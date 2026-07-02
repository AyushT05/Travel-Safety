import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Platform, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons, Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const STEPS = ['Notice', 'Details', 'Trip', 'Contacts'];

export default function CreateTravelCard({ user, onDone, onBack }) {
  const [step, setStep]     = useState(0);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName]     = useState(user.user_metadata?.full_name || '');
  const [mobile, setMobile]         = useState('');
  const [docType, setDocType]       = useState('');
  const [docFile, setDocFile]       = useState(null);
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');
  const [places, setPlaces]         = useState(['']);
  const [companions, setCompanions] = useState([{ name: '', phone: '' }]);
  const [emergency, setEmergency]   = useState([
    { name: '', phone: '' },
    { name: '', phone: '' },
    { name: '', phone: '' },
  ]);

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'] });
    if (!result.canceled && result.assets?.[0]) setDocFile(result.assets[0]);
  }

  async function handleSubmit() {
    const validEmergency = emergency.filter(c => c.name.trim() && c.phone.trim());
    if (validEmergency.length < 3) {
      Alert.alert('Required', 'Please add at least 3 emergency contacts.'); return;
    }
    setSaving(true);
    try {
      let documentUrl = null;
      if (docFile) {
        const ext  = docFile.name.split('.').pop();
        const path = `${user.id}/${Date.now()}.${ext}`;
        const response = await fetch(docFile.uri);
        const blob = await response.blob();
        const { error: uploadError } = await supabase.storage
          .from('travel-documents').upload(path, blob, { contentType: docFile.mimeType });
        if (!uploadError) documentUrl = path;
      }
      const { error } = await supabase.from('travel_cards').insert({
        user_id: user.id, full_name: fullName, mobile,
        document_type: docType, document_url: documentUrl,
        start_date: startDate, end_date: endDate,
        places: places.filter(p => p.trim()),
        companions: companions.filter(c => c.name.trim()),
        emergency_contacts: validEmergency,
        disclaimer_accepted: true, status: 'upcoming',
      });
      if (error) Alert.alert('Error', error.message);
      else Alert.alert(
        'Travel card created',
        'Your journey is registered. Stay safe.',
        [{ text: 'Done', onPress: onDone }]
      );
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
    setSaving(false);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F7F5F0' }}>
      <StatusBar style="dark" />

      {/* Top bar */}
      <View style={s.topBar}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={step === 0 ? onBack : () => setStep(v => v - 1)}
        >
          <Feather name="arrow-left" size={18} color="#1B4332" />
        </TouchableOpacity>
        <Text style={s.topTitle}>{STEPS[step]}</Text>
        {step > 0
          ? <Text style={s.stepCount}>{step} / {STEPS.length - 1}</Text>
          : <View style={{ width: 40 }} />
        }
      </View>

      {/* Progress bar */}
      {step > 0 && (
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${(step / (STEPS.length - 1)) * 100}%` }]} />
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* STEP 0 — Disclaimer */}
        {step === 0 && (
          <View>
            <View style={s.disclaimerIconWrap}>
              <Ionicons name="shield-checkmark" size={36} color="#1B4332" />
            </View>
            <Text style={s.pageTitle}>Safety Notice</Text>
            <Text style={s.pageDesc}>Please read before proceeding</Text>

            {[
              { icon: 'navigation',  title: 'Location Access',    desc: 'Your real-time GPS location will be tracked throughout your journey to ensure your safety.' },
              { icon: 'alert-triangle', title: 'Anomaly Detection', desc: 'Our system monitors for route deviations and will alert your emergency contacts.' },
              { icon: 'phone-call',  title: 'Emergency Actions',  desc: 'In detected emergencies, your registered contacts will be notified immediately.' },
              { icon: 'lock',        title: 'Data Privacy',       desc: 'Your location data is encrypted and only shared with your designated contacts.' },
            ].map((item, i) => (
              <View key={i} style={s.disclaimerCard}>
                <View style={s.disclaimerCardIcon}>
                  <Feather name={item.icon} size={18} color="#1B4332" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.disclaimerCardTitle}>{item.title}</Text>
                  <Text style={s.disclaimerCardDesc}>{item.desc}</Text>
                </View>
              </View>
            ))}

            <TouchableOpacity style={s.agreeBtn} onPress={() => setStep(1)} activeOpacity={0.9}>
              <Text style={s.agreeBtnText}>I understand and agree</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.declineBtn} onPress={onBack}>
              <Text style={s.declineBtnText}>Go back</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* STEP 1 — Personal details */}
        {step === 1 && (
          <View>
            <Text style={s.pageTitle}>Personal Details</Text>
            <Text style={s.pageDesc}>We need to verify your identity for safety purposes</Text>

            <FLabel text="Full Name" />
            <FInput value={fullName} onChange={setFullName} placeholder="As per your ID" />

            <FLabel text="Mobile Number" />
            <FInput value={mobile} onChange={setMobile} placeholder="+91 9876543210" keyboard="phone-pad" />

            <FLabel text="Government ID Type" />
            <View style={s.chipRow}>
              {['Aadhaar', 'PAN Card', 'Passport', 'Voter ID'].map(type => (
                <TouchableOpacity
                  key={type}
                  style={[s.chip, docType === type && s.chipActive]}
                  onPress={() => setDocType(type)}
                >
                  {docType === type && <Feather name="check" size={12} color="#1B4332" />}
                  <Text style={[s.chipText, docType === type && s.chipTextActive]}>{type}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <FLabel text="Upload Document" />
            <TouchableOpacity style={s.uploadBtn} onPress={pickDocument} activeOpacity={0.8}>
              <Feather name={docFile ? 'file' : 'upload'} size={18} color={docFile ? '#1B4332' : '#9E9484'} />
              <Text style={[s.uploadText, docFile && { color: '#1B4332' }]}>
                {docFile ? docFile.name : 'Tap to upload (Image or PDF)'}
              </Text>
            </TouchableOpacity>

            <NextBtn onPress={() => {
              if (!fullName.trim() || !mobile.trim() || !docType) {
                Alert.alert('Required', 'Please fill all fields and select an ID type.'); return;
              }
              setStep(2);
            }} />
          </View>
        )}

        {/* STEP 2 — Trip details */}
        {step === 2 && (
          <View>
            <Text style={s.pageTitle}>Trip Details</Text>
            <Text style={s.pageDesc}>Help us monitor your journey for anomalies</Text>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <FLabel text="Start Date" />
                <FInput value={startDate} onChange={setStartDate} placeholder="YYYY-MM-DD" />
              </View>
              <View style={{ flex: 1 }}>
                <FLabel text="End Date" />
                <FInput value={endDate} onChange={setEndDate} placeholder="YYYY-MM-DD" />
              </View>
            </View>

            <FLabel text="Destinations" />
            {places.map((place, i) => (
              <View key={i} style={s.listRow}>
                <View style={s.listNum}><Text style={s.listNumText}>{i + 1}</Text></View>
                <TextInput
                  style={[s.input, { flex: 1 }]} value={place}
                  onChangeText={t => { const n = [...places]; n[i] = t; setPlaces(n); }}
                  placeholder={`Destination ${i + 1}`} placeholderTextColor="#C4BAA8"
                />
                {places.length > 1 && (
                  <TouchableOpacity style={s.removeCircle}
                    onPress={() => setPlaces(places.filter((_, j) => j !== i))}>
                    <Feather name="x" size={12} color="#DC2626" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <AddRowBtn label="Add destination" onPress={() => setPlaces([...places, ''])} />

            <FLabel text="Travel Companions" />
            <Text style={s.subDesc}>People travelling with you</Text>
            {companions.map((c, i) => (
              <View key={i} style={s.groupCard}>
                <View style={s.groupCardHeader}>
                  <Text style={s.groupCardTitle}>Person {i + 1}</Text>
                  {companions.length > 1 && (
                    <TouchableOpacity style={s.removeInlineBtn}
                      onPress={() => setCompanions(companions.filter((_, j) => j !== i))}>
                      <Feather name="trash-2" size={13} color="#DC2626" />
                      <Text style={s.removeInlineBtnText}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <FInput value={c.name} onChange={t => { const n = [...companions]; n[i].name = t; setCompanions(n); }} placeholder="Full name" />
                <FInput value={c.phone} onChange={t => { const n = [...companions]; n[i].phone = t; setCompanions(n); }} placeholder="Phone number" keyboard="phone-pad" />
              </View>
            ))}
            <AddRowBtn label="Add companion" onPress={() => setCompanions([...companions, { name: '', phone: '' }])} />

            <NextBtn onPress={() => {
              if (!startDate || !endDate) { Alert.alert('Required', 'Please enter travel dates.'); return; }
              setStep(3);
            }} />
          </View>
        )}

        {/* STEP 3 — Emergency contacts */}
        {step === 3 && (
          <View>
            <Text style={s.pageTitle}>Emergency Contacts</Text>
            <Text style={s.pageDesc}>Minimum 3 contacts who will be notified in emergencies</Text>

            {emergency.map((c, i) => (
              <View key={i} style={[s.groupCard, s.groupCardEmergency]}>
                <View style={s.groupCardHeader}>
                  <View style={s.groupCardTitleRow}>
                    <View style={s.ecNum}><Text style={s.ecNumText}>{i + 1}</Text></View>
                    <Text style={s.groupCardTitle}>Contact {i + 1}{i < 3 ? ' · Required' : ''}</Text>
                  </View>
                  {i >= 3 && (
                    <TouchableOpacity style={s.removeInlineBtn}
                      onPress={() => setEmergency(emergency.filter((_, j) => j !== i))}>
                      <Feather name="trash-2" size={13} color="#DC2626" />
                      <Text style={s.removeInlineBtnText}>Remove</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <FInput value={c.name} onChange={t => { const n = [...emergency]; n[i].name = t; setEmergency(n); }} placeholder="Contact name" />
                <FInput value={c.phone} onChange={t => { const n = [...emergency]; n[i].phone = t; setEmergency(n); }} placeholder="Phone number" keyboard="phone-pad" />
              </View>
            ))}
            <AddRowBtn label="Add more contacts" onPress={() => setEmergency([...emergency, { name: '', phone: '' }])} />

            {/* Summary */}
            <View style={s.summaryCard}>
              <View style={s.summaryHeader}>
                <Feather name="clipboard" size={16} color="#52796F" />
                <Text style={s.summaryTitle}>Summary</Text>
              </View>
              {[
                { label: 'Name',               value: fullName },
                { label: 'Mobile',             value: mobile },
                { label: 'Document',           value: docType },
                { label: 'Dates',              value: `${startDate} → ${endDate}` },
                { label: 'Destinations',       value: places.filter(Boolean).join(', ') || '—' },
                { label: 'Emergency contacts', value: `${emergency.filter(c => c.name && c.phone).length} added` },
              ].map((row, i) => (
                <View key={i} style={s.summaryRow}>
                  <Text style={s.summaryLabel}>{row.label}</Text>
                  <Text style={s.summaryValue}>{row.value}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={s.submitBtn} onPress={handleSubmit} disabled={saving} activeOpacity={0.9}>
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : (
                  <View style={s.submitBtnInner}>
                    <Ionicons name="shield-checkmark" size={18} color="#fff" />
                    <Text style={s.submitBtnText}>Create Travel Card</Text>
                  </View>
                )
              }
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function FLabel({ text }) { return <Text style={s.label}>{text}</Text>; }
function FInput({ value, onChange, placeholder, keyboard }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[s.input, focused && s.inputFocused]}
      value={value} onChangeText={onChange}
      placeholder={placeholder} placeholderTextColor="#C4BAA8"
      keyboardType={keyboard || 'default'}
      autoCapitalize="none" autoCorrect={false}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    />
  );
}
function NextBtn({ onPress }) {
  return (
    <TouchableOpacity style={s.nextBtn} onPress={onPress} activeOpacity={0.9}>
      <Text style={s.nextBtnText}>Continue</Text>
      <Feather name="arrow-right" size={16} color="#fff" />
    </TouchableOpacity>
  );
}
function AddRowBtn({ label, onPress }) {
  return (
    <TouchableOpacity style={s.addBtn} onPress={onPress} activeOpacity={0.8}>
      <Feather name="plus" size={14} color="#1B4332" />
      <Text style={s.addBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 56 : 36, paddingBottom: 14,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#EAE4D9',
  },
  topTitle: { fontSize: 17, fontWeight: '700', color: '#1A1A1A' },
  stepCount: { fontSize: 13, fontWeight: '600', color: '#9E9484' },
  progressTrack: { height: 3, backgroundColor: '#EAE4D9', marginHorizontal: 20, borderRadius: 2, marginBottom: 6 },
  progressFill: { height: 3, backgroundColor: '#1B4332', borderRadius: 2 },

  disclaimerIconWrap: {
    width: 72, height: 72, borderRadius: 22, backgroundColor: '#ECFDF5',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
    borderWidth: 1.5, borderColor: '#D1FAE5',
  },
  pageTitle: { fontSize: 26, fontWeight: '800', color: '#1A1A1A', letterSpacing: -0.5, marginBottom: 6 },
  pageDesc:  { fontSize: 14, color: '#9E9484', marginBottom: 24, lineHeight: 20 },

  disclaimerCard: {
    flexDirection: 'row', gap: 14, backgroundColor: '#fff',
    borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#EAE4D9',
  },
  disclaimerCardIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#ECFDF5',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  disclaimerCardTitle: { fontSize: 14, fontWeight: '700', color: '#1A1A1A', marginBottom: 4 },
  disclaimerCardDesc:  { fontSize: 13, color: '#9E9484', lineHeight: 19 },

  agreeBtn: {
    backgroundColor: '#1B4332', borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', marginTop: 16,
    shadowColor: '#1B4332', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 5,
  },
  agreeBtnText:  { color: '#fff', fontSize: 16, fontWeight: '700' },
  declineBtn:    { alignItems: 'center', paddingVertical: 14 },
  declineBtnText:{ fontSize: 14, color: '#9E9484', fontWeight: '500' },

  label:   { fontSize: 12, fontWeight: '600', color: '#7A8C84', marginBottom: 8, marginTop: 4 },
  subDesc: { fontSize: 12, color: '#C4BAA8', marginTop: -4, marginBottom: 12 },
  input: {
    paddingVertical: 13, paddingHorizontal: 16,
    borderWidth: 1.5, borderColor: '#EAE4D9', borderRadius: 12,
    fontSize: 15, color: '#1A1A1A', backgroundColor: '#fff', marginBottom: 12,
  },
  inputFocused: { borderColor: '#1B4332' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#EAE4D9', backgroundColor: '#fff',
  },
  chipActive:     { borderColor: '#1B4332', backgroundColor: '#ECFDF5' },
  chipText:       { fontSize: 13, fontWeight: '600', color: '#9E9484' },
  chipTextActive: { color: '#1B4332' },

  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderWidth: 1.5, borderColor: '#EAE4D9',
    borderRadius: 12, borderStyle: 'dashed', backgroundColor: '#FAFAF8', marginBottom: 20,
  },
  uploadText: { fontSize: 14, color: '#9E9484', flex: 1 },

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
    borderWidth: 1.5, borderColor: '#1B4332', borderStyle: 'dashed', marginBottom: 20,
  },
  addBtnText: { fontSize: 14, fontWeight: '600', color: '#1B4332' },

  groupCard:          { backgroundColor: '#FAFAF8', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#EAE4D9' },
  groupCardEmergency: { borderColor: '#FFC9C9', backgroundColor: '#FFF8F8' },
  groupCardHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  groupCardTitleRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupCardTitle:     { fontSize: 12, fontWeight: '700', color: '#9E9484', letterSpacing: 0.3 },
  ecNum:     { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFE4E4', alignItems: 'center', justifyContent: 'center' },
  ecNumText: { fontSize: 11, fontWeight: '700', color: '#DC2626' },
  removeInlineBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  removeInlineBtnText: { fontSize: 12, color: '#DC2626', fontWeight: '600' },

  summaryCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    marginTop: 8, marginBottom: 20, borderWidth: 1, borderColor: '#EAE4D9',
  },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  summaryTitle:  { fontSize: 15, fontWeight: '700', color: '#1A1A1A' },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F7F5F0',
  },
  summaryLabel: { fontSize: 13, color: '#9E9484', fontWeight: '500' },
  summaryValue: { fontSize: 13, color: '#1A1A1A', fontWeight: '600', flex: 1, textAlign: 'right' },

  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1B4332', borderRadius: 14, paddingVertical: 15, marginTop: 8,
    shadowColor: '#1B4332', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22, shadowRadius: 8, elevation: 4,
  },
  nextBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  submitBtn: {
    backgroundColor: '#1B4332', borderRadius: 16, paddingVertical: 18, alignItems: 'center',
    shadowColor: '#1B4332', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 5,
  },
  submitBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  submitBtnText:  { color: '#fff', fontSize: 16, fontWeight: '700' },
});