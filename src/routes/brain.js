/**
 * src/routes/brain.js
 *
 * Mounts at /brain
 *
 * GET    /brain/list                                — list all brains
 * POST   /brain/create                              — create brain
 * GET    /brain/channel-info?videoUrl=              — get channel + playlists from video URL
 * DELETE /brain/:brainId                            — delete brain
 * GET    /brain/:brainId                            — get brain with docs
 * POST   /brain/:brainId/youtube                    — add YouTube video
 * POST   /brain/:brainId/playlist                   — ingest all videos from a playlist
 * POST   /brain/:brainId/docs                       — add text document
 * DELETE /brain/:brainId/docs/:docId                — delete document
 * POST   /brain/:brainId/query                      — keyword search
 * GET    /brain/:brainId/status                     — brain status
 * POST   /brain/:brainId/channels                   — add channel to brain
 * DELETE /brain/:brainId/channels/:channelId        — remove channel from brain
 */

const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const brain        = require('../services/brainStore');
const Anthropic    = require('@anthropic-ai/sdk');
const toolRegistry = require('../tools/toolRegistry');

router.use(authenticate);

// ── List all brains ────────────────────────────────────────────────────────────

router.get('/list', async (req, res) => {
  try {
    const brains = await brain.listBrains(req.locationId);
    res.json({ success: true, data: brains });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Create brain ──────────────────────────────────────────────────────────────

router.post('/create', async (req, res) => {
  const { name, slug, description, docsUrl, changelogUrl, primaryChannel, secondaryChannels, syncNow } = req.body;
  if (!name) return res.status(400).json({ success: false, error: '"name" is required.' });
  try {
    const result = await brain.createBrain(req.locationId, {
      name, slug, description, docsUrl, changelogUrl, primaryChannel, secondaryChannels, autoSync: !!syncNow,
    });
    res.json({ success: true, data: result });
    // If syncNow, queue all channels for discovery (frontend drives batch processing)
    if (syncNow && (result.channels || []).length > 0) {
      (async () => {
        try {
          for (const ch of result.channels) {
            if (ch.channelUrl) {
              await brain.queueChannelSync(req.locationId, result.brainId, ch.channelId);
            }
          }
        } catch (e) {
          console.error('[brain/create] queue sync error:', e.message);
        }
      })();
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Channel info + playlists (must be before /:brainId) ──────────────────────

router.get('/channel-info', async (req, res) => {
  const { videoUrl } = req.query;
  if (!videoUrl) return res.status(400).json({ success: false, error: '"videoUrl" query param required.' });
  try {
    const result = await brain.getChannelFromVideo(videoUrl);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Routes that need brainId ───────────────────────────────────────────────────
// NOTE: specific sub-paths (/list, /create, /channel-info) must come before /:brainId

// ── Delete brain ──────────────────────────────────────────────────────────────

router.delete('/:brainId', async (req, res) => {
  try {
    const result = await brain.deleteBrain(req.locationId, req.params.brainId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Update brain metadata ─────────────────────────────────────────────────────

router.patch('/:brainId', async (req, res) => {
  const { name, description, docsUrl, changelogUrl, autoSync } = req.body;
  try {
    const result = await brain.updateBrainMeta(req.locationId, req.params.brainId, {
      ...(name        !== undefined && { name:        name.trim() }),
      ...(description !== undefined && { description: description.trim() }),
      ...(docsUrl     !== undefined && { docsUrl:     docsUrl.trim() }),
      ...(changelogUrl !== undefined && { changelogUrl: changelogUrl.trim() }),
      ...(autoSync    !== undefined && { autoSync:    !!autoSync }),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Trigger sync ──────────────────────────────────────────────────────────────

router.post('/:brainId/sync', async (req, res) => {
  try {
    // Just flag the brain — frontend drives incremental discovery + batch processing
    await brain.updateBrainMeta(req.locationId, req.params.brainId, { pipelineStage: 'syncing' });
    res.json({ success: true, message: 'Sync started.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Get brain ─────────────────────────────────────────────────────────────────

router.get('/:brainId', async (req, res) => {
  try {
    const result = await brain.getBrain(req.locationId, req.params.brainId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Brain status ──────────────────────────────────────────────────────────────

router.get('/:brainId/status', async (req, res) => {
  try {
    const status = await brain.getStatus(req.locationId, req.params.brainId);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Add YouTube video ─────────────────────────────────────────────────────────

router.post('/:brainId/youtube', async (req, res) => {
  const { url, title, isPrimary } = req.body;
  if (!url) return res.status(400).json({ success: false, error: '"url" is required.' });
  try {
    const result = await brain.addYoutubeVideo(
      req.locationId,
      req.params.brainId,
      url,
      title || null,
      !!isPrimary,
    );
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Brain] YouTube ingest error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Ingest entire playlist ────────────────────────────────────────────────────

router.post('/:brainId/playlist', async (req, res) => {
  const { playlistId, isPrimary } = req.body;
  if (!playlistId) return res.status(400).json({ success: false, error: '"playlistId" is required.' });
  try {
    const result = await brain.addPlaylistToBrain(
      req.locationId,
      req.params.brainId,
      playlistId,
      { isPrimary: !!isPrimary },
    );
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Brain] Playlist ingest error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Add text document ─────────────────────────────────────────────────────────

router.post('/:brainId/docs', async (req, res) => {
  const { text, sourceLabel, url, isPrimary } = req.body;
  if (!text) return res.status(400).json({ success: false, error: '"text" is required.' });
  try {
    const result = await brain.addDocument(req.locationId, req.params.brainId, {
      text,
      sourceLabel,
      url,
      isPrimary: !!isPrimary,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Delete document ───────────────────────────────────────────────────────────

router.delete('/:brainId/docs/:docId', async (req, res) => {
  try {
    const result = await brain.deleteDocument(
      req.locationId,
      req.params.brainId,
      req.params.docId,
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── AI-powered ask (RAG) ──────────────────────────────────────────────────────

// ── Provider list for RAG — returns ALL available providers in priority order ─
// Tries each one; if the active provider fails with a billing/quota error it
// automatically falls through to the next one.
async function getProviderList(locationId) {
  const configs = await toolRegistry.loadToolConfigs(locationId);
  const list = [];

  // Per-location user-configured keys first
  if (configs.anthropic?.apiKey)
    list.push({ provider: 'anthropic',  key: configs.anthropic.apiKey,  model: 'claude-sonnet-4-6' });
  if (configs.openrouter?.apiKey)
    list.push({ provider: 'openrouter', key: configs.openrouter.apiKey, model: configs.openrouter.model || 'openai/gpt-4o-mini' });
  if (configs.openai?.apiKey)
    list.push({ provider: 'openai',     key: configs.openai.apiKey,     model: 'gpt-4o-mini' });

  // Server-level shared keys as fallback (Gemini free tier, Groq free tier)
  if (process.env.GOOGLE_API_KEY)
    list.push({ provider: 'google', key: process.env.GOOGLE_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });
  if (process.env.GROQ_API_KEY)
    list.push({ provider: 'groq',   key: process.env.GROQ_API_KEY,   model: process.env.GROQ_MODEL   || 'llama-3.1-8b-instant' });

  return list;
}

// Returns true for errors that mean "try the next provider" (billing/quota/auth)
function isFallbackError(err) {
  const msg = err?.message || '';
  return (
    err instanceof SyntaxError ||
    msg.includes('not valid JSON') ||
    msg.includes('DOCTYPE') ||
    msg.includes('credit balance') ||
    msg.includes('insufficient_quota') ||
    msg.includes('quota') ||
    msg.includes('billing') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('401') ||
    /4\d\d.*invalid_api_key/i.test(msg)
  );
}

router.post('/:brainId/ask', async (req, res) => {
  const { query, k = 20 } = req.body;
  const tag = `[brain/ask brain=${req.params.brainId?.slice(-6)} loc=${req.locationId?.slice(0,8)}]`;

  process.stdout.write(`${tag} ── START query="${query}" k=${k}\n`);

  if (!query) return res.status(400).json({ success: false, error: '"query" is required.' });

  try {
    // 1. Retrieve relevant chunks
    process.stdout.write(`${tag} [1/4] querying knowledge base…\n`);
    const t0 = Date.now();
    const chunks = await brain.queryKnowledge(req.locationId, req.params.brainId, query, k);
    const searchMethod = chunks._method || 'keyword';
    process.stdout.write(`${tag} [1/4] done — ${chunks.length} chunks (${searchMethod}) in ${Date.now() - t0}ms\n`);

    if (!chunks.length) {
      process.stdout.write(`${tag} ✗ no context found — returning no_context event\n`);
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ type: 'no_context' })}\n\n`);
      res.end();
      return;
    }

    // 2. Build context block from top chunks
    const context = chunks.map((c, i) =>
      `[Source ${i + 1}: ${c.sourceLabel || 'Unknown'}${c.url ? ` — ${c.url}` : ''}]\n${c.text}`
    ).join('\n\n---\n\n');
    process.stdout.write(`${tag} [2/4] context built — ${context.length} chars from ${chunks.length} sources\n`);

    // 3. Build provider list
    process.stdout.write(`${tag} [3/4] loading provider list…\n`);
    const providers = await getProviderList(req.locationId);
    if (!providers.length) {
      process.stdout.write(`${tag} ✗ no AI provider configured\n`);
      return res.status(400).json({ success: false, error: 'No AI provider configured. Go to Settings → Integrations to add an API key (Claude, OpenRouter, Gemini, or Groq).' });
    }
    process.stdout.write(`${tag} [3/4] available: ${providers.map(p => p.provider).join(', ')}\n`);

    const SYSTEM = `You are a precise knowledge extraction assistant for a YouTube video brain. Your only job is to find and present what the videos specifically say about the user's question.

Rules — follow strictly:
1. Read every transcript excerpt carefully. Identify ONLY the sentences or ideas that directly and specifically answer the question.
2. Build your answer exclusively from those relevant parts. Quote or closely paraphrase the transcript, and name the video source.
3. Discard anything in the transcripts that is NOT directly relevant to the question — do not mention it.
4. Do NOT add general knowledge, background context, definitions, or anything not found in the provided transcripts.
5. If the transcripts contain no direct answer to the question, respond only with: "The brain does not have specific content about this. Try rephrasing or ask about topics covered in the synced videos."
6. Be concise and direct. No padding, no filler, no restating the question. Answer in bullet points if multiple points are relevant.`;
    const USER_MSG = `Video transcript excerpts:\n\n${context}\n\n---\n\nQuestion: ${query}\n\nExtract only what these transcripts say that directly answers this question.`;

    // 4. Try providers in order, falling back on billing/quota errors
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write(`data: ${JSON.stringify({ type: 'sources', searchMethod, sources: chunks.map(c => ({ sourceLabel: c.sourceLabel, url: c.url, score: c.score, isPrimary: c.isPrimary, excerpt: (c.text || '').slice(0, 300) })) })}\n\n`);

    let answered = false;
    let lastErr  = null;

    for (const { provider, key, model } of providers) {
      process.stdout.write(`${tag} [4/4] trying ${provider} (${model}) key=${key.slice(0,12)}…\n`);
      const t1 = Date.now();
      try {
        let charCount = 0;

        if (provider === 'anthropic') {
          const client = new Anthropic.default({ apiKey: key });
          const stream = client.messages.stream({
            model, max_tokens: 1024,
            system: SYSTEM,
            messages: [{ role: 'user', content: USER_MSG }],
          });
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              charCount += event.delta.text.length;
              res.write(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`);
            }
          }

        } else if (provider === 'google') {
          const gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: SYSTEM }] },
                contents: [{ role: 'user', parts: [{ text: USER_MSG }] }],
              }),
            }
          );
          const gData = await gRes.json();
          if (!gRes.ok) throw new Error(`Gemini ${gRes.status}: ${JSON.stringify(gData).slice(0, 200)}`);
          const text = gData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          charCount = text.length;
          res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);

        } else {
          const hostname = provider === 'openrouter' ? 'openrouter.ai'
                         : provider === 'groq'       ? 'api.groq.com'
                         : 'api.openai.com';
          const apiPath = provider === 'openrouter' ? '/api/v1/chat/completions' : '/openai/v1/chat/completions';
          const oRes = await fetch(`https://${hostname}${apiPath}`, {
            method: 'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${key}`,
              ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://claudeserver.vercel.app', 'X-Title': 'HL Brain' } : {}),
            },
            body: JSON.stringify({
              model, max_tokens: 1024,
              messages: [
                { role: 'system', content: SYSTEM },
                { role: 'user',   content: USER_MSG },
              ],
            }),
          });
          const oData = await oRes.json();
          if (!oRes.ok) throw new Error(`${provider} ${oRes.status}: ${JSON.stringify(oData).slice(0, 200)}`);
          const text = oData.choices?.[0]?.message?.content || '';
          charCount = text.length;
          res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
        }

        process.stdout.write(`${tag} ✓ ${provider} replied ${charCount} chars in ${Date.now() - t1}ms\n`);
        answered = true;
        break;

      } catch (err) {
        lastErr = err;
        process.stdout.write(`${tag} ✗ ${provider} failed: ${err.message}\n`);
        if (isFallbackError(err)) {
          process.stdout.write(`${tag} ↳ billing/quota error — trying next provider\n`);
          continue;
        }
        throw err; // non-recoverable error, stop immediately
      }
    }

    if (!answered) {
      const msg = `All configured AI providers failed. Last error: ${lastErr?.message}`;
      process.stdout.write(`${tag} ✗ ${msg}\n`);
      res.write(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    process.stdout.write(`${tag} ✗ ERROR: ${err.message}\n${err.stack}\n`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ── Query / search ────────────────────────────────────────────────────────────

router.post('/:brainId/query', async (req, res) => {
  const { query, k } = req.body;
  if (!query) return res.status(400).json({ success: false, error: '"query" is required.' });
  try {
    process.stdout.write(`[brain/query brain=${req.params.brainId?.slice(-6)}] "${query}" k=${k || 5}\n`);
    const results = await brain.queryKnowledge(
      req.locationId,
      req.params.brainId,
      query,
      k || 5,
    );
    process.stdout.write(`[brain/query brain=${req.params.brainId?.slice(-6)}] → ${results.length} results\n`);
    res.json({ success: true, data: results });
  } catch (err) {
    process.stdout.write(`[brain/query brain=${req.params.brainId?.slice(-6)}] ✗ ${err.message}\n`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Add channel to brain ──────────────────────────────────────────────────────

router.post('/:brainId/channels', async (req, res) => {
  const { channelName, channelUrl, isPrimary } = req.body;
  if (!channelName) return res.status(400).json({ success: false, error: '"channelName" is required.' });
  try {
    const result = await brain.addChannelToBrain(
      req.locationId,
      req.params.brainId,
      { channelName, channelUrl, isPrimary: !!isPrimary },
    );
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Queue channel sync (collects video IDs, no transcripts) ──────────────────

router.post('/:brainId/channels/:channelId/queue', async (req, res) => {
  try {
    const result = await brain.queueChannelSync(req.locationId, req.params.brainId, req.params.channelId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Process next batch from sync queue ────────────────────────────────────────

router.post('/:brainId/sync-batch', async (req, res) => {
  try {
    const result = await brain.processSyncBatch(req.locationId, req.params.brainId, req.body.batchSize || 5);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Sync single channel ───────────────────────────────────────────────────────

router.post('/:brainId/channels/:channelId/sync', async (req, res) => {
  try {
    await brain.updateBrainMeta(req.locationId, req.params.brainId, { pipelineStage: 'syncing' });
    res.json({ success: true, message: 'Channel sync started.' });
    brain.syncSingleChannel(req.locationId, req.params.brainId, req.params.channelId)
      .catch(e => console.error('[brain/channel-sync] background sync error:', e));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── List videos (metadata catalogue) ─────────────────────────────────────────

router.get('/:brainId/videos', async (req, res) => {
  try {
    const videos = await brain.listVideos(req.locationId, req.params.brainId);
    res.json({ success: true, data: videos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Generate transcript for a single video ────────────────────────────────────

router.post('/:brainId/videos/:videoId/transcript', async (req, res) => {
  try {
    // Queue for batch processing — avoids Vercel 10s timeout
    const result = await brain.queueVideoForTranscript(
      req.locationId,
      req.params.brainId,
      req.params.videoId,
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Download transcript text for a single video ───────────────────────────────

router.get('/:brainId/videos/:videoId/transcript', async (req, res) => {
  try {
    const text = await brain.getVideoTranscriptText(
      req.locationId,
      req.params.brainId,
      req.params.videoId,
    );
    if (!text) return res.status(404).json({ success: false, error: 'Transcript not found' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transcript-${req.params.videoId}.txt"`);
    res.send(text);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Changelog notes (manual docs / notes per brain) ──────────────────────────

router.post('/:brainId/changelog', async (req, res) => {
  const { title, text = '', noteType = 'note' } = req.body;
  if (!title?.trim()) return res.status(400).json({ success: false, error: '"title" is required.' });
  try {
    const b = await brain.getBrain(req.locationId, req.params.brainId);
    const entry = {
      id:    `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts:    new Date().toISOString(),
      type:  noteType,
      title: title.trim(),
      text:  text.trim(),
    };
    const notes  = [...(b.notes || []), entry];
    const result = await brain.updateBrainMeta(req.locationId, req.params.brainId, { notes });
    res.json({ success: true, entry, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:brainId/changelog/:entryId', async (req, res) => {
  try {
    const b     = await brain.getBrain(req.locationId, req.params.brainId);
    const notes = (b.notes || []).filter(n => n.id !== req.params.entryId);
    await brain.updateBrainMeta(req.locationId, req.params.brainId, { notes });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Remove channel from brain ─────────────────────────────────────────────────

router.post('/:brainId/reindex', async (req, res) => {
  try {
    const result = await brain.reindexBrain(req.locationId, req.params.brainId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:brainId/channels/:channelId', async (req, res) => {
  try {
    const result = await brain.removeChannelFromBrain(
      req.locationId,
      req.params.brainId,
      req.params.channelId,
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
