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

// ─── Page templates — full structure per page type with alignment + copy role ──
// align: 'center' = hero/CTA/social proof blocks | 'left' = body/story/FAQ/benefits

const PAGE_SECTION_PLANS = {
  home: [
    { name: 'Hero Hook',          align: 'center', bg: 'dark',   role: 'Pattern-interrupt opening hook. Bold claim or provocative question as H1 that stops the scroll. Subheadline clarifies who this is for and the #1 outcome. Primary CTA button.', elements: ['headline h1', 'sub-heading', 'button'] },
    { name: 'Problem Agitation',  align: 'left',   bg: 'white',  role: 'Speak directly to the pain. Name the exact frustrations, struggles, and failed attempts the audience has experienced. Make them feel understood. 2 paragraphs + bullet list of pain points.', elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Our Story',          align: 'left',   bg: 'light',  role: 'Origin story — why this business exists. What problem the founder personally faced, how they found the solution, and why they are now dedicated to helping others. Humanise the brand. 2 paragraphs.', elements: ['heading h2', 'paragraph'] },
    { name: 'The Solution',       align: 'left',   bg: 'white',  role: 'Introduce the offer/service as the clear solution. What it is, how it works in simple terms, and the transformation it creates. 1 paragraph + 4–5 specific outcome bullets.', elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Why Choose Us',      align: 'left',   bg: 'light',  role: '3–4 specific differentiators — NOT generic ("we care about clients"). Real reasons backed by numbers, methods, or unique angles. Bullet list.', elements: ['heading h2', 'bulletList'] },
    { name: 'Social Proof',       align: 'center', bg: 'white',  role: 'Real client results and testimonials. Include specific outcomes (numbers, timeframes, before/after). 2 paragraphs written as testimonial-style quotes or case study results.', elements: ['heading h2', 'paragraph'] },
    { name: 'How It Works',       align: 'center', bg: 'light',  role: '3-step process — simple numbered steps showing exactly what happens after they sign up or reach out. Keep it frictionless. Bullet list formatted as Step 1, Step 2, Step 3.', elements: ['heading h2', 'bulletList'] },
    { name: 'FAQ',                align: 'left',   bg: 'white',  role: '5 real objection-handling questions. Format each as bold Q followed by honest, reassuring A. Cover: cost concern, time commitment, will it work for me, what if I\'m not happy, how to get started.', elements: ['heading h2', 'paragraph'] },
    { name: 'Newsletter',         align: 'center', bg: 'light',  role: 'Email newsletter signup. Lead with the VALUE of subscribing (tips, resources, insider info). Clear benefit headline, 1 sentence why, CTA button to subscribe.', elements: ['heading h2', 'sub-heading', 'button'] },
    { name: 'Final CTA',          align: 'center', bg: 'dark',   role: 'Closing call to action. Restate the #1 outcome, add urgency or scarcity, include a guarantee or risk-reversal statement, strong CTA button.', elements: ['heading h2', 'paragraph', 'button'] },
  ],
  about: [
    { name: 'About Hero',         align: 'center', bg: 'dark',   role: 'Hook headline — NOT "About Us". Lead with who you help and the transformation you create. Subheadline adds the brand story hook.', elements: ['headline h1', 'sub-heading'] },
    { name: 'Our Story',          align: 'left',   bg: 'white',  role: 'Full origin story — the founder\'s personal before/after. What life looked like before, the breaking point, the discovery, and the mission that followed. 3 paragraphs, conversational and honest.', elements: ['heading h2', 'paragraph'] },
    { name: 'Mission & Values',   align: 'left',   bg: 'light',  role: 'What the brand stands for and against. Mission statement in 1 sentence, then 4 core values with a one-line explanation each. Bullet list format.', elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Who We Help',        align: 'left',   bg: 'white',  role: 'Specific description of the ideal client — their situation, struggles, goals. Make the right people feel seen and the wrong people self-select out. 1 paragraph + bullet list of "this is for you if..." points.', elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Credentials',        align: 'left',   bg: 'light',  role: 'Trust signals — years of experience, clients served, certifications, media mentions, awards. Bullet list of specific credibility markers.', elements: ['heading h2', 'bulletList'] },
    { name: 'Social Proof',       align: 'center', bg: 'white',  role: 'Client results and testimonials with names and specific outcomes. 2 paragraphs in testimonial format.', elements: ['heading h2', 'paragraph'] },
    { name: 'Connect CTA',        align: 'center', bg: 'dark',   role: 'Warm invitation to take the next step. Acknowledge they\'ve read about us — now it\'s time to connect. CTA button to book a call or get in touch.', elements: ['heading h2', 'paragraph', 'button'] },
  ],
  services: [
    { name: 'Services Hero',      align: 'center', bg: 'dark',   role: 'Hook headline naming the transformation delivered, not just the service. Subheadline states who it\'s for and the key result.', elements: ['headline h1', 'sub-heading', 'button'] },
    { name: 'Who It\'s For',      align: 'left',   bg: 'white',  role: 'Qualification section — describe exactly who gets the best results. "This is for you if..." bullet list. Makes ideal clients feel called out (in a good way).', elements: ['heading h2', 'bulletList'] },
    { name: 'Core Services',      align: 'left',   bg: 'light',  role: 'Each service with its specific outcome, not just a name. Format: service name as sub-point, followed by what the client gets and the result. 3–5 services as bullets.', elements: ['heading h2', 'bulletList'] },
    { name: 'What Changes',       align: 'left',   bg: 'white',  role: 'Before/after transformation. Left side pain, right side result. Written as "Before working with us... After working with us..." 1 paragraph each + outcome bullets.', elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'How It Works',       align: 'center', bg: 'light',  role: '3-step process showing the journey from enquiry to result. Simple, low-friction. Bullet list: Step 1, Step 2, Step 3 with a one-line description each.', elements: ['heading h2', 'bulletList'] },
    { name: 'Social Proof',       align: 'center', bg: 'white',  role: 'Specific client result story — name, situation, what was done, measurable outcome. 2 paragraphs.', elements: ['heading h2', 'paragraph'] },
    { name: 'FAQ',                align: 'left',   bg: 'light',  role: '4–5 service-specific objection questions. Format as bold Q + honest A. Cover: pricing, timeline, results guarantee, what\'s included, getting started.', elements: ['heading h2', 'paragraph'] },
    { name: 'Book a Call CTA',    align: 'center', bg: 'dark',   role: 'Strong closing CTA. Restate the #1 outcome. Include what happens on the call (no-pressure discovery). CTA button. Guarantee or risk reversal below the button.', elements: ['heading h2', 'paragraph', 'button'] },
  ],
  landing: [
    { name: 'Hero Hook',          align: 'center', bg: 'dark',   role: 'Attention-grabbing H1 — bold specific claim or provocative question that speaks to the #1 desire or fear of the audience. Subheadline narrows who this is for and the promise. CTA button immediately.', elements: ['headline h1', 'sub-heading', 'button'] },
    { name: 'Problem Agitation',  align: 'left',   bg: 'white',  role: 'Twist the knife on the pain. Name the exact struggle, failed attempts, wasted money, and emotional frustration. 2 paragraphs that make them think "this person gets me". End with: "There\'s a better way."', elements: ['heading h2', 'paragraph'] },
    { name: 'Introduce Solution', align: 'center', bg: 'light',  role: 'Present the offer as the clear answer. Name it confidently. Explain the core mechanism — WHY it works when other things haven\'t. 1 paragraph + 4–5 outcome bullets.', elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Social Proof',       align: 'center', bg: 'white',  role: 'Specific result from a real client. Name, situation, exact outcome with numbers. Formatted as a compelling mini case study in 2 paragraphs.', elements: ['heading h2', 'paragraph'] },
    { name: 'What You Get',       align: 'left',   bg: 'light',  role: 'Deliverables list — exactly what\'s included. Each bullet starts with the deliverable name, then its specific benefit. 5–7 bullets. Make the value feel impossible to say no to.', elements: ['heading h2', 'bulletList'] },
    { name: 'Objection Handling', align: 'left',   bg: 'white',  role: '4 FAQ-style objections. Format as bold Q + honest conversational A. Cover: "Is this for me?", "What if it doesn\'t work?", "How much time does it take?", "Why should I trust you?"', elements: ['heading h2', 'paragraph'] },
    { name: 'Guarantee',          align: 'center', bg: 'light',  role: 'Risk reversal — money-back guarantee or results promise. State it confidently. Explain why you can offer it (confidence in the method). 1 paragraph + CTA button.', elements: ['heading h2', 'paragraph', 'button'] },
    { name: 'Final CTA',          align: 'center', bg: 'dark',   role: 'Last chance CTA. Add urgency (limited spots, deadline, bonus). Restate the outcome. Strong button. 1 line of scarcity or social proof below.', elements: ['heading h2', 'paragraph', 'button'] },
  ],
  contact: [
    { name: 'Contact Hero',       align: 'center', bg: 'dark',   role: 'Inviting hook headline — make reaching out feel easy and exciting, not transactional. Subheadline states what happens after they contact you.', elements: ['headline h1', 'sub-heading'] },
    { name: 'Reasons to Connect', align: 'left',   bg: 'white',  role: 'Why get in touch — bullet list of 4–5 specific reasons that speak to what the visitor wants to discuss. Makes it feel relevant to act.', elements: ['heading h2', 'bulletList'] },
    { name: 'Contact Details',    align: 'left',   bg: 'light',  role: 'All contact methods — phone, email, address, social profiles, office hours. Bullet list format, each with icon emoji prefix.', elements: ['heading h2', 'bulletList'] },
    { name: 'What Happens Next',  align: 'left',   bg: 'white',  role: '3-step process showing what happens after they reach out. Reduces anxiety about contacting. Step 1, Step 2, Step 3 bullet list.', elements: ['heading h2', 'bulletList'] },
    { name: 'FAQ',                align: 'left',   bg: 'light',  role: '4 common questions about getting in touch — response time, who responds, what to include in their message, what the first meeting looks like.', elements: ['heading h2', 'paragraph'] },
    { name: 'CTA',                align: 'center', bg: 'dark',   role: 'Warm closing — encourage them to take that first step. Reassure it\'s no-pressure. CTA button.', elements: ['heading h2', 'paragraph', 'button'] },
  ],
  pricing: [
    { name: 'Pricing Hero',       align: 'center', bg: 'dark',   role: 'Confident headline about the value of investing — NOT "our prices". Focus on the outcome they\'re buying. Subheadline: transparent, no hidden fees, here\'s exactly what you get.', elements: ['headline h1', 'sub-heading'] },
    { name: 'Value Statement',    align: 'left',   bg: 'white',  role: 'Before showing prices — remind them WHAT they\'re investing in. The outcome, the transformation, what life looks like after. 1 paragraph + 4 outcome bullets.', elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Plans',              align: 'left',   bg: 'light',  role: '2–3 pricing tiers. For each: plan name, price indicator (starts at X / from X), what\'s included as bullets, who it\'s best for. Format clearly.', elements: ['heading h2', 'bulletList'] },
    { name: 'Everything Included',align: 'left',   bg: 'white',  role: 'Master list of everything clients get regardless of plan. Bullet list format — make the value feel overwhelming in a good way.', elements: ['heading h2', 'bulletList'] },
    { name: 'Guarantee',          align: 'center', bg: 'light',  role: 'Risk reversal — money-back or results guarantee. State confidently. Explain the reasoning. Removes the last barrier to saying yes.', elements: ['heading h2', 'paragraph'] },
    { name: 'FAQ',                align: 'left',   bg: 'white',  role: '5 pricing-specific objections. Bold Q + honest A. Cover: "Is it worth it?", "Can I pay in instalments?", "What if I want to cancel?", "Do prices change?", "What\'s not included?"', elements: ['heading h2', 'paragraph'] },
    { name: 'Get Started CTA',    align: 'center', bg: 'dark',   role: 'Closing CTA. Remind them of the cost of NOT acting. Strong CTA button. Option to book a call if they want to talk first.', elements: ['heading h2', 'paragraph', 'button'] },
  ],
  faq: [
    { name: 'FAQ Hero',           align: 'center', bg: 'dark',   role: 'Headline that validates having questions — normalise the uncertainty. Subheadline: "We\'ve answered the most common ones below."', elements: ['headline h1', 'sub-heading'] },
    { name: 'Getting Started',    align: 'left',   bg: 'white',  role: '4–5 questions about how to begin. Bold Q + detailed honest A. Cover: how to sign up, what to expect first, prerequisites, timeline to results.', elements: ['heading h2', 'paragraph'] },
    { name: 'About the Offer',    align: 'left',   bg: 'light',  role: '4–5 questions about the product/service itself. Bold Q + A. Cover: what\'s included, how it works, who it\'s for, customisation, support.', elements: ['heading h2', 'paragraph'] },
    { name: 'Results & Expectations', align: 'left', bg: 'white', role: '4 questions about outcomes. Bold Q + A. Cover: how long to see results, what results are realistic, what affects results, success stories.', elements: ['heading h2', 'paragraph'] },
    { name: 'Pricing & Policy',   align: 'left',   bg: 'light',  role: '4 questions about cost and policies. Bold Q + A. Cover: pricing, refunds, cancellation, payment options.', elements: ['heading h2', 'paragraph'] },
    { name: 'Still Have Questions', align: 'center', bg: 'dark', role: 'Invitation to reach out for unanswered questions. Warm, personal tone. CTA button to contact or book a call.', elements: ['heading h2', 'paragraph', 'button'] },
  ],
  portfolio: [
    { name: 'Portfolio Hero',     align: 'center', bg: 'dark',   role: 'Hook headline about the results and transformations delivered — lead with outcomes, not "our work". Subheadline: type of clients helped + niche specialty.', elements: ['headline h1', 'sub-heading', 'button'] },
    { name: 'What We Do',         align: 'left',   bg: 'white',  role: 'Brief clear explanation of the service and who it\'s for. Sets context before showing work. 1 paragraph + 4 specialisation bullets.', elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Case Study 1',       align: 'left',   bg: 'light',  role: 'First case study — client type, challenge faced, approach taken, specific measurable result. Written as a mini story: Before → During → After. 2 paragraphs.', elements: ['heading h2', 'paragraph'] },
    { name: 'Case Study 2',       align: 'left',   bg: 'white',  role: 'Second case study — different client type to show range. Same Before → During → After structure. 2 paragraphs.', elements: ['heading h2', 'paragraph'] },
    { name: 'Results by Numbers', align: 'center', bg: 'light',  role: 'Key metrics and results across all clients. Bullet list of specific numbers — averages, totals, records. e.g. "Average 3.2x ROI for ecom clients".', elements: ['heading h2', 'bulletList'] },
    { name: 'Social Proof',       align: 'center', bg: 'white',  role: 'Client testimonials — 2 specific quotes with names and outcomes. 2 paragraphs.', elements: ['heading h2', 'paragraph'] },
    { name: 'Work With Us CTA',   align: 'center', bg: 'dark',   role: 'Invite them to be the next success story. CTA to book a discovery call. Reassure it\'s no-pressure — just a conversation.', elements: ['heading h2', 'paragraph', 'button'] },
  ],
  blog: [
    { name: 'Blog Hero',          align: 'center', bg: 'dark',   role: 'Hook headline about what the reader will learn — frame the blog as a resource that gives them an edge. Subheadline: topics covered + who it\'s written for.', elements: ['headline h1', 'sub-heading'] },
    { name: 'What You\'ll Learn', align: 'left',   bg: 'white',  role: 'Topics and categories covered in the blog. Bullet list of 6–8 specific topic areas that deliver real value. Be specific — not "marketing tips" but "step-by-step Facebook ad strategies for coaches".', elements: ['heading h2', 'bulletList'] },
    { name: 'Why Read This Blog', align: 'left',   bg: 'light',  role: 'Differentiate — what makes this blog different from generic content. Author credibility, practical focus, no-fluff promise. 1 paragraph + 3 differentiation bullets.', elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Newsletter Signup',  align: 'center', bg: 'dark',   role: 'Email list CTA — make the value crystal clear. What they get by subscribing (frequency, type of content, exclusive tips). CTA button: "Send Me the Tips" or similar.', elements: ['heading h2', 'sub-heading', 'button'] },
  ],
  custom: [
    { name: 'Hero Hook',          align: 'center', bg: 'dark',   role: 'Bold hook headline, supporting context subheadline, primary CTA button.', elements: ['headline h1', 'sub-heading', 'button'] },
    { name: 'Core Message',       align: 'left',   bg: 'white',  role: 'Main content — explain the purpose of this page clearly and compellingly. 2 paragraphs + bullet list of key points.', elements: ['heading h2', 'paragraph', 'bulletList'] },
    { name: 'Supporting Detail',  align: 'left',   bg: 'light',  role: 'Additional context, proof, or explanation that supports the core message. 2 paragraphs.', elements: ['heading h2', 'paragraph'] },
    { name: 'Social Proof',       align: 'center', bg: 'white',  role: 'Testimonial or result that validates the core message. 1–2 paragraphs.', elements: ['heading h2', 'paragraph'] },
    { name: 'CTA',                align: 'center', bg: 'dark',   role: 'Clear closing call to action — restate the benefit, CTA button, risk reversal.', elements: ['heading h2', 'paragraph', 'button'] },
  ],
};

// ─── AI: generate native GHL section content ──────────────────────────────────

async function generatePageSections(brief) {
  const { pageName, pageType, websiteName, niche, offer, audience, brand, colorScheme, extraNotes } = brief;
  const plan     = PAGE_SECTION_PLANS[pageType] || PAGE_SECTION_PLANS.custom;
  const provider = await aiService.getProvider();

  const sectionList = plan.map((s, i) =>
    `Section ${i + 1} — "${s.name}" [align: ${s.align}, bg: ${s.bg}]\n  Copy brief: ${s.role}\n  Elements: ${s.elements.join(', ')}`
  ).join('\n\n');

  const system = `You are a world-class direct-response copywriter who writes websites that compel, convert, and connect emotionally. You write like the best of David Ogilvy, Gary Halbert, and Alex Hormozi combined — clear, specific, punchy, and human. Return ONLY valid JSON, no markdown fences, no explanation.`;

  const user = `Write a complete high-converting website page for the brief below. Every section must be written for a REAL human who has real problems, desires, and objections — not generic filler copy.

PAGE: "${pageName}"
PAGE TYPE: ${pageType}
NICHE/INDUSTRY: ${niche || 'the business'}
OFFER/PRODUCT: ${offer || 'their main product or service'}
TARGET AUDIENCE: ${audience || 'ideal customers'}
BRAND NAME: ${brand || 'the business'}
WEBSITE: ${websiteName || 'the website'}
COLOR SCHEME: ${colorScheme || 'professional and modern'}
EXTRA NOTES: ${extraNotes || 'none'}

COPYWRITING RULES — follow these exactly:
1. HOOK: The H1 must stop the scroll. Use a bold claim, provocative question, or surprising stat. Never lead with the company name.
2. SPECIFICITY: No generic copy. Use real industry language, real pain points, real outcomes with numbers where possible.
3. STORY: Where the brief says "story" — write a real before/after narrative. Struggle → discovery → transformation.
4. FAQ: Write actual objections buyers have, not softball questions. Answer honestly without corporate spin.
5. CTAs: Every button must be action + outcome specific. "Book My Free Strategy Call" not "Submit". "Get My Custom Plan" not "Click Here".
6. BULLETS: Each bullet = specific outcome or fact. Maximum 12 words. Start with a strong verb or number.
7. PARAGRAPHS: Short. Max 3 sentences. Use <strong>bold</strong> for the most important phrase in each paragraph.
8. NEWSLETTER: Frame as giving VALUE ("Get weekly tips that...") not asking for something.
9. TEXT ALIGNMENT: Follow the [align] directive per section — centered sections feel bold/impactful, left-aligned sections feel detailed/trustworthy.

SECTIONS TO WRITE:
${sectionList}

RETURN THIS EXACT JSON:
{
  "seoTitle": "Keyword-rich SEO title 50–60 chars exactly",
  "metaDescription": "Compelling meta description 150–160 chars that makes someone click from Google",
  "sections": [
    {
      "name": "Section Name",
      "textAlign": "center",
      "styles": { "backgroundColor": { "value": "#1a1a2e" } },
      "children": [
        { "type": "headline",    "tag": "h1", "text": "Hook headline — bold, specific, stops the scroll", "styles": { "color": { "value": "#ffffff" } } },
        { "type": "sub-heading",              "text": "Clarifying subheadline — who this is for + outcome", "styles": { "color": { "value": "#cbd5e0" } } },
        { "type": "heading",     "tag": "h2", "text": "Section H2 heading",  "styles": { "color": { "value": "#1a202c" } } },
        { "type": "paragraph",                "text": "Body copy with <strong>bold key phrase</strong> — short, punchy, human.", "styles": { "color": { "value": "#4a5568" } } },
        { "type": "bulletList",               "items": ["Specific outcome bullet — verb + result", "Another specific bullet with numbers if possible"], "styles": { "color": { "value": "#4a5568" } } },
        { "type": "button",                   "text": "Action + Outcome CTA Text", "styles": { "backgroundColor": { "value": "#e53e3e" }, "color": { "value": "#ffffff" } } }
      ]
    }
  ]
}

COLOR RULES:
- "dark" bg sections: use a rich dark color matching the brand (navy, charcoal, deep brand color) — white or light text
- "white" bg sections: #ffffff background — dark gray text (#1a202c headings, #4a5568 body)
- "light" bg sections: #F7FAFC or #EDF2F7 background — same dark text as white sections
- Buttons: bright accent color (brand primary, red, orange, or teal) — never gray
- Never use "#primary" — always a real hex code
- Extract brand colors from the color scheme hint if hex codes are provided`;

  const raw    = await aiService.generate(system, user, { maxTokens: 5000 });
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
