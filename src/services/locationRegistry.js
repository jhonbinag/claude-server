/**
 * src/services/locationRegistry.js
 *
 * Tracks every GHL sub-account that has installed the app.
 *
 * PRIMARY:  Firebase Firestore (when isFirebaseEnabled)
 *           Collection: locationRegistry  /  Document: {locationId}
 *
 * FALLBACK: Upstash Redis (always available)
 *           hltools:locs:index  → JSON array of all locationIds
 *           hltools:locs:{id}   → JSON metadata
 *
 * Metadata fields:
 *   status        — 'active' | 'uninstalled'
 *   companyId     — GHL company/agency ID
 *   installedAt   — ISO timestamp
 *   uninstalledAt — ISO timestamp (null if active)
 *   restoredAt    — ISO timestamp (null if never)
 *   restoredBy    — adminId (null if never)
 *   lastActive    — ISO timestamp of last API activity
 */

const config = require('../config');
const https  = require('https');

// ── Firebase (lazy, only when enabled) ───────────────────────────────────────

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

const FB_COLLECTION = 'locationRegistry';

// ── Redis fallback ────────────────────────────────────────────────────────────

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const LOC_PREFIX = 'hltools:locs:';
const IDX_KEY    = 'hltools:locs:index';
const TTL        = 730 * 24 * 3600; // 2 years

const _mem = new Map();

function redisReq(cmd) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    const [c, k, v, , ex] = cmd;
    if (c === 'GET') return Promise.resolve(_mem.get(k) ?? null);
    if (c === 'SET') {
      _mem.set(k, v);
      if (ex) setTimeout(() => _mem.delete(k), Number(ex) * 1000);
      return Promise.resolve('OK');
    }
    if (c === 'DEL') { _mem.delete(k); return Promise.resolve(1); }
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(cmd);
    const url  = new URL(REDIS_URL);
    const req  = https.request(
      { hostname: url.hostname, path: url.pathname, method: 'POST',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try { const p = JSON.parse(d); if (p.error) reject(new Error(p.error)); else resolve(p.result); }
          catch (e) { reject(new Error(d)); }
        });
      },
    );
    req.on('error', reject); req.write(body); req.end();
  });
}

const r = {
  get: (k)         => redisReq(['GET', k]),
  set: (k, v, ttl) => ttl ? redisReq(['SET', k, v, 'EX', String(ttl)]) : redisReq(['SET', k, v]),
  del: (k)         => redisReq(['DEL', k]),
};

async function redisGetIndex() {
  const raw = await r.get(IDX_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function redisAddToIndex(locationId) {
  const idx = await redisGetIndex();
  if (!idx.includes(locationId)) {
    idx.unshift(locationId);
    await r.set(IDX_KEY, JSON.stringify(idx), TTL);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function now() { return new Date().toISOString(); }

// ── Public API ────────────────────────────────────────────────────────────────

async function registerLocation(locationId, { companyId } = {}) {
  const ts = now();
  const store = db();

  if (store) {
    // Firebase path
    const ref  = store.collection(FB_COLLECTION).doc(locationId);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.update({ status: 'active', installedAt: ts, uninstalledAt: null, ...(companyId ? { companyId } : {}) });
    } else {
      await ref.set({ status: 'active', companyId: companyId || null, installedAt: ts, uninstalledAt: null, restoredAt: null, restoredBy: null, lastActive: ts });
    }
  } else {
    // Redis fallback
    const existing = await redisGetLocation(locationId);
    const record = existing
      ? { ...existing, status: 'active', installedAt: ts, uninstalledAt: null, ...(companyId ? { companyId } : {}) }
      : { status: 'active', companyId: companyId || null, installedAt: ts, uninstalledAt: null, restoredAt: null, restoredBy: null, lastActive: ts };
    await r.set(LOC_PREFIX + locationId, JSON.stringify(record), TTL);
    await redisAddToIndex(locationId);
  }

  console.log(`[LocationRegistry] Registered: ${locationId}`);
}

async function uninstallLocation(locationId) {
  const store = db();
  if (store) {
    await store.collection(FB_COLLECTION).doc(locationId).set(
      { status: 'uninstalled', uninstalledAt: now() }, { merge: true },
    );
  } else {
    const existing = await redisGetLocation(locationId);
    if (existing) await r.set(LOC_PREFIX + locationId, JSON.stringify({ ...existing, status: 'uninstalled', uninstalledAt: now() }), TTL);
  }
  console.log(`[LocationRegistry] Marked uninstalled: ${locationId}`);
}

async function restoreLocation(locationId, adminId = 'admin') {
  const store = db();
  if (store) {
    await store.collection(FB_COLLECTION).doc(locationId).set(
      { status: 'active', restoredAt: now(), restoredBy: adminId, uninstalledAt: null }, { merge: true },
    );
  } else {
    const existing = await redisGetLocation(locationId);
    if (existing) await r.set(LOC_PREFIX + locationId, JSON.stringify({ ...existing, status: 'active', restoredAt: now(), restoredBy: adminId, uninstalledAt: null }), TTL);
  }
  console.log(`[LocationRegistry] Restored: ${locationId} by ${adminId}`);
}

async function updateLastActive(locationId) {
  const store = db();
  if (store) {
    store.collection(FB_COLLECTION).doc(locationId).set({ lastActive: now() }, { merge: true }).catch(() => {});
  } else {
    const existing = await redisGetLocation(locationId);
    if (existing) r.set(LOC_PREFIX + locationId, JSON.stringify({ ...existing, lastActive: now() }), TTL).catch(() => {});
  }
}

async function redisGetLocation(locationId) {
  const raw = await r.get(LOC_PREFIX + locationId);
  return raw ? { locationId, ...JSON.parse(raw) } : null;
}

async function getLocation(locationId) {
  const store = db();
  if (store) {
    const snap = await store.collection(FB_COLLECTION).doc(locationId).get();
    return snap.exists ? { locationId, ...snap.data() } : null;
  }
  return redisGetLocation(locationId);
}

async function listAllLocations({ includeUninstalled = true } = {}) {
  const store = db();

  if (store) {
    let q = store.collection(FB_COLLECTION).orderBy('installedAt', 'desc');
    if (!includeUninstalled) q = q.where('status', '==', 'active');
    const snap = await q.get();
    return snap.docs.map((d) => ({ locationId: d.id, ...d.data() }));
  }

  // Redis fallback
  const idx = await redisGetIndex();
  const records = await Promise.all(idx.map(async (id) => {
    const raw = await r.get(LOC_PREFIX + id);
    return raw ? { locationId: id, ...JSON.parse(raw) } : null;
  }));
  const all = records.filter(Boolean);
  return includeUninstalled ? all : all.filter((r) => r.status === 'active');
}

async function isUninstalled(locationId) {
  const rec = await getLocation(locationId);
  return rec?.status === 'uninstalled';
}

module.exports = { registerLocation, uninstallLocation, restoreLocation, updateLastActive, getLocation, listAllLocations, isUninstalled };
