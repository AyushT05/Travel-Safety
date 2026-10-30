// Sunrise and sunset (NOAA / Almanac algorithm), ported from the scoring service so the dashboard and the
// alerting engine agree on "after dark". Accurate to a few minutes; validated for Indian longitudes.
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const mod = (a, n) => ((a % n) + n) % n;
const DAY_MS = 86400000;

function dayOfYear(y, m, d) {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / DAY_MS);
}

function eventUtcHours(y, m, d, lat, lon, rising, zenith = 90.833) {
  const n = dayOfYear(y, m, d);
  const lngHour = lon / 15;
  const t = n + (rising ? (6 - lngHour) / 24 : (18 - lngHour) / 24);
  const meanAnomaly = 0.9856 * t - 3.289;
  const l = mod(meanAnomaly + 1.916 * Math.sin(rad(meanAnomaly)) + 0.02 * Math.sin(rad(2 * meanAnomaly)) + 282.634, 360);
  let ra = mod(deg(Math.atan(0.91764 * Math.tan(rad(l)))), 360);
  ra += Math.floor(l / 90) * 90 - Math.floor(ra / 90) * 90;
  ra /= 15;
  const sinDec = 0.39782 * Math.sin(rad(l));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(rad(zenith)) - sinDec * Math.sin(rad(lat))) / (cosDec * Math.cos(rad(lat)));
  if (cosH > 1 || cosH < -1) return null; // sun never rises / never sets
  let h = rising ? 360 - deg(Math.acos(cosH)) : deg(Math.acos(cosH));
  h /= 15;
  const localT = h + ra - 0.06571 * t - 6.622;
  return mod(localT - lngHour, 24);
}

/** -> { rise: Date, set: Date } for the local solar date y-m-d, or null in polar cases. */
export function sunTimes(y, m, d, lat, lon) {
  const r = eventUtcHours(y, m, d, lat, lon, true);
  const s = eventUtcHours(y, m, d, lat, lon, false);
  if (r === null || s === null) return null;
  const base = Date.UTC(y, m - 1, d);
  return { rise: new Date(base + r * 3600000), set: new Date(base + s * 3600000) };
}

export function localSolarDate(t, lon) {
  const shifted = new Date(t.getTime() + (lon / 15) * 3600000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** True between sunset and the next sunrise. Polar (no sunrise/sunset): false. */
export function isDark(t, lat, lon, marginMin = 0) {
  const { y, m, d } = localSolarDate(t, lon);
  const st = sunTimes(y, m, d, lat, lon);
  if (!st) return false;
  const margin = marginMin * 60000;
  return t.getTime() < st.rise.getTime() - margin || t.getTime() > st.set.getTime() + margin;
}
