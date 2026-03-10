/**
 * authenticate.js
 *
 * Validates requests using:
 *   x-location-id: <locationId>   (required)
 *
 * A location is authenticated by its locationId alone.
 * Claude uses the server-level ANTHROPIC_API_KEY env var.
 */

const ghlClient  = require('../services/ghlClient');
const tokenStore = require('../services/tokenStore');

async function authenticate(req, res, next) {
  try {
    const locationId = req.headers['x-location-id'];

    if (!locationId) {
      return res.status(401).json({
        success:    false,
        error:      'Missing x-location-id header.',
        needsSetup: true,
      });
    }

    req.locationId = locationId;

    // Attach GHL helper if OAuth tokens exist (optional, non-blocking)
    try {
      const record = await tokenStore.getTokenRecord(locationId);
      if (record && record.refreshToken) {
        req.companyId = record.companyId;
        req.ghl = (method, endpoint, data, params) =>
          ghlClient.ghlRequest(locationId, method, endpoint, data, params);
      }
    } catch (_) {
      // GHL tokens not available — that's fine, GHL tools just won't work
    }

    next();
  } catch (err) {
    console.error('[Auth Middleware] Error:', err.message);
    // Still allow the request through — locationId is all that's required
    if (req.locationId) return next();
    res.status(500).json({ success: false, error: 'Authentication error.' });
  }
}

module.exports = authenticate;
