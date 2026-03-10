/**
 * src/services/toolTokenService.js
 *
 * Two responsibilities:
 *
 * 1. TOOL CONFIG CACHE
 *    After toolRegistry loads configs from Firebase (or file store), it
 *    caches them in Upstash Redis with a 1-hour TTL. This eliminates
 *    repeated Firestore reads on every Claude task request.
 *    Cache is invalidated automatically when an integration changes.
 *
 * 2. TOOL SESSION TOKENS  (tst_* tokens)
 *    Generated when a user connects an integration. Represent the set of
 *    active integrations for a sub-account. Stored in Redis.
 *
 *    LIFETIME — 7-day SLIDING window:
 *      • Token is valid as long as lastActive < 7 days ago.
 *      • Every authenticated API call calls touchToken() which updates
 *        lastActive in Redis (debounced to at most once per 6 hours to
 *        avoid excessive Redis writes).
 *      • If the user is active daily, the token NEVER expires.
 *      • lastActive > 3 days → status = 'idle'  → UI shows "Reconnect" button
 *      • lastActive > 7 days → status = 'expired' → must reconnect
 *
 *    No duplicates: generateToolSessionToken() revokes the previous token
 *    before creating a new one. Reconnect just regenerates in-place.
 *
 * FALLBACK: In-process Map when Upstash credentials are absent (dev mode).
 *
 * Redis key layout:
 *   hltools:toolcfg:{locationId}      → JSON tool configs (TTL 1h)
 *   hltools:tooltoken:{locationId}    → JSON token record
 *   hltools:tooltokenidx:{token}      → locationId (reverse-lookup)
 */

const crypto = require('crypto');
const https  = require('https');

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

// Sliding-window token lifecycle
const CFG_TTL             = 3600;              // 1h config cache
const TOKEN_IDLE_MS       = 3 * 24 * 3600 * 1000;  // 3 days → show Reconnect
const TOKEN_EXPIRE_MS     = 7 * 24 * 3600 * 1000;  // 7 days → expired
const TOUCH_DEBOUNCE_MS   = 6 * 3600 * 1000;        // touch Redis at most once per 6h

const TOOLCFG_PREFIX   = 'hltools:toolcfg:';
const TOOLTOKEN_PREFIX = 'hltools:tooltoken:';
const TOKENIDX_PREFIX  = 'hltools:tooltokenidx:';

// ── Upstash REST Client ───────────────────────────────────────────────────────

const memFallback = new Map();
// In-process debounce: locationId → last Redis touch timestamp
const touchDebounce = new Map();

function redisRequest(command) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    const [cmd, key, val, , ex] = command;
    if (cmd === 'GET') return Promise.resolve(memFallback.get(key) ?? null);
    if (cmd === 'SET') {
      memFallback.set(key, typeof val === 'string' ? val : JSON.stringify(val));
      if (ex) setTimeout(() => memFallback.delete(key), Number(ex) * 1000);
      return Promise.resolve('OK');
    }
    if (cmd === 'DEL') { memFallback.delete(key); return Promise.resolve(1); }
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(command);
    const url     = new URL(REDIS_URL);
    const options = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers:  {
        Authorization:    `Bearer ${REDIS_TOKEN}`,
        'Content-Type':   'application/json',
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

const redis = {
  get: (key)           => redisRequest(['GET', key]),
  set: (key, val, ttl) => ttl
    ? redisRequest(['SET', key, typeof val === 'string' ? val : JSON.stringify(val), 'EX', String(ttl)])
    : redisRequest(['SET', key, typeof val === 'string' ? val : JSON.stringify(val)]),
  del: (key)           => redisRequest(['DEL', key]),
};

function parseRedis(raw) {
  if (raw === null || raw === undefined) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// ── Tool Config Cache ─────────────────────────────────────────────────────────

async function getCachedToolConfig(locationId) {
  try {
    return parseRedis(await redis.get(TOOLCFG_PREFIX + locationId));
  } catch (err) {
    console.error('[ToolTokenService] Cache get error:', err.message);
    return null;
  }
}

async function setCachedToolConfig(locationId, configs, ttl = CFG_TTL) {
  try {
    await redis.set(TOOLCFG_PREFIX + locationId, JSON.stringify(configs), ttl);
  } catch (err) {
    console.error('[ToolTokenService] Cache set error:', err.message);
  }
}

async function invalidateToolConfigCache(locationId) {
  try {
    await redis.del(TOOLCFG_PREFIX + locationId);
    console.log(`[ToolTokenService] Cache invalidated for location ${locationId}`);
  } catch (err) {
    console.error('[ToolTokenService] Cache invalidate error:', err.message);
  }
}

// ── Tool Session Tokens ───────────────────────────────────────────────────────

/**
 * Generate and store a new tool-session token.
 * Revokes any previous token first (no duplicates).
 *
 * @param {string}   locationId
 * @param {string[]} enabledCategories
 * @returns {Promise<string>} new token
 */
async function generateToolSessionToken(locationId, enabledCategories) {
  await revokeToolSessionToken(locationId);

  const prefix = locationId.slice(0, 6);
  const secret = crypto.randomBytes(32).toString('hex');
  const token  = `tst_${prefix}_${secret}`;
  const now    = Date.now();

  const record = JSON.stringify({
    token,
    locationId,
    categories:  enabledCategories,
    createdAt:   now,
    lastActive:  now,
  });

  try {
    await Promise.all([
      redis.set(TOOLTOKEN_PREFIX + locationId, record),
      redis.set(TOKENIDX_PREFIX  + token,      locationId),
    ]);
    console.log(`[ToolTokenService] Token generated for ${locationId} (${enabledCategories.length} integrations)`);
  } catch (err) {
    console.error('[ToolTokenService] Token store error:', err.message);
  }

  return token;
}

/**
 * Update lastActive timestamp on a token (debounced: once per 6h per location).
 * Also updates the locationRegistry (fire-and-forget).
 *
 * @param {string} locationId
 * @returns {Promise<void>}
 */
async function touchToken(locationId) {
  const now      = Date.now();
  const lastTouch = touchDebounce.get(locationId) || 0;

  if (now - lastTouch < TOUCH_DEBOUNCE_MS) return; // too soon

  touchDebounce.set(locationId, now);

  try {
    const raw = parseRedis(await redis.get(TOOLTOKEN_PREFIX + locationId));
    if (!raw) return;

    raw.lastActive = now;
    await redis.set(TOOLTOKEN_PREFIX + locationId, JSON.stringify(raw));

    // Also update locationRegistry (no await — fire-and-forget)
    require('./locationRegistry').updateLastActive(locationId).catch(() => {});
  } catch (err) {
    console.error('[ToolTokenService] Touch error:', err.message);
  }
}

/**
 * Validate a tool-session token.
 * Returns location/categories on success, null on failure.
 *
 * @param {string} token
 * @returns {Promise<{locationId: string, categories: string[]}|null>}
 */
async function validateToolSessionToken(token) {
  if (!token) return null;
  try {
    const locationId = await redis.get(TOKENIDX_PREFIX + token);
    if (!locationId) return null;

    const raw = parseRedis(await redis.get(TOOLTOKEN_PREFIX + locationId));
    if (!raw) return null;

    // Sliding-window expiry: check lastActive, not a fixed expiresAt
    if (Date.now() - raw.lastActive > TOKEN_EXPIRE_MS) {
      await revokeToolSessionToken(locationId);
      return null;
    }

    return { locationId: raw.locationId, categories: raw.categories };
  } catch (err) {
    console.error('[ToolTokenService] Token validate error:', err.message);
    return null;
  }
}

/**
 * Get the full token record including lastActive and computed status.
 *
 * @param {string} locationId
 * @returns {Promise<object|null>}
 */
async function getToolSessionToken(locationId) {
  try {
    const raw = parseRedis(await redis.get(TOOLTOKEN_PREFIX + locationId));
    if (!raw) return null;

    const idle = Date.now() - raw.lastActive;
    const status =
      idle > TOKEN_EXPIRE_MS ? 'expired' :
      idle > TOKEN_IDLE_MS   ? 'idle'    : 'active';

    return {
      ...raw,
      status,
      idleDays: Math.floor(idle / (24 * 3600 * 1000)),
    };
  } catch {
    return null;
  }
}

/**
 * Get token status summary for a location (used by admin and /sync endpoint).
 *
 * @param {string} locationId
 * @returns {Promise<{status: string, token: string|null, lastActive: number|null, idleDays: number}>}
 */
async function getTokenStatus(locationId) {
  const rec = await getToolSessionToken(locationId);
  if (!rec) return { status: 'none', token: null, lastActive: null, idleDays: 0 };
  return {
    status:     rec.status,
    token:      rec.token,
    lastActive: rec.lastActive,
    idleDays:   rec.idleDays,
    categories: rec.categories,
  };
}

/**
 * Revoke the tool-session token for a location.
 * Called on integration disconnect, uninstall, or admin action.
 */
async function revokeToolSessionToken(locationId) {
  try {
    const raw = parseRedis(await redis.get(TOOLTOKEN_PREFIX + locationId));
    if (raw?.token) {
      await redis.del(TOKENIDX_PREFIX + raw.token);
    }
    await redis.del(TOOLTOKEN_PREFIX + locationId);
    touchDebounce.delete(locationId); // reset debounce
  } catch (err) {
    console.error('[ToolTokenService] Token revoke error:', err.message);
  }
}

module.exports = {
  // Cache
  getCachedToolConfig,
  setCachedToolConfig,
  invalidateToolConfigCache,
  // Tokens
  generateToolSessionToken,
  touchToken,
  validateToolSessionToken,
  getToolSessionToken,
  getTokenStatus,
  revokeToolSessionToken,
  // Constants (used by UI sync endpoint)
  TOKEN_IDLE_DAYS:   TOKEN_IDLE_MS   / (24 * 3600 * 1000),
  TOKEN_EXPIRE_DAYS: TOKEN_EXPIRE_MS / (24 * 3600 * 1000),
};
