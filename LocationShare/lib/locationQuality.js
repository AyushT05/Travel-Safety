// Pure functions: no React, no Expo, no I/O, so they are unit-testable with plain Node.
//
// Two separate questions:
//   1. How fresh/usable is the position I am about to SHOW?   -> classifyFreshness
//   2. Should this new fix become the "last reliable fix"?     -> assessFix
// Neither of them drops data. Every observation is still queued and uploaded;
// the flags only decide what is trusted, so history stays auditable.

export const LIVE_MAX_AGE_S = 20;
export const DELAYED_MAX_AGE_S = 90;
export const RELIABLE_ACCURACY_M = 100;

// Implied speed above this, over a short gap, is treated as a GPS jump rather than travel.
// Over long gaps (phone was offline) any distance can be legitimate, so no check applies.
export const JUMP_SPEED_MPS = 70;     // about 250 km/h
export const JUMP_MAX_GAP_S = 300;

export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2
    + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// NONE | LIVE | DELAYED | STALE | DEGRADED
// Age dominates: an old fix is STALE however accurate it was. A fresh but inaccurate fix is
// DEGRADED (shown with its uncertainty, never as a precise live dot).
export function classifyFreshness({ observedAtMs, accuracy, now = Date.now() }) {
  if (observedAtMs == null) return 'NONE';
  const age = Math.max(0, (now - observedAtMs) / 1000);
  if (age > DELAYED_MAX_AGE_S) return 'STALE';
  if (accuracy != null && accuracy > RELIABLE_ACCURACY_M) return 'DEGRADED';
  return age > LIVE_MAX_AGE_S ? 'DELAYED' : 'LIVE';
}

// prev: last RELIABLE fix {lat, lon, accuracy, observedAt(ms)} or null.
// cur : the new fix, same shape.
// reliable === true means "safe to store as last_reliable_fix".
export function assessFix(prev, cur) {
  const flags = [];
  const validCoords = Number.isFinite(cur.lat) && Number.isFinite(cur.lon)
    && Math.abs(cur.lat) <= 90 && Math.abs(cur.lon) <= 180
    && !(cur.lat === 0 && cur.lon === 0);           // (0,0) is the classic "no fix" artefact
  if (!validCoords) flags.push('invalid_coords');
  if (cur.accuracy == null || cur.accuracy > RELIABLE_ACCURACY_M) {
    // null accuracy is not trusted either: the provider did not say how good the fix is
    if (cur.accuracy != null) flags.push('poor_accuracy'); else flags.push('unknown_accuracy');
  }
  if (validCoords && prev) {
    const dt = (cur.observedAt - prev.observedAt) / 1000;
    if (dt < 0) {
      flags.push('out_of_order');
    } else if (dt > 0 && dt <= JUMP_MAX_GAP_S) {
      // Subtract both uncertainty radii so two noisy fixes are not called a "jump".
      const slack = (prev.accuracy ?? 0) + (cur.accuracy ?? 0);
      const moved = Math.max(0, haversineM(prev.lat, prev.lon, cur.lat, cur.lon) - slack);
      if (moved / dt > JUMP_SPEED_MPS) flags.push('implausible_jump');
    }
  }
  const blocking = flags.filter((f) => f !== 'unknown_accuracy');
  // A missing accuracy is accepted for last_reliable_fix only if nothing else is wrong,
  // matching the previous behaviour (accuracy == null counted as reliable).
  return { reliable: blocking.length === 0, flags };
}
