# Travel Safety

A full-stack tourist safety and live-location monitoring system, built around a shared Supabase backend. Travellers create a trip profile and share live GPS location from a mobile app; a web dashboard lets an admin or emergency contact watch tracked travellers on a live map.

The project has three parts:

```
.
├── WebDashboard/margarakshak/   React + Vite web dashboard (admin/monitoring view)
├── LocationShare/               React Native (Expo) mobile app (traveller-facing)
├── server.py                    Lightweight Python location relay (legacy/standalone)
├── live_map.html, mobile.html   Standalone HTML prototypes of the map/mobile flow
├── location.json                Sample/scratch location data
├── Procfile, requirements.txt   Deployment config for server.py (e.g. Render)
```

## How it fits together

- **LocationShare** (mobile app) — a traveller signs up, fills out a **travel card** (personal details, ID document, trip dates, places, travel companions, and at least 3 emergency contacts), then starts **active tracking**, which streams live GPS location to Supabase.
- **WebDashboard** (web app) — an authenticated viewer sees tracked travellers as live pins on a Leaflet map, can select a device to follow, view their travel card details, and manage which IDs they're tracking.
- **server.py / live_map.html / mobile.html** — an earlier, simpler prototype of the same idea using a standalone Python HTTP server (in-memory location store, no auth, no database) with a bare HTML map and mobile client. Kept for reference/fallback; the Supabase-backed apps above are the current version.

## Tech stack

| Layer | Stack |
|---|---|
| Mobile app | React Native, Expo SDK 54, `expo-location`, `expo-document-picker` |
| Web dashboard | React 19, Vite, Leaflet |
| Backend / data | Supabase (Auth + Postgres) |
| Legacy relay | Python 3 stdlib `http.server` (no dependencies), deployable on Render |

## Getting started

### Web dashboard
```bash
cd WebDashboard/margarakshak
npm install
```
Create a `.env` file in this folder with:
```
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```
Then:
```bash
npm run dev
```

### Mobile app
```bash
cd LocationShare
npm install
```
Create a `.env` file in this folder with:
```
EXPO_PUBLIC_SUPABASE_URL=your-supabase-project-url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```
Then:
```bash
npx expo start
```
Scan the QR code with the **Expo Go** app on your phone, or run `npx expo start --android` / `--ios` for a simulator.

Both apps point at the same Supabase project, so a traveller created via the mobile app is what shows up on the web dashboard.

### Legacy standalone server (optional)
```bash
pip install -r requirements.txt   # no external deps, stdlib only
python server.py
```
Serves `live_map.html` and `mobile.html` and exposes:
- `POST /update-location` — push a location update
- `GET /locations` — fetch current in-memory locations

## Environment variables

Neither `.env` file is committed. You'll need your own Supabase project URL and anon key — set up a Supabase project, enable email auth, and create tables for travellers/travel cards/locations to match what `useDevices.js` and the mobile screens query.

> **Note:** the Supabase anon key is safe to expose client-side by design, but make sure Row Level Security (RLS) policies are enabled on your tables so travellers can only read/write data they're supposed to.

## Status

Actively developed as a college major project. The Supabase-backed mobile + dashboard pair is the primary version going forward; the root-level Python server and HTML files are an earlier prototype kept for reference.
