import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

// Mirrors useDevices.js's bootstrap-then-subscribe pattern exactly, but
// against trip_activity_state instead of locations. Rows here are written
// by the HSMM scoring service (Render), not by the tourist's phone, so
// this is a SEPARATE realtime channel from useDevices' "locations-live".
//
// Unlike locations (append-only, every row is a new INSERT), rows here get
// upserted per trip_id: the FIRST ping for a trip is an INSERT, every ping
// after that is an UPDATE to the same row. Both event types have to be
// subscribed to, or every score after the first one for a given trip would
// be silently missed.
export default function useActivityState() {
  const [activity, setActivity] = useState({});
  const activityRef = useRef({});

  useEffect(() => {
    let channel;
    let cancelled = false;

    function applyRow(row) {
      const next = {
        ...activityRef.current,
        [row.trip_id]: {
          currentState: row.current_state,
          durationMinutes: row.duration_minutes,
          tailProbability: row.tail_probability,
          llr: row.llr,
          updatedAt: row.updated_at,
        },
      };
      activityRef.current = next;
      setActivity(next);
    }

    async function bootstrap() {
      const { data, error } = await supabase
        .from("trip_activity_state")
        .select("trip_id, current_state, duration_minutes, tail_probability, llr, updated_at");

      if (!cancelled && !error && data) {
        const initial = {};
        data.forEach((row) => {
          initial[row.trip_id] = {
            currentState: row.current_state,
            durationMinutes: row.duration_minutes,
            tailProbability: row.tail_probability,
            llr: row.llr,
            updatedAt: row.updated_at,
          };
        });
        activityRef.current = initial;
        setActivity(initial);
      } else if (error) {
        console.error("Failed to load trip_activity_state:", error);
      }

      channel = supabase
        .channel("trip-activity-live")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "trip_activity_state" },
          (payload) => applyRow(payload.new)
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "trip_activity_state" },
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

  return { activity };
}
