const express = require('express');
const router  = express.Router();

// GET /workflows — scope: workflows.readonly
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/workflows/', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
