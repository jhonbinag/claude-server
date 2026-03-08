/**
 * src/middleware/adminAuth.js
 *
 * Protects all /admin/* routes with a separate ADMIN_API_KEY.
 * This key is set in .env and never shared with sub-account users.
 *
 * Header: x-admin-key: <ADMIN_API_KEY>
 */

const config = require('../config');

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];

  if (!key) {
    return res.status(401).json({
      success: false,
      error:   'Missing admin key. Include it in the x-admin-key header.',
    });
  }

  if (!config.adminApiKey) {
    return res.status(503).json({
      success: false,
      error:   'Admin access is not configured. Set ADMIN_API_KEY in your .env file.',
    });
  }

  if (key !== config.adminApiKey) {
    return res.status(403).json({ success: false, error: 'Invalid admin key.' });
  }

  req.adminId = 'admin'; // can be extended to support named admin keys
  next();
}

module.exports = adminAuth;
