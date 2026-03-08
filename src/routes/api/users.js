const express = require('express');
const router  = express.Router();

// GET /users
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/users/', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET /users/:userId
router.get('/:userId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/users/${req.params.userId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST /users
router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/users/', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT /users/:userId
router.put('/:userId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/users/${req.params.userId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE /users/:userId
router.delete('/:userId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/users/${req.params.userId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
