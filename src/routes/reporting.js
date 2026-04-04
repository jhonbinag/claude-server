/**
 * src/routes/reporting.js  — mounted at /rpt
 *
 * GET /rpt/dashboard       — summary stats (totals + weekly/monthly leads)
 * GET /rpt/contacts        — contacts list with date/query filter + pagination
 * GET /rpt/opportunities   — opportunities with date/status filter + pagination
 * GET /rpt/conversations   — conversations with date filter + pagination
 * GET /rpt/invoices        — invoices/subscriptions/orders/transactions by type
 *
 * All require x-location-id header (via authenticate middleware).
 */

const express       = require('express');
const router        = express.Router();
const authenticate  = require('../middleware/authenticate');

console.log('[Reporting] routes loaded');

router.use((req, res, next) => {
  console.log(`[Reporting] ${req.method} ${req.path} | loc=${req.headers['x-location-id']}`);
  next();
});

router.use(authenticate);

// Guard helper — returns 402 if GHL isn't connected for this location
function requireGhl(req, res) {
  if (!req.ghl) {
    res.status(402).json({ success: false, error: 'GHL not connected for this location. Check your OAuth token.' });
    return false;
  }
  return true;
}

// ── GET /rpt/dashboard ────────────────────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  if (!requireGhl(req, res)) return;
  try {
    const locId   = req.locationId;
    const now      = Date.now();
    const weekMs   = 7  * 24 * 60 * 60 * 1000;
    const monthMs  = 30 * 24 * 60 * 60 * 1000;

    const ok = r => r.status === 'fulfilled';

    // Fetch totals
    const [contacts, opps, convs] = await Promise.allSettled([
      req.ghl('GET', '/contacts/',            null, { locationId: locId, limit: 1 }),
      req.ghl('GET', '/opportunities/search', null, { location_id: locId, limit: 1 }),
      req.ghl('GET', '/conversations/search', null, { locationId: locId, limit: 1 }),
    ]);

    // Fetch recent contacts, filter by dateAdded server-side
    const cutoff3d   = now - 3 * 24 * 60 * 60 * 1000;
    const cutoff7d  = now - weekMs;
    const cutoff30d = now - monthMs;
    let allContacts = [], cur = null;

    for (let p = 0; p < 10; p++) {
      try {
        const params = { locationId: locId, limit: 100 };
        if (cur) params.startAfter = cur;
        const d = await req.ghl('GET', '/contacts/', null, params);
        const batch = d?.contacts || [];
        allContacts = allContacts.concat(batch);
        if (batch.length < 100) break;
        const lastDate = batch[batch.length - 1]?.dateAdded;
        cur = lastDate ? new Date(lastDate).getTime() : null;
        if (!cur) break;
      } catch (_) { break; }
    }

    let recent3d = 0, weekly = 0, monthly = 0;
    allContacts.forEach(c => {
      const raw = c.dateAdded || null;
      if (!raw) return;
      const ms = new Date(raw).getTime();
      if (isNaN(ms)) return;
      if (ms >= cutoff3d)  recent3d++;
      if (ms >= cutoff7d)  weekly++;
      if (ms >= cutoff30d) monthly++;
    });

    console.log(`[Reporting] dashboard: scanned=${allContacts.length} recent3d=${recent3d} weekly=${weekly} monthly=${monthly}`);

    res.json({
      success: true,
      data: {
        contacts: {
          total:    ok(contacts) ? (contacts.value?.meta?.total ?? contacts.value?.count ?? 0) : 0,
          recent3d,
          weekly,
          monthly,
        },
        opportunities: {
          total: ok(opps) ? (opps.value?.meta?.total ?? 0) : 0,
        },
        conversations: {
          total: ok(convs) ? (convs.value?.meta?.total ?? convs.value?.count ?? 0) : 0,
        },
      },
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /rpt/debug-contact — inspect raw GHL contact fields ──────────────────

router.get('/debug-contact', async (req, res) => {
  if (!requireGhl(req, res)) return;
  try {
    const data = await req.ghl('GET', '/contacts/', null, { locationId: req.locationId, limit: 3 });
    const contacts = data?.contacts || [];
    const sample = contacts.slice(0, 3).map(c => ({
      id: c.id,
      allKeys: Object.keys(c),
      dateAdded:   c.dateAdded,
      dateCreated: c.dateCreated,
      createdAt:   c.createdAt,
      date_added:  c.date_added,
    }));
    console.log('[Reporting DEBUG] total fetched:', contacts.length);
    sample.forEach((s, i) => console.log(`[Reporting DEBUG] contact[${i}]:`, JSON.stringify(s)));
    res.json({ success: true, total: contacts.length, sample });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /rpt/contacts ─────────────────────────────────────────────────────────
// When startDate/endDate are present we fetch up to 500 records from GHL
// and filter server-side by dateAdded — GHL's startAfter is a pagination cursor,
// not a reliable date filter, so we handle the date logic ourselves.

router.get('/contacts', async (req, res) => {
  if (!requireGhl(req, res)) return;
  const { limit = 20, page = 1, startDate, endDate, query } = req.query;
  const pageNum  = Math.max(1, Number(page));
  const pageSize = Math.max(1, Number(limit));

  try {
    const hasDateFilter = !!(startDate || endDate);

    let contacts = [];

    // Fetch from GHL with no date params (they cause 422 errors).
    // Filter by dateAdded server-side after fetching.
    const startMs = startDate ? new Date(startDate).getTime() : null;
    const endMs   = endDate   ? new Date(endDate).getTime() + 86399999 : null;
    const fetchPages = hasDateFilter ? 10 : 1;
    const fetchLimit = hasDateFilter ? 100 : Math.min(pageSize, 100);
    let cursor = null;

    for (let p = 0; p < fetchPages; p++) {
      const params = { locationId: req.locationId, limit: fetchLimit };
      if (query)  params.query      = query;
      if (cursor) params.startAfter = cursor;

      const data  = await req.ghl('GET', '/contacts/', null, params);
      const batch = data?.contacts || [];
      contacts = contacts.concat(batch);
      if (batch.length < fetchLimit) break;
      const lastDate = batch[batch.length - 1]?.dateAdded;
      cursor = lastDate ? new Date(lastDate).getTime() : null;
      if (!cursor) break;
    }

    if (hasDateFilter) {
      contacts = contacts.filter(c => {
        const raw = c.dateAdded || null;
        if (!raw) return false;
        const ms = new Date(raw).getTime();
        if (isNaN(ms)) return false;
        if (startMs && ms < startMs) return false;
        if (endMs   && ms > endMs)   return false;
        return true;
      });
    }

    const total     = contacts.length;
    const offset    = (pageNum - 1) * pageSize;
    const paginated = hasDateFilter ? contacts.slice(offset, offset + pageSize) : contacts;

    res.json({ success: true, data: paginated, meta: { total } });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /rpt/opportunities ────────────────────────────────────────────────────

router.get('/opportunities', async (req, res) => {
  if (!requireGhl(req, res)) return;
  const { limit = 20, page = 1, status, startDate, endDate, q } = req.query;
  try {
    const params = { location_id: req.locationId, limit: Number(limit), page: Number(page) };
    if (status)    params.status    = status;
    if (startDate) params.startDate = startDate;
    if (endDate)   params.endDate   = endDate;
    if (q)         params.q         = q;

    const data = await req.ghl('GET', '/opportunities/search', null, params);
    res.json({
      success: true,
      data: data?.opportunities || [],
      meta: { total: data?.meta?.total ?? 0 },
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /rpt/conversations ────────────────────────────────────────────────────

router.get('/conversations', async (req, res) => {
  if (!requireGhl(req, res)) return;
  const { limit = 20, page = 1, startDate } = req.query;
  try {
    const params = { locationId: req.locationId, limit: Number(limit) };
    if (startDate) params.startAfter = new Date(startDate).getTime();

    const data = await req.ghl('GET', '/conversations/search', null, params);
    res.json({
      success: true,
      data: data?.conversations || [],
      meta: { total: data?.meta?.total ?? data?.conversations?.length ?? 0 },
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /rpt/debug-billing — inspect raw GHL fields for each billing type ─────

router.get('/debug-billing', async (req, res) => {
  if (!requireGhl(req, res)) return;
  const { type = 'subscription' } = req.query;
  const endpointMap = {
    subscription: ['/payments/subscriptions', { altId: req.locationId, altType: 'location', limit: 3 }],
    transaction:  ['/payments/transactions',  { altId: req.locationId, altType: 'location', limit: 3 }],
    order:        ['/payments/orders',         { altId: req.locationId, altType: 'location', limit: 3 }],
  };
  const [endpoint, params] = endpointMap[type] || endpointMap.subscription;
  try {
    const data = await req.ghl('GET', endpoint, null, params);
    const key  = type === 'subscription' ? 'subscriptions' : type === 'transaction' ? 'transactions' : 'orders';
    const records = data?.[key] || data?.data || [];
    const sample  = records.slice(0, 3).map(r => ({ allKeys: Object.keys(r), raw: r }));
    console.log(`[Billing DEBUG] type=${type} total=${records.length}`);
    sample.forEach((s, i) => console.log(`[Billing DEBUG] record[${i}] keys:`, JSON.stringify(s.allKeys)));
    res.json({ success: true, type, total: records.length, sample });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /rpt/invoices ─────────────────────────────────────────────────────────
// ?type=invoice|subscription|order|transaction

router.get('/invoices', async (req, res) => {
  if (!requireGhl(req, res)) return;
  const { limit = 20, page = 1, type = 'invoice', status, startDate, endDate } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  try {
    let endpoint, params;

    if (type === 'subscription') {
      endpoint = '/payments/subscriptions';
      params   = { altId: req.locationId, altType: 'location', limit: Number(limit), offset };
      if (startDate) params.startAt = startDate;
      if (endDate)   params.endAt   = endDate;
    } else if (type === 'transaction') {
      endpoint = '/payments/transactions';
      params   = { altId: req.locationId, altType: 'location', limit: Number(limit), offset };
      if (startDate) params.startAt = startDate;
      if (endDate)   params.endAt   = endDate;
    } else if (type === 'order') {
      endpoint = '/payments/orders';
      params   = { altId: req.locationId, altType: 'location', limit: Number(limit), offset };
      if (startDate) params.startAt = startDate;
      if (endDate)   params.endAt   = endDate;
    } else {
      // default: invoices
      endpoint = '/invoices/';
      params   = { altId: req.locationId, altType: 'location', limit: Number(limit), offset };
      if (status)    params.status  = status;
      if (startDate) params.startAt = startDate;
      if (endDate)   params.endAt   = endDate;
    }

    const data    = await req.ghl('GET', endpoint, null, params);
    const records = data?.invoices || data?.subscriptions || data?.orders || data?.transactions || data?.data || [];
    const total   = data?.meta?.total ?? data?.total ?? data?.count ?? records.length;

    res.json({ success: true, data: records, meta: { total } });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── PUT /rpt/conversations/:id/read ──────────────────────────────────────────

router.put('/conversations/:id/read', async (req, res) => {
  if (!requireGhl(req, res)) return;
  try {
    await req.ghl('PUT', `/conversations/${req.params.id}`, { unread: false });
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

module.exports = router;
