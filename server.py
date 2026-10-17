from http.server import SimpleHTTPRequestHandler, HTTPServer
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
# Safety Assessment Helpers
# ============================================================================

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance between two coordinates in kilometers"""
    R = 6371  # Earth's radius in km
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def query_overpass(query_str, timeout=30):
    """Query Overpass API and return parsed JSON"""
    try:
        req = request.Request(
            "https://overpass-api.de/api/interpreter",
            data=f"data={parse.quote(query_str)}".encode(),
            headers={"User-Agent": "MargRakshak-TravelSafety/1.0"}
        )
        with request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read())
    except Exception as e:
        print(f"Overpass query error: {e}")
        return None

def assess_emergency_access(lat, lon):
    """Check distances to nearest emergency services using Geoapify API"""
    if not GEOAPIFY_API_KEY:
        print("Geoapify API key not configured, defaulting to moderate risk")
        return None, None, None, 0.5

    try:
        # Geoapify categories for emergency services
        categories = "service.police,healthcare.hospital,service.fire_station"
        params = {
            "categories": categories,
            "filter": f"circle:{lon},{lat},20000",
            "bias": f"proximity:{lon},{lat}",
            "limit": "50",
            "apiKey": GEOAPIFY_API_KEY
        }

        url = f"https://api.geoapify.com/v2/places?{parse.urlencode(params)}"
        req = request.Request(url, headers={"Accept": "application/json", "User-Agent": "MargRakshak-TravelSafety/1.0"})

        with request.urlopen(req, timeout=15) as response:
            result = json.loads(response.read())

        if not result or 'features' not in result:
            return None, None, None, 0.5

        police_dist = None
        hospital_dist = None
        fire_dist = None

        for feature in result['features']:
            props = feature.get('properties', {})
            coords = feature.get('geometry', {}).get('coordinates', [])

            if len(coords) < 2:
                continue

            # GeoJSON is [lon, lat]
            elem_lon, elem_lat = coords[0], coords[1]

            if not isinstance(elem_lat, (int, float)) or not isinstance(elem_lon, (int, float)):
                continue

            dist = haversine_distance(lat, lon, elem_lat, elem_lon)

            # Classify by category
            categories_list = props.get('categories', [])

            if any('police' in cat for cat in categories_list):
                if police_dist is None or dist < police_dist:
                    police_dist = dist
            elif any('hospital' in cat for cat in categories_list):
                if hospital_dist is None or dist < hospital_dist:
                    hospital_dist = dist
            elif any('fire_station' in cat for cat in categories_list):
                if fire_dist is None or dist < fire_dist:
                    fire_dist = dist

        # Compute risk score based on worst (farthest) service
        distances = [d for d in [police_dist, hospital_dist, fire_dist] if d is not None]
        if not distances:
            emergency_score = 0.7  # No services found = high risk
        else:
            max_dist = max(distances)
            if max_dist < 2:
                emergency_score = 0.0
            elif max_dist < 5:
                emergency_score = 0.15
            elif max_dist < 10:
                emergency_score = 0.35
            elif max_dist < 20:
                emergency_score = 0.6
            else:
                emergency_score = 0.9

        return police_dist, hospital_dist, fire_dist, emergency_score

    except Exception as e:
        print(f"Geoapify emergency access error: {e}")
        return None, None, None, 0.5

def assess_isolation(lat, lon):
    """Check for isolation indicators - roads, buildings, settlements"""
    query = f"""
    [out:json][timeout:25];
    (
      way["highway"~"primary|secondary|tertiary|residential"](around:500,{lat},{lon});
      way["building"](around:300,{lat},{lon});
      node["place"~"village|town|city"](around:3000,{lat},{lon});
    );
    out body;
    """

    result = query_overpass(query)
    if not result or 'elements' not in result:
        return 0.5  # Default moderate isolation score

    # Count elements found
    count = len(result.get('elements', []))

    if count > 30:
        return 0.0  # Well connected urban/suburban area
    elif count > 15:
        return 0.15  # Some infrastructure
    elif count > 5:
        return 0.4  # Limited infrastructure (rural)
    else:
        return 0.8  # Highly isolated

def assess_hazards(lat, lon):
    """Check for official hazard zones"""
    query = f"""
    [out:json][timeout:25];
    (
      way["natural"="water"]["flood_prone"="yes"](around:500,{lat},{lon});
      node["hazard"](around:500,{lat},{lon});
      way["landuse"="military"](around:500,{lat},{lon});
      way["access"="no"](around:500,{lat},{lon});
      node["geological_hazard"="landslide"](around:1000,{lat},{lon});
    );
    out body;
    """

    result = query_overpass(query)
    hazard_zones = []

    if result and 'elements' in result:
        for element in result['elements']:
            tags = element.get('tags', {})
            hazard_type = None

            if tags.get('flood_prone') == 'yes':
                hazard_type = 'flood_zone'
            elif 'hazard' in tags:
                hazard_type = 'hazard_zone'
            elif tags.get('landuse') == 'military':
                hazard_type = 'restricted_area'
            elif tags.get('geological_hazard') == 'landslide':
                hazard_type = 'landslide_zone'
            elif tags.get('access') == 'no':
                hazard_type = 'restricted_area'

            if hazard_type:
                hazard_zones.append({
                    'type': hazard_type,
                    'tags': tags
                })

    # Hazard score: binary - if any hazard found, high risk
    hazard_score = 0.7 if len(hazard_zones) > 0 else 0.0

    return hazard_zones, hazard_score

def query_unsafe_zones(lat, lon):
    """Query Supabase for nearby user-reported unsafe zones"""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return [], 0.0

    try:
        # Query unsafe_zones within 2km radius
        # This is a simplified approach - in production you'd use PostGIS
        req = request.Request(
            f"{SUPABASE_URL}/rest/v1/unsafe_zones?status=eq.verified&select=*",
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/json"
            }
        )

        with request.urlopen(req, timeout=10) as response:
            zones = json.loads(response.read())

            nearby_zones = []
            for zone in zones:
                zone_lat = zone.get('lat')
                zone_lon = zone.get('lon')
                if zone_lat and zone_lon:
                    dist = haversine_distance(lat, lon, zone_lat, zone_lon)
                    radius_km = zone.get('radius_m', 500) / 1000

                    if dist <= radius_km + 0.5:  # Within zone radius + 500m buffer
                        nearby_zones.append({
                            'category': zone.get('category'),
                            'severity': zone.get('severity'),
                            'description': zone.get('description'),
                            'distance_km': round(dist, 2),
                            'lat': zone_lat,
                            'lon': zone_lon,
                            'radius_m': zone.get('radius_m', 500)
                        })

            # Crime proxy score based on number of nearby reports
            if len(nearby_zones) == 0:
                crime_score = 0.0
            elif len(nearby_zones) == 1:
                crime_score = 0.3
            elif len(nearby_zones) == 2:
                crime_score = 0.5
            else:
                crime_score = 0.7

            return nearby_zones, crime_score
    except Exception as e:
        print(f"Error querying unsafe zones: {e}")
        return [], 0.0

def compute_trajectory_warning(lat, lon, prev_locations, current_risk_score):
    """Check if user is heading toward a more dangerous area"""
    if not prev_locations or len(prev_locations) < 3:
        return None

    # Calculate bearing from last 3 points
    recent = prev_locations[-3:]
    if len(recent) < 3:
        return None

    # Simple trajectory: check if moving and in which direction
    lat_trend = recent[-1]['lat'] - recent[0]['lat']
    lon_trend = recent[-1]['lon'] - recent[0]['lon']

    # Project 5-10 minutes ahead (rough estimate)
    future_lat = lat + (lat_trend * 2)
    future_lon = lon + (lon_trend * 2)

    # Quick assessment of future position (simplified - just check emergency access)
    try:
        _, _, _, future_emergency_score = assess_emergency_access(future_lat, future_lon)

        # If future emergency access is significantly worse
        if future_emergency_score > current_risk_score + 0.2:
            return "You are heading toward an area with limited emergency access. Consider your route."
    except Exception:
        pass

    return None

def compute_safety_assessment(lat, lon, user_id, travel_card_id, prev_locations):
    """Main safety assessment computation"""

    # 1. Emergency access
    police_km, hospital_km, fire_km, emergency_score = assess_emergency_access(lat, lon)

    # 2. Isolation
    isolation_score = assess_isolation(lat, lon)

    # 3. Official hazards
    hazard_zones, hazard_score = assess_hazards(lat, lon)

    # 4. User-reported unsafe zones
    unsafe_zones, crime_score = query_unsafe_zones(lat, lon)

    # Composite risk score (weighted average)
    risk_score = (
        0.20 * emergency_score +
        0.30 * isolation_score +
        0.25 * hazard_score +
        0.25 * crime_score
    )

    # Determine status
    if risk_score < 0.3:
        safety_status = 'safe'
    elif risk_score < 0.6:
        safety_status = 'caution'
    else:
        safety_status = 'unsafe'

    # Build risk factors array
    risk_factors = []

    if emergency_score > 0.3:
        severity = 'high' if emergency_score > 0.6 else 'medium'
        risk_factors.append({
            'type': 'emergency_distance',
            'label': 'Far from emergency services',
            'severity': severity,
            'distance_km': max([d for d in [police_km, hospital_km, fire_km] if d is not None], default=None)
        })

    if isolation_score > 0.4:
        severity = 'high' if isolation_score > 0.7 else 'medium'
        risk_factors.append({
            'type': 'isolation',
            'label': 'Isolated area with limited infrastructure',
            'severity': severity
        })

    if hazard_score > 0.5:
        for hz in hazard_zones:
            risk_factors.append({
                'type': hz['type'],
                'label': hz['type'].replace('_', ' ').title(),
                'severity': 'high'
            })

    if crime_score > 0.2:
        severity = 'high' if crime_score > 0.6 else 'medium'
        risk_factors.append({
            'type': 'unsafe_zone',
            'label': f'{len(unsafe_zones)} reported incident(s) nearby',
            'severity': severity
        })

    # Trajectory warning
    heading_warning = compute_trajectory_warning(lat, lon, prev_locations, risk_score)

    return {
        'user_id': user_id,
        'travel_card_id': travel_card_id,
        'lat': lat,
        'lon': lon,
        'safety_status': safety_status,
        'risk_score': round(risk_score, 3),
        'risk_factors': risk_factors,
        'nearest_police_km': police_km,
        'nearest_hospital_km': hospital_km,
        'nearest_fire_km': fire_km,
        'isolation_score': round(isolation_score, 3),
        'hazard_zones': hazard_zones,
        'matched_unsafe_zones': unsafe_zones,
        'heading_warning': heading_warning,
        'assessed_at': datetime.now(timezone.utc).isoformat()
    }

def write_assessment_to_supabase(assessment):
    """Write safety assessment to Supabase (upsert on user_id)"""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("Supabase credentials not configured")
        return False

    try:
        payload = json.dumps(assessment).encode()

        req = request.Request(
            f"{SUPABASE_URL}/rest/v1/safety_assessments?on_conflict=user_id",
            data=payload,
            method='POST',
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates"
            }
        )

        response = request.urlopen(req, timeout=10)
        response.read()
        response.close()

        print(f"✓ Safety assessment written for user {assessment['user_id']}: {assessment['safety_status']}")
        print(f"  Emergency: Police={assessment.get('nearest_police_km')}km Hospital={assessment.get('nearest_hospital_km')}km Fire={assessment.get('nearest_fire_km')}km")
        print(f"  Risk: {assessment.get('risk_score')} Isolation: {assessment.get('isolation_score')}")
        return True

    except request.HTTPError as e:
        error_body = e.read().decode() if hasattr(e, 'read') else str(e)
        print(f"✗ Supabase HTTP error ({e.code}): {error_body}")
        return False
    except Exception as e:
        print(f"✗ Error writing to Supabase: {e}")
        import traceback
        traceback.print_exc()
        return False

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
        elif self.path == "/api/assess-safety":
            # Safety assessment endpoint
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}

            lat = body.get("lat")
            lon = body.get("lon")
            user_id = body.get("user_id")
            travel_card_id = body.get("travel_card_id")
            prev_locations = body.get("prev_locations", [])

            if lat is None or lon is None or not user_id:
                self.send_response(400)
                self._cors()
                self.end_headers()
                self.wfile.write(b'{"error": "lat, lon, and user_id required"}')
                return

            try:
                # Compute safety assessment
                assessment = compute_safety_assessment(lat, lon, user_id, travel_card_id, prev_locations)

                # Write to Supabase
                write_success = write_assessment_to_supabase(assessment)

                if write_success:
                    self.send_response(200)
                    self._cors()
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(assessment).encode())
                else:
                    # Even if write failed, return the computed assessment
                    self.send_response(200)
                    self._cors()
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(assessment).encode())

            except Exception as e:
                print(f"Safety assessment error: {e}")
                import traceback
                traceback.print_exc()
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

    def log_message(self, _, *__):
        pass  # suppress default HTTP logs

print(f"Server running on http://0.0.0.0:{PORT}")
HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()