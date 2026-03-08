const express = require('express');
const router  = express.Router();

// ─── Products ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/products/', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:productId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/products/${req.params.productId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/products/', { ...req.body, locationId: req.locationId });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:productId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/products/${req.params.productId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:productId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/products/${req.params.productId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Prices ───────────────────────────────────────────────────────────────────
router.get('/:productId/price/', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/products/${req.params.productId}/price/`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/:productId/price/:priceId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/products/${req.params.productId}/price/${req.params.priceId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/:productId/price/', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/products/${req.params.productId}/price/`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.put('/:productId/price/:priceId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/products/${req.params.productId}/price/${req.params.priceId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.delete('/:productId/price/:priceId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/products/${req.params.productId}/price/${req.params.priceId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
