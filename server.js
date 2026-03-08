/**
 * server.js — HL Pro Tools GHL Marketplace Backend
 *
 * Entry point. Wires together:
 *  - Express app with raw body capture for webhook signature verification
 *  - OAuth routes        → /oauth/*
 *  - Webhook receiver    → /webhooks/ghl  (RSA-verified GHL events)
 *  - Protected API       → /api/v1/*      (requires x-api-key header)
 *  - Token refresh cron  → runs every 20 hours
 */

require('dotenv').config();

const express    = require('express');
const rateLimit  = require('express-rate-limit');
const cron       = require('node-cron');
const config     = require('./src/config');
const authRoutes    = require('./src/routes/auth');
const apiRoutes     = require('./src/routes/api');
const webhookRoutes = require('./src/routes/webhooks');
const claudeRoutes  = require('./src/routes/claude');
const toolsRoutes   = require('./src/routes/tools');
const adsRoutes     = require('./src/routes/adsGenerator');
const adminRoutes   = require('./src/routes/admin');
const uiRoute       = require('./src/routes/ui');
const tokenStore    = require('./src/services/tokenStore');
const ghlClient     = require('./src/services/ghlClient');

const app = express();

// ─── Raw Body Capture (for webhook RSA signature verification) ────────────────
// Must come before express.json() so rawBody is available in webhookAuth middleware.

app.use((req, res, next) => {
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => { req.rawBody = data; next(); });
});

// ─── Body Parsing ─────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Rate Limiting (mirror GHL limits: 100 req / 10 sec) ─────────────────────

const limiter = rateLimit({
  windowMs:        10 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, error: 'Too many requests. Slow down.' },
});

app.use('/api', limiter);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/oauth',     authRoutes);
app.use('/webhooks',  webhookRoutes);
app.use('/api/v1',    apiRoutes);
app.use('/claude',    claudeRoutes);
app.use('/tools',     toolsRoutes);
app.use('/ads',       adsRoutes);
app.use('/admin',     adminRoutes);
app.use('/ui',        uiRoute);
app.use(express.static('public'));

// Public health check
app.get('/health', (req, res) => {
  res.json({ success: true, service: 'hltools-ghl-marketplace', status: 'running' });
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// ─── Proactive Token Refresh Cron ─────────────────────────────────────────────
// GHL access tokens expire after 24 hours; refresh every 20 hours as a buffer.

cron.schedule('0 */20 * * *', async () => {
  const locations = await tokenStore.listLocations();
  console.log(`[Cron] Proactive token refresh for ${locations.length} location(s)...`);
  for (const locationId of locations) {
    try {
      await ghlClient.refreshAccessToken(locationId);
      console.log(`[Cron] Refreshed: ${locationId}`);
    } catch (err) {
      console.error(`[Cron] Failed to refresh ${locationId}: ${err.message}`);
    }
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║       HL Pro Tools — GHL Marketplace Backend         ║
  ╠══════════════════════════════════════════════════════╣
  ║  Server   : http://localhost:${config.port}                 ║
  ║  Env      : ${config.nodeEnv.padEnd(41)}║
  ╠══════════════════════════════════════════════════════╣
  ║  OAuth    : GET  /oauth/install                      ║
  ║  Callback : GET  /oauth/callback                     ║
  ║  Webhooks : POST /webhooks/ghl  (RSA verified)       ║
  ║  API      : /api/v1/*  (x-api-key required)          ║
  ║  Claude   : /claude/*  (x-api-key required)          ║
  ║  Tools    : /tools/*   (x-api-key required)          ║
  ║  UI       : GET  /ui              (Dashboard)         ║
  ║           : GET  /ui/settings    (Integration Hub)   ║
  ║           : GET  /ui/workflows   (Workflow Builder)  ║
  ║           : GET  /ui/ads-generator (Bulk Ads)        ║
  ║  Health   : GET  /health                             ║
  ╚══════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
