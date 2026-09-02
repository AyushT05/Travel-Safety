import { useEffect, useState } from "react";
import useNearbyServices from "../hooks/Usenearbyservices";

function formatDistance(m) {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

function gmapsLink(lat, lon) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

export default function NearbyServicesPanel({ lat, lon, name, onClose }) {
  const { data, loading, error, search, CATEGORY_META } = useNearbyServices();
  const [activeTab, setActiveTab] = useState("hospital");

  useEffect(() => {
    if (lat != null && lon != null) search(lat, lon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon]);

  const categoryKeys = Object.keys(CATEGORY_META);
  const items = data?.categories?.[activeTab] || [];

  return (
    <div className="nearby-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nearby-slideover">
        <div className="nearby-slideover-header">
          <div>
            <div className="nearby-slideover-title">Nearby Help</div>
            {name && <div className="nearby-slideover-subtitle">for {name}</div>}
          </div>
          <button className="nearby-slideover-close" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="nearby-tabs">
          {categoryKeys.map((key) => {
            const count = data?.categories?.[key]?.length ?? null;
            return (
              <button
                key={key}
                className={`nearby-tab ${activeTab === key ? "active" : ""}`}
                style={activeTab === key ? { background: CATEGORY_META[key].color, borderColor: CATEGORY_META[key].color } : undefined}
                onClick={() => setActiveTab(key)}
              >
                <span className="nearby-tab-dot" style={{ background: CATEGORY_META[key].color }} />
                {CATEGORY_META[key].label}
                {count !== null && <span className="nearby-tab-count">{count}</span>}
              </button>
            );
          })}
        </div>

        <div className="nearby-slideover-body">
          {loading && (
            <div className="nearby-loading-state">
              <span className="nearby-spinner-lg" />
              <div>Searching nearby…</div>
            </div>
          )}

          {!loading && error && (
            <div className="nearby-error-state">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div>{error}</div>
              <button className="nearby-retry-btn" onClick={() => search(lat, lon)}>Try again</button>
            </div>
          )}

          {!loading && !error && data && items.length === 0 && (
            <div className="nearby-empty-state">
              Nothing found within 5 km.
            </div>
          )}

          {!loading && !error && items.map((place) => (
            <div key={place.id} className="nearby-card">
              <div
                className="nearby-card-icon"
                style={{ background: `${CATEGORY_META[activeTab].color}1A`, color: CATEGORY_META[activeTab].color }}
              >
                {CATEGORY_META[activeTab].label.charAt(0)}
              </div>
              <div className="nearby-card-body">
                <div className="nearby-card-name">{place.name}</div>
                <div className="nearby-card-meta">
                  {formatDistance(place.distance_m)}
                  {place.address && ` · ${place.address}`}
                </div>
              </div>
              <div className="nearby-card-actions">
                {place.phone && (
                  <a className="nearby-card-btn filled" href={`tel:${place.phone}`} title="Call">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                  </a>
                )}
                <a
                  className="nearby-card-btn"
                  href={gmapsLink(place.lat, place.lon)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Directions"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="3 11 22 2 13 21 11 13 3 11" />
                  </svg>
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}