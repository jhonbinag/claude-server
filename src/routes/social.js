/**
 * social.js — Social Planner routes
 * Proxies GoHighLevel Social Media Posting API endpoints.
 * Uses ghlClient directly (same pattern as ghlTools.js) — does NOT depend on req.ghl.
 */

const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const ghlClient    = require('../services/ghlClient');

router.use(authenticate);

// GET /social/accounts — list connected social accounts for the location
router.get('/accounts', async (req, res) => {
  try {
    const data = await ghlClient.ghlRequest(
      req.locationId, 'GET',
      `/social-media-posting/${req.locationId}/accounts`
    );
    res.json(data);
  } catch (err) {
    console.error('[Social] accounts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /social/posts?status=SCHEDULED|PUBLISHED|DRAFT&page=1&limit=20
router.get('/posts', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const params = { page, limit };
    if (status) params.status = status;
    const data = await ghlClient.ghlRequest(
      req.locationId, 'GET',
      `/social-media-posting/${req.locationId}/posts`,
      null, params
    );
    res.json(data);
  } catch (err) {
    console.error('[Social] posts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /social/posts — create / schedule a social post
router.post('/posts', async (req, res) => {
  try {
    const { summary, status = 'NOW', scheduledDate, accountIds } = req.body;
    if (!summary)                        return res.status(400).json({ error: 'summary is required.' });
    if (!accountIds || !accountIds.length) return res.status(400).json({ error: 'At least one accountId is required.' });

    const payload = { summary, status, accountIds };
    if (scheduledDate) payload.scheduledDate = scheduledDate;

    const data = await ghlClient.ghlRequest(
      req.locationId, 'POST',
      `/social-media-posting/${req.locationId}/posts`,
      payload
    );
    res.json(data);
  } catch (err) {
    console.error('[Social] create post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /social/posts/:postId
router.delete('/posts/:postId', async (req, res) => {
  try {
    const data = await ghlClient.ghlRequest(
      req.locationId, 'DELETE',
      `/social-media-posting/${req.locationId}/posts/${req.params.postId}`
    );
    res.json(data);
  } catch (err) {
    console.error('[Social] delete post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
