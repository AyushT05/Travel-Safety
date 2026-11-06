import { useState } from "react";
import { insightIsFresh } from "../hooks/useTripInsights";
import "./insights.css";

const LABEL = { normal: "On track", watch: "Worth a look", alert: "Needs attention" };
const KIND = {
  route_deviation: "Off route", abrupt_stop: "Abrupt stop", unplanned_stop: "Long stop", signal_lost: "Signal lost",
  signal_restored: "Signal back", repeated_signal_gaps: "Signal gaps", circling: "Circling", erratic_movement: "Erratic",
  high_speed: "High speed", in_hazard_zone: "In hazard zone", approaching_hazard: "Nearing hazard", gps_jump: "GPS jump",
  gps_degraded: "Weak GPS", unsafe_area: "Unsafe area", isolated_at_night: "Isolated at night",
  traveller_confirmed_ok: "Traveller: OK", traveller_needs_help: "Traveller: needs help",
};
const ago = (iso) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`; };

// Compact AI read-out for the selected traveller: where they are, where they are heading, route adherence
// and any abnormal events, with what the traveller was told.
export default function TripInsightCard({ insight }) {
  const [open, setOpen] = useState(false);
  if (!insight) return null;
  const fresh = insightIsFresh(insight);
  const status = fresh ? insight.status : "normal";
  const events = (insight.abnormal_events || []).filter((e) => e.kind !== "traveller_confirmed_ok" || open);
  const rt = insight.situation?.route || {};
  return (
    <div className={`ti-card ti-${status}`}>
      <div className="ti-top" onClick={() => setOpen(!open)}>
        <span className="ti-pill">{fresh ? LABEL[insight.status] : "Analysis out of date"}</span>
        <div className="ti-main">
          <div className="ti-headline">{insight.headline}</div>
          <div className="ti-sub">
            {insight.source === "llm" ? "AI analysis" : "Automatic analysis"} · {ago(insight.updated_at)}
            {rt.eta_min ? ` · ETA ${rt.eta_min} min` : ""}
          </div>
        </div>
        <span className="ti-chev">{open ? "▴" : "▾"}</span>
      </div>
      {events.length > 0 && (
        <div className="ti-chips">
          {events.slice(0, open ? 20 : 4).map((e) => (
            <span key={e.id} className={`ti-chip sev-${e.severity}`} title={e.text}>{KIND[e.kind] || e.kind}</span>
          ))}
        </div>
      )}
      {open && (
        <div className="ti-body">
          <p>{insight.admin_summary}</p>
          {events.map((e) => (
            <div key={e.id} className="ti-event">
              <strong>{KIND[e.kind] || e.kind}</strong> <span className="ti-time">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <div>{e.text}</div>
              {e.explanation && <div className="ti-expl">{e.explanation}</div>}
            </div>
          ))}
          {(insight.explanations || []).length > 0 && (
            <><h5>Could also be</h5><ul>{insight.explanations.map((t, i) => <li key={i}>{t}</li>)}</ul></>
          )}
          {(insight.admin_actions || []).length > 0 && (
            <><h5>Suggested checks</h5><ul>{insight.admin_actions.map((a, i) => (
              <li key={i}>{a.detail}{a.needs_approval && <em> (needs authorised approval)</em>}</li>))}</ul></>
          )}
          {insight.user_message && <><h5>Message sent to the traveller</h5><p className="ti-user">“{insight.user_message}”</p></>}
          {insight.llm_error && <div className="ti-debug">AI wording not used: {insight.llm_error}</div>}
          <div className="ti-disclaimer">These are signals, not findings. A person decides whether anyone needs help.</div>
        </div>
      )}
    </div>
  );
}
