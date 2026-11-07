// One definition of "is this trip active?" for the whole dashboard.
// The database decides trip dates in India time (Asia/Kolkata); the dashboard used to compare against the UTC
// date (new Date().toISOString()), so for 5.5 hours after midnight IST a finished trip still counted as active
// and its blip kept pulsing. Everything now uses the same zone as the database.
const TZ = "Asia/Kolkata";

export function todayLocal(now = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// "active" | "paused" | "upcoming" | "completed" | "unknown"
// "paused" = a return trip whose outbound leg has ended; tracking resumes on card.return_date.
export function tripPhase(card, now = new Date()) {
  if (!card?.start_date || !card?.end_date) return "unknown";
  const today = todayLocal(now);
  if (card.status === "completed" || card.status === "cancelled") return "completed";
  if (card.end_date < today) return "completed";
  if (card.start_date > today) return "upcoming";
  if (card.status === "paused") return "paused";
  return "active";
}

export const isActiveTrip = (card, now) => tripPhase(card, now) === "active";

// Which devices get a blip on the map: every ACTIVE trip, plus the one card an administrator has open
// (shown gray and still when that trip is completed / not started).
export function filterVisibleDevices(devices, travelCards, selectedCard, now) {
  return Object.fromEntries(Object.entries(devices).filter(([id, device]) => {
    const card = travelCards.find((c) => c.id === id || c.id === device.travelCardId);
    return card && (isActiveTrip(card, now) || card.id === selectedCard?.id);
  }));
}
