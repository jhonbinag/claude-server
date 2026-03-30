/**
 * src/routes/integrations.js — mounts at /integrations
 *
 * Public endpoints — NO user auth required. Uses own token/key auth.
 *
 * POST /integrations/webhook/:token   — 3rd party pushes data via webhook
 * GET  /integrations/api/:key         — 3rd party queries our AI API
 * POST /integrations/api/:key         — 3rd party pushes data or queries AI
 */

const express          = require('express');
const router           = express.Router();
const integrationStore = require('../services/integrationStore');
const Anthropic        = require('@anthropic-ai/sdk');

let _client = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// ── POST /integrations/webhook/:token ─────────────────────────────────────────
// 3rd party (Zapier, GHL, etc.) posts data here

router.post('/webhook/:token', async (req, res) => {
  try {
    const integration = await integrationStore.getByWebhookToken(req.params.token);
    if (!integration) return res.status(404).json({ success: false, error: 'Unknown webhook token' });
    if (integration.status !== 'active') return res.status(403).json({ success: false, error: 'Integration inactive' });

    await integrationStore.updateLastPayload(integration.integrationId, req.body);
    console.log(`[Integrations] Webhook received for "${integration.name}" (${integration.clientName})`);
    res.json({ success: true, received: true });
  } catch (err) {
    console.error('[Integrations] Webhook error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /integrations/api/:key?q=your+query ───────────────────────────────────
// 3rd party queries our AI with a question

router.get('/api/:key', async (req, res) => {
  try {
    const integration = await integrationStore.getByOurApiKey(req.params.key);
    if (!integration) return res.status(404).json({ success: false, error: 'Unknown API key' });
    if (integration.status !== 'active') return res.status(403).json({ success: false, error: 'Integration inactive' });
    if (!integration.allowQuery) return res.status(403).json({ success: false, error: 'Query mode not enabled for this integration' });

    const query = (req.query.q || req.query.query || '').trim();
    if (!query) return res.json({ success: true, integration: integration.name, status: 'ready', hint: 'Pass ?q=your+question to query the AI' });

    const context = integration.lastPayload
      ? `\n\nRECENT DATA FROM ${integration.name.toUpperCase()}:\n${typeof integration.lastPayload === 'string' ? integration.lastPayload : JSON.stringify(integration.lastPayload, null, 2)}`
      : '';

    const msg = await client().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: `${query}${context}` }],
    });

    res.json({ success: true, answer: msg.content[0]?.text || '', integration: integration.name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /integrations/api/:key ───────────────────────────────────────────────
// 3rd party pushes data, or sends { query } to get an AI response

router.post('/api/:key', async (req, res) => {
  try {
    const integration = await integrationStore.getByOurApiKey(req.params.key);
    if (!integration) return res.status(404).json({ success: false, error: 'Unknown API key' });
    if (integration.status !== 'active') return res.status(403).json({ success: false, error: 'Integration inactive' });

    const { query, data, ...rest } = req.body || {};
    const payload = data || rest || {};

    // Always store the payload
    if (Object.keys(payload).length > 0 || data) {
      await integrationStore.updateLastPayload(integration.integrationId, payload);
    }

    // If a query is also included, run it through AI and return a response
    if (query && integration.allowQuery) {
      const context = Object.keys(payload).length > 0
        ? `\n\nData provided:\n${JSON.stringify(payload, null, 2)}`
        : (integration.lastPayload ? `\n\nStored data:\n${typeof integration.lastPayload === 'string' ? integration.lastPayload : JSON.stringify(integration.lastPayload, null, 2)}` : '');

      const msg = await client().messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: `${query}${context}` }],
      });

      return res.json({ success: true, answer: msg.content[0]?.text || '', stored: Object.keys(payload).length > 0 });
    }

    res.json({ success: true, stored: true, integration: integration.name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
