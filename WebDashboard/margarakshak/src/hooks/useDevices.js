import { useEffect, useState } from "react";

const SERVER = "https://travel-safety.onrender.com";

export default function useDevices() {
  const [devices, setDevices] = useState({});

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(
          `${SERVER}/locations?nocache=${Date.now()}`
        );

        const data = await res.json();

        const updated = {};

        Object.entries(data).forEach(([name, d]) => {
          updated[name] = {
            lastLatlng: [d.lat, d.lon],
            accuracy: d.accuracy,
            timestamp: d.timestamp,
          };
        });

        setDevices(updated);

      } catch (e) {
        console.error("Polling failed:", e);
      }
    }

    poll();

    const interval = setInterval(poll, 2000);

    return () => clearInterval(interval);

  }, []);

  return {
    devices,
    clearTrails: () => {},
    toggleFollow: () => true,
    fitAll: () => {},
  };
}