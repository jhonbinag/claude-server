const express = require('express');
const router  = express.Router();

// GET all blog sites
router.get('/site/all', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/blogs/site/all', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET all blog posts
router.get('/posts/all', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/blogs/posts/all', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET check slug
router.get('/posts/url-slug-exists', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/blogs/posts/url-slug-exists', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create blog post
router.post('/posts', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/blogs/posts', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update blog post
router.put('/posts/:postId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/blogs/posts/${req.params.postId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET categories
router.get('/categories', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/blogs/categories', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET authors
router.get('/authors', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/blogs/authors', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
