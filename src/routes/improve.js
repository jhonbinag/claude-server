/**
 * src/routes/improve.js
 *
 * Self-improvement loop endpoints — inspired by Karpathy/autoresearch pattern:
 *   Fixed scorer (tamper-proof rubric) + mutable artifact + exploit-or-revert.
 *
 * POST /improve/score    — score an artifact (fast/cheap model)
 * POST /improve/generate — generate one improved variant (quality model)
 *
 * Automatically uses whichever AI provider is configured for the location:
 *   Anthropic (per-location key → server key) → OpenAI → Groq → Gemini
 *
 * Client manages the loop: score → generate → score → keep/discard → repeat.
 * This keeps each call under 10s (Vercel free-tier limit).
 */

const express      = require('express');
const router       = express.Router();
const Anthropic    = require('@anthropic-ai/sdk');
const https        = require('https');
const authenticate = require('../middleware/authenticate');
const toolRegistry = require('../tools/toolRegistry');
const config       = require('../config');

router.use(authenticate);

// ── Model pairs per provider: fast scorer + quality generator ────────────────
const PROVIDER_MODELS = {
  anthropic: {
    scorer:         'claude-haiku-4-5-20251001',
    generator:      'claude-sonnet-4-6',
    scorerLabel:    'Haiku',
    generatorLabel: 'Sonnet',
  },
  openai: {
    scorer:         'gpt-4o-mini',
    generator:      'gpt-4o',
    scorerLabel:    'GPT-4o mini',
    generatorLabel: 'GPT-4o',
  },
  groq: {
    scorer:         'llama-3.1-8b-instant',
    generator:      process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    scorerLabel:    'Llama 8B',
    generatorLabel: 'Llama 70B',
  },
  gemini: {
    scorer:         'gemini-2.0-flash',
    generator:      process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20',
    scorerLabel:    'Gemini Flash',
    generatorLabel: 'Gemini 2.5',
  },
};

// ── Fixed scorers (tamper-proof — never modified by the improvement loop) ────
// Each returns JSON: {score, breakdown, weakest, feedback}
const SCORERS = {
  ad_copy: `You are a direct-response advertising expert. Score this ad copy 0–100.
Criteria (each 0–20 points):
  hook       — does the opening grab attention in 2 seconds?
  problem    — is the customer's pain or desire clearly stated?
  value      — is the benefit concrete and compelling?
  cta        — is the call to action clear and urgent?
  emotion    — does it connect emotionally with the target audience?
Respond with ONLY valid JSON (no markdown, no extra text):
{"score":0-100,"breakdown":{"hook":0-20,"problem":0-20,"value":0-20,"cta":0-20,"emotion":0-20},"weakest":"criterion_name","feedback":"one specific actionable improvement for the weakest criterion"}`,

  funnel_page: `You are a conversion-rate-optimisation expert. Score this funnel page copy 0–100.
Criteria (each 0–20 points):
  headline   — does the main headline immediately communicate the offer?
  benefits   — are benefits stated before features?
  proof      — are there credible trust signals?
  urgency    — is there a reason to act now?
  flow       — does the copy guide naturally to the CTA?
Respond with ONLY valid JSON:
{"score":0-100,"breakdown":{"headline":0-20,"benefits":0-20,"proof":0-20,"urgency":0-20,"flow":0-20},"weakest":"criterion_name","feedback":"one specific actionable improvement"}`,

  agent_prompt: `You are an AI prompt-engineering expert. Score this agent instruction prompt 0–100.
Criteria (each 0–20 points):
  clarity      — is the task unambiguous?
  context      — does the agent have all needed context?
  format       — is the expected output format specified?
  edges        — are failure modes and edge cases handled?
  conciseness  — is the prompt as short as possible while complete?
Respond with ONLY valid JSON:
{"score":0-100,"breakdown":{"clarity":0-20,"context":0-20,"format":0-20,"edges":0-20,"conciseness":0-20},"weakest":"criterion_name","feedback":"one specific actionable improvement"}`,

  brain_answer: `You are a retrieval-augmented-generation expert. Score this answer against the given query 0–100.
Criteria (each 0–20 points):
  relevance      — does the answer directly address the question?
  completeness   — are all key aspects covered?
  accuracy       — is the answer grounded in context (not hallucinated)?
  clarity        — is the answer clear and well-structured?
  actionability  — does it give actionable information?
Respond with ONLY valid JSON:
{"score":0-100,"breakdown":{"relevance":0-20,"completeness":0-20,"accuracy":0-20,"clarity":0-20,"actionability":0-20},"weakest":"criterion_name","feedback":"one specific actionable improvement"}`,

  manychat_message: `You are a conversational-marketing expert. Score this ManyChat message sequence 0–100.
Criteria (each 0–20 points):
  natural        — does it sound human, not robotic?
  value          — does it deliver immediate value to the subscriber?
  engagement     — does it prompt a response or action?
  sequence       — does each message naturally lead to the next?
  personalization — does it feel personal to the reader?
Respond with ONLY valid JSON:
{"score":0-100,"breakdown":{"natural":0-20,"value":0-20,"engagement":0-20,"sequence":0-20,"personalization":0-20},"weakest":"criterion_name","feedback":"one specific actionable improvement"}`,
};

// ── Improver system prompt ────────────────────────────────────────────────────
const IMPROVER_SYSTEM = `You are a world-class content improvement specialist.
KEY RULES (from the autoresearch principle — simpler is better):
- Make ONE focused change targeting the WEAKEST criterion only
- Prefer simpler, shorter changes that achieve equal or better results
- Do NOT change what is already working well
- Do NOT repeat approaches already tried (check the prior attempts)
Respond with ONLY valid JSON (no markdown, no extra text):
{"improved":"<full improved content>","description":"<one sentence: what changed and why>"}`;

// ── Build ordered list of provider candidates for this location ──────────────
// Priority: per-location Anthropic key → server ANTHROPIC_API_KEY → OpenAI → Groq → Gemini
// Returns an array so callers can fall through on billing/quota failures.
async function getProviderCandidates(locationId) {
  const configs    = await toolRegistry.loadToolConfigs(locationId);
  const candidates = [];
  if (configs.anthropic?.apiKey)  candidates.push({ provider: 'anthropic', apiKey: configs.anthropic.apiKey });
  if (config.anthropic?.apiKey)   candidates.push({ provider: 'anthropic', apiKey: config.anthropic.apiKey });
  if (process.env.OPENAI_API_KEY) candidates.push({ provider: 'openai',    apiKey: process.env.OPENAI_API_KEY });
  if (process.env.GROQ_API_KEY)   candidates.push({ provider: 'groq',      apiKey: process.env.GROQ_API_KEY });
  if (process.env.GOOGLE_API_KEY) candidates.push({ provider: 'gemini',    apiKey: process.env.GOOGLE_API_KEY });

  // Deduplicate same provider+key pairs
  const seen = new Set();
  const unique = candidates.filter(c => {
    const k = `${c.provider}:${c.apiKey}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!unique.length) throw new Error('No AI provider configured. Add an API key in Settings → Integrations → Claude AI.');
  return unique;
}

// Returns true for errors that mean "this provider has no quota/credits" →
// safe to silently skip and try the next provider.
function isBillingError(msg = '') {
  const m = msg.toLowerCase();
  return m.includes('credit') || m.includes('billing') || m.includes('quota') ||
         m.includes('insufficient') || m.includes('balance') || m.includes('rate limit') ||
         m.includes('exceeded') || m.includes('limit exceeded');
}

// Try each candidate in order; skip on billing errors, throw on other errors.
async function callWithFallback(candidates, { modelKey, system, user, maxTokens }) {
  let lastError;
  for (const { provider, apiKey } of candidates) {
    const models = PROVIDER_MODELS[provider];
    try {
      const text = await callAI({ provider, apiKey, model: models[modelKey], system, user, maxTokens });
      return { text, provider, models };
    } catch (e) {
      if (isBillingError(e.message)) {
        console.warn(`[improve] ${provider} billing error — trying next provider. (${e.message.slice(0, 80)})`);
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw new Error(`All configured providers failed. Last error: ${lastError?.message || 'unknown'}`);
}

// ── Simple single-turn text completion (no tool calls) ───────────────────────
async function callAI({ provider, apiKey, model, system, user, maxTokens = 400 }) {
  // Anthropic SDK
  if (provider === 'anthropic') {
    const client = new (Anthropic.default || Anthropic)({ apiKey });
    const msg = await client.messages.create({
      model, max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });
    return msg.content[0].text.trim();
  }

  // OpenAI or Groq (OpenAI-compatible REST)
  if (provider === 'openai' || provider === 'groq') {
    const hostname = provider === 'groq' ? 'api.groq.com' : 'api.openai.com';
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        model, max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
      });
      const req = https.request({
        hostname, path: '/openai/v1/chat/completions', method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${apiKey}`,
        },
      }, resp => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => {
          try {
            const parsed = JSON.parse(d);
            if (resp.statusCode >= 400) return reject(new Error(parsed?.error?.message || `HTTP ${resp.statusCode}`));
            resolve(parsed.choices?.[0]?.message?.content?.trim() || '');
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  // Google Gemini REST
  if (provider === 'gemini') {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      });
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path:     `/v1beta/models/${model}:generateContent?key=${apiKey}`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, resp => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => {
          try {
            const parsed = JSON.parse(d);
            if (resp.statusCode >= 400) return reject(new Error(JSON.stringify(parsed).slice(0, 200)));
            const txt = parsed.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
            resolve(txt.trim());
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

// ── POST /improve/score ───────────────────────────────────────────────────────
router.post('/score', async (req, res) => {
  const { type, artifact, context = {} } = req.body;
  if (!SCORERS[type]) return res.status(400).json({ error: `Unknown type: ${type}. Valid: ${Object.keys(SCORERS).join(', ')}` });
  if (!artifact?.trim()) return res.status(400).json({ error: 'artifact is required' });

  try {
    const candidates = await getProviderCandidates(req.locationId);

    const userContent = [
      SCORERS[type],
      context.query ? `\nQuery the answer is responding to: "${context.query}"` : '',
      `\nContent to score:\n${artifact}`,
    ].join('');

    const { text: raw, provider, models } = await callWithFallback(candidates, {
      modelKey:  'scorer',
      maxTokens: 400,
      system: 'You are an expert evaluator. Respond with ONLY valid JSON. No markdown. No preamble.',
      user:   userContent,
    });

    const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const data  = JSON.parse(clean);
    res.json({
      success: true,
      ...data,
      provider,
      scorerLabel:    models.scorerLabel,
      generatorLabel: models.generatorLabel,
    });
  } catch (e) {
    console.error('[improve/score]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /improve/generate ────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { type, artifact, score, weakest, feedback, ledger = [], context = {} } = req.body;
  if (!artifact?.trim()) return res.status(400).json({ error: 'artifact is required' });

  const typeLabels = {
    ad_copy: 'ad copy', funnel_page: 'funnel page copy',
    agent_prompt: 'agent instruction prompt', brain_answer: 'answer',
    manychat_message: 'ManyChat message sequence',
  };

  const ledgerStr = ledger.length
    ? `Prior attempts (do NOT repeat these — try unexplored angles):\n${ledger.map(e => `  Iter ${e.iteration}: ${e.description} → ${e.newScore}pts (${e.decision})`).join('\n')}`
    : 'No prior attempts yet.';

  const userContent = `Improve this ${typeLabels[type] || 'content'}.
Current score: ${score}/100
Weakest criterion: ${weakest || 'unknown'}
Specific feedback: ${feedback || 'none'}
${context.query      ? `Original query: "${context.query}"` : ''}
${context.agentName  ? `Agent name: "${context.agentName}"` : ''}

${ledgerStr}

Current content to improve:
${artifact}`;

  try {
    const candidates = await getProviderCandidates(req.locationId);

    const { text: raw, provider, models } = await callWithFallback(candidates, {
      modelKey:  'generator',
      maxTokens: 2048,
      system: IMPROVER_SYSTEM,
      user:   userContent,
    });

    const clean  = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const result = JSON.parse(clean);
    res.json({
      success: true,
      ...result,
      provider,
      generatorLabel: models.generatorLabel,
    });
  } catch (e) {
    console.error('[improve/generate]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
