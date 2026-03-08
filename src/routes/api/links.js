const express = require('express');
const router  = express.Router();

// GET /links
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/links/', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST /links
router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/links/', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT /links/:linkId
router.put('/:linkId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/links/${req.params.linkId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE /links/:linkId
router.delete('/:linkId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/links/${req.params.linkId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
