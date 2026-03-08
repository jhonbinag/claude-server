const express = require('express');
const router  = express.Router();

// ─── Search / List ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { query, limit = 20, skip = 0 } = req.query;
    const data = await req.ghl('GET', '/contacts/', null, { locationId: req.locationId, query, limit, skip });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/business/:businessId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/contacts/business/${req.params.businessId}`, null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── CRUD ─────────────────────────────────────────────────────────────────────
router.get('/:contactId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/contacts/${req.params.contactId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/contacts/', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:contactId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/contacts/${req.params.contactId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:contactId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/contacts/${req.params.contactId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Appointments ─────────────────────────────────────────────────────────────
router.get('/:contactId/appointments', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/contacts/${req.params.contactId}/appointments`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Tasks ────────────────────────────────────────────────────────────────────
router.get('/:contactId/tasks', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/contacts/${req.params.contactId}/tasks`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:contactId/tasks/:taskId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/contacts/${req.params.contactId}/tasks/${req.params.taskId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:contactId/tasks', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/contacts/${req.params.contactId}/tasks`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:contactId/tasks/:taskId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/contacts/${req.params.contactId}/tasks/${req.params.taskId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:contactId/tasks/:taskId/completed', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/contacts/${req.params.contactId}/tasks/${req.params.taskId}/completed`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:contactId/tasks/:taskId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/contacts/${req.params.contactId}/tasks/${req.params.taskId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Notes ────────────────────────────────────────────────────────────────────
router.get('/:contactId/notes', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/contacts/${req.params.contactId}/notes`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:contactId/notes/:noteId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/contacts/${req.params.contactId}/notes/${req.params.noteId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:contactId/notes', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/contacts/${req.params.contactId}/notes`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:contactId/notes/:noteId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/contacts/${req.params.contactId}/notes/${req.params.noteId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:contactId/notes/:noteId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/contacts/${req.params.contactId}/notes/${req.params.noteId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Tags ─────────────────────────────────────────────────────────────────────
router.post('/:contactId/tags', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/contacts/${req.params.contactId}/tags`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:contactId/tags', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/contacts/${req.params.contactId}/tags`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Campaigns ────────────────────────────────────────────────────────────────
router.post('/:contactId/campaigns/:campaignId', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/contacts/${req.params.contactId}/campaigns/${req.params.campaignId}`);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:contactId/campaigns/removeAll', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/contacts/${req.params.contactId}/campaigns/removeAll`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:contactId/campaigns/:campaignId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/contacts/${req.params.contactId}/campaigns/${req.params.campaignId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Workflows ────────────────────────────────────────────────────────────────
router.post('/:contactId/workflow/:workflowId', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/contacts/${req.params.contactId}/workflow/${req.params.workflowId}`);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:contactId/workflow/:workflowId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/contacts/${req.params.contactId}/workflow/${req.params.workflowId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
