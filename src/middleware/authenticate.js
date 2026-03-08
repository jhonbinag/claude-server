/**
 * authenticate.js
 *
 * Express middleware that gates every protected endpoint.
 *
 * Flow:
 *  1. Read x-api-key from request header
 *  2. Validate it against the store → resolve locationId
 *  3. Ensure GHL tokens exist for that location (app was installed)
 *  4. Touch the tool-session token (sliding 7-day window, debounced 6h)
 *  5. Attach locationId and a ready-to-use ghlRequest helper to req
 */

const apiKeyService    = require('../services/apiKeyService');
const tokenStore       = require('../services/tokenStore');
const ghlClient        = require('../services/ghlClient');
const toolTokenService = require('../services/toolTokenService');
const activityLogger   = require('../services/activityLogger');
const config           = require('../config');

async function authenticate(req, res, next) {
  try {
    const apiKey = req.headers[config.apiKeyHeader];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error:   'Missing API key. Include it in the x-api-key header.',
      });
    }

    const locationId = await apiKeyService.validateApiKey(apiKey);
    if (!locationId) {
      return res.status(401).json({ success: false, error: 'Invalid API key.' });
    }

    const record = await tokenStore.getTokenRecord(locationId);
    if (!record || !record.refreshToken) {
      return res.status(403).json({
        success: false,
        error:   'App is not installed for this location. Complete the OAuth flow first.',
      });
    }

    // Attach helpers to req
    req.locationId = locationId;
    req.companyId  = record.companyId;
    req.ghl = (method, endpoint, data, params) =>
      ghlClient.ghlRequest(locationId, method, endpoint, data, params);

    // Touch token — sliding-window refresh (debounced, fire-and-forget)
    toolTokenService.touchToken(locationId).catch(() => {});

    next();
  } catch (err) {
    console.error('[Auth Middleware] Error:', err.message);
    res.status(500).json({ success: false, error: 'Authentication error.' });
  }
}

module.exports = authenticate;
