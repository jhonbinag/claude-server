/**
 * src/routes/agent.js
 *
 * Mounts at /agent
 *
 * GET    /agent/agents/ghl        — list GHL Agent Studio agents for location (proxy)
 * GET    /agent/agents            — list saved agent definitions
 * POST   /agent/agents            — create agent definition
 * PUT    /agent/agents/:id        — update agent definition
 * DELETE /agent/agents/:id        — delete agent definition
 * POST   /agent/agents/:id/execute — generate brief + execute via GHL Agent Studio API
 * POST   /agent/generate          — standalone brief generator (no saved agent)
 */

const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const agentStore   = require('../services/agentStore');
const ghlClient    = require('../services/ghlClient');
const Anthropic    = require('@anthropic-ai/sdk');

router.use(authenticate);

// ── List GHL Agent Studio agents (direct GHL v2 API) ─────────────────────────
// Proxies GET /agent-studio/agent?locationId= so the frontend can populate
// the agent picker without needing a separate GHL API call from the browser.

router.get('/agents/ghl', async (req, res) => {
  try {
    const data = await ghlClient.ghlRequest(
      req.locationId, 'GET', '/agent-studio/agent',
      null, { locationId: req.locationId, limit: 100 }
    );
    res.json({ success: true, data: data.agents || data.data || data || [] });
  } catch (err) {
    console.error('[Agent] list GHL agents error:', err.message);
    // Return empty array — Agent Studio may not be enabled on this plan/location
    res.json({ success: true, data: [], warning: err.message });
  }
});

// ── List saved agent definitions ──────────────────────────────────────────────

router.get('/agents', async (req, res) => {
  try {
    const list = await agentStore.listAgents(req.locationId);
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Create agent definition ───────────────────────────────────────────────────

router.post('/agents', async (req, res) => {
  const { name, emoji, role, persona, instructions, ghlAgentId } = req.body;
  if (!name || !instructions) {
    return res.status(400).json({ success: false, error: '"name" and "instructions" are required.' });
  }
  try {
    const agent = await agentStore.saveAgent(req.locationId, {
      name, emoji: emoji || '🤖', role: role || 'custom',
      persona, instructions, ghlAgentId: ghlAgentId || null,
    });
    res.json({ success: true, data: agent });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Update agent definition ───────────────────────────────────────────────────

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

// ── Delete agent definition ───────────────────────────────────────────────────

router.delete('/agents/:id', async (req, res) => {
  try {
    await agentStore.deleteAgent(req.locationId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Execute agent ─────────────────────────────────────────────────────────────
// 1. Build task description from request body
// 2. Generate a structured execution brief via Claude (agent persona as system prompt)
// 3. Execute the GHL Agent Studio agent via POST /agent-studio/agent/:ghlAgentId/execute

router.post('/agents/:id/execute', async (req, res) => {
  const { task, niche, offer, audience, funnelType, pages, extraContext, executionId } = req.body;
  if (!task && !niche) {
    return res.status(400).json({ success: false, error: 'Provide "task" or "niche" + "offer".' });
  }

  try {
    const agent = await agentStore.getAgent(req.locationId, req.params.id);
    if (!agent) return res.status(404).json({ success: false, error: 'Agent not found.' });

    if (!agent.ghlAgentId) {
      return res.status(400).json({ success: false, error: 'This agent has no GHL Agent Studio agent linked.' });
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

Your job is to generate a complete, detailed execution brief that the GHL Agent Studio agent will follow step-by-step to complete the requested task inside GoHighLevel. Be extremely specific — include actual copy, headlines, CTAs, color suggestions, and step-by-step build instructions. The GHL agent must be able to execute this without any follow-up questions.`;

    const client   = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: `Complete this task inside GHL:\n\n${taskDescription}` }],
    });

    const brief = response.content[0]?.text?.trim() || '';

    // Execute via GHL Agent Studio v2 API
    // POST /agent-studio/agent/:agentId/execute
    const execBody = {
      locationId: req.locationId,
      message:    brief,
      ...(executionId && { executionId }),
    };

    const ghlResponse = await ghlClient.ghlRequest(
      req.locationId, 'POST',
      `/agent-studio/agent/${agent.ghlAgentId}/execute`,
      execBody
    );

    res.json({
      success:     true,
      brief,
      executionId: ghlResponse.executionId || null,
      ghlResponse,
      message:     `Agent "${agent.name}" executed in GHL Agent Studio.`,
    });
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

module.exports = router;
