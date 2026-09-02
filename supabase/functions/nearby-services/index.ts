// supabase/functions/nearby-services/index.ts
//
// Deploy with: supabase functions deploy nearby-services
//
// Replaces the old client-side Nominatim calls (utils/nearbyServices.js,
// lib/nearbyServices.js). Reasons that implementation was unreliable:
//
// 1. Nominatim's public instance enforces a strict 1 request/second limit
//    with no parallel/bulk use. The old code fired 5 categories via
//    Promise.all — 5 simultaneous requests every time a device moved >2km
//    or every 5 minutes — which gets you soft-blocked intermittently. That's
//    the "sometimes works, sometimes doesn't" you're seeing, it's not
//    random, it's rate-limiting kicking in under load.
// 2. Nominatim is a geocoder (free-text search over names/addresses), not a
//    spatial tag-query engine. Asking it "hospital" near a viewbox often
//    misses real hospitals that don't have "hospital" in their indexed
//    name text, independent of rate limiting, it's the wrong tool.
//
// Overpass is built for exactly this: "give me every node/way tagged
// amenity=hospital within N metres of this point," which is what's needed
// here. Calling it from an Edge Function (not the browser) also sidesteps
// the CORS issues that pushed the previous implementation to Nominatim in
// the first place, server-to-server requests aren't subject to CORS at all.
//
// Input  (POST body): { "lat": number, "lon": number }
// Output: {
//   origin: { lat, lon },
//   generated_at: string,
//   categories: {
//     hospital:     [{ id, name, lat, lon, distance_m, address, phone }, ...],
//     police:       [...],
//     fire_station: [...],
//     pharmacy:     [...],
//     clinic:       [...],
//   }
// }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CATEGORIES: Record<string, { osm: string; label: string }> = {
  hospital:     { osm: "amenity=hospital",     label: "Hospital" },
  police:       { osm: "amenity=police",       label: "Police Station" },
  fire_station: { osm: "amenity=fire_station", label: "Fire Station" },
  pharmacy:     { osm: "amenity=pharmacy",     label: "Pharmacy" },
  clinic:       { osm: "amenity=clinic",       label: "Clinic" },
};

const RADIUS_M = 5000;
const CACHE_TTL_MIN = 15;
const RESULTS_PER_CATEGORY = 10;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const { lat, lon } = await req.json();

    if (typeof lat !== "number" || typeof lon !== "number") {
      return new Response(
        JSON.stringify({ error: "lat and lon (numbers) are required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ~1.1km grid cell at the equator, close enough for "nearby" caching —
    // this is what turns N tourists near the same spot into 1 Overpass hit
    // instead of N, which is the other half of fixing the rate-limit issue.
    const cacheKey = `${lat.toFixed(2)}:${lon.toFixed(2)}`;

    const { data: cached } = await supabase
      .from("nearby_cache")
      .select("payload, created_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (
      cached &&
      Date.now() - new Date(cached.created_at).getTime() < CACHE_TTL_MIN * 60 * 1000
    ) {
      return new Response(JSON.stringify(cached.payload), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const filters = Object.values(CATEGORIES)
      .map(
        (c) =>
          `node[${c.osm}](around:${RADIUS_M},${lat},${lon});` +
          `way[${c.osm}](around:${RADIUS_M},${lat},${lon});`
      )
      .join("\n");

    const overpassQuery = `[out:json][timeout:20];(${filters});out center 30;`;

    const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(overpassQuery),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (!overpassRes.ok) {
      throw new Error(`Overpass request failed: ${overpassRes.status}`);
    }

    const raw = await overpassRes.json();

    const grouped: Record<string, any[]> = {
      hospital: [],
      police: [],
      fire_station: [],
      pharmacy: [],
      clinic: [],
    };

    for (const el of raw.elements ?? []) {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      if (elLat == null || elLon == null) continue;

      const tags = el.tags ?? {};
      const category = Object.keys(CATEGORIES).find((k) => tags.amenity === k);
      if (!category) continue;

      grouped[category].push({
        id: `${el.type}/${el.id}`,
        name: tags.name || CATEGORIES[category].label,
        lat: elLat,
        lon: elLon,
        distance_m: Math.round(haversineMeters(lat, lon, elLat, elLon)),
        address:
          [tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"], tags["addr:city"]]
            .filter(Boolean)
            .join(", ") || null,
        phone: tags.phone || tags["contact:phone"] || null,
      });
    }

    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => a.distance_m - b.distance_m);
      grouped[key] = grouped[key].slice(0, RESULTS_PER_CATEGORY);
    }

    const payload = {
      origin: { lat, lon },
      generated_at: new Date().toISOString(),
      categories: grouped,
    };

    // Best-effort cache write, a failure here shouldn't fail the response.
    await supabase.from("nearby_cache").upsert({
      cache_key: cacheKey,
      payload,
      created_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify(payload), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
