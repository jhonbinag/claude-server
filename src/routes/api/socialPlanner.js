const express = require('express');
const router  = express.Router();

// ─── Accounts ─────────────────────────────────────────────────────────────────
router.get('/:locationId/accounts', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/social-media-posting/${req.params.locationId}/accounts`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:locationId/accounts/:id', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/social-media-posting/${req.params.locationId}/accounts/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Posts ────────────────────────────────────────────────────────────────────
router.get('/:locationId/posts/:id', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/social-media-posting/${req.params.locationId}/posts/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:locationId/posts/list', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/social-media-posting/${req.params.locationId}/posts/list`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:locationId/posts', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/social-media-posting/${req.params.locationId}/posts`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:locationId/posts/:id', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/social-media-posting/${req.params.locationId}/posts/${req.params.id}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.patch('/:locationId/posts/:id', async (req, res) => {
  try {
    const data = await req.ghl('PATCH', `/social-media-posting/${req.params.locationId}/posts/${req.params.id}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:locationId/posts/:id', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/social-media-posting/${req.params.locationId}/posts/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Categories ───────────────────────────────────────────────────────────────
router.get('/:locationId/categories', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/social-media-posting/${req.params.locationId}/categories`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:locationId/categories/:id', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/social-media-posting/${req.params.locationId}/categories/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Tags ─────────────────────────────────────────────────────────────────────
router.get('/:locationId/tags', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/social-media-posting/${req.params.locationId}/tags`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:locationId/tags/details', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/social-media-posting/${req.params.locationId}/tags/details`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── CSV Import ───────────────────────────────────────────────────────────────
router.get('/:locationId/csv', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/social-media-posting/${req.params.locationId}/csv`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:locationId/csv/:id', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/social-media-posting/${req.params.locationId}/csv/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:locationId/csv', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/social-media-posting/${req.params.locationId}/csv`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.patch('/:locationId/csv/:id', async (req, res) => {
  try {
    const data = await req.ghl('PATCH', `/social-media-posting/${req.params.locationId}/csv/${req.params.id}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:locationId/csv/:id', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/social-media-posting/${req.params.locationId}/csv/${req.params.id}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:locationId/posts/bulk-delete', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/social-media-posting/${req.params.locationId}/posts/bulk-delete`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:locationId/csv/:csvId/post/:postId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/social-media-posting/${req.params.locationId}/csv/${req.params.csvId}/post/${req.params.postId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Social OAuth ─────────────────────────────────────────────────────────────
const PLATFORMS = ['facebook', 'google', 'instagram', 'linkedin', 'tiktok', 'tiktok-business', 'twitter'];

PLATFORMS.forEach((platform) => {
  router.get(`/oauth/${platform}/start`, async (req, res) => {
    try {
      const data = await req.ghl('GET', `/social-media-posting/oauth/${platform}/start`, null, req.query);
      res.json({ success: true, data });
    } catch (err) { res.status(502).json({ success: false, error: err.message }); }
  });

  router.get(`/oauth/:locationId/${platform}/accounts/:accountId`, async (req, res) => {
    try {
      const data = await req.ghl('GET', `/social-media-posting/oauth/${req.params.locationId}/${platform}/accounts/${req.params.accountId}`);
      res.json({ success: true, data });
    } catch (err) { res.status(502).json({ success: false, error: err.message }); }
  });

  router.post(`/oauth/:locationId/${platform}/accounts/:accountId`, async (req, res) => {
    try {
      const data = await req.ghl('POST', `/social-media-posting/oauth/${req.params.locationId}/${platform}/accounts/${req.params.accountId}`, req.body);
      res.json({ success: true, data });
    } catch (err) { res.status(502).json({ success: false, error: err.message }); }
  });
});

router.post('/:locationId/set-accounts', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/social-media-posting/${req.params.locationId}/set-accounts`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
