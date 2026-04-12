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
const axios         = require('axios');
const router        = express.Router();
const authenticate  = require('../middleware/authenticate');
const toolRegistry  = require('../tools/toolRegistry');

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

    // Debug: log the full conversations response shape so we can see what GHL returns
    if (ok(convs)) {
      const cv = convs.value;
      console.log('[Reporting] convs keys:', Object.keys(cv || {}));
      console.log('[Reporting] convs meta:', cv?.meta, '| total:', cv?.total, '| count:', cv?.count, '| conversations.length:', cv?.conversations?.length);
    } else {
      console.log('[Reporting] convs FAILED:', convs.reason?.message);
    }

    // GHL conversations/search may return total at root level, under meta, or as count
    const convTotal = ok(convs)
      ? (convs.value?.meta?.total ?? convs.value?.total ?? convs.value?.meta?.count ?? convs.value?.count ?? convs.value?.conversations?.length ?? 0)
      : 0;

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
          total: convTotal,
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

// ── GET /rpt/affiliates ──────────────────────────────────────────────────────
// Fetch contacts and filter by affiliate tags + email + date range server-side.
// Query params: tag, email, startDate, endDate, page, limit
const AFFILIATE_TAGS = [
  'affiliate :: highlevel paid',
  'affiliate $97 monthly',
  'affiliate $297 monthly',
  'affiliate $497',
  'affiliate :: sub affiliate',
];

router.get('/affiliates', async (req, res) => {
  if (!requireGhl(req, res)) return;
  const { limit = 20, page = 1, startDate, endDate, email = '', tags: tagsParam = '' } = req.query;
  const pageNum  = Math.max(1, Number(page));
  const pageSize = Math.max(1, Number(limit));

  try {
    const startMs = startDate ? new Date(startDate).getTime() : null;
    const endMs   = endDate   ? new Date(endDate).getTime() + 86399999 : null;
    const hasDateFilter  = !!(startMs || endMs);
    const hasEmailFilter = !!email;

    // Parse selected tags from multi-select (comma-separated)
    const selectedTags = tagsParam ? tagsParam.split(',').map(t => t.trim()).filter(Boolean) : [];
    const affTagsLower = AFFILIATE_TAGS.map(t => t.toLowerCase());

    // Fetch all contacts the same way /contacts does — cursor pagination, no date params
    let contacts = [];
    let cursor   = null;
    const MAX_PAGES = 50; // up to 5000 contacts
    for (let p = 0; p < MAX_PAGES; p++) {
      const params = { locationId: req.locationId, limit: 100 };
      if (cursor) params.startAfter = cursor;
      const data  = await req.ghl('GET', '/contacts/', null, params);
      const batch = data?.contacts || [];
      contacts = contacts.concat(batch);
      if (batch.length < 100) break;
      const last = batch[batch.length - 1]?.dateAdded;
      cursor = last ? new Date(last).getTime() : null;
      if (!cursor) break;
    }

    // Deduplicate by email (keep first occurrence)
    const seenEmails = new Set();
    contacts = contacts.filter(c => {
      const key = (c.email || '').toLowerCase().trim() || c.id;
      if (!key || seenEmails.has(key)) return false;
      seenEmails.add(key);
      return true;
    });

    // Filter: must have at least one affiliate tag
    contacts = contacts.filter(c => {
      const cTags = (c.tags || []).map(t => (typeof t === 'string' ? t : t?.name || '').toLowerCase());
      return affTagsLower.some(at => cTags.includes(at));
    });

    // Filter by selected tags (multi-select — must have at least one of the selected tags)
    if (selectedTags.length) {
      const selLower = selectedTags.map(t => t.toLowerCase());
      contacts = contacts.filter(c => {
        const cTags = (c.tags || []).map(t => (typeof t === 'string' ? t : t?.name || '').toLowerCase());
        return selLower.some(st => cTags.includes(st));
      });
    }

    // Filter by email
    if (hasEmailFilter) {
      const eLower = email.toLowerCase();
      contacts = contacts.filter(c => (c.email || '').toLowerCase().includes(eLower));
    }

    // Filter by date
    if (hasDateFilter) {
      contacts = contacts.filter(c => {
        const ms = c.dateAdded ? new Date(c.dateAdded).getTime() : null;
        if (!ms || isNaN(ms)) return false;
        if (startMs && ms < startMs) return false;
        if (endMs   && ms > endMs)   return false;
        return true;
      });
    }

    const total     = contacts.length;
    const offset    = (pageNum - 1) * pageSize;
    const paginated = contacts.slice(offset, offset + pageSize);

    res.json({ success: true, data: paginated, meta: { total }, tags: AFFILIATE_TAGS });
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
    const pipelines = data?.pipelines || [];
    // Log shape so we can confirm stage structure
    if (pipelines.length > 0) {
      console.log('[Pipelines] first pipeline keys:', Object.keys(pipelines[0]));
      console.log('[Pipelines] first pipeline stages:', JSON.stringify(pipelines[0].stages?.slice(0, 2)));
    }
    res.json({ success: true, data: pipelines });
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
    if (pipelineId) base.pipeline_id = pipelineId;
    // Note: GHL /opportunities/search does not accept startDate/endDate — omit them

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
  const pageNum  = Math.max(1, Number(page));
  const pageSize = Math.max(1, Number(limit));
  const hasDateFilter = !!(startDate || endDate);

  try {
    // GHL /opportunities/search does NOT accept startDate/endDate (returns 422).
    // When date filter is active we fetch up to 10 pages and filter server-side by createdAt.
    const ghlParams = { location_id: req.locationId, limit: hasDateFilter ? 100 : pageSize };
    if (status)     ghlParams.status      = status;
    if (q)          ghlParams.q           = q;
    if (pipelineId) ghlParams.pipeline_id = pipelineId;

    let opps = [];
    let total = 0;

    if (!hasDateFilter) {
      ghlParams.page = pageNum;
      const data = await req.ghl('GET', '/opportunities/search', null, ghlParams);
      opps  = data?.opportunities || [];
      total = data?.meta?.total ?? 0;
    } else {
      // Server-side date filtering: fetch up to 10 pages, filter by createdAt
      const startMs = startDate ? new Date(startDate).getTime() : null;
      const endMs   = endDate   ? new Date(endDate).getTime() + 86399999 : null;
      let allOpps = [], page_ = 1;

      for (let i = 0; i < 10; i++) {
        const data  = await req.ghl('GET', '/opportunities/search', null, { ...ghlParams, page: page_++ });
        const batch = data?.opportunities || [];
        allOpps = allOpps.concat(batch);
        if (batch.length < 100) break;
      }

      opps  = allOpps.filter(o => {
        const ms = o.createdAt ? new Date(o.createdAt).getTime() : null;
        if (!ms) return false;
        if (startMs && ms < startMs) return false;
        if (endMs   && ms > endMs)   return false;
        return true;
      });
      total = opps.length;
      opps  = opps.slice((pageNum - 1) * pageSize, pageNum * pageSize);
    }

    res.json({ success: true, data: opps, meta: { total } });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /rpt/debug-pipeline — inspect raw GHL pipeline + opp field names ─────

router.get('/debug-pipeline', async (req, res) => {
  if (!requireGhl(req, res)) return;
  try {
    const locId = req.locationId;
    const [pipeData, oppData] = await Promise.all([
      req.ghl('GET', '/opportunities/pipelines', null, { locationId: locId }),
      req.ghl('GET', '/opportunities/search', null, { location_id: locId, limit: 3 }),
    ]);

    const pipelines = pipeData?.pipelines || [];
    const opps      = oppData?.opportunities || [];

    const pipelineSample = pipelines.slice(0, 2).map(p => ({
      id: p.id, name: p.name,
      stageKeys: p.stages?.[0] ? Object.keys(p.stages[0]) : [],
      stages: (p.stages || []).slice(0, 3).map(s => ({ id: s.id, name: s.name })),
    }));

    const oppSample = opps.slice(0, 2).map(o => ({
      allKeys: Object.keys(o),
      pipelineId:      o.pipelineId,
      pipeline:        o.pipeline,
      pipelineStageId: o.pipelineStageId,
      pipelineStage:   o.pipelineStage,
      stageName:       o.stageName,
      pipelineName:    o.pipelineName,
      stage:           o.stage,
    }));

    res.json({ success: true, pipelines: pipelineSample, opportunities: oppSample });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /rpt/conversations ────────────────────────────────────────────────────

router.get('/conversations', async (req, res) => {
  if (!requireGhl(req, res)) return;
  const { limit = 20, page = 1, startDate, endDate } = req.query;
  const pageNum  = Math.max(1, Number(page));
  const pageSize = Math.max(1, Number(limit));

  try {
    // GHL /conversations/search cursor params (startAfter, startAfterId, offset, page)
    // are all silently ignored — the API always returns the same first batch regardless.
    // Only solution: fetch the maximum (100) in one call and do local pagination.
    const data  = await req.ghl('GET', '/conversations/search', null,
      { locationId: req.locationId, limit: 100 });
    let conversations = data?.conversations || [];
    const ghlTotal    = data?.total ?? data?.meta?.total ?? conversations.length;

    // Apply date filter server-side if provided
    if (startDate || endDate) {
      const startMs = startDate ? new Date(startDate).getTime() : null;
      const endMs   = endDate   ? new Date(endDate).getTime() + 86399999 : null;
      conversations = conversations.filter(c => {
        const ms = new Date(c.lastMessageDate || c.dateAdded || c.dateUpdated).getTime();
        if (isNaN(ms)) return false;
        if (startMs && ms < startMs) return false;
        if (endMs   && ms > endMs)   return false;
        return true;
      });
    }

    const total     = conversations.length;
    const offset    = (pageNum - 1) * pageSize;
    const paginated = conversations.slice(offset, offset + pageSize);

    res.json({ success: true, data: paginated, meta: { total, ghlTotal } });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /rpt/debug-conversations — inspect raw GHL pagination fields ──────────

router.get('/debug-conversations', async (req, res) => {
  if (!requireGhl(req, res)) return;
  try {
    // Step 1: fetch first page
    const page1 = await req.ghl('GET', '/conversations/search', null, { locationId: req.locationId, limit: 5 });
    const convs1 = page1?.conversations || [];
    const last   = convs1[convs1.length - 1];

    // Step 2: try offset-based (like billing endpoints)
    const page2offset = await req.ghl('GET', '/conversations/search', null,
      { locationId: req.locationId, limit: 5, offset: 5 }).catch(e => ({ _error: e.message }));

    // Step 3: try startAfter + startAfterId
    const lastTs = last?.lastMessageDate || last?.dateUpdated || last?.dateAdded;
    const page2cursor = last ? await req.ghl('GET', '/conversations/search', null, {
      locationId:   req.locationId,
      limit:        5,
      startAfter:   lastTs ? new Date(lastTs).getTime() : undefined,
      startAfterId: last?.id,
    }).catch(e => ({ _error: e.message })) : null;

    // Step 4: try lastId alone
    const page2lastId = last ? await req.ghl('GET', '/conversations/search', null, {
      locationId: req.locationId,
      limit:      5,
      lastId:     last?.id,
    }).catch(e => ({ _error: e.message })) : null;

    const summarise = (d) => {
      if (!d) return null;
      if (d._error) return { error: d._error };
      const convs = d?.conversations || [];
      return {
        topKeys:  Object.keys(d),
        meta:     d?.meta,
        total:    d?.total,
        lastId:   d?.lastId,
        nextPage: d?.nextPage,
        count:    convs.length,
        firstId:  convs[0]?.id,
        lastIdInBatch: convs[convs.length - 1]?.id,
        sameAsPage1: convs[0]?.id === convs1[0]?.id,
      };
    };

    res.json({
      page1: {
        topKeys: Object.keys(page1 || {}),
        meta:    page1?.meta,
        total:   page1?.total,
        lastId:  page1?.lastId,
        count:   convs1.length,
        lastRecord: last ? { id: last.id, lastMessageDate: last.lastMessageDate, dateUpdated: last.dateUpdated, dateAdded: last.dateAdded } : null,
      },
      page2_offset:   summarise(page2offset),
      page2_cursor:   summarise(page2cursor),
      page2_lastId:   summarise(page2lastId),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
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
// Returns billing activity grouped by DAY (only days with records are included).
// Default: last 90 days. Respects startDate/endDate filters.

router.get('/billing-chart', async (req, res) => {
  if (!requireGhl(req, res)) return;
  const { startDate, endDate } = req.query;
  try {
    const locId = req.locationId;
    const base  = { altId: locId, altType: 'location', limit: 500 };

    const [subs, orders, txns] = await Promise.allSettled([
      req.ghl('GET', '/payments/subscriptions', null, base),
      req.ghl('GET', '/payments/orders',         null, base),
      req.ghl('GET', '/payments/transactions',   null, base),
    ]);

    const now        = new Date();
    const rangeStart = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const rangeEnd   = endDate   ? new Date(endDate + 'T23:59:59') : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // Accumulate counts per day key (YYYY-MM-DD) — only for days in range
    const byDay = {};

    const bucket = (records, field) => {
      (records || []).forEach(r => {
        const raw = r.createdAt || r.dateAdded || r.created_at;
        if (!raw) return;
        const ts = new Date(raw);
        if (ts < rangeStart || ts > rangeEnd) return;
        const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}`;
        if (!byDay[key]) byDay[key] = { key, subscriptions: 0, orders: 0, transactions: 0 };
        byDay[key][field]++;
      });
    };

    if (subs.status   === 'fulfilled') bucket(subs.value?.subscriptions   || subs.value?.data   || [], 'subscriptions');
    if (orders.status === 'fulfilled') bucket(orders.value?.orders         || orders.value?.data || [], 'orders');
    if (txns.status   === 'fulfilled') bucket(txns.value?.transactions     || txns.value?.data   || [], 'transactions');

    // Sort by date and add human-readable label
    const days = Object.values(byDay)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(d => {
        const [y, m, day] = d.key.split('-').map(Number);
        const dt = new Date(y, m - 1, day);
        const label = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return { ...d, label };
      });

    res.json({ success: true, data: days });
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

// ── /rpt/integrations — save tool configs without the admin sharing gate ────
// The Reporting page is admin-level; users connecting their own Slack/ClickUp
// shouldn't need the location-level sharing flag set by an admin.

const ALLOWED_RPT_INTEGRATIONS = ['slack', 'clickup', 'anthropic'];

function maskValue(v) {
  if (!v || typeof v !== 'string') return v;
  if (v.length <= 8) return '••••••••';
  return v.slice(0, 4) + '••••••••' + v.slice(-4);
}

router.get('/integrations/:category', async (req, res) => {
  const { category } = req.params;
  if (!ALLOWED_RPT_INTEGRATIONS.includes(category)) {
    return res.status(404).json({ success: false, error: 'Unknown integration.' });
  }
  try {
    const configs = await toolRegistry.getToolConfig(req.locationId);
    const cfg     = configs[category] || {};
    const preview = Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, maskValue(v)]));
    res.json({ success: true, config: preview, connected: Object.keys(cfg).length > 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/integrations/:category', async (req, res) => {
  const { category } = req.params;
  if (!ALLOWED_RPT_INTEGRATIONS.includes(category)) {
    return res.status(404).json({ success: false, error: 'Unknown integration.' });
  }
  const body = req.body || {};
  const fields = Object.fromEntries(Object.entries(body).filter(([, v]) => v && typeof v === 'string' && v.trim()));
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ success: false, error: 'No fields provided.' });
  }
  try {
    await toolRegistry.saveToolConfig(req.locationId, category, fields);
    const preview = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, maskValue(v)]));
    res.json({ success: true, configPreview: preview });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/integrations/:category', async (req, res) => {
  const { category } = req.params;
  if (!ALLOWED_RPT_INTEGRATIONS.includes(category)) {
    return res.status(404).json({ success: false, error: 'Unknown integration.' });
  }
  try {
    await toolRegistry.deleteToolConfig(req.locationId, category);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ClickUp task picker endpoints ────────────────────────────────────────────

async function getClickupKey(locationId) {
  const configs = await toolRegistry.loadToolConfigs(locationId);
  const key = configs.clickup?.apiKey;
  if (!key) throw new Error('ClickUp not connected. Add your API key in Integrations.');
  return key;
}

// GET /rpt/clickup/lists — returns all spaces + lists tree
router.get('/clickup/lists', async (req, res) => {
  try {
    const apiKey = await getClickupKey(req.locationId);
    const teamsResp = await axios.get('https://api.clickup.com/api/v2/team', { headers: { Authorization: apiKey } });
    const teams = teamsResp.data?.teams || [];
    const result = [];
    for (const team of teams) {
      const spacesResp = await axios.get(`https://api.clickup.com/api/v2/team/${team.id}/space?archived=false`, { headers: { Authorization: apiKey } });
      for (const space of spacesResp.data?.spaces || []) {
        const lists = [];
        // Folderless lists
        const flResp = await axios.get(`https://api.clickup.com/api/v2/space/${space.id}/list?archived=false`, { headers: { Authorization: apiKey } });
        for (const l of flResp.data?.lists || []) lists.push({ id: l.id, name: l.name, taskCount: l.task_count });
        // Lists inside folders
        const foldersResp = await axios.get(`https://api.clickup.com/api/v2/space/${space.id}/folder?archived=false`, { headers: { Authorization: apiKey } });
        for (const folder of foldersResp.data?.folders || []) {
          const listsResp = await axios.get(`https://api.clickup.com/api/v2/folder/${folder.id}/list?archived=false`, { headers: { Authorization: apiKey } });
          for (const l of listsResp.data?.lists || []) lists.push({ id: l.id, name: `${folder.name} / ${l.name}`, taskCount: l.task_count });
        }
        result.push({ spaceId: space.id, spaceName: space.name, lists });
      }
    }
    res.json({ success: true, spaces: result });
  } catch (err) {
    res.status(err.message.includes('not connected') ? 400 : 502).json({ success: false, error: err.message });
  }
});

// GET /rpt/clickup/tasks?listId=xxx&query=foo — returns tasks from a list or workspace search
router.get('/clickup/tasks', async (req, res) => {
  try {
    const apiKey = await getClickupKey(req.locationId);
    const { listId, query, status, limit = 50 } = req.query;
    const trimTask = t => ({
      id:       t.id,
      name:     t.name,
      status:   t.status?.status || t.status,
      priority: t.priority?.priority,
      url:      t.url,
      listId:   t.list?.id,
      listName: t.list?.name,
      dueDate:  t.due_date ? new Date(Number(t.due_date)).toISOString().slice(0, 10) : null,
    });
    if (listId) {
      const params = { page: 0, order_by: 'updated', reverse: true, subtasks: true, include_closed: false };
      if (status) params.statuses = [status];
      const resp = await axios.get(`https://api.clickup.com/api/v2/list/${listId}/task`, { headers: { Authorization: apiKey }, params });
      return res.json({ success: true, tasks: (resp.data?.tasks || []).slice(0, limit).map(trimTask) });
    }
    // Workspace-level search
    const teamsResp = await axios.get('https://api.clickup.com/api/v2/team', { headers: { Authorization: apiKey } });
    const teamId = teamsResp.data?.teams?.[0]?.id;
    if (!teamId) return res.json({ success: true, tasks: [] });
    const params = { page: 0, order_by: 'updated', reverse: true, subtasks: true, include_closed: false };
    if (query)  params.search   = query;
    if (status) params.statuses = [status];
    const resp = await axios.get(`https://api.clickup.com/api/v2/team/${teamId}/task`, { headers: { Authorization: apiKey }, params });
    res.json({ success: true, tasks: (resp.data?.tasks || []).slice(0, limit).map(trimTask) });
  } catch (err) {
    res.status(err.message.includes('not connected') ? 400 : 502).json({ success: false, error: err.message });
  }
});

module.exports = router;
