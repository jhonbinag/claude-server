/**
 * routes/api/phoneSystem.js
 *
 * GHL Phone System / LC Phone API.
 *
 * Covers:
 *  - Phone Numbers: list active numbers per location
 *  - Number Pools:  manage pools of numbers for call tracking / rotation
 *  - LC Phone:      HighLevel's native phone provider (SMS/voice)
 *  - Call Logs:     access call records (also used by Voice AI)
 *
 * Auth: Sub-account or Agency Bearer token (JWT).
 * No dedicated OAuth scope — access is controlled by token type.
 *
 * Mounted at: /api/v1/phone
 */

const express = require('express');
const router  = express.Router();

// ─── Phone Numbers ────────────────────────────────────────────────────────────

// GET list active phone numbers for the location
// Query: { limit, skip, search, excludeNumberPool }
router.get('/numbers', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/phone-system/numbers', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET details of a specific phone number
router.get('/numbers/:numberId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/phone-system/numbers/${req.params.numberId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST purchase/assign a phone number to the location
// Body: { number, type }
router.post('/numbers', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/phone-system/numbers', {
      locationId: req.locationId,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update a phone number (e.g. routing, forwarding)
router.put('/numbers/:numberId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/phone-system/numbers/${req.params.numberId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE release a phone number
router.delete('/numbers/:numberId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/phone-system/numbers/${req.params.numberId}`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Number Pools ─────────────────────────────────────────────────────────────

// GET list number pools for the location
router.get('/pools', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/phone-system/pools', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET a specific number pool
router.get('/pools/:poolId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/phone-system/pools/${req.params.poolId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create a number pool
// Body: { name, numbers[], trackingType }
router.post('/pools', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/phone-system/pools', {
      locationId: req.locationId,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update a number pool
router.put('/pools/:poolId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/phone-system/pools/${req.params.poolId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE a number pool
router.delete('/pools/:poolId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/phone-system/pools/${req.params.poolId}`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── LC Phone (Native GHL Phone Provider) ────────────────────────────────────

// GET LC Phone status / settings for the location
router.get('/lc-phone', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/lc-phone', null, { locationId: req.locationId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET search available numbers to buy via LC Phone
// Query: { countryCode, areaCode, contains, type }
router.get('/lc-phone/search', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/lc-phone/lookup', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST buy a number through LC Phone
// Body: { number, type }
router.post('/lc-phone/buy', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/lc-phone/buy', {
      locationId: req.locationId,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Call Logs ────────────────────────────────────────────────────────────────

// GET list call logs for the location
// Query: { contactId, agentId, callType, startDate, endDate, limit, skip }
router.get('/call-logs', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/phone-system/call-logs', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET a specific call log
router.get('/call-logs/:callId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/phone-system/call-logs/${req.params.callId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
