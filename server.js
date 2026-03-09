require('dotenv').config();
const express   = require('express');
const rateLimit = require('express-rate-limit');

// ── Resilient module loader ────────────────────────────────────────────────────
// Wraps every require so one bad module can't crash the whole server.
// Check /debug to see which modules loaded OK vs failed.
const _loaded = {};
const _errors = {};

function safeRequire(label, modulePath) {
  try {
    const m = require(modulePath);
    _loaded[label] = true;
    return m;
  } catch (err) {
    _errors[label] = err.message;
    console.error(`[LOAD FAIL] ${label}: ${err.message}`);
    return null;
  }
}

const config        = safeRequire('config',      './src/config');
const authRoutes    = safeRequire('auth',         './src/routes/auth');
const apiRoutes     = safeRequire('api',          './src/routes/api');
const webhookRoutes = safeRequire('webhooks',     './src/routes/webhooks');
const claudeRoutes  = safeRequire('claude',       './src/routes/claude');
const toolsRoutes   = safeRequire('tools',        './src/routes/tools');
const adsRoutes     = safeRequire('ads',          './src/routes/adsGenerator');
const adminRoutes   = safeRequire('admin',        './src/routes/admin');
const uiRoute       = safeRequire('ui',           './src/routes/ui');

// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();

function captureRawBody(req, res, buf, encoding) {
  req.rawBody = buf.toString(encoding || 'utf8');
}

app.use(express.json({ verify: captureRawBody, limit: '10mb' }));
app.use(express.urlencoded({ extended: true, verify: captureRawBody, limit: '10mb' }));
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-api-key,x-location-id,x-admin-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok:      true,
    version: '2.0.0',
    node:    process.version,
    env:     process.env.NODE_ENV,
    ts:      new Date().toISOString(),
  });
});

// ── Debug — shows which modules loaded OK vs crashed ─────────────────────────
app.get('/debug', (req, res) => {
  res.json({
    loaded: Object.keys(_loaded),
    errors: _errors,
    nodeVersion: process.version,
    env: process.env.NODE_ENV,
  });
});

// ── Routes (only mount if they loaded) ───────────────────────────────────────
if (authRoutes)    app.use('/oauth',    authRoutes);
if (apiRoutes)     app.use('/api',      apiRoutes);
if (webhookRoutes) app.use('/webhooks', webhookRoutes);
if (claudeRoutes)  app.use('/claude',   claudeRoutes);
if (toolsRoutes)   app.use('/tools',    toolsRoutes);
if (adsRoutes)     app.use('/ads',      adsRoutes);
if (adminRoutes)   app.use('/admin',    adminRoutes);
if (uiRoute)       app.use('/',         uiRoute);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// ── Local dev listener ────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  const port = (config && config.port) || 3000;
  app.listen(port, () => console.log(`[Dev] Server running on :${port}`));
}

module.exports = app;
