/**
 * src/services/ghlPageBuilder.js
 *
 * Saves native GHL page sections by:
 *  1. Reading the page's current Firestore doc to get funnelId, version, downloadUrl
 *  2. Downloading the current page data JSON from Firebase Storage
 *  3. Converting our AI-generated sections to GHL's real Firebase Storage format
 *  4. Uploading the new JSON to Firebase Storage
 *  5. Updating the Firestore document with the new storage URL
 *
 * Discovery: GHL stores page content in Firebase Storage (not Firestore fields).
 * Firestore only holds metadata: funnel_id, page_data_url, page_data_download_url, version, etc.
 * The builder reads the JSON from Firebase Storage to render elements.
 */

const https   = require('https');
const crypto  = require('crypto');
const { getFirebaseToken } = require('./ghlFirebaseService');

const BACKEND_HOST   = 'backend.leadconnectorhq.com';
const FIRESTORE_HOST = 'firestore.googleapis.com';
const STORAGE_HOST   = 'firebasestorage.googleapis.com';
const STORAGE_BUCKET = 'highlevel-backend.appspot.com';

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

// ── Firestore helpers ─────────────────────────────────────────────────────────

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

async function readFirestoreDoc(idToken, projectId, pageId) {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/funnel_pages/${pageId}`;
  const res  = await httpsRequest(FIRESTORE_HOST, 'GET', path, { 'Authorization': `Bearer ${idToken}` }, null);
  if (res.status >= 400) throw new Error(`Firestore GET failed (${res.status}): ${res.raw.slice(0, 200)}`);
  const f = res.data.fields || {};
  return {
    funnelId:          f.funnel_id?.stringValue,
    locationId:        f.location_id?.stringValue,
    version:           parseInt(f.version?.integerValue || '1', 10),
    downloadUrl:       f.page_data_download_url?.stringValue,
    settings:          null, // read from storage file
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

  console.log(`[GHLPageBuilder] Storage upload ${storagePath} → ${res.status}`);
  if (res.status >= 400) throw new Error(`Storage upload failed (${res.status}): ${String(res.raw).slice(0, 300)}`);

  const downloadToken = res.data.downloadTokens;
  const downloadUrl   = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodedPath}?alt=media&token=${downloadToken}`;

  return { storagePath, downloadUrl };
}

// ── GHL page data format builders ─────────────────────────────────────────────

const DEFAULT_EXTRA_BG = { value: { mediaType: 'image', url: '', opacity: '1', options: 'bgCover', svgCode: '', videoUrl: '', videoThumbnail: '', videoLoop: true } };
const DEFAULT_VISIBILITY = { value: { hideDesktop: false, hideMobile: false } };
const DEFAULT_CLASS_BASE = { borders: { value: 'noBorder' }, borderRadius: { value: 'radius0' }, radiusEdge: { value: 'none' } };

function buildRow(rowId, colIds) {
  return {
    id: rowId, type: 'row',
    child: colIds,
    class: { alignRow: { value: 'row-align-center' }, ...DEFAULT_CLASS_BASE },
    styles: {
      boxShadow: { value: 'none' },
      paddingLeft: { value: 20, unit: 'px' }, paddingRight: { value: 20, unit: 'px' },
      paddingTop: { value: 10, unit: 'px' }, paddingBottom: { value: 10, unit: 'px' },
      backgroundColor: { value: 'var(--transparent)' }, background: { value: 'none' },
      backdropFilter: { value: 'none' },
      borderColor: { value: 'var(--black)' }, borderWidth: { value: '0', unit: 'px' }, borderStyle: { value: 'solid' },
    },
    extra: { visibility: DEFAULT_VISIBILITY, bgImage: DEFAULT_EXTRA_BG, rowWidth: { value: 1170, unit: 'px' }, customClass: { value: [] } },
    wrapper: { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 }, marginLeft: { unit: '', value: 'auto' }, marginRight: { unit: '', value: 'auto' } },
    tagName: 'c-row', meta: 'row', mobileStyles: {}, mobileWrapper: {}, title: '1 Column Row',
  };
}

function buildCol(colId, childIds) {
  return {
    id: colId, type: 'col',
    child: childIds,
    class: DEFAULT_CLASS_BASE,
    styles: {
      boxShadow: { value: 'none' },
      paddingLeft: { value: 15, unit: 'px' }, paddingRight: { value: 15, unit: 'px' },
      paddingTop: { value: 10, unit: 'px' }, paddingBottom: { value: 10, unit: 'px' },
      backgroundColor: { value: 'var(--transparent)' }, background: { value: 'none' },
      backdropFilter: { value: 'none' }, width: { value: 100, unit: '%' },
      borderColor: { value: 'var(--black)' }, borderWidth: { value: '0', unit: 'px' }, borderStyle: { value: 'solid' },
    },
    extra: {
      visibility: DEFAULT_VISIBILITY, bgImage: DEFAULT_EXTRA_BG,
      columnLayout: { value: 'column' }, justifyContentColumnLayout: { value: 'center' },
      alignContentColumnLayout: { value: 'inherit' }, forceColumnLayoutForMobile: { value: true },
      customClass: { value: [] }, elementVersion: { value: 2 },
    },
    wrapper: { marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 }, marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 } },
    tagName: 'c-column', meta: 'col', mobileStyles: {}, mobileWrapper: {}, title: '1st Column', noOfColumns: 1,
  };
}

function buildHeadline(id, text, tag = 'h1', styles = {}) {
  return {
    id, type: 'headline', child: [],
    class: { textAlign: { value: styles.textAlign || 'center' }, ...DEFAULT_CLASS_BASE },
    styles: {
      fontSize: { value: styles.fontSize || 48, unit: 'px' },
      fontWeight: { value: styles.fontWeight || '700' },
      color: { value: styles.color || 'var(--black)' },
      lineHeight: { value: styles.lineHeight || 1.2 },
      letterSpacing: { value: 0, unit: 'px' },
    },
    extra: {
      visibility: DEFAULT_VISIBILITY, customClass: { value: [] },
      content: { value: text },
      tag: { value: tag },
      link: { value: { type: 'none', value: '', target: '_self' } },
    },
    wrapper: { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 20 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 } },
    tagName: 'c-heading', meta: 'headline', title: 'Headline', mobileStyles: { fontSize: { value: Math.round((styles.fontSize || 48) * 0.6), unit: 'px' } }, mobileWrapper: {},
  };
}

function buildSubHeadline(id, text, styles = {}) {
  return {
    id, type: 'sub-headline', child: [],
    class: { textAlign: { value: 'center' }, ...DEFAULT_CLASS_BASE },
    styles: {
      fontSize: { value: styles.fontSize || 22, unit: 'px' },
      fontWeight: { value: styles.fontWeight || '500' },
      color: { value: styles.color || 'var(--black)' },
      lineHeight: { value: 1.4 },
    },
    extra: {
      visibility: DEFAULT_VISIBILITY, customClass: { value: [] },
      content: { value: text },
      link: { value: { type: 'none', value: '', target: '_self' } },
    },
    wrapper: { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 15 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 } },
    tagName: 'c-heading', meta: 'sub-headline', title: 'Sub Headline', mobileStyles: { fontSize: { value: Math.round((styles.fontSize || 22) * 0.8), unit: 'px' } }, mobileWrapper: {},
  };
}

function buildParagraph(id, htmlText, styles = {}) {
  // Ensure it's wrapped in <p> tags
  const content = htmlText.startsWith('<') ? htmlText : `<p>${htmlText}</p>`;
  return {
    id, type: 'paragraph', child: [],
    class: {},
    styles: {
      fontSize: { value: styles.fontSize || 16, unit: 'px' },
      color: { value: styles.color || 'var(--black)' },
      lineHeight: { value: styles.lineHeight || 1.7 },
    },
    extra: {
      visibility: DEFAULT_VISIBILITY, customClass: { value: [] },
      content: { value: content },
    },
    wrapper: { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 15 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 } },
    tagName: 'c-text', meta: 'paragraph', title: 'Paragraph', mobileStyles: {}, mobileWrapper: {},
  };
}

function buildButton(id, text, link = '#', styles = {}) {
  return {
    id, type: 'button', child: [],
    class: { align: { value: 'center' }, ...DEFAULT_CLASS_BASE },
    styles: {
      fontSize: { value: styles.fontSize || 16, unit: 'px' },
      fontWeight: { value: '700' },
      color: { value: styles.color || 'var(--white)' },
      backgroundColor: { value: styles.backgroundColor || 'var(--primary)' },
      paddingTop: { value: 14, unit: 'px' }, paddingBottom: { value: 14, unit: 'px' },
      paddingLeft: { value: 32, unit: 'px' }, paddingRight: { value: 32, unit: 'px' },
      borderRadius: { value: 6, unit: 'px' },
      borderWidth: { value: '0', unit: 'px' }, borderStyle: { value: 'solid' }, borderColor: { value: 'var(--black)' },
    },
    extra: {
      visibility: DEFAULT_VISIBILITY, customClass: { value: [] },
      content: { value: text },
      link: { value: { type: 'url', value: link, target: '_self' } },
    },
    wrapper: { marginTop: { unit: 'px', value: 10 }, marginBottom: { unit: 'px', value: 10 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 } },
    tagName: 'c-button', meta: 'button', title: 'Button', mobileStyles: {}, mobileWrapper: {},
  };
}

function buildBulletList(id, items, styles = {}) {
  const listContent = items.map(item => `<li>${item.text || item}</li>`).join('');
  return {
    id, type: 'list', child: [],
    class: {},
    styles: {
      fontSize: { value: styles.fontSize || 16, unit: 'px' },
      color: { value: styles.color || 'var(--black)' },
      lineHeight: { value: 1.7 },
    },
    extra: {
      visibility: DEFAULT_VISIBILITY, customClass: { value: [] },
      content: { value: `<ul>${listContent}</ul>` },
    },
    wrapper: { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 15 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 } },
    tagName: 'c-list', meta: 'list', title: 'List', mobileStyles: {}, mobileWrapper: {},
  };
}

/**
 * Convert our simple AI-generated section format to GHL's Firebase Storage format.
 *
 * Our format:
 *   { type: "section", children: [{ type: "row", children: [{ type: "column", children: [elements] }] }] }
 * OR flattened:
 *   { type: "section", styles, children: [ { type: "headline", text: "..." }, { type: "button", text: "...", link: "..." } ] }
 *
 * GHL format: section has metaData + flat elements array with ID references
 */
function convertSectionsToGhl(aiSections, pageId, funnelId, locationId) {
  const ghlSections = [];

  aiSections.forEach((aiSection, sectionIdx) => {
    const secId  = aiSection.id || `section-${randomId()}`;
    const rowId  = `row-${randomId()}`;
    const colId  = `col-${randomId()}`;

    // Gather content elements from AI section
    // AI may nest them under children[row][column] or directly in section.children
    let contentItems = [];
    const kids = aiSection.children || [];

    if (kids.length > 0 && kids[0].type === 'row') {
      // Nested structure
      const row = kids[0];
      const col = (row.children || [])[0];
      contentItems = (col?.children || []);
    } else {
      // Flat structure — direct children are the content elements
      contentItems = kids.filter(k => !['row', 'column'].includes(k.type));
    }

    // Build GHL content elements
    const ghlElements = [];
    const contentIds  = [];

    contentItems.forEach(el => {
      const elId = el.id || `${el.type}-${randomId()}`;
      let ghlEl;

      switch (el.type) {
        case 'headline':
          ghlEl = buildHeadline(elId, el.text || '', el.tag || 'h1', el.styles || {});
          break;
        case 'sub-headline':
          ghlEl = buildSubHeadline(elId, el.text || '', el.styles || {});
          break;
        case 'paragraph':
          ghlEl = buildParagraph(elId, el.text || '', el.styles || {});
          break;
        case 'button':
          ghlEl = buildButton(elId, el.text || 'Click Here', el.link || '#', el.styles || {});
          break;
        case 'bulletList':
          ghlEl = buildBulletList(elId, el.items || [], el.styles || {});
          break;
        default:
          // Unknown type — wrap as paragraph
          ghlEl = buildParagraph(elId, el.text || JSON.stringify(el).slice(0, 100));
      }

      ghlElements.push(ghlEl);
      contentIds.push(elId);
    });

    // Build section background color
    const bgColor = aiSection.styles?.backgroundColor?.value || '#ffffff';

    const ghlSection = {
      id: secId,
      metaData: {
        id: secId,
        type: 'section',
        child: [rowId],
        class: {
          width: { value: 'fullSection' },
          borders: { value: 'noBorder' },
          borderRadius: { value: 'radius0' },
          radiusEdge: { value: 'none' },
        },
        styles: {
          boxShadow: { value: 'none' },
          paddingLeft: { unit: 'px', value: 0 },
          paddingRight: { value: 0, unit: 'px' },
          paddingBottom: { unit: 'px', value: aiSection.styles?.paddingBottom?.value || 60 },
          paddingTop: { unit: 'px', value: aiSection.styles?.paddingTop?.value || 60 },
          marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 },
          marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 },
          backgroundColor: { value: bgColor },
          background: { value: 'none' }, backdropFilter: { value: 'none' },
          borderColor: { value: 'var(--black)' }, borderWidth: { value: '0', unit: 'px' }, borderStyle: { value: 'solid' },
        },
        extra: {
          sticky: { value: 'noneSticky' },
          visibility: DEFAULT_VISIBILITY,
          bgImage: DEFAULT_EXTRA_BG,
          allowRowMaxWidth: { value: false },
          customClass: { value: [] },
          elementScreenshot: { value: [] },
        },
        wrapper: {},
        meta: 'section',
        tagName: 'c-section',
        title: aiSection.name || `Section ${sectionIdx + 1}`,
        mobileStyles: {},
        mobileWrapper: {},
      },
      elements: [
        buildRow(rowId, [colId]),
        buildCol(colId, contentIds),
        ...ghlElements,
      ],
      sequence: sectionIdx,
      pageId,
      funnelId,
      locationId,
      general: {
        colors: [
          { label: 'Transparent', value: 'transparent' },
          { label: 'Black', value: '#000000' },
        ],
        fontsForPreview: [],
        rootVars: { '--transparent': 'transparent', '--black': '#000000' },
        sectionStyles: '',
        customFonts: [],
      },
    };

    ghlSections.push(ghlSection);
  });

  return ghlSections;
}

// ── Backend metadata update ───────────────────────────────────────────────────

function buildBackendHeaders(idToken) {
  return {
    'token-id':     idToken,
    'channel':      'APP',
    'source':       'WEB_USER',
    'version':      '2021-07-28',
    'Content-Type': 'application/json',
  };
}

async function updateBackendMetadata(locationId, pageId, sectionsJson) {
  let idToken = await getFirebaseToken(locationId);
  const path  = `/funnels/funnel/funnel-page/${pageId}`;
  let result  = await httpsRequest(BACKEND_HOST, 'POST', path, buildBackendHeaders(idToken), JSON.stringify(sectionsJson));
  if (result.status === 401) {
    idToken = await getFirebaseToken(locationId);
    result  = await httpsRequest(BACKEND_HOST, 'POST', path, buildBackendHeaders(idToken), JSON.stringify(sectionsJson));
  }
  console.log(`[GHLPageBuilder] Backend metadata POST ${pageId} → ${result.status}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save page sections to GHL by uploading to Firebase Storage.
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

  // 1. Read Firestore doc to get funnelId, version, and existing download URL
  let docInfo;
  try {
    docInfo = await readFirestoreDoc(idToken, projectId, pageId);
  } catch (e) {
    throw new Error(`Cannot read Firestore doc for page ${pageId}: ${e.message}`);
  }

  const { funnelId, version: currentVersion, downloadUrl: currentDownloadUrl } = docInfo;
  if (!funnelId) throw new Error(`Page ${pageId} Firestore doc missing funnelId — page may not be initialized yet. Open it in GHL builder (Create from Blank) first.`);

  // 2. Download current page data to preserve settings/general
  let currentPageData = null;
  if (currentDownloadUrl) {
    try { currentPageData = await downloadStorageFile(currentDownloadUrl); }
    catch (e) { console.warn(`[GHLPageBuilder] Could not download current page data: ${e.message}`); }
  }

  // 3. Convert AI sections to GHL format
  const ghlSections = convertSectionsToGhl(aiSections, pageId, funnelId, locationId);
  console.log(`[GHLPageBuilder] Converted to ${ghlSections.length} GHL sections`);

  // 4. Build new page data (merge with existing settings)
  const newPageData = {
    sections: ghlSections,
    settings: currentPageData?.settings || {},
    general:  currentPageData?.general  || {},
  };

  // 5. Upload to Firebase Storage
  const { storagePath, downloadUrl: newDownloadUrl } = await uploadToStorage(idToken, funnelId, pageId, newPageData);
  console.log(`[GHLPageBuilder] Uploaded to ${storagePath}`);

  // 6. Update Firestore with new URL and incremented version
  const newVersion = (currentVersion || 1) + 1;
  const fsFields   = {
    page_data_url:          toFirestoreValue(storagePath),
    page_data_download_url: toFirestoreValue(newDownloadUrl),
    version:                toFirestoreValue(newVersion),
    date_updated:           { timestampValue: new Date().toISOString() },
  };

  const fsResult = await patchFirestoreDoc(idToken, projectId, pageId, fsFields);
  console.log(`[GHLPageBuilder] Firestore metadata updated → ${fsResult.status}`);

  if (fsResult.status >= 400) {
    throw new Error(`Firestore update failed (${fsResult.status}): ${String(fsResult.raw).slice(0, 200)}`);
  }

  // 7. Also update backend metadata (non-fatal)
  try { await updateBackendMetadata(locationId, pageId, sectionsJson); } catch (e) {
    console.warn(`[GHLPageBuilder] Backend metadata update failed (non-fatal): ${e.message}`);
  }

  return { success: true, storagePath, downloadUrl: newDownloadUrl, sections: ghlSections.length };
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
