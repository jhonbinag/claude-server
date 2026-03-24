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
const config       = require('../config');

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

router.post('/:brainId/ask', async (req, res) => {
  const { query, k = 10 } = req.body;
  const tag = `[brain/ask brain=${req.params.brainId?.slice(-6)} loc=${req.locationId?.slice(0,8)}]`;

  process.stdout.write(`${tag} ── START query="${query}" k=${k}\n`);

  if (!query) return res.status(400).json({ success: false, error: '"query" is required.' });

  try {
    // 1. Retrieve relevant chunks
    process.stdout.write(`${tag} [1/4] querying knowledge base…\n`);
    const t0 = Date.now();
    const chunks = await brain.queryKnowledge(req.locationId, req.params.brainId, query, k);
    process.stdout.write(`${tag} [1/4] done — ${chunks.length} chunks in ${Date.now() - t0}ms\n`);

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

    // 3. Get Anthropic client (per-location key → fallback to server key)
    process.stdout.write(`${tag} [3/4] loading Anthropic API key…\n`);
    const configs = await toolRegistry.loadToolConfigs(req.locationId);
    const apiKey  = configs.anthropic?.apiKey || config.anthropic?.apiKey;
    if (!apiKey) {
      process.stdout.write(`${tag} ✗ no Anthropic API key found\n`);
      return res.status(400).json({ success: false, error: 'Claude API key not configured. Go to Settings → Integrations → Claude AI.' });
    }
    process.stdout.write(`${tag} [3/4] API key found (${apiKey.slice(0, 10)}…)\n`);

    const client = new Anthropic.default({ apiKey });

    // 4. Stream the answer
    process.stdout.write(`${tag} [4/4] opening SSE stream to client…\n`);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    res.write(`data: ${JSON.stringify({ type: 'sources', sources: chunks.map(c => ({ sourceLabel: c.sourceLabel, url: c.url, score: c.score, isPrimary: c.isPrimary })) })}\n\n`);

    process.stdout.write(`${tag} [4/4] calling Claude claude-sonnet-4-6…\n`);
    const t1 = Date.now();
    let charCount = 0;

    const stream = client.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are a helpful AI assistant that answers questions based strictly on the provided transcript content from a YouTube knowledge base.

Rules:
- Answer only from the provided context. Do not add outside knowledge.
- Be concise but complete. Use bullet points or short paragraphs as appropriate.
- If the context doesn't contain enough information to answer, say so clearly.
- When referencing specific content, mention the video/source it came from.
- Do not repeat the question back.`,
      messages: [{
        role: 'user',
        content: `Context from knowledge base:\n\n${context}\n\n---\n\nQuestion: ${query}`,
      }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        charCount += event.delta.text.length;
        res.write(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`);
      }
    }

    process.stdout.write(`${tag} ✓ DONE — Claude replied ${charCount} chars in ${Date.now() - t1}ms\n`);
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
    const result = await brain.generateVideoTranscript(
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

// ── Remove channel from brain ─────────────────────────────────────────────────

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
