// Small-area geometry on GeoJSON ([lon, lat]), ported from the scoring service. No PostGIS or turf needed.
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export class GeometryError extends Error {}

const xy = (lat, lon, lat0, lon0) => [R * rad(lon - lon0) * Math.cos(rad(lat0)), R * rad(lat - lat0)];

function seg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return [Math.hypot(px - cx, py - cy), cx, cy];
}

function ringContains(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pairs(coords) {
  if (!Array.isArray(coords)) throw new GeometryError('bad coordinates');
  return coords.map((c) => {
    if (!Array.isArray(c) || c.length < 2 || typeof c[0] !== 'number' || typeof c[1] !== 'number') throw new GeometryError('bad coordinate');
    const [lon, lat] = c;
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) throw new GeometryError('coordinate out of range');
    return [lat, lon];
  });
}

/** [{kind: 'point'|'line'|'polygon', data}] with data as [lat, lon] pairs (polygon: list of rings). */
export function parts(geom) {
  if (!geom || typeof geom !== 'object') throw new GeometryError('geometry must be an object');
  const { type, coordinates: c } = geom;
  switch (type) {
    case 'Point': return [{ kind: 'point', data: pairs([c])[0] }];
    case 'MultiPoint': return pairs(c).map((p) => ({ kind: 'point', data: p }));
    case 'LineString': return [{ kind: 'line', data: pairs(c) }];
    case 'MultiLineString': return c.map((l) => ({ kind: 'line', data: pairs(l) }));
    case 'Polygon': return [{ kind: 'polygon', data: c.map(pairs) }];
    case 'MultiPolygon': return c.map((poly) => ({ kind: 'polygon', data: poly.map(pairs) }));
    default: throw new GeometryError(`unsupported geometry type ${type}`);
  }
}

export function geometryKind(geom) {
  const kinds = new Set(parts(geom).map((p) => p.kind));
  return kinds.has('polygon') ? 'polygon' : kinds.has('line') ? 'line' : 'point';
}

export function bboxOf(geom) {
  const pts = [];
  for (const { kind, data } of parts(geom)) {
    if (kind === 'point') pts.push(data);
    else if (kind === 'line') pts.push(...data);
    else data.forEach((ring) => pts.push(...ring));
  }
  if (!pts.length) throw new GeometryError('empty geometry');
  const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
  return { south: Math.min(...lats), west: Math.min(...lons), north: Math.max(...lats), east: Math.max(...lons) };
}

/**
 * Signed distance in metres: positive = distance to the geometry, negative = depth inside a polygon.
 * Same contract as the scoring service, so "inside" means the same thing in both places.
 */
export function signedDistance(lat, lon, geom) {
  let best = null;
  const consider = (signed, x, y) => { if (best === null || signed < best[0]) best = [signed, x, y]; };
  for (const { kind, data } of parts(geom)) {
    if (kind === 'point') {
      const [x, y] = xy(data[0], data[1], lat, lon);
      consider(Math.hypot(x, y), x, y);
    } else if (kind === 'line') {
      const pts = data.map((p) => xy(p[0], p[1], lat, lon));
      if (pts.length === 1) consider(Math.hypot(pts[0][0], pts[0][1]), pts[0][0], pts[0][1]);
      for (let i = 0; i + 1 < pts.length; i++) {
        const [d, x, y] = seg(0, 0, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
        consider(d, x, y);
      }
    } else {
      const rings = data.map((r) => r.map((p) => xy(p[0], p[1], lat, lon)));
      let edge = null;
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const [d, x, y] = seg(0, 0, a[0], a[1], b[0], b[1]);
          if (edge === null || d < edge[0]) edge = [d, x, y];
        }
      }
      if (edge === null) continue;
      const inside = rings.length > 0 && ringContains(0, 0, rings[0]) && !rings.slice(1).some((h) => ringContains(0, 0, h));
      consider(inside ? -edge[0] : edge[0], edge[1], edge[2]);
    }
  }
  if (best === null) throw new GeometryError('empty geometry');
  return best[0];
}

export const metersPerPixel = (lat, zoom) => (156543.03392 * Math.cos(rad(lat))) / 2 ** zoom;
