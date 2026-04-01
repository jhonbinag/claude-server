/**
 * src/routes/dashboard.js
 *
 * Standalone Admin Dashboard API — credential-based auth (no GHL token needed).
 * Mounts at /dashboard.
 *
 * Public:
 *   GET  /dashboard/public-config          — enabled tabs (no auth needed for login screen)
 *   POST /dashboard/login                  — verify username + password → session token
 *   GET  /dashboard/activate/:token        — email activation link → sets account active
 *
 * Authenticated (requires x-dash-token header):
 *   GET  /dashboard/me                     — current credential info
 *   GET  /dashboard/locations              — locations this credential can access
 *   GET  /dashboard/beta                   — beta features for active location
 *   POST /dashboard/beta/:id/toggle        — toggle beta feature
 *   GET  /dashboard/users                  — users at active location
 *   PUT  /dashboard/users/:userId          — change a user's role
 *   POST /dashboard/users/sync             — sync GHL users
 *
 * Multi-location: when credential.locationIds has more than one entry (or ['all']),
 * pass x-dash-location header to specify which location you're operating on.
 */

const express              = require('express');
const router               = express.Router();
const roleService          = require('../services/roleService');
const betaLabStore         = require('../services/betaLabStore');
const dashboardConfigStore = require('../services/dashboardConfigStore');
const credStore            = require('../services/dashboardCredentialStore');
const tokenStore           = require('../services/tokenStore');
const locationRegistry     = require('../services/locationRegistry');
const ghlClient            = require('../services/ghlClient');

let businessProfileStore;
try { businessProfileStore = require('../services/businessProfileStore'); } catch { /* optional */ }

// ── Auth middleware ───────────────────────────────────────────────────────────

async function dashAuth(req, res, next) {
  const token = req.headers['x-dash-token'];
  if (!token) return res.status(401).json({ success: false, error: 'Missing x-dash-token header. Please log in.' });

  const credentialId = credStore.verifyToken(token);
  if (!credentialId) return res.status(401).json({ success: false, error: 'Invalid or expired session. Please log in again.' });

  const cred = await credStore.getCredential(credentialId);
  if (!cred)                    return res.status(401).json({ success: false, error: 'Credential not found.' });
  if (cred.status !== 'active') return res.status(403).json({ success: false, error: 'This account is inactive.' });
  if (!cred.activated)          return res.status(403).json({ success: false, error: 'Account not yet activated.' });

  // Resolve active location
  // Support both old schema (locationId) and new (locationIds)
  const locationIds = cred.locationIds || (cred.locationId ? [cred.locationId] : []);
  const isSingleLocation = locationIds.length === 1 && !locationIds.includes('all');

  let activeLocationId = null;
  if (isSingleLocation) {
    activeLocationId = locationIds[0];
  } else {
    // Multi-location or 'all' — client must specify x-dash-location
    activeLocationId = req.headers['x-dash-location'] || null;
    if (locationIds.includes('all')) {
      // Allow any location; activeLocationId may be null for non-location-specific endpoints
    } else if (activeLocationId && !locationIds.includes(activeLocationId)) {
      return res.status(403).json({ success: false, error: 'Access to this location not permitted.' });
    }
  }

  req.locationId       = activeLocationId;
  req.locationIds      = locationIds;
  req.dashRole         = cred.role || 'mini_admin';
  req.dashCredentialId = credentialId;
  req.dashCred         = cred;
  next();
}

// ── GET /dashboard/public-config — enabled tabs only (pre-login) ──────────────

router.get('/public-config', async (req, res) => {
  try {
    const [cfg, profile] = await Promise.all([
      dashboardConfigStore.getConfig(),
      businessProfileStore ? businessProfileStore.getProfile() : null,
    ]);
    res.json({
      success:         true,
      enabledTabs:     cfg.enabledTabs || [],
      businessProfile: profile || { name: 'HL Pro Tools', tagline: '', logoEmoji: '🧩', logoUrl: '' },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /dashboard/login ─────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username?.trim() || !password?.trim()) {
    return res.status(400).json({ success: false, error: 'username and password are required.' });
  }
  const ip = req.ip || req.headers['x-forwarded-for'] || null;
  const result = await credStore.login(username.trim(), password, ip);
  if (!result.success) return res.status(401).json(result);
  res.json(result);
});

// ── GET /dashboard/activate/:token ───────────────────────────────────────────

router.get('/activate/:token', async (req, res) => {
  try {
    const result = await credStore.activateByToken(req.params.token);
    if (!result.success) {
      // Redirect to login with error param
      return res.redirect(`/ui/admin-dashboard?activation_error=${encodeURIComponent(result.error)}`);
    }
    // Redirect to login page with success flag
    res.redirect('/ui/admin-dashboard?activated=1');
  } catch (err) {
    res.redirect(`/ui/admin-dashboard?activation_error=${encodeURIComponent(err.message)}`);
  }
});

// ── All routes below require a valid session token ────────────────────────────

router.use(dashAuth);

// ── GET /dashboard/me ─────────────────────────────────────────────────────────

router.get('/me', (req, res) => {
  const { passwordHash: _h, passwordSalt: _s, activationToken: _at, ...safe } = req.dashCred;
  res.json({ success: true, credential: safe, role: req.dashRole, locationId: req.locationId, locationIds: req.locationIds });
});

// ── GET /dashboard/locations — returns locations this credential can access ───

router.get('/locations', async (req, res) => {
  try {
    const locationIds = req.locationIds;

    // Try locationRegistry first (Firestore/Redis) — falls back to tokenStore file
    const allRegistered = await locationRegistry.listAllLocations({ includeUninstalled: false }).catch(() => null);

    let locations;
    if (locationIds.includes('all')) {
      if (allRegistered && allRegistered.length > 0) {
        locations = allRegistered.map(r => ({
          locationId:   r.locationId,
          locationName: r.locationName || r.name || '',
          status:       r.status || 'active',
        }));
      } else {
        // tokenStore fallback
        const allIds = tokenStore.listLocations();
        locations = allIds.map(id => {
          const r = tokenStore.getTokenRecord(id);
          return { locationId: id, locationName: r?.locationName || r?.name || '', status: r?.status || 'active' };
        });
      }
    } else {
      // Specific location IDs — look up names from registry
      const registryMap = {};
      if (allRegistered) allRegistered.forEach(r => { registryMap[r.locationId] = r; });
      locations = locationIds.map(id => {
        const reg = registryMap[id];
        if (reg) return { locationId: id, locationName: reg.locationName || reg.name || '', status: reg.status || 'active' };
        const r = tokenStore.getTokenRecord(id);
        return { locationId: id, locationName: r?.locationName || r?.name || '', status: r?.status || 'unknown' };
      });
    }

    res.json({ success: true, locations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /dashboard/beta ───────────────────────────────────────────────────────

router.get('/beta', async (req, res) => {
  if (!req.locationId) return res.status(400).json({ success: false, error: 'No active location. Pass x-dash-location header.' });
  try {
    const features = await betaLabStore.getFeaturesForLocation(req.locationId, req.dashRole);
    res.json({ success: true, data: features });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /dashboard/beta/:id/toggle ──────────────────────────────────────────

router.post('/beta/:id/toggle', async (req, res) => {
  if (!req.locationId) return res.status(400).json({ success: false, error: 'No active location. Pass x-dash-location header.' });
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
  if (!req.locationId) return res.status(400).json({ success: false, error: 'No active location. Pass x-dash-location header.' });
  try {
    const users = await roleService.getUsersForLocation(req.locationId);
    res.json({ success: true, users: Object.values(users) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /dashboard/users/:userId ──────────────────────────────────────────────

router.put('/users/:targetUserId', async (req, res) => {
  if (!req.locationId) return res.status(400).json({ success: false, error: 'No active location. Pass x-dash-location header.' });
  const { role } = req.body;
  if (!role) return res.status(400).json({ success: false, error: 'role required.' });
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
  if (!req.locationId) return res.status(400).json({ success: false, error: 'No active location. Pass x-dash-location header.' });
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
