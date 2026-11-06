import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const POLL_MS = 30000;
const FRESH_MS = 10 * 60 * 1000;      // an analysis older than this describes the past (the agent ticks every minute)

// Latest AI analysis per trip (keyed by travel_card_id, the same key as devices). Live via Realtime.
export default function useTripInsights() {
  const [insights, setInsights] = useState({});
  const ref = useRef({});

  useEffect(() => {
    let channel;
    let cancelled = false;
    const publish = (next) => { ref.current = next; setInsights(next); };
    const apply = (row) => row?.travel_card_id && publish({ ...ref.current, [row.travel_card_id]: row });

    async function refresh() {
      const { data, error } = await supabase.from("trip_insights").select("*");
      if (cancelled) return;
      if (error) { console.warn("trip_insights unavailable (run 20261101_trip_insights_and_notifications.sql):", error.message); return; }
      publish(Object.fromEntries((data || []).map((r) => [r.travel_card_id, r])));
    }
    refresh().then(() => {
      if (cancelled) return;
      channel = supabase.channel("trip-insights-live")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_insights" }, (p) => apply(p.new))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trip_insights" }, (p) => apply(p.new))
        .subscribe();
    });
    const poll = setInterval(refresh, POLL_MS);
    return () => { cancelled = true; clearInterval(poll); if (channel) supabase.removeChannel(channel); };
  }, []);

  return { insights };
}

export const insightIsFresh = (i) => !!i && Date.now() - new Date(i.updated_at).getTime() < FRESH_MS;
