/**
 * src/services/aiService.js
 *
 * Unified AI provider layer — auto-detects which provider is configured:
 *   1. Anthropic  (ANTHROPIC_API_KEY)  → Claude Sonnet 4.6
 *   2. OpenAI     (OPENAI_API_KEY)     → GPT-4o-mini
 *   3. Groq       (GROQ_API_KEY)       → llama-3.1-8b-instant (compact mode, 1500 token cap)
 *   4. Google     (GOOGLE_API_KEY)     → Gemini 2.5 Flash
 *   5. Perplexity (PERPLEXITY_API_KEY) → sonar (8192 tokens)
 *
 * Exports:
 *   getProvider()                         → { name, model }
 *   generate(system, userText, opts)      → string
 *   generateWithVision(system, userText, imageBase64, mimeType, opts) → string
 */

const https  = require('https');
const config = require('../config');

// ── Provider detection ────────────────────────────────────────────────────────

function getProvider() {
  if (process.env.ANTHROPIC_API_KEY) {
    return { name: 'anthropic', model: 'claude-sonnet-4-6', visionModel: 'claude-opus-4-5' };
  }
  if (process.env.OPENAI_API_KEY) {
    return { name: 'openai', model: 'gpt-4o-mini', visionModel: 'gpt-4o' };
  }
  if (process.env.GROQ_API_KEY) {
    const m = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
    return { name: 'groq', model: m, visionModel: 'meta-llama/llama-4-scout-17b-16e-instruct' };
  }
  if (process.env.GOOGLE_API_KEY) {
    const m = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20';
    return { name: 'google', model: m, visionModel: m };
  }
  if (process.env.PERPLEXITY_API_KEY) {
    const m = process.env.PERPLEXITY_MODEL || 'sonar';
    return { name: 'perplexity', model: m, visionModel: m };
  }
  return null;
}

function requireProvider() {
  const p = getProvider();
  if (!p) throw new Error('No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, GOOGLE_API_KEY, or PERPLEXITY_API_KEY.');
  return p;
}

// ── HTTPS helper ──────────────────────────────────────────────────────────────

function parseRetryAfterMs(message = '', headers = {}) {
  const hdr = headers['retry-after'];
  if (hdr) return Math.ceil(parseFloat(hdr)) * 1000 + 300;
  const sec = message.match(/try again in ([\d.]+)s/i);
  if (sec) return Math.ceil(parseFloat(sec[1])) * 1000 + 300;
  const ms  = message.match(/try again in (\d+)ms/i);
  if (ms)  return parseInt(ms[1], 10) + 300;
  return 10000;
}

function httpsPost(hostname, path, headers, body, retries = 4) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } },
      (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', async () => {
          try {
            const parsed = JSON.parse(d);
            if (resp.statusCode === 429 && retries > 0) {
              const wait = parseRetryAfterMs(parsed?.error?.message || '', resp.headers);
              console.warn(`[aiService] 429 from ${hostname} — retrying in ${wait}ms (${retries} left)`);
              await new Promise(r => setTimeout(r, wait));
              httpsPost(hostname, path, headers, body, retries - 1).then(resolve).catch(reject);
            } else if (resp.statusCode >= 400) {
              reject(new Error(`${hostname} returned ${resp.statusCode}: ${JSON.stringify(parsed).slice(0, 300)}`));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`JSON parse error from ${hostname}: ${d.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

async function anthropicGenerate(system, userText, { model, maxTokens = 4096 } = {}) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp      = await client.messages.create({
    model:      model || 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages:   [{ role: 'user', content: userText }],
  });
  return resp.content[0]?.text || '';
}

async function anthropicGenerateWithVision(system, userText, imageBase64, mimeType, { model, maxTokens = 8192 } = {}) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp      = await client.messages.create({
    model:      model || 'claude-opus-4-5',
    max_tokens: maxTokens,
    system,
    messages: [{
      role:    'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
        { type: 'text',  text: userText },
      ],
    }],
  });
  return resp.content[0]?.text || '';
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function openaiGenerate(system, userText, { model, maxTokens = 4096 } = {}) {
  const resp = await httpsPost(
    'api.openai.com',
    '/v1/chat/completions',
    { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model:      model || 'gpt-4o-mini',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: userText },
      ],
    }
  );
  return resp.choices?.[0]?.message?.content || '';
}

async function openaiGenerateWithVision(system, userText, imageBase64, mimeType, { model, maxTokens = 8192 } = {}) {
  const resp = await httpsPost(
    'api.openai.com',
    '/v1/chat/completions',
    { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    {
      model:      model || 'gpt-4o',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        {
          role:    'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            { type: 'text',      text: userText },
          ],
        },
      ],
    }
  );
  return resp.choices?.[0]?.message?.content || '';
}

// ── Groq (OpenAI-compatible) ──────────────────────────────────────────────────

async function groqGenerate(system, userText, { model, maxTokens = 4096 } = {}) {
  const resp = await httpsPost(
    'api.groq.com',
    '/openai/v1/chat/completions',
    { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    {
      model:      model || process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: userText },
      ],
    }
  );
  return resp.choices?.[0]?.message?.content || '';
}

async function groqGenerateWithVision(system, userText, imageBase64, mimeType, { model, maxTokens = 8192 } = {}) {
  const resp = await httpsPost(
    'api.groq.com',
    '/openai/v1/chat/completions',
    { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    {
      model:      model || 'llama-3.2-90b-vision-preview',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        {
          role:    'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            { type: 'text',      text: userText },
          ],
        },
      ],
    }
  );
  return resp.choices?.[0]?.message?.content || '';
}

// ── Google Gemini ─────────────────────────────────────────────────────────────

async function googleGenerate(system, userText, { model, maxTokens = 4096 } = {}) {
  const m    = model || process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20';
  const resp = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/${m}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
    {},
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }
  );
  return resp.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function googleGenerateWithVision(system, userText, imageBase64, mimeType, { model, maxTokens = 8192 } = {}) {
  const m    = model || process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20';
  const resp = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/${m}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
    {},
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{
        role:  'user',
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: userText },
        ],
      }],
      generationConfig: { maxOutputTokens: maxTokens },
    }
  );
  return resp.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── Perplexity (OpenAI-compatible) ────────────────────────────────────────────

async function perplexityGenerate(system, userText, { model, maxTokens = 8192 } = {}) {
  const resp = await httpsPost(
    'api.perplexity.ai',
    '/chat/completions',
    { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` },
    {
      model:      model || process.env.PERPLEXITY_MODEL || 'sonar',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: userText },
      ],
    }
  );
  return resp.choices?.[0]?.message?.content || '';
}

async function perplexityGenerateWithVision(system, userText, imageBase64, mimeType, { model, maxTokens = 8192 } = {}) {
  const resp = await httpsPost(
    'api.perplexity.ai',
    '/chat/completions',
    { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` },
    {
      model:      model || process.env.PERPLEXITY_MODEL || 'sonar',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        {
          role:    'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            { type: 'text',      text: userText },
          ],
        },
      ],
    }
  );
  return resp.choices?.[0]?.message?.content || '';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate text from a system + user prompt.
 * opts.model overrides the default model for the detected provider.
 * opts.maxTokens caps the response length.
 */
async function generate(system, userText, opts = {}) {
  const provider = requireProvider();
  const model    = opts.model || provider.model;
  // Groq: compact mode — 1500 token cap (fast/testing). All other providers: 8192.
  const maxTokens = provider.name === 'groq' ? Math.min(opts.maxTokens || 1500, 1500) : (opts.maxTokens || 8192);

  switch (provider.name) {
    case 'anthropic':  return anthropicGenerate(system, userText, { ...opts, model, maxTokens });
    case 'openai':     return openaiGenerate(system, userText, { ...opts, model, maxTokens });
    case 'groq':       return groqGenerate(system, userText, { ...opts, model, maxTokens });
    case 'google':     return googleGenerate(system, userText, { ...opts, model, maxTokens });
    case 'perplexity': return perplexityGenerate(system, userText, { ...opts, model, maxTokens });
  }
}

/**
 * Generate text from a system prompt + user text + image (base64).
 * Automatically uses the vision-capable model for each provider.
 */
async function generateWithVision(system, userText, imageBase64, mimeType, opts = {}) {
  const provider = requireProvider();
  const model    = opts.model || provider.visionModel;

  switch (provider.name) {
    case 'anthropic':  return anthropicGenerateWithVision(system, userText, imageBase64, mimeType, { ...opts, model });
    case 'openai':     return openaiGenerateWithVision(system, userText, imageBase64, mimeType, { ...opts, model });
    case 'groq':       return groqGenerateWithVision(system, userText, imageBase64, mimeType, { ...opts, model });
    case 'google':     return googleGenerateWithVision(system, userText, imageBase64, mimeType, { ...opts, model });
    case 'perplexity': return perplexityGenerateWithVision(system, userText, imageBase64, mimeType, { ...opts, model });
  }
}

/**
 * Generate using a caller-supplied Anthropic API key (Claude only).
 * Used when the user provides their own key in the UI.
 */
async function generateWithKey(apiKey, system, userText, opts = {}) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey });
  const resp      = await client.messages.create({
    model:      opts.model || 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens || 4096,
    system,
    messages:   [{ role: 'user', content: userText }],
  });
  return resp.content[0]?.text || '';
}

async function generateWithVisionWithKey(apiKey, system, userText, imageBase64, mimeType, opts = {}) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey });

  const reqParams = {
    model:      opts.model || 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens || 8192,
    system,
    messages: [{
      role:    'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
        { type: 'text',  text: userText },
      ],
    }],
  };

  // Enable extended thinking for deep visual analysis when requested
  if (opts.thinking) {
    reqParams.thinking = { type: 'enabled', budget_tokens: opts.thinkingBudget || 8000 };
    reqParams.betas    = ['interleaved-thinking-2025-05-14'];
  }

  const resp = await client.messages.create(reqParams);
  // With thinking enabled, resp.content has mixed thinking/text blocks — return first text block
  const textBlock = resp.content.find(b => b.type === 'text');
  return textBlock?.text || resp.content[0]?.text || '';
}

// ── Per-location AI generation ─────────────────────────────────────────────────
// Loads the key saved via Settings → Integrations for the given locationId.
// Falls back to the platform-level env-var provider if no per-location key found.

function detectKeyProvider(key = '') {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('gsk_'))    return 'groq';
  if (key.startsWith('AIza'))    return 'google';
  if (key.startsWith('sk-'))     return 'openai';
  return null;
}

async function generateWithAnyKey(apiKey, system, userText, opts = {}) {
  const provider = detectKeyProvider(apiKey);
  const maxTokens = opts.maxTokens || 8192;
  if (provider === 'anthropic') {
    return generateWithKey(apiKey, system, userText, { ...opts, maxTokens });
  }
  if (provider === 'openai') {
    const resp = await httpsPost('api.openai.com', '/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}` },
      { model: opts.model || 'gpt-4o-mini', max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userText }] });
    return resp.choices?.[0]?.message?.content || '';
  }
  if (provider === 'groq') {
    const resp = await httpsPost('api.groq.com', '/openai/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}` },
      { model: opts.model || 'llama-3.3-70b-versatile', max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userText }] });
    return resp.choices?.[0]?.message?.content || '';
  }
  if (provider === 'google') {
    const m = opts.model || 'gemini-2.5-flash-preview-05-20';
    const resp = await httpsPost('generativelanguage.googleapis.com',
      `/v1beta/models/${m}:generateContent?key=${apiKey}`, {},
      { systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { maxOutputTokens: maxTokens } });
    return resp.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  // Unknown key format — fall through to env-var provider
  return generate(system, userText, opts);
}

async function generateForLocation(locationId, systemPrompt, userPrompt, opts = {}) {
  if (locationId) {
    let configs = null;
    try {
      const registry = require('../tools/toolRegistry');
      configs = await registry.loadToolConfigs(locationId);
    } catch (err) {
      console.warn(`[aiService] loadToolConfigs failed for ${locationId}:`, err.message);
    }
    if (configs) {
      for (const p of ['anthropic', 'openai', 'groq', 'google']) {
        if (configs?.[p]?.apiKey) {
          console.log(`[aiService] generateForLocation(${locationId}): using stored ${p} key`);
          // Do NOT catch here — if the API call fails, let the error propagate to the caller
          return generateWithAnyKey(configs[p].apiKey, systemPrompt, userPrompt, opts);
        }
      }
    }
  }
  // No per-location key found — fall back to env-var provider
  console.log(`[aiService] generateForLocation(${locationId}): no stored key, using env-var provider (${getProvider()?.name || 'none'})`);
  return generate(systemPrompt, userPrompt, opts);
}

module.exports = { getProvider, generate, generateWithVision, generateWithKey, generateWithVisionWithKey, generateForLocation };
