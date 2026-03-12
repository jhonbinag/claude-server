/**
 * social.js — Social Planner routes
 * Proxies GoHighLevel Social Media Posting API endpoints.
 * Requires GHL OAuth tokens (req.ghl set by authenticate middleware).
 */

const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');

router.use(authenticate);

// Guard: all social routes require GHL OAuth tokens
function requireGhl(req, res, next) {
  if (!req.ghl) {
    return res.status(503).json({
      error: 'GHL OAuth not connected for this location. Complete the OAuth install flow first.',
      code:  'GHL_OAUTH_REQUIRED',
      locationId: req.locationId,
    });
  }
  next();
}

router.use(requireGhl);

// GET /social/accounts — list connected social accounts for the location
router.get('/accounts', async (req, res) => {
  try {
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
router.post('/posts', async (req, res) => {
  try {
    const { summary, status = 'NOW', scheduledDate, accountIds } = req.body;
    if (!summary)                         return res.status(400).json({ error: 'summary is required.' });
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
    const data = await req.ghl('DELETE', `/social-media-posting/${req.locationId}/posts/${req.params.postId}`);
    res.json(data);
  } catch (err) {
    console.error('[Social] delete post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /social/connect/:platform — get GHL OAuth start URL for a social platform
// platform: facebook | instagram | linkedin | tiktok | twitter | gmb | youtube
router.get('/connect/:platform', async (req, res) => {
  try {
    const { platform } = req.params;
    const { reconnect = 'false' } = req.query;
    const data = await req.ghl(
      'GET',
      `/social-media-posting/oauth/${platform}/start`,
      null,
      { locationId: req.locationId, reconnect }
    );
    console.log('[Social] connect raw response:', JSON.stringify(data));

    // GHL may return the URL in various shapes — dig for it
    const url =
      (typeof data === 'string' && data.startsWith('http') ? data : null) ||
      data?.url || data?.authUrl || data?.oauthUrl ||
      data?.data?.url || data?.data?.authUrl ||
      data?.result?.url || data?.result?.authUrl ||
      null;

    if (!url) {
      // Return the raw response so the frontend can show a useful error
      return res.status(502).json({
        error: 'GHL did not return an OAuth URL.',
        raw: data,
      });
    }
    res.json({ url });
  } catch (err) {
    console.error('[Social] connect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /social/accounts/:accountId — disconnect a social account
router.delete('/accounts/:accountId', async (req, res) => {
  try {
    const data = await req.ghl(
      'DELETE',
      `/social-media-posting/${req.locationId}/accounts/${req.params.accountId}`
    );
    res.json(data);
  } catch (err) {
    console.error('[Social] disconnect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
