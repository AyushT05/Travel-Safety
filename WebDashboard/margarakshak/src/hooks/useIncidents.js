import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const OPEN = ["open", "acknowledged"];
const POLL_MS = 30000;
const LEVEL_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

export function sortIncidents(list) {
  return [...list].sort(
    (a, b) =>
      (LEVEL_RANK[b.level] || 0) - (LEVEL_RANK[a.level] || 0) ||
      new Date(b.updated_at) - new Date(a.updated_at)
  );
}

// Incidents are admin-only (RLS), so for non-admins this simply returns nothing.
export default function useIncidents() {
  const [incidents, setIncidents] = useState([]);
  const ref = useRef([]);

  // Shared by the realtime/poll effect and by act(); touches only a ref and a state setter.
  const commit = useCallback((next) => {
    ref.current = next;
    setIncidents(next);
  }, []);

  useEffect(() => {
    let channel;
    let cancelled = false;

    function upsert(row) {
      const rest = ref.current.filter((i) => i.id !== row.id);
      commit(OPEN.includes(row.status) ? [row, ...rest] : rest);
    }

    async function refresh() {
      const { data, error } = await supabase
        .from("incidents")
        .select("*")
        .in("status", OPEN)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) {
        console.error("Failed to load incidents:", error);
        return;
      }
      commit(data || []);
    }

    async function bootstrap() {
      await refresh();
      if (cancelled) return;
      channel = supabase
        .channel("incidents-live")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "incidents" },
          (p) => upsert(p.new))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "incidents" },
          (p) => upsert(p.new))
        .subscribe();
    }

    bootstrap();
    const poll = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(poll);
      if (channel) supabase.removeChannel(channel);
    };
  }, [commit]);

  // action: acknowledged | resolved | dismissed | contacted | note
  // The database only lets admins change status/resolution; every action is also logged
  // (who, when, why) so dismissals can later be used to tune thresholds.
  async function act(incident, action, { reason = null, note = null } = {}) {
    const statusPatch = {
      acknowledged: { status: "acknowledged" },
      resolved: { status: "resolved", resolution: "admin_resolved" },
      dismissed: { status: "dismissed", resolution: reason || "other" },
    }[action];

    if (statusPatch) {
      const { error } = await supabase.from("incidents").update(statusPatch).eq("id", incident.id);
      if (error) {
        console.error("Failed to update incident:", error);
        return { error };
      }
    }
    const { error: logError } = await supabase
      .from("incident_actions")
      .insert({ incident_id: incident.id, action, reason, note });
    if (logError) console.error("Failed to log incident action:", logError);

    if (statusPatch) {
      const next = { ...incident, ...statusPatch };
      const rest = ref.current.filter((i) => i.id !== incident.id);
      commit(OPEN.includes(next.status) ? [next, ...rest] : rest);
    }
    return { error: logError || null };
  }

  const urgentCount = incidents.filter(
    (i) => i.status === "open" && (i.level === "high" || i.level === "critical")
  ).length;

  return { incidents: sortIncidents(incidents), urgentCount, act };
}
