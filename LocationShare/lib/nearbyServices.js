/**
 * Nearby Emergency Services — Nominatim (OpenStreetMap) Search API
 *
 * Uses Nominatim instead of Overpass to avoid CORS issues.
 * The same logic is duplicated in the web dashboard as
 * WebDashboard/margarakshak/src/utils/nearbyServices.js — keep the two in sync.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

const CATEGORIES = [
  { key: 'hospital',     query: 'hospital',       label: 'Hospitals',        icon: 'medkit' },
  { key: 'police',       query: 'police station', label: 'Police Stations',  icon: 'shield-checkmark' },
  { key: 'fire_station', query: 'fire station',   label: 'Fire Stations',    icon: 'flame' },
  { key: 'pharmacy',     query: 'pharmacy',       label: 'Pharmacies',       icon: 'medical' },
  { key: 'clinic',       query: 'clinic',         label: 'Clinics',          icon: 'fitness' },
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
 * Fetch nearby emergency services from Nominatim.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} [radiusKm=5] — search radius in kilometres
 * @returns {Promise<Array<{category, label, icon, places: Array<{name, lat, lon, distanceKm}>}>>}
 */
export async function fetchNearbyServices(lat, lon, radiusKm = 5) {
  const results = await Promise.all(
    CATEGORIES.map(async (cat) => {
      try {
        // Nominatim search with viewbox centered on location
        const params = new URLSearchParams({
          q: cat.query,
          format: 'json',
          limit: 20,
          viewbox: `${lon - 0.1},${lat - 0.1},${lon + 0.1},${lat + 0.1}`,
          bounded: 1,
        });

        const res = await fetch(`${NOMINATIM_URL}?${params}`, {
          headers: {
            'User-Agent': 'MargRakshak-TravelSafety/1.0',
          },
        });

        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();

        const places = data
          .map((place) => ({
            name: place.display_name?.split(',')[0] || 'Unnamed',
            lat: parseFloat(place.lat),
            lon: parseFloat(place.lon),
            distanceKm: haversineKm(lat, lon, parseFloat(place.lat), parseFloat(place.lon)),
          }))
          .filter((p) => p.distanceKm <= radiusKm)
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, 10);

        return { category: cat.key, label: cat.label, icon: cat.icon, places };
      } catch (e) {
        console.warn(`Failed to fetch ${cat.label}:`, e);
        return { category: cat.key, label: cat.label, icon: cat.icon, places: [] };
      }
    })
  );

  return results;
}

export { CATEGORIES };
