import React from "react";
import { renderHook, render, act, waitFor, fireEvent, screen } from "@testing-library/react";
import { vi } from "vitest";

let rows = [], handlers = [], calls = [];
vi.mock("../src/lib/supabase", () => {
  const q = (table) => {
    const b = { _t: table, _op: "select", _patch: null };
    ["select", "in", "order", "limit"].forEach((k) => (b[k] = () => b));
    b.update = (patch) => { b._op = "update"; b._patch = patch; return b; };
    b.insert = (row) => { calls.push({ table, op: "insert", row }); return Promise.resolve({ error: null }); };
    b.eq = (col, val) => { if (b._op === "update") { calls.push({ table, op: "update", patch: b._patch, id: val }); return Promise.resolve({ error: null }); } return b; };
    b.then = (res) => res({ data: table === "incidents" ? rows : [], error: null });
    return b;
  };
  return { supabase: { from: q,
    channel: () => { const ch = { on: (_t, _f, cb) => { handlers.push(cb); return ch; }, subscribe: () => ch }; return ch; },
    removeChannel: () => {} } };
});

import useIncidents from "../src/hooks/useIncidents";
import IncidentsPanel from "../src/components/IncidentsPanel";

const base = { user_id: "u1", travel_card_id: "c1", status: "open", score: 70, reasons: ["+18: x"], opened_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const inc = (id, level, extra = {}) => ({ ...base, id, level, kind: "trip_risk", ...extra });
beforeEach(() => { rows = []; handlers = []; calls = []; });

test("sorted by level, low last; urgent count only counts open high/critical", async () => {
  rows = [inc("a", "low"), inc("b", "critical"), inc("c", "medium"), inc("d", "high", { status: "acknowledged" })];
  const { result } = renderHook(() => useIncidents());
  await waitFor(() => expect(result.current.incidents.length).toBe(4));
  expect(result.current.incidents.map((i) => i.id)).toEqual(["b", "d", "c", "a"]);
  expect(result.current.urgentCount).toBe(1);
});

test("act() acknowledges, logs the action, and does not throw (regression: commit was out of scope)", async () => {
  rows = [inc("a", "high")];
  const { result } = renderHook(() => useIncidents());
  await waitFor(() => expect(result.current.incidents.length).toBe(1));
  await act(async () => { await result.current.act(result.current.incidents[0], "acknowledged"); });
  expect(calls.find((c) => c.op === "update").patch).toEqual({ status: "acknowledged" });
  expect(calls.find((c) => c.op === "insert").row.action).toBe("acknowledged");
  expect(result.current.incidents[0].status).toBe("acknowledged");
  await act(async () => { await result.current.act(result.current.incidents[0], "dismissed", { reason: "known_dead_zone" }); });
  expect(result.current.incidents.length).toBe(0);
  expect(calls.filter((c) => c.op === "update").pop().patch).toEqual({ status: "dismissed", resolution: "known_dead_zone" });
});

test("realtime update removes an incident once it is resolved elsewhere", async () => {
  rows = [inc("a", "high")];
  const { result } = renderHook(() => useIncidents());
  await waitFor(() => expect(result.current.incidents.length).toBe(1));
  act(() => handlers[1]({ new: { ...rows[0], status: "resolved" } }));
  expect(result.current.incidents.length).toBe(0);
});

test("panel hides low priority by default, shows approval badge and tel links from the travel card", () => {
  const brief = { source: "template", headline: "SOS: panic button pressed", summary: "s", timeline: [], steps: [
    { action: "CONTACT_EMERGENCY_CONTACT", detail: "Contact emergency contact 1.", needs_approval: false, contact_index: 0 },
    { action: "ESCALATE_TO_AUTHORITIES", detail: "Escalate.", needs_approval: true, contact_index: null }],
    unknowns: [], alternative_explanations: [], nearby_services: [] };
  const incidents = [inc("a", "critical", { kind: "panic", brief }), inc("b", "low")];
  const cards = [{ id: "c1", user_id: "u1", full_name: "Asha", mobile: "+91111", emergency_contacts: [{ name: "Ravi", phone: "+91222" }] }];
  const { container } = render(<IncidentsPanel incidents={incidents} travelCards={cards} onAct={() => {}} onFocus={() => {}} onClose={() => {}} />);
  expect(container.querySelectorAll(".inc-card").length).toBe(1);               // low hidden
  expect(container.textContent).toContain("needs authorised approval");
  expect(container.querySelector('a[href="tel:+91222"]')).not.toBeNull();
  fireEvent.click(screen.getByLabelText ? container.querySelector('input[type="checkbox"]') : null);
  expect(container.querySelectorAll(".inc-card").length).toBe(2);
});
