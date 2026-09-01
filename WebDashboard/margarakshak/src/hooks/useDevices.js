import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// Replaces the old 2s-polling loop against the Render Express server.
// Location rows now come straight from Supabase, gated by the RLS policy on
// `locations` (owner, admin, or someone who has this user in tracked_ids).
export default function useDevices() {
  const [devices, setDevices] = useState({});
  const devicesRef = useRef({});

  useEffect(() => {
    let channel;
    let cancelled = false;

    function applyRow(row) {
      const prev = devicesRef.current[row.user_id];
      const next = {
        ...devicesRef.current,
        [row.user_id]: {
          lastLatlng: [row.lat, row.lon],
          accuracy: row.accuracy,
          speed: row.speed,
          timestamp: new Date(row.recorded_at).getTime() / 1000,
          updates: (prev?.updates || 0) + 1,
        },
      };
      devicesRef.current = next;
      setDevices(next);
    }

    async function bootstrap() {
      // Initial paint: last known fix per visible user (RLS-scoped server-side).
      const { data, error } = await supabase
        .from("latest_locations")
        .select("*");

      if (!cancelled && !error && data) {
        const initial = {};
        data.forEach((row) => {
          initial[row.user_id] = {
            lastLatlng: [row.lat, row.lon],
            accuracy: row.accuracy,
            speed: row.speed,
            timestamp: new Date(row.recorded_at).getTime() / 1000,
            updates: 1,
          };
        });
        devicesRef.current = initial;
        setDevices(initial);
      } else if (error) {
        console.error("Failed to load latest_locations:", error);
      }

      // Live updates after that, no more polling.
      channel = supabase
        .channel("locations-live")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "locations" },
          (payload) => applyRow(payload.new)
        )
        .subscribe();
    }

    bootstrap();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return {
    devices,
    clearTrails: () => {},
    toggleFollow: () => true,
    fitAll: () => {},
  };
}
