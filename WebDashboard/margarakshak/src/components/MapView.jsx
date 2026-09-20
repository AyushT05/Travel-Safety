import {
  useEffect,
  useRef,
} from "react";

import L from "leaflet";
import { colorFor, findCurrentCard } from "../utils/helpers";

function makeLiveIcon(color, initials) {
  return L.divIcon({
    className: "",
    html: `
      <div class="live-marker" style="--mc:${color}">
        <div class="live-marker-ring live-marker-ring-2"></div>
        <div class="live-marker-ring live-marker-ring-1"></div>

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
}) {
  const mapRef = useRef(null);

  const leafletMap = useRef(null);

  const markersRef = useRef({});

  const trailsRef = useRef({});

  // Tracks which travel_card_id's trail is currently drawn for each device
  // id, so a trip boundary can be detected and the trail reset even if the
  // dashboard tab has stayed open the whole time (the same user_id can
  // legitimately move from one finished trip straight into a brand new
  // one without the page ever reloading).
  const activeCardRef = useRef({});

  const alertMarkersRef = useRef({});

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

      clearTrails() {
        Object.values(trailsRef.current).forEach(
          (trail) => {
            leafletMap.current.removeLayer(
              trail
            );
          }
        );

        trailsRef.current = {};
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

        // Trip-boundary check: if this device's active card has changed
        // since we last drew its trail (including going from "had a card"
        // to "has a different one"), the old trail belongs to a different
        // trip and must not visually connect into the new one. Recreate a
        // fresh trail seeded at the CURRENT point immediately, rather than
        // just deleting it, so the update branch below always has a trail
        // to append to.
        const cardKey = card?.id ?? null;
        const tripChanged =
          activeCardRef.current[id] !== undefined && activeCardRef.current[id] !== cardKey;
        if (tripChanged) {
          const oldTrail = trailsRef.current[id];
          if (oldTrail) map.removeLayer(oldTrail);
          trailsRef.current[id] = L.polyline([d.lastLatlng], {
            color: colorFor(id),
            weight: 4,
            opacity: 0.45,
          }).addTo(map);
        }
        activeCardRef.current[id] = cardKey;

        const name =
          card?.full_name ||
          id.slice(0, 8);

        const initials =
          getInitials(name);

        const color = colorFor(id);

        // Create marker
        if (!markersRef.current[id]) {
          const marker = L.marker(
            d.lastLatlng,
            {
              icon: makeLiveIcon(
                color,
                initials
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

          // Trail was already created above if this is a fresh trip
          // boundary; otherwise this is a genuinely brand-new device,
          // seed its trail here.
          if (!trailsRef.current[id]) {
            trailsRef.current[id] =
              L.polyline(
                [d.lastLatlng],
                {
                  color,
                  weight: 4,
                  opacity: 0.45,
                }
              ).addTo(map);
          }
        } else {
          // Update marker
          markersRef.current[id].setLatLng(
            d.lastLatlng
          );

          markersRef.current[id].setIcon(
            makeLiveIcon(
              color,
              initials
            )
          );

          markersRef.current[id].setPopupContent(
            popupHtml(name, card, id)
          );

          // Update trail
          const trail =
            trailsRef.current[id];

          if (trail) {
            const latlngs =
              trail.getLatLngs();

            latlngs.push(d.lastLatlng);

            trail.setLatLngs(latlngs);
          }
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
  }, [devices, travelCards, follow]);

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