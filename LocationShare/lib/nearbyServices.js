/**
 * Nearby Emergency Services — Proxied through server.py
 *
 * Queries for hospitals, police stations, fire stations, pharmacies, and
 * clinics within a given radius of a lat/lon coordinate.
 *
 * The same logic is duplicated in the web dashboard as
 * WebDashboard/margarakshak/src/utils/nearbyServices.js — keep the two in sync
 * when adding categories or changing the query shape.
 */

const PROXY_URL = 'https://travel-safety.onrender.com/api/nearby-services';

const CATEGORIES = [
  { key: 'hospital',     tag: 'amenity=hospital',     label: 'Hospitals',        icon: 'medkit' },
  { key: 'police',       tag: 'amenity=police',       label: 'Police Stations',  icon: 'shield-checkmark' },
  { key: 'fire_station', tag: 'amenity=fire_station', label: 'Fire Stations',    icon: 'flame' },
  { key: 'pharmacy',     tag: 'amenity=pharmacy',     label: 'Pharmacies',       icon: 'medical' },
  { key: 'clinic',       tag: 'amenity=clinic',       label: 'Clinics',          icon: 'fitness' },
];

/**
 * Haversine distance in km between two [lat, lon] points.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Fetch nearby emergency services from the Overpass API via proxy.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} [radiusMeters=5000] — search radius in metres
 * @returns {Promise<Array<{category, label, icon, places: Array<{name, lat, lon, distanceKm}>}>>}
 */
export async function fetchNearbyServices(lat, lon, radiusMeters = 5000) {
  // Use our proxy server to avoid CORS issues with Overpass API
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ lat, lon, radius: radiusMeters }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 429 || res.status === 406) {
      throw new Error('Service temporarily busy. Please wait 30 seconds and try again.');
    }
    throw new Error(`Unable to fetch services (${res.status}). Try again later.`);
  }
  const json = await res.json();

  // Bucket the raw elements by category, compute distance, and sort.
  const grouped = CATEGORIES.map((cat) => {
    const [tagKey, tagVal] = cat.tag.split('=');
    const places = json.elements
      .filter((el) => el.tags?.[tagKey] === tagVal)
      .map((el) => ({
        name: el.tags?.name || 'Unnamed',
        lat: el.lat,
        lon: el.lon,
        distanceKm: haversineKm(lat, lon, el.lat, el.lon),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return {
      category: cat.key,
      label: cat.label,
      icon: cat.icon,
      places,
    };
  });

  return grouped;
}

export { CATEGORIES };
