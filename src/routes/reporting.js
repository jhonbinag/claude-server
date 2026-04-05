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

    // Fetch totals + opp status counts in parallel
    const [contacts, opps, convs, oppOpen, oppWon, oppLost, oppAbandoned] = await Promise.allSettled([
      req.ghl('GET', '/contacts/',            null, { locationId: locId, limit: 1 }),
      req.ghl('GET', '/opportunities/search', null, { location_id: locId, limit: 1 }),
      req.ghl('GET', '/conversations/search', null, { locationId: locId, limit: 1 }),
      req.ghl('GET', '/opportunities/search', null, { location_id: locId, limit: 1, status: 'open' }),
      req.ghl('GET', '/opportunities/search', null, { location_id: locId, limit: 1, status: 'won' }),
      req.ghl('GET', '/opportunities/search', null, { location_id: locId, limit: 1, status: 'lost' }),
      req.ghl('GET', '/opportunities/search', null, { location_id: locId, limit: 1, status: 'abandoned' }),
    ]);

    // Fetch recent contacts, filter by dateAdded server-side
    const cutoff1d   = now - 1 * 24 * 60 * 60 * 1000;
    const cutoff3d   = now - 3 * 24 * 60 * 60 * 1000;
    const cutoff7d   = now - weekMs;
    const cutoff30d  = now - monthMs;
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

    let recent1d = 0, recent3d = 0, weekly = 0, monthly = 0;
    allContacts.forEach(c => {
      const raw = c.dateAdded || null;
      if (!raw) return;
      const ms = new Date(raw).getTime();
      if (isNaN(ms)) return;
      if (ms >= cutoff1d)  recent1d++;
      if (ms >= cutoff3d)  recent3d++;
      if (ms >= cutoff7d)  weekly++;
      if (ms >= cutoff30d) monthly++;
    });

    console.log(`[Reporting] dashboard: scanned=${allContacts.length} recent1d=${recent1d} recent3d=${recent3d} weekly=${weekly} monthly=${monthly}`);

    const tot = r => ok(r) ? (r.value?.meta?.total ?? 0) : 0;

    res.json({
      success: true,
      data: {
        contacts: {
          total:    ok(contacts) ? (contacts.value?.meta?.total ?? contacts.value?.count ?? 0) : 0,
          recent1d,
          recent3d,
          weekly,
          monthly,
        },
        opportunities: {
          total:     tot(opps),
          byStatus: {
            open:      tot(oppOpen),
            won:       tot(oppWon),
            lost:      tot(oppLost),
            abandoned: tot(oppAbandoned),
          },
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

// ── GET /rpt/pipelines ────────────────────────────────────────────────────────

router.get('/pipelines', async (req, res) => {
  if (!requireGhl(req, res)) return;
  try {
    const data = await req.ghl('GET', '/opportunities/pipelines', null, { locationId: req.locationId });
    res.json({ success: true, data: data?.pipelines || [] });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /rpt/opp-stats ────────────────────────────────────────────────────────
// Returns open/won/lost/abandoned counts, optionally filtered by pipelineId

router.get('/opp-stats', async (req, res) => {
  if (!requireGhl(req, res)) return;
  const { pipelineId } = req.query;
  try {
    const base = { location_id: req.locationId, limit: 1 };
    if (pipelineId) base.pipelineId = pipelineId;

    const [open, won, lost, abandoned] = await Promise.allSettled([
      req.ghl('GET', '/opportunities/search', null, { ...base, status: 'open' }),
      req.ghl('GET', '/opportunities/search', null, { ...base, status: 'won' }),
      req.ghl('GET', '/opportunities/search', null, { ...base, status: 'lost' }),
      req.ghl('GET', '/opportunities/search', null, { ...base, status: 'abandoned' }),
    ]);

    const tot = r => r.status === 'fulfilled' ? (r.value?.meta?.total ?? 0) : 0;
    res.json({
      success: true,
      data: { open: tot(open), won: tot(won), lost: tot(lost), abandoned: tot(abandoned) },
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

router.get('/opportunities', async (req, res) => {
  if (!requireGhl(req, res)) return;
  const { limit = 20, page = 1, status, startDate, endDate, q, pipelineId } = req.query;
  try {
    const params = { location_id: req.locationId, limit: Number(limit), page: Number(page) };
    if (status)     params.status     = status;
    if (startDate)  params.startDate  = startDate;
    if (endDate)    params.endDate    = endDate;
    if (q)          params.q          = q;
    if (pipelineId) params.pipelineId = pipelineId;

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

// ── GET /rpt/billing-chart ────────────────────────────────────────────────────
// Returns last 6 months of subscription / order / transaction counts grouped by month

router.get('/billing-chart', async (req, res) => {
  if (!requireGhl(req, res)) return;
  const { startDate, endDate } = req.query;
  try {
    const locId = req.locationId;
    const base  = { altId: locId, altType: 'location', limit: 200 };

    const [subs, orders, txns] = await Promise.allSettled([
      req.ghl('GET', '/payments/subscriptions', null, base),
      req.ghl('GET', '/payments/orders',         null, base),
      req.ghl('GET', '/payments/transactions',   null, base),
    ]);

    // Build month buckets — use provided date range or default last 6 months
    const rangeStart = startDate ? new Date(startDate) : null;
    const rangeEnd   = endDate   ? new Date(endDate + 'T23:59:59') : null;
    const now        = new Date();

    // Determine min/max month to show
    let fromMonth, toMonth;
    if (rangeStart && rangeEnd) {
      fromMonth = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
      toMonth   = new Date(rangeEnd.getFullYear(),   rangeEnd.getMonth(),   1);
    } else {
      fromMonth = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      toMonth   = new Date(now.getFullYear(), now.getMonth(),     1);
    }

    const months = [];
    for (let d = new Date(fromMonth); d <= toMonth; d.setMonth(d.getMonth() + 1)) {
      months.push({
        key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleString('default', { month: 'short', year: '2-digit' }),
        subscriptions: 0, orders: 0, transactions: 0,
      });
    }
    const byKey = Object.fromEntries(months.map(m => [m.key, m]));

    const bucket = (records, field) => {
      (records || []).forEach(r => {
        const raw = r.createdAt || r.dateAdded || r.created_at;
        if (!raw) return;
        const ts = new Date(raw);
        if (rangeStart && ts < rangeStart) return;
        if (rangeEnd   && ts > rangeEnd)   return;
        const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}`;
        if (byKey[key]) byKey[key][field]++;
      });
    };

    if (subs.status   === 'fulfilled') bucket(subs.value?.subscriptions   || subs.value?.data   || [], 'subscriptions');
    if (orders.status === 'fulfilled') bucket(orders.value?.orders         || orders.value?.data || [], 'orders');
    if (txns.status   === 'fulfilled') bucket(txns.value?.transactions     || txns.value?.data   || [], 'transactions');

    res.json({ success: true, data: months });
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
