import { useEffect, useState } from "react";
import { statusFor } from "../utils/helpers";
import { useAuth } from "../context/AuthContext";

const Icon = ({ children, size = 17 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

export default function Header({ devices, travelCards = [], openAlertsCount = 0, onOpenAlerts, urgentIncidentCount = 0, onOpenIncidents }) {
  const { auth, logout } = useAuth();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const names = Object.keys(devices);
  const cardIds = new Set(travelCards.map((card) => card.id));
  // GPS rows survive a trip for audit/trail history. Header totals must be
  // cards, not those retained rows, otherwise deleted/old trips look alive.
  const live = names.filter((n) => cardIds.has(devices[n]?.travelCardId) && statusFor(devices[n].timestamp) === "live").length;
  const badge = (n) => (n > 9 ? "9+" : n);

  return (
    <header>
      <div className="logo">
        <img className="brand-lockup" src="/logo-full-light.png" alt="Margarakshak" />
      </div>

      <div className="hd-status" role="status">
        <span className="hd-seg"><i className={`dot ${live ? "dot-green" : "dot-idle"}`} /><b>{live}</b> live</span>
        <span className="hd-seg"><b>{travelCards.length}</b> {travelCards.length === 1 ? "card" : "cards"}</span>
        <span className="hd-seg hd-clock" id="header-clock">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>

      <div className="hd-actions">
        {onOpenIncidents && (
          <button className="alerts-bell-btn header-incidents-btn" onClick={onOpenIncidents} title="Incidents" aria-label="Incidents">
            <Icon><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></Icon>
            {urgentIncidentCount > 0 && <span className="alerts-bell-count">{badge(urgentIncidentCount)}</span>}
          </button>
        )}
        <button className="alerts-bell-btn" onClick={onOpenAlerts} title="Alerts" aria-label="Alerts">
          <Icon><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></Icon>
          {openAlertsCount > 0 && <span className="alerts-bell-count">{badge(openAlertsCount)}</span>}
        </button>

        <div className="hd-user" title={auth?.name}>
          <div className="header-avatar">{auth?.name?.[0]?.toUpperCase()}</div>
          <div className="hd-user-meta">
            <span className="hd-user-name">{auth?.name}</span>
            <span className={`header-role-badge ${auth?.role}`}>{auth?.role === "admin" ? "Administrator" : "Viewer"}</span>
          </div>
        </div>

        <button className="header-logout" onClick={logout} title="Sign out" aria-label="Sign out">
          <Icon size={16}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></Icon>
        </button>
      </div>
    </header>
  );
}
