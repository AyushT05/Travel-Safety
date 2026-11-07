import test from 'node:test';
import assert from 'node:assert/strict';
import {
  legFor, shouldPause, resumeIsDue, stepArrival, initialArrival, tripEnds, validateReturnDate,
  resumeReminderDate, ARRIVAL_DWELL_MS, ARRIVAL_RADIUS_M,
} from '../lib/returnTrip.js';

const MYS = { name: 'Mysuru', lat: 12.2958, lon: 76.6394 };
const KOL = { name: 'Kolkata', lat: 22.5726, lon: 88.3639 };
const card = (extra = {}) => ({ status: 'active', return_date: '2026-11-12',
  place_details: [MYS, { name: 'Vijayawada', lat: 16.5, lon: 80.64 }, KOL, { _type: 'planned_route', polyline: [] }], ...extra });

test('tripEnds takes first and last real place and ignores the planned_route entry', () => {
  const e = tripEnds(card());
  assert.equal(e.origin.name, 'Mysuru');
  assert.equal(e.destination.name, 'Kolkata');
  assert.deepEqual(tripEnds({ place_details: [{ name: 'x' }, { name: 'y' }] }), { origin: null, destination: null });
});

test('no return date: old behaviour, nothing auto-stops', () => {
  const l = legFor(card({ return_date: null }));
  assert.equal(l.target, null);
  assert.equal(l.pauseOnArrival, false);
  assert.equal(l.completeOnArrival, false);
});

test('outbound targets the destination; paused card is the return leg and targets the start point', () => {
  const out = legFor(card());
  assert.equal(out.leg, 'outbound');
  assert.equal(out.target.name, 'Kolkata');
  assert.equal(out.pauseOnArrival, true);
  const back = legFor(card({ status: 'paused' }));
  assert.equal(back.leg, 'return');
  assert.equal(back.target.name, 'Mysuru');
  assert.equal(back.completeOnArrival, true);
});

test('typed-by-hand destination (no coordinates) cannot auto-pause', () => {
  const c = card({ place_details: [MYS, { name: 'Somewhere', verified: false }] });
  assert.equal(legFor(c).pauseOnArrival, false);
});

test('only pause if the return day is still ahead', () => {
  assert.equal(shouldPause(card(), '2026-11-08'), true);
  assert.equal(shouldPause(card(), '2026-11-12'), false);
  assert.equal(shouldPause(card(), '2026-11-13'), false);
  assert.equal(shouldPause(card({ return_date: null }), '2026-11-08'), false);
});

test('resumeIsDue only for a paused card on/after the return date', () => {
  assert.equal(resumeIsDue(card({ status: 'paused' }), '2026-11-11'), false);
  assert.equal(resumeIsDue(card({ status: 'paused' }), '2026-11-12'), true);
  assert.equal(resumeIsDue(card(), '2026-11-12'), false);
});

const T0 = 1_700_000_000_000;
const at = (target, dLat, t, extra = {}) => ({ lat: target.lat + dLat, lon: target.lon, accuracy: 10, speed: 0.2, timestampMs: t, ...extra });

test('arrival needs dwell time AND several fixes, not one lucky fix', () => {
  let st = initialArrival();
  let r = stepArrival(st, at(KOL, 0.0005, T0), KOL); st = r.state;
  assert.equal(r.arrived, false);
  r = stepArrival(st, at(KOL, 0.0005, T0 + 5_000), KOL); st = r.state;
  r = stepArrival(st, at(KOL, 0.0005, T0 + 10_000), KOL); st = r.state;
  assert.equal(r.arrived, false);                       // 3 fixes but only 10 s
  r = stepArrival(st, at(KOL, 0.0005, T0 + ARRIVAL_DWELL_MS + 1), KOL);
  assert.equal(r.arrived, true);
});

test('driving through the circle at speed never counts as arriving', () => {
  let st = initialArrival(), arrived = false;
  for (let i = 0; i < 40; i++) {
    const r = stepArrival(st, at(KOL, 0.001, T0 + i * 5_000, { speed: 12 }), KOL);
    st = r.state; arrived = arrived || r.arrived;
  }
  assert.equal(arrived, false);
});

test('leaving the circle resets the streak; vague fixes neither confirm nor reset', () => {
  let st = initialArrival();
  st = stepArrival(st, at(KOL, 0.0005, T0), KOL).state;
  st = stepArrival(st, at(KOL, 0.0005, T0 + 5_000), KOL).state;
  assert.equal(st.count, 2);
  st = stepArrival(st, at(KOL, 0.0005, T0 + 6_000, { accuracy: 400 }), KOL).state;
  assert.equal(st.count, 2);
  st = stepArrival(st, at(KOL, 0.05, T0 + 7_000), KOL).state;   // ~5.5 km away
  assert.equal(st.count, 0);
  assert.ok(ARRIVAL_RADIUS_M < 500);
});

test('no target means never arrived', () => {
  assert.equal(stepArrival(initialArrival(), at(KOL, 0, T0), null).arrived, false);
});

test('return date validation', () => {
  const base = { startYmd: '2026-11-01', endYmd: '2026-11-20', destinationHasCoords: true };
  assert.equal(validateReturnDate({ ...base, returnYmd: null }), null);
  assert.equal(validateReturnDate({ ...base, returnYmd: '2026-11-12' }), null);
  assert.match(validateReturnDate({ ...base, returnYmd: '2026-11-01' }), /after your start/);
  assert.match(validateReturnDate({ ...base, returnYmd: '2026-11-25' }), /after the end/);
  assert.match(validateReturnDate({ ...base, returnYmd: '2026-11-12', destinationHasCoords: false }), /search results/);
});

test('reminder is 07:00 local on the return date', () => {
  const d = resumeReminderDate('2026-11-12');
  assert.equal(d.getFullYear(), 2026); assert.equal(d.getMonth(), 10); assert.equal(d.getDate(), 12);
  assert.equal(d.getHours(), 7);
  assert.equal(resumeReminderDate('nope'), null);
});
