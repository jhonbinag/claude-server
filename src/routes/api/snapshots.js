const express = require('express');
const router  = express.Router();

// GET /snapshots — scope: snapshots.readonly (Agency only)
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/snapshots', null, { companyId: req.companyId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
