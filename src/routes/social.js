/**
 * social.js — Social Planner routes
 * Proxies GoHighLevel Social Media Posting API endpoints.
 * Requires GHL OAuth tokens (req.ghl set by authenticate middleware).
 */

const express      = require('express');
const router       = express.Router();
const axios        = require('axios');
const authenticate = require('../middleware/authenticate');
const ghlClient    = require('../services/ghlClient');
const config       = require('../config');

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

    // Resolve userId — from token record or fallback to Users API
    let userId = req.userId;
    if (!userId) {
      try {
        const users = await req.ghl('GET', '/users/search', null, { locationId: req.locationId });
        const list = users?.users || users?.data || users || [];
        userId = Array.isArray(list) && list[0]?.id;
        console.log('[Social] resolved userId from Users API:', userId);
      } catch (e) {
        console.warn('[Social] Could not fetch userId from Users API:', e.message);
      }
    }

    const params = { locationId: req.locationId, reconnect };
    if (userId) params.userId = userId;

    // GHL redirects (302) to the platform OAuth URL — we need to capture
    // the Location header instead of following the redirect
    const accessToken = await ghlClient.getValidAccessToken(req.locationId);
    const apiUrl = `${config.ghl.apiBaseUrl}/social-media-posting/oauth/${platform}/start`;

    let url = null;
    try {
      const resp = await axios.get(apiUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: config.ghl.apiVersion,
        },
        params,
        maxRedirects: 0,
        validateStatus: s => s < 400,
      });
      // 200 response — URL may be in body
      url = resp.data?.url || resp.data?.authUrl ||
            (typeof resp.data === 'string' && resp.data.startsWith('http') ? resp.data : null) ||
            resp.headers?.location;
    } catch (redirectErr) {
      // 302 redirect — Location header has the OAuth URL
      url = redirectErr.response?.headers?.location;
      if (!url) throw redirectErr;
    }

    console.log('[Social] connect OAuth URL:', url?.substring(0, 80));
    if (!url) return res.status(502).json({ error: 'GHL did not return an OAuth URL.' });
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
