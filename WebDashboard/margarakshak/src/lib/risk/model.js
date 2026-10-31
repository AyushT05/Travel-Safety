// Zone risk model for the dashboard map. Mirrors the scoring service (geofence/scoring.py): the same hazard
// profiles, freshness rules and thresholds, so a zone is "high risk" on the map for the same reason an alert
// would fire. test/riskModel.test.js checks parity against numbers produced by the Python code.
//
// This model draws what is RECORDED. An area with no zone has no colour, which is not the same as safe.
import { isDark } from './sun';
import { GeometryError, bboxOf, geometryKind, parts, signedDistance } from './geometry';

export const SEVERITY = { low: 0.25, medium: 0.5, high: 0.75, critical: 1.0 };
export const DEFAULT_BUFFER_M = { point: 100, line: 30, polygon: 0 };
const STALE_FLOOR = 0.05;
export const GDACS_MAX_AGE_MS = 12 * 3600 * 1000; // same dead-man rule as the service: unrefreshed GDACS zones are ignored
const LEVELS = [['none', 0], ['caution', 0.15], ['warning', 0.4], ['danger', 0.65]];

// group, label, day weight, night weight, cap, half-life in days (null: no decay)
const P = (group, label, dayW, nightW, cap, halfLife) => ({ group, label, dayW, nightW, cap, halfLife });
export const PROFILES = {
  poor_lighting: P('lighting', 'Poorly lit area', 0.05, 1.0, 0.7, 730),
  crime: P('crime', 'Reported crime / security risk', 0.6, 1.0, 0.9, 180),
  weak_connectivity: P('connectivity', 'Weak mobile coverage', 0.5, 0.5, 0.35, 365),
  road_condition: P('road', 'Poor road condition', 0.6, 0.8, 0.8, 180),
  road_closure: P('road', 'Road closure', 1.0, 1.0, 1.0, 30),
  flood: P('disaster', 'Flood', 1.0, 1.0, 1.0, 7),
  landslide: P('disaster', 'Landslide', 1.0, 1.0, 1.0, 7),
  cyclone: P('disaster', 'Cyclone', 1.0, 1.0, 1.0, 7),
  earthquake: P('disaster', 'Earthquake', 1.0, 1.0, 1.0, 7),
  wildfire: P('disaster', 'Wildfire', 1.0, 1.0, 1.0, 7),
  other_disaster: P('disaster', 'Disaster alert', 1.0, 1.0, 1.0, 7),
  restricted_area: P('restricted', 'Restricted area', 0.8, 0.8, 0.8, null),
};

export const levelFor = (score) => LEVELS.reduce((lvl, [name, floor]) => (score >= floor ? name : lvl), 'none');
const round3 = (x) => Math.round(x * 1000) / 1000;
const parseDate = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ------------------------------------------------------------------ rows -> zones
export function zoneFromRiskRow(r, now = new Date(), historical = false) {
  if (!r || !PROFILES[r.hazard_type] || !r.geometry) return null;
  // The scoring service ignores GDACS zones its hourly sync has not refreshed; do the same so the map
  // never shows a disaster the alerts no longer know about.
  if (r.source === 'GDACS' && r.updated_at && now.getTime() - new Date(r.updated_at).getTime() > GDACS_MAX_AGE_MS) return null;
  return {
    key: `risk:${r.id}`, name: r.name || 'Risk zone', hazard: r.hazard_type, severity: r.severity || 'medium',
    geometry: r.geometry, confidence: r.confidence != null ? Number(r.confidence) : 0.5,
    source: r.source || 'unknown', sourceUrl: r.source_url || null, radiusM: r.radius_m ?? null,
    // The GDACS sync retires a finished event by changing its *current*
    // status to expired. During a historical lookup it was still active until
    // expires_at, so let freshness() evaluate that temporal boundary instead.
    observedAt: parseDate(r.observed_at), expiresAt: parseDate(r.expires_at),
    status: historical && r.status === 'expired' ? 'active' : (r.status || 'active'),
    validFrom: parseDate((r.attributes || {}).valid_from), attributes: r.attributes || {},
  };
}

const UNSAFE_TYPE = { poor_lighting: 'poor_lighting', robbery: 'crime', assault: 'crime', harassment: 'crime', suspicious_activity: 'crime', other: 'crime' };
const UNSAFE_SEV = { info: 'low', warning: 'medium', critical: 'critical' };
const UNSAFE_CONF = { verified: 0.8, pending: 0.35 };

/** unsafe_zones (user / admin reports). Dismissed reports give null. */
export function zoneFromUnsafeRow(r) {
  const conf = UNSAFE_CONF[r && r.status];
  if (conf === undefined || typeof r.lat !== 'number' || typeof r.lon !== 'number') return null;
  return {
    key: `unsafe:${r.id}`, name: String(r.description || r.category || 'Reported zone').slice(0, 80),
    hazard: UNSAFE_TYPE[r.category] || 'crime', severity: UNSAFE_SEV[r.severity] || 'medium',
    geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, confidence: conf, source: `community report (${r.status})`,
    sourceUrl: null, radiusM: r.radius_m || 500, observedAt: parseDate(r.created_at), expiresAt: parseDate(r.expires_at),
    status: 'active', validFrom: null, attributes: {},
  };
}

export const zoneBuffer = (z) => (z.radiusM !== null && z.radiusM !== undefined ? z.radiusM : DEFAULT_BUFFER_M[geometryKind(z.geometry)]);

export function zoneCenter(z) {
  const b = bboxOf(z.geometry);
  return { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
}

// ------------------------------------------------------------------ scoring
/** -> { f } or { skip: reason } */
export function freshness(z, t) {
  const prof = PROFILES[z.hazard];
  if (!prof) return { skip: 'unknown_hazard_type' };
  if (z.status !== 'active') return { skip: 'inactive' };
  if (z.validFrom && t < z.validFrom) return { skip: 'not_yet_valid' };
  if (z.expiresAt) return t > z.expiresAt ? { skip: 'expired_before_arrival' } : { f: 1 };
  if (prof.halfLife === null) return { f: 1 };
  if (!z.observedAt) return { f: 0.5 };
  const ageDays = Math.max(0, (t - z.observedAt) / 86400000);
  const f = 0.5 ** (ageDays / prof.halfLife);
  return f >= STALE_FLOOR ? { f } : { skip: 'stale' };
}

/** Contribution of one zone for someone INSIDE it at time t. dark is evaluated at lat/lon. */
export function zoneContribution(z, t, lat, lon) {
  const fr = freshness(z, t);
  if (fr.skip) return { value: 0, skip: fr.skip, dark: false, freshness: 0 };
  const prof = PROFILES[z.hazard];
  const dark = isDark(t, lat, lon);
  const w = dark ? prof.nightW : prof.dayW;
  const raw = (SEVERITY[z.severity] ?? 0.5) * Math.max(0, Math.min(1, z.confidence)) * fr.f * w;
  return { value: Math.min(raw, prof.cap), dark, freshness: fr.f, weight: w };
}

/** Risk at a position (accuracy 0, so only zones that contain the point count). Same aggregation as the service. */
export function riskAtPoint(zones, lat, lon, t) {
  const factors = [];
  for (const z of zones) {
    let signed;
    try { signed = signedDistance(lat, lon, z.geometry); } catch (e) { if (e instanceof GeometryError) continue; throw e; }
    if (signed - zoneBuffer(z) > 0) continue;
    const c = zoneContribution(z, t, lat, lon);
    const value = round3(c.value);
    if (value < 0.01) continue;
    factors.push({ zone: z, value, group: PROFILES[z.hazard].group, dark: c.dark });
  }
  factors.sort((a, b) => b.value - a.value);
  let score = 0;
  if (factors.length) {
    const top = factors[0];
    const others = new Set(factors.slice(1).filter((f) => f.value >= 0.3 && f.group !== top.group).map((f) => f.group));
    score = Math.min(1, top.value + 0.1 * others.size);
  }
  score = round3(score);
  return { score, level: levelFor(score), factors, dark: factors.length ? factors[0].dark : isDark(t, lat, lon) };
}

// ------------------------------------------------------------------ heat sampling
const M_PER_DEG = 111195;
const mPerLonDeg = (lat) => M_PER_DEG * Math.max(0.05, Math.cos((lat * Math.PI) / 180));

const inBounds = (lat, lon, b) => !b || (lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east);

/**
 * Points [lat, lon, weight] that paint the zone's area for a heat layer. Spacing follows the map zoom, so
 * the heat looks continuous at every zoom instead of dissolving into dots, and only the visible part of a
 * huge zone (a cyclone wind field) is sampled. Bounded by maxPoints.
 */
export function zoneHeatPoints(z, value, { spacingM, bounds = null, maxPoints = 400 } = {}) {
  if (!(value > 0) || !(spacingM > 0)) return [];
  const out = [];
  const buf = zoneBuffer(z);
  const push = (lat, lon, w) => { if (out.length < maxPoints && inBounds(lat, lon, bounds)) out.push([lat, lon, w]); };

  const gridOver = (box, test) => {
    const south = bounds ? Math.max(box.south, bounds.south) : box.south;
    const north = bounds ? Math.min(box.north, bounds.north) : box.north;
    const west = bounds ? Math.max(box.west, bounds.west) : box.west;
    const east = bounds ? Math.min(box.east, bounds.east) : box.east;
    if (south > north || west > east) return;
    const midLat = (south + north) / 2;
    const areaM2 = (north - south) * M_PER_DEG * (east - west) * mPerLonDeg(midLat);
    const step = Math.max(spacingM, Math.sqrt(Math.max(areaM2, 1) / maxPoints));
    const dLat = step / M_PER_DEG, dLon = step / mPerLonDeg(midLat);
    for (let lat = south + dLat / 2; lat <= north && out.length < maxPoints; lat += dLat) {
      for (let lon = west + dLon / 2; lon <= east && out.length < maxPoints; lon += dLon) test(lat, lon);
    }
  };

  for (const { kind, data } of parts(z.geometry)) {
    if (kind === 'point') {
      const [clat, clon] = data;
      if (buf <= spacingM * 0.75) { push(clat, clon, value); continue; }
      const dLat = buf / M_PER_DEG, dLon = buf / mPerLonDeg(clat);
      gridOver({ south: clat - dLat, north: clat + dLat, west: clon - dLon, east: clon + dLon }, (lat, lon) => {
        const d = Math.hypot((lat - clat) * M_PER_DEG, (lon - clon) * mPerLonDeg(clat));
        if (d <= buf) push(lat, lon, value * (1 - 0.45 * (d / buf)));     // soft falloff toward the edge
      });
    } else if (kind === 'line') {
      for (let i = 0; i + 1 < data.length; i++) {
        const [a, b] = [data[i], data[i + 1]];
        const lenM = Math.hypot((b[0] - a[0]) * M_PER_DEG, (b[1] - a[1]) * mPerLonDeg(a[0]));
        const n = Math.max(1, Math.ceil(lenM / spacingM));
        for (let k = 0; k <= n; k++) push(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, value);
      }
    } else {
      const lats = data[0].map((p) => p[0]), lons = data[0].map((p) => p[1]);
      const box = { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) };
      const geom = { type: 'Polygon', coordinates: data.map((ring) => ring.map(([la, lo]) => [lo, la])) };
      gridOver(box, (lat, lon) => { if (signedDistance(lat, lon, geom) <= buf) push(lat, lon, value); });
    }
  }
  return out;
}
