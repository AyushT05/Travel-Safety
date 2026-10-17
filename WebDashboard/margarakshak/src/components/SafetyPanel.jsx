import { getSafetyConfig, getRiskFactorLabel, formatSafetyDistance } from "../utils/safetyHelpers";
import SafetyBadge from "./SafetyBadge";

export default function SafetyPanel({ assessment, onClose }) {
  if (!assessment) return null;
  const config = getSafetyConfig(assessment.safety_status);
  const riskFactors = assessment.risk_factors || [];
  const matchedZones = assessment.matched_unsafe_zones || [];
  const riskPercent = Math.round((assessment.risk_score || 0) * 100);

  return (
    <div className="safety-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="safety-panel">
        <div className="safety-panel-header">
          <div className="safety-panel-title">Safety Assessment</div>
          <button className="safety-panel-close" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="safety-panel-body">
          {/* Status header */}
          <div className="safety-status-header" style={{ backgroundColor: config.bgColor, borderColor: config.borderColor }}>
            <SafetyBadge status={assessment.safety_status} size="large" />
            <div className="safety-score-row">
              <span className="safety-score-label">Risk Score</span>
              <span className="safety-score-value" style={{ color: config.color }}>{riskPercent}%</span>
            </div>
            <div className="safety-score-bar">
              <div
                className="safety-score-fill"
                style={{ width: `${riskPercent}%`, backgroundColor: config.color }}
              />
            </div>
          </div>

          {/* Heading warning */}
          {assessment.heading_warning && (
            <div className="safety-heading-warning">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>{assessment.heading_warning}</span>
            </div>
          )}

          {/* Risk factors */}
          {riskFactors.length > 0 && (
            <div className="safety-section">
              <div className="safety-section-title">Risk Factors</div>
              {riskFactors.map((factor, i) => (
                <div key={i} className={`safety-factor severity-${factor.severity}`}>
                  <div className="safety-factor-dot" />
                  <div className="safety-factor-info">
                    <div className="safety-factor-label">{getRiskFactorLabel(factor.type)}</div>
                    {factor.label && factor.label !== getRiskFactorLabel(factor.type) && (
                      <div className="safety-factor-detail">{factor.label}</div>
                    )}
                  </div>
                  {factor.distance_km != null && (
                    <div className="safety-factor-dist">{formatSafetyDistance(factor.distance_km)}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Emergency distances */}
          <div className="safety-section">
            <div className="safety-section-title">Nearest Emergency Services</div>
            <div className="safety-emergency-grid">
              <EmergencyDist label="Police" distance={assessment.nearest_police_km} />
              <EmergencyDist label="Hospital" distance={assessment.nearest_hospital_km} />
              <EmergencyDist label="Fire Station" distance={assessment.nearest_fire_km} />
            </div>
          </div>

          {/* Matched unsafe zones */}
          {matchedZones.length > 0 && (
            <div className="safety-section">
              <div className="safety-section-title">Reported Incidents Nearby</div>
              {matchedZones.map((zone, i) => (
                <div key={i} className="safety-zone-item">
                  <div className="safety-zone-category">{zone.category}</div>
                  <div className="safety-zone-desc">{zone.description || "No description"}</div>
                  {zone.distance_km != null && (
                    <div className="safety-zone-dist">{formatSafetyDistance(zone.distance_km)} away</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Assessed at timestamp */}
          <div className="safety-timestamp">
            Last assessed: {new Date(assessment.assessed_at).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmergencyDist({ label, distance }) {
  const isClose = distance != null && distance < 5;
  const isFar = distance != null && distance > 10;
  return (
    <div className="safety-emergency-item">
      <div className="safety-emergency-label">{label}</div>
      <div
        className="safety-emergency-value"
        style={{ color: isFar ? "#dc2626" : isClose ? "#16a34a" : "#d97706" }}
      >
        {formatSafetyDistance(distance)}
      </div>
    </div>
  );
}
