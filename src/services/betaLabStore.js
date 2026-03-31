/**
 * src/services/betaLabStore.js
 *
 * Firestore-backed Beta Lab feature registry.
 * Falls back to in-memory when Firebase is disabled.
 *
 * Collection: betaFeatures
 *
 * Each document:
 *   featureId       — unique ID
 *   title           — short name
 *   description     — markdown-friendly detail
 *   version         — e.g. "2.8"
 *   status          — 'permanent' | 'beta' | 'not_shared'
 *                     permanent  = all locations get it immediately, banner shown once
 *                     beta       = mini_admin enables per-location first, then users see it
 *                     not_shared = only visible in admin/mini_admin panel, no banner
 *   enabledLocations  — locationIds where a mini_admin has toggled ON (beta only)
 *   acknowledgedBy    — locationIds that dismissed the banner
 *   publishedAt, createdAt, updatedAt
 */

const crypto = require('crypto');
const config  = require('../config');

let _db = null;
function db() {
  if (_db) return _db;
  if (!config.isFirebaseEnabled) return null;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length) _db = admin.app().firestore();
  } catch { /* ignore */ }
  return _db;
}

const COL = 'betaFeatures';
const mem = {};

function genId() { return `beta_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`; }

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function listFeatures() {
  const d = db();
  if (d) {
    const snap = await d.collection(COL).orderBy('createdAt', 'desc').get();
    return snap.docs.map(doc => ({ featureId: doc.id, ...doc.data() }));
  }
  return Object.values(mem).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function getFeature(featureId) {
  const d = db();
  if (d) {
    const snap = await d.collection(COL).doc(featureId).get();
    if (!snap.exists) return null;
    return { featureId: snap.id, ...snap.data() };
  }
  return mem[featureId] || null;
}

async function saveFeature(data) {
  const { featureId, ...rest } = data;
  const id  = featureId || genId();
  const now = Date.now();
  const save = {
    enabledLocations: [],
    acknowledgedBy:   [],
    ...rest,
    updatedAt: now,
  };
  if (!rest.createdAt)   save.createdAt   = now;
  if (!rest.publishedAt) save.publishedAt = now;

  const d = db();
  if (d) {
    await d.collection(COL).doc(id).set(save, { merge: true });
  } else {
    mem[id] = { featureId: id, ...save };
  }
  return { featureId: id, ...save };
}

async function deleteFeature(featureId) {
  const d = db();
  if (d) await d.collection(COL).doc(featureId).delete();
  else delete mem[featureId];
}

// ── Mini-admin toggle ─────────────────────────────────────────────────────────
// Adds or removes a locationId from enabledLocations.

async function toggleForLocation(featureId, locationId, enabled) {
  const feat = await getFeature(featureId);
  if (!feat) throw new Error('Feature not found');
  const list = new Set(feat.enabledLocations || []);
  enabled ? list.add(locationId) : list.delete(locationId);
  const patch = { enabledLocations: [...list], updatedAt: Date.now() };
  const d = db();
  if (d) {
    await d.collection(COL).doc(featureId).set(patch, { merge: true });
  } else if (mem[featureId]) {
    Object.assign(mem[featureId], patch);
  }
  return { ...feat, ...patch };
}

// ── Acknowledge banner ────────────────────────────────────────────────────────

async function acknowledgeForLocation(featureId, locationId) {
  const feat = await getFeature(featureId);
  if (!feat) return;
  const list = new Set(feat.acknowledgedBy || []);
  list.add(locationId);
  const patch = { acknowledgedBy: [...list], updatedAt: Date.now() };
  const d = db();
  if (d) {
    await d.collection(COL).doc(featureId).set(patch, { merge: true });
  } else if (mem[featureId]) {
    Object.assign(mem[featureId], patch);
  }
}

// ── Get features visible to a location + role ─────────────────────────────────
// Returns features the location should see (in banner / mini-admin panel).
//
// mini_admin sees:
//   - permanent: always
//   - beta: always (with their toggle state)
//   - not_shared: in panel only (flagged panelOnly:true)
//
// regular user sees:
//   - permanent: always
//   - beta: only if their locationId is in enabledLocations
//   - not_shared: never

async function getFeaturesForLocation(locationId, role) {
  try {
    const all = await listFeatures();
    const isMiniAdmin = role === 'mini_admin' || role === 'owner' || role === 'admin';
    const result = [];

    for (const f of all) {
      const acked     = (f.acknowledgedBy || []).includes(locationId);
      const enabled   = (f.enabledLocations || []).includes(locationId);

      if (f.status === 'permanent') {
        result.push({ ...f, visible: true, toggleable: false, panelOnly: false, acknowledged: acked, myEnabled: true });
      } else if (f.status === 'beta') {
        if (isMiniAdmin) {
          result.push({ ...f, visible: true, toggleable: true, panelOnly: false, acknowledged: acked, myEnabled: enabled });
        } else if (enabled) {
          result.push({ ...f, visible: true, toggleable: false, panelOnly: false, acknowledged: acked, myEnabled: true });
        }
      } else if (f.status === 'not_shared') {
        if (isMiniAdmin) {
          result.push({ ...f, visible: false, toggleable: false, panelOnly: true, acknowledged: acked, myEnabled: false });
        }
      }
    }

    return result;
  } catch { return []; }
}

module.exports = {
  listFeatures,
  getFeature,
  saveFeature,
  deleteFeature,
  toggleForLocation,
  acknowledgeForLocation,
  getFeaturesForLocation,
};
