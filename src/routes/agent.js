/**
 * src/routes/agent.js
 *
 * Mounts at /agent
 *
 * POST /agent/execute   — forward a structured prompt to the GHL Agent Studio webhook
 * POST /agent/generate  — use Claude to generate a structured agent brief, then optionally send it
 */

const express      = require('express');
const router       = express.Router();
const axios        = require('axios');
const authenticate = require('../middleware/authenticate');
const toolRegistry = require('../tools/toolRegistry');
const Anthropic    = require('@anthropic-ai/sdk');

router.use(authenticate);

async function getWebhookUrl(locationId) {
  const config = await toolRegistry.getToolConfig(locationId);
  return config?.ghl_agent?.webhookUrl || null;
}

// ── POST /agent/generate ─────────────────────────────────────────────────────
// Claude generates a rich, structured agent prompt from user inputs.
// Body: { niche, offer, audience, funnelType, pages, extraContext }
// Returns: { brief } — the generated prompt string

router.post('/generate', async (req, res) => {
  const { niche, offer, audience, funnelType, pages, extraContext } = req.body;
  if (!niche || !offer) {
    return res.status(400).json({ error: '"niche" and "offer" are required.' });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured.' });

  const pageList = Array.isArray(pages) && pages.length
    ? pages.join(', ')
    : 'Opt-in Page, Sales Page, Thank You Page';

  const prompt = `You are an expert GHL (GoHighLevel) funnel strategist and copywriter. Generate a complete, detailed agent prompt that a GHL Agent Studio AI agent will use to build a high-converting funnel natively inside GoHighLevel.

Business Details:
- Niche: ${niche}
- Offer: ${offer}
- Target Audience: ${audience || 'General audience'}
- Funnel Type: ${funnelType || 'Sales Funnel'}
- Pages to build: ${pageList}
${extraContext ? `- Extra context: ${extraContext}` : ''}

Generate a detailed agent instruction prompt that includes:
1. FUNNEL OVERVIEW — what this funnel achieves and who it's for
2. PAGE-BY-PAGE INSTRUCTIONS — for each page:
   - Page goal and primary action
   - Hero headline (main H1)
   - Subheadline
   - Body copy key points (3-5 bullet points)
   - Call-to-action button text and destination
   - Social proof / testimonial to include (fabricate realistic example)
   - Color mood (e.g. dark & bold, clean & minimal, warm & friendly)
3. BRAND VOICE — tone, style, personality
4. COPY HOOKS — 3 powerful hooks/angles to use throughout
5. OFFER STACK — how to present the offer value

Write this as direct instructions TO the GHL agent (start with "Build a [funnelType] for...").
Be extremely specific — include actual headline text, actual CTA copy, actual bullet points.
The agent should be able to build the entire funnel from this prompt alone without needing to ask questions.`;

  try {
    const client   = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      messages:   [{ role: 'user', content: prompt }],
    });
    const brief = response.content[0]?.text?.trim() || '';
    res.json({ success: true, brief });
  } catch (err) {
    console.error('[Agent] generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /agent/execute ──────────────────────────────────────────────────────
// Forward a prompt to the configured GHL Agent Studio webhook.
// Body: { brief, metadata? }

router.post('/execute', async (req, res) => {
  const { brief, metadata } = req.body;
  if (!brief) return res.status(400).json({ error: '"brief" is required.' });

  const webhookUrl = await getWebhookUrl(req.locationId);
  if (!webhookUrl) {
    return res.status(400).json({ error: 'GHL Agent webhook URL not configured. Add it in Settings → GHL Agent Studio.' });
  }

  try {
    await axios.post(webhookUrl, {
      prompt:     brief,
      locationId: req.locationId,
      source:     'hltools',
      timestamp:  new Date().toISOString(),
      ...(metadata || {}),
    }, {
      headers:        { 'Content-Type': 'application/json' },
      timeout:        15000,
      validateStatus: () => true,
    });

    res.json({ success: true, message: 'Agent triggered successfully. Check GHL for progress.' });
  } catch (err) {
    console.error('[Agent] execute error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
