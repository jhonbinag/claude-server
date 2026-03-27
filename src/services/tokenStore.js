/**
 * tokenStore.js
 *
 * Persists GHL OAuth tokens and private API keys per locationId.
 *
 * Storage backend is chosen automatically at startup:
 *   1. Upstash Redis  → when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set (production)
 *   2. Local JSON file → when writable filesystem available (local dev)
 *   3. In-memory       → fallback for read-only filesystems (Vercel serverless)
 */

// ─── 1. Upstash Redis ─────────────────────────────────────────────────────────

if ((process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) && (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)) {
  console.log('[Store] Using Upstash Redis backend');
  module.exports = require('./redisStore');
  return;
}

// ─── 2. File-based or In-memory fallback ──────────────────────────────────────

const fs     = require('fs');
const path   = require('path');
const config = require('../config');

const storePath    = path.resolve(config.storePath || './data/store.json');
let   useInMemory  = false;

// In-memory store (used when filesystem is read-only, e.g. Vercel)
const memStore = { locations: {} };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureStore() {
  if (useInMemory) return;
  try {
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir))      fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(storePath)) fs.writeFileSync(storePath, JSON.stringify({ locations: {} }, null, 2));
  } catch {
    console.warn('[Store] Filesystem not writable — switching to in-memory store');
    useInMemory = true;
  }
}

function readStore() {
  ensureStore();
  if (useInMemory) return memStore;
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch {
    useInMemory = true;
    return memStore;
  }
}

function writeStore(data) {
  if (useInMemory) {
    Object.assign(memStore, data);
    return;
  }
  try {
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
  } catch {
    useInMemory = true;
    Object.assign(memStore, data);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function saveTokens(locationId, { accessToken, refreshToken, expiresIn, companyId, scope, userId }) {
  const store    = readStore();
  const existing = store.locations[locationId] || {};
  store.locations[locationId] = {
    ...existing,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (expiresIn - 300) * 1000,
    companyId: companyId || existing.companyId,
    scope:     scope     || existing.scope,
    userId:    userId    || existing.userId,
  };
  writeStore(store);
  console.log(`[TokenStore] Tokens saved for location: ${locationId}`);
}

function getTokenRecord(locationId) {
  return readStore().locations[locationId] || null;
}

function isTokenExpired(locationId) {
  const record = getTokenRecord(locationId);
  if (!record) return true;
  return Date.now() >= record.expiresAt;
}

function saveApiKey(locationId, apiKey) {
  const store = readStore();
  if (!store.locations[locationId]) store.locations[locationId] = {};
  store.locations[locationId].apiKey = apiKey;
  writeStore(store);
}

function getApiKey(locationId) {
  const record = getTokenRecord(locationId);
  return record ? record.apiKey : null;
}

function findLocationByApiKey(apiKey) {
  const store = readStore();
  const match = Object.entries(store.locations).find(([, r]) => r.apiKey === apiKey);
  return match ? match[0] : null;
}

function removeLocation(locationId) {
  const store = readStore();
  delete store.locations[locationId];
  writeStore(store);
  console.log(`[TokenStore] Location removed: ${locationId}`);
}

function listLocations() {
  return Object.keys(readStore().locations);
}

function saveToolConfig(locationId, toolConfigs) {
  const store = readStore();
  if (!store.locations[locationId]) store.locations[locationId] = {};
  store.locations[locationId].toolConfigs = {
    ...(store.locations[locationId].toolConfigs || {}),
    ...toolConfigs,
  };
  writeStore(store);
}

function getToolConfig(locationId) {
  const record = getTokenRecord(locationId);
  return (record && record.toolConfigs) ? record.toolConfigs : {};
}

function saveToolSharing(locationId, sharing) {
  const store = readStore();
  if (!store.locations[locationId]) store.locations[locationId] = {};
  store.locations[locationId].toolSharing = {
    ...(store.locations[locationId].toolSharing || {}),
    ...sharing,
  };
  writeStore(store);
}

function getToolSharing(locationId) {
  const record = getTokenRecord(locationId);
  return (record && record.toolSharing) ? record.toolSharing : {};
}

// App-level settings (GHL clientId/secret/redirectUri) stored in fallback
function saveAppSettings(settings) {
  const store = readStore();
  store.appSettings = { ...(store.appSettings || {}), ...settings };
  writeStore(store);
}

function getAppSettings() {
  return readStore().appSettings || null;
}

module.exports = {
  saveTokens,
  getTokenRecord,
  isTokenExpired,
  saveApiKey,
  getApiKey,
  findLocationByApiKey,
  removeLocation,
  listLocations,
  saveToolConfig,
  getToolConfig,
  saveToolSharing,
  getToolSharing,
  saveAppSettings,
  getAppSettings,
};
