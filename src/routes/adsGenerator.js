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

// ─── Legendary copywriter personas — rotated across variations ───────────────

const COPYWRITER_PERSONAS = [
  {
    name:  'David Ogilvy',
    style: `Write like Ogilvy: research-backed, factual, treating the reader as an intelligent adult. Headlines carry 80% of the weight — lead with the strongest specific benefit. Use "How to...", "Who else wants...", or numbered promise headlines. Include one surprising specific fact or number. Never be clever at the expense of clarity.`,
  },
  {
    name:  'Gary Halbert',
    style: `Write like Gary Halbert: street-level raw directness. Write to ONE broke person who desperately needs this. Short punchy sentences. Conversational, almost confrontational. No corporate polish. Use "Look..." or "Here's the deal..." energy. Say exactly what other ads dance around. Cut every word that doesn't sell.`,
  },
  {
    name:  'Eugene Schwartz',
    style: `Write like Schwartz: channel the mass desire that ALREADY EXISTS in the market — don't create it, amplify it. Name the unique mechanism ("...using the [specific method] that..."). Match the reader's exact awareness level. Open with the desire, not the product. The offer is the vehicle; the transformation is what they're buying.`,
  },
  {
    name:  'Claude Hopkins',
    style: `Write like Hopkins: specificity is the soul of every claim. Replace every vague word with an exact one — not "fast" but "in 11 days", not "affordable" but "under $47". Give a reason for everything. Prove every claim with a specific detail. Make the reader feel like they are making a logical, safe, well-reasoned decision.`,
  },
  {
    name:  'Joe Sugarman',
    style: `Write like Sugarman: the slippery slope. Every sentence's only job is to make them read the next. Open with a curiosity gap so compelling they can't stop. Use psychological triggers in sequence: curiosity → involvement → desire → urgency. Build unstoppable momentum. The CTA should feel like a relief, not a demand.`,
  },
  {
    name:  'Dan Kennedy',
    style: `Write like Dan Kennedy: NO BS, zero fluff, maximum impact. Call out the target audience in line one. Be brutally honest about their problem — they'll respect you for it. Make an offer so clear and specific it's impossible to misunderstand. Use urgency that is real, not manufactured. Destroy the top 2 objections before they form.`,
  },
  {
    name:  'Gary Bencivenga',
    style: `Write like Bencivenga: combine iron-clad proof with deep emotion. Lead with belief-building evidence (a specific result, a mechanism, a reason why). Then transition to the emotional payoff — what their life actually looks like after. Be the most credible, most believable ad on the feed. Every claim earns trust before asking for action.`,
  },
  {
    name:  'John Caples',
    style: `Write like Caples: use his tested headline formulas. Set up tension then reveal the transformation ("They laughed when I sat down at the piano..."). Lead with pure self-interest in the headline — what the reader gains. Use before/after framing. Keep the copy simple enough for a 12-year-old to understand but compelling enough for a CEO to act on.`,
  },
];

// ─── Tone instruction map ─────────────────────────────────────────────────────

const TONE_INSTRUCTIONS = {
  direct_response: `TONE: Direct Response (Dan Kennedy / Claude Hopkins style)
- Lead immediately with the #1 measurable result or benefit — no warm-up
- Use specific numbers, timeframes, outcomes in every claim
- Power words that trigger action: "Finally", "Proven", "Guaranteed", "Deadline", "Only X left"
- Every sentence must earn its place — if it doesn't move them toward clicking, cut it
- Close with a command CTA that names the exact next step`,

  emotional: `TONE: Emotional / Empathy-driven (Gary Halbert / John Caples style)
- Line 1: make them feel deeply understood — name their exact pain, frustration, or secret desire
- Use "you" language as if writing a personal letter to one specific person
- Describe the full transformation: where they are now → where they'll be after
- Emotional arc: pain → understanding → hope → action
- Triggers: relief, belonging, hope, pride, love — pick one and go deep on it`,

  pas: `TONE: PAS Framework (Eugene Schwartz awareness-level approach)
- PROBLEM (1 sentence): name the exact problem with specificity — make it sting
- AGITATE (2-3 sentences): amplify the cost — emotional, financial, time, social consequences
- SOLUTION (1-2 sentences): introduce the offer as the obvious, inevitable answer
- The problem section should feel so accurate they think you've been reading their diary
- Never agitate without offering a clear solution`,

  storytelling: `TONE: Story-driven (Gary Halbert micro-narrative style)
- Open with a specific person in a specific situation: "Maria, 38, had spent $6,000 on solutions that didn't work..."
- The protagonist must be a mirror of the exact target audience
- Build the tension arc: problem → failed attempts → discovery → transformation
- Use sensory, specific language — not "she felt better" but "she finally slept 8 hours straight"
- Cut the story right where the offer becomes the turning point`,

  curiosity: `TONE: Curiosity / Pattern Interrupt (Joe Sugarman open-loop technique)
- Line 1 must create an open loop the reader's brain CANNOT close without clicking
- Use counterintuitive truth: "The reason most [audience] fail at [goal] isn't what you think..."
- Build intrigue layer by layer — each sentence adds mystery, never resolves it fully
- Use: "What if...", "The real reason...", "Nobody tells you that...", "I had to find out why..."
- The tease must be so specific it feels like insider knowledge`,

  social_proof: `TONE: Social Proof / Results-driven (Gary Bencivenga proof-first approach)
- Lead with a specific, believable result: "1,247 [audience type] used this to [specific outcome] in [timeframe]"
- Specificity = credibility: "847" beats "thousands"; "23 days" beats "quickly"
- Layer proof: aggregate stats → individual transformation → what made it work
- Name the type of person getting results to make the reader identify themselves
- Close with FOMO: others are already getting this result — when do you start?`,

  fomo: `TONE: FOMO / Urgency & Scarcity (Caples tested-urgency formulas)
- Make the urgency REAL — tie it to a deadline, limited quantity, or price change
- Paint the 6-month picture: exactly where they'll be if they act vs. if they don't
- Use specific countdown language: "Only 9 spots at this price", "Closes [day]", "After [date] the price goes to $X"
- What are they LOSING by waiting? Name the exact cost — money, time, opportunity, results
- Every line should feel like a clock ticking`,

  educational: `TONE: Educational / Authority (David Ogilvy research-led approach)
- Open with a genuinely useful insight most people don't know — earns attention immediately
- Position as the expert guide sharing a discovery, not a brand selling a product
- Teach the "why" behind the problem in 2-3 factual sentences — build credibility with specifics
- The transition to the offer should feel natural: "That's why we created [X] — specifically for [audience]"
- Reader should feel measurably smarter after reading and ready to trust the offer`,
};

// ─── Step 2: AI analysis of competitor ads ────────────────────────────────────

async function analyzeAds(ads, keywords, brandContext, tone) {
  const sample = ads.slice(0, 25).map((a, i) =>
    `Ad ${i + 1} [${a.pageName}]:\nPrimary: ${a.primaryText}\nHeadline: ${a.headline}`
  ).join('\n\n---\n\n');

  const system = `You are a world-class Facebook advertising strategist combining Ogilvy's research methodology, Schwartz's awareness framework, and Kennedy's direct-response precision. Return only valid JSON, no markdown.`;

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
  const system = `You are a world-class Facebook advertising strategist combining the research depth of David Ogilvy, Eugene Schwartz's audience awareness framework, and Dan Kennedy's direct-response precision. Return only valid JSON, no markdown.`;

  const user = `Build a deep strategic ad framework for this offer. Think like the best copywriters in history — not a generic marketer.

Niche: ${keywords}
Offer: ${offer || 'not specified — infer from niche'}
Audience: ${targetAudience || 'not specified — infer from niche'}
Brand Voice: ${brandVoice || 'to be determined'}
Copy Tone: ${tone}

Go deep on this specific audience. Think about:
- Their exact daily frustrations (name the specific moments, not categories)
- What they've already tried that failed — and why it failed
- The transformation they're REALLY seeking (the emotion behind the stated goal)
- What they secretly believe is standing in their way
- The exact language they use when they talk about this problem to a friend
- Their awareness level (Schwartz): unaware / problem-aware / solution-aware / product-aware / most-aware

Return this JSON:
{
  "topHooks": ["8 specific, powerful opening lines — vary the style: curiosity, pain, social proof, counterintuitive, story, stats, challenge, desire"],
  "winningAngles": [
    {"angle":"angle name","description":"the exact psychological reason this angle works for THIS audience","example":"specific hypothetical ad opening using this angle"}
  ],
  "ctaPatterns": ["4-5 specific CTAs that match the offer type and audience sophistication"],
  "emotionalTriggers": ["8 specific emotional states — name the exact feeling, not a category"],
  "painPoints": ["8 specific, concrete, daily pains — the kind they feel in their body, not abstract"],
  "desiredOutcomes": ["8 specific results with timeframes or metrics where possible"],
  "powerWords": ["12 words/phrases that resonate deeply with this specific audience"],
  "recommendedAngles": ["4 fresh differentiated angles competitors are NOT likely using"],
  "awarenessLevel": "unaware|problem-aware|solution-aware|product-aware|most-aware",
  "marketSaturation": "low|medium|high",
  "summary": "2-3 sentence strategic positioning: the biggest differentiation opportunity and the #1 angle to lead with"
}`;

  const raw = await aiService.generate(system, user, { maxTokens: 2500 });
  return parseJson(raw);
}

// ─── Step 3: Generate one ad variation ───────────────────────────────────────

async function generateAdVariation(index, analysis, brief) {
  const toneInstruction = TONE_INSTRUCTIONS[brief.tone] || TONE_INSTRUCTIONS.direct_response;
  const persona = COPYWRITER_PERSONAS[index % COPYWRITER_PERSONAS.length];
  const angle   = analysis.winningAngles?.[index % Math.max(analysis.winningAngles?.length || 1, 1)];
  const hook    = analysis.topHooks?.[index % Math.max(analysis.topHooks?.length || 1, 1)] || '';
  const pain    = (analysis.painPoints    || [])[index % Math.max((analysis.painPoints    || []).length, 1)] || '';
  const desire  = (analysis.desiredOutcomes || [])[index % Math.max((analysis.desiredOutcomes || []).length, 1)] || '';
  const recAngle = analysis.recommendedAngles?.[index % Math.max((analysis.recommendedAngles || []).length, 1)] || 'direct results focus';

  const system = `You are channeling the combined mastery of history's greatest copywriters — David Ogilvy, Gary Halbert, Eugene Schwartz, Claude Hopkins, Joe Sugarman, Dan Kennedy, Gary Bencivenga, and John Caples. For this specific variation, your primary voice is ${persona.name}.

${persona.style}

You write Facebook ads that stop the scroll, create genuine desire, and drive real action. Your copy feels human, specific, and impossible to ignore. Return only valid JSON, no markdown fences.`;

  const user = `Write ONE high-converting Facebook ad. Variation #${index + 1} of ${brief.numVariations} — using ${persona.name}'s approach.

━━━ CAMPAIGN BRIEF ━━━
Niche / Product: ${brief.keywords}
Offer: ${brief.offer || 'their core product or service'}
Target Audience: ${brief.targetAudience || 'people interested in ' + brief.keywords}
Ad Format: ${brief.format || 'feed'} ad
Brand Voice: ${brief.brandVoice || 'confident, direct, results-focused'}

━━━ TONE DIRECTIVE ━━━
${toneInstruction}

━━━ THIS VARIATION'S UNIQUE STRATEGY ━━━
Copywriter voice: ${persona.name} — ${persona.style.split('\n')[0]}
Angle: ${angle ? `"${angle.angle}" — ${angle.description}` : recAngle}
Pain point to address: ${pain || 'the core frustration of this audience'}
Desired transformation to promise: ${desire || 'the #1 outcome this audience wants'}
Hook inspiration (do NOT copy — use as direction only): ${hook}
High-impact words for this audience: ${(analysis.powerWords || []).slice(0, 6).join(', ')}

━━━ CRITICAL RULES ━━━
1. HOOK (line 1): Must make someone physically stop scrolling. Be specific, provocative, or counterintuitive. NOT generic.
2. ONE PERSON: Write as if you're talking to one specific person sitting across from you — not a crowd.
3. SPECIFICITY: Every claim needs a specific detail — a number, timeframe, or concrete outcome. Vague = ignored.
4. HUMAN VOICE: Zero corporate speak. No buzzwords. No "revolutionary", "seamless", "cutting-edge". Sound like a real person.
5. UNIQUENESS: This variation must have a completely different structure, hook style, and angle from all other variations.
6. FTC COMPLIANT: No false claims, no guaranteed income/weight loss without disclaimers.

━━━ HEADLINE RULES (most ads fail here) ━━━
- The headline is NOT the hook — it's the value proposition in 5–8 words
- Must contain a clear BENEFIT, NUMBER, or SPECIFIC PROMISE — never just a clever phrase
- Use one of these proven formulas:
  • "How to [specific outcome] Without [pain/cost]"
  • "[Number] [Audience] [Achieved Result] in [Timeframe]"
  • "Finally: [Solution] for [Audience]"
  • "Stop [Pain]. Start [Desire]."
  • "The [Adjective] Way to [Specific Outcome]"
- NEVER use: brand names, "Results Guaranteed", vague superlatives, or generic phrases
- The headline should make someone think "wait — how?" or "that's exactly my problem"

Return ONLY this JSON (no markdown, no explanation):
{
  "primaryText": "full ad body — 4-6 punchy sentences separated by \\n\\n. Hook on line 1. Body builds desire. Close with urgency or clear next step.",
  "headline": "5-8 word benefit-driven headline using a proven formula above",
  "description": "one sharp supporting line that reinforces the headline promise (max 35 chars)",
  "callToAction": "Book Now|Get Started|Learn More|Shop Now|Sign Up|Claim Offer|Watch Now|Download Free",
  "hook": "just the opening hook line verbatim from primaryText",
  "angle": "${angle?.angle || recAngle}",
  "copywriterVoice": "${persona.name}",
  "imagePrompt": "specific DALL-E image prompt — describe the exact scene, mood, subject, lighting, and style that would make this ad visual stop the scroll. Be specific and visual, not generic.",
  "whyItWorks": "1 sentence — the exact psychological mechanism that makes this specific variation resonate with this specific audience"
}`;

  const raw = await aiService.generate(system, user, { maxTokens: 1200 });
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
          primaryText:  `Still struggling with ${keywords}?\n\nYou're not alone — and it's not your fault. Most people never get the result they want because they're missing one critical piece.\n\nWe built this specifically to fix that. No fluff, no guesswork — just a proven path to ${analysis.desiredOutcomes?.[0] || 'real results'}.\n\nSpots are limited. Click below to see if you qualify.`,
          headline:     `How to Finally Get Results With ${keywords}`,
          description:  'See if you qualify today',
          callToAction: 'Get Started',
          hook:         `Still struggling with ${keywords}?`,
          angle:        'problem-agitate-solution',
          copywriterVoice: 'Dan Kennedy',
          imagePrompt:  `A real person experiencing genuine relief and satisfaction related to ${keywords}. Authentic, candid moment. Warm natural lighting. Not stock-photo generic — specific and emotional.`,
          whyItWorks:   'Opens with a qualifying question that resonates with the exact audience, then applies PAS structure to build desire.',
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
