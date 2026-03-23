/**
 * src/routes/adsGenerator.js
 *
 * Bulk Ads Generator — Facebook Ads Library (optional) → AI Analysis → Original Ad Set
 *
 * Mounts at /ads — requires x-location-id authentication.
 *
 * AI provider: auto-detected from env (Anthropic → OpenAI → Groq → Google Gemini)
 * FB Ads Library: optional — skipped gracefully if no token configured
 * Images: DALL-E 3 via OpenAI key — skipped gracefully if no key
 *
 * POST /ads/generate
 * Body: {
 *   keywords:       string   required
 *   competitorPage: string   optional — Facebook page ID
 *   countries:      string[] optional — ISO codes, default ["US"]
 *   numVariations:  number   optional — 1–10, default 5
 *   format:         string   optional — "feed"|"story"|"reel"
 *   brandVoice:     string   optional
 *   offer:          string   optional
 *   targetAudience: string   optional
 *   generateImages: boolean  optional — default true
 * }
 */

require('dotenv').config();

const express      = require('express');
const axios        = require('axios');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const toolRegistry = require('../tools/toolRegistry');
const aiService    = require('../services/aiService');

router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripFences(raw) {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

function parseJson(raw) {
  const cleaned = stripFences(raw);
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

// ─── Step 1: Search Facebook Ads Library (optional) ──────────────────────────

async function searchAdsLibrary({ keywords, competitorPage, countries, accessToken, limit = 50 }) {
  const params = {
    access_token:         accessToken,
    ad_type:              'ALL',
    ad_active_status:     'ACTIVE',
    ad_reached_countries: JSON.stringify(countries || ['US']),
    fields: [
      'id', 'page_name', 'ad_creation_time',
      'ad_creative_bodies', 'ad_creative_link_captions',
      'ad_creative_link_descriptions', 'ad_creative_link_titles',
      'spend', 'impressions', 'media_type',
    ].join(','),
    limit,
  };
  if (competitorPage) params.search_page_ids = competitorPage;
  else                params.search_terms     = keywords;

  const resp = await axios.get('https://graph.facebook.com/v20.0/ads_archive', { params });
  return resp.data.data || [];
}

function extractAdCopy(rawAds) {
  return rawAds
    .filter(ad => (ad.ad_creative_bodies || []).some(b => b && b.trim().length > 10))
    .map(ad => ({
      id:          ad.id,
      pageName:    ad.page_name,
      primaryText: (ad.ad_creative_bodies || []).join(' | '),
      headline:    (ad.ad_creative_link_titles || []).join(' | '),
      description: (ad.ad_creative_link_descriptions || []).join(' | '),
      spend:       ad.spend,
      impressions: ad.impressions,
    }));
}

// ─── Tone instruction map ─────────────────────────────────────────────────────

const TONE_INSTRUCTIONS = {
  direct_response: `TONE: Direct Response — Hard-hitting, conversion-focused copy.
- Lead with the biggest benefit or result immediately
- Use power words: "Finally", "Proven", "Guaranteed", "Exclusive", "Limited"
- Every sentence moves the reader closer to clicking
- Be specific: use numbers, timeframes, outcomes
- End with a strong command CTA`,

  emotional: `TONE: Emotional / Empathy-driven copy.
- Start by deeply acknowledging the reader's pain or struggle
- Make them feel SEEN and UNDERSTOOD before pitching anything
- Use "you" language heavily — write like a letter to one person
- Describe the transformation: before state → after state
- Trigger: hope, relief, belonging, love, pride`,

  pas: `TONE: PAS Framework (Problem → Agitate → Solution).
- PROBLEM: Open by naming the exact problem they're experiencing right now
- AGITATE: Twist the knife — make the problem feel urgent, costly, embarrassing
- SOLUTION: Introduce the offer as the clear, logical answer
- Keep each section punchy. Problem: 1 sentence. Agitate: 2-3 sentences. Solution: 1-2 sentences.`,

  storytelling: `TONE: Storytelling / Narrative copy.
- Open with a micro-story: "Sarah was 42, exhausted, and had tried everything..."
- Make the protagonist relatable to the target audience
- Build tension → turning point → resolution (the offer)
- Write in simple, conversational language — like texting a friend
- End the story at the exact moment the offer solved the problem`,

  curiosity: `TONE: Curiosity / Pattern Interrupt copy.
- Open with a bold, unexpected, or counterintuitive statement
- Create an "open loop" the reader MUST close by clicking
- Use: "What if...", "The truth about...", "Why most people fail at...", "The #1 mistake..."
- Tease the answer — never fully reveal it in the ad
- Make them feel they'd be missing something important if they scroll past`,

  social_proof: `TONE: Social Proof / Results-driven copy.
- Lead with a specific result: "847 people lost 20lbs in 60 days using this..."
- Use real-sounding specifics (numbers, timeframes, before/after)
- Name the type of person getting results (makes it relatable)
- Layer proof: stats → testimonial quote → CTA
- Imply: "others are doing this — don't get left behind"`,

  fomo: `TONE: FOMO / Urgency & Scarcity copy.
- Create genuine urgency: limited spots, time-bound offer, price going up
- Describe what they're LOSING by not acting now
- Use countdown language: "Only 12 spots left", "Closes Friday", "Price doubles soon"
- Paint the picture of where they'll be in 6 months if they don't act
- Every line should create forward momentum`,

  educational: `TONE: Educational / Authority copy.
- Position the brand as the expert guide, not the hero
- Open with a valuable insight or little-known fact about the niche
- Teach something useful in 2-3 sentences that builds trust
- Naturally transition: "That's why we built [offer]..."
- Reader should feel smarter after reading — and ready to act`,
};

// ─── Step 2: AI analysis of competitor ads ────────────────────────────────────

async function analyzeAds(ads, keywords, brandContext, tone) {
  const sample = ads.slice(0, 25).map((a, i) =>
    `Ad ${i + 1} [${a.pageName}]:\nPrimary: ${a.primaryText}\nHeadline: ${a.headline}`
  ).join('\n\n---\n\n');

  const system = `You are a world-class Facebook advertising strategist with deep expertise in consumer psychology and conversion copywriting. Return only valid JSON, no markdown.`;

  const user = `Analyze these ${ads.length} active Facebook ads for the niche: "${keywords}".
${brandContext ? `Brand context: ${brandContext}` : ''}
Target tone for our ads: ${tone}

COMPETITOR ADS:
${sample}

Identify the specific psychological triggers, language patterns, and structural elements that make these ads work. Be extremely specific — generic observations are useless.

Return this JSON:
{
  "topHooks": ["5 specific opening lines or hook patterns that appear most effective"],
  "winningAngles": [{"angle":"specific angle name","description":"exactly why this angle works psychologically","example":"direct quote or paraphrase from the ads"}],
  "ctaPatterns": ["specific CTA phrases used, not generic"],
  "emotionalTriggers": ["specific emotional states being targeted"],
  "painPoints": ["specific, concrete pain points mentioned — not generic"],
  "desiredOutcomes": ["specific results/transformations the audience wants"],
  "powerWords": ["high-impact words/phrases appearing in top ads"],
  "recommendedAngles": ["3 angles we should use that competitors are NOT using"],
  "marketSaturation": "low|medium|high",
  "summary": "2-3 sentence strategic analysis with specific differentiation opportunity"
}`;

  const raw = await aiService.generate(system, user, { maxTokens: 2048 });
  return parseJson(raw);
}

// ─── Generate analysis from brief only (no FB data) ──────────────────────────

async function analyzeFromBrief(keywords, offer, targetAudience, brandVoice, tone) {
  const system = `You are a world-class Facebook advertising strategist. Return only valid JSON, no markdown.`;

  const user = `Build a deep strategic ad framework for this offer:

Niche: ${keywords}
Offer: ${offer || 'not specified — infer from niche'}
Audience: ${targetAudience || 'not specified — infer from niche'}
Brand Voice: ${brandVoice || 'to be determined'}
Copy Tone: ${tone}

Think deeply about this specific audience: their daily frustrations, secret desires, what keeps them up at night, what they've already tried that failed, what transformation they're really seeking.

Return this JSON:
{
  "topHooks": ["5 specific, powerful opening lines tailored to this audience"],
  "winningAngles": [{"angle":"name","description":"psychological reason this works for THIS audience","example":"hypothetical example ad opening"}],
  "ctaPatterns": ["3-4 specific CTAs matching the offer type"],
  "emotionalTriggers": ["specific emotional states this audience experiences"],
  "painPoints": ["specific, concrete daily pains — not generic"],
  "desiredOutcomes": ["specific results this audience desperately wants"],
  "powerWords": ["words that resonate strongly with this specific audience"],
  "recommendedAngles": ["3 fresh angles to differentiate from competition"],
  "marketSaturation": "medium",
  "summary": "Strategic positioning and differentiation approach for this offer"
}`;

  const raw = await aiService.generate(system, user, { maxTokens: 2048 });
  return parseJson(raw);
}

// ─── Step 3: Generate one ad variation ───────────────────────────────────────

async function generateAdVariation(index, analysis, brief) {
  const toneInstruction = TONE_INSTRUCTIONS[brief.tone] || TONE_INSTRUCTIONS.direct_response;
  const angle  = analysis.winningAngles?.[index % Math.max(analysis.winningAngles?.length || 1, 1)];
  const hook   = analysis.topHooks?.[index % Math.max(analysis.topHooks?.length || 1, 1)] || '';
  const pain   = (analysis.painPoints || [])[index % Math.max((analysis.painPoints || []).length, 1)] || '';
  const desire = (analysis.desiredOutcomes || [])[index % Math.max((analysis.desiredOutcomes || []).length, 1)] || '';

  const system = `You are one of the world's best Facebook ads copywriters. You write copy that stops the scroll, creates genuine desire, and drives action. Your ads feel human, specific, and impossible to ignore. Return only valid JSON, no markdown.`;

  const user = `Write ONE high-converting Facebook ad. Variation #${index + 1} of ${brief.numVariations}.

━━━ CAMPAIGN BRIEF ━━━
Niche: ${brief.keywords}
Offer: ${brief.offer || 'their core product/service'}
Target Audience: ${brief.targetAudience || 'people interested in ' + brief.keywords}
Ad Format: ${brief.format || 'feed'} ad
Brand Voice: ${brief.brandVoice || 'confident, results-focused'}

━━━ TONE DIRECTIVE ━━━
${toneInstruction}

━━━ THIS VARIATION'S STRATEGY ━━━
Angle to use: ${angle ? `"${angle.angle}" — ${angle.description}` : (analysis.recommendedAngles?.[index % 3] || 'direct results')}
Specific pain point to address: ${pain}
Desired outcome to promise: ${desire}
Hook inspiration (rewrite completely, do NOT copy): ${hook}
Power words to consider: ${(analysis.powerWords || []).slice(0, 5).join(', ')}

━━━ RULES ━━━
1. The hook (first line) must make someone STOP scrolling — be bold, specific, or provocative
2. Write for ONE specific person in the audience — not everyone
3. Be concrete: use numbers, timeframes, specific outcomes wherever possible
4. Sound human — no corporate speak, no buzzwords, no generic phrases
5. This variation must feel COMPLETELY DIFFERENT from the others (different hook style, structure, angle)
6. Follow FTC guidelines — no false claims

Return ONLY this JSON:
{
  "primaryText": "the full ad body — 3-5 punchy sentences with \\n between paragraphs. Hook on line 1.",
  "headline": "powerful headline under 40 characters",
  "description": "supporting line under 30 characters",
  "callToAction": "Book Now|Get Started|Learn More|Shop Now|Sign Up|Claim Offer",
  "hook": "just the opening hook line",
  "angle": "${angle?.angle || 'direct'}",
  "whyItWorks": "1 sentence — the specific psychological reason this ad will resonate"
}`;

  const raw = await aiService.generate(system, user, { maxTokens: 900 });
  return parseJson(raw);
}

// ─── POST /ads/generate ───────────────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const {
    keywords,
    competitorPage,
    countries,
    numVariations  = 8,
    format         = 'feed',
    brandVoice,
    offer,
    targetAudience,
    tone           = 'direct_response',
  } = req.body;

  if (!keywords || !keywords.trim()) {
    return res.status(400).json({ success: false, error: '"keywords" is required.' });
  }

  // ── Detect AI provider ────────────────────────────────────────────────────
  const provider = aiService.getProvider();
  console.log('[Ads] provider:', provider ? `${provider.name} / ${provider.model}` : 'NONE');

  if (!provider) {
    return res.status(400).json({ success: false, error: 'No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, or GOOGLE_API_KEY.' });
  }

  // ── Load per-location configs ─────────────────────────────────────────────
  const configs = await toolRegistry.loadToolConfigs(req.locationId);
  const fbToken = configs.facebook_ads?.accessToken || null;

  console.log('[Ads] locationId:', req.locationId);
  console.log('[Ads] fbToken:', fbToken ? '✓' : '✗ (will skip library search)');

  const n = Math.min(Math.max(parseInt(numVariations) || 5, 1), 10);
  const startAt = Date.now();
  const providerLabel = `${provider.name.charAt(0).toUpperCase() + provider.name.slice(1)} (${provider.model})`;
  const TOTAL_STEPS = 4;

  // ── Setup SSE ─────────────────────────────────────────────────────────────
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    let analysis;
    let libInfo = null;

    if (fbToken) {
      // ── Step 1: Search FB Ads Library ────────────────────────────────────
      send('step', { step: 1, total: TOTAL_STEPS, label: `Searching Facebook Ads Library for "${keywords}"…` });

      const rawAds = await searchAdsLibrary({
        keywords,
        competitorPage: competitorPage || null,
        countries:      countries || ['US'],
        accessToken:    fbToken,
        limit:          50,
      });

      if (!rawAds.length) {
        send('warn', { msg: `No active ads found for "${keywords}" in Facebook Ads Library — generating from brief instead.` });
        send('step', { step: 2, total: TOTAL_STEPS, label: `Building strategy with ${providerLabel}…` });
        analysis = await analyzeFromBrief(keywords, offer, targetAudience, brandVoice, tone);
      } else {
        const structuredAds = extractAdCopy(rawAds);
        libInfo = { total: rawAds.length, analyzed: structuredAds.length };
        send('library_ads', { ...libInfo, ads: structuredAds.slice(0, 20) });

        // ── Step 2: Analyze ───────────────────────────────────────────────
        send('step', { step: 2, total: TOTAL_STEPS, label: `Analyzing ${structuredAds.length} competitor ads with ${providerLabel}…` });
        const brandContext = [
          brandVoice     ? `Voice: ${brandVoice}`     : '',
          offer          ? `Offer: ${offer}`           : '',
          targetAudience ? `Audience: ${targetAudience}` : '',
        ].filter(Boolean).join(' | ');
        analysis = await analyzeAds(structuredAds, keywords, brandContext, tone);
      }
    } else {
      // ── No FB token — skip to brief-based strategy ────────────────────
      send('step', { step: 1, total: TOTAL_STEPS, label: `No Facebook Ads token — building strategy with ${providerLabel}…` });
      analysis = await analyzeFromBrief(keywords, offer, targetAudience, brandVoice, tone);
    }

    send('analysis', analysis);

    // ── Step 3: Generate Copy ─────────────────────────────────────────────
    send('step', { step: 3, total: TOTAL_STEPS, label: `Writing ${n} targeted ${tone} ad variations with ${providerLabel}…` });

    const generatedAds = [];
    const brief = { keywords, offer, targetAudience, brandVoice, tone, format, numVariations: n };

    for (let i = 0; i < n; i++) {
      send('step', { step: 3, total: TOTAL_STEPS, label: `Writing ad variation ${i + 1} of ${n} with ${providerLabel}…` });
      let copy;
      try {
        copy = await generateAdVariation(i, analysis, brief);
      } catch (err) {
        console.warn(`[Ads] variation ${i + 1} parse error:`, err.message);
        copy = {
          primaryText:  `Discover ${keywords} that actually works. Join thousands who've already made the switch.`,
          headline:     `${keywords} — Results Guaranteed`,
          description:  'Limited time offer',
          callToAction: 'Learn More',
          hook:         'Are you still struggling with...',
          angle:        'social proof',
          imagePrompt:  `Professional ${keywords} lifestyle photo, clean background, premium feel`,
          whyItWorks:   'Social proof combined with urgency drives conversions.',
        };
      }
      generatedAds.push({ index: i, copy, imageUrl: null });
      send('ad_copy', { index: i, total: n, copy });
    }

    // ── Done ─────────────────────────────────────────────────────────────
    send('step', { step: TOTAL_STEPS, total: TOTAL_STEPS, label: 'Complete!' });
    send('done', {
      ads:          generatedAds,
      total:        n,
      libraryTotal: libInfo?.total || 0,
      provider:     provider.name,
      model:        provider.model,
      duration:     Math.round((Date.now() - startAt) / 1000),
      analysis,
    });

  } catch (err) {
    console.error('[Ads] generation error:', err.message);
    send('error', { error: err.message });
  }

  res.end();
});

// ─── GET /ads/library — Preview Ads Library ───────────────────────────────────

router.get('/library', async (req, res) => {
  const { keywords, pageId, countries, limit } = req.query;
  if (!keywords && !pageId) return res.status(400).json({ success: false, error: 'Provide keywords or pageId.' });

  const configs = await toolRegistry.loadToolConfigs(req.locationId);
  const fbToken = configs.facebook_ads?.accessToken;
  if (!fbToken) return res.status(400).json({ success: false, error: 'Facebook Ads not configured.' });

  try {
    const raw       = await searchAdsLibrary({ keywords, competitorPage: pageId, countries: countries ? countries.split(',') : ['US'], accessToken: fbToken, limit: parseInt(limit) || 25 });
    const extracted = extractAdCopy(raw);
    res.json({ success: true, total: raw.length, data: extracted });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ─── POST /ads/facebook/sync-leads ───────────────────────────────────────────

router.post('/facebook/sync-leads', async (req, res) => {
  const locationId = req.locationId;
  if (!locationId) return res.status(401).json({ success: false, error: 'Missing locationId.' });

  const configs = await toolRegistry.loadToolConfigs(locationId);
  const { accessToken, adAccountId } = configs.facebook_ads || {};

  if (!accessToken || !adAccountId) {
    return res.status(400).json({ success: false, error: 'Facebook Ads not configured. Add Access Token and Ad Account ID in Settings → Facebook Ads.' });
  }

  const accountId = adAccountId.replace('act_', '');
  let synced = 0, total = 0;
  const errors = [];

  try {
    const formsResp = await axios.get(`https://graph.facebook.com/v20.0/act_${accountId}/leadgen_forms`, {
      params: { access_token: accessToken, fields: 'id,name,status,leads_count', limit: 50 },
    });
    const forms = (formsResp.data.data || []).filter(f => f.status === 'ACTIVE' || !f.status);

    for (const form of forms) {
      try {
        const leadsResp = await axios.get(`https://graph.facebook.com/v20.0/${form.id}/leads`, {
          params: { access_token: accessToken, fields: 'id,created_time,field_data', limit: 100 },
        });
        const leads = leadsResp.data.data || [];
        total += leads.length;

        for (const lead of leads) {
          const fields = {};
          (lead.field_data || []).forEach(f => { fields[f.name] = f.values?.[0] || ''; });
          const firstName = fields.first_name || fields.full_name?.split(' ')[0] || '';
          const lastName  = fields.last_name  || fields.full_name?.split(' ').slice(1).join(' ') || '';
          const email     = fields.email || '';
          const phone     = fields.phone_number || fields.phone || '';
          if (!email && !phone) continue;

          if (req.ghl) {
            try {
              await req.ghl('POST', '/contacts/', { locationId, firstName, lastName, email, phone, source: `Facebook Lead Ads — ${form.name}`, tags: ['fb-lead', 'auto-synced'] });
              synced++;
            } catch (e) {
              if (e.message?.includes('422') || e.message?.includes('duplicate')) synced++;
              else errors.push(`Lead ${lead.id}: ${e.message}`);
            }
          } else {
            synced++;
          }
        }
      } catch (e) {
        errors.push(`Form ${form.id}: ${e.message}`);
      }
    }

    res.json({ success: true, synced, total, forms: forms.length, errors: errors.length ? errors.slice(0, 5) : undefined });
  } catch (err) {
    console.error('[Ads] FB lead sync error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
