/**
 * server.js — HL Pro Tools GHL Marketplace Backend
 *
 * Entry point. Wires together:
 *  - Express app with raw body capture for webhook signature verification
 *  - OAuth routes        → /oauth/*
 *  - Webhook receiver    → /webhooks/ghl  (RSA-verified GHL events)
 *  - Protected API       → /api/v1/*      (requires x-api-key header)
 *
 * Vercel note: app.listen() is only called in local dev (non-Vercel).
 * Vercel wraps the exported Express app as a serverless function.
 */

require('dotenv').config();

process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});

// ─── Module Initialization (wrapped to surface cold-start crashes) ─────────────

let express = require('express');
let app;
let _initError = null;

try {
  const rateLimit = require('express-rate-limit');

  let config, authRoutes, apiRoutes, webhookRoutes, claudeRoutes,
      toolsRoutes, adsRoutes, adminRoutes, uiRoute;

  try { config       = require('./src/config'); }          catch (e) { throw new Error(`config: ${e.message}`); }
  try { authRoutes    = require('./src/routes/auth'); }     catch (e) { throw new Error(`routes/auth: ${e.message}`); }
  try { apiRoutes     = require('./src/routes/api'); }      catch (e) { throw new Error(`routes/api: ${e.message}`); }
  try { webhookRoutes = require('./src/routes/webhooks'); } catch (e) { throw new Error(`routes/webhooks: ${e.message}`); }
  try { claudeRoutes  = require('./src/routes/claude'); }   catch (e) { throw new Error(`routes/claude: ${e.message}`); }
  try { toolsRoutes   = require('./src/routes/tools'); }    catch (e) { throw new Error(`routes/tools: ${e.message}`); }
  try { adsRoutes     = require('./src/routes/adsGenerator'); } catch (e) { throw new Error(`routes/adsGenerator: ${e.message}`); }
  try { adminRoutes   = require('./src/routes/admin'); }    catch (e) { throw new Error(`routes/admin: ${e.message}`); }
  try { uiRoute       = require('./src/routes/ui'); }       catch (e) { throw new Error(`routes/ui: ${e.message}`); }

  app = express();

  // ─── Body Parsing + Raw Body Capture ───────────────────────────────────────
  function captureRawBody(req, res, buf, encoding) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }

  app.use(express.json({ verify: captureRawBody, limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, verify: captureRawBody, limit: '10mb' }));

  // ─── Rate Limiting ──────────────────────────────────────────────────────────
  const limiter = rateLimit({
    windowMs:        10 * 1000,
    max:             100,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { success: false, error: 'Too many requests. Slow down.' },
  });

  app.use('/api', limiter);

  // ─── Routes ─────────────────────────────────────────────────────────────────
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
    res.json({
      success: true,
      service: 'hltools-ghl-marketplace',
      status:  'running',
      baseUrl: 'https://claudeserver.vercel.app',
    });
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

  // ─── Local Dev Only ─────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const tokenStore = require('./src/services/tokenStore');
    const ghlClient  = require('./src/services/ghlClient');
    const cron       = require('node-cron');

    cron.schedule('0 */20 * * *', async () => {
      const locations = await tokenStore.listLocations();
      for (const locationId of locations) {
        try { await ghlClient.refreshAccessToken(locationId); }
        catch (err) { console.error(`[Cron] Failed ${locationId}: ${err.message}`); }
      }
    });

    app.listen(config.port, () => {
      console.log(`[Server] Listening on http://localhost:${config.port}`);
    });
  }

} catch (err) {
  // Cold-start module load failure — return the error in every response
  _initError = err;
  console.error('[STARTUP CRASH]', err.message, '\n', err.stack);

  app = express();
  app.use((req, res) => {
    res.status(500).json({
      success: false,
      error:   'Server initialization failed',
      detail:  _initError.message,
    });
  });
}

// ─── Export for Vercel Serverless ─────────────────────────────────────────────
module.exports = app;
