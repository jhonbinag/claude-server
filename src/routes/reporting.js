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
    const now     = Date.now();
    const weekMs  = 7  * 24 * 60 * 60 * 1000;
    const monthMs = 30 * 24 * 60 * 60 * 1000;

    // Fetch totals + large recent batches for server-side date counting
    const [contacts, opps, convs, recent500] = await Promise.allSettled([
      req.ghl('GET', '/contacts/',            null, { locationId: locId, limit: 1 }),
      req.ghl('GET', '/opportunities/search', null, { location_id: locId, limit: 1 }),
      req.ghl('GET', '/conversations/search', null, { locationId: locId, limit: 1 }),
      req.ghl('GET', '/contacts/',            null, { locationId: locId, limit: 500 }),
    ]);

    const ok = r => r.status === 'fulfilled';

    // Count contacts within 7d / 30d by filtering on dateAdded server-side
    let weekly = 0, monthly = 0;
    if (ok(recent500)) {
      const all = recent500.value?.contacts || [];
      all.forEach(c => {
        const raw     = c.createdAt ?? null;
        if (!raw) return;
        const addedMs = typeof raw === 'number' ? raw : new Date(raw).getTime();
        if (addedMs >= now - weekMs)  weekly++;
        if (addedMs >= now - monthMs) monthly++;
      });
    }

    res.json({
      success: true,
      data: {
        contacts: {
          total:   ok(contacts) ? (contacts.value?.meta?.total ?? contacts.value?.count ?? 0) : 0,
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

    // When filtering by date, fetch a large batch so we can filter properly.
    // GHL doesn't expose a reliable dateAdded filter on the list endpoint.
    const fetchLimit = hasDateFilter ? 500 : pageSize;
    const params = { locationId: req.locationId, limit: fetchLimit };
    if (query) params.query = query;

    const data = await req.ghl('GET', '/contacts/', null, params);
    let contacts = data?.contacts || [];

    if (hasDateFilter) {
      const startMs = startDate ? new Date(startDate).getTime() : null;
      // end of endDate day
      const endMs   = endDate   ? new Date(endDate).getTime() + 86399999 : null;

      contacts = contacts.filter(c => {
        const raw   = c.createdAt ?? null;
        if (!raw) return false;
        const addedMs = typeof raw === 'number' ? raw : new Date(raw).getTime();
        if (startMs && addedMs < startMs) return false;
        if (endMs   && addedMs > endMs)   return false;
        return true;
      });
    }

    const total    = contacts.length;
    const offset   = (pageNum - 1) * pageSize;
    const paginated = contacts.slice(offset, offset + pageSize);

    res.json({ success: true, data: paginated, meta: { total } });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /rpt/opportunities ────────────────────────────────────────────────────

router.get('/opportunities', async (req, res) => {
  if (!requireGhl(req, res)) return;
  const { limit = 20, page = 1, status, startDate, endDate } = req.query;
  try {
    const params = { location_id: req.locationId, limit: Number(limit), page: Number(page) };
    if (status)    params.status    = status;
    if (startDate) params.startDate = startDate;
    if (endDate)   params.endDate   = endDate;

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
    if (startDate) params.startAfterDate = new Date(startDate).getTime();

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
      params   = { locationId: req.locationId, limit: Number(limit), offset };
    } else if (type === 'transaction') {
      endpoint = '/payments/transactions';
      params   = { locationId: req.locationId, limit: Number(limit), offset };
    } else if (type === 'order') {
      endpoint = '/payments/orders';
      params   = { altId: req.locationId, altType: 'location', limit: Number(limit), offset };
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

module.exports = router;
