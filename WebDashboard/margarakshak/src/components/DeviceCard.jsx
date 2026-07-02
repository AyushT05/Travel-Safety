import { timeAgo, statusFor } from "../utils/helpers";

export default function DeviceCard({ name, displayName, data, selected, onClick }) {
  const status = statusFor(data.timestamp);

  return (
    <div className={`device-card ${selected ? "selected" : ""} ${status}`} onClick={onClick}>
      <div className="dc-header">
        <div className="dc-avatar" style={{ background: data.color }}>
          {(displayName || name).slice(0, 2).toUpperCase()}
        </div>
        <div className="dc-info">
          <div className="dc-name">{displayName || truncateId(name)}</div>
          <div className="dc-id-sub">{displayName ? truncateId(name) : ""}</div>
          <div className="dc-time">{timeAgo(data.timestamp)}</div>
        </div>
        <div className={`dc-status-dot ${status}`} title={status} />
      </div>

      {data.lastLatlng && (
        <div className="dc-coords">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16.01"/>
          </svg>
          {data.lastLatlng[0].toFixed(4)}, {data.lastLatlng[1].toFixed(4)}
        </div>
      )}
    </div>
  );
}

function truncateId(id) {
  if (!id || id.length <= 16) return id;
  return id.slice(0, 8) + "…" + id.slice(-4);
}