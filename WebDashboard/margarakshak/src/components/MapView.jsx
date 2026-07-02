import {
  useEffect,
  useRef,
} from "react";

import L from "leaflet";
import { colorFor } from "../utils/helpers";

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
  follow,
  setMapActions,
}) {
  const mapRef = useRef(null);

  const leafletMap = useRef(null);

  const markersRef = useRef({});

  const trailsRef = useRef({});

  const initializedRef = useRef(false);

  // Initialize map
  useEffect(() => {
    if (leafletMap.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: false,
    }).setView([20, 78], 5);

    L.control.zoom({
      position: "bottomright",
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

    Object.entries(devices).forEach(
      ([id, d]) => {
        if (!d.lastLatlng) return;

        const card = travelCards.find(
          (c) => c.user_id === id
        );

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
            `
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
          `,
            {
              maxWidth: 220,
            }
          );

          markersRef.current[id] =
            marker;

          // Create initial trail
          trailsRef.current[id] =
            L.polyline(
              [d.lastLatlng],
              {
                color,
                weight: 4,
                opacity: 0.45,
              }
            ).addTo(map);
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