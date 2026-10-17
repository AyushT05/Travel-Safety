import React from "react";
import { render, renderHook, act, waitFor } from "@testing-library/react";
import { vi } from "vitest";

let handlers = [];
let tables = {};
vi.mock("../src/lib/supabase", () => {
  const q = (name) => {
    const b = { _name: name };
    ["select","gte","order","limit","eq","is"].forEach(k => b[k] = () => b);
    b.then = (res) => res({ data: tables[name] || [], error: null });
    return b;
  };
  return { supabase: {
    from: (n) => q(n),
    channel: () => { const ch = { on: (_t, _f, cb) => { handlers.push(cb); return ch; }, subscribe: () => ch }; return ch; },
    removeChannel: () => {},
  }};
});

import useDevices from "../src/hooks/useDevices";
import { pickActivity } from "../src/hooks/useActivityState";
import MapView from "../src/components/MapView";

const U = "user-1";
const T0 = Date.parse("2026-10-17T10:00:00Z");
const row = (i, card="card-1", extra={}) => ({ id:i, user_id:U, travel_card_id:card, lat:12.2958+i*0.001, lon:76.6394+(i%2)*0.001,
  accuracy:6, speed:1.3, recorded_at:new Date(T0+i*5000).toISOString(), ...extra });
const pts = c => [...c.querySelectorAll(".leaflet-overlay-pane path")].map(p => ((p.getAttribute("d")||"").match(/-?\d+(\.\d+)?/g)||[]).length/2);
const cards = [
  { id:"card-1", user_id:U, full_name:"A", start_date:"2000-01-01", end_date:"2999-01-01" },
  { id:"card-2", user_id:U, full_name:"B", start_date:"2000-01-01", end_date:"2999-01-01" },
];

beforeEach(() => { handlers = []; tables = {}; });

test("history rebuilds trail on load, realtime pings extend it, trip change resets it", async () => {
  tables.latest_locations = [row(5)];
  tables.locations = [5,4,3,2,1,0].map(i => row(i)).concat([row(-9,"old-card")]); // newest first, like the DB; old trip row must be excluded
  const { result } = renderHook(() => useDevices());
  await waitFor(() => expect(result.current.devices[U]?.trail?.length).toBe(6));

  act(() => handlers[0]({ new: row(6) }));
  act(() => handlers[0]({ new: row(7) }));
  expect(result.current.devices[U].trail.length).toBe(8);

  act(() => handlers[0]({ new: row(8, "card-2") }));          // new trip starts
  expect(result.current.devices[U].trail.length).toBe(1);

  act(() => result.current.clearTrails());
  expect(result.current.devices[U].trail.length).toBe(1);
});

test("MapView draws the trail even when the polled card list flips order", async () => {
  tables.latest_locations = [row(0)]; tables.locations = [row(0)];
  const { result } = renderHook(() => useDevices());
  await waitFor(() => expect(result.current.devices[U]).toBeTruthy());
  const P = (devices, c) => <MapView devices={devices} travelCards={c} alerts={[]} follow={false} selected={null} setMapActions={()=>{}}/>;
  const { container, rerender } = render(P(result.current.devices, cards));
  for (let i = 1; i <= 8; i++) {
    act(() => handlers[0]({ new: row(i) }));
    rerender(P(result.current.devices, i % 2 ? [cards[1], cards[0]] : cards));   // the scenario that used to erase the trail
  }
  console.log("trail points drawn:", pts(container));
  expect(Math.max(...pts(container))).toBeGreaterThanOrEqual(9);
});

test("pickActivity uses the device's travel card, never a stale user-id row", () => {
  const activity = { [U]: { currentState:"RESTING" }, "card-1": { currentState:"WALKING" } };
  expect(pickActivity(activity, { travelCardId:"card-1" }, U).currentState).toBe("WALKING");
  expect(pickActivity({ [U]: { currentState:"RESTING" } }, { travelCardId:"card-1" }, U)).toBeNull();
  expect(pickActivity(activity, { travelCardId:null }, U).currentState).toBe("RESTING");   // legacy pings only
});
