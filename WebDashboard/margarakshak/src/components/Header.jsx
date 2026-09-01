import { statusFor } from "../utils/helpers";
import { useAuth } from "../context/AuthContext";

export default function Header({ devices, openAlertsCount = 0, onOpenAlerts }) {
  const { auth, logout } = useAuth();
  const names = Object.keys(devices);
  const live  = names.filter(n => statusFor(devices[n].timestamp) === "live").length;

  return (
    <header>
      <div className="logo">
        <div className="logo-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1B4332" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
        <span className="logo-text">Margarakshak</span>
      </div>

      <div className="header-stats">
        <div className="stat-pill">
          <div className="dot dot-green" />
          <strong>{live}</strong> live
        </div>
        <div className="stat-pill">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2"/>
            <line x1="12" y1="18" x2="12" y2="18.01"/>
          </svg>
          <strong>{names.length}</strong> total
        </div>
        <div className="stat-pill">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span id="header-clock">{new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <div className="header-user">
        <button className="alerts-bell-btn" onClick={onOpenAlerts} title="Alerts">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {openAlertsCount > 0 && (
            <span className="alerts-bell-count">{openAlertsCount > 9 ? "9+" : openAlertsCount}</span>
          )}
        </button>

        <div className={`header-role-badge ${auth?.role}`}>
          {auth?.role === "admin" ? "Admin" : "User"}
        </div>
        <div className="header-avatar" title={auth?.name}>
          {auth?.name?.[0]?.toUpperCase()}
        </div>
        <button className="header-logout" onClick={logout} title="Sign out">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </header>
  );
}