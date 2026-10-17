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
const POLL_MS = 15000;

function toActivity(row) {
  return {
    currentState: row.current_state,
    durationMinutes: row.duration_minutes,
    tailProbability: row.tail_probability,
    llr: row.llr,
    updatedAt: row.updated_at,
  };
}

// Rows are keyed by trip_id = travel_card_id (falls back to user_id only for
// legacy pings). Callers must look activity up with pickActivity() below, NOT
// with the user id alone, or a trip-keyed row is never found and an old
// user-id-keyed row from before that migration is shown forever.
export function pickActivity(activity, device, userId) {
  if (!device) return null;
  const row = device.travelCardId ? activity[device.travelCardId] : activity[userId];
  return row || null;
}

export default function useActivityState() {
  const [activity, setActivity] = useState({});
  const activityRef = useRef({});

  useEffect(() => {
    let channel;
    let cancelled = false;

    function applyRow(row) {
      const next = { ...activityRef.current, [row.trip_id]: toActivity(row) };
      activityRef.current = next;
      setActivity(next);
    }

    async function refresh() {
      const { data, error } = await supabase
        .from("trip_activity_state")
        .select("trip_id, current_state, duration_minutes, tail_probability, llr, updated_at");
      if (cancelled) return;
      if (error) {
        console.error("Failed to load trip_activity_state:", error);
        return;
      }
      const all = {};
      (data || []).forEach((row) => { all[row.trip_id] = toActivity(row); });
      activityRef.current = all;
      setActivity(all);
    }

    async function bootstrap() {
      await refresh();
      if (cancelled) return;
      // Realtime needs trip_activity_state in the supabase_realtime
      // publication (see 20261017_activity_realtime.sql). The poll below keeps
      // the panel correct even if that has not been applied.
      channel = supabase
        .channel("trip-activity-live")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_activity_state" },
          (payload) => applyRow(payload.new))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trip_activity_state" },
          (payload) => applyRow(payload.new))
        .subscribe();
    }

    bootstrap();
    const poll = setInterval(refresh, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return { activity };
}
