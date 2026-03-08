const express = require('express');
const router  = express.Router();

// GET /campaigns — scope: campaigns.readonly
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/campaigns/', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
