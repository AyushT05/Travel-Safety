import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export default function useAlerts() {
  const [alerts, setAlerts] = useState([]);
  const alertsRef = useRef([]);

  useEffect(() => {
    let channel;
    let cancelled = false;

    function upsert(row) {
      const next = [row, ...alertsRef.current.filter((a) => a.id !== row.id)].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      );
      alertsRef.current = next;
      setAlerts(next);
    }

    async function bootstrap() {
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (!cancelled && !error && data) {
        alertsRef.current = data;
        setAlerts(data);
      } else if (error) {
        console.error("Failed to load alerts:", error);
      }

      channel = supabase
        .channel("alerts-live")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "alerts" },
          (payload) => upsert(payload.new)
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "alerts" },
          (payload) => upsert(payload.new)
        )
        .subscribe();
    }

    bootstrap();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  async function acknowledge(id) {
    const { error } = await supabase
      .from("alerts")
      .update({ status: "acknowledged" })
      .eq("id", id);
    if (error) console.error("Failed to acknowledge alert:", error);
  }

  async function resolve(id) {
    // resolved_at / resolved_by are stamped server-side by a trigger, never
    // set them from the client.
    const { error } = await supabase
      .from("alerts")
      .update({ status: "resolved" })
      .eq("id", id);
    if (error) console.error("Failed to resolve alert:", error);
  }

  const openCount = alerts.filter((a) => a.status === "open").length;

  return { alerts, openCount, acknowledge, resolve };
}
