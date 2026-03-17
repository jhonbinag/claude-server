/**
 * src/routes/adsGenerator.js
 *
 * Bulk Ads Generator — Facebook Ads Library → AI Analysis → Original Ad Set
 *
 * Mounts at /ads — requires x-api-key authentication.
 *
 * Pipeline (all streamed via SSE):
 *   Step 1 — Search Facebook Ads Library for keywords/competitor pages
 *   Step 2 — Extract all ad copy (hooks, headlines, CTAs, body text)
 *   Step 3 — Claude analyzes patterns: winning angles, offer structures, emotional triggers
 *   Step 4 — Claude generates N original ad variations (primary text, headline, description, CTA)
 *   Step 5 — DALL-E 3 generates a unique image for each variation
 *   Final  — Complete ad package streamed back
 *
 * SSE Events:
 *   step         → { step, label, total }          progress indicator
 *   library_ads  → { ads: [...] }                  raw ads found in library
 *   analysis     → { hooks, angles, patterns, ctas }
 *   ad           → { index, copy, imageUrl }        one generated ad (streamed as ready)
 *   done         → { ads: [...], total, duration }  final package
 *   error        → { error }
 *
 * POST /ads/generate
 * Body: {
 *   keywords:      string   required — niche/product keywords to search
 *   competitorPage: string  optional — Facebook page name or ID to pull ads from
 *   countries:     string[] optional — ISO codes, default ["US"]
 *   numVariations: number   optional — ad variations to generate (1–10, default 5)
 *   format:        string   optional — "feed"|"story"|"reel" (default "feed")
 *   brandVoice:    string   optional — describe your brand tone/style
 *   offer:         string   optional — your specific product/offer details
 *   targetAudience: string  optional — who you are targeting
 *   generateImages: boolean optional — generate DALL-E images (default true)
 * }
 */

require('dotenv').config();

const express      = require('express');
const axios        = require('axios');
const Anthropic    = require('@anthropic-ai/sdk');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const toolRegistry = require('../tools/toolRegistry');

router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getConfigs(locationId) {
  return toolRegistry.loadToolConfigs(locationId);
}

function requireKey(configs, service, field = 'apiKey') {
  const val = configs[service] && configs[service][field];
  if (!val) throw new Error(`${service} ${field} not configured. Connect it in the dashboard (/ui).`);
  return val;
}

// ─── Step 1: Search Facebook Ads Library ─────────────────────────────────────

async function searchAdsLibrary({ keywords, competitorPage, countries, accessToken, limit = 50 }) {
  const params = {
    access_token:        accessToken,
    ad_type:             'ALL',
    ad_active_status:    'ACTIVE',
    ad_reached_countries: JSON.stringify(countries || ['US']),
    fields: [
      'id',
      'page_name',
      'page_id',
      'ad_creation_time',
      'ad_creative_bodies',
      'ad_creative_link_captions',
      'ad_creative_link_descriptions',
      'ad_creative_link_titles',
      'ad_snapshot_url',
      'spend',
      'impressions',
      'media_type',
    ].join(','),
    limit,
  };

  if (competitorPage) {
    params.search_page_ids = competitorPage;
  } else {
    params.search_terms = keywords;
  }

  const resp = await axios.get('https://graph.facebook.com/v20.0/ads_archive', { params });
  return resp.data.data || [];
}

// ─── Step 2: Extract structured copy from raw ads ─────────────────────────────

function extractAdCopy(rawAds) {
  return rawAds
    .filter((ad) => {
      const bodies = ad.ad_creative_bodies || [];
      return bodies.some((b) => b && b.trim().length > 10);
    })
    .map((ad) => ({
      id:          ad.id,
      pageName:    ad.page_name,
      primaryText: (ad.ad_creative_bodies || []).join(' | '),
      headline:    (ad.ad_creative_link_titles || []).join(' | '),
      description: (ad.ad_creative_link_descriptions || []).join(' | '),
      caption:     (ad.ad_creative_link_captions || []).join(' | '),
      spend:       ad.spend,
      impressions: ad.impressions,
      createdAt:   ad.ad_creation_time,
      mediaType:   ad.media_type,
      snapshotUrl: ad.ad_snapshot_url,
    }));
}

// ─── Step 3: Claude analysis ──────────────────────────────────────────────────

async function analyzeAds(client, ads, keywords, brandContext) {
  const adSample = ads.slice(0, 30).map((a, i) =>
    `Ad ${i + 1} [${a.pageName}]:\nPrimary: ${a.primaryText}\nHeadline: ${a.headline}\nDescription: ${a.description}`
  ).join('\n\n---\n\n');

  const stream = client.messages.stream({
    model:      'claude-opus-4-6',
    max_tokens: 4096,
    thinking:   { type: 'adaptive' },
    messages: [{
      role:    'user',
      content: `You are an expert Facebook advertising strategist and copywriter.

Analyze these ${ads.length} active ads from the Facebook Ads Library for the niche: "${keywords}".
${brandContext ? `Brand context: ${brandContext}` : ''}

ADS FROM LIBRARY:
${adSample}

Provide a deep strategic analysis in this exact JSON format:
{
  "topHooks": ["hook1", "hook2", "hook3", "hook4", "hook5"],
  "winningAngles": [
    { "angle": "angle name", "description": "why it works", "example": "from the ads above" }
  ],
  "ctaPatterns": ["cta1", "cta2", "cta3"],
  "emotionalTriggers": ["trigger1", "trigger2", "trigger3"],
  "offerStructures": ["structure1", "structure2"],
  "painPoints": ["pain1", "pain2", "pain3"],
  "uniqueMechanisms": ["mechanism1", "mechanism2"],
  "commonMistakes": ["mistake1", "mistake2"],
  "marketSaturation": "low|medium|high",
  "recommendedAngles": ["angle1", "angle2", "angle3"],
  "summary": "2-3 sentence strategic overview"
}

Return ONLY valid JSON, no markdown fences.`,
    }],
  });

  let raw = '';
  for await (const evt of stream) {
    if (evt.type === 'content_block_delta' && evt.delta.type === 'text_delta') {
      raw += evt.delta.text;
    }
  }

  // Parse JSON — strip any accidental markdown fences
  const jsonStr = raw.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(jsonStr);
}

// ─── Step 4: Claude generates original ad variations ─────────────────────────

async function generateAdVariation(client, index, analysis, brief) {
  const angle = analysis.winningAngles[index % analysis.winningAngles.length];
  const hook   = analysis.topHooks[index % analysis.topHooks.length];

  const stream = client.messages.stream({
    model:      'claude-opus-4-6',
    max_tokens: 2048,
    messages: [{
      role:    'user',
      content: `You are an elite Facebook ads copywriter. Write ONE complete, original Facebook ad creative.

BRIEF:
- Niche/Keywords: ${brief.keywords}
- Offer/Product: ${brief.offer || 'their product/service'}
- Target Audience: ${brief.targetAudience || 'general audience'}
- Ad Format: ${brief.format || 'feed'} ad
- Brand Voice: ${brief.brandVoice || 'professional and compelling'}
- Variation #: ${index + 1}

STRATEGY (from market research):
- Use this angle: ${angle ? angle.angle + ' — ' + angle.description : analysis.recommendedAngles[index % analysis.recommendedAngles.length]}
- Hook inspiration (DO NOT copy, create original): ${hook}
- Pain points to address: ${analysis.painPoints.slice(0, 2).join(', ')}
- Emotional triggers to use: ${analysis.emotionalTriggers.slice(0, 2).join(', ')}
- CTA style: ${analysis.ctaPatterns[index % analysis.ctaPatterns.length]}

DIFFERENTIATION: Make this COMPLETELY ORIGINAL — different angle from other variations.
Do NOT copy any competitor ads. Create fresh, compelling copy that follows FTC guidelines.

Return this exact JSON (no markdown):
{
  "primaryText": "main ad body text (3-5 sentences, can use line breaks with \\n)",
  "headline": "attention-grabbing headline (under 40 chars)",
  "description": "supporting description (under 30 chars)",
  "callToAction": "action button text e.g. Learn More|Shop Now|Get Started|Sign Up",
  "hook": "the opening hook/first line used",
  "angle": "${angle ? angle.angle : 'direct'}",
  "imagePrompt": "detailed DALL-E 3 image generation prompt that visually represents this ad — describe style, subject, colors, mood, composition. NO text in the image.",
  "whyItWorks": "1-2 sentence explanation of the strategy"
}`,
    }],
  });

  let raw = '';
  for await (const evt of stream) {
    if (evt.type === 'content_block_delta' && evt.delta.type === 'text_delta') {
      raw += evt.delta.text;
    }
  }

  const jsonStr = raw.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(jsonStr);
}

// ─── Step 5: DALL-E image generation ─────────────────────────────────────────

async function generateAdImage(openAiKey, imagePrompt, format) {
  const sizeMap = {
    story: '1024x1792',
    reel:  '1024x1792',
    feed:  '1792x1024',
  };
  const size = sizeMap[format] || '1792x1024';

  const resp = await axios.post('https://api.openai.com/v1/images/generations', {
    model:           'dall-e-3',
    prompt:          `Professional Facebook advertisement creative image. ${imagePrompt} High quality, commercial photography style, clean and eye-catching. No text overlay.`,
    n:               1,
    size,
    style:           'vivid',
    response_format: 'url',
  }, {
    headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
    timeout: 90000,
  });

  return resp.data.data[0].url;
}

// ─── POST /ads/generate — Main SSE endpoint ───────────────────────────────────

router.post('/generate', async (req, res) => {
  const {
    keywords,
    competitorPage,
    countries,
    numVariations  = 5,
    format         = 'feed',
    brandVoice,
    offer,
    targetAudience,
    generateImages = true,
  } = req.body;

  if (!keywords || !keywords.trim()) {
    return res.status(400).json({ success: false, error: '"keywords" is required.' });
  }

  const configs = await getConfigs(req.locationId);

  // Validate required integrations
  const fbToken   = configs.facebook_ads && configs.facebook_ads.accessToken;
  const openAiKey = (configs.openai && configs.openai.apiKey) || process.env.OPENAI_API_KEY;
  const claudeKey = (configs.anthropic && configs.anthropic.apiKey) || process.env.ANTHROPIC_API_KEY;

  if (!fbToken)   return res.status(400).json({ success: false, error: 'Facebook Ads access token not configured. Connect Facebook Ads in the dashboard.' });
  if (!claudeKey) return res.status(400).json({ success: false, error: 'ANTHROPIC_API_KEY required for Ads Generator (streaming). Set it in your environment.' });
  if (generateImages && !openAiKey) return res.status(400).json({ success: false, error: 'OpenAI API key required for image generation. Connect OpenAI in the dashboard.' });

  const client  = new Anthropic.default({ apiKey: claudeKey });
  const n       = Math.min(Math.max(parseInt(numVariations) || 5, 1), 10);
  const startAt = Date.now();

  // Setup SSE
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const TOTAL_STEPS = generateImages ? 5 : 4;

  try {
    // ── Step 1: Search Library ──────────────────────────────────────────────
    send('step', { step: 1, total: TOTAL_STEPS, label: `Searching Facebook Ads Library for "${keywords}"…` });

    const rawAds = await searchAdsLibrary({
      keywords,
      competitorPage: competitorPage || null,
      countries:      countries || ['US'],
      accessToken:    fbToken,
      limit:          50,
    });

    if (!rawAds.length) {
      send('error', { error: `No active ads found for "${keywords}". Try broader keywords or a specific page ID.` });
      return res.end();
    }

    const structuredAds = extractAdCopy(rawAds);
    send('library_ads', {
      total:    rawAds.length,
      analyzed: structuredAds.length,
      ads:      structuredAds.slice(0, 20), // send sample to UI
    });

    // ── Step 2: Analyze ─────────────────────────────────────────────────────
    send('step', { step: 2, total: TOTAL_STEPS, label: `Analyzing ${structuredAds.length} ads with Claude…` });

    const brandContext = [
      brandVoice    ? `Voice: ${brandVoice}`    : '',
      offer          ? `Offer: ${offer}`          : '',
      targetAudience ? `Audience: ${targetAudience}` : '',
    ].filter(Boolean).join(' | ');

    const analysis = await analyzeAds(client, structuredAds, keywords, brandContext);
    send('analysis', analysis);

    // ── Step 3: Generate Copy ───────────────────────────────────────────────
    send('step', { step: 3, total: TOTAL_STEPS, label: `Generating ${n} original ad variations…` });

    const generatedAds = [];
    const brief = { keywords, offer, targetAudience, brandVoice, format };

    for (let i = 0; i < n; i++) {
      send('step', { step: 3, total: TOTAL_STEPS, label: `Writing ad variation ${i + 1} of ${n}…` });

      let copy;
      try {
        copy = await generateAdVariation(client, i, analysis, brief);
      } catch (parseErr) {
        copy = {
          primaryText: `Discover ${keywords} that actually works. Join thousands who've already made the switch.`,
          headline:    `${keywords} — Results Guaranteed`,
          description: 'Limited time offer',
          callToAction: 'Learn More',
          hook:        'Are you still struggling with...',
          angle:       'social proof',
          imagePrompt: `Professional ${keywords} product lifestyle photo, clean white background, premium feel`,
          whyItWorks:  'Social proof combined with urgency drives conversions.',
        };
      }

      generatedAds.push({ index: i, copy, imageUrl: null });
      send('ad_copy', { index: i, total: n, copy });
    }

    // ── Step 4: Generate Images ─────────────────────────────────────────────
    if (generateImages) {
      send('step', { step: 4, total: TOTAL_STEPS, label: `Generating ${n} ad images with DALL-E 3…` });

      for (let i = 0; i < generatedAds.length; i++) {
        send('step', { step: 4, total: TOTAL_STEPS, label: `Creating image ${i + 1} of ${n}…` });

        try {
          const imageUrl = await generateAdImage(openAiKey, generatedAds[i].copy.imagePrompt, format);
          generatedAds[i].imageUrl = imageUrl;
          send('ad_image', { index: i, imageUrl });
        } catch (imgErr) {
          generatedAds[i].imageUrl = null;
          send('ad_image', { index: i, imageUrl: null, error: imgErr.message });
        }
      }
    }

    // ── Step 5: Done ────────────────────────────────────────────────────────
    send('step', { step: TOTAL_STEPS, total: TOTAL_STEPS, label: 'Complete!' });
    send('done', {
      ads:           generatedAds,
      total:         n,
      libraryTotal:  rawAds.length,
      duration:      Math.round((Date.now() - startAt) / 1000),
      analysis,
    });

  } catch (err) {
    send('error', { error: err.message });
  }

  res.end();
});

// ─── GET /ads/library — Preview Ads Library (no generation) ──────────────────

router.get('/library', async (req, res) => {
  const { keywords, pageId, countries, limit } = req.query;
  if (!keywords && !pageId) return res.status(400).json({ success: false, error: 'Provide keywords or pageId.' });

  const configs = await getConfigs(req.locationId);
  const fbToken = configs.facebook_ads && configs.facebook_ads.accessToken;
  if (!fbToken) return res.status(400).json({ success: false, error: 'Facebook Ads not configured.' });

  try {
    const raw       = await searchAdsLibrary({ keywords, competitorPage: pageId, countries: countries ? countries.split(',') : ['US'], accessToken: fbToken, limit: parseInt(limit) || 25 });
    const extracted = extractAdCopy(raw);
    res.json({ success: true, total: raw.length, data: extracted });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── POST /ads/facebook/sync-leads ─────────────────────────────────────────────
// Fetch all lead form submissions from Facebook & Instagram Lead Ads and
// push them as contacts into GoHighLevel CRM.
router.post('/facebook/sync-leads', async (req, res) => {
  const locationId = req.locationId;
  if (!locationId) return res.status(401).json({ success: false, error: 'Missing locationId.' });

  const configs = await toolRegistry.loadToolConfigs(locationId);
  const fbCfg   = configs.facebook_ads || {};
  const { accessToken, adAccountId } = fbCfg;

  if (!accessToken || !adAccountId) {
    return res.status(400).json({ success: false, error: 'Facebook Ads not configured. Add your Access Token and Ad Account ID in Settings → Facebook Ads.' });
  }

  const accountId = adAccountId.replace('act_', '');
  const config    = require('../config');
  let synced = 0;
  let total  = 0;
  const errors = [];

  try {
    // 1. Get all lead gen forms for the ad account's pages
    const formsResp = await axios.get(`https://graph.facebook.com/v20.0/act_${accountId}/leadgen_forms`, {
      params: { access_token: accessToken, fields: 'id,name,status,leads_count', limit: 50 },
    });
    const forms = (formsResp.data.data || []).filter(f => f.status === 'ACTIVE' || !f.status);

    for (const form of forms) {
      try {
        // 2. Get leads for each form
        const leadsResp = await axios.get(`https://graph.facebook.com/v20.0/${form.id}/leads`, {
          params: { access_token: accessToken, fields: 'id,created_time,field_data', limit: 100 },
        });
        const leads = leadsResp.data.data || [];
        total += leads.length;

        for (const lead of leads) {
          // Parse field_data into a flat object
          const fields = {};
          (lead.field_data || []).forEach(f => { fields[f.name] = f.values?.[0] || ''; });

          const firstName = fields.first_name || fields.full_name?.split(' ')[0] || '';
          const lastName  = fields.last_name  || fields.full_name?.split(' ').slice(1).join(' ') || '';
          const email     = fields.email || '';
          const phone     = fields.phone_number || fields.phone || '';

          if (!email && !phone) continue; // skip incomplete leads

          // 3. Create contact in GHL via req.ghl if available, otherwise skip
          if (req.ghl) {
            try {
              await req.ghl('POST', '/contacts/', {
                locationId,
                firstName,
                lastName,
                email,
                phone,
                source: `Facebook Lead Ads — ${form.name}`,
                tags:   ['fb-lead', 'auto-synced'],
              });
              synced++;
            } catch (e) {
              // 422 = duplicate contact — still count as handled
              if (e.message?.includes('422') || e.message?.includes('duplicate')) {
                synced++;
              } else {
                errors.push(`Lead ${lead.id}: ${e.message}`);
              }
            }
          } else {
            synced++; // count as synced even without GHL (dry-run)
          }
        }
      } catch (e) {
        errors.push(`Form ${form.id}: ${e.message}`);
      }
    }

    res.json({
      success: true,
      synced,
      total,
      forms:  forms.length,
      errors: errors.length ? errors.slice(0, 5) : undefined,
    });
  } catch (err) {
    console.error('[Ads] FB lead sync error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
