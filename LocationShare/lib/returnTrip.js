// Optional return trip: stop tracking when the traveller reaches the destination, resume on the
// day they head back, finish when they are home.
//
// Pure functions only (no React Native / Supabase imports) so they are unit-testable. The caller
// persists `arrival` state between fixes, because the background task can be woken in a fresh
// JS context for every batch of locations.
//
// A card WITHOUT a return_date behaves exactly as before: tracked until end_date, no auto-stop.
//
// Card fields used:
//   return_date  'YYYY-MM-DD' | null   set = feature on
//   status       'upcoming' | 'active' | 'paused' | 'completed'
//   place_details[]  first/last entries with lat/lon are the start point / final destination

export const ARRIVAL_RADIUS_M = 300;       // inside this distance of the target...
export const ARRIVAL_DWELL_MS = 120_000;   // ...continuously for this long counts as arrived
export const ARRIVAL_MIN_FIXES = 3;        // and we need at least this many fixes saying so
export const ARRIVAL_MAX_SPEED_MPS = 4;    // driving straight through the circle is not arriving
export const ARRIVAL_MAX_ACCURACY_M = 100; // a vague fix cannot prove you are there
export const RESUME_HOUR_LOCAL = 7;        // morning reminder on the return date

export function distanceM(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Start point and final destination as {name, lat, lon}, or null when a place was typed free-hand
// (no coordinates), in which case arrival cannot be detected for it.
export function tripEnds(card) {
  const pts = (card?.place_details || []).filter((p) => p && p._type !== 'planned_route');
  const ok = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon));
  const first = pts[0], last = pts[pts.length - 1];
  const wrap = (p) => (ok(p) ? { name: p.name ?? null, lat: Number(p.lat), lon: Number(p.lon) } : null);
  return { origin: pts.length >= 2 ? wrap(first) : null, destination: pts.length >= 2 ? wrap(last) : null };
}

export const hasReturnTrip = (card) => !!card?.return_date;

// Which leg is this tracking session for, and what ends it?
//   outbound: ends at the destination (only when a return trip is planned)
//   return  : ends at the start point (only when we can locate it)
export function legFor(card) {
  const { origin, destination } = tripEnds(card);
  if (!hasReturnTrip(card)) return { leg: 'outbound', target: null, pauseOnArrival: false, completeOnArrival: false };
  if (card.status === 'paused') {
    return { leg: 'return', target: origin, pauseOnArrival: false, completeOnArrival: !!origin };
  }
  return { leg: 'outbound', target: destination, pauseOnArrival: !!destination, completeOnArrival: false };
}

// Pausing only makes sense if the return day is still ahead. If the traveller reaches the
// destination ON or AFTER the return date, they carry on tracking straight into the return leg.
export function shouldPause(card, todayYmd) {
  return hasReturnTrip(card) && card.return_date > todayYmd;
}

// Can the traveller resume now? (Resuming early is always allowed; this drives the banner copy.)
export function resumeIsDue(card, todayYmd) {
  return card?.status === 'paused' && !!card.return_date && card.return_date <= todayYmd;
}

export function initialArrival() { return { count: 0, sinceMs: null }; }

// One GPS fix in, new state out. `arrived` is true once the dwell + count conditions hold.
// fix: { lat, lon, accuracy, speed, timestampMs }
export function stepArrival(state, fix, target) {
  const s = state ?? initialArrival();
  if (!target || !fix) return { state: s, arrived: false };
  const inside = distanceM({ lat: fix.lat, lon: fix.lon }, target) <= ARRIVAL_RADIUS_M;
  const fast = fix.speed != null && fix.speed > ARRIVAL_MAX_SPEED_MPS;
  const vague = fix.accuracy != null && fix.accuracy > ARRIVAL_MAX_ACCURACY_M;

  if (vague) return { state: s, arrived: false };            // neither confirms nor resets
  if (!inside || fast) return { state: initialArrival(), arrived: false };

  const next = { count: s.count + 1, sinceMs: s.sinceMs ?? fix.timestampMs };
  const arrived = next.count >= ARRIVAL_MIN_FIXES && fix.timestampMs - next.sinceMs >= ARRIVAL_DWELL_MS;
  return { state: next, arrived };
}

// When to remind the traveller on the return date (device-local 07:00 on that date).
export function resumeReminderDate(returnYmd, hour = RESUME_HOUR_LOCAL) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(returnYmd ?? '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, 0, 0, 0);
}

// Validation for the create form. Returns an error string or null.
export function validateReturnDate({ startYmd, endYmd, returnYmd, destinationHasCoords }) {
  if (!returnYmd) return null;                     // optional
  if (!startYmd || !endYmd) return 'Pick the travel dates first.';
  if (returnYmd <= startYmd) return 'Return date must be after your start date.';
  if (returnYmd > endYmd) return 'Return date cannot be after the end of your trip.';
  if (!destinationHasCoords) return 'Choose your final destination from the search results, so arrival can be detected and tracking can pause.';
  return null;
}
