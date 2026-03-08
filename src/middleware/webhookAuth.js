/**
 * webhookAuth.js
 *
 * Verifies incoming GHL webhook requests using RSA-SHA256 signature validation.
 *
 * GHL sends:
 *   - x-wh-signature  : base64-encoded RSA-SHA256 signature of the raw body
 *   - payload.timestamp: ISO timestamp of when the event was sent
 *   - payload.webhookId: unique ID per delivery (for replay protection)
 *
 * Steps:
 *  1. Extract x-wh-signature header
 *  2. Verify signature against raw body using GHL public key
 *  3. Reject if timestamp is older than 5 minutes (replay protection)
 *  4. Reject duplicate webhookIds (replay protection)
 */

const crypto = require('crypto');
const config = require('../config');

// In-memory seen webhookId set (use Redis/DB in production for multi-instance)
const seenWebhookIds = new Set();

// Auto-clean old IDs every 10 minutes to prevent unbounded memory growth
setInterval(() => seenWebhookIds.clear(), 10 * 60 * 1000);

function webhookAuth(req, res, next) {
  try {
    const signature = req.headers['x-wh-signature'];
    const rawBody   = req.rawBody; // attached by express raw body middleware in server.js

    // 1. Signature header must be present
    if (!signature) {
      return res.status(401).json({ success: false, error: 'Missing webhook signature.' });
    }

    // 2. Public key must be configured
    if (!config.ghl.webhookPublicKey) {
      console.error('[WebhookAuth] GHL_WEBHOOK_PUBLIC_KEY not configured.');
      return res.status(500).json({ success: false, error: 'Webhook public key not configured.' });
    }

    // 3. Verify RSA-SHA256 signature
    const verifier = crypto.createVerify('SHA256');
    verifier.update(rawBody);
    const isValid = verifier.verify(config.ghl.webhookPublicKey, signature, 'base64');

    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid webhook signature.' });
    }

    // 4. Parse body for timestamp + webhookId checks
    const payload = req.body;
    const { timestamp, webhookId } = payload;

    // Timestamp must be within 5 minutes
    if (timestamp) {
      const eventTime  = new Date(timestamp).getTime();
      const now        = Date.now();
      const fiveMinMs  = 5 * 60 * 1000;
      if (Math.abs(now - eventTime) > fiveMinMs) {
        return res.status(401).json({ success: false, error: 'Webhook timestamp out of acceptable range (replay protection).' });
      }
    }

    // Reject duplicate webhookIds
    if (webhookId) {
      if (seenWebhookIds.has(webhookId)) {
        return res.status(409).json({ success: false, error: 'Duplicate webhookId rejected (replay protection).' });
      }
      seenWebhookIds.add(webhookId);
    }

    next();
  } catch (err) {
    console.error('[WebhookAuth] Error:', err.message);
    res.status(500).json({ success: false, error: 'Webhook authentication error.' });
  }
}

module.exports = webhookAuth;
