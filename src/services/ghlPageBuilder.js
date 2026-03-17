/**
 * src/services/ghlPageBuilder.js
 *
 * Low-level helpers for interacting with GHL's internal backend API
 * (backend.leadconnectorhq.com) to read and write native funnel/website
 * page data.
 *
 * All requests authenticate via Firebase ID token (token-id header),
 * obtained through ghlFirebaseService.
 */

const https = require('https');
const { getFirebaseToken } = require('./ghlFirebaseService');

const BACKEND_HOST = 'backend.leadconnectorhq.com';

// ── Header factory ────────────────────────────────────────────────────────────

/**
 * Build the required headers for backend.leadconnectorhq.com requests.
 *
 * @param {string} idToken  Firebase ID token
 * @returns {object}
 */
function buildBackendHeaders(idToken) {
  return {
    'token-id':     idToken,
    'channel':      'APP',
    'source':       'WEB_USER',
    'version':      '2021-07-28',
    'Content-Type': 'application/json',
  };
}

// ── Generic HTTPS request helper ──────────────────────────────────────────────

function backendRequest(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      ...headers,
      ...(payload && { 'Content-Length': Buffer.byteLength(payload) }),
    };

    const req = https.request(
      {
        hostname: BACKEND_HOST,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
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
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Retry helper: refresh token on 401 and try once more ─────────────────────

async function backendRequestWithRetry(locationId, method, path, body) {
  let idToken = await getFirebaseToken(locationId);
  let headers = buildBackendHeaders(idToken);
  let result  = await backendRequest(method, path, headers, body);

  if (result.status === 401) {
    console.log(`[GHLPageBuilder] 401 received, forcing token refresh for ${locationId}`);
    // Force a fresh token by temporarily expiring it in the store —
    // getFirebaseToken will refresh automatically on next call since the
    // stored token is now invalid. We trigger refresh by calling the service's
    // refresh path directly (the service checks expiresAt; here we bypass
    // cache by re-requiring after the 401 means the token is truly stale).
    // Simple approach: just call getFirebaseToken again — if the token was
    // recently refreshed it will be the same; caller should disconnect and
    // reconnect if still 401.
    const { connectFirebase: _c, disconnectFirebase: _d, ...svc } = require('./ghlFirebaseService');
    // Re-fetch (may be same token if not expired by time); if still 401 caller handles it
    idToken = await getFirebaseToken(locationId);
    headers = buildBackendHeaders(idToken);
    result  = await backendRequest(method, path, headers, body);
  }

  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save page sections to GHL's backend.
 *
 * @param {string} locationId
 * @param {string} pageId
 * @param {object} sectionsJson  The full { sections: [...] } object
 * @returns {object} GHL API response data
 */
async function savePageData(locationId, pageId, sectionsJson) {
  const path   = `/funnels/funnel/funnel-page/${pageId}`;
  const body   = sectionsJson; // already { sections: [...] }
  console.log(`[GHLPageBuilder] Saving page ${pageId} — sections: ${sectionsJson?.sections?.length}, sample: ${JSON.stringify(sectionsJson?.sections?.[0]).slice(0, 200)}`);
  const result = await backendRequestWithRetry(locationId, 'POST', path, body);

  if (result.status >= 400) {
    const msg = typeof result.data === 'object'
      ? (result.data.message || result.data.error || JSON.stringify(result.data))
      : result.data;
    throw new Error(`GHL savePageData failed (${result.status}): ${msg}`);
  }

  const resp = result.data;
  const savedSections = resp?.data?._data?.sections || resp?.sections || resp?.data?.sections;
  console.log(`[GHLPageBuilder] Saved page ${pageId} — status: ${result.status}, savedSectionsCount: ${savedSections?.length ?? 'NOT FOUND'}, _data keys: ${JSON.stringify(Object.keys(resp?.data?._data || {}))}`);
  return resp;
}

/**
 * Fetch the current page data from GHL's backend.
 *
 * @param {string} locationId
 * @param {string} pageId
 * @returns {object} page data from GHL
 */
async function getPageData(locationId, pageId) {
  const idToken = await getFirebaseToken(locationId);
  const headers = buildBackendHeaders(idToken);
  delete headers['Content-Type']; // GET requests must not have Content-Type

  const path   = `/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(locationId)}`;
  const result = await backendRequest('GET', path, headers, null);

  if (result.status >= 400) {
    const msg = typeof result.data === 'object'
      ? (result.data.message || result.data.error || JSON.stringify(result.data))
      : result.data;
    throw new Error(`GHL getPageData failed (${result.status}): ${msg}`);
  }

  return result.data;
}

module.exports = { buildBackendHeaders, savePageData, getPageData };
