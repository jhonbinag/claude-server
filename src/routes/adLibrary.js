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
// Checks all possible sources in priority order:
//   1. social_facebook (Social Hub — pageAccessToken field)
//   2. facebook_ads (Manual FB Ads config — accessToken field)
async function getFbToken(locationId) {
  const registry = require('../tools/toolRegistry');
  const configs  = await registry.loadToolConfigs(locationId);
  const fb  = configs.social_facebook || {};
  const ads = configs.facebook_ads    || {};
  return (
    fb.pageAccessToken || fb.accessToken || fb.pageToken || fb.userAccessToken ||
    ads.accessToken    || ads.pageToken  || ads.userAccessToken ||
    null
  );
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
    if (!q) return res.status(400).json({ error: 'Search term (q) is required.' });

    const token = await getFbToken(req.locationId);
    if (!token) {
      return res.status(400).json({
        error:   'Facebook access token not configured.',
        hint:    'Connect Facebook in Settings → Social Hub (enter your Page Access Token).',
        code:    'FB_TOKEN_MISSING',
      });
    }

    const params = {
      access_token:        token,
      search_terms:        q,
      ad_reached_countries: JSON.stringify([country]),
      ad_type:             type,
      fields:              AD_FIELDS,
      limit:               Math.min(Number(limit), 50),
    };
    if (status !== 'ALL') params.ad_active_status = status;

    const response = await axios.get(`${FB_API}/ads_archive`, { params });
    res.json(response.data);
  } catch (err) {
    const status  = err.response?.status;
    const message = err.response?.data?.error?.message || err.message;
    console.error('[AdLibrary] search error:', message);
    res.status(status || 500).json({ error: message });
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
