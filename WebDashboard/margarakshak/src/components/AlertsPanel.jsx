import { useAuth } from "../context/AuthContext";

const TYPE_LABEL = {
  panic: "Panic button",
  geofence_entry: "Entered risk zone",
  geofence_exit: "Exited risk zone",
  dropout: "Signal dropout",
  deviation: "Route deviation",
  manual: "Manual flag",
};

export default function AlertsPanel({ alerts, travelCards = [], onAcknowledge, onResolve, onClose }) {
  const { auth } = useAuth();
  const isAdmin = auth?.role === "admin";

  return (
    <div className="alerts-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="alerts-panel">
        <div className="alerts-panel-header">
          <div className="alerts-panel-title">Alerts</div>
          <button className="alerts-panel-close" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="alerts-panel-list">
          {alerts.length === 0 && (
            <div className="alerts-empty">No alerts yet.</div>
          )}

          {alerts.map((a) => {
            const card = travelCards.find((c) => c.user_id === a.user_id);
            const name = card?.full_name || `${a.user_id.slice(0, 8)}…`;

            return (
              <div key={a.id} className={`alert-item severity-${a.severity}`}>
                <div className="alert-item-top">
                  <span className="alert-type">{TYPE_LABEL[a.type] || a.type}</span>
                  <span className={`alert-status-badge status-${a.status}`}>{a.status}</span>
                </div>

                <div className="alert-name">{name}</div>

                <div className="alert-meta">
                  {new Date(a.created_at).toLocaleString()}
                  {a.lat != null && a.lon != null && ` · ${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}`}
                </div>

                {a.message && <div className="alert-message">{a.message}</div>}

                {isAdmin && a.status !== "resolved" && (
                  <div className="alert-actions">
                    {a.status === "open" && (
                      <button className="alert-ack-btn" onClick={() => onAcknowledge(a.id)}>
                        Acknowledge
                      </button>
                    )}
                    <button className="alert-resolve-btn" onClick={() => onResolve(a.id)}>
                      Resolve
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
