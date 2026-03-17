/**
 * src/services/aiService.js
 *
 * Unified AI provider layer — auto-detects which provider is configured:
 *   1. Anthropic (ANTHROPIC_API_KEY)  → Claude Sonnet 4.6
 *   2. OpenAI    (OPENAI_API_KEY)     → GPT-4o-mini
 *   3. Groq      (GROQ_API_KEY)       → llama-3.3-70b-versatile (free tier, fastest)
 *   4. Google    (GOOGLE_API_KEY)     → Gemini 2.5 Flash (free tier)
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
    return { name: 'groq', model: m, visionModel: 'llama-3.2-11b-vision-preview' };
  }
  if (process.env.GOOGLE_API_KEY) {
    const m = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20';
    return { name: 'google', model: m, visionModel: m };
  }
  return null;
}

function requireProvider() {
  const p = getProvider();
  if (!p) throw new Error('No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.');
  return p;
}

// ── HTTPS helper ──────────────────────────────────────────────────────────────

function httpsPost(hostname, path, headers, body, retries = 3) {
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
              // Rate limited — wait and retry with backoff
              const wait = (4 - retries) * 5000; // 5s, 10s, 15s
              console.warn(`[aiService] 429 from ${hostname} — retrying in ${wait / 1000}s (${retries} left)`);
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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate text from a system + user prompt.
 * opts.model overrides the default model for the detected provider.
 * opts.maxTokens caps the response length.
 */
async function generate(system, userText, opts = {}) {
  const provider = requireProvider();
  const model    = opts.model || provider.model;

  switch (provider.name) {
    case 'anthropic': return anthropicGenerate(system, userText, { ...opts, model });
    case 'openai':    return openaiGenerate(system, userText, { ...opts, model });
    case 'groq':      return groqGenerate(system, userText, { ...opts, model });
    case 'google':    return googleGenerate(system, userText, { ...opts, model });
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
    case 'anthropic': return anthropicGenerateWithVision(system, userText, imageBase64, mimeType, { ...opts, model });
    case 'openai':    return openaiGenerateWithVision(system, userText, imageBase64, mimeType, { ...opts, model });
    case 'groq':      return groqGenerateWithVision(system, userText, imageBase64, mimeType, { ...opts, model });
    case 'google':    return googleGenerateWithVision(system, userText, imageBase64, mimeType, { ...opts, model });
  }
}

module.exports = { getProvider, generate, generateWithVision };
