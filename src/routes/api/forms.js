const express = require('express');
const router  = express.Router();

// GET /forms — scope: forms.readonly
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/forms/', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET /forms/submissions
router.get('/submissions', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/forms/submissions', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
