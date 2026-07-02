export default function DevicePanel({ device, name, travelCards = [] }) {
  if (!device) return null;
  const card = travelCards.find(c => c.user_id === name);
  const displayName = card?.full_name || name?.slice(0, 12) + "…";

  return (
    <div className="device-panel visible">
      <div className="panel-row">
        <div className="panel-left">
          <div className="panel-name">{displayName}</div>
          <div className="panel-coords">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {device.lastLatlng?.map(v => v.toFixed(5)).join(", ")}
          </div>
          {card && (
            <div className="panel-card-info">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              {card.start_date} → {card.end_date}
              {card.places?.length > 0 && (
                <span className="panel-route"> · {card.places.join(" → ")}</span>
              )}
            </div>
          )}
        </div>
        <div className="panel-metrics">
          <Metric label="Speed" value={device.speed?.toFixed(1) ?? "—"} unit="km/h" />
          <Metric label="Accuracy" value={device.accuracy?.toFixed(0) ?? "—"} unit="m" />
          <Metric label="Updates" value={device.updates ?? "—"} />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, unit }) {
  return (
    <div className="panel-metric">
      <div className="panel-metric-label">{label}</div>
      <div className="panel-metric-value">
        {value}
        {unit && <span className="panel-metric-unit"> {unit}</span>}
      </div>
    </div>
  );
}