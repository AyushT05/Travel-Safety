import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated, Alert, Platform, ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { Ionicons, Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import PanicButton from '../components/PanicButton';
import SafetyBanner from '../components/SafetyBanner';
import NearbyServices from '../components/NearbyServices';
import { recordFix } from '../lib/locationRecorder';
import { subscribe } from '../lib/sync';
import { pendingCounts } from '../lib/localDb';
import { ensureSmsPermission } from '../lib/smsFallback';
import { startBackgroundTracking, stopBackgroundTracking, askBackgroundDisclosure, isBackgroundTrackingActive } from '../lib/backgroundTracking';
import { classifyFreshness } from '../lib/locationQuality';

export default function ActiveTracking({ user, card, onStop }) {
  const [isSharing, setIsSharing]       = useState(false);
  const [locationData, setLocationData] = useState(null);
  const [updateCount, setUpdateCount]   = useState(0);
  const [serverError, setServerError]   = useState(false);
  const [permissionAsked, setPermissionAsked] = useState(false);
  const [pending, setPending]       = useState({ locations: 0, sos: 0 });
  const [background, setBackground] = useState(false);   // true: the foreground service is recording
  const [bgNote, setBgNote]         = useState(null);    // why background tracking is off, if it is
  const [now, setNow]               = useState(Date.now());
  const backgroundRef = useRef(false);                   // read inside the watcher callback

  const subscriptionRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ringAnim  = useRef(new Animated.Value(1)).current;

  const today   = new Date().toISOString().split('T')[0];
  const isToday = card.start_date <= today && card.end_date >= today;

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

  // Leaving the screen must not leak the foreground watcher. The background service is NOT
  // stopped here: it ends only on Stop, or when the trip ends.
  useEffect(() => () => { subscriptionRef.current?.remove(); subscriptionRef.current = null; }, []);

  // Reopened while the service is still running (e.g. the app was swiped away): reflect that.
  useEffect(() => {
    isBackgroundTrackingActive().then((on) => { if (on) { backgroundRef.current = true; setBackground(true); } });
  }, []);

  useEffect(() => {
    if (isToday && !permissionAsked) {
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
  }, []);

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
    let bg = { ok: false, reason: 'declined' };
    if (await askBackgroundDisclosure()) {
      bg = await startBackgroundTracking({ userId: user.id, travelCardId: card.id, endDate: card.end_date });
    }
    backgroundRef.current = bg.ok;
    setBackground(bg.ok);
    setBgNote(bg.ok ? null : bg.reason === 'declined' ? 'Background tracking is off. Updates pause when the app is closed.'
      : bg.reason === 'background_permission_denied' ? 'Background location was not allowed. Updates pause when the app is closed.'
      : 'Background tracking is not available in this build. Updates pause when the app is closed.');

    setIsSharing(true); setUpdateCount(0); setServerError(false);
    startPulse();
    await supabase.from('travel_cards').update({ status: 'active' }).eq('id', card.id);

    subscriptionRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 },
      async (pos) => {
        const data = {
          name: user.id,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          observedAt: pos.timestamp || Date.now(),
        };
        setLocationData(data);
        setUpdateCount(c => c + 1);
        // Durable first: the fix is saved to the phone's SQLite outbox, then uploaded by the
        // SyncManager (batched, retried with backoff, idempotent via event_id). A network
        // failure can no longer lose a fix. recorded_at on the server is the device time.
        // While the background service is running it is the single recorder; recording here too
        // would store every fix twice.
        if (!backgroundRef.current) {
          try { await recordFix(pos, { userId: user.id, travelCardId: card.id }); }
          catch (e) { console.warn('could not store fix locally:', e?.message ?? e); }
        }
      }
    );
  }

  async function stopSharing() {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    await stopBackgroundTracking();
    backgroundRef.current = false; setBackground(false); setBgNote(null);
    setIsSharing(false); setLocationData(null);
    setUpdateCount(0); setServerError(false);
    stopPulse();
  }

  const places    = card.places || [];
  const emergency = card.emergency_contacts || [];

  return (
    <View style={{ flex: 1, backgroundColor: '#F7F5F0' }}>
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
                color={isSharing ? '#fff' : '#9E9484'}
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
            <Text style={s.startBtnText}>Start Location Sharing</Text>
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
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#EAE4D9',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A' },

  liveCard: {
    backgroundColor: '#fff', borderRadius: 24, padding: 32,
    alignItems: 'center', marginBottom: 16,
    borderWidth: 1.5, borderColor: '#EAE4D9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  liveCardActive: { borderColor: '#D1FAE5', backgroundColor: '#F0FDF4' },

  orbWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  orbRing: {
    position: 'absolute', width: 96, height: 96, borderRadius: 48,
    borderWidth: 2, borderColor: '#1B4332',
  },
  orbCore: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#F7F5F0',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#EAE4D9',
  },
  orbCoreActive: {
    backgroundColor: '#1B4332', borderColor: '#1B4332',
    shadowColor: '#1B4332', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },

  liveLabel:       { fontSize: 14, fontWeight: '700', color: '#C4BAA8', letterSpacing: 0.5 },
  liveLabelActive: { color: '#1B4332' },

  coordsRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  coords: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12, color: '#52796F',
  },
  acquiringRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  acquiringText:{ fontSize: 13, color: '#9E9484' },

  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 18,
    alignItems: 'center', borderWidth: 1, borderColor: '#EAE4D9',
  },
  statValue: { fontSize: 22, fontWeight: '800', color: '#1B4332', marginBottom: 4 },
  statLabel: { fontSize: 11, fontWeight: '600', color: '#9E9484' },

  warnBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A',
    borderRadius: 12, padding: 12, marginBottom: 16,
  },
  warnText: { fontSize: 13, color: '#92400E', fontWeight: '500', flex: 1 },
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
    marginBottom: 12, borderWidth: 1, borderColor: '#EAE4D9',
  },
  infoCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  infoCardTitle:  { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F7F5F0',
  },
  infoLabel: { fontSize: 13, color: '#9E9484', fontWeight: '500' },
  infoValue: { fontSize: 13, color: '#1A1A1A', fontWeight: '600', flex: 1, textAlign: 'right' },
});