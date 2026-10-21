// SyncManager: moves outbox events to Supabase.
//   * SOS first, then routine location history.
//   * At-least-once delivery + server-side idempotency (event_id unique index).
//   * An event leaves the queue only after the server confirmed it.
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { supabase } from './supabase';
import {
  getDb, recoverStuck, dueSos, sosAwaitingAck, dueLocations,
  deleteEvents, setStatus, bumpLocationFailure, pendingCounts, getSos, setSmsStatus,
} from './localDb';
import { sendSosSms } from './smsFallback';

const LOCATION_BATCH = 100;
const MAX_BATCHES_PER_FLUSH = 20;
const ACK_CHECK_EVERY_MS = 10000;
const TICK_MS = 5000;
const SOS_REQUEST_TIMEOUT_MS = 8000;

const listeners = new Set();
let flushing = false;
let rerun = false;
let locBackoffUntil = 0;
let locFailures = 0;
let lastAckCheck = 0;

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(); } catch { /* listener bug must not break sync */ } } }

const jitter = (ms) => ms * (0.75 + Math.random() * 0.5);

export function buildSosMessage(p) {
  const delayedS = Math.round((Date.now() - Date.parse(p.observed_at)) / 1000);
  const parts = ['Panic button triggered from mobile app'];
  if (p.lat == null) {
    parts.push('No location fix available at trigger time');
  } else {
    const fixAgeS = Math.round((Date.parse(p.observed_at) - Date.parse(p.location_observed_at)) / 1000);
    const acc = p.location_accuracy != null ? ` ±${Math.round(p.location_accuracy)} m` : '';
    parts.push(p.location_source === 'live'
      ? `Live fix${acc}`
      : `LAST KNOWN position${acc}, ${fixAgeS}s old at trigger time (not a live fix)`);
  }
  if (delayedS > 30) parts.push(`Pressed ${delayedS}s before delivery (phone was offline or retrying)`);
  return parts.join('. ');
}

function withTimeout(thenable, ms) {
  let timer;
  return Promise.race([
    thenable,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('request timed out')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Text the SOS to the gateway phone, once per SOS. The server dedupes by event_id, so it is
// harmless if the internet attempt also succeeds.
async function trySmsFallback(eventId, payload) {
  const fresh = await getSos(eventId);
  if (!fresh || fresh.sms_status || fresh.status === 'delivered' || fresh.status === 'acknowledged') return;
  await setSmsStatus(eventId, await sendSosSms(eventId, payload));
  emit();
}

export async function setSmsStatusAndNotify(eventId, status) {
  await setSmsStatus(eventId, status);
  emit();
}

async function deliverSos(row) {
  const p = JSON.parse(row.payload);
  // Known offline: do not wait for the network attempt to time out before texting.
  const net = await NetInfo.fetch().catch(() => null);
  if (net && (net.isConnected === false || net.isInternetReachable === false)) {
    await trySmsFallback(row.event_id, p);
  }
  await setStatus(row.event_id, 'sending');
  emit();
  try {
    const { error } = await withTimeout(supabase.from('alerts').upsert(
      {
        event_id: row.event_id,
        user_id: p.user_id,
        travel_card_id: p.travel_card_id ?? null,
        type: 'panic',
        severity: 'critical',
        lat: p.lat,
        lon: p.lon,
        location_accuracy: p.location_accuracy ?? null,
        location_observed_at: p.location_observed_at ?? null,
        observed_at: p.observed_at,
        message: buildSosMessage(p),
      },
      { onConflict: 'event_id', ignoreDuplicates: true }
    ), SOS_REQUEST_TIMEOUT_MS);
    if (error) throw error;

    // Do not trust the write blindly: read it back. "Delivered" means the row is really there.
    const { data, error: readErr } = await withTimeout(supabase
      .from('alerts').select('id,status').eq('event_id', row.event_id).maybeSingle(), SOS_REQUEST_TIMEOUT_MS);
    if (readErr) throw readErr;
    if (!data) throw new Error('SOS not visible on server after write');

    await setStatus(row.event_id, data.status === 'open' ? 'delivered' : 'acknowledged',
      { serverId: String(data.id) });
  } catch (e) {
    const attempts = row.attempts + 1;
    // SOS is retried quickly and forever; it is never dropped.
    const delay = Math.min(10000, jitter(1000 * 2 ** Math.min(attempts, 4)));
    await setStatus(row.event_id, 'queued',
      { lastError: String(e?.message ?? e), attempts, nextRetryAt: Date.now() + delay });
    // The internet attempt failed: use the cellular channel too.
    await trySmsFallback(row.event_id, p).catch(() => {});
  }
  emit();
}

async function checkAcknowledgements() {
  if (Date.now() - lastAckCheck < ACK_CHECK_EVERY_MS) return;
  lastAckCheck = Date.now();
  const rows = await sosAwaitingAck();
  for (const row of rows) {
    try {
      const { data } = await supabase.from('alerts').select('status').eq('event_id', row.event_id).maybeSingle();
      if (data && data.status !== 'open') { await setStatus(row.event_id, 'acknowledged'); emit(); }
    } catch { /* offline: try again next time */ }
  }
}

async function flushLocations(force) {
  for (let i = 0; i < MAX_BATCHES_PER_FLUSH; i++) {
    if (!force && Date.now() < locBackoffUntil) return;
    const rows = await dueLocations(LOCATION_BATCH);
    if (!rows.length) return;
    const ids = rows.map((r) => r.event_id);
    const { error } = await supabase.from('locations').upsert(
      rows.map((r) => JSON.parse(r.payload)),
      { onConflict: 'event_id', ignoreDuplicates: true }
    );
    if (error) {
      locFailures += 1;
      locBackoffUntil = Date.now() + jitter(Math.min(120000, 2000 * 2 ** Math.min(locFailures, 6)));
      await bumpLocationFailure(ids, String(error.message ?? error));
      return;
    }
    locFailures = 0;
    locBackoffUntil = 0;
    await deleteEvents(ids);
    emit();
  }
}

export async function flush({ force = false } = {}) {
  if (flushing) { rerun = true; return; }
  flushing = true;
  try {
    do {
      rerun = false;
      for (const row of await dueSos()) await deliverSos(row);
      await checkAcknowledgements();
      await flushLocations(force);
    } while (rerun);
  } catch (e) {
    console.warn('sync flush failed:', e?.message ?? e);
  } finally {
    flushing = false;
    emit();
  }
}

// Call once when a user is signed in. Returns a stop function.
export async function startSync() {
  await getDb();
  await recoverStuck();

  const netSub = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      locBackoffUntil = 0; locFailures = 0;   // network just came back: retry now, not after the backoff
      flush({ force: true });
    }
  });
  const appSub = AppState.addEventListener('change', (s) => { if (s === 'active') flush({ force: true }); });
  const timer = setInterval(async () => {
    const c = await pendingCounts();
    if (c.locations || c.sos) flush();
  }, TICK_MS);

  flush({ force: true });
  return () => { netSub(); appSub.remove(); clearInterval(timer); };
}
