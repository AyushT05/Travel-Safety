import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import '../lib/leafletHeat';
import { PROFILES, levelFor, riskAtPoint, zoneBuffer, zoneCenter, zoneContribution, zoneHeatPoints } from '../lib/risk/model';
import { metersPerPixel, parts } from '../lib/risk/geometry';
import { clusterDevices } from '../lib/risk/cluster';
import { escapeHtml } from '../lib/risk/html';

const HEAT_RADIUS_PX = 26;
const MAX_HEAT_POINTS = 6000;
const TICK_MS = 60000;

const RISK_GRADIENT = { 0.15: '#fde047', 0.4: '#fb923c', 0.65: '#ef4444', 0.9: '#991b1b' };
const ALERT_GRADIENT = { 0.2: '#c4b5fd', 0.5: '#8b5cf6', 0.8: '#6d28d9', 1.0: '#3b0764' };
const DENSITY_GRADIENT = { 0.2: '#99f6e4', 0.5: '#14b8a6', 0.8: '#0f766e', 1.0: '#134e4a' };

const OUTLINE = {
  none: { color: '#94a3b8', weight: 1, dashArray: '4 4', fillOpacity: 0.02 },
  caution: { color: '#d97706', weight: 2, dashArray: null, fillOpacity: 0.08 },
  warning: { color: '#ea580c', weight: 2, dashArray: null, fillOpacity: 0.1 },
  danger: { color: '#b91c1c', weight: 2.5, dashArray: null, fillOpacity: 0.12 },
};

// Neighbouring points overlap and add up in a heat layer; scale weights so a lone weak zone is not
// drowned out and a dense strong one does not simply saturate.
const heatScale = (n) => (n >= 6 ? 1 / 2.2 : n >= 2 ? 1 / 1.6 : 1);

const toLatLngs = (data) => data.map(([la, lo]) => [la, lo]);

// leaflet.heat is fragile around removal: setLatLngs on a layer that is no longer on a map throws, and a
// redraw frame scheduled before removal fires afterwards and throws too. These two helpers are the only
// way this file touches a heat layer.
function detachHeat(map, layer) {
  if (!layer) return;
  if (layer._frame) { L.Util.cancelAnimFrame(layer._frame); layer._frame = null; }
  try { if (map.hasLayer(layer)) map.removeLayer(layer); } catch { /* the map was already removed */ }
}

function syncHeat(map, layer, points, want) {
  if (!layer) return;
  if (!want) { detachHeat(map, layer); return; }
  if (map.hasLayer(layer)) layer.setLatLngs(points);
  else { layer._latlngs = points; layer.addTo(map); }     // same effect as setLatLngs, without a redraw on a detached layer
}

function shapeFor(z, style) {
  const rendered = [];
  for (const { kind, data } of parts(z.geometry)) {
    if (kind === 'point') rendered.push(L.circle(data, { ...style, radius: Math.max(zoneBuffer(z), 15), fill: true, fillColor: style.color }));
    else if (kind === 'line') rendered.push(L.polyline(toLatLngs(data), { color: style.color, weight: Math.max(style.weight + 3, 5), opacity: 0.7, dashArray: style.dashArray }));
    else rendered.push(L.polygon(data.map(toLatLngs), { ...style, fill: true, fillColor: style.color }));
  }
  return rendered;
}

function popupHtml(z, c, level, at) {
  const prof = PROFILES[z.hazard];
  const rows = [
    ['Type', prof.label], ['Severity', z.severity], ['Confidence', `${Math.round(z.confidence * 100)}%`],
    ['Risk at this time', c.skip ? `not applicable (${c.skip.replace(/_/g, ' ')})` : `${level} (${c.value.toFixed(2)})${c.dark && prof.nightW > prof.dayW ? ', after dark' : ''}`],
    ['Source', z.source], ['Valid until', z.expiresAt ? z.expiresAt.toLocaleString() : 'no expiry set'],
    ['Evaluated for', at.toLocaleString()],
  ];
  const link = z.sourceUrl && /^https?:\/\//i.test(z.sourceUrl) ? `<div><a href="${escapeHtml(z.sourceUrl)}" target="_blank" rel="noreferrer">Source</a></div>` : '';
  return `<div class="rz-popup"><strong>${escapeHtml(z.name)}</strong>${rows.map(([k, v]) => `<div><span>${k}</span> ${escapeHtml(v)}</div>`).join('')}${link}</div>`;
}

/**
 * Drives the risk overlays on a Leaflet map: hazard heat + outlines, past-alert heat, tourist density and
 * tourist clusters. `map` is the Leaflet map (null until ready). Everything is torn down cleanly.
 */
export default function useRiskLayers(map, { zones = [], alertPoints = [], devices = {}, markersRef = null, selectedId = null, options = {} }) {
  const [tick, setTick] = useState(0);
  const [view, setView] = useState(0);                       // bumps when the visible area / zoom changes
  const handles = useRef({});
  const o = options || {};
  const atMs = o.at instanceof Date ? o.at.getTime() : null;

  // minute tick so "now" moves on (lighting zones glow at dusk) and dead-man expiry is honoured
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), TICK_MS); return () => clearInterval(t); }, []);

  // redraw after the map settles
  useEffect(() => {
    if (!map) return undefined;
    let timer = null;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => setView((n) => n + 1), 180); };
    map.on('moveend zoomend', bump);
    return () => { clearTimeout(timer); map.off('moveend zoomend', bump); };
  }, [map]);

  // ---- create the layers once per map
  useEffect(() => {
    if (!map) return undefined;
    const h = handles.current;
    h.outlines = L.layerGroup().addTo(map);
    h.clusters = L.layerGroup().addTo(map);
    h.riskHeat = L.heatLayer([], { radius: HEAT_RADIUS_PX, blur: 22, maxZoom: 17, max: 1.0, minOpacity: 0.2, gradient: RISK_GRADIENT });
    h.alertHeat = L.heatLayer([], { radius: 22, blur: 18, maxZoom: 17, max: 1.0, minOpacity: 0.25, gradient: ALERT_GRADIENT });
    h.densityHeat = L.heatLayer([], { radius: 32, blur: 24, maxZoom: 17, max: 1.0, minOpacity: 0.25, gradient: DENSITY_GRADIENT });
    return () => {
      [h.riskHeat, h.alertHeat, h.densityHeat].forEach((l) => detachHeat(map, l));
      [h.outlines, h.clusters].forEach((l) => { try { if (l && map.hasLayer(l)) map.removeLayer(l); } catch { /* already removed */ } });
      handles.current = {};
    };
  }, [map]);

  const at = useMemo(() => (atMs ? new Date(atMs) : new Date()), [atMs, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- hazard outlines + heat
  useEffect(() => {
    const h = handles.current;
    if (!map || !h.outlines) return;
    h.outlines.clearLayers();
    const wantHeat = !!o.riskHeat, wantOutlines = !!o.zoneOutlines;
    const heatPts = [];
    if (wantHeat || wantOutlines) {
      const zoom = map.getZoom();
      const b = map.getBounds().pad(0.3);
      const bounds = { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() };
      for (const z of zones) {
        let center;
        try { center = zoneCenter(z); } catch { continue; }
        const c = zoneContribution(z, at, center.lat, center.lon);
        const level = levelFor(c.value);
        if (wantOutlines && (level !== 'none' || o.showInactive)) {
          try {
            const shapes = shapeFor(z, OUTLINE[level]);
            shapes.forEach((s) => { s.bindPopup(popupHtml(z, c, level, at)); h.outlines.addLayer(s); });
          } catch { /* a malformed geometry must not break the map */ }
        }
        if (wantHeat && c.value >= 0.01 && heatPts.length < MAX_HEAT_POINTS) {
          try {
            const spacing = metersPerPixel(center.lat, zoom) * HEAT_RADIUS_PX * 0.6;
            const pts = zoneHeatPoints(z, c.value, { spacingM: spacing, bounds, maxPoints: Math.min(400, MAX_HEAT_POINTS - heatPts.length) });
            const k = heatScale(pts.length);
            pts.forEach(([la, lo, w]) => heatPts.push([la, lo, w * k]));
          } catch { /* skip */ }
        }
      }
    }
    syncHeat(map, h.riskHeat, heatPts, wantHeat);
  }, [map, zones, at, view, o.riskHeat, o.zoneOutlines, o.showInactive]);

  // ---- past alerts heat
  useEffect(() => {
    const h = handles.current;
    if (!map || !h.alertHeat) return;
    syncHeat(map, h.alertHeat, alertPoints.map((p) => [p.lat, p.lon, Math.min(1, p.w * 0.6)]), !!o.alertHeat);
  }, [map, alertPoints, o.alertHeat]);

  // ---- tourist density heat
  const live = useMemo(() => Object.entries(devices || {}).filter(([, d]) => d && Array.isArray(d.lastLatlng))
    .map(([id, d]) => ({ id, lat: d.lastLatlng[0], lon: d.lastLatlng[1] })), [devices]);

  useEffect(() => {
    const h = handles.current;
    if (!map || !h.densityHeat) return;
    syncHeat(map, h.densityHeat, live.map((d) => [d.lat, d.lon, 0.5]), !!o.density);
  }, [map, live, o.density]);

  // ---- tourist clusters (each coloured by the worst current risk among its members)
  useEffect(() => {
    const h = handles.current;
    if (!map || !h.clusters) return undefined;
    h.clusters.clearLayers();
    const markers = (markersRef && markersRef.current) || {};
    const hidden = [];
    if (o.clusters && live.length > 1) {
      const items = live.map((d) => ({ ...d, level: zones.length ? riskAtPoint(zones, d.lat, d.lon, at).level : 'none' }));
      const clusters = clusterDevices(items, map.getZoom());
      for (const c of clusters) {
        const size = Math.round(34 + Math.min(26, Math.sqrt(c.count) * 6));
        const icon = L.divIcon({
          className: 'tc-wrap', iconSize: [size, size],
          html: `<div class="tc-bubble tc-${c.worst}" style="width:${size}px;height:${size}px;line-height:${size}px">${c.count}</div>`,
        });
        const m = L.marker([c.lat, c.lon], { icon, zIndexOffset: 1000, keyboard: false });
        m.bindTooltip(`${c.count} tourists${c.inRisk ? `, ${c.inRisk} in a risk zone` : ''}`, { direction: 'top' });
        m.on('click', () => map.fitBounds(L.latLngBounds(c.ids.map((id) => { const d = live.find((x) => x.id === id); return [d.lat, d.lon]; })), { maxZoom: 17, padding: [60, 60] }));
        h.clusters.addLayer(m);
        c.ids.filter((id) => id !== selectedId).forEach((id) => { if (markers[id]) { markers[id].setOpacity(0); hidden.push(id); } });
      }
    }
    return () => { hidden.forEach((id) => { if (markers[id]) markers[id].setOpacity(1); }); };   // never leave a tourist hidden
  }, [map, live, zones, at, view, o.clusters, selectedId, markersRef]);
}
