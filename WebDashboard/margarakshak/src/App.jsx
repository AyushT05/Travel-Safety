import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import MapView from "./components/MapView";
import DevicePanel from "./components/DevicePanel";
import MapControls from "./components/MapControls";
import LoginPage from "./components/LoginPage";
import UserIdPanel from "./components/UserIdPanel";
import AlertsPanel from "./components/AlertsPanel";

import useDevices from "./hooks/useDevices";
import useAlerts from "./hooks/useAlerts";

import { useState, useEffect } from "react";

import { useAuth } from "./context/AuthContext";

import { supabase } from "./lib/supabase";

export default function App() {
  const { auth, isLoaded } = useAuth();

  // Only devices now
  const { devices } = useDevices();
  const { alerts, openCount, acknowledge, resolve } = useAlerts();

  const [showAlertsPanel, setShowAlertsPanel] =
    useState(false);

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
      // Admins get the full travel_cards row (RLS allows it). Regular users
      // get only the safe columns for people they legitimately track, via
      // tracked_traveler_info (see 0001_security_and_locations.sql) — mobile
      // number, ID document, companions, and emergency contacts never leave
      // the database for anyone but the owner or an admin.
      const table =
        auth?.role === "admin" ? "travel_cards" : "tracked_traveler_info";

      const { data } = await supabase.from(table).select("*");

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
      <Header
        devices={devices}
        openAlertsCount={openCount}
        onOpenAlerts={() => setShowAlertsPanel(true)}
      />

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
            alerts={alerts}
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

      {/* Alerts */}
      {showAlertsPanel && (
        <AlertsPanel
          alerts={alerts}
          travelCards={travelCards}
          onAcknowledge={acknowledge}
          onResolve={resolve}
          onClose={() => setShowAlertsPanel(false)}
        />
      )}
    </>
  );
}