/**
 * routes/api/companies.js
 *
 * GHL Companies API — Agency-level management of the company and its sub-accounts.
 *
 * Scope: companies.readonly (Agency access required)
 *
 * This is the agency "company" layer — above sub-accounts (locations).
 * Used for SaaS agencies that manage multiple client sub-accounts.
 *
 * Sub-Account (SaaS) operations:
 *   - List all sub-accounts under the company
 *   - Create / update / delete sub-accounts
 *   - Get sub-account details
 *   - Manage SaaS plan per sub-account (via saas routes, referenced here for clarity)
 *
 * Mounted at: /api/v1/companies
 */

const express = require('express');
const router  = express.Router();

// ─── Company ──────────────────────────────────────────────────────────────────

// GET the agency company details
router.get('/', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/companies', null, { companyId: req.companyId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET a specific company by ID
router.get('/:companyId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/companies/${req.params.companyId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Sub-Accounts Under Company (SaaS) ───────────────────────────────────────

// GET list all sub-accounts (locations) under the company
// Query: { limit, skip, search, isActive }
router.get('/:companyId/sub-accounts', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/locations/search', null, {
      companyId: req.params.companyId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// GET details of a specific sub-account
router.get('/:companyId/sub-accounts/:locationId', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/locations/${req.params.locationId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST create a new sub-account under the company
// Body: { name, address, city, state, country, postalCode, phone, email,
//         website, timezone, snapshotId }
router.post('/:companyId/sub-accounts', async (req, res) => {
  try {
    const data = await req.ghl('POST', '/locations/', {
      companyId: req.params.companyId,
      ...req.body,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update a sub-account
router.put('/:companyId/sub-accounts/:locationId', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/locations/${req.params.locationId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// DELETE a sub-account
router.delete('/:companyId/sub-accounts/:locationId', async (req, res) => {
  try {
    const data = await req.ghl('DELETE', `/locations/${req.params.locationId}`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── SaaS Plan Management Per Sub-Account ────────────────────────────────────

// GET SaaS subscription for a sub-account — saas/location.read
router.get('/:companyId/sub-accounts/:locationId/saas-subscription', async (req, res) => {
  try {
    const data = await req.ghl('GET', `/saas/location/${req.params.locationId}/subscription`);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST enable SaaS for a sub-account — saas/location.write
// Body: { planId, paymentProvider, subscriptionId }
router.post('/:companyId/sub-accounts/:locationId/enable-saas', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/enable-saas/${req.params.locationId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// PUT update SaaS subscription for a sub-account — saas/location.write
// Body: { planId, subscriptionId, status }
router.put('/:companyId/sub-accounts/:locationId/saas-subscription', async (req, res) => {
  try {
    const data = await req.ghl('PUT', `/update-saas-subscription/${req.params.locationId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST disable SaaS for all sub-accounts in the company — saas/company.write
router.post('/:companyId/bulk-disable-saas', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/bulk-disable-saas/${req.params.companyId}`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Snapshots ────────────────────────────────────────────────────────────────

// GET all snapshots available for the company — snapshots.readonly
router.get('/:companyId/snapshots', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/snapshots', null, { companyId: req.params.companyId });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// POST apply a snapshot to a sub-account
// Body: { snapshotId, override }
router.post('/:companyId/sub-accounts/:locationId/apply-snapshot', async (req, res) => {
  try {
    const data = await req.ghl('POST', `/locations/${req.params.locationId}/apply-snapshot`, req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ─── Installed App Locations ──────────────────────────────────────────────────

// GET list all locations where this OAuth app is installed — oauth.readonly
// Query: { limit, skip, isInstalled }
router.get('/:companyId/installed-locations', async (req, res) => {
  try {
    const data = await req.ghl('GET', '/oauth/installedLocations', null, {
      companyId: req.params.companyId,
      ...req.query,
    });
    res.json({ success: true, data });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
