import { useState } from "react";
import "./incidents.css";

const KIND_LABEL = { trip_risk: "Trip review", panic: "SOS", zone_cluster: "Zone cluster" };
const DISMISS_REASONS = [
  ["expected_behaviour", "Expected behaviour"],
  ["known_dead_zone", "Known coverage gap"],
  ["tourist_confirmed_safe", "Tourist confirmed safe"],
  ["false_positive", "False positive"],
  ["duplicate", "Duplicate"],
  ["other", "Other"],
];

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};


const SOS_SOURCE = {
  app: "Manual SOS from the app",
  sms: "Manual SOS sent by SMS (phone had no data connection)",
  manual: "Manual SOS",
  system: "Automatic alert",
  auto: "Automatic alert: detected by the safety agent (no button pressed)",
};
const SERVICE_LABEL = { police: "Police", hospital: "Hospital", fire_station: "Fire station", clinic: "Clinic", pharmacy: "Pharmacy" };

export const isSos = (inc) => inc.kind === "panic" || (inc.kind === "trip_risk" && (inc.level === "high" || inc.level === "critical"));

// What the console needs in the first ten seconds of an SOS: where, what it is likely about, who to call.
function SosSummary({ inc, card, onFocus }) {
  const b = inc.brief || {};
  const lk = b.last_known;
  const manual = inc.kind === "panic";
  const sourceKey = manual ? b.sos_source || "app" : "auto";
  const contacts = (b.contacts_shared && b.contacts_shared.length ? b.contacts_shared : [
    ...(card?.mobile ? [{ role: "traveller", name: card.full_name, phone: card.mobile }] : []),
    ...(card?.emergency_contacts || []).filter((c) => c?.phone).map((c) => ({ role: "emergency_contact", name: c.name, relation: c.relation, phone: c.phone })),
  ]);
  const issues = b.likely_issues || [];
  const services = b.nearby_services || [];
  const numbers = b.emergency_numbers || [];
  const cond = b.conditions || {};
  return (
    <div className={`sos-box ${manual ? "manual" : "auto"}`}>
      <div className="sos-kicker">{manual ? "SOS" : "Automated alert"} · {SOS_SOURCE[sourceKey] || SOS_SOURCE.app}</div>

      <h4>Where it came from</h4>
      {lk ? (
        <p>
          <strong>{lk.location_name || "Place name not available yet"}</strong>
          <br />
          {lk.lat.toFixed(5)}, {lk.lon.toFixed(5)} · fix {ago(lk.at)}
          {lk.accuracy_m != null && ` · accuracy ${Math.round(lk.accuracy_m)} m`}
          {lk.source === "alert" && " · position sent with the SOS"}
          {lk.age_s > 300 && <span className="inc-badge warn">last known position is {Math.round(lk.age_s / 60)} min old</span>}
          {" "}
          {inc.user_id && <button className="inc-link" onClick={() => onFocus(inc.travel_card_id || inc.user_id)}>Show on map</button>}
        </p>
      ) : <p>No position was received with this alert.</p>}

      <h4>What could be the issue (from this location)</h4>
      {issues.length ? (
        <ul className="sos-issues">
          {issues.map((i) => (
            <li key={i.id}>
              <strong>{i.issue.replace(/^./, (c) => c.toUpperCase())}</strong>
              {i.confidence === "plausible" && <span className="inc-badge">more likely</span>}
              <ul>{i.why.map((w, k) => <li key={k}>{w}</li>)}</ul>
            </li>
          ))}
        </ul>
      ) : <p className="inc-sub">{b.likely_issues ? "Nothing about this location points to a specific cause. Ask the traveller." : "Working out the likely causes from the location…"}</p>}
      {(cond.night || cond.weather?.weather_code != null) && (
        <p className="inc-sub">
          {cond.night ? "After dark. " : ""}
          {cond.weather && cond.weather.apparent_temperature != null ? `Feels like ${Math.round(cond.weather.apparent_temperature)}°C` : ""}
          {cond.weather && cond.weather.precipitation ? `, rain ${cond.weather.precipitation} mm/h` : ""}
          {cond.weather && cond.weather.wind_gusts_10m ? `, gusts ${Math.round(cond.weather.wind_gusts_10m)} km/h` : ""}
        </p>
      )}

      <h4>Contact numbers shared by the traveller</h4>
      {contacts.length ? (
        <ul>
          {contacts.map((c, i) => (
            <li key={i}>
              {c.role === "traveller" ? "Traveller" : c.role === "companion" ? "Companion" : "Emergency contact"}
              {c.name ? ` · ${c.name}` : ""}{c.relation ? ` (${c.relation})` : ""}: <a className="inc-link" href={`tel:${c.phone}`}>{c.phone}</a>
            </li>
          ))}
        </ul>
      ) : <p className="inc-sub">The traveller did not share any contact numbers.</p>}

      <h4>Nearby services</h4>
      {services.length ? (
        <ul>
          {services.map((s, i) => (
            <li key={i}>
              {SERVICE_LABEL[s.category] || s.category}: {s.name || "unnamed"} · {s.distance_km} km
              {s.phone ? <> · <a className="inc-link" href={`tel:${s.phone}`}>{s.phone}</a></> : <span className="inc-sub"> · no number listed</span>}
            </li>
          ))}
        </ul>
      ) : <p className="inc-sub">{b.nearby_services ? "No services found within 8 km in the map data." : "Looking up nearby services…"}</p>}
      {numbers.length > 0 && (
        <p className="sos-numbers">
          {numbers.map((n) => (<a key={n.number} className="inc-link" href={`tel:${n.number}`} title={n.label}>{n.label.split(" (")[0]} {n.number}</a>))}
        </p>
      )}
    </div>
  );
}

function IncidentCard({ inc, card, onAct, onFocus }) {
  const [open, setOpen] = useState(inc.level === "critical" || inc.level === "high");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const brief = inc.brief;
  const contacts = card?.emergency_contacts || [];
  const name =
    inc.kind === "zone_cluster" ? `Zone #${inc.zone_id}` : card?.full_name || `${(inc.user_id || "").slice(0, 8)}…`;

  async function run(action, opts) {
    setBusy(true);
    setError(null);
    try {
      const result = await onAct(inc, action, opts);
      if (result?.error) {
        setError(`Failed to ${action}: ${result.error.message || 'Unknown error'}`);
      }
    } catch (e) {
      setError(`Failed to ${action}: ${e.message || 'Unknown error'}`);
      console.error(`Incident action ${action} failed:`, e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`inc-card lvl-${inc.level}`}>
      <div className="inc-card-top" onClick={() => setOpen(!open)}>
        <span className="inc-pill">{inc.level}</span>
        <div className="inc-main">
          <div className="inc-headline">{brief?.headline || inc.reasons?.[0] || "Incident"}</div>
          <div className="inc-sub">
            {KIND_LABEL[inc.kind] || inc.kind} · {name} · opened {ago(inc.opened_at)}
          </div>
        </div>
        <span className="inc-status">{inc.status}</span>
      </div>

      {open && (
        <div className="inc-body">
          {isSos(inc) && <SosSummary inc={inc} card={card} onFocus={onFocus} />}
          {brief ? (
            <>
              <h4>
                Summary
                <span className="inc-badge">{brief.source === "llm" ? "AI-assisted wording" : "Automatic summary"}</span>
              </h4>
              <p>{brief.summary}</p>

              <h4>Why this priority (score {inc.score})</h4>
              <ul>{(inc.reasons || []).map((r, i) => <li key={i}>{r}</li>)}</ul>

              <h4>Timeline</h4>
              <ul className="inc-timeline">
                {(brief.timeline || []).map((t, i) => (
                  <li key={i}><span className="inc-time">{fmtTime(t.at)}</span>{t.event}</li>
                ))}
              </ul>

              {!isSos(inc) && brief.last_known && (
                <>
                  <h4>Last known position</h4>
                  <p>
                    {brief.last_known.location_name && (
                      <><strong>{brief.last_known.location_name}</strong><br /></>
                    )}
                    {brief.last_known.lat.toFixed(5)}, {brief.last_known.lon.toFixed(5)} · {ago(brief.last_known.at)}
                    {brief.last_known.accuracy_m != null && ` · accuracy ${Math.round(brief.last_known.accuracy_m)} m`}{" "}
                    {inc.user_id && <button className="inc-link" onClick={() => onFocus(inc.travel_card_id || inc.user_id)}>Show on map</button>}
                  </p>
                </>
              )}

              {(brief.alternative_explanations || []).length > 0 && (
                <>
                  <h4>Other possible explanations</h4>
                  <ul>{brief.alternative_explanations.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </>
              )}

              {!isSos(inc) && (brief.nearby_services || []).length > 0 && (
                <>
                  <h4>Nearest services</h4>
                  <ul>
                    {brief.nearby_services.map((s, i) => (
                      <li key={i}>
                        {s.category.replace("_", " ")}: {s.name || "unnamed"} · {s.distance_km} km
                        {s.phone && <> · <a className="inc-link" href={`tel:${s.phone}`}>{s.phone}</a></>}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <h4>Recommended next steps</h4>
              <ul>
                {(brief.steps || []).map((s, i) => {
                  const c = s.contact_index != null ? contacts[s.contact_index] : null;
                  return (
                    <li key={i}>
                      {s.detail}
                      {s.needs_approval && <span className="inc-badge warn">needs authorised approval</span>}
                      {s.action === "CONTACT_TOURIST" && card?.mobile && (
                        <> <a className="inc-link" href={`tel:${card.mobile}`}>{card.mobile}</a></>
                      )}
                      {c && <> {c.name}: <a className="inc-link" href={`tel:${c.phone}`}>{c.phone}</a></>}
                    </li>
                  );
                })}
              </ul>

              {(brief.unknowns || []).length > 0 && (
                <>
                  <h4>What is not known</h4>
                  <ul>{brief.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul>
                </>
              )}
            </>
          ) : (
            <>
              <h4>Why this priority (score {inc.score})</h4>
              <ul>{(inc.reasons || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
              <p className="inc-sub">A brief is generated for medium priority and above.</p>
            </>
          )}

          <div className="inc-actions">
            {inc.status === "open" && (
              <button className="inc-btn primary" disabled={busy} onClick={() => run("acknowledged")}>
                {busy ? "Processing..." : "Acknowledge"}
              </button>
            )}
            <button className="inc-btn" disabled={busy} onClick={() => run("resolved")}>
              {busy ? "Processing..." : "Resolve"}
            </button>
            <select className="inc-select" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Dismiss as…</option>
              {DISMISS_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button className="inc-btn" disabled={busy || !reason} onClick={() => run("dismissed", { reason })}>
              {busy ? "Processing..." : "Dismiss"}
            </button>
          </div>

          {error && (
            <div className="inc-error" style={{
              backgroundColor: '#FEE2E2',
              border: '1px solid #FCA5A5',
              borderRadius: '8px',
              padding: '12px',
              marginTop: '12px',
              color: '#991B1B',
              fontSize: '13px'
            }}>
              {error}
            </div>
          )}

          <div className="inc-disclaimer">
            These signals can have ordinary explanations. Whether someone needs help, and who gets contacted, is decided by an authorised person.
          </div>
          {inc.brief_error && <div className="inc-debug">AI wording not used: {inc.brief_error}</div>}
        </div>
      )}
    </div>
  );
}

export default function IncidentsPanel({ incidents, travelCards = [], onAct, onFocus, onClose }) {
  const [showLow, setShowLow] = useState(false);
  const [closing, setClosing] = useState(false);
  const close = () => { if (closing) return; setClosing(true); setTimeout(onClose, 280); };
  const visible = incidents.filter((i) => showLow || i.level !== "low");
  const hidden = incidents.length - visible.length;

  return (
    <div className={`inc-overlay${closing ? " closing" : ""}`} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="inc-panel">
        <div className="inc-head">
          <div className="inc-title">Incidents</div>
          <button className="inc-close" onClick={close} aria-label="Close">✕</button>
        </div>
        <div className="inc-toolbar">
          <span>{visible.length} shown{hidden > 0 && ` · ${hidden} low priority hidden`}</span>
          <label><input type="checkbox" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} /> Show low priority</label>
        </div>
        {incidents.some(isSos) && (
          <div className="sos-strip">
            <strong>{incidents.filter((i) => i.kind === "panic").length}</strong> manual SOS ·{" "}
            <strong>{incidents.filter((i) => i.kind !== "panic" && isSos(i)).length}</strong> automated alert(s) open
          </div>
        )}
        <div className="inc-note">
          Incidents combine several signals. They are prompts to review, never a finding that someone is missing or in danger.
        </div>
        <div className="inc-list">
          {visible.length === 0 && <div className="inc-empty">No open incidents.</div>}
          {visible.map((inc) => (
            <IncidentCard
              key={inc.id}
              inc={inc}
              card={travelCards.find((c) => c.id === inc.travel_card_id) || travelCards.find((c) => c.user_id === inc.user_id)}
              onAct={onAct}
              onFocus={onFocus}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
