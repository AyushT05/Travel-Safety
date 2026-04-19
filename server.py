from http.server import SimpleHTTPRequestHandler, HTTPServer
import json, time, os

PORT = 8000
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
            # Persist to file
            with open("locations.json", "w") as f:
                json.dump(locations, f)
            self.send_response(200)
            self._cors()
            self.end_headers()
            self.wfile.write(b"OK")
        else:
            self.send_response(404)
            self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def log_message(self, fmt, *args):
        pass  # suppress default HTTP logs; we print our own

# Load previous state if exists
if os.path.exists("locations.json"):
    with open("locations.json") as f:
        locations = json.load(f)
    print(f"Loaded {len(locations)} saved device(s).")

print(f"Server running on http://0.0.0.0:{PORT}")
HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()