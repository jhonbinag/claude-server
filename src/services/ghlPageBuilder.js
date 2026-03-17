/**
 * src/services/ghlPageBuilder.js
 *
 * Saves native GHL page sections by writing directly to the Firestore
 * `sections` field on the funnel_pages document.
 *
 * Discovery: GHL renders pages from the Firestore `sections` field —
 * a hierarchical nested format (section → row → column → elements).
 * Firebase Storage holds a snapshot but is NOT what the builder reads.
 *
 * Section format (plain JS before Firestore encoding):
 *   { id, type:'section', styles:{...}, mobileStyles:{}, children:[
 *     { children:[          // rows
 *       { id, type:'column', width:12, styles:{...}, mobileStyles:{}, children:[
 *         { id, type:'headline',     tag:'h1', text:'...' },
 *         { id, type:'sub-headline', text:'...' },
 *         { id, type:'paragraph',    text:'...' },
 *         { id, type:'button',       text:'...', link:'#', styles:{...} },
 *         { id, type:'bulletList',   text:'<ul>...' },
 *       ]}
 *     ]}
 *   ]}
 */

const https   = require('https');
const crypto  = require('crypto');
const { getFirebaseToken } = require('./ghlFirebaseService');

const FIRESTORE_HOST = 'firestore.googleapis.com';
const STORAGE_HOST   = 'firebasestorage.googleapis.com';
const STORAGE_BUCKET = 'highlevel-backend.appspot.com';
const BACKEND_HOST   = 'backend.leadconnectorhq.com';

// ── Utilities ─────────────────────────────────────────────────────────────────

function randomId(len = 8) {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

function uuidv4() {
  return crypto.randomUUID ? crypto.randomUUID() : `${randomId(8)}-${randomId(4)}-${randomId(4)}-${randomId(4)}-${randomId(12)}`;
}

// ── Generic HTTPS helper ──────────────────────────────────────────────────────

function httpsRequest(hostname, method, path, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const payload = bodyStr || null;
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
          try   { resolve({ status: res.statusCode, data: JSON.parse(d), raw: d }); }
          catch { resolve({ status: res.statusCode, data: d, raw: d }); }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Firebase token helper ─────────────────────────────────────────────────────

function getProjectIdFromToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
    const aud = payload.aud;
    return Array.isArray(aud) ? aud[0] : aud;
  } catch { return 'highlevel-backend'; }
}

// ── Firestore value encoder ───────────────────────────────────────────────────

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean')          return { booleanValue: val };
  if (typeof val === 'number')           return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  if (typeof val === 'string')           return { stringValue: val };
  if (Array.isArray(val))               return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) fields[k] = toFirestoreValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function readFirestoreDoc(idToken, projectId, pageId) {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/funnel_pages/${pageId}`;
  const res  = await httpsRequest(FIRESTORE_HOST, 'GET', path, { 'Authorization': `Bearer ${idToken}` }, null);
  if (res.status >= 400) throw new Error(`Firestore GET failed (${res.status}): ${res.raw.slice(0, 200)}`);
  const f = res.data.fields || {};
  return {
    funnelId:    f.funnel_id?.stringValue,
    locationId:  f.location_id?.stringValue,
    version:     parseInt(f.version?.integerValue || '1', 10),
    downloadUrl: f.page_data_download_url?.stringValue,
  };
}

async function patchFirestoreDoc(idToken, projectId, pageId, fields) {
  const fieldPaths = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const path = `/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/funnel_pages/${pageId}?${fieldPaths}`;
  const body = JSON.stringify({ fields });
  return httpsRequest(FIRESTORE_HOST, 'PATCH', path, {
    'Authorization': `Bearer ${idToken}`,
    'Content-Type':  'application/json',
  }, body);
}

// ── Firebase Storage helpers ──────────────────────────────────────────────────

async function downloadStorageFile(url) {
  const u   = new URL(url);
  const res = await httpsRequest(u.hostname, 'GET', u.pathname + u.search, {}, null);
  if (res.status >= 400) throw new Error(`Storage download failed (${res.status})`);
  return typeof res.data === 'object' ? res.data : JSON.parse(res.raw);
}

async function uploadToStorage(idToken, funnelId, pageId, pageData) {
  const fileName    = `page-data-${uuidv4()}`;
  const storagePath = `funnel/${funnelId}/page/${pageId}/${fileName}`;
  const encodedPath = encodeURIComponent(storagePath);
  const uploadPath  = `/v0/b/${STORAGE_BUCKET}/o?uploadType=media&name=${encodedPath}`;

  const body = JSON.stringify(pageData);
  const res  = await httpsRequest(STORAGE_HOST, 'POST', uploadPath, {
    'Authorization': `Bearer ${idToken}`,
    'Content-Type':  'application/json',
  }, body);

  if (res.status >= 400) throw new Error(`Storage upload failed (${res.status}): ${String(res.raw).slice(0, 300)}`);

  const downloadToken = res.data.downloadTokens;
  const downloadUrl   = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodedPath}?alt=media&token=${downloadToken}`;
  return { storagePath, downloadUrl };
}

// ── Section → GHL Firestore format converter ──────────────────────────────────

/**
 * Convert our AI-generated sections to GHL's Firestore sections format.
 * GHL sections are hierarchical: section → row → column → elements.
 * Columns can be split (width 6+6) or full-width (12).
 *
 * Our AI format (same hierarchy, just needs style normalization):
 *   { type:'section', id, name, styles:{backgroundColor, paddingTop, paddingBottom},
 *     children: [
 *       { type:'headline'|'sub-headline'|'paragraph'|'button'|'bulletList', id, text, tag?, link?, styles?, items? }
 *       OR { type:'row', children: [{ type:'column', children:[elements] }] }
 *     ]
 *   }
 */
function convertSectionsToGhl(aiSections) {
  return aiSections.map(aiSection => {
    const secId = aiSection.id || `section-${randomId()}`;

    // Flatten content elements from AI section
    const kids = aiSection.children || [];
    let contentItems = [];

    if (kids.length > 0 && kids[0].type === 'row') {
      // Nested row/column structure
      const row = kids[0];
      const col = (row.children || [])[0];
      contentItems = col?.children || [];
    } else {
      // Flat: direct children are content elements
      contentItems = kids.filter(k => !['row', 'column'].includes(k.type));
    }

    // Build content elements in GHL Firestore format
    const ghlElements = contentItems.map(el => {
      const elId = el.id || `${el.type}-${randomId()}`;
      switch (el.type) {
        case 'headline':
          return {
            id: elId, type: 'headline', tag: el.tag || 'h1', text: el.text || '',
            styles: { color: {} }, mobileStyles: {},
          };
        case 'sub-headline':
          return {
            id: elId, type: 'sub-headline', text: el.text || '',
          };
        case 'paragraph':
          return {
            id: elId, type: 'paragraph', text: el.text || '',
          };
        case 'button':
          return {
            id: elId, type: 'button',
            text: el.text || 'Click Here',
            link: el.link || '#',
            styles: {
              backgroundColor: { value: el.styles?.backgroundColor || '#000000' },
              color:           { value: el.styles?.color           || '#ffffff' },
              paddingLeft:     { value: 25, unit: 'px' },
              paddingRight:    { value: 25, unit: 'px' },
              borderRadius:    {},
            },
            mobileStyles: {},
          };
        case 'bulletList':
          return {
            id: elId, type: 'bulletList',
            text: '<ul>' + (el.items || []).map(i => `<li>${i.text || i}</li>`).join('') + '</ul>',
          };
        default:
          return {
            id: elId, type: 'paragraph', text: el.text || '',
          };
      }
    });

    // Build the section in GHL Firestore format
    return {
      id: secId,
      type: 'section',
      styles: {
        paddingTop:      { value: aiSection.styles?.paddingTop?.value      || 80,  unit: 'px' },
        paddingBottom:   { value: aiSection.styles?.paddingBottom?.value   || 80,  unit: 'px' },
        paddingLeft:     { value: 20, unit: 'px' },
        paddingRight:    { value: 20, unit: 'px' },
        backgroundColor: { value: aiSection.styles?.backgroundColor?.value || '#ffffff' },
      },
      mobileStyles: {},
      children: [
        {
          children: [
            {
              id:           `column-${randomId()}`,
              type:         'column',
              width:        12,
              styles:       { textAlign: { value: 'center' } },
              mobileStyles: {},
              children:     ghlElements,
            },
          ],
        },
      ],
    };
  });
}

// ── Backend metadata helper ───────────────────────────────────────────────────

function buildBackendHeaders(idToken) {
  return {
    'token-id':     idToken,
    'channel':      'APP',
    'source':       'WEB_USER',
    'version':      '2021-07-28',
    'Content-Type': 'application/json',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save page sections to GHL.
 *
 * Writes directly to the Firestore `sections` field (what GHL renders from).
 * Also uploads a snapshot to Firebase Storage and updates the URL fields.
 *
 * @param {string} locationId
 * @param {string} pageId
 * @param {object} sectionsJson  { sections: [...] }  (our AI-generated format)
 */
async function savePageData(locationId, pageId, sectionsJson) {
  const aiSections = sectionsJson?.sections || [];
  console.log(`[GHLPageBuilder] Saving page ${pageId} — ${aiSections.length} AI sections`);

  const idToken   = await getFirebaseToken(locationId);
  const projectId = getProjectIdFromToken(idToken);

  // 1. Read Firestore doc to get funnelId and version
  let docInfo;
  try {
    docInfo = await readFirestoreDoc(idToken, projectId, pageId);
  } catch (e) {
    throw new Error(`Cannot read Firestore doc for page ${pageId}: ${e.message}`);
  }

  const { funnelId, version: currentVersion, downloadUrl: currentDownloadUrl } = docInfo;
  if (!funnelId) throw new Error(`Page ${pageId} Firestore doc missing funnelId — open the page in GHL builder first.`);

  // 2. Convert AI sections to GHL Firestore format
  const ghlSections = convertSectionsToGhl(aiSections);
  console.log(`[GHLPageBuilder] Converted to ${ghlSections.length} GHL sections`);

  // 3. Write sections directly to Firestore (what GHL builder reads)
  const newVersion = (currentVersion || 1) + 1;
  const fsFields = {
    sections:     toFirestoreValue(ghlSections),
    version:      toFirestoreValue(newVersion),
    date_updated: { timestampValue: new Date().toISOString() },
  };

  const fsResult = await patchFirestoreDoc(idToken, projectId, pageId, fsFields);
  console.log(`[GHLPageBuilder] Firestore sections written → ${fsResult.status}`);

  if (fsResult.status >= 400) {
    throw new Error(`Firestore sections write failed (${fsResult.status}): ${String(fsResult.raw).slice(0, 300)}`);
  }

  // 4. Also upload snapshot to Firebase Storage + update URL fields (non-fatal)
  try {
    let currentPageData = null;
    if (currentDownloadUrl) {
      try { currentPageData = await downloadStorageFile(currentDownloadUrl); }
      catch { /* ignore */ }
    }

    const { storagePath, downloadUrl: newDownloadUrl } = await uploadToStorage(
      idToken, funnelId, pageId,
      { sections: ghlSections, settings: currentPageData?.settings || {}, general: currentPageData?.general || {} }
    );
    console.log(`[GHLPageBuilder] Storage snapshot → ${storagePath}`);

    await patchFirestoreDoc(idToken, projectId, pageId, {
      page_data_url:          toFirestoreValue(storagePath),
      page_data_download_url: toFirestoreValue(newDownloadUrl),
    });
  } catch (e) {
    console.warn(`[GHLPageBuilder] Storage snapshot failed (non-fatal): ${e.message}`);
  }

  return { success: true, sections: ghlSections.length, version: newVersion };
}

/**
 * Fetch the current page data from GHL's backend copilot endpoint.
 */
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
