/**
 * src/services/aiService.js
 *
 * Unified AI provider layer — reads provider keys exclusively from Redis/Firebase
 * via toolRegistry.loadToolConfigs(locationId). No env-var fallback.
 *
 * Exports:
 *   generateForLocation(locationId, system, userText, opts)       → string
 *   generateWithVisionForLocation(locationId, system, userText, imageBase64, mimeType, opts) → string
 *   generateWithKey(apiKey, system, userText, opts)               → string  (explicit key)
 *   generateWithVisionWithKey(apiKey, system, userText, b64, mime, opts) → string
 *   generateWithAnyKey(apiKey, system, userText, opts)            → string  (auto-detect provider from key prefix)
 */

const https  = require('https');

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

// ── Provider-specific generators (all accept explicit apiKey) ─────────────────

async function anthropicGenerate(apiKey, system, userText, { model, maxTokens = 4096 } = {}) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey });
  const resp      = await client.messages.create({
    model:      model || 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages:   [{ role: 'user', content: userText }],
  });
  return resp.content[0]?.text || '';
}

async function anthropicGenerateWithVision(apiKey, system, userText, imageBase64, mimeType, { model, maxTokens = 8192 } = {}) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey });
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

async function openaiGenerate(apiKey, system, userText, { model, maxTokens = 4096 } = {}) {
  const resp = await httpsPost(
    'api.openai.com', '/v1/chat/completions',
    { Authorization: `Bearer ${apiKey}` },
    { model: model || 'gpt-4o-mini', max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: userText }] }
  );
  return resp.choices?.[0]?.message?.content || '';
}

async function openaiGenerateWithVision(apiKey, system, userText, imageBase64, mimeType, { model, maxTokens = 8192 } = {}) {
  const resp = await httpsPost(
    'api.openai.com', '/v1/chat/completions',
    { Authorization: `Bearer ${apiKey}` },
    { model: model || 'gpt-4o', max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: 'text', text: userText },
        ]},
      ]}
  );
  return resp.choices?.[0]?.message?.content || '';
}

async function groqGenerate(apiKey, system, userText, { model, maxTokens = 4096 } = {}) {
  const resp = await httpsPost(
    'api.groq.com', '/openai/v1/chat/completions',
    { Authorization: `Bearer ${apiKey}` },
    { model: model || 'llama-3.1-8b-instant', max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: userText }] }
  );
  return resp.choices?.[0]?.message?.content || '';
}

async function groqGenerateWithVision(apiKey, system, userText, imageBase64, mimeType, { model, maxTokens = 8192 } = {}) {
  const resp = await httpsPost(
    'api.groq.com', '/openai/v1/chat/completions',
    { Authorization: `Bearer ${apiKey}` },
    { model: model || 'meta-llama/llama-4-scout-17b-16e-instruct', max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: 'text', text: userText },
        ]},
      ]}
  );
  return resp.choices?.[0]?.message?.content || '';
}

async function googleGenerate(apiKey, system, userText, { model, maxTokens = 4096 } = {}) {
  const m    = model || 'gemini-2.5-flash-preview-05-20';
  const resp = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/${m}:generateContent?key=${apiKey}`,
    {},
    { systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: maxTokens } }
  );
  return resp.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function googleGenerateWithVision(apiKey, system, userText, imageBase64, mimeType, { model, maxTokens = 8192 } = {}) {
  const m    = model || 'gemini-2.5-flash-preview-05-20';
  const resp = await httpsPost(
    'generativelanguage.googleapis.com',
    `/v1beta/models/${m}:generateContent?key=${apiKey}`,
    {},
    { systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType, data: imageBase64 } },
        { text: userText },
      ]}],
      generationConfig: { maxOutputTokens: maxTokens } }
  );
  return resp.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function perplexityGenerate(apiKey, system, userText, { model, maxTokens = 8192 } = {}) {
  const resp = await httpsPost(
    'api.perplexity.ai', '/chat/completions',
    { Authorization: `Bearer ${apiKey}` },
    { model: model || 'sonar', max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: userText }] }
  );
  return resp.choices?.[0]?.message?.content || '';
}

async function perplexityGenerateWithVision(apiKey, system, userText, imageBase64, mimeType, { model, maxTokens = 8192 } = {}) {
  const resp = await httpsPost(
    'api.perplexity.ai', '/chat/completions',
    { Authorization: `Bearer ${apiKey}` },
    { model: model || 'sonar', max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: 'text', text: userText },
        ]},
      ]}
  );
  return resp.choices?.[0]?.message?.content || '';
}

// ── Key-prefix auto-detection ────────────────────────────────────────────────

function detectKeyProvider(key = '') {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('gsk_'))    return 'groq';
  if (key.startsWith('AIza'))    return 'google';
  if (key.startsWith('pplx-'))   return 'perplexity';
  if (key.startsWith('sk-'))     return 'openai';
  return null;
}

// ── Public: explicit key ──────────────────────────────────────────────────────

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
  if (opts.thinking) {
    reqParams.thinking = { type: 'enabled', budget_tokens: opts.thinkingBudget || 8000 };
    reqParams.betas    = ['interleaved-thinking-2025-05-14'];
  }
  const resp = await client.messages.create(reqParams);
  const textBlock = resp.content.find(b => b.type === 'text');
  return textBlock?.text || resp.content[0]?.text || '';
}

async function generateWithAnyKey(apiKey, system, userText, opts = {}) {
  const provider  = detectKeyProvider(apiKey);
  const maxTokens = opts.maxTokens || 8192;
  if (provider === 'anthropic')  return anthropicGenerate(apiKey, system, userText, { ...opts, maxTokens });
  if (provider === 'openai')     return openaiGenerate(apiKey, system, userText, { ...opts, maxTokens });
  if (provider === 'groq')       return groqGenerate(apiKey, system, userText, { ...opts, maxTokens });
  if (provider === 'google')     return googleGenerate(apiKey, system, userText, { ...opts, maxTokens });
  if (provider === 'perplexity') return perplexityGenerate(apiKey, system, userText, { ...opts, maxTokens });
  throw new Error('Unrecognised API key format.');
}

// ── Public: per-location (primary API) ───────────────────────────────────────

const AI_PROVIDERS = ['anthropic', 'openai', 'groq', 'google', 'perplexity'];

async function generateForLocation(locationId, systemPrompt, userPrompt, opts = {}) {
  const registry = require('../tools/toolRegistry');
  let configs = {};
  try { configs = await registry.loadToolConfigs(locationId); } catch (err) {
    console.warn(`[aiService] loadToolConfigs failed for ${locationId}:`, err.message);
  }

  const perLoc = AI_PROVIDERS.find(p => configs[p]?.apiKey);
  if (!perLoc) {
    throw new Error('No AI provider configured. Please add an API key in Settings → Integrations.');
  }

  console.log(`[aiService] generateForLocation(${locationId}): using ${perLoc}`);
  return generateWithAnyKey(configs[perLoc].apiKey, systemPrompt, userPrompt, opts);
}

async function generateWithVisionForLocation(locationId, system, userText, imageBase64, mimeType, opts = {}) {
  const registry = require('../tools/toolRegistry');
  let configs = {};
  try { configs = await registry.loadToolConfigs(locationId); } catch (err) {
    console.warn(`[aiService] loadToolConfigs failed for ${locationId}:`, err.message);
  }

  const perLoc = AI_PROVIDERS.find(p => configs[p]?.apiKey);
  if (!perLoc) {
    throw new Error('No AI provider configured. Please add an API key in Settings → Integrations.');
  }

  const apiKey    = configs[perLoc].apiKey;
  const maxTokens = opts.maxTokens || 8192;
  if (perLoc === 'anthropic')  return anthropicGenerateWithVision(apiKey, system, userText, imageBase64, mimeType, { ...opts, maxTokens });
  if (perLoc === 'openai')     return openaiGenerateWithVision(apiKey, system, userText, imageBase64, mimeType, { ...opts, maxTokens });
  if (perLoc === 'groq')       return groqGenerateWithVision(apiKey, system, userText, imageBase64, mimeType, { ...opts, maxTokens });
  if (perLoc === 'google')     return googleGenerateWithVision(apiKey, system, userText, imageBase64, mimeType, { ...opts, maxTokens });
  throw new Error(`Vision not supported for provider: ${perLoc}`);
}

// ── Shim: callers that pass locationId in opts ────────────────────────────────
// generate(system, userText, { locationId, ...opts }) — locationId required
async function generate(system, userText, opts = {}) {
  const { locationId, ...rest } = opts;
  if (!locationId) throw new Error('[aiService] generate() requires opts.locationId — use generateForLocation() instead.');
  return generateForLocation(locationId, system, userText, rest);
}

async function generateWithVision(system, userText, imageBase64, mimeType, opts = {}) {
  const { locationId, ...rest } = opts;
  if (!locationId) throw new Error('[aiService] generateWithVision() requires opts.locationId — use generateWithVisionForLocation() instead.');
  return generateWithVisionForLocation(locationId, system, userText, imageBase64, mimeType, rest);
}

// Backwards-compat stub — always returns null since env-var providers are removed.
// Guards that check !getProvider() will correctly show "no provider" when location has no key.
function getProvider() { return null; }

module.exports = {
  getProvider,
  generate,
  generateWithVision,
  generateWithKey,
  generateWithVisionWithKey,
  generateWithAnyKey,
  generateForLocation,
  generateWithVisionForLocation,
};
