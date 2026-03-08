/**
 * routes/api/conversationAI.js
 *
 * GHL Conversation AI + Voice AI API.
 *
 * Conversation AI — text-based AI agent management:
 *   Agents   : Create, Search, Get, Update, Delete
 *   Actions  : Attach, List, Get, Update, Remove, Update Followup Settings
 *   Generations: Get AI response details (system prompt, KB chunks, history)
 *
 * Voice AI — voice call agent management:
 *   Agents   : Create, List, Get, Patch, Delete
 *   Actions  : Create, Get, Update, Delete
 *   Call Logs: List, Get
 *
 * Auth: Sub-account Bearer token (JWT) — must be location-scoped.
 * Tokens must NOT be agency-level for these endpoints.
 *
 * Mounted at: /api/v1/conversation-ai
 */

const express = require('express');
const router  = express.Router();

// ─── Conversation AI Agents ───────────────────────────────────────────────────

// GET search / list all conversation AI agents for the location
// Query: { query, limit, skip }
router.get('/agents', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/conversation-ai/agents', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET a specific conversation AI agent
router.get('/agents/:agentId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/conversation-ai/agents/${req.params.agentId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create a conversation AI agent
// Body: { name, description, prompt, knowledgeBaseIds[], tone, language }
router.post('/agents', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/conversation-ai/agents', {
      locationId: req.locationId,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update a conversation AI agent
router.put('/agents/:agentId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/conversation-ai/agents/${req.params.agentId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE a conversation AI agent
router.delete('/agents/:agentId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/conversation-ai/agents/${req.params.agentId}`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Conversation AI Actions ──────────────────────────────────────────────────

// GET list all actions attached to an agent
router.get('/agents/:agentId/actions', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/conversation-ai/agents/${req.params.agentId}/actions`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET a specific action
router.get('/agents/:agentId/actions/:actionId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/conversation-ai/agents/${req.params.agentId}/actions/${req.params.actionId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST attach/create an action on an agent
// Body: { type, name, description, config }
router.post('/agents/:agentId/actions', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/conversation-ai/agents/${req.params.agentId}/actions`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update an action
router.put('/agents/:agentId/actions/:actionId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/conversation-ai/agents/${req.params.agentId}/actions/${req.params.actionId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE / remove an action from an agent
router.delete('/agents/:agentId/actions/:actionId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/conversation-ai/agents/${req.params.agentId}/actions/${req.params.actionId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update followup settings for an agent
// Body: { followupEnabled, followupDelay, followupMessage }
router.put('/agents/:agentId/followup-settings', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/conversation-ai/agents/${req.params.agentId}/followup-settings`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Conversation AI Generations ──────────────────────────────────────────────

// GET get AI generation details for a conversation
// Returns: systemPrompt, conversationHistory, KBchunks, websiteChunks, faqChunks, richTextChunks
// Query: { conversationId, messageId }
router.get('/generations', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/conversation-ai/generations', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Voice AI Agents ──────────────────────────────────────────────────────────

// GET list voice AI agents
router.get('/voice-agents', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/voice-ai/agents', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET a specific voice AI agent
router.get('/voice-agents/:agentId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/voice-ai/agents/${req.params.agentId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create a voice AI agent
// Body: { name, phoneNumber, voice, language, prompt, knowledgeBaseIds[], greeting }
router.post('/voice-agents', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/voice-ai/agents', {
      locationId: req.locationId,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PATCH partial update a voice AI agent
router.patch('/voice-agents/:agentId', async (req, res) => {
  try {
    const data = await req.ghl('PATCH', `/voice-ai/agents/${req.params.agentId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE a voice AI agent
router.delete('/voice-agents/:agentId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/voice-ai/agents/${req.params.agentId}`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Voice AI Actions ─────────────────────────────────────────────────────────

// GET a specific voice AI action
router.get('/voice-agents/:agentId/actions/:actionId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/voice-ai/agents/${req.params.agentId}/actions/${req.params.actionId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create a voice AI action
router.post('/voice-agents/:agentId/actions', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/voice-ai/agents/${req.params.agentId}/actions`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update a voice AI action
router.put('/voice-agents/:agentId/actions/:actionId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/voice-ai/agents/${req.params.agentId}/actions/${req.params.actionId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE a voice AI action
router.delete('/voice-agents/:agentId/actions/:actionId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/voice-ai/agents/${req.params.agentId}/actions/${req.params.actionId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Voice AI Call Logs ───────────────────────────────────────────────────────

// GET list voice AI call logs
// Query: { agentId, contactId, callType, startDate, endDate, limit, skip }
router.get('/voice-call-logs', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/voice-ai/call-logs', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET a specific voice AI call log
router.get('/voice-call-logs/:callId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/voice-ai/call-logs/${req.params.callId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
