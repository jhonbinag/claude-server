/**
 * src/routes/betaLab.js
 *
 * User-facing Beta Lab routes — requires standard x-location-id auth.
 * Mounts at /beta
 *
 * GET  /beta/features                        — features visible to this location + role
 * POST /beta/features/:id/toggle             — mini_admin toggles a beta feature on/off
 * POST /beta/features/:id/acknowledge        — dismiss the new-feature banner
 */

const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const betaLabStore = require('../services/betaLabStore');

router.use(authenticate);

// ─── GET /beta/features ────────────────────────────────────────────────────────

router.get('/features', async (req, res) => {
  try {
    const features = await betaLabStore.getFeaturesForLocation(req.locationId, req.userRole);
    res.json({ success: true, data: features });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /beta/features/:id/toggle ───────────────────────────────────────────
// mini_admin only — enables or disables a beta feature for their location

router.post('/features/:id/toggle', async (req, res) => {
  const role = req.userRole;
  const isMiniAdmin = role === 'mini_admin' || role === 'owner' || role === 'admin';
  if (!isMiniAdmin) {
    return res.status(403).json({ success: false, error: 'Only mini_admin or above can toggle beta features.' });
  }
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: '"enabled" boolean required.' });
  }
  try {
    const updated = await betaLabStore.toggleForLocation(req.params.id, req.locationId, enabled);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /beta/features/:id/acknowledge ──────────────────────────────────────
// Dismiss the new-feature banner for this location

router.post('/features/:id/acknowledge', async (req, res) => {
  try {
    await betaLabStore.acknowledgeForLocation(req.params.id, req.locationId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
