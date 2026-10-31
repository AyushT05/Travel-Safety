import {
  useEffect,
  useRef,
  useState,
} from "react";

import L from "leaflet";
import { colorFor, cardForDevice } from "../utils/helpers";
import { getRoadRoute } from "../utils/routeService";
import useRiskLayers from "../hooks/useRiskLayers";

function makeGoogleDestinationPin() {
  return L.divIcon({
    className: "gmaps-pin-marker",
    html: `
      <div style="position:relative;width:30px;height:40px;transform:translate(-50%,-100%);">
        <svg width="30" height="40" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0px 3px 6px rgba(0,0,0,0.45));">
          <path d="M16 0C7.163 0 0 7.163 0 16c0 11.5 14.5 25.1 15.1 25.7.5.5 1.3.5 1.8 0C17.5 41.1 32 27.5 32 16 32 7.163 24.837 0 16 0z" fill="#EA4335"/>
          <circle cx="16" cy="15" r="6.5" fill="#FFFFFF"/>
        </svg>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    popupAnchor: [0, -40],
  });
}

function makeGoogleOriginPin() {
  return L.divIcon({
    className: "gmaps-origin-marker",
    html: `
      <div style="position:relative;width:22px;height:22px;transform:translate(-50%,-50%);">
        <div style="width:20px;height:20px;border-radius:50%;background:#0F9D58;border:3px solid #FFFFFF;box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
          <div style="width:6px;height:6px;border-radius:50%;background:#FFFFFF;"></div>
        </div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function makeGoogleStopPin(label) {
  return L.divIcon({
    className: "gmaps-stop-marker",
    html: `
      <div style="position:relative;width:20px;height:20px;transform:translate(-50%,-50%);">
        <div style="width:18px;height:18px;border-radius:50%;background:#1A73E8;border:2.5px solid #FFFFFF;box-shadow:0 1.5px 5px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#FFFFFF;font-size:10px;font-weight:700;">
          ${label}
        </div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function makeLiveIcon(color, initials, isUnsafe = false, inactive = false) {
  return L.divIcon({
    className: "",
    html: `
      <div class="live-marker${inactive ? " live-marker-inactive" : ""}" style="--mc:${color}">
        ${inactive ? "" : `<div class="live-marker-ring live-marker-ring-2"${isUnsafe ? ' style="border-color:#dc2626;"' : ""}></div>
        <div class="live-marker-ring live-marker-ring-1"${isUnsafe ? ' style="border-color:#dc2626;"' : ""}></div>`}

        <div class="live-marker-core">
          <span class="live-marker-initials">
            ${initials}
          </span>
        </div>

        <div class="live-marker-tail"></div>
      </div>
    `,
    iconSize: [48, 60],
    iconAnchor: [24, 58],
    popupAnchor: [0, -60],
  });
}

function getInitials(name) {
  if (!name) return "?";

  const parts = name.split(" ");

  if (parts.length >= 2) {
    return (
      parts[0][0] + parts[1][0]
    ).toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}

export default function MapView({
  devices,
  travelCards = [],
  alerts = [],
  follow,
  selected,
  selectedCard = null,
  setMapActions,
  safetyAssessments = {},
  riskZones = [],
  alertHeat = [],
  riskOptions = null,
}) {
  const mapRef = useRef(null);

  // The Leaflet instance as state, so the risk overlays can attach once it exists.
  const [mapInstance, setMapInstance] = useState(null);

  const leafletMap = useRef(null);

  const markersRef = useRef({});

  const trailsRef = useRef({});
  const plannedRoutesRef = useRef({});
  const waypointMarkersRef = useRef({});
  const deviationLinesRef = useRef({});
  const selectedCardRouteRef = useRef(null);

  // Planned routes are drawn only for the SELECTED travel card. The async route
  // lookup below reads this ref so a slow response can't draw a route for a card
  // that was deselected while it was loading.
  const selectedRef = useRef(selected);

  function clearRouteFor(id) {
    const route = plannedRoutesRef.current[id];
    if (route) {
      route.casing?.remove();
      route.core?.remove();
      delete plannedRoutesRef.current[id];
    }
    if (waypointMarkersRef.current[id]) {
      waypointMarkersRef.current[id].forEach((m) => m.remove());
      delete waypointMarkersRef.current[id];
    }
    if (deviationLinesRef.current[id]) {
      deviationLinesRef.current[id].remove();
      delete deviationLinesRef.current[id];
    }
  }

  // Last trail array drawn per device. Trails are owned by useDevices
  // (device.trail); the map only mirrors them, and only redraws when the
  // array reference changed.
  const trailSeenRef = useRef({});

  const alertMarkersRef = useRef({});

  const dangerZonesRef = useRef([]);

  const initializedRef = useRef(false);

  // Initialize map
  useEffect(() => {
    if (leafletMap.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([20, 78], 5);

    // bottomright is where DevicePanel's metrics + Nearby Help button live,
    // and topright is already taken by the Follow/Fit all/Clear trails
    // cluster (.map-controls), so zoom goes topleft, the one empty corner,
    // and attribution moves to bottomleft to stay out of DevicePanel's way.
    L.control.zoom({
      position: "topleft",
    }).addTo(map);

    L.control.attribution({
      position: "bottomleft",
    }).addTo(map);

    L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }
    ).addTo(map);

    leafletMap.current = map;
    setMapInstance(map);

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      setMapInstance(null);
      map.remove();
      leafletMap.current = null;
    };
  }, []);

  // Risk heat map, zone outlines, past-alert heat, tourist density and clusters (all off unless
  // riskOptions switches them on).
  useRiskLayers(mapInstance, {
    zones: riskZones,
    alertPoints: alertHeat,
    devices,
    markersRef,
    selectedId: selected,
    options: riskOptions,
  });

  // Expose actions to parent
  useEffect(() => {
    if (!leafletMap.current) return;

    setMapActions({
      fitAll() {
        const pts = Object.values(devices)
          .map((d) => d.lastLatlng)
          .filter(Boolean);

        if (pts.length === 1) {
          leafletMap.current.setView(
            pts[0],
            15
          );
        } else if (pts.length > 1) {
          leafletMap.current.fitBounds(pts, {
            padding: [60, 60],
          });
        }
      },
    });
  }, [devices, setMapActions]);

  // Marker + trail updates
  useEffect(() => {
    if (!leafletMap.current) return;
    selectedRef.current = selected;

    const map = leafletMap.current;

    // Builds the popup HTML for a device's marker. Extracted into its own
    // function so it can be called both when a marker is first created AND
    // whenever the device's current card changes afterward — previously
    // this was inlined into marker creation only, so the popup's name,
    // mobile number, and trip dates were frozen at whatever they were the
    // very first time that marker was drawn, and never updated again even
    // as findCurrentCard started returning a different (newer) card.
    function popupHtml(name, card, id) {
      return `
        <div style="font-family:'DM Sans',sans-serif;padding:4px 0;min-width:160px">
          <div style="font-weight:700;font-size:14px;color:#1B4332;margin-bottom:4px">
            ${name}
          </div>

          ${
            card
              ? `
            <div style="font-size:12px;color:#6b7280;margin-bottom:2px">
              ${card.mobile || ""}
            </div>

            <div style="font-size:12px;color:#6b7280">
              ${card.start_date} → ${card.end_date}
            </div>
          `
              : `
            <div style="font-size:11px;color:#9ca3af;font-family:monospace">
              ${id}
            </div>
          `
          }
        </div>
      `;
    }

    Object.entries(devices).forEach(
      ([id, d]) => {
        if (!d.lastLatlng) return;

        const card = cardForDevice(travelCards, id, d);

        const name =
          card?.full_name ||
          id.slice(0, 8);

        const initials =
          getInitials(name);

        const completed = Boolean(card?.end_date && card.end_date < new Date().toISOString().slice(0, 10));
        const color = completed ? "#94a3b8" : colorFor(id);
        const isUnsafe = safetyAssessments[id]?.safety_status === "unsafe";

        // Create marker
        if (!markersRef.current[id]) {
          const marker = L.marker(
            d.lastLatlng,
            {
              icon: makeLiveIcon(
                color,
                initials,
                isUnsafe,
                completed
              ),
            }
          ).addTo(map);

          marker.bindPopup(
            popupHtml(name, card, id),
            {
              maxWidth: 220,
            }
          );

          markersRef.current[id] =
            marker;
        } else {
          // Update marker
          markersRef.current[id].setLatLng(
            d.lastLatlng
          );

          markersRef.current[id].setIcon(
            makeLiveIcon(
              color,
              initials,
              isUnsafe,
              completed
            )
          );

          markersRef.current[id].setPopupContent(
            popupHtml(name, card, id)
          );
        }

        // Mirror the device's trail onto the map. Created if missing (first
        // render, or after Clear trails) and redrawn only when it changed.
        const trailPts = d.trail && d.trail.length ? d.trail : [d.lastLatlng];
        let trail = trailsRef.current[id];
        if (!trail) {
          trail = L.polyline(trailPts, {
            color,
            weight: 5,
            opacity: 0.85,
            lineJoin: "round",
            lineCap: "round",
          }).addTo(map);
          trailsRef.current[id] = trail;
          trailSeenRef.current[id] = d.trail;
        } else if (trailSeenRef.current[id] !== d.trail) {
          trail.setLatLngs(trailPts);
          trailSeenRef.current[id] = d.trail;
        }

        // Draw the planned road route & pins, but ONLY for the selected card;
        // every other card's route (and deviation line) is removed from the map.
        if (id !== selected) {
          clearRouteFor(id);
        } else if (card) {
          getRoadRoute(card).then((routeRes) => {
            if (selectedRef.current !== id) return; // deselected while loading
            if (!routeRes || !routeRes.polyline || routeRes.polyline.length < 2) return;
            const pts = routeRes.polyline;
            const currentRouteKey = `${card.id}:${pts.length}:${pts[0][0]}`;

            let existing = plannedRoutesRef.current[id];
            if (!existing || existing.key !== currentRouteKey) {
              if (existing) {
                if (existing.casing) existing.casing.remove();
                if (existing.core) existing.core.remove();
              }

              // Google Maps authentic dual-layer solid road ribbon
              const casing = L.polyline(pts, {
                color: "#185ABC",
                weight: 8,
                opacity: 0.92,
                lineCap: "round",
                lineJoin: "round",
              }).addTo(map);

              const core = L.polyline(pts, {
                color: "#4285F4",
                weight: 5.5,
                opacity: 1.0,
                lineCap: "round",
                lineJoin: "round",
              }).addTo(map);

              const routeTitle = card.places?.length
                ? card.places.join(" → ")
                : "Planned Route";
              const distanceInfo = routeRes.distanceKm ? ` · ${routeRes.distanceKm} km` : "";
              core.bindTooltip(`🛣️ ${routeTitle}${distanceInfo}`, { sticky: true });

              plannedRoutesRef.current[id] = { casing, core, key: currentRouteKey, polyline: pts };

              // Place Google Maps styled waypoint markers
              if (waypointMarkersRef.current[id]) {
                waypointMarkersRef.current[id].forEach((m) => m.remove());
              }
              const wpMarkers = [];
              const wps = routeRes.waypoints || [];
              if (wps.length >= 2) {
                // Origin (Green Pin)
                const startMarker = L.marker([wps[0].lat, wps[0].lon], {
                  icon: makeGoogleOriginPin(),
                }).addTo(map);
                startMarker.bindPopup(`<b>Origin:</b> ${wps[0].name}`);
                wpMarkers.push(startMarker);

                // Intermediate stops (Numbered stop pins)
                for (let i = 1; i < wps.length - 1; i++) {
                  const stopMarker = L.marker([wps[i].lat, wps[i].lon], {
                    icon: makeGoogleStopPin(i),
                  }).addTo(map);
                  stopMarker.bindPopup(`<b>Stop ${i}:</b> ${wps[i].name}`);
                  wpMarkers.push(stopMarker);
                }

                // Destination (Iconic Google Maps Red Pin)
                const dest = wps[wps.length - 1];
                const destMarker = L.marker([dest.lat, dest.lon], {
                  icon: makeGoogleDestinationPin(),
                }).addTo(map);
                destMarker.bindPopup(`<b>Destination:</b> ${dest.name}`);
                wpMarkers.push(destMarker);
              }
              waypointMarkersRef.current[id] = wpMarkers;
            }

            // Draw deviation indicator if active deviation alert exists
            const activePts = plannedRoutesRef.current[id]?.polyline || pts;
            const openDevAlert = (alerts || []).find(
              (a) => (a.travel_card_id ? a.travel_card_id === d.travelCardId : a.user_id === d.userId) && a.type === "deviation" && a.status === "open"
            );
            let devLine = deviationLinesRef.current[id];
            if (openDevAlert && activePts && d.lastLatlng) {
              let closestPt = activePts[0];
              let minDist = Infinity;
              for (const pt of activePts) {
                const dist = Math.hypot(pt[0] - d.lastLatlng[0], pt[1] - d.lastLatlng[1]);
                if (dist < minDist) {
                  minDist = dist;
                  closestPt = pt;
                }
              }
              const linePts = [d.lastLatlng, closestPt];
              if (!devLine) {
                devLine = L.polyline(linePts, {
                  color: "#dc2626",
                  weight: 5,
                  lineCap: "round",
                  lineJoin: "round",
                  opacity: 0.95,
                }).addTo(map);
                devLine.bindTooltip(openDevAlert.message || "Route deviation", { permanent: true, direction: "top" });
                deviationLinesRef.current[id] = devLine;
              } else {
                devLine.setLatLngs(linePts);
              }
            } else if (devLine) {
              devLine.remove();
              delete deviationLinesRef.current[id];
            }
          });
        }
      }
    );

    // Filter changes (for example selecting/closing a completed card) must
    // remove the old map layers, not leave an orphaned animated marker behind.
    const visibleIds = new Set(Object.keys(devices));
    Object.keys(markersRef.current).forEach((id) => {
      if (!visibleIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
        trailsRef.current[id]?.remove();
        delete trailsRef.current[id];
        clearRouteFor(id);
      }
    });

    // First load auto-fit ONLY ONCE
    if (!initializedRef.current) {
      const pts = Object.values(devices)
        .map((d) => d.lastLatlng)
        .filter(Boolean);

      if (pts.length === 1) {
        map.setView(pts[0], 15);
      } else if (pts.length > 1) {
        map.fitBounds(pts, {
          padding: [60, 60],
        });
      }

      initializedRef.current = true;
    }

    // Follow mode
    if (follow) {
      const pts = Object.values(devices)
        .map((d) => d.lastLatlng)
        .filter(Boolean);

      if (pts.length === 1) {
        map.panTo(pts[0]);
      } else if (pts.length > 1) {
        map.fitBounds(pts, {
          padding: [80, 80],
        });
      }
    }
  }, [devices, travelCards, alerts, follow, safetyAssessments, selected]);

  // Zoom to the selected device whenever a sidebar card is clicked. This is
  // deliberately its own effect, keyed only on `selected` (not on every
  // `devices` update), so it fires exactly once per click rather than
  // re-zooming on every incoming GPS ping for that device.
  useEffect(() => {
    if (!leafletMap.current || !selected) return;
    const device = devices[selected];
    if (!device?.lastLatlng) return;

    leafletMap.current.flyTo(device.lastLatlng, 16, { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // A newly created card can be selected before its first GPS upload reaches
  // the dashboard. Draw its planned route anyway, then the normal per-device
  // renderer takes over as soon as the card-linked location arrives.
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return undefined;
    const existing = selectedCardRouteRef.current;
    if (existing) { existing.remove(); selectedCardRouteRef.current = null; }
    if (!selectedCard || devices[selectedCard.id]) return undefined;

    let cancelled = false;
    getRoadRoute(selectedCard).then((routeRes) => {
      if (cancelled || !routeRes?.polyline || routeRes.polyline.length < 2) return;
      const line = L.polyline(routeRes.polyline, {
        color: "#1B4332", weight: 5, opacity: 0.8, lineJoin: "round",
      }).addTo(map);
      selectedCardRouteRef.current = line;
      map.fitBounds(line.getBounds(), { padding: [70, 70], maxZoom: 13 });
    });
    return () => {
      cancelled = true;
      if (selectedCardRouteRef.current) {
        selectedCardRouteRef.current.remove();
        selectedCardRouteRef.current = null;
      }
    };
  }, [selectedCard, devices]);

  // Alert markers — one pulsing red pin per open/acknowledged alert that has
  // a location. Cleared automatically once an alert is resolved.
  useEffect(() => {
    if (!leafletMap.current) return;
    const map = leafletMap.current;

    const active = alerts.filter(
      (a) => a.status !== "resolved" && a.lat != null && a.lon != null
    );
    const activeIds = new Set(active.map((a) => a.id));

    // Remove markers for alerts that resolved or dropped out of the feed
    Object.keys(alertMarkersRef.current).forEach((id) => {
      if (!activeIds.has(Number(id))) {
        map.removeLayer(alertMarkersRef.current[id]);
        delete alertMarkersRef.current[id];
      }
    });

    active.forEach((a) => {
      const latlng = [a.lat, a.lon];

      if (!alertMarkersRef.current[a.id]) {
        const icon = L.divIcon({
          className: "",
          html: `<div class="alert-marker"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });

        const marker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(map);

        marker.bindPopup(
          `<div style="font-family:'DM Sans',sans-serif;font-size:12px">
            <div style="font-weight:700;color:#DC2626;margin-bottom:2px">${a.type}</div>
            <div style="color:#6b7280">${new Date(a.created_at).toLocaleString()}</div>
          </div>`
        );

        alertMarkersRef.current[a.id] = marker;
      } else {
        alertMarkersRef.current[a.id].setLatLng(latlng);
      }
    });
  }, [alerts]);

  // Danger zone circles on map for the selected user's nearby unsafe zones
  useEffect(() => {
    if (!leafletMap.current) return;
    const map = leafletMap.current;

    // Clean up existing danger zones
    dangerZonesRef.current.forEach((circle) => map.removeLayer(circle));
    dangerZonesRef.current = [];

    if (!selected) return;
    const assessment = safetyAssessments[selected];
    const zones = assessment?.matched_unsafe_zones;
    if (!Array.isArray(zones) || zones.length === 0) return;

    zones.forEach((zone) => {
      const lat = zone.lat ?? zone.latitude;
      const lon = zone.lon ?? zone.longitude;
      if (lat == null || lon == null) return;

      const circle = L.circle([lat, lon], {
        radius: zone.radius_m || 500,
        color: "#dc2626",
        fillColor: "#dc2626",
        fillOpacity: 0.12,
        weight: 1.5,
        dashArray: "6,4",
        className: "danger-zone",
      }).addTo(map);

      dangerZonesRef.current.push(circle);
    });

    return () => {
      dangerZonesRef.current.forEach((circle) => map.removeLayer(circle));
      dangerZonesRef.current = [];
    };
  }, [selected, safetyAssessments]);

  return (
    <div
      ref={mapRef}
      style={{
        width: "100%",
        height: "100%",
      }}
    />
  );
}
