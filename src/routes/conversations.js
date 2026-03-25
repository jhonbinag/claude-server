const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const store        = require('../services/conversationStore');

// GET /conversations — list all conversations for this location
router.get('/', authenticate, async (req, res) => {
  try {
    const data = await store.listConversations(req.locationId);
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /conversations/:id — get a single conversation with full messages
router.get('/:id', authenticate, async (req, res) => {
  try {
    const conv = await store.getConversation(req.locationId, req.params.id);
    if (!conv) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: conv });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /conversations — create or update a conversation
router.post('/', authenticate, async (req, res) => {
  try {
    const { id, title, messages } = req.body;
    if (!id || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, error: 'id and messages[] required' });
    }
    await store.saveConversation(req.locationId, { id, title, messages });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /conversations/:id — delete a conversation
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await store.deleteConversation(req.locationId, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
