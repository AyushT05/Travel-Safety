from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json, time, os, math
from urllib import request, parse
from datetime import datetime, timezone

PORT = int(os.environ.get("PORT", 8000))  # Render injects PORT
locations = {}  # name -> {lat, lon, accuracy, timestamp}

# Supabase config from environment
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
GEOAPIFY_API_KEY = os.environ.get("GEOAPIFY_API_KEY", "")

# ============================================================================
# Safety assessment: see safety_engine.py (multi-factor, multi-source, explainable)
# ============================================================================
import safety_engine


def haversine_distance(lat1, lon1, lat2, lon2):
    """Kilometres. Kept here for the route-planning fallback below."""
    return safety_engine.haversine_km(lat1, lon1, lat2, lon2)


# ============================================================================
# HTTP Handler
# ============================================================================

class Handler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/locations"):
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(locations).encode())
        elif self.path in ("/", ""):
            # Health check — Render pings this to confirm app is up
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Live Tracker OK")
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/update-location":
            length = int(self.headers["Content-Length"])
            body = json.loads(self.rfile.read(length))
            name = body.get("name", "Unknown").strip() or "Unknown"
            locations[name] = {
                "lat": body["lat"],
                "lon": body["lon"],
                "accuracy": body["accuracy"],
                "timestamp": time.time()
            }
            print(f"[{name}] Lat: {body['lat']:.6f}, Lon: {body['lon']:.6f}, Acc: {body['accuracy']:.1f}m")
            self.send_response(200)
            self._cors()
            self.end_headers()
            self.wfile.write(b"OK")
        elif self.path == "/api/nearby-services":
            # Proxy for Overpass API to avoid CORS issues
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}

            lat = body.get("lat")
            lon = body.get("lon")
            radius = body.get("radius", 5000)

            if lat is None or lon is None:
                self.send_response(400)
                self._cors()
                self.end_headers()
                self.wfile.write(b'{"error": "lat and lon required"}')
                return

            # Build Overpass query
            categories = [
                "amenity=hospital",
                "amenity=police",
                "amenity=fire_station",
                "amenity=pharmacy",
                "amenity=clinic"
            ]
            filters = "\n".join([f'node[{tag}](around:{radius},{lat},{lon});' for tag in categories])
            query = f'[out:json][timeout:25];({filters});out body;'

            try:
                req = request.Request(
                    "https://overpass-api.de/api/interpreter",
                    data=f"data={parse.quote(query)}".encode(),
                    headers={"User-Agent": "MargRakshak-TravelSafety/1.0"}
                )
                with request.urlopen(req, timeout=30) as response:
                    data = response.read()
                    self.send_response(200)
                    self._cors()
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as e:
                print(f"Overpass error: {e}")
                self.send_response(500)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        elif self.path == "/api/plan-route":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            waypoints = body.get("waypoints", [])

            valid_wps = []
            for wp in waypoints:
                if wp.get("lat") is not None and wp.get("lon") is not None:
                    valid_wps.append((float(wp["lat"]), float(wp["lon"])))

            if len(valid_wps) < 2:
                self.send_response(400)
                self._cors()
                self.end_headers()
                self.wfile.write(b'{"error": "At least 2 valid waypoints required"}')
                return

            try:
                coords_str = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in valid_wps)
                osrm_url = f"https://router.project-osrm.org/route/v1/driving/{coords_str}?overview=full&geometries=geojson&steps=true"
                req = request.Request(osrm_url, headers={"User-Agent": "MargRakshak-TravelSafety/1.0"})
                with request.urlopen(req, timeout=10) as resp:
                    osrm_data = json.loads(resp.read().decode())
                
                if osrm_data.get("code") == "Ok" and osrm_data.get("routes"):
                    r0 = osrm_data["routes"][0]
                    coords = r0.get("geometry", {}).get("coordinates", [])
                    polyline = [[c[1], c[0]] for c in coords] # to [lat, lon]
                    res = {
                        "success": True,
                        "source": "osrm",
                        "total_distance_km": round(r0.get("distance", 0.0) / 1000.0, 2),
                        "total_duration_hours": round(r0.get("duration", 0.0) / 3600.0, 2),
                        "polyline": polyline,
                        "legs": r0.get("legs", []),
                    }
                else:
                    raise ValueError("OSRM did not return Ok")
            except Exception as e:
                # Fallback: simple interpolation
                polyline = []
                total_km = 0.0
                for i in range(len(valid_wps) - 1):
                    p1, p2 = valid_wps[i], valid_wps[i + 1]
                    total_km += haversine_distance(p1[0], p1[1], p2[0], p2[1])
                    for f in [0.0, 0.25, 0.5, 0.75]:
                        polyline.append([p1[0] + (p2[0] - p1[0]) * f, p1[1] + (p2[1] - p1[1]) * f])
                polyline.append([valid_wps[-1][0], valid_wps[-1][1]])
                res = {
                    "success": True,
                    "source": "interpolated_fallback",
                    "total_distance_km": round(total_km, 2),
                    "total_duration_hours": round(total_km / 50.0, 2),
                    "polyline": polyline,
                    "legs": [],
                }

            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode())

        elif self.path == "/api/check-deviation":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            lat = body.get("lat")
            lon = body.get("lon")
            polyline = body.get("polyline", [])

            if lat is None or lon is None or not polyline:
                self.send_response(400)
                self._cors()
                self.end_headers()
                self.wfile.write(b'{"error": "lat, lon, and polyline required"}')
                return

            min_dist_m = float("inf")
            for pt in polyline:
                d = haversine_distance(lat, lon, pt[0], pt[1]) * 1000.0
                if d < min_dist_m:
                    min_dist_m = d

            status = "on_route" if min_dist_m <= 500.0 else "caution" if min_dist_m <= 1500.0 else "deviated"
            res = {
                "deviation_distance_m": round(min_dist_m, 1),
                "status": status,
                "is_deviated": min_dist_m > 1500.0
            }
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode())

        elif self.path == "/api/assess-safety":
            length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(length)) if length else {}
            except ValueError:
                return self._json(400, {"error": "invalid JSON"})
            lat, lon, user_id = body.get("lat"), body.get("lon"), body.get("user_id")
            try:
                lat, lon = float(lat), float(lon)
            except (TypeError, ValueError):
                return self._json(400, {"error": "lat, lon, and user_id required"})
            if not user_id or abs(lat) > 90 or abs(lon) > 180 or (lat == 0 and lon == 0):
                return self._json(400, {"error": "lat, lon, and user_id required (valid coordinates)"})
            try:
                assessment = safety_engine.compute_assessment(
                    lat, lon, user_id, body.get("travel_card_id"), body.get("prev_locations") or [],
                    body.get("network"), body.get("speed"))
                ok, detail = safety_engine.write_assessment(assessment)
                print(f"[assess] {user_id} {assessment['safety_status']} risk={assessment['risk_score']} "
                      f"quality={assessment['data_quality']} persisted={ok} ({detail})")
                # persisted=false tells the app the dashboard did NOT receive this reading.
                self._json(200, {**assessment, "persisted": ok, "persist_detail": detail})
            except Exception as e:
                import traceback
                traceback.print_exc()
                self._json(500, {"error": str(e)})
        else:
            self.send_response(404)
            self.end_headers()

    def _json(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def log_message(self, _, *__):
        pass  # suppress default HTTP logs

print(f"Server running on http://0.0.0.0:{PORT}")
ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
