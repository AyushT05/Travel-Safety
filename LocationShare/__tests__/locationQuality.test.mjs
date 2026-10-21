import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFreshness, assessFix, haversineM } from '../lib/locationQuality.js';

const T = 1_700_000_000_000;
const fix = (lat, lon, acc, t) => ({ lat, lon, accuracy: acc, observedAt: t });

test('freshness: age dominates accuracy', () => {
  assert.equal(classifyFreshness({ observedAtMs: T, accuracy: 10, now: T + 5_000 }), 'LIVE');
  assert.equal(classifyFreshness({ observedAtMs: T, accuracy: 10, now: T + 30_000 }), 'DELAYED');
  assert.equal(classifyFreshness({ observedAtMs: T, accuracy: 10, now: T + 120_000 }), 'STALE');
  assert.equal(classifyFreshness({ observedAtMs: T, accuracy: 10, now: T + 600_000 }), 'STALE');
  assert.equal(classifyFreshness({ observedAtMs: T, accuracy: 500, now: T + 120_000 }), 'STALE');
});
test('freshness: fresh but inaccurate is DEGRADED, no fix is NONE', () => {
  assert.equal(classifyFreshness({ observedAtMs: T, accuracy: 350, now: T + 3_000 }), 'DEGRADED');
  assert.equal(classifyFreshness({ observedAtMs: null, accuracy: null }), 'NONE');
});
test('first fix with good accuracy is reliable', () => {
  assert.deepEqual(assessFix(null, fix(12.3, 76.6, 8, T)), { reliable: true, flags: [] });
});
test('poor accuracy and (0,0) are not reliable', () => {
  assert.equal(assessFix(null, fix(12.3, 76.6, 250, T)).reliable, false);
  assert.ok(assessFix(null, fix(0, 0, 5, T)).flags.includes('invalid_coords'));
  assert.ok(assessFix(null, fix(91, 10, 5, T)).flags.includes('invalid_coords'));
});
test('null accuracy alone stays acceptable (old behaviour) but is flagged', () => {
  const r = assessFix(null, fix(12.3, 76.6, null, T));
  assert.equal(r.reliable, true);
  assert.deepEqual(r.flags, ['unknown_accuracy']);
});
test('out-of-order fix never replaces a newer one', () => {
  const r = assessFix(fix(12.3, 76.6, 8, T), fix(12.3, 76.6, 8, T - 5_000));
  assert.equal(r.reliable, false);
  assert.ok(r.flags.includes('out_of_order'));
});
test('GPS jump: 5 km in 5 s is flagged, vehicle speed is not', () => {
  const a = fix(12.3000, 76.6000, 8, T);
  const far = fix(12.3450, 76.6000, 8, T + 5_000);          // about 5 km
  assert.ok(assessFix(a, far).flags.includes('implausible_jump'));
  const car = fix(12.3002, 76.6000, 8, T + 5_000);          // about 22 m in 5 s (4 m/s)
  assert.equal(assessFix(a, car).reliable, true);
  const fast = fix(12.3030, 76.6000, 8, T + 5_000);         // about 333 m in 5 s (66 m/s, a fast train)
  assert.equal(assessFix(a, fast).reliable, true);
});
test('two noisy fixes are not a jump (uncertainty is subtracted)', () => {
  const a = fix(12.3000, 76.6000, 90, T);
  const b = fix(12.3030, 76.6000, 90, T + 5_000);           // 333 m, slack 180 m, net 153 m
  assert.equal(assessFix(a, b).reliable, true);
});
test('after a long gap (offline) distance is not judged', () => {
  const a = fix(12.3, 76.6, 8, T);
  const b = fix(13.9, 77.9, 8, T + 3_600_000);
  assert.equal(assessFix(a, b).reliable, true);
});
test('haversine sanity', () => {
  assert.ok(Math.abs(haversineM(0, 0, 0, 1) - 111195) < 200);
});
