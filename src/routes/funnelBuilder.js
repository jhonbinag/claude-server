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
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  return JSON.parse(jsonrepair(cleaned));
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
const { savePageData, getPageData } = require('../services/ghlPageBuilder');
const agentStore                    = require('../services/agentStore');
const ghlClient                     = require('../services/ghlClient');
const chroma                        = require('../services/chromaService');
const https                         = require('https');

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

  if (!pageId) {
    return res.status(400).json({ success: false, error: '"pageId" is required.' });
  }
  if (!niche || !offer) {
    return res.status(400).json({ success: false, error: '"niche" and "offer" are required.' });
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

  // Step 2: Optionally fetch existing page context
  let pageContext = null;
  try {
    pageContext = await getPageData(req.locationId, pageId);
  } catch (err) {
    // Non-fatal — 404 is normal for new pages, log only unexpected errors
    if (!err.message.includes('404')) {
      console.warn(`[FunnelBuilder] Could not fetch page context for ${pageId}:`, err.message);
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
IDs: type-XXXXXXXX (8 random chars). Styles use {"value":X,"unit":"px"} or {"value":"#HEX"} format.

Element types:
- heading: {"id":"heading-X","type":"heading","tag":"h1","text":"...","styles":{"color":{"value":"#111"},"fontSize":{"value":48,"unit":"px"},"fontWeight":{"value":"700"}},"mobileStyles":{}}
- sub-heading: {"id":"sub-heading-X","type":"sub-heading","text":"...","styles":{"color":{"value":"#444"},"fontSize":{"value":22,"unit":"px"}},"mobileStyles":{}}
- paragraph: {"id":"paragraph-X","type":"paragraph","text":"<p>...</p>","styles":{"color":{"value":"#555"},"fontSize":{"value":16,"unit":"px"}},"mobileStyles":{}}
- button: {"id":"button-X","type":"button","text":"...","link":"#","styles":{"backgroundColor":{"value":"#1D4ED8"},"color":{"value":"#fff"},"fontSize":{"value":16,"unit":"px"},"paddingTop":{"value":14,"unit":"px"},"paddingBottom":{"value":14,"unit":"px"},"paddingLeft":{"value":32,"unit":"px"},"paddingRight":{"value":32,"unit":"px"},"borderRadius":{"value":6,"unit":"px"}},"mobileStyles":{}}
- bulletList: {"id":"bulletList-X","type":"bulletList","items":[{"text":"..."}],"icon":{"name":"check","unicode":"f00c","fontFamily":"Font Awesome 5 Free"},"styles":{"color":{"value":"#111"},"fontSize":{"value":16,"unit":"px"}},"mobileStyles":{}}

Section wrapper: {"id":"section-X","type":"section","name":"name","allowRowMaxWidth":false,"styles":{"backgroundColor":{"value":"#fff"},"paddingTop":{"value":60,"unit":"px"},"paddingBottom":{"value":60,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},"mobileStyles":{},"children":[{"id":"row-X","type":"row","children":[{"id":"column-X","type":"column","width":12,"styles":{"textAlign":{"value":"center"}},"mobileStyles":{},"children":[ELEMENTS]}]}]}`;

  const fullSystemPrompt = `${agentIntro}You are an expert GoHighLevel funnel designer and copywriter. Generate complete, production-ready native GHL page JSON.

RULES:
1. Respond with ONLY valid JSON — no markdown, no code fences, no explanation.
2. Root object: { "sections": [ ... ] }
3. All IDs: type-XXXXXXXX (8 random alphanumeric chars).
4. Use persuasive, benefit-driven copy for the target audience.
5. Mobile styles reduce padding/font sizes to ~60% of desktop.

SCHEMA:
{"sections":[{"id":"section-X","type":"section","name":"name","allowRowMaxWidth":false,
"styles":{"backgroundColor":{"value":"#HEX"},"paddingTop":{"value":80,"unit":"px"},"paddingBottom":{"value":80,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},
"mobileStyles":{"paddingTop":{"value":40,"unit":"px"},"paddingBottom":{"value":40,"unit":"px"}},
"children":[{"id":"row-X","type":"row","children":[{"id":"column-X","type":"column","width":12,
"styles":{"textAlign":{"value":"center"}},"mobileStyles":{},
"children":[
{"id":"heading-X","type":"heading","text":"Headline","tag":"h1","styles":{"color":{"value":"#111827"},"fontSize":{"value":52,"unit":"px"},"fontWeight":{"value":"700"},"lineHeight":{"value":1.2}},"mobileStyles":{"fontSize":{"value":32,"unit":"px"}}},
{"id":"sub-heading-X","type":"sub-heading","text":"Subheadline","styles":{"color":{"value":"#374151"},"fontSize":{"value":24,"unit":"px"},"fontWeight":{"value":"500"}},"mobileStyles":{"fontSize":{"value":18,"unit":"px"}}},
{"id":"paragraph-X","type":"paragraph","text":"<p>Body copy.</p>","styles":{"color":{"value":"#4B5563"},"fontSize":{"value":18,"unit":"px"},"lineHeight":{"value":1.7}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
{"id":"button-X","type":"button","text":"CTA","link":"#","styles":{"backgroundColor":{"value":"#1D4ED8"},"color":{"value":"#FFFFFF"},"fontSize":{"value":18,"unit":"px"},"fontWeight":{"value":"700"},"paddingTop":{"value":16,"unit":"px"},"paddingBottom":{"value":16,"unit":"px"},"paddingLeft":{"value":40,"unit":"px"},"paddingRight":{"value":40,"unit":"px"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
{"id":"bulletList-X","type":"bulletList","items":[{"text":"Benefit 1"},{"text":"Benefit 2"},{"text":"Benefit 3"}],"icon":{"name":"check","unicode":"f00c","fontFamily":"Font Awesome 5 Free"},"styles":{"color":{"value":"#111827"},"fontSize":{"value":18,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
{"id":"image-X","type":"image","src":"https://placehold.co/800x450/1D4ED8/FFFFFF?text=Image","alt":"Image","styles":{"width":{"value":100,"unit":"%"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{}}
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

  // Step 5: Save to GHL backend
  let saveResult;
  try {
    saveResult = await savePageData(req.locationId, pageId, pageJson);
  } catch (err) {
    console.error('[FunnelBuilder] savePageData error:', err.message);

    // If it was a 401, give a helpful message about reconnecting
    if (err.message.includes('401')) {
      return res.status(401).json({
        success: false,
        error:   'Firebase token rejected by GHL. Please reconnect via POST /funnel-builder/connect.',
        detail:  err.message,
      });
    }

    return res.status(500).json({
      success: false,
      error:   'Page JSON generated but failed to save to GHL.',
      detail:  err.message,
      pageJson, // return the generated JSON so the client can retry or inspect it
    });
  }

  // Step 6: Build preview URL
  const previewUrl = funnelId
    ? `https://app.gohighlevel.com/v2/preview/${funnelId}/${pageId}`
    : null;

  res.json({
    success:      true,
    pageId,
    previewUrl,
    sectionsCount: pageJson.sections.length,
    agentUsed:    selectedAgent ? { id: selectedAgent.id, name: selectedAgent.name, emoji: selectedAgent.emoji } : null,
    message:      `Page generated (${pageJson.sections.length} sections) and saved to GHL successfully.`,
    ghlResponse:  saveResult,
  });
});

// ── POST /generate-from-design — analyze Figma screenshot → GHL native page ──

router.post('/generate-from-design', upload.single('image'), async (req, res) => {
  const {
    pageId,
    funnelId,
    agentId,
    extraContext,
  } = req.body;

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'An image file is required (field: "image").' });
  }
  if (!pageId) {
    return res.status(400).json({ success: false, error: '"pageId" is required.' });
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

  // Step 2: Load optional agent persona
  let selectedAgent = null;
  if (agentId) {
    try { selectedAgent = await agentStore.getAgent(req.locationId, agentId); } catch {}
  }

  // Step 3: RAG context if agent has knowledge base
  let ragContext = '';
  if (agentId && chroma.isEnabled()) {
    try {
      const chunks = await chroma.queryKnowledge(req.locationId, agentId, extraContext || 'page design conversion', 5);
      if (chunks.length > 0) {
        ragContext = `\n\nRelevant knowledge base context:\n${chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')}`;
      }
    } catch {}
  }

  // Step 4: Convert image to base64
  const imageBase64  = req.file.buffer.toString('base64');
  const imageMediaType = req.file.mimetype; // e.g. image/png

  const agentIntro = selectedAgent
    ? `You are ${selectedAgent.name}. ${selectedAgent.persona || ''}\n\n${selectedAgent.instructions}${ragContext}\n\n---\n\n`
    : '';

  const systemPrompt = `${agentIntro}You are an expert GoHighLevel funnel designer. You will be given a screenshot of a Figma (or other design tool) page layout. Your job is to faithfully reconstruct it as a complete, production-ready native GHL page JSON.

RULES:
1. Respond with ONLY valid JSON — no markdown, no code fences, no explanation.
2. Root object: { "sections": [ ... ] }
3. Match the visual layout as closely as possible: section order, column structure, content hierarchy, colors, fonts.
4. Extract ALL text content visible in the design — headlines, subheadings, paragraphs, button labels, list items.
5. Match colors from the design as closely as possible using hex codes.
6. All IDs: type-XXXXXXXX (8 random alphanumeric chars), e.g. "section-a1b2c3d4".
7. Mobile styles should reduce padding/font sizes (~50-60% of desktop values).
8. If the design contains placeholder images, keep them as image elements with placehold.co URLs matching the approximate dimensions and colors.

SCHEMA:
{
  "sections": [{
    "id": "section-{8chars}", "type": "section", "name": "section-name",
    "allowRowMaxWidth": false,
    "styles": {
      "backgroundColor": {"value": "#HEXCOLOR"},
      "paddingTop": {"value": 80, "unit": "px"}, "paddingBottom": {"value": 80, "unit": "px"},
      "paddingLeft": {"value": 20, "unit": "px"}, "paddingRight": {"value": 20, "unit": "px"}
    },
    "mobileStyles": {"paddingTop": {"value": 40, "unit": "px"}, "paddingBottom": {"value": 40, "unit": "px"}},
    "children": [{
      "id": "row-{8chars}", "type": "row",
      "children": [{
        "id": "column-{8chars}", "type": "column", "width": 12,
        "styles": {"textAlign": {"value": "center"}}, "mobileStyles": {},
        "children": [
          {"id": "heading-{8chars}", "type": "heading", "text": "Headline", "tag": "h1",
           "styles": {"color": {"value":"#111827"}, "fontSize": {"value":52,"unit":"px"}, "fontWeight": {"value":"700"}, "lineHeight": {"value":1.2}},
           "mobileStyles": {"fontSize": {"value":32,"unit":"px"}}},
          {"id": "sub-heading-{8chars}", "type": "sub-heading", "text": "Subheadline",
           "styles": {"color": {"value":"#374151"}, "fontSize": {"value":24,"unit":"px"}, "fontWeight": {"value":"500"}},
           "mobileStyles": {"fontSize": {"value":18,"unit":"px"}}},
          {"id": "paragraph-{8chars}", "type": "paragraph", "text": "<p>Body copy</p>",
           "styles": {"color": {"value":"#4B5563"}, "fontSize": {"value":18,"unit":"px"}, "lineHeight": {"value":1.7}},
           "mobileStyles": {"fontSize": {"value":16,"unit":"px"}}},
          {"id": "button-{8chars}", "type": "button", "text": "CTA Text", "link": "#",
           "styles": {"backgroundColor": {"value":"#1D4ED8"}, "color": {"value":"#FFFFFF"},
             "fontSize": {"value":18,"unit":"px"}, "fontWeight": {"value":"700"},
             "paddingTop": {"value":16,"unit":"px"}, "paddingBottom": {"value":16,"unit":"px"},
             "paddingLeft": {"value":40,"unit":"px"}, "paddingRight": {"value":40,"unit":"px"},
             "borderRadius": {"value":8,"unit":"px"}},
           "mobileStyles": {"fontSize": {"value":16,"unit":"px"}}},
          {"id": "bulletList-{8chars}", "type": "bulletList",
           "items": [{"text": "Item 1"}, {"text": "Item 2"}],
           "icon": {"name": "check", "unicode": "f00c", "fontFamily": "Font Awesome 5 Free"},
           "styles": {"color": {"value":"#111827"}, "fontSize": {"value":18,"unit":"px"}},
           "mobileStyles": {"fontSize": {"value":16,"unit":"px"}}},
          {"id": "image-{8chars}", "type": "image", "src": "https://placehold.co/800x450/1D4ED8/FFFFFF?text=Image", "alt": "Design image",
           "styles": {"width": {"value":100,"unit":"%"}, "borderRadius": {"value":8,"unit":"px"}},
           "mobileStyles": {}}
        ]
      }]
    }]
  }]
}`;

  // Step 5: Call AI Vision
  let pageJson;
  try {
    const visionText = `Analyze this design screenshot and reconstruct it as a complete native GHL page JSON. Preserve the visual layout, section order, all text content, colors, and hierarchy faithfully.${extraContext ? `\n\nAdditional context from user: ${extraContext}` : ''}\n\nOutput ONLY the JSON object, nothing else.`;
    const rawText = (await aiService.generateWithVision(systemPrompt, visionText, imageBase64, imageMediaType, { maxTokens: 8192 })).trim();
    pageJson = parseJsonSafe(rawText);
    if (!pageJson.sections || !Array.isArray(pageJson.sections)) {
      throw new Error('AI response missing "sections" array.');
    }
  } catch (err) {
    console.error('[FunnelBuilder] Vision generation error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to analyze design.', detail: err.message });
  }

  // Step 6: Save to GHL
  let saveResult;
  try {
    saveResult = await savePageData(req.locationId, pageId, pageJson);
  } catch (err) {
    console.error('[FunnelBuilder] savePageData error:', err.message);
    if (err.message.includes('401')) {
      return res.status(401).json({
        success: false,
        error:   'Firebase token rejected by GHL. Please reconnect.',
        pageJson,
      });
    }
    return res.status(500).json({
      success: false,
      error:   'Page JSON generated but failed to save to GHL.',
      detail:  err.message,
      pageJson,
    });
  }

  const previewUrl = funnelId
    ? `https://app.gohighlevel.com/v2/preview/${funnelId}/${pageId}`
    : null;

  res.json({
    success:       true,
    pageId,
    previewUrl,
    sectionsCount: pageJson.sections.length,
    agentUsed:     selectedAgent ? { id: selectedAgent.id, name: selectedAgent.name, emoji: selectedAgent.emoji } : null,
    message:       `Design analyzed (${pageJson.sections.length} sections) and saved to GHL successfully.`,
    ghlResponse:   saveResult,
    pageJson,
  });
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

  send('start', { total: pages.length, pages: pages.map(p => ({ id: p.id, name: p.name, stepOrder: p.stepOrder })) });

  const provider  = aiService.getProvider();
  const isGroq    = provider?.name === 'groq';
  const results   = [];

  let agentInfo = null;
  if (agentId) {
    try { agentInfo = await agentStore.getAgent(req.locationId, agentId); } catch {}
  }

  for (let i = 0; i < pages.length; i++) {
    const page     = pages[i];
    const pageType = inferPageType(page.name || '');
    send('page_start', { index: i, pageId: page.id, name: page.name, pageType });

    // Build prompts (reuse existing logic)
    const colors   = colorScheme || 'modern, professional — white, dark navy, and gold accents';
    const agentIntro = agentInfo ? `You are ${agentInfo.name}. ${agentInfo.persona || ''}\n${agentInfo.instructions}\n\n---\n\n` : '';
    const isGroqLocal = isGroq;

    const groqSysPrompt = `${agentIntro}You are a GHL funnel page JSON generator. Output ONLY valid JSON, no explanation.
Root: {"sections":[...]}. IDs: type-XXXXXXXX. Styles: {"value":X,"unit":"px"} or {"value":"#HEX"}.
Elements: heading(tag h1/h2/h3), sub-heading, paragraph(text as <p>html</p>), button(link,text), bulletList(items:[{text}],icon:{name:"check",unicode:"f00c",fontFamily:"Font Awesome 5 Free"}), image(src,alt).
Section: {"id":"section-X","type":"section","name":"n","allowRowMaxWidth":false,"styles":{"backgroundColor":{"value":"#fff"},"paddingTop":{"value":60,"unit":"px"},"paddingBottom":{"value":60,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},"mobileStyles":{},"children":[{"id":"row-X","type":"row","children":[{"id":"column-X","type":"column","width":12,"styles":{"textAlign":{"value":"center"}},"mobileStyles":{},"children":[ELEMENTS]}]}]}`;

    const fullSysPrompt = `${agentIntro}You are an expert GoHighLevel funnel designer. Generate production-ready native GHL page JSON. Output ONLY valid JSON. Root: {"sections":[...]}. Follow GHL schema with {"value":X,"unit":"px"} style format. Include mobileStyles with ~60% desktop values.`;

    const systemPrompt = isGroqLocal ? groqSysPrompt : fullSysPrompt;

    const sectionsNote = isGroqLocal
      ? `Build 3 sections: Hero (H1 + subheading + CTA), Benefits (4 bullet points), CTA (headline + button). Keep copy short.`
      : `Build a complete ${pageType} with all relevant sections: hero, benefits, social proof, CTA, and any page-type specific sections.`;

    const userPrompt = `Generate a native GHL ${pageType} JSON (step ${i + 1} of ${pages.length} in a funnel).
Page name: "${page.name}"
Niche: ${niche}
Offer: ${offer}
Audience: ${audience || 'General prospects'}
Color scheme: ${colors}
${extraContext ? `Extra context: ${extraContext}` : ''}

${sectionsNote}
Output ONLY the JSON object.`;

    let pageJson;
    try {
      const raw = (await aiService.generate(systemPrompt, userPrompt, { maxTokens: 4096 })).trim();
      pageJson  = parseJsonSafe(raw);
      if (!pageJson.sections) throw new Error('Missing sections array');
    } catch (err) {
      send('page_error', { index: i, pageId: page.id, name: page.name, error: `AI generation failed: ${err.message}` });
      results.push({ pageId: page.id, name: page.name, success: false, error: err.message });
      if (isGroq) await new Promise(r => setTimeout(r, 5000)); // pace for Groq
      continue;
    }

    try {
      await savePageData(req.locationId, page.id, pageJson);
      send('page_done', { index: i, pageId: page.id, name: page.name, pageType, sectionsCount: pageJson.sections.length });
      results.push({ pageId: page.id, name: page.name, pageType, success: true, sectionsCount: pageJson.sections.length });
    } catch (err) {
      send('page_error', { index: i, pageId: page.id, name: page.name, error: `Save failed: ${err.message}` });
      results.push({ pageId: page.id, name: page.name, success: false, error: err.message });
    }

    // Pace between pages for Groq TPM
    if (isGroq && i < pages.length - 1) await new Promise(r => setTimeout(r, 8000));
  }

  const succeeded = results.filter(r => r.success).length;
  send('complete', { total: pages.length, succeeded, failed: pages.length - succeeded, results });
  res.end();
});

module.exports = router;
