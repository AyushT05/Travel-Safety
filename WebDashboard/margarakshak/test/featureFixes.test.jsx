import React from "react";
import { render, act } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";

let locRows = [];
vi.mock("../src/lib/supabase", () => ({ supabase: { from: () => { const b = {}; ["select","eq","gte","lte","order","limit","is"].forEach(k => b[k] = () => b); b.then = (r) => r({ data: locRows, error: null }); return b; } } }));

import MapView from "../src/components/MapView";
import { tripPhase, filterVisibleDevices, todayLocal } from "../src/utils/tripPhase";
import { buildPath } from "../src/hooks/useDeviationPaths";

const card = (id, start, end, extra = {}) => ({ id, user_id: "u", full_name: "Asha Rao", start_date: start, end_date: end, ...extra });
const dev = (id) => ({ userId: "u", travelCardId: id, lastLatlng: [12.30, 76.70], trail: [[12.30, 76.69], [12.30, 76.70]], freshnessStatus: "LIVE", timestamp: Date.now() / 1000, accuracy: 5, speed: 0, updates: 1 });
const base = { alerts: [], follow: false, selected: null, setMapActions: () => {} };
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
const rings = (c) => c.querySelectorAll(".live-marker-ring").length;
const markers = (c) => c.querySelectorAll(".live-marker").length;

beforeEach(() => { locRows = []; });

describe("trip phase uses India time like the database", () => {
  test("just after midnight IST a trip that ended yesterday is already completed", () => {
    const t = new Date("2026-11-01T19:00:00Z");               // 00:30 on 2 Nov in IST, still 1 Nov in UTC
    expect(todayLocal(t)).toBe("2026-11-02");
    expect(tripPhase(card("a", "2026-10-30", "2026-11-01"), t)).toBe("completed");
    expect(tripPhase(card("a", "2026-10-30", "2026-11-02"), t)).toBe("active");
    expect(tripPhase(card("a", "2026-11-03", "2026-11-05"), t)).toBe("upcoming");
    expect(tripPhase(card("a", "2000-01-01", "2999-01-01", { status: "completed" }))).toBe("completed");
  });

  test("only active trips are on the map unless that exact card is open", () => {
    const cards = [card("act", "2000-01-01", "2999-01-01"), card("old", "2000-01-01", "2001-01-01"), card("soon", "2999-01-01", "2999-02-01")];
    const devices = { act: dev("act"), old: dev("old"), soon: dev("soon") };
    expect(Object.keys(filterVisibleDevices(devices, cards, null)).sort()).toEqual(["act"]);
    expect(Object.keys(filterVisibleDevices(devices, cards, cards[1])).sort()).toEqual(["act", "old"]);
  });
});

describe("blips", () => {
  test("active trip pulses; completed trip is gray with no animated rings", async () => {
    const cards = [card("act", "2000-01-01", "2999-01-01"), card("old", "2000-01-01", "2001-01-01")];
    const { container } = render(<MapView {...base} travelCards={cards} devices={{ act: dev("act"), old: dev("old") }} />);
    await settle();
    expect(markers(container)).toBe(2);
    expect(rings(container)).toBe(2);                                    // the two rings belong to the active marker only
    const inactive = container.querySelectorAll(".live-marker-inactive");
    expect(inactive.length).toBe(1);
    expect(inactive[0].querySelectorAll(".live-marker-ring").length).toBe(0);
  });

  test("a marker is not rebuilt on every GPS ping (rebuilding restarts the pulse and looks like flicker)", async () => {
    const cards = [card("act", "2000-01-01", "2999-01-01")];
    const { container, rerender } = render(<MapView {...base} travelCards={cards} devices={{ act: dev("act") }} />);
    await settle();
    const first = container.querySelector(".live-marker");
    rerender(<MapView {...base} travelCards={cards} devices={{ act: { ...dev("act"), lastLatlng: [12.3001, 76.7001], updates: 2 } }} />);
    await settle();
    expect(container.querySelector(".live-marker")).toBe(first);
  });
});

describe("route deviation is a red traced path", () => {
  const alert = { id: 5, type: "deviation", status: "open", user_id: "u", travel_card_id: "act", lat: 12.31, lon: 76.71, message: "Route deviation detected", created_at: new Date(Date.now() - 60000).toISOString() };

  test("buildPath drops poor fixes and jitter", () => {
    const p = buildPath([{ lat: 1, lon: 1, accuracy: 5 }, { lat: 1.00001, lon: 1, accuracy: 5 }, { lat: 1.01, lon: 1, accuracy: 200 }, { lat: 1.002, lon: 1, accuracy: 5 }]);
    expect(p).toEqual([[1, 1], [1.002, 1]]);
  });

  test("draws the driven path in red, with no straight connector and no pulsing dot", async () => {
    locRows = Array.from({ length: 12 }, (_, i) => ({ lat: 12.30 + i * 0.002, lon: 76.70 + (i % 3) * 0.002, accuracy: 6, recorded_at: new Date().toISOString() }));
    const cards = [card("act", "2000-01-01", "2999-01-01")];
    const { container } = render(<MapView {...base} alerts={[alert]} travelCards={cards} devices={{ act: dev("act") }} />);
    await settle(); await settle();
    const red = [...container.querySelectorAll(".leaflet-overlay-pane path")].filter((p) => p.getAttribute("stroke") === "#dc2626");
    expect(red.length).toBeGreaterThanOrEqual(1);
    const nodes = ((red.find((p) => (p.getAttribute("d") || "").split("L").length > 3) || red[0]).getAttribute("d").match(/-?\d+(\.\d+)?/g) || []).length / 2;
    expect(nodes).toBeGreaterThanOrEqual(4);                            // a traced path (Leaflet simplifies), not a two-point line
    expect(container.querySelectorAll(".alert-marker").length).toBe(0); // the dot is gone for deviation alerts
  });

  test("a resolved deviation is shown only for the selected traveller", async () => {
    locRows = Array.from({ length: 8 }, (_, i) => ({ lat: 12.30 + i * 0.002, lon: 76.70, accuracy: 6, recorded_at: new Date().toISOString() }));
    const cards = [card("act", "2000-01-01", "2999-01-01")];
    const resolved = { ...alert, status: "resolved", resolved_at: new Date().toISOString() };
    const redCount = (c) => [...c.querySelectorAll(".leaflet-overlay-pane path")].filter((p) => p.getAttribute("stroke") === "#dc2626").length;
    const a = render(<MapView {...base} alerts={[resolved]} travelCards={cards} devices={{ act: dev("act") }} />);
    await settle(); await settle();
    expect(redCount(a.container)).toBe(0);
    const b = render(<MapView {...base} selected="act" alerts={[resolved]} travelCards={cards} devices={{ act: dev("act") }} />);
    await settle(); await settle();
    expect(redCount(b.container)).toBeGreaterThanOrEqual(1);
  });
});
