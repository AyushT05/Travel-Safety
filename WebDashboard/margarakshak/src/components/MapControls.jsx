export default function MapControls({
  follow,
  actions,
}) {
  return (
    <div className="map-controls">
      {/* Follow */}
      <button
        className={`ctrl-btn ${
          follow ? "active" : ""
        }`}
        onClick={actions.toggleFollow}
        title={
          follow
            ? "Following devices"
            : "Follow disabled"
        }
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="3 11 22 2 13 21 11 13 3 11" />
        </svg>

        {follow ? "Following" : "Follow off"}
      </button>

      {/* Fit all */}
      <button
        className="ctrl-btn"
        onClick={actions.fitAll}
        title="Fit all devices"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>

        Fit all
      </button>

      {/* Clear trails */}
      <button
        className="ctrl-btn"
        onClick={actions.clearTrails}
        title="Clear trails"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>

        Clear trails
      </button>
    </div>
  );
}