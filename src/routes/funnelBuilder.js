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
const Anthropic    = require('@anthropic-ai/sdk');
const authenticate = require('../middleware/authenticate');
const {
  connectFirebase,
  disconnectFirebase,
  getFirebaseToken,
  getStatus,
} = require('../services/ghlFirebaseService');
const { savePageData, getPageData } = require('../services/ghlPageBuilder');
const agentStore                    = require('../services/agentStore');

router.use(authenticate);

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

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return res.status(503).json({ success: false, error: 'ANTHROPIC_API_KEY not configured.' });
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
    // Non-fatal — continue without existing context
    console.warn(`[FunnelBuilder] Could not fetch page context for ${pageId}:`, err.message);
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

  // Step 3: Build Claude prompt
  const pageLabel    = pageType || 'Sales Page';
  const colors       = colorScheme || 'modern, professional — use white, dark navy, and gold accents';
  const contextBlock = pageContext
    ? `\nExisting page context (use as reference for any brand/funnel details):\n${JSON.stringify(pageContext, null, 2).slice(0, 1500)}`
    : '';

  const agentIntro = selectedAgent
    ? `You are ${selectedAgent.name}. ${selectedAgent.persona || ''}\n\nYour training and instructions:\n${selectedAgent.instructions}\n\n---\n\n`
    : '';

  const systemPrompt = `${agentIntro}You are an expert GoHighLevel funnel designer and copywriter. Your job is to generate complete, production-ready native GHL page JSON that follows the exact GoHighLevel page builder schema.

RULES:
1. Respond with ONLY valid JSON — no markdown, no code fences, no explanation text.
2. The root object must be exactly: { "sections": [ ... ] }
3. Follow the schema below precisely for every element type.
4. Generate a COMPLETE, high-converting ${pageLabel} — include ALL sections (hero, benefits, social proof, CTA, footer).
5. All IDs must use the format: type-XXXXXXXX (8 random alphanumeric chars), e.g. "section-a1b2c3d4".
6. Use persuasive, benefit-driven copy that addresses the target audience directly.
7. Mobile styles should reduce padding/font sizes appropriately (roughly 50-60% of desktop).

SCHEMA:
{
  "sections": [
    {
      "id": "section-{8chars}",
      "type": "section",
      "name": "descriptive-section-name",
      "allowRowMaxWidth": false,
      "styles": {
        "backgroundColor": { "value": "#HEXCOLOR" },
        "paddingTop":    { "value": 80, "unit": "px" },
        "paddingBottom": { "value": 80, "unit": "px" },
        "paddingLeft":   { "value": 20, "unit": "px" },
        "paddingRight":  { "value": 20, "unit": "px" }
      },
      "mobileStyles": {
        "paddingTop":    { "value": 40, "unit": "px" },
        "paddingBottom": { "value": 40, "unit": "px" }
      },
      "children": [
        {
          "id": "row-{8chars}",
          "type": "row",
          "children": [
            {
              "id": "column-{8chars}",
              "type": "column",
              "width": 12,
              "styles": { "textAlign": { "value": "center" } },
              "mobileStyles": {},
              "children": [
                // ELEMENT TYPES — use exactly as shown:

                // Heading (H1):
                { "id": "heading-{8chars}", "type": "heading", "text": "Your Headline Here", "tag": "h1",
                  "styles": { "color": {"value":"#111827"}, "fontSize": {"value":52,"unit":"px"}, "fontWeight": {"value":"700"}, "lineHeight": {"value":1.2} },
                  "mobileStyles": { "fontSize": {"value":32,"unit":"px"} } },

                // Subheading:
                { "id": "sub-heading-{8chars}", "type": "sub-heading", "text": "Subheadline text here",
                  "styles": { "color": {"value":"#374151"}, "fontSize": {"value":24,"unit":"px"}, "fontWeight": {"value":"500"} },
                  "mobileStyles": { "fontSize": {"value":18,"unit":"px"} } },

                // Paragraph:
                { "id": "paragraph-{8chars}", "type": "paragraph", "text": "<p>Body copy with <strong>bold</strong> and emphasis.</p>",
                  "styles": { "color": {"value":"#4B5563"}, "fontSize": {"value":18,"unit":"px"}, "lineHeight": {"value":1.7} },
                  "mobileStyles": { "fontSize": {"value":16,"unit":"px"} } },

                // Button:
                { "id": "button-{8chars}", "type": "button", "text": "CTA Text Here", "link": "#",
                  "styles": { "backgroundColor": {"value":"#1D4ED8"}, "color": {"value":"#FFFFFF"},
                    "fontSize": {"value":18,"unit":"px"}, "fontWeight": {"value":"700"},
                    "paddingTop": {"value":16,"unit":"px"}, "paddingBottom": {"value":16,"unit":"px"},
                    "paddingLeft": {"value":40,"unit":"px"}, "paddingRight": {"value":40,"unit":"px"},
                    "borderRadius": {"value":8,"unit":"px"} },
                  "mobileStyles": { "fontSize": {"value":16,"unit":"px"} } },

                // Bullet list:
                { "id": "bulletList-{8chars}", "type": "bulletList",
                  "items": [ {"text": "Benefit one"}, {"text": "Benefit two"}, {"text": "Benefit three"} ],
                  "icon": { "name": "check", "unicode": "f00c", "fontFamily": "Font Awesome 5 Free" },
                  "styles": { "color": {"value":"#111827"}, "fontSize": {"value":18,"unit":"px"} },
                  "mobileStyles": { "fontSize": {"value":16,"unit":"px"} } },

                // Image:
                { "id": "image-{8chars}", "type": "image", "src": "https://placehold.co/800x450/1D4ED8/FFFFFF?text=Image", "alt": "Description",
                  "styles": { "width": {"value":100,"unit":"%"}, "borderRadius": {"value":8,"unit":"px"} },
                  "mobileStyles": {} }
              ]
            }
          ]
        }
      ]
    }
  ]
}`;

  const userPrompt = `Generate a complete, high-converting native GHL ${pageLabel} JSON for:

Business / Niche: ${niche}
Offer: ${offer}
Target Audience: ${audience || 'General prospects interested in the offer'}
Color Scheme: ${colors}
${extraContext ? `Additional Context: ${extraContext}` : ''}
${funnelId ? `Funnel ID (for reference): ${funnelId}` : ''}
${contextBlock}

Build a FULL page with these sections in order:
1. Hero section — bold H1 headline, compelling subheading, short paragraph hook, primary CTA button
2. Problem/Agitation section — speak to the pain points of the audience (paragraph + bullet list)
3. Solution/Benefits section — introduce the offer as the solution, 4-6 benefit bullets, supporting paragraph
4. Social Proof section — testimonial-style paragraph(s) with names, a results stat or two
5. Offer Details / Value Stack section — what they get, price anchoring, urgency element, CTA button
6. FAQ section — 3-4 common objections answered (paragraph elements)
7. Final CTA section — strong closing headline, urgency/scarcity line, final CTA button

Remember: output ONLY the JSON object. No markdown, no explanation.`;

  // Step 4: Call Claude
  let pageJson;
  try {
    const client   = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0]?.text?.trim() || '';

    // Strip any accidental markdown code fences
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    pageJson = JSON.parse(cleaned);

    if (!pageJson.sections || !Array.isArray(pageJson.sections)) {
      throw new Error('Claude response missing "sections" array.');
    }
  } catch (err) {
    console.error('[FunnelBuilder] Claude generation error:', err.message);
    return res.status(500).json({
      success: false,
      error:   'Failed to generate page JSON.',
      detail:  err.message,
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

module.exports = router;
