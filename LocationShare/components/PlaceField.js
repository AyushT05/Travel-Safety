import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import * as Location from 'expo-location';
import { Text, TextInput } from './Text';
import { Feather } from '@expo/vector-icons';
import { searchPlaces, fetchPlaceRisk } from '../lib/placeRisk';

const SEV = {
  danger:  { bg: '#FEF2F2', border: '#FCA5A5', fg: '#991B1B', icon: 'alert-octagon', label: 'Danger' },
  warning: { bg: '#FFF7ED', border: '#FDBA74', fg: '#9A3412', icon: 'alert-triangle', label: 'Warning' },
  caution: { bg: '#FFFBEB', border: '#FDE68A', fg: '#92400E', icon: 'alert-circle', label: 'Caution' },
  info:    { bg: '#EFF6FF', border: '#BFDBFE', fg: '#1E40AF', icon: 'info', label: 'Note' },
};

/**
 * Place input with Google-Maps-style suggestions, plus a safety check for the chosen place.
 *   value / onChangeText : the text shown (and later saved into travel_cards.places)
 *   info                 : { place, risk, loading, error } kept by the parent, or null
 *   onInfoChange(info)   : parent updates its copy
 *   startDate/endDate    : trip dates (seasonal rules and the rain forecast depend on them)
 *   bias                 : optional { lat, lon } to rank nearby suggestions first
 *   allowCurrentLocation : show a "Use my current location" button (used for the start point)
 *   skipRiskCheck        : do not run the safety check for this place (the start point: you are
 *                          already there, and the check is about where you are going)
 */
export default function PlaceField({ value, onChangeText, info, onInfoChange, startDate, endDate, placeholder, bias, style, allowCurrentLocation = false, skipRiskCheck = false }) {
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [locating, setLocating] = useState(false);
  const timer = useRef(null);
  const seq = useRef(0);

  const place = info?.place ?? null;
  const startKey = startDate ? startDate.getTime() : 0;
  const endKey = endDate ? endDate.getTime() : 0;

  // (Re)check the chosen place whenever the place or the trip dates change.
  useEffect(() => {
    if (!place || skipRiskCheck || place.current) return;
    let cancelled = false;
    onInfoChange({ place, risk: null, loading: true, error: null });
    fetchPlaceRisk(place, startDate, endDate)
      .then((risk) => { if (!cancelled) onInfoChange({ place, risk, loading: false, error: null }); })
      .catch((e) => { if (!cancelled) onInfoChange({ place, risk: null, loading: false, error: String(e?.message ?? e) }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.id, startKey, endKey, retry]);

  function handleChange(text) {
    onChangeText(text);
    if (place) onInfoChange(null);            // typing again discards the earlier selection
    clearTimeout(timer.current);
    if (text.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    const mine = ++seq.current;
    timer.current = setTimeout(async () => {
      setSearching(true); setSearchError(null);
      try {
        const res = await searchPlaces(text.trim(), bias);
        if (mine !== seq.current) return;      // a newer keystroke superseded this request
        setSuggestions(res); setOpen(true);
      } catch (e) {
        if (mine === seq.current) { setSuggestions([]); setSearchError('Could not load suggestions. You can still type the place name.'); setOpen(true); }
      }
      if (mine === seq.current) setSearching(false);
    }, 400);
  }

  function choose(s) {
    seq.current++;                              // cancel any in-flight search
    clearTimeout(timer.current);
    setOpen(false); setSuggestions([]); setSearching(false);
    onChangeText(s.name + (s.subtitle && !s.subtitle.startsWith(s.name) ? `, ${s.subtitle}` : ''));
    onInfoChange({ place: s, risk: null, loading: !skipRiskCheck, error: null });
  }

  // Pin the start to where the traveller actually is, instead of the centre of a city that may be
  // kilometres away (which then looks like a route deviation from the very first fix).
  async function fillCurrentLocation() {
    if (locating) return;
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Location permission needed', 'Allow location access to use your current position, or search for a start point instead.');
        return;
      }
      let pos = null;
      try {
        pos = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
        ]);
      } catch {
        pos = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });   // a recent fix beats none
      }
      if (!pos) {
        Alert.alert('Could not get your location', 'Make sure GPS is on and try again, or search for a start point.');
        return;
      }
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;

      // A readable label is nice to have, never required: reverse geocoding can fail offline.
      let area = null, state = null, district = null;
      try {
        const [g] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        if (g) {
          area = g.district || g.city || g.subregion || null;
          district = g.subregion || g.city || null;
          state = g.region || null;
        }
      } catch { /* keep the generic label */ }

      const cityBit = [area, district && district !== area ? district : null].filter(Boolean).join(', ');
      const label = cityBit ? `Current location (${cityBit})` : 'Current location';
      seq.current++; clearTimeout(timer.current);
      setOpen(false); setSuggestions([]); setSearching(false);
      onChangeText(label);
      onInfoChange({
        place: { id: 'current-location', name: label, lat, lon, state, district, current: true, accuracy_m: accuracy ?? null },
        risk: null, loading: false, error: null,
      });
      if (accuracy != null && accuracy > 150) {
        Alert.alert('Location is approximate', `Your position is only accurate to about ${Math.round(accuracy)} m right now. Moving outdoors and trying again will pin your start more precisely.`);
      }
    } catch (e) {
      Alert.alert('Could not get your location', String(e?.message ?? e));
    } finally {
      setLocating(false);
    }
  }

  return (
    <View style={style}>
      <View style={[st.inputWrap, focused && st.inputFocused]}>
        <Feather name={place ? 'map-pin' : 'search'} size={15} color={place ? '#1B4332' : '#6F8378'} />
        <TextInput
          style={st.input} value={value} onChangeText={handleChange}
          placeholder={placeholder} placeholderTextColor="#A7B8AD"
          autoCorrect={false}
          onFocus={() => { setFocused(true); if (suggestions.length) setOpen(true); }}
          onBlur={() => setFocused(false)}
        />
        {searching && <ActivityIndicator size="small" color="#1B4332" />}
        {place && !searching && <Feather name="check-circle" size={15} color="#1B4332" />}
      </View>

      {open && (suggestions.length > 0 || searchError) && (
        <View style={st.dropdown}>
          {suggestions.map((s) => (
            <TouchableOpacity key={s.id} style={st.option} onPress={() => choose(s)} activeOpacity={0.7}>
              <Feather name="map-pin" size={14} color="#52796F" style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={st.optionName} numberOfLines={1}>{s.name}</Text>
                {!!s.subtitle && <Text style={st.optionSub} numberOfLines={1}>{s.subtitle}</Text>}
              </View>
            </TouchableOpacity>
          ))}
          {searchError && <Text style={st.searchError}>{searchError}</Text>}
          {suggestions.length === 0 && !searchError && <Text style={st.searchError}>No matches</Text>}
        </View>
      )}

      {allowCurrentLocation && !place?.current && (
        <TouchableOpacity style={st.locBtn} onPress={fillCurrentLocation} disabled={locating} activeOpacity={0.8}>
          {locating
            ? <ActivityIndicator size="small" color="#1B4332" />
            : <Feather name="crosshair" size={15} color="#1B4332" />}
          <Text style={st.locBtnText}>{locating ? 'Finding your location…' : 'Use my current location'}</Text>
        </TouchableOpacity>
      )}

      {!place && value.trim().length >= 3 && !open && !searching && (
        <Text style={st.unverified}>
          {skipRiskCheck
            ? 'Not selected from the list: your route start will not be pinned. Pick a suggestion or use your current location.'
            : 'Not selected from the list: this place will not get a safety check.'}
        </Text>
      )}

      {place?.current && (
        <Text style={st.currentNote}>
          Start pinned to where you are right now{place.accuracy_m != null ? ` (about ${Math.round(place.accuracy_m)} m accuracy)` : ''}. If you are creating this card ahead of time from somewhere else, search for your start instead.
        </Text>
      )}

      {place && !skipRiskCheck && !place.current && <RiskCard info={info} onRetry={() => setRetry((n) => n + 1)} />}
    </View>
  );
}

function RiskCard({ info, onRetry }) {
  const [showAll, setShowAll] = useState(false);
  const [showSources, setShowSources] = useState(false);
  if (info.loading) {
    return (
      <View style={st.checking}>
        <ActivityIndicator size="small" color="#1B4332" />
        <Text style={st.checkingText}>Checking alerts, weather and restrictions for this place…</Text>
      </View>
    );
  }
  if (info.error || !info.risk) {
    return (
      <View style={[st.card, { backgroundColor: '#F3F4F6', borderColor: '#D1D5DB' }]}>
        <Text style={[st.cardTitle, { color: '#374151' }]}>Safety check unavailable</Text>
        <Text style={[st.cardBody, { color: '#374151' }]}>
          We could not check this place right now. That does NOT mean it is safe. Check official alerts (IMD, your state disaster authority) before you travel.
        </Text>
        {onRetry && (
          <TouchableOpacity style={st.retryBtn} onPress={onRetry} activeOpacity={0.8}>
            <Feather name="refresh-cw" size={13} color="#1B4332" /><Text style={st.retryText}>Try again</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const { warnings = [], checked = [] } = info.risk;
  const failed = checked.filter((c) => !c.ok);
  const okSources = checked.filter((c) => c.ok);
  const partial = failed.length > 0;
  const shown = showAll ? warnings : warnings.filter((w) => w.severity !== 'info').slice(0, 4);
  const hiddenCount = warnings.length - shown.length;

  return (
    <View>
      {warnings.length === 0 && partial && (
        <View style={[st.card, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
          <Text style={[st.cardTitle, { color: '#92400E' }]}>No warnings, but the check is incomplete</Text>
          <Text style={[st.cardBody, { color: '#92400E' }]}>
            {okSources.length} of {checked.length} sources responded and none reported a problem. {failed.length === 1 ? 'One source' : `${failed.length} sources`} could not be reached, so this is not an all-clear. Check official alerts before you travel.
          </Text>
        </View>
      )}

      {warnings.length === 0 && !partial && (
        <View style={[st.card, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
          <Text style={[st.cardTitle, { color: '#166534' }]}>No warnings found</Text>
          <Text style={[st.cardBody, { color: '#166534' }]}>
            None of the sources we could check reported a problem for this place and your dates. This is not a guarantee of safety. Conditions change quickly.
          </Text>
        </View>
      )}

      {shown.map((w) => {
        const c = SEV[w.severity] ?? SEV.caution;
        return (
          <View key={w.id} style={[st.card, { backgroundColor: c.bg, borderColor: c.border }]}>
            <View style={st.cardHead}>
              <Feather name={c.icon} size={15} color={c.fg} />
              <Text style={[st.cardTag, { color: c.fg }]}>{c.label.toUpperCase()}</Text>
            </View>
            <Text style={[st.cardTitle, { color: c.fg }]}>{w.title}</Text>
            <Text style={[st.cardBody, { color: c.fg }]}>{w.detail}</Text>
            <Text style={[st.cardSource, { color: c.fg }]}>
              {w.source}{w.valid_until ? ` · valid until ${new Date(w.valid_until).toLocaleDateString()}` : ''}
            </Text>
          </View>
        );
      })}

      {hiddenCount > 0 && (
        <TouchableOpacity onPress={() => setShowAll(true)}><Text style={st.more}>Show {hiddenCount} more note{hiddenCount > 1 ? 's' : ''}</Text></TouchableOpacity>
      )}

      {checked.length > 0 && (
        <View style={st.sources}>
          <TouchableOpacity style={st.sourcesHead} onPress={() => setShowSources((v) => !v)} activeOpacity={0.7}>
            <Feather name={partial ? 'alert-circle' : 'check-circle'} size={15} color={partial ? '#B45309' : '#2F7D4F'} />
            <Text style={st.sourcesTitle}>{okSources.length} of {checked.length} sources checked</Text>
            <Feather name={showSources || partial ? 'chevron-up' : 'chevron-down'} size={16} color="#6F8378" style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>
          {(showSources || partial) && (
            <View style={st.sourcesBody}>
              {checked.map((c) => (
                <View key={c.source} style={st.sourceRow}>
                  <Feather name={c.ok ? 'check' : 'minus-circle'} size={13} color={c.ok ? '#2F7D4F' : '#B45309'} style={{ marginTop: 2 }} />
                  <Text style={st.sourceText}>
                    <Text style={{ fontWeight: '700', color: '#2F4A3B' }}>{c.label}</Text>
                    {c.ok ? (c.note ? `: ${c.note}` : '') : ': could not be reached just now'}
                  </Text>
                </View>
              ))}
              {partial && onRetry && (
                <TouchableOpacity style={st.retryBtn} onPress={onRetry} activeOpacity={0.8}>
                  <Feather name="refresh-cw" size={13} color="#1B4332" /><Text style={st.retryText}>Check again</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#DAE6DD', borderRadius: 14,
    paddingHorizontal: 14, marginBottom: 6,
  },
  inputFocused: { borderColor: '#1B4332' },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: '#0F2118' },
  dropdown: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#DAE6DD', borderRadius: 12, marginBottom: 8, overflow: 'hidden' },
  option: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F2F7F3' },
  optionName: { fontSize: 14, fontWeight: '600', color: '#0F2118' },
  optionSub: { fontSize: 12, color: '#6F8378', marginTop: 1 },
  searchError: { fontSize: 12, color: '#6F8378', padding: 12 },
  locBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', height: 40, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: '#DAE6DD', backgroundColor: '#F8FBF8', marginBottom: 10 },
  locBtnText: { fontSize: 13, fontWeight: '700', color: '#1B4332' },
  currentNote: { fontSize: 12, color: '#1B4332', marginBottom: 8 },
  unverified: { fontSize: 12, color: '#92400E', marginBottom: 6 },
  checking: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  checkingText: { fontSize: 12.5, color: '#52796F' },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  cardTag: { fontSize: 11, fontWeight: '800', },
  cardTitle: { fontSize: 14, fontWeight: '800', marginBottom: 3 },
  cardBody: { fontSize: 12.5, lineHeight: 18 },
  cardSource: { fontSize: 11, marginTop: 6, opacity: 0.8 },
  more: { fontSize: 12.5, color: '#1B4332', fontWeight: '700', marginBottom: 8, textDecorationLine: 'underline' },
  sources: { marginTop: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: '#DAE6DD', borderRadius: 14, overflow: 'hidden' },
  sourcesHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 13 },
  sourcesTitle: { fontSize: 13, fontWeight: '700', color: '#2F4A3B' },
  sourcesBody: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 12, gap: 9, borderTopWidth: 1, borderTopColor: '#EAF1EC' },
  sourceRow: { flexDirection: 'row', gap: 8 },
  sourceText: { flex: 1, fontSize: 12, lineHeight: 17, color: '#5B7266' },
  retryBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, height: 38, borderRadius: 12, borderWidth: 1.5, borderColor: '#DAE6DD', backgroundColor: '#F8FBF8', marginTop: 8 },
  retryText: { fontSize: 13, fontWeight: '700', color: '#1B4332' },
  footnote: { fontSize: 11, color: '#6F8378', marginBottom: 2 },
});
