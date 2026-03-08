/**
 * src/services/locationRegistry.js
 *
 * Tracks every GHL sub-account that has installed the app.
 * Persisted in Firebase Firestore so the Admin dashboard can list
 * all locations without scanning the OAuth token store.
 *
 * COLLECTION: locationRegistry
 * Document:   {locationId}
 * Fields:
 *   status        — 'active' | 'uninstalled'
 *   companyId     — GHL company/agency ID
 *   installedAt   — ISO timestamp of first (or most recent) install
 *   uninstalledAt — ISO timestamp of uninstall (null if active)
 *   restoredAt    — ISO timestamp of last admin restore (null if never)
 *   restoredBy    — adminId who last restored (null if never)
 *   lastActive    — ISO timestamp of last API activity
 *
 * FALLBACK: When Firebase is disabled, data is read from the OAuth
 * tokenStore (listLocations + getTokenRecord). Write operations are
 * no-ops — the admin dashboard still works with limited metadata.
 */

const config    = require('../config');
const tokenStore = require('./tokenStore');

// ── Firebase (lazy) ───────────────────────────────────────────────────────────

let _db    = null;
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

const COLLECTION = 'locationRegistry';

function now() { return new Date().toISOString(); }

// ── Helpers ───────────────────────────────────────────────────────────────────

async function docRef(locationId) {
  return db().collection(COLLECTION).doc(locationId);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register (or re-register) a location on app install.
 * If the location was previously uninstalled, marks it active again
 * but does NOT restore tool configs — that requires admin action.
 */
async function registerLocation(locationId, { companyId } = {}) {
  const store = db();
  if (!store) return; // no-op in dev mode

  const ref  = store.collection(COLLECTION).doc(locationId);
  const snap = await ref.get();
  const ts   = now();

  if (snap.exists) {
    // Re-install: update status but preserve history
    await ref.update({
      status:       'active',
      installedAt:  ts,
      uninstalledAt: null,
      ...(companyId ? { companyId } : {}),
    });
  } else {
    // Fresh install
    await ref.set({
      status:        'active',
      companyId:     companyId || null,
      installedAt:   ts,
      uninstalledAt: null,
      restoredAt:    null,
      restoredBy:    null,
      lastActive:    ts,
    });
  }

  console.log(`[LocationRegistry] Registered location: ${locationId}`);
}

/**
 * Mark a location as uninstalled.
 * Data is PRESERVED so admin can restore it later.
 */
async function uninstallLocation(locationId) {
  const store = db();
  if (!store) return;

  await store.collection(COLLECTION).doc(locationId).set(
    { status: 'uninstalled', uninstalledAt: now() },
    { merge: true },
  );

  console.log(`[LocationRegistry] Marked uninstalled: ${locationId}`);
}

/**
 * Restore an uninstalled location (admin action).
 */
async function restoreLocation(locationId, adminId = 'admin') {
  const store = db();
  if (!store) return;

  await store.collection(COLLECTION).doc(locationId).set(
    { status: 'active', restoredAt: now(), restoredBy: adminId, uninstalledAt: null },
    { merge: true },
  );

  console.log(`[LocationRegistry] Restored location: ${locationId} by ${adminId}`);
}

/**
 * Update the lastActive timestamp for a location.
 * Called by the token touch mechanism (debounced externally).
 */
async function updateLastActive(locationId) {
  const store = db();
  if (!store) return;

  store.collection(COLLECTION).doc(locationId).set(
    { lastActive: now() },
    { merge: true },
  ).catch(() => {}); // fire-and-forget
}

/**
 * Get the registry record for one location.
 * Falls back to tokenStore data when Firebase is disabled.
 *
 * @returns {Promise<object|null>}
 */
async function getLocation(locationId) {
  const store = db();
  if (store) {
    const snap = await store.collection(COLLECTION).doc(locationId).get();
    return snap.exists ? { locationId, ...snap.data() } : null;
  }

  // Fallback: build a minimal record from tokenStore
  const record = await Promise.resolve(tokenStore.getTokenRecord(locationId));
  if (!record) return null;
  return {
    locationId,
    status:        'active',
    companyId:     record.companyId || null,
    installedAt:   null,
    uninstalledAt: null,
    restoredAt:    null,
    restoredBy:    null,
    lastActive:    null,
  };
}

/**
 * List all registered locations.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeUninstalled]  — include uninstalled locations (default true)
 * @returns {Promise<Array>}
 */
async function listAllLocations({ includeUninstalled = true } = {}) {
  const store = db();

  if (store) {
    let q = store.collection(COLLECTION).orderBy('installedAt', 'desc');
    if (!includeUninstalled) q = q.where('status', '==', 'active');
    const snap = await q.get();
    return snap.docs.map((d) => ({ locationId: d.id, ...d.data() }));
  }

  // Fallback: read from tokenStore
  const ids     = await Promise.resolve(tokenStore.listLocations());
  const results = [];
  for (const id of ids) {
    const rec = await Promise.resolve(tokenStore.getTokenRecord(id));
    if (rec) {
      results.push({
        locationId:    id,
        status:        'active',
        companyId:     rec.companyId || null,
        installedAt:   null,
        uninstalledAt: null,
        restoredAt:    null,
        restoredBy:    null,
        lastActive:    null,
      });
    }
  }
  return results;
}

/**
 * Check if a location is currently marked as uninstalled.
 */
async function isUninstalled(locationId) {
  const rec = await getLocation(locationId);
  return rec?.status === 'uninstalled';
}

module.exports = {
  registerLocation,
  uninstallLocation,
  restoreLocation,
  updateLastActive,
  getLocation,
  listAllLocations,
  isUninstalled,
};
