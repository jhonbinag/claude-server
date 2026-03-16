/**
 * src/routes/knowledge.js
 *
 * Mounts at /knowledge
 *
 * GET    /knowledge/:agentId/status     — Chroma enabled? chunk + doc count
 * GET    /knowledge/:agentId/docs       — list documents
 * POST   /knowledge/:agentId/docs       — add document (text or URL)
 * DELETE /knowledge/:agentId/docs/:docId — delete document
 * POST   /knowledge/:agentId/query      — semantic search preview
 */

const express       = require('express');
const router        = express.Router();
const authenticate  = require('../middleware/authenticate');
const chroma        = require('../services/chromaService');

router.use(authenticate);

// ── GET /:agentId/status ──────────────────────────────────────────────────────

router.get('/:agentId/status', async (req, res) => {
  try {
    const status = await chroma.getStatus(req.locationId, req.params.agentId);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /:agentId/docs ────────────────────────────────────────────────────────

router.get('/:agentId/docs', async (req, res) => {
  try {
    const docs = await chroma.listDocuments(req.locationId, req.params.agentId);
    res.json({ success: true, data: docs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /:agentId/docs — add text or URL ─────────────────────────────────────

router.post('/:agentId/docs', async (req, res) => {
  const { text, url, sourceLabel } = req.body;
  if (!text && !url) {
    return res.status(400).json({ success: false, error: 'Provide "text" or "url".' });
  }
  if (!chroma.isEnabled()) {
    return res.status(503).json({ success: false, error: 'Chroma is not configured. Set CHROMA_API_KEY, CHROMA_TENANT, CHROMA_DATABASE, JINA_API_KEY.' });
  }

  try {
    const result = await chroma.addDocument(req.locationId, req.params.agentId, { text, url, sourceLabel });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Knowledge] addDocument error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /:agentId/docs/:docId ──────────────────────────────────────────────

router.delete('/:agentId/docs/:docId', async (req, res) => {
  if (!chroma.isEnabled()) {
    return res.status(503).json({ success: false, error: 'Chroma is not configured.' });
  }
  try {
    const result = await chroma.deleteDocument(req.locationId, req.params.agentId, req.params.docId);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Knowledge] deleteDocument error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /:agentId/query — semantic search preview ────────────────────────────

router.post('/:agentId/query', async (req, res) => {
  const { query, k } = req.body;
  if (!query) return res.status(400).json({ success: false, error: '"query" is required.' });
  if (!chroma.isEnabled()) {
    return res.status(503).json({ success: false, error: 'Chroma is not configured.' });
  }
  try {
    const results = await chroma.queryKnowledge(req.locationId, req.params.agentId, query, k || 5);
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('[Knowledge] query error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
