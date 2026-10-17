import {
  useEffect,
  useRef,
} from "react";

import L from "leaflet";
import { colorFor, findCurrentCard } from "../utils/helpers";

function makeLiveIcon(color, initials, isUnsafe = false) {
  return L.divIcon({
    className: "",
    html: `
      <div class="live-marker" style="--mc:${color}">
        <div class="live-marker-ring live-marker-ring-2"${isUnsafe ? ' style="border-color:#dc2626;"' : ""}></div>
        <div class="live-marker-ring live-marker-ring-1"${isUnsafe ? ' style="border-color:#dc2626;"' : ""}></div>

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
  setMapActions,
  safetyAssessments = {},
}) {
  const mapRef = useRef(null);

  const leafletMap = useRef(null);

  const markersRef = useRef({});

  const trailsRef = useRef({});

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

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      map.remove();
      leafletMap.current = null;
    };
  }, []);

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

        const card = findCurrentCard(travelCards, id);

        const name =
          card?.full_name ||
          id.slice(0, 8);

        const initials =
          getInitials(name);

        const color = colorFor(id);
        const isUnsafe = safetyAssessments[id]?.safety_status === "unsafe";

        // Create marker
        if (!markersRef.current[id]) {
          const marker = L.marker(
            d.lastLatlng,
            {
              icon: makeLiveIcon(
                color,
                initials,
                isUnsafe
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
              isUnsafe
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
      }
    );

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
  }, [devices, travelCards, follow, safetyAssessments]);

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