import { getSafetyConfig } from "../utils/safetyHelpers";

export default function SafetyBadge({ status, size = "small" }) {
  if (!status) return null;
  const config = getSafetyConfig(status);
  return (
    <span
      className={`safety-badge sb-${size} ${config.dotClass}`}
      style={{ color: config.color, backgroundColor: config.bgColor, borderColor: config.borderColor }}
    >
      <i className="sb-dot" style={{ backgroundColor: config.color }} />
      {config.label}
    </span>
  );
}
