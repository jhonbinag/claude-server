/**
 * authenticate.js
 *
 * Validates requests using:
 *   x-location-id: <locationId>   (required)
 *
 * A location is authenticated once its Anthropic API key has been stored
 * via POST /api/activate. No OAuth or separate app key needed.
 */

const toolRegistry = require('../tools/toolRegistry');
const ghlClient    = require('../services/ghlClient');
const tokenStore   = require('../services/tokenStore');

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

    // A location is activated once it has an Anthropic API key stored
    const configs = await toolRegistry.loadToolConfigs(locationId);
    if (!configs.anthropic?.apiKey) {
      return res.status(401).json({
        success:    false,
        error:      'Location not activated. Enter your Anthropic API key to get started.',
        needsSetup: true,
      });
    }

    req.locationId = locationId;

    // Attach GHL helper if OAuth tokens exist (optional)
    const record = await tokenStore.getTokenRecord(locationId).catch(() => null);
    if (record && record.refreshToken) {
      req.companyId = record.companyId;
      req.ghl = (method, endpoint, data, params) =>
        ghlClient.ghlRequest(locationId, method, endpoint, data, params);
    }

    next();
  } catch (err) {
    console.error('[Auth Middleware] Error:', err.message);
    res.status(500).json({ success: false, error: 'Authentication error.' });
  }
}

module.exports = authenticate;
