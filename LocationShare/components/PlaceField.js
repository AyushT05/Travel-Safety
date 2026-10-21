import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
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
 */
export default function PlaceField({ value, onChangeText, info, onInfoChange, startDate, endDate, placeholder, bias, style }) {
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const seq = useRef(0);

  const place = info?.place ?? null;
  const startKey = startDate ? startDate.getTime() : 0;
  const endKey = endDate ? endDate.getTime() : 0;

  // (Re)check the chosen place whenever the place or the trip dates change.
  useEffect(() => {
    if (!place) return;
    let cancelled = false;
    onInfoChange({ place, risk: null, loading: true, error: null });
    fetchPlaceRisk(place, startDate, endDate)
      .then((risk) => { if (!cancelled) onInfoChange({ place, risk, loading: false, error: null }); })
      .catch((e) => { if (!cancelled) onInfoChange({ place, risk: null, loading: false, error: String(e?.message ?? e) }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.id, startKey, endKey]);

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
    onInfoChange({ place: s, risk: null, loading: true, error: null });
  }

  return (
    <View style={style}>
      <View style={[st.inputWrap, focused && st.inputFocused]}>
        <Feather name={place ? 'map-pin' : 'search'} size={15} color={place ? '#1B4332' : '#9E9484'} />
        <TextInput
          style={st.input} value={value} onChangeText={handleChange}
          placeholder={placeholder} placeholderTextColor="#C4BAA8"
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

      {!place && value.trim().length >= 3 && !open && !searching && (
        <Text style={st.unverified}>Not selected from the list: this place will not get a safety check.</Text>
      )}

      {place && <RiskCard info={info} />}
    </View>
  );
}

function RiskCard({ info }) {
  const [showAll, setShowAll] = useState(false);
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
      </View>
    );
  }

  const { warnings = [], checked = [] } = info.risk;
  const failed = checked.filter((c) => !c.ok);
  const shown = showAll ? warnings : warnings.filter((w) => w.severity !== 'info').slice(0, 4);
  const hiddenCount = warnings.length - shown.length;

  return (
    <View>
      {warnings.length === 0 && (
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

      {failed.length > 0 && (
        <Text style={st.failed}>
          Could not check: {failed.map((f) => f.label).join('; ')}. Missing results are not the same as "safe".
        </Text>
      )}
      {checked.filter((c) => c.ok && c.note).map((c) => (
        <Text key={c.source} style={st.footnote}>{c.label}: {c.note}</Text>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#EAE4D9', borderRadius: 14,
    paddingHorizontal: 14, marginBottom: 6,
  },
  inputFocused: { borderColor: '#1B4332' },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: '#1A1A1A' },
  dropdown: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#EAE4D9', borderRadius: 12, marginBottom: 8, overflow: 'hidden' },
  option: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#F7F5F0' },
  optionName: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  optionSub: { fontSize: 12, color: '#9E9484', marginTop: 1 },
  searchError: { fontSize: 12, color: '#9E9484', padding: 12 },
  unverified: { fontSize: 12, color: '#92400E', marginBottom: 6 },
  checking: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  checkingText: { fontSize: 12.5, color: '#52796F' },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  cardTag: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  cardTitle: { fontSize: 14, fontWeight: '800', marginBottom: 3 },
  cardBody: { fontSize: 12.5, lineHeight: 18 },
  cardSource: { fontSize: 11, marginTop: 6, opacity: 0.8 },
  more: { fontSize: 12.5, color: '#1B4332', fontWeight: '700', marginBottom: 8, textDecorationLine: 'underline' },
  failed: { fontSize: 12, color: '#92400E', marginBottom: 6 },
  footnote: { fontSize: 11, color: '#9E9484', marginBottom: 2 },
});
