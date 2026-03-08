/**
 * server.js — HL Pro Tools GHL Marketplace Backend
 * Minimal diagnostic version — adding routes back incrementally
 */

require('dotenv').config();

const express = require('express');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/health', (req, res) => {
  res.json({ success: true, status: 'running', node: process.version });
});

// Test each route group — uncomment one at a time to find which crashes
let loadErrors = {};

function tryLoad(name, path) {
  try {
    return require(path);
  } catch (e) {
    loadErrors[name] = e.message;
    console.error(`[LOAD ERROR] ${name}: ${e.message}`);
    return null;
  }
}

const config       = tryLoad('config',        './src/config');
const authRoutes    = tryLoad('auth',           './src/routes/auth');
const webhookRoutes = tryLoad('webhooks',       './src/routes/webhooks');
const claudeRoutes  = tryLoad('claude',         './src/routes/claude');
const toolsRoutes   = tryLoad('tools',          './src/routes/tools');
const adsRoutes     = tryLoad('adsGenerator',   './src/routes/adsGenerator');
const adminRoutes   = tryLoad('admin',          './src/routes/admin');
const uiRoute       = tryLoad('ui',             './src/routes/ui');
const apiRoutes     = tryLoad('api',            './src/routes/api');

// Diagnostic endpoint — shows which modules loaded or failed
app.get('/diag', (req, res) => {
  res.json({
    success: true,
    node:    process.version,
    loaded: {
      config:       !!config,
      auth:         !!authRoutes,
      webhooks:     !!webhookRoutes,
      claude:       !!claudeRoutes,
      tools:        !!toolsRoutes,
      adsGenerator: !!adsRoutes,
      admin:        !!adminRoutes,
      ui:           !!uiRoute,
      api:          !!apiRoutes,
    },
    errors: loadErrors,
  });
});

if (authRoutes)    app.use('/oauth',    authRoutes);
if (webhookRoutes) app.use('/webhooks', webhookRoutes);
if (apiRoutes)     app.use('/api/v1',   apiRoutes);
if (claudeRoutes)  app.use('/claude',   claudeRoutes);
if (toolsRoutes)   app.use('/tools',    toolsRoutes);
if (adsRoutes)     app.use('/ads',      adsRoutes);
if (adminRoutes)   app.use('/admin',    adminRoutes);
if (uiRoute)       app.use('/ui',       uiRoute);

app.use(express.static('public'));

app.use((req, res) => res.status(404).json({ success: false, error: 'Route not found.' }));
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ success: false, error: err.message });
});

if (process.env.NODE_ENV !== 'production') {
  const port = (config && config.port) || 3000;
  app.listen(port, () => console.log(`Listening on http://localhost:${port}`));
}

module.exports = app;
