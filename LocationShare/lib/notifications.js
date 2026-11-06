// Messages from the AI trip analyst to the traveller (public.user_notifications).
// Delivery: Realtime for speed + a 30 s poll in case the socket dropped, and a local OS notification when the
// optional `expo-notifications` package is installed (so the message is visible with the app in the background).
// The traveller can answer "I'm OK" / "I need help"; the answer feeds the next analysis and the admin console.
import { supabase } from './supabase';

let Notifications = null;
try {
  // Optional dependency: `npx expo install expo-notifications`. Metro treats a require inside try/catch as optional.
  // eslint-disable-next-line global-require
  Notifications = require('expo-notifications');
  Notifications.setNotificationHandler?.({
    handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
  });
} catch { Notifications = null; }

const COLS = 'id, travel_card_id, kind, severity, title, body, actions, created_at, read_at, response';

export async function fetchOpenNotifications(userId, travelCardId, sinceMs = 6 * 3600 * 1000) {
  let q = supabase.from('user_notifications').select(COLS).eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - sinceMs).toISOString());
  if (travelCardId) q = q.eq('travel_card_id', travelCardId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(20);
  if (error) { console.warn('notifications unavailable (run 20261101_trip_insights_and_notifications.sql):', error.message); return []; }
  return data || [];
}

export function subscribeNotifications(userId, onInsert) {
  const ch = supabase.channel(`user_notifications_${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${userId}` },
      (p) => p.new && onInsert(p.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
}

export async function respondToNotification(id, response) {
  const { error } = await supabase.from('user_notifications')
    .update({ response, responded_at: new Date().toISOString(), read_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function markNotificationRead(id) {
  await supabase.from('user_notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
}

export async function showLocalNotification(n) {
  if (!Notifications) return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) await Notifications.requestPermissionsAsync();
    await Notifications.scheduleNotificationAsync({ content: { title: n.title, body: n.body, data: { id: n.id } }, trigger: null });
  } catch { /* the in-app card is the primary channel */ }
}
