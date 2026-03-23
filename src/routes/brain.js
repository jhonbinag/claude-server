/**
 * src/routes/brain.js
 *
 * Mounts at /brain
 *
 * GET    /brain/list                      — list all brains
 * POST   /brain/create                    — create brain
 * DELETE /brain/:brainId                  — delete brain
 * GET    /brain/:brainId                  — get brain with docs
 * POST   /brain/:brainId/youtube          — add YouTube video
 * POST   /brain/:brainId/docs             — add text document
 * DELETE /brain/:brainId/docs/:docId      — delete document
 * POST   /brain/:brainId/query            — keyword search
 * GET    /brain/:brainId/status           — brain status
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
  const { name, slug, description } = req.body;
  if (!name) return res.status(400).json({ success: false, error: '"name" is required.' });
  try {
    const result = await brain.createBrain(req.locationId, { name, slug, description });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Routes that need brainId ───────────────────────────────────────────────────
// NOTE: specific sub-paths (/list, /create) must come before /:brainId

// ── Delete brain ──────────────────────────────────────────────────────────────

router.delete('/:brainId', async (req, res) => {
  try {
    const result = await brain.deleteBrain(req.locationId, req.params.brainId);
    res.json({ success: true, ...result });
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

module.exports = router;
