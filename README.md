# Travel Safety

## Problem Statement

**Smart Tourist Safety Monitoring & Incident Response System using AI, Geo-Fencing, and Blockchain-based Digital ID**

Tourism-heavy regions — especially remote or high-risk areas like the Northeast — struggle to keep visitors safe with traditional policing and manual tracking. The envisioned solution is a full digital ecosystem: blockchain-issued digital tourist IDs, a mobile app with geo-fencing alerts and a panic button, AI-based anomaly detection for missing/distress behaviour, a real-time police/tourism-department dashboard with heat maps and automated E-FIR generation, optional IoT wearables for high-risk zones, and multilingual, privacy-compliant access for all travellers.

## What this project actually builds

This repo implements the core traveller-monitoring loop of that vision: a mobile app for tourists and a web dashboard for whoever is watching over them, both backed by a shared Supabase database.

**Digital travel card (mobile app)** — Instead of a blockchain-issued ID, a traveller creates a **travel card**: full name, mobile number, an identity document upload (image or PDF), trip start/end dates, planned places, travel companions, and a minimum of 3 emergency contacts. This is stored in Supabase and scoped to that traveller's account.

**Live location sharing (mobile app)** — Once a travel card's trip dates are active, the app prompts for location permission and, once started, streams the traveller's GPS position (lat/lon/accuracy) every few seconds while tracking is on. The traveller can stop sharing at any time.

**Monitoring dashboard (web app)** — An authenticated viewer sees active travellers as live pins on a Leaflet map, can select a traveller to follow their movement, inspect their travel card (trip dates, route, emergency contacts), search/manage which traveller IDs they're tracking, and clear trail history.

**Legacy prototype (`server.py`, `live_map.html`, `mobile.html`)** — The earliest version of this idea: a dependency-free Python HTTP server holding locations in memory, a bare HTML map, and a plain mobile web page for sending location. No auth, no database, no persistence — superseded by the Supabase-backed apps but kept in the repo as the original proof of concept.

## Mapped against the problem statement

| Problem statement asks for | Status |
|---|---|
| Digital Tourist ID (blockchain, KYC, entry-point issuance) | Partial — traveller profile + ID document exist as a **Supabase-backed travel card**, not blockchain-based, not issued at physical entry points |
| Tourist Safety Score | Not implemented |
| Geo-fencing alerts for high-risk zones | Not implemented |
| Panic button with live sharing to police/contacts | Not implemented — location sharing exists, but it's manually started/stopped by the traveller, not an SOS trigger |
| Opt-in real-time tracking for families/law enforcement | Implemented — live GPS streaming, dashboard viewing |
| AI-based anomaly detection (drop-offs, inactivity, route deviation) | Not implemented |
| Police/tourism department dashboard with heat maps | Partial — live map + traveller list + travel card lookup exist; no heat maps, no alert history |
| Automated E-FIR generation | Not implemented |
| IoT wearable integration | Not implemented |
| Multilingual support | Not implemented (English only) |
| End-to-end encryption / data protection compliance | Relies on Supabase's built-in auth and transport security; no additional encryption layer added |

## Tech stack

| Layer | Stack |
|---|---|
| Mobile app | React Native, Expo SDK 54, `expo-location`, `expo-document-picker` |
| Web dashboard | React 19, Vite, Leaflet |
| Backend / data | Supabase (Auth + Postgres) |
| Legacy relay | Python 3 stdlib `http.server`, deployable on Render |

## Repo layout

```
.
├── WebDashboard/margarakshak/   Web dashboard (React + Vite)
├── LocationShare/               Mobile app (React Native / Expo)
├── server.py                    Legacy in-memory location relay
├── live_map.html, mobile.html   Legacy standalone prototype pages
├── location.json                Sample/scratch location data
├── Procfile, requirements.txt   Deployment config for server.py
```
