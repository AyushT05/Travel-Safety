import React, { useState, useEffect, useRef } from 'react';
import { View, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Animated, Image } from 'react-native';
import { Text, TextInput, DISPLAY } from '../components/Text';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons, Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import * as Linking from 'expo-linking';

WebBrowser.maybeCompleteAuthSession();

export default function AuthScreen() {
  const [tab, setTab]           = useState('signin');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [method, setMethod]     = useState('email');
  const [otp, setOtp]           = useState('');
  const [otpSent, setOtpSent]   = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [message, setMessage]   = useState('');

  // One entrance: logo settles first, then the card follows.
  const brandIn = useRef(new Animated.Value(0)).current;
  const cardIn  = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.stagger(180, [
      Animated.timing(brandIn, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(cardIn,  { toValue: 1, duration: 650, useNativeDriver: true }),
    ]).start();
  }, [brandIn, cardIn]);
  const rise = (v, px) => ({ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [px, 0] }) }] });

  async function handleEmailAuth() {
    if (!email.trim() || !password) { setError('Please fill in all fields.'); return; }
    if (tab === 'signup' && !name.trim()) { setError('Please enter your name.'); return; }
    setLoading(true); setError('');
    if (tab === 'signin') {
      const { error: e } = await supabase.auth.signInWithPassword({ email, password });
      if (e) setError(e.message);
    } else {
      const { error: e } = await supabase.auth.signUp({
        email, password, options: { data: { full_name: name } },
      });
      if (e) setError(e.message);
      else setMessage('Check your email to confirm your account.');
    }
    setLoading(false);
  }

  async function handleSendOtp() {
    if (!phone.trim()) { setError('Enter a valid phone number.'); return; }
    setLoading(true); setError('');
    const { error: e } = await supabase.auth.signInWithOtp({ phone });
    if (e) setError(e.message);
    else { setOtpSent(true); setMessage('OTP sent to your phone.'); }
    setLoading(false);
  }

  async function handleVerifyOtp() {
    if (!otp.trim()) { setError('Enter the OTP.'); return; }
    setLoading(true); setError('');
    const { error: e } = await supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' });
    if (e) setError(e.message);
    setLoading(false);
  }

async function handleGoogle() {
  setLoading(true);
  setError('');

  const redirectTo = Linking.createURL('auth-callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    setError(error.message);
    setLoading(false);
    return;
  }

  const res = await WebBrowser.openAuthSessionAsync(
    data?.url,
    redirectTo
  );

  console.log(res);
  console.log(Linking.createURL('auth-callback'));

  setLoading(false);
}

  function switchMethod(m) { setMethod(m); setError(''); setMessage(''); setOtpSent(false); }
  function switchTab(t) { setTab(t); setError(''); setMessage(''); }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F2F7F3' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={s.root}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Brand */}
        <View style={s.glow} pointerEvents="none" />
        <Animated.View style={[s.brand, rise(brandIn, 10)]}>
          <Image source={require('../assets/logo-full.png')} style={s.logo} resizeMode="contain" />
          <Text style={s.brandSub}>Travel with confidence. Your safety, tracked.</Text>
        </Animated.View>

        {/* Card */}
        <Animated.View style={[s.card, rise(cardIn, 18)]}>
          <Text style={s.cardTitle}>{method === 'phone' ? 'Continue with your phone' : tab === 'signin' ? 'Welcome back' : 'Create your account'}</Text>
          {/* Method toggle */}
          <View style={s.methodRow}>
            <MethodBtn icon="mail-outline" label="Email"
              active={method === 'email'} onPress={() => switchMethod('email')} />
            <MethodBtn icon="phone-portrait-outline" label="Phone"
              active={method === 'phone'} onPress={() => switchMethod('phone')} />
          </View>

          {/* Tab row — email only */}
          {method === 'email' && (
            <View style={s.tabRow}>
              <TabBtn label="Sign In" active={tab === 'signin'} onPress={() => switchTab('signin')} />
              <TabBtn label="Sign Up" active={tab === 'signup'} onPress={() => switchTab('signup')} />
            </View>
          )}

          {/* Email fields */}
          {method === 'email' && (
            <View>
              {tab === 'signup' && (
                <Field icon="person-outline" label="Full Name"
                  value={name} onChange={setName} placeholder="Your name" />
              )}
              <Field icon="mail-outline" label="Email Address"
                value={email} onChange={setEmail}
                placeholder="you@example.com" keyboard="email-address" />
              <Field icon="lock-closed-outline" label="Password"
                value={password} onChange={setPassword}
                placeholder="••••••••" secure={!showPass}
                rightIcon={
                  <TouchableOpacity onPress={() => setShowPass(v => !v)} style={s.eyeBtn}>
                    <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color="#6F8378" />
                  </TouchableOpacity>
                }
              />
              {error   !== '' && <FeedbackBox type="error" msg={error} />}
              {message !== '' && <FeedbackBox type="success" msg={message} />}
              <SubmitBtn
                label={tab === 'signin' ? 'Sign in' : 'Create account'}
                loading={loading} onPress={handleEmailAuth}
              />
            </View>
          )}

          {/* Phone — send OTP */}
          {method === 'phone' && !otpSent && (
            <View>
              <Field icon="phone-portrait-outline" label="Phone Number"
                value={phone} onChange={setPhone}
                placeholder="+91 9876543210" keyboard="phone-pad" />
              {error !== '' && <FeedbackBox type="error" msg={error} />}
              <SubmitBtn label="Send OTP" loading={loading} onPress={handleSendOtp} />
            </View>
          )}

          {/* Phone — verify OTP */}
          {method === 'phone' && otpSent && (
            <View>
              <View style={s.otpHintRow}>
                <Ionicons name="checkmark-circle" size={16} color="#1B4332" />
                <Text style={s.otpHint}>OTP sent to {phone}</Text>
              </View>
              <Field icon="keypad-outline" label="OTP Code"
                value={otp} onChange={setOtp}
                placeholder="6-digit code" keyboard="number-pad" />
              {error   !== '' && <FeedbackBox type="error" msg={error} />}
              {message !== '' && <FeedbackBox type="success" msg={message} />}
              <SubmitBtn label="Verify OTP" loading={loading} onPress={handleVerifyOtp} />
              <TouchableOpacity onPress={() => setOtpSent(false)} style={s.backLink}>
                <Feather name="arrow-left" size={14} color="#52796F" />
                <Text style={s.backLinkText}>Change number</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Divider */}
          <View style={s.divider}>
            <View style={s.divLine} />
            <Text style={s.divText}>or</Text>
            <View style={s.divLine} />
          </View>

          {/* Google */}
          <TouchableOpacity style={s.googleBtn} onPress={handleGoogle} activeOpacity={0.85}>
            <Ionicons name="logo-google" size={18} color="#4285F4" />
            <Text style={s.googleText}>Continue with Google</Text>
          </TouchableOpacity>
        </Animated.View>

        <Text style={s.footNote}>By continuing you agree to our Terms & Privacy Policy</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function MethodBtn({ icon, label, active, onPress }) {
  return (
    <TouchableOpacity style={[s.methodBtn, active && s.methodBtnActive]} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name={icon} size={16} color={active ? '#1B4332' : '#6F8378'} />
      <Text style={[s.methodBtnText, active && s.methodBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function TabBtn({ label, active, onPress }) {
  return (
    <TouchableOpacity style={[s.tabBtn, active && s.tabBtnActive]} onPress={onPress} activeOpacity={0.8}>
      <Text style={[s.tabText, active && s.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Field({ icon, label, value, onChange, placeholder, secure, keyboard, rightIcon }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={s.fieldWrap}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.fieldRow, focused && s.fieldRowFocused]}>
        <Ionicons name={icon} size={16} color={focused ? '#1B4332' : '#A7B8AD'} style={s.fieldIcon} />
        <TextInput
          style={s.fieldInput}
          value={value} onChangeText={onChange}
          placeholder={placeholder} placeholderTextColor="#A7B8AD"
          secureTextEntry={secure} keyboardType={keyboard || 'default'}
          autoCapitalize="none" autoCorrect={false}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        />
        {rightIcon}
      </View>
    </View>
  );
}

function FeedbackBox({ type, msg }) {
  return (
    <View style={[s.feedbackBox, type === 'error' ? s.feedbackError : s.feedbackSuccess]}>
      <Ionicons
        name={type === 'error' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
        size={15} color={type === 'error' ? '#C0392B' : '#1B4332'}
      />
      <Text style={[s.feedbackText, type === 'error' ? s.feedbackErrorText : s.feedbackSuccessText]}>
        {msg}
      </Text>
    </View>
  );
}

function SubmitBtn({ label, loading, onPress }) {
  return (
    <TouchableOpacity style={s.submitBtn} onPress={onPress} disabled={loading} activeOpacity={0.9}>
      {loading
        ? <ActivityIndicator color="#fff" size="small" />
        : <Text style={s.submitText}>{label}</Text>
      }
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flexGrow: 1, padding: 24, paddingTop: 72, paddingBottom: 40 },

  brand: { alignItems: 'center', marginBottom: 28 },
  glow: { position: 'absolute', top: -120, right: -90, width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(6,127,56,0.10)' },
  logo: { width: 250, height: 71, marginBottom: 6 },
  brandSub: { fontSize: 14, color: '#5B7266', textAlign: 'center', lineHeight: 20 },

  card: {
    backgroundColor: '#fff', borderRadius: 28, padding: 24,
    borderWidth: 1, borderColor: '#E3EDE5',
    shadowColor: '#0E3B24', shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12, shadowRadius: 28, elevation: 8,
  },
  cardTitle: { fontFamily: DISPLAY, fontSize: 24, color: '#0E3B24', letterSpacing: -0.4, marginBottom: 18 },

  methodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  methodBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#DAE6DD',
  },
  methodBtnActive: { borderColor: '#067F38', backgroundColor: '#E8F5EB' },
  methodBtnText: { fontSize: 13, fontWeight: '600', color: '#6F8378' },
  methodBtnTextActive: { color: '#1B4332' },

  tabRow: {
    flexDirection: 'row', backgroundColor: '#F2F7F3',
    borderRadius: 12, padding: 3, marginBottom: 20,
  },
  tabBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  tabBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  tabText: { fontSize: 13, fontWeight: '600', color: '#6F8378' },
  tabTextActive: { color: '#1B4332' },

  fieldWrap: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#7A8C84', marginBottom: 7 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#DAE6DD', borderRadius: 12,
    backgroundColor: '#F8FBF8', paddingHorizontal: 14,
  },
  fieldRowFocused: { borderColor: '#067F38', backgroundColor: '#fff' },
  fieldIcon: { marginRight: 10 },
  fieldInput: { flex: 1, paddingVertical: 13, fontSize: 15, color: '#0F2118' },
  eyeBtn: { padding: 4 },

  otpHintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  otpHint: { fontSize: 13, color: '#1B4332', fontWeight: '500' },

  feedbackBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1,
  },
  feedbackError:       { backgroundColor: '#FFF0F0', borderColor: '#FFD0D0' },
  feedbackSuccess:     { backgroundColor: '#F0FAF4', borderColor: '#B7EBC8' },
  feedbackText:        { fontSize: 13, flex: 1, lineHeight: 18 },
  feedbackErrorText:   { color: '#C0392B' },
  feedbackSuccessText: { color: '#1B4332' },

  submitBtn: {
    backgroundColor: '#0E3B24', borderRadius: 16,
    paddingVertical: 16, alignItems: 'center', marginTop: 4,
    shadowColor: '#1B4332', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700', },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 },
  divLine: { flex: 1, height: 1, backgroundColor: '#DAE6DD' },
  divText: { fontSize: 12, color: '#A7B8AD', fontWeight: '500' },

  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: '#DAE6DD', backgroundColor: '#F8FBF8',
  },
  googleText: { fontSize: 15, fontWeight: '600', color: '#3D3530' },

  backLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  backLinkText: { fontSize: 13, color: '#52796F', fontWeight: '500' },

  footNote: { textAlign: 'center', fontSize: 11, color: '#A7B8AD', marginTop: 24 },
});