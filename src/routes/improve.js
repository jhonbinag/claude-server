/**
 * src/routes/improve.js
 *
 * Self-improvement loop endpoints — inspired by Karpathy/autoresearch pattern:
 *   Fixed scorer (tamper-proof rubric) + mutable artifact + exploit-or-revert.
 *
 * POST /improve/score    — score an artifact (Claude Haiku, fast + cheap)
 * POST /improve/generate — generate one improved variant (Claude Sonnet)
 *
 * Client manages the loop: score → generate → score → keep/discard → repeat.
 * This keeps each call under 10s (Vercel free-tier limit).
 */

const express      = require('express');
const router       = express.Router();
const Anthropic    = require('@anthropic-ai/sdk');
const authenticate = require('../middleware/authenticate');
const toolRegistry = require('../tools/toolRegistry');
const config       = require('../config');

router.use(authenticate);

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

// ── Get Anthropic client for location ────────────────────────────────────────
async function getClient(locationId) {
  const configs = await toolRegistry.loadToolConfigs(locationId);
  const apiKey  = configs.anthropic?.apiKey || config.anthropic?.apiKey;
  if (!apiKey) throw new Error('Anthropic API key not configured. Add it in Settings → Claude AI.');
  return new (Anthropic.default || Anthropic)({ apiKey });
}

// ── POST /improve/score ───────────────────────────────────────────────────────
router.post('/score', async (req, res) => {
  const { type, artifact, context = {} } = req.body;
  if (!SCORERS[type]) return res.status(400).json({ error: `Unknown type: ${type}. Valid: ${Object.keys(SCORERS).join(', ')}` });
  if (!artifact?.trim()) return res.status(400).json({ error: 'artifact is required' });

  try {
    const client = await getClient(req.locationId);

    const userContent = [
      SCORERS[type],
      context.query ? `\nQuery the answer is responding to: "${context.query}"` : '',
      `\nContent to score:\n${artifact}`,
    ].join('');

    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001', // Haiku: fast + cheap for scoring
      max_tokens: 300,
      system:     'You are an expert evaluator. Respond with ONLY valid JSON. No markdown. No preamble.',
      messages:   [{ role: 'user', content: userContent }],
    });

    const raw  = msg.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const data = JSON.parse(raw);
    res.json({ success: true, ...data });
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
${context.query ? `Original query: "${context.query}"` : ''}
${context.agentName ? `Agent name: "${context.agentName}"` : ''}

${ledgerStr}

Current content to improve:
${artifact}`;

  try {
    const client = await getClient(req.locationId);

    const msg = await client.messages.create({
      model:      'claude-sonnet-4-6', // Sonnet: better quality for generation
      max_tokens: 2048,
      system:     IMPROVER_SYSTEM,
      messages:   [{ role: 'user', content: userContent }],
    });

    const raw    = msg.content[0].text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const result = JSON.parse(raw);
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[improve/generate]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
