/**
 * src/services/ghlPageBuilder.js
 *
 * Saves native GHL page sections via TWO writes:
 *
 *  1. Firebase Storage — GHL hierarchical format (what GHL builder reads)
 *     { sections: [{ id, type, name, allowRowMaxWidth, styles, mobileStyles, children }] }
 *     children: rows → columns → elements (heading/sub-heading/paragraph/button/bulletList/image/divider)
 *
 *  2. Firestore funnel_pages/{pageId} — page_data_url, page_data_download_url,
 *     sections (same hierarchical format), versionHistory, version
 *
 * Discovery (2026-03-18): GHL's native AI stores the SAME hierarchical format
 * in Firebase Storage as in Firestore. No flat elements array. No metaData.
 * No general field. Element types: "heading", "sub-heading" (not "headline"/"sub-headline").
 */

const https  = require('https');
const crypto = require('crypto');
const { getFirebaseToken } = require('./ghlFirebaseService');

const FIRESTORE_HOST = 'firestore.googleapis.com';
const STORAGE_HOST   = 'firebasestorage.googleapis.com';
const STORAGE_BUCKET = 'highlevel-backend.appspot.com';

// ── Utilities ─────────────────────────────────────────────────────────────────

function randomId(len = 10) {
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

  const vhValues = f.versionHistory?.arrayValue?.values || [];

  return {
    funnelId:       f.funnel_id?.stringValue,
    locationId:     f.location_id?.stringValue,
    version:        parseInt(f.version?.integerValue || '1', 10),
    downloadUrl:    f.page_data_download_url?.stringValue,
    versionHistory: vhValues,
    updatedBy:      f.updated_by?.stringValue,
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

// ── GHL element builder (hierarchical format matching GHL's native AI) ─────────

function buildGhlElement(el) {
  const rawColor  = el.styles?.color?.value || el.styles?.color || '#000000';
  const rawBg     = el.styles?.backgroundColor?.value || el.styles?.backgroundColor || 'transparent';
  const textAlign = el.styles?.textAlign?.value || 'left';

  switch (el.type) {
    case 'headline':
    case 'heading': {
      const tag    = el.tag || 'h1';
      const fSize  = el.styles?.fontSize?.value  || (tag === 'h1' ? 52 : tag === 'h2' ? 36 : 28);
      const mSize  = el.mobileStyles?.fontSize?.value || (tag === 'h1' ? 32 : tag === 'h2' ? 26 : 22);
      return {
        id:   `heading-${randomId()}`,
        type: 'heading',
        text: el.text || '',
        tag,
        styles: {
          color:         { value: rawColor },
          fontSize:      { value: fSize, unit: 'px' },
          lineHeight:    { value: 1.2, unit: 'em' },
          textAlign:     { value: el.styles?.textAlign?.value || 'center' },
          marginTop:     { value: 0,  unit: 'px' },
          marginRight:   { value: 0,  unit: 'px' },
          marginBottom:  { value: 20, unit: 'px' },
          marginLeft:    { value: 0,  unit: 'px' },
          typography:    { value: 'var(--headlinefont)' },
          linkTextColor: { value: rawColor },
        },
        mobileStyles: {
          fontSize:     { value: mSize, unit: 'px' },
          marginBottom: { value: 16,    unit: 'px' },
        },
      };
    }

    case 'sub-headline':
    case 'sub-heading': {
      const fSize = el.styles?.fontSize?.value || 20;
      return {
        id:   `sub-heading-${randomId()}`,
        type: 'sub-heading',
        text: el.text || '',
        styles: {
          color:         { value: rawColor },
          fontSize:      { value: fSize, unit: 'px' },
          lineHeight:    { value: 1.4, unit: 'em' },
          textAlign:     { value: el.styles?.textAlign?.value || 'center' },
          marginTop:     { value: 0,  unit: 'px' },
          marginRight:   { value: 0,  unit: 'px' },
          marginBottom:  { value: 12, unit: 'px' },
          marginLeft:    { value: 0,  unit: 'px' },
          typography:    { value: 'var(--contentfont)' },
          linkTextColor: { value: rawColor },
        },
        mobileStyles: {
          fontSize:     { value: el.mobileStyles?.fontSize?.value || Math.max(fSize - 2, 14), unit: 'px' },
          marginBottom: { value: 10, unit: 'px' },
        },
      };
    }

    case 'paragraph': {
      const fSize = el.styles?.fontSize?.value || 16;
      return {
        id:   `paragraph-${randomId()}`,
        type: 'paragraph',
        text: el.text || '',
        styles: {
          color:         { value: rawColor },
          fontSize:      { value: fSize, unit: 'px' },
          lineHeight:    { value: 1.6, unit: 'em' },
          textAlign:     { value: textAlign },
          marginTop:     { value: 0,  unit: 'px' },
          marginRight:   { value: 0,  unit: 'px' },
          marginBottom:  { value: 20, unit: 'px' },
          marginLeft:    { value: 0,  unit: 'px' },
          typography:    { value: 'var(--contentfont)' },
          linkTextColor: { value: rawColor },
        },
        mobileStyles: {
          fontSize:     { value: el.mobileStyles?.fontSize?.value || Math.max(fSize - 2, 14), unit: 'px' },
          marginBottom: { value: 16, unit: 'px' },
        },
      };
    }

    case 'button': {
      const btnColor = el.styles?.color?.value         || el.styles?.color         || '#FFFFFF';
      const btnBg    = el.styles?.backgroundColor?.value || el.styles?.backgroundColor || '#1D4ED8';
      const fSize    = el.styles?.fontSize?.value || 16;
      return {
        id:   `button-${randomId()}`,
        type: 'button',
        text: el.text || 'Click Here',
        link: el.link || '#',
        styles: {
          backgroundColor: { value: btnBg },
          color:           { value: btnColor },
          fontSize:        { value: fSize, unit: 'px' },
          fontWeight:      { value: '700' },
          lineHeight:      { value: 1.2, unit: 'em' },
          textAlign:       { value: 'center' },
          paddingTop:      { value: el.styles?.paddingTop?.value    || 14, unit: 'px' },
          paddingRight:    { value: el.styles?.paddingRight?.value  || 32, unit: 'px' },
          paddingBottom:   { value: el.styles?.paddingBottom?.value || 14, unit: 'px' },
          paddingLeft:     { value: el.styles?.paddingLeft?.value   || 32, unit: 'px' },
          borderRadius:    { value: el.styles?.borderRadius?.value  || 8,  unit: 'px' },
          marginTop:       { value: 10, unit: 'px' },
          marginRight:     { value: 0,  unit: 'px' },
          marginBottom:    { value: 10, unit: 'px' },
          marginLeft:      { value: 0,  unit: 'px' },
        },
        mobileStyles: {
          fontSize:     { value: el.mobileStyles?.fontSize?.value || Math.max(fSize - 1, 14), unit: 'px' },
          paddingTop:   { value: 12, unit: 'px' },
          paddingBottom:{ value: 12, unit: 'px' },
        },
      };
    }

    case 'bulletList': {
      const fSize = el.styles?.fontSize?.value || 16;
      const items = (el.items || []).map(i => (typeof i === 'string' ? i : (i.text || String(i))));
      return {
        id:    `bulletList-${randomId()}`,
        type:  'bulletList',
        items,
        icon:  el.icon || { name: 'check', unicode: 'f00c', fontFamily: 'Font Awesome 5 Free' },
        styles: {
          color:         { value: rawColor },
          iconColor:     { value: el.styles?.iconColor?.value || '#22C55E' },
          fontSize:      { value: fSize, unit: 'px' },
          lineHeight:    { value: 1.7, unit: 'em' },
          textAlign:     { value: textAlign },
          marginTop:     { value: 0,  unit: 'px' },
          marginRight:   { value: 0,  unit: 'px' },
          marginBottom:  { value: 20, unit: 'px' },
          marginLeft:    { value: 0,  unit: 'px' },
          typography:    { value: 'var(--contentfont)' },
          linkTextColor: { value: rawColor },
        },
        mobileStyles: {
          fontSize:     { value: el.mobileStyles?.fontSize?.value || Math.max(fSize - 1, 14), unit: 'px' },
          marginBottom: { value: 16, unit: 'px' },
        },
      };
    }

    case 'image':
      return {
        id:   `image-${randomId()}`,
        type: 'image',
        src:  el.src || '',
        alt:  el.alt || '',
        styles: {
          width:         { value: 100, unit: '%' },
          borderRadius:  { value: el.styles?.borderRadius?.value || 0, unit: 'px' },
          marginTop:     { value: 0, unit: 'px' },
          marginRight:   { value: 0, unit: 'px' },
          marginBottom:  { value: 0, unit: 'px' },
          marginLeft:    { value: 0, unit: 'px' },
        },
        mobileStyles: {},
      };

    case 'divider':
      return {
        id:   `divider-${randomId()}`,
        type: 'divider',
        styles: {
          borderTopWidth: { value: 1, unit: 'px' },
          borderTopStyle: { value: 'solid' },
          borderTopColor: { value: el.styles?.borderTopColor?.value || '#E5E7EB' },
          marginTop:      { value: 10, unit: 'px' },
          marginRight:    { value: 0,  unit: 'px' },
          marginBottom:   { value: 20, unit: 'px' },
          marginLeft:     { value: 0,  unit: 'px' },
        },
        mobileStyles: {},
      };

    default:
      return {
        id:   `paragraph-${randomId()}`,
        type: 'paragraph',
        text: el.text || '',
        styles: {
          color:         { value: '#374151' },
          fontSize:      { value: 16, unit: 'px' },
          lineHeight:    { value: 1.6, unit: 'em' },
          textAlign:     { value: 'left' },
          marginBottom:  { value: 16, unit: 'px' },
          typography:    { value: 'var(--contentfont)' },
          linkTextColor: { value: '#374151' },
        },
        mobileStyles: { fontSize: { value: 15, unit: 'px' } },
      };
  }
}

// ── Convert AI sections → GHL hierarchical format ─────────────────────────────
// This format is used for BOTH Firebase Storage file AND Firestore sections field.

function convertSectionsToGHL(aiSections) {
  return aiSections.map((aiSection, idx) => {
    const secId = aiSection.id || `section-${randomId()}`;

    // Flatten content items from nested AI format
    const kids = aiSection.children || [];
    let contentItems = [];
    if (kids.length > 0 && kids[0].type === 'row') {
      const col = (kids[0].children || [])[0];
      contentItems = col?.children || [];
    } else {
      contentItems = kids.filter(k => !['row', 'column'].includes(k.type));
    }

    const ghlElements = contentItems.map(buildGhlElement);

    const bgColor = aiSection.styles?.backgroundColor?.value || aiSection.styles?.backgroundColor || '#FFFFFF';
    const padTop  = aiSection.styles?.paddingTop?.value  || 80;
    const padBot  = aiSection.styles?.paddingBottom?.value || 80;

    return {
      id:              secId,
      type:            'section',
      name:            aiSection.name || `section-${idx + 1}`,
      allowRowMaxWidth: false,
      styles: {
        backgroundColor: { value: bgColor },
        paddingTop:      { value: padTop, unit: 'px' },
        paddingRight:    { value: 20,     unit: 'px' },
        paddingBottom:   { value: padBot, unit: 'px' },
        paddingLeft:     { value: 20,     unit: 'px' },
      },
      mobileStyles: {
        paddingTop:    { value: Math.round(padTop / 2), unit: 'px' },
        paddingRight:  { value: 15, unit: 'px' },
        paddingBottom: { value: Math.round(padBot / 2), unit: 'px' },
        paddingLeft:   { value: 15, unit: 'px' },
      },
      children: [{
        id:   `row-${randomId()}`,
        type: 'row',
        children: [{
          id:     `column-${randomId()}`,
          type:   'column',
          width:  12,
          styles: {
            textAlign:                  { value: 'center' },
            forceColumnLayoutForMobile: { value: false },
            marginTop:                  { value: 0,      unit: 'px' },
            marginRight:                { value: 'auto', unit: ''   },
            marginBottom:               { value: 0,      unit: 'px' },
            marginLeft:                 { value: 'auto', unit: ''   },
            justifyContentColumnLayout: { value: 'flex-start' },
          },
          mobileStyles: {
            marginTop:    { value: 0,      unit: 'px' },
            marginRight:  { value: 'auto', unit: ''   },
            marginBottom: { value: 0,      unit: 'px' },
            marginLeft:   { value: 'auto', unit: ''   },
          },
          children: ghlElements,
        }],
      }],
    };
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save page sections to GHL.
 *
 * @param {string} locationId
 * @param {string} pageId
 * @param {object} sectionsJson  { sections: [...] }
 * @param {object} hints         { funnelId? }
 */
async function savePageData(locationId, pageId, sectionsJson, hints = {}) {
  const aiSections = sectionsJson?.sections || [];
  console.log(`[GHLPageBuilder] Saving page ${pageId} — ${aiSections.length} AI sections`);

  const idToken   = await getFirebaseToken(locationId);
  const projectId = getProjectIdFromToken(idToken);

  // Read Firestore for funnelId and current state
  let docInfo = { funnelId: hints.funnelId, version: 1, downloadUrl: null, versionHistory: [], updatedBy: locationId };
  try {
    const fetched = await readFirestoreDoc(idToken, projectId, pageId);
    docInfo = { ...docInfo, ...fetched };
  } catch (e) {
    if (hints.funnelId) {
      console.warn(`[GHLPageBuilder] Firestore read failed (${e.message.slice(0, 80)}), using hint funnelId: ${hints.funnelId}`);
    } else {
      throw new Error(`Cannot read Firestore doc for page ${pageId}: ${e.message} — pass funnelId in the request or reconnect Firebase.`);
    }
  }

  const { funnelId, version: currentVersion, versionHistory: existingVH } = docInfo;
  if (!funnelId) throw new Error(`Page ${pageId} missing funnelId — provide funnelId in the request or open the page in GHL builder first.`);

  // Convert AI output → GHL's native hierarchical format
  const ghlSections = convertSectionsToGHL(aiSections);
  console.log(`[GHLPageBuilder] Built ${ghlSections.length} sections (GHL hierarchical format)`);

  // Storage file — matches GHL's native AI format exactly
  const storageFile = { sections: ghlSections };

  // Upload to Firebase Storage
  const { storagePath, downloadUrl: newDownloadUrl } = await uploadToStorage(idToken, funnelId, pageId, storageFile);
  console.log(`[GHLPageBuilder] Uploaded to ${storagePath}`);

  // Build versionHistory entry
  const newVHEntry = toFirestoreValue({
    version_id:         uuidv4(),
    page_download_path: storagePath,
    page_download_url:  newDownloadUrl,
    updated_by:         docInfo.updatedBy || locationId,
    updated_at:         new Date().toISOString(),
    pageType:           'draft',
    integrations: {
      popup:           false,
      videoBackground: false,
      blogMeta: { selectedBlogCategories: [], categoryNavigationList: [] },
    },
  });
  const updatedVH = { arrayValue: { values: [newVHEntry, ...(existingVH || []).slice(0, 29)] } };

  // Update Firestore — sections use same hierarchical format as Storage
  const newVersion = (currentVersion || 1) + 1;
  const fsResult   = await patchFirestoreDoc(idToken, projectId, pageId, {
    page_data_url:          toFirestoreValue(storagePath),
    page_data_download_url: toFirestoreValue(newDownloadUrl),
    versionHistory:         updatedVH,
    sections:               toFirestoreValue(ghlSections),
    version:                toFirestoreValue(newVersion),
    date_updated:           { timestampValue: new Date().toISOString() },
  });

  console.log(`[GHLPageBuilder] Firestore updated → ${fsResult.status}`);

  if (fsResult.status >= 400) {
    const fsErr = typeof fsResult.data === 'object'
      ? (fsResult.data?.error?.message || fsResult.data?.error?.status || JSON.stringify(fsResult.data).slice(0, 300))
      : String(fsResult.raw || '').slice(0, 300);
    console.warn(`[GHLPageBuilder] Firestore PATCH failed (${fsResult.status}): ${fsErr}`);
    return {
      success:          true,
      firestoreOk:      false,
      firestoreStatus:  fsResult.status,
      firestoreError:   fsErr,
      firestoreWarning: `Firestore update failed (${fsResult.status}): ${fsErr} — page uploaded to Storage but GHL won't show it until Firestore is updated. Reconnect Firebase and regenerate.`,
      storagePath,
      downloadUrl:  newDownloadUrl,
      sections:     ghlSections.length,
      version:      newVersion,
    };
  }

  return { success: true, firestoreOk: true, storagePath, downloadUrl: newDownloadUrl, sections: ghlSections.length, version: newVersion };
}

function buildBackendHeaders(idToken) {
  return {
    'token-id':     idToken,
    'channel':      'APP',
    'source':       'WEB_USER',
    'version':      '2021-07-28',
    'Content-Type': 'application/json',
  };
}

async function getPageData(locationId, pageId) {
  const idToken = await getFirebaseToken(locationId);
  const headers = buildBackendHeaders(idToken);
  delete headers['Content-Type'];
  const path   = `/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(locationId)}`;
  const result = await httpsRequest('backend.leadconnectorhq.com', 'GET', path, headers, null);
  if (result.status >= 400) {
    const d = result.data;
    throw new Error(`GHL getPageData failed (${result.status}): ${typeof d === 'object' ? (d.message || d.error || JSON.stringify(d)) : d}`);
  }
  return result.data;
}

module.exports = { buildBackendHeaders, savePageData, getPageData };
