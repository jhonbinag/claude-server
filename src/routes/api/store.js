/**
 * routes/api/store.js
 *
 * GHL Store API — e-commerce store management.
 *
 * Scopes required:
 *   store/shipping.readonly  — read shipping carriers, zones, rates
 *   store/shipping.write     — create/update/delete carriers, zones, rates
 *   store/setting.readonly   — read store settings
 *   store/setting.write      — update store settings
 *
 * Mounted at: /api/v1/store
 */

const express = require('express');
const router  = express.Router();

// ─── Store Settings ───────────────────────────────────────────────────────────

// GET store settings for a location
router.get('/settings', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/store/settings', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update store settings
router.put('/settings', async (req, res) => {
  try {
    const data = await req.ghl('PUT', '/store/settings', { ...req.body, locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Shipping Carriers ────────────────────────────────────────────────────────

// GET list all shipping carriers for a location
router.get('/shipping/carriers', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/shipping-carrier', null, {
      altId:   req.locationId,
      altType: 'location',
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST register a custom shipping carrier
// Body: { name, callbackUrl }
// callbackUrl = your live-rates endpoint that GHL will POST to during checkout
router.post('/shipping/carriers', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/shipping-carrier', {
      altId:   req.locationId,
      altType: 'location',
      name:        req.body.name,
      callbackUrl: req.body.callbackUrl,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE remove a shipping carrier (call on app uninstall)
router.delete('/shipping/carriers/:carrierId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/shipping-carrier/${req.params.carrierId}`, null, {
      altId:   req.locationId,
      altType: 'location',
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Shipping Zones ───────────────────────────────────────────────────────────

// GET list shipping zones
router.get('/shipping/zones', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/shipping-zone', null, {
      altId:   req.locationId,
      altType: 'location',
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create a shipping zone
router.post('/shipping/zones', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/shipping-zone', {
      altId:   req.locationId,
      altType: 'location',
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update a shipping zone
router.put('/shipping/zones/:zoneId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/shipping-zone/${req.params.zoneId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE a shipping zone
router.delete('/shipping/zones/:zoneId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/shipping-zone/${req.params.zoneId}`, null, {
      altId:   req.locationId,
      altType: 'location',
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Shipping Rates (within a Zone) ──────────────────────────────────────────

// GET shipping rates for a zone
router.get('/shipping/zones/:zoneId/rates', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/shipping-zones/${req.params.zoneId}/rates`, null, {
      altId:   req.locationId,
      altType: 'location',
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create a shipping rate in a zone
// Body: { name, amount, isCarrierRate, shippingCarrierId, minOrderAmount, maxOrderAmount }
router.post('/shipping/zones/:zoneId/rates', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/shipping-zones/${req.params.zoneId}/rates`, {
      altId:   req.locationId,
      altType: 'location',
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update a shipping rate
router.put('/shipping/zones/:zoneId/rates/:rateId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/shipping-zones/${req.params.zoneId}/rates/${req.params.rateId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE a shipping rate
router.delete('/shipping/zones/:zoneId/rates/:rateId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/shipping-zones/${req.params.zoneId}/rates/${req.params.rateId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Live Rates Callback (your server → GHL checkout) ────────────────────────
// GHL will POST to your callbackUrl during checkout requesting live rates.
// This route handles that inbound request from GHL so you can return rates.
// Expose: POST /store/shipping/live-rates
// Register this URL as your callbackUrl when creating a carrier.

router.post('/shipping/live-rates', (req, res) => {
  const { origin, destination, items, currency } = req.body;

  // TODO: Calculate real rates using your shipping carrier API (UPS, FedEx, etc.)
  // Return the rates array — GHL will display these to the customer at checkout.
  const rates = [
    {
      serviceName:   'Standard Shipping',
      amount:        5.99,
      currency:      currency || 'USD',
      estimatedDays: 5,
    },
    {
      serviceName:   'Express Shipping',
      amount:        14.99,
      currency:      currency || 'USD',
      estimatedDays: 2,
    },
  ];

  res.json({ rates });
});

module.exports = router;
