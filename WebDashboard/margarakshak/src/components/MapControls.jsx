export default function MapControls({ actions }) {
  return (
    <div className="map-controls">
      <button
        className="ctrl-btn"
        onClick={actions.fitAll}
        title="Show all travellers"
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

        Show all travellers
      </button>
    </div>
  );
}
