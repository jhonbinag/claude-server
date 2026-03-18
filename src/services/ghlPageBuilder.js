/**
 * src/services/ghlPageBuilder.js
 *
 * Saves native GHL page sections via TWO writes:
 *
 *  1. Firebase Storage — GHL's ACTUAL native format (confirmed 2026-03-19):
 *     { sections: [ { id, metaData, elements (FLAT array), sequence, pageId, funnelId, locationId, general } ] }
 *     - metaData: section-level metadata (child IDs, class, extra, styles, tagName etc.)
 *     - elements: flat array of ALL descendants (rows, columns, leaf elements) linked by child[] ID refs
 *     - general: colors, fonts, rootVars, sectionStyles CSS
 *
 *  2. Firestore funnel_pages/{pageId} — page_data_url, page_data_download_url,
 *     section_version, page_version, version, versionHistory, date_updated
 *     NOTE: GHL's editor does NOT read Firestore sections field — it reads the Storage file.
 *
 * Element tagName map: c-section, c-row, c-column, c-heading, c-paragraph, c-button, c-image
 * Meta types: "section", "row", "col", "headline", "paragraph", "button", "image"
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
    sectionVersion: parseInt(f.section_version?.integerValue || '1', 10),
    pageVersion:    parseInt(f.page_version?.integerValue || '1', 10),
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

  // Step 1: Upload the file content (simple media upload)
  const body = JSON.stringify(pageData);
  const res  = await httpsRequest(STORAGE_HOST, 'POST', uploadPath, {
    'Authorization': `Bearer ${idToken}`,
    'Content-Type':  'application/json',
  }, body);

  if (res.status >= 400) throw new Error(`Storage upload failed (${res.status}): ${String(res.raw).slice(0, 300)}`);

  // Step 2: PATCH metadata to add a download token (makes URL publicly accessible)
  // Firebase Storage doesn't auto-generate downloadTokens via REST API uploads.
  const downloadToken = res.data?.downloadTokens || uuidv4();
  if (!res.data?.downloadTokens) {
    // No token yet — patch metadata to add one
    const patchPath = `/v0/b/${STORAGE_BUCKET}/o/${encodedPath}`;
    const patchBody = JSON.stringify({ metadata: { firebaseStorageDownloadTokens: downloadToken } });
    const patchRes  = await httpsRequest(STORAGE_HOST, 'PATCH', patchPath, {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type':  'application/json',
    }, patchBody);
    if (patchRes.status >= 400) {
      console.warn(`[GHLPageBuilder] Storage metadata PATCH failed (${patchRes.status}) — URL may require auth`);
    } else {
      console.log(`[GHLPageBuilder] Storage token patched, token: ${downloadToken.slice(0, 8)}...`);
    }
  }

  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodedPath}?alt=media&token=${downloadToken}`;
  return { storagePath, downloadUrl };
}

// ── GHL Native Format Builders (confirmed 2026-03-19) ─────────────────────────
// GHL's actual Storage file format uses:
//  - metaData object at section level (child IDs, class, extra, styles, tagName)
//  - flat elements[] array with child[] ID references (not nested children)
//  - element meta types: "section","row","col","headline","paragraph","button","image"
//  - element tagNames: "c-section","c-row","c-column","c-heading","c-paragraph","c-button","c-image"

function sid() {
  return crypto.randomBytes(4).toString('hex');
}

// Default extra props shared by most elements
function defaultExtra(overrides = {}) {
  return {
    bgImage:          { value: { options: 'bgNoRepeat', url: '' } },
    desktopFontSize:  { unit: 'px', value: '16' },
    mobileFontSize:   { unit: 'px', value: '16' },
    typography:       { value: 'var(--contentfont)' },
    visibility:       { value: { hideDesktop: false, hideMobile: false } },
    ...overrides,
  };
}

function makeRow(id, colIds) {
  return {
    child: colIds,
    class: {
      alignRow:     { value: 'row-align-center' },
      borderRadius: { value: 'radius0' },
      borders:      { value: 'noBorder' },
    },
    extra: defaultExtra({ rowWidth: { unit: '%', value: 100 } }),
    id,
    meta:    'row',
    styles: {
      borderStyle:   { value: 'solid' },
      borderWidth:   { unit: 'px', value: 3 },
      marginBottom:  { unit: 'px', value: '0' },
      marginLeft:    { unit: 'px', value: '0' },
      marginRight:   { unit: 'px', value: '0' },
      marginTop:     { unit: 'px', value: '0' },
      paddingBottom: { unit: 'px', value: '0' },
      paddingLeft:   { unit: 'px', value: '15' },
      paddingRight:  { unit: 'px', value: '15' },
      paddingTop:    { unit: 'px', value: '0' },
    },
    tagName: 'c-row',
    title:   'Row',
    type:    'row',
    wrapper: {},
  };
}

function makeColumn(id, childIds, align = 'center') {
  return {
    child: childIds,
    class: { borderRadius: { value: 'radius0' }, borders: { value: 'noBorder' } },
    extra: defaultExtra(),
    id,
    meta:    'col',
    styles: {
      borderStyle:   { value: 'solid' },
      borderWidth:   { unit: 'px', value: 3 },
      paddingBottom: { unit: 'px', value: '20' },
      paddingLeft:   { unit: 'px', value: '15' },
      paddingRight:  { unit: 'px', value: '15' },
      paddingTop:    { unit: 'px', value: '20' },
      width:         { unit: '%', value: '100' },
    },
    tagName: 'c-column',
    title:   'Column',
    type:    'col',
    wrapper: {},
  };
}

// Recursively collect leaf elements from any nesting depth (section/row/column wrappers).
function flattenElements(nodes) {
  const result = [];
  for (const n of (nodes || [])) {
    if (!n) continue;
    if (n.type === 'row' || n.type === 'column' || n.type === 'section') {
      result.push(...flattenElements(n.children));
    } else {
      result.push(n);
    }
  }
  return result;
}

// Build a single leaf element in GHL native format
function buildGhlNativeElement(el, textAlign = 'center') {
  const color    = el.styles?.color?.value || '#000000';
  const btnBg    = el.styles?.backgroundColor?.value || '#1D4ED8';
  const btnColor = el.styles?.color?.value || '#FFFFFF';

  switch (el.type) {
    case 'headline':
    case 'heading': {
      const tag   = el.tag || 'h1';
      const dSize = el.styles?.fontSize?.value || (tag === 'h1' ? 48 : tag === 'h2' ? 36 : 28);
      const mSize = Math.max(dSize - 16, 22);
      const id    = `heading-${sid()}`;
      return {
        child: [],
        class: { borderRadius: { value: 'radius0' } },
        extra: {
          desktopFontSize: { unit: 'px', value: String(dSize) },
          mobileFontSize:  { unit: 'px', value: String(mSize) },
          nodeId:          `c-heading-${id}`,
          text:            { value: el.text || '' },
          typography:      { value: 'var(--headlinefont)' },
          visibility:      { value: { hideDesktop: false, hideMobile: false } },
        },
        id,
        meta:    'headline',
        styles: {
          boldTextColor: { value: color },
          color:         { value: color },
          fontWeight:    { value: 'bold' },
          lineHeight:    { value: '' },
          marginTop:     { unit: 'px', value: 0 },
          textAlign:     { value: textAlign },
        },
        tag:     tag,
        tagName: 'c-heading',
        title:   'Heading',
        type:    'element',
        wrapper: { marginTop: { unit: 'px', value: '0' }, textAlign: { value: textAlign } },
      };
    }

    case 'sub-headline':
    case 'sub-heading': {
      const fSize = el.styles?.fontSize?.value || 22;
      const id    = `heading-${sid()}`;
      return {
        child: [],
        class: { borderRadius: { value: 'radius0' } },
        extra: {
          desktopFontSize: { unit: 'px', value: String(fSize) },
          mobileFontSize:  { unit: 'px', value: String(Math.max(fSize - 4, 16)) },
          nodeId:          `c-heading-${id}`,
          text:            { value: el.text || '' },
          typography:      { value: 'var(--headlinefont)' },
          visibility:      { value: { hideDesktop: false, hideMobile: false } },
        },
        id,
        meta:    'headline',
        styles: {
          boldTextColor: { value: color },
          color:         { value: color },
          fontWeight:    { value: 'normal' },
          lineHeight:    { value: '' },
          marginTop:     { unit: 'px', value: 10 },
          textAlign:     { value: textAlign },
        },
        tag:     'h3',
        tagName: 'c-heading',
        title:   'Heading',
        type:    'element',
        wrapper: { marginTop: { unit: 'px', value: '10' }, textAlign: { value: textAlign } },
      };
    }

    case 'paragraph': {
      const fSize = el.styles?.fontSize?.value || 17;
      const id    = `paragraph-${sid()}`;
      return {
        child: [],
        class: { borderRadius: { value: 'radius0' }, borders: { value: 'noBorder' } },
        extra: {
          desktopFontSize: { unit: 'px', value: String(fSize) },
          mobileFontSize:  { unit: 'px', value: String(Math.max(fSize - 2, 14)) },
          nodeId:          `c-paragraph-${id}`,
          text:            { value: el.text || '' },
          typography:      { value: 'var(--contentfont)' },
          visibility:      { value: { hideDesktop: false, hideMobile: false } },
        },
        id,
        meta:    'paragraph',
        styles: {
          boldTextColor:   { value: color },
          color:           { value: color },
          italicTextColor: { value: color },
          lineHeight:      { value: '' },
          linkTextColor:   { value: color },
          marginTop:       { unit: 'px', value: 10 },
          textAlign:       { value: textAlign },
          underlineTextColor: { value: color },
        },
        tag:     'p',
        tagName: 'c-paragraph',
        title:   'Paragraph',
        type:    'element',
        wrapper: { marginTop: { unit: 'px', value: '10' }, textAlign: { value: textAlign } },
      };
    }

    case 'bulletList': {
      const items = (el.items || []).map(i => typeof i === 'string' ? i : (i.text || String(i)));
      const htmlList = '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
      const fSize    = el.styles?.fontSize?.value || 17;
      const id       = `paragraph-${sid()}`;
      return {
        child: [],
        class: { borderRadius: { value: 'radius0' }, borders: { value: 'noBorder' } },
        extra: {
          desktopFontSize: { unit: 'px', value: String(fSize) },
          mobileFontSize:  { unit: 'px', value: String(Math.max(fSize - 2, 14)) },
          nodeId:          `c-paragraph-${id}`,
          text:            { value: htmlList },
          typography:      { value: 'var(--contentfont)' },
          visibility:      { value: { hideDesktop: false, hideMobile: false } },
        },
        id,
        meta:    'paragraph',
        styles: {
          boldTextColor: { value: color },
          color:         { value: color },
          lineHeight:    { value: '' },
          marginTop:     { unit: 'px', value: 10 },
          textAlign:     { value: 'left' },
        },
        tag:     'p',
        tagName: 'c-paragraph',
        title:   'Paragraph',
        type:    'element',
        wrapper: { marginTop: { unit: 'px', value: '10' }, textAlign: { value: 'left' } },
      };
    }

    case 'button': {
      const fSize = el.styles?.fontSize?.value || 18;
      const id    = `button-${sid()}`;
      return {
        child: [],
        class: {
          borderRadius:  { value: 'radius125' },
          borders:       { value: 'borderFull' },
          buttonHp:      { value: 'btn-hp-40' },
        },
        extra: {
          action:          { value: 'scroll' },
          desktopFontSize: { unit: 'px', value: String(fSize) },
          iconEnd:         { value: { fontFamily: '', name: '', unicode: '' } },
          iconStart:       { value: { fontFamily: '', name: '', unicode: '' } },
          mobileFontSize:  { unit: 'px', value: String(Math.max(fSize - 2, 14)) },
          nodeId:          `c-button-${id}`,
          subText:         { value: '' },
          text:            { value: el.text || 'Get Started' },
          typography:      { value: 'var(--contentfont)' },
          visibility:      { value: { hideDesktop: false, hideMobile: false } },
        },
        id,
        meta:    'button',
        styles: {
          backgroundColor: { value: btnBg    },
          boldTextColor:   { value: btnColor },
          color:           { value: btnColor },
          fontWeight:      { value: 'bold' },
          lineHeight:      { value: '' },
          marginTop:       { unit: 'px', value: 20 },
          paddingBottom:   { unit: 'px', value: '14' },
          paddingLeft:     { unit: 'px', value: '35' },
          paddingRight:    { unit: 'px', value: '35' },
          paddingTop:      { unit: 'px', value: '14' },
          textAlign:       { value: 'center' },
          textTransform:   { value: 'none' },
        },
        tag:     '',
        tagName: 'c-button',
        title:   'button',
        type:    'element',
        wrapper: { marginTop: { unit: 'px', value: '20' }, textAlign: { value: 'center' } },
      };
    }

    case 'image': {
      const id = `image-${sid()}`;
      return {
        child: [],
        class: { borderRadius: { value: 'radius0' } },
        extra: {
          desktopFontSize: { unit: 'px', value: '16' },
          imageProperties: { value: { altText: el.alt || '', url: el.src || '', width: '100%' } },
          mobileFontSize:  { unit: 'px', value: '16' },
          nodeId:          `c-image-${id}`,
          typography:      { value: 'var(--contentfont)' },
          visibility:      { value: { hideDesktop: false, hideMobile: false } },
        },
        id,
        meta:    'image',
        styles: {
          color:     { value: '#000000' },
          marginTop: { unit: 'px', value: 0 },
          textAlign: { value: 'center' },
        },
        tag:     '',
        tagName: 'c-image',
        title:   'image',
        type:    'element',
        wrapper: { marginTop: { unit: 'px', value: '0' }, textAlign: { value: 'center' } },
      };
    }

    default: {
      // Fallback: render as paragraph
      const id = `paragraph-${sid()}`;
      return {
        child: [],
        class: { borderRadius: { value: 'radius0' }, borders: { value: 'noBorder' } },
        extra: {
          desktopFontSize: { unit: 'px', value: '16' },
          mobileFontSize:  { unit: 'px', value: '15' },
          nodeId:          `c-paragraph-${id}`,
          text:            { value: el.text || '' },
          typography:      { value: 'var(--contentfont)' },
          visibility:      { value: { hideDesktop: false, hideMobile: false } },
        },
        id,
        meta:    'paragraph',
        styles: {
          color:     { value: '#374151' },
          lineHeight:{ value: '' },
          marginTop: { unit: 'px', value: 10 },
          textAlign: { value: 'left' },
        },
        tag:     'p',
        tagName: 'c-paragraph',
        title:   'Paragraph',
        type:    'element',
        wrapper: { marginTop: { unit: 'px', value: '10' }, textAlign: { value: 'left' } },
      };
    }
  }
}

/**
 * Convert AI sections to GHL's ACTUAL native Storage format.
 * Each section becomes: { id, metaData, elements (flat), sequence, pageId, funnelId, locationId, general }
 */
function convertSectionsToGHL(aiSections, pageId = '', funnelId = '', locationId = '') {
  return aiSections.map((aiSection, idx) => {
    const secId    = `section-${sid()}`;
    const rowId    = `row-${sid()}`;
    const colId    = `col-${sid()}`;
    const bgColor  = aiSection.styles?.backgroundColor?.value || (idx === 0 ? '#ffffff' : idx === 1 ? '#f9fafb' : '#1e3a5f');
    const padTop   = String(aiSection.styles?.paddingTop?.value    || 80);
    const padBot   = String(aiSection.styles?.paddingBottom?.value || 80);
    const textAlign = idx === 1 ? 'left' : 'center'; // benefits section left-align

    // Extract leaf elements from AI section (regardless of nesting)
    const leafElems  = flattenElements(aiSection.children || []);
    console.log(`[GHLPageBuilder] Section ${idx + 1} (${aiSection.name || ''}): ${leafElems.length} elements (${leafElems.map(e => e.type).join(', ')})`);

    // Build GHL native leaf elements
    const nativeElems = leafElems.map(e => buildGhlNativeElement(e, textAlign));
    const leafIds     = nativeElems.map(e => e.id);

    // Build column and row
    const col = makeColumn(colId, leafIds, textAlign);
    const row = makeRow(rowId, [colId]);

    // Section metaData
    const metaData = {
      child:   [rowId],
      class:   { borderRadius: { value: 'radius0' }, borders: { value: 'noBorder' } },
      extra:   defaultExtra(),
      id:      secId,
      meta:    'section',
      styles:  {
        backgroundColor: { value: bgColor },
        borderStyle:     { value: 'solid' },
        borderWidth:     { unit: 'px', value: 3 },
        paddingBottom:   { unit: 'px', value: padBot },
        paddingTop:      { unit: 'px', value: padTop },
      },
      tagName: 'c-section',
      title:   aiSection.name || `Section ${idx + 1}`,
      type:    'section',
      wrapper: {},
      _id:     secId,
    };

    return {
      id:          secId,
      metaData,
      elements:    [row, col, ...nativeElems],
      sequence:    idx,
      pageId:      pageId  || '',
      funnelId:    funnelId  || '',
      locationId:  locationId || '',
      general: {
        colors:          [{ value: '#000000', label: 'Black' }],
        fontsForPreview: [],
        rootVars:        {},
        sectionStyles:   '',
      },
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

  const { funnelId, version: currentVersion, sectionVersion: currentSV, pageVersion: currentPV, versionHistory: existingVH } = docInfo;
  if (!funnelId) throw new Error(`Page ${pageId} missing funnelId — provide funnelId in the request or open the page in GHL builder first.`);

  // Convert AI output → GHL's ACTUAL native Storage format (metaData + flat elements[])
  const allSections = convertSectionsToGHL(aiSections, pageId, funnelId, locationId);
  // Drop sections with no elements (elements[] has only row+col with no leaves)
  const ghlSections = allSections.filter(s => s.elements && s.elements.length > 2); // row + col + at least 1 leaf
  if (allSections.length !== ghlSections.length) {
    console.warn(`[GHLPageBuilder] Dropped ${allSections.length - ghlSections.length} empty section(s)`);
  }
  console.log(`[GHLPageBuilder] Built ${ghlSections.length} sections in GHL native format`);

  // Also normalize AI sections for Firestore `sections` field (regular editor reads this directly).
  // The regular funnel editor reads the `sections` array from the GHL backend API (not Storage).
  // We write sections in GHL's old nested-children format with normalized element type names.
  function normalizeTypeNames(nodes) {
    return (nodes || []).map(n => {
      const typeMap = { heading: 'headline', 'sub-heading': 'sub-headline' };
      const out = { ...n, type: typeMap[n.type] || n.type };
      if (Array.isArray(n.children)) out.children = normalizeTypeNames(n.children);
      return out;
    });
  }
  const firestoreSections = normalizeTypeNames(aiSections);

  // Storage file — GHL native format: { sections: [{ id, metaData, elements, sequence, pageId, funnelId, locationId, general }] }
  const storageFile = { sections: ghlSections };
  const firstLeaf = ghlSections[0]?.elements?.find(e => e.type === 'element');
  console.log(`[GHLPageBuilder] First leaf element sample: ${JSON.stringify(firstLeaf).slice(0, 200)}`);

  // Upload to Firebase Storage
  const { storagePath, downloadUrl: newDownloadUrl } = await uploadToStorage(idToken, funnelId, pageId, storageFile);
  console.log(`[GHLPageBuilder] Uploaded to ${storagePath}, downloadUrl present: ${!!newDownloadUrl}`);

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

  // Update Firestore — sections (nested format for regular editor) + URL fields + version counters.
  // The regular funnel editor reads `sections` from GHL's backend API (Firestore-backed).
  // The AI editor reads from Storage via page_data_download_url.
  // We write both so either editor path shows the generated content.
  const newVersion   = (currentVersion || 1) + 1;
  const newSV        = (currentSV || 1) + 1;
  const newPV        = (currentPV || 1) + 1;
  const fsResult     = await patchFirestoreDoc(idToken, projectId, pageId, {
    sections:               toFirestoreValue(firestoreSections),
    page_data_url:          toFirestoreValue(storagePath),
    page_data_download_url: toFirestoreValue(newDownloadUrl),
    versionHistory:         updatedVH,
    version:                toFirestoreValue(newVersion),
    section_version:        toFirestoreValue(newSV),
    page_version:           toFirestoreValue(newPV),
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

  return { success: true, firestoreOk: true, storagePath, downloadUrl: newDownloadUrl, sections: ghlSections.length, version: newVersion, sectionVersion: newSV, pageVersion: newPV };
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

module.exports = { buildBackendHeaders, savePageData, getPageData, convertSectionsToGHL };
