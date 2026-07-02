import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function UserIdPanel({ devices, onClose }) {
  const { auth, addTrackedId, removeTrackedId } = useAuth();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const trackedIds = auth?.trackedIds || [];

  function handleAdd() {
    const id = input.trim();
    if (!id) return;
    if (trackedIds.includes(id)) { setError("Already tracking this ID."); return; }
    addTrackedId(id);
    setInput("");
    setError("");
  }

  return (
    <div className="uid-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="uid-panel">
        <div className="uid-header">
          <div className="uid-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1B4332" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>
            </svg>
            Track a Device
          </div>
          <button className="uid-close" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <p className="uid-desc">
          Enter the <strong>Device ID</strong> shared with you to start tracking that person's location.
        </p>

        <div className="uid-input-row">
          <input
            className="uid-input"
            placeholder="Paste device ID..."
            value={input}
            onChange={e => { setInput(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
          />
          <button className="uid-add-btn" onClick={handleAdd}>Add</button>
        </div>
        {error && <div className="uid-error">{error}</div>}

        <div className="uid-list">
          {trackedIds.length === 0 && (
            <div className="uid-empty">No devices tracked yet. Add an ID above.</div>
          )}
          {trackedIds.map(id => {
            const exists = !!devices[id];
            return (
              <div key={id} className={`uid-item ${exists ? "found" : "missing"}`}>
                <div className="uid-item-left">
                  <div className={`uid-dot ${exists ? "live" : "offline"}`} />
                  <span className="uid-id">{id.slice(0, 8)}…{id.slice(-6)}</span>
                  <span className={`uid-badge ${exists ? "found" : "missing"}`}>
                    {exists ? "Live" : "Not found"}
                  </span>
                </div>
                <button className="uid-remove" onClick={() => removeTrackedId(id)}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}