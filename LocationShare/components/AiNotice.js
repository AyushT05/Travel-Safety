import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Alert, Vibration } from 'react-native';
import { Text } from './Text';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchOpenNotifications, subscribeNotifications, respondToNotification, markNotificationRead, showLocalNotification,
} from '../lib/notifications';
import { triggerSos } from '../lib/sosService';

const PALETTE = {
  urgent: { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B', icon: '#DC2626', name: 'warning' },
  warning: { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', icon: '#D97706', name: 'alert-circle' },
  notice: { bg: '#EFF6FF', border: '#BFDBFE', text: '#1E40AF', icon: '#2563EB', name: 'information-circle' },
  info: { bg: '#F0FDF4', border: '#BBF7D0', text: '#166534', icon: '#16A34A', name: 'checkmark-circle' },
};
const POLL_MS = 30000;
const MAX_AGE_MS = 6 * 3600 * 1000;

// Messages from the safety analyst. Shows the newest unanswered one with answer buttons.
export default function AiNotice({ user, travelCardId, isSharing }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set());
  const primed = useRef(false);

  const take = useCallback((rows, announce) => {
    setItems((cur) => {
      const byId = new Map(cur.map((r) => [r.id, r]));
      rows.forEach((r) => byId.set(r.id, { ...byId.get(r.id), ...r }));
      return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
    });
    rows.forEach((r) => {
      if (seen.current.has(r.id)) return;
      seen.current.add(r.id);
      if (announce && !r.response && Date.now() - new Date(r.created_at).getTime() < 10 * 60 * 1000) {
        if (r.severity === 'urgent' || r.severity === 'warning') Vibration.vibrate([0, 300, 150, 300]);
        showLocalNotification(r);
      }
    });
  }, []);

  useEffect(() => {
    if (!user?.id || !isSharing) return undefined;
    let alive = true;
    const load = async () => { const rows = await fetchOpenNotifications(user.id, travelCardId); if (alive) { take(rows, primed.current); primed.current = true; } };
    load();
    const unsub = subscribeNotifications(user.id, (row) => alive && take([row], true));
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); unsub(); };
  }, [user?.id, travelCardId, isSharing, take]);

  const current = items.find((n) => !n.response && !n.read_at && Date.now() - new Date(n.created_at).getTime() < MAX_AGE_MS);
  if (!current) return null;
  const p = PALETTE[current.severity] || PALETTE.notice;
  const actions = Array.isArray(current.actions) ? current.actions : [];

  const answer = async (id) => {
    setBusy(true);
    try {
      if (id === 'need_help') {
        Alert.alert('Send an SOS now?', 'This alerts the safety desk with your location.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Send SOS', style: 'destructive', onPress: async () => {
            await respondToNotification(current.id, 'need_help').catch(() => {});
            await triggerSos({ user, travelCardId });
            setItems((cur) => cur.map((n) => (n.id === current.id ? { ...n, response: 'need_help' } : n)));
          } },
        ]);
      } else {
        await respondToNotification(current.id, 'ok');
        setItems((cur) => cur.map((n) => (n.id === current.id ? { ...n, response: 'ok' } : n)));
      }
    } catch { Alert.alert('Could not send your reply', 'Please try again. If you need help right now, use the SOS button or call 112.'); }
    finally { setBusy(false); }
  };
  const dismiss = () => { markNotificationRead(current.id); setItems((cur) => cur.map((n) => (n.id === current.id ? { ...n, read_at: new Date().toISOString() } : n))); };

  return (
    <View style={[s.card, { backgroundColor: p.bg, borderColor: p.border }]} accessibilityRole="alert">
      <View style={s.row}>
        <Ionicons name={p.name} size={20} color={p.icon} />
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: p.text }]}>{current.title}</Text>
          <Text style={[s.body, { color: p.text }]}>{current.body}</Text>
        </View>
        {actions.length === 0 && <TouchableOpacity onPress={dismiss} hitSlop={10}><Ionicons name="close" size={18} color={p.text} /></TouchableOpacity>}
      </View>
      {actions.length > 0 && (
        <View style={s.actions}>
          {actions.map((a) => (
            <TouchableOpacity key={a.id} disabled={busy} onPress={() => answer(a.id)}
              style={[s.btn, a.id === 'need_help' ? s.btnHelp : s.btnOk]}>
              <Text style={[s.btnText, a.id === 'need_help' && { color: '#fff' }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 14, fontWeight: '700' }, body: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  btnOk: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db' }, btnHelp: { backgroundColor: '#DC2626' },
  btnText: { fontSize: 13, fontWeight: '600', color: '#111827' },
});
