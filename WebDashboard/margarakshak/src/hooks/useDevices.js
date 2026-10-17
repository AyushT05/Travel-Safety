import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const FRESHNESS_REFRESH_MS = 5000;
const TRAIL_HISTORY_HOURS = 6;      // how far back to rebuild trails on load
const TRAIL_HISTORY_ROWS = 2000;    // newest rows fetched per device (about 2.8 h at 5 s)
const TRAIL_MAX_POINTS = 3000;      // per device, oldest dropped first
const TRAIL_MIN_STEP_M = 3;         // ignore moves smaller than this (GPS jitter)
const TRAIL_MAX_ACCURACY_M = 60;    // ignore very poor fixes in the drawn trail

function getFreshness(recordedAt) {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(recordedAt).getTime()) / 1000));
  const freshnessStatus = ageSeconds <= 20 ? "LIVE" : ageSeconds <= 90 ? "DELAYED" : "STALE";
  return { locationAgeSeconds: ageSeconds, freshnessStatus };
}

function distM(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Returns a NEW trail array (immutable updates let MapView detect changes by
// reference) or the same array when the point is not worth drawing.
function extendTrail(trail, latlng, accuracy) {
  if (accuracy != null && accuracy > TRAIL_MAX_ACCURACY_M) return trail;
  const last = trail[trail.length - 1];
  if (last && distM(last, latlng) < TRAIL_MIN_STEP_M) return trail;
  const next = trail.length >= TRAIL_MAX_POINTS ? trail.slice(1) : trail.slice();
  next.push(latlng);
  return next;
}

function toDevice(row, previous = null) {
  const timestamp = new Date(row.recorded_at).getTime();
  const latlng = [row.lat, row.lon];
  const cardId = row.travel_card_id || null;

  // A different travel_card_id on the incoming row IS the trip boundary. This
  // comes from the data itself, so it cannot flip back and forth the way a
  // card list polled every 10 s (and picked by findCurrentCard) can.
  const sameTrip = previous && (previous.travelCardId || null) === cardId;
  const baseTrail = sameTrip ? previous.trail || [] : [];

  return {
    lastLatlng: latlng,
    accuracy: row.accuracy,
    speed: row.speed,
    timestamp: timestamp / 1000,
    updates: (previous?.updates || 0) + 1,
    travelCardId: cardId,
    trail: extendTrail(baseTrail, latlng, row.accuracy),
    ...getFreshness(row.recorded_at),
  };
}

export default function useDevices() {
  const [devices, setDevices] = useState({});
  const devicesRef = useRef({});

  useEffect(() => {
    let channel;
    let cancelled = false;

    function publish(next) {
      devicesRef.current = next;
      setDevices(next);
    }

    function applyRow(row) {
      if (!row?.user_id || !row?.recorded_at) return;
      const prev = devicesRef.current[row.user_id];
      // Ignore a late/out-of-order row so it cannot move the marker backwards.
      if (prev && new Date(row.recorded_at).getTime() / 1000 < prev.timestamp) return;
      publish({ ...devicesRef.current, [row.user_id]: toDevice(row, prev) });
    }

    // Rebuild each device's trail from stored history so a trail exists the
    // moment the dashboard opens (not only for pings seen since page load).
    // One bounded query PER DEVICE, newest first, then reversed. A single
    // shared query with a global LIMIT would return the OLDEST rows for busy
    // projects (15 travellers at 5 s is ~65k rows per 6 h) and the trails
    // would stop short of "now".
    async function loadHistory(initial) {
      const since = new Date(Date.now() - TRAIL_HISTORY_HOURS * 3600 * 1000).toISOString();
      const entries = await Promise.all(Object.entries(initial).map(async ([uid, dev]) => {
        let q = supabase
          .from("locations")
          .select("travel_card_id, lat, lon, accuracy, recorded_at")
          .eq("user_id", uid)
          .gte("recorded_at", since);
        q = dev.travelCardId ? q.eq("travel_card_id", dev.travelCardId) : q.is("travel_card_id", null);
        const { data, error } = await q
          .order("recorded_at", { ascending: false })
          .limit(TRAIL_HISTORY_ROWS);
        if (error) {
          console.error("Failed to load trail history for", uid, error);
          return [uid, []];
        }
        let trail = [];
        for (const r of (data || []).slice().reverse()) {
          // Defensive: the query already filters by trip, but keep the guard.
          if ((r.travel_card_id || null) !== (dev.travelCardId || null)) continue;
          trail = extendTrail(trail, [r.lat, r.lon], r.accuracy);
        }
        return [uid, trail];
      }));
      return Object.fromEntries(entries.filter(([, t]) => t.length));
    }

    async function bootstrap() {
      const { data, error } = await supabase
        .from("latest_locations")
        .select("user_id, lat, lon, accuracy, speed, recorded_at, travel_card_id");

      if (!cancelled && !error && data) {
        const initial = {};
        for (const row of data) initial[row.user_id] = toDevice(row, null);
        publish(initial);

        const trails = await loadHistory(initial);
        if (!cancelled) {
          // Merge with anything that arrived over realtime while history loaded.
          const merged = { ...devicesRef.current };
          for (const [uid, hist] of Object.entries(trails)) {
            const cur = merged[uid];
            if (!cur) continue;
            let t = hist;
            for (const p of cur.trail || []) t = extendTrail(t, p, null);
            merged[uid] = { ...cur, trail: t };
          }
          publish(merged);
        }
      } else if (error) {
        console.error("Failed to load latest_locations:", error);
      }

      if (cancelled) return;
      channel = supabase
        .channel("locations-live")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "locations" },
          (payload) => applyRow(payload.new))
        .subscribe();
    }

    bootstrap();

    // Freshness changes even when no Realtime event arrives. Recompute ages
    // locally so a device transitions to DELAYED/STALE without new GPS data.
    const freshnessTimer = setInterval(() => {
      if (cancelled) return;
      const current = devicesRef.current;
      const next = {};
      let changed = false;
      for (const [userId, device] of Object.entries(current)) {
        const freshness = getFreshness(new Date(device.timestamp * 1000).toISOString());
        next[userId] = { ...device, ...freshness };
        if (freshness.freshnessStatus !== device.freshnessStatus ||
            freshness.locationAgeSeconds !== device.locationAgeSeconds) changed = true;
      }
      if (changed) publish(next);
    }, FRESHNESS_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(freshnessTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // "Clear trails" keeps each device's latest point so the next ping extends
  // from where it is now.
  function clearTrails() {
    const next = {};
    for (const [uid, d] of Object.entries(devicesRef.current)) {
      next[uid] = { ...d, trail: d.lastLatlng ? [d.lastLatlng] : [] };
    }
    devicesRef.current = next;
    setDevices(next);
  }

  return { devices, clearTrails };
}
