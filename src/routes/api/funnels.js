const express = require('express');
const router  = express.Router();

// GET /funnels/funnel/list
router.get('/funnel/list', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/funnels/funnel/list', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET /funnels/page
router.get('/page', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/funnels/page', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET /funnels/page/count
router.get('/page/count', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/funnels/page/count', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST /funnels/page — create a new page inside an existing funnel
router.post('/page', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/funnels/page', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT /funnels/page/:pageId — update funnel page content/settings
router.put('/page/:pageId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/funnels/page/${req.params.pageId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Redirects ────────────────────────────────────────────────────────────────
router.get('/lookup/redirect/list', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/funnels/lookup/redirect/list', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/lookup/redirect', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/funnels/lookup/redirect', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.patch('/lookup/redirect/:id', async (req, res) => {
  try {
    const data = await req.ghl('PATCH', `/funnels/lookup/redirect/${req.params.id}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/lookup/redirect/:id', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/funnels/lookup/redirect/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
