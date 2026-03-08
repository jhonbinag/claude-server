const express = require('express');
const router  = express.Router();

// ─── Schema ───────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/objects', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:key', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/objects/${req.params.key}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Records ──────────────────────────────────────────────────────────────────
router.get('/:schemaKey/records/:id', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/objects/${req.params.schemaKey}/records/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:schemaKey/records', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/objects/${req.params.schemaKey}/records`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:schemaKey/records/:id', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/objects/${req.params.schemaKey}/records/${req.params.id}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:schemaKey/records/:id', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/objects/${req.params.schemaKey}/records/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
