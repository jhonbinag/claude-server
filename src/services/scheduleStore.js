/**
 * src/services/scheduleStore.js
 *
 * Redis-backed workflow schedule storage.
 *
 * Key layout:
 *   hltools:sched:{scheduleId}    → JSON schedule object (1-year TTL)
 *   hltools:schedidx:{locationId} → JSON array of scheduleIds per location
 *   hltools:schedall              → JSON array of ALL active scheduleIds (for cron scan)
 *
 * Schedule types: 'once' | 'daily' | 'weekly' | 'monthly'
 */

const https  = require('https');
const crypto = require('crypto');

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const SCHED_PREFIX = 'hltools:sched:';
const IDX_PREFIX   = 'hltools:schedidx:';
const ALL_KEY      = 'hltools:schedall';
const TTL          = 365 * 24 * 3600; // 1 year

// ── Minimal Redis client (same pattern as workflowStore) ──────────────────────

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
  get: (k)         => redisReq(['GET', k]),
  set: (k, v, ttl) => ttl ? redisReq(['SET', k, v, 'EX', String(ttl)]) : redisReq(['SET', k, v]),
  del: (k)         => redisReq(['DEL', k]),
};

// ── Next-run calculation ──────────────────────────────────────────────────────

function calcNextRun(sched) {
  const now = Date.now();

  if (sched.type === 'once') {
    return sched.scheduledAt || null;
  }

  const [h, m] = (sched.time || '09:00').split(':').map(Number);

  // Start from today at the given time
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h, m, 0, 0);

  // Advance past "now"
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);

  if (sched.type === 'daily') {
    return d.getTime();
  }

  if (sched.type === 'weekly') {
    const dow = sched.dayOfWeek ?? 1; // default Monday
    while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  if (sched.type === 'monthly') {
    const dom = sched.dayOfMonth ?? 1;
    d.setDate(dom);
    if (d.getTime() <= now) {
      d.setMonth(d.getMonth() + 1);
      d.setDate(dom);
    }
    return d.getTime();
  }

  return null;
}

// ── Schedule CRUD ─────────────────────────────────────────────────────────────

async function listSchedules(locationId) {
  const raw = await r.get(IDX_PREFIX + locationId);
  if (!raw) return [];
  const ids = JSON.parse(raw);
  const items = await Promise.all(ids.map(async (id) => {
    const s = await r.get(SCHED_PREFIX + id);
    return s ? JSON.parse(s) : null;
  }));
  return items.filter(Boolean);
}

async function createSchedule(locationId, { workflowId, workflowName, webhookToken, type, scheduledAt, time, dayOfWeek, dayOfMonth }) {
  const id    = `sch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const sched = {
    id, locationId, workflowId, workflowName, webhookToken,
    type,        // 'once' | 'daily' | 'weekly' | 'monthly'
    scheduledAt, // ms timestamp for 'once'
    time,        // 'HH:MM' for recurring
    dayOfWeek,   // 0–6 for 'weekly'
    dayOfMonth,  // 1–31 for 'monthly'
    status:    'active',
    createdAt: Date.now(),
    lastRun:   null,
    nextRun:   null,
  };
  sched.nextRun = calcNextRun(sched);

  await r.set(SCHED_PREFIX + id, JSON.stringify(sched), TTL);

  // Update per-location index
  const idxRaw = await r.get(IDX_PREFIX + locationId);
  const ids    = idxRaw ? JSON.parse(idxRaw) : [];
  ids.push(id);
  await r.set(IDX_PREFIX + locationId, JSON.stringify(ids), TTL);

  // Update global index (scanned by cron)
  const allRaw = await r.get(ALL_KEY);
  const all    = allRaw ? JSON.parse(allRaw) : [];
  all.push(id);
  await r.set(ALL_KEY, JSON.stringify(all), TTL);

  return sched;
}

async function deleteSchedule(scheduleId, locationId) {
  await r.del(SCHED_PREFIX + scheduleId);

  const idxRaw = await r.get(IDX_PREFIX + locationId);
  if (idxRaw) {
    const ids = JSON.parse(idxRaw).filter((id) => id !== scheduleId);
    await r.set(IDX_PREFIX + locationId, JSON.stringify(ids), TTL);
  }

  const allRaw = await r.get(ALL_KEY);
  if (allRaw) {
    const all = JSON.parse(allRaw).filter((id) => id !== scheduleId);
    await r.set(ALL_KEY, JSON.stringify(all), TTL);
  }
}

// ── Cron helpers ──────────────────────────────────────────────────────────────

async function getDueSchedules() {
  const now    = Date.now();
  const allRaw = await r.get(ALL_KEY);
  if (!allRaw) return [];

  const ids   = JSON.parse(allRaw);
  const items = await Promise.all(ids.map(async (id) => {
    const s = await r.get(SCHED_PREFIX + id);
    return s ? JSON.parse(s) : null;
  }));

  return items.filter((s) => s && s.status === 'active' && s.nextRun && s.nextRun <= now);
}

async function markRan(scheduleId) {
  const raw = await r.get(SCHED_PREFIX + scheduleId);
  if (!raw) return null;
  const sched = JSON.parse(raw);

  sched.lastRun = Date.now();

  if (sched.type === 'once') {
    sched.status  = 'completed';
    sched.nextRun = null;
    // Remove from global active index
    const allRaw = await r.get(ALL_KEY);
    if (allRaw) {
      const all = JSON.parse(allRaw).filter((id) => id !== scheduleId);
      await r.set(ALL_KEY, JSON.stringify(all), TTL);
    }
  } else {
    sched.nextRun = calcNextRun(sched);
  }

  await r.set(SCHED_PREFIX + scheduleId, JSON.stringify(sched), TTL);
  return sched;
}

module.exports = { listSchedules, createSchedule, deleteSchedule, getDueSchedules, markRan };
