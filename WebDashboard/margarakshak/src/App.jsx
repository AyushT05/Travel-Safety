import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import MapView from "./components/MapView";
import DevicePanel from "./components/DevicePanel";
import NearbyServicesPanel from "./components/NearbyServicesPanel";
import MapControls from "./components/MapControls";
import LoginPage from "./components/LoginPage";
import UserIdPanel from "./components/UserIdPanel";
import AlertsPanel from "./components/AlertsPanel";
import IncidentsPanel from "./components/IncidentsPanel";

import useDevices from "./hooks/useDevices";
import useActivityState, { pickActivity } from "./hooks/useActivityState";
import useAlerts from "./hooks/useAlerts";
import useIncidents from "./hooks/useIncidents";
import useSafetyAssessments from "./hooks/useSafetyAssessments";
import SafetyPanel from "./components/SafetyPanel";
import RiskLayerPanel from "./components/RiskLayerPanel";
import useRiskZones from "./hooks/useRiskZones";
import useAlertHeat from "./hooks/useAlertHeat";
import { zoneCenter, zoneContribution } from "./lib/risk/model";

import { useState, useEffect, useMemo } from "react";

import { useAuth } from "./context/AuthContext";

import { supabase } from "./lib/supabase";

export default function App() {
  const { auth, isLoaded } = useAuth();

  // Only devices now
  const { devices, clearTrails } = useDevices();
  const { activity } = useActivityState();
  const { alerts, openCount, acknowledge, resolve } = useAlerts();
  const { assessments: safetyAssessments } = useSafetyAssessments();
  const { incidents, urgentCount, act: actOnIncident } = useIncidents();
  const [showIncidents, setShowIncidents] = useState(false);

  // Risk overlays: heat map of recorded hazard zones, past-alert heat, tourist clusters / density.
  const [riskOptions, setRiskOptions] = useState({
    riskHeat: true, zoneOutlines: true, showInactive: false, clusters: true, density: false,
    alertHeat: false, alertTypes: ["panic", "geofence_entry", "dropout"], alertHours: 24 * 7, at: null,
  });
  const risk = useRiskZones();
  const alertHeat = useAlertHeat({
    enabled: riskOptions.alertHeat, hours: riskOptions.alertHours, types: riskOptions.alertTypes,
  });
  const riskStats = useMemo(() => {
    const t = riskOptions.at || risk.loadedAt || new Date();     // loadedAt moves every minute, so "now" stays current
    let activeZones = 0, inactiveZones = 0;
    for (const z of risk.zones) {
      try {
        const c = zoneCenter(z);
        if (zoneContribution(z, t, c.lat, c.lon).value >= 0.01) activeZones += 1; else inactiveZones += 1;
      } catch { /* malformed geometry */ }
    }
    return { activeZones, inactiveZones, loading: risk.loading, error: risk.error, alertCount: alertHeat.points.length };
  }, [risk.zones, risk.loadedAt, risk.loading, risk.error, riskOptions.at, alertHeat.points.length]);

  const [showAlertsPanel, setShowAlertsPanel] =
    useState(false);

  const [nearbyTarget, setNearbyTarget] =
    useState(null);

  const [selected, setSelected] =
    useState(null);

  const [follow, setFollow] =
    useState(false);

  const [showIdPanel, setShowIdPanel] =
    useState(false);

  const [safetyTarget, setSafetyTarget] =
    useState(null);

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
        urgentIncidentCount={urgentCount}
        onOpenIncidents={auth?.role === "admin" ? () => setShowIncidents(true) : undefined}
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
          safetyAssessments={safetyAssessments}
        />

        {/* Main map area */}
        <div className="map-area">
          <MapView
            devices={devices}
            travelCards={travelCards}
            alerts={alerts}
            follow={follow}
            selected={selected}
            safetyAssessments={safetyAssessments}
            riskZones={risk.zones}
            alertHeat={alertHeat.points}
            riskOptions={riskOptions}
            setMapActions={
              setMapActions
            }
          />

          <RiskLayerPanel options={riskOptions} setOptions={setRiskOptions} stats={riskStats} />

          <MapControls
            follow={follow}
            actions={{
              toggleFollow: () =>
                setFollow(
                  (f) => !f
                ),

              fitAll:
                mapActions.fitAll,

              clearTrails,
            }}
          />

          <DevicePanel
            device={devices[selected]}
            name={selected}
            travelCards={travelCards}
            activity={pickActivity(activity, devices[selected], selected)}
            onOpenNearby={setNearbyTarget}
            safetyAssessment={safetyAssessments[selected]}
            onOpenSafety={setSafetyTarget}
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

      {/* Incidents (admin only; RLS enforces this server-side too) */}
      {showIncidents && (
        <IncidentsPanel
          incidents={incidents}
          travelCards={travelCards}
          onAct={actOnIncident}
          onFocus={(userId) => { setSelected(userId); setShowIncidents(false); }}
          onClose={() => setShowIncidents(false)}
        />
      )}

      {/* Nearby emergency services */}
      {nearbyTarget && (
        <NearbyServicesPanel
          lat={nearbyTarget.lat}
          lon={nearbyTarget.lon}
          name={nearbyTarget.name}
          onClose={() => setNearbyTarget(null)}
        />
      )}
      {safetyTarget && (
        <SafetyPanel
          assessment={safetyTarget}
          onClose={() => setSafetyTarget(null)}
        />
      )}
    </>
  );
}