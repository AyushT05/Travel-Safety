// Trip time estimate: transport mode + realistic breaks (meals, tea, rest, overnight halts).
//
// Pure functions, no React Native imports, so it runs under `node --test` and the same stored
// result (travel_cards.eta_plan) is what the dashboard shows and what the scoring service reads.
//
// Every number below is a HAND-SET heuristic (like agent/config.py on the server), not a learned
// value. They live in one table so they are easy to review and tune. The estimate is an
// estimate: it says so in `assumptions`, and nothing here is used to *raise* an alert, only to
// stop ordinary stops from being mistaken for trouble.

export const ETA_VERSION = 1;

// avgKmh      : fallback average moving speed when no routed duration is available
// roadScale   : multiplier on the routed (OSRM car-profile, near free-flow) duration
// distance    : 'road' = use routed road km; 'straight' = great-circle km x `detour`
// restEveryMin: moving time after which a short rest is planned (road-like modes only)
// maxDayMin   : moving minutes per day before an overnight halt is planned (null = runs through the night)
// stops       : false = no en-route halts are planned (train/flight: you are not the one stopping)
// preMin/postMin: fixed buffers outside the moving time (reach station/airport, exit, collect bags)
export const MODES = {
  car:    { label: 'Car / taxi',        avgKmh: 50, roadScale: 1.15, distance: 'road',     restEveryMin: 150, maxDayMin: 600,  stops: true,  preMin: 0,   postMin: 0 },
  bike:   { label: 'Motorbike / scooter', avgKmh: 40, roadScale: 1.20, distance: 'road',   restEveryMin: 120, maxDayMin: 480,  stops: true,  preMin: 0,   postMin: 0 },
  bus:    { label: 'Bus',               avgKmh: 42, roadScale: 1.45, distance: 'road',     restEveryMin: 240, maxDayMin: null, stops: true,  preMin: 20,  postMin: 10 },
  train:  { label: 'Train',             avgKmh: 55, roadScale: null, distance: 'straight', detour: 1.25, restEveryMin: null, maxDayMin: null, stops: false, preMin: 45,  postMin: 20 },
  flight: { label: 'Flight',            avgKmh: 750, roadScale: null, distance: 'straight', detour: 1.05, restEveryMin: null, maxDayMin: null, stops: false, preMin: 120, postMin: 45, blockOverheadMin: 30 },
  cycle:  { label: 'Cycle',             avgKmh: 15, roadScale: null, distance: 'road',     restEveryMin: 60,  maxDayMin: 360,  stops: true,  preMin: 0,   postMin: 0 },
  walk:   { label: 'On foot',           avgKmh: 4.5, roadScale: null, distance: 'road',    restEveryMin: 60,  maxDayMin: 420,  stops: true,  preMin: 0,   postMin: 0 },
};

export const MODE_KEYS = Object.keys(MODES);

// Local-clock windows (minutes since midnight). A meal is taken once per day, when the clock is
// inside its window and at least MIN_MOVING_BEFORE_BREAK minutes have been travelled since the last halt.
export const MEALS = [
  { id: 'breakfast', label: 'Breakfast', from: 7 * 60 + 30,  to: 10 * 60,       durationMin: 35 },
  { id: 'lunch',     label: 'Lunch',     from: 12 * 60 + 30, to: 14 * 60 + 30,  durationMin: 45 },
  { id: 'snack',     label: 'Tea / snacks', from: 16 * 60,   to: 17 * 60 + 30,  durationMin: 20 },
  { id: 'dinner',    label: 'Dinner',    from: 19 * 60 + 30, to: 21 * 60 + 30,  durationMin: 45 },
];
export const REST_BREAK_MIN = 15;
export const OVERNIGHT_MIN = 8 * 60;
export const MIN_MOVING_BEFORE_BREAK = 30;   // do not stop again right after a halt
export const SKIP_BREAK_IF_ARRIVING_WITHIN = 25;   // just arrive, then eat
export const DEFAULT_DEPARTURE = '07:00';
const STEP_MIN = 5;

// How much longer than planned a stop may run before the scoring service treats it as unusual.
export const STOP_GRACE_FACTOR = 1.5;

export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function fmtHHMM(totalMin) {
  const m = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function haversineKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// One leg: how far and how many minutes of actual movement (no breaks yet).
// leg = { from, to, roadKm?, roadMin?, straightKm? }
export function legMoving(modeKey, leg) {
  const m = MODES[modeKey];
  if (!m) throw new Error(`unknown transport mode: ${modeKey}`);
  let km;
  if (m.distance === 'straight') {
    const base = leg.straightKm ?? leg.roadKm;
    km = base == null ? null : base * (m.detour ?? 1);
  } else {
    km = leg.roadKm ?? (leg.straightKm != null ? leg.straightKm * 1.3 : null);
  }
  if (km == null) return { distanceKm: null, movingMin: null };

  let min;
  if (m.distance === 'road' && m.roadScale && leg.roadMin != null) min = leg.roadMin * m.roadScale;
  else min = (km / m.avgKmh) * 60;
  if (modeKey === 'flight') min += m.blockOverheadMin ?? 0;
  return { distanceKm: round1(km), movingMin: Math.round(min) };
}

const round1 = (x) => Math.round(x * 10) / 10;

// Walks the journey in 5-minute steps on the local clock and inserts halts.
// Returns [{ type, label, afterMovingMin, durationMin, clock? }]
export function planBreaks(modeKey, movingMin, departMin) {
  const m = MODES[modeKey];
  if (!m?.stops || !(movingMin > 0)) return [];
  const breaks = [];
  const taken = new Set();
  let moved = 0, sinceBreak = 0, dayMoving = 0, elapsed = 0;

  while (moved < movingMin) {
    const step = Math.min(STEP_MIN, movingMin - moved);
    moved += step; sinceBreak += step; dayMoving += step; elapsed += step;
    const left = movingMin - moved;
    if (left <= 0) break;

    const clock = departMin + elapsed;
    const day = Math.floor(clock / 1440);
    const tod = clock % 1440;

    let halt = null;
    if (m.maxDayMin && dayMoving >= m.maxDayMin) {
      halt = { type: 'overnight', label: 'Overnight halt', durationMin: OVERNIGHT_MIN };
      dayMoving = 0;
    } else if (left > SKIP_BREAK_IF_ARRIVING_WITHIN && sinceBreak >= MIN_MOVING_BEFORE_BREAK) {
      const meal = MEALS.find((x) => tod >= x.from && tod <= x.to && !taken.has(`${day}:${x.id}`));
      if (meal) {
        taken.add(`${day}:${meal.id}`);
        halt = { type: meal.id, label: meal.label, durationMin: meal.durationMin };
      } else if (m.restEveryMin && sinceBreak >= m.restEveryMin) {
        halt = { type: 'rest', label: 'Rest / fuel stop', durationMin: REST_BREAK_MIN };
      }
    }
    if (halt) {
      breaks.push({ ...halt, afterMovingMin: moved, clockMin: ((clock % 1440) + 1440) % 1440 });
      elapsed += halt.durationMin;
      sinceBreak = 0;
      if (halt.type === 'overnight') dayMoving = 0;
    }
  }
  return breaks;
}

// legs: [{ from, to, roadKm?, roadMin?, straightKm? }]  (one per consecutive pair of places)
// Returns null when no distance could be established for any leg.
export function estimateTrip({ mode, legs, departureTime = null }) {
  if (!MODES[mode]) return null;
  const parsed = parseHHMM(departureTime);
  const assumedDeparture = parsed == null;
  const departMin = parsed ?? parseHHMM(DEFAULT_DEPARTURE);

  const legOut = [];
  let movingTotal = 0, kmTotal = 0, known = 0;
  for (const leg of legs || []) {
    const r = legMoving(mode, leg);
    legOut.push({ from: leg.from ?? null, to: leg.to ?? null, distance_km: r.distanceKm, moving_min: r.movingMin });
    if (r.movingMin != null) { movingTotal += r.movingMin; kmTotal += r.distanceKm; known += 1; }
  }
  if (!known) return null;

  // Breaks are planned over the whole journey as one continuous clock (a lunch break is a lunch
  // break whichever leg it lands in).
  const breaks = planBreaks(mode, movingTotal, departMin);
  const m = MODES[mode];
  const breakMin = breaks.reduce((s, b) => s + b.durationMin, 0);
  const bufferMin = m.preMin + m.postMin;
  const totalMin = movingTotal + breakMin + bufferMin;
  const overnight = breaks.filter((b) => b.type === 'overnight').length;

  const assumptions = [
    assumedDeparture
      ? `Assumed a ${DEFAULT_DEPARTURE} departure (none given); meal stops depend on the clock.`
      : `Departure at ${fmtHHMM(departMin)}.`,
    'Speeds are typical averages, not live traffic; allow extra time for weather, ghats and festivals.',
  ];
  if (legs.length > known) assumptions.push('Some legs had no coordinates, so they are not counted.');
  if (m.preMin) assumptions.push(`Includes ${m.preMin + m.postMin} min of check-in / boarding / exit buffer.`);

  const longestStop = breaks.reduce((mx, b) => (b.type === 'overnight' ? mx : Math.max(mx, b.durationMin)), 0);

  return {
    version: ETA_VERSION,
    mode,
    departure_time: assumedDeparture ? null : fmtHHMM(departMin),
    assumed_departure: assumedDeparture,
    distance_km: round1(kmTotal),
    moving_min: movingTotal,
    break_min: breakMin,
    buffer_min: bufferMin,
    total_min: totalMin,
    arrival_clock: fmtHHMM(departMin + totalMin),
    arrival_day_offset: Math.floor((departMin + totalMin) / 1440),
    overnight_halts: overnight,
    longest_planned_stop_min: longestStop,
    legs: legOut,
    breaks: breaks.map((b) => ({ type: b.type, label: b.label, after_moving_min: b.afterMovingMin, clock: fmtHHMM(b.clockMin), duration_min: b.durationMin })),
    assumptions,
  };
}

export function formatDuration(min) {
  if (min == null || !isFinite(min)) return '--';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h >= 24) { const d = Math.floor(h / 24); return `${d} d ${h % 24} h`; }
  return r ? `${h} h ${r} min` : `${h} h`;
}
