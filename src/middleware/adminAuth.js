/**
 * src/middleware/adminAuth.js
 *
 * Protects /admin/* routes. Accepts two key types via x-admin-key header:
 *
 *  1. ADMIN_API_KEY env var  — full server-wide admin access
 *  2. Sub-location API key   — access scoped to that location (hlpt_... prefix)
 *
 * Header: x-admin-key: <key>
 */

const config          = require('../config');
const apiKeyService   = require('../services/apiKeyService');

async function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];

  if (!key) {
    return res.status(401).json({
      success: false,
      error:   'Missing admin key. Include it in the x-admin-key header.',
    });
  }

  // 1. Master admin key
  if (config.adminApiKey && key === config.adminApiKey) {
    req.adminId     = 'admin';
    req.adminScoped = false;
    return next();
  }

  // 2. Sub-location API key (hlpt_...)
  if (key.startsWith('hlpt_')) {
    const locationId = await apiKeyService.validateApiKey(key);
    if (locationId) {
      req.adminId     = locationId;
      req.locationId  = locationId;
      req.adminScoped = true;
      return next();
    }
  }

  return res.status(403).json({ success: false, error: 'Invalid admin key.' });
}

module.exports = adminAuth;
