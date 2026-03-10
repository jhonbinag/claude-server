/**
 * src/services/workflowStore.js
 *
 * Redis-backed workflow storage.
 *
 * Key layout:
 *   hltools:wf:{locationId}         → JSON array of saved workflows (1-year TTL)
 *   hltools:wfhook:{webhookToken}   → JSON { locationId, workflowId } (1-year TTL)
 */

const https  = require('https');
const crypto = require('crypto');

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const WF_PREFIX  = 'hltools:wf:';
const WH_PREFIX  = 'hltools:wfhook:';
const TTL        = 365 * 24 * 3600;   // 1 year
const MAX_WF     = 50;

// ── Minimal Redis client (same pattern as toolTokenService) ───────────────────

const _mem = new Map();

function redisReq(cmd) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    const [c, k, v, , ex] = cmd;
    if (c === 'GET') return Promise.resolve(_mem.get(k) ?? null);
    if (c === 'SET') {
      _mem.set(k, v);
      if (ex) setTimeout(() => _mem.delete(k), Number(ex) * 1000);
      return Promise.resolve('OK');
    }
    if (c === 'DEL') { _mem.delete(k); return Promise.resolve(1); }
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(cmd);
    const url  = new URL(REDIS_URL);
    const req  = https.request(
      {
        hostname: url.hostname,
        path:     url.pathname,
        method:   'POST',
        headers:  {
          Authorization:    `Bearer ${REDIS_TOKEN}`,
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const p = JSON.parse(d);
            if (p.error) reject(new Error(p.error));
            else resolve(p.result);
          } catch (e) { reject(new Error(d)); }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const r = {
  get: (k)           => redisReq(['GET', k]),
  set: (k, v, ttl)   => ttl ? redisReq(['SET', k, v, 'EX', String(ttl)]) : redisReq(['SET', k, v]),
  del: (k)           => redisReq(['DEL', k]),
};

// ── Workflow CRUD ─────────────────────────────────────────────────────────────

async function listWorkflows(locationId) {
  const raw = await r.get(WF_PREFIX + locationId);
  return raw ? JSON.parse(raw) : [];
}

async function saveWorkflow(locationId, wf) {
  const list = await listWorkflows(locationId);

  if (!wf.id) {
    // New workflow — assign ID + webhook token
    wf.id           = `wf_${Date.now()}`;
    wf.webhookToken  = crypto.randomBytes(16).toString('hex');
    await r.set(WH_PREFIX + wf.webhookToken, JSON.stringify({ locationId, workflowId: wf.id }), TTL);
  } else {
    // Existing — preserve webhook token and refresh its TTL
    const existing = list.find((w) => w.id === wf.id);
    if (existing?.webhookToken) {
      wf.webhookToken = existing.webhookToken;
      await r.set(WH_PREFIX + wf.webhookToken, JSON.stringify({ locationId, workflowId: wf.id }), TTL);
    }
  }

  wf.updatedAt = Date.now();

  const idx = list.findIndex((w) => w.id === wf.id);
  if (idx >= 0) list[idx] = wf;
  else          list.unshift(wf);

  await r.set(WF_PREFIX + locationId, JSON.stringify(list.slice(0, MAX_WF)), TTL);
  return wf;
}

async function deleteWorkflow(locationId, workflowId) {
  const list = await listWorkflows(locationId);
  const wf   = list.find((w) => w.id === workflowId);
  if (wf?.webhookToken) await r.del(WH_PREFIX + wf.webhookToken);
  const updated = list.filter((w) => w.id !== workflowId);
  await r.set(WF_PREFIX + locationId, JSON.stringify(updated), TTL);
}

async function getByWebhookToken(token) {
  const raw = await r.get(WH_PREFIX + token);
  if (!raw) return null;
  const { locationId, workflowId } = JSON.parse(raw);
  const list = await listWorkflows(locationId);
  const wf   = list.find((w) => w.id === workflowId);
  return wf ? { locationId, workflow: wf } : null;
}

module.exports = { listWorkflows, saveWorkflow, deleteWorkflow, getByWebhookToken };
