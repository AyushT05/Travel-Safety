import { describe, expect, test } from 'vitest';
import parity from './fixtures/risk_parity.json';
import { sunTimes, isDark } from '../src/lib/risk/sun';
import { signedDistance, bboxOf, GeometryError } from '../src/lib/risk/geometry';
import {
  GDACS_MAX_AGE_MS, freshness, levelFor, riskAtPoint, zoneContribution, zoneFromRiskRow, zoneFromUnsafeRow, zoneHeatPoints,
} from '../src/lib/risk/model';

const asZone = (s) => ({
  key: s.key, name: s.key, hazard: s.hazard, severity: s.severity, geometry: s.geometry, confidence: s.confidence,
  source: 't', radiusM: s.radiusM, observedAt: s.observedAt ? new Date(s.observedAt) : null,
  expiresAt: s.expiresAt ? new Date(s.expiresAt) : null, status: s.status, validFrom: s.validFrom ? new Date(s.validFrom) : null, attributes: {},
});

describe('parity with the scoring service (numbers produced by the Python evaluator)', () => {
  test.each(parity.cases.map((c) => [c.name, c]))('%s', (_n, c) => {
    const r = riskAtPoint(c.zones.map(asZone), c.lat, c.lon, new Date(c.t));
    expect(r.score).toBeCloseTo(c.score, 2);                  // within 0.005: the service rounds factors to 3 places
    expect(r.level).toBe(c.level);
    expect(r.dark).toBe(c.dark);
    expect(r.factors[0]?.zone.hazard ?? null).toBe(c.top);
  });

  test.each(parity.sun.map((s) => [s.name, s]))('sunrise and sunset: %s', (_n, s) => {
    const { rise, set } = sunTimes(s.y, s.m, s.d, s.lat, s.lon);
    expect(Math.abs(rise.getTime() - Date.parse(s.rise))).toBeLessThan(2000);
    expect(Math.abs(set.getTime() - Date.parse(s.set))).toBeLessThan(2000);
  });
});

describe('geometry', () => {
  const SQ = { type: 'Polygon', coordinates: [[[76.64, 12.29], [76.66, 12.29], [76.66, 12.31], [76.64, 12.31], [76.64, 12.29]]] };
  test('signed distance is negative depth inside a polygon and positive outside', () => {
    expect(signedDistance(12.3, 76.65, SQ)).toBeCloseTo(-1086, -1);
    expect(signedDistance(12.3, 76.66 + 100 / 108642, SQ)).toBeCloseTo(100, 0);
  });
  test('malformed geometry is rejected, not drawn', () => {
    expect(() => signedDistance(1, 1, { type: 'Point', coordinates: ['x', 1] })).toThrow(GeometryError);
    expect(() => bboxOf({ type: 'Circle', coordinates: [1, 1] })).toThrow(GeometryError);
  });
  test('after dark helper', () => {
    expect(isDark(new Date('2026-10-24T10:00:00+05:30'), 12.3, 76.65)).toBe(false);
    expect(isDark(new Date('2026-10-24T20:30:00+05:30'), 12.3, 76.65)).toBe(true);
  });
});

describe('rows to zones', () => {
  const NOW = new Date('2026-10-24T15:30:00Z');
  const base = { id: 'a', name: 'Ghat', hazard_type: 'landslide', severity: 'high', geometry: { type: 'Point', coordinates: [76.6, 12.4] }, confidence: 0.7, source: 'manual', status: 'active' };
  test('a GDACS zone not refreshed for 12 hours is ignored, like the service does', () => {
    const fresh = zoneFromRiskRow({ ...base, source: 'GDACS', updated_at: new Date(NOW - GDACS_MAX_AGE_MS + 60000).toISOString() }, NOW);
    const stale = zoneFromRiskRow({ ...base, source: 'GDACS', updated_at: new Date(NOW - GDACS_MAX_AGE_MS - 60000).toISOString() }, NOW);
    expect(fresh).not.toBeNull();
    expect(stale).toBeNull();
    expect(zoneFromRiskRow({ ...base, updated_at: '2020-01-01T00:00:00Z' }, NOW)).not.toBeNull();   // only GDACS has the dead-man rule
  });
  test('unknown hazard types and bad rows are dropped', () => {
    expect(zoneFromRiskRow({ ...base, hazard_type: 'nonsense' }, NOW)).toBeNull();
    expect(zoneFromRiskRow({ ...base, geometry: null }, NOW)).toBeNull();
  });
  test('user reports map to hazards like the service does', () => {
    const row = { id: 7, category: 'robbery', severity: 'critical', description: 'Phones snatched', lat: 12.3, lon: 76.65, radius_m: 300, status: 'verified', created_at: '2026-10-01T00:00:00Z' };
    const z = zoneFromUnsafeRow(row);
    expect([z.key, z.hazard, z.severity, z.confidence, z.radiusM]).toEqual(['unsafe:7', 'crime', 'critical', 0.8, 300]);
    expect(zoneFromUnsafeRow({ ...row, status: 'dismissed' })).toBeNull();
    expect(zoneFromUnsafeRow({ ...row, status: 'pending' }).confidence).toBeLessThan(0.5);
    expect(zoneFromUnsafeRow({ ...row, category: 'poor_lighting' }).hazard).toBe('poor_lighting');
  });
});

describe('what the map draws', () => {
  const t = new Date('2026-10-24T20:30:00+05:30');
  const z = (over = {}) => asZone({ key: 'z', hazard: 'poor_lighting', severity: 'medium', confidence: 0.6, radiusM: 100,
    geometry: { type: 'Point', coordinates: [76.65, 12.3] }, observedAt: '2026-10-23T00:00:00Z', expiresAt: null, status: 'active', validFrom: null, ...over });

  test('a lighting hazard glows after dark and not by day', () => {
    expect(zoneContribution(z(), t, 12.3, 76.65).value).toBeCloseTo(0.3, 2);
    expect(zoneContribution(z(), new Date('2026-10-24T10:00:00+05:30'), 12.3, 76.65).value).toBeLessThan(0.02);
  });
  test('expired and not-yet-valid zones contribute nothing and say why', () => {
    expect(freshness(z({ expiresAt: '2026-10-24T12:00:00Z' }), t)).toEqual({ skip: 'expired_before_arrival' });
    expect(freshness(z({ validFrom: '2026-10-25T00:00:00Z' }), t)).toEqual({ skip: 'not_yet_valid' });
    expect(freshness(z({ status: 'resolved' }), t)).toEqual({ skip: 'inactive' });
  });
  test('levels match the service thresholds', () => {
    expect([0.14, 0.15, 0.39, 0.4, 0.64, 0.65].map(levelFor)).toEqual(['none', 'caution', 'caution', 'warning', 'warning', 'danger']);
  });

  const bounds = { south: 12.2, north: 12.4, west: 76.55, east: 76.75 };
  test('heat points stay inside the zone and respect the point budget', () => {
    const big = z({ radiusM: 5000, hazard: 'crime', severity: 'high', confidence: 0.9 });
    const pts = zoneHeatPoints(big, 0.6, { spacingM: 300, bounds, maxPoints: 200 });
    expect(pts.length).toBeGreaterThan(20);
    expect(pts.length).toBeLessThanOrEqual(200);
    for (const [la, lo, w] of pts) {
      expect(Math.hypot((la - 12.3) * 111195, (lo - 76.65) * 108642)).toBeLessThanOrEqual(5000 + 1);
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(0.6);
    }
  });
  test('a zone smaller than the sampling spacing is one point; only the visible part is sampled', () => {
    expect(zoneHeatPoints(z({ radiusM: 50 }), 0.3, { spacingM: 200, bounds })).toHaveLength(1);
    const offscreen = z({ geometry: { type: 'Point', coordinates: [90, 20] }, radiusM: 50 });
    expect(zoneHeatPoints(offscreen, 0.3, { spacingM: 200, bounds })).toHaveLength(0);
  });
  test('polygons and lines are sampled along their real shape', () => {
    const SQ = { type: 'Polygon', coordinates: [[[76.6, 12.25], [76.7, 12.25], [76.7, 12.35], [76.6, 12.35], [76.6, 12.25]]] };
    const poly = zoneHeatPoints(z({ geometry: SQ, radiusM: 0 }), 0.5, { spacingM: 500, bounds, maxPoints: 400 });
    expect(poly.length).toBeGreaterThan(30);
    poly.forEach(([la, lo]) => { expect(la).toBeGreaterThanOrEqual(12.25); expect(la).toBeLessThanOrEqual(12.35); expect(lo).toBeGreaterThanOrEqual(76.6); expect(lo).toBeLessThanOrEqual(76.7); });
    const line = { type: 'LineString', coordinates: [[76.6, 12.3], [76.7, 12.3]] };
    const pts = zoneHeatPoints(z({ geometry: line, radiusM: null }), 0.5, { spacingM: 500, bounds });
    expect(pts.length).toBeGreaterThan(15);
    pts.forEach(([la]) => expect(la).toBeCloseTo(12.3, 5));
  });
  test('nothing is drawn for a zero-risk zone', () => {
    expect(zoneHeatPoints(z(), 0, { spacingM: 200, bounds })).toEqual([]);
  });
});
