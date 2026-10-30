// Zoom-aware grouping of live tourists into clusters (pure, no Leaflet), coloured by the worst risk level
// among the members.
export const MAX_CLUSTER_ZOOM = 15;           // closer than this, tourists are shown individually
const RANK = { none: 0, caution: 1, warning: 2, danger: 3 };

/** Web Mercator pixel position at a zoom level (256 px tiles), the same projection Leaflet uses. */
export function project(lat, lon, zoom) {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return [((lon + 180) / 360) * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale];
}

/**
 * items: [{ id, lat, lon, level }]. Returns clusters of at least minSize tourists that fall in the same
 * cellPx x cellPx screen cell: { key, lat, lon, count, ids, worst, inRisk }.
 */
export function clusterDevices(items, zoom, { cellPx = 64, minSize = 2 } = {}) {
  if (zoom > MAX_CLUSTER_ZOOM) return [];
  const cells = new Map();
  for (const it of items) {
    if (!Number.isFinite(it.lat) || !Number.isFinite(it.lon)) continue;
    const [x, y] = project(it.lat, it.lon, zoom);
    const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
    let c = cells.get(key);
    if (!c) { c = { key, sumLat: 0, sumLon: 0, count: 0, ids: [], worst: 'none', inRisk: 0 }; cells.set(key, c); }
    c.sumLat += it.lat; c.sumLon += it.lon; c.count += 1; c.ids.push(it.id);
    const level = it.level || 'none';
    if (RANK[level] > RANK[c.worst]) c.worst = level;
    if (level !== 'none') c.inRisk += 1;
  }
  return [...cells.values()].filter((c) => c.count >= minSize)
    .map((c) => ({ key: c.key, lat: c.sumLat / c.count, lon: c.sumLon / c.count, count: c.count, ids: c.ids, worst: c.worst, inRisk: c.inRisk }));
}
