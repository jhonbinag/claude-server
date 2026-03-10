/**
 * src/routes/admin.js
 *
 * Admin-only API — requires x-admin-key header (ADMIN_API_KEY from .env).
 * Mounts at /admin — NEVER expose this route without adminAuth middleware.
 *
 * Endpoints:
 *   GET  /admin/app-settings               — get GHL app credentials (masked)
 *   POST /admin/app-settings               — save GHL app credentials
 *   GET  /admin/locations                  — list all registered locations
 *   GET  /admin/locations/:id              — single location detail + recent logs
 *   POST /admin/locations/:id/refresh      — force refresh token (keep configs)
 *   POST /admin/locations/:id/restore      — restore an uninstalled location
 *   POST /admin/locations/:id/revoke       — revoke token (force user reconnect)
 *   GET  /admin/logs                       — query activity logs (filterable)
 *   GET  /admin/stats                      — aggregate stats for dashboard header
 */

const express          = require('express');
const router           = express.Router();
const adminAuth        = require('../middleware/adminAuth');
const locationRegistry = require('../services/locationRegistry');
const toolTokenService = require('../services/toolTokenService');
const toolRegistry     = require('../tools/toolRegistry');
const activityLogger   = require('../services/activityLogger');
const firebaseStore    = require('../services/firebaseStore');
const tokenStore       = require('../services/tokenStore');
const appSettings      = require('../services/appSettings');
const billingStore     = require('../services/billingStore');
const workflowStore    = require('../services/workflowStore');
const config           = require('../config');

router.use(adminAuth);

// ─── GET /admin/app-settings — get GHL app credentials (masked) ──────────────

router.get('/app-settings', async (req, res) => {
  try {
    const masked = await appSettings.getGhlSettingsMasked();
    res.json({ success: true, data: masked });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/app-settings — save GHL app credentials ─────────────────────

router.post('/app-settings', async (req, res) => {
  const { clientId, clientSecret, redirectUri } = req.body;
  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(400).json({ success: false, error: 'clientId, clientSecret, and redirectUri are required.' });
  }
  try {
    await appSettings.saveGhlSettings({ clientId, clientSecret, redirectUri });
    activityLogger.log({
      locationId: 'system',
      event:      'app_settings_update',
      detail:     { redirectUri },
      success:    true,
      adminId:    req.adminId,
    });
    res.json({ success: true, message: 'GHL app credentials saved successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Helper: enrich a registry record with live token status ─────────────────

async function enrichLocation(rec) {
  const tokenStat = await toolTokenService.getTokenStatus(rec.locationId);
  let integrationCount = 0;
  try {
    const enabled = await toolRegistry.getEnabledIntegrations(rec.locationId);
    integrationCount = enabled.length;
  } catch { /* non-fatal */ }

  return {
    ...rec,
    tokenStatus:  tokenStat.status,
    tokenIdleDays: tokenStat.idleDays,
    lastActive:   tokenStat.lastActive || rec.lastActive || null,
    integrations: integrationCount,
  };
}

// ─── GET /admin/locations — list all locations ────────────────────────────────

router.get('/locations', async (req, res) => {
  try {
    const { active } = req.query; // ?active=true to exclude uninstalled
    const includeUninstalled = active !== 'true';
    const locations = await locationRegistry.listAllLocations({ includeUninstalled });

    // Enrich in parallel (cap at 20 concurrent to avoid flooding Redis)
    const enriched = await Promise.all(locations.map(enrichLocation));

    res.json({ success: true, count: enriched.length, data: enriched });
  } catch (err) {
    console.error('[Admin] GET /locations error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/locations/:id — single location detail ───────────────────────

router.get('/locations/:id', async (req, res) => {
  const locationId = req.params.id;
  try {
    const rec = await locationRegistry.getLocation(locationId);
    if (!rec) return res.status(404).json({ success: false, error: 'Location not found.' });

    const enriched  = await enrichLocation(rec);
    const tokenRec  = await toolTokenService.getToolSessionToken(locationId);
    const recentLogs = await activityLogger.getLogs({ locationId, limit: 50 });

    // Load connected integration categories
    let toolConfigs = {};
    try { toolConfigs = await toolRegistry.getToolConfig(locationId); } catch { /* ok */ }

    const connectedCategories = Object.keys(toolConfigs).filter(
      (k) => toolConfigs[k] && Object.keys(toolConfigs[k]).length > 0,
    );

    res.json({
      success: true,
      data: {
        ...enriched,
        connectedCategories,
        tokenRecord: tokenRec
          ? { token: tokenRec.token, categories: tokenRec.categories, lastActive: tokenRec.lastActive }
          : null,
        recentLogs,
      },
    });
  } catch (err) {
    console.error('[Admin] GET /locations/:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/locations/:id/refresh — force refresh token ─────────────────
// Keeps all tool configs, just regenerates the token and resets lastActive.

router.post('/locations/:id/refresh', async (req, res) => {
  const locationId = req.params.id;
  try {
    const rec = await locationRegistry.getLocation(locationId);
    if (!rec) return res.status(404).json({ success: false, error: 'Location not found.' });

    // Invalidate cache so getEnabledIntegrations reads fresh data
    await toolTokenService.invalidateToolConfigCache(locationId);
    const enabledCategories = await toolRegistry.getEnabledIntegrations(locationId);
    const token = await toolTokenService.generateToolSessionToken(locationId, enabledCategories);

    // Update lastActive in registry
    await locationRegistry.updateLastActive(locationId);

    activityLogger.log({
      locationId,
      event:   'admin_refresh',
      detail:  { categories: enabledCategories },
      success: true,
      adminId: req.adminId,
    });

    console.log(`[Admin] Refreshed token for ${locationId} (${enabledCategories.length} integrations)`);

    res.json({
      success:    true,
      message:    'Connection refreshed successfully.',
      toolToken:  token,
      categories: enabledCategories,
    });
  } catch (err) {
    console.error('[Admin] POST /locations/:id/refresh error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/locations/:id/restore — restore uninstalled location ─────────
// Re-activates all preserved tool configs and generates a new token.

router.post('/locations/:id/restore', async (req, res) => {
  const locationId = req.params.id;
  try {
    const rec = await locationRegistry.getLocation(locationId);
    if (!rec) return res.status(404).json({ success: false, error: 'Location not found.' });

    if (rec.status !== 'uninstalled') {
      return res.status(400).json({ success: false, error: 'Location is not uninstalled — nothing to restore.' });
    }

    // 1. Mark as active in registry
    await locationRegistry.restoreLocation(locationId, req.adminId);

    // 2. Invalidate cache + re-read configs from Firebase
    await toolTokenService.invalidateToolConfigCache(locationId);
    const enabledCategories = await toolRegistry.getEnabledIntegrations(locationId);

    // 3. Generate new token representing previously connected integrations
    const token = await toolTokenService.generateToolSessionToken(locationId, enabledCategories);

    activityLogger.log({
      locationId,
      event:   'restore',
      detail:  { categories: enabledCategories, restoredBy: req.adminId },
      success: true,
      adminId: req.adminId,
    });

    console.log(`[Admin] Restored location ${locationId} (${enabledCategories.length} integrations) by ${req.adminId}`);

    res.json({
      success:    true,
      message:    `Location ${locationId} restored successfully.`,
      toolToken:  token,
      categories: enabledCategories,
    });
  } catch (err) {
    console.error('[Admin] POST /locations/:id/restore error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/locations/:id/revoke — revoke token (force reconnect) ───────

router.post('/locations/:id/revoke', async (req, res) => {
  const locationId = req.params.id;
  try {
    await toolTokenService.revokeToolSessionToken(locationId);

    activityLogger.log({
      locationId,
      event:   'admin_revoke',
      detail:  {},
      success: true,
      adminId: req.adminId,
    });

    console.log(`[Admin] Token revoked for ${locationId} by ${req.adminId}`);
    res.json({ success: true, message: `Token revoked for ${locationId}. User must reconnect.` });
  } catch (err) {
    console.error('[Admin] POST /locations/:id/revoke error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/logs — query activity logs ────────────────────────────────────

router.get('/logs', async (req, res) => {
  try {
    const { locationId, event, limit = '100', offset = '0' } = req.query;
    const logs = await activityLogger.getLogs({
      locationId: locationId || null,
      event:      event      || null,
      limit:      Math.min(parseInt(limit, 10) || 100, 500),
      offset:     parseInt(offset, 10) || 0,
    });
    res.json({ success: true, count: logs.length, data: logs });
  } catch (err) {
    console.error('[Admin] GET /logs error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/stats — aggregate header stats ───────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const locations  = await locationRegistry.listAllLocations({ includeUninstalled: true });
    const active     = locations.filter((l) => l.status === 'active').length;
    const uninstalled = locations.filter((l) => l.status === 'uninstalled').length;

    // Count idle/expired tokens
    let idleCount = 0, expiredCount = 0;
    for (const loc of locations.filter((l) => l.status === 'active')) {
      const stat = await toolTokenService.getTokenStatus(loc.locationId);
      if (stat.status === 'idle')    idleCount++;
      if (stat.status === 'expired') expiredCount++;
    }

    const recentLogs = await activityLogger.getLogs({ limit: 10 });

    res.json({
      success: true,
      stats: {
        total:       locations.length,
        active,
        uninstalled,
        idle:        idleCount,
        expired:     expiredCount,
      },
      recentActivity: recentLogs,
    });
  } catch (err) {
    console.error('[Admin] GET /stats error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/billing — list all billing records ───────────────────────────

router.get('/billing', async (req, res) => {
  try {
    const records = await billingStore.listAllBilling();
    const summary = {
      total:       records.length,
      active:      records.filter(r => r.status === 'active').length,
      trial:       records.filter(r => r.status === 'trial').length,
      pastDue:     records.filter(r => r.status === 'past_due').length,
      cancelled:   records.filter(r => r.status === 'cancelled').length,
      revenue:     records.filter(r => r.status === 'active').reduce((s, r) => s + (r.amount || 0), 0),
    };
    res.json({ success: true, summary, data: records });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/billing/:locationId — single billing record ──────────────────

router.get('/billing/:locationId', async (req, res) => {
  try {
    const rec = await billingStore.getOrCreateBilling(req.params.locationId);
    res.json({ success: true, data: rec });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/billing/:locationId — create / update subscription ───────────

router.post('/billing/:locationId', async (req, res) => {
  const { plan, status, amount, currency, interval, trialEnd, currentPeriodEnd, notes } = req.body;
  try {
    const rec = await billingStore.updateSubscription(req.params.locationId, {
      plan, status, amount: amount !== undefined ? Number(amount) : undefined,
      currency, interval, trialEnd, currentPeriodEnd, notes,
    });
    activityLogger.log({ locationId: req.params.locationId, event: 'billing_update', detail: { plan, status }, success: true, adminId: req.adminId });
    res.json({ success: true, data: rec });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/billing/:locationId/invoice — create invoice ────────────────

router.post('/billing/:locationId/invoice', async (req, res) => {
  const { amount, currency, description, status, date } = req.body;
  if (amount === undefined) return res.status(400).json({ success: false, error: 'amount required.' });
  try {
    const inv = await billingStore.createInvoice(req.params.locationId, { amount: Number(amount), currency, description, status, date });
    activityLogger.log({ locationId: req.params.locationId, event: 'billing_invoice_create', detail: { amount, status }, success: true, adminId: req.adminId });
    res.json({ success: true, data: inv });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PATCH /admin/billing/:locationId/invoice/:invoiceId — update invoice ────

router.patch('/billing/:locationId/invoice/:invoiceId', async (req, res) => {
  const { status, amount, description, date } = req.body;
  try {
    const inv = await billingStore.updateInvoice(req.params.locationId, req.params.invoiceId, {
      ...(status      !== undefined && { status }),
      ...(amount      !== undefined && { amount: Number(amount) }),
      ...(description !== undefined && { description }),
      ...(date        !== undefined && { date }),
    });
    activityLogger.log({ locationId: req.params.locationId, event: 'billing_invoice_update', detail: { invoiceId: req.params.invoiceId, status }, success: true, adminId: req.adminId });
    res.json({ success: true, data: inv });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /admin/billing/:locationId/invoice/:invoiceId — delete invoice ───

router.delete('/billing/:locationId/invoice/:invoiceId', async (req, res) => {
  try {
    await billingStore.deleteInvoice(req.params.locationId, req.params.invoiceId);
    activityLogger.log({ locationId: req.params.locationId, event: 'billing_invoice_delete', detail: { invoiceId: req.params.invoiceId }, success: true, adminId: req.adminId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/billing/:locationId/refund/:invoiceId — refund ──────────────

router.post('/billing/:locationId/refund/:invoiceId', async (req, res) => {
  try {
    const stripe = billingStore.getStripe();
    const rec    = await billingStore.getBilling(req.params.locationId);
    if (!rec) return res.status(404).json({ success: false, error: 'Billing record not found.' });

    const inv = rec.invoices.find(i => i.id === req.params.invoiceId);
    if (!inv) return res.status(404).json({ success: false, error: 'Invoice not found.' });

    // If Stripe is enabled and this invoice has a Stripe charge, issue real refund
    if (stripe && inv.stripeInvoiceId) {
      try {
        const invoice = await stripe.invoices.retrieve(inv.stripeInvoiceId);
        if (invoice.charge) await stripe.refunds.create({ charge: invoice.charge });
      } catch (stripeErr) {
        console.warn('[Admin] Stripe refund failed:', stripeErr.message);
      }
    }

    const updated = await billingStore.updateInvoice(req.params.locationId, req.params.invoiceId, { status: 'refunded' });
    activityLogger.log({ locationId: req.params.locationId, event: 'billing_refund', detail: { invoiceId: req.params.invoiceId, amount: inv.amount }, success: true, adminId: req.adminId });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /admin/billing/:locationId — delete all billing data ──────────────

router.delete('/billing/:locationId', async (req, res) => {
  try {
    await billingStore.deleteBilling(req.params.locationId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TROUBLESHOOTING — Workflows & Connections (admin read/edit for support)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /admin/locations/:id/workflows — list user's saved workflows ─────────

router.get('/locations/:id/workflows', async (req, res) => {
  try {
    const list = await workflowStore.listWorkflows(req.params.id);
    res.json({ success: true, count: list.length, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /admin/locations/:id/workflows/:wfId — edit a workflow (troubleshoot) ─

router.put('/locations/:id/workflows/:wfId', async (req, res) => {
  const { name, steps, context } = req.body;
  try {
    const list = await workflowStore.listWorkflows(req.params.id);
    const existing = list.find((w) => w.id === req.params.wfId);
    if (!existing) return res.status(404).json({ success: false, error: 'Workflow not found.' });

    const updated = await workflowStore.saveWorkflow(req.params.id, {
      ...existing,
      ...(name    !== undefined && { name }),
      ...(steps   !== undefined && { steps }),
      ...(context !== undefined && { context }),
    });

    activityLogger.log({ locationId: req.params.id, event: 'admin_workflow_edit', detail: { wfId: req.params.wfId }, success: true, adminId: req.adminId });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /admin/locations/:id/workflows/:wfId — delete a workflow ──────────

router.delete('/locations/:id/workflows/:wfId', async (req, res) => {
  try {
    await workflowStore.deleteWorkflow(req.params.id, req.params.wfId);
    activityLogger.log({ locationId: req.params.id, event: 'admin_workflow_delete', detail: { wfId: req.params.wfId }, success: true, adminId: req.adminId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/locations/:id/connections — view full tool configs ─────────────

router.get('/locations/:id/connections', async (req, res) => {
  try {
    const configs = await toolRegistry.getToolConfig(req.params.id);
    // Mask sensitive values (show key existence but not full value)
    const masked = {};
    for (const [cat, cfg] of Object.entries(configs || {})) {
      masked[cat] = {};
      for (const [k, v] of Object.entries(cfg || {})) {
        if (typeof v === 'string' && v.length > 8) {
          masked[cat][k] = v.slice(0, 4) + '••••' + v.slice(-4);
        } else {
          masked[cat][k] = v;
        }
      }
    }
    res.json({ success: true, data: masked });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /admin/locations/:id/connections/:category — clear a broken integration

router.delete('/locations/:id/connections/:category', async (req, res) => {
  const { id, category } = req.params;
  try {
    if (config.isFirebaseEnabled) {
      await firebaseStore.deleteToolConfig(id, category);
    } else {
      const existing = await toolRegistry.getToolConfig(id);
      const updated  = { ...existing };
      delete updated[category];
      await toolTokenService.setCachedToolConfig(id, updated, 90 * 24 * 3600);
    }
    await toolTokenService.invalidateToolConfigCache(id);

    activityLogger.log({ locationId: id, event: 'admin_connection_clear', detail: { category }, success: true, adminId: req.adminId });
    res.json({ success: true, message: `${category} connection cleared for ${id}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
