/**
 * routes/api/knowledgeBase.js
 *
 * GHL Knowledge Base API.
 *
 * Covers:
 *  - Knowledge Base items (CRUD)
 *  - Web Crawler (crawl external URLs and add to KB)
 *  - FAQs (create and manage FAQ entries)
 *
 * Auth: Sub-account or Agency Bearer token (JWT).
 *
 * Mounted at: /api/v1/knowledge-base
 */

const express = require('express');
const router  = express.Router();

// ─── Knowledge Base ───────────────────────────────────────────────────────────

// GET list all knowledge base items for the location
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/knowledge-base/', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET a specific knowledge base item
router.get('/:id', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/knowledge-base/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create a new knowledge base item
// Body: { title, content, type, tags[] }
router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/knowledge-base/', {
      locationId: req.locationId,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update a knowledge base item
router.put('/:id', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/knowledge-base/${req.params.id}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE a knowledge base item
router.delete('/:id', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/knowledge-base/${req.params.id}`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Web Crawler ──────────────────────────────────────────────────────────────

// GET list web crawler jobs for the location
router.get('/web-crawler', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/knowledge-base/web-crawler', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET status of a specific crawler job
router.get('/web-crawler/:jobId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/knowledge-base/web-crawler/${req.params.jobId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST start a new web crawl job
// Body: { url, maxDepth, maxPages, includePatterns[], excludePatterns[] }
router.post('/web-crawler', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/knowledge-base/web-crawler', {
      locationId: req.locationId,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE / cancel a web crawler job
router.delete('/web-crawler/:jobId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/knowledge-base/web-crawler/${req.params.jobId}`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── FAQs ─────────────────────────────────────────────────────────────────────

// GET list all FAQs for the location
router.get('/faqs', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/knowledge-base/faqs', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET a specific FAQ
router.get('/faqs/:faqId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/knowledge-base/faqs/${req.params.faqId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create a new FAQ entry
// Body: { question, answer, tags[] }
router.post('/faqs', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/knowledge-base/faqs', {
      locationId: req.locationId,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update an FAQ entry
router.put('/faqs/:faqId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/knowledge-base/faqs/${req.params.faqId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE an FAQ entry
router.delete('/faqs/:faqId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/knowledge-base/faqs/${req.params.faqId}`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
