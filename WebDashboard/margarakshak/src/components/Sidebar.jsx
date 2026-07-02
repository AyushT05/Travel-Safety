import { useState } from "react";
import DeviceCard from "./DeviceCard";
import { useAuth } from "../context/AuthContext";

export default function Sidebar({
  devices,
  selected,
  onSelect,
  onManageIds,
  travelCards = [],
}) {
  const { auth } = useAuth();

  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [expandedCard, setExpandedCard] = useState(null);

  const isAdmin = auth?.role === "admin";
  const trackedIds = auth?.trackedIds || [];

  let visibleNames = Object.keys(devices);

  if (!isAdmin) {
    visibleNames = visibleNames.filter((n) =>
      trackedIds.includes(n)
    );
  }

  if (isAdmin && search.trim()) {
    const q = search.toLowerCase();

    visibleNames = visibleNames.filter((n) => {
      const card = travelCards.find((c) => c.user_id === n);

      return (
        n.toLowerCase().includes(q) ||
        card?.full_name?.toLowerCase().includes(q)
      );
    });
  }

  function copyId() {
    navigator.clipboard.writeText(auth.id);
    setCopied(true);

    setTimeout(() => setCopied(false), 2000);
  }

  function handleSelect(name) {
    onSelect(name);

    const card = travelCards.find((c) => c.user_id === name);

    setExpandedCard(card || null);
  }

  // Get display name for a device
  function getDisplayName(deviceId) {
    const card = travelCards.find((c) => c.user_id === deviceId);

    return card?.full_name || null;
  }

  return (
    <aside>
      <div className="sidebar-header">
        <div className="sidebar-title-row">
          <div className="sidebar-title">
            {isAdmin ? "All Devices" : "Tracked Devices"}
          </div>

          {isAdmin && (
            <span className="sidebar-count">
              {visibleNames.length}
            </span>
          )}
        </div>

        {/* My ID card — regular users only */}
        {!isAdmin && (
          <div className="my-id-card">
            <div className="my-id-label">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="2" />
                <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
              </svg>

              Your Device ID
            </div>

            <div className="my-id-desc">
              Share this ID with someone to let them track you
            </div>

            <div className="my-id-row">
              <span className="my-id-value">{auth?.id}</span>

              <button
                className="my-id-copy"
                onClick={copyId}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {/* Admin search */}
        {isAdmin && (
          <div className="sidebar-search">
            <svg
              className="sidebar-search-icon"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line
                x1="21"
                y1="21"
                x2="16.65"
                y2="16.65"
              />
            </svg>

            <input
              className="sidebar-search-input"
              placeholder="Search by name or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {search && (
              <button
                className="sidebar-search-clear"
                onClick={() => setSearch("")}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Manage IDs button */}
        {!isAdmin && (
          <button
            className="sidebar-manage-btn"
            onClick={onManageIds}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>

            Manage IDs
          </button>
        )}
      </div>

      <div className="device-list">
        {visibleNames.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon-wrap">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#9E9484"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {isAdmin ? (
                  <>
                    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                    <line
                      x1="12"
                      y1="20"
                      x2="12"
                      y2="20.01"
                    />
                  </>
                ) : (
                  <>
                    <rect
                      x="5"
                      y="2"
                      width="14"
                      height="20"
                      rx="2"
                    />
                    <line
                      x1="12"
                      y1="18"
                      x2="12"
                      y2="18.01"
                    />
                  </>
                )}
              </svg>
            </div>

            <div className="empty-label">
              {isAdmin
                ? search
                  ? "No devices match your search."
                  : "Waiting for devices..."
                : "No tracked devices yet."}
            </div>

            {!isAdmin && (
              <div className="empty-sub">
                Add a device ID to start tracking
              </div>
            )}
          </div>
        )}

        {visibleNames.map((name) => (
          <DeviceCard
            key={name}
            name={name}
            displayName={getDisplayName(name)}
            data={devices[name]}
            selected={name === selected}
            onClick={() => handleSelect(name)}
          />
        ))}
      </div>

      {/* Travel card detail panel */}
      {selected && expandedCard && (
        <TravelCardDetail
          card={expandedCard}
          onClose={() => {
            setExpandedCard(null);
            onSelect(null);
          }}
        />
      )}
    </aside>
  );
}

function TravelCardDetail({ card, onClose }) {
  const today = new Date().toISOString().split("T")[0];

  const isActive =
    card.start_date <= today &&
    card.end_date >= today;

  const isUpcoming = card.start_date > today;

  const statusLabel = isActive
    ? "Active"
    : isUpcoming
    ? "Upcoming"
    : "Completed";

  const statusClass = isActive
    ? "status-active"
    : isUpcoming
    ? "status-upcoming"
    : "status-done";

  return (
    <div className="travel-detail">
      <div className="travel-detail-header">
        <div className="travel-detail-title">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#1B4332"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
            <circle cx="12" cy="10" r="3" />
          </svg>

          Travel Card
        </div>

        <button
          className="travel-detail-close"
          onClick={onClose}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="travel-detail-body">
        <div className="td-name-row">
          <div className="td-name">
            {card.full_name}
          </div>

          <span className={`td-status ${statusClass}`}>
            {statusLabel}
          </span>
        </div>

        <div className="td-mobile">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect
              x="5"
              y="2"
              width="14"
              height="20"
              rx="2"
            />
            <line
              x1="12"
              y1="18"
              x2="12"
              y2="18.01"
            />
          </svg>

          {card.mobile}
        </div>

        <DetailSection
          icon="calendar"
          label="Travel Dates"
        >
          {formatDate(card.start_date)} →{" "}
          {formatDate(card.end_date)}
        </DetailSection>

        {card.places?.length > 0 && (
          <DetailSection
            icon="map-pin"
            label="Destinations"
          >
            <div className="td-places">
              {card.places.map((p, i) => (
                <span
                  key={i}
                  className="td-place-chip"
                >
                  {p}
                </span>
              ))}
            </div>
          </DetailSection>
        )}

        {card.companions?.length > 0 && (
          <DetailSection
            icon="users"
            label="Companions"
          >
            {card.companions.map((c, i) => (
              <div
                key={i}
                className="td-person"
              >
                {c.name}

                {c.phone ? (
                  <span className="td-person-phone">
                    {c.phone}
                  </span>
                ) : null}
              </div>
            ))}
          </DetailSection>
        )}

        {card.emergency_contacts?.length > 0 && (
          <DetailSection
            icon="phone-call"
            label="Emergency Contacts"
          >
            {card.emergency_contacts.map((c, i) => (
              <div
                key={i}
                className="td-person td-emergency"
              >
                {c.name}

                <span className="td-person-phone">
                  {c.phone}
                </span>
              </div>
            ))}
          </DetailSection>
        )}

        {card.document_type && (
          <DetailSection
            icon="file-text"
            label="ID Document"
          >
            {card.document_type}
          </DetailSection>
        )}
      </div>
    </div>
  );
}

function DetailSection({ icon, label, children }) {
  const icons = {
    calendar: (
      <>
        <rect
          x="3"
          y="4"
          width="18"
          height="18"
          rx="2"
        />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    ),

    "map-pin": (
      <>
        <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
        <circle cx="12" cy="10" r="3" />
      </>
    ),

    users: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),

    "phone-call": (
      <>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.4a16 16 0 0 0 6.09 6.09l.97-.97a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </>
    ),

    "file-text": (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </>
    ),
  };

  return (
    <div className="td-section">
      <div className="td-section-label">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icons[icon]}
        </svg>

        {label}
      </div>

      <div className="td-section-content">
        {children}
      </div>
    </div>
  );
}

function formatDate(d) {
  if (!d) return "";

  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}