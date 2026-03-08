const express = require('express');
const router  = express.Router();

// GET /businesses
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/businesses/', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET /businesses/:businessId
router.get('/:businessId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/businesses/${req.params.businessId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST /businesses
router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/businesses/', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT /businesses/:businessId
router.put('/:businessId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/businesses/${req.params.businessId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE /businesses/:businessId
router.delete('/:businessId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/businesses/${req.params.businessId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
