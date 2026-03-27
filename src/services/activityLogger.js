/**
 * src/services/activityLogger.js
 *
 * Fire-and-forget activity logging to Firebase Firestore.
 * Used for security audit trails and admin troubleshooting.
 *
 * COLLECTION: activityLogs
 * Fields per document:
 *   locationId  — GHL sub-account ID
 *   event       — e.g. 'install', 'uninstall', 'tool_connect', 'tool_call', 'auth'
 *   detail      — arbitrary context object
 *   success     — boolean
 *   ip          — requester IP (for security)
 *   adminId     — admin identifier (for admin-originated actions)
 *   timestamp   — Firestore server timestamp
 *
 * All writes are fire-and-forget — callers NEVER await log().
 * Failures are swallowed so logging never breaks request flow.
 *
 * FALLBACK: When Firebase is disabled, logs are kept in a circular
 * in-memory buffer (last 2000 entries) so the admin API still works
 * in dev mode, and console.log gives visibility.
 *
 * FIRESTORE INDEX REQUIRED (create in Firebase console):
 *   Collection: activityLogs
 *   Fields: locationId ASC, timestamp DESC
 */

const config = require('../config');

// ── In-memory fallback buffer ─────────────────────────────────────────────────

const MEM_MAX = 2000;
const memBuffer = []; // oldest-first circular buffer

function memPush(entry) {
  memBuffer.push(entry);
  if (memBuffer.length > MEM_MAX) memBuffer.shift();
}

// ── Firebase (lazy) ───────────────────────────────────────────────────────────

let _db   = null;
let _admin = null;

function db() {
  if (_db) return _db;
  if (!config.isFirebaseEnabled) return null;
  try {
    _admin = require('firebase-admin');
    _db    = _admin.firestore();
  } catch { _db = null; }
  return _db;
}

const COLLECTION = 'activityLogs';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Log an activity event. NEVER await this function.
 *
 * @param {object} opts
 * @param {string}  opts.locationId
 * @param {string}  opts.event       — event type key
 * @param {object}  [opts.detail]    — extra context
 * @param {boolean} [opts.success]   — defaults true
 * @param {string}  [opts.ip]        — requester IP
 * @param {string}  [opts.adminId]   — set for admin-originated actions
 */
function log({ locationId, event, detail = {}, success = true, ip = null, adminId = null }) {
  const entry = {
    locationId: locationId || 'unknown',
    event,
    detail,
    success,
    ip,
    adminId,
    timestamp: new Date().toISOString(),
  };

  // Always console-log in non-production for visibility
  if (config.nodeEnv !== 'production') {
    console.log(`[ActivityLog] ${entry.locationId} | ${event} | ${success ? 'OK' : 'FAIL'}`, detail);
  }

  // In-memory fallback (always push, so admin API works without Firebase)
  memPush({ ...entry });

  // Firebase write — fire and forget
  const store = db();
  if (!store) return;

  store.collection(COLLECTION).add({
    ...entry,
    timestamp: _admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => {
    console.error('[ActivityLog] Write failed:', err.message);
  });
}

/**
 * Query activity logs. Used by the admin dashboard.
 *
 * @param {object} opts
 * @param {string}  [opts.locationId]  — filter by location (null = all)
 * @param {string}  [opts.event]       — filter by event type
 * @param {number}  [opts.limit]       — max results (default 100)
 * @param {number}  [opts.offset]      — skip (mem-only, Firebase uses cursor)
 * @returns {Promise<Array>}
 */
async function getLogs({ locationId, event, limit = 100, offset = 0 } = {}) {
  const store = db();

  if (store) {
    try {
      let q = store.collection(COLLECTION).orderBy('timestamp', 'desc');
      if (locationId) q = q.where('locationId', '==', locationId);
      if (event)      q = q.where('event', '==', event);
      q = q.limit(limit);

      const snap = await q.get();
      return snap.docs.map((d) => {
        const data = d.data();
        // Firestore Timestamp → ISO string so frontend can parse with new Date()
        if (data.timestamp && typeof data.timestamp.toDate === 'function') {
          data.timestamp = data.timestamp.toDate().toISOString();
        }
        return { id: d.id, ...data };
      });
    } catch (err) {
      console.error('[ActivityLog] getLogs Firebase error:', err.message);
      // Fall through to memory fallback
    }
  }

  // Memory fallback
  let results = [...memBuffer].reverse(); // newest first
  if (locationId) results = results.filter((e) => e.locationId === locationId);
  if (event)      results = results.filter((e) => e.event === event);
  return results.slice(offset, offset + limit);
}

module.exports = { log, getLogs };
