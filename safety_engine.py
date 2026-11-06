"""
Multi-factor zone safety scoring (stdlib only, like server.py).

WHY THIS REPLACES THE OLD SCORE
  1. "Isolated" came from ONE OpenStreetMap query that pulled every building/road as full
     JSON ("out body") and treated a timeout or an Overpass "runtime error" (HTTP 200 with
     zero elements) as "nothing is nearby". In a dense area that query is the one most likely
     to time out, so a house surrounded by shops could be scored as isolated.
  2. OSM is also incomplete in many Indian towns, so a single sparse OSM answer is weak
     evidence. Isolation now needs sources to AGREE, and is never claimed from one failed or
     thin response.
  3. The old weighted average diluted real danger (a thunderstorm at weight 0.10 added 0.08).
     Factors are now combined with a noisy-OR, so several moderate factors reinforce each
     other and one severe factor cannot be averaged away.
  4. An unavailable source contributes NOTHING (it is not "risky" and not "safe") and lowers
     the reported confidence instead.

FACTORS (each returns score 0..1 or None = could not be checked):
  emergency_access   nearest police / hospital / fire station
  infrastructure     population / activity density -> isolation (OSM counts + Geoapify places)
  terrain            forest, wetland, water, protected area, track-only roads (OSM)
  weather            storm, heavy rain, gusts, fog, heat/cold, snow, 3 h look-ahead (Open-Meteo)
  air_quality        US AQI (Open-Meteo)
  network            device connectivity + this user's own recent signal gaps + known dead zones
  hazards            OSM hazards + active risk_zones (GDACS cyclone/flood/quake/fire) from Supabase
  community_reports  verified user/admin reports, weighted by severity and age
  incident_history   past SOS / deviation / geofence alerts within 2 km (180 days)
  time_of_day        night / deep night (only matters alongside other factors, see synergy)
  synergy            night + isolation, night + no coverage
"""
import json
import math
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from urllib import error as urlerror, parse, request

UA = "MargRakshak-TravelSafety/2.0"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
GEOAPIFY_API_KEY = os.environ.get("GEOAPIFY_API_KEY", "")
LOCAL_TZ_OFFSET_H = float(os.environ.get("LOCAL_TZ_OFFSET_H", "5.5"))          # IST; used only if Open-Meteo is down

OVERPASS_MIRRORS = [m for m in os.environ.get("OVERPASS_URLS", "").split(",") if m.strip()] or [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# Weight = the most a single factor can contribute to the noisy-OR when its score is 1.0.
WEIGHTS = {
    "hazards": 0.60,
    "weather": 0.45,
    "emergency_access": 0.35,
    "infrastructure": 0.35,
    "community_reports": 0.35,
    "incident_history": 0.25,
    "network": 0.22,
    "terrain": 0.15,
    "air_quality": 0.12,
    "time_of_day": 0.15,
    "synergy": 0.30,
}
LABELS = {
    "hazards": "Official / mapped hazard zone",
    "weather": "Weather conditions",
    "emergency_access": "Distance to emergency services",
    "infrastructure": "Isolation / infrastructure around you",
    "community_reports": "Reported unsafe area",
    "incident_history": "Past incidents in this area",
    "network": "Network and signal conditions",
    "terrain": "Terrain and surroundings",
    "air_quality": "Air quality",
    "time_of_day": "Time of day",
    "synergy": "Combined risk (night + isolation / no signal)",
}
SAFE_BELOW, UNSAFE_FROM = 0.25, 0.50


# --------------------------------------------------------------------------------- utilities
def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def _http_json(url, data=None, headers=None, timeout=10, method=None):
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    req = request.Request(url, data=data, headers=h, method=method)
    with request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


class TTLCache:
    """Small thread-safe cache. get_stale() lets a failed refresh fall back to the last good value."""

    def __init__(self, max_items=2000):
        self._d, self._lock, self._max = {}, threading.Lock(), max_items

    def get(self, key):
        with self._lock:
            hit = self._d.get(key)
            return hit[1] if hit and hit[0] > time.time() else None

    def get_stale(self, key, max_age_s):
        with self._lock:
            hit = self._d.get(key)
            return hit[1] if hit and hit[2] + max_age_s > time.time() else None

    def put(self, key, value, ttl_s):
        with self._lock:
            if len(self._d) >= self._max:
                for k in sorted(self._d, key=lambda k: self._d[k][0])[: self._max // 10]:
                    self._d.pop(k, None)
            self._d[key] = (time.time() + ttl_s, value, time.time())


_cache = TTLCache()


def cell(lat, lon, step=0.003):
    """~330 m grid cell: nearby requests share cached map data instead of hammering free APIs."""
    return f"{round(lat / step)}:{round(lon / step)}"


# --------------------------------------------------------------------------------- Overpass
class OverpassError(Exception):
    pass


def overpass(query, timeout=25):
    """Run a query against several mirrors. A 200 response carrying a 'remark' (runtime error / timeout)
    is a FAILURE, not an empty result: that was the root cause of false 'isolated' readings."""
    last = None
    for url in OVERPASS_MIRRORS:
        try:
            body = parse.urlencode({"data": query}).encode()
            data = _http_json(url, data=body, timeout=timeout,
                              headers={"Content-Type": "application/x-www-form-urlencoded"})
            remark = str(data.get("remark", "")).lower()
            if "error" in remark or "timed out" in remark or "out of memory" in remark:
                last = OverpassError(remark[:120])
                continue
            if "elements" not in data:
                last = OverpassError("no elements key")
                continue
            return data
        except (urlerror.URLError, urlerror.HTTPError, TimeoutError, ValueError, OSError) as e:
            last = e
    raise OverpassError(str(last))


def _counts(data):
    """Parse the sequence of 'count' elements produced by `out count;` blocks, in query order."""
    return [int((e.get("tags") or {}).get("total", 0)) for e in data["elements"] if e.get("type") == "count"]


# --------------------------------------------------------------------------------- factor results
def factor(key, score, evidence=None, available=True, confidence=1.0, note=None):
    return {"key": key, "label": LABELS[key], "score": None if score is None else round(score, 3),
            "weight": WEIGHTS[key], "available": bool(available and score is not None),
            "confidence": round(confidence, 2), "evidence": evidence or {}, "note": note}


# --------------------------------------------------------------------------------- 1. emergency access
def _emergency_from_geoapify(lat, lon):
    params = {"categories": "service.police,healthcare.hospital,service.fire_station",
              "filter": f"circle:{lon},{lat},25000", "bias": f"proximity:{lon},{lat}",
              "limit": "60", "apiKey": GEOAPIFY_API_KEY}
    res = _http_json(f"https://api.geoapify.com/v2/places?{parse.urlencode(params)}", timeout=15)
    out = {}
    for f in res.get("features", []):
        coords = (f.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        cats = (f.get("properties") or {}).get("categories") or []
        kind = ("police" if any("police" in c for c in cats) else
                "hospital" if any("hospital" in c for c in cats) else
                "fire" if any("fire_station" in c for c in cats) else None)
        if kind:
            d = haversine_km(lat, lon, coords[1], coords[0])
            out[kind] = min(out.get(kind, 1e9), d)
    return out


def _emergency_from_overpass(lat, lon):
    q = (f'[out:json][timeout:20];(nwr["amenity"~"^(hospital|police|fire_station)$"](around:25000,{lat},{lon}););'
         f'out center tags qt 120;')
    out = {}
    for e in overpass(q)["elements"]:
        c = e if "lat" in e else e.get("center") or {}
        if "lat" not in c:
            continue
        a = (e.get("tags") or {}).get("amenity")
        kind = {"police": "police", "hospital": "hospital", "fire_station": "fire"}.get(a)
        if kind:
            out[kind] = min(out.get(kind, 1e9), haversine_km(lat, lon, c["lat"], c["lon"]))
    return out


def _dist_score(d):
    return 0.0 if d < 2 else 0.15 if d < 5 else 0.35 if d < 10 else 0.6 if d < 20 else 0.9


def assess_emergency_access(lat, lon):
    key = "em:" + cell(lat, lon, 0.01)
    found = _cache.get(key)
    source = "cache"
    if found is None:
        found, source, err = None, None, None
        for name, fn, enabled in (("geoapify", _emergency_from_geoapify, bool(GEOAPIFY_API_KEY)),
                                  ("overpass", _emergency_from_overpass, True)):
            if not enabled:
                continue
            try:
                found, source = fn(lat, lon), name
                break
            except Exception as e:                                     # noqa: BLE001
                err = f"{name}: {type(e).__name__}"
        if found is None:
            stale = _cache.get_stale(key, 7 * 86400)
            if stale is None:
                return factor("emergency_access", None, available=False, note=err or "no provider"), {}
            found, source = stale, "stale-cache"
        else:
            _cache.put(key, found, 6 * 3600)
    police, hospital, fire = found.get("police"), found.get("hospital"), found.get("fire")
    # Police and hospitals matter most for a traveller; fire is secondary. Not "farthest of three".
    primary = [d for d in (police, hospital) if d is not None]
    if not primary and fire is None:
        score = 0.7                                                    # query worked, nothing within 25 km
    else:
        near = min(primary) if primary else fire
        far = max([d for d in (police, hospital, fire) if d is not None])
        score = 0.7 * _dist_score(near) + 0.3 * _dist_score(far)
    ev = {"police_km": _r(police), "hospital_km": _r(hospital), "fire_km": _r(fire), "source": source}
    return factor("emergency_access", score, ev), {"police": police, "hospital": hospital, "fire": fire}


def _r(v):
    return None if v is None else round(v, 2)


# --------------------------------------------------------------------------------- 2. infrastructure / isolation
def _osm_infrastructure(lat, lon):
    # `out count;` returns only totals, so a dense city costs a few bytes instead of thousands of
    # elements (the old "out body" of every building is what timed out).
    q = f"""[out:json][timeout:25];
way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street|service|trunk|motorway)$"](around:1500,{lat},{lon});out count;
nwr["building"](around:1000,{lat},{lon});out count;
nwr["shop"](around:1500,{lat},{lon});out count;
nwr["amenity"~"^(restaurant|cafe|fast_food|bank|atm|fuel|school|marketplace|pharmacy|clinic|hospital|police|place_of_worship|bus_station|college|post_office|bar|pub|cinema)$"](around:2000,{lat},{lon});out count;
nwr["place"~"^(village|town|city|suburb|neighbourhood|quarter|hamlet)$"](around:5000,{lat},{lon});out count;
way["landuse"~"^(residential|commercial|retail|industrial)$"](around:1500,{lat},{lon});out count;
"""
    c = _counts(overpass(q))
    if len(c) < 6:
        raise OverpassError("incomplete counts")
    return {"roads": c[0], "buildings": c[1], "shops": c[2], "amenities": c[3], "settlements": c[4], "built_landuse": c[5]}


def _osm_density(c):
    # Any strong signal means "people live/work here"; each is saturating so one huge number cannot dominate.
    parts = [c["roads"] / 25, c["buildings"] / 120, (c["shops"] + c["amenities"]) / 18,
             0.5 * min(1, c["settlements"]), c["built_landuse"] / 3]
    return clamp(max(parts))


def _geoapify_activity(lat, lon):
    params = {"categories": "commercial,catering,accommodation,service,healthcare,education,public_transport,religion",
              "filter": f"circle:{lon},{lat},2500", "limit": "100", "apiKey": GEOAPIFY_API_KEY}
    res = _http_json(f"https://api.geoapify.com/v2/places?{parse.urlencode(params)}", timeout=15)
    return len(res.get("features", []))


def assess_infrastructure(lat, lon, emergency):
    key = "infra:" + cell(lat, lon)
    cached = _cache.get(key)
    osm, geo, errors, source = None, None, [], "cache"
    if cached is not None:
        osm, geo = cached
    else:
        source = "live"
        try:
            osm = _osm_infrastructure(lat, lon)
        except Exception as e:                                         # noqa: BLE001
            errors.append(f"osm: {type(e).__name__}")
        if GEOAPIFY_API_KEY:
            try:
                geo = _geoapify_activity(lat, lon)
            except Exception as e:                                     # noqa: BLE001
                errors.append(f"geoapify: {type(e).__name__}")
        if osm is None and geo is None:
            stale = _cache.get_stale(key, 14 * 86400)
            if stale is not None:
                osm, geo, source = stale[0], stale[1], "stale-cache"
        elif not errors:
            _cache.put(key, (osm, geo), 12 * 3600)                     # only cache complete answers
    if osm is None and geo is None:
        return factor("infrastructure", None, {"errors": errors}, available=False,
                      note="Map data unavailable; isolation is unknown, not assumed."), None

    dens = []
    if osm is not None:
        dens.append(_osm_density(osm))
    if geo is not None:
        dens.append(clamp(geo / 40))
    density = max(dens)                                                # either source showing activity = populated
    near_services = [d for d in (emergency or {}).values() if d is not None]
    served = bool(near_services) and min(near_services) <= 3.0

    both = len(dens) == 2
    if density >= 0.55:
        score, claim = 0.0, "populated"
    elif density >= 0.25:
        score, claim = 0.2, "semi-populated"
    elif both:
        score, claim = 0.75, "isolated"                                # both sources agree it is sparse
    else:
        score, claim = 0.35, "possibly isolated (single source, unverified)"
    if served:
        score = min(score, 0.15)                                       # a police station / hospital within 3 km
    confidence = (0.9 if both else 0.55) * (0.7 if source == "stale-cache" else 1.0)
    ev = {"osm": osm, "geoapify_places_2_5km": geo, "density_index": round(density, 2), "assessment": claim,
          "source": source, "errors": errors or None}
    return factor("infrastructure", score, ev, confidence=confidence), {"density": density, "claim": claim, "score": score}


# --------------------------------------------------------------------------------- 3. terrain
def assess_terrain(lat, lon):
    key = "terrain:" + cell(lat, lon)
    c = _cache.get(key)
    if c is None:
        q = f"""[out:json][timeout:20];
nwr["natural"~"^(wood|scrub|wetland|water|cliff|cave_entrance)$"](around:300,{lat},{lon});out count;
nwr["landuse"="forest"](around:300,{lat},{lon});out count;
nwr["boundary"="protected_area"](around:300,{lat},{lon});out count;
way["highway"~"^(track|path|footway)$"](around:300,{lat},{lon});out count;
way["highway"~"^(motorway|trunk)$"](around:150,{lat},{lon});out count;
"""
        try:
            n = _counts(overpass(q))
            if len(n) < 5:
                raise OverpassError("incomplete")
            c = {"natural": n[0], "forest": n[1], "protected": n[2], "tracks": n[3], "fast_road": n[4]}
            _cache.put(key, c, 24 * 3600)
        except Exception as e:                                         # noqa: BLE001
            return factor("terrain", None, available=False, note=f"{type(e).__name__}")
    score = 0.0
    if c["forest"] or c["protected"]:
        score = max(score, 0.45)
    if c["natural"]:
        score = max(score, 0.3)
    if c["tracks"] and not (c["forest"] or c["protected"]):
        score = max(score, 0.2)
    if c["fast_road"]:
        score = max(score, 0.25)                                       # highways: breakdowns / high-speed traffic
    return factor("terrain", score, c, confidence=0.6)


# --------------------------------------------------------------------------------- 4. weather + air quality
WEATHER_SEVERE = {95, 96, 99}
WEATHER_HEAVY = {65, 67, 75, 77, 82, 86}
WEATHER_FREEZING = {56, 57, 66, 67, 71, 73, 75, 77, 85, 86}
WEATHER_FOG = {45, 48}


def assess_weather(lat, lon):
    key = "wx:" + cell(lat, lon, 0.05)
    data = _cache.get(key)
    if data is None:
        params = parse.urlencode({
            "latitude": lat, "longitude": lon, "timezone": "auto", "forecast_hours": 4,
            "current": "weather_code,precipitation,wind_speed_10m,wind_gusts_10m,temperature_2m,"
                       "apparent_temperature,visibility,is_day",
            "hourly": "weather_code,precipitation_probability,precipitation,wind_gusts_10m,visibility"})
        try:
            data = _http_json(f"https://api.open-meteo.com/v1/forecast?{params}", timeout=8)
            _cache.put(key, data, 600)
        except Exception as e:                                         # noqa: BLE001
            return factor("weather", None, available=False, note=f"{type(e).__name__}"), None
    cur = data.get("current") or {}
    code = int(cur.get("weather_code") or 0)
    rain = float(cur.get("precipitation") or 0)
    wind = float(cur.get("wind_speed_10m") or 0)
    gust = float(cur.get("wind_gusts_10m") or 0)
    temp = cur.get("temperature_2m")
    feels = cur.get("apparent_temperature")
    vis = cur.get("visibility")
    reasons, score = [], 0.0

    def add(s, why):
        nonlocal score
        score = max(score, s)
        reasons.append(why)

    if code in WEATHER_SEVERE:
        add(0.85, "thunderstorm")
    if rain >= 12 or code in WEATHER_HEAVY and rain >= 4:
        add(0.8, f"heavy rain ({rain} mm/h)")
    elif rain >= 4 or code in (63, 80, 81):
        add(0.45, f"moderate rain ({rain} mm/h)")
    elif code in (51, 53, 55, 61):
        add(0.15, "light rain or drizzle")
    if gust >= 75 or wind >= 55:
        add(0.85, f"damaging wind (gusts {gust:.0f} km/h)")
    elif gust >= 50 or wind >= 35:
        add(0.45, f"strong wind (gusts {gust:.0f} km/h)")
    if vis is not None and vis < 200 or code in WEATHER_FOG and (vis is None or vis < 500):
        add(0.7, "dense fog / very low visibility")
    elif vis is not None and vis < 1000:
        add(0.4, f"poor visibility ({int(vis)} m)")
    if feels is not None and feels >= 41:
        add(0.65, f"extreme heat (feels like {feels:.0f}°C)")
    elif feels is not None and feels >= 36:
        add(0.3, f"hot (feels like {feels:.0f}°C)")
    if temp is not None and temp <= 0:
        add(0.55, f"freezing ({temp:.0f}°C)")
    elif temp is not None and temp <= 5:
        add(0.3, f"very cold ({temp:.0f}°C)")
    if code in WEATHER_FREEZING:
        add(0.55, "snow / freezing precipitation")

    # Look-ahead: a storm arriving within ~3 h matters for someone who is out in the open.
    hourly = data.get("hourly") or {}
    ahead_codes = (hourly.get("weather_code") or [])[1:4]
    ahead_gust = max([g or 0 for g in (hourly.get("wind_gusts_10m") or [])[1:4]] or [0])
    if any(c in WEATHER_SEVERE for c in ahead_codes) and code not in WEATHER_SEVERE:
        add(0.4, "thunderstorm expected within 3 hours")
    if ahead_gust >= 75 and gust < 75:
        add(0.4, "damaging wind expected within 3 hours")

    ev = {"weather_code": code, "precipitation_mm": rain, "wind_kmh": wind, "gust_kmh": gust,
          "temperature_c": temp, "feels_like_c": feels, "visibility_m": vis, "reasons": reasons}
    return factor("weather", score, ev, confidence=0.85), {"is_day": cur.get("is_day"), "local_time": cur.get("time")}


def assess_air_quality(lat, lon):
    key = "aq:" + cell(lat, lon, 0.1)
    data = _cache.get(key)
    if data is None:
        try:
            q = parse.urlencode({"latitude": lat, "longitude": lon, "current": "us_aqi,pm2_5"})
            data = _http_json(f"https://air-quality-api.open-meteo.com/v1/air-quality?{q}", timeout=6)
            _cache.put(key, data, 1800)
        except Exception as e:                                         # noqa: BLE001
            return factor("air_quality", None, available=False, note=f"{type(e).__name__}")
    aqi = (data.get("current") or {}).get("us_aqi")
    if aqi is None:
        return factor("air_quality", None, available=False)
    score = 0.0 if aqi < 100 else 0.2 if aqi < 150 else 0.4 if aqi < 200 else 0.6 if aqi < 300 else 0.8
    return factor("air_quality", score, {"us_aqi": aqi}, confidence=0.7)


# --------------------------------------------------------------------------------- 5. time of day
def assess_time(wx_meta):
    """Uses the weather API's own local time/is_day; falls back to a fixed UTC offset."""
    local = None
    if wx_meta and wx_meta.get("local_time"):
        try:
            local = datetime.fromisoformat(wx_meta["local_time"])
        except ValueError:
            local = None
    if local is None:
        local = datetime.now(timezone.utc) + timedelta(hours=LOCAL_TZ_OFFSET_H)
    hour = local.hour + local.minute / 60
    is_day = wx_meta.get("is_day") if wx_meta else None
    if is_day == 1 and 6 <= hour < 18.5:
        period, score = "day", 0.0
    elif 23 <= hour or hour < 4.5:
        period, score = "deep_night", 0.4
    elif is_day == 0 or hour >= 19 or hour < 6:
        period, score = "night", 0.25
    else:
        period, score = "dusk_or_dawn", 0.1
    return factor("time_of_day", score, {"period": period, "local_hour": round(hour, 1)}, confidence=0.9), period


# --------------------------------------------------------------------------------- Supabase helpers
def _sb(path, params, timeout=10):
    if not (SUPABASE_URL and SUPABASE_SERVICE_KEY):
        raise RuntimeError("supabase not configured")
    url = f"{SUPABASE_URL}/rest/v1/{path}?{parse.urlencode(params, doseq=True)}"
    return _http_json(url, headers={"apikey": SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
                      timeout=timeout)


def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _bbox(lat, lon, km):
    dlat = km / 111.0
    dlon = km / (111.0 * max(0.2, math.cos(math.radians(lat))))
    return lat - dlat, lat + dlat, lon - dlon, lon + dlon


# --------------------------------------------------------------------------------- 6. network
def assess_network(lat, lon, network, user_id, travel_card_id):
    score, ev, conf = 0.0, {}, 0.0
    reasons = []

    def add(s, why):
        nonlocal score
        score = max(score, s)
        reasons.append(why)

    if isinstance(network, dict):
        conn, reach, ntype = network.get("is_connected"), network.get("is_internet_reachable"), network.get("type")
        gen = (network.get("cellular_generation") or "").lower()
        ev.update({"connected": conn, "reachable": reach, "type": ntype, "generation": gen or None})
        if conn is False or ntype in ("none", "unknown") and conn is not True:
            add(0.65, "device has no network connection")
            conf = 0.8
        elif reach is False:
            add(0.5, "connected but internet is not reachable")
            conf = 0.8
        elif conn is True:
            conf = 0.8
            if gen in ("2g",):
                add(0.35, "only 2G cellular available")
            elif gen == "3g":
                add(0.15, "slow 3G cellular")
        if network.get("signal_strength") is not None:
            ev["signal_strength"] = network["signal_strength"]
            if network["signal_strength"] <= 1:
                add(0.3, "very weak signal")

    # The user's own recent behaviour: fixes arriving late or with gaps mean they were out of coverage.
    if user_id:
        try:
            since = _iso(datetime.now(timezone.utc) - timedelta(minutes=30))
            params = {"user_id": f"eq.{user_id}", "recorded_at": f"gte.{since}", "order": "recorded_at.asc",
                      "select": "recorded_at,received_at", "limit": 600}
            if travel_card_id:
                params["travel_card_id"] = f"eq.{travel_card_id}"
            rows = _sb("locations", params)
            ts = [datetime.fromisoformat(r["recorded_at"].replace("Z", "+00:00")) for r in rows if r.get("recorded_at")]
            gaps = [(b - a).total_seconds() for a, b in zip(ts, ts[1:])]
            long_gaps = [g for g in gaps if g >= 120]
            lags = []
            for r in rows:
                if r.get("received_at") and r.get("recorded_at"):
                    lag = (datetime.fromisoformat(r["received_at"].replace("Z", "+00:00"))
                           - datetime.fromisoformat(r["recorded_at"].replace("Z", "+00:00"))).total_seconds()
                    lags.append(lag)
            late = sum(1 for l in lags if l > 90)
            ev.update({"recent_fixes_30m": len(rows), "signal_gaps_30m": len(long_gaps),
                       "longest_gap_s": int(max(gaps)) if gaps else 0, "late_uploads_30m": late})
            if len(long_gaps) >= 3 or (gaps and max(gaps) >= 600):
                add(0.45, f"{len(long_gaps)} signal gap(s) in the last 30 min")
            elif len(long_gaps) >= 1 or late >= 5:
                add(0.25, "intermittent signal in the last 30 min")
            conf = max(conf, 0.7 if len(rows) >= 10 else 0.4)
        except Exception as e:                                         # noqa: BLE001
            ev["history_error"] = type(e).__name__

    # Area history: dropout alerts from ANY traveller near here in the last 90 days = a known dead zone.
    try:
        s, n, w, e_ = _bbox(lat, lon, 3.0)
        since = _iso(datetime.now(timezone.utc) - timedelta(days=90))
        rows = _sb("alerts", [("type", "eq.dropout"), ("created_at", f"gte.{since}"), ("lat", f"gte.{s}"),
                              ("lat", f"lte.{n}"), ("lon", f"gte.{w}"), ("lon", f"lte.{e_}"),
                              ("select", "user_id,travel_card_id"), ("limit", 200)])
        trips = {r.get("travel_card_id") or r.get("user_id") for r in rows}
        ev["dropout_alerts_90d_3km"], ev["distinct_trips_with_dropout"] = len(rows), len(trips)
        if len(trips) >= 3:
            add(0.45, f"signal drops reported by {len(trips)} different trips within 3 km")
        elif len(trips) == 2:
            add(0.25, "signal drops reported by 2 trips within 3 km")
        conf = max(conf, 0.6)
    except Exception as e:                                             # noqa: BLE001
        ev["coverage_history_error"] = type(e).__name__

    if conf == 0:
        return factor("network", None, ev, available=False, note="no connectivity evidence")
    ev["reasons"] = reasons
    return factor("network", score, ev, confidence=conf)


# --------------------------------------------------------------------------------- 7. hazards
def _point_in_ring(lon, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi, xj, yj = ring[i][0], ring[i][1], ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _in_geometry(lat, lon, geom, buffer_m):
    """True if the point is inside (or within buffer_m of) a GeoJSON Point / Polygon / MultiPolygon."""
    if not isinstance(geom, dict):
        return False
    t, c = geom.get("type"), geom.get("coordinates")
    if t == "Point" and c:
        return haversine_km(lat, lon, c[1], c[0]) * 1000 <= (buffer_m or 5000)
    polys = [c] if t == "Polygon" else c if t == "MultiPolygon" else []
    for poly in polys:
        if poly and _point_in_ring(lon, lat, poly[0]) and not any(_point_in_ring(lon, lat, h) for h in poly[1:]):
            return True
        if buffer_m and poly:
            ring = poly[0]
            step = max(1, len(ring) // 200)
            if any(haversine_km(lat, lon, p[1], p[0]) * 1000 <= buffer_m for p in ring[::step]):
                return True
    return False


SEV = {"low": 0.25, "medium": 0.5, "warning": 0.5, "high": 0.75, "critical": 0.95, "info": 0.15}


def assess_hazards(lat, lon):
    zones, score, errors = [], 0.0, []
    # (a) active risk_zones (GDACS and curated). Same table the geofence service maintains.
    try:
        s, n, w, e_ = _bbox(lat, lon, 1.0)
        now = _iso(datetime.now(timezone.utc))
        rows = _sb("risk_zones", [("status", "eq.active"), ("min_lat", f"lte.{n}"), ("max_lat", f"gte.{s}"),
                                  ("min_lon", f"lte.{e_}"), ("max_lon", f"gte.{w}"),
                                  ("or", f"(expires_at.is.null,expires_at.gt.{now})"), ("select", "*"), ("limit", 50)])
        for z in rows:
            valid_from = (z.get("attributes") or {}).get("valid_from")
            if valid_from and valid_from > now:
                continue
            if _in_geometry(lat, lon, z.get("geometry"), z.get("radius_m")):
                conf = float(z.get("confidence") if z.get("confidence") is not None else 0.6)
                s_ = SEV.get(z.get("severity"), 0.5) * (0.6 + 0.4 * conf)
                score = max(score, s_)
                zones.append({"type": "hazard_zone", "name": z.get("name"), "hazard": z.get("hazard_type"),
                              "severity": z.get("severity"), "source": z.get("source"), "confidence": conf})
    except Exception as e:                                             # noqa: BLE001
        errors.append(f"risk_zones: {type(e).__name__}")
    # (b) OSM-tagged hazards, cheap and cached.
    key = "hz:" + cell(lat, lon)
    osm = _cache.get(key)
    if osm is None:
        q = f"""[out:json][timeout:20];
node["hazard"](around:500,{lat},{lon});out tags 20;
way["landuse"="military"](around:500,{lat},{lon});out tags 5;
way["flood_prone"="yes"](around:500,{lat},{lon});out tags 5;
node["geological_hazard"="landslide"](around:1000,{lat},{lon});out tags 5;
"""
        try:
            osm = [{"tags": e.get("tags", {})} for e in overpass(q)["elements"] if e.get("type") != "count"]
            _cache.put(key, osm, 24 * 3600)
        except Exception as e:                                         # noqa: BLE001
            errors.append(f"osm: {type(e).__name__}")
            osm = []
    for el in osm:
        t = el["tags"]
        kind = ("flood_zone" if t.get("flood_prone") == "yes" else "restricted_area" if t.get("landuse") == "military"
                else "landslide_zone" if t.get("geological_hazard") == "landslide" else "hazard_zone" if "hazard" in t else None)
        if kind:
            score = max(score, 0.45 if kind != "restricted_area" else 0.35)
            zones.append({"type": kind, "name": t.get("name"), "source": "OpenStreetMap"})
    available = not (len(errors) == 2)
    return factor("hazards", score if available else None, {"zones": zones[:10], "errors": errors or None},
                  available=available, confidence=0.8), zones


# --------------------------------------------------------------------------------- 8/9. community reports + history
def assess_reports(lat, lon):
    try:
        rows = _sb("unsafe_zones", {"status": "eq.verified", "select": "*", "limit": 500})
    except Exception as e:                                             # noqa: BLE001
        return factor("community_reports", None, available=False, note=type(e).__name__), []
    now = datetime.now(timezone.utc)
    nearby, p_none = [], 1.0
    for z in rows:
        if z.get("lat") is None or z.get("lon") is None:
            continue
        if z.get("expires_at") and datetime.fromisoformat(z["expires_at"].replace("Z", "+00:00")) < now:
            continue
        d = haversine_km(lat, lon, z["lat"], z["lon"])
        radius_km = (z.get("radius_m") or 500) / 1000
        if d > radius_km + 0.5:
            continue
        age_days = 0
        if z.get("created_at"):
            age_days = (now - datetime.fromisoformat(z["created_at"].replace("Z", "+00:00"))).days
        recency = 1.0 if age_days <= 30 else 0.7 if age_days <= 120 else 0.45
        sev = SEV.get(z.get("severity"), 0.5)
        p_none *= 1 - 0.8 * sev * recency                              # several reports reinforce (noisy-OR)
        nearby.append({"category": z.get("category"), "severity": z.get("severity"), "description": z.get("description"),
                       "distance_km": round(d, 2), "lat": z["lat"], "lon": z["lon"], "radius_m": z.get("radius_m", 500),
                       "age_days": age_days})
    return factor("community_reports", 1 - p_none, {"count": len(nearby)}, confidence=0.7), nearby


def assess_history(lat, lon):
    try:
        s, n, w, e_ = _bbox(lat, lon, 2.0)
        since = _iso(datetime.now(timezone.utc) - timedelta(days=180))
        rows = _sb("alerts", [("type", "in.(panic,deviation,geofence_entry)"), ("created_at", f"gte.{since}"),
                              ("lat", f"gte.{s}"), ("lat", f"lte.{n}"), ("lon", f"gte.{w}"), ("lon", f"lte.{e_}"),
                              ("select", "type,created_at,user_id"), ("limit", 300)])
    except Exception as e:                                             # noqa: BLE001
        return factor("incident_history", None, available=False, note=type(e).__name__)
    days = {r["created_at"][:10] for r in rows}
    panics = sum(1 for r in rows if r["type"] == "panic")
    n_ = len(days)
    score = 0.0 if n_ == 0 else 0.2 if n_ == 1 else 0.4 if n_ <= 3 else 0.6
    if panics >= 2:
        score = max(score, 0.55)
    return factor("incident_history", score, {"alerts_180d_2km": len(rows), "distinct_days": n_, "sos": panics},
                  confidence=0.6)


# --------------------------------------------------------------------------------- combine
def combine(factors, period, infra_meta, network_factor):
    by = {f["key"]: f for f in factors}
    # Synergy: being alone and unreachable at night is worse than the parts.
    syn, syn_reasons = 0.0, []
    night = period in ("night", "deep_night")
    iso = (by.get("infrastructure") or {}).get("score")
    net = (by.get("network") or {}).get("score")

    def bump(level, why):
        nonlocal syn
        syn = max(syn, level)
        syn_reasons.append(why)

    if night and iso is not None and iso >= 0.6:
        bump(0.8, "isolated area after dark")
    if night and net is not None and net >= 0.45:
        bump(0.6, "poor signal after dark")
    if net is not None and net >= 0.45 and iso is not None and iso >= 0.6:
        bump(0.8, "isolated area with poor signal")
    factors.append(factor("synergy", syn if (syn or iso is not None) else None, {"reasons": syn_reasons}))

    p_safe, used_w, total_w = 1.0, 0.0, 0.0
    for f in factors:
        total_w += f["weight"]
        if f["available"]:
            used_w += f["weight"]
            contrib = f["weight"] * f["score"] * (0.5 + 0.5 * f["confidence"])   # low-confidence evidence counts for less
            f["contribution"] = round(contrib, 3)
            p_safe *= 1 - contrib
        else:
            f["contribution"] = 0.0
    risk = 1 - p_safe
    coverage = used_w / total_w if total_w else 0
    quality = "good" if coverage >= 0.75 else "partial" if coverage >= 0.5 else "poor"
    return clamp(risk), round(coverage, 2), quality


def status_for(risk):
    return "safe" if risk < SAFE_BELOW else "caution" if risk < UNSAFE_FROM else "unsafe"


def _factor_to_risk_entries(f, extra):
    """Dashboard/mobile 'risk_factors' list (type, label, severity, optional distance)."""
    s = f["score"]
    if not f["available"] or s is None:
        return []
    sev = "high" if s >= 0.65 else "medium" if s >= 0.3 else None
    if sev is None:
        return []
    ev, k = f["evidence"], f["key"]
    if k == "emergency_access":
        far = max([d for d in (ev.get("police_km"), ev.get("hospital_km"), ev.get("fire_km")) if d is not None], default=None)
        return [{"type": "emergency_distance", "label": "Far from emergency services", "severity": sev, "distance_km": far}]
    if k == "infrastructure":
        return [{"type": "isolation", "label": f"Isolated area ({ev.get('assessment')})", "severity": sev}]
    if k == "weather":
        return [{"type": "weather", "label": "Weather: " + ", ".join(ev.get("reasons") or ["adverse conditions"]), "severity": sev}]
    if k == "network":
        return [{"type": "connectivity", "label": "Network: " + "; ".join(ev.get("reasons") or ["unreliable signal"]), "severity": sev}]
    if k == "hazards":
        out = [{"type": z["type"], "label": (z.get("name") or z["type"].replace("_", " ").title()), "severity": "high"}
               for z in extra.get("hazard_zones", [])[:5]]
        return out or [{"type": "hazard_zone", "label": "Hazard zone", "severity": sev}]
    if k == "community_reports":
        return [{"type": "unsafe_zone", "label": f"{ev.get('count', 0)} reported incident(s) nearby", "severity": sev}]
    if k == "incident_history":
        return [{"type": "incident_history", "label": f"{ev.get('distinct_days', 0)} past incident day(s) within 2 km", "severity": sev}]
    if k == "terrain":
        return [{"type": "terrain", "label": "Remote terrain (forest / water / protected area / highway)", "severity": sev}]
    if k == "air_quality":
        return [{"type": "air_quality", "label": f"Poor air quality (AQI {ev.get('us_aqi')})", "severity": sev}]
    if k == "time_of_day":
        return [{"type": "night", "label": "Night-time travel", "severity": "medium"}] if s >= 0.25 else []
    if k == "synergy":
        return [{"type": "combined", "label": ", ".join(ev.get("reasons") or []).capitalize(), "severity": "high"}] if ev.get("reasons") else []
    return []


# --------------------------------------------------------------------------------- heading warning
def heading_warning(lat, lon, speed, prev_locations, current_infra_score):
    """If moving, look ~10 min ahead along the current heading and compare the cheap cached factors."""
    pts = [p for p in (prev_locations or []) if p.get("lat") is not None]
    if len(pts) < 3 or not speed or speed < 2.0:
        return None
    a, b = pts[-3], pts[-1]
    coslat = max(0.2, math.cos(math.radians(lat)))
    north_m = (b["lat"] - a["lat"]) * 111000.0
    east_m = (b["lon"] - a["lon"]) * 111000.0 * coslat
    norm = math.hypot(north_m, east_m)
    if norm < 1.0:
        return None
    dist_m = min(15000.0, speed * 600.0)                               # 10 minutes at the current speed
    f_lat = lat + (north_m / norm) * dist_m / 111000.0
    f_lon = lon + (east_m / norm) * dist_m / (111000.0 * coslat)
    try:
        hz, zones = assess_hazards(f_lat, f_lon)
        if hz["available"] and hz["score"] and hz["score"] >= 0.45:
            return f"Heading toward a mapped hazard area in about 10 minutes ({(zones[0].get('name') or zones[0]['type']).replace('_', ' ')})."
        infra, meta = assess_infrastructure(f_lat, f_lon, None)
        if meta and infra["available"] and infra["score"] - (current_infra_score or 0) >= 0.5 and meta["claim"] == "isolated":
            return "You are heading toward a sparsely populated stretch with few services. Plan fuel, water and signal."
    except Exception:                                                  # noqa: BLE001
        pass
    return None


# --------------------------------------------------------------------------------- orchestration
_last = {}                                                             # user_id -> (risk, lat, lon, time) for smoothing
_last_lock = threading.Lock()


def compute_assessment(lat, lon, user_id, travel_card_id, prev_locations=None, network=None, speed=None):
    emergency_f, emergency = assess_emergency_access(lat, lon)
    infra_f, infra_meta = assess_infrastructure(lat, lon, emergency)
    terrain_f = assess_terrain(lat, lon)
    weather_f, wx_meta = assess_weather(lat, lon)
    aq_f = assess_air_quality(lat, lon)
    time_f, period = assess_time(wx_meta)
    net_f = assess_network(lat, lon, network, user_id, travel_card_id)
    hazard_f, hazard_zones = assess_hazards(lat, lon)
    reports_f, unsafe = assess_reports(lat, lon)
    history_f = assess_history(lat, lon)

    factors = [hazard_f, weather_f, emergency_f, infra_f, reports_f, history_f, net_f, terrain_f, aq_f, time_f]
    risk, coverage, quality = combine(factors, period, infra_meta, net_f)

    # Smoothing: free APIs flicker. Escalation is immediate; relaxation is gradual (blend with the previous
    # reading while the user has not moved far). A transient API failure can therefore never hide a risk.
    with _last_lock:
        prev = _last.get(user_id)
        if (prev and risk < prev[0] and time.time() - prev[3] < 900
                and haversine_km(lat, lon, prev[1], prev[2]) < 0.5):
            risk = 0.65 * risk + 0.35 * prev[0]
        _last[user_id] = (risk, lat, lon, time.time())

    status = status_for(risk)
    extra = {"hazard_zones": hazard_zones}
    risk_factors = []
    for f in sorted(factors, key=lambda f: -(f.get("contribution") or 0)):
        risk_factors += _factor_to_risk_entries(f, extra)

    infra_score = infra_f["score"] if infra_f["available"] else None
    police, hospital, fire = emergency.get("police"), emergency.get("hospital"), emergency.get("fire")
    weather_ev = weather_f["evidence"] if weather_f["available"] else {"available": False}
    network_ev = net_f["evidence"] if net_f["available"] else {"available": False}
    return {
        "user_id": user_id, "travel_card_id": travel_card_id, "lat": lat, "lon": lon,
        "safety_status": status, "risk_score": round(risk, 3), "risk_factors": risk_factors,
        "nearest_police_km": _r(police), "nearest_hospital_km": _r(hospital), "nearest_fire_km": _r(fire),
        "isolation_score": None if infra_score is None else round(infra_score, 3),
        "infrastructure_evidence": infra_f["evidence"] if infra_f["available"] else {"available": False, **infra_f["evidence"]},
        "weather": weather_ev, "network": network_ev, "time_context": time_f["evidence"],
        "hazard_zones": hazard_zones, "matched_unsafe_zones": unsafe,
        "heading_warning": heading_warning(lat, lon, speed, prev_locations, infra_score),
        "score_breakdown": factors,
        "confidence": coverage, "data_quality": quality,
        "assessed_at": datetime.now(timezone.utc).isoformat(),
    }


# Columns that exist in the ORIGINAL safety_assessments table. If the new columns have not been migrated yet
# the write is retried with just these, so a missing migration degrades gracefully instead of silently
# leaving the dashboard on an old row (the bug that kept showing a stale "isolated").
LEGACY_COLUMNS = ("user_id", "travel_card_id", "lat", "lon", "safety_status", "risk_score", "risk_factors",
                  "nearest_police_km", "nearest_hospital_km", "nearest_fire_km", "isolation_score",
                  "hazard_zones", "matched_unsafe_zones", "heading_warning", "assessed_at")


def write_assessment(assessment):
    """Returns (ok, detail). Upsert by user_id; never raises."""
    if not (SUPABASE_URL and SUPABASE_SERVICE_KEY):
        return False, "supabase not configured"
    url = f"{SUPABASE_URL}/rest/v1/safety_assessments?on_conflict=user_id"
    hdr = {"apikey": SUPABASE_SERVICE_KEY, "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
           "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"}

    def post(payload):
        req = request.Request(url, data=json.dumps(payload).encode(), method="POST", headers=hdr)
        with request.urlopen(req, timeout=10) as r:
            r.read()

    try:
        post(assessment)
        return True, "full"
    except urlerror.HTTPError as e:
        body = e.read().decode(errors="replace")
        if e.code in (400, 404) and ("PGRST204" in body or "column" in body.lower()):
            print("WARNING: safety_assessments is missing new columns; run 20261101_safety_assessment_v2.sql. "
                  f"Writing legacy columns only. ({body[:160]})")
            try:
                post({k: assessment[k] for k in LEGACY_COLUMNS if k in assessment})
                return True, "legacy-columns-only (run the migration)"
            except Exception as e2:                                    # noqa: BLE001
                return False, f"legacy write failed: {e2}"
        return False, f"HTTP {e.code}: {body[:200]}"
    except Exception as e:                                             # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"
