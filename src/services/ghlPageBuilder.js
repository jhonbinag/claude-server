/**
 * src/services/ghlPageBuilder.js
 *
 * Saves native GHL page sections. Tries every known storage path in order:
 *
 * 1. Firestore sub-collection  funnel_pages/{pageId}/sections/{version}
 *    (section_version from main doc tells the builder which version to read)
 * 2. Firestore root field       funnel_pages/{pageId}.sections   (top-level)
 * 3. Firebase Realtime Database funnel_pages/{pageId}
 * 4. Backend API                /funnels/funnel/funnel-page/{pageId}  (metadata)
 */

const https = require('https');
const { getFirebaseToken } = require('./ghlFirebaseService');

const BACKEND_HOST   = 'backend.leadconnectorhq.com';
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

// ── Firestore helpers ─────────────────────────────────────────────────────────

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean')          return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val)
      ? { integerValue: String(val) }
      : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val))      return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) fields[k] = toFirestoreValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function getProjectIdFromToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
    const aud = payload.aud;
    return Array.isArray(aud) ? aud[0] : aud;
  } catch { return null; }
}

async function firestorePatch(projectId, docPath, fields, idToken) {
  const fieldPaths = Object.keys(fields)
    .map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&');
  const path = `/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${docPath}?${fieldPaths}`;
  return httpsRequest(FIRESTORE_HOST, 'PATCH', path, {
    'Authorization': `Bearer ${idToken}`,
    'Content-Type':  'application/json',
  }, { fields });
}

// Create a new Firestore document (for sub-collections that may not exist yet)
async function firestoreCreate(projectId, colPath, docId, fields, idToken) {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${colPath}?documentId=${encodeURIComponent(docId)}`;
  return httpsRequest(FIRESTORE_HOST, 'POST', path, {
    'Authorization': `Bearer ${idToken}`,
    'Content-Type':  'application/json',
  }, { fields });
}

// ── Firebase Realtime Database helper ─────────────────────────────────────────

async function rtdbPut(projectId, rtdbPath, data, idToken) {
  // Try both common RTDB hostnames for GHL's project
  const hosts = [
    `${projectId}-default-rtdb.firebaseio.com`,
    `${projectId}-default-rtdb.us-central1.firebasedatabase.app`,
  ];
  for (const host of hosts) {
    const path = `/${rtdbPath}.json`;
    let result;
    try {
      result = await httpsRequest(host, 'PATCH', path, {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type':  'application/json',
      }, data);
    } catch (e) {
      console.warn(`[GHLPageBuilder] RTDB PATCH ${host}${path} threw: ${e.message}`);
      continue;
    }
    console.log(`[GHLPageBuilder] RTDB PATCH ${host}${path} → ${result.status}: ${String(result.data).slice(0, 200)}`);
    if (result.status < 400) return result;
  }
  return null;
}

// ── Read current section_version from Firestore ───────────────────────────────

async function getSectionVersion(projectId, pageId, idToken) {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/funnel_pages/${pageId}`;
  try {
    const res = await httpsRequest(FIRESTORE_HOST, 'GET', path, {
      'Authorization': `Bearer ${idToken}`,
    }, null);
    const version = res.data?.fields?.section_version?.integerValue;
    return version ? parseInt(version, 10) : 1;
  } catch { return 1; }
}

// ── Main write function ───────────────────────────────────────────────────────

/**
 * Write sections to all known GHL storage paths.
 * Logs each attempt so we can see what works.
 */
async function writeAllPaths(idToken, pageId, sections) {
  const projectId = getProjectIdFromToken(idToken);
  if (!projectId) {
    console.warn('[GHLPageBuilder] Could not extract Firebase project ID from token');
    return;
  }
  console.log(`[GHLPageBuilder] Firebase project: ${projectId}`);

  // ── 1. Firestore sub-collection: funnel_pages/{pageId}/sections/{version} ──
  // The builder reads section_version from the main doc then fetches that version.
  const sectionVersion = await getSectionVersion(projectId, pageId, idToken);
  const versionDocId   = String(sectionVersion);

  const subcolFields   = { sections: toFirestoreValue(sections) };

  // Try PATCH (if doc exists) then POST (create if not)
  let subcolResult;
  try {
    subcolResult = await firestorePatch(
      projectId,
      `funnel_pages/${pageId}/sections/${versionDocId}`,
      subcolFields,
      idToken
    );
    console.log(`[GHLPageBuilder] Firestore subcol PATCH sections/v${versionDocId} → ${subcolResult.status}: ${JSON.stringify(subcolResult.data).slice(0, 300)}`);
    if (subcolResult.status === 404 || subcolResult.status === 400) {
      // Document doesn't exist — create it
      subcolResult = await firestoreCreate(
        projectId,
        `funnel_pages/${pageId}/sections`,
        versionDocId,
        subcolFields,
        idToken
      );
      console.log(`[GHLPageBuilder] Firestore subcol CREATE sections/v${versionDocId} → ${subcolResult.status}: ${JSON.stringify(subcolResult.data).slice(0, 300)}`);
    }
  } catch (e) {
    console.warn(`[GHLPageBuilder] Firestore subcol threw: ${e.message}`);
  }

  // ── 2. Firestore root field: funnel_pages/{pageId}.sections ──
  try {
    const rootResult = await firestorePatch(
      projectId,
      `funnel_pages/${pageId}`,
      { sections: toFirestoreValue(sections) },
      idToken
    );
    console.log(`[GHLPageBuilder] Firestore root sections field → ${rootResult.status}: ${JSON.stringify(rootResult.data).slice(0, 200)}`);
  } catch (e) {
    console.warn(`[GHLPageBuilder] Firestore root threw: ${e.message}`);
  }

  // ── 3. Firebase Realtime Database: funnel_pages/{pageId} ──
  await rtdbPut(projectId, `funnel_pages/${pageId}`, { sections }, idToken);
}

// ── Backend API helpers ───────────────────────────────────────────────────────

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

async function savePageData(locationId, pageId, sectionsJson) {
  const sections = sectionsJson?.sections;
  console.log(`[GHLPageBuilder] Saving page ${pageId} — ${sections?.length} sections`);

  // Get a fresh token once and reuse for all Firebase operations
  const idToken = await getFirebaseToken(locationId);

  // Write to all known storage paths
  await writeAllPaths(idToken, pageId, sections);

  // Update metadata via backend API (non-fatal)
  const { result } = await updatePageMetadata(locationId, pageId, sectionsJson);
  if (result.status >= 400) {
    const d = result.data;
    console.warn(`[GHLPageBuilder] Metadata update ${result.status}: ${typeof d === 'object' ? JSON.stringify(d).slice(0, 200) : d}`);
  }

  return result.data;
}

async function getPageData(locationId, pageId) {
  const idToken = await getFirebaseToken(locationId);
  const headers = buildBackendHeaders(idToken);
  delete headers['Content-Type'];

  const path   = `/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(locationId)}`;
  const result = await httpsRequest(BACKEND_HOST, 'GET', path, headers, null);

  if (result.status >= 400) {
    const d = result.data;
    throw new Error(`GHL getPageData failed (${result.status}): ${typeof d === 'object' ? (d.message || d.error || JSON.stringify(d)) : d}`);
  }
  return result.data;
}

module.exports = { buildBackendHeaders, savePageData, getPageData };
