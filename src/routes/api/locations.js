const express = require('express');
const router  = express.Router();

// ─── Location ─────────────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/locations/search', null, req.query);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/timezones', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/locations/timeZones');
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:locationId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/locations/${req.params.locationId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/locations/', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:locationId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/locations/${req.params.locationId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:locationId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/locations/${req.params.locationId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Custom Values ────────────────────────────────────────────────────────────
router.get('/:locationId/customValues', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/locations/${req.params.locationId}/customValues`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:locationId/customValues/:id', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/locations/${req.params.locationId}/customValues/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:locationId/customValues', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/locations/${req.params.locationId}/customValues`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:locationId/customValues/:id', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/locations/${req.params.locationId}/customValues/${req.params.id}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:locationId/customValues/:id', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/locations/${req.params.locationId}/customValues/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Custom Fields ────────────────────────────────────────────────────────────
router.get('/:locationId/customFields', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/locations/${req.params.locationId}/customFields`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:locationId/customFields/:id', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/locations/${req.params.locationId}/customFields/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:locationId/customFields', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/locations/${req.params.locationId}/customFields`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:locationId/customFields/:id', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/locations/${req.params.locationId}/customFields/${req.params.id}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:locationId/customFields/:id', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/locations/${req.params.locationId}/customFields/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Tags ─────────────────────────────────────────────────────────────────────
router.get('/:locationId/tags', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/locations/${req.params.locationId}/tags`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:locationId/tags/:tagId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/locations/${req.params.locationId}/tags/${req.params.tagId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:locationId/tags/', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/locations/${req.params.locationId}/tags/`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:locationId/tags/:tagId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/locations/${req.params.locationId}/tags/${req.params.tagId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:locationId/tags/:tagId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/locations/${req.params.locationId}/tags/${req.params.tagId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Templates ────────────────────────────────────────────────────────────────
router.get('/:locationId/templates', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/locations/${req.params.locationId}/templates`, null, req.query);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Tasks Search ─────────────────────────────────────────────────────────────
router.post('/:locationId/tasks/search', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/locations/${req.params.locationId}/tasks/search`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
