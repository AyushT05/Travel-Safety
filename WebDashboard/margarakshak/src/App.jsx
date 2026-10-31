import Header from "./components/Header";
import Sidebar, { TravelCardDetail } from "./components/Sidebar";
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

function documentStoragePath(documentUrl) {
  const marker = "/travel-documents/";
  const markerIndex = documentUrl?.indexOf(marker) ?? -1;
  return markerIndex >= 0
    ? decodeURIComponent(documentUrl.slice(markerIndex + marker.length).split("?")[0])
    : documentUrl;
}

export default function App() {
  const { auth, isLoaded } = useAuth();

  // Only devices now
  const { devices } = useDevices();
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
  const risk = useRiskZones(riskOptions.at);
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

  const [selectedCard, setSelectedCard] = useState(null);
  const [isCardMinimized, setIsCardMinimized] = useState(false);
  const [showMapLayers, setShowMapLayers] = useState(false);

  const [showIdPanel, setShowIdPanel] =
    useState(false);

  const [safetyTarget, setSafetyTarget] =
    useState(null);

  const [travelCards, setTravelCards] =
    useState([]);
  const mappedDevices = useMemo(() => {
    const cardIds = new Set(travelCards.map((card) => card.id));
    return Object.fromEntries(Object.entries(devices).filter(([, device]) =>
      device.travelCardId && cardIds.has(device.travelCardId)
    ));
  }, [devices, travelCards]);
  // Keep the map calm: ongoing cards are visible by default. A completed card
  // becomes visible only while an administrator has explicitly opened it.
  const visibleMapDevices = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return Object.fromEntries(Object.entries(mappedDevices).filter(([id, device]) => {
      const card = travelCards.find((candidate) => candidate.id === id || candidate.id === device.travelCardId);
      return card && (card.end_date >= today || card.id === selectedCard?.id);
    }));
  }, [mappedDevices, travelCards, selectedCard]);

  function openTravelCard(card) {
    setSelectedCard(card);
    setIsCardMinimized(false);
    setSelected(card.id);
  }

  // Map actions exposed from MapView
  const [mapActions, setMapActions] =
    useState({
        fitAll: () => {},
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

      const { data } = await supabase.from(table).select("*").order("created_at", { ascending: false });

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

  async function deleteCompletedCard(card) {
    // The UI is intentionally restrictive, and the accompanying RLS migration
    // makes the same rule non-bypassable from a modified browser client.
    const today = new Date().toISOString().slice(0, 10);
    if (auth?.role !== "admin" || !card?.end_date || card.end_date >= today) {
      return { error: "Only completed travel cards can be deleted by an administrator." };
    }
    // The document bucket is private and does not cascade when the database
    // row is deleted, so remove the file first to avoid retaining government
    // ID scans after the completed trip is removed.
    if (card.document_url) {
      const { error: storageError } = await supabase.storage
        .from("travel-documents")
        .remove([documentStoragePath(card.document_url)]);
      if (storageError) return { error: `Could not remove the ID document: ${storageError.message}` };
    }
    const { error } = await supabase.from("travel_cards").delete().eq("id", card.id);
    if (!error) setTravelCards((cards) => cards.filter((c) => c.id !== card.id));
    return { error: error?.message ?? null };
  }

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
        travelCards={travelCards}
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
          onDeleteCompletedCard={deleteCompletedCard}
          selectedCard={selectedCard}
          onSelectTravelCard={openTravelCard}
        />

        {/* Main map area */}
        <div className="map-area">
          <MapView
            devices={visibleMapDevices}
            travelCards={travelCards}
            alerts={alerts}
            selected={selected}
            selectedCard={selectedCard}
            safetyAssessments={safetyAssessments}
            riskZones={risk.zones}
            alertHeat={alertHeat.points}
            riskOptions={riskOptions}
            setMapActions={
              setMapActions
            }
          />

          <RiskLayerPanel options={riskOptions} setOptions={setRiskOptions} stats={riskStats} open={showMapLayers} onOpenChange={setShowMapLayers} />

          <MapControls
            actions={{ fitAll: mapActions.fitAll }}
          />

          <DevicePanel
            device={devices[selected]}
            name={selected}
            travelCards={travelCards}
            activity={pickActivity(activity, devices[selected], devices[selected]?.userId)}
            onOpenNearby={setNearbyTarget}
            safetyAssessment={safetyAssessments[selected]}
            onOpenSafety={setSafetyTarget}
            onToggleLayers={() => setShowMapLayers((open) => !open)}
            mapLayersOpen={showMapLayers}
          />
          {selectedCard && !isCardMinimized && (
            <div className="map-travel-card-panel">
              <TravelCardDetail
                card={selectedCard}
                isAdmin={auth?.role === "admin"}
                onDeleteCompletedCard={deleteCompletedCard}
                onMinimize={() => setIsCardMinimized(true)}
                onClose={() => { setSelectedCard(null); setSelected(null); setIsCardMinimized(false); }}
              />
            </div>
          )}
          {selectedCard && isCardMinimized && (
            <button className="minimized-travel-card" onClick={() => setIsCardMinimized(false)}>
              <span>Travel card</span>
              <strong>{selectedCard.full_name || "Traveller"}</strong>
              <span>Expand</span>
            </button>
          )}
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
          onFocus={(id) => {
            // id is a travel_card_id (preferred) or a user_id for legacy rows;
            // devices are keyed per trip, so resolve it to a device key.
            const key = devices[id] ? id : Object.keys(devices).find((k) => devices[k].userId === id);
            setSelected(key || null);
            setShowIncidents(false);
          }}
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
