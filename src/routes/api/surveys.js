const express = require('express');
const router  = express.Router();

// GET /surveys — scope: surveys.readonly
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/surveys/', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET /surveys/submissions
router.get('/submissions', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/surveys/submissions', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
