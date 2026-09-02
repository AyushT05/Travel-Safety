import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Linking, Platform, LayoutAnimation, UIManager,
} from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { fetchNearbyServices } from '../lib/nearbyServices';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ICON_MAP = {
  hospital:     { name: 'medkit',          color: '#DC2626' },
  police:       { name: 'shield-checkmark', color: '#2563EB' },
  fire_station: { name: 'flame',           color: '#EA580C' },
  pharmacy:     { name: 'medical',         color: '#059669' },
  clinic:       { name: 'fitness',         color: '#7C3AED' },
};

function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function openMaps(lat, lon, name) {
  const label = encodeURIComponent(name);
  const url = Platform.select({
    ios:     `maps:0,0?q=${label}@${lat},${lon}`,
    android: `geo:0,0?q=${lat},${lon}(${label})`,
  });
  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`)
  );
}

/**
 * Collapsible card listing nearby emergency services.
 * Expects `lat` and `lon` props from the parent (ActiveTracking).
 */
export default function NearbyServices({ lat, lon }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [openCat, setOpenCat]   = useState(null);

  // Cache results: only re-fetch when location drifts > 2km or 5 minutes have passed
  const lastFetch = useRef({ lat: null, lon: null, ts: 0 });

  const shouldRefetch = useCallback(() => {
    const { lat: pLat, lon: pLon, ts } = lastFetch.current;
    if (pLat === null) return true;
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat - pLat);
    const dLon = toRad(lon - pLon);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(pLat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
    const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return distKm > 2.0 || Date.now() - ts > 300_000;
  }, [lat, lon]);

  const load = useCallback(async () => {
    if (!shouldRefetch()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchNearbyServices(lat, lon, 5000);
      setData(result);
      lastFetch.current = { lat, lon, ts: Date.now() };
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [lat, lon, shouldRefetch]);

  // Auto-fetch when expanded and location available
  useEffect(() => {
    if (expanded && lat != null && lon != null) load();
  }, [expanded, lat, lon, load]);

  function toggleExpand() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  }

  function toggleCat(key) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenCat((v) => (v === key ? null : key));
  }

  const totalCount = data ? data.reduce((s, g) => s + g.places.length, 0) : 0;

  return (
    <View style={s.card}>
      {/* Header — always visible */}
      <TouchableOpacity style={s.header} onPress={toggleExpand} activeOpacity={0.8}>
        <View style={s.headerLeft}>
          <Ionicons name="medkit-outline" size={16} color="#1B4332" />
          <Text style={s.headerTitle}>Emergency Services Nearby</Text>
        </View>
        <View style={s.headerRight}>
          {totalCount > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{totalCount}</Text>
            </View>
          )}
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#9E9484" />
        </View>
      </TouchableOpacity>

      {/* Expanded body */}
      {expanded && (
        <View style={s.body}>
          {loading && !data && (
            <View style={s.loadingRow}>
              <ActivityIndicator color="#1B4332" size="small" />
              <Text style={s.loadingText}>Searching nearby…</Text>
            </View>
          )}

          {error && (
            <View style={s.errorRow}>
              <Feather name="alert-circle" size={14} color="#DC2626" />
              <Text style={s.errorText}>{error}</Text>
              <TouchableOpacity onPress={load}><Text style={s.retryText}>Retry</Text></TouchableOpacity>
            </View>
          )}

          {data && data.map((group) => {
            const ic = ICON_MAP[group.category] || { name: 'location', color: '#555' };
            const isOpen = openCat === group.category;
            const shown = isOpen ? group.places : group.places.slice(0, 2);

            return (
              <View key={group.category} style={s.catSection}>
                <TouchableOpacity style={s.catHeader} onPress={() => toggleCat(group.category)} activeOpacity={0.7}>
                  <Ionicons name={ic.name} size={16} color={ic.color} />
                  <Text style={s.catLabel}>{group.label}</Text>
                  <View style={s.catCount}>
                    <Text style={s.catCountText}>{group.places.length}</Text>
                  </View>
                  <Feather name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#9E9484" />
                </TouchableOpacity>

                {group.places.length === 0 && (
                  <Text style={s.emptyText}>None within 5 km</Text>
                )}

                {shown.map((p, i) => (
                  <View key={`${p.lat}-${p.lon}-${i}`} style={s.placeRow}>
                    <View style={s.placeInfo}>
                      <Text style={s.placeName} numberOfLines={1}>{p.name}</Text>
                      <Text style={s.placeDist}>{formatDistance(p.distanceKm)}</Text>
                    </View>
                    <TouchableOpacity
                      style={s.navBtn}
                      onPress={() => openMaps(p.lat, p.lon, p.name)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="navigate-outline" size={14} color="#1B4332" />
                    </TouchableOpacity>
                  </View>
                ))}

                {!isOpen && group.places.length > 2 && (
                  <TouchableOpacity onPress={() => toggleCat(group.category)}>
                    <Text style={s.showMore}>+{group.places.length - 2} more</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          {/* Manual refresh */}
          {data && (
            <TouchableOpacity style={s.refreshBtn} onPress={load} disabled={loading} activeOpacity={0.7}>
              {loading ? (
                <ActivityIndicator color="#52796F" size="small" />
              ) : (
                <>
                  <Feather name="refresh-cw" size={13} color="#52796F" />
                  <Text style={s.refreshText}>Refresh</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#EAE4D9', overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 14, fontWeight: '700', color: '#1A1A1A' },

  badge: {
    backgroundColor: '#D1FAE5', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#1B4332' },

  body: { paddingHorizontal: 16, paddingBottom: 16 },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  loadingText: { fontSize: 13, color: '#9E9484' },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  errorText: { fontSize: 13, color: '#DC2626', flex: 1 },
  retryText: { fontSize: 13, fontWeight: '600', color: '#1B4332' },

  catSection: { marginTop: 8 },
  catHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#F7F5F0',
  },
  catLabel: { fontSize: 13, fontWeight: '600', color: '#1A1A1A', flex: 1 },
  catCount: {
    backgroundColor: '#F7F5F0', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1,
  },
  catCountText: { fontSize: 10, fontWeight: '700', color: '#9E9484' },

  emptyText: { fontSize: 12, color: '#C4BAA8', fontStyle: 'italic', paddingVertical: 6, paddingLeft: 24 },

  placeRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    paddingLeft: 24, borderBottomWidth: 1, borderBottomColor: '#F7F5F0',
  },
  placeInfo: { flex: 1, marginRight: 8 },
  placeName: { fontSize: 13, fontWeight: '600', color: '#1A1A1A' },
  placeDist: { fontSize: 11, color: '#9E9484', marginTop: 2 },
  navBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0FDF4',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#D1FAE5',
  },

  showMore: { fontSize: 12, color: '#52796F', fontWeight: '600', paddingVertical: 6, paddingLeft: 24 },

  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: 12, paddingVertical: 10, borderRadius: 12,
    backgroundColor: '#F7F5F0',
  },
  refreshText: { fontSize: 13, fontWeight: '600', color: '#52796F' },
});
