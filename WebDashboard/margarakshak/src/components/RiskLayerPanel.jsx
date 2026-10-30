import { useState } from "react";
import "./riskLayers.css";

const HOURS = [[24, "24 hours"], [24 * 7, "7 days"], [24 * 30, "30 days"]];

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RiskLayerPanel({ options, setOptions, stats }) {
  const [open, setOpen] = useState(true);
  const set = (patch) => setOptions((o) => ({ ...o, ...patch }));
  const toggle = (key) => () => set({ [key]: !options[key] });

  return (
    <div className="rl-panel">
      <button className="rl-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Map layers</span><span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="rl-body">
          <label className="rl-row"><input type="checkbox" checked={options.riskHeat} onChange={toggle("riskHeat")} />Risk heat map</label>
          <label className="rl-row"><input type="checkbox" checked={options.zoneOutlines} onChange={toggle("zoneOutlines")} />Zone outlines</label>
          {options.zoneOutlines && (
            <label className="rl-row rl-sub"><input type="checkbox" checked={options.showInactive} onChange={toggle("showInactive")} />Show zones not risky at this time</label>
          )}

          <label className="rl-row"><input type="checkbox" checked={options.clusters} onChange={toggle("clusters")} />Tourist clusters</label>
          <label className="rl-row"><input type="checkbox" checked={options.density} onChange={toggle("density")} />Tourist density</label>

          <label className="rl-row"><input type="checkbox" checked={options.alertHeat} onChange={toggle("alertHeat")} />Past alerts heat map</label>
          {options.alertHeat && (
            <div className="rl-sub">
              <div className="rl-chips">
                {[["panic", "SOS"], ["geofence_entry", "Zone entries"], ["dropout", "Dropouts"]].map(([k, label]) => (
                  <button key={k} className={"rl-chip" + (options.alertTypes.includes(k) ? " on" : "")}
                    onClick={() => set({ alertTypes: options.alertTypes.includes(k) ? options.alertTypes.filter((x) => x !== k) : [...options.alertTypes, k] })}>{label}</button>
                ))}
              </div>
              <select value={options.alertHours} onChange={(e) => set({ alertHours: Number(e.target.value) })}>
                {HOURS.map(([h, label]) => <option key={h} value={h}>Last {label}</option>)}
              </select>
              <div className="rl-note">{stats.alertCount} alerts with a position</div>
            </div>
          )}

          <div className="rl-time">
            <div className="rl-label">Risk shown for</div>
            <div className="rl-chips">
              <button className={"rl-chip" + (!options.at ? " on" : "")} onClick={() => set({ at: null })}>Now</button>
              <input type="datetime-local" value={options.at ? toLocalInput(options.at) : ""}
                onChange={(e) => set({ at: e.target.value ? new Date(e.target.value) : null })} />
            </div>
            <div className="rl-note">Lighting hazards matter after dark; pick an evening time to preview.</div>
          </div>

          <div className="rl-legend">
            <div className="rl-bar" />
            <div className="rl-scale"><span>low</span><span>high</span></div>
          </div>
          <div className="rl-stats">
            {stats.loading ? "Loading zones..." : `${stats.activeZones} zones risky now, ${stats.inactiveZones} not at this time`}
            {stats.error && <div className="rl-error">Could not refresh zones: {stats.error}</div>}
          </div>
          <div className="rl-note">
            Shows hazards recorded in the system, not predictions. An area with no colour has no recorded hazard, which does not mean it is safe.
          </div>
        </div>
      )}
    </div>
  );
}
