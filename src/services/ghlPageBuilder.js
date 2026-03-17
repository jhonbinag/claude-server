/**
 * src/services/ghlPageBuilder.js
 *
 * Saves native GHL page sections via TWO writes:
 *
 *  1. Firebase Storage — flat elements format with metaData (what GHL builder RENDERS from)
 *     - sections[].{ id, metaData, elements[], sequence, pageId, funnelId, locationId, general }
 *     - Top-level: { sections, settings, general, pageStyles, trackingCode, fontsForPreview, popups, popupsList }
 *     - pageStyles contains CSS variable definitions required for rendering
 *
 *  2. Firestore funnel_pages/{pageId} — update page_data_url, page_data_download_url, sections (hierarchical), version
 *
 * Discovery: GHL reads page content from Firebase Storage (flat elements format).
 * The Firestore `sections` field uses a simplified hierarchical format for the builder UI sidebar.
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

  // Decode versionHistory array (raw Firestore wire format)
  const vhValues = f.versionHistory?.arrayValue?.values || [];

  return {
    funnelId:       f.funnel_id?.stringValue,
    locationId:     f.location_id?.stringValue,
    version:        parseInt(f.version?.integerValue || '1', 10),
    downloadUrl:    f.page_data_download_url?.stringValue,
    versionHistory: vhValues, // raw Firestore arrayValue values[]
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

// ── GHL flat elements format builders ─────────────────────────────────────────

const DEFAULT_BG_IMAGE = {
  value: { mediaType: 'image', url: '', opacity: '1', options: 'bgCover', svgCode: '', videoUrl: '', videoThumbnail: '', videoLoop: true },
};
const DEFAULT_VISIBILITY = { value: { hideDesktop: false, hideMobile: false } };

function buildSection(secId, rowId, styles = {}) {
  const bgColor = styles.backgroundColor?.value || 'var(--transparent)';
  const padTop  = styles.paddingTop?.value  || 60;
  const padBot  = styles.paddingBottom?.value || 60;
  return {
    id: secId,
    type: 'section',
    child: [rowId],
    class: {
      width:        { value: 'fullSection' },
      borders:      { value: 'noBorder' },
      borderRadius: { value: 'radius0' },
      radiusEdge:   { value: 'none' },
    },
    styles: {
      boxShadow:       { value: 'none' },
      paddingLeft:     { unit: 'px', value: 0 },
      paddingRight:    { value: 0, unit: 'px' },
      paddingBottom:   { unit: 'px', value: padBot },
      paddingTop:      { unit: 'px', value: padTop },
      marginTop:       { unit: 'px', value: 0 },
      marginBottom:    { unit: 'px', value: 0 },
      marginLeft:      { unit: 'px', value: 0 },
      marginRight:     { unit: 'px', value: 0 },
      backgroundColor: { value: bgColor },
      background:      { value: 'none' },
      backdropFilter:  { value: 'none' },
      borderColor:     { value: 'var(--black)' },
      borderWidth:     { value: '0', unit: 'px' },
      borderStyle:     { value: 'solid' },
    },
    extra: {
      sticky:          { value: 'noneSticky' },
      visibility:      DEFAULT_VISIBILITY,
      bgImage:         DEFAULT_BG_IMAGE,
      allowRowMaxWidth:{ value: false },
      customClass:     { value: [] },
      elementScreenshot: { value: [] },
    },
    wrapper:      { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 } },
    meta:         'section',
    tagName:      'c-section',
    title:        'Section',
    mobileStyles: {},
    mobileWrapper:{},
  };
}

function buildRow(rowId, colIds) {
  return {
    id: rowId, type: 'row', child: colIds,
    class: {
      alignRow:     { value: 'row-align-center' },
      borders:      { value: 'noBorder' },
      borderRadius: { value: 'radius0' },
      radiusEdge:   { value: 'none' },
    },
    styles: {
      boxShadow:       { value: 'none' },
      paddingLeft:     { value: 20, unit: 'px' },
      paddingRight:    { value: 20, unit: 'px' },
      paddingTop:      { value: 10, unit: 'px' },
      paddingBottom:   { value: 10, unit: 'px' },
      backgroundColor: { value: 'var(--transparent)' },
      background:      { value: 'none' },
      backdropFilter:  { value: 'none' },
      borderColor:     { value: 'var(--black)' },
      borderWidth:     { value: '0', unit: 'px' },
      borderStyle:     { value: 'solid' },
    },
    extra: {
      visibility: DEFAULT_VISIBILITY,
      bgImage:    DEFAULT_BG_IMAGE,
      rowWidth:   { value: 1170, unit: 'px' },
      customClass:{ value: [] },
    },
    wrapper:      { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 }, marginLeft: { unit: '', value: 'auto' }, marginRight: { unit: '', value: 'auto' } },
    tagName:      'c-row',
    meta:         'row',
    mobileStyles: {},
    mobileWrapper:{},
    title:        '1 Column Row',
  };
}

function buildCol(colId, childIds) {
  return {
    id: colId, type: 'col', child: childIds,
    class: {
      borders:      { value: 'noBorder' },
      borderRadius: { value: 'radius0' },
      radiusEdge:   { value: 'none' },
    },
    styles: {
      boxShadow:       { value: 'none' },
      paddingLeft:     { value: 15, unit: 'px' },
      paddingRight:    { value: 15, unit: 'px' },
      paddingTop:      { value: 10, unit: 'px' },
      paddingBottom:   { value: 10, unit: 'px' },
      backgroundColor: { value: 'var(--transparent)' },
      background:      { value: 'none' },
      backdropFilter:  { value: 'none' },
      width:           { value: 100, unit: '%' },
      borderColor:     { value: 'var(--black)' },
      borderWidth:     { value: '0', unit: 'px' },
      borderStyle:     { value: 'solid' },
    },
    extra: {
      visibility:                  DEFAULT_VISIBILITY,
      bgImage:                     DEFAULT_BG_IMAGE,
      columnLayout:                { value: 'column' },
      justifyContentColumnLayout:  { value: 'center' },
      alignContentColumnLayout:    { value: 'inherit' },
      forceColumnLayoutForMobile:  { value: true },
      customClass:                 { value: [] },
      elementVersion:              { value: 2 },
    },
    wrapper:      { marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 }, marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 } },
    tagName:      'c-column',
    meta:         'col',
    mobileStyles: {},
    mobileWrapper:{},
    title:        '1st Column',
    noOfColumns:  1,
  };
}

// Shared styles block for c-heading / c-sub-heading / c-paragraph (GHL new element format)
function buildTextStyles(overrides = {}) {
  return {
    backgroundColor:      { value: 'var(--transparent)' },
    color:                { value: 'var(--black)' },
    boldTextColor:        { value: 'var(--black)' },
    italicTextColor:      { value: 'var(--text-color)' },
    underlineTextColor:   { value: 'var(--text-color)' },
    linkTextColor:        { value: 'var(--link-color)' },
    iconColor:            { value: 'var(--text-color)' },
    fontFamily:           { value: '' },
    fontWeight:           { value: 'normal' },
    paddingLeft:          { unit: 'px', value: 0 },
    paddingRight:         { unit: 'px', value: 0 },
    paddingTop:           { unit: 'px', value: 0 },
    paddingBottom:        { unit: 'px', value: 0 },
    opacity:              { value: '1' },
    textShadow:           { value: '0px 0px 0px rgba(0,0,0,0)' },
    borderColor:          { value: 'var(--black)' },
    borderWidth:          { value: '2', unit: 'px' },
    borderStyle:          { value: 'solid' },
    lineHeight:           { value: 1.3, unit: 'em' },
    textTransform:        { value: '' },
    letterSpacing:        { value: '0', unit: 'px' },
    textAlign:            { value: 'center' },
    ...overrides,
  };
}

function buildTextClass() {
  return {
    boxShadow:    { value: 'none' },
    borders:      { value: 'noBorder' },
    borderRadius: { value: 'radius0' },
    radiusEdge:   { value: 'none' },
  };
}

function buildHeadline(id, text, tag = 'h1') {
  const deskSize = tag === 'h1' ? 48 : tag === 'h2' ? 36 : 28;
  const mobSize  = tag === 'h1' ? 32 : 24;
  const rawId    = id.replace(/^heading-/, '');
  return {
    id,
    type:      'element',
    child:     [],
    meta:      'heading',
    tagName:   'c-heading',
    title:     'Headline',
    tag,
    customCss: [],
    class:     buildTextClass(),
    styles:    buildTextStyles({ fontWeight: { value: '700' }, textAlign: { value: 'center' } }),
    extra: {
      nodeId:          { value: `cheading-${rawId}` },
      visibility:      DEFAULT_VISIBILITY,
      text:            { value: `<${tag}>${text}</${tag}>` },
      desktopFontSize: { value: deskSize, unit: 'px' },
      mobileFontSize:  { value: mobSize,  unit: 'px' },
      typography:      { value: 'var(--headlinefont)' },
      icon:            { value: { name: '', unicode: '', fontFamily: '' } },
      customClass:     { value: [] },
    },
    wrapper: { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: '20' } },
  };
}

function buildSubHeadline(id, text) {
  const rawId = id.replace(/^sub-headline-/, '').replace(/^sub-heading-/, '');
  return {
    id,
    type:         'element',
    child:        [],
    meta:         'sub-heading',
    tagName:      'c-sub-heading',
    title:        'Sub Headline',
    tag:          'h3',
    customCss:    [],
    mobileStyles: {},
    mobileWrapper:{},
    class:        buildTextClass(),
    styles:       buildTextStyles({ textAlign: { value: 'center' } }),
    extra: {
      nodeId:          { value: `csub-heading-${rawId}` },
      visibility:      DEFAULT_VISIBILITY,
      text:            { value: `<h3>${text}</h3>` },
      desktopFontSize: { value: 23, unit: 'px' },
      mobileFontSize:  { value: 20, unit: 'px' },
      typography:      { value: 'var(--headlinefont)' },
      icon:            { value: { name: '', unicode: '', fontFamily: '' } },
      customClass:     { value: [] },
    },
    wrapper: { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 } },
  };
}

function buildParagraph(id, text) {
  const html  = text.startsWith('<') ? text : `<p>${text}</p>`;
  const rawId = id.replace(/^paragraph-/, '');
  return {
    id,
    type:      'element',
    child:     [],
    meta:      'paragraph',
    tagName:   'c-paragraph',
    title:     'Paragraph',
    tag:       'p',
    customCss: [],
    class:     buildTextClass(),
    styles:    buildTextStyles({ textAlign: { value: 'left' } }),
    extra: {
      nodeId:          { value: `cparagraph-${rawId}` },
      visibility:      DEFAULT_VISIBILITY,
      text:            { value: html },
      desktopFontSize: { value: 16, unit: 'px' },
      mobileFontSize:  { value: 14, unit: 'px' },
      typography:      { value: 'var(--contentfont)' },
      icon:            { value: { name: '', unicode: '', fontFamily: '' } },
      customClass:     { value: [] },
    },
    wrapper: { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: '15' } },
  };
}

function buildButton(id, text, link = '#', elStyles = {}) {
  // Unwrap AI-generated style values that may already be in { value: "..." } object form
  const colorVal = typeof elStyles.color === 'string' ? elStyles.color : (elStyles.color?.value || 'var(--white)');
  const bgVal    = typeof elStyles.backgroundColor === 'string' ? elStyles.backgroundColor : (elStyles.backgroundColor?.value || 'var(--primary)');
  return {
    id, type: 'button', child: [],
    class: {
      align:        { value: 'center' },
      borders:      { value: 'noBorder' },
      borderRadius: { value: 'radius0' },
      radiusEdge:   { value: 'none' },
    },
    styles: {
      fontSize:        { value: 16, unit: 'px' },
      fontWeight:      { value: '700' },
      lineHeight:      { value: 1.2 },
      color:           { value: colorVal },
      backgroundColor: { value: bgVal },
      paddingTop:      { value: 14, unit: 'px' },
      paddingBottom:   { value: 14, unit: 'px' },
      paddingLeft:     { value: 32, unit: 'px' },
      paddingRight:    { value: 32, unit: 'px' },
      borderRadius:    { value: 6, unit: 'px' },
      borderWidth:     { value: '0', unit: 'px' },
      borderStyle:     { value: 'solid' },
      borderColor:     { value: 'var(--black)' },
    },
    extra: {
      visibility:  DEFAULT_VISIBILITY,
      customClass: { value: [] },
      content:     { value: text },
      link:        { value: { type: 'url', value: link, target: '_self' } },
    },
    wrapper:      { marginTop: { unit: 'px', value: 10 }, marginBottom: { unit: 'px', value: 10 }, marginLeft: { unit: 'px', value: 0 }, marginRight: { unit: 'px', value: 0 } },
    tagName:      'c-button',
    meta:         'button',
    title:        'Button',
    mobileStyles: {},
    mobileWrapper:{},
  };
}

function buildBulletList(id, items) {
  const html  = '<ul>' + items.map(i => `<li>${i.text || i}</li>`).join('') + '</ul>';
  const rawId = id.replace(/^bulletList-/, '').replace(/^list-/, '');
  return {
    id,
    type:      'element',
    child:     [],
    meta:      'paragraph',
    tagName:   'c-paragraph',
    title:     'Paragraph',
    tag:       'p',
    customCss: [],
    class:     buildTextClass(),
    styles:    buildTextStyles({ textAlign: { value: 'left' } }),
    extra: {
      nodeId:          { value: `cparagraph-${rawId}` },
      visibility:      DEFAULT_VISIBILITY,
      text:            { value: html },
      desktopFontSize: { value: 16, unit: 'px' },
      mobileFontSize:  { value: 14, unit: 'px' },
      typography:      { value: 'var(--contentfont)' },
      icon:            { value: { name: '', unicode: '', fontFamily: '' } },
      customClass:     { value: [] },
    },
    wrapper: { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: '15' } },
  };
}

function buildImage(id, src, alt = '') {
  const rawId = id.replace(/^image-/, '');
  return {
    id,
    type:      'element',
    child:     [],
    meta:      'image',
    tagName:   'c-image',
    title:     'Image',
    customCss: [],
    class: {
      borders:      { value: 'noBorder' },
      borderRadius: { value: 'radius0' },
      radiusEdge:   { value: 'none' },
      align:        { value: 'center' },
    },
    styles: {
      width:           { value: 100,  unit: '%' },
      maxWidth:        { value: 100,  unit: '%' },
      paddingTop:      { value: 0,    unit: 'px' },
      paddingBottom:   { value: 0,    unit: 'px' },
      paddingLeft:     { value: 0,    unit: 'px' },
      paddingRight:    { value: 0,    unit: 'px' },
      opacity:         { value: '1' },
      borderColor:     { value: 'var(--black)' },
      borderWidth:     { value: '0', unit: 'px' },
      borderStyle:     { value: 'solid' },
    },
    extra: {
      nodeId:      { value: `cimage-${rawId}` },
      visibility:  DEFAULT_VISIBILITY,
      src:         { value: src || '' },
      alt:         { value: alt || '' },
      link:        { value: { type: 'url', value: '', target: '_self' } },
      customClass: { value: [] },
    },
    wrapper:      { marginTop: { unit: 'px', value: 0 }, marginBottom: { unit: 'px', value: 0 }, marginLeft: { unit: '', value: 'auto' }, marginRight: { unit: '', value: 'auto' } },
    mobileStyles: {},
    mobileWrapper:{},
  };
}

// ── Top-level GHL Storage file structure ──────────────────────────────────────

const PAGE_STYLES = `:root{ --transparent: transparent;\n--primary: #37ca37;\n--secondary: #188bf6;\n--white: #ffffff;\n--gray: #cbd5e0;\n--black: #000000;\n--red: #e93d3d;\n--orange: #f6ad55;\n--yellow: #faf089;\n--green: #9ae6b4;\n--teal: #81e6d9;\n--malibu: #63b3ed;\n--indigo: #757BBD;\n--purple: #d6bcfa;\n--pink: #fbb6ce;\n--inter: Inter,sans-serif;\n}`;

// These objects match the shape of existingFile.settings / existingFile.general
// (no outer wrapper — pageFile.settings = { typography:{...} }, not { settings:{...} })
const PAGE_SETTINGS = {
  typography: {
    fonts: {
      headlineFont: { id: 'headlinefont', text: 'Headline Font', value: { text: 'Inter', value: 'var(--inter)' } },
      contentFont:  { id: 'contentfont',  text: 'Content Font',  value: { text: 'Inter', value: 'var(--inter)' } },
    },
    colors: {
      textColor:       { id: 'textcolor',       text: 'Text Color',       value: { text: 'Black', value: 'var(--black)' } },
      backgroundColor: { id: 'backgroundcolor', text: 'Background Color', value: { text: 'Transparent', value: 'var(--transparent)' } },
    },
  },
};

const PAGE_GENERAL = {
  colors: [
    { label: 'Transparent', value: 'transparent' },
    { label: 'Primary',     value: '#37ca37' },
    { label: 'Secondary',   value: '#188bf6' },
    { label: 'White',       value: '#ffffff' },
    { label: 'Gray',        value: '#cbd5e0' },
    { label: 'Black',       value: '#000000' },
  ],
  rootVars: { '--transparent': 'transparent', '--black': '#000000', '--primary': '#37ca37', '--secondary': '#188bf6', '--white': '#ffffff' },
};

const SECTION_GENERAL = {
  colors: [
    { label: 'Transparent', value: 'transparent' },
    { label: 'Black', value: '#000000' },
  ],
  fontsForPreview: [],
  rootVars: { '--transparent': 'transparent', '--black': '#000000' },
  sectionStyles: '',
  customFonts: [],
};

// ── Convert AI sections → GHL flat elements format (for Firebase Storage) ─────

function convertSectionsToGhlStorage(aiSections, pageId, funnelId, locationId) {
  return aiSections.map((aiSection, idx) => {
    const secId = aiSection.id || `section-${randomId()}`;
    const rowId = `row-${randomId()}`;
    const colId = `col-${randomId()}`;

    // Flatten content elements
    const kids = aiSection.children || [];
    let contentItems = [];
    if (kids.length > 0 && kids[0].type === 'row') {
      const col = (kids[0].children || [])[0];
      contentItems = col?.children || [];
    } else {
      contentItems = kids.filter(k => !['row', 'column'].includes(k.type));
    }

    // Build content elements
    const contentEls = [];
    const contentIds = [];
    for (const el of contentItems) {
      const elId = el.id || `${el.type}-${randomId()}`;
      let built;
      switch (el.type) {
        case 'headline':    built = buildHeadline(elId, el.text || '', el.tag || 'h1'); break;
        case 'sub-headline':built = buildSubHeadline(elId, el.text || ''); break;
        case 'paragraph':   built = buildParagraph(elId, el.text || ''); break;
        case 'button':      built = buildButton(elId, el.text || 'Click Here', el.link || '#', el.styles || {}); break;
        case 'bulletList':  built = buildBulletList(elId, el.items || []); break;
        case 'image':       built = buildImage(elId, el.src || '', el.alt || ''); break;
        default:            built = buildParagraph(elId, el.text || '');
      }
      contentEls.push(built);
      contentIds.push(elId);
    }

    // Build the metaData section descriptor
    const sectionMeta = buildSection(secId, rowId, aiSection.styles || {});

    return {
      id:         secId,
      metaData:   sectionMeta,
      elements:   [
        buildRow(rowId, [colId]),
        buildCol(colId, contentIds),
        ...contentEls,
      ],
      sequence:   idx,
      pageId,
      funnelId,
      locationId,
      general:    SECTION_GENERAL,
    };
  });
}

// ── Convert AI sections → GHL Firestore hierarchical format (for sections field) ──

function convertSectionsToFirestore(aiSections) {
  return aiSections.map(aiSection => {
    const secId = aiSection.id || `section-${randomId()}`;
    const kids  = aiSection.children || [];
    let contentItems = [];
    if (kids.length > 0 && kids[0].type === 'row') {
      const col = (kids[0].children || [])[0];
      contentItems = col?.children || [];
    } else {
      contentItems = kids.filter(k => !['row', 'column'].includes(k.type));
    }

    const ghlEls = contentItems.map(el => {
      const elId = el.id || `${el.type}-${randomId()}`;
      switch (el.type) {
        case 'headline':    return { id: elId, type: 'headline',     tag: el.tag || 'h1', text: el.text || '', styles: { color: {} }, mobileStyles: {} };
        case 'sub-headline':return { id: elId, type: 'sub-headline', text: el.text || '' };
        case 'paragraph':   return { id: elId, type: 'paragraph',    text: el.text || '' };
        case 'button':      return { id: elId, type: 'button', text: el.text || 'Click Here', link: el.link || '#',
                                     styles: { backgroundColor: { value: el.styles?.backgroundColor || '#000000' }, color: { value: el.styles?.color || '#ffffff' }, paddingLeft: { value: 25, unit: 'px' }, paddingRight: { value: 25, unit: 'px' }, borderRadius: {} }, mobileStyles: {} };
        case 'bulletList':  return { id: elId, type: 'bulletList', text: '<ul>' + (el.items||[]).map(i=>`<li>${i.text||i}</li>`).join('') + '</ul>' };
        case 'image':       return { id: elId, type: 'image', src: el.src || '', alt: el.alt || '', styles: { width: { value: 100, unit: '%' } }, mobileStyles: {} };
        default:            return { id: elId, type: 'paragraph', text: el.text || '' };
      }
    });

    return {
      id:   secId, type: 'section',
      styles: {
        paddingTop:      { value: aiSection.styles?.paddingTop?.value      || 80,  unit: 'px' },
        paddingBottom:   { value: aiSection.styles?.paddingBottom?.value   || 80,  unit: 'px' },
        paddingLeft:     { value: 20, unit: 'px' },
        paddingRight:    { value: 20, unit: 'px' },
        backgroundColor: { value: aiSection.styles?.backgroundColor?.value || '#ffffff' },
      },
      mobileStyles: {},
      children: [{ children: [{ id: `column-${randomId()}`, type: 'column', width: 12, styles: { textAlign: { value: 'center' } }, mobileStyles: {}, children: ghlEls }] }],
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
 */
async function savePageData(locationId, pageId, sectionsJson, hints = {}) {
  const aiSections = sectionsJson?.sections || [];
  console.log(`[GHLPageBuilder] Saving page ${pageId} — ${aiSections.length} AI sections`);

  const idToken   = await getFirebaseToken(locationId);
  const projectId = getProjectIdFromToken(idToken);

  // Read Firestore for funnelId and current state
  // Non-fatal when funnelId is supplied via hints (e.g. passed from route body)
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

  const { funnelId, version: currentVersion, downloadUrl: currentDownloadUrl, versionHistory: existingVH } = docInfo;
  if (!funnelId) throw new Error(`Page ${pageId} missing funnelId — provide funnelId in the request or open the page in GHL builder first.`);

  // Download existing file to preserve trackingCode/popups if available
  let existingFile = null;
  if (currentDownloadUrl) {
    try { existingFile = await downloadStorageFile(currentDownloadUrl); } catch { /* ignore */ }
  }

  // Normalize settings — unwrap old double-nested format ({ settings: { typography } } → { typography })
  // and validate that typography.colors exists; fall back to PAGE_SETTINGS if anything looks wrong
  function normalizeSettings(s) {
    if (!s) return PAGE_SETTINGS;
    const unwrapped = s.settings || s;          // unwrap { settings: {...} } if present
    if (!unwrapped.typography?.colors) return PAGE_SETTINGS;
    return unwrapped;
  }

  // Normalize general — unwrap old double-nested format ({ general: { colors } } → { colors })
  function normalizeGeneral(g) {
    if (!g) return PAGE_GENERAL;
    const unwrapped = g.general || g;           // unwrap { general: {...} } if present
    if (!Array.isArray(unwrapped.colors)) return PAGE_GENERAL;
    return unwrapped;
  }

  // Convert to GHL flat elements format (what the builder renders from Storage)
  const storageSections = convertSectionsToGhlStorage(aiSections, pageId, funnelId, locationId);
  console.log(`[GHLPageBuilder] Built ${storageSections.length} sections (flat elements format)`);

  // Build complete page file matching GHL's expected structure
  const pageFile = {
    sections:        storageSections,
    settings:        normalizeSettings(existingFile?.settings),
    general:         normalizeGeneral(existingFile?.general),
    pageStyles:      existingFile?.pageStyles || PAGE_STYLES,
    trackingCode:    existingFile?.trackingCode    || '',
    fontsForPreview: existingFile?.fontsForPreview || [],
    popups:          existingFile?.popups          || [],
    popupsList:      existingFile?.popupsList      || [],
  };

  // Upload to Firebase Storage
  const { storagePath, downloadUrl: newDownloadUrl } = await uploadToStorage(idToken, funnelId, pageId, pageFile);
  console.log(`[GHLPageBuilder] Uploaded to ${storagePath}`);

  // Build new versionHistory entry (prepend — GHL renders from versionHistory[0])
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
  // Prepend our entry — keep at most 30 existing entries after ours
  const updatedVH = { arrayValue: { values: [newVHEntry, ...(existingVH || []).slice(0, 29)] } };

  // Convert to Firestore hierarchical format (for builder sections sidebar)
  const firestoreSections = convertSectionsToFirestore(aiSections);

  // Update Firestore with new Storage URL + versionHistory + sections + version
  const newVersion = (currentVersion || 1) + 1;
  const fsResult   = await patchFirestoreDoc(idToken, projectId, pageId, {
    page_data_url:          toFirestoreValue(storagePath),
    page_data_download_url: toFirestoreValue(newDownloadUrl),
    versionHistory:         updatedVH,
    sections:               toFirestoreValue(firestoreSections),
    version:                toFirestoreValue(newVersion),
    date_updated:           { timestampValue: new Date().toISOString() },
  });
  console.log(`[GHLPageBuilder] Firestore updated → ${fsResult.status}`);

  if (fsResult.status >= 400) {
    // Storage upload succeeded but Firestore metadata update failed.
    // The page data IS saved to Storage — GHL just won't see it until Firestore is updated.
    // This typically means the Firebase token lacks Firestore write permissions.
    // Reconnect using the console snippet (refreshedToken) and regenerate to fix.
    console.warn(`[GHLPageBuilder] Firestore PATCH failed (${fsResult.status}) — page saved to Storage but GHL won't reload it until Firestore is updated. Token may lack write claims.`);
    return {
      success:      true,
      firestoreWarning: `Firestore update failed (${fsResult.status}) — reconnect via the console snippet and regenerate so GHL picks up the new content.`,
      storagePath,
      downloadUrl:  newDownloadUrl,
      sections:     storageSections.length,
      version:      newVersion,
    };
  }

  return { success: true, storagePath, downloadUrl: newDownloadUrl, sections: storageSections.length, version: newVersion };
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
