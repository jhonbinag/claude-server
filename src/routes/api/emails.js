const express = require('express');
const router  = express.Router();

// GET /emails/builder
router.get('/builder', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/emails/builder', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST /emails/builder
router.post('/builder', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/emails/builder', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST /emails/builder/data
router.post('/builder/data', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/emails/builder/data', req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE /emails/builder/:locationId/:templateId
router.delete('/builder/:locationId/:templateId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/emails/builder/${req.params.locationId}/${req.params.templateId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET /emails/schedule
router.get('/schedule', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/emails/schedule', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
