/**
 * src/routes/funnelBuilder.js
 *
 * Mounts at /funnel-builder
 *
 * POST   /funnel-builder/connect       — exchange GHL custom token for Firebase ID token
 * DELETE /funnel-builder/connect       — remove stored Firebase token
 * GET    /funnel-builder/status        — check connection status
 * POST   /funnel-builder/generate      — generate native GHL page JSON via Claude + save to GHL
 */

const express      = require('express');
const router       = express.Router();

// Repair truncated JSON: close open strings, fill dangling keys, close brackets
const { jsonrepair } = require('jsonrepair');

function parseJsonSafe(raw) {
  // Strip markdown code fences
  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // Extract JSON object — from first { to last } (handles leading/trailing text)
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  try { return JSON.parse(jsonrepair(cleaned)); } catch { /* fall through */ }

  // Last resort: jsonrepair on the original stripped text
  return JSON.parse(jsonrepair(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()));
}
const multer       = require('multer');
const aiService    = require('../services/aiService');
const authenticate = require('../middleware/authenticate');
const {
  connectFirebase,
  disconnectFirebase,
  getFirebaseToken,
  getStatus,
} = require('../services/ghlFirebaseService');
const { savePageData, getPageData, convertSectionsToGHL } = require('../services/ghlPageBuilder');
const { buildPageHtml }             = require('../tools/ghlTools');
const agentStore                    = require('../services/agentStore');
const ghlClient                     = require('../services/ghlClient');
const chroma                        = require('../services/chromaService');
const https                         = require('https');

// ── savePageData wrapper — passes funnelId hint so Firestore read is non-fatal
function saveWithFunnelHint(locationId, pageId, pageJson, funnelId) {
  return savePageData(locationId, pageId, pageJson, funnelId ? { funnelId } : {});
}

// Multer: store in memory (we only need the buffer for base64)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPG, WEBP, or GIF images are accepted.'));
  },
});

router.use(authenticate);

// ── Probe GHL backend for a Firebase custom token ────────────────────────────
// Try candidate paths in order; return first one that yields a token field.

function probeCustomToken(accessToken, locationId) {
  const candidates = [
    // Observed in GHL network traffic — try most likely first
    { hostname: 'backend.leadconnectorhq.com', path: `/user/firebase-custom-token?locationId=${encodeURIComponent(locationId)}` },
    { hostname: 'backend.leadconnectorhq.com', path: `/user/customToken?locationId=${encodeURIComponent(locationId)}` },
    { hostname: 'backend.leadconnectorhq.com', path: `/firebase/customToken?locationId=${encodeURIComponent(locationId)}` },
    { hostname: 'services.leadconnectorhq.com', path: `/oauth/firebase-token?locationId=${encodeURIComponent(locationId)}` },
  ];

  const tryNext = (i) => new Promise((resolve, reject) => {
    if (i >= candidates.length) {
      return reject(new Error('All Firebase token endpoints exhausted — none returned a token.'));
    }
    const { hostname, path } = candidates[i];
    const req2 = https.request(
      {
        hostname,
        path,
        method:  'GET',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          channel:        'APP',
          source:         'WEB_USER',
          version:        '2021-07-28',
        },
      },
      (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => {
          console.log(`[FunnelBuilder] probe ${hostname}${path} → ${resp.statusCode}: ${d.slice(0, 300)}`);
          try {
            const parsed = JSON.parse(d);
            const token = parsed.token || parsed.customToken || parsed.firebaseToken
                       || parsed.firebase_token || parsed.firebaseCustomToken;
            if (token && resp.statusCode < 400) resolve(token);
            else tryNext(i + 1).then(resolve).catch(reject);
          } catch {
            tryNext(i + 1).then(resolve).catch(reject);
          }
        });
      }
    );
    req2.on('error', () => tryNext(i + 1).then(resolve).catch(reject));
    req2.end();
  });

  return tryNext(0);
}

// ── POST /auto-connect — get Firebase token using stored GHL OAuth token ───────

router.post('/auto-connect', async (req, res) => {
  try {
    // Already connected and fresh? Return early
    const existing = await getStatus(req.locationId);
    if (existing.connected && existing.expiresAt > Date.now() + 60_000) {
      return res.json({ success: true, alreadyConnected: true, expiresAt: existing.expiresAt });
    }

    const accessToken = await ghlClient.getValidAccessToken(req.locationId);
    const customToken = await probeCustomToken(accessToken, req.locationId);

    const record = await connectFirebase(req.locationId, customToken);
    console.log(`[FunnelBuilder] Auto-connected Firebase for location ${req.locationId}`);

    res.json({
      success:   true,
      message:   'Firebase auto-connected using GHL OAuth token.',
      expiresAt: record.expiresAt,
    });
  } catch (err) {
    console.error('[FunnelBuilder] auto-connect error:', err.message);
    res.status(400).json({
      success: false,
      error:   err.message,
      hint:    'Auto-connect failed. Paste your refreshedToken manually in the Funnel Builder page.',
    });
  }
});

// ── POST /connect — exchange refreshedToken for Firebase tokens ───────────────

router.post('/connect', async (req, res) => {
  const { refreshedToken } = req.body;
  if (!refreshedToken) {
    return res.status(400).json({ success: false, error: '"refreshedToken" is required.' });
  }

  try {
    const record = await connectFirebase(req.locationId, refreshedToken);
    res.json({
      success:   true,
      message:   'Firebase connected successfully.',
      expiresAt: record.expiresAt,
    });
  } catch (err) {
    console.error('[FunnelBuilder] connect error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── DELETE /connect — remove stored Firebase token ───────────────────────────

router.delete('/connect', async (req, res) => {
  try {
    await disconnectFirebase(req.locationId);
    res.json({ success: true, message: 'Firebase disconnected.' });
  } catch (err) {
    console.error('[FunnelBuilder] disconnect error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /inspect-page — read raw Firestore doc + sub-collections for a page ──
// Usage: GET /funnel-builder/inspect-page?pageId=xxx
// Returns the raw Firestore document + tries to read sub-collection docs so
// we can see exactly where GHL stores page sections.

router.get('/inspect-page', async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '"pageId" query param required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  const https       = require('https');
  const projectId   = 'highlevel-backend';
  const authHeader  = { 'Authorization': `Bearer ${idToken}` };

  const get = (hostname, path) => new Promise((resolve) => {
    const req2 = https.request({ hostname, path, method: 'GET', headers: authHeader }, (r) => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, data: d }); }
      });
    });
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.end();
  });

  const base = `/v1/projects/${projectId}/databases/(default)/documents`;

  const [mainDoc, subSections, subContent, rtdb] = await Promise.all([
    get('firestore.googleapis.com', `${base}/funnel_pages/${pageId}`),
    get('firestore.googleapis.com', `${base}/funnel_pages/${pageId}/sections?pageSize=5`),
    get('firestore.googleapis.com', `${base}/funnel_pages/${pageId}/content?pageSize=5`),
    get(`${projectId}-default-rtdb.firebaseio.com`, `/funnel_pages/${pageId}.json?shallow=true`),
  ]);

  res.json({
    mainDoc:     {
      status: mainDoc.status,
      // Show ALL field names present in the doc (tells us what fields GHL stores)
      fields: mainDoc.data?.fields ? Object.keys(mainDoc.data.fields) : mainDoc.data,
      // Show the raw sections field if it exists
      sectionsPresent: !!mainDoc.data?.fields?.sections,
      rawSectionsSample: mainDoc.data?.fields?.sections
        ? JSON.stringify(mainDoc.data.fields.sections).slice(0, 500)
        : null,
    },
    subSections: { status: subSections.status, data: subSections.data },
    subContent:  { status: subContent.status,  data: subContent.data },
    rtdb:        { status: rtdb.status,        data: rtdb.data },
    // Also try reading from backend API GET (different from POST)
  });
});

// ── GET /read-storage — download actual Storage file for a page (debug) ───────
// Usage: GET /funnel-builder/read-storage?pageId=xxx
// Downloads the page JSON from Firebase Storage so we can see exactly what
// GHL's own AI saves vs what we're writing.

router.get('/read-storage', async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '"pageId" query param required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  const { readFirestoreDoc, downloadStorageFile } = (() => {
    // Re-use helpers from ghlPageBuilder
    const builder = require('../services/ghlPageBuilder');
    return builder;
  })();

  // Read Firestore to get the download URL
  const https     = require('https');
  const projectId = 'highlevel-backend';

  const firestoreGet = (path) => new Promise((resolve) => {
    const req2 = https.request(
      { hostname: 'firestore.googleapis.com', path, method: 'GET', headers: { Authorization: `Bearer ${idToken}` } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d }); } }); }
    );
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.end();
  });

  const docPath = `/v1/projects/${projectId}/databases/(default)/documents/funnel_pages/${pageId}`;
  const docRes  = await firestoreGet(docPath);

  if (docRes.status >= 400) {
    return res.status(docRes.status).json({ error: 'Firestore read failed', detail: docRes.data });
  }

  const fields      = docRes.data?.fields || {};
  const downloadUrl = fields.page_data_download_url?.stringValue;
  const vhValues    = fields.versionHistory?.arrayValue?.values || [];
  const vhUrl       = vhValues[0]?.mapValue?.fields?.page_download_url?.stringValue;

  if (!downloadUrl && !vhUrl) {
    return res.json({
      message: 'No storage URL found in Firestore document — page has never been saved.',
      firestoreFields: Object.keys(fields),
    });
  }

  // Download the actual Storage file
  const url     = downloadUrl || vhUrl;
  const httpsGet = (urlStr) => new Promise((resolve) => {
    const u   = new URL(urlStr);
    const req2 = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: {} },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d }); } }); }
    );
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.end();
  });

  const fileRes = await httpsGet(url);

  res.json({
    storageUrl:      url,
    storageStatus:   fileRes.status,
    // Top-level keys in the file
    topLevelKeys:    typeof fileRes.data === 'object' ? Object.keys(fileRes.data) : null,
    // Full raw file (may be large)
    rawFile:         fileRes.data,
  });
});

// ── GET /status — check whether Firebase token exists + expiry ────────────────

router.get('/status', async (req, res) => {
  try {
    const status = await getStatus(req.locationId);
    res.json({ success: true, ...status });
  } catch (err) {
    console.error('[FunnelBuilder] status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /generate — AI-powered native page generation + save to GHL ─────────

router.post('/generate', async (req, res) => {
  const {
    pageId,
    funnelId,
    pageType,
    niche,
    offer,
    audience,
    extraContext,
    colorScheme,
    agentId,       // optional: saved agent to use as persona
  } = req.body;

  if (!niche || !offer) {
    return res.status(400).json({ success: false, error: '"niche" and "offer" are required.' });
  }
  if (!funnelId && !pageId) {
    return res.status(400).json({ success: false, error: '"funnelId" is required (pageId is auto-detected from funnelId).' });
  }

  if (!aiService.getProvider()) {
    return res.status(503).json({ success: false, error: 'No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.' });
  }

  // Step 1: Ensure Firebase is connected
  let idToken;
  try {
    idToken = await getFirebaseToken(req.locationId);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error:   'Firebase not connected. Call POST /funnel-builder/connect first.',
      detail:  err.message,
    });
  }

  // Step 1b: Auto-detect pageId from funnelId if not provided
  let resolvedPageId = pageId;
  if (!resolvedPageId && funnelId) {
    try {
      const result = await ghlClient.ghlRequest(req.locationId, 'GET', '/funnels/page', null, {
        locationId: req.locationId, funnelId, limit: 20, offset: '0',
      });
      const pages = result?.funnelPages || result?.pages || result?.pageList || result?.list || result?.data
                 || (Array.isArray(result) ? result : []);
      if (!pages.length) {
        return res.status(400).json({ success: false, error: 'No pages found in this funnel. Add a page in GHL first.' });
      }
      pages.sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));
      resolvedPageId = pages[0].id || pages[0]._id;
      console.log(`[FunnelBuilder] Auto-detected pageId: ${resolvedPageId} (first page in funnel ${funnelId})`);
    } catch (err) {
      return res.status(502).json({ success: false, error: `Failed to list funnel pages: ${err.message}` });
    }
  }

  // Step 2: Optionally fetch existing page context
  let pageContext = null;
  try {
    pageContext = await getPageData(req.locationId, resolvedPageId);
  } catch (err) {
    // Non-fatal — 404 is normal for new pages, log only unexpected errors
    if (!err.message.includes('404')) {
      console.warn(`[FunnelBuilder] Could not fetch page context for ${resolvedPageId}:`, err.message);
    }
  }

  // Step 2b: Load selected agent (optional)
  let selectedAgent = null;
  if (agentId) {
    try {
      selectedAgent = await agentStore.getAgent(req.locationId, agentId);
    } catch (err) {
      console.warn(`[FunnelBuilder] Could not load agent ${agentId}:`, err.message);
    }
  }

  // Step 2c: RAG context from agent knowledge base (optional)
  let ragContext = '';
  if (agentId && chroma.isEnabled()) {
    try {
      const ragQuery = `${niche} ${offer} ${audience || ''} ${extraContext || ''}`.trim();
      const chunks   = await chroma.queryKnowledge(req.locationId, agentId, ragQuery, 5);
      if (chunks.length > 0) {
        ragContext = `\n\nRelevant knowledge base context for this agent:\n${chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')}`;
      }
    } catch (e) {
      console.warn('[FunnelBuilder] RAG query failed:', e.message);
    }
  }

  // Step 3: Build Claude prompt
  const pageLabel    = pageType || 'Sales Page';
  const colors       = colorScheme || 'modern, professional — use white, dark navy, and gold accents';
  const imgKeyword   = (niche || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').find(Boolean) || 'business';
  const contextBlock = pageContext
    ? `\nExisting page context (use as reference for any brand/funnel details):\n${JSON.stringify(pageContext, null, 2).slice(0, 1500)}`
    : '';

  const agentIntro = selectedAgent
    ? `You are ${selectedAgent.name}. ${selectedAgent.persona || ''}\n\nYour training and instructions:\n${selectedAgent.instructions}${ragContext}\n\n---\n\n`
    : '';

  const provider = aiService.getProvider();
  const isGroq   = provider?.name === 'groq';

  // Groq compact schema — no mobileStyles, minimal style props to save tokens
  const groqSystemPrompt = `${agentIntro}You are a GHL funnel page JSON generator. Output ONLY valid JSON, no explanation.
Root: {"sections":[...]}
IDs MUST be unique using format {elementType}-{8 random alphanumeric chars}. Generate truly random chars — NEVER use sequential numbers like 0001, 12345. Styles use {"value":X,"unit":"px"} or {"value":"#HEX"} format.

Element types (use EXACTLY these type names — heading NOT headline, sub-heading NOT sub-headline):
- heading: {"id":"heading-a1b2c3d4","type":"heading","tag":"h1","text":"Headline text","styles":{"color":{"value":"#111"},"fontSize":{"value":48,"unit":"px"},"fontWeight":{"value":"700"}},"mobileStyles":{}}
- sub-heading: {"id":"sub-heading-e5f6g7h8","type":"sub-heading","text":"Subheading text","styles":{"color":{"value":"#444"},"fontSize":{"value":22,"unit":"px"}},"mobileStyles":{}}
- paragraph: {"id":"paragraph-X","type":"paragraph","text":"Plain text body copy. No HTML tags.","styles":{"color":{"value":"#555"},"fontSize":{"value":16,"unit":"px"}},"mobileStyles":{}}
- button: {"id":"button-X","type":"button","text":"Button label","link":"#","styles":{"backgroundColor":{"value":"#1D4ED8"},"color":{"value":"#fff"},"fontSize":{"value":16,"unit":"px"},"paddingTop":{"value":14,"unit":"px"},"paddingBottom":{"value":14,"unit":"px"},"paddingLeft":{"value":32,"unit":"px"},"paddingRight":{"value":32,"unit":"px"},"borderRadius":{"value":6,"unit":"px"}},"mobileStyles":{}}
- bulletList: {"id":"bulletList-X","type":"bulletList","items":["Benefit one","Benefit two","Benefit three"],"icon":{"name":"check","unicode":"f00c","fontFamily":"Font Awesome 5 Free"},"styles":{"color":{"value":"#111"},"fontSize":{"value":16,"unit":"px"}},"mobileStyles":{}}

Section wrapper: {"id":"section-X","type":"section","name":"name","allowRowMaxWidth":false,"styles":{"backgroundColor":{"value":"#fff"},"paddingTop":{"value":60,"unit":"px"},"paddingBottom":{"value":60,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},"mobileStyles":{},"children":[{"id":"row-X","type":"row","children":[{"id":"column-X","type":"column","width":12,"styles":{"textAlign":{"value":"center"}},"mobileStyles":{},"children":[ELEMENTS]}]}]}`;

  const fullSystemPrompt = `${agentIntro}You are an expert GoHighLevel funnel designer and copywriter. Generate complete, production-ready native GHL page JSON.

RULES:
1. Respond with ONLY valid JSON — no markdown, no code fences, no explanation.
2. Root object: { "sections": [ ... ] }
3. All IDs: type-XXXXXXXX (8 random alphanumeric chars).
4. Use persuasive, benefit-driven copy for the target audience.
5. Mobile styles reduce padding/font sizes to ~60% of desktop.
6. CRITICAL: Use "heading" (NOT "headline") and "sub-heading" (NOT "sub-headline") for element types.
7. CRITICAL: paragraph "text" must be plain text — NO HTML tags, no <p>, no <br>, no <strong>.
8. CRITICAL: bulletList "items" must be an array of plain strings — NOT objects. Example: ["Benefit 1","Benefit 2"]

SCHEMA:
{"sections":[{"id":"section-X","type":"section","name":"name","allowRowMaxWidth":false,
"styles":{"backgroundColor":{"value":"#HEX"},"paddingTop":{"value":80,"unit":"px"},"paddingBottom":{"value":80,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},
"mobileStyles":{"paddingTop":{"value":40,"unit":"px"},"paddingBottom":{"value":40,"unit":"px"}},
"children":[{"id":"row-X","type":"row","children":[{"id":"column-X","type":"column","width":12,
"styles":{"textAlign":{"value":"center"}},"mobileStyles":{},
"children":[
{"id":"heading-X","type":"heading","text":"Headline text here","tag":"h1","styles":{"color":{"value":"#111827"},"fontSize":{"value":52,"unit":"px"},"fontWeight":{"value":"700"},"lineHeight":{"value":1.2}},"mobileStyles":{"fontSize":{"value":32,"unit":"px"}}},
{"id":"sub-heading-X","type":"sub-heading","text":"Subheading text here","styles":{"color":{"value":"#374151"},"fontSize":{"value":24,"unit":"px"},"fontWeight":{"value":"500"}},"mobileStyles":{"fontSize":{"value":18,"unit":"px"}}},
{"id":"paragraph-X","type":"paragraph","text":"Plain text body copy here. No HTML tags whatsoever.","styles":{"color":{"value":"#4B5563"},"fontSize":{"value":18,"unit":"px"},"lineHeight":{"value":1.7}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
{"id":"button-X","type":"button","text":"CTA Text","link":"#","styles":{"backgroundColor":{"value":"#1D4ED8"},"color":{"value":"#FFFFFF"},"fontSize":{"value":18,"unit":"px"},"fontWeight":{"value":"700"},"paddingTop":{"value":16,"unit":"px"},"paddingBottom":{"value":16,"unit":"px"},"paddingLeft":{"value":40,"unit":"px"},"paddingRight":{"value":40,"unit":"px"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
{"id":"bulletList-X","type":"bulletList","items":["Benefit one plain text","Benefit two plain text","Benefit three plain text"],"icon":{"name":"check","unicode":"f00c","fontFamily":"Font Awesome 5 Free"},"styles":{"color":{"value":"#111827"},"fontSize":{"value":18,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
{"id":"image-X","type":"image","src":"https://picsum.photos/seed/${imgKeyword}/800/450","alt":"${imgKeyword}","styles":{"width":{"value":100,"unit":"%"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{}}
]}]}]}]}`;

  const systemPrompt = isGroq ? groqSystemPrompt : fullSystemPrompt;

  // Groq has tight token limits — generate a compact 3-section page; other providers get all 7
  const sectionsInstruction = isGroq
    ? `Build 3 sections: 1) Hero (H1 headline + subheading + CTA button), 2) Benefits (subheading + 4 bullet points), 3) Final CTA (headline + button). Keep copy concise.`
    : `Build a FULL page with these sections in order:
1. Hero section — bold H1 headline, compelling subheading, short paragraph hook, primary CTA button
2. Problem/Agitation section — speak to the pain points of the audience (paragraph + bullet list)
3. Solution/Benefits section — introduce the offer as the solution, 4-6 benefit bullets, supporting paragraph
4. Social Proof section — testimonial-style paragraph(s) with names, a results stat or two
5. Offer Details / Value Stack section — what they get, price anchoring, urgency element, CTA button
6. FAQ section — 3-4 common objections answered (paragraph elements)
7. Final CTA section — strong closing headline, urgency/scarcity line, final CTA button`;

  const userPrompt = `Generate a native GHL ${pageLabel} JSON for:

Business / Niche: ${niche}
Offer: ${offer}
Target Audience: ${audience || 'General prospects interested in the offer'}
Color Scheme: ${colors}
${extraContext ? `Additional Context: ${extraContext}` : ''}
${contextBlock}

${sectionsInstruction}

Output ONLY the JSON object. No markdown, no explanation.`;

  // Step 4: Call AI provider
  let pageJson;
  try {
    const rawText = (await aiService.generate(systemPrompt, userPrompt, { maxTokens: 4096 })).trim();
    pageJson = parseJsonSafe(rawText);
    if (!pageJson.sections || !Array.isArray(pageJson.sections)) {
      throw new Error('AI response missing "sections" array.');
    }
  } catch (err) {
    console.error('[FunnelBuilder] AI generation error:', err.message);
    return res.status(500).json({
      success: false,
      error:   'Failed to generate page JSON: ' + err.message,
    });
  }

  // Step 5: Save to GHL backend (Firestore + Storage)
  let saveResult;
  try {
    saveResult = await saveWithFunnelHint(req.locationId, resolvedPageId, pageJson, funnelId);
  } catch (err) {
    console.error('[FunnelBuilder] savePageData error:', err.message);
    return res.status(500).json({
      success: false,
      error:   'Page JSON generated but failed to save to GHL.',
      detail:  err.message,
      hint:    err.message.includes('403') ? 'Firebase token expired. Use the bookmarklet to reconnect.' : undefined,
      pageJson,
    });
  }

  // Step 5b: POST to GHL's native copilot save endpoint (same as GHL's "Ask AI")
  try {
    const { buildBackendHeaders } = require('../services/ghlPageBuilder');
    const fbTok2    = await getFirebaseToken(req.locationId);
    const beHdrs2   = buildBackendHeaders(fbTok2);
    const copilotBody = JSON.stringify({
      sections:            convertSectionsToGHL(pageJson.sections),
      pageDataDownloadUrl: saveResult.downloadUrl,
      pageDataUrl:         saveResult.storagePath,
      sectionVersion:      saveResult.sectionVersion,
      pageVersion:         saveResult.pageVersion,
      version:             saveResult.version,
    });
    const copilotPath = `/funnel-ai/copilot/page-data/${resolvedPageId}?locationId=${encodeURIComponent(req.locationId)}`;
    await new Promise((resolve) => {
      const r2 = https.request(
        { hostname: 'backend.leadconnectorhq.com', path: copilotPath, method: 'POST',
          headers: { ...beHdrs2, 'Content-Length': Buffer.byteLength(copilotBody) } },
        (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(r.statusCode)); }
      );
      r2.on('error', () => resolve(0));
      r2.write(copilotBody);
      r2.end();
    });
  } catch (e) {
    console.warn('[FunnelBuilder] copilot push warning:', e.message);
  }

  // Step 6: Build preview URL
  const previewUrl = funnelId
    ? `https://app.gohighlevel.com/v2/preview/${funnelId}/${resolvedPageId}`
    : null;

  res.json({
    success:      true,
    pageId:       resolvedPageId,
    previewUrl,
    sectionsCount: pageJson.sections.length,
    agentUsed:    selectedAgent ? { id: selectedAgent.id, name: selectedAgent.name, emoji: selectedAgent.emoji } : null,
    message:      `Page generated (${pageJson.sections.length} sections) and saved to GHL successfully.`,
    ghlResponse:  saveResult,
  });
});

// ── POST /generate-from-design — analyze Figma screenshot → GHL native page ──

router.post('/generate-from-design', upload.single('image'), async (req, res) => {
  const { funnelId, agentId, extraContext } = req.body;

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'An image file is required (field: "image").' });
  }
  if (!funnelId) {
    return res.status(400).json({ success: false, error: '"funnelId" is required.' });
  }
  if (!aiService.getProvider()) {
    return res.status(503).json({ success: false, error: 'No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.' });
  }

  // Ensure Firebase connected
  try { await getFirebaseToken(req.locationId); } catch (err) {
    return res.status(400).json({ success: false, error: 'Firebase not connected. Call POST /funnel-builder/connect first.', detail: err.message });
  }

  // Load agent + RAG context
  let selectedAgent = null;
  if (agentId) {
    try { selectedAgent = await agentStore.getAgent(req.locationId, agentId); } catch {}
  }
  let ragContext = '';
  if (agentId && chroma.isEnabled()) {
    try {
      const chunks = await chroma.queryKnowledge(req.locationId, agentId, extraContext || 'page design conversion', 5);
      if (chunks.length > 0) ragContext = `\n\nRelevant knowledge base context:\n${chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')}`;
    } catch {}
  }

  // Get pages from funnel
  let pages;
  try {
    const result = await ghlClient.ghlRequest(req.locationId, 'GET', '/funnels/page', null, {
      locationId: req.locationId, funnelId, limit: 20, offset: '0',
    });
    pages = result?.funnelPages || result?.pages || result?.pageList || result?.list || result?.data
         || (Array.isArray(result) ? result : []);
  } catch (err) {
    return res.status(502).json({ success: false, error: `Failed to list funnel pages: ${err.message}` });
  }

  if (!Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ success: false, needsPages: true, error: 'This funnel has no pages yet. Add pages in GHL first.' });
  }

  pages.sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));
  pages = pages.map(p => ({ ...p, id: p.id || p._id }));

  const imageBase64    = req.file.buffer.toString('base64');
  const imageMediaType = req.file.mimetype;

  const agentIntro = selectedAgent
    ? `You are ${selectedAgent.name}. ${selectedAgent.persona || ''}\n\n${selectedAgent.instructions}${ragContext}\n\n---\n\n`
    : '';

  const systemPrompt = `${agentIntro}You are an expert GoHighLevel funnel designer. You will be given a screenshot of a page design. Faithfully reconstruct it as a complete, production-ready native GHL page JSON.

RULES:
1. Respond with ONLY valid JSON — no markdown, no code fences, no explanation.
2. Root object: { "sections": [ ... ] }
3. Match the visual layout: section order, column structure, content hierarchy, colors, fonts.
4. Extract ALL text content visible in the design.
5. Match colors using hex codes.
6. All IDs: type-XXXXXXXX (8 random alphanumeric chars).
7. Mobile styles reduce padding/font sizes to ~60% of desktop values.
8. CRITICAL: Use "heading" (NOT "headline") and "sub-heading" (NOT "sub-headline") for element types.
9. CRITICAL: paragraph "text" must be plain text — NO HTML tags, no <p>, no <br>, no <strong>.
10. CRITICAL: bulletList "items" must be an array of plain strings — NOT objects. Example: ["Item 1","Item 2"]

SCHEMA:
{"sections":[{"id":"section-{8chars}","type":"section","name":"section-name","allowRowMaxWidth":false,
"styles":{"backgroundColor":{"value":"#HEX"},"paddingTop":{"value":80,"unit":"px"},"paddingBottom":{"value":80,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},
"mobileStyles":{"paddingTop":{"value":40,"unit":"px"},"paddingBottom":{"value":40,"unit":"px"}},
"children":[{"id":"row-{8chars}","type":"row","children":[{"id":"column-{8chars}","type":"column","width":12,"styles":{"textAlign":{"value":"center"}},"mobileStyles":{},
"children":[
{"id":"heading-{8chars}","type":"heading","text":"Headline text","tag":"h1","styles":{"color":{"value":"#111827"},"fontSize":{"value":52,"unit":"px"},"fontWeight":{"value":"700"}},"mobileStyles":{"fontSize":{"value":32,"unit":"px"}}},
{"id":"sub-heading-{8chars}","type":"sub-heading","text":"Subheading text","styles":{"color":{"value":"#374151"},"fontSize":{"value":24,"unit":"px"}},"mobileStyles":{"fontSize":{"value":18,"unit":"px"}}},
{"id":"paragraph-{8chars}","type":"paragraph","text":"Plain text body copy. No HTML tags.","styles":{"color":{"value":"#4B5563"},"fontSize":{"value":18,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
{"id":"button-{8chars}","type":"button","text":"CTA","link":"#","styles":{"backgroundColor":{"value":"#1D4ED8"},"color":{"value":"#FFF"},"fontSize":{"value":18,"unit":"px"},"paddingTop":{"value":16,"unit":"px"},"paddingBottom":{"value":16,"unit":"px"},"paddingLeft":{"value":40,"unit":"px"},"paddingRight":{"value":40,"unit":"px"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
{"id":"bulletList-{8chars}","type":"bulletList","items":["Plain text item 1","Plain text item 2","Plain text item 3"],"icon":{"name":"check","unicode":"f00c","fontFamily":"Font Awesome 5 Free"},"styles":{"color":{"value":"#111827"},"fontSize":{"value":18,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
{"id":"image-{8chars}","type":"image","src":"https://picsum.photos/seed/design/800/450","alt":"Image","styles":{"width":{"value":100,"unit":"%"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{}}
]}]}]}]}`;

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send('start', { total: pages.length, pages: pages.map(p => ({ id: p.id, name: p.name, stepOrder: p.stepOrder })) });

  const results = [];

  for (let i = 0; i < pages.length; i++) {
    const page     = pages[i];
    const pageType = inferPageType(page.name || '');
    send('page_start', { index: i, pageId: page.id, name: page.name, pageType });

    let pageJson, genError;
    try {
      const visionText = `Analyze this design screenshot and reconstruct it as a native GHL ${pageType} JSON (page ${i + 1} of ${pages.length}: "${page.name}"). Preserve the layout, section order, all text, colors, and hierarchy.${extraContext ? `\n\nUser notes: ${extraContext}` : ''}\n\nOutput ONLY the JSON object.`;
      const rawText = (await aiService.generateWithVision(systemPrompt, visionText, imageBase64, imageMediaType, { maxTokens: 8192 })).trim();
      pageJson = parseJsonSafe(rawText);
      if (!pageJson.sections || !Array.isArray(pageJson.sections)) throw new Error('AI response missing "sections" array.');
    } catch (err) {
      genError = err;
      console.error(`[FunnelBuilder] Vision error for "${page.name}":`, err.message);
    }

    if (genError) {
      send('page_error', { index: i, pageId: page.id, name: page.name, error: `AI generation failed: ${genError.message}` });
      results.push({ pageId: page.id, name: page.name, success: false, error: genError.message });
      continue;
    }

    try {
      const saveRes = await saveWithFunnelHint(req.locationId, page.id, pageJson, funnelId);
      const warn    = saveRes?.firestoreWarning;
      send('page_done', { index: i, pageId: page.id, name: page.name, pageType, sectionsCount: pageJson.sections.length, warning: warn || undefined });
      results.push({ pageId: page.id, name: page.name, pageType, success: true, sectionsCount: pageJson.sections.length, warning: warn || undefined });
    } catch (err) {
      console.error(`[FunnelBuilder] Save error for "${page.name}":`, err.message);
      send('page_error', { index: i, pageId: page.id, name: page.name, error: `Save failed: ${err.message}` });
      results.push({ pageId: page.id, name: page.name, success: false, error: err.message });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  send('complete', { total: pages.length, succeeded, failed: pages.length - succeeded, results });
  res.end();
});

// ── POST /write-test-sections — write known-good GHL native sections to Firestore ──
// Usage: POST /funnel-builder/write-test-sections { pageId }
// Writes hardcoded sections from a confirmed-working GHL native AI page,
// to test whether the write mechanism works regardless of our generated format.

router.post('/write-test-sections', async (req, res) => {
  const { pageId } = req.body;
  if (!pageId) return res.status(400).json({ error: '"pageId" required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  // Minimal known-good section from GHL's native AI (confirmed working format)
  const testSections = [
    {
      id: 'section-test-native',
      type: 'section',
      name: 'Test Hero',
      allowRowMaxWidth: false,
      styles: {
        backgroundColor: { value: '#FFFFFF' },
        paddingTop:       { value: 80, unit: 'px' },
        paddingRight:     { value: 20, unit: 'px' },
        paddingBottom:    { value: 80, unit: 'px' },
        paddingLeft:      { value: 20, unit: 'px' },
      },
      mobileStyles: {
        paddingTop:    { value: 40, unit: 'px' },
        paddingRight:  { value: 15, unit: 'px' },
        paddingBottom: { value: 40, unit: 'px' },
        paddingLeft:   { value: 15, unit: 'px' },
      },
      children: [{
        id:   'row-test-native',
        type: 'row',
        children: [{
          id:    'column-test-native',
          type:  'column',
          width: 12,
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
          children: [
            {
              id:   'heading-test-native',
              type: 'heading',
              text: 'Hello from HL Pro Tools AI',
              tag:  'h1',
              styles: {
                color:         { value: '#0F172A' },
                fontSize:      { value: 56, unit: 'px' },
                lineHeight:    { value: 1.05, unit: 'em' },
                textAlign:     { value: 'center' },
                marginTop:     { value: 0,  unit: 'px' },
                marginRight:   { value: 0,  unit: 'px' },
                marginBottom:  { value: 20, unit: 'px' },
                marginLeft:    { value: 0,  unit: 'px' },
                typography:    { value: 'var(--headlinefont)' },
                linkTextColor: { value: '#0F172A' },
              },
              mobileStyles: {
                fontSize:      { value: 40,  unit: 'px' },
                lineHeight:    { value: 1.1, unit: 'em' },
                marginTop:     { value: 0,   unit: 'px' },
                marginRight:   { value: 0,   unit: 'px' },
                marginBottom:  { value: 16,  unit: 'px' },
                marginLeft:    { value: 0,   unit: 'px' },
              },
            },
            {
              id:    'paragraph-test-native',
              type:  'paragraph',
              text:  'This test section was written by HL Pro Tools to verify the GHL editor renders our format correctly.',
              styles: {
                color:         { value: '#6B7280' },
                fontSize:      { value: 18, unit: 'px' },
                lineHeight:    { value: 1.6, unit: 'em' },
                textAlign:     { value: 'center' },
                marginTop:     { value: 0,  unit: 'px' },
                marginRight:   { value: 0,  unit: 'px' },
                marginBottom:  { value: 30, unit: 'px' },
                marginLeft:    { value: 0,  unit: 'px' },
                typography:    { value: 'var(--contentfont)' },
                linkTextColor: { value: '#6B7280' },
              },
              mobileStyles: {
                fontSize:     { value: 16, unit: 'px' },
                marginBottom: { value: 24, unit: 'px' },
              },
            },
          ],
        }],
      }],
    },
  ];

  // Write to Firestore using same method as savePageData
  const { savePageData } = require('../services/ghlPageBuilder');
  try {
    const result = await savePageData(req.locationId, pageId, { sections: testSections }, {});
    res.json({ success: true, message: 'Test sections written to Firestore + Storage', result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /ghl-push — push sections directly to GHL's backend save API ─────────
// Usage: POST /funnel-builder/ghl-push { pageId, funnelId }
// Tries known GHL backend endpoints to write sections, similar to what GHL's
// native AI does internally. This finds + uses the correct save API.

router.post('/ghl-push', async (req, res) => {
  const { pageId, funnelId } = req.body;
  if (!pageId) return res.status(400).json({ error: '"pageId" required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  const { buildBackendHeaders } = require('../services/ghlPageBuilder');
  const beHeaders = { ...buildBackendHeaders(idToken), 'Content-Type': 'application/json' };

  // Read current Firestore sections to push
  const projectId = 'highlevel-backend';
  const fsPath    = `/v1/projects/${projectId}/databases/(default)/documents/funnel_pages/${pageId}`;
  const fsRes = await new Promise(resolve => {
    const r2 = https.request({ hostname: 'firestore.googleapis.com', path: fsPath, method: 'GET', headers: { Authorization: `Bearer ${idToken}` } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); });
    r2.on('error', () => resolve({}));
    r2.end();
  });

  // Decode sections from Firestore arrayValue
  function decodeFirestore(v) {
    if (!v) return null;
    if ('stringValue'  in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue'  in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue'    in v) return null;
    if ('arrayValue'   in v) return (v.arrayValue.values || []).map(decodeFirestore);
    if ('mapValue'     in v) {
      const o = {};
      for (const [k, fv] of Object.entries(v.mapValue.fields || {})) o[k] = decodeFirestore(fv);
      return o;
    }
    return null;
  }

  const rawSections = fsRes?.fields?.sections;
  const sections    = rawSections ? decodeFirestore(rawSections) : [];
  const downloadUrl = fsRes?.fields?.page_data_download_url?.stringValue || '';

  const tryPost = (path, body) => new Promise(resolve => {
    const payload = JSON.stringify(body);
    const r2 = https.request(
      { hostname: 'backend.leadconnectorhq.com', path, method: 'POST',
        headers: { ...beHeaders, 'Content-Length': Buffer.byteLength(payload) } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve({ path, status: r.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ path, status: r.statusCode, data: d.slice(0, 200) }); }
      }); });
    r2.on('error', e => resolve({ path, status: 0, error: e.message }));
    r2.write(payload); r2.end();
  });

  const tryPut = (path, body) => new Promise(resolve => {
    const payload = JSON.stringify(body);
    const r2 = https.request(
      { hostname: 'backend.leadconnectorhq.com', path, method: 'PUT',
        headers: { ...beHeaders, 'Content-Length': Buffer.byteLength(payload) } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve({ path, status: r.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ path, status: r.statusCode, data: d.slice(0, 200) }); }
      }); });
    r2.on('error', e => resolve({ path, status: 0, error: e.message }));
    r2.write(payload); r2.end();
  });

  const pagePayload = { sections, pageDataDownloadUrl: downloadUrl, pageDataUrl: downloadUrl };

  const results = await Promise.all([
    tryPost(`/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, pagePayload),
    tryPut(`/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, pagePayload),
    tryPost(`/funnels/page/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, pagePayload),
    tryPut(`/funnels/page/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, pagePayload),
    tryPost(`/funnel-ai/copilot/save/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, pagePayload),
    tryPost(`/funnels/${funnelId || 'x'}/pages/${pageId}/save`, pagePayload),
  ]);

  const success = results.filter(r => r.status >= 200 && r.status < 300);
  res.json({ sectionsAvailable: sections.length, results: results.map(r => ({ path: r.path, status: r.status })), successPaths: success.map(r => r.path), successDetails: success });
});

// ── POST /copilot-push — push current Firestore sections via GHL's native copilot API ──
// Usage: POST /funnel-builder/copilot-push { pageId }
// Reads what's currently in Firestore for this page and POSTs it to GHL's
// funnel-ai/copilot/page-data endpoint — the same endpoint GHL's "Ask AI" uses.
// If this makes the editor show content, we know the copilot endpoint is required.

router.post('/copilot-push', async (req, res) => {
  const { pageId } = req.body;
  if (!pageId) return res.status(400).json({ error: '"pageId" required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  const { buildBackendHeaders } = require('../services/ghlPageBuilder');
  const beHeaders = buildBackendHeaders(idToken);
  const projectId = 'highlevel-backend';

  // 1. Read current sections from Firestore
  const fsPath = `/v1/projects/${projectId}/databases/(default)/documents/funnel_pages/${pageId}`;
  const fsRes  = await new Promise(resolve => {
    const r2 = https.request({ hostname: 'firestore.googleapis.com', path: fsPath, method: 'GET', headers: { Authorization: `Bearer ${idToken}` } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d }); } }); });
    r2.on('error', e => resolve({ status: 0, error: e.message }));
    r2.end();
  });

  if (fsRes.status >= 400) return res.status(fsRes.status).json({ error: 'Firestore read failed', data: fsRes.data });

  // Decode Firestore values to plain JS
  function decodeFS(v) {
    if (!v) return null;
    if ('stringValue'  in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue'  in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue'    in v) return null;
    if ('arrayValue'   in v) return (v.arrayValue.values || []).map(decodeFS);
    if ('mapValue'     in v) { const o = {}; for (const [k, fv] of Object.entries(v.mapValue.fields || {})) o[k] = decodeFS(fv); return o; }
    return null;
  }

  const f           = fsRes.data?.fields || {};
  const sections    = decodeFS(f.sections);
  const downloadUrl = f.page_data_download_url?.stringValue || '';
  const storagePath = f.page_data_url?.stringValue || '';
  const sv          = Number(f.section_version?.integerValue || 1);
  const pv          = Number(f.page_version?.integerValue || 1);
  const ver         = Number(f.version?.integerValue || 1);

  if (!sections || !sections.length) {
    return res.status(400).json({ error: 'No sections in Firestore for this page. Generate content first.' });
  }

  // 2. POST to GHL copilot save endpoint
  const copilotBody = JSON.stringify({ sections, pageDataDownloadUrl: downloadUrl, pageDataUrl: storagePath, sectionVersion: sv, pageVersion: pv, version: ver });
  const copilotPath = `/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(req.locationId)}`;
  const copilotRes  = await new Promise(resolve => {
    const r2 = https.request(
      { hostname: 'backend.leadconnectorhq.com', path: copilotPath, method: 'POST',
        headers: { ...beHeaders, 'Content-Length': Buffer.byteLength(copilotBody) } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d.slice(0, 500) }); } }); }
    );
    r2.on('error', e => resolve({ status: 0, error: e.message }));
    r2.write(copilotBody);
    r2.end();
  });

  res.json({
    message:       'Copilot push attempted',
    sectionsCount: sections.length,
    copilotPath,
    copilotStatus: copilotRes.status,
    copilotData:   copilotRes.data,
  });
});

// ── GET /ghl-raw — call GHL's actual backend APIs and return raw responses ─────
// Usage: GET /funnel-builder/ghl-raw?pageId=xxx
// Calls ALL known GHL backend endpoints for a page so we can see exactly what
// GHL's editor reads (vs what we write to Firestore/Storage).

router.get('/ghl-raw', async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '"pageId" query param required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  const { buildBackendHeaders } = require('../services/ghlPageBuilder');
  const beHeaders = buildBackendHeaders(idToken);
  delete beHeaders['Content-Type'];

  const callGHL = (hostname, path, extraHeaders = {}) => new Promise(resolve => {
    const req2 = https.request(
      { hostname, path, method: 'GET', headers: { ...beHeaders, ...extraHeaders } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, data: d }); }
      }); }
    );
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.end();
  });

  // Probe multiple GHL backend paths to find where the editor reads sections from
  const [copilotData, funnelPage, funnelPageV2] = await Promise.all([
    callGHL('backend.leadconnectorhq.com', `/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(req.locationId)}`),
    callGHL('backend.leadconnectorhq.com', `/funnels/page/${pageId}?locationId=${encodeURIComponent(req.locationId)}`),
    callGHL('backend.leadconnectorhq.com', `/funnels/page/${pageId}`),
  ]);

  // Summarize what each endpoint returned
  const summarize = (r) => ({
    status: r.status,
    error: r.error,
    keys: typeof r.data === 'object' && r.data ? Object.keys(r.data) : null,
    hasSections: typeof r.data === 'object' && r.data
      ? (Array.isArray(r.data.sections) ? `array[${r.data.sections.length}]` :
         typeof r.data.sections !== 'undefined' ? 'present (non-array)' : 'absent')
      : null,
    firstSection: typeof r.data === 'object' && Array.isArray(r.data.sections)
      ? JSON.stringify(r.data.sections[0]).slice(0, 600) : null,
    // Critical: show the actual URL the editor would download for page content
    pageDataDownloadUrl: r.data?.pageDataDownloadUrl ?? null,
    pageDataUrl:         r.data?.pageDataUrl ?? null,
    sectionVersion:      r.data?.sectionVersion ?? null,
    pageVersion:         r.data?.pageVersion ?? null,
    version:             r.data?.version ?? null,
    rawSlice: typeof r.data === 'string' ? r.data.slice(0, 300) : null,
  });

  // Also try to download the actual file from GHL's pageDataDownloadUrl
  const pageData = funnelPage.data?.pageDataDownloadUrl || funnelPageV2.data?.pageDataDownloadUrl;
  let storageContent = null;
  if (pageData) {
    try {
      const u = new URL(pageData);
      storageContent = await new Promise(resolve => {
        const req2 = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET' },
          (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
            try { resolve({ ok: true, keys: Object.keys(JSON.parse(d)), sectionCount: JSON.parse(d)?.sections?.length }); }
            catch { resolve({ ok: false, raw: d.slice(0, 200) }); }
          }); });
        req2.on('error', e => resolve({ ok: false, error: e.message }));
        req2.end();
      });
    } catch (e) { storageContent = { error: e.message }; }
  }

  res.json({
    pageId,
    locationId: req.locationId,
    '/funnel-ai/copilot/page-data': summarize(copilotData),
    '/funnels/page/{pageId}?locationId': summarize(funnelPage),
    '/funnels/page/{pageId}': summarize(funnelPageV2),
    storageFileFromGhlUrl: storageContent,
  });
});

// ── GET /page-data — fetch existing GHL page data from Firestore + Storage ────
// Usage: GET /funnel-builder/page-data?pageId=xxx

router.get('/page-data', async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '"pageId" query param required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  const projectId = 'highlevel-backend';
  const fsPath    = `/v1/projects/${projectId}/databases/(default)/documents/funnel_pages/${pageId}`;
  const fsRes     = await new Promise(resolve => {
    const req2 = https.request(
      { hostname: 'firestore.googleapis.com', path: fsPath, method: 'GET', headers: { Authorization: `Bearer ${idToken}` } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d }); } }); }
    );
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.end();
  });

  if (fsRes.status >= 400) return res.status(fsRes.status).json({ error: 'Firestore read failed', data: fsRes.data });

  const fields      = fsRes.data?.fields || {};
  const downloadUrl = fields.page_data_download_url?.stringValue;
  const sectionsRaw = fields.sections;

  let storageFile = null;
  if (downloadUrl) {
    const u    = new URL(downloadUrl);
    storageFile = await new Promise(resolve => {
      const req2 = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET' },
        (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); }
      );
      req2.on('error', () => resolve(null));
      req2.end();
    });
  }

  // Extract key metadata fields
  const sectionVersion = fields.section_version?.integerValue ?? fields.section_version?.stringValue ?? null;
  const pageVersion    = fields.page_version?.integerValue    ?? fields.page_version?.stringValue    ?? null;
  const templateType   = fields.template_type?.stringValue ?? null;

  res.json({
    pageId,
    firestoreFields:     Object.keys(fields),
    section_version:     sectionVersion,
    page_version:        pageVersion,
    template_type:       templateType,
    downloadUrl,
    // First section from Storage file (what GHL builder actually reads)
    storageFirstSection: Array.isArray(storageFile?.sections) ? storageFile.sections[0] : storageFile,
    storageSectionCount: Array.isArray(storageFile?.sections) ? storageFile.sections.length : null,
    // First section from Firestore sections field (decoded)
    firestoreSectionsPresent: !!sectionsRaw,
    firestoreSectionsSample:  sectionsRaw ? JSON.stringify(sectionsRaw).slice(0, 800) : null,
  });
});

// ── GET /list-pages — list pages in a funnel (debug / fetch) ─────────────────
// Usage: GET /funnel-builder/list-pages?funnelId=xxx

router.get('/list-pages', async (req, res) => {
  const { funnelId } = req.query;
  if (!funnelId) return res.status(400).json({ error: '"funnelId" query param required' });

  try {
    const result = await ghlClient.ghlRequest(req.locationId, 'GET', '/funnels/page', null, {
      locationId: req.locationId,
      funnelId,
      limit: 20,
      offset: '0',
    });
    const pages = result?.funnelPages || result?.pages || result?.pageList || result?.list || result?.data
               || (Array.isArray(result) ? result : []);
    res.json({ funnelId, count: pages.length, pages });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST /generate-funnel — list all funnel pages then generate each ──────────

// Infer page type from page name
function inferPageType(name = '') {
  const n = name.toLowerCase();
  if (/opt.?in|lead|capture|sign.?up|subscribe/.test(n))  return 'Opt-in / Lead Capture Page';
  if (/thank|thanks|confirm|success|welcome/.test(n))      return 'Thank You Page';
  if (/upsell|oto|one.time|bump/.test(n))                  return 'Upsell Page';
  if (/downsell|down.sell/.test(n))                        return 'Downsell Page';
  if (/order|checkout|payment|buy/.test(n))                return 'Order Page';
  if (/webinar|registration|register/.test(n))             return 'Webinar Registration Page';
  if (/vsl|video.?sales/.test(n))                          return 'VSL Page';
  return 'Sales Page';
}

const FUNNEL_TYPE_PAGES = {
  lead_gen:       [{ name: 'Opt-in Page',        url: 'opt-in',       stepOrder: 1 }, { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 2 }],
  sales:          [{ name: 'Opt-in Page',        url: 'opt-in',       stepOrder: 1 }, { name: 'Sales Page',          url: 'sales',        stepOrder: 2 }, { name: 'Order Page',          url: 'order',        stepOrder: 3 }, { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 4 }],
  vsl:            [{ name: 'VSL Page',           url: 'watch',        stepOrder: 1 }, { name: 'Order Page',          url: 'order',        stepOrder: 2 }, { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 3 }],
  webinar:        [{ name: 'Registration Page',  url: 'register',     stepOrder: 1 }, { name: 'Confirmation Page',   url: 'confirmation', stepOrder: 2 }, { name: 'Webinar Replay Page', url: 'replay',       stepOrder: 3 }, { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 4 }],
  tripwire:       [{ name: 'Opt-in Page',        url: 'opt-in',       stepOrder: 1 }, { name: 'Sales Page',          url: 'sales',        stepOrder: 2 }, { name: 'Upsell Page',         url: 'upsell',       stepOrder: 3 }, { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 4 }],
  product_launch: [{ name: 'Opt-in Page',        url: 'opt-in',       stepOrder: 1 }, { name: 'Sales Page',          url: 'sales',        stepOrder: 2 }, { name: 'Upsell Page',         url: 'upsell',       stepOrder: 3 }, { name: 'Downsell Page',       url: 'downsell',     stepOrder: 4 }, { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 5 }],
  application:    [{ name: 'Opt-in Page',        url: 'opt-in',       stepOrder: 1 }, { name: 'Application Page',    url: 'apply',        stepOrder: 2 }, { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 3 }],
  free_shipping:  [{ name: 'Sales Page',         url: 'free-offer',   stepOrder: 1 }, { name: 'Order Page',          url: 'order',        stepOrder: 2 }, { name: 'Upsell Page',         url: 'upsell',       stepOrder: 3 }, { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 4 }],
};

router.post('/generate-funnel', async (req, res) => {
  const { funnelId, funnelType, audience, colorScheme, extraContext, agentId } = req.body;
  const niche = req.body.niche || 'this business';
  const offer = req.body.offer || 'their offer';

  if (!funnelId) return res.status(400).json({ success: false, error: '"funnelId" is required.' });
  if (!aiService.getProvider()) return res.status(503).json({ success: false, error: 'No AI provider configured.' });

  // Ensure Firebase connected
  try { await getFirebaseToken(req.locationId); } catch (err) {
    return res.status(400).json({ success: false, error: 'Firebase not connected. Connect first.', detail: err.message });
  }

  // List pages in the funnel
  let pages;
  try {
    const result = await ghlClient.ghlRequest(req.locationId, 'GET', '/funnels/page', null, {
      locationId: req.locationId,
      funnelId,
      limit: 20,
      offset: '0',
    });
    pages = result?.funnelPages || result?.pages || result?.pageList || result?.list || result?.data
         || (Array.isArray(result) ? result : []);
  } catch (err) {
    return res.status(502).json({ success: false, error: `Failed to list funnel pages: ${err.message}` });
  }

  // If funnel has no pages, tell user which pages to create in GHL
  if (!Array.isArray(pages) || pages.length === 0) {
    const typePages = FUNNEL_TYPE_PAGES[funnelType] || FUNNEL_TYPE_PAGES.sales;
    const pageNames = typePages.map((p, i) => `${i + 1}. ${p.name}`).join(', ');
    return res.status(400).json({
      success: false,
      needsPages: true,
      error: `This funnel has no pages yet. Go to GHL → Funnels → open your funnel → add these pages: ${pageNames}. Then run Full Funnel again.`,
      pagesToCreate: typePages,
    });
  }

  // Sort by stepOrder
  pages.sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));

  // Set up SSE so UI gets live per-page progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Normalise page objects — GHL returns _id not id
  pages = pages.map(p => ({ ...p, id: p.id || p._id }));

  const provider = aiService.getProvider();
  const isGroq   = provider?.name === 'groq';
  const results  = [];

  send('log', { msg: `Using AI provider: ${provider?.name} (${provider?.model})`, level: 'info' });
  send('start', { total: pages.length, pages: pages.map(p => ({ id: p.id, name: p.name, stepOrder: p.stepOrder })) });
  send('log', { msg: `Found ${pages.length} page(s) in funnel`, level: 'info' });

  let agentInfo = null;
  if (agentId) {
    try { agentInfo = await agentStore.getAgent(req.locationId, agentId); } catch {}
  }

  for (let i = 0; i < pages.length; i++) {
    const page     = pages[i];
    const pageType = inferPageType(page.name || '');
    send('page_start', { index: i, pageId: page.id, name: page.name, pageType });
    send('log', { msg: `[${i+1}/${pages.length}] "${page.name}" — type: ${pageType}`, level: 'info' });

    // ── Step A: Read current page via Firebase backend to verify step ID ────
    send('log', { msg: `[${i+1}/${pages.length}] Reading current page from GHL...`, level: 'info' });
    let currentPage = null;
    try {
      const { buildBackendHeaders } = require('../services/ghlPageBuilder');
      const fbToken  = await getFirebaseToken(req.locationId);
      const beHdrs   = buildBackendHeaders(fbToken);
      delete beHdrs['Content-Type'];
      const pagePath = `/funnels/page/${page.id}?locationId=${encodeURIComponent(req.locationId)}`;
      const pageRes  = await new Promise((resolve, reject) => {
        const r2 = https.request(
          { hostname: 'backend.leadconnectorhq.com', path: pagePath, method: 'GET', headers: beHdrs },
          (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d }); } }); }
        );
        r2.on('error', reject);
        r2.end();
      });
      if (pageRes.status === 200) {
        currentPage = pageRes.data;
        const stepId           = currentPage.stepId || currentPage.step_id || 'unknown';
        const existingSections = Array.isArray(currentPage.sections) ? currentPage.sections.length : 0;
        const sv               = currentPage.sectionVersion ?? '-';
        send('log', { msg: `[${i+1}/${pages.length}] Verified: stepId=${stepId} | sectionVersion=${sv} | existing sections=${existingSections}`, level: 'success' });
      } else {
        send('log', { msg: `[${i+1}/${pages.length}] Page read returned ${pageRes.status} — continuing`, level: 'warn' });
      }
    } catch (err) {
      send('log', { msg: `[${i+1}/${pages.length}] Page read warning: ${err.message.slice(0, 80)}`, level: 'warn' });
    }

    const colors     = colorScheme || 'modern, professional — white, dark navy, and gold accents';
    const agentIntro = agentInfo ? `You are ${agentInfo.name}. ${agentInfo.persona || ''}\n${agentInfo.instructions}\n\n---\n\n` : '';
    const imgKw      = (niche || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').find(Boolean) || 'business';
    const randId     = () => Math.random().toString(36).slice(2, 10);

    const groqSysPrompt = `${agentIntro}You are a GHL funnel page JSON generator. Output ONLY valid JSON, no explanation.
Root: {"sections":[...]}. IDs MUST be unique per element using format {type}-{8 random alphanumeric chars}, e.g. section-${randId()}, row-${randId()}, column-${randId()}, heading-${randId()}. NEVER reuse IDs. Styles: {"value":X,"unit":"px"} or {"value":"#HEX"}.
CRITICAL: Use EXACTLY these element type names — "heading" (NOT headline), "sub-heading" (NOT sub-headline), "paragraph" (plain text, NO HTML tags), "button", "bulletList" (items = plain string array), "image".
Section: {"id":"section-${randId()}","type":"section","name":"n","allowRowMaxWidth":false,"styles":{"backgroundColor":{"value":"#fff"},"paddingTop":{"value":60,"unit":"px"},"paddingBottom":{"value":60,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},"mobileStyles":{},"children":[{"id":"row-${randId()}","type":"row","children":[{"id":"column-${randId()}","type":"column","width":12,"styles":{"textAlign":{"value":"center"}},"mobileStyles":{},"children":[ELEMENTS]}]}]}
Elements examples:
{"id":"heading-${randId()}","type":"heading","tag":"h1","text":"Your headline here","styles":{"color":{"value":"#111"},"fontSize":{"value":48,"unit":"px"}},"mobileStyles":{"fontSize":{"value":30,"unit":"px"}}}
{"id":"sub-heading-${randId()}","type":"sub-heading","text":"Your subheading here","styles":{"color":{"value":"#444"},"fontSize":{"value":22,"unit":"px"}},"mobileStyles":{"fontSize":{"value":18,"unit":"px"}}}
{"id":"paragraph-${randId()}","type":"paragraph","text":"Plain text body copy. No HTML tags.","styles":{"color":{"value":"#555"},"fontSize":{"value":16,"unit":"px"}},"mobileStyles":{"fontSize":{"value":15,"unit":"px"}}}
{"id":"button-${randId()}","type":"button","text":"Click Here","link":"#","styles":{"backgroundColor":{"value":"#1D4ED8"},"color":{"value":"#fff"},"fontSize":{"value":16,"unit":"px"},"paddingTop":{"value":14,"unit":"px"},"paddingBottom":{"value":14,"unit":"px"},"paddingLeft":{"value":32,"unit":"px"},"paddingRight":{"value":32,"unit":"px"},"borderRadius":{"value":6,"unit":"px"}},"mobileStyles":{}}
{"id":"bulletList-${randId()}","type":"bulletList","items":["Benefit one","Benefit two","Benefit three"],"icon":{"name":"check","unicode":"f00c","fontFamily":"Font Awesome 5 Free"},"styles":{"color":{"value":"#111"},"fontSize":{"value":16,"unit":"px"}},"mobileStyles":{}}`;

    const fullSysPrompt = `${agentIntro}You are an expert GoHighLevel funnel designer. Generate production-ready native GHL page JSON. Output ONLY valid JSON. Root: {"sections":[...]}.
CRITICAL: Use EXACTLY these element type names — "heading" (NOT headline), "sub-heading" (NOT sub-headline).
CRITICAL: paragraph "text" must be plain text — NO HTML tags, no <p>, no <br>.
CRITICAL: bulletList "items" must be plain string array — ["Item 1","Item 2"] NOT [{text:"Item 1"}].
Style format: {"value":X,"unit":"px"}. Include mobileStyles with ~60% desktop values.
For image elements use src "https://picsum.photos/seed/${imgKw}/800/450".`;

    const systemPrompt = isGroq ? groqSysPrompt : fullSysPrompt;

    const sectionsNote = isGroq
      ? `Build 3 sections:
1. Hero — heading (h1) + sub-heading + paragraph (plain text) + button
2. Benefits — sub-heading + bulletList (4 plain string items) + paragraph (plain text)
3. Final CTA — heading + paragraph (plain text) + button
Keep copy concise but persuasive.`
      : `Build a complete ${pageType} with ALL these sections:
1. Hero — bold heading h1, compelling sub-heading, short paragraph hook, primary CTA button
2. Problem/Pain — speak to audience pain points (sub-heading + paragraph + bulletList)
3. Solution/Benefits — introduce offer as solution, 5-6 benefit bullets, supporting paragraph
4. Social Proof — testimonial paragraphs with names, results stats
5. Offer Details — what they get, value stack, urgency, CTA button
6. FAQ — 3-4 objections answered (sub-heading + paragraph pairs)
7. Final CTA — strong closing heading, urgency line, final CTA button`;

    const userPrompt = `Generate a native GHL ${pageType} JSON (page ${i + 1} of ${pages.length}).
Page name: "${page.name}"
Niche: ${niche}
Offer: ${offer}
Audience: ${audience || 'General prospects'}
Color scheme: ${colors}
${extraContext ? `Extra context: ${extraContext}` : ''}

${sectionsNote}
Output ONLY the JSON object.`;

    send('log', { msg: `[${i+1}/${pages.length}] Calling AI (${provider?.name}) to generate content...`, level: 'info' });

    let pageJson;
    let genError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) {
          send('log', { msg: `[${i+1}/${pages.length}] Retry attempt ${attempt}/3...`, level: 'warn' });
          await new Promise(r => setTimeout(r, isGroq ? 5000 : 1000));
        }
        const retryNote = attempt > 1 ? '\n\nIMPORTANT: Your previous response had invalid JSON. Output ONLY a raw JSON object, no text before or after, no code fences, no comments.' : '';
        const raw = (await aiService.generate(systemPrompt, userPrompt + retryNote, { maxTokens: 4096 })).trim();
        pageJson  = parseJsonSafe(raw);
        if (!pageJson.sections) throw new Error('Missing sections array');
        const totalEls = pageJson.sections.reduce((sum, s) => sum + (s.children?.[0]?.children?.[0]?.children?.length || 0), 0);
        send('log', { msg: `[${i+1}/${pages.length}] AI generated ${pageJson.sections.length} sections, ${totalEls} elements`, level: 'success' });
        genError = null;
        break;
      } catch (err) {
        genError = err;
        send('log', { msg: `[${i+1}/${pages.length}] AI attempt ${attempt} failed: ${err.message.slice(0, 80)}`, level: 'warn' });
      }
    }
    if (genError) {
      send('log', { msg: `[${i+1}/${pages.length}] All AI attempts failed — skipping page`, level: 'error' });
      send('page_error', { index: i, pageId: page.id, name: page.name, error: `AI generation failed: ${genError.message}` });
      results.push({ pageId: page.id, name: page.name, success: false, error: genError.message });
      continue;
    }

    try {
      // ── Step C: Upload to Storage + write Firestore ──────────────────────
      send('log', { msg: `[${i+1}/${pages.length}] Uploading to Firebase Storage...`, level: 'info' });
      const saveRes = await saveWithFunnelHint(req.locationId, page.id, pageJson, funnelId);
      const warn    = saveRes?.firestoreWarning;
      if (warn) {
        send('log', { msg: `[${i+1}/${pages.length}] Firestore warning: ${warn.slice(0, 120)}`, level: 'warn' });
      } else {
        send('log', { msg: `[${i+1}/${pages.length}] Firestore updated (v${saveRes.version}, sectionV${saveRes.sectionVersion})`, level: 'success' });
      }

      // ── Step D: POST to GHL's native copilot save endpoint ───────────────
      // This is the same endpoint GHL's own "Ask AI" feature calls internally.
      send('log', { msg: `[${i+1}/${pages.length}] Pushing to GHL backend save API...`, level: 'info' });
      try {
        const { buildBackendHeaders } = require('../services/ghlPageBuilder');
        const fbToken2  = await getFirebaseToken(req.locationId);
        const beHdrs2   = buildBackendHeaders(fbToken2);
        const ghlSects  = convertSectionsToGHL(pageJson.sections);
        const copilotBody = JSON.stringify({
          sections:            ghlSects,
          pageDataDownloadUrl: saveRes.downloadUrl,
          pageDataUrl:         saveRes.storagePath,
          sectionVersion:      saveRes.sectionVersion,
          pageVersion:         saveRes.pageVersion,
          version:             saveRes.version,
        });
        const copilotPath = `/funnel-ai/copilot/page-data/${page.id}?locationId=${encodeURIComponent(req.locationId)}`;
        const copilotRes  = await new Promise((resolve, reject) => {
          const r2 = https.request(
            { hostname: 'backend.leadconnectorhq.com', path: copilotPath, method: 'POST',
              headers: { ...beHdrs2, 'Content-Length': Buffer.byteLength(copilotBody) } },
            (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
              try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
              catch { resolve({ status: r.statusCode, data: d.slice(0, 200) }); }
            }); }
          );
          r2.on('error', reject);
          r2.write(copilotBody);
          r2.end();
        });
        if (copilotRes.status >= 200 && copilotRes.status < 300) {
          send('log', { msg: `[${i+1}/${pages.length}] GHL copilot save OK (${copilotRes.status}) — editor will refresh`, level: 'success' });
        } else {
          send('log', { msg: `[${i+1}/${pages.length}] GHL copilot save returned ${copilotRes.status} — Firestore write still active`, level: 'warn' });
        }
      } catch (putErr) {
        send('log', { msg: `[${i+1}/${pages.length}] GHL copilot save error: ${putErr.message.slice(0, 80)}`, level: 'warn' });
      }

      send('page_done', { index: i, pageId: page.id, name: page.name, pageType, sectionsCount: pageJson.sections.length, warning: warn || undefined });
      results.push({ pageId: page.id, name: page.name, pageType, success: true, sectionsCount: pageJson.sections.length, warning: warn || undefined });
    } catch (err) {
      send('log', { msg: `[${i+1}/${pages.length}] Save error: ${err.message.slice(0, 120)}`, level: 'error' });
      send('page_error', { index: i, pageId: page.id, name: page.name, error: `Save failed: ${err.message}` });
      results.push({ pageId: page.id, name: page.name, success: false, error: err.message });
    }

    // Pace between pages for Groq TPM
    if (isGroq && i < pages.length - 1) {
      send('log', { msg: `Waiting 8s before next page (Groq rate limit)...`, level: 'info' });
      await new Promise(r => setTimeout(r, 8000));
    }
  }

  const succeeded = results.filter(r => r.success).length;
  send('log', { msg: `All done — ${succeeded}/${pages.length} pages generated successfully`, level: succeeded === pages.length ? 'success' : 'warn' });
  send('complete', { total: pages.length, succeeded, failed: pages.length - succeeded, results });
  res.end();
});

module.exports = router;
