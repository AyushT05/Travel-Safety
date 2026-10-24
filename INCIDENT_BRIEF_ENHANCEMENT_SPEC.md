# Incident Brief Enhancement Specification

## Overview
This document specifies the enhancements needed for the AI-generated incident briefs to include nearby emergency services contact information and reverse-geocoded location names.

## Current Structure
The incident brief is stored in `incidents.brief` (JSONB column) and currently includes:
- `headline`: Brief title
- `summary`: AI-generated description
- `timeline`: Array of events with timestamps
- `last_known`: Last known position with lat/lon
- `nearby_services`: Array of nearby services (without contact info)
- `alternative_explanations`: Array of possible explanations
- `steps`: Recommended next steps
- `unknowns`: What information is missing

## Required Enhancements

### 1. Add Contact Information to Nearby Services

**Current Structure:**
```json
{
  "nearby_services": [
    {
      "category": "hospital",
      "name": "City Hospital",
      "distance_km": 2.5
    }
  ]
}
```

**Enhanced Structure:**
```json
{
  "nearby_services": [
    {
      "category": "hospital",
      "name": "City Hospital", 
      "distance_km": 2.5,
      "phone": "+91-XXXXXXXXXX",      // NEW: Contact number
      "address": "123 Main St, City"  // NEW: Full address (optional)
    }
  ]
}
```

**Implementation Notes:**
- Fetch phone numbers from Geoapify API or Overpass API responses
- Geoapify properties include: `datasource.raw.phone`, `datasource.raw.contact:phone`
- Overpass API tags include: `phone`, `contact:phone`
- Format phone numbers consistently (with country code)

### 2. Add Reverse Geocoded Location Name

**Current Structure:**
```json
{
  "last_known": {
    "lat": 28.6139,
    "lon": 77.2090,
    "at": "2026-10-21T10:15:00Z",
    "accuracy_m": 15
  }
}
```

**Enhanced Structure:**
```json
{
  "last_known": {
    "lat": 28.6139,
    "lon": 77.2090,
    "at": "2026-10-21T10:15:00Z",
    "accuracy_m": 15,
    "location_name": "Near Connaught Place, New Delhi, Delhi 110001, India"  // NEW
  }
}
```

**Implementation Notes:**
- Use Geoapify Reverse Geocoding API: 
  `https://api.geoapify.com/v1/geocode/reverse?lat={lat}&lon={lon}&apiKey={key}`
- Construct readable location string from response:
  - Priority: `name` or `street` + `city` + `state` + `postcode` + `country`
  - Example: "123 Main Street, New Delhi, Delhi 110001, India"
  - Fallback: "Lat: 28.6139, Lon: 77.2090" if geocoding fails

## Backend Service Modifications Required

### File: `/agent/briefing.py` (or equivalent)

1. **Add function to fetch contact info for nearby services:**

```python
def enrich_nearby_services_with_contact(services, lat, lon, api_key):
    """
    Enrich nearby services with phone numbers from Geoapify
    """
    enriched = []
    for service in services:
        service_lat = service.get('lat')
        service_lon = service.get('lon')
        
        # Query Geoapify for place details
        try:
            params = {
                'lat': service_lat,
                'lon': service_lon,
                'apiKey': api_key
            }
            # Fetch place details and extract phone
            # Add phone to service dict
            service['phone'] = extracted_phone or None
        except Exception as e:
            service['phone'] = None
        
        enriched.append(service)
    
    return enriched
```

2. **Add function to reverse geocode location:**

```python
def reverse_geocode_location(lat, lon, api_key):
    """
    Get human-readable location name from coordinates
    """
    try:
        url = f"https://api.geoapify.com/v1/geocode/reverse"
        params = {
            'lat': lat,
            'lon': lon,
            'apiKey': api_key,
            'format': 'json'
        }
        
        response = requests.get(url, params=params, timeout=10)
        data = response.json()
        
        if data.get('results'):
            result = data['results'][0]
            
            # Build location string
            parts = []
            if result.get('name') or result.get('street'):
                parts.append(result.get('name') or result.get('street'))
            if result.get('city'):
                parts.append(result['city'])
            if result.get('state'):
                parts.append(result['state'])
            if result.get('postcode'):
                parts.append(result['postcode'])
            if result.get('country'):
                parts.append(result['country'])
            
            return ', '.join(parts) if parts else None
    except Exception as e:
        print(f"Reverse geocoding failed: {e}")
        return None
    
    return None
```

3. **Modify brief generation to include enhancements:**

```python
def generate_incident_brief(incident_data, geoapify_key):
    # ... existing brief generation code ...
    
    # Enhance nearby services with contact info
    if brief.get('nearby_services'):
        brief['nearby_services'] = enrich_nearby_services_with_contact(
            brief['nearby_services'], 
            last_lat, 
            last_lon, 
            geoapify_key
        )
    
    # Add location name to last_known
    if brief.get('last_known'):
        location_name = reverse_geocode_location(
            brief['last_known']['lat'],
            brief['last_known']['lon'],
            geoapify_key
        )
        if location_name:
            brief['last_known']['location_name'] = location_name
        else:
            # Fallback to coordinates
            brief['last_known']['location_name'] = (
                f"Lat: {brief['last_known']['lat']:.5f}, "
                f"Lon: {brief['last_known']['lon']:.5f}"
            )
    
    return brief
```

## Frontend Display (Already Implemented)

The IncidentsPanel.jsx at lines 86-98 already displays nearby services:

```jsx
{(brief.nearby_services || []).length > 0 && (
  <>
    <h4>Nearest services</h4>
    <ul>
      {brief.nearby_services.map((s, i) => (
        <li key={i}>
          {s.category.replace("_", " ")}: {s.name || "unnamed"} · {s.distance_km} km
          {s.phone && <> · <a className="inc-link" href={`tel:${s.phone}`}>{s.phone}</a></>}
        </li>
      ))}
    </ul>
  </>
)}
```

**This needs to be enhanced to show the location name:**

```jsx
{brief.last_known && (
  <>
    <h4>Last known position</h4>
    <p>
      {brief.last_known.location_name && (
        <><strong>{brief.last_known.location_name}</strong><br /></>
      )}
      {brief.last_known.lat.toFixed(5)}, {brief.last_known.lon.toFixed(5)} · {ago(brief.last_known.at)}
      {brief.last_known.accuracy_m != null && ` · accuracy ${Math.round(brief.last_known.accuracy_m)} m`}{" "}
      {inc.user_id && <button className="inc-link" onClick={() => onFocus(inc.user_id)}>Show on map</button>}
    </p>
  </>
)}
```

## Testing Checklist

- [ ] Nearby services include phone numbers when available
- [ ] Phone numbers are clickable tel: links
- [ ] Last known location shows human-readable address
- [ ] Fallback to coordinates when reverse geocoding fails
- [ ] Error handling for API failures doesn't break brief generation
- [ ] Phone number formatting is consistent (with country code)

## API Rate Limits

**Geoapify Free Tier:**
- 3,000 requests/day
- Consider caching reverse geocoding results for same coordinates
- Batch requests when possible

**Fallback Strategy:**
- If rate limit exceeded, use coordinate-only display
- Cache results in database for frequently accessed locations
