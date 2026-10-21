// Every GPS fix goes to SQLite first; the SyncManager uploads it when it can.
import * as Crypto from 'expo-crypto';
import { enqueue, saveLastFix } from './localDb';
import { flush } from './sync';

const RELIABLE_ACCURACY_M = 100;

export async function recordFix(pos, { userId, travelCardId }) {
  const observedAt = pos.timestamp || Date.now(); // device observation time, not "now"
  const eventId = Crypto.randomUUID();

  await enqueue({
    eventId,
    kind: 'location',
    payload: {
      event_id: eventId,
      user_id: userId,
      travel_card_id: travelCardId,
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      speed: pos.coords.speed,
      observed_at: new Date(observedAt).toISOString(),
    },
  });

  if (pos.coords.accuracy == null || pos.coords.accuracy <= RELIABLE_ACCURACY_M) {
    await saveLastFix({
      lat: pos.coords.latitude, lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy, observedAt,
    });
  }
  flush(); // fire-and-forget; respects backoff
}
