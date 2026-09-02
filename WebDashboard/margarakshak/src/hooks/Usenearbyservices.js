import { useState, useCallback } from "react";
import { supabase } from "../lib/supabase";

const CATEGORY_META = {
  hospital:     { label: "Hospitals",       color: "#DC2626" },
  police:       { label: "Police Stations", color: "#2563EB" },
  fire_station: { label: "Fire Stations",   color: "#EA580C" },
  pharmacy:     { label: "Pharmacies",      color: "#059669" },
  clinic:       { label: "Clinics",         color: "#7C3AED" },
};

export default function useNearbyServices() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const search = useCallback(async (lat, lon) => {
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: fnError } = await supabase.functions.invoke(
        "nearby-services",
        { body: { lat, lon } }
      );
      if (fnError) throw fnError;
      setData(result);
    } catch (e) {
      setError(e.message || "Failed to load nearby services");
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { data, loading, error, search, reset, CATEGORY_META };
}