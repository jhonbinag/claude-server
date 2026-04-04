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
    const now     = Date.now();
    const weekMs  = 7  * 24 * 60 * 60 * 1000;
    const monthMs = 30 * 24 * 60 * 60 * 1000;

    const ok = r => r.status === 'fulfilled';

    // Fetch totals
    const [contacts, opps, convs] = await Promise.allSettled([
      req.ghl('GET', '/contacts/',            null, { locationId: locId, limit: 1 }),
      req.ghl('GET', '/opportunities/search', null, { location_id: locId, limit: 1 }),
      req.ghl('GET', '/conversations/search', null, { locationId: locId, limit: 1 }),
    ]);

    // Fetch up to 10 pages and count — GHL does NOT sort by date so we
    // cannot use early-exit; we must scan all fetched contacts.
    let weekly = 0, monthly = 0;
    let cursor = null;
    const cutoff30d = now - monthMs;
    const cutoff7d  = now - weekMs;
    let allFetched = [];

    for (let p = 0; p < 10; p++) {
      const params = { locationId: locId, limit: 100 };
      if (cursor) params.startAfter = cursor;
      try {
        const d = await req.ghl('GET', '/contacts/', null, params);
        const batch = d?.contacts || [];
        if (!batch.length) break;
        allFetched = allFetched.concat(batch);
        if (batch.length < 100) break;
        const lastDate = batch[batch.length - 1]?.dateAdded;
        cursor = lastDate ? new Date(lastDate).getTime() : null;
        if (!cursor) break;
      } catch (_) { break; }
    }

    // Log sample dates so we can verify filter is working
    if (allFetched.length > 0) {
      const sample = allFetched.slice(0, 3).map(c => c.dateAdded);
      console.log(`[Reporting] dashboard: fetched=${allFetched.length} cutoff7d=${new Date(cutoff7d).toISOString()} cutoff30d=${new Date(cutoff30d).toISOString()} sampleDates=${JSON.stringify(sample)}`);
    }

    allFetched.forEach(c => {
      const raw = c.dateAdded || c.dateCreated || c.createdAt || null;
      if (!raw) return;
      const addedMs = typeof raw === 'number' ? raw : new Date(raw).getTime();
      if (isNaN(addedMs)) return;
      if (addedMs >= cutoff7d)  weekly++;
      if (addedMs >= cutoff30d) monthly++;
    });

    console.log(`[Reporting] dashboard counts: weekly=${weekly} monthly=${monthly}`);

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

    if (hasDateFilter) {
      // GHL max limit is 100. Fetch up to 5 pages (500 contacts) for date filtering.
      const GHL_MAX = 100;
      const MAX_PAGES = 5;
      let startAfterCursor = null;

      for (let p = 0; p < MAX_PAGES; p++) {
        const params = { locationId: req.locationId, limit: GHL_MAX };
        if (query) params.query = query;
        // startAfter must be a ms timestamp number (not a contact ID)
        if (startAfterCursor) params.startAfter = startAfterCursor;

        const data = await req.ghl('GET', '/contacts/', null, params);
        const batch = data?.contacts || [];
        contacts = contacts.concat(batch);

        if (p === 0 && batch.length > 0) {
          console.log('[Reporting] GHL contact date fields:', JSON.stringify({ dateAdded: batch[0].dateAdded }));
        }

        if (batch.length < GHL_MAX) break;
        // Use last contact's dateAdded as next page cursor (must be a number)
        const lastDate = batch[batch.length - 1]?.dateAdded;
        startAfterCursor = lastDate ? new Date(lastDate).getTime() : null;
        if (!startAfterCursor) break;
      }

      const startMs = startDate ? new Date(startDate).getTime() : null;
      const endMs   = endDate   ? new Date(endDate).getTime() + 86399999 : null;

      console.log(`[Reporting] fetched ${contacts.length} total, filtering startMs:${startMs} endMs:${endMs}`);

      contacts = contacts.filter(c => {
        const raw = c.dateAdded || c.dateCreated || c.createdAt || null;
        if (!raw) return false;
        const addedMs = typeof raw === 'number' ? raw : new Date(raw).getTime();
        if (isNaN(addedMs)) return false;
        if (startMs && addedMs < startMs) return false;
        if (endMs   && addedMs > endMs)   return false;
        return true;
      });

      console.log(`[Reporting] after date filter: ${contacts.length} matched`);
    } else {
      const params = { locationId: req.locationId, limit: Math.min(pageSize, 100) };
      if (query) params.query = query;
      const data = await req.ghl('GET', '/contacts/', null, params);
      contacts = data?.contacts || [];
    }

    const total    = contacts.length;
    const offset   = (pageNum - 1) * pageSize;
    const paginated = hasDateFilter ? contacts.slice(offset, offset + pageSize) : contacts;

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
