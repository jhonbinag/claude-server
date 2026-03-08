const express = require('express');
const router  = express.Router();

// GET /opportunities/pipelines
router.get('/pipelines', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/opportunities/pipelines', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET /opportunities/search
router.get('/search', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/opportunities/search', null, { location_id: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET /opportunities/:id
router.get('/:id', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/opportunities/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST /opportunities
router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/opportunities/', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT /opportunities/:id
router.put('/:id', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/opportunities/${req.params.id}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT /opportunities/:id/status
router.put('/:id/status', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/opportunities/${req.params.id}/status`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE /opportunities/:id
router.delete('/:id', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/opportunities/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
