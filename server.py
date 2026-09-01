from http.server import SimpleHTTPRequestHandler, HTTPServer
import json, time, os
from urllib import request, parse

PORT = int(os.environ.get("PORT", 8000))  # Render injects PORT
locations = {}  # name -> {lat, lon, accuracy, timestamp}

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
        else:
            self.send_response(404)
            self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def log_message(self, fmt, *args):
        pass  # suppress default HTTP logs

print(f"Server running on http://0.0.0.0:{PORT}")
HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()