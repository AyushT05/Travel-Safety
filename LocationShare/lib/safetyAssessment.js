import { supabase } from './supabase';

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:8000';

/**
 * Triggers a safety assessment for the user's current location.
 * Calls the server endpoint which evaluates the area and writes results to Supabase.
 * Falls back to a direct Supabase query if the server is unreachable.
 */
export async function requestSafetyAssessment(lat, lon, userId, travelCardId, speed, prevLocations) {
  try {
    const response = await fetch(`${SERVER_URL}/api/assess-safety`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        lat,
        lon,
        user_id: userId,
        travel_card_id: travelCardId,
        speed,
        prev_locations: prevLocations,
      }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (e) {
    console.warn('Safety assessment via server failed, using direct query:', e.message);
    // Fallback: just read the latest assessment from the table
    return fetchLatestAssessment(userId);
  }
}

/**
 * Fetches the latest safety assessment for a user from Supabase.
 */
export async function fetchLatestAssessment(userId) {
  const { data, error } = await supabase
    .from('safety_assessments')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') console.error('Failed to fetch safety assessment:', error);
  return data || null;
}

/**
 * Reports an unsafe zone at the given coordinates.
 */
export async function reportUnsafeZone({ lat, lon, category, severity, description, userId }) {
  const { data, error } = await supabase
    .from('unsafe_zones')
    .insert({
      reported_by: userId,
      category,
      severity: severity || 'warning',
      description,
      lat,
      lon,
      radius_m: 500,
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Safety status config for UI rendering */
export const SAFETY_CONFIG = {
  safe: {
    label: 'Safe Area',
    color: '#16a34a',
    bgColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    icon: 'shield-checkmark',
    description: 'You are in a well-connected area with good emergency access.',
  },
  caution: {
    label: 'Caution',
    color: '#d97706',
    bgColor: '#fffbeb',
    borderColor: '#fde68a',
    icon: 'alert-circle',
    description: 'Some risk factors detected in your area. Stay alert.',
  },
  unsafe: {
    label: 'Unsafe Area',
    color: '#dc2626',
    bgColor: '#fef2f2',
    borderColor: '#fecaca',
    icon: 'warning',
    description: 'Multiple risk factors detected. Consider moving to a safer location.',
  },
};
