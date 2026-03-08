const express = require('express');
const router  = express.Router();

// POST courses/courses-exporter/public/import — scope: courses.write
router.post('/courses-exporter/public/import', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/courses/courses-exporter/public/import', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
