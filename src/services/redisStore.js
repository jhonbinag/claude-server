/**
 * src/services/redisStore.js
 *
 * Upstash Redis-backed store — drop-in replacement for the file-based tokenStore.
 * Activated automatically when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 * are present in the environment.
 *
 * Key layout:
 *   hltools:location:{locationId}  → JSON string of the full location record
 *   hltools:apikey:{apiKey}        → locationId  (reverse-lookup index)
 *
 * Get Upstash credentials: https://console.upstash.com
 *   1. Create a Redis database
 *   2. Copy "REST URL" → UPSTASH_REDIS_REST_URL
 *   3. Copy "REST Token" → UPSTASH_REDIS_REST_TOKEN
 */

const https = require('https');

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const KEY_PREFIX  = 'hltools:location:';
const APIKEY_PREFIX = 'hltools:apikey:';

// ─── Upstash REST Client (no external package needed) ─────────────────────────

function redisRequest(command) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(command);
    const url  = new URL(REDIS_URL);

    const options = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers: {
        Authorization:  `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error));
          resolve(parsed.result);
        } catch (e) {
          reject(new Error(`Redis parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Convenience wrappers
const redis = {
  get:    (key)        => redisRequest(['GET', key]),
  set:    (key, value) => redisRequest(['SET', key, typeof value === 'string' ? value : JSON.stringify(value)]),
  del:    (key)        => redisRequest(['DEL', key]),
  keys:   (pattern)   => redisRequest(['KEYS', pattern]),
};

// ─── Store API (same interface as tokenStore.js) ──────────────────────────────

async function saveTokens(locationId, { accessToken, refreshToken, expiresIn, companyId, scope, userId }) {
  const existing = await getRecord(locationId) || {};
  const record   = {
    ...existing,
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (expiresIn - 300) * 1000,
    companyId: companyId || existing.companyId,
    scope:     scope     || existing.scope,
    userId:    userId    || existing.userId,
  };
  await redis.set(KEY_PREFIX + locationId, JSON.stringify(record));
  console.log(`[Redis] Tokens saved for location: ${locationId}`);
}

async function getRecord(locationId) {
  const raw = await redis.get(KEY_PREFIX + locationId);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function isTokenExpired(locationId) {
  const record = await getRecord(locationId);
  if (!record) return true;
  return Date.now() >= record.expiresAt;
}

async function saveApiKey(locationId, apiKey) {
  const existing = await getRecord(locationId) || {};
  existing.apiKey = apiKey;
  await redis.set(KEY_PREFIX + locationId, JSON.stringify(existing));
  // Index for reverse lookup
  await redis.set(APIKEY_PREFIX + apiKey, locationId);
}

async function getApiKey(locationId) {
  const record = await getRecord(locationId);
  return record ? record.apiKey : null;
}

async function findLocationByApiKey(apiKey) {
  return redis.get(APIKEY_PREFIX + apiKey);
}

async function removeLocation(locationId) {
  const record = await getRecord(locationId);
  if (record && record.apiKey) {
    await redis.del(APIKEY_PREFIX + record.apiKey);
  }
  await redis.del(KEY_PREFIX + locationId);
  console.log(`[Redis] Location removed: ${locationId}`);
}

async function listLocations() {
  const keys = await redis.keys(KEY_PREFIX + '*');
  return (keys || []).map((k) => k.replace(KEY_PREFIX, ''));
}

async function saveToolConfig(locationId, toolConfigs) {
  const existing = await getRecord(locationId) || {};
  existing.toolConfigs = { ...(existing.toolConfigs || {}), ...toolConfigs };
  await redis.set(KEY_PREFIX + locationId, JSON.stringify(existing));
}

async function getToolConfig(locationId) {
  const record = await getRecord(locationId);
  return (record && record.toolConfigs) ? record.toolConfigs : {};
}

async function saveToolSharing(locationId, sharing) {
  const existing = await getRecord(locationId) || {};
  existing.toolSharing = { ...(existing.toolSharing || {}), ...sharing };
  await redis.set(KEY_PREFIX + locationId, JSON.stringify(existing));
}

async function getToolSharing(locationId) {
  const record = await getRecord(locationId);
  return (record && record.toolSharing) ? record.toolSharing : {};
}

const APP_SETTINGS_KEY = 'hltools:appsettings';

async function saveAppSettings(settings) {
  const existing = await getAppSettings() || {};
  await redis.set(APP_SETTINGS_KEY, JSON.stringify({ ...existing, ...settings }));
}

async function getAppSettings() {
  const raw = await redis.get(APP_SETTINGS_KEY);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

module.exports = {
  saveTokens,
  getTokenRecord:      getRecord,
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
