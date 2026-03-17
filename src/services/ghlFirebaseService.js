/**
 * src/services/ghlFirebaseService.js
 *
 * Manages GHL Firebase ID tokens for accessing backend.leadconnectorhq.com APIs.
 *
 * Token flow:
 *  1. User provides a `refreshedToken` (Firebase custom token) from GHL localStorage
 *  2. Exchange it via identitytoolkit.googleapis.com → idToken + refreshToken
 *  3. Store both in Redis with expiry tracking
 *  4. On expiry: re-exchange the stored GHL custom token via signInWithCustomToken
 *     to get a fresh idToken WITH custom claims intact.
 *     (securetoken.googleapis.com refresh is NOT used — it strips GHL custom
 *      claims that Firestore security rules require)
 *
 * Redis key: hltools:fb:{locationId}
 * Value: JSON { idToken, customToken, expiresAt }
 * TTL: none (permanent until user disconnects)
 */

const https = require('https');

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const FIREBASE_API_KEY       = 'AIzaSyB_w3vXmsI7WeQtrIOkjR6xTRVN5uOieiE';
const SIGN_IN_URL            = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`;
const REFRESH_URL            = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
const FIVE_MINUTES_MS        = 5 * 60 * 1000;

const PREFIX = 'hltools:fb:';

// ── In-memory fallback (no Redis) ─────────────────────────────────────────────
const _mem = new Map();

function redisReq(cmd) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    const [c, k, v] = cmd;
    if (c === 'GET') return Promise.resolve(_mem.get(k) ?? null);
    if (c === 'SET') { _mem.set(k, v); return Promise.resolve('OK'); }
    if (c === 'DEL') { _mem.delete(k); return Promise.resolve(1); }
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(cmd);
    const url  = new URL(REDIS_URL);
    const req  = https.request(
      {
        hostname: url.hostname,
        path:     url.pathname,
        method:   'POST',
        headers:  {
          Authorization:   `Bearer ${REDIS_TOKEN}`,
          'Content-Type':  'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const p = JSON.parse(d);
            if (p.error) reject(new Error(p.error));
            else resolve(p.result);
          } catch (e) {
            reject(new Error(d));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Simple HTTPS POST helper returning parsed JSON ────────────────────────────
function httpsPost(urlStr, body, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const url     = new URL(urlStr);
    const req     = https.request(
      {
        hostname: url.hostname,
        path:     url.pathname + url.search,
        method:   'POST',
        headers:  {
          'Content-Type':   contentType,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(d) });
          } catch (e) {
            resolve({ status: res.statusCode, data: d });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Redis helpers ─────────────────────────────────────────────────────────────
async function storeRecord(locationId, record) {
  await redisReq(['SET', PREFIX + locationId, JSON.stringify(record)]);
}

async function loadRecord(locationId) {
  const raw = await redisReq(['GET', PREFIX + locationId]);
  return raw ? JSON.parse(raw) : null;
}

// ── Token type detection ──────────────────────────────────────────────────────

/**
 * Decode a JWT payload without verification.
 */
function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    try {
      return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    } catch { return null; }
  }
}

/**
 * Classify a token string:
 *  'idToken'      — Firebase idToken JWT  (aud = project ID)
 *  'customToken'  — Firebase custom token (aud = identitytoolkit URL)
 *  'refreshToken' — Firebase refresh token (opaque, not a JWT)
 */
function classifyToken(token) {
  if (!token || typeof token !== 'string') return 'unknown';
  const parts = token.split('.');
  if (parts.length !== 3) return 'refreshToken'; // not a JWT → refresh token
  const p = decodeJwtPayload(token);
  if (!p) return 'refreshToken';
  const aud = Array.isArray(p.aud) ? p.aud[0] : p.aud;
  if (typeof aud === 'string' && aud.includes('identitytoolkit.googleapis.com')) return 'customToken';
  return 'idToken';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Accept any Firebase token type from GHL localStorage:
 *  - idToken      → use directly
 *  - customToken  → exchange via signInWithCustomToken
 *  - refreshToken → exchange via securetoken.googleapis.com
 * Stores the token alongside the idToken for auto-refresh on expiry.
 */
async function connectFirebase(locationId, ghlToken) {
  const kind = classifyToken(ghlToken);
  console.log(`[GHLFirebase] Connecting ${locationId} with token type: ${kind}`);

  let idToken, expiresAt;

  if (kind === 'idToken') {
    // Store idToken as-is but do NOT set customToken — an idToken cannot be
    // re-exchanged for a fresh one, so on expiry we must ask user to reconnect.
    const payload = decodeJwtPayload(ghlToken);
    idToken   = ghlToken;
    expiresAt = payload?.exp ? payload.exp * 1000 : Date.now() + 3600 * 1000;
    const record = { idToken, customToken: null, expiresAt };
    await storeRecord(locationId, record);
    console.log(`[GHLFirebase] Connected ${locationId} via idToken, expires ${new Date(expiresAt).toISOString()} (no auto-refresh — reconnect when expired)`);
    return record;

  } else if (kind === 'customToken') {
    const result = await httpsPost(SIGN_IN_URL, { token: ghlToken, returnSecureToken: true });
    if (result.status !== 200 || !result.data.idToken) {
      const errMsg = result.data?.error?.message || '';
      // INVALID_CUSTOM_TOKEN means GHL stored an idToken in refreshedToken — fall back to using it directly
      if (errMsg.includes('INVALID_CUSTOM_TOKEN') || errMsg.includes('INVALID_IDP_RESPONSE')) {
        console.log(`[GHLFirebase] customToken exchange rejected (${errMsg}) — treating as idToken`);
        const payload = decodeJwtPayload(ghlToken);
        idToken   = ghlToken;
        expiresAt = payload?.exp ? payload.exp * 1000 : Date.now() + 3600 * 1000;
        const record = { idToken, customToken: null, expiresAt };
        await storeRecord(locationId, record);
        console.log(`[GHLFirebase] Connected ${locationId} via idToken fallback, expires ${new Date(expiresAt).toISOString()}`);
        return record;
      }
      throw new Error(`Firebase sign-in failed: ${errMsg || JSON.stringify(result.data)}`);
    }
    idToken   = result.data.idToken;
    expiresAt = Date.now() + (parseInt(result.data.expiresIn, 10) || 3600) * 1000;

  } else {
    // refreshToken — exchange via securetoken
    const body   = `grant_type=refresh_token&refresh_token=${encodeURIComponent(ghlToken)}`;
    const result = await httpsPost(REFRESH_URL, body, 'application/x-www-form-urlencoded');
    if (result.status !== 200 || !result.data.id_token) {
      const msg = result.data?.error?.message || JSON.stringify(result.data);
      throw new Error(`Firebase refresh exchange failed: ${msg}`);
    }
    idToken   = result.data.id_token;
    expiresAt = Date.now() + (parseInt(result.data.expires_in, 10) || 3600) * 1000;
    // Store the new refresh token returned so we can re-exchange it later
    ghlToken  = result.data.refresh_token || ghlToken;
  }

  const record = { idToken, customToken: ghlToken, expiresAt };
  await storeRecord(locationId, record);

  console.log(`[GHLFirebase] Connected location ${locationId}, expires ${new Date(expiresAt).toISOString()}`);
  return record;
}

/**
 * Get a valid idToken for the location.
 * On expiry: re-exchanges the stored GHL custom token via signInWithCustomToken
 * to get a fresh idToken WITH all custom claims intact.
 * If the custom token is also expired, throws asking user to reconnect.
 *
 * @param {string} locationId
 * @returns {string} valid Firebase idToken
 */
async function getFirebaseToken(locationId) {
  const record = await loadRecord(locationId);
  if (!record) {
    throw new Error('No Firebase token found for this location. Please connect first.');
  }

  // Return cached token if still fresh
  if (record.expiresAt > Date.now() + FIVE_MINUTES_MS) {
    return record.idToken;
  }

  // Re-exchange the stored GHL custom token to get a fresh idToken with claims
  if (record.customToken) {
    console.log(`[GHLFirebase] idToken near expiry for ${locationId}, re-exchanging custom token`);
    try {
      return (await connectFirebase(locationId, record.customToken)).idToken;
    } catch (err) {
      // Custom token itself expired (1h) — user must reconnect via bookmarklet
      throw new Error(`Firebase session expired. Please use the bookmarklet to reconnect. (${err.message})`);
    }
  }

  // No customToken stored (connected via idToken) — must reconnect
  throw new Error('Firebase session expired. Please run the console snippet again in GHL to reconnect.');
}

/**
 * Delete the stored Firebase token for a location.
 *
 * @param {string} locationId
 */
async function disconnectFirebase(locationId) {
  await redisReq(['DEL', PREFIX + locationId]);
  console.log(`[GHLFirebase] Disconnected location ${locationId}`);
}

/**
 * Get the stored record metadata (without the raw token) for status checks.
 *
 * @param {string} locationId
 * @returns {{ connected: boolean, expiresAt: number|null }}
 */
async function getStatus(locationId) {
  const record = await loadRecord(locationId);
  if (!record) return { connected: false, expiresAt: null };
  const expired    = record.expiresAt && record.expiresAt < Date.now();
  const canRefresh = !!record.customToken; // customToken present → auto-refresh capable
  if (expired && !canRefresh) return { connected: true, expired: true, expiresAt: record.expiresAt, canRefresh: false };
  return { connected: true, expiresAt: record.expiresAt, canRefresh };
}

module.exports = { connectFirebase, getFirebaseToken, disconnectFirebase, getStatus };
