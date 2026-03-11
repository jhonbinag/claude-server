/**
 * src/services/billingStore.js
 *
 * Billing storage — Firebase primary (when enabled), Redis fallback.
 *
 * Firebase: Collection `billing` / Document {locationId}
 * Redis:    hltools:billing:{locationId}  (2-year TTL)
 *           hltools:billing:index         (JSON array of locationIds)
 *
 * Plans: trial | starter | pro | agency
 * Statuses: trial | active | past_due | cancelled | suspended
 * Invoice statuses: pending | paid | overdue | refunded | void
 */

const https  = require('https');
const crypto = require('crypto');
const config = require('../config');

// ── Firebase (lazy) ───────────────────────────────────────────────────────────

let _db = null;
function db() {
  if (_db) return _db;
  if (!config.isFirebaseEnabled) return null;
  try {
    const admin = require('firebase-admin');
    _db = admin.firestore();
  } catch { _db = null; }
  return _db;
}
const FB_COLLECTION = 'billing';

// ── Redis fallback ─────────────────────────────────────────────────────────────

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const BL_PREFIX = 'hltools:billing:';
const IDX_KEY   = 'hltools:billing:index';
const TTL       = 730 * 24 * 3600; // 2 years

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
    const req  = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { const p = JSON.parse(d); p.error ? reject(new Error(p.error)) : resolve(p.result); }
        catch (e) { reject(new Error(d)); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

const r = {
  get: k           => redisReq(['GET', k]),
  set: (k, v, ttl) => ttl ? redisReq(['SET', k, v, 'EX', String(ttl)]) : redisReq(['SET', k, v]),
  del: k           => redisReq(['DEL', k]),
};

// ── Plans ─────────────────────────────────────────────────────────────────────

const PLANS = {
  trial:   { name: 'Free Trial', amount: 0,   interval: 'month' },
  starter: { name: 'Starter',    amount: 29,  interval: 'month' },
  pro:     { name: 'Pro',        amount: 99,  interval: 'month' },
  agency:  { name: 'Agency',     amount: 249, interval: 'month' },
};

// ── Default billing record factory ────────────────────────────────────────────

function defaultRecord(locationId) {
  const now      = Date.now();
  const trialEnd = now + 14 * 24 * 3600 * 1000;
  return {
    locationId, plan: 'trial', status: 'trial',
    amount: 0, currency: 'usd', interval: 'month',
    trialEnd, currentPeriodEnd: trialEnd,
    stripeCustomerId: null, stripeSubId: null, paymentMethod: null,
    invoices: [], notes: '', createdAt: now, updatedAt: now,
  };
}

// ── Firebase helpers ──────────────────────────────────────────────────────────

async function fbGet(locationId) {
  const d = db();
  if (!d) return null;
  const snap = await d.collection(FB_COLLECTION).doc(locationId).get();
  return snap.exists ? snap.data() : null;
}

async function fbSave(record) {
  const d = db();
  if (!d) return;
  await d.collection(FB_COLLECTION).doc(record.locationId).set(record);
}

async function fbDelete(locationId) {
  const d = db();
  if (!d) return;
  await d.collection(FB_COLLECTION).doc(locationId).delete();
}

async function fbList() {
  const d = db();
  if (!d) return null;
  const snap = await d.collection(FB_COLLECTION).orderBy('createdAt', 'desc').get();
  return snap.docs.map(doc => doc.data());
}

// ── Redis index helpers ───────────────────────────────────────────────────────

async function redisAddToIndex(locationId) {
  const raw = await r.get(IDX_KEY);
  const idx = raw ? JSON.parse(raw) : [];
  if (!idx.includes(locationId)) { idx.push(locationId); await r.set(IDX_KEY, JSON.stringify(idx), TTL); }
}

async function redisRemoveFromIndex(locationId) {
  const raw = await r.get(IDX_KEY);
  const idx = raw ? JSON.parse(raw) : [];
  await r.set(IDX_KEY, JSON.stringify(idx.filter(id => id !== locationId)), TTL);
}

// ── Core CRUD ─────────────────────────────────────────────────────────────────

async function getBilling(locationId) {
  if (db()) return fbGet(locationId);
  const raw = await r.get(BL_PREFIX + locationId);
  return raw ? JSON.parse(raw) : null;
}

async function saveBilling(record) {
  record.updatedAt = Date.now();
  if (db()) {
    await fbSave(record);
  } else {
    await r.set(BL_PREFIX + record.locationId, JSON.stringify(record), TTL);
    await redisAddToIndex(record.locationId);
  }
  return record;
}

async function getOrCreateBilling(locationId) {
  const existing = await getBilling(locationId);
  return existing || defaultRecord(locationId);
}

async function listAllBilling() {
  if (db()) {
    const records = await fbList();
    return records || [];
  }
  const raw = await r.get(IDX_KEY);
  const ids = raw ? JSON.parse(raw) : [];
  const records = await Promise.all(ids.map(id => getBilling(id)));
  return records.filter(Boolean);
}

// ── Subscription ──────────────────────────────────────────────────────────────

async function updateSubscription(locationId, {
  plan, tier, status, amount, currency, interval,
  trialEnd, currentPeriodEnd,
  stripeCustomerId, stripeSubId,
  paymentMethod, notes,
}) {
  const rec = await getOrCreateBilling(locationId);
  if (plan             !== undefined) rec.plan             = plan;
  if (tier             !== undefined) rec.tier             = tier;
  if (status           !== undefined) rec.status           = status;
  if (amount           !== undefined) rec.amount           = amount;
  if (currency         !== undefined) rec.currency         = currency;
  if (interval         !== undefined) rec.interval         = interval;
  if (trialEnd         !== undefined) rec.trialEnd         = trialEnd;
  if (currentPeriodEnd !== undefined) rec.currentPeriodEnd = currentPeriodEnd;
  if (stripeCustomerId !== undefined) rec.stripeCustomerId = stripeCustomerId;
  if (stripeSubId      !== undefined) rec.stripeSubId      = stripeSubId;
  if (paymentMethod    !== undefined) rec.paymentMethod    = paymentMethod;
  if (notes            !== undefined) rec.notes            = notes;
  return saveBilling(rec);
}

// ── Invoices ──────────────────────────────────────────────────────────────────

async function createInvoice(locationId, { amount, currency = 'usd', description, status = 'pending', date, stripeInvoiceId }) {
  const rec = await getOrCreateBilling(locationId);
  const inv = {
    id: `inv_${crypto.randomBytes(6).toString('hex')}`,
    amount: Number(amount), currency,
    description: description || `${rec.plan} plan`,
    status,
    date:           date || Date.now(),
    paidAt:         status === 'paid' ? Date.now() : null,
    refundedAt:     null,
    stripeInvoiceId: stripeInvoiceId || null,
    createdAt:      Date.now(),
  };
  rec.invoices = [inv, ...(rec.invoices || [])];
  await saveBilling(rec);
  return inv;
}

async function updateInvoice(locationId, invoiceId, updates) {
  const rec = await getBilling(locationId);
  if (!rec) throw new Error('Billing record not found.');
  const idx = rec.invoices.findIndex(i => i.id === invoiceId);
  if (idx < 0) throw new Error('Invoice not found.');
  const inv = { ...rec.invoices[idx], ...updates };
  if (updates.status === 'paid'     && !inv.paidAt)     inv.paidAt     = Date.now();
  if (updates.status === 'refunded' && !inv.refundedAt) inv.refundedAt = Date.now();
  rec.invoices[idx] = inv;
  await saveBilling(rec);
  return inv;
}

async function deleteInvoice(locationId, invoiceId) {
  const rec = await getBilling(locationId);
  if (!rec) throw new Error('Billing record not found.');
  rec.invoices = rec.invoices.filter(i => i.id !== invoiceId);
  await saveBilling(rec);
}

async function deleteBilling(locationId) {
  if (db()) { await fbDelete(locationId); return; }
  await r.del(BL_PREFIX + locationId);
  await redisRemoveFromIndex(locationId);
}

// ── Stripe ────────────────────────────────────────────────────────────────────

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try { return require('stripe')(key); } catch { return null; }
}

module.exports = {
  PLANS,
  getBilling, saveBilling, getOrCreateBilling, listAllBilling,
  updateSubscription, createInvoice, updateInvoice, deleteInvoice, deleteBilling,
  getStripe,
};
