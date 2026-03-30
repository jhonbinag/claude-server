/**
 * src/services/integrationStore.js
 *
 * Firestore-backed 3rd-party integration registry.
 * Falls back to in-memory when Firebase is disabled.
 *
 * Collection: chatIntegrations
 *
 * Each document:
 *  integrationId   — unique ID
 *  clientName      — folder / client grouping label
 *  name            — integration display name
 *  type            — 'webhook' | 'api_key' | 'our_api'
 *
 *  webhook type:
 *    webhookToken  — generated token, used in /integrations/webhook/:token
 *    lastPayload   — last received body (JSON)
 *    lastReceivedAt — timestamp
 *
 *  api_key type:
 *    apiKey        — their API key
 *    endpoint      — their endpoint URL
 *    method        — GET | POST (default GET)
 *    headers       — JSON string of extra headers
 *
 *  our_api type:
 *    ourApiKey     — generated key, shared with 3rd party
 *    lastPayload   — last data pushed by 3rd party
 *    lastReceivedAt — timestamp
 *    allowQuery    — boolean: allow GET ?q= AI queries
 *
 *  assignedTo        — '__all__' | 'specific'
 *  assignedLocations — array of locationIds
 *  status            — 'active' | 'inactive'
 *  createdAt, updatedAt
 */

const crypto = require('crypto');
const config = require('../config');

let _db = null;
function db() {
  if (_db) return _db;
  if (!config.isFirebaseEnabled) return null;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length) _db = admin.app().firestore();
  } catch { /* ignore */ }
  return _db;
}

const COL = 'chatIntegrations';
const mem = {}; // in-memory fallback

// ── Generators ────────────────────────────────────────────────────────────────

function genWebhookToken()  { return 'whk_' + crypto.randomBytes(20).toString('hex'); }
function genOurApiKey()     { return 'oapi_' + crypto.randomBytes(20).toString('hex'); }
function genId()            { return `int_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

// ── CRUD ──────────────────────────────────────────────────────────────────────

async function listIntegrations() {
  const d = db();
  if (d) {
    const snap = await d.collection(COL).orderBy('createdAt', 'desc').get();
    return snap.docs.map(doc => ({ integrationId: doc.id, ...doc.data() }));
  }
  return Object.values(mem).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function getIntegration(integrationId) {
  const d = db();
  if (d) {
    const snap = await d.collection(COL).doc(integrationId).get();
    if (!snap.exists) return null;
    return { integrationId: snap.id, ...snap.data() };
  }
  return mem[integrationId] || null;
}

async function saveIntegration(data) {
  const { integrationId, ...rest } = data;
  const id  = integrationId || genId();
  const now = Date.now();
  const save = { ...rest, updatedAt: now };
  if (!rest.createdAt) save.createdAt = now;

  // Auto-generate tokens on creation
  if (!integrationId) {
    if (rest.type === 'webhook' && !rest.webhookToken)  save.webhookToken = genWebhookToken();
    if (rest.type === 'our_api' && !rest.ourApiKey)     save.ourApiKey    = genOurApiKey();
  }

  const d = db();
  if (d) {
    await d.collection(COL).doc(id).set(save, { merge: true });
  } else {
    mem[id] = { integrationId: id, ...save };
  }
  return { integrationId: id, ...save };
}

async function deleteIntegration(integrationId) {
  const d = db();
  if (d) await d.collection(COL).doc(integrationId).delete();
  else delete mem[integrationId];
}

// ── Lookup by token / key (for inbound requests) ──────────────────────────────

async function getByWebhookToken(token) {
  const all = await listIntegrations();
  return all.find(i => i.webhookToken === token) || null;
}

async function getByOurApiKey(key) {
  const all = await listIntegrations();
  return all.find(i => i.ourApiKey === key) || null;
}

// ── Update last received payload ───────────────────────────────────────────────

async function updateLastPayload(integrationId, payload) {
  const d = db();
  const patch = { lastPayload: JSON.stringify(payload), lastReceivedAt: Date.now(), updatedAt: Date.now() };
  if (d) {
    await d.collection(COL).doc(integrationId).set(patch, { merge: true });
  } else if (mem[integrationId]) {
    Object.assign(mem[integrationId], patch);
  }
}

// ── Get active integrations for a location (used by chats) ───────────────────

async function getIntegrationsForLocation(locationId) {
  try {
    const all = await listIntegrations();
    return all.filter(i =>
      i.status === 'active' && (
        i.assignedTo === '__all__' ||
        (i.assignedTo === 'specific' && Array.isArray(i.assignedLocations) && i.assignedLocations.includes(locationId))
      )
    );
  } catch { return []; }
}

module.exports = {
  listIntegrations,
  getIntegration,
  saveIntegration,
  deleteIntegration,
  getByWebhookToken,
  getByOurApiKey,
  updateLastPayload,
  getIntegrationsForLocation,
};
