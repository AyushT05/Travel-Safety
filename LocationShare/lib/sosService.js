// SOS: persist locally FIRST, then deliver. The write to SQLite happens before any
// network call and before waiting for GPS, so a crash, a dead network or a slow
// fix can never lose the SOS.
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import { enqueue, updateQueuedPayload, getLastFix, saveLastFix, getSos, latestOpenSos } from './localDb';
import { flush } from './sync';

const LIVE_FIX_TIMEOUT_MS = 4000;
const RELIABLE_ACCURACY_M = 100;

function sosPayload({ user, travelCardId, observedAt, fix }) {
  return {
    user_id: user.id,
    travel_card_id: travelCardId ?? null,
    observed_at: new Date(observedAt).toISOString(),
    lat: fix?.lat ?? null,
    lon: fix?.lon ?? null,
    location_accuracy: fix?.accuracy ?? null,
    location_observed_at: fix ? new Date(fix.observedAt).toISOString() : null,
    location_source: fix?.source ?? null, // 'live' | 'last_known' | null
  };
}

async function tryLiveFix(timeoutMs) {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null; // never block an emergency on a permission prompt
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!pos) return null;
    return {
      lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy,
      observedAt: pos.timestamp, source: 'live',
    };
  } catch { return null; }
}

export async function triggerSos({ user, travelCardId }) {
  const eventId = Crypto.randomUUID();
  const observedAt = Date.now();

  // 1. Save immediately, using the last reliable fix. Held back from the sender for the
  //    few seconds we give GPS; if the app dies meanwhile it is sent on next start.
  const last = await getLastFix();
  const lastFix = last ? { ...last, source: 'last_known' } : null;
  await enqueue({
    eventId, kind: 'sos',
    payload: sosPayload({ user, travelCardId, observedAt, fix: lastFix }),
    nextRetryAt: Date.now() + LIVE_FIX_TIMEOUT_MS + 500,
  });

  // 2. Try to improve the position, bounded. Only applies while the row is still queued.
  const live = await tryLiveFix(LIVE_FIX_TIMEOUT_MS);
  if (live) {
    await updateQueuedPayload(eventId, sosPayload({ user, travelCardId, observedAt, fix: live }));
    if (live.accuracy == null || live.accuracy <= RELIABLE_ACCURACY_M) await saveLastFix(live);
  } else {
    await updateQueuedPayload(eventId, sosPayload({ user, travelCardId, observedAt, fix: lastFix }));
  }

  // 3. Deliver (fire-and-forget; the UI follows progress through the outbox status).
  flush({ force: true });
  return eventId;
}

export { getSos, latestOpenSos };

// Honest, user-facing wording for each state. Never says "sent" for something merely queued.
export function describeSos(row) {
  if (!row) return null;
  switch (row.status) {
    case 'acknowledged':
      return { tone: 'ok', title: 'Help desk has seen your SOS', body: 'A responder acknowledged it. Stay where you are if it is safe to do so.' };
    case 'delivered':
      return { tone: 'warn', title: 'Delivered to the safety dashboard', body: 'The server has your SOS, but no person has acknowledged it yet. If you can, also call 112.' };
    case 'sending':
      return { tone: 'warn', title: 'Sending…', body: 'Saved on this phone. Trying to reach the server now.' };
    default:
      if (row.sms_status === 'sent') {
        return { tone: 'warn', title: 'SOS texted from your phone', body: 'Your position was sent by SMS to the help desk number. Delivery is not confirmed, and the internet route is still retrying. If you can, also call 112.', action: null };
      }
      if (row.sms_status === 'composer_sent') {
        return { tone: 'warn', title: 'SMS handed to your messaging app', body: 'Make sure it was actually sent. Delivery is not confirmed. If you can, also call 112.', action: null };
      }
      if (row.sms_status === 'needs_user') {
        return { tone: 'bad', title: 'NOT delivered yet: send by SMS', body: 'No internet. Tap the button to text your SOS and position to the help desk. If you can, also call 112.', action: 'sms_composer' };
      }
      return row.attempts > 0
        ? { tone: 'bad', title: 'NOT delivered yet', body: 'Saved on this phone and retrying automatically. No one has been alerted. Call 112 if you can.', action: null }
        : { tone: 'warn', title: 'Saved on this phone', body: 'Sending in a moment.', action: null };
  }
}
