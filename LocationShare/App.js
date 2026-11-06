import React, { useState, useEffect } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import { supabase } from './lib/supabase';
import AuthScreen from './screens/AuthScreen';
import HomeScreen from './screens/HomeScreen';
import CreateTravelCard from './screens/CreateTravelCard';
import ActiveTracking from './screens/ActiveTracking';
import { startSync } from './lib/sync';
import './lib/backgroundTracking'; // registers the background location task at load time

function Splash() {
  const fade = React.useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 700, useNativeDriver: true }).start();
  }, [fade]);
  return (
    <View style={s.splash}>
      <Animated.Image
        source={require('./assets/logo-full.png')}
        resizeMode="contain"
        style={{ width: 240, height: 68, opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}
      />
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
  });
  const [user, setUser]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [screen, setScreen]       = useState('home'); // home | create | tracking
  const [activeCard, setActiveCard] = useState(null);
  const [trackingState, setTrackingState] = useState(null); // persisted tracking state

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Start the outbox sync (SOS + location uploads) for as long as someone is signed in.
  useEffect(() => {
    if (!user) return;
    let stop;
    let cancelled = false;
    startSync().then((fn) => { if (cancelled) fn(); else stop = fn; }).catch((e) => console.warn('sync start failed', e));
    return () => { cancelled = true; if (stop) stop(); };
  }, [user?.id]);

  if (loading || !fontsLoaded) return <Splash />;

  if (!user) return <AuthScreen />;

  if (screen === 'create') return (
    <CreateTravelCard
      user={user}
      onDone={() => setScreen('home')}
      onBack={() => setScreen('home')}
    />
  );

  if (screen === 'tracking' && activeCard) return (
    <ActiveTracking
      user={user}
      card={activeCard}
      trackingState={trackingState}
      onTrackingStateChange={setTrackingState}
      onStop={() => {
        setActiveCard(null);
        setScreen('home');
      }}
    />
  );

  return (
    <HomeScreen
      user={user}
      onCreateCard={() => setScreen('create')}
      onStartTracking={(card) => { setActiveCard(card); setScreen('tracking'); }}
    />
  );
}

const s = StyleSheet.create({
  splash: { flex: 1, backgroundColor: '#F2F7F3', alignItems: 'center', justifyContent: 'center' },
});
