/**
 * Nearby Emergency Services
 *
 * Was calling Nominatim directly from the client (5 parallel requests per
 * lookup). Two problems with that: Nominatim's public instance enforces a
 * strict 1 request/second limit with no bulk/parallel use, so firing 5 at
 * once gets intermittently rate-limited (the "sometimes works" symptom),
 * and Nominatim is a name/address geocoder, not a spatial tag-query engine,
 * so it can miss real amenities that don't textually match the search term
 * even when it isn't rate-limited.
 *
 * Now calls a Supabase Edge Function backed by OpenStreetMap's Overpass API
 * (the right tool for "everything tagged amenity=X within N metres"), with
 * server-side caching so repeated lookups near the same spot don't even hit
 * Overpass again. Same output shape as before, so NearbyServices.js doesn't
 * need any changes.
 */

import { supabase } from './supabase';

export const CATEGORIES = [
  { key: 'hospital',     label: 'Hospitals',       icon: 'medkit' },
  { key: 'police',       label: 'Police Stations', icon: 'shield-checkmark' },
  { key: 'fire_station', label: 'Fire Stations',   icon: 'flame' },
  { key: 'pharmacy',     label: 'Pharmacies',      icon: 'medical' },
  { key: 'clinic',       label: 'Clinics',         icon: 'fitness' },
];

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<Array<{category, label, icon, places: Array<{name, lat, lon, distanceKm}>}>>}
 */
export async function fetchNearbyServices(lat, lon) {
  const { data, error } = await supabase.functions.invoke('nearby-services', {
    body: { lat, lon },
  });

  if (error) throw error;

  return CATEGORIES.map((cat) => {
    const places = (data?.categories?.[cat.key] || []).map((p) => ({
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      distanceKm: p.distance_m / 1000,
      address: p.address,
      phone: p.phone,
    }));
    return { category: cat.key, label: cat.label, icon: cat.icon, places };
  });
}