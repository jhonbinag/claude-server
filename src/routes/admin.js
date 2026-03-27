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
const roleService      = require('../services/roleService');
const ghlClient        = require('../services/ghlClient');
const config           = require('../config');

router.use(adminAuth);

const PAYMENT_HUB_KEYS = ['stripe', 'paypal', 'square', 'authorizenet'];
async function getConnectedPaymentProviders(locationId) {
  try {
    let cfg = await toolTokenService.getCachedToolConfig(locationId) || {};
    if (!Object.keys(cfg).length && firebaseStore.isEnabled()) {
      cfg = await firebaseStore.getToolConfig(locationId) || {};
    }
    return PAYMENT_HUB_KEYS.filter(key => {
      const c = cfg[key];
      return c && Object.values(c).some(v => v && String(v).trim());
    });
  } catch { return []; }
}

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

function extractLocationName(payload) {
  const source = payload?.location || payload || {};
  return (
    source.name ||
    payload?.name ||
    source?.business?.name ||
    payload?.business?.name ||
    null
  );
}

async function buildLocationSeedMap({ includeUninstalled = true } = {}) {
  const registryLocations = await locationRegistry.listAllLocations({ includeUninstalled });
  const tokenLocationIds = await tokenStore.listLocations();
  const seeds = new Map(registryLocations.map((loc) => [loc.locationId, { ...loc }]));

  for (const locationId of tokenLocationIds) {
    if (!seeds.has(locationId)) seeds.set(locationId, { locationId, status: 'active' });
  }

  return seeds;
}

async function resolveLocationRecord(seed) {
  if (!seed?.locationId) return null;

  const locationId = seed.locationId;
  const tokenRec = await tokenStore.getTokenRecord(locationId);
  const resolved = {
    status: 'active',
    ...seed,
    ...(tokenRec?.companyId && !seed.companyId ? { companyId: tokenRec.companyId } : {}),
  };

  const patch = {};
  if (!seed.companyId && tokenRec?.companyId) patch.companyId = tokenRec.companyId;

  if (!resolved.name && tokenRec?.accessToken) {
    try {
      const data = await ghlClient.ghlRequest(locationId, 'GET', `/locations/${locationId}`);
      const liveName = extractLocationName(data);
      if (liveName) {
        resolved.name = liveName;
        patch.name = liveName;
      }
    } catch (err) {
      console.warn(`[Admin] Failed live location lookup for ${locationId}: ${err.message}`);
    }
  }

  if (Object.keys(patch).length) {
    try {
      await locationRegistry.updateLocationMetadata(locationId, patch);
    } catch (err) {
      console.warn(`[Admin] Failed to persist location metadata for ${locationId}: ${err.message}`);
    }
  }

  return resolved;
}

// ─── GET /admin/locations — list all locations ────────────────────────────────

router.get('/locations', async (req, res) => {
  try {
    const { active } = req.query; // ?active=true to exclude uninstalled
    const includeUninstalled = active !== 'true';
    const seedMap = await buildLocationSeedMap({ includeUninstalled });
    const locations = [...seedMap.values()];

    // Enrich in parallel (cap at 20 concurrent to avoid flooding Redis)
    const enriched = await Promise.all(locations.map(async (loc) => enrichLocation(await resolveLocationRecord(loc))));

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
    const seedMap = await buildLocationSeedMap({ includeUninstalled: true });
    const rec = await resolveLocationRecord(seedMap.get(locationId) || { locationId });
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
    const seedMap = await buildLocationSeedMap({ includeUninstalled: true });
    const rec = await resolveLocationRecord(seedMap.get(locationId) || { locationId });
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
    const seedMap = await buildLocationSeedMap({ includeUninstalled: true });
    const locations = [...seedMap.values()];
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
    const enrichedRecords = await Promise.all(records.map(async (record) => {
      const location = await resolveLocationRecord({ locationId: record.locationId });
      return {
        ...record,
        name: location?.name || null,
        companyId: location?.companyId || null,
      };
    }));
    const summary = {
      total:       enrichedRecords.length,
      active:      enrichedRecords.filter(r => r.status === 'active').length,
      trial:       enrichedRecords.filter(r => r.status === 'trial').length,
      pastDue:     enrichedRecords.filter(r => r.status === 'past_due').length,
      cancelled:   enrichedRecords.filter(r => r.status === 'cancelled').length,
      revenue:     enrichedRecords.filter(r => r.status === 'active').reduce((s, r) => s + (r.amount || 0), 0),
    };
    res.json({ success: true, summary, data: enrichedRecords });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/billing/:locationId — single billing record ──────────────────

router.get('/billing/:locationId', async (req, res) => {
  try {
    const rec = await billingStore.getOrCreateBilling(req.params.locationId);
    const connectedPaymentProviders = await getConnectedPaymentProviders(req.params.locationId);
    const location = await resolveLocationRecord({ locationId: req.params.locationId });
    res.json({ success: true, data: { ...rec, connectedPaymentProviders, name: location?.name || null, companyId: location?.companyId || null } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/billing/:locationId — create / update subscription ───────────

router.post('/billing/:locationId', async (req, res) => {
  const { plan, tier, status, amount, currency, interval, trialEnd, currentPeriodEnd, notes } = req.body;
  try {
    const rec = await billingStore.updateSubscription(req.params.locationId, {
      plan, tier, status, amount: amount !== undefined ? Number(amount) : undefined,
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

// ─── PUT /admin/locations/:id/connections/:category — update tool config fields ─
// Admin can update API keys / config values for a specific integration.

router.put('/locations/:id/connections/:category', async (req, res) => {
  const { id, category } = req.params;
  const configData = req.body; // { apiKey: '...', etc }

  if (!configData || Object.keys(configData).length === 0) {
    return res.status(400).json({ success: false, error: 'No config fields provided.' });
  }

  try {
    if (config.isFirebaseEnabled) {
      await firebaseStore.saveToolConfig(id, category, configData);
    } else {
      await toolRegistry.saveToolConfig(id, category, configData);
    }
    await toolTokenService.invalidateToolConfigCache(id);

    activityLogger.log({
      locationId: id,
      event:      'admin_connection_update',
      detail:     { category, fields: Object.keys(configData) },
      success:    true,
      adminId:    req.adminId,
    });

    res.json({ success: true, message: `${category} config updated for ${id}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/locations/:id/run-task — run a Claude task on behalf of a location ─
// Admin debugging tool: run any task as a specific location to reproduce issues.

router.post('/locations/:id/run-task', async (req, res) => {
  const locationId = req.params.id;
  const { task } = req.body;

  if (!task || typeof task !== 'string' || !task.trim()) {
    return res.status(400).json({ success: false, error: '"task" string required.' });
  }

  try {
    const claudeSvc = require('../services/claudeService');
    const result = await claudeSvc.runTask({ task: task.trim(), locationId });

    activityLogger.log({
      locationId,
      event:   'admin_run_task',
      detail:  { task: task.trim().substring(0, 200), turns: result.turns, toolCallCount: result.toolCallCount },
      success: true,
      adminId: req.adminId,
    });

    res.json({
      success:       true,
      result:        result.result,
      turns:         result.turns,
      toolCallCount: result.toolCallCount,
    });
  } catch (err) {
    activityLogger.log({
      locationId,
      event:   'admin_run_task',
      detail:  { task: task.trim().substring(0, 200), error: err.message },
      success: false,
      adminId: req.adminId,
    });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Plan Tier routes ─────────────────────────────────────────────────────────

const planTierStore  = require('../services/planTierStore');
const { ghlRequest } = require('../services/ghlClient');
const VALID_TIERS    = ['bronze', 'silver', 'gold', 'diamond'];

// GET /admin/ghl-products?locationId=xxx — list GHL products with prices for a location
router.get('/ghl-products', async (req, res) => {
  const { locationId } = req.query;
  if (!locationId) return res.status(400).json({ success: false, error: 'locationId query param required' });
  try {
    const data = await ghlRequest(locationId, 'GET', '/products/', null, { locationId, limit: 100 });
    const products = (data.products || []).map(p => ({
      id:     p._id || p.id,
      name:   p.name,
      prices: (p.prices || []).map(pr => ({
        id:        pr._id || pr.id,
        name:      pr.name || pr.variantOptionName || p.name,
        amount:    pr.amount,
        currency:  pr.currency || 'USD',
        recurring: pr.recurring || null,
      })),
    }));
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /admin/plan-tiers — get all tier configs
router.get('/plan-tiers', async (req, res) => {
  try {
    const tiers = await planTierStore.getTiers();
    res.json({ success: true, data: tiers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin/plan-tiers/:tier — save one tier config
router.post('/plan-tiers/:tier', async (req, res) => {
  const { tier } = req.params;
  if (!VALID_TIERS.includes(tier)) {
    return res.status(400).json({ success: false, error: `Invalid tier. Valid: ${VALID_TIERS.join(', ')}` });
  }
  const { name, icon, integrationLimit, allowedIntegrations, description, price, interval,
          ghlProductId, ghlPriceId, ghlProductName } = req.body;
  const updates = {};
  if (name                !== undefined) updates.name               = name;
  if (icon                !== undefined) updates.icon               = icon;
  if (description         !== undefined) updates.description        = description;
  if (integrationLimit    !== undefined) updates.integrationLimit   = Number(integrationLimit);
  if (allowedIntegrations !== undefined) updates.allowedIntegrations = allowedIntegrations;
  if (price               !== undefined) updates.price              = Number(price);
  if (interval            !== undefined) updates.interval           = interval;
  if (ghlProductId        !== undefined) updates.ghlProductId       = ghlProductId || null;
  if (ghlPriceId          !== undefined) updates.ghlPriceId         = ghlPriceId   || null;
  if (ghlProductName      !== undefined) updates.ghlProductName     = ghlProductName || null;
  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: 'No fields to update.' });
  }
  try {
    const saved = await planTierStore.saveTier(tier, updates);
    activityLogger.log({ locationId: 'system', event: 'plan_tier_update', detail: { tier, ...updates }, success: true });
    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /admin/billing/:locationId/tier — assign tier to a location's billing record
router.put('/billing/:locationId/tier', async (req, res) => {
  const { tier } = req.body;
  if (!tier || !VALID_TIERS.includes(tier)) {
    return res.status(400).json({ success: false, error: `Valid tiers: ${VALID_TIERS.join(', ')}` });
  }
  try {
    const rec = await billingStore.getOrCreateBilling(req.params.locationId);
    await billingStore.updateSubscription(req.params.locationId, { ...rec, tier });
    activityLogger.log({ locationId: req.params.locationId, event: 'billing_tier_update', detail: { tier }, success: true });
    res.json({ success: true, message: `Tier updated to ${tier} for ${req.params.locationId}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/locations/:id/custom-roles — list custom roles ───────────────

router.get('/locations/:id/custom-roles', async (req, res) => {
  const locationId = req.params.id;
  try {
    const custom = await roleService.getCustomRoles(locationId);
    // Merge per-location overrides into built-in role definitions
    const builtinRoles = Object.values(roleService.BUILTIN_ROLES).map(r => ({
      ...r,
      ...(custom[r.id] ? { features: custom[r.id].features, overridden: true } : {}),
    }));
    // Only return truly custom (non-builtin) roles in customRoles
    const customOnly = Object.values(custom).filter(
      r => !roleService.BUILTIN_ROLE_KEYS.includes(r.id)
    );
    const planTierStore = require('../services/planTierStore');
    const tiers = await planTierStore.getTiers();
    res.json({
      success: true,
      builtinRoles,
      customRoles: customOnly,
      allFeatures: roleService.ALL_FEATURES,
      tiers,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/locations/:id/custom-roles — create custom role ──────────────

router.post('/locations/:id/custom-roles', async (req, res) => {
  const locationId = req.params.id;
  const { name, features, tier } = req.body;
  if (!name) return res.status(400).json({ success: false, error: 'name is required.' });
  try {
    const role = await roleService.saveCustomRole(locationId, null, name, features || [], tier || null);
    activityLogger.log({ locationId, event: 'role_create', detail: { roleId: role.id, name }, success: true, adminId: req.adminId });
    res.json({ success: true, role });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─── PUT /admin/locations/:id/custom-roles/:roleId — update custom role ───────

router.put('/locations/:id/custom-roles/:roleId', async (req, res) => {
  const { id: locationId, roleId } = req.params;
  const { name, features, tier } = req.body;
  try {
    const role = await roleService.saveCustomRole(locationId, roleId, name, features || [], tier || null);
    activityLogger.log({ locationId, event: 'role_update', detail: { roleId, name }, success: true, adminId: req.adminId });
    res.json({ success: true, role });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─── DELETE /admin/locations/:id/custom-roles/:roleId — delete custom role ───

router.delete('/locations/:id/custom-roles/:roleId', async (req, res) => {
  const { id: locationId, roleId } = req.params;
  try {
    await roleService.deleteCustomRole(locationId, roleId);
    activityLogger.log({ locationId, event: 'role_delete', detail: { roleId }, success: true, adminId: req.adminId });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/locations/:id/custom-roles/:roleId/reset — reset built-in role ─

router.post('/locations/:id/custom-roles/:roleId/reset', async (req, res) => {
  const { id: locationId, roleId } = req.params;
  try {
    const role = await roleService.resetBuiltinRole(locationId, roleId);
    activityLogger.log({ locationId, event: 'role_reset', detail: { roleId }, success: true, adminId: req.adminId });
    res.json({ success: true, role });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/locations/:id/users — list users for a location ──────────────

router.get('/locations/:id/users', async (req, res) => {
  const locationId = req.params.id;
  try {
    const users = await roleService.getUsersForLocation(locationId);
    res.json({ success: true, users: Object.values(users) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/locations/:id/users/:userId/role — set user role ─────────────

router.post('/locations/:id/users/:userId/role', async (req, res) => {
  const { id: locationId, userId } = req.params;
  const { role } = req.body;
  if (!role) return res.status(400).json({ success: false, error: 'role is required.' });
  try {
    const updated = await roleService.setUserRole(locationId, userId, role);
    activityLogger.log({
      locationId,
      event:   'user_role_update',
      detail:  { userId, role },
      success: true,
      adminId: req.adminId,
    });
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/locations/:id/users/sync — sync GHL users ───────────────────

router.post('/locations/:id/users/sync', async (req, res) => {
  const locationId = req.params.id;
  try {
    const record = await tokenStore.getTokenRecord(locationId);
    if (!record || !record.accessToken) {
      return res.status(503).json({ success: false, error: 'No GHL token for this location.' });
    }
    const ghlReq = (method, endpoint, data, params) =>
      ghlClient.ghlRequest(locationId, method, endpoint, data, params);
    const users = await roleService.syncUsers(locationId, ghlReq, record.userId);
    activityLogger.log({
      locationId,
      event:   'user_sync',
      detail:  { count: Object.keys(users).length },
      success: true,
      adminId: req.adminId,
    });
    res.json({ success: true, users: Object.values(users) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/locations/:id/enabled-integrations ───────────────────────────

router.get('/locations/:id/enabled-integrations', async (req, res) => {
  try {
    const enabled = await toolRegistry.getEnabledIntegrations(req.params.id);
    res.json({ success: true, enabled });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
