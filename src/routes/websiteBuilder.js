/**
 * src/routes/websiteBuilder.js
 *
 * AI Website Page Builder — generates AI copy for GHL website pages.
 *
 * Mounts at /website-builder
 *
 * GHL v2 API on services.leadconnectorhq.com (OAuth)
 * Required scopes: websites.readonly, websites.write
 *
 * GET  /website-builder/websites          — list websites for this location
 * POST /website-builder/generate          — SSE: AI generates page → creates in GHL
 */

require('dotenv').config();

const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const aiService    = require('../services/aiService');
const ghlClient    = require('../services/ghlClient');

router.use(authenticate);

// ─── JSON parse helper ────────────────────────────────────────────────────────

function parseJsonSafe(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  const slice = (start !== -1 && end > start) ? cleaned.slice(start, end + 1) : cleaned;
  try { return JSON.parse(slice); } catch {
    try {
      const { jsonrepair } = require('jsonrepair');
      return JSON.parse(jsonrepair(slice));
    } catch {
      throw new Error(`AI returned non-JSON: ${raw.slice(0, 120)}`);
    }
  }
}

// ─── GET /website-builder/websites ───────────────────────────────────────────

router.get('/websites', async (req, res) => {
  try {
    // Websites are a subtype of funnels in GHL — filter by type=website
    const data = await ghlClient.ghlRequest(req.locationId, 'GET', '/funnels/funnel/list', null, {
      locationId: req.locationId,
      type:       'website',
      limit:      50,
      offset:     0,
    });
    const list = data?.funnels || data?.data || (Array.isArray(data) ? data : []);
    res.json({ success: true, websites: list });
  } catch (err) {
    console.error('[WebsiteBuilder] list websites error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── AI: generate website page content ────────────────────────────────────────

const PAGE_TYPE_CONTEXT = {
  home:       'Home page — first impression, hero headline, main value prop, social proof, multiple CTAs',
  about:      'About page — brand story, team, mission, trust signals, humanising the brand',
  services:   'Services/Offerings page — list of services with benefits, pricing hints, strong CTAs',
  contact:    'Contact page — inviting copy, multiple contact methods, form intro, FAQs',
  landing:    'Landing page — single focused offer, no nav, strong headline, benefits, urgency, CTA',
  blog:       'Blog index page — intro, categories, recent posts teaser, newsletter CTA',
  pricing:    'Pricing page — plans, features comparison, social proof, FAQs, guarantee',
  portfolio:  'Portfolio/Work page — intro, showcase, case study hooks, CTA for enquiries',
  faq:        'FAQ page — intro, categorised questions with conversational answers, bottom CTA',
  custom:     'Custom page — general purpose, follow the brief closely',
};

async function generatePageContent(brief) {
  const { pageName, pageType, websiteName, niche, offer, audience, brand, colorScheme, extraNotes } = brief;
  const ctx = PAGE_TYPE_CONTEXT[pageType] || PAGE_TYPE_CONTEXT.custom;
  const provider = await aiService.getProvider();

  const system = `You are an expert web copywriter and UX strategist. You write high-converting website page copy that is specific, human, and persuasive — never generic or vague. Return only valid JSON.`;

  const user = `Write complete copy for a "${pageName}" website page.

Page Type: ${ctx}
Business/Niche: ${niche}
Offer/Product: ${offer || 'their main product or service'}
Target Audience: ${audience || 'ideal customers'}
Brand/Business Name: ${brand || 'the business'}
Website Name: ${websiteName || 'the website'}
Color Scheme: ${colorScheme || 'professional and modern'}
Extra Notes: ${extraNotes || 'none'}

Rules:
1. Write specifically for THIS niche and audience — no generic filler
2. Every headline must have a concrete benefit or outcome
3. CTAs should be action-oriented and specific (not just "Click Here")
4. Include real pain points and desired outcomes this page should address
5. SEO title 50-60 chars, meta description 150-160 chars
6. Each section must have a purpose — no padding

Return this exact JSON:
{
  "seoTitle": "50-60 char SEO title",
  "metaDescription": "150-160 char meta description",
  "sections": [
    {
      "type": "hero",
      "headline": "Bold, benefit-driven headline (8-12 words)",
      "subheadline": "Supporting sentence that adds specificity (1-2 sentences)",
      "ctaText": "Primary CTA button text",
      "ctaSubtext": "Risk reducer under the button (optional)"
    },
    {
      "type": "value_proposition",
      "headline": "Section headline",
      "items": [
        { "icon": "emoji", "title": "Benefit title", "body": "2-3 sentence explanation" }
      ]
    },
    {
      "type": "social_proof",
      "headline": "Section headline",
      "items": [
        { "quote": "testimonial text", "author": "Name, Role/Company", "result": "specific result achieved" }
      ]
    },
    {
      "type": "offer_detail",
      "headline": "Section headline",
      "body": "2-3 paragraph explanation of the offer/service",
      "bullets": ["specific feature or benefit 1", "specific feature or benefit 2"]
    },
    {
      "type": "cta_section",
      "headline": "Closing headline that creates urgency or excitement",
      "body": "1-2 sentences reinforcing the value",
      "ctaText": "Final CTA button text",
      "subtext": "Guarantee or risk reversal statement"
    }
  ],
  "suggestedColors": {
    "primary": "#hex",
    "bg": "#hex",
    "text": "#hex",
    "accent": "#hex"
  }
}`;

  const raw = await aiService.generate(system, user, { maxTokens: 2000 });
  const parsed = parseJsonSafe(raw);
  parsed._provider = provider;
  return parsed;
}

// ─── POST /website-builder/generate ──────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const {
    websiteId   = '',
    websiteName = '',
    pageName    = 'New Page',
    pageType    = 'landing',
    pageUrl     = '',
    niche       = '',
    offer       = '',
    audience    = '',
    brand       = '',
    colorScheme = '',
    extraNotes  = '',
  } = req.body;

  if (!niche && !offer && !pageName) {
    return res.status(400).json({ success: false, error: 'Provide at least niche or offer details.' });
  }

  // SSE setup
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // ── Step 1: Generate page content ─────────────────────────────────────
    send('step', { step: 1, total: 2, label: 'Generating website page copy with AI…' });

    const content = await generatePageContent({ pageName, pageType, websiteName, niche, offer, audience, brand, colorScheme, extraNotes });
    send('content', content);

    // ── Step 2: Create GHL website page ───────────────────────────────────
    send('step', { step: 2, total: 2, label: 'Creating page in GHL website builder…' });

    if (!websiteId) {
      // No website selected — return content only
      send('warn', { message: 'No website ID provided — page content generated but not saved to GHL. Enter a website ID to auto-save.' });
      send('done', { success: false, noWebsite: true, content, pageName });
      return res.end();
    }

    // url field: no leading slash (GHL requirement)
    const slug = (pageUrl || pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).replace(/^\//, '');

    // GHL website pages use the funnels API: POST /funnels/page with funnelId = websiteId
    const pagePayload = {
      locationId:  req.locationId,
      funnelId:    websiteId,
      name:        pageName,
      url:         slug,
      title:       content.seoTitle || pageName,
      description: content.metaDescription || '',
      published:   false,
    };

    console.log('[WebsiteBuilder] POST /funnels/page for', req.locationId, 'websiteId:', websiteId);

    let ghlData;
    try {
      ghlData = await ghlClient.ghlRequest(req.locationId, 'POST', '/funnels/page', pagePayload);
      console.log('[WebsiteBuilder] page created:', JSON.stringify(ghlData).slice(0, 300));
    } catch (e) {
      console.error('[WebsiteBuilder] create error:', e.message);
      const is401 = e.message.includes('401');
      const errMsg = is401
        ? 'Missing scope: websites.write. Reinstall the GTM AI Toolkit app to grant the new permission, then retry.'
        : `GHL API error: ${e.message}`;
      send('error', { error: errMsg, needsReinstall: is401 });
      send('done', { success: false, content, needsReinstall: is401 });
      return res.end();
    }

    const pageId  = ghlData?.id || ghlData?.pageId || ghlData?._id || null;
    const editUrl = pageId
      ? `https://app.gohighlevel.com/v2/location/${req.locationId}/sites/website/${websiteId}/page/${pageId}`
      : null;

    send('done', {
      success: true,
      pageId,
      editUrl,
      slug,
      content,
      pageName,
    });

  } catch (err) {
    console.error('[WebsiteBuilder] error:', err.message);
    send('error', { error: err.message });
  }

  res.end();
});

module.exports = router;
