const express = require('express');
const router  = express.Router();

// ─── Orders ───────────────────────────────────────────────────────────────────
router.get('/orders/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/payments/orders/', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/orders/:orderId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/payments/orders/${req.params.orderId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/orders/:orderId/fulfillments', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/payments/orders/${req.params.orderId}/fulfillments`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/orders/:orderId/fulfillments', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/payments/orders/${req.params.orderId}/fulfillments`, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Transactions ─────────────────────────────────────────────────────────────
router.get('/transactions/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/payments/transactions/', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/transactions/:transactionId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/payments/transactions/${req.params.transactionId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Subscriptions ────────────────────────────────────────────────────────────
router.get('/subscriptions/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/payments/subscriptions/', null, { locationId: req.locationId, ...req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/subscriptions/:subscriptionId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/payments/subscriptions/${req.params.subscriptionId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Integrations (Whitelabel) ────────────────────────────────────────────────
router.get('/integrations/provider/whitelabel', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/payments/integrations/provider/whitelabel', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.post('/integrations/provider/whitelabel', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/payments/integrations/provider/whitelabel', req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
