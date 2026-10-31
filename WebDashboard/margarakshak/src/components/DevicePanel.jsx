import { cardForDevice } from "../utils/helpers";
import SafetyBadge from "./SafetyBadge";

const RISK_LEVELS = [
  { max: 0.05, label: "Critical", color: "#dc2626" },
  { max: 0.10, label: "Concern", color: "#ea580c" },
  { max: 0.25, label: "Watch", color: "#ca8a04" },
  { max: Infinity, label: "Normal", color: "#16a34a" },
];

const ACTIVITY_LABELS = {
  WALKING: "Walking",
  RESTING: "Resting",
  IN_VEHICLE: "In vehicle",
  MOVING: "Moving",
  STOPPED: "Stopped",
  ERRATIC: "Erratic / Distress",
};
const ACTIVITY_STALE_MS = 3 * 60 * 1000;

// What to show in the Activity metric. A row that has not been touched for a
// few minutes describes the past, not the present, so it is not shown as the
// current state.
function activityView(activity, device) {
  const live = device?.freshnessStatus === "LIVE" || device?.freshnessStatus === "DELAYED";
  if (!activity) return { label: live ? "Detecting…" : "—", duration: "—", stale: false };
  const age = Date.now() - new Date(activity.updatedAt).getTime();
  if (age > ACTIVITY_STALE_MS) return { label: "—", duration: "—", stale: true };
  if (!activity.currentState) return { label: "Detecting…", duration: "—", stale: false };
  return {
    label: ACTIVITY_LABELS[activity.currentState] ?? activity.currentState,
    duration: activity.durationMinutes ?? "—",
    stale: false,
  };
}

function riskLevel(tailProbability) {
  if (tailProbability === undefined || tailProbability === null) return null;
  return RISK_LEVELS.find((level) => tailProbability < level.max) ?? RISK_LEVELS[RISK_LEVELS.length - 1];
}

export default function DevicePanel({
  device,
  name,
  travelCards = [],
  activity,
  onOpenNearby,
  safetyAssessment,
  onOpenSafety,
  onToggleLayers,
  mapLayersOpen,
}) {
  if (!device) return null;
  const card = cardForDevice(travelCards, name, device);
  const displayName = card?.full_name || name?.slice(0, 12) + "…";
  const view = activityView(activity, device);
  const risk = view.stale ? null : riskLevel(activity?.tailProbability);

  return (
    <div className="device-panel visible">
      <div className="panel-row">
        <div className="panel-left">
          <div className="panel-name">
            {displayName}
            {risk && (
              <span
                className="panel-risk-badge"
                style={{
                  marginLeft: 8,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#fff",
                  backgroundColor: risk.color,
                }}
                title={`Tail probability: ${activity.tailProbability}`}
              >
                {risk.label}
              </span>
            )}
            {safetyAssessment && (
              <SafetyBadge status={safetyAssessment.safety_status} size="large" />
            )}
          </div>
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
        <div className="panel-right">
          <div className="panel-metrics">
            <Metric label="Speed" value={device.speed?.toFixed(1) ?? "—"} unit="km/h" />
            <Metric label="Accuracy" value={device.accuracy?.toFixed(0) ?? "—"} unit="m" />
            <Metric label="Updates" value={device.updates ?? "—"} />
            <Metric label="Activity" value={view.label} />
            <Metric label="Duration" value={view.duration} unit={view.duration === "—" ? undefined : "min"} />
          </div>

          <div className="panel-actions">
            <button className="nearby-trigger-btn" onClick={() => onOpenNearby?.({ lat: device.lastLatlng?.[0], lon: device.lastLatlng?.[1], name: displayName })}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            Nearby Help
            </button>

            <button
              className="safety-trigger-btn"
              onClick={() => onOpenSafety?.(safetyAssessment)}
              disabled={!safetyAssessment}
              title={safetyAssessment ? "Open safety details" : "No safety assessment is available yet"}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              Safety Details
            </button>
            <button className={`map-layer-trigger-btn ${mapLayersOpen ? "active" : ""}`} onClick={onToggleLayers}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 8 4.5-8 4.5-8-4.5L12 2Z"/><path d="m4 12 8 4.5 8-4.5"/><path d="m4 17.5 8 4.5 8-4.5"/></svg>
              Map layers
            </button>
          </div>
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
