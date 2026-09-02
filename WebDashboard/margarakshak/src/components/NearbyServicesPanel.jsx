import { useState, useEffect, useCallback, useRef } from "react";
import { fetchNearbyServices } from "../utils/nearbyServices";

// SVG icons for each category
function HospitalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M17 7v10M7 7v10M2 12h20"/>
    </svg>
  );
}

function PoliceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
}

function FireIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
    </svg>
  );
}

function PharmacyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
      <path d="M9 12h6M12 9v6"/>
    </svg>
  );
}

function ClinicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  );
}

const ICON_COMPONENTS = {
  hospital: HospitalIcon,
  police: PoliceIcon,
  fire_station: FireIcon,
  pharmacy: PharmacyIcon,
  clinic: ClinicIcon,
};

const CATEGORY_COLORS = {
  hospital: '#DC2626',
  police: '#2563EB',
  fire_station: '#EA580C',
  pharmacy: '#059669',
  clinic: '#7C3AED',
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <span className="nearby-title">Emergency Services Nearby</span>
        </span>
        <span className="nearby-header-right">
          {totalCount > 0 && <span className="nearby-badge">{totalCount}</span>}
          <svg className={`nearby-chevron ${expanded ? "open" : ""}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
              <button className="nearby-retry" onClick={load}>Retry</button>
            </div>
          )}

          {data && data.map((group) => {
            const isOpen = openCat === group.category;
            const shown  = isOpen ? group.places : group.places.slice(0, 3);
            const IconComponent = ICON_COMPONENTS[group.category];
            const color = CATEGORY_COLORS[group.category];

            return (
              <div key={group.category} className="nearby-cat">
                <button
                  className="nearby-cat-header"
                  onClick={() => setOpenCat((v) => v === group.category ? null : group.category)}
                >
                  <span className="nearby-cat-icon" style={{ color }}>
                    <IconComponent />
                  </span>
                  <span className="nearby-cat-label">{group.label}</span>
                  <span className="nearby-cat-count">{group.places.length}</span>
                  <svg className={`nearby-chevron small ${isOpen ? "open" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
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
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="7" y1="17" x2="17" y2="7"/>
                        <polyline points="7 7 17 7 17 17"/>
                      </svg>
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
              {loading ? (
                <>
                  <span className="nearby-spinner" />
                  Loading…
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  Refresh
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
