// Runs after every recorded fix (foreground watcher AND background task) and ends the current
// leg when the traveller has really arrived. See returnTrip.js for the rules.
//
// No import of backgroundTracking/trackingControl here on purpose (they import the recorder, which
// would make a cycle); the caller passes `stopTracking`.
import { supabase } from './supabase';
import { getTrackingContext, updateTrackingExtra } from './localDb';
import { stepArrival, shouldPause, resumeReminderDate } from './returnTrip';
import { scheduleResumeReminder, cancelResumeReminders } from './notifications';

const RETRY_EVERY_MS = 30_000;
let busy = false;
let lastAttempt = 0;

const localYmd = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// pos: an expo-location LocationObject. Returns 'paused' | 'completed' | null.
export async function afterFix(pos, { stopTracking }) {
  try {
    const ctx = await getTrackingContext();
    const x = ctx?.extra;
    if (!x?.target || !(x.pauseOnArrival || x.completeOnArrival)) return null;

    const fix = {
      lat: pos.coords.latitude, lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy, speed: pos.coords.speed,
      timestampMs: pos.timestamp || Date.now(),
    };
    const { state, arrived } = stepArrival(x.arrival, fix, x.target);

    const changed = state.count !== (x.arrival?.count ?? 0) || state.sinceMs !== (x.arrival?.sinceMs ?? null);
    if (changed) await updateTrackingExtra({ ...x, arrival: state });
    if (!arrived) return null;

    // Already arrived but the server write failed earlier: retry, but not on every 5 s fix.
    if (busy || Date.now() - lastAttempt < RETRY_EVERY_MS) return null;
    busy = true; lastAttempt = Date.now();
    try {
      const atIso = new Date(fix.timestampMs).toISOString();

      if (x.completeOnArrival) {
        const { error } = await supabase.from('travel_cards')
          .update({ status: 'completed', completed_at: atIso }).eq('id', ctx.travelCardId);
        if (error) return null;                       // keep tracking; retried on a later fix
        await cancelResumeReminders();
        await stopTracking();
        return 'completed';
      }

      // Outbound arrival. If the return day is today or already past, do not pause: carry on
      // tracking straight into the return leg.
      if (!shouldPause({ return_date: x.returnDate }, localYmd())) {
        await updateTrackingExtra({ ...x, pauseOnArrival: false, arrival: { count: 0, sinceMs: null } });
        return null;
      }
      const { error } = await supabase.from('travel_cards')
        .update({ status: 'paused', outbound_arrived_at: atIso }).eq('id', ctx.travelCardId);
      if (error) return null;                         // keep tracking; retried on a later fix
      await cancelResumeReminders();
      await scheduleResumeReminder(resumeReminderDate(x.returnDate), ctx.travelCardId);
      await stopTracking();
      return 'paused';
    } finally {
      busy = false;
    }
  } catch (e) {
    console.warn('arrival check failed:', e?.message ?? e);
    return null;
  }
}
