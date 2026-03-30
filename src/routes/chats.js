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
 * Message flow (two-pass):
 *   1. Fast draft via Haiku  (silent)
 *   2. Improve + stream via Sonnet
 * Persona is loaded per-session (by personaId sent from frontend) or
 * falls back to the location's assigned default persona.
 */

const express       = require('express');
const router        = express.Router();
const authenticate  = require('../middleware/authenticate');
const store         = require('../services/conversationStore');
const brainStore    = require('../services/brainStore');
const personaStore       = require('../services/personaStore');
const integrationStore   = require('../services/integrationStore');
const Anthropic          = require('@anthropic-ai/sdk');

const client     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SHARED_LOC = '__shared__';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAllBrains(locationId) {
  const results = [];
  try { const own = await brainStore.listBrains(locationId); own.forEach(b => results.push({ ...b, _loc: locationId })); } catch (_) {}
  try { const shared = await brainStore.listBrains(SHARED_LOC); shared.forEach(b => results.push({ ...b, _loc: SHARED_LOC, isShared: true })); } catch (_) {}
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

function makeTitle(text) {
  const t = text.trim().replace(/\n+/g, ' ');
  return t.length > 60 ? t.slice(0, 57) + '…' : t;
}

// All routes require authentication
router.use(authenticate);

// ── GET /chats/personas — active personas available to this location ──────────
// Must be before /:id to avoid routing conflict

router.get('/personas', async (req, res) => {
  try {
    const all = await personaStore.listPersonas();
    const active = all.filter(p =>
      p.status === 'active' && (
        p.assignedTo === '__all__' ||
        (p.assignedTo === 'specific' && Array.isArray(p.assignedLocations) && p.assignedLocations.includes(req.locationId))
      )
    );
    res.json({ success: true, data: active });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /chats ─────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const all = await store.listConversations(req.locationId + ':chats');
    res.json({ success: true, data: all });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /chats/:id ─────────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const conv = await store.getConversation(req.locationId + ':chats', req.params.id);
    if (!conv) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: conv });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /chats — create empty session ────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { id, title, messages, personaId } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    await store.saveConversation(req.locationId + ':chats', {
      id, title: title || 'New Chat', messages: messages || [],
      ...(personaId ? { personaId } : {}),
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /chats/:id ──────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    await store.deleteConversation(req.locationId + ':chats', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /chats/:id/message — two-pass AI reply (draft → improve → stream) ────

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
    // 1. Load brains
    const brains = await getAllBrains(req.locationId);
    let brainContext = '';
    if (brains.length > 0) {
      const results = await Promise.all(brains.map(b => queryBrain(b._loc, b.brainId, message, 5)));
      const combined = results.filter(Boolean).join('\n\n---\n\n');
      if (combined) {
        brainContext = `KNOWLEDGE BASE (from ${brains.length} brain${brains.length > 1 ? 's' : ''}):\n${combined}\n\n---\n\nUse the knowledge base above to inform your answer. If it covers the topic, prioritise that information.\n\n`;
      }
    }

    // 2. Load persona — prefer explicit personaId, fall back to location default
    let persona = null;
    try {
      if (personaId) persona = await personaStore.getPersona(personaId);
      if (!persona)  persona = await personaStore.getPersonaForLocation(req.locationId);
    } catch (_) {}

    let basePrompt = 'You are a helpful AI assistant. Be concise, clear, and friendly. Use markdown formatting where helpful.';
    if (persona) {
      basePrompt = persona.systemPrompt?.trim() || persona.personality?.trim() || basePrompt;
      if (persona.content?.trim()) {
        brainContext = `PERSONA KNOWLEDGE:\n${persona.content}\n\n---\n\n` + brainContext;
      }
    }

    const systemPrompt   = `${basePrompt}\n\n${brainContext}`.trim();
    const claudeMessages = [
      ...history.slice(-20).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message.trim() },
    ];

    // 3. Load active 3rd-party integrations and inject any recent data
    try {
      const integrations = await integrationStore.getIntegrationsForLocation(req.locationId);
      const intParts = integrations
        .filter(i => i.lastPayload)
        .map(i => {
          let payload = i.lastPayload;
          try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch {}
          const ago = i.lastReceivedAt ? `(received ${Math.round((Date.now() - i.lastReceivedAt) / 60000)}m ago)` : '';
          return `[${i.clientName} — ${i.name}] ${ago}:\n${typeof payload === 'object' ? JSON.stringify(payload, null, 2) : payload}`;
        });
      if (intParts.length > 0) {
        brainContext += `\n\n3RD-PARTY INTEGRATION DATA:\n${intParts.join('\n\n---\n\n')}\n\nUse the above data to provide more accurate and context-aware answers.\n\n`;
      }
    } catch (_) {}

    // 4. Pass 1 — fast draft via Haiku (silent, not streamed)
    send('status', { text: 'Thinking…' });
    const draft = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   claudeMessages,
    });
    const draftText = draft.content[0]?.text?.trim() || '';

    // 5. Pass 2 — improve the draft and stream the result via Sonnet
    send('status', { text: '✨ Improving…' });

    const improveMessages = [
      ...claudeMessages,
      { role: 'assistant', content: draftText },
      {
        role: 'user',
        content: persona
          ? `Review your response above and improve it — make it more natural, engaging, and true to your personality as ${persona.name}. Write only the improved response, nothing else.`
          : 'Review your response above and improve it — make it clearer, more helpful, and better structured. Write only the improved response, nothing else.',
      },
    ];

    let fullText = '';
    const stream = client.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     systemPrompt,
      messages:   improveMessages,
    });

    stream.on('text', text => {
      fullText += text;
      send('text', { text });
    });

    await stream.finalMessage();

    // 6. Persist updated conversation
    const conv     = await store.getConversation(req.locationId + ':chats', req.params.id).catch(() => null);
    const existing = conv?.messages || [];
    const updated  = [
      ...existing,
      { role: 'user',      content: message.trim(), ts: Date.now() },
      { role: 'assistant', content: fullText,        ts: Date.now() },
    ];
    const title = conv?.title && conv.title !== 'New Chat' ? conv.title : makeTitle(message);
    await store.saveConversation(req.locationId + ':chats', {
      id: req.params.id, title, messages: updated,
      ...(personaId ? { personaId } : (conv?.personaId ? { personaId: conv.personaId } : {})),
    });

    send('done', { text: fullText });
  } catch (err) {
    send('error', { error: err.message });
  }

  res.end();
});

module.exports = router;
