/**
 * src/routes/chats.js  — mounts at /chats
 *
 * GET    /chats/personas            — list active personas for this location
 * GET    /chats                     — list all chat sessions
 * POST   /chats                     — create / update a session
 * GET    /chats/:id                 — get session with messages
 * DELETE /chats/:id                 — delete a session
 * POST   /chats/:id/message         — send a user message, stream AI reply (SSE)
 *
 * Message flow:
 *   A. If persona has linked integrations WITH discovered MCP tools:
 *      → Agentic tool-use loop (Claude calls tools, backend executes live API calls)
 *      → Stream the final response
 *   B. Otherwise:
 *      → Two-pass: Haiku draft (silent) → Sonnet improve (streamed)
 *
 * Context injected (always):
 *   - Brain knowledge (all brains for this location)
 *   - Persona system prompt + content
 *   - Live/cached data from persona-linked integrations (webhook/our_api payloads, api_key live fetch)
 *   - Location-level integration data (fallback)
 */

const express            = require('express');
const router             = express.Router();
const authenticate       = require('../middleware/authenticate');
const store              = require('../services/conversationStore');
const brainStore         = require('../services/brainStore');
const personaStore       = require('../services/personaStore');
const integrationStore   = require('../services/integrationStore');
const toolRegistry       = require('../tools/toolRegistry');
const systemAgentStore   = require('../services/systemAgentStore');
const config             = require('../config');
const Anthropic          = require('@anthropic-ai/sdk');

const SHARED_LOC = '__shared__';

// ── Provider detection — returns ALL configured providers for fallback support ─
const AI_PROVIDERS = ['anthropic', 'openai', 'groq', 'google'];

function isBillingError(msg = '') {
  const m = msg.toLowerCase();
  return m.includes('credit') || m.includes('billing') || m.includes('quota') ||
         m.includes('insufficient') || m.includes('balance') || m.includes('rate limit') ||
         m.includes('exceeded') || m.includes('too low') || m.includes('limit exceeded') ||
         m.includes('overloaded') || m.includes('529') ||
         m.includes('too large') || m.includes('request too large') || m.includes('context length') ||
         m.includes('tokens per minute') || m.includes('maximum context') ||
         m.includes('decommissioned') || m.includes('no longer supported') || m.includes('deprecated');
}

// Context limits per provider (chars) — keeps requests within free-tier token budgets
const PROVIDER_LIMITS = {
  anthropic: { systemChars: 80000, historyMessages: 20, brainChunks: 5 },
  openai:    { systemChars: 40000, historyMessages: 15, brainChunks: 4 },
  groq:      { systemChars: 8000,  historyMessages: 6,  brainChunks: 2 },
  google:    { systemChars: 60000, historyMessages: 15, brainChunks: 4 },
};

function trimForProvider(provider, systemPrompt, messages) {
  const limits = PROVIDER_LIMITS[provider] || PROVIDER_LIMITS.openai;
  const trimmedSystem = systemPrompt.length > limits.systemChars
    ? systemPrompt.slice(0, limits.systemChars) + '\n[context trimmed]'
    : systemPrompt;
  const trimmedMessages = messages.slice(-limits.historyMessages);
  return { trimmedSystem, trimmedMessages };
}

async function resolveProviders(locationId) {
  let configs = {};
  try { configs = await toolRegistry.loadToolConfigs(locationId); } catch (_) {}

  const list = [];
  if (configs.anthropic?.apiKey) list.push({ provider: 'anthropic', anthropicKey: configs.anthropic.apiKey });
  if (configs.openai?.apiKey)    list.push({ provider: 'openai',    openaiKey: configs.openai.apiKey, hostname: 'api.openai.com', model: 'gpt-4o-mini' });
  if (configs.groq?.apiKey)      list.push({ provider: 'groq',      groqKey:   configs.groq.apiKey,   hostname: 'api.groq.com',   model: 'llama-3.3-70b-versatile' });
  if (configs.google?.apiKey)    list.push({ provider: 'google',    googleKey: configs.google.apiKey });

  if (!list.length) throw new Error('No AI provider configured. Please add an API key in Settings → Integrations.');
  return list;
}

const https = require('https');

// ── OpenAI-compatible REST (OpenAI + Groq) — non-streaming simple call ────────
function openAICompatChat(hostname, apiKey, { model, systemPrompt, messages, maxTokens = 2048 }) {
  const isGroq = hostname === 'api.groq.com';
  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path:    isGroq ? '/openai/v1/chat/completions' : '/v1/chat/completions',
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(body) },
      },
      (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => {
          try {
            const parsed = JSON.parse(d);
            if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            resolve(parsed.choices?.[0]?.message?.content || '');
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject); req.write(body); req.end();
  });
}

// ── Gemini REST — streaming ───────────────────────────────────────────────────
function geminiGenerate(googleKey, { systemPrompt, messages, onText }) {
  const model    = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const body = JSON.stringify({
    system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
    contents,
    generationConfig: { maxOutputTokens: 2048 },
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path:     `/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${googleKey}`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (resp) => {
        let fullText = '', buf = '';
        resp.on('data', chunk => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;
            try {
              const text = JSON.parse(raw).candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (text) { fullText += text; if (onText) onText(text); }
            } catch (_) {}
          }
        });
        resp.on('end', () => resolve(fullText));
        resp.on('error', reject);
      }
    );
    req.on('error', reject); req.write(body); req.end();
  });
}

async function getAnthropicClient(anthropicKey) {
  return new Anthropic({ apiKey: anthropicKey });
}

// ── Brain helpers ─────────────────────────────────────────────────────────────

async function getAllBrains(locationId) {
  const results = [];
  try { (await brainStore.listBrains(locationId)).forEach(b => results.push({ ...b, _loc: locationId })); } catch (_) {}
  try { (await brainStore.listBrains(SHARED_LOC)).forEach(b => results.push({ ...b, _loc: SHARED_LOC })); } catch (_) {}
  const seen = new Set();
  return results.filter(b => { if (seen.has(b.brainId)) return false; seen.add(b.brainId); return true; });
}

async function queryBrain(locId, brainId, query, k = 5) {
  try {
    const chunks = await brainStore.queryKnowledge(locId, brainId, query, k);
    if (!Array.isArray(chunks) || !chunks.length) return null;
    return chunks.map(c => c.text || c.content || '').filter(Boolean).join('\n\n');
  } catch (_) { return null; }
}

// ── Outbound webhook call for persona ────────────────────────────────────────
// POSTs user message + conversation context to persona.webhookUrl.
// Returns the response body (object or string) to use as context, or null.

async function callPersonaWebhook(persona, message, locationId, conversationId, history) {
  if (!persona.webhookEnabled || !persona.webhookUrl) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({
      personaId:      persona.personaId,
      personaName:    persona.name,
      message,
      locationId,
      conversationId,
      history:        (history || []).slice(-5).map(m => ({ role: m.role, content: m.content })),
      timestamp:      Date.now(),
    });
    try {
      const res = await fetch(persona.webhookUrl, { method: 'POST', headers, body, signal: ctrl.signal });
      const text = await res.text();
      try { return JSON.parse(text); } catch { return text.slice(0, 2000) || null; }
    } finally { clearTimeout(t); }
  } catch { return null; }
}

// ── Live API call helper (used for api_key simple fetch) ──────────────────────

async function liveFetch(integ, message) {
  try {
    let extraHeaders = {};
    try { if (integ.headers) extraHeaders = JSON.parse(integ.headers); } catch {}
    const url = integ.endpoint + (integ.endpoint.includes('?') ? '&' : '?') + `q=${encodeURIComponent(message)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(url, {
        method: integ.method || 'GET',
        headers: { ...(integ.apiKey ? { Authorization: `Bearer ${integ.apiKey}` } : {}), 'Content-Type': 'application/json', ...extraHeaders },
        signal: ctrl.signal,
      });
      return (await res.text()).slice(0, 1500);
    } finally { clearTimeout(t); }
  } catch { return null; }
}

// ── MCP tool execution ────────────────────────────────────────────────────────

async function executeTool(block, toolMap) {
  const config = toolMap[block.name];
  if (!config) return JSON.stringify({ error: 'Unknown tool' });
  const { integ, meta } = config;
  const input = block.input || {};

  try {
    // Build URL — substitute path params
    const pathParams = [];
    let url = (meta.baseUrl + meta.path).replace(/\{([^}]+)\}/g, (_, k) => {
      pathParams.push(k);
      return encodeURIComponent(input[k] ?? '');
    });

    let extraHeaders = {};
    try { if (integ.headers) extraHeaders = JSON.parse(integ.headers); } catch {}

    // Remaining input → query string (GET) or body (POST/PUT/PATCH)
    const remaining = Object.fromEntries(Object.entries(input).filter(([k]) => !pathParams.includes(k)));
    const method = meta.method || 'GET';
    if (method === 'GET' && Object.keys(remaining).length > 0) {
      url += (url.includes('?') ? '&' : '?') + new URLSearchParams(remaining).toString();
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, {
        method,
        headers: { ...(integ.apiKey ? { Authorization: `Bearer ${integ.apiKey}` } : {}), 'Content-Type': 'application/json', ...extraHeaders },
        ...(method !== 'GET' && Object.keys(remaining).length > 0 ? { body: JSON.stringify(remaining) } : {}),
        signal: ctrl.signal,
      });
      const text = await res.text();
      try { return JSON.stringify(JSON.parse(text), null, 2).slice(0, 3000); } catch { return text.slice(0, 3000); }
    } finally { clearTimeout(t); }
  } catch (err) { return JSON.stringify({ error: err.message }); }
}

function makeTitle(text) {
  const t = text.trim().replace(/\n+/g, ' ');
  return t.length > 60 ? t.slice(0, 57) + '…' : t;
}

// ── Request logger — identifies which UI context the request comes from ──────
router.use((req, res, next) => {
  const ref     = req.headers['referer'] || req.headers['referer'] || '';
  const origin  = ref.includes('/admin-dashboard') ? '[admin-dashboard]'
                : ref.includes('/admin')            ? '[admin]'
                : ref.includes('/ui')               ? '[ui]'
                : '[unknown]';
  const locId   = req.headers['x-location-id'] || req.headers['x-dash-location'] || '(none)';
  const dashTok = req.headers['x-dash-token']  ? '✓ dash-token' : '';
  const adminKey = req.headers['x-admin-key']  ? '✓ admin-key'  : '';
  console.log(`[Chats] ${origin} ${req.method} ${req.path} | loc=${locId} ${dashTok}${adminKey}`);
  next();
});

// All routes require authentication
router.use(authenticate);

// ── GET /chats/personas — active personas for this location ───────────────────

router.get('/personas', async (req, res) => {
  try {
    const all    = await personaStore.listPersonas();
    const active = all.filter(p =>
      p.status === 'active' && (
        p.assignedTo === '__all__' ||
        (p.assignedTo === 'specific' && Array.isArray(p.assignedLocations) && p.assignedLocations.includes(req.locationId))
      )
    );
    // Attach tool count from linked integrations
    const withTools = await Promise.all(active.map(async p => {
      try {
        const linked = await integrationStore.getIntegrationsForPersona(p.personaId);
        const toolCount = linked.reduce((n, i) => n + (i.mcpTools?.length || 0), 0);
        return { ...p, _toolCount: toolCount, _integrationCount: linked.length };
      } catch { return p; }
    }));
    res.json({ success: true, data: withTools });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /chats/agents — shared system agents visible to this location ─────────

router.get('/agents', async (req, res) => {
  try {
    const agents = await systemAgentStore.getSharedAgents();
    // Return only the fields the UI needs (no systemPrompt exposed to client)
    const safe = agents.map(({ id, name, avatar, description, capabilities, badge, bonus }) => ({
      agentId: id, name, avatar, description, capabilities, badge, bonus,
    }));
    res.json({ success: true, data: safe });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /chats ─────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const all = await store.listConversations(req.locationId + ':chats');
    res.json({ success: true, data: all });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /chats/:id ─────────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const conv = await store.getConversation(req.locationId + ':chats', req.params.id);
    // Return empty messages if session exists in index but messages haven't been saved yet
    if (!conv) return res.json({ success: true, data: { id: req.params.id, messages: [], title: 'New Chat' } });
    res.json({ success: true, data: conv });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /chats ────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { id, title, messages, personaId } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    await store.saveConversation(req.locationId + ':chats', {
      id, title: title || 'New Chat', messages: messages || [],
      ...(personaId ? { personaId } : {}),
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── DELETE /chats/:id ──────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    await store.deleteConversation(req.locationId + ':chats', req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /chats/:id/message ────────────────────────────────────────────────────

router.post('/:id/message', async (req, res) => {
  const { message, history = [], personaId } = req.body;
  if (!message?.trim()) return res.status(400).json({ success: false, error: 'message required' });

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (evt, data) => res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // Load all configured providers — try in order, fall back on billing/quota errors
    const providers = await resolveProviders(req.locationId);

    // ── 1. Brains ─────────────────────────────────────────────────────────────
    const brains = await getAllBrains(req.locationId);
    let brainContext = '';
    if (brains.length > 0) {
      const results = await Promise.all(brains.map(b => queryBrain(b._loc, b.brainId, message, 5)));
      const combined = results.filter(Boolean).join('\n\n---\n\n');
      if (combined) brainContext = `KNOWLEDGE BASE:\n${combined}\n\n---\n\n`;
    }

    // ── 2. Persona / System Agent ─────────────────────────────────────────────
    let persona = null;
    let systemAgent = null;
    try {
      if (personaId) {
        persona = await personaStore.getPersona(personaId);
        // If no persona found, check if personaId is actually a system agent id
        if (!persona) {
          systemAgent = await systemAgentStore.getAgentById(personaId);
        }
      }
      if (!persona && !systemAgent) persona = await personaStore.getPersonaForLocation(req.locationId);
    } catch (_) {}

    let basePrompt = 'You are a helpful AI assistant. Be concise, clear, and friendly. Use markdown formatting where helpful.';
    let personaWebhookContext = '';
    if (systemAgent) {
      basePrompt = systemAgent.systemPrompt?.trim() || basePrompt;
    } else if (persona) {
      basePrompt = persona.systemPrompt?.trim() || persona.personality?.trim() || basePrompt;
      if (persona.content?.trim()) brainContext = `PERSONA KNOWLEDGE:\n${persona.content}\n\n---\n\n` + brainContext;

      // Inject last inbound payload (data pushed by external tool to /integrations/persona/:token)
      if (persona.lastInboundPayload) {
        let payload = persona.lastInboundPayload;
        try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch {}
        const ago = persona.lastInboundAt ? ` (${Math.round((Date.now() - persona.lastInboundAt) / 60000)}m ago)` : '';
        personaWebhookContext += `[Inbound data${ago}]:\n${typeof payload === 'object' ? JSON.stringify(payload, null, 2) : payload}\n\n`;
      }

      // Call outbound webhook — POST message to external URL and use response as context
      if (persona.webhookEnabled && persona.webhookUrl) {
        send('status', { text: `Fetching from ${persona.name} hook…` });
        const hookResponse = await callPersonaWebhook(persona, message, req.locationId, req.params.id, history);
        if (hookResponse) {
          const hookText = typeof hookResponse === 'object' ? JSON.stringify(hookResponse, null, 2) : String(hookResponse);
          personaWebhookContext += `[Hook response]:\n${hookText.slice(0, 2000)}\n\n`;
        }
      }
    }

    // ── 3. Integrations: separate into data context + MCP tools ──────────────
    let integrationContext = '';
    const claudeTools   = []; // tool defs for Claude API
    const toolMap       = {}; // name → { integ, meta }

    const personaIntegrations = persona
      ? await integrationStore.getIntegrationsForPersona(persona.personaId).catch(() => [])
      : [];

    // Also inject location-level integrations as context (non-tool)
    const locationIntegrations = await integrationStore.getIntegrationsForLocation(req.locationId).catch(() => []);

    // Persona-linked integrations: live calls + tools
    for (const integ of personaIntegrations) {
      if (integ.type === 'webhook' || integ.type === 'our_api') {
        // Use last stored payload as context
        if (integ.lastPayload) {
          let payload = integ.lastPayload;
          try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch {}
          const ago = integ.lastReceivedAt ? ` (${Math.round((Date.now() - integ.lastReceivedAt) / 60000)}m ago)` : '';
          integrationContext += `[${integ.clientName} — ${integ.name}${ago}]:\n${typeof payload === 'object' ? JSON.stringify(payload, null, 2) : payload}\n\n`;
        }
      } else if (integ.type === 'api_key') {
        if (integ.mcpTools?.length > 0) {
          // Convert discovered endpoints to Claude tools
          integ.mcpTools.forEach(tool => {
            const safeName = `${integ.integrationId.slice(4, 12)}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
            claudeTools.push({
              name: safeName,
              description: `[${integ.clientName} — ${integ.name}] ${tool.description}`,
              input_schema: tool.inputSchema || { type: 'object', properties: {} },
            });
            toolMap[safeName] = { integ, meta: tool._meta };
          });
        } else {
          // Simple live fetch as data context
          send('status', { text: `Fetching from ${integ.name}…` });
          const liveData = await liveFetch(integ, message);
          if (liveData) integrationContext += `[${integ.name} live data]:\n${liveData}\n\n`;
        }
      }
    }

    // Location-level integrations: inject cached payloads only (not tools)
    for (const integ of locationIntegrations) {
      if (personaIntegrations.find(p => p.integrationId === integ.integrationId)) continue; // already handled
      if (integ.lastPayload) {
        let payload = integ.lastPayload;
        try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch {}
        integrationContext += `[${integ.clientName} — ${integ.name}]:\n${typeof payload === 'object' ? JSON.stringify(payload, null, 2) : payload}\n\n`;
      }
    }

    // Build final system prompt
    let systemPrompt = basePrompt;
    if (brainContext)            systemPrompt += `\n\n${brainContext}`;
    if (personaWebhookContext)   systemPrompt += `\n\nPERSONA HOOK DATA (use this to answer accurately):\n${personaWebhookContext}`;
    if (integrationContext)      systemPrompt += `\n\nINTEGRATION DATA (use this to answer accurately):\n${integrationContext}`;
    systemPrompt = systemPrompt.trim();

    const claudeMessages = [
      ...history.slice(-20).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message.trim() },
    ];

    let fullText = '';

    const improveInstruction = systemAgent
      ? `Review and improve this response. Stay fully in character as ${systemAgent.name}. Keep all methodology, phase references, and formatting intact. Write only the improved response.`
      : persona
      ? `Review and improve this response to be more natural and true to your personality as ${persona.name}. Write only the improved response.`
      : 'Review and improve this response to be clearer and better structured. Write only the improved response.';

    // ── 4. Try providers in order — fall back on billing/quota errors ─────────
    let lastErr = null;
    for (const providerInfo of providers) {
      try {
        // 4A. Agentic tool-use path (Anthropic only — tools require SDK)
        if (claudeTools.length > 0 && providerInfo.provider === 'anthropic') {
          send('status', { text: `Analyzing request…` });
          const { trimmedSystem: sys, trimmedMessages: initMsgs } = trimForProvider('anthropic', systemPrompt, claudeMessages);
          const client = await getAnthropicClient(providerInfo.anthropicKey);
          let msgs = [...initMsgs];
          let iterations = 0;
          while (iterations < 5) {
            iterations++;
            const response = await client.messages.create({
              model: 'claude-sonnet-4-6', max_tokens: 2048,
              system: sys, messages: msgs, tools: claudeTools,
            });
            if (response.stop_reason === 'tool_use') {
              const toolResults = [];
              for (const block of response.content.filter(b => b.type === 'tool_use')) {
                send('status', { text: `Fetching from ${toolMap[block.name]?.integ?.name || block.name}…` });
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: await executeTool(block, toolMap) });
              }
              msgs = [...msgs, { role: 'assistant', content: response.content }, { role: 'user', content: toolResults }];
            } else {
              fullText = response.content.find(b => b.type === 'text')?.text || '';
              break;
            }
          }
          send('status', { text: '✨ Improving…' });
          const improveStream = client.messages.stream({
            model: 'claude-sonnet-4-6', max_tokens: 2048, system: sys,
            messages: [...msgs, { role: 'assistant', content: fullText }, { role: 'user', content: improveInstruction }],
          });
          let improvedText = '';
          improveStream.on('text', t => { improvedText += t; send('text', { text: t }); });
          await improveStream.finalMessage();
          if (improvedText) fullText = improvedText;

        // 4B. Anthropic two-pass (Haiku draft → Sonnet improve)
        } else if (providerInfo.provider === 'anthropic') {
          send('status', { text: `Thinking… (${providerInfo.provider})` });
          const { trimmedSystem: sys, trimmedMessages: msgs2 } = trimForProvider('anthropic', systemPrompt, claudeMessages);
          const client = await getAnthropicClient(providerInfo.anthropicKey);
          let draftText = '';
          try {
            const draft = await client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: sys, messages: msgs2 });
            draftText = draft.content[0]?.text?.trim() || '';
          } catch (_) {}
          if (draftText) {
            send('status', { text: '✨ Improving…' });
            const stream = client.messages.stream({
              model: 'claude-sonnet-4-6', max_tokens: 2048, system: sys,
              messages: [...msgs2, { role: 'assistant', content: draftText }, { role: 'user', content: improveInstruction }],
            });
            stream.on('text', t => { fullText += t; send('text', { text: t }); });
            await stream.finalMessage();
          } else {
            const stream = client.messages.stream({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: sys, messages: msgs2 });
            stream.on('text', t => { fullText += t; send('text', { text: t }); });
            await stream.finalMessage();
          }

        // 4C. OpenAI / Groq
        } else if (providerInfo.provider === 'openai' || providerInfo.provider === 'groq') {
          send('status', { text: `Thinking… (${providerInfo.provider})` });
          const { trimmedSystem: sys, trimmedMessages: msgs2 } = trimForProvider(providerInfo.provider, systemPrompt, claudeMessages);
          const apiKey = providerInfo.openaiKey || providerInfo.groqKey;
          fullText = await openAICompatChat(providerInfo.hostname, apiKey, { model: providerInfo.model, systemPrompt: sys, messages: msgs2 });
          if (fullText) send('text', { text: fullText });

        // 4D. Google Gemini
        } else if (providerInfo.provider === 'google') {
          send('status', { text: `Thinking… (${providerInfo.provider})` });
          const { trimmedSystem: sys, trimmedMessages: msgs2 } = trimForProvider('google', systemPrompt, claudeMessages);
          fullText = await geminiGenerate(providerInfo.googleKey, { systemPrompt: sys, messages: msgs2, onText: t => send('text', { text: t }) });
        }

        break; // success — stop trying more providers

      } catch (err) {
        lastErr = err;
        if (isBillingError(err.message)) {
          console.warn(`[Chats] ${providerInfo.provider} billing/quota error — trying next provider:`, err.message.slice(0, 120));
          continue; // try next provider
        }
        throw err; // non-billing error — propagate immediately
      }
    }

    if (!fullText && lastErr) throw lastErr;

    // ── 5. Always send done first so client never hangs ──────────────────────
    send('done', { text: fullText });

    // ── 6. Persist (fire-and-forget — must not block or crash the response) ──
    try {
      const conv     = await store.getConversation(req.locationId + ':chats', req.params.id).catch(() => null);
      const existing = conv?.messages || [];
      // Merge: use client history as ground truth (already validated), append new pair
      const clientHistory = history.slice(-100).map(m => ({ role: m.role, content: m.content, ts: m.ts || 0 }));
      const merged = clientHistory.length >= existing.length ? clientHistory : existing;
      const updated = [
        ...merged,
        { role: 'user',      content: message.trim(), ts: Date.now() },
        { role: 'assistant', content: fullText,        ts: Date.now() },
      ];
      const title = conv?.title && conv.title !== 'New Chat' ? conv.title : makeTitle(message);
      await store.saveConversation(req.locationId + ':chats', {
        id: req.params.id, title, messages: updated,
        ...(personaId ? { personaId } : (conv?.personaId ? { personaId: conv.personaId } : {})),
      });
    } catch (saveErr) {
      console.error('[Chats] Failed to persist conversation:', saveErr.message);
    }
  } catch (err) {
    send('error', { error: err.message });
  }

  res.end();
});

module.exports = router;
