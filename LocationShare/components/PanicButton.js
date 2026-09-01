import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';

// One confirm tap after the initial press, keeps it fast to trigger for real
// but hard to fire by accident. Writes straight into `alerts` (RLS: insert
// only allowed as your own user_id), the dashboard picks it up over Realtime
// with no polling delay.
export default function PanicButton({ user, style }) {
  const [sending, setSending] = useState(false);

  function confirmAndSend() {
    Alert.alert(
      'Send SOS?',
      'This immediately notifies the safety dashboard with your current location.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send SOS', style: 'destructive', onPress: sendAlert },
      ]
    );
  }

  async function sendAlert() {
    setSending(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location needed',
          'Enable location access so your SOS includes a position.'
        );
        setSending(false);
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { error } = await supabase.from('alerts').insert({
        user_id: user.id,
        type: 'panic',
        severity: 'critical',
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        message: 'Panic button triggered from mobile app',
      });

      if (error) {
        Alert.alert(
          'Could not send SOS',
          `${error.message}. If this persists, call emergency services directly.`
        );
      } else {
        Alert.alert('SOS sent', 'Your location has been shared with the dashboard.');
      }
    } catch {
      Alert.alert(
        'Could not send SOS',
        'Check your connection and try again, or call emergency services directly.'
      );
    }
    setSending(false);
  }

  return (
    <TouchableOpacity
      style={[s.btn, style]}
      onPress={confirmAndSend}
      disabled={sending}
      activeOpacity={0.85}
    >
      {sending ? (
        <ActivityIndicator color="#fff" size="small" />
      ) : (
        <>
          <Ionicons name="warning" size={18} color="#fff" />
          <Text style={s.text}>SOS</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  text: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
});
