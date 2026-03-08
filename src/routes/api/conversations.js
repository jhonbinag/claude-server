const express = require('express');
const router  = express.Router();

// GET /conversations/search
router.get('/search', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/conversations/search', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET /conversations/:conversationId
router.get('/:conversationId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/conversations/${req.params.conversationId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST /conversations
router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/conversations/', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT /conversations/:conversationId
router.put('/:conversationId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/conversations/${req.params.conversationId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE /conversations/:conversationId
router.delete('/:conversationId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/conversations/${req.params.conversationId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Messages ─────────────────────────────────────────────────────────────────

// POST /conversations/messages
router.post('/messages', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/conversations/messages', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST /conversations/messages/inbound
router.post('/messages/inbound', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/conversations/messages/inbound', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST /conversations/messages/upload
router.post('/messages/upload', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/conversations/messages/upload', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT /conversations/messages/:messageId/status
router.put('/messages/:messageId/status', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/conversations/messages/${req.params.messageId}/status`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE /conversations/messages/:messageId/schedule
router.delete('/messages/:messageId/schedule', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/conversations/messages/${req.params.messageId}/schedule`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE /conversations/messages/email/:emailMessageId/schedule
router.delete('/messages/email/:emailMessageId/schedule', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/conversations/messages/email/${req.params.emailMessageId}/schedule`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET message recording
router.get('/messages/:messageId/locations/:locationId/recording', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/conversations/messages/${req.params.messageId}/locations/${req.params.locationId}/recording`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET message transcription
router.get('/locations/:locationId/messages/:messageId/transcription', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/conversations/locations/${req.params.locationId}/messages/${req.params.messageId}/transcription`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET transcription download
router.get('/locations/:locationId/messages/:messageId/transcription/download', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/conversations/locations/${req.params.locationId}/messages/${req.params.messageId}/transcription/download`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Live Chat ────────────────────────────────────────────────────────────────

// POST /conversations/providers/live-chat/typing
router.post('/providers/live-chat/typing', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/conversations/providers/live-chat/typing', req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
