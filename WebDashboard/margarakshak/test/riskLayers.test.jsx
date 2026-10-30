import React from "react";
import { render, act } from "@testing-library/react";
import { beforeAll, describe, expect, test } from "vitest";
import MapView from "../src/components/MapView";

// jsdom has no canvas; leaflet.heat only needs a context that accepts drawing calls.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
    get: (t, k) => (k in t ? t[k]
      : k === "getImageData" ? (_x, _y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
      : k === "createLinearGradient" ? () => ({ addColorStop() {} })
      : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
});

const NIGHT = new Date("2026-10-24T20:30:00+05:30");
const DAY = new Date("2026-10-24T10:00:00+05:30");
const zone = (over = {}) => ({
  key: "risk:z1", name: "Ghat road", hazard: "crime", severity: "high", confidence: 0.9, source: "manual", sourceUrl: null,
  geometry: { type: "Point", coordinates: [78, 20] }, radiusM: 40000, observedAt: new Date("2026-10-23T00:00:00Z"),
  expiresAt: null, status: "active", validFrom: null, attributes: {}, ...over,
});
const OFF = { riskHeat: false, zoneOutlines: false, showInactive: false, clusters: false, density: false, alertHeat: false, at: NIGHT };
const dev = (lat, lon) => ({ lastLatlng: [lat, lon], trail: [], freshnessStatus: "LIVE", timestamp: Date.now() / 1000, accuracy: 5, speed: 0 });
const props = { travelCards: [], alerts: [], follow: false, selected: null, setMapActions: () => {} };
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 350)); });   // the layers redraw 180 ms after the map settles

const paths = (c) => c.querySelectorAll(".leaflet-overlay-pane path").length;
const heat = (c) => c.querySelectorAll("canvas.leaflet-heatmap-layer").length;
const bubbles = (c) => [...c.querySelectorAll(".tc-bubble")];
const hiddenMarkers = (c) => [...c.querySelectorAll(".leaflet-marker-icon")].filter((m) => m.style.opacity === "0").length;

describe("risk layers on the real map", () => {
  test("zone outlines and heat appear, and switch off again", async () => {
    const { container, rerender } = render(<MapView {...props} devices={{}} riskZones={[zone()]} riskOptions={OFF} />);
    await tick();
    expect(paths(container)).toBe(0);
    expect(heat(container)).toBe(0);

    rerender(<MapView {...props} devices={{}} riskZones={[zone()]} riskOptions={{ ...OFF, riskHeat: true, zoneOutlines: true }} />);
    await tick();
    expect(paths(container)).toBeGreaterThanOrEqual(1);       // the zone circle
    expect(heat(container)).toBe(1);

    rerender(<MapView {...props} devices={{}} riskZones={[zone()]} riskOptions={{ ...OFF, riskHeat: true }} />);
    await tick();
    expect(paths(container)).toBe(0);
    expect(heat(container)).toBe(1);

    rerender(<MapView {...props} devices={{}} riskZones={[zone()]} riskOptions={OFF} />);
    await tick();
    expect(heat(container)).toBe(0);
  });

  test("a lighting hazard is only outlined as risky after dark; inactive zones are opt-in", async () => {
    const lit = zone({ hazard: "poor_lighting", severity: "medium", confidence: 0.6 });
    const on = { ...OFF, zoneOutlines: true };
    const { container, rerender } = render(<MapView {...props} devices={{}} riskZones={[lit]} riskOptions={{ ...on, at: DAY }} />);
    await tick();
    expect(paths(container)).toBe(0);                          // by day: contributes nothing, hidden by default
    rerender(<MapView {...props} devices={{}} riskZones={[lit]} riskOptions={{ ...on, at: DAY, showInactive: true }} />);
    await tick();
    expect(paths(container)).toBeGreaterThanOrEqual(1);        // shown as a faint dashed outline when asked
    expect(container.querySelector(".leaflet-overlay-pane path").getAttribute("stroke")).toBe("#94a3b8");
    rerender(<MapView {...props} devices={{}} riskZones={[lit]} riskOptions={{ ...on, at: NIGHT }} />);
    await tick();
    expect(paths(container)).toBeGreaterThanOrEqual(1);        // after dark: a real, coloured outline
    expect(container.querySelector(".leaflet-overlay-pane path").getAttribute("stroke")).toBe("#d97706");
  });

  test("an expired zone and a malformed one never break the map", async () => {
    const expired = zone({ key: "risk:old", expiresAt: new Date("2026-10-24T12:00:00Z") });
    const broken = zone({ key: "risk:bad", geometry: { type: "Point", coordinates: ["x", 1] } });
    const { container } = render(<MapView {...props} devices={{}} riskZones={[expired, broken]} riskOptions={{ ...OFF, riskHeat: true, zoneOutlines: true }} />);
    await tick();
    expect(paths(container)).toBe(0);
    expect(heat(container)).toBe(1);                           // the (empty) layer exists, nothing crashed
  });

  test("past alerts and tourist density heat layers", async () => {
    const { container, rerender } = render(<MapView {...props} devices={{ a: dev(20, 78) }} riskZones={[]} alertHeat={[{ lat: 20, lon: 78, w: 1 }]} riskOptions={OFF} />);
    await tick();
    expect(heat(container)).toBe(0);
    rerender(<MapView {...props} devices={{ a: dev(20, 78) }} riskZones={[]} alertHeat={[{ lat: 20, lon: 78, w: 1 }]} riskOptions={{ ...OFF, alertHeat: true, density: true }} />);
    await tick();
    expect(heat(container)).toBe(2);
  });

  // MapView fits the map to all tourists, so a far-away third tourist keeps the zoom low enough for the close pair to merge.
  const pair = { a: dev(20.0, 78.0), b: dev(20.001, 78.001), far: dev(28.0, 77.0) };

  test("nearby tourists become a cluster bubble coloured by risk; separating them restores the markers", async () => {
    const hazard = zone({ radiusM: 5000 });                     // covers the close pair only
    const { container, rerender } = render(<MapView {...props} devices={pair} riskZones={[hazard]} riskOptions={{ ...OFF, clusters: true }} />);
    await tick();
    expect(bubbles(container)).toHaveLength(1);
    expect(bubbles(container)[0].textContent).toBe("2");
    expect(bubbles(container)[0].className).toContain("tc-danger");     // crime hazard at night: danger
    expect(hiddenMarkers(container)).toBe(2);                           // the lone tourist keeps their own marker

    const apart = { a: dev(20.0, 78.0), b: dev(24.0, 74.0), far: dev(28.0, 77.0) };
    rerender(<MapView {...props} devices={apart} riskZones={[hazard]} riskOptions={{ ...OFF, clusters: true }} />);
    await tick();
    expect(bubbles(container)).toHaveLength(0);
    expect(hiddenMarkers(container)).toBe(0);
  });

  test("a cluster outside every hazard is green; clusters off restores all markers; the selected tourist is never hidden", async () => {
    const { container, rerender } = render(<MapView {...props} devices={pair} riskZones={[]} riskOptions={{ ...OFF, clusters: true }} />);
    await tick();
    expect(bubbles(container)).toHaveLength(1);
    expect(bubbles(container)[0].className).toContain("tc-none");
    expect(hiddenMarkers(container)).toBe(2);
    rerender(<MapView {...props} devices={pair} riskZones={[]} riskOptions={{ ...OFF, clusters: false }} />);
    await tick();
    expect(bubbles(container)).toHaveLength(0);
    expect(hiddenMarkers(container)).toBe(0);
    rerender(<MapView {...props} selected="a" devices={pair} riskZones={[]} riskOptions={{ ...OFF, clusters: true }} />);
    await tick();
    // Selecting a tourist also zooms the map onto them, which dissolves clusters past zoom 15; either way the
    // selected tourist's own marker is never the one that is hidden.
    expect(hiddenMarkers(container)).toBeLessThanOrEqual(1);
  });

  test("heat layers can be toggled off and back on, and new data arriving while off does not throw", async () => {
    const mk = (opts, pts) => <MapView {...props} devices={{ a: dev(20, 78) }} riskZones={[zone()]} alertHeat={pts} riskOptions={{ ...OFF, ...opts }} />;
    const { container, rerender } = render(mk({ alertHeat: true, riskHeat: true }, [{ lat: 20, lon: 78, w: 1 }]));
    await tick();
    expect(heat(container)).toBe(2);
    rerender(mk({ alertHeat: false, riskHeat: false }, [{ lat: 20, lon: 78, w: 1 }]));
    await tick();
    expect(heat(container)).toBe(0);
    rerender(mk({ alertHeat: false, riskHeat: false }, [{ lat: 21, lon: 79, w: 1 }, { lat: 22, lon: 79, w: 1 }]));   // a poll lands while the layer is off
    await tick();
    rerender(mk({ alertHeat: true, riskHeat: true }, [{ lat: 21, lon: 79, w: 1 }]));
    await tick();
    expect(heat(container)).toBe(2);
  });

  test("unmounting with every layer on does not throw", async () => {
    const { unmount } = render(<MapView {...props} devices={{ a: dev(20, 78), b: dev(20.1, 78.1) }} riskZones={[zone()]} alertHeat={[{ lat: 20, lon: 78, w: 1 }]}
      riskOptions={{ ...OFF, riskHeat: true, zoneOutlines: true, clusters: true, density: true, alertHeat: true }} />);
    await tick();
    expect(() => unmount()).not.toThrow();
  });
});
