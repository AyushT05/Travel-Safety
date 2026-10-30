import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

// Shows the tourist's OPEN geofence alerts (approaching / inside a risk area) while a trip is being
// shared. The alerts are created by the scoring service; the tourist cannot change them, so
// "Dismiss" only hides one on this screen.
//
// Delivery: Realtime for speed, plus a 30 s poll in case the socket dropped. Push notifications
// (for when the app is closed) are a separate step.

const OPEN_TYPES = ['geofence_approach', 'geofence_entry', 'deviation'];
const MAX_AGE_MS = 6 * 3600 * 1000;      // an "open" alert older than this is not trusted as current
const POLL_MS = 30000;

const TITLE = {
  geofence_entry: 'You are in a risk area',
  geofence_approach: 'Approaching a risk area',
  deviation: 'Route Deviation Detected',
};
const PALETTE = {
  critical: { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B', icon: '#DC2626' },
  warning: { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', icon: '#D97706' },
  info: { bg: '#EFF6FF', border: '#BFDBFE', text: '#1E40AF', icon: '#2563EB' },
};

export default function GeofenceBanner({ userId, isSharing }) {
  const [alerts, setAlerts] = useState([]);         // open geofence alerts, newest first
  const [dismissed, setDismissed] = useState({});
  const seen = useRef(new Set());
  const primed = useRef(false);                     // the first load must not pop up old alerts

  const announce = useCallback((a) => {
    if (seen.current.has(a.id)) return;
    seen.current.add(a.id);
    if (!primed.current) return;
    // A modal for the serious ones; the banner below stays either way.
    if (a.severity === 'critical' || a.type === 'geofence_entry' || a.type === 'deviation') {
      Alert.alert(TITLE[a.type] || 'Safety alert', a.message || 'Check your surroundings and stay alert.');
    }
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    const since = new Date(Date.now() - MAX_AGE_MS).toISOString();
    const { data, error } = await supabase
      .from('alerts')
      .select('id,type,severity,message,created_at,status')
      .eq('user_id', userId)
      .in('type', OPEN_TYPES)
      .eq('status', 'open')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) { console.warn('geofence alerts load failed:', error.message); return; }
    (data || []).forEach(announce);
    primed.current = true;
    setAlerts(data || []);
  }, [userId, announce]);

  useEffect(() => {
    if (!isSharing || !userId) { setAlerts([]); primed.current = false; seen.current = new Set(); return; }
    load();
    const channel = supabase
      .channel(`geofence_alerts_${userId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'alerts', filter: `user_id=eq.${userId}` },
        (payload) => {
          const a = payload.new;
          if (!a || !OPEN_TYPES.includes(a.type)) return;
          if (a.status === 'open') {
            announce(a);
            setAlerts((cur) => [a, ...cur.filter((x) => x.id !== a.id)].slice(0, 5));
          } else {
            setAlerts((cur) => cur.filter((x) => x.id !== a.id));     // resolved: the tourist left, or it was superseded
          }
        })
      .subscribe();
    const poll = setInterval(load, POLL_MS);
    return () => { clearInterval(poll); supabase.removeChannel(channel); };
  }, [userId, isSharing, load, announce]);

  const visible = alerts.filter((a) => !dismissed[a.id]).slice(0, 2);
  if (!isSharing || visible.length === 0) return null;

  return (
    <View style={{ marginBottom: 8 }}>
      {visible.map((a) => {
        const c = PALETTE[a.severity] || PALETTE.info;
        return (
          <View key={a.id} style={[s.card, { backgroundColor: c.bg, borderColor: c.border }]}>
            <Ionicons name={a.severity === 'critical' ? 'warning' : 'alert-circle'} size={22} color={c.icon} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={[s.title, { color: c.text }]}>{TITLE[a.type] || 'Safety alert'}</Text>
              {!!a.message && <Text style={[s.msg, { color: c.text }]}>{a.message}</Text>}
            </View>
            <TouchableOpacity onPress={() => setDismissed((d) => ({ ...d, [a.id]: true }))} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={18} color={c.text} />
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 6 },
  title: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  msg: { fontSize: 12.5, lineHeight: 17 },
});
