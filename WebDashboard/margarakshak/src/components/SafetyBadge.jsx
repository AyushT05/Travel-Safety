import { getSafetyConfig } from "../utils/safetyHelpers";

export default function SafetyBadge({ status, size = "small" }) {
  if (!status) return null;
  const config = getSafetyConfig(status);
  const isLarge = size === "large";

  return (
    <span
      className={`safety-badge ${config.dotClass}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: isLarge ? 6 : 4,
        padding: isLarge ? "4px 10px" : "2px 8px",
        borderRadius: 999,
        fontSize: isLarge ? 12 : 10,
        fontWeight: 700,
        color: config.color,
        backgroundColor: config.bgColor,
        border: `1px solid ${config.borderColor}`,
        letterSpacing: "0.3px",
      }}
    >
      <span
        style={{
          width: isLarge ? 8 : 6,
          height: isLarge ? 8 : 6,
          borderRadius: "50%",
          backgroundColor: config.color,
          flexShrink: 0,
        }}
      />
      {config.label}
    </span>
  );
}
