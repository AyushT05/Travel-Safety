import React, { useState, useEffect } from 'react';
import PlaceField from '../components/PlaceField';
import { summarizeRisk, worstSeverity, SEVERITY_ORDER } from '../lib/placeRisk';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Platform, Alert, Modal,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons, Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import { checkIdNumberFormat } from '../utils/idValidation';

const STEPS = ['Notice', 'Details', 'Trip', 'Contacts'];

function toDbDate(d) {
  if (!d) return '';
  return d.toISOString().split('T')[0];
}

function toDisplayDate(d) {
  if (!d) return 'Select date';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CreateTravelCard({ user, onDone, onBack }) {
  const [step, setStep]     = useState(0);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName]     = useState(user.user_metadata?.full_name || '');
  const [mobile, setMobile]         = useState('');
  const [docType, setDocType]       = useState('');
  const [docFile, setDocFile]       = useState(null);
  const [idNumber, setIdNumber]     = useState('');

  // { status: 'idle' | 'checking' | 'done' | 'error', verdict?, confidence?,
  //   reasoning?, nameMatch?, message? }
  const [verification, setVerification]     = useState({ status: 'idle' });
  const [verifyOverride, setVerifyOverride] = useState(false);

  const [startDate, setStartDate]         = useState(null);
  const [endDate, setEndDate]             = useState(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker]     = useState(false);

  // Trip structure: start point and final destination are required and
  // always occupy the first/last position; intermediate stops are optional.
  // On submit these get flattened into one ordered `places` array —
  // [start, ...waypoints, destination] — which is exactly the shape every
  // other screen (Sidebar, MapView, DevicePanel) already expects and
  // displays as "A -> B -> C", so nothing downstream needs to change. It's
  // also exactly the expected-route data the anomaly-detection pipeline
  // needs to know a stop at one of these places is planned, not a
  // deviation.
  const [startPoint, setStartPoint]             = useState('');
  const [finalDestination, setFinalDestination] = useState('');
  const [waypoints, setWaypoints]               = useState([]);
  // Place chosen from the search box + its safety check: { place, risk, loading, error } | null.
  // `stops` runs parallel to `waypoints`.
  const [placeInfo, setPlaceInfo] = useState({ start: null, dest: null, stops: [] });
  const setStopInfo = (i, v) => setPlaceInfo(p => { const stops = [...p.stops]; stops[i] = v; return { ...p, stops }; });

  const [companions, setCompanions] = useState([{ name: '', phone: '' }]);
  const [emergency, setEmergency]   = useState([
    { name: '', phone: '' },
    { name: '', phone: '' },
    { name: '', phone: '' },
  ]);

  async function pickDocument() {
    // copyToCacheDirectory must be explicit, not left to the default —
    // Expo's own docs warn that without it, expo-file-system can fail to
    // read the picked file immediately afterward (exactly the "isn't
    // readable" IOException this was hitting), because the copy into the
    // app's cache isn't guaranteed to have finished by the time
    // getDocumentAsync's promise resolves otherwise.
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf'],
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets?.[0]) {
      setDocFile(result.assets[0]);
      setVerification({ status: 'idle' });
      setVerifyOverride(false);
    }
  }

  // Re-checks automatically whenever the picked file OR the declared
  // document type changes (so switching "Aadhaar" to "Passport" after
  // already uploading re-runs the check against the new claim).
  // Re-checks when the file, declared type, or declared ID number changes.
  // Debounced because each call is a real, metered API request and the ID
  // number changes on every keystroke.
  useEffect(() => {
    if (!docFile || !docType) return;
    const timeout = setTimeout(() => verifyDocument(), 800);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docFile, docType, idNumber]);

  async function verifyDocument() {
    setVerification({ status: 'checking' });
    try {
      let sourceUri = docFile.uri;
      let sourceMimeType = docFile.mimeType;

      // Shrink images before sending. A full-resolution phone photo can be
      // several MB, which is the likely cause of the intermittent "non-2xx"
      // failures (request size limits). PDFs are rendered server-side
      // instead. fetch().blob() is used rather than expo-file-system because
      // that module could not read Expo Go's DocumentPicker cache URIs.
      if (sourceMimeType !== 'application/pdf') {
        const manipulated = await ImageManipulator.manipulateAsync(
          docFile.uri,
          [{ resize: { width: 1600 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
        );
        sourceUri = manipulated.uri;
        sourceMimeType = 'image/jpeg';
      }

      const response = await fetch(sourceUri);
      const blob = await response.blob();
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });

      const { data, error } = await supabase.functions.invoke('verify-document', {
        body: {
          imageBase64: base64,
          mimeType: sourceMimeType,
          docType,
          fullName,
          declaredIdNumber: idNumber,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setVerification({ status: 'done', ...data });
    } catch (e) {
      // The real reason lives in e.context (the response body), not in
      // e.message, which is only the generic "non-2xx" wrapper.
      if (e?.context?.json) {
        e.context.json().then(
          (body) => console.error('verifyDocument failed, server said:', body),
          () => console.error('verifyDocument failed:', e)
        );
      } else {
        console.error('verifyDocument failed:', e);
      }
      // Fail open: a hiccup in the automatic check is not evidence the
      // document is invalid.
      setVerification({
        status: 'error',
        message: 'Automatic check unavailable right now -- continuing without it.',
      });
    }
  }

  const verificationBlocksContinue =
    verification.status === 'done' &&
    (verification.verdict === 'likely_invalid' || verification.idNumberMatch === false) &&
    !verifyOverride;

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

      const places = [startPoint.trim(), ...waypoints.map(w => w.trim()).filter(Boolean), finalDestination.trim()]
        .filter(Boolean);

      // Structured copy of each place (coordinates + a short risk summary). `places` below is
      // unchanged, so the dashboard and scoring service keep working exactly as before.
      const placeDetails = [
        { text: startPoint, info: placeInfo.start },
        ...waypoints.map((w, i) => ({ text: w, info: placeInfo.stops[i] })),
        { text: finalDestination, info: placeInfo.dest },
      ].filter(x => x.text.trim()).map(x => x.info?.place
        ? { name: x.text.trim(), place_id: x.info.place.id, lat: x.info.place.lat, lon: x.info.place.lon,
            state: x.info.place.state, district: x.info.place.district, risk: summarizeRisk(x.info.risk) }
        : { name: x.text.trim(), verified: false });

      const { error } = await supabase.from('travel_cards').insert({
        user_id: user.id, full_name: fullName, mobile,
        document_type: docType, document_url: documentUrl,
        id_number: idNumber.trim() || null,
        document_id_number_match: verification.status === 'done' ? (verification.idNumberMatch ?? null) : null,
        document_verdict: verification.status === 'done' ? verification.verdict : null,
        document_confidence: verification.status === 'done' ? verification.confidence : null,
        document_reasoning: verification.status === 'done' ? verification.reasoning : null,
        start_date: toDbDate(startDate), end_date: toDbDate(endDate),
        places,
        place_details: placeDetails,
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
        {/* STEP 0 -- Disclaimer */}
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

        {/* STEP 1 -- Personal details */}
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

            {docType ? (
              <>
                <FLabel text={`${docType} Number`} />
                <TextInput
                  style={[
                    s.input,
                    idNumber.trim() && !checkIdNumberFormat(docType, idNumber).valid && s.inputInvalid,
                  ]}
                  value={idNumber}
                  onChangeText={setIdNumber}
                  placeholder={docType === 'Aadhaar' ? 'XXXX XXXX XXXX' : docType === 'PAN Card' ? 'ABCDE1234F' : 'ID number'}
                  placeholderTextColor="#C4BAA8"
                  autoCapitalize="characters"
                  keyboardType={docType === 'Aadhaar' ? 'number-pad' : 'default'}
                />
                {idNumber.trim() && !checkIdNumberFormat(docType, idNumber).valid ? (
                  <Text style={s.idFormatError}>{checkIdNumberFormat(docType, idNumber).message}</Text>
                ) : null}
              </>
            ) : null}

            <FLabel text="Upload Document" />
            <TouchableOpacity style={s.uploadBtn} onPress={pickDocument} activeOpacity={0.8}>
              <Feather name={docFile ? 'file' : 'upload'} size={18} color={docFile ? '#1B4332' : '#9E9484'} />
              <Text style={[s.uploadText, docFile && { color: '#1B4332' }]}>
                {docFile ? docFile.name : 'Tap to upload (Image or PDF)'}
              </Text>
            </TouchableOpacity>

            {!docType && docFile && (
              <Text style={s.verifyHint}>Select a document type above to check this upload.</Text>
            )}

            {verification.status === 'checking' && (
              <View style={s.verifyCard}>
                <ActivityIndicator size="small" color="#1B4332" />
                <Text style={s.verifyCheckingText}>Checking document…</Text>
              </View>
            )}

            {verification.status === 'error' && (
              <View style={[s.verifyCard, s.verifyCardMuted]}>
                <Feather name="info" size={15} color="#9E9484" />
                <Text style={s.verifyMutedText}>{verification.message}</Text>
              </View>
            )}

            {verification.status === 'done' && (
              <View style={[
                s.verifyCard,
                verification.verdict === 'likely_genuine' && s.verifyCardGood,
                verification.verdict === 'uncertain' && s.verifyCardWarn,
                verification.verdict === 'likely_invalid' && s.verifyCardBad,
              ]}>
                <Feather
                  name={verification.verdict === 'likely_genuine' ? 'check-circle'
                    : verification.verdict === 'uncertain' ? 'help-circle' : 'alert-circle'}
                  size={16}
                  color={verification.verdict === 'likely_genuine' ? '#059669'
                    : verification.verdict === 'uncertain' ? '#CA8A04' : '#DC2626'}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[
                    s.verifyTitle,
                    verification.verdict === 'likely_genuine' && { color: '#059669' },
                    verification.verdict === 'uncertain' && { color: '#CA8A04' },
                    verification.verdict === 'likely_invalid' && { color: '#DC2626' },
                  ]}>
                    {verification.verdict === 'likely_genuine' ? `Looks like a valid ${docType}`
                      : verification.verdict === 'uncertain' ? 'Could not confirm automatically'
                      : `Doesn't look like a valid ${docType}`}
                  </Text>
                  <Text style={s.verifyReasoning}>{verification.reasoning}</Text>
                  {verification.nameMatch === false && (
                    <Text style={s.verifyNameWarning}>
                      The name on the document doesn't appear to match "{fullName}".
                    </Text>
                  )}

                  {verification.idNumberMatch === false && (
                    <Text style={s.verifyNameWarning}>
                      The number on the document ({verification.extractedIdNumber || 'unclear'}) doesn't match what you entered.
                    </Text>
                  )}
                  {verification.idNumberMatch === true && (
                    <Text style={s.verifyIdMatchGood}>Document number matches what you entered.</Text>
                  )}

                  {(verification.verdict === 'likely_invalid' || verification.idNumberMatch === false) && (
                    <TouchableOpacity
                      style={s.overrideRow}
                      onPress={() => setVerifyOverride(v => !v)}
                    >
                      <View style={[s.checkbox, verifyOverride && s.checkboxChecked]}>
                        {verifyOverride && <Feather name="check" size={11} color="#fff" />}
                      </View>
                      <Text style={s.overrideText}>
                        I confirm this is correct -- upload anyway
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            <Text style={s.verifyDisclaimer}>
              This is an automatic first-pass check, not official identity verification --
              it can miss things and occasionally flag genuine documents by mistake.
            </Text>

            <NextBtn
              disabled={verification.status === 'checking' || verificationBlocksContinue}
              onPress={() => {
                if (!fullName.trim() || !mobile.trim() || !docType) {
                  Alert.alert('Required', 'Please fill all fields and select an ID type.'); return;
                }
                if (idNumber.trim() && !checkIdNumberFormat(docType, idNumber).valid) {
                  Alert.alert('Check ID number', checkIdNumberFormat(docType, idNumber).message); return;
                }
                if (verificationBlocksContinue) {
                  const reason = verification.idNumberMatch === false
                    ? "The ID number on the document doesn't match what you entered."
                    : "This doesn't look like a valid document of the selected type.";
                  Alert.alert(
                    'Document check failed',
                    `${reason} Please double check and re-upload if needed, or confirm the checkbox above to continue anyway.`
                  );
                  return;
                }
                setStep(2);
              }}
            />
          </View>
        )}

        {/* STEP 2 -- Trip details */}
        {step === 2 && (
          <View>
            <Text style={s.pageTitle}>Trip Details</Text>
            <Text style={s.pageDesc}>Help us monitor your journey for anomalies</Text>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <FLabel text="Start Date" />
                <DateField
                  value={startDate}
                  onPress={() => setShowStartPicker(true)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <FLabel text="End Date" />
                <DateField
                  value={endDate}
                  onPress={() => {
                    if (!startDate) {
                      Alert.alert('Pick a start date first', 'Choose your start date before the end date.');
                      return;
                    }
                    setShowEndPicker(true);
                  }}
                />
              </View>
            </View>

            <DatePickerSheet
              visible={showStartPicker}
              value={startDate || new Date()}
              minimumDate={new Date()}
              onClose={() => setShowStartPicker(false)}
              onChange={(d) => {
                setStartDate(d);
                if (endDate && endDate < d) setEndDate(null);
              }}
            />
            <DatePickerSheet
              visible={showEndPicker}
              value={endDate || startDate || new Date()}
              minimumDate={startDate || new Date()}
              onClose={() => setShowEndPicker(false)}
              onChange={setEndDate}
            />

            <FLabel text="Start Point" />
            <PlaceField
              value={startPoint} onChangeText={setStartPoint}
              info={placeInfo.start} onInfoChange={v => setPlaceInfo(p => ({ ...p, start: v }))}
              startDate={startDate} endDate={endDate}
              placeholder="Where does your trip begin? (search a city or place)"
            />

            <FLabel text="Intermediate Stops" />
            <Text style={s.subDesc}>
              Places you'll pass through before your final destination -- stopping here won't
              be flagged as unusual
            </Text>
            {waypoints.map((stop, i) => (
              <View key={i} style={[s.listRow, { alignItems: 'flex-start' }]}>
                <View style={[s.listNum, { marginTop: 14 }]}><Text style={s.listNumText}>{i + 1}</Text></View>
                <PlaceField
                  style={{ flex: 1 }}
                  value={stop}
                  onChangeText={tx => { const n = [...waypoints]; n[i] = tx; setWaypoints(n); }}
                  info={placeInfo.stops[i] ?? null} onInfoChange={v => setStopInfo(i, v)}
                  startDate={startDate} endDate={endDate}
                  placeholder={`Stop ${i + 1} (search a place)`}
                />
                <TouchableOpacity style={[s.removeCircle, { marginTop: 14 }]}
                  onPress={() => {
                    setWaypoints(waypoints.filter((_, j) => j !== i));
                    setPlaceInfo(p => ({ ...p, stops: p.stops.filter((_, j) => j !== i) }));
                  }}>
                  <Feather name="x" size={12} color="#DC2626" />
                </TouchableOpacity>
              </View>
            ))}
            <AddRowBtn label="Add intermediate stop" onPress={() => setWaypoints([...waypoints, ''])} />

            <FLabel text="Final Destination" />
            <PlaceField
              value={finalDestination} onChangeText={setFinalDestination}
              info={placeInfo.dest} onInfoChange={v => setPlaceInfo(p => ({ ...p, dest: v }))}
              startDate={startDate} endDate={endDate}
              placeholder="Where does your trip end? (search a city or place)"
            />

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
              if (!startDate || !endDate) { Alert.alert('Required', 'Please select travel dates.'); return; }
              if (!startPoint.trim() || !finalDestination.trim()) {
                Alert.alert('Required', 'Please enter a start point and final destination.'); return;
              }
              // Serious warnings do not block the trip, but the traveller must see them first.
              const checks = [placeInfo.start, ...placeInfo.stops, placeInfo.dest].filter(i => i?.risk);
              const serious = checks.filter(i => ['warning', 'danger'].includes(worstSeverity(i.risk)));
              if (serious.length) {
                const lines = serious.map(i => {
                  const top = i.risk.warnings.find(w => SEVERITY_ORDER[w.severity] >= 2);
                  return `• ${i.place.name}: ${top?.title ?? 'serious warning'}`;
                }).join('\n');
                Alert.alert(
                  'Safety warnings for your trip',
                  `${lines}\n\nPlease read them on this page. You can continue, but consider changing your dates or plans.`,
                  [
                    { text: 'Review', style: 'cancel' },
                    { text: 'Continue anyway', onPress: () => setStep(3) },
                  ]
                );
                return;
              }
              setStep(3);
            }} />
          </View>
        )}

        {/* STEP 3 -- Emergency contacts */}
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
                { label: 'Document',           value: idNumber.trim() ? `${docType} (${idNumber.trim()})` : docType },
                { label: 'Dates',              value: `${toDisplayDate(startDate)} -> ${toDisplayDate(endDate)}` },
                { label: 'Route',               value: [startPoint, ...waypoints.filter(Boolean), finalDestination].filter(Boolean).join(' -> ') || '--' },
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
function DateField({ value, onPress }) {
  return (
    <TouchableOpacity style={s.dateBtn} onPress={onPress} activeOpacity={0.8}>
      <Feather name="calendar" size={15} color={value ? '#1B4332' : '#9E9484'} />
      <Text style={[s.dateBtnText, value && { color: '#1A1A1A', fontWeight: '600' }]}>
        {toDisplayDate(value)}
      </Text>
    </TouchableOpacity>
  );
}
// Android's native date dialog dismisses itself on selection; iOS's inline
// picker doesn't, so it needs an explicit sheet with a Done button -- this
// wraps both behind one consistent onChange(date) callback either way.
function DatePickerSheet({ visible, value, minimumDate, onChange, onClose }) {
  if (!visible) return null;

  if (Platform.OS === 'android') {
    return (
      <DateTimePicker
        value={value}
        mode="date"
        display="default"
        minimumDate={minimumDate}
        onChange={(event, selected) => {
          onClose();
          if (event.type === 'set' && selected) onChange(selected);
        }}
      />
    );
  }

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={s.pickerOverlay}>
        <View style={s.pickerSheet}>
          <DateTimePicker
            value={value}
            mode="date"
            display="inline"
            minimumDate={minimumDate}
            onChange={(event, selected) => { if (selected) onChange(selected); }}
          />
          <TouchableOpacity style={s.pickerDoneBtn} onPress={onClose} activeOpacity={0.9}>
            <Text style={s.pickerDoneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
function NextBtn({ onPress, disabled }) {
  return (
    <TouchableOpacity
      style={[s.nextBtn, disabled && s.nextBtnDisabled]}
      onPress={onPress}
      activeOpacity={0.9}
      disabled={disabled}
    >
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
  inputInvalid: { borderColor: '#DC2626' },
  idFormatError: { fontSize: 12, color: '#DC2626', marginTop: -8, marginBottom: 12 },

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
    borderRadius: 12, borderStyle: 'dashed', backgroundColor: '#FAFAF8', marginBottom: 12,
  },
  uploadText: { fontSize: 14, color: '#9E9484', flex: 1 },

  verifyHint: { fontSize: 12, color: '#CA8A04', marginBottom: 12 },
  verifyCard: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 12,
    backgroundColor: '#fff', borderColor: '#EAE4D9',
  },
  verifyCardMuted: { backgroundColor: '#FAFAF8', borderColor: '#EAE4D9' },
  verifyCardGood:  { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  verifyCardWarn:  { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  verifyCardBad:   { backgroundColor: '#FFF5F5', borderColor: '#FFC9C9' },
  verifyCheckingText: { fontSize: 13, color: '#1B4332', fontWeight: '600' },
  verifyMutedText:    { fontSize: 12, color: '#9E9484', flex: 1 },
  verifyTitle:        { fontSize: 13, fontWeight: '700', marginBottom: 3 },
  verifyReasoning:    { fontSize: 12, color: '#6b7280', lineHeight: 17 },
  verifyNameWarning:  { fontSize: 12, color: '#DC2626', marginTop: 6, fontWeight: '600' },
  verifyIdMatchGood:  { fontSize: 12, color: '#059669', marginTop: 6, fontWeight: '600' },
  verifyDisclaimer:   { fontSize: 11, color: '#C4BAA8', marginBottom: 18, lineHeight: 15 },

  overrideRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  checkbox: {
    width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: '#DC2626',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: '#DC2626' },
  overrideText: { fontSize: 12, color: '#DC2626', fontWeight: '600', flex: 1 },

  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 13, paddingHorizontal: 16,
    borderWidth: 1.5, borderColor: '#EAE4D9', borderRadius: 12,
    backgroundColor: '#fff', marginBottom: 12,
  },
  dateBtnText: { fontSize: 14, color: '#9E9484' },

  pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  pickerSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },
  pickerDoneBtn: {
    backgroundColor: '#1B4332', borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', marginTop: 8,
  },
  pickerDoneBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

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
  nextBtnDisabled: { opacity: 0.5 },
  nextBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  submitBtn: {
    backgroundColor: '#1B4332', borderRadius: 16, paddingVertical: 18, alignItems: 'center',
    shadowColor: '#1B4332', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 5,
  },
  submitBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  submitBtnText:  { color: '#fff', fontSize: 16, fontWeight: '700' },
});
