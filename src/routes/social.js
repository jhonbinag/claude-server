/**
 * social.js — Social Planner routes
 * Proxies GoHighLevel Social Media Posting API endpoints.
 * All routes require authenticate middleware (x-location-id header).
 */

const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');

router.use(authenticate);

// GET /social/accounts — list connected social accounts for the location
router.get('/accounts', async (req, res) => {
  try {
    if (!req.ghl) return res.status(400).json({ error: 'GHL OAuth not available for this location.' });
    const data = await req.ghl('GET', `/social-media-posting/${req.locationId}/accounts`);
    res.json(data);
  } catch (err) {
    console.error('[Social] accounts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /social/posts?status=SCHEDULED|PUBLISHED|DRAFT&page=1&limit=20
router.get('/posts', async (req, res) => {
  try {
    if (!req.ghl) return res.status(400).json({ error: 'GHL OAuth not available for this location.' });
    const { status, page = 1, limit = 20 } = req.query;
    const params = { page, limit };
    if (status) params.status = status;
    const data = await req.ghl('GET', `/social-media-posting/${req.locationId}/posts`, null, params);
    res.json(data);
  } catch (err) {
    console.error('[Social] posts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /social/posts — create / schedule a social post
// Body: { summary, status, scheduledDate, accountIds }
router.post('/posts', async (req, res) => {
  try {
    if (!req.ghl) return res.status(400).json({ error: 'GHL OAuth not available for this location.' });
    const { summary, status = 'NOW', scheduledDate, accountIds } = req.body;
    if (!summary) return res.status(400).json({ error: 'summary is required.' });
    if (!accountIds || !accountIds.length) return res.status(400).json({ error: 'At least one accountId is required.' });

    const payload = { summary, status, accountIds };
    if (scheduledDate) payload.scheduledDate = scheduledDate;

    const data = await req.ghl('POST', `/social-media-posting/${req.locationId}/posts`, payload);
    res.json(data);
  } catch (err) {
    console.error('[Social] create post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /social/posts/:postId
router.delete('/posts/:postId', async (req, res) => {
  try {
    if (!req.ghl) return res.status(400).json({ error: 'GHL OAuth not available for this location.' });
    const data = await req.ghl('DELETE', `/social-media-posting/${req.locationId}/posts/${req.params.postId}`);
    res.json(data);
  } catch (err) {
    console.error('[Social] delete post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
