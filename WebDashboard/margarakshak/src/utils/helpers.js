export const PALETTE = [
  "#3b82f6","#8b5cf6","#ec4899","#f97316",
  "#14b8a6","#84cc16","#ef4444","#06b6d4"
];

export function colorFor(name) {
  let hash = 0;
  for (let c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function initials(name) {
  return name.split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase();
}

export function timeAgo(ts) {
  const s = Math.round((Date.now()/1000) - ts);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}

export function statusFor(ts) {
  const age = Date.now()/1000 - ts;
  if (age < 30) return "live";
  if (age < 120) return "stale";
  return "offline";
}

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);

  const s =
    Math.sin(dLat/2)**2 +
    Math.cos(toRad(a[0])) *
    Math.cos(toRad(b[0])) *
    Math.sin(dLon/2)**2;

  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Picks the ONE travel card that actually represents "now" for this user,
// instead of just the first match in the array. Without this, a user with
// both an old, finished card and a new active one would show whichever
// happened to come first in the query result (most Supabase queries here
// have no explicit .order(), so that's effectively arbitrary), which is
// exactly the kind of stale-data mixup that made a new trip look like it
// was showing the previous trip's details.
//
// Same isActive/isUpcoming logic Sidebar.jsx already uses for its status
// badge, centralized here so MapView, DevicePanel, and Sidebar can't drift
// out of agreement about which card is "the current one" for a user.
export function findCurrentCard(travelCards, userId) {
  const today = new Date().toISOString().split("T")[0];
  const cards = travelCards.filter(c => c.user_id === userId);
  if (cards.length === 0) return null;
  if (cards.length === 1) return cards[0];

  const active = cards.find(c => c.start_date <= today && c.end_date >= today);
  if (active) return active;

  // No card spans today (all finished, or all upcoming): prefer the
  // closest upcoming one, else the most recently finished one.
  const upcoming = cards
    .filter(c => c.start_date > today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (upcoming.length > 0) return upcoming[0];

  return cards
    .slice()
    .sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
}