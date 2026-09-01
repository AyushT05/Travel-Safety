import { useState, useEffect, useCallback, useRef } from "react";
import { fetchNearbyServices } from "../utils/nearbyServices";

const ICON_MAP = {
  hospital:     "🏥",
  police:       "🚔",
  fire_station: "🚒",
  pharmacy:     "💊",
  clinic:       "🩺",
};

function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function gmapsLink(lat, lon) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

/**
 * Panel shown below DevicePanel that lists nearby emergency services
 * for the selected device's current location.
 *
 * Props:
 *   lat, lon — from device.lastLatlng
 */
export default function NearbyServicesPanel({ lat, lon }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [openCat, setOpenCat]   = useState(null);

  const lastFetch = useRef({ lat: null, lon: null, ts: 0 });

  const shouldRefetch = useCallback(() => {
    const { lat: pLat, lon: pLon, ts } = lastFetch.current;
    if (pLat === null) return true;
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat - pLat);
    const dLon = toRad(lon - pLon);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(pLat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
    const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return distKm > 2.0 || Date.now() - ts > 300_000;
  }, [lat, lon]);

  const load = useCallback(async () => {
    if (!shouldRefetch()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchNearbyServices(lat, lon, 5000);
      setData(result);
      lastFetch.current = { lat, lon, ts: Date.now() };
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [lat, lon, shouldRefetch]);

  useEffect(() => {
    if (expanded && lat != null && lon != null) load();
  }, [expanded, lat, lon, load]);

  // Reset when device changes
  useEffect(() => {
    setData(null);
    setOpenCat(null);
    lastFetch.current = { lat: null, lon: null, ts: 0 };
  }, [lat, lon]);

  if (lat == null || lon == null) return null;

  const totalCount = data ? data.reduce((s, g) => s + g.places.length, 0) : 0;

  return (
    <div className="nearby-panel">
      {/* Header */}
      <button className="nearby-header" onClick={() => setExpanded((v) => !v)}>
        <span className="nearby-header-left">
          <span className="nearby-icon">📍</span>
          <span className="nearby-title">Nearby Emergency Services</span>
        </span>
        <span className="nearby-header-right">
          {totalCount > 0 && <span className="nearby-badge">{totalCount}</span>}
          <span className={`nearby-chevron ${expanded ? "open" : ""}`}>▾</span>
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="nearby-body">
          {loading && !data && (
            <div className="nearby-loading">
              <span className="nearby-spinner" />
              Searching nearby…
            </div>
          )}

          {error && (
            <div className="nearby-error">
              ⚠️ {error}
              <button className="nearby-retry" onClick={load}>Retry</button>
            </div>
          )}

          {data && data.map((group) => {
            const isOpen = openCat === group.category;
            const shown  = isOpen ? group.places : group.places.slice(0, 3);

            return (
              <div key={group.category} className="nearby-cat">
                <button
                  className="nearby-cat-header"
                  onClick={() => setOpenCat((v) => v === group.category ? null : group.category)}
                >
                  <span className="nearby-cat-icon">{ICON_MAP[group.category]}</span>
                  <span className="nearby-cat-label">{group.label}</span>
                  <span className="nearby-cat-count">{group.places.length}</span>
                  <span className={`nearby-chevron small ${isOpen ? "open" : ""}`}>▾</span>
                </button>

                {group.places.length === 0 && (
                  <div className="nearby-empty">None within 5 km</div>
                )}

                {shown.map((p, i) => (
                  <div key={`${p.lat}-${p.lon}-${i}`} className="nearby-place">
                    <div className="nearby-place-info">
                      <div className="nearby-place-name">{p.name}</div>
                      <div className="nearby-place-dist">{formatDistance(p.distanceKm)}</div>
                    </div>
                    <a
                      className="nearby-nav-link"
                      href={gmapsLink(p.lat, p.lon)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open in Google Maps"
                    >
                      ↗
                    </a>
                  </div>
                ))}

                {!isOpen && group.places.length > 3 && (
                  <button
                    className="nearby-show-more"
                    onClick={() => setOpenCat(group.category)}
                  >
                    +{group.places.length - 3} more
                  </button>
                )}
              </div>
            );
          })}

          {data && (
            <button className="nearby-refresh" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
