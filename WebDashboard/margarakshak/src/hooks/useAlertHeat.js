import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const POLL_MS = 120000;
// How much each kind of past alert counts. A tourist pressing SOS says far more about a place than a dropped signal.
export const ALERT_WEIGHT = { panic: 1.0, geofence_entry: 0.5, geofence_approach: 0.2, dropout: 0.25 };
export const ALERT_LABEL = { panic: 'SOS', geofence_entry: 'Zone entries', dropout: 'Signal dropouts' };

/** Past alerts with a position, for the "where have things happened" heat layer. Only fetched while enabled. */
export default function useAlertHeat({ enabled, hours = 24 * 7, types = ['panic', 'geofence_entry', 'dropout'] }) {
  const [state, setState] = useState({ points: [], error: null, loadedAt: null });
  const alive = useRef(true);
  const typesKey = types.join(',');

  const load = useCallback(async () => {
    try {
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
      const { data, error } = await supabase.from('alerts')
        .select('id,type,lat,lon,created_at')
        .in('type', typesKey.split(',').filter(Boolean)).not('lat', 'is', null).not('lon', 'is', null)
        .gte('created_at', since).order('created_at', { ascending: false }).limit(3000);
      if (error) throw new Error(error.message);
      const points = (data || []).filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
        .map((a) => ({ id: a.id, type: a.type, lat: a.lat, lon: a.lon, w: ALERT_WEIGHT[a.type] ?? 0.2 }));
      if (alive.current) setState({ points, error: null, loadedAt: new Date() });
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, error: e.message || String(e) }));
    }
  }, [hours, typesKey]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) { setState({ points: [], error: null, loadedAt: null }); return undefined; }
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive.current = false; clearInterval(t); };
  }, [enabled, load]);

  return state;
}
