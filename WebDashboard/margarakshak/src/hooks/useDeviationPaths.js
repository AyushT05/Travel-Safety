import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// The red "deviation path": the route the traveller ACTUALLY drove while a route-deviation alert was open,
// rebuilt from stored location fixes (not a straight line from the marker to the nearest route point).
//   * open alert       -> traced for every traveller, refreshed as new fixes arrive
//   * resolved alert   -> kept only for the traveller whose card is selected (history, not clutter)
const LEAD_S = 120;              // include the stretch just before the alert fired (it needs 3 off-route fixes)
const MIN_STEP_M = 3;
const MAX_ACCURACY_M = 60;
const REFRESH_MS = 6000;
const MAX_ROWS = 2000;

function distM(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function buildPath(rows) {
  const out = [];
  for (const r of rows) {
    if (r.accuracy != null && r.accuracy > MAX_ACCURACY_M) continue;
    const p = [r.lat, r.lon];
    if (out.length && distM(out[out.length - 1], p) < MIN_STEP_M) continue;
    out.push(p);
  }
  return out;
}

// alerts: rows from useAlerts. devices: keyed by travel card (or user) id. selected: device key.
export default function useDeviationPaths({ alerts, devices, selected }) {
  const [paths, setPaths] = useState({});
  const cache = useRef({});        // alert id -> { rows, fetchedAt, updates }
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const wanted = (alerts || []).filter((a) => a.type === "deviation").filter((a) => {
    const key = a.travel_card_id || a.user_id;
    return a.status !== "resolved" || key === selected;
  });
  // latest wanted alert per device key, so a long history of resolved alerts draws only the newest one
  const byKey = {};
  for (const a of wanted) {
    const key = a.travel_card_id || a.user_id;
    if (!byKey[key] || new Date(a.created_at) > new Date(byKey[key].created_at)) byKey[key] = a;
  }
  const signature = Object.values(byKey).map((a) => `${a.id}:${a.status}`).join("|");
  const updatesSig = Object.keys(byKey).map((k) => devices?.[k]?.updates ?? 0).join(",");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next = {};
      await Promise.all(Object.entries(byKey).map(async ([key, a]) => {
        const open = a.status !== "resolved";
        const c = cache.current[a.id];
        const updates = devices?.[key]?.updates ?? 0;
        const fresh = c && (!open || (Date.now() - c.fetchedAt < REFRESH_MS && c.updates === updates));
        let rows = c?.rows;
        if (!fresh) {
          const since = new Date(new Date(a.created_at).getTime() - LEAD_S * 1000).toISOString();
          let q = supabase.from("locations").select("lat, lon, accuracy, recorded_at").eq("user_id", a.user_id).gte("recorded_at", since);
          if (a.resolved_at) q = q.lte("recorded_at", new Date(new Date(a.resolved_at).getTime() + 30000).toISOString());
          if (a.travel_card_id) q = q.eq("travel_card_id", a.travel_card_id);
          const { data, error } = await q.order("recorded_at", { ascending: true }).limit(MAX_ROWS);
          if (error) { console.warn("deviation path load failed:", error.message); rows = rows || []; }
          else { rows = data || []; cache.current[a.id] = { rows, fetchedAt: Date.now(), updates }; }
        }
        const path = buildPath(rows || []);
        if (path.length >= 2) next[key] = { alertId: a.id, open, path, message: a.message, startedAt: a.created_at };
      }));
      if (!cancelled && alive.current) setPaths(next);
    }
    load();
    const timer = Object.values(byKey).some((a) => a.status !== "resolved") ? setInterval(load, REFRESH_MS) : null;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, updatesSig]);

  return paths;
}
