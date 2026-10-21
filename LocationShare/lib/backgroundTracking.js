// Background location via an Android foreground service (iOS: background location mode).
//
// IMPORTANT: TaskManager.defineTask must run at module load, in the app's entry path, so the OS
// can wake a headless JS context and find the task. App.js imports this file for that reason.
//
// Needs a development build or a standalone APK/AAB. Expo Go cannot run background location on
// Android, so startBackgroundTracking returns { ok: false } there and the caller falls back to
// foreground-only recording.
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { Alert } from 'react-native';
import { recordFix } from './locationRecorder';
import { flush } from './sync';
import { setTrackingContext, getTrackingContext, clearTrackingContext } from './localDb';

export const TRACKING_TASK = 'margarakshak-background-location';

const localYmd = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

TaskManager.defineTask(TRACKING_TASK, async ({ data, error }) => {
  if (error) { console.warn('background location task error:', error.message); return; }
  const locations = data?.locations ?? [];
  if (!locations.length) return;

  const ctx = await getTrackingContext();
  if (!ctx) { await stopBackgroundTracking(); return; }                    // nothing to record for
  if (ctx.endDate && localYmd() > ctx.endDate) {                           // trip is over: stop collecting
    await stopBackgroundTracking();
    return;
  }

  // Oldest first, so "last reliable fix" ends on the newest observation.
  const ordered = [...locations].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  for (const pos of ordered) {
    try { await recordFix(pos, { userId: ctx.userId, travelCardId: ctx.travelCardId, flush: false }); }
    catch (e) { console.warn('could not store background fix:', e?.message ?? e); }
  }
  flush();
});

// Play policy wants a prominent in-app disclosure BEFORE the system background-location prompt.
export function askBackgroundDisclosure() {
  return new Promise((resolve) => {
    Alert.alert(
      'Keep tracking when the app is closed?',
      'Margarakshak shares your location with your safety dashboard during an active trip, even when the app is closed or the screen is off, so help can find you. A notification stays visible while this is on. Tracking stops when you tap Stop or when the trip ends.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Allow', onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}

// Returns { ok: true } or { ok: false, reason }. Never throws: failing to start the background
// service must not stop foreground sharing or the SOS button.
export async function startBackgroundTracking({ userId, travelCardId, endDate }) {
  try {
    let bg = await Location.getBackgroundPermissionsAsync();
    if (!bg.granted) bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) return { ok: false, reason: 'background_permission_denied' };

    await setTrackingContext({ userId, travelCardId, endDate });

    if (!(await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK))) {
      await Location.startLocationUpdatesAsync(TRACKING_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 0,
        // Without this the OS may pause updates while the phone is stationary.
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Margarakshak is sharing your location',
          notificationBody: 'Active trip. Open the app to stop sharing.',
          notificationColor: '#1B4332',
        },
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e) };
  }
}

export async function stopBackgroundTracking() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK)) {
      await Location.stopLocationUpdatesAsync(TRACKING_TASK);
    }
  } catch (e) { console.warn('stop background tracking failed:', e?.message ?? e); }
  await clearTrackingContext().catch(() => {});
}

export async function isBackgroundTrackingActive() {
  try { return await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK); } catch { return false; }
}
