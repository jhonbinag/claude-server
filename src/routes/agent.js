/**
 * src/routes/agent.js
 *
 * Mounts at /agent
 *
 * GET    /agent/agents            — list agents for location
 * POST   /agent/agents            — create agent
 * PUT    /agent/agents/:id        — update agent
 * DELETE /agent/agents/:id        — delete agent
 * POST   /agent/agents/:id/execute — generate brief + trigger GHL Agent Studio webhook
 * POST   /agent/generate          — standalone brief generator (no agent needed)
 */

const express      = require('express');
const router       = express.Router();
const axios        = require('axios');
const authenticate = require('../middleware/authenticate');
const agentStore   = require('../services/agentStore');
const Anthropic    = require('@anthropic-ai/sdk');

router.use(authenticate);

// ── List agents ───────────────────────────────────────────────────────────────

router.get('/agents', async (req, res) => {
  try {
    const list = await agentStore.listAgents(req.locationId);
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Create agent ──────────────────────────────────────────────────────────────

router.post('/agents', async (req, res) => {
  const { name, emoji, role, persona, instructions, webhookUrl, allowedTools } = req.body;
  if (!name || !instructions) {
    return res.status(400).json({ success: false, error: '"name" and "instructions" are required.' });
  }
  try {
    const agent = await agentStore.saveAgent(req.locationId, {
      name, emoji: emoji || '🤖', role: role || 'custom',
      persona, instructions, webhookUrl, allowedTools: allowedTools || [],
    });
    res.json({ success: true, data: agent });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Update agent ──────────────────────────────────────────────────────────────

router.put('/agents/:id', async (req, res) => {
  try {
    const existing = await agentStore.getAgent(req.locationId, req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Agent not found.' });
    const agent = await agentStore.saveAgent(req.locationId, { ...existing, ...req.body, id: req.params.id });
    res.json({ success: true, data: agent });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Delete agent ──────────────────────────────────────────────────────────────

router.delete('/agents/:id', async (req, res) => {
  try {
    await agentStore.deleteAgent(req.locationId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Execute agent ─────────────────────────────────────────────────────────────
// Generates a task brief using the agent's persona + instructions as context,
// then sends it to the agent's configured GHL webhook.

router.post('/agents/:id/execute', async (req, res) => {
  const { task, niche, offer, audience, funnelType, pages, extraContext } = req.body;
  if (!task && !niche) {
    return res.status(400).json({ success: false, error: 'Provide "task" or "niche" + "offer".' });
  }

  try {
    const agent = await agentStore.getAgent(req.locationId, req.params.id);
    if (!agent) return res.status(404).json({ success: false, error: 'Agent not found.' });

    if (!agent.webhookUrl) {
      return res.status(400).json({ success: false, error: 'This agent has no GHL webhook URL configured.' });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured.' });

    // Build the task description
    const taskDescription = task || [
      niche         && `Niche/Business: ${niche}`,
      offer         && `Offer: ${offer}`,
      audience      && `Target Audience: ${audience}`,
      funnelType    && `Funnel Type: ${funnelType}`,
      pages?.length && `Pages: ${pages.join(', ')}`,
      extraContext  && `Extra context: ${extraContext}`,
    ].filter(Boolean).join('\n');

    // Generate a structured execution brief using the agent's persona
    const systemPrompt = `You are ${agent.name}. ${agent.persona || ''}

Your core instructions and training:
${agent.instructions}

Your job is to generate a complete, detailed execution brief that GHL Agent Studio will follow step-by-step to complete the requested task inside GoHighLevel. Be extremely specific — include actual copy, headlines, CTAs, color suggestions, and step-by-step build instructions. The GHL agent must be able to execute this without any follow-up questions.`;

    const client   = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model:     'claude-sonnet-4-6',
      max_tokens: 2048,
      system:    systemPrompt,
      messages:  [{ role: 'user', content: `Complete this task inside GHL:\n\n${taskDescription}` }],
    });

    const brief = response.content[0]?.text?.trim() || '';

    // Send to GHL Agent Studio webhook
    await axios.post(agent.webhookUrl, {
      agent:      agent.name,
      agentRole:  agent.role,
      brief,
      task:       taskDescription,
      locationId: req.locationId,
      source:     'hltools-agents',
      timestamp:  new Date().toISOString(),
    }, {
      headers:        { 'Content-Type': 'application/json' },
      timeout:        15000,
      validateStatus: () => true,
    });

    res.json({ success: true, brief, message: `Agent "${agent.name}" triggered in GHL Agent Studio.` });
  } catch (err) {
    console.error('[Agent] execute error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Standalone brief generator (no saved agent) ───────────────────────────────

router.post('/generate', async (req, res) => {
  const { niche, offer, audience, funnelType, pages, extraContext } = req.body;
  if (!niche || !offer) return res.status(400).json({ error: '"niche" and "offer" are required.' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured.' });

  const pageList = Array.isArray(pages) && pages.length ? pages.join(', ') : 'Opt-in Page, Sales Page, Thank You Page';

  const prompt = `You are an expert GHL funnel strategist. Generate a complete, detailed agent brief that a GHL Agent Studio agent will use to build a high-converting ${funnelType || 'Sales Funnel'} natively inside GoHighLevel.

Business: ${niche} | Offer: ${offer} | Audience: ${audience || 'General'} | Pages: ${pageList}
${extraContext ? `Context: ${extraContext}` : ''}

Include:
1. FUNNEL OVERVIEW — goal, who it's for
2. PAGE-BY-PAGE — for each page: H1 headline, subheadline, body bullets, CTA text, color mood, social proof
3. BRAND VOICE — tone and style
4. COPY HOOKS — 3 powerful angles
5. OFFER PRESENTATION — value stack

Write as direct instructions to the GHL agent. Include actual copy text. Be extremely specific.`;

  try {
    const client   = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ success: true, brief: response.content[0]?.text?.trim() || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Standalone execute (no saved agent) ──────────────────────────────────────

router.post('/execute', async (req, res) => {
  const { brief, metadata } = req.body;
  if (!brief) return res.status(400).json({ error: '"brief" is required.' });

  const toolRegistry = require('../tools/toolRegistry');
  const webhookUrl   = (await toolRegistry.getToolConfig(req.locationId))?.ghl_agent?.webhookUrl;
  if (!webhookUrl) return res.status(400).json({ error: 'GHL Agent webhook not configured in Settings.' });

  try {
    await axios.post(webhookUrl, {
      prompt: brief, locationId: req.locationId,
      source: 'hltools', timestamp: new Date().toISOString(), ...(metadata || {}),
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000, validateStatus: () => true });
    res.json({ success: true, message: 'Agent triggered successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
