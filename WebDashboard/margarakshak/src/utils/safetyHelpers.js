/** Safety status configuration for UI rendering */
export const SAFETY_STATUS = {
  safe: {
    label: "Safe",
    color: "#16a34a",
    bgColor: "#f0fdf4",
    borderColor: "#bbf7d0",
    dotClass: "safety-dot-safe",
  },
  caution: {
    label: "Caution",
    color: "#d97706",
    bgColor: "#fffbeb",
    borderColor: "#fde68a",
    dotClass: "safety-dot-caution",
  },
  unsafe: {
    label: "Unsafe",
    color: "#dc2626",
    bgColor: "#fef2f2",
    borderColor: "#fecaca",
    dotClass: "safety-dot-unsafe",
  },
};

export function getSafetyConfig(status) {
  return SAFETY_STATUS[status] || SAFETY_STATUS.safe;
}

/** Risk factor type to human label */
export const RISK_FACTOR_LABELS = {
  emergency_distance: "Far from emergency services",
  isolation: "Isolated area",
  hazard_zone: "Near hazard zone",
  unsafe_zone: "Reported unsafe area",
  poor_lighting: "Poorly lit area",
  no_road_access: "Limited road access",
  flood_zone: "Flood-prone area",
  restricted_area: "Restricted area",
};

export function getRiskFactorLabel(type) {
  return RISK_FACTOR_LABELS[type] || type;
}

/** Format distance for display */
export function formatSafetyDistance(km) {
  if (km == null) return "—";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
