import React, { useState, useRef, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator, Animated, Alert, Platform, ScrollView } from 'react-native';
import { Text } from '../components/Text';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { Ionicons, Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import PanicButton from '../components/PanicButton';
import SafetyBanner from '../components/SafetyBanner';
import GeofenceBanner from '../components/GeofenceBanner';
import AiNotice from '../components/AiNotice';
import NearbyServices from '../components/NearbyServices';
import { recordFix } from '../lib/locationRecorder';
import { subscribe } from '../lib/sync';
import { pendingCounts, getLastFix, getTrackingContext, setTrackingContext } from '../lib/localDb';
import { ensureSmsPermission } from '../lib/smsFallback';
import { startBackgroundTracking, askBackgroundDisclosure, isBackgroundTrackingActive } from '../lib/backgroundTracking';
import { startForegroundWatch } from '../lib/foregroundTracking';
import { stopAllTracking } from '../lib/trackingControl';
import { afterFix } from '../lib/tripLegs';
import { legFor, resumeIsDue } from '../lib/returnTrip';
import { MODES, formatDuration } from '../lib/tripEstimate';
import { classifyFreshness } from '../lib/locationQuality';

export default function ActiveTracking({ user, card, onStop, trackingState, onTrackingStateChange }) {
  const [isSharing, setIsSharing]       = useState(trackingState?.isSharing || false);
  const [locationData, setLocationData] = useState(trackingState?.locationData || null);
  const [updateCount, setUpdateCount]   = useState(trackingState?.updateCount || 0);
  const [serverError, setServerError]   = useState(false);
  const [permissionAsked, setPermissionAsked] = useState(trackingState?.permissionAsked || false);
  const [pending, setPending]       = useState({ locations: 0, sos: 0 });
  const [background, setBackground] = useState(trackingState?.background || false);   // true: the foreground service is recording
  const [bgNote, setBgNote]         = useState(trackingState?.bgNote || null);    // why background tracking is off, if it is
  const [now, setNow]               = useState(Date.now());
  const [restored, setRestored]     = useState(false);
  const backgroundRef = useRef(trackingState?.background || false);                   // read inside the watcher callback
  // 'upcoming' | 'active' | 'paused' (return trip: waiting for the return day) | 'completed'
  const [legStatus, setLegStatus]  = useState(card.status);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ringAnim  = useRef(new Animated.Value(1)).current;

  const today   = new Date().toISOString().split('T')[0];
  const isToday = card.start_date <= today && card.end_date >= today;

  // Persist tracking state to parent so it survives navigation
  useEffect(() => {
    if (onTrackingStateChange) {
      onTrackingStateChange({
        isSharing,
        locationData,
        updateCount,
        permissionAsked,
        background,
        bgNote,
      });
    }
  }, [isSharing, locationData, updateCount, permissionAsked, background, bgNote, onTrackingStateChange]);

  // Show how many fixes are still waiting on this phone (offline / retrying).
  useEffect(() => {
    const refresh = () => pendingCounts().then(setPending).catch(() => {});
    refresh();
    return subscribe(refresh);
  }, []);

  // Re-evaluate freshness every few seconds so a silent GPS shows STALE instead of freezing on LIVE.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(t);
  }, []);

  // The foreground watcher is owned by lib/foregroundTracking (one per app), not by this screen.
  // Leaving the screen while sharing deliberately keeps it running; Stop Sharing stops it for real.

  // One handler for every foreground fix, so there is a single place that records, counts and
  // checks for arrival.
  async function handleFgFix(pos) {
    setLocationData({
      name: user.id, lat: pos.coords.latitude, lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy, observedAt: pos.timestamp || Date.now(),
    });
    setUpdateCount(c => c + 1);
    // Durable first: SQLite outbox, then the SyncManager uploads (batched, retried, idempotent).
    // Recorded even when background mode is on: Android may not dispatch that service's task until
    // the app is backgrounded.
    try { await recordFix(pos, { userId: user.id, travelCardId: card.id }); }
    catch (e) { console.warn('could not store fix locally:', e?.message ?? e); }
    const ended = await afterFix(pos, { stopTracking: stopAllTracking });
    if (ended) onLegEnded(ended);
  }

  function onLegEnded(kind) {   // 'paused' | 'completed'
    backgroundRef.current = false; setBackground(false); setBgNote(null);
    setIsSharing(false); setLocationData(null); setUpdateCount(0); stopPulse();
    setLegStatus(kind);
    Alert.alert(
      kind === 'paused' ? 'You have arrived' : 'Welcome back',
      kind === 'paused'
        ? `Tracking is paused. It resumes on ${card.return_date}, when you head back.`
        : 'Your trip is complete and tracking has stopped.'
    );
  }

  // Reopened while the service is still running (e.g. the app was swiped away): reflect that.
  // Also restart the foreground watcher if we were sharing when we left.
  useEffect(() => {
    let mounted = true;

    async function restore() {
      const [on, context, lastFix] = await Promise.all([
        isBackgroundTrackingActive(), getTrackingContext(), getLastFix(),
      ]);
      if (!mounted) return;
      // The SQLite context is written before the OS service starts. It is the
      // durable source of truth when this screen is reopened or the app was
      // restarted, whereas React navigation state only survives one mount.
      const ownsActiveContext = context?.userId === user.id && context?.travelCardId === card.id;
      if (on && ownsActiveContext) {
        backgroundRef.current = true;
        setBackground(true);
        setIsSharing(true);
        setPermissionAsked(true);
        if (lastFix) setLocationData(lastFix);
      }

      // We were sharing when we navigated away: point the single watcher at this screen again.
      if (trackingState?.isSharing) {
        const ok = await startForegroundWatch(handleFgFix);
        if (ok && mounted) startPulse();
      }
    }

    restore().finally(() => { if (mounted) setRestored(true); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const waitingForReturn = legStatus === 'paused' && !resumeIsDue({ ...card, status: legStatus }, today);
    if (restored && isToday && !permissionAsked && !isSharing && !waitingForReturn && legStatus !== 'completed') {
      setPermissionAsked(true);
      Alert.alert(
        'Location Access Required',
        'Your travel card is active today. Allow location access to start safety tracking?',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Allow & Start', onPress: startSharing },
        ]
      );
    }
  }, [restored, isToday, permissionAsked, isSharing, legStatus]);

  function startPulse() {
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.15, duration: 900, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 900, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(ringAnim, { toValue: 1.7, duration: 1800, useNativeDriver: true }),
      Animated.timing(ringAnim, { toValue: 1,   duration: 0,    useNativeDriver: true }),
    ])).start();
  }

  function stopPulse() {
    pulseAnim.stopAnimation(); pulseAnim.setValue(1);
    ringAnim.stopAnimation();  ringAnim.setValue(1);
  }

  async function startSharing() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'Please enable location access in Settings.'); return;
    }
    ensureSmsPermission().catch(() => {}); // so an offline SOS can be texted without any taps
    // Background tracking is best effort: the disclosure can be declined, and Expo Go cannot do it.
    // Either way foreground sharing still works and records through the watcher below.
    // Return trips: which leg is this, and where does it end? (null target = nothing auto-stops)
    const leg = legFor({ ...card, status: legStatus });
    const extra = leg.target
      ? { leg: leg.leg, target: leg.target, pauseOnArrival: leg.pauseOnArrival,
          completeOnArrival: leg.completeOnArrival, returnDate: card.return_date ?? null,
          arrival: { count: 0, sinceMs: null } }
      : null;

    let bg = { ok: false, reason: 'declined' };
    if (await askBackgroundDisclosure()) {
      bg = await startBackgroundTracking({ userId: user.id, travelCardId: card.id, endDate: card.end_date, extra });
    }
    // Foreground-only sharing still needs the leg context so arrival can be detected.
    if (!bg.ok && extra) {
      await setTrackingContext({ userId: user.id, travelCardId: card.id, endDate: card.end_date, extra }).catch(() => {});
    }
    backgroundRef.current = bg.ok;
    setBackground(bg.ok);
    setBgNote(bg.ok ? null : bg.reason === 'declined' ? 'Background tracking is off. Updates pause when the app is closed.'
      : bg.reason === 'background_permission_denied' ? 'Background location was not allowed. Updates pause when the app is closed.'
      : 'Background tracking is not available in this build. Updates pause when the app is closed.');

    setIsSharing(true); setUpdateCount(0); setServerError(false);
    startPulse();
    // Starting clears the server-side "stopped" marker (see Stop Sharing) and, on a return leg,
    // records when tracking resumed so the dropout check does not fire before the first fix lands.
    const patch = { status: 'active', tracking_stopped_at: null };
    if (leg.leg === 'return') patch.tracking_resumed_at = new Date().toISOString();
    let { error: cardErr } = await supabase.from('travel_cards').update(patch).eq('id', card.id);
    if (cardErr) {   // migration 20261106 not applied yet: fall back to the old behaviour
      ({ error: cardErr } = await supabase.from('travel_cards').update({ status: 'active' }).eq('id', card.id));
      if (cardErr) console.warn('could not mark the trip active:', cardErr.message);
    }
    setLegStatus('active');

    // Do not wait for the first watch callback (which can be delayed by the
    // device). This gives a newly started trip an immediate, card-linked map
    // position even when background tracking is also enabled.
    try {
      const firstFix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLocationData({
        name: user.id, lat: firstFix.coords.latitude, lon: firstFix.coords.longitude,
        accuracy: firstFix.coords.accuracy, observedAt: firstFix.timestamp || Date.now(),
      });
      setUpdateCount(1);
      await recordFix(firstFix, { userId: user.id, travelCardId: card.id });
    } catch (e) {
      console.warn('could not get initial location fix:', e?.message ?? e);
    }

    await startForegroundWatch(handleFgFix);
  }

  async function stopSharing() {
    await stopAllTracking();               // foreground watcher + background service + context
    backgroundRef.current = false; setBackground(false); setBgNote(null);
    setIsSharing(false); setLocationData(null);
    setUpdateCount(0); setServerError(false);
    stopPulse();
    // Make Stop authoritative on the server too: fixes recorded after this moment are refused, so
    // an old install, a stray service or a restarted task cannot keep feeding the dashboard.
    // Best effort (the phone may be offline); the local stop above already happened.
    supabase.from('travel_cards').update({ tracking_stopped_at: new Date().toISOString() }).eq('id', card.id)
      .then(({ error }) => { if (error) console.warn('could not record the stop on the server:', error.message); });
  }

  const places    = card.places || [];
  const emergency = card.emergency_contacts || [];

  return (
    <View style={{ flex: 1, backgroundColor: '#F2F7F3' }}>
      <StatusBar style="dark" />

      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={onStop}>
          <Feather name="arrow-left" size={18} color="#1B4332" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Active Journey</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <PanicButton user={user} travelCardId={card.id} />
      </View>

      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <GeofenceBanner userId={user.id} isSharing={isSharing} />
        <AiNotice user={user} travelCardId={card.id} isSharing={isSharing} />
        <SafetyBanner
          lat={locationData?.lat}
          lon={locationData?.lon}
          user={user}
          travelCardId={card.id}
          isSharing={isSharing}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {legStatus === 'paused' && !isSharing && (
          <View style={s.pausedBox}>
            <Feather name="pause-circle" size={18} color="#1D4ED8" />
            <View style={{ flex: 1 }}>
              <Text style={s.pausedTitle}>Tracking paused</Text>
              <Text style={s.pausedText}>
                You reached your destination. Tracking resumes on {card.return_date}, when you head back.
                You can also resume it now.
              </Text>
            </View>
          </View>
        )}
        {legStatus === 'completed' && !isSharing && (
          <View style={s.okBox}>
            <Feather name="check-circle" size={14} color="#166534" />
            <Text style={s.okText}>Trip complete. Tracking has stopped.</Text>
          </View>
        )}

        {/* Live orb */}
        <View style={[s.liveCard, isSharing && s.liveCardActive]}>
          <View style={s.orbWrap}>
            {isSharing && (
              <Animated.View style={[s.orbRing, {
                transform: [{ scale: ringAnim }],
                opacity: ringAnim.interpolate({ inputRange: [1, 1.7], outputRange: [0.35, 0] }),
              }]} />
            )}
            <View style={[s.orbCore, isSharing && s.orbCoreActive]}>
              <Ionicons
                name={isSharing ? 'navigate' : 'navigate-outline'}
                size={28}
                color={isSharing ? '#fff' : '#6F8378'}
              />
            </View>
          </View>

          <Text style={[s.liveLabel, isSharing && s.liveLabelActive]}>
            {isSharing ? 'Broadcasting Live' : 'Not Sharing'}
          </Text>

          {isSharing && locationData && (
            <View style={s.coordsRow}>
              <Feather name="map-pin" size={12} color="#52796F" />
              <Text style={s.coords}>
                {locationData.lat.toFixed(5)},  {locationData.lon.toFixed(5)}
              </Text>
            </View>
          )}

          {isSharing && !locationData && (
            <View style={s.acquiringRow}>
              <ActivityIndicator color="#1B4332" size="small" />
              <Text style={s.acquiringText}>Acquiring GPS signal</Text>
            </View>
          )}
        </View>

        {/* Stats */}
        {isSharing && locationData && (
          <View style={s.statsRow}>
            <StatCard icon="crosshair" label="Accuracy" value={`${locationData.accuracy.toFixed(0)} m`} />
            <StatCard icon="clock" label="Fix status"
              value={classifyFreshness({ observedAtMs: locationData.observedAt, accuracy: locationData.accuracy, now })} />
          </View>
        )}

        {isSharing && (
          <View style={background ? s.okBox : s.warnBox}>
            <Feather name={background ? 'shield' : 'alert-triangle'} size={14} color={background ? '#166534' : '#92400E'} />
            <Text style={background ? s.okText : s.warnText}>
              {background ? 'Tracking continues when the app is closed.' : bgNote}
            </Text>
          </View>
        )}

        {pending.locations > 0 && (
          <View style={s.warnBox}>
            <Feather name="wifi-off" size={14} color="#92400E" />
            <Text style={s.warnText}>
              {pending.locations} location update{pending.locations === 1 ? '' : 's'} saved on this phone, waiting to upload
            </Text>
          </View>
        )}

        {/* Toggle button */}
        {!isSharing ? (
          <TouchableOpacity style={s.startBtn} onPress={startSharing} activeOpacity={0.9}>
            <Ionicons name="navigate" size={18} color="#fff" />
            <Text style={s.startBtnText}>{legStatus === 'paused' ? 'Resume Tracking' : 'Start Location Sharing'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.stopBtn} onPress={stopSharing} activeOpacity={0.9}>
            <Feather name="square" size={16} color="#DC2626" />
            <Text style={s.stopBtnText}>Stop Sharing</Text>
          </TouchableOpacity>
        )}

        {/* Trip info */}
        <View style={s.infoCard}>
          <View style={s.infoCardHeader}>
            <Feather name="map" size={15} color="#52796F" />
            <Text style={s.infoCardTitle}>Trip Details</Text>
          </View>
          <InfoRow label="Traveller" value={card.full_name} />
          <InfoRow label="Dates" value={`${card.start_date}  →  ${card.end_date}`} />
          {places.length > 0 && <InfoRow label="Route" value={places.join(' → ')} />}
          {MODES[card.transport_mode] && <InfoRow label="Travelling by" value={MODES[card.transport_mode].label} />}
          {card.eta_plan?.total_min != null && (
            <InfoRow label="Estimated time"
              value={`${formatDuration(card.eta_plan.total_min)}${card.eta_plan.break_min ? ` (includes ${formatDuration(card.eta_plan.break_min)} of breaks)` : ''}`} />
          )}
          {card.return_date && <InfoRow label="Heading back" value={card.return_date} />}
        </View>

        {emergency.length > 0 && (
          <View style={s.infoCard}>
            <View style={s.infoCardHeader}>
              <Feather name="phone-call" size={15} color="#52796F" />
              <Text style={s.infoCardTitle}>Emergency Contacts</Text>
            </View>
            {emergency.map((c, i) => (
              <InfoRow key={i} label={c.name} value={c.phone} />
            ))}
          </View>
        )}

        {/* Nearby emergency services — visible only while sharing */}
        {isSharing && locationData && (
          <NearbyServices lat={locationData.lat} lon={locationData.lon} />
        )}
      </ScrollView>
    </View>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <View style={s.statCard}>
      <Feather name={icon} size={16} color="#52796F" style={{ marginBottom: 8 }} />
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 36, paddingBottom: 16,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#DAE6DD',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#0F2118' },

  liveCard: {
    backgroundColor: '#fff', borderRadius: 24, padding: 32,
    alignItems: 'center', marginBottom: 16,
    borderWidth: 1.5, borderColor: '#DAE6DD',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  liveCardActive: { borderColor: '#CBE7D2', backgroundColor: '#F0FDF4' },

  orbWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  orbRing: {
    position: 'absolute', width: 96, height: 96, borderRadius: 48,
    borderWidth: 2, borderColor: '#1B4332',
  },
  orbCore: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#F2F7F3',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#DAE6DD',
  },
  orbCoreActive: {
    backgroundColor: '#1B4332', borderColor: '#1B4332',
    shadowColor: '#1B4332', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },

  liveLabel:       { fontSize: 14, fontWeight: '700', color: '#A7B8AD', },
  liveLabelActive: { color: '#1B4332' },

  coordsRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  coords: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12, color: '#52796F',
  },
  acquiringRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  acquiringText:{ fontSize: 13, color: '#6F8378' },

  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 18,
    alignItems: 'center', borderWidth: 1, borderColor: '#DAE6DD',
  },
  statValue: { fontSize: 22, fontWeight: '800', color: '#1B4332', marginBottom: 4 },
  statLabel: { fontSize: 11, fontWeight: '600', color: '#6F8378' },

  warnBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A',
    borderRadius: 12, padding: 12, marginBottom: 16,
  },
  warnText: { fontSize: 13, color: '#92400E', fontWeight: '500', flex: 1 },
  pausedBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE',
    borderRadius: 12, padding: 12, marginBottom: 16,
  },
  pausedTitle: { fontSize: 14, color: '#1E3A8A', fontWeight: '700', marginBottom: 2 },
  pausedText: { fontSize: 13, color: '#1E40AF', fontWeight: '500', lineHeight: 18 },
  okBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0',
    borderRadius: 12, padding: 12, marginBottom: 16,
  },
  okText: { fontSize: 13, color: '#166534', fontWeight: '500', flex: 1 },

  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#1B4332', borderRadius: 16, paddingVertical: 16, marginBottom: 20,
    shadowColor: '#1B4332', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28, shadowRadius: 12, elevation: 6,
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFF5F5', borderRadius: 16, paddingVertical: 16, marginBottom: 20,
    borderWidth: 1.5, borderColor: '#FFC9C9',
  },
  stopBtnText: { color: '#DC2626', fontSize: 16, fontWeight: '700' },

  infoCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    marginBottom: 12, borderWidth: 1, borderColor: '#DAE6DD',
  },
  infoCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  infoCardTitle:  { fontSize: 14, fontWeight: '700', color: '#0F2118' },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F2F7F3',
  },
  infoLabel: { fontSize: 13, color: '#6F8378', fontWeight: '500' },
  infoValue: { fontSize: 13, color: '#0F2118', fontWeight: '600', flex: 1, textAlign: 'right' },
});
