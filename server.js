require('dotenv').config();
const express   = require('express');
const rateLimit = require('express-rate-limit');

// ── Resilient module loader ────────────────────────────────────────────────────
// Inline try-catch keeps static require() strings visible to Vercel's bundler
// so it can trace the full dependency tree (axios, multer, etc.)
const _errors = {};

let config;        try { config        = require('./src/config');            } catch (e) { _errors.config   = e.message; }
let authRoutes;    try { authRoutes    = require('./src/routes/auth');        } catch (e) { _errors.auth     = e.message; }
let apiRoutes;     try { apiRoutes     = require('./src/routes/api');         } catch (e) { _errors.api      = e.message; }
let webhookRoutes; try { webhookRoutes = require('./src/routes/webhooks');    } catch (e) { _errors.webhooks = e.message; }
let claudeRoutes;  try { claudeRoutes  = require('./src/routes/claude');      } catch (e) { _errors.claude   = e.message; }
let toolsRoutes;   try { toolsRoutes   = require('./src/routes/tools');       } catch (e) { _errors.tools    = e.message; }
let adsRoutes;     try { adsRoutes     = require('./src/routes/adsGenerator');} catch (e) { _errors.ads      = e.message; }
let adminRoutes;   try { adminRoutes   = require('./src/routes/admin');       } catch (e) { _errors.admin    = e.message; }
let uiRoute;       try { uiRoute       = require('./src/routes/ui');          } catch (e) { _errors.ui       = e.message; }

// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();

function captureRawBody(req, res, buf, encoding) {
  req.rawBody = buf.toString(encoding || 'utf8');
}

app.use(express.json({ verify: captureRawBody, limit: '10mb' }));
app.use(express.urlencoded({ extended: true, verify: captureRawBody, limit: '10mb' }));
app.set('trust proxy', 1);

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-api-key,x-location-id,x-admin-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Health / debug ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, version: '2.0.0', node: process.version, env: process.env.NODE_ENV });
});

app.get('/debug', (req, res) => {
  res.json({ errors: _errors, node: process.version, env: process.env.NODE_ENV });
});

// ── Routes ────────────────────────────────────────────────────────────────────
if (authRoutes)    app.use('/oauth',    authRoutes);
if (apiRoutes)     app.use('/api',      apiRoutes);
if (webhookRoutes) app.use('/webhooks', webhookRoutes);
if (claudeRoutes)  app.use('/claude',   claudeRoutes);
if (toolsRoutes)   app.use('/tools',    toolsRoutes);
if (adsRoutes)     app.use('/ads',      adsRoutes);
if (adminRoutes)   app.use('/admin',    adminRoutes);
if (uiRoute)       app.use('/',         uiRoute);

// ── 404 / error ───────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

app.use((err, req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Local dev ─────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  const port = (config && config.port) || 3000;
  app.listen(port, () => console.log(`[Dev] Server on :${port}`));
}

module.exports = app;
