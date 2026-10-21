import React, { useEffect, useState, useCallback } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { triggerSos, getSos, latestOpenSos, describeSos } from '../lib/sosService';
import { subscribe, setSmsStatusAndNotify } from '../lib/sync';
import { openSmsComposer } from '../lib/smsFallback';

const TONES = {
  ok:   { bg: '#F0FDF4', border: '#BBF7D0', fg: '#166534' },
  warn: { bg: '#FFFBEB', border: '#FDE68A', fg: '#92400E' },
  bad:  { bg: '#FEF2F2', border: '#FECACA', fg: '#991B1B' },
};

// One confirm tap, then the SOS is written to the phone's own storage before any
// network call. The status card below tells the truth about where it is:
// saved locally -> sending -> delivered to server -> acknowledged by a person.
export default function PanicButton({ user, travelCardId = null, style }) {
  const [busy, setBusy] = useState(false);
  const [eventId, setEventId] = useState(null);
  const [row, setRow] = useState(null);

  const refresh = useCallback(async (id) => {
    const r = id ? await getSos(id) : await latestOpenSos();
    setRow(r || null);
    if (r && !id) setEventId(r.event_id);
  }, []);

  // Resume after an app restart: an SOS that is not acknowledged yet stays visible.
  useEffect(() => { refresh(null); }, [refresh]);
  useEffect(() => subscribe(() => refresh(eventId)), [eventId, refresh]);

  function confirmAndSend() {
    Alert.alert(
      'Send SOS?',
      'This alerts the safety dashboard with your location. It is saved on this phone first and retried until it gets through.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send SOS', style: 'destructive', onPress: send },
      ]
    );
  }

  async function send() {
    setBusy(true);
    try {
      const id = await triggerSos({ user, travelCardId });
      setEventId(id);
      await refresh(id);
    } catch (e) {
      // Only possible if local storage itself failed.
      Alert.alert('SOS could not be saved', `${e?.message ?? e}. Call 112 now.`);
    }
    setBusy(false);
  }

  async function sendBySms() {
    try {
      const status = await openSmsComposer(row.event_id, JSON.parse(row.payload));
      if (status === 'composer_sent') await setSmsStatusAndNotify(row.event_id, 'composer_sent');
    } catch (e) {
      Alert.alert('Could not open SMS', `${e?.message ?? e}. Call 112 now.`);
    }
  }

  const info = describeSos(row);
  const tone = info ? TONES[info.tone] : null;

  return (
    <View>
      <TouchableOpacity style={[s.btn, style]} onPress={confirmAndSend} disabled={busy} activeOpacity={0.85}>
        {busy ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Ionicons name="warning" size={18} color="#fff" />
            <Text style={s.text}>SOS</Text>
          </>
        )}
      </TouchableOpacity>

      {info && (
        <View style={[s.card, { backgroundColor: tone.bg, borderColor: tone.border }]}>
          <Text style={[s.cardTitle, { color: tone.fg }]}>{info.title}</Text>
          <Text style={[s.cardBody, { color: tone.fg }]}>{info.body}</Text>
          {info.action === 'sms_composer' && (
            <TouchableOpacity style={s.smsBtn} onPress={sendBySms} activeOpacity={0.85}>
              <Text style={s.smsBtnText}>Send SOS by SMS</Text>
            </TouchableOpacity>
          )}
          {row?.status === 'acknowledged' && (
            <TouchableOpacity onPress={() => { setRow(null); setEventId(null); }}>
              <Text style={[s.dismiss, { color: tone.fg }]}>Dismiss</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#DC2626', borderRadius: 16, paddingVertical: 16,
    shadowColor: '#DC2626', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  text: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  card: { marginTop: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  cardTitle: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  cardBody: { fontSize: 12.5, lineHeight: 18 },
  smsBtn: { marginTop: 10, backgroundColor: '#991B1B', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  smsBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  dismiss: { marginTop: 8, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
});
