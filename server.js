require('dotenv').config();
const express    = require('express');
const rateLimit  = require('express-rate-limit');
const config     = require('./src/config');

const authRoutes    = require('./src/routes/auth');
const apiRoutes     = require('./src/routes/api');
const webhookRoutes = require('./src/routes/webhooks');
const claudeRoutes  = require('./src/routes/claude');
const toolsRoutes   = require('./src/routes/tools');
const adsRoutes     = require('./src/routes/adsGenerator');
const adminRoutes   = require('./src/routes/admin');
const uiRoute       = require('./src/routes/ui');

const app = express();

// ── Raw body capture (runs inside express.json verify — no double-consume) ────
function captureRawBody(req, res, buf, encoding) {
  req.rawBody = buf.toString(encoding || 'utf8');
}

app.use(express.json({ verify: captureRawBody, limit: '10mb' }));
app.use(express.urlencoded({ extended: true, verify: captureRawBody, limit: '10mb' }));

// ── Trust proxy (Vercel / reverse proxy) ──────────────────────────────────────
app.set('trust proxy', 1);

// ── Rate limiter ──────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use(limiter);

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-api-key,x-location-id,x-admin-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok:      true,
    version: '2.0.0',
    node:    process.version,
    env:     process.env.NODE_ENV,
    ts:      new Date().toISOString(),
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/oauth', authRoutes);
app.use('/api',   apiRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/claude',   claudeRoutes);
app.use('/tools',    toolsRoutes);
app.use('/ads',      adsRoutes);
app.use('/admin',    adminRoutes);
app.use('/',         uiRoute);       // catch-all for React SPA (must be last)

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(err.status || 500).json({
    error:   err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// ── Local dev listener ────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  const port = config.port || 3000;
  app.listen(port, () => console.log(`[Dev] Server running on :${port}`));
}

module.exports = app;
