import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Platform, Alert, Share,
  Modal, TextInput,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

export default function HomeScreen({ user, onCreateCard, onStartTracking }) {
  const [cards, setCards]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editingCard, setEditingCard] = useState(null);

  const name  = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Traveller';
  const today = new Date().toISOString().split('T')[0];

  const fetchCards = useCallback(async () => {
    const { data } = await supabase
      .from('travel_cards').select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setCards(data || []);
    setLoading(false);
    setRefreshing(false);
  }, [user.id]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  async function deleteCard(card) {
    Alert.alert(
      'Delete Travel Card',
      `Delete "${card.full_name}'s journey"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await supabase.from('travel_cards').delete().eq('id', card.id);
            fetchCards();
          },
        },
      ]
    );
  }

  async function shareCard(card) {
    const places     = (card.places || []).join(' → ') || 'Not specified';
    const companions = (card.companions || []).map(c => c.name).join(', ') || 'None';
    const emergency  = (card.emergency_contacts || [])
      .map(c => `${c.name} (${c.phone})`).join('\n  ') || 'None';
    await Share.share({
      title: `Margarakshak — ${card.full_name}'s Journey`,
      message:
        `Margarakshak Travel Card\n` +
        `─────────────────────\n` +
        `Traveller: ${card.full_name}\n` +
        `Mobile: ${card.mobile}\n` +
        `Travel dates: ${card.start_date} to ${card.end_date}\n` +
        `Destinations: ${places}\n` +
        `Companions: ${companions}\n\n` +
        `Emergency Contacts:\n  ${emergency}\n\n` +
        `─────────────────────\n` +
        `Live Tracking ID:\n${user.id}\n\n` +
        `To track live, open the Margarakshak dashboard and add this ID under "Manage IDs".`,
    });
  }

  const activeCard = cards.find(c => c.start_date <= today && c.end_date >= today);

  return (
    <View style={{ flex: 1, backgroundColor: '#F7F5F0' }}>
      <StatusBar style="dark" />

      <View style={s.header}>
        <View>
          <Text style={s.headerGreeting}>Good {getTimeOfDay()}</Text>
          <Text style={s.headerName}>{name}</Text>
        </View>
        <TouchableOpacity style={s.signOutBtn} onPress={() => supabase.auth.signOut()}>
          <Feather name="log-out" size={16} color="#9E9484" />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchCards(); }}
            tintColor="#1B4332"
          />
        }
        contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 60 }}
      >
        {/* Active journey banner */}
        {activeCard && (
          <TouchableOpacity
            style={s.activeBanner}
            onPress={() => onStartTracking(activeCard)}
            activeOpacity={0.9}
          >
            <View style={s.activeBannerLeft}>
              <View style={s.activePulseDot} />
              <View>
                <Text style={s.activeBannerLabel}>ACTIVE JOURNEY</Text>
                <Text style={s.activeBannerTitle}>{activeCard.full_name}'s trip</Text>
                <Text style={s.activeBannerSub}>Tap to open tracking</Text>
              </View>
            </View>
            <Feather name="arrow-right" size={20} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
        )}

        {/* Device ID card */}
        <View style={s.idCard}>
          <View style={s.idCardTop}>
            <View style={s.idIconWrap}>
              <Ionicons name="radio-outline" size={18} color="#1B4332" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.idCardLabel}>Your Device ID</Text>
              <Text style={s.idCardDesc}>Share with trusted contacts to be tracked</Text>
            </View>
          </View>
          <View style={s.idBox}>
            <Text style={s.idText} numberOfLines={1} ellipsizeMode="middle">
              {user.id}
            </Text>
          </View>
        </View>

        {/* Section header */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Travel Cards</Text>
          <TouchableOpacity style={s.newCardBtn} onPress={onCreateCard} activeOpacity={0.85}>
            <Feather name="plus" size={14} color="#fff" />
            <Text style={s.newCardBtnText}>New</Text>
          </TouchableOpacity>
        </View>

        {loading && <ActivityIndicator color="#1B4332" style={{ marginTop: 32 }} />}

        {!loading && cards.length === 0 && (
          <View style={s.emptyState}>
            <View style={s.emptyIconWrap}>
              <Ionicons name="map-outline" size={32} color="#9E9484" />
            </View>
            <Text style={s.emptyTitle}>No travel cards yet</Text>
            <Text style={s.emptyDesc}>
              Create a travel card to enable safety tracking for your next journey
            </Text>
            <TouchableOpacity style={s.emptyBtn} onPress={onCreateCard} activeOpacity={0.9}>
              <Text style={s.emptyBtnText}>Create my first card</Text>
            </TouchableOpacity>
          </View>
        )}

        {cards.map(card => (
          <TravelCardItem
            key={card.id}
            card={card} today={today}
            onStartTracking={() => onStartTracking(card)}
            onEdit={() => setEditingCard(card)}
            onDelete={() => deleteCard(card)}
            onShare={() => shareCard(card)}
          />
        ))}
      </ScrollView>

      {editingCard && (
        <EditCardModal
          card={editingCard}
          onClose={() => setEditingCard(null)}
          onSaved={() => { setEditingCard(null); fetchCards(); }}
        />
      )}
    </View>
  );
}

function TravelCardItem({ card, today, onStartTracking, onEdit, onDelete, onShare }) {
  const [expanded, setExpanded] = useState(false);

  const isActive   = card.start_date <= today && card.end_date >= today;
  const isUpcoming = card.start_date > today;

  const statusColor = isActive ? '#1B4332' : isUpcoming ? '#1D4ED8' : '#9E9484';
  const statusBg    = isActive ? '#ECFDF5'  : isUpcoming ? '#EFF6FF' : '#F4F1EC';
  const statusLabel = isActive ? 'Active'   : isUpcoming ? 'Upcoming' : 'Completed';

  const places     = card.places || [];
  const emergency  = card.emergency_contacts || [];
  const companions = card.companions || [];

  return (
    <View style={s.travelCard}>
      <TouchableOpacity style={s.tcTop} onPress={() => setExpanded(e => !e)} activeOpacity={0.8}>
        <View style={{ flex: 1 }}>
          <View style={s.tcTitleRow}>
            <Text style={s.tcName}>{card.full_name}</Text>
            <View style={[s.tcBadge, { backgroundColor: statusBg }]}>
              <View style={[s.tcBadgeDot, { backgroundColor: statusColor }]} />
              <Text style={[s.tcBadgeText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
          </View>
          <View style={s.tcDateRow}>
            <Feather name="calendar" size={12} color="#9E9484" />
            <Text style={s.tcDates}>{formatDate(card.start_date)} — {formatDate(card.end_date)}</Text>
          </View>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#C4BAA8" style={{ marginLeft: 8 }} />
      </TouchableOpacity>

      {places.length > 0 && (
        <View style={s.tcRouteRow}>
          <Feather name="map-pin" size={12} color="#9E9484" />
          <Text style={s.tcRoute} numberOfLines={expanded ? undefined : 1}>
            {places.join('  →  ')}
          </Text>
        </View>
      )}

      {expanded && (
        <View style={s.tcExpanded}>
          {companions.length > 0 && (
            <ExpandSection icon="users" title="Companions"
              items={companions.map(c => `${c.name}${c.phone ? `  ·  ${c.phone}` : ''}`)} />
          )}
          {emergency.length > 0 && (
            <ExpandSection icon="phone-call" title="Emergency Contacts"
              items={emergency.map(c => `${c.name}  ·  ${c.phone}`)} />
          )}
          {card.document_type && (
            <ExpandSection icon="file-text" title="Document" items={[card.document_type]} />
          )}
        </View>
      )}

      <View style={s.tcActions}>
        {isActive && (
          <ActionBtn icon="navigation" label="Track" filled color="#1B4332" onPress={onStartTracking} />
        )}
        <ActionBtn icon="share-2" label="Share" onPress={onShare} />
        <ActionBtn icon="edit-2"  label="Edit"  onPress={onEdit} />
        <ActionBtn icon="trash-2" label="Delete" danger onPress={onDelete} />
      </View>
    </View>
  );
}

function ExpandSection({ icon, title, items }) {
  return (
    <View style={s.expandSection}>
      <View style={s.expandHeader}>
        <Feather name={icon} size={13} color="#9E9484" />
        <Text style={s.expandTitle}>{title}</Text>
      </View>
      {items.map((item, i) => (
        <Text key={i} style={s.expandItem}>{item}</Text>
      ))}
    </View>
  );
}

function ActionBtn({ icon, label, onPress, filled, color, danger }) {
  return (
    <TouchableOpacity
      style={[
        s.actionBtn,
        filled && { backgroundColor: color || '#1B4332', borderColor: color || '#1B4332' },
        danger && { borderColor: '#FFC9C9', backgroundColor: '#FFF5F5' },
      ]}
      onPress={onPress} activeOpacity={0.8}
    >
      <Feather name={icon} size={13} color={filled ? '#fff' : danger ? '#DC2626' : '#52796F'} />
      <Text style={[s.actionBtnText, filled && { color: '#fff' }, danger && { color: '#DC2626' }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function EditCardModal({ card, onClose, onSaved }) {
  const [saving, setSaving]         = useState(false);
  const [fullName, setFullName]     = useState(card.full_name);
  const [mobile, setMobile]         = useState(card.mobile);
  const [startDate, setStartDate]   = useState(card.start_date);
  const [endDate, setEndDate]       = useState(card.end_date);
  const [places, setPlaces]         = useState(card.places?.length ? card.places : ['']);
  const [companions, setCompanions] = useState(
    card.companions?.length ? card.companions : [{ name: '', phone: '' }]
  );
  const [emergency, setEmergency]   = useState(
    card.emergency_contacts?.length
      ? card.emergency_contacts
      : [{ name: '', phone: '' }, { name: '', phone: '' }, { name: '', phone: '' }]
  );

  async function save() {
    if (!fullName.trim() || !startDate || !endDate) {
      Alert.alert('Required', 'Name and travel dates are required.'); return;
    }
    const validEmergency = emergency.filter(c => c.name.trim() && c.phone.trim());
    if (validEmergency.length < 3) {
      Alert.alert('Required', 'Please keep at least 3 emergency contacts.'); return;
    }
    setSaving(true);
    const { error } = await supabase.from('travel_cards').update({
      full_name: fullName, mobile,
      start_date: startDate, end_date: endDate,
      places: places.filter(p => p.trim()),
      companions: companions.filter(c => c.name.trim()),
      emergency_contacts: validEmergency,
    }).eq('id', card.id);
    setSaving(false);
    if (error) Alert.alert('Error', error.message);
    else onSaved();
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#F7F5F0' }}>
        <View style={m.header}>
          <TouchableOpacity onPress={onClose} style={m.closeBtn}>
            <Feather name="x" size={18} color="#52796F" />
          </TouchableOpacity>
          <Text style={m.headerTitle}>Edit Travel Card</Text>
          <TouchableOpacity onPress={save} disabled={saving} style={m.saveBtn}>
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={m.saveBtnText}>Save</Text>
            }
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <SectionHead title="Basic Info" />
          <MLabel text="Full Name" />
          <MInput value={fullName} onChange={setFullName} placeholder="Full name" />
          <MLabel text="Mobile" />
          <MInput value={mobile} onChange={setMobile} placeholder="+91 9876543210" keyboard="phone-pad" />

          <SectionHead title="Travel Dates" />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <MLabel text="Start Date" />
              <MInput value={startDate} onChange={setStartDate} placeholder="YYYY-MM-DD" />
            </View>
            <View style={{ flex: 1 }}>
              <MLabel text="End Date" />
              <MInput value={endDate} onChange={setEndDate} placeholder="YYYY-MM-DD" />
            </View>
          </View>

          <SectionHead title="Destinations" />
          {places.map((place, i) => (
            <View key={i} style={m.listRow}>
              <View style={m.listNum}><Text style={m.listNumText}>{i + 1}</Text></View>
              <TextInput
                style={[m.input, { flex: 1 }]} value={place}
                onChangeText={t => { const n = [...places]; n[i] = t; setPlaces(n); }}
                placeholder={`Destination ${i + 1}`} placeholderTextColor="#C4BAA8"
              />
              {places.length > 1 && (
                <TouchableOpacity style={m.removeCircle}
                  onPress={() => setPlaces(places.filter((_, j) => j !== i))}>
                  <Feather name="x" size={12} color="#DC2626" />
                </TouchableOpacity>
              )}
            </View>
          ))}
          <AddRowBtn label="Add destination" onPress={() => setPlaces([...places, ''])} />

          <SectionHead title="Companions" />
          {companions.map((c, i) => (
            <GroupCard key={i} title={`Person ${i + 1}`}
              showRemove={companions.length > 1}
              onRemove={() => setCompanions(companions.filter((_, j) => j !== i))}>
              <MInput value={c.name} onChange={t => { const n = [...companions]; n[i].name = t; setCompanions(n); }} placeholder="Name" />
              <MInput value={c.phone} onChange={t => { const n = [...companions]; n[i].phone = t; setCompanions(n); }} placeholder="Phone" keyboard="phone-pad" />
            </GroupCard>
          ))}
          <AddRowBtn label="Add companion" onPress={() => setCompanions([...companions, { name: '', phone: '' }])} />

          <SectionHead title="Emergency Contacts" subtitle="Minimum 3 required" />
          {emergency.map((c, i) => (
            <GroupCard key={i} title={`Contact ${i + 1}${i < 3 ? ' (required)' : ''}`}
              showRemove={i >= 3}
              onRemove={() => setEmergency(emergency.filter((_, j) => j !== i))}
              accent>
              <MInput value={c.name} onChange={t => { const n = [...emergency]; n[i].name = t; setEmergency(n); }} placeholder="Contact name" />
              <MInput value={c.phone} onChange={t => { const n = [...emergency]; n[i].phone = t; setEmergency(n); }} placeholder="Phone number" keyboard="phone-pad" />
            </GroupCard>
          ))}
          <AddRowBtn label="Add contact" onPress={() => setEmergency([...emergency, { name: '', phone: '' }])} />

          <TouchableOpacity style={m.submitBtn} onPress={save} disabled={saving} activeOpacity={0.9}>
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={m.submitBtnText}>Save Changes</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function SectionHead({ title, subtitle }) {
  return (
    <View style={m.sectionHead}>
      <Text style={m.sectionTitle}>{title}</Text>
      {subtitle && <Text style={m.sectionSub}>{subtitle}</Text>}
    </View>
  );
}
function MLabel({ text }) { return <Text style={m.label}>{text}</Text>; }
function MInput({ value, onChange, placeholder, keyboard }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[m.input, focused && m.inputFocused]}
      value={value} onChangeText={onChange}
      placeholder={placeholder} placeholderTextColor="#C4BAA8"
      keyboardType={keyboard || 'default'}
      autoCapitalize="none" autoCorrect={false}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    />
  );
}
function GroupCard({ title, children, showRemove, onRemove, accent }) {
  return (
    <View style={[m.groupCard, accent && m.groupCardAccent]}>
      <View style={m.groupCardHeader}>
        <Text style={m.groupCardTitle}>{title}</Text>
        {showRemove && (
          <TouchableOpacity onPress={onRemove} style={m.removeBtn}>
            <Feather name="trash-2" size={13} color="#DC2626" />
            <Text style={m.removeBtnText}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}
function AddRowBtn({ label, onPress }) {
  return (
    <TouchableOpacity style={m.addBtn} onPress={onPress} activeOpacity={0.8}>
      <Feather name="plus" size={14} color="#1B4332" />
      <Text style={m.addBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingBottom: 16,
  },
  headerGreeting: { fontSize: 13, color: '#9E9484', fontWeight: '500', marginBottom: 2 },
  headerName: { fontSize: 24, fontWeight: '800', color: '#1B4332', letterSpacing: -0.5 },
  signOutBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#EAE4D9',
  },

  activeBanner: {
    backgroundColor: '#1B4332', borderRadius: 18, padding: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16,
    shadowColor: '#1B4332', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25, shadowRadius: 16, elevation: 8,
  },
  activeBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  activePulseDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#4ADE80' },
  activeBannerLabel: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, marginBottom: 3 },
  activeBannerTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  activeBannerSub: { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 },

  idCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#D1FAE5', marginBottom: 20,
  },
  idCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  idIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#ECFDF5', alignItems: 'center', justifyContent: 'center',
  },
  idCardLabel: { fontSize: 14, fontWeight: '700', color: '#1B4332' },
  idCardDesc: { fontSize: 12, color: '#6B7C74', marginTop: 1 },
  idBox: { backgroundColor: '#F7F5F0', borderRadius: 10, padding: 12 },
  idText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12, color: '#3D3530', letterSpacing: 0.3,
  },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#1A1A1A', letterSpacing: -0.3 },
  newCardBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#1B4332', borderRadius: 20, paddingVertical: 7, paddingHorizontal: 14,
  },
  newCardBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 22, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
    borderWidth: 1, borderColor: '#EAE4D9',
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A1A', marginBottom: 8 },
  emptyDesc: { fontSize: 14, color: '#9E9484', textAlign: 'center', lineHeight: 21, marginBottom: 24, paddingHorizontal: 24 },
  emptyBtn: { backgroundColor: '#1B4332', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 28 },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  travelCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 12,
    borderWidth: 1, borderColor: '#EAE4D9',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  tcTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  tcTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
  tcName: { fontSize: 15, fontWeight: '700', color: '#1A1A1A' },
  tcBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  tcBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  tcBadgeText: { fontSize: 11, fontWeight: '700' },
  tcDateRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tcDates: { fontSize: 12, color: '#9E9484', fontWeight: '500' },
  tcRouteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 10 },
  tcRoute: { fontSize: 13, color: '#52796F', flex: 1, lineHeight: 18 },
  tcExpanded: { borderTopWidth: 1, borderTopColor: '#F0EBE3', paddingTop: 14, marginTop: 4, gap: 14 },
  expandSection: { gap: 6 },
  expandHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  expandTitle: { fontSize: 11, fontWeight: '700', color: '#9E9484', letterSpacing: 0.5, textTransform: 'uppercase' },
  expandItem: { fontSize: 13, color: '#3D3530', lineHeight: 19, paddingLeft: 19 },
  tcActions: {
    flexDirection: 'row', gap: 8, flexWrap: 'wrap',
    borderTopWidth: 1, borderTopColor: '#F0EBE3', paddingTop: 14, marginTop: 10,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#EAE4D9', backgroundColor: '#FAFAF8',
  },
  actionBtnText: { fontSize: 12, fontWeight: '600', color: '#52796F' },
});

const m = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 36, paddingBottom: 16,
    backgroundColor: '#F7F5F0', borderBottomWidth: 1, borderBottomColor: '#EAE4D9',
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#EAE4D9',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A' },
  saveBtn: { backgroundColor: '#1B4332', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 18 },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  sectionHead: { marginTop: 24, marginBottom: 14 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#1A1A1A', letterSpacing: -0.2 },
  sectionSub: { fontSize: 12, color: '#9E9484', marginTop: 3 },
  label: { fontSize: 12, fontWeight: '600', color: '#7A8C84', marginBottom: 7 },
  input: {
    paddingVertical: 13, paddingHorizontal: 16,
    borderWidth: 1.5, borderColor: '#EAE4D9', borderRadius: 12,
    fontSize: 15, color: '#1A1A1A', backgroundColor: '#fff', marginBottom: 12,
  },
  inputFocused: { borderColor: '#1B4332' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  listNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1B4332', alignItems: 'center', justifyContent: 'center' },
  listNumText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  removeCircle: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFF5F5',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFC9C9',
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#1B4332', borderStyle: 'dashed', marginBottom: 4,
  },
  addBtnText: { fontSize: 14, fontWeight: '600', color: '#1B4332' },
  groupCard: { backgroundColor: '#FAFAF8', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#EAE4D9' },
  groupCardAccent: { borderColor: '#FFC9C9', backgroundColor: '#FFF8F8' },
  groupCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  groupCardTitle: { fontSize: 12, fontWeight: '700', color: '#9E9484', letterSpacing: 0.3 },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  removeBtnText: { fontSize: 12, color: '#DC2626', fontWeight: '600' },
  submitBtn: {
    backgroundColor: '#1B4332', borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', marginTop: 28,
    shadowColor: '#1B4332', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 5,
  },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});