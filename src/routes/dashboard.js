/**
 * src/routes/dashboard.js
 *
 * Standalone Admin Dashboard API — no GHL token required.
 * Uses x-location-id header for scoping. No adminAuth.
 * Mounts at /dashboard.
 *
 * GET  /dashboard/config                — enabled tabs + location name
 * GET  /dashboard/beta                  — beta features for this location + role
 * POST /dashboard/beta/:id/toggle       — toggle beta feature (mini_admin+)
 * GET  /dashboard/users                 — users at this location
 * PUT  /dashboard/users/:userId         — change a user's role
 * POST /dashboard/users/sync            — sync GHL users
 */

const express              = require('express');
const router               = express.Router();
const roleService          = require('../services/roleService');
const betaLabStore         = require('../services/betaLabStore');
const dashboardConfigStore = require('../services/dashboardConfigStore');
const tokenStore           = require('../services/tokenStore');
const ghlClient            = require('../services/ghlClient');

// ── Lightweight auth: just needs x-location-id ────────────────────────────────
// Also resolves the caller's role from x-user-id if provided.
async function dashAuth(req, res, next) {
  const locationId = req.headers['x-location-id'];
  if (!locationId) return res.status(401).json({ success: false, error: 'Missing x-location-id header.' });
  req.locationId = locationId;

  const userId = req.headers['x-user-id'] || null;
  req.dashUserId = userId;

  if (userId) {
    try {
      const rec = await roleService.getUserRole(locationId, userId);
      req.dashRole = rec?.role || 'member';
    } catch { req.dashRole = 'member'; }
  } else {
    req.dashRole = 'owner'; // no userId = location-level auth = owner
  }

  next();
}

router.use(dashAuth);

// ── GET /dashboard/config ─────────────────────────────────────────────────────

router.get('/config', async (req, res) => {
  try {
    const cfg = await dashboardConfigStore.getConfig();
    // Try to get location name from token store
    let locationName = null;
    try {
      const rec = await tokenStore.getTokenRecord(req.locationId);
      locationName = rec?.locationName || rec?.name || null;
    } catch {}
    res.json({ success: true, data: cfg, locationId: req.locationId, locationName, role: req.dashRole });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /dashboard/beta ───────────────────────────────────────────────────────

router.get('/beta', async (req, res) => {
  try {
    const features = await betaLabStore.getFeaturesForLocation(req.locationId, req.dashRole);
    res.json({ success: true, data: features });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /dashboard/beta/:id/toggle ──────────────────────────────────────────

router.post('/beta/:id/toggle', async (req, res) => {
  const isMiniAdmin = ['mini_admin', 'owner', 'admin'].includes(req.dashRole);
  if (!isMiniAdmin) return res.status(403).json({ success: false, error: 'Insufficient permissions.' });
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ success: false, error: '"enabled" boolean required.' });
  try {
    const updated = await betaLabStore.toggleForLocation(req.params.id, req.locationId, enabled);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /dashboard/users ──────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  const isMiniAdmin = ['mini_admin', 'owner', 'admin'].includes(req.dashRole);
  if (!isMiniAdmin) return res.status(403).json({ success: false, error: 'Insufficient permissions.' });
  try {
    const users = await roleService.getUsersForLocation(req.locationId);
    res.json({ success: true, users: Object.values(users) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /dashboard/users/:userId ──────────────────────────────────────────────

router.put('/users/:targetUserId', async (req, res) => {
  const isMiniAdmin = ['mini_admin', 'owner', 'admin'].includes(req.dashRole);
  if (!isMiniAdmin) return res.status(403).json({ success: false, error: 'Insufficient permissions.' });
  const { role } = req.body;
  if (!role) return res.status(400).json({ success: false, error: 'role required.' });
  // Prevent privilege escalation: mini_admin cannot assign owner/admin
  if (req.dashRole === 'mini_admin' && ['owner', 'admin'].includes(role)) {
    return res.status(403).json({ success: false, error: 'mini_admin cannot assign owner or admin roles.' });
  }
  try {
    const updated = await roleService.setUserRole(req.locationId, req.params.targetUserId, role);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── POST /dashboard/users/sync ────────────────────────────────────────────────

router.post('/users/sync', async (req, res) => {
  const isMiniAdmin = ['mini_admin', 'owner', 'admin'].includes(req.dashRole);
  if (!isMiniAdmin) return res.status(403).json({ success: false, error: 'Insufficient permissions.' });
  try {
    const record = await tokenStore.getTokenRecord(req.locationId);
    if (!record || !record.accessToken) {
      return res.status(503).json({ success: false, error: 'No GHL token for this location.' });
    }
    const ghlReq = (method, endpoint, data, params) =>
      ghlClient.ghlRequest(req.locationId, method, endpoint, data, params);
    const users = await roleService.syncUsers(req.locationId, ghlReq, record.userId);
    res.json({ success: true, users: Object.values(users) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
