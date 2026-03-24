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
      name, slug, description, docsUrl, changelogUrl, primaryChannel, secondaryChannels,
    });
    res.json({ success: true, data: result });
    if (syncNow && (primaryChannel?.url || (result.channels || []).length > 0)) {
      brain.syncBrainChannels(req.locationId, result.brainId)
        .catch(e => console.error('[brain/create] background sync error:', e));
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
  const { name, description, docsUrl, changelogUrl } = req.body;
  try {
    const result = await brain.updateBrainMeta(req.locationId, req.params.brainId, {
      ...(name        !== undefined && { name:        name.trim() }),
      ...(description !== undefined && { description: description.trim() }),
      ...(docsUrl     !== undefined && { docsUrl:     docsUrl.trim() }),
      ...(changelogUrl !== undefined && { changelogUrl: changelogUrl.trim() }),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Trigger sync ──────────────────────────────────────────────────────────────

router.post('/:brainId/sync', async (req, res) => {
  try {
    // Set stage to needs_sync immediately, then kick off background sync
    await brain.updateBrainMeta(req.locationId, req.params.brainId, { pipelineStage: 'syncing' });
    res.json({ success: true, message: 'Sync started.' });
    brain.syncBrainChannels(req.locationId, req.params.brainId)
      .catch(e => console.error('[brain/sync] background sync error:', e));
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

// ── Query / search ────────────────────────────────────────────────────────────

router.post('/:brainId/query', async (req, res) => {
  const { query, k } = req.body;
  if (!query) return res.status(400).json({ success: false, error: '"query" is required.' });
  try {
    const results = await brain.queryKnowledge(
      req.locationId,
      req.params.brainId,
      query,
      k || 5,
    );
    res.json({ success: true, data: results });
  } catch (err) {
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
