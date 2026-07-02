from http.server import SimpleHTTPRequestHandler, HTTPServer
import json, time, os

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