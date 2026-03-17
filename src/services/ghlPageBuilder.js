/**
 * src/services/ghlPageBuilder.js
 *
 * Saves native GHL page sections by writing DIRECTLY to GHL's Firestore
 * via the Firestore REST API (firestore.googleapis.com), authenticated with
 * the Firebase ID token from ghlFirebaseService.
 *
 * The backend.leadconnectorhq.com POST endpoint only saves page metadata —
 * it does NOT persist sections. The native builder reads sections from
 * Firestore, so we must write there directly.
 */

const https = require('https');
const { getFirebaseToken } = require('./ghlFirebaseService');

const BACKEND_HOST  = 'backend.leadconnectorhq.com';
const FIRESTORE_HOST = 'firestore.googleapis.com';

// ── Generic HTTPS helper ──────────────────────────────────────────────────────

function httpsRequest(hostname, method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname,
        path,
        method,
        headers: {
          ...headers,
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => {
          try   { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, data: d }); }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Firestore REST API helpers ────────────────────────────────────────────────

/**
 * Convert an arbitrary JS value to a Firestore REST API typed value object.
 */
function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean')          return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val)
      ? { integerValue: String(val) }
      : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) fields[k] = toFirestoreValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

/**
 * Extract the Firebase project ID from a Firebase ID token (JWT).
 * The `aud` claim contains the project ID.
 */
function getProjectIdFromToken(idToken) {
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split('.')[1], 'base64').toString('utf8')
    );
    const aud = payload.aud;
    return Array.isArray(aud) ? aud[0] : aud;
  } catch {
    return null;
  }
}

/**
 * Write sections directly to GHL's Firestore via REST API.
 * Tries multiple collection paths in order until one succeeds.
 *
 * @param {string} idToken    Firebase ID token
 * @param {string} pageId     GHL funnel page ID
 * @param {Array}  sections   The sections array
 * @returns {object|null}     Firestore response or null if all paths failed
 */
async function writeFirestoreSections(idToken, pageId, sections) {
  const projectId = getProjectIdFromToken(idToken);
  if (!projectId) {
    console.warn('[GHLPageBuilder] Could not extract Firebase project ID from token');
    return null;
  }
  console.log(`[GHLPageBuilder] Firebase project: ${projectId}`);

  const headers = {
    'Authorization': `Bearer ${idToken}`,
    'Content-Type':  'application/json',
  };

  // Try multiple candidate collection paths.
  // GHL's native builder document is most likely at funnel_pages/{pageId}.
  // The sections may be at the top-level OR nested under _data.
  const attempts = [
    // (collection, fields to write)
    { col: 'funnel_pages', fields: { sections: toFirestoreValue(sections) } },
    { col: 'funnel_pages', fields: { _data: toFirestoreValue({ sections }) } },
    { col: 'funnelPages',  fields: { sections: toFirestoreValue(sections) } },
  ];

  for (const { col, fields } of attempts) {
    const fieldPaths  = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const path        = `/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${col}/${pageId}?${fieldPaths}`;

    let result;
    try {
      result = await httpsRequest(FIRESTORE_HOST, 'PATCH', path, headers, { fields });
    } catch (e) {
      console.warn(`[GHLPageBuilder] Firestore PATCH ${col}/${pageId} threw: ${e.message}`);
      continue;
    }

    console.log(`[GHLPageBuilder] Firestore PATCH ${col}/${pageId} (fields: ${Object.keys(fields).join(',')}) → ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`);

    if (result.status < 400) {
      console.log(`[GHLPageBuilder] Firestore write SUCCESS: ${col}/${pageId}`);
      return result;
    }
  }

  console.warn('[GHLPageBuilder] All Firestore write attempts failed');
  return null;
}

// ── Backend metadata update (keeps GHL page metadata in sync) ─────────────────

function buildBackendHeaders(idToken) {
  return {
    'token-id':     idToken,
    'channel':      'APP',
    'source':       'WEB_USER',
    'version':      '2021-07-28',
    'Content-Type': 'application/json',
  };
}

async function updatePageMetadata(locationId, pageId, sectionsJson) {
  let idToken = await getFirebaseToken(locationId);
  const path  = `/funnels/funnel/funnel-page/${pageId}`;

  let result = await httpsRequest(BACKEND_HOST, 'POST', path, buildBackendHeaders(idToken), sectionsJson);

  if (result.status === 401) {
    console.log(`[GHLPageBuilder] 401, refreshing token for ${locationId}`);
    idToken = await getFirebaseToken(locationId);
    result  = await httpsRequest(BACKEND_HOST, 'POST', path, buildBackendHeaders(idToken), sectionsJson);
  }

  console.log(`[GHLPageBuilder] Metadata POST ${pageId} → ${result.status}`);
  return { idToken, result };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save page sections to GHL.
 * Primary: writes sections directly to Firestore (what the native builder reads).
 * Secondary: updates page metadata via backend API.
 *
 * @param {string} locationId
 * @param {string} pageId
 * @param {object} sectionsJson  { sections: [...] }
 * @returns {object} metadata API response
 */
async function savePageData(locationId, pageId, sectionsJson) {
  const sections = sectionsJson?.sections;
  console.log(`[GHLPageBuilder] Saving page ${pageId} — ${sections?.length} sections, sample: ${JSON.stringify(sections?.[0]).slice(0, 200)}`);

  // Step 1: Write sections directly to Firestore
  const idToken = await getFirebaseToken(locationId);
  await writeFirestoreSections(idToken, pageId, sections);

  // Step 2: Update page metadata via backend API (keeps version/timestamps in sync)
  const { result } = await updatePageMetadata(locationId, pageId, sectionsJson);

  if (result.status >= 400) {
    const d   = result.data;
    const msg = typeof d === 'object' ? (d.message || d.error || JSON.stringify(d)) : d;
    // Non-fatal if Firestore write succeeded — just warn
    console.warn(`[GHLPageBuilder] Metadata update failed (${result.status}): ${msg}`);
  }

  return result.data;
}

/**
 * Fetch the current page data from GHL's backend.
 */
async function getPageData(locationId, pageId) {
  const idToken = await getFirebaseToken(locationId);
  const headers = buildBackendHeaders(idToken);
  delete headers['Content-Type'];

  const path   = `/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(locationId)}`;
  const result = await httpsRequest(BACKEND_HOST, 'GET', path, headers, null);

  if (result.status >= 400) {
    const d   = result.data;
    const msg = typeof d === 'object' ? (d.message || d.error || JSON.stringify(d)) : d;
    throw new Error(`GHL getPageData failed (${result.status}): ${msg}`);
  }

  return result.data;
}

module.exports = { buildBackendHeaders, savePageData, getPageData };
