/**
 * src/services/agentStore.js
 *
 * Redis-backed storage for user-created agent definitions.
 *
 * Key layout:
 *   hltools:agents:{locationId} → JSON array of agent objects (1-year TTL)
 */

const https  = require('https');
const crypto = require('crypto');

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const PREFIX = 'hltools:agents:';
const TTL    = 365 * 24 * 3600;

const _mem = new Map();

function redisReq(cmd) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    const [c, k, v, , ex] = cmd;
    if (c === 'GET') return Promise.resolve(_mem.get(k) ?? null);
    if (c === 'SET') { _mem.set(k, v); if (ex) setTimeout(() => _mem.delete(k), Number(ex) * 1000); return Promise.resolve('OK'); }
    if (c === 'DEL') { _mem.delete(k); return Promise.resolve(1); }
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(cmd);
    const url  = new URL(REDIS_URL);
    const req  = https.request(
      { hostname: url.hostname, path: url.pathname, method: 'POST',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const p = JSON.parse(d); if (p.error) reject(new Error(p.error)); else resolve(p.result); } catch (e) { reject(new Error(d)); } }); }
    );
    req.on('error', reject); req.write(body); req.end();
  });
}

const r = {
  get: (k)         => redisReq(['GET', k]),
  set: (k, v, ttl) => ttl ? redisReq(['SET', k, v, 'EX', String(ttl)]) : redisReq(['SET', k, v]),
};

async function listAgents(locationId) {
  const raw = await r.get(PREFIX + locationId);
  return raw ? JSON.parse(raw) : [];
}

async function saveAgent(locationId, agent) {
  const list = await listAgents(locationId);
  if (!agent.id) {
    agent.id        = `ag_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    agent.createdAt = Date.now();
  }
  agent.updatedAt = Date.now();
  const idx = list.findIndex(a => a.id === agent.id);
  if (idx >= 0) list[idx] = agent; else list.unshift(agent);
  await r.set(PREFIX + locationId, JSON.stringify(list), TTL);
  return agent;
}

async function deleteAgent(locationId, agentId) {
  const list    = await listAgents(locationId);
  const updated = list.filter(a => a.id !== agentId);
  await r.set(PREFIX + locationId, JSON.stringify(updated), TTL);
}

async function getAgent(locationId, agentId) {
  const list = await listAgents(locationId);
  return list.find(a => a.id === agentId) || null;
}

module.exports = { listAgents, saveAgent, deleteAgent, getAgent };
