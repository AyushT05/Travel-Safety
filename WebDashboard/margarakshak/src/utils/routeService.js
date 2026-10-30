// Route resolution and road geometry service for Margarakshak Web Dashboard.
// Fetches real driving routes from OSRM following roads & highways (like Google Maps),
// caches them in memory, and handles fallback gracefully.

const routeCache = new Map();

/**
 * Extracts waypoints from a travel card.
 * Returns array of { name, lat, lon }
 */
export function extractWaypoints(card) {
  if (!card) return [];
  const details = card.place_details;
  if (Array.isArray(details) && details.length >= 2) {
    const valid = details
      .filter((p) => p && typeof p.lat === "number" && typeof p.lon === "number")
      .map((p, idx) => ({
        name: p.name || `Stop ${idx + 1}`,
        lat: p.lat,
        lon: p.lon,
      }));
    if (valid.length >= 2) return valid;
  }
  return [];
}

/**
 * Fetches real driving route from OSRM.
 * Returns { polyline: [[lat, lon], ...], distanceKm, durationHours, waypoints }
 */
export async function getRoadRoute(card) {
  if (!card) return null;

  // 1. If card already has a detailed polyline (>10 points), use it directly
  if (card.planned_route?.polyline && card.planned_route.polyline.length >= 10) {
    return {
      polyline: card.planned_route.polyline,
      distanceKm: card.planned_route.distance_km || 0,
      durationHours: card.planned_route.duration_hours || 0,
      waypoints: extractWaypoints(card),
      source: "card_planned_route",
    };
  }

  const waypoints = extractWaypoints(card);
  if (waypoints.length < 2) return null;

  const cacheKey = waypoints.map((w) => `${w.lon.toFixed(5)},${w.lat.toFixed(5)}`).join(";");
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey);
  }

  // 2. Fetch road routing from OSRM
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${cacheKey}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const data = await res.json();

    if (data.code === "Ok" && data.routes && data.routes.length > 0) {
      const primary = data.routes[0];
      // OSRM GeoJSON coords are [lon, lat] -> convert to Leaflet [lat, lon]
      const polyline = (primary.geometry?.coordinates || []).map((c) => [c[1], c[0]]);

      const routeResult = {
        polyline,
        distanceKm: Math.round((primary.distance / 1000) * 10) / 10,
        durationHours: Math.round((primary.duration / 3600) * 10) / 10,
        waypoints,
        source: "osrm_road",
      };

      routeCache.set(cacheKey, routeResult);
      return routeResult;
    }
  } catch (err) {
    console.warn("Could not fetch OSRM road geometry, using fallback:", err);
  }

  // 3. Fallback: return waypoint coordinates
  const fallback = {
    polyline: waypoints.map((w) => [w.lat, w.lon]),
    distanceKm: 0,
    durationHours: 0,
    waypoints,
    source: "fallback_waypoints",
  };
  return fallback;
}
