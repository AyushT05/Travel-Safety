import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import MapView from "./components/MapView";
import DevicePanel from "./components/DevicePanel";
import MapControls from "./components/MapControls";
import LoginPage from "./components/LoginPage";
import UserIdPanel from "./components/UserIdPanel";

import useDevices from "./hooks/useDevices";

import { useState, useEffect } from "react";

import { useAuth } from "./context/AuthContext";

import { supabase } from "./lib/supabase";

export default function App() {
  const { auth, isLoaded } = useAuth();

  // Only devices now
  const { devices } = useDevices();

  const [selected, setSelected] =
    useState(null);

  const [follow, setFollow] =
    useState(false);

  const [showIdPanel, setShowIdPanel] =
    useState(false);

  const [travelCards, setTravelCards] =
    useState([]);

  // Map actions exposed from MapView
  const [mapActions, setMapActions] =
    useState({
      fitAll: () => {},
      clearTrails: () => {},
    });

  // Fetch travel cards
  useEffect(() => {
    if (!auth) return;

    async function fetchCards() {
      const { data } =
        await supabase
          .from("travel_cards")
          .select("*");

      setTravelCards(data || []);
    }

    fetchCards();

    // Refresh every 10s
    const interval = setInterval(
      fetchCards,
      10000
    );

    return () =>
      clearInterval(interval);
  }, [auth]);

  // Loading screen
  if (!isLoaded) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
      </div>
    );
  }

  // Login screen
  if (!auth) {
    return <LoginPage />;
  }

  return (
    <>
      <Header devices={devices} />

      <div className="layout">
        {/* Sidebar */}
        <Sidebar
          devices={devices}
          selected={selected}
          onSelect={setSelected}
          onManageIds={() =>
            setShowIdPanel(true)
          }
          travelCards={travelCards}
        />

        {/* Main map area */}
        <div className="map-area">
          <MapView
            devices={devices}
            travelCards={travelCards}
            follow={follow}
            setMapActions={
              setMapActions
            }
          />

          <MapControls
            follow={follow}
            actions={{
              toggleFollow: () =>
                setFollow(
                  (f) => !f
                ),

              fitAll:
                mapActions.fitAll,

              clearTrails:
                mapActions.clearTrails,
            }}
          />

          <DevicePanel
            device={devices[selected]}
            name={selected}
            travelCards={travelCards}
          />
        </div>
      </div>

      {/* User ID Manager */}
      {showIdPanel && (
        <UserIdPanel
          devices={devices}
          onClose={() =>
            setShowIdPanel(false)
          }
        />
      )}
    </>
  );
}