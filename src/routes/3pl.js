/**
 * src/routes/3pl.js
 *
 * 3PL Systems (BrokerWare TMS) API proxy — Admin only.
 * Stores credentials in Firestore adminConfigs/3pl, caches OAuth tokens in Redis.
 *
 * Endpoints (all require x-admin-key header):
 *   GET  /3pl/config                          — get saved config (secrets masked)
 *   POST /3pl/config                          — save credentials
 *   POST /3pl/test                            — test connection
 *   POST /3pl/rates                           — get carrier rates
 *   POST /3pl/shipments                       — create shipment
 *   PUT  /3pl/shipments                       — update shipment
 *   GET  /3pl/shipments                       — get loads (global)
 *   POST /3pl/shipments/with-rate             — create shipment with rateQuoteId
 *   GET  /3pl/documents                       — list shipment documents
 *   POST /3pl/documents/send                  — send documents by email
 *   GET  /3pl/carriers                        — get carrier list (global)
 */

const express   = require('express');
const router    = express.Router();
const adminAuth = require('../middleware/adminAuth');
const config    = require('../config');

// Optional deps — graceful fallback when not configured
let admin = null;
let _db   = null;
let redis = null;

try {
  if (config.isFirebaseEnabled) {
    admin = require('firebase-admin');
    _db   = admin.firestore();
  }
} catch (_) {}

try {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url: config.upstash?.url, token: config.upstash?.token });
} catch (_) {}

const CACHE_KEY      = '3pl:config';
const TOKEN_KEY_C    = '3pl:token:client';
const TOKEN_KEY_G    = '3pl:token:global';
const TOKEN_TTL      = 3500; // seconds — slightly under 1h OAuth expiry

router.use(adminAuth);

/* ── Helpers ────────────────────────────────────────────────────────────── */

async function loadConfig() {
  // Redis cache first
  if (redis) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) return typeof cached === 'string' ? JSON.parse(cached) : cached;
    } catch (_) {}
  }
  // Firebase
  if (_db) {
    try {
      const doc = await _db.collection('adminConfigs').doc('3pl').get();
      if (doc.exists) {
        const data = doc.data();
        if (redis) {
          await redis.set(CACHE_KEY, JSON.stringify(data), { ex: 3600 }).catch(() => {});
        }
        return data;
      }
    } catch (_) {}
  }
  return null;
}

async function saveConfig(data) {
  if (_db) {
    await _db.collection('adminConfigs').doc('3pl').set({
      ...data,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  if (redis) {
    await redis.del(CACHE_KEY).catch(() => {});
    await redis.del(TOKEN_KEY_C).catch(() => {});
    await redis.del(TOKEN_KEY_G).catch(() => {});
  }
}

async function getToken(cfg, type = 'client') {
  const cacheKey = type === 'global' ? TOKEN_KEY_G : TOKEN_KEY_C;
  const clientId     = type === 'global' ? cfg.globalClientId     : cfg.clientId;
  const clientSecret = type === 'global' ? cfg.globalClientSecret : cfg.clientSecret;

  if (!clientId || !clientSecret) throw new Error(`Missing ${type} credentials`);
  if (!cfg.baseUrl) throw new Error('Base URL not configured');

  // Redis cache
  if (redis) {
    try {
      const t = await redis.get(cacheKey);
      if (t) return typeof t === 'string' ? t : String(t);
    } catch (_) {}
  }

  // Fetch fresh token
  const url  = cfg.baseUrl.replace(/\/$/, '') + '/Authentication';
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => resp.statusText);
    throw new Error(`3PL auth failed (${resp.status}): ${txt}`);
  }

  const data = await resp.json();
  const token = data.access_token || data.token;
  if (!token) throw new Error('No access_token in auth response');

  if (redis) {
    await redis.set(cacheKey, token, { ex: TOKEN_TTL }).catch(() => {});
  }

  return token;
}

async function proxy3pl(cfg, method, path, body = null, type = 'client', query = '') {
  const token = await getToken(cfg, type);
  const base  = cfg.baseUrl.replace(/\/$/, '');
  const url   = `${base}${path}${query ? '?' + query : ''}`;

  const opts = {
    method:  method.toUpperCase(),
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(url, opts);
  const text = await resp.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { parsed = text; }

  if (!resp.ok) throw Object.assign(new Error(`3PL API error ${resp.status}`), { status: resp.status, body: parsed });
  return parsed;
}

/* ── Config endpoints ────────────────────────────────────────────────────── */

router.get('/config', async (req, res) => {
  try {
    const cfg = await loadConfig();
    if (!cfg) return res.json({ configured: false });
    res.json({
      configured:      true,
      baseUrl:         cfg.baseUrl         || '',
      clientId:        cfg.clientId        || '',
      clientSecret:    cfg.clientSecret    ? '••••••••' : '',
      globalClientId:  cfg.globalClientId  || '',
      globalClientSecret: cfg.globalClientSecret ? '••••••••' : '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/config', async (req, res) => {
  try {
    const { baseUrl, clientId, clientSecret, globalClientId, globalClientSecret } = req.body;
    if (!baseUrl) return res.status(400).json({ error: 'baseUrl is required' });

    const existing = await loadConfig() || {};
    const toSave = {
      baseUrl:            baseUrl.trim(),
      clientId:           clientId            || existing.clientId            || '',
      clientSecret:       clientSecret        || existing.clientSecret        || '',
      globalClientId:     globalClientId      || existing.globalClientId      || '',
      globalClientSecret: globalClientSecret  || existing.globalClientSecret  || '',
    };

    await saveConfig(toSave);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/test', async (req, res) => {
  try {
    const cfg = await loadConfig();
    if (!cfg) return res.status(400).json({ error: 'Not configured' });

    const results = {};

    // Test client credentials
    if (cfg.clientId && cfg.clientSecret) {
      try {
        await getToken({ ...cfg }, 'client');
        results.client = 'ok';
      } catch (e) {
        results.client = e.message;
      }
    } else {
      results.client = 'not configured';
    }

    // Test global credentials
    if (cfg.globalClientId && cfg.globalClientSecret) {
      try {
        await getToken({ ...cfg }, 'global');
        results.global = 'ok';
      } catch (e) {
        results.global = e.message;
      }
    } else {
      results.global = 'not configured';
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Rating ──────────────────────────────────────────────────────────────── */

router.post('/rates', async (req, res) => {
  try {
    const cfg = await loadConfig();
    if (!cfg) return res.status(400).json({ error: 'Not configured' });
    const data = await proxy3pl(cfg, 'POST', '/api/v1/rating', req.body, 'client');
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, detail: err.body });
  }
});

/* ── Shipments ───────────────────────────────────────────────────────────── */

router.post('/shipments', async (req, res) => {
  try {
    const cfg = await loadConfig();
    if (!cfg) return res.status(400).json({ error: 'Not configured' });
    const data = await proxy3pl(cfg, 'POST', '/api/v1/createshipment', req.body, 'client');
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, detail: err.body });
  }
});

router.put('/shipments', async (req, res) => {
  try {
    const cfg = await loadConfig();
    if (!cfg) return res.status(400).json({ error: 'Not configured' });
    const data = await proxy3pl(cfg, 'POST', '/api/v1/UpdateShipment', req.body, 'client');
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, detail: err.body });
  }
});

// Create shipment with rate quote ID (query param)
router.post('/shipments/with-rate', async (req, res) => {
  try {
    const cfg = await loadConfig();
    if (!cfg) return res.status(400).json({ error: 'Not configured' });
    const { rateQuoteId, ...body } = req.body;
    if (!rateQuoteId) return res.status(400).json({ error: 'rateQuoteId is required' });
    const data = await proxy3pl(cfg, 'POST', '/api/v1/CreateShipmentWithRateQuoteId', body, 'client', `rateQuoteId=${encodeURIComponent(rateQuoteId)}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, detail: err.body });
  }
});

/* ── Loads (Global) ──────────────────────────────────────────────────────── */

router.get('/shipments', async (req, res) => {
  try {
    const cfg = await loadConfig();
    if (!cfg) return res.status(400).json({ error: 'Not configured' });
    const { status = 'Booked', startDate, endDate } = req.query;
    const params = new URLSearchParams({ status });
    if (startDate) params.append('startDate', startDate);
    if (endDate)   params.append('endDate',   endDate);
    const data = await proxy3pl(cfg, 'GET', '/api/clientv1/GetLoads', null, 'global', params.toString());
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, detail: err.body });
  }
});

// Update shipment (Global)
router.put('/shipments/global', async (req, res) => {
  try {
    const cfg = await loadConfig();
    if (!cfg) return res.status(400).json({ error: 'Not configured' });
    const data = await proxy3pl(cfg, 'POST', '/api/clientv1/UpdateShipment', req.body, 'global');
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, detail: err.body });
  }
});

/* ── Documents ───────────────────────────────────────────────────────────── */

router.get('/documents', async (req, res) => {
  try {
    const cfg = await loadConfig();
    if (!cfg) return res.status(400).json({ error: 'Not configured' });
    const { loadId } = req.query;
    if (!loadId) return res.status(400).json({ error: 'loadId is required' });
    const data = await proxy3pl(cfg, 'GET', '/api/v1/ListShipmentDocuments', null, 'client', `loadId=${loadId}`);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, detail: err.body });
  }
});

router.post('/documents/send', async (req, res) => {
  try {
    const cfg = await loadConfig();
    if (!cfg) return res.status(400).json({ error: 'Not configured' });
    const { loadId, emails, documentNames } = req.body;
    if (!loadId) return res.status(400).json({ error: 'loadId is required' });
    const data = await proxy3pl(cfg, 'POST', '/api/v1/SendShipmentDocuments', { loadId, emails, documentNames }, 'client');
    res.json(data || { ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, detail: err.body });
  }
});

/* ── Carriers (Global) ───────────────────────────────────────────────────── */

router.get('/carriers', async (req, res) => {
  try {
    const cfg = await loadConfig();
    if (!cfg) return res.status(400).json({ error: 'Not configured' });
    const { startDate, endDate } = req.query;
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate)   params.append('endDate',   endDate);
    const data = await proxy3pl(cfg, 'GET', '/api/clientv1/carrier', null, 'global', params.toString());
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, detail: err.body });
  }
});

module.exports = router;
