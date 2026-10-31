import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export default function useSafetyAssessments() {
  const [assessments, setAssessments] = useState({});
  const assessmentsRef = useRef({});

  useEffect(() => {
    let channel;
    let cancelled = false;

    function publish(next) {
      assessmentsRef.current = next;
      setAssessments(next);
    }

    // Keyed the same way as useDevices (travel_card_id, else user_id) so the
    // lookup assessments[deviceKey] lines up with the per-trip device entries.
    const keyOf = (row) => row.travel_card_id || row.user_id;

    function applyRow(row) {
      if (!row?.user_id) return;
      publish({ ...assessmentsRef.current, [keyOf(row)]: row });
    }

    async function bootstrap() {
      const { data, error } = await supabase
        .from("safety_assessments")
        .select("*");

      if (!cancelled && !error && data) {
        const initial = {};
        for (const row of data) {
          initial[keyOf(row)] = row;
        }
        publish(initial);
      } else if (error) {
        console.error("Failed to load safety_assessments:", error);
      }

      if (cancelled) return;
      channel = supabase
        .channel("safety-live")
        .on("postgres_changes", {
          event: "INSERT", schema: "public", table: "safety_assessments",
        }, (payload) => applyRow(payload.new))
        .on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "safety_assessments",
        }, (payload) => applyRow(payload.new))
        .subscribe();
    }

    bootstrap();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return { assessments };
}
