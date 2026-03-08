/**
 * routes/api/lcEmail.js
 *
 * GHL LC Email API — HighLevel's native email provider stats and management.
 *
 * Scope: lc-email.readonly
 *
 * LC Email is HighLevel's built-in SMTP/email sending system.
 * This API provides access to:
 *  - Email send stats (opens, clicks, bounces, complaints, unsubscribes)
 *  - Email verification status
 *  - Domain/sender reputation data
 *
 * Mounted at: /api/v1/lc-email
 */

const express = require('express');
const router  = express.Router();

// ─── Email Stats ──────────────────────────────────────────────────────────────

// GET email sending stats for the location
// Query: { startDate, endDate, limit, skip }
router.get('/stats', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/lc-email/stats', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET stats for a specific email message
router.get('/stats/:messageId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/lc-email/stats/${req.params.messageId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Email Verification ───────────────────────────────────────────────────────

// POST verify an email address
// Body: { email }
router.post('/verify', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/lc-email/verify', {
      locationId: req.locationId,
      email:      req.body.email,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Sending Domains ──────────────────────────────────────────────────────────

// GET list configured sending domains for the location
router.get('/domains', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/lc-email/domains', null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET DNS verification status for a domain
router.get('/domains/:domain/verify', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/lc-email/domains/${req.params.domain}/verify`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST add/register a sending domain
// Body: { domain }
router.post('/domains', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/lc-email/domains', {
      locationId: req.locationId,
      domain:     req.body.domain,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE a sending domain
router.delete('/domains/:domain', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/lc-email/domains/${req.params.domain}`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Suppression List ─────────────────────────────────────────────────────────

// GET suppression list (bounced/unsubscribed emails)
// Query: { type, limit, skip }  type: 'bounce' | 'complaint' | 'unsubscribe'
router.get('/suppressions', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/lc-email/suppressions', null, {
      locationId: req.locationId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE remove an email from the suppression list
router.delete('/suppressions/:email', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/lc-email/suppressions/${req.params.email}`, null, {
      locationId: req.locationId,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
