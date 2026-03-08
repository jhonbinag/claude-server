/**
 * src/routes/admin.js
 *
 * Admin-only API — requires x-admin-key header (ADMIN_API_KEY from .env).
 * Mounts at /admin — NEVER expose this route without adminAuth middleware.
 *
 * Endpoints:
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
const config           = require('../config');

router.use(adminAuth);

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

module.exports = router;
