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

// ── Color utilities ───────────────────────────────────────────────────────────

/**
 * Parse a colorScheme string (e.g. "dark navy (#0F172A) background with gold (#F59E0B) accents")
 * and return structured colors for section backgrounds, buttons, and pageStyles CSS vars.
 */
function extractColors(colorScheme) {
  const str = colorScheme || '';
  const hexes = [...str.matchAll(/#([0-9A-Fa-f]{6})\b/g)].map(m => '#' + m[1].toUpperCase());

  const luminance = h => {
    const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
    return r * 0.299 + g * 0.587 + b * 0.114;
  };
  const isDark = h => luminance(h) < 160;

  const lc = str.toLowerCase();
  const hasWhiteBg = lc.includes('white background') || lc.includes('clean white') || lc.includes('on white');

  let heroBg, primary, bodyText, sectionBg;

  if (hexes.length === 0) {
    heroBg = '#0F172A'; primary = '#1D4ED8'; bodyText = '#111827'; sectionBg = '#F9FAFB';
  } else if (hasWhiteBg) {
    heroBg   = '#FFFFFF';
    primary  = hexes[0];
    bodyText = '#111827';
    sectionBg = '#F9FAFB';
  } else if (isDark(hexes[0])) {
    heroBg   = hexes[0];
    primary  = hexes[1] || '#F59E0B';
    bodyText = '#111827';  // always dark for light content sections
    sectionBg = '#F9FAFB';
  } else {
    heroBg   = '#0F172A';
    primary  = hexes[0];
    bodyText = '#111827';
    sectionBg = '#F9FAFB';
  }

  const ctaBg       = isDark(heroBg) ? heroBg : (hexes.find(isDark) || '#0F172A');
  const heroText    = isDark(heroBg) ? '#FFFFFF' : '#111827';
  const buttonColor = isDark(primary) ? '#FFFFFF' : '#111827';

  return { heroBg, primary, bodyText, sectionBg, ctaBg, heroText, buttonColor };
}

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

let _placeholderN = 0;
function nextPlaceholderImg(w = 800, h = 500) {
  _placeholderN += 1;
  return `https://picsum.photos/seed/${_placeholderN}ph/${w}/${h}`;
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

function makeColumn(id, childIds, align = 'center', widthPct = 100) {
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
      width:         { unit: '%', value: String(widthPct) },
    },
    tagName: 'c-column',
    title:   'Column',
    type:    'col',
    wrapper: {},
  };
}

function makeCardColumn(id, childIds, align = 'center', widthPct = 32) {
  return {
    child: childIds,
    class: {
      borderRadius: { value: 'radius10' },
      borders:      { value: 'noBorder' },
      boxShadow:    { value: 'medium' },
    },
    extra: defaultExtra(),
    id,
    meta:    'col',
    styles: {
      backgroundColor: { value: '#ffffff' },
      borderStyle:     { value: 'solid' },
      borderWidth:     { unit: 'px', value: 0 },
      paddingBottom:   { unit: 'px', value: '40' },
      paddingLeft:     { unit: 'px', value: '28' },
      paddingRight:    { unit: 'px', value: '28' },
      paddingTop:      { unit: 'px', value: '40' },
      width:           { unit: '%', value: String(widthPct) },
    },
    tagName: 'c-column',
    title:   'Column',
    type:    'col',
    wrapper: {},
  };
}

// Recursively collect leaf elements from any nesting depth (section/row/column wrappers).
// Also handles: n.elements (alternative field name), and direct leaf children without row/column.
function flattenElements(nodes) {
  const result = [];
  for (const n of (nodes || [])) {
    if (!n || typeof n !== 'object') continue;
    const children = n.children || n.elements || [];
    if (n.type === 'row' || n.type === 'column' || n.type === 'section') {
      result.push(...flattenElements(children));
    } else if (Array.isArray(children) && children.length > 0 && !n.text && !n.items && !n.src) {
      // Node has nested children but isn't a known wrapper type — recurse into it too
      result.push(...flattenElements(children));
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
          text:            { value: el.text || el.value || '' },
          typography:      { value: 'var(--headlinefont)' },
          visibility:      { value: { hideDesktop: false, hideMobile: false } },
        },
        id,
        meta:    'heading',
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
        title:   'headline',
        type:    'element',
        wrapper: { marginTop: { unit: 'px', value: '0' }, textAlign: { value: textAlign } },
      };
    }

    case 'sub-headline':
    case 'sub-heading': {
      const fSize = el.styles?.fontSize?.value || 22;
      const id    = `sub-heading-${sid()}`;
      return {
        child: [],
        class: { borderRadius: { value: 'radius0' } },
        extra: {
          desktopFontSize: { unit: 'px', value: String(fSize) },
          mobileFontSize:  { unit: 'px', value: String(Math.max(fSize - 4, 16)) },
          nodeId:          `c-sub-heading-${id}`,
          text:            { value: el.text || el.value || '' },
          typography:      { value: 'var(--headlinefont)' },
          visibility:      { value: { hideDesktop: false, hideMobile: false } },
        },
        id,
        meta:    'sub-heading',
        styles: {
          boldTextColor: { value: color },
          color:         { value: color },
          fontWeight:    { value: 'normal' },
          lineHeight:    { value: '' },
          marginTop:     { unit: 'px', value: 10 },
          textAlign:     { value: textAlign },
        },
        tag:     'h3',
        tagName: 'c-sub-heading',
        title:   'sub-headline',
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
          text:            { value: el.text || el.value || '' },
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
      const rawItems = el.items || (el.children || []).map(c => c.text || c.value || String(c));
      const items = rawItems.map(i => typeof i === 'string' ? i : (i.text || i.value || String(i)));
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
          text:            { value: el.text || el.value || 'Get Started' },
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
          imageProperties: { value: { altText: el.alt || '', url: (!el.src || el.src === 'placeholder') ? nextPlaceholderImg() : el.src, width: '100%' } },
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

    case 'orderForm': {
      const id = `order-form-${sid()}`;
      return {
        child: [], class: {},
        extra: { nodeId: `c-order-form-${id}`, visibility: { value: { hideDesktop: false, hideMobile: false } } },
        id, meta: 'order-form',
        styles: { marginTop: { unit: 'px', value: 20 } },
        tag: '', tagName: 'c-order-form', title: 'Order Form', type: 'element',
        wrapper: { marginTop: { unit: 'px', value: '20' }, textAlign: { value: 'center' } },
      };
    }

    case 'orderConfirmation': {
      const id = `order-confirmation-${sid()}`;
      return {
        child: [], class: {},
        extra: { nodeId: `c-order-confirmation-${id}`, visibility: { value: { hideDesktop: false, hideMobile: false } } },
        id, meta: 'order-confirmation',
        styles: { marginTop: { unit: 'px', value: 20 } },
        tag: '', tagName: 'c-order-confirmation', title: 'Order Confirmation', type: 'element',
        wrapper: { marginTop: { unit: 'px', value: '20' }, textAlign: { value: 'center' } },
      };
    }

    case 'form': {
      const id = `form-${sid()}`;
      return {
        child: [], class: {},
        extra: { nodeId: `c-form-${id}`, visibility: { value: { hideDesktop: false, hideMobile: false } } },
        id, meta: 'form',
        styles: { marginTop: { unit: 'px', value: 20 } },
        tag: '', tagName: 'c-form', title: 'Form', type: 'element',
        wrapper: { marginTop: { unit: 'px', value: '20' }, textAlign: { value: 'center' } },
      };
    }

    case 'video': {
      const id = `video-${sid()}`;
      return {
        child: [], class: {},
        extra: {
          desktopFontSize: { unit: 'px', value: '16' },
          mobileFontSize:  { unit: 'px', value: '16' },
          nodeId: `c-video-${id}`,
          videoProperties: { value: { url: el.src || '', autoplay: false, loop: false, muted: false, controls: true, type: 'youtube' } },
          visibility: { value: { hideDesktop: false, hideMobile: false } },
        },
        id, meta: 'video',
        styles: { marginTop: { unit: 'px', value: 20 }, textAlign: { value: 'center' } },
        tag: '', tagName: 'c-video', title: 'Video', type: 'element',
        wrapper: { marginTop: { unit: 'px', value: '20' }, textAlign: { value: 'center' } },
      };
    }

    case 'textLink': {
      const fSize = el.styles?.fontSize?.value || 14;
      const id    = `paragraph-${sid()}`;
      const linkHtml = el.link
        ? `<a href="${el.link}" style="color:#9CA3AF;text-decoration:underline;">${el.text || 'No thanks'}</a>`
        : el.text || 'No thanks';
      return {
        child: [], class: { borderRadius: { value: 'radius0' }, borders: { value: 'noBorder' } },
        extra: {
          desktopFontSize: { unit: 'px', value: String(fSize) },
          mobileFontSize:  { unit: 'px', value: String(Math.max(fSize - 2, 12)) },
          nodeId:   `c-paragraph-${id}`,
          text:     { value: linkHtml },
          typography: { value: 'var(--contentfont)' },
          visibility: { value: { hideDesktop: false, hideMobile: false } },
        },
        id, meta: 'paragraph',
        styles: {
          color:     { value: '#9CA3AF' },
          lineHeight:{ value: '' },
          marginTop: { unit: 'px', value: 16 },
          textAlign: { value: 'center' },
        },
        tag: 'p', tagName: 'c-paragraph', title: 'Paragraph', type: 'element',
        wrapper: { marginTop: { unit: 'px', value: '16' }, textAlign: { value: 'center' } },
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
 * Always returns an ARRAY of GHL native elements.
 * bulletList → one styled paragraph per item (✓ prefix), so each bullet is individually editable in GHL.
 * All other types → [buildGhlNativeElement(el, textAlign)].
 */
function buildGhlNativeElements(el, textAlign = 'center') {
  if (el.type !== 'bulletList') {
    return [buildGhlNativeElement(el, textAlign)];
  }
  const rawItems = el.items || (el.children || []).map(c => c.text || c.value || String(c));
  const items    = rawItems.map(i => typeof i === 'string' ? i : (i.text || i.value || String(i)));
  const color    = el.styles?.color?.value || '#4a5568';
  const fSize    = el.styles?.fontSize?.value || 17;

  return items.map(item => {
    const id   = `paragraph-${sid()}`;
    const html = `<span style="color:var(--primary,#22c55e);font-weight:700;margin-right:8px;">✓</span>${item}`;
    return {
      child: [],
      class: { borderRadius: { value: 'radius0' }, borders: { value: 'noBorder' } },
      extra: {
        desktopFontSize: { unit: 'px', value: String(fSize) },
        mobileFontSize:  { unit: 'px', value: String(Math.max(fSize - 2, 14)) },
        nodeId:          `c-paragraph-${id}`,
        text:            { value: html },
        typography:      { value: 'var(--contentfont)' },
        visibility:      { value: { hideDesktop: false, hideMobile: false } },
      },
      id,
      meta:    'paragraph',
      styles: {
        boldTextColor: { value: color },
        color:         { value: color },
        lineHeight:    { value: '' },
        marginTop:     { unit: 'px', value: 8 },
        textAlign:     { value: 'left' },
      },
      tag:     'p',
      tagName: 'c-paragraph',
      title:   'Paragraph',
      type:    'element',
      wrapper: { marginTop: { unit: 'px', value: '8' }, textAlign: { value: 'left' } },
    };
  });
}

/**
 * Convert AI sections to GHL's ACTUAL native Storage format.
 * Each section becomes: { id, metaData, elements (flat), sequence, pageId, funnelId, locationId, general }
 */
function convertSectionsToGHL(aiSections, pageId = '', funnelId = '', locationId = '', colorScheme = '') {
  const colors  = extractColors(colorScheme);
  const total   = aiSections.length;

  return aiSections.map((aiSection, idx) => {
    const secId = `section-${sid()}`;

    // Section background: use AI value if present, otherwise apply smart defaults
    const aiBg    = aiSection.styles?.backgroundColor?.value;
    const isFirst = idx === 0;
    const isLast  = idx === total - 1;
    const bgColor = aiBg || (isFirst ? colors.heroBg : isLast ? colors.ctaBg : idx % 2 === 1 ? colors.sectionBg : '#FFFFFF');

    const padTop = String(aiSection.styles?.paddingTop?.value    || (isFirst || isLast ? 100 : 80));
    const padBot = String(aiSection.styles?.paddingBottom?.value || (isFirst || isLast ? 100 : 80));

    const rawNodes  = aiSection.children || aiSection.elements || aiSection.rows || [];
    const leafElems = flattenElements(rawNodes);
    console.log(`[GHLPageBuilder] Section ${idx + 1} (${aiSection.name || ''}): ${leafElems.length} elements (${leafElems.map(e => e.type).join(', ')})`);

    // ── Layout decision ─────────────────────────────────────────────────────────
    // three-column: social proof grids (layout === 'three-column' + columns array)
    // two-column:   middle sections with image + other elements (image | text)
    // single-column: everything else

    const imageElems  = leafElems.filter(e => e.type === 'image');
    const otherElems  = leafElems.filter(e => e.type !== 'image');
    const useThreeCol = aiSection.layout === 'three-column' && Array.isArray(aiSection.columns) && aiSection.columns.length > 0;
    const useTwoCol   = !useThreeCol && !isFirst && !isLast && imageElems.length > 0 && otherElems.length >= 2;

    let rowObjects     = [];
    let allNative      = [];
    let topLevelRowIds = [];

    if (useThreeCol) {
      // ── Three-column card grid ──────────────────────────────────────────────
      // Row 1: centered heading(s) from section children
      const hdrTypes  = new Set(['headline', 'heading', 'sub-heading', 'sub-headline']);
      const hdrLeaves = leafElems.filter(e => hdrTypes.has(e.type));
      const hdrNative = hdrLeaves.map(e => buildGhlNativeElement(e, 'center'));
      const hdrColId  = `col-${sid()}`;
      const hdrRowId  = `row-${sid()}`;
      const hdrCol    = makeColumn(hdrColId, hdrNative.map(e => e.id), 'center', 100);
      const hdrRow    = makeRow(hdrRowId, [hdrColId]);

      // Row 2: up to 3 card columns
      const cardColIds  = [];
      const cardObjects = [];
      const cardNatives = [];
      for (const col of aiSection.columns.slice(0, 3)) {
        const colChildren = col.children || [];
        const colLeaves   = flattenElements(colChildren.length ? colChildren : [col]);
        const colNative   = colLeaves.flatMap(e => buildGhlNativeElements(e, 'center'));
        const cardColId   = `col-${sid()}`;
        const cardCol     = makeCardColumn(cardColId, colNative.map(e => e.id), 'center', 32);
        cardColIds.push(cardColId);
        cardObjects.push(cardCol);
        cardNatives.push(...colNative);
      }
      const cardRowId = `row-${sid()}`;
      const cardRow   = makeRow(cardRowId, cardColIds);

      allNative      = [...hdrNative, ...cardNatives];
      rowObjects     = [hdrRow, hdrCol, cardRow, ...cardObjects];
      topLevelRowIds = [hdrRowId, cardRowId];

    } else if (useTwoCol) {
      // ── Two-column: alternate image side ───────────────────────────────────
      const imgLeft  = (idx % 2 === 0);
      const imgColId = `col-${sid()}`;
      const txtColId = `col-${sid()}`;
      const rowId    = `row-${sid()}`;

      const imgNative = imageElems.map(e => buildGhlNativeElement(e, 'center'));
      const txtNative = otherElems.flatMap(e => buildGhlNativeElements(e, 'left'));
      allNative = [...imgNative, ...txtNative];

      const imgCol   = makeColumn(imgColId, imgNative.map(e => e.id), 'center', 41.67);
      const txtCol   = makeColumn(txtColId, txtNative.map(e => e.id), 'left',   58.33);
      const colOrder = imgLeft ? [imgColId, txtColId] : [txtColId, imgColId];
      const row      = makeRow(rowId, colOrder);

      rowObjects     = imgLeft ? [row, imgCol, txtCol] : [row, txtCol, imgCol];
      topLevelRowIds = [rowId];

    } else {
      // ── Single column ───────────────────────────────────────────────────────
      const textAlign = aiSection.textAlign || ((isFirst || isLast) ? 'center' : 'left');
      const colId     = `col-${sid()}`;
      const rowId     = `row-${sid()}`;

      allNative      = leafElems.flatMap(e => buildGhlNativeElements(e, textAlign));
      const col      = makeColumn(colId, allNative.map(e => e.id), textAlign, 100);
      const row      = makeRow(rowId, [colId]);
      rowObjects     = [row, col];
      topLevelRowIds = [rowId];
    }

    // Gradient background — if the AI section specifies one, apply it
    const gradient = aiSection.styles?.backgroundGradient?.value || null;

    // Section metaData — child = the top-level row ID(s) this section contains
    const metaData = {
      child:   topLevelRowIds,
      class:   { borderRadius: { value: 'radius0' }, borders: { value: 'noBorder' } },
      extra:   defaultExtra({
        ...(gradient ? { backgroundGradient: { value: gradient } } : {}),
      }),
      id:      secId,
      meta:    'section',
      styles:  {
        backgroundColor: { value: gradient ? 'transparent' : bgColor },
        ...(gradient ? { backgroundImage: { value: gradient } } : {}),
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
      elements:    [...rowObjects, ...allNative],
      sequence:    idx,
      pageId:      pageId    || '',
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
  try { console.log(`[GHLPageBuilder] sections[0] keys=${Object.keys(aiSections[0]||{}).join(',')} children.len=${(aiSections[0]?.children||aiSections[0]?.elements||[]).length} raw=${JSON.stringify(aiSections[0]||{}).slice(0,300)}`); } catch(e) { console.log('[GHLPageBuilder] sections[0] inspect failed:', e.message); }

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

  const colorScheme     = hints.colorScheme     || '';
  const seoTitle        = hints.seoTitle        || '';
  const metaDescription = hints.metaDescription || '';
  const palette         = extractColors(colorScheme);

  // Convert AI output → GHL's ACTUAL native Storage format (metaData + flat elements[])
  const allSections = convertSectionsToGHL(aiSections, pageId, funnelId, locationId, colorScheme);
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

  // Storage file — GHL native format requires these top-level fields for the renderer to work.
  // Without pageStyles (CSS vars) and settings (fonts), the page renders blank.
  const popupRowId = `row-${sid()}`;
  const popupColId = `col-${sid()}`;
  const storageFile = {
    sections: ghlSections,
    popups: [
      {
        id: 'hl_main_popup', tag: '', meta: 'hl_main_popup', child: [popupRowId],
        title: 'Modal', customCss: [],
        extra: {
          visibility: { value: { hideDesktop: true, hideMobile: true } },
          minWidth: { value: 'medium-page' }, left: { unit: '%', value: 50 },
          showPopupOnMouseOut: { value: false }, overlayColor: { value: 'var(--overlay)' },
          popupDisabled: { value: false },
          desktopFontSize: { unit: 'px', value: '16' }, mobileFontSize: { value: '16', unit: 'px' },
          typography: { value: 'var(--contentfont)' }, bgImage: { value: { url: '', options: 'bgNoRepeat' } },
        },
        class: { radiusEdge: { value: 'none' }, borderRadius: { value: 'radius10' }, borders: { value: 'noBorder' }, boxShadow: { value: 'none' } },
        wrapper: {},
        styles: { paddingBottom: { unit: 'px', value: '40' }, borderStyle: { value: 'solid' }, paddingTop: { value: '40', unit: 'px' }, paddingRight: { value: 0, unit: 'px' }, marginTop: { value: '100', unit: 'px' }, paddingLeft: { value: 0, unit: 'px' }, borderWidth: { value: 3, unit: 'px' }, backgroundColor: { value: 'var(--color-18)' } },
      },
      { type: 'row', meta: 'row', id: popupRowId, tagName: 'c-row', title: '1 column row', child: [popupColId], class: { borderRadius: { value: 'radius0' }, alignRow: { value: 'row-align-center' }, borders: { value: 'noBorder' } }, extra: { visibility: { value: { hideDesktop: false, hideMobile: false } }, bgImage: { value: { options: 'bgCover', url: '' } }, desktopFontSize: { unit: 'px', value: '16' }, mobileFontSize: { unit: 'px', value: '16' }, typography: { value: 'var(--contentfont)' } }, styles: { borderStyle: { value: 'solid' }, paddingTop: { unit: 'px', value: '20' }, paddingRight: { value: '10', unit: 'px' }, paddingLeft: { unit: 'px', value: '10' }, marginTop: { value: '0', unit: 'px' }, paddingBottom: { unit: 'px', value: '20' }, borderWidth: { value: 3, unit: 'px' } }, wrapper: {} },
      { type: 'col', meta: 'col', id: popupColId, tagName: 'c-column', title: '1st column', child: [], class: { borderRadius: { value: 'radius0' }, borders: { value: 'noBorder' } }, extra: { visibility: { value: { hideDesktop: false, hideMobile: false } }, bgImage: { value: { options: 'bgCover', url: '' } }, desktopFontSize: { unit: 'px', value: '16' }, mobileFontSize: { unit: 'px', value: '16' }, typography: { value: 'var(--contentfont)' } }, styles: { paddingBottom: { unit: 'px', value: '0' }, borderWidth: { value: 3, unit: 'px' }, borderStyle: { value: 'solid' }, paddingTop: { value: '0', unit: 'px' }, width: { value: '100', unit: '%' }, paddingLeft: { unit: 'px', value: '10' }, paddingRight: { value: '10', unit: 'px' } }, wrapper: {} },
    ],
    settings: {
      settings: {
        background: { backgroundColor: { value: 'var(--color-18)' }, bgImage: { value: { options: 'bgCover', url: '' } } },
        typography: {
          fonts: {
            contentFont:  { text: 'Content Font',  id: 'contentfont',  value: { value: 'var(--open-sans)',    text: '"Open Sans"' } },
            headlineFont: { text: 'Headline Font', id: 'headlinefont', value: { value: 'var(--merriweather)', text: 'Merriweather' } },
          },
          colors: {
            linkColor: { value: { label: 'var(--link-color)', value: 'var(--color-17)' } },
            textColor: { value: { value: 'var(--black)', label: 'var(--text-color)' } },
          },
        },
        seo: {
          pageTitle:       { value: seoTitle },
          metaDescription: { value: metaDescription },
          keywords:        { value: '' },
          favicon:         { value: '' },
        },
      },
    },
    general: {
      general: {
        colors: [
          { label: 'Primary',   value: palette.primary }, { label: 'Secondary', value: palette.heroBg },
          { label: 'White',     value: '#ffffff' }, { label: 'Gray',      value: '#cbd5e0' },
          { label: 'Black',     value: '#000000' }, { label: 'Red',       value: '#e93d3d' },
          { label: 'Orange',    value: '#f6ad55' }, { label: 'Yellow',    value: '#faf089' },
          { label: 'Green',     value: '#9ae6b4' }, { label: 'Teal',      value: '#63b3ed' },
          { label: 'Indigo',    value: '#757BBD' }, { label: 'Purple',    value: '#d6bcfa' },
          { label: 'Pink',      value: '#fbb6ce' },
          { label: 'color-14',  value: '#ffffff' }, { label: 'color-15',  value: '#000000' },
          { label: 'color-16',  value: '#ffffff' }, { label: 'color-17',  value: '#188bf6' },
          { label: 'color-18',  value: '#ffffff' }, { label: 'color-19',  value: '#ffffff' },
          { label: 'color-20',  value: '#000000' }, { label: 'color-21',  value: '#000000' },
          { label: 'color-22',  value: '#000000' }, { label: 'color-23',  value: '#000000' },
          { label: 'color-24',  value: '#ffffff' }, { label: 'color-25',  value: palette.primary },
        ],
        fontsForPreview: [],
      },
    },
    pageStyles: `:root{
--primary:${palette.primary};--secondary:${palette.heroBg};--white:#ffffff;--gray:#cbd5e0;--black:#000000;
--red:#e93d3d;--orange:#f6ad55;--yellow:#faf089;--green:#9ae6b4;--teal:#63b3ed;
--indigo:#757BBD;--purple:#d6bcfa;--pink:#fbb6ce;--transparent:transparent;
--overlay:rgba(0,0,0,.5);--text-color:${palette.bodyText};--link-color:${palette.primary};
--color-14:#ffffff;--color-15:#000000;--color-16:#ffffff;--color-17:${palette.primary};
--color-18:${palette.sectionBg};--color-19:#ffffff;--color-20:${palette.bodyText};--color-21:${palette.bodyText};
--color-22:${palette.bodyText};--color-23:${palette.bodyText};--color-24:#ffffff;--color-25:${palette.primary};
--open-sans:'Open Sans',sans-serif;--merriweather:'Merriweather',serif;
--contentfont:var(--open-sans);--headlinefont:var(--merriweather);
}`,
    trackingCode: { headerCode: '', footerCode: '' },
    fontsForPreview: ["'\"Open Sans\"'", "'Merriweather'", "'Open Sans'"],
  };
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
    // page_data_* — fields used by some GHL paths
    page_data_url:          toFirestoreValue(storagePath),
    page_data_download_url: toFirestoreValue(newDownloadUrl),
    // section_* — fields the GHL page editor actually reads (confirmed by native AI page inspection)
    section_url:            toFirestoreValue(storagePath),
    section_download_url:   toFirestoreValue(newDownloadUrl),
    versionHistory:         updatedVH,
    version:                toFirestoreValue(newVersion),
    section_version:        toFirestoreValue(newSV),
    page_version:           toFirestoreValue(newPV),
    date_updated:           { timestampValue: new Date().toISOString() },
    ...(seoTitle        ? { name:            toFirestoreValue(seoTitle) }        : {}),
    ...(metaDescription ? { metaDescription: toFirestoreValue(metaDescription) } : {}),
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

module.exports = { buildBackendHeaders, savePageData, getPageData, convertSectionsToGHL, extractColors };
