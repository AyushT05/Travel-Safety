import { extractWaypoints } from "../src/utils/routeService";

describe("routeService", () => {
  test("extracts waypoints from place_details", () => {
    const card = {
      places: ["Puttur", "Madikeri", "Mysuru"],
      place_details: [
        { name: "Puttur", lat: 12.7687, lon: 75.2071 },
        { name: "Madikeri", lat: 12.4244, lon: 75.7382 },
        { name: "Mysuru", lat: 12.2958, lon: 76.6394 },
      ],
    };
    const waypoints = extractWaypoints(card);
    expect(waypoints.length).toBe(3);
    expect(waypoints[0].name).toBe("Puttur");
    expect(waypoints[1].name).toBe("Madikeri");
    expect(waypoints[2].name).toBe("Mysuru");
  });
});
