// Durable on-device storage: the outbox (events waiting to reach the server)
// and the last reliable GPS fix. Backed by SQLite so it survives app restarts.
import * as SQLite from 'expo-sqlite';

const MAX_QUEUED_LOCATIONS = 5000; // ~7 h at one fix / 5 s. SOS rows are never pruned.

let dbPromise = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('margarakshak.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS outbox (
          event_id      TEXT PRIMARY KEY,
          kind          TEXT NOT NULL,              -- 'location' | 'sos'
          payload       TEXT NOT NULL,              -- JSON, exactly what is sent to the server
          status        TEXT NOT NULL,              -- queued | sending | delivered | acknowledged
          attempts      INTEGER NOT NULL DEFAULT 0,
          next_retry_at INTEGER NOT NULL DEFAULT 0, -- epoch ms
          last_error    TEXT,
          server_id     TEXT,                       -- alerts.id once the server has it
          sms_status    TEXT,                       -- NULL | sent | needs_user | composer_sent | unavailable
          created_at    INTEGER NOT NULL            -- epoch ms
        );
        CREATE INDEX IF NOT EXISTS outbox_kind_status_idx ON outbox (kind, status, created_at);
        -- Which trip the background task should record for. The task can run with no UI
        -- mounted, so it cannot rely on React state.
        CREATE TABLE IF NOT EXISTS tracking_context (
          id             INTEGER PRIMARY KEY CHECK (id = 1),
          user_id        TEXT NOT NULL,
          travel_card_id TEXT NOT NULL,
          end_date       TEXT,                      -- YYYY-MM-DD, tracking stops itself after this day
          started_at     INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS last_reliable_fix (
          id          INTEGER PRIMARY KEY CHECK (id = 1),
          lat         REAL NOT NULL,
          lon         REAL NOT NULL,
          accuracy    REAL,
          observed_at INTEGER NOT NULL              -- epoch ms, device time
        );
      `);
      // Phones that already ran Feature 1 have the table without sms_status.
      try { await db.execAsync(`ALTER TABLE outbox ADD COLUMN sms_status TEXT`); } catch { /* already there */ }
      return db;
    })();
  }
  return dbPromise;
}

// ------------------------------------------------------------------ outbox

export async function enqueue({ eventId, kind, payload, nextRetryAt = 0 }) {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO outbox (event_id, kind, payload, status, next_retry_at, created_at)
     VALUES (?, ?, ?, 'queued', ?, ?)`,
    [eventId, kind, JSON.stringify(payload), nextRetryAt, Date.now()]
  );
  if (kind === 'location') await pruneLocations();
}

async function pruneLocations() {
  const db = await getDb();
  await db.runAsync(
    `DELETE FROM outbox WHERE kind = 'location' AND event_id IN (
       SELECT event_id FROM outbox WHERE kind = 'location'
       ORDER BY created_at DESC LIMIT -1 OFFSET ?
     )`,
    [MAX_QUEUED_LOCATIONS]
  );
}

// A crash mid-send leaves rows in 'sending'. Put them back in the queue; the
// server ignores duplicates, so re-sending is always safe.
export async function recoverStuck() {
  const db = await getDb();
  await db.runAsync(`UPDATE outbox SET status = 'queued', next_retry_at = 0 WHERE status = 'sending'`);
}

export async function dueSos(now = Date.now()) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM outbox WHERE kind = 'sos' AND status = 'queued' AND next_retry_at <= ? ORDER BY created_at ASC`,
    [now]
  );
}

export async function sosAwaitingAck() {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM outbox WHERE kind = 'sos' AND status = 'delivered'`);
}

// Newest first, so the freshest fix reaches the dashboard before any backlog.
export async function dueLocations(limit = 100) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM outbox WHERE kind = 'location' AND status = 'queued' ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

export async function deleteEvents(eventIds) {
  if (!eventIds.length) return;
  const db = await getDb();
  const marks = eventIds.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM outbox WHERE event_id IN (${marks})`, eventIds);
}

export async function setStatus(eventId, status, fields = {}) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status = ?, server_id = COALESCE(?, server_id),
       last_error = ?, attempts = COALESCE(?, attempts), next_retry_at = COALESCE(?, next_retry_at)
     WHERE event_id = ?`,
    [status, fields.serverId ?? null, fields.lastError ?? null, fields.attempts ?? null, fields.nextRetryAt ?? null, eventId]
  );
}

export async function setSmsStatus(eventId, smsStatus) {
  const db = await getDb();
  await db.runAsync(`UPDATE outbox SET sms_status = ? WHERE event_id = ?`, [smsStatus, eventId]);
}

// Only allowed while still queued, so a payload can never change after a send began.
export async function updateQueuedPayload(eventId, payload) {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET payload = ?, next_retry_at = 0 WHERE event_id = ? AND status = 'queued'`,
    [JSON.stringify(payload), eventId]
  );
}

export async function bumpLocationFailure(eventIds, message) {
  if (!eventIds.length) return;
  const db = await getDb();
  const marks = eventIds.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE event_id IN (${marks})`,
    [message, ...eventIds]
  );
}

export async function getSos(eventId) {
  const db = await getDb();
  return db.getFirstAsync(`SELECT * FROM outbox WHERE event_id = ? AND kind = 'sos'`, [eventId]);
}

// Most recent SOS that has not been acknowledged yet (so the UI can resume after a restart).
export async function latestOpenSos(maxAgeMs = 24 * 3600 * 1000) {
  const db = await getDb();
  return db.getFirstAsync(
    `SELECT * FROM outbox WHERE kind = 'sos' AND status != 'acknowledged' AND created_at >= ?
     ORDER BY created_at DESC LIMIT 1`,
    [Date.now() - maxAgeMs]
  );
}

export async function pendingCounts() {
  const db = await getDb();
  const row = await db.getFirstAsync(`
    SELECT
      SUM(CASE WHEN kind = 'location' AND status = 'queued' THEN 1 ELSE 0 END) AS locations,
      SUM(CASE WHEN kind = 'sos' AND status IN ('queued', 'sending', 'delivered') THEN 1 ELSE 0 END) AS sos
    FROM outbox`);
  return { locations: row?.locations ?? 0, sos: row?.sos ?? 0 };
}

// ------------------------------------------------------------ last reliable fix

export async function saveLastFix({ lat, lon, accuracy, observedAt }) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO last_reliable_fix (id, lat, lon, accuracy, observed_at) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET lat = excluded.lat, lon = excluded.lon,
       accuracy = excluded.accuracy, observed_at = excluded.observed_at`,
    [lat, lon, accuracy ?? null, observedAt]
  );
}

export async function getLastFix() {
  const db = await getDb();
  const r = await db.getFirstAsync(`SELECT lat, lon, accuracy, observed_at FROM last_reliable_fix WHERE id = 1`);
  return r ? { lat: r.lat, lon: r.lon, accuracy: r.accuracy, observedAt: r.observed_at } : null;
}

// ------------------------------------------------------------ tracking context

export async function setTrackingContext({ userId, travelCardId, endDate }) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO tracking_context (id, user_id, travel_card_id, end_date, started_at) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, travel_card_id = excluded.travel_card_id,
       end_date = excluded.end_date, started_at = excluded.started_at`,
    [userId, travelCardId, endDate ?? null, Date.now()]
  );
}

export async function getTrackingContext() {
  const db = await getDb();
  const r = await db.getFirstAsync(`SELECT user_id, travel_card_id, end_date FROM tracking_context WHERE id = 1`);
  return r ? { userId: r.user_id, travelCardId: r.travel_card_id, endDate: r.end_date } : null;
}

export async function clearTrackingContext() {
  const db = await getDb();
  await db.runAsync(`DELETE FROM tracking_context WHERE id = 1`);
}
