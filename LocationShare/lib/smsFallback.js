// SMS fallback for SOS when there is no data connection.
// Android + native module + SEND_SMS granted -> sent silently, no taps.
// Otherwise (iOS, Expo Go, permission denied) -> the user taps one button to open the
// SMS composer pre-filled; the OS does not allow silent SMS there.
import { Platform, PermissionsAndroid } from 'react-native';
import * as SMS from 'expo-sms';
import SmsSender from '../modules/sms-sender';

// The number of the phone running "SMS Gateway for Android", e.g. +919876543210
const GATEWAY_NUMBER = process.env.EXPO_PUBLIC_SOS_SMS_NUMBER;

// SOS1|event_id|lat|lon|accuracy_m|fix_epoch_s|press_epoch_s|L(ive)/K(nown)
// Carries the phone's own GPS fix: that is the point, because offline the server has none.
export function buildSosSms(eventId, p) {
  const sec = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) : '');
  return [
    'SOS1', eventId,
    p.lat != null ? p.lat.toFixed(6) : '',
    p.lon != null ? p.lon.toFixed(6) : '',
    p.location_accuracy != null ? Math.round(p.location_accuracy) : '',
    sec(p.location_observed_at), sec(p.observed_at),
    p.location_source === 'live' ? 'L' : 'K',
  ].join('|');
}

// Ask early (when the trip starts), never in the middle of an emergency.
export async function ensureSmsPermission() {
  if (Platform.OS !== 'android' || !SmsSender || !GATEWAY_NUMBER) return false;
  const P = PermissionsAndroid.PERMISSIONS.SEND_SMS;
  if (await PermissionsAndroid.check(P)) return true;
  const r = await PermissionsAndroid.request(P, {
    title: 'Allow SOS text messages?',
    message: 'If you press SOS with no internet, Margarakshak can text your position to the help desk. Your carrier may charge for the SMS.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

// Returns: 'sent' (handed to the SIM) | 'needs_user' (button must be tapped) | 'unavailable'
export async function sendSosSms(eventId, payload) {
  if (!GATEWAY_NUMBER) return 'unavailable';
  const body = buildSosSms(eventId, payload);
  if (Platform.OS === 'android' && SmsSender && await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS)) {
    try { await SmsSender.send(GATEWAY_NUMBER, body); return 'sent'; } catch { /* fall through */ }
  }
  return (await SMS.isAvailableAsync().catch(() => false)) ? 'needs_user' : 'unavailable';
}

// Called from the "Send SOS by SMS" button. Returns 'composer_sent' | 'cancelled'.
export async function openSmsComposer(eventId, payload) {
  const { result } = await SMS.sendSMSAsync([GATEWAY_NUMBER], buildSosSms(eventId, payload));
  return result === 'cancelled' ? 'cancelled' : 'composer_sent';
}
