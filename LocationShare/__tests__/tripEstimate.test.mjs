import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTrip, planBreaks, legMoving, parseHHMM, fmtHHMM, formatDuration, haversineKm } from '../lib/tripEstimate.js';

const MYS_BLR = { from: 'Mysuru', to: 'Bengaluru', roadKm: 150, roadMin: 170, straightKm: 128 };

test('parseHHMM / fmtHHMM', () => {
  assert.equal(parseHHMM('07:30'), 450);
  assert.equal(parseHHMM('7:05'), 425);
  assert.equal(parseHHMM('24:00'), null);
  assert.equal(parseHHMM('abc'), null);
  assert.equal(fmtHHMM(25 * 60 + 5), '01:05');
});

test('car uses routed duration scaled up, not raw OSRM free-flow time', () => {
  const r = legMoving('car', MYS_BLR);
  assert.equal(r.distanceKm, 150);
  assert.equal(r.movingMin, Math.round(170 * 1.15));
});

test('mode changes the answer: bus slower than car, flight uses straight line + overhead', () => {
  const car = legMoving('car', MYS_BLR).movingMin;
  const bus = legMoving('bus', MYS_BLR).movingMin;
  assert.ok(bus > car);
  const far = { roadKm: 1900, roadMin: 1900, straightKm: 1400 };
  const fl = legMoving('flight', far);
  assert.equal(fl.distanceKm, Math.round(1400 * 1.05 * 10) / 10);
  assert.ok(fl.movingMin < 180 && fl.movingMin > 100);   // about 2 h block time
});

test('falls back to average speed when no routed duration exists', () => {
  const r = legMoving('car', { roadKm: 100 });
  assert.equal(r.movingMin, 120);          // 100 km at 50 km/h
  assert.equal(legMoving('car', {}).movingMin, null);
});

test('a morning departure picks up breakfast; lunch lands in its window; each meal once a day', () => {
  // 07:00 departure, 8 h of moving
  const b = planBreaks('car', 8 * 60, 7 * 60);
  const types = b.map((x) => x.type);
  assert.ok(types.includes('breakfast'));
  assert.ok(types.includes('lunch'));
  assert.equal(types.filter((t) => t === 'breakfast').length, 1);
  assert.equal(types.filter((t) => t === 'lunch').length, 1);
  const lunch = b.find((x) => x.type === 'lunch');
  assert.ok(lunch.clockMin >= 12.5 * 60 && lunch.clockMin <= 14.5 * 60);
});

test('no halt is planned when you are about to arrive', () => {
  // 40 minutes of driving starting 12:45: lunch window, but arrival is close
  const b = planBreaks('car', 40, 12 * 60 + 45);
  assert.deepEqual(b, []);
});

test('train and flight plan no en-route halts but add boarding buffers', () => {
  assert.deepEqual(planBreaks('train', 600, 8 * 60), []);
  const t = estimateTrip({ mode: 'flight', legs: [{ straightKm: 1400 }], departureTime: '09:00' });
  assert.equal(t.break_min, 0);
  assert.equal(t.buffer_min, 120 + 45);
  assert.equal(t.total_min, t.moving_min + 165);
});

test('long road trip gets overnight halts, bus runs through the night', () => {
  const car = estimateTrip({ mode: 'car', legs: [{ roadKm: 1900, roadMin: 1700 }], departureTime: '06:00' });
  assert.ok(car.overnight_halts >= 2);
  const bus = estimateTrip({ mode: 'bus', legs: [{ roadKm: 1900, roadMin: 1700 }], departureTime: '06:00' });
  assert.equal(bus.overnight_halts, 0);
});

test('estimate is deterministic, includes an assumption when departure is missing', () => {
  const a = estimateTrip({ mode: 'car', legs: [MYS_BLR] });
  const b = estimateTrip({ mode: 'car', legs: [MYS_BLR] });
  assert.deepEqual(a, b);
  assert.equal(a.assumed_departure, true);
  assert.equal(a.departure_time, null);
  assert.match(a.assumptions[0], /Assumed a 07:00 departure/);
});

test('multi-leg trip sums legs; legs without data are skipped, not zeroed', () => {
  const r = estimateTrip({ mode: 'car', legs: [MYS_BLR, { from: 'x', to: 'y' }, { roadKm: 100, roadMin: 90 }], departureTime: '06:00' });
  assert.equal(r.legs.length, 3);
  assert.equal(r.legs[1].moving_min, null);
  assert.equal(r.moving_min, r.legs[0].moving_min + r.legs[2].moving_min);
  assert.ok(r.assumptions.some((s) => /no coordinates/.test(s)));
  assert.equal(estimateTrip({ mode: 'car', legs: [{}] }), null);
  assert.equal(estimateTrip({ mode: 'hovercraft', legs: [MYS_BLR] }), null);
});

test('longest_planned_stop_min ignores overnight halts', () => {
  const r = estimateTrip({ mode: 'car', legs: [{ roadKm: 1500, roadMin: 1300 }], departureTime: '06:00' });
  assert.ok(r.longest_planned_stop_min <= 45);
});

test('formatDuration and haversine', () => {
  assert.equal(formatDuration(45), '45 min');
  assert.equal(formatDuration(135), '2 h 15 min');
  assert.equal(formatDuration(60 * 50), '2 d 2 h');
  const d = haversineKm({ lat: 12.2958, lon: 76.6394 }, { lat: 12.9716, lon: 77.5946 });
  assert.ok(d > 120 && d < 135);
});

test('meal table is pinned (the scoring service has the same literal table in agent/breaks.py)', async () => {
  const { MEALS, REST_BREAK_MIN, STOP_GRACE_FACTOR } = await import('../lib/tripEstimate.js');
  assert.deepEqual(MEALS.map((m) => [m.id, m.from, m.to, m.durationMin]),
    [['breakfast', 450, 600, 35], ['lunch', 750, 870, 45], ['snack', 960, 1050, 20], ['dinner', 1170, 1290, 45]]);
  assert.equal(REST_BREAK_MIN, 15);
  assert.equal(STOP_GRACE_FACTOR, 1.5);
});
