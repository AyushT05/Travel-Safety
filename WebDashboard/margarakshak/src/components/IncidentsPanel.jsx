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

function IncidentCard({ inc, card, onAct, onFocus }) {
  const [open, setOpen] = useState(inc.level === "critical");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const brief = inc.brief;
  const contacts = card?.emergency_contacts || [];
  const name =
    inc.kind === "zone_cluster" ? `Zone #${inc.zone_id}` : card?.full_name || `${(inc.user_id || "").slice(0, 8)}…`;

  async function run(action, opts) {
    setBusy(true);
    await onAct(inc, action, opts);
    setBusy(false);
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

              {brief.last_known && (
                <>
                  <h4>Last known position</h4>
                  <p>
                    {brief.last_known.lat.toFixed(5)}, {brief.last_known.lon.toFixed(5)} · {ago(brief.last_known.at)}
                    {brief.last_known.accuracy_m != null && ` · accuracy ${Math.round(brief.last_known.accuracy_m)} m`}{" "}
                    {inc.user_id && <button className="inc-link" onClick={() => onFocus(inc.user_id)}>Show on map</button>}
                  </p>
                </>
              )}

              {(brief.alternative_explanations || []).length > 0 && (
                <>
                  <h4>Other possible explanations</h4>
                  <ul>{brief.alternative_explanations.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </>
              )}

              {(brief.nearby_services || []).length > 0 && (
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
              <button className="inc-btn primary" disabled={busy} onClick={() => run("acknowledged")}>Acknowledge</button>
            )}
            <button className="inc-btn" disabled={busy} onClick={() => run("resolved")}>Resolve</button>
            <select className="inc-select" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Dismiss as…</option>
              {DISMISS_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button className="inc-btn" disabled={busy || !reason} onClick={() => run("dismissed", { reason })}>Dismiss</button>
          </div>

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
  const visible = incidents.filter((i) => showLow || i.level !== "low");
  const hidden = incidents.length - visible.length;

  return (
    <div className="inc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="inc-panel">
        <div className="inc-head">
          <div className="inc-title">Incidents</div>
          <button className="inc-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="inc-toolbar">
          <span>{visible.length} shown{hidden > 0 && ` · ${hidden} low priority hidden`}</span>
          <label><input type="checkbox" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} /> Show low priority</label>
        </div>
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
