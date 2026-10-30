import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { zoneFromRiskRow, zoneFromUnsafeRow } from '../lib/risk/model';

const POLL_MS = 60000;
const RISK_COLS = 'id,name,hazard_type,geometry,radius_m,severity,confidence,source,source_url,observed_at,expires_at,status,attributes,updated_at';
const UNSAFE_COLS = 'id,category,severity,description,lat,lon,radius_m,status,created_at,expires_at';

/**
 * Hazard zones for the map: curated and ingested zones (risk_zones) plus user and admin reports
 * (unsafe_zones), as one list. Refreshed every minute. A failed refresh keeps the last good list and
 * reports the error, so the map never silently empties.
 */
export default function useRiskZones() {
  const [state, setState] = useState({ zones: [], loading: true, error: null, loadedAt: null });
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const [risk, unsafe] = await Promise.all([
        supabase.from('risk_zones').select(RISK_COLS).eq('status', 'active'),
        supabase.from('unsafe_zones').select(UNSAFE_COLS).in('status', ['verified', 'pending']),
      ]);
      if (risk.error) throw new Error(`risk_zones: ${risk.error.message}`);
      if (unsafe.error) throw new Error(`unsafe_zones: ${unsafe.error.message}`);
      const now = new Date();
      const zones = [
        ...(risk.data || []).map((r) => zoneFromRiskRow(r, now)),
        ...(unsafe.data || []).map(zoneFromUnsafeRow),
      ].filter(Boolean);
      if (alive.current) setState({ zones, loading: false, error: null, loadedAt: now });
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, loading: false, error: e.message || String(e) }));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive.current = false; clearInterval(t); };
  }, [load]);

  return state;
}
