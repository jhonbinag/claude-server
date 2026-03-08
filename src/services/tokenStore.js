/**
 * tokenStore.js
 *
 * Persists GHL OAuth tokens and private API keys per locationId.
 *
 * Storage backend is chosen automatically at startup:
 *   - Upstash Redis  → when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set (production)
 *   - Local JSON file → fallback for local development
 *
 * All callers use the same interface regardless of backend.
 */

// ─── Backend Selection ────────────────────────────────────────────────────────

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.log('[Store] Using Upstash Redis backend');
  module.exports = require('./redisStore');
  return; // short-circuit — rest of this file is the file-based fallback
}

console.log('[Store] Using local JSON file backend (set UPSTASH_REDIS_REST_URL for Redis)');

const fs   = require('fs');
const path = require('path');
const config = require('../config');

const storePath = path.resolve(config.storePath);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureStore() {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(storePath)) fs.writeFileSync(storePath, JSON.stringify({ locations: {} }, null, 2));
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(storePath, 'utf8'));
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Save or update tokens for a location after OAuth token exchange.
 */
function saveTokens(locationId, { accessToken, refreshToken, expiresIn, companyId, scope }) {
  const store = readStore();
  const existing = store.locations[locationId] || {};

  store.locations[locationId] = {
    ...existing,
    accessToken,
    refreshToken,
    // expiresIn is in seconds; subtract 5 min buffer
    expiresAt: Date.now() + (expiresIn - 300) * 1000,
    companyId: companyId || existing.companyId,
    scope:     scope     || existing.scope,
  };

  writeStore(store);
  console.log(`[TokenStore] Tokens saved for location: ${locationId}`);
}

/**
 * Retrieve the full token record for a location.
 */
function getTokenRecord(locationId) {
  const store = readStore();
  return store.locations[locationId] || null;
}

/**
 * Check whether the access token is still valid.
 */
function isTokenExpired(locationId) {
  const record = getTokenRecord(locationId);
  if (!record) return true;
  return Date.now() >= record.expiresAt;
}

/**
 * Save a generated private API key for a location.
 */
function saveApiKey(locationId, apiKey) {
  const store = readStore();
  if (!store.locations[locationId]) store.locations[locationId] = {};
  store.locations[locationId].apiKey = apiKey;
  writeStore(store);
}

/**
 * Get the private API key for a location.
 */
function getApiKey(locationId) {
  const record = getTokenRecord(locationId);
  return record ? record.apiKey : null;
}

/**
 * Find a location by its private API key.
 * Returns locationId or null.
 */
function findLocationByApiKey(apiKey) {
  const store = readStore();
  const match = Object.entries(store.locations).find(
    ([, record]) => record.apiKey === apiKey
  );
  return match ? match[0] : null;
}

/**
 * Remove a location's data (e.g. on app uninstall).
 */
function removeLocation(locationId) {
  const store = readStore();
  delete store.locations[locationId];
  writeStore(store);
  console.log(`[TokenStore] Location removed: ${locationId}`);
}

/**
 * List all stored locationIds.
 */
function listLocations() {
  const store = readStore();
  return Object.keys(store.locations);
}

// ─── External Tool Configs ────────────────────────────────────────────────────

/**
 * Save external tool configuration for a location.
 * toolConfigs is a partial object — only provided keys are merged.
 * e.g. saveToolConfig('loc123', { perplexity: { apiKey: 'pplx-...' } })
 */
function saveToolConfig(locationId, toolConfigs) {
  const store = readStore();
  if (!store.locations[locationId]) store.locations[locationId] = {};
  const existing = store.locations[locationId].toolConfigs || {};
  store.locations[locationId].toolConfigs = { ...existing, ...toolConfigs };
  writeStore(store);
}

/**
 * Get all tool configs for a location.
 * Returns {} if none saved.
 */
function getToolConfig(locationId) {
  const record = getTokenRecord(locationId);
  return (record && record.toolConfigs) ? record.toolConfigs : {};
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
};
