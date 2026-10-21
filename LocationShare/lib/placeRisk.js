// Client for the place-search and place-risk edge functions.
import { supabase } from './supabase';

export async function searchPlaces(q, bias, signal) {
  const { data, error } = await supabase.functions.invoke('place-search', {
    body: { q, lat: bias?.lat, lon: bias?.lon },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.results ?? [];
}

const ymd = (d) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : null);

export async function fetchPlaceRisk(place, startDate, endDate) {
  const { data, error } = await supabase.functions.invoke('place-risk', {
    body: {
      name: place.name, lat: place.lat, lon: place.lon, state: place.state, district: place.district, city: place.city,
      formatted: place.formatted, category: place.category,
      start_date: ymd(startDate), end_date: ymd(endDate),
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data; // { warnings, checked, generated_at }
}

export const SEVERITY_ORDER = { info: 0, caution: 1, warning: 2, danger: 3 };

export function worstSeverity(risk) {
  if (!risk?.warnings?.length) return null;
  return risk.warnings.reduce((w, x) => (SEVERITY_ORDER[x.severity] > SEVERITY_ORDER[w] ? x.severity : w), 'info');
}

// Compact summary stored on the travel card (the full warnings are not stored).
export function summarizeRisk(risk) {
  if (!risk) return null;
  return {
    checked_at: risk.generated_at,
    max_severity: worstSeverity(risk),
    warning_titles: (risk.warnings ?? []).filter((w) => SEVERITY_ORDER[w.severity] >= 1).map((w) => w.title).slice(0, 8),
    failed_sources: (risk.checked ?? []).filter((c) => !c.ok).map((c) => c.source),
  };
}