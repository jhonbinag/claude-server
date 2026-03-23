/**
 * src/routes/websiteBuilder.js
 *
 * AI Website Page Builder — generates native GHL section content and saves it.
 *
 * Mounts at /website-builder
 *
 * GET  /website-builder/websites   — list websites for this location
 * POST /website-builder/generate   — SSE: AI generates copy → creates page + saves native sections
 */

require('dotenv').config();

const express        = require('express');
const router         = express.Router();
const authenticate   = require('../middleware/authenticate');
const aiService      = require('../services/aiService');
const ghlClient      = require('../services/ghlClient');
const ghlPageBuilder = require('../services/ghlPageBuilder');

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
    const data = await ghlClient.ghlRequest(req.locationId, 'GET', '/funnels/funnel/list', null, {
      locationId: req.locationId,
      type:       'website',
      limit:      20,
      offset:     0,
    });
    const list = data?.funnels || data?.data || (Array.isArray(data) ? data : []);
    res.json({ success: true, websites: list });
  } catch (err) {
    console.error('[WebsiteBuilder] list websites error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /website-builder/pages?websiteId=xxx ─────────────────────────────────
// GHL's OAuth API returns [] for website pages — websites use a different system.
// We fetch pages via the Firebase backend API instead.

const https = require('https');

router.get('/pages', async (req, res) => {
  const { websiteId } = req.query;
  if (!websiteId) return res.status(400).json({ success: false, error: 'websiteId is required.' });

  // ── Try Firebase backend API first ────────────────────────────────────────
  try {
    const { getFirebaseToken } = require('../services/ghlFirebaseService');
    const idToken = await getFirebaseToken(req.locationId);
    const { buildBackendHeaders } = ghlPageBuilder;
    const headers = { ...buildBackendHeaders(idToken) };
    delete headers['Content-Type'];

    const path = `/funnels/page?locationId=${encodeURIComponent(req.locationId)}&funnelId=${encodeURIComponent(websiteId)}&limit=20&offset=0`;

    const result = await new Promise((resolve, reject) => {
      const r = https.request(
        { hostname: 'backend.leadconnectorhq.com', path, method: 'GET', headers },
        (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, data: d }); } }); }
      );
      r.on('error', reject);
      r.end();
    });

    console.log('[WebsiteBuilder] backend /pages status:', result.status, 'raw:', JSON.stringify(result.data).slice(0, 400));

    if (result.status < 300) {
      const d = result.data;
      let pages = d?.funnelPages || d?.pages || d?.pageList || d?.list || d?.data
               || (Array.isArray(d) ? d : []);
      if (pages && !Array.isArray(pages) && Array.isArray(pages.list))        pages = pages.list;
      if (pages && !Array.isArray(pages) && Array.isArray(pages.funnelPages)) pages = pages.funnelPages;
      pages = (pages || []).map(p => ({ ...p, id: p.id || p._id }));
      console.log('[WebsiteBuilder] backend pages resolved:', pages.length);
      return res.json({ success: true, pages });
    }
  } catch (fbErr) {
    console.warn('[WebsiteBuilder] backend pages fetch failed:', fbErr.message);
  }

  // ── Fallback: OAuth API ────────────────────────────────────────────────────
  try {
    const data = await ghlClient.ghlRequest(req.locationId, 'GET', '/funnels/page', null, {
      locationId: req.locationId,
      funnelId:   websiteId,
      limit:      20,
      offset:     '0',
    });
    console.log('[WebsiteBuilder] oauth /pages raw:', JSON.stringify(data).slice(0, 400));
    let pages = data?.funnelPages || data?.pages || data?.pageList || data?.list
             || (Array.isArray(data) ? data : []);
    pages = (pages || []).map(p => ({ ...p, id: p.id || p._id }));
    res.json({ success: true, pages });
  } catch (err) {
    console.error('[WebsiteBuilder] list pages error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Page type → section plan ─────────────────────────────────────────────────
// Each section specifies the element types to include — AI fills in the copy.

const PAGE_SECTION_PLANS = {
  home: [
    { name: 'Hero',              role: 'First impression — bold benefit-driven headline, supporting subheadline, primary CTA',  elements: ['headline h1', 'sub-heading', 'button'] },
    { name: 'Value Proposition', role: '3–4 core benefits or reasons to choose this business — bullet list format',            elements: ['heading h2', 'bulletList'] },
    { name: 'Social Proof',      role: 'Testimonial or results that build trust — 1–2 paragraphs',                            elements: ['heading h2', 'paragraph'] },
    { name: 'Services Overview', role: 'Brief overview of key services with outcome-focused descriptions',                     elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Final CTA',         role: 'Closing call to action with urgency or guarantee — re-state the core benefit',        elements: ['heading h2', 'paragraph', 'button'] },
  ],
  about: [
    { name: 'About Hero',    role: 'Brand intro — who you are, who you help, and why it matters',            elements: ['headline h1', 'sub-heading'] },
    { name: 'Mission',       role: 'Mission statement and core values — bullet list of what you stand for', elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Story',         role: 'Founder or team story — humanise the brand, build connection',          elements: ['heading h2', 'paragraph'] },
    { name: 'Trust Signals', role: 'Credentials, awards, years of experience, key numbers',                 elements: ['heading h2', 'bulletList'] },
    { name: 'Connect CTA',   role: 'Invite visitor to take the next step — book a call or get in touch',   elements: ['heading h2', 'paragraph', 'button'] },
  ],
  services: [
    { name: 'Services Hero',   role: 'Clear headline about what is offered and who it is for',                     elements: ['headline h1', 'sub-heading'] },
    { name: 'Core Services',   role: 'List of key services with brief outcome-focused descriptions',               elements: ['heading h2', 'bulletList'] },
    { name: 'Benefits',        role: 'What clients gain — transformation, outcomes, and results',                  elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Social Proof',    role: 'Client result or short testimonial that reinforces the service value',       elements: ['heading h2', 'paragraph'] },
    { name: 'Enquire CTA',     role: 'Strong CTA to book a consultation or enquire about services',               elements: ['heading h2', 'paragraph', 'button'] },
  ],
  landing: [
    { name: 'Hero',             role: 'Single focused offer — concrete benefit headline, key promise, CTA', elements: ['headline h1', 'sub-heading', 'button'] },
    { name: 'Problem',          role: 'Agitate the pain point this offer solves — specific, relatable',     elements: ['heading h2', 'paragraph'] },
    { name: 'Solution',         role: 'How this offer solves the problem — 4–5 benefit bullets',            elements: ['heading h2', 'bulletList'] },
    { name: 'Social Proof',     role: 'Short testimonial or specific result that overcomes objections',     elements: ['heading h2', 'paragraph'] },
    { name: 'Final CTA',        role: 'Last-chance CTA — urgency, guarantee, or risk reversal statement',  elements: ['heading h2', 'paragraph', 'button'] },
  ],
  contact: [
    { name: 'Contact Hero',    role: 'Welcoming headline that makes reaching out feel easy and worthwhile', elements: ['headline h1', 'sub-heading'] },
    { name: 'Contact Methods', role: 'Phone, email, social, address — multiple ways to reach the business', elements: ['heading h2', 'bulletList'] },
    { name: 'What to Expect',  role: 'What happens after they reach out — the response process',           elements: ['heading h2', 'paragraph'] },
    { name: 'FAQ',             role: '3–4 common contact questions with brief, friendly answers',           elements: ['heading h2', 'paragraph'] },
  ],
  pricing: [
    { name: 'Pricing Hero',     role: 'Value-first headline — transparency and confidence in pricing',         elements: ['headline h1', 'sub-heading'] },
    { name: 'Plans',            role: 'Plan tiers with included features as bullet lists per plan',           elements: ['heading h2', 'bulletList'] },
    { name: "What's Included",  role: 'Key inclusions and guarantees across all plans',                      elements: ['heading h2', 'bulletList'] },
    { name: 'FAQ',              role: 'Common pricing objections and questions answered honestly',             elements: ['heading h2', 'paragraph'] },
    { name: 'Get Started CTA',  role: 'CTA to sign up, book a demo, or talk to sales',                       elements: ['heading h2', 'paragraph', 'button'] },
  ],
  faq: [
    { name: 'FAQ Hero',       role: 'Reassuring intro — this page will answer your questions',          elements: ['headline h1', 'sub-heading'] },
    { name: 'General FAQs',   role: '4–5 broad questions with conversational, honest answers',          elements: ['heading h2', 'paragraph'] },
    { name: 'Product FAQs',   role: '4–5 specific questions about the offer with direct answers',       elements: ['heading h2', 'paragraph'] },
    { name: 'More Questions', role: 'Invite them to reach out if their question was not answered',      elements: ['heading h2', 'paragraph', 'button'] },
  ],
  portfolio: [
    { name: 'Portfolio Hero',   role: 'Showcase intro — what you do and the niche you serve',           elements: ['headline h1', 'sub-heading'] },
    { name: 'Featured Work',    role: '3–4 project/case study descriptions with outcomes and results',  elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Results',          role: 'Specific measurable results achieved for clients',               elements: ['heading h2', 'bulletList'] },
    { name: 'Work With Us CTA', role: 'CTA to enquire about working together or book a discovery call', elements: ['heading h2', 'paragraph', 'button'] },
  ],
  blog: [
    { name: 'Blog Hero',      role: 'Blog index intro — what topics are covered and who it is for',  elements: ['headline h1', 'sub-heading'] },
    { name: 'Categories',     role: 'Main blog categories or topics covered as a list',              elements: ['heading h2', 'bulletList'] },
    { name: 'Newsletter CTA', role: 'Subscribe CTA — clear value for joining the email list',        elements: ['heading h2', 'paragraph', 'button'] },
  ],
  custom: [
    { name: 'Hero',             role: 'Opening hero — main headline, supporting context, primary CTA', elements: ['headline h1', 'sub-heading', 'button'] },
    { name: 'Main Content',     role: 'Core content — explain the main message with detail',           elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Supporting',       role: 'Additional detail, social proof, or secondary message',         elements: ['heading h2', 'paragraph'] },
    { name: 'CTA',              role: 'Closing call to action — clear next step',                      elements: ['heading h2', 'button'] },
  ],
};

// ─── AI: generate native GHL section content ──────────────────────────────────

async function generatePageSections(brief) {
  const { pageName, pageType, websiteName, niche, offer, audience, brand, colorScheme, extraNotes } = brief;
  const plan     = PAGE_SECTION_PLANS[pageType] || PAGE_SECTION_PLANS.custom;
  const provider = await aiService.getProvider();

  const sectionList = plan.map((s, i) =>
    `Section ${i + 1}: "${s.name}" — ${s.role}\n  Required elements: ${s.elements.join(', ')}`
  ).join('\n\n');

  const system = `You are an expert direct-response copywriter. Write compelling, specific website copy that converts. Return ONLY valid JSON — no markdown fences, no explanation.`;

  const user = `Write native GHL website page sections for: "${pageName}"

Business/Niche: ${niche || 'the business'}
Offer/Product: ${offer || 'their main product or service'}
Target Audience: ${audience || 'ideal customers'}
Brand Name: ${brand || 'the business'}
Website Name: ${websiteName || 'the website'}
Color Scheme Hint: ${colorScheme || 'professional and modern'}
Extra Notes: ${extraNotes || 'none'}

Copywriting rules:
1. Write for THIS specific niche — no generic placeholder copy
2. Every headline states a concrete benefit or outcome (not what you do, but what they GET)
3. Use real pain points this audience has
4. CTAs must be action-specific ("Book Your Free Strategy Call" not "Click Here")
5. Bullet list items: concise, specific, outcome-focused (8–12 words each)

Sections to write (follow this exact plan):
${sectionList}

Return this exact JSON:
{
  "seoTitle": "SEO page title 50–60 chars",
  "metaDescription": "Meta description 150–160 chars",
  "sections": [
    {
      "name": "Section Name",
      "styles": { "backgroundColor": { "value": "#hexcolor" } },
      "children": [
        { "type": "headline",    "tag": "h1", "text": "Main headline text",           "styles": { "color": { "value": "#ffffff" } } },
        { "type": "sub-heading",              "text": "Supporting subheadline text",  "styles": { "color": { "value": "#e5e7eb" } } },
        { "type": "heading",     "tag": "h2", "text": "Section heading",              "styles": { "color": { "value": "#111827" } } },
        { "type": "paragraph",                "text": "Body copy — use <strong> for bold emphasis", "styles": { "color": { "value": "#374151" } } },
        { "type": "bulletList",               "items": ["Bullet one", "Bullet two"],  "styles": { "color": { "value": "#374151" } } },
        { "type": "button",                   "text": "CTA Button Text",              "styles": { "backgroundColor": { "value": "#primary" }, "color": { "value": "#ffffff" } } }
      ]
    }
  ]
}

Color guidance:
- First section (hero): use a dark branded background color, white or light text
- Middle sections: alternate white (#ffffff) and very light gray (#F9FAFB)
- Last section (CTA): use a dark or accent background, contrasting text
- Button backgrounds: use a bright accent or primary color
- Never use the literal placeholder "#primary" — always use a real hex color
- Keep text colors contrasting: white/light on dark backgrounds, dark on light backgrounds`;

  const raw    = await aiService.generate(system, user, { maxTokens: 3500 });
  const parsed = parseJsonSafe(raw);
  parsed._provider = provider;
  return parsed;
}

// ─── POST /website-builder/generate ──────────────────────────────────────────
// Requires an existing pageId — GHL does not support page creation via API.
// User must create a blank page in GHL website editor first, then select it here.

router.post('/generate', async (req, res) => {
  const {
    websiteId   = '',
    websiteName = '',
    pageId      = '',
    pageName    = 'New Page',
    pageType    = 'landing',
    niche       = '',
    offer       = '',
    audience    = '',
    brand       = '',
    colorScheme = '',
    extraNotes  = '',
  } = req.body;

  if (!websiteId) {
    return res.status(400).json({ success: false, error: 'websiteId is required.' });
  }
  if (!pageId) {
    return res.status(400).json({ success: false, error: 'pageId is required. Select a page from the dropdown or paste a page ID.' });
  }
  if (!niche && !offer) {
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
    const resolvedPageName = pageName || (pageType.charAt(0).toUpperCase() + pageType.slice(1) + ' Page');
    const editUrl = `https://app.gohighlevel.com/v2/location/${req.locationId}/sites/website/${websiteId}/page/${pageId}`;

    // ── Step 1: Generate native section content with AI ────────────────────
    send('step', { step: 1, total: 2, label: 'Generating page copy with AI…' });
    const content = await generatePageSections({ pageName: resolvedPageName, pageType, websiteName, niche, offer, audience, brand, colorScheme, extraNotes });
    send('content', content);

    // ── Step 2: Save native sections via Firebase Storage ──────────────────
    send('step', { step: 2, total: 2, label: 'Saving native section content to GHL…' });

    try {
      await ghlPageBuilder.savePageData(
        req.locationId,
        pageId,
        { sections: content.sections || [] },
        { funnelId: websiteId, colorScheme }
      );
      console.log('[WebsiteBuilder] native sections saved for page', pageId);
    } catch (saveErr) {
      console.error('[WebsiteBuilder] section save error:', saveErr.message);
      send('warn', { message: `Content generated but could not be saved: ${saveErr.message}` });
      send('done', { success: true, partial: true, pageId, editUrl, content, pageName: resolvedPageName });
      return res.end();
    }

    send('done', { success: true, pageId, editUrl, content, pageName: resolvedPageName });

  } catch (err) {
    console.error('[WebsiteBuilder] error:', err.message);
    send('error', { error: err.message });
  }

  res.end();
});

module.exports = router;
