/**
 * src/routes/roles.js
 *
 * User-facing RBAC endpoints — authenticated with x-location-id.
 * Mounts at /roles.
 *
 * Endpoints:
 *   GET  /roles/my-features           — get current user's role + allowed features
 *   GET  /roles/users                 — list all users + roles for this location (admin/owner only)
 *   PUT  /roles/users/:userId         — update a user's role (admin/owner only)
 *   POST /roles/sync                  — re-sync GHL users for this location (admin/owner only)
 */

const express     = require('express');
const router      = express.Router();
const authenticate = require('../middleware/authenticate');
const roleService  = require('../services/roleService');
const ghlClient   = require('../services/ghlClient');

router.use(authenticate);

// ── GET /roles/my-features ────────────────────────────────────────────────────

router.get('/my-features', async (req, res) => {
  const { locationId } = req;
  const userId = req.headers['x-user-id'] || req.userId || null;

  if (!userId) {
    return res.json({ success: true, userId: null, role: 'owner', features: ['*'] });
  }

  try {
    const record   = await roleService.getUserRole(locationId, userId);
    const role     = record?.role || 'member';
    let features   = await roleService.getFeaturesForRole(locationId, role);

    // Intersect with tier allowedFeatures if this role has a tier attached
    const custom = await roleService.getCustomRoles(locationId);
    const roleObj = custom[role];
    if (roleObj?.tier) {
      const planTierStore = require('../services/planTierStore');
      const tier = await planTierStore.getTier(roleObj.tier);
      if (tier && Array.isArray(tier.allowedFeatures)) {
        if (features.includes('*')) {
          features = tier.allowedFeatures;
        } else {
          features = features.filter(f => tier.allowedFeatures.includes(f));
        }
      }
      // if tier.allowedFeatures === null → no restriction (diamond)
    }

    return res.json({ success: true, userId, role, features, tier: roleObj?.tier || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /roles/users ──────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  const { locationId } = req;
  const userId = req.headers['x-user-id'] || req.userId;

  try {
    // Check caller's role — only admin/owner can see the full list
    const callerRecord = userId ? await roleService.getUserRole(locationId, userId) : null;
    const callerRole   = callerRecord?.role || 'owner'; // no userId → treated as owner
    if (callerRole === 'manager' || callerRole === 'member') {
      return res.status(403).json({ success: false, error: 'Insufficient permissions.' });
    }

    const users = await roleService.getUsersForLocation(locationId);
    res.json({ success: true, users: Object.values(users) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /roles/users/:userId ──────────────────────────────────────────────────

router.put('/users/:targetUserId', async (req, res) => {
  const { locationId } = req;
  const { targetUserId } = req.params;
  const { role } = req.body;
  const callerId = req.headers['x-user-id'] || req.userId;

  if (!role) return res.status(400).json({ success: false, error: 'role is required.' });

  try {
    // Only admin/owner can change roles
    const callerRecord = callerId ? await roleService.getUserRole(locationId, callerId) : null;
    const callerRole   = callerRecord?.role || 'owner';
    if (callerRole === 'manager' || callerRole === 'member') {
      return res.status(403).json({ success: false, error: 'Insufficient permissions.' });
    }
    // Non-owners cannot set owner role
    if (role === 'owner' && callerRole !== 'owner') {
      return res.status(403).json({ success: false, error: 'Only an owner can assign the owner role.' });
    }

    const updated = await roleService.setUserRole(locationId, targetUserId, role);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── POST /roles/sync ──────────────────────────────────────────────────────────

router.post('/sync', async (req, res) => {
  const { locationId } = req;
  const callerId = req.headers['x-user-id'] || req.userId;

  try {
    const callerRecord = callerId ? await roleService.getUserRole(locationId, callerId) : null;
    const callerRole   = callerRecord?.role || 'owner';
    if (callerRole === 'manager' || callerRole === 'member') {
      return res.status(403).json({ success: false, error: 'Insufficient permissions.' });
    }

    if (!req.ghl) {
      return res.status(503).json({ success: false, error: 'GHL token not available for this location.' });
    }

    const users = await roleService.syncUsers(locationId, req.ghl, req.userId);
    res.json({ success: true, users: Object.values(users) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
