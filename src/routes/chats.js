/**
 * src/routes/chats.js  — mounts at /chats
 *
 * Manages persistent chat sessions and handles AI replies that
 * automatically query all available brains before responding.
 *
 * GET    /chats                  — list all chat sessions
 * POST   /chats                  — create / update a session
 * GET    /chats/:id              — get session with messages
 * DELETE /chats/:id              — delete a session
 * POST   /chats/:id/message      — send a user message, stream AI reply (SSE)
 */

const express       = require('express');
const router        = express.Router();
const authenticate  = require('../middleware/authenticate');
const store         = require('../services/conversationStore');
const brainStore    = require('../services/brainStore');
const personaStore  = require('../services/personaStore');
const Anthropic     = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SHARED_LOC = '__shared__';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Collect all brains available to this location (own + shared)
async function getAllBrains(locationId) {
  const results = [];
  try {
    const own = await brainStore.listBrains(locationId);
    own.forEach(b => results.push({ ...b, _loc: locationId }));
  } catch (_) {}
  try {
    const shared = await brainStore.listBrains(SHARED_LOC);
    shared.forEach(b => results.push({ ...b, _loc: SHARED_LOC, isShared: true }));
  } catch (_) {}
  // De-duplicate by brainId
  const seen = new Set();
  return results.filter(b => { if (seen.has(b.brainId)) return false; seen.add(b.brainId); return true; });
}

// Query a brain and return its text chunks joined
async function queryBrain(locId, brainId, query, k = 5) {
  try {
    const chunks = await brainStore.queryKnowledge(locId, brainId, query, k);
    if (!Array.isArray(chunks) || !chunks.length) return null;
    return chunks.map(c => c.text || c.content || '').filter(Boolean).join('\n\n');
  } catch (_) { return null; }
}

// Auto-generate a short title from the first user message
function makeTitle(text) {
  const t = text.trim().replace(/\n+/g, ' ');
  return t.length > 60 ? t.slice(0, 57) + '…' : t;
}

// All routes require authentication
router.use(authenticate);

// ── GET /chats ─────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    // Reuse conversationStore but under a "chats:" namespace
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
    const { id, title, messages } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    await store.saveConversation(req.locationId + ':chats', {
      id, title: title || 'New Chat', messages: messages || [],
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

// ── POST /chats/:id/message — stream AI reply ──────────────────────────────────

router.post('/:id/message', async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ success: false, error: 'message required' });

  // SSE setup
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (evt, data) => res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // 1. Load all brains and query them with the user's message
    const brains = await getAllBrains(req.locationId);
    let brainContext = '';

    if (brains.length > 0) {
      const results = await Promise.all(
        brains.map(b => queryBrain(b._loc, b.brainId, message, 5))
      );
      const combined = results.filter(Boolean).join('\n\n---\n\n');
      if (combined) {
        brainContext = `KNOWLEDGE BASE (from ${brains.length} brain${brains.length > 1 ? 's' : ''}):\n${combined}\n\n---\n\nUse the knowledge base above to inform your answer. If the knowledge base covers the topic, prioritise that information. If it doesn't cover it, answer from your own knowledge.\n\n`;
      }
    }

    // 2. Load active persona for this location (admin-configured)
    let basePrompt = 'You are a helpful AI assistant. Be concise, clear, and friendly. Use markdown formatting where helpful.';
    try {
      const persona = await personaStore.getPersonaForLocation(req.locationId);
      if (persona) {
        basePrompt = persona.systemPrompt?.trim() || persona.personality?.trim() || basePrompt;
        // Prepend persona's own knowledge content before brain context
        if (persona.content?.trim()) {
          const personaKnowledge = `PERSONA KNOWLEDGE:\n${persona.content}\n\n---\n\n`;
          brainContext = personaKnowledge + brainContext;
        }
      }
    } catch (_) {}

    // 3. Build system prompt
    const systemPrompt = `${basePrompt}\n\n${brainContext}`.trim();

    // 4. Build messages array for Claude (convert history + new message)
    const claudeMessages = [
      ...history.slice(-20).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message.trim() },
    ];

    // 5. Stream response
    let fullText = '';
    const stream = client.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     systemPrompt,
      messages:   claudeMessages,
    });

    stream.on('text', (text) => {
      fullText += text;
      send('text', { text });
    });

    await stream.finalMessage();

    // 6. Persist the updated conversation
    const conv = await store.getConversation(req.locationId + ':chats', req.params.id).catch(() => null);
    const existing = conv?.messages || [];
    const updated = [
      ...existing,
      { role: 'user',      content: message.trim(), ts: Date.now() },
      { role: 'assistant', content: fullText,        ts: Date.now() },
    ];
    const title = conv?.title && conv.title !== 'New Chat' ? conv.title : makeTitle(message);
    await store.saveConversation(req.locationId + ':chats', {
      id: req.params.id, title, messages: updated,
    });

    send('done', { text: fullText });
  } catch (err) {
    send('error', { error: err.message });
  }

  res.end();
});

module.exports = router;
