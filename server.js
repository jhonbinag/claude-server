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
let adsRoutes;      try { adsRoutes      = require('./src/routes/adsGenerator');   } catch (e) { _errors.ads       = e.message; }
let adminRoutes;    try { adminRoutes    = require('./src/routes/admin');         } catch (e) { _errors.admin     = e.message; }
let workflowRoutes; try { workflowRoutes = require('./src/routes/savedWorkflows'); } catch (e) { _errors.workflows = e.message; }
let billingRoutes;  try { billingRoutes  = require('./src/routes/billing');       } catch (e) { _errors.billing  = e.message; }
let socialRoutes;   try { socialRoutes   = require('./src/routes/social');        } catch (e) { _errors.social      = e.message; }
let adLibRoutes;    try { adLibRoutes    = require('./src/routes/adLibrary');     } catch (e) { _errors.adLibrary   = e.message; }
let socialAuthRoutes; try { socialAuthRoutes = require('./src/routes/socialAuth'); } catch (e) { _errors.socialAuth = e.message; }
let manychatRoutes;   try { manychatRoutes   = require('./src/routes/manychat');   } catch (e) { _errors.manychat   = e.message; }
let promptRoutes;     try { promptRoutes     = require('./src/routes/prompts');     } catch (e) { _errors.prompts    = e.message; }
let uiRoute;        try { uiRoute        = require('./src/routes/ui');            } catch (e) { _errors.ui          = e.message; }

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
// Serve React SPA static assets (JS, CSS) before any route handlers
const path = require('path');
app.use('/ui', express.static(path.join(__dirname, 'public/ui'), { index: false, maxAge: '1y', immutable: true }));

// ── Privacy Policy (required for Facebook App Live mode) ─────────────────────
app.get('/privacy', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Privacy Policy — GTM AI Toolkit</title>
<style>body{font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#222;line-height:1.7}h1{color:#111}h2{margin-top:2rem}</style></head>
<body>
<h1>Privacy Policy</h1>
<p><strong>Effective date:</strong> ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</p>
<p>GTM AI Toolkit ("we", "our", or "us") operates the GTM AI Toolkit platform. This page informs you of our policies regarding the collection, use, and disclosure of personal data.</p>
<h2>Data We Collect</h2>
<p>When you connect a social account (Facebook, Instagram, etc.) we store an access token to perform actions on your behalf. We do not sell or share your data with third parties.</p>
<h2>How We Use Data</h2>
<p>Access tokens are used solely to perform actions you explicitly request (reading pages, posting content, searching ad library). Tokens are encrypted at rest using AES-256-GCM.</p>
<h2>Data Retention</h2>
<p>You may disconnect any integration at any time. Upon disconnection your access token is deleted from our systems.</p>
<h2>Contact</h2>
<p>For privacy questions, contact us at the email address on your GoHighLevel account.</p>
</body></html>`);
});

if (authRoutes)    app.use('/oauth',    authRoutes);
if (apiRoutes)     app.use('/api',      apiRoutes);
if (webhookRoutes) app.use('/webhooks', webhookRoutes);
if (claudeRoutes)  app.use('/claude',   claudeRoutes);
if (toolsRoutes)   app.use('/tools',    toolsRoutes);
if (adsRoutes)       app.use('/ads',       adsRoutes);
if (adminRoutes)     app.use('/admin',     adminRoutes);
if (workflowRoutes)  app.use('/workflows', workflowRoutes);
if (billingRoutes)   app.use('/billing',   billingRoutes);
if (socialRoutes)    app.use('/social',      socialRoutes);
if (adLibRoutes)       app.use('/ad-library',  adLibRoutes);
if (socialAuthRoutes)  app.use('/social-auth', socialAuthRoutes);
if (manychatRoutes)    app.use('/manychat',    manychatRoutes);
if (promptRoutes)      app.use('/prompts',     promptRoutes);
if (uiRoute)         app.use('/',           uiRoute);

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
