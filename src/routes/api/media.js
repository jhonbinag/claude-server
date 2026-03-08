const express = require('express');
const router  = express.Router();

// GET /medias/files
router.get('/files', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/medias/files', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST /medias/upload-file
router.post('/upload-file', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/medias/upload-file', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE /medias/:fileId
router.delete('/:fileId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/medias/${req.params.fileId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
