# Backend Agent Enhancement Guide - Add Contact Info & Location Names to Incident Briefs

## Overview
This guide shows how to enhance the incident brief generation in your backend agent service to include:
1. **Phone numbers and addresses** from nearby emergency services
2. **Human-readable location names** (reverse geocoded) for the last known position

## Current State
- ✅ Supabase Edge Function `nearby-services` already extracts phone numbers
- ✅ Web dashboard frontend ready to display the enhanced data
- ❌ Backend agent doesn't call nearby-services or reverse geocoding when generating briefs

## Architecture

```
┌─────────────────┐
│  Mobile App     │ triggers SOS
│  (LocationShare)│────────┐
└─────────────────┘        │
                           ▼
                    ┌──────────────┐
                    │  Supabase    │
                    │  (alerts)    │
                    └──────┬───────┘
                           │
                   webhook │
                           ▼
                    ┌─────────────────────┐
                    │  Backend Agent      │
                    │  (Render Service)   │ ◄─── MODIFY THIS
                    │  - Generates brief  │
                    │  - Calls AI         │
                    └─────────┬───────────┘
                              │
                 ┌────────────┼────────────┐
                 │            │            │
                 ▼            ▼            ▼
        ┌────────────┐  ┌──────────┐  ┌──────────────┐
        │ Nearby     │  │ Geoapify │  │  Supabase    │
        │ Services   │  │ Reverse  │  │  (incidents) │
        │ Edge Fn    │  │ Geocode  │  │              │
        └────────────┘  └──────────┘  └──────────────┘
                 │            │            │
                 └────────────┴────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Web Dashboard  │
                    │  Displays brief │
                    └─────────────────┘
```

## Step 1: Add Nearby Services API Call

Your Supabase Edge Function at `supabase/functions/nearby-services/index.ts` already returns this structure:

```typescript
{
  "origin": { "lat": 28.6139, "lon": 77.2090 },
  "generated_at": "2026-10-21T10:30:00Z",
  "categories": {
    "hospital": [
      {
        "id": "123456",
        "name": "City Hospital",
        "lat": 28.6150,
        "lon": 77.2100,
        "distance_m": 1200,
        "address": "123 Main Street, New Delhi",
        "phone": "+91-11-12345678"  // ✅ Already included!
      }
    ],
    "police": [...],
    "fire_station": [...],
    "pharmacy": [...],
    "clinic": [...]
  }
}
```

### Python Code to Call This API

Add this function to your backend agent (likely in a `briefing.py` or similar file):

```python
import requests
from typing import List, Dict, Optional

def fetch_nearby_services(lat: float, lon: float, supabase_url: str, supabase_key: str) -> List[Dict]:
    """
    Call the Supabase Edge Function to get nearby services with contact info
    """
    try:
        url = f"{supabase_url}/functions/v1/nearby-services"
        
        response = requests.post(
            url,
            json={"lat": lat, "lon": lon},
            headers={
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json"
            },
            timeout=15
        )
        
        if not response.ok:
            print(f"Nearby services API failed: {response.status_code}")
            return []
        
        data = response.json()
        categories = data.get("categories", {})
        
        # Flatten all categories into a single list and sort by distance
        services = []
        
        for category_name, places in categories.items():
            for place in places:
                services.append({
                    "category": category_name,
                    "name": place.get("name", "Unknown"),
                    "distance_km": round(place.get("distance_m", 0) / 1000, 2),
                    "phone": place.get("phone"),  # May be None
                    "address": place.get("address"),
                    "lat": place.get("lat"),
                    "lon": place.get("lon")
                })
        
        # Sort by distance and take top 10
        services.sort(key=lambda s: s["distance_km"])
        return services[:10]
        
    except Exception as e:
        print(f"Error fetching nearby services: {e}")
        return []
```

## Step 2: Add Reverse Geocoding

### Python Code to Reverse Geocode

```python
def reverse_geocode_location(lat: float, lon: float, geoapify_key: str) -> Optional[str]:
    """
    Get human-readable location name from coordinates using Geoapify
    """
    try:
        params = {
            'lat': lat,
            'lon': lon,
            'apiKey': geoapify_key,
            'format': 'json',
            'lang': 'en'
        }
        
        response = requests.get(
            "https://api.geoapify.com/v1/geocode/reverse",
            params=params,
            timeout=10
        )
        
        if not response.ok:
            print(f"Reverse geocoding failed: {response.status_code}")
            return None
        
        data = response.json()
        results = data.get('results', [])
        
        if not results:
            return None
        
        result = results[0]
        
        # Build readable location string
        parts = []
        
        # Try to get the most specific location first
        if result.get('name') and result.get('name') != result.get('city'):
            parts.append(result['name'])
        elif result.get('street'):
            parts.append(result['street'])
        elif result.get('suburb'):
            parts.append(result['suburb'])
        
        # Add city
        if result.get('city'):
            parts.append(result['city'])
        
        # Add state if different from city
        if result.get('state') and result.get('state') != result.get('city'):
            parts.append(result['state'])
        
        # Add postcode
        if result.get('postcode'):
            parts.append(result['postcode'])
        
        # Add country
        if result.get('country'):
            parts.append(result['country'])
        
        if parts:
            return ', '.join(parts)
        
        # Fallback to formatted address
        return result.get('formatted')
        
    except Exception as e:
        print(f"Reverse geocoding error: {e}")
        return None
```

## Step 3: Integrate into Brief Generation

Find where you generate the incident brief (likely when handling `/agent/panic` or `/agent/tick` endpoints) and modify it:

### Before (Current Code):
```python
def generate_incident_brief(incident_data, alert_data):
    # ... existing code ...
    
    brief = {
        "headline": "SOS Alert - Emergency assistance needed",
        "summary": "...",
        "timeline": [...],
        "last_known": {
            "lat": alert_data['lat'],
            "lon": alert_data['lon'],
            "at": alert_data['created_at'],
            "accuracy_m": alert_data.get('accuracy')
        },
        "nearby_services": [],  # Currently empty or basic
        # ... rest of brief ...
    }
    
    return brief
```

### After (Enhanced Code):
```python
def generate_incident_brief(
    incident_data, 
    alert_data,
    supabase_url: str,
    supabase_key: str,
    geoapify_key: str
):
    # ... existing code ...
    
    lat = alert_data['lat']
    lon = alert_data['lon']
    
    # Fetch nearby services WITH contact info
    nearby_services = fetch_nearby_services(lat, lon, supabase_url, supabase_key)
    
    # Get human-readable location name
    location_name = reverse_geocode_location(lat, lon, geoapify_key)
    if not location_name:
        # Fallback to coordinates
        location_name = f"Lat: {lat:.5f}, Lon: {lon:.5f}"
    
    brief = {
        "headline": "SOS Alert - Emergency assistance needed",
        "summary": "...",
        "timeline": [...],
        "last_known": {
            "lat": lat,
            "lon": lon,
            "at": alert_data['created_at'],
            "accuracy_m": alert_data.get('accuracy'),
            "location_name": location_name  # ✅ NEW!
        },
        "nearby_services": nearby_services,  # ✅ NOW WITH PHONE NUMBERS!
        # ... rest of brief ...
    }
    
    return brief
```

## Step 4: Update Environment Variables

Make sure your Render service has these environment variables:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
GEOAPIFY_API_KEY=your-geoapify-api-key
```

## Step 5: Expected Brief Output

After these changes, your incident brief should look like:

```json
{
  "headline": "SOS Alert - Emergency assistance needed",
  "summary": "Tourist triggered panic button. Last known position 15 minutes ago.",
  "timeline": [
    {"at": "2026-10-21T10:15:00Z", "event": "SOS triggered"},
    {"at": "2026-10-21T10:00:00Z", "event": "Location last updated"}
  ],
  "last_known": {
    "lat": 28.6139,
    "lon": 77.2090,
    "at": "2026-10-21T10:00:00Z",
    "accuracy_m": 15,
    "location_name": "Connaught Place, New Delhi, Delhi 110001, India"
  },
  "nearby_services": [
    {
      "category": "hospital",
      "name": "All India Institute of Medical Sciences",
      "distance_km": 2.5,
      "phone": "+91-11-26588500",
      "address": "Ansari Nagar, New Delhi, 110029"
    },
    {
      "category": "police",
      "name": "Connaught Place Police Station",
      "distance_km": 0.8,
      "phone": "+91-11-23417384",
      "address": "P Block, Connaught Place, New Delhi"
    },
    {
      "category": "fire_station",
      "name": "Delhi Fire Service Station",
      "distance_km": 1.2,
      "phone": "101",
      "address": "Barakhamba Road, New Delhi"
    }
  ],
  "steps": [
    {"detail": "Call nearest hospital immediately", "contact_index": null},
    {"detail": "Contact tourist's emergency contact", "contact_index": 0}
  ],
  "alternative_explanations": [...],
  "unknowns": [...]
}
```

## Step 6: Handle API Failures Gracefully

Both API calls might fail. Always provide fallbacks:

```python
def generate_incident_brief_safe(incident_data, alert_data, config):
    """
    Generate brief with graceful fallbacks if external APIs fail
    """
    lat = alert_data['lat']
    lon = alert_data['lon']
    
    # Try to fetch nearby services
    try:
        nearby_services = fetch_nearby_services(
            lat, lon, 
            config['supabase_url'], 
            config['supabase_key']
        )
    except Exception as e:
        print(f"Failed to fetch nearby services: {e}")
        nearby_services = []
    
    # Try to reverse geocode
    try:
        location_name = reverse_geocode_location(
            lat, lon, 
            config['geoapify_key']
        )
    except Exception as e:
        print(f"Failed to reverse geocode: {e}")
        location_name = None
    
    # Fallback to coordinates
    if not location_name:
        location_name = f"Lat: {lat:.5f}, Lon: {lon:.5f}"
    
    # Build brief with whatever we got
    brief = {
        # ... other fields ...
        "last_known": {
            "lat": lat,
            "lon": lon,
            "at": alert_data['created_at'],
            "accuracy_m": alert_data.get('accuracy'),
            "location_name": location_name
        },
        "nearby_services": nearby_services,
        # ... rest of brief ...
    }
    
    return brief
```

## Step 7: Testing

### Test the Nearby Services API directly:

```bash
curl -X POST 'https://your-project.supabase.co/functions/v1/nearby-services' \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"lat": 28.6139, "lon": 77.2090}'
```

Expected response:
```json
{
  "origin": {"lat": 28.6139, "lon": 77.2090},
  "categories": {
    "hospital": [{"name": "...", "phone": "+91-...", ...}],
    ...
  }
}
```

### Test Reverse Geocoding:

```bash
curl "https://api.geoapify.com/v1/geocode/reverse?lat=28.6139&lon=77.2090&apiKey=YOUR_KEY&format=json"
```

Expected response:
```json
{
  "results": [
    {
      "formatted": "Connaught Place, New Delhi, Delhi 110001, India",
      "city": "New Delhi",
      "state": "Delhi",
      "country": "India",
      ...
    }
  ]
}
```

### Test Full Flow:

1. Trigger SOS from mobile app
2. Check backend agent logs - should show:
   ```
   Fetching nearby services for 28.6139, 77.2090
   Found 8 nearby services with contact info
   Reverse geocoded to: Connaught Place, New Delhi...
   ```
3. Open Incidents Panel in web dashboard
4. Verify "Nearest services" section shows phone numbers
5. Verify "Last known position" shows location name above coordinates
6. Click phone number - should open phone dialer

## Performance Considerations

### Caching
Consider caching reverse geocoding results:

```python
# Simple in-memory cache (use Redis for production)
_geocode_cache = {}

def reverse_geocode_with_cache(lat: float, lon: float, geoapify_key: str) -> Optional[str]:
    # Round to 4 decimal places (~11m precision) for cache key
    cache_key = f"{round(lat, 4)},{round(lon, 4)}"
    
    if cache_key in _geocode_cache:
        return _geocode_cache[cache_key]
    
    location_name = reverse_geocode_location(lat, lon, geoapify_key)
    
    if location_name:
        _geocode_cache[cache_key] = location_name
    
    return location_name
```

### Rate Limits

**Geoapify Free Tier:**
- 3,000 requests/day
- Enough for ~100 incidents/day (each uses 2 requests)

**If you hit rate limits:**
- Cache more aggressively
- Only call for medium+ priority incidents
- Upgrade to paid tier ($49/month for 100k requests)

### Timeouts

Both API calls have 10-15 second timeouts. Brief generation should complete within 20-30 seconds total.

## Troubleshooting

### "Nearby services API failed: 401"
- Check SUPABASE_SERVICE_KEY is correct
- Verify Edge Function is deployed: `supabase functions list`

### "Reverse geocoding failed: 403"
- Check GEOAPIFY_API_KEY is valid
- Check you haven't exceeded rate limit

### "No phone numbers showing up"
- Check the nearby-services response includes phone numbers
- Verify OSM data has phone numbers for those places
- Some places legitimately don't have phone numbers in OSM

### "Location name is just coordinates"
- Geoapify might not have detailed data for that area
- This is expected for very remote locations
- Coordinates are a valid fallback

## Deployment Checklist

- [ ] Add `fetch_nearby_services()` function to backend
- [ ] Add `reverse_geocode_location()` function to backend  
- [ ] Integrate both into `generate_incident_brief()`
- [ ] Add error handling and fallbacks
- [ ] Set environment variables on Render
- [ ] Deploy backend service
- [ ] Test with dummy SOS alert
- [ ] Verify data appears in web dashboard
- [ ] Check logs for any errors
- [ ] Monitor API usage/rate limits

## Complete Example

Here's a complete example you can adapt:

```python
# briefing.py
import requests
from typing import Dict, List, Optional
import os

def generate_enhanced_brief(alert_data: Dict, incident_data: Dict) -> Dict:
    """
    Generate incident brief with nearby services and location name
    """
    lat = alert_data.get('lat')
    lon = alert_data.get('lon')
    
    if not lat or not lon:
        # Can't enhance without coordinates
        return generate_basic_brief(alert_data, incident_data)
    
    # Get environment variables
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
    geoapify_key = os.environ.get('GEOAPIFY_API_KEY')
    
    # Fetch nearby services (with phone numbers)
    nearby_services = []
    if supabase_url and supabase_key:
        try:
            nearby_services = fetch_nearby_services(lat, lon, supabase_url, supabase_key)
            print(f"✓ Fetched {len(nearby_services)} nearby services")
        except Exception as e:
            print(f"✗ Failed to fetch nearby services: {e}")
    
    # Reverse geocode location
    location_name = None
    if geoapify_key:
        try:
            location_name = reverse_geocode_location(lat, lon, geoapify_key)
            print(f"✓ Location: {location_name}")
        except Exception as e:
            print(f"✗ Failed to reverse geocode: {e}")
    
    if not location_name:
        location_name = f"Lat: {lat:.5f}, Lon: {lon:.5f}"
    
    # Build enhanced brief
    brief = {
        "source": "llm",
        "headline": "SOS Alert - Immediate assistance required",
        "summary": f"Tourist activated emergency SOS. Last known location: {location_name}",
        "timeline": [
            {"at": alert_data['created_at'], "event": "SOS button pressed"},
            # ... more timeline events ...
        ],
        "last_known": {
            "lat": lat,
            "lon": lon,
            "at": alert_data['created_at'],
            "accuracy_m": alert_data.get('accuracy'),
            "location_name": location_name  # ✅ ENHANCED
        },
        "nearby_services": nearby_services,  # ✅ ENHANCED WITH PHONE NUMBERS
        "steps": [
            {"detail": "Contact tourist immediately on their registered mobile number"},
            {"detail": "Alert nearest hospital if no response within 5 minutes"},
            {"detail": "Notify tourist's emergency contacts"},
        ],
        "alternative_explanations": [
            "Accidental button press - tourist may confirm they're safe",
            "Lost phone - may not be with tourist",
        ],
        "unknowns": [
            "Whether tourist is actually in danger",
            "Current circumstances leading to SOS",
        ]
    }
    
    return brief


def fetch_nearby_services(lat: float, lon: float, supabase_url: str, supabase_key: str) -> List[Dict]:
    # (Use code from Step 1 above)
    pass


def reverse_geocode_location(lat: float, lon: float, geoapify_key: str) -> Optional[str]:
    # (Use code from Step 2 above)
    pass
```

---

## Summary

After implementing these changes:

✅ Incident briefs will include **phone numbers** for nearby emergency services  
✅ Incident briefs will show **readable location names** instead of just coordinates  
✅ Web dashboard will display all this information automatically (frontend is ready)  
✅ Responders can **call emergency services directly** from the incident panel  
✅ Better situational awareness with **"Near Connaught Place, New Delhi"** vs **"28.6139, 77.2090"**  

The frontend is already complete and waiting for this data. Once you deploy these backend changes, the enhanced information will appear immediately in the Incidents Panel!
