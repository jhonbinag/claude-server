/**
 * adLibrary.js — Facebook Ad Library routes
 *
 * GET  /ad-library/search  — search competitor ads via Facebook Ads Archive API
 * POST /ad-library/analyze — send ads data to Claude for competitive analysis
 */

const express      = require('express');
const router       = express.Router();
const axios        = require('axios');
const authenticate = require('../middleware/authenticate');

const FB_API = 'https://graph.facebook.com/v19.0';

const AD_FIELDS = [
  'id',
  'page_id',
  'page_name',
  'ad_creative_bodies',
  'ad_creative_link_captions',
  'ad_creative_link_descriptions',
  'ad_creative_link_titles',
  'ad_delivery_start_time',
  'ad_delivery_stop_time',
  'ad_snapshot_url',
  'impressions',
  'spend',
  'demographic_distribution',
  'region_distribution',
  'publisher_platforms',
].join(',');

router.use(authenticate);

// ── Helper: resolve FB access token ───────────────────────────────────────────
// Priority order:
//   1. social_facebook (Social Hub — pageAccessToken field)
//   2. facebook_ads user access token
//   3. facebook_ads app token (APP_ID|APP_SECRET) — no OAuth needed
async function getFbToken(locationId) {
  const registry = require('../tools/toolRegistry');
  const configs  = await registry.loadToolConfigs(locationId);
  const fb  = configs.social_facebook || {};
  const ads = configs.facebook_ads    || {};

  // User/page token takes priority
  const userToken =
    fb.pageAccessToken || fb.accessToken || fb.pageToken || fb.userAccessToken ||
    ads.accessToken    || ads.pageToken  || ads.userAccessToken ||
    null;
  if (userToken) return userToken;

  // Fall back to App Token from env vars (APP_ID|APP_SECRET) — works for Ad Library reads
  const appId     = ads.appId     || process.env.FACEBOOK_APP_ID;
  const appSecret = ads.appSecret || process.env.FACEBOOK_APP_SECRET;
  if (appId && appSecret) {
    return `${appId}|${appSecret}`;
  }

  return null;
}

// ── Public scraper: Facebook's own internal Ad Library endpoint ───────────────
// Step 1: fetch the Ad Library page to get session cookies + CSRF tokens
// Step 2: use those cookies for the async search request
async function searchPublicAdLibrary({ q, country = 'US', status = 'ALL', limit = 30 }) {
  const crypto = require('crypto');

  // Rotate through realistic Chrome UAs to reduce fingerprinting
  const UAS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  ];
  const UA = UAS[Math.floor(Math.random() * UAS.length)];

  // Step 1: get cookies from the Ad Library page
  const seedRes = await axios.get('https://www.facebook.com/ads/library/', {
    headers: {
      'User-Agent':         UA,
      'Accept':             'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language':    'en-US,en;q=0.9',
      'Accept-Encoding':    'gzip, deflate, br',
      'DNT':                '1',
      'sec-ch-ua':          '"Chromium";v="123", "Not:A-Brand";v="8"',
      'sec-ch-ua-mobile':   '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest':     'document',
      'sec-fetch-mode':     'navigate',
      'sec-fetch-site':     'none',
      'sec-fetch-user':     '?1',
      'Upgrade-Insecure-Requests': '1',
    },
    timeout: 12000,
    maxRedirects: 5,
    validateStatus: s => s < 400,
  });

  const cookies = (seedRes.headers['set-cookie'] || [])
    .map(c => c.split(';')[0]).join('; ');

  // Extract CSRF tokens embedded in page HTML
  const html      = typeof seedRes.data === 'string' ? seedRes.data : '';
  const lsdMatch  = html.match(/"LSD",\s*\[\],\s*\{"token":"([^"]+)"/);
  const lsd       = lsdMatch?.[1] || '';
  const dtsgMatch = html.match(/"DTSGInitialData",\s*\[\],\s*\{"token":"([^"]+)"/);
  const dtsg      = dtsgMatch?.[1] || '';

  const params = new URLSearchParams({
    q,
    ad_type:          'all',
    active_status:    status === 'ACTIVE' ? 'active' : status === 'INACTIVE' ? 'inactive' : 'all',
    country,
    start_index:      '0',
    count:            String(Math.min(Number(limit), 50)),
    session_id:       crypto.randomUUID(),
    source:           'Search',
    search_type:      'keyword_unordered',
    view_all_page_id: '',
    ...(lsd  ? { lsd }          : {}),
    ...(dtsg ? { fb_dtsg: dtsg } : {}),
  });

  const response = await axios.get(
    `https://www.facebook.com/ads/library/async/search_ads/?${params.toString()}`,
    {
      headers: {
        'User-Agent':       UA,
        'Accept':           'application/json, text/javascript, */*; q=0.01',
        'Accept-Language':  'en-US,en;q=0.9',
        'Accept-Encoding':  'gzip, deflate, br',
        'Referer':          'https://www.facebook.com/ads/library/',
        'Origin':           'https://www.facebook.com',
        'X-Requested-With': 'XMLHttpRequest',
        'sec-fetch-dest':   'empty',
        'sec-fetch-mode':   'cors',
        'sec-fetch-site':   'same-origin',
        ...(cookies ? { 'Cookie': cookies } : {}),
      },
      timeout: 20000,
    }
  );

  // Facebook prefixes JSON responses with "for (;;);" — strip it
  let raw = response.data;
  if (typeof raw === 'string') {
    raw = raw.replace(/^for \(;;\);/, '').trim();
    raw = JSON.parse(raw);
  }

  // Extract ads from the response payload
  const ads = raw?.payload?.results || raw?.data?.results || raw?.results || [];
  if (!Array.isArray(ads)) throw new Error('Unexpected response format from Facebook');

  return ads.map(ad => ({
    id:                      ad.adArchiveID || ad.id || String(Math.random()),
    page_name:               ad.pageName    || ad.page_name || '',
    ad_creative_bodies:      ad.snapshot?.body?.markup?.__html
                               ? [ad.snapshot.body.markup.__html.replace(/<[^>]+>/g, '')]
                               : (ad.ad_creative_bodies || []),
    ad_creative_link_titles: ad.snapshot?.title ? [ad.snapshot.title] : (ad.ad_creative_link_titles || []),
    ad_creative_link_descriptions: ad.snapshot?.linkDescription ? [ad.snapshot.linkDescription] : [],
    ad_delivery_start_time:  ad.startDate || ad.ad_delivery_start_time || '',
    publisher_platforms:     ad.publisherPlatform || ad.publisher_platforms || [],
    impressions:             ad.impressionsWithIndex || ad.impressions || null,
    spend:                   ad.spend || null,
    _source:                 'public',
  }));
}

// ── GET /ad-library/search ────────────────────────────────────────────────────
// Query params:
//   q        — search terms (brand / competitor name)
//   country  — ISO2 country code, default US
//   type     — ALL | POLITICAL_AND_ISSUE_ADS, default ALL
//   status   — ALL | ACTIVE | INACTIVE, default ALL
//   limit    — max results, default 25
router.get('/search', async (req, res) => {
  try {
    const { q, country = 'US', type = 'ALL', status = 'ALL', limit = 25 } = req.query;
    console.log(`[AdLibrary] search request: locationId=${req.locationId} q="${q}" country=${country} status=${status} limit=${limit}`);
    if (!q) return res.status(400).json({ error: 'Search term (q) is required.' });

    // ── Try official API first (skip if token missing/expired) ──────────────────
    const token = await getFbToken(req.locationId);
    if (token) {
      try {
        const apiParams = {
          access_token:         token,
          search_terms:         q,
          ad_reached_countries: JSON.stringify([country === 'ALL' ? 'US' : country]),
          ad_type:              type,
          fields:               AD_FIELDS,
          limit:                Math.min(Number(limit), 50),
        };
        if (status !== 'ALL') apiParams.ad_active_status = status;
        const response = await axios.get(`${FB_API}/ads_archive`, { params: apiParams });
        const apiAds = response.data?.data || [];
        console.log(`[AdLibrary] official API: ${apiAds.length} ads for "${q}"`);
        return res.json({ data: apiAds });
      } catch (apiErr) {
        const msg = apiErr.response?.data?.error?.message || apiErr.message;
        console.warn(`[AdLibrary] official API failed (${msg}), falling back to public scraper`);
        // Continue to public scraper — do NOT re-throw
      }
    }

    // ── Public scraper fallback (no token needed) ─────────────────────────────
    console.log(`[AdLibrary] using public scraper for "${q}"`);
    try {
      const ads = await searchPublicAdLibrary({ q, country: country === 'ALL' ? 'US' : country, status, limit });
      console.log(`[AdLibrary] public scraper: ${ads.length} ads for "${q}"`);
      return res.json({ data: ads });
    } catch (scrapeErr) {
      console.error('[AdLibrary] public scraper failed:', scrapeErr.message);
      return res.status(500).json({ error: 'Unable to fetch ads. Facebook may be blocking server-side requests. Try the Paste & Analyze option instead.' });
    }

  } catch (err) {
    const message = err.response?.data?.error?.message || err.message;
    console.error('[AdLibrary] search error:', message);
    res.status(err.response?.status || 500).json({ error: message });
  }
});

// ── POST /ad-library/analyze ──────────────────────────────────────────────────
// Body: { ads: [...], focus: 'messaging|targeting|creative|all' }
// Streams Claude's competitive analysis as plain text
router.post('/analyze', async (req, res) => {
  try {
    const { ads, focus = 'all', competitor } = req.body;
    if (!ads || !ads.length) return res.status(400).json({ error: 'No ads provided.' });

    const registry  = require('../tools/toolRegistry');
    const configs   = await registry.loadToolConfigs(req.locationId);
    const apiKey    = configs.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'Anthropic API key not configured.' });

    const adSummaries = ads.slice(0, 20).map((ad, i) => {
      const body   = (ad.ad_creative_bodies  || []).join(' | ') || '—';
      const title  = (ad.ad_creative_link_titles || []).join(' | ') || '—';
      const descr  = (ad.ad_creative_link_descriptions || []).join(' | ') || '—';
      const impr   = ad.impressions ? `${ad.impressions.lower_bound}–${ad.impressions.upper_bound}` : 'N/A';
      const spend  = ad.spend       ? `$${ad.spend.lower_bound}–$${ad.spend.upper_bound}` : 'N/A';
      return `Ad #${i + 1} | Page: ${ad.page_name}\n  Headline: ${title}\n  Body: ${body}\n  Description: ${descr}\n  Impressions: ${impr} | Spend: ${spend}`;
    }).join('\n\n');

    const focusNote = {
      messaging:  'Focus on the messaging angles, hooks, emotional triggers, and CTAs being used.',
      targeting:  'Focus on the demographic distribution, regions, and who this competitor is targeting.',
      creative:   'Focus on the creative structure, headline formulas, and ad copy patterns.',
      all:        'Cover messaging, targeting signals, creative patterns, and strategic takeaways.',
    }[focus] || 'Cover all aspects of the ads.';

    const prompt = `You are a competitive intelligence analyst. Analyze the following Facebook ads from${competitor ? ` competitor "${competitor}"` : ' a competitor'} and provide actionable insights.

${focusNote}

Here are the ads:
${adSummaries}

Provide a structured analysis with:
1. **Key Messaging Themes** — What angles/hooks are they using most?
2. **Target Audience Signals** — Who are they targeting based on demographics/regions?
3. **Creative Patterns** — Common headline formulas, CTAs, ad structures?
4. **Competitive Opportunities** — Where are the gaps we can exploit?
5. **Recommended Actions** — 3–5 specific tactics to counter or differentiate from this competitor.

Be specific, data-driven, and actionable.`;

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model:      'claude-opus-4-6',
      max_tokens: 1500,
      messages:   [{ role: 'user', content: prompt }],
    });

    res.json({
      success:  true,
      analysis: message.content[0]?.text || '',
      usage:    message.usage,
    });
  } catch (err) {
    console.error('[AdLibrary] analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
