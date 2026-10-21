// Every GPS fix goes to SQLite first; the SyncManager uploads it when it can.
// Used by both the foreground watcher (fallback) and the background task.
import * as Crypto from 'expo-crypto';
import { enqueue, saveLastFix, getLastFix } from './localDb';
import { flush } from './sync';
import { assessFix } from './locationQuality';

// opts.flush = false lets a caller that records several fixes in a row flush once at the end.
export async function recordFix(pos, { userId, travelCardId, flush: doFlush = true }) {
  const observedAt = pos.timestamp || Date.now(); // device observation time, not "now"
  const eventId = Crypto.randomUUID();

  // Always store and upload the raw observation (audit trail). Quality flags only decide
  // whether it may become the "last reliable fix" that an SOS falls back on.
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

  const cur = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, observedAt };
  const verdict = assessFix(await getLastFix(), cur);
  if (verdict.reliable) await saveLastFix(cur);

  if (doFlush) flush(); // fire-and-forget; respects backoff
  return verdict;
}
