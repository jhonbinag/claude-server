/**
 * src/routes/funnelBuilder.js
 *
 * Mounts at /funnel-builder
 *
 * POST   /funnel-builder/connect       — exchange GHL custom token for Firebase ID token
 * DELETE /funnel-builder/connect       — remove stored Firebase token
 * GET    /funnel-builder/status        — check connection status
 * POST   /funnel-builder/generate      — generate native GHL page JSON via Claude + save to GHL
 */

const express      = require('express');
const router       = express.Router();

// Repair truncated JSON: close open strings, fill dangling keys, close brackets
const { jsonrepair } = require('jsonrepair');

function parseJsonSafe(raw) {
  // Strip markdown code fences
  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*```\s*$/i, '').replace(/\s*```\s*$/i, '').trim();

  // Extract JSON object — from first { to last } (handles leading/trailing text)
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  // Attempt 1: native JSON.parse
  try { return JSON.parse(cleaned); } catch { /* fall through */ }

  // Attempt 2: jsonrepair on extracted JSON
  try { return JSON.parse(jsonrepair(cleaned)); } catch { /* fall through */ }

  // Attempt 3: jsonrepair on fully raw text (re-strip)
  const rawStripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { return JSON.parse(jsonrepair(rawStripped)); } catch { /* fall through */ }

  // All attempts failed — log raw for debugging, then throw descriptive error
  console.error('[parseJsonSafe] All parse attempts failed. Raw AI output (first 600 chars):', raw.slice(0, 600));
  throw new Error(`AI returned non-JSON output. Preview: ${raw.slice(0, 120)}`);
}
const multer       = require('multer');
const aiService    = require('../services/aiService');
const authenticate = require('../middleware/authenticate');
const {
  connectFirebase,
  disconnectFirebase,
  getFirebaseToken,
  getStatus,
} = require('../services/ghlFirebaseService');
const { savePageData, getPageData, convertSectionsToGHL, extractColors } = require('../services/ghlPageBuilder');
const { generateWithKey, generateWithVisionWithKey } = require('../services/aiService');
const { buildPageHtml }             = require('../tools/ghlTools');
const agentStore                    = require('../services/agentStore');
const ghlClient                     = require('../services/ghlClient');
const chroma                        = require('../services/chromaService');
const https                         = require('https');
const { saveToolConfig, getToolConfig } = require('../services/firebaseStore');
const {
  saveFunnelAiKey, getFunnelAiKey, deleteFunnelAiKey,
  saveFigmaToken, getFigmaToken, deleteFigmaToken,
  saveFigmaOAuthState, getFigmaOAuthState,
  saveFigmaOAuthToken, getFigmaOAuthToken, deleteFigmaOAuthToken,
} = require('../services/toolTokenService');

function detectProviderName(key = '') {
  if (key.startsWith('sk-ant-')) return 'claude';
  if (key.startsWith('sk-'))     return 'openai';
  if (key.startsWith('gsk_'))    return 'groq';
  if (key.startsWith('AIza'))    return 'google';
  if (key.startsWith('pplx-'))   return 'perplexity';
  return 'unknown';
}

// Redis → Firebase fallback for the stored AI key
async function loadStoredAiKey(locationId) {
  try {
    const redisKey = await getFunnelAiKey(locationId);
    if (redisKey) return redisKey;
  } catch { /* fall through */ }
  try {
    const configs = await getToolConfig(locationId);
    const fbKey = configs?.funnelBuilderAiKey?.key;
    if (fbKey) {
      // Warm Redis cache
      saveFunnelAiKey(locationId, fbKey).catch(() => {});
      return fbKey;
    }
    // Fall back to centralized AI key saved via Settings → Integrations
    for (const p of ['anthropic', 'openai', 'groq', 'google']) {
      if (configs?.[p]?.apiKey) return configs[p].apiKey;
    }
  } catch { /* fall through */ }
  return null;
}

// ── savePageData wrapper — passes funnelId hint so Firestore read is non-fatal
// Returns generate/generateWithVision functions bound to the user's key (any provider) or server's aiService
// storedKey: pre-loaded from Redis/Firebase (fallback when no header sent)
function resolveAI(req, storedKey) {
  const anthropicKey  = req.headers['x-anthropic-api-key'];
  const openaiKey     = req.headers['x-openai-api-key'];
  const groqKey       = req.headers['x-groq-api-key'];
  const googleKey     = req.headers['x-google-api-key'];
  const perplexityKey = req.headers['x-perplexity-api-key'];

  // If no header provided but we have a stored key, inject it into the right slot
  if (!anthropicKey && !openaiKey && !groqKey && !googleKey && !perplexityKey && storedKey) {
    const prov = detectProviderName ? detectProviderName(storedKey) : '';
    if (prov === 'claude')           req.headers['x-anthropic-api-key']  = storedKey;
    else if (prov === 'openai')      req.headers['x-openai-api-key']     = storedKey;
    else if (prov === 'groq')        req.headers['x-groq-api-key']       = storedKey;
    else if (prov === 'google')      req.headers['x-google-api-key']     = storedKey;
    else if (prov === 'perplexity')  req.headers['x-perplexity-api-key'] = storedKey;
    return resolveAI(req, null); // re-enter without storedKey to pick up header
  }

  if (anthropicKey) {
    return {
      generate:           (sys, usr, opts) => generateWithKey(anthropicKey, sys, usr, opts),
      generateWithVision: (sys, usr, b64, mime, opts) => generateWithVisionWithKey(anthropicKey, sys, usr, b64, mime, opts),
      isUserKey: true, provider: 'anthropic',
    };
  }
  if (openaiKey) {
    // Temporarily override OPENAI_API_KEY env for this request via aiService with forced provider
    const { generate: g, generateWithVision: gv } = require('../services/aiService');
    // Use aiService but force openai calls directly
    const { httpsPostOpenAI } = (() => {
      // inline openai call using the user's key
      const httpsPost = require('https');
      const makeOpenAI = (key, model, vModel) => ({
        generate: (sys, usr, opts = {}) => {
          const payload = JSON.stringify({ model: opts.model || model, max_tokens: opts.maxTokens || 4096, messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] });
          return new Promise((res, rej) => {
            const r = require('https').request({ hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${key}` } }, (resp) => {
              let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { const p = JSON.parse(d); if (resp.statusCode >= 400) rej(new Error(JSON.stringify(p).slice(0, 200))); else res(p.choices?.[0]?.message?.content || ''); } catch(e) { rej(e); } });
            }); r.on('error', rej); r.write(payload); r.end();
          });
        },
        generateWithVision: (sys, usr, b64, mime, opts = {}) => {
          const payload = JSON.stringify({ model: opts.model || vModel, max_tokens: opts.maxTokens || 8192, messages: [{ role: 'system', content: sys }, { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }, { type: 'text', text: usr }] }] });
          return new Promise((res, rej) => {
            const r = require('https').request({ hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${key}` } }, (resp) => {
              let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { const p = JSON.parse(d); if (resp.statusCode >= 400) rej(new Error(JSON.stringify(p).slice(0, 200))); else res(p.choices?.[0]?.message?.content || ''); } catch(e) { rej(e); } });
            }); r.on('error', rej); r.write(payload); r.end();
          });
        },
      });
      return { httpsPostOpenAI: makeOpenAI(openaiKey, 'gpt-4o-mini', 'gpt-4o') };
    })();
    return { ...httpsPostOpenAI, isUserKey: true, provider: 'openai' };
  }
  if (groqKey) {
    const makeGroq = (key) => ({
      generate: (sys, usr, opts = {}) => {
        const model = opts.model || 'llama-3.3-70b-versatile';
        const payload = JSON.stringify({ model, max_tokens: Math.min(opts.maxTokens || 1500, 1500), messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] });
        return new Promise((res, rej) => {
          const r = require('https').request({ hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${key}` } }, (resp) => {
            let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { const p = JSON.parse(d); if (resp.statusCode >= 400) rej(new Error(JSON.stringify(p).slice(0, 200))); else res(p.choices?.[0]?.message?.content || ''); } catch(e) { rej(e); } });
          }); r.on('error', rej); r.write(payload); r.end();
        });
      },
      generateWithVision: (sys, usr, b64, mime, opts = {}) => {
        const model = 'meta-llama/llama-4-scout-17b-16e-instruct';
        const payload = JSON.stringify({ model, max_tokens: opts.maxTokens || 4096, messages: [{ role: 'system', content: sys }, { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }, { type: 'text', text: usr }] }] });
        return new Promise((res, rej) => {
          const r = require('https').request({ hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${key}` } }, (resp) => {
            let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { const p = JSON.parse(d); if (resp.statusCode >= 400) rej(new Error(JSON.stringify(p).slice(0, 200))); else res(p.choices?.[0]?.message?.content || ''); } catch(e) { rej(e); } });
          }); r.on('error', rej); r.write(payload); r.end();
        });
      },
    });
    return { ...makeGroq(groqKey), isUserKey: true, provider: 'groq' };
  }
  if (googleKey) {
    const makeGoogle = (key) => ({
      generate: (sys, usr, opts = {}) => {
        const m = opts.model || 'gemini-2.5-flash-preview-05-20';
        const payload = JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: usr }] }], generationConfig: { maxOutputTokens: opts.maxTokens || 8192 } });
        return new Promise((res, rej) => {
          const r = require('https').request({ hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/${m}:generateContent?key=${key}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (resp) => {
            let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { const p = JSON.parse(d); if (resp.statusCode >= 400) rej(new Error(JSON.stringify(p).slice(0, 200))); else res(p.candidates?.[0]?.content?.parts?.[0]?.text || ''); } catch(e) { rej(e); } });
          }); r.on('error', rej); r.write(payload); r.end();
        });
      },
      generateWithVision: (sys, usr, b64, mime, opts = {}) => {
        const m = opts.model || 'gemini-2.5-flash-preview-05-20';
        const payload = JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: b64 } }, { text: usr }] }], generationConfig: { maxOutputTokens: opts.maxTokens || 8192 } });
        return new Promise((res, rej) => {
          const r = require('https').request({ hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/${m}:generateContent?key=${key}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (resp) => {
            let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { const p = JSON.parse(d); if (resp.statusCode >= 400) rej(new Error(JSON.stringify(p).slice(0, 200))); else res(p.candidates?.[0]?.content?.parts?.[0]?.text || ''); } catch(e) { rej(e); } });
          }); r.on('error', rej); r.write(payload); r.end();
        });
      },
    });
    return { ...makeGoogle(googleKey), isUserKey: true, provider: 'google' };
  }
  if (perplexityKey) {
    const makePerplexity = (key) => ({
      generate: (sys, usr, opts = {}) => {
        const model = opts.model || 'sonar';
        const payload = JSON.stringify({ model, max_tokens: opts.maxTokens || 8192, messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] });
        return new Promise((res, rej) => {
          const r = require('https').request({ hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${key}` } }, (resp) => {
            let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { const p = JSON.parse(d); if (resp.statusCode >= 400) rej(new Error(JSON.stringify(p).slice(0, 200))); else res(p.choices?.[0]?.message?.content || ''); } catch(e) { rej(e); } });
          }); r.on('error', rej); r.write(payload); r.end();
        });
      },
      generateWithVision: (sys, usr, b64, mime, opts = {}) => {
        const model = opts.model || 'sonar';
        const payload = JSON.stringify({ model, max_tokens: opts.maxTokens || 8192, messages: [{ role: 'system', content: sys }, { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }, { type: 'text', text: usr }] }] });
        return new Promise((res, rej) => {
          const r = require('https').request({ hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${key}` } }, (resp) => {
            let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { const p = JSON.parse(d); if (resp.statusCode >= 400) rej(new Error(JSON.stringify(p).slice(0, 200))); else res(p.choices?.[0]?.message?.content || ''); } catch(e) { rej(e); } });
          }); r.on('error', rej); r.write(payload); r.end();
        });
      },
    });
    return { ...makePerplexity(perplexityKey), isUserKey: true, provider: 'perplexity' };
  }

  return {
    generate:           aiService.generate.bind(aiService),
    generateWithVision: aiService.generateWithVision.bind(aiService),
    isUserKey: false, provider: aiService.getProvider()?.name || 'server',
  };
}

function saveWithFunnelHint(locationId, pageId, pageJson, funnelId, colorScheme, extraHints = {}) {
  return savePageData(locationId, pageId, pageJson, {
    ...(funnelId    ? { funnelId }    : {}),
    ...(colorScheme ? { colorScheme } : {}),
    ...extraHints,
  });
}

// Multer: store in memory (we only need the buffer for base64)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPG, WEBP, or GIF images are accepted.'));
  },
});

router.use(authenticate);

// ── Probe GHL backend for a Firebase custom token ────────────────────────────
// Try candidate paths in order; return first one that yields a token field.

function probeCustomToken(accessToken, locationId) {
  const candidates = [
    // Observed in GHL network traffic — try most likely first
    { hostname: 'backend.leadconnectorhq.com', path: `/user/firebase-custom-token?locationId=${encodeURIComponent(locationId)}` },
    { hostname: 'backend.leadconnectorhq.com', path: `/user/customToken?locationId=${encodeURIComponent(locationId)}` },
    { hostname: 'backend.leadconnectorhq.com', path: `/firebase/customToken?locationId=${encodeURIComponent(locationId)}` },
    { hostname: 'services.leadconnectorhq.com', path: `/oauth/firebase-token?locationId=${encodeURIComponent(locationId)}` },
  ];

  const tryNext = (i) => new Promise((resolve, reject) => {
    if (i >= candidates.length) {
      return reject(new Error('All Firebase token endpoints exhausted — none returned a token.'));
    }
    const { hostname, path } = candidates[i];
    const req2 = https.request(
      {
        hostname,
        path,
        method:  'GET',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          channel:        'APP',
          source:         'WEB_USER',
          version:        '2021-07-28',
        },
      },
      (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => {
          console.log(`[FunnelBuilder] probe ${hostname}${path} → ${resp.statusCode}: ${d.slice(0, 300)}`);
          try {
            const parsed = JSON.parse(d);
            const token = parsed.token || parsed.customToken || parsed.firebaseToken
                       || parsed.firebase_token || parsed.firebaseCustomToken;
            if (token && resp.statusCode < 400) resolve(token);
            else tryNext(i + 1).then(resolve).catch(reject);
          } catch {
            tryNext(i + 1).then(resolve).catch(reject);
          }
        });
      }
    );
    req2.on('error', () => tryNext(i + 1).then(resolve).catch(reject));
    req2.end();
  });

  return tryNext(0);
}

// ── POST /auto-connect — get Firebase token using stored GHL OAuth token ───────

router.post('/auto-connect', async (req, res) => {
  try {
    // Already connected and fresh? Return early
    const existing = await getStatus(req.locationId);
    if (existing.connected && existing.expiresAt > Date.now() + 60_000) {
      return res.json({ success: true, alreadyConnected: true, expiresAt: existing.expiresAt });
    }

    const accessToken = await ghlClient.getValidAccessToken(req.locationId);
    const customToken = await probeCustomToken(accessToken, req.locationId);

    const record = await connectFirebase(req.locationId, customToken);
    console.log(`[FunnelBuilder] Auto-connected Firebase for location ${req.locationId}`);

    res.json({
      success:   true,
      message:   'Firebase auto-connected using GHL OAuth token.',
      expiresAt: record.expiresAt,
    });
  } catch (err) {
    console.error('[FunnelBuilder] auto-connect error:', err.message);
    res.status(400).json({
      success: false,
      error:   err.message,
      hint:    'Auto-connect failed. Paste your refreshedToken manually in the Funnel Builder page.',
    });
  }
});

// ── POST /connect — exchange refreshedToken for Firebase tokens ───────────────

router.post('/connect', async (req, res) => {
  const { refreshedToken } = req.body;
  if (!refreshedToken) {
    return res.status(400).json({ success: false, error: '"refreshedToken" is required.' });
  }

  try {
    const record = await connectFirebase(req.locationId, refreshedToken);
    res.json({
      success:   true,
      message:   'Firebase connected successfully.',
      expiresAt: record.expiresAt,
    });
  } catch (err) {
    console.error('[FunnelBuilder] connect error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── DELETE /connect — remove stored Firebase token ───────────────────────────

router.delete('/connect', async (req, res) => {
  try {
    await disconnectFirebase(req.locationId);
    res.json({ success: true, message: 'Firebase disconnected.' });
  } catch (err) {
    console.error('[FunnelBuilder] disconnect error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /inspect-page — read raw Firestore doc + sub-collections for a page ──
// Usage: GET /funnel-builder/inspect-page?pageId=xxx
// Returns the raw Firestore document + tries to read sub-collection docs so
// we can see exactly where GHL stores page sections.

router.get('/inspect-page', async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '"pageId" query param required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  const https       = require('https');
  const projectId   = 'highlevel-backend';
  const authHeader  = { 'Authorization': `Bearer ${idToken}` };

  const get = (hostname, path) => new Promise((resolve) => {
    const req2 = https.request({ hostname, path, method: 'GET', headers: authHeader }, (r) => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, data: d }); }
      });
    });
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.end();
  });

  const base = `/v1/projects/${projectId}/databases/(default)/documents`;

  const [mainDoc, subSections, subContent, rtdb] = await Promise.all([
    get('firestore.googleapis.com', `${base}/funnel_pages/${pageId}`),
    get('firestore.googleapis.com', `${base}/funnel_pages/${pageId}/sections?pageSize=5`),
    get('firestore.googleapis.com', `${base}/funnel_pages/${pageId}/content?pageSize=5`),
    get(`${projectId}-default-rtdb.firebaseio.com`, `/funnel_pages/${pageId}.json?shallow=true`),
  ]);

  // Also try to write a minimal section document to the sub-collection
  const testSectionDoc = JSON.stringify({
    fields: {
      id:   { stringValue: 'section-probe-test' },
      type: { stringValue: 'section' },
      name: { stringValue: 'probe' },
    },
  });
  const subWriteRes = await new Promise(resolve => {
    const subPath = `${base}/funnel_pages/${pageId}/sections`;
    const req2    = https.request(
      { hostname: 'firestore.googleapis.com', path: subPath, method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(testSectionDoc) } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d.slice(0, 200) }); } }); }
    );
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.write(testSectionDoc);
    req2.end();
  });

  res.json({
    mainDoc:     {
      status: mainDoc.status,
      fields: mainDoc.data?.fields ? Object.keys(mainDoc.data.fields) : mainDoc.data,
      sectionsPresent: !!mainDoc.data?.fields?.sections,
      rawSectionsSample: mainDoc.data?.fields?.sections
        ? JSON.stringify(mainDoc.data.fields.sections).slice(0, 500)
        : null,
    },
    subSections: { status: subSections.status, data: subSections.data },
    subContent:  { status: subContent.status,  data: subContent.data },
    rtdb:        { status: rtdb.status,        data: rtdb.data },
    // Write probe — can we write to the sub-collection?
    subCollectionWriteProbe: { status: subWriteRes.status, data: subWriteRes.data },
  });
});

// ── GET /read-storage — download actual Storage file for a page (debug) ───────
// Usage: GET /funnel-builder/read-storage?pageId=xxx
// Downloads the page JSON from Firebase Storage so we can see exactly what
// GHL's own AI saves vs what we're writing.

router.get('/read-storage', async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '"pageId" query param required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  const { readFirestoreDoc, downloadStorageFile } = (() => {
    // Re-use helpers from ghlPageBuilder
    const builder = require('../services/ghlPageBuilder');
    return builder;
  })();

  // Read Firestore to get the download URL
  const https     = require('https');
  const projectId = 'highlevel-backend';

  const firestoreGet = (path) => new Promise((resolve) => {
    const req2 = https.request(
      { hostname: 'firestore.googleapis.com', path, method: 'GET', headers: { Authorization: `Bearer ${idToken}` } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d }); } }); }
    );
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.end();
  });

  const docPath = `/v1/projects/${projectId}/databases/(default)/documents/funnel_pages/${pageId}`;
  const docRes  = await firestoreGet(docPath);

  if (docRes.status >= 400) {
    return res.status(docRes.status).json({ error: 'Firestore read failed', detail: docRes.data });
  }

  const fields      = docRes.data?.fields || {};
  const downloadUrl = fields.page_data_download_url?.stringValue;
  const vhValues    = fields.versionHistory?.arrayValue?.values || [];
  const vhUrl       = vhValues[0]?.mapValue?.fields?.page_download_url?.stringValue;

  if (!downloadUrl && !vhUrl) {
    return res.json({
      message: 'No storage URL found in Firestore document — page has never been saved.',
      firestoreFields: Object.keys(fields),
    });
  }

  // Download the actual Storage file
  const url     = downloadUrl || vhUrl;
  const httpsGet = (urlStr) => new Promise((resolve) => {
    const u   = new URL(urlStr);
    const req2 = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: {} },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d }); } }); }
    );
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.end();
  });

  const fileRes = await httpsGet(url);

  res.json({
    storageUrl:      url,
    storageStatus:   fileRes.status,
    // Top-level keys in the file
    topLevelKeys:    typeof fileRes.data === 'object' ? Object.keys(fileRes.data) : null,
    // Full raw file (may be large)
    rawFile:         fileRes.data,
  });
});

// ── GET /status — check whether Firebase token exists + expiry ────────────────

router.get('/status', async (req, res) => {
  try {
    const status = await getStatus(req.locationId);
    res.json({ success: true, ...status });
  } catch (err) {
    console.error('[FunnelBuilder] status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Figma API helpers ─────────────────────────────────────────────────────────

function httpsPostForm(hostname, path, headers, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req = https.request(
      { hostname, path, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...headers } },
      (resp) => {
        let d = ''; resp.on('data', c => d += c);
        resp.on('end', () => {
          try {
            if (resp.statusCode >= 400) return reject(new Error(`${hostname} ${resp.statusCode}: ${d.slice(0, 300)}`));
            resolve(JSON.parse(d));
          } catch (e) { reject(new Error(`JSON parse error: ${d.slice(0, 200)}`)); }
        });
      }
    );
    req.on('error', reject); req.write(body); req.end();
  });
}

function httpsGet(hostname, path, headers = {}, retries = 3) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers: { 'Content-Type': 'application/json', ...headers } },
      (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', async () => {
          try {
            if (resp.statusCode === 429 && retries > 0) {
              const retryAfter = parseInt(resp.headers['retry-after'] || '10', 10);
              const wait = (retryAfter || 10) * 1000;
              console.warn(`[FunnelBuilder] Figma 429 — retrying in ${wait}ms (${retries} left)`);
              await new Promise(r => setTimeout(r, wait));
              return httpsGet(hostname, path, headers, retries - 1).then(resolve).catch(reject);
            }
            if (resp.statusCode >= 400) return reject(new Error(`${hostname} ${resp.statusCode}: ${d.slice(0, 300)}`));
            resolve(JSON.parse(d));
          } catch (e) { reject(new Error(`JSON parse error from ${hostname}: ${d.slice(0, 200)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    mod.get(url, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        return downloadUrl(resp.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve(Buffer.concat(chunks)));
      resp.on('error', reject);
    }).on('error', reject);
  });
}

function parseFigmaUrl(url) {
  const match = url.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('Invalid Figma URL — expected https://www.figma.com/file/... or /design/...');
  const fileKey = match[1];
  const rawNodeId = new URL(url).searchParams.get('node-id') || '';
  // Figma URLs use - separator (e.g. 1-2), API uses : (e.g. 1:2)
  const nodeId = rawNodeId.replace(/-/g, ':');
  return { fileKey, nodeId };
}

/**
 * Verify PAT is valid — returns true if valid, false if definitively unauthorized (401).
 * Any other error (network, 403 scope, etc.) is treated as "probably fine, proceed".
 */
async function figmaVerifyPat(authHeader) {
  return new Promise((resolve) => {
    const https2 = require('https');
    const headers = { 'Content-Type': 'application/json', ...authHeader };
    const req = https2.request(
      { hostname: 'api.figma.com', path: '/v1/me', method: 'GET', headers },
      (resp) => {
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => {
          if (resp.statusCode === 401) return resolve(false); // definitely invalid
          resolve(true); // 200, 403 scope, etc. — treat as valid, let file call handle access
        });
      }
    );
    req.on('error', () => resolve(true)); // network error — don't block, proceed
    req.end();
  });
}

/**
 * Auto-discover the first frame node in a Figma file.
 * Used when the URL has no ?node-id parameter.
 */
async function figmaFirstFrameNodeId(fileKey, authHeader) {
  const data = await httpsGet('api.figma.com', `/v1/files/${fileKey}?depth=2`, authHeader);
  const pages = data.document?.children || [];
  for (const page of pages) {
    for (const child of (page.children || [])) {
      if (child.type === 'FRAME' || child.type === 'COMPONENT' || child.type === 'GROUP') {
        return child.id;
      }
    }
  }
  throw new Error('No frames found in this Figma file. Make sure the file has at least one frame on a page.');
}

/**
 * Get ALL top-level frames from a Figma file, in order.
 * Each frame represents one page/screen in the design.
 * Returns: [{ id, name, pageName }]
 */
async function figmaGetAllFrames(fileKey, authHeader) {
  const data = await httpsGet('api.figma.com', `/v1/files/${fileKey}?depth=2`, authHeader);
  const docPages = data.document?.children || [];
  const frames = [];
  for (const page of docPages) {
    for (const child of (page.children || [])) {
      if (child.type === 'FRAME' || child.type === 'COMPONENT' || child.type === 'GROUP') {
        frames.push({ id: child.id, name: child.name, pageName: page.name });
      }
    }
  }
  return frames;
}

async function figmaExportImage(fileKey, nodeId, authHeader) {
  const data = await httpsGet(
    'api.figma.com',
    `/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=1`,
    authHeader
  );
  if (data.err) throw new Error(`Figma export error: ${data.err}`);
  const imageUrl = data.images?.[nodeId];
  if (!imageUrl) throw new Error(`No image returned for node "${nodeId}". Try right-clicking a frame in Figma → Copy link to selection.`);
  const buffer = await downloadUrl(imageUrl);
  return { base64: buffer.toString('base64'), mimeType: 'image/png' };
}

/**
 * Batch-export multiple Figma nodes as PNG and download their buffers.
 * Returns a map: nodeId → { buffer, name }
 */
async function figmaBatchExportImages(fileKey, imageNodes, authHeader) {
  if (!imageNodes.length) return {};
  // Figma allows up to ~20 IDs per call; batch in groups of 20
  const results = {};
  const chunks = [];
  for (let i = 0; i < imageNodes.length; i += 20) chunks.push(imageNodes.slice(i, i + 20));

  for (const chunk of chunks) {
    const ids = chunk.map(n => n.nodeId).join(',');
    try {
      const data = await httpsGet(
        'api.figma.com',
        `/v1/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=1`,
        authHeader
      );
      if (data.err) { console.warn('[FunnelBuilder] Figma batch export error:', data.err); continue; }
      for (const node of chunk) {
        const url = data.images?.[node.nodeId];
        if (!url) continue;
        try {
          const buf = await downloadUrl(url);
          results[node.nodeId] = { buffer: buf, name: node.name };
        } catch (e) {
          console.warn(`[FunnelBuilder] Failed to download Figma image ${node.nodeId}:`, e.message);
        }
      }
    } catch (e) {
      console.warn('[FunnelBuilder] Figma batch export chunk error:', e.message);
    }
  }
  return results;
}

/**
 * Upload an image buffer to GHL media library.
 * Returns the hosted URL, or null on failure.
 */
async function uploadImageToGHL(locationId, buffer, filename) {
  try {
    const FormData = require('form-data');
    const axios    = require('axios');
    const token    = await ghlClient.getValidAccessToken(locationId);

    const form = new FormData();
    form.append('file', buffer, { filename, contentType: 'image/png' });
    form.append('locationId', locationId);
    form.append('fileAltText', filename.replace(/\.png$/, '').replace(/-/g, ' '));

    const resp = await axios.post(
      'https://services.leadconnectorhq.com/medias/upload-file',
      form,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: '2021-07-28',
          ...form.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength:    Infinity,
      }
    );
    const url = resp.data?.uploadedFiles?.[0]?.url || resp.data?.url || null;
    if (url) console.log(`[FunnelBuilder] Uploaded "${filename}" to GHL media: ${url}`);
    return url;
  } catch (e) {
    console.warn(`[FunnelBuilder] GHL media upload failed for "${filename}":`, e.response?.data || e.message);
    return null;
  }
}

async function figmaExtractContent(fileKey, nodeId, authHeader) {
  try {
    const data = await httpsGet(
      'api.figma.com',
      `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`,
      authHeader
    );
    const root = data.nodes?.[nodeId]?.document;
    if (!root) return { texts: [], colors: [], spec: '', sectionCount: 0, imageNodes: [] };

    const globalColors = new Set();
    const imageNodes   = []; // { nodeId, name } — for batch export + GHL upload

    // ── Helpers ────────────────────────────────────────────────────────────────

    function toHex({ r, g, b, a } = {}) {
      if (r == null) return null;
      return '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
    }

    function getFill(fills = []) {
      return fills.find(f => f.type === 'SOLID' && f.color) || null;
    }

    function getFillHex(fills = []) {
      const f = getFill(fills);
      return f ? toHex(f.color) : null;
    }

    function getGradient(fills = []) {
      const g = fills.find(f => f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL');
      if (!g || !g.gradientStops?.length) return null;
      const stops = g.gradientStops.map(s => `${toHex(s.color)} ${Math.round(s.position * 100)}%`).join(', ');
      return g.type === 'GRADIENT_RADIAL' ? `radial-gradient(${stops})` : `linear-gradient(to right, ${stops})`;
    }

    function getShadow(effects = []) {
      const s = effects.find(e => e.type === 'DROP_SHADOW' && e.visible !== false);
      if (!s) return null;
      return `${s.offset?.x || 0}px ${s.offset?.y || 0}px ${s.radius || 0}px ${toHex(s.color) || 'rgba(0,0,0,0.1)'}`;
    }

    function getPadding(n) {
      return {
        top:    n.paddingTop    || n.verticalPadding   || 0,
        bottom: n.paddingBottom || n.verticalPadding   || 0,
        left:   n.paddingLeft   || n.horizontalPadding || 0,
        right:  n.paddingRight  || n.horizontalPadding || 0,
      };
    }

    function isButton(n) {
      const name = (n.name || '').toLowerCase();
      if (/\b(button|btn|cta|get started|sign up|buy|order|claim|start|join|register|download|apply)\b/.test(name)) return true;
      if ((n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE') &&
          n.fills?.some(f => f.type === 'SOLID') &&
          n.children?.some(c => c.type === 'TEXT')) return true;
      return false;
    }

    function isImage(n) {
      if (n.fills?.some(f => f.type === 'IMAGE')) return true;
      const name = (n.name || '').toLowerCase();
      return /\b(image|photo|img|picture|hero|banner|thumbnail|avatar|icon|logo|illustration|graphic|mockup|screenshot)\b/.test(name);
    }

    // ── Walk a node and produce structured items ────────────────────────────────

    function walkNode(n, depth, items) {
      if (depth > 8) return;

      // Skip invisible nodes
      if (n.visible === false || n.opacity === 0) return;

      if (isButton(n)) {
        const bg       = getFillHex(n.fills);
        const gradient = getGradient(n.fills);
        const txtNode  = n.children?.find(c => c.type === 'TEXT');
        const txt      = txtNode?.characters?.trim() || n.name;
        const txtColor = getFillHex(txtNode?.fills || []);
        const txtStyle = txtNode?.style || {};
        const pad      = getPadding(n);
        if (bg) globalColors.add(bg);
        if (txtColor) globalColors.add(txtColor);
        items.push({
          type: 'button', text: txt,
          background: gradient || bg || '#000000',
          color: txtColor || '#FFFFFF',
          fontSize: txtStyle.fontSize || 16,
          fontWeight: txtStyle.fontWeight || 600,
          fontFamily: txtStyle.fontFamily || null,
          borderRadius: n.cornerRadius || n.rectangleCornerRadii?.[0] || 0,
          paddingTop: pad.top, paddingBottom: pad.bottom,
          paddingLeft: pad.left, paddingRight: pad.right,
          shadow: getShadow(n.effects || []),
        });
        return;
      }

      if (isImage(n)) {
        const imgNodeId = n.id;
        if (imgNodeId) imageNodes.push({ nodeId: imgNodeId, name: n.name });
        items.push({ type: 'image', name: n.name, nodeId: imgNodeId, width: n.absoluteBoundingBox?.width, height: n.absoluteBoundingBox?.height });
        return;
      }

      if (n.type === 'TEXT' && n.characters) {
        const style    = n.style || {};
        const color    = getFillHex(n.fills);
        if (color) globalColors.add(color);
        const size     = style.fontSize || 16;
        const weight   = style.fontWeight || 400;
        const align    = (style.textAlignHorizontal || 'LEFT').toLowerCase();
        const lineH    = style.lineHeightPx ? Math.round(style.lineHeightPx) : null;
        const letterSp = style.letterSpacing ? Math.round(style.letterSpacing * 10) / 10 : null;
        const fontFam  = style.fontFamily || null;
        const italic   = style.italic || false;
        const decoration = style.textDecoration || null;

        let role = 'paragraph';
        if (size >= 44 || (weight >= 700 && size >= 32)) role = 'headline';
        else if (size >= 28) role = 'subheadline';
        else if (size >= 20) role = 'subheading';
        else if (size <= 12) role = 'caption';

        items.push({
          type: 'text', role, text: n.characters.trim(),
          fontSize: size, fontWeight: weight, fontFamily: fontFam,
          color, align, lineHeight: lineH, letterSpacing: letterSp,
          italic, decoration,
        });
        return;
      }

      // Divider / separator
      if ((n.type === 'LINE' || n.type === 'RECTANGLE') && !n.children?.length) {
        const bb = n.absoluteBoundingBox;
        if (bb && bb.height <= 4) {
          const col = getFillHex(n.fills);
          items.push({ type: 'divider', color: col || '#E5E7EB', thickness: Math.max(1, Math.round(bb.height)) });
          return;
        }
      }

      // Recurse into groups/frames
      if (n.children?.length) {
        const horizontal = n.layoutMode === 'HORIZONTAL';
        if (horizontal) {
          const cols = [];
          for (const child of n.children) {
            const colItems = [];
            const childBg = getFillHex(child.fills);
            if (childBg) globalColors.add(childBg);
            walkNode(child, depth + 1, colItems);
            if (colItems.length) cols.push({ background: childBg, items: colItems, width: child.absoluteBoundingBox?.width });
          }
          if (cols.length >= 2) {
            // Normalise widths to 12-column grid
            const totalW = cols.reduce((s, c) => s + (c.width || 1), 0);
            const gridCols = cols.map(c => ({ ...c, gridWidth: Math.round(12 * (c.width || 1) / totalW) }));
            items.push({ type: 'columns', columns: gridCols });
          } else {
            for (const child of n.children) walkNode(child, depth + 1, items);
          }
        } else {
          for (const child of n.children) walkNode(child, depth + 1, items);
        }
      }
    }

    // ── Build sections ─────────────────────────────────────────────────────────

    const sectionNodes = root.children?.length ? root.children : [root];
    const sections = [];

    for (const sec of sectionNodes) {
      if (sec.visible === false) continue;
      const bg       = getFillHex(sec.fills);
      const gradient = getGradient(sec.fills);
      const shadow   = getShadow(sec.effects || []);
      const pad      = getPadding(sec);
      if (bg) globalColors.add(bg);

      const items = [];
      for (const child of (sec.children || [])) walkNode(child, 1, items);

      sections.push({
        name: sec.name,
        background: gradient || bg || 'transparent',
        paddingTop:    pad.top,    paddingBottom: pad.bottom,
        paddingLeft:   pad.left,   paddingRight:  pad.right,
        minHeight: sec.absoluteBoundingBox?.height ? Math.round(sec.absoluteBoundingBox.height) : null,
        shadow,
        items,
      });
    }

    // ── Serialise to spec string ───────────────────────────────────────────────

    function fmtItem(it, indent = '  ') {
      if (it.type === 'text') {
        const extras = [
          it.fontFamily  ? `font:"${it.fontFamily}"` : null,
          it.lineHeight  ? `lineHeight:${it.lineHeight}px` : null,
          it.letterSpacing ? `letterSpacing:${it.letterSpacing}px` : null,
          it.italic      ? 'italic' : null,
          it.decoration  ? `decoration:${it.decoration}` : null,
        ].filter(Boolean).join(' ');
        return `${indent}[${it.role.toUpperCase()}] "${it.text}"\n${indent}  → size:${it.fontSize}px weight:${it.fontWeight} color:${it.color || 'inherit'} align:${it.align}${extras ? ' ' + extras : ''}`;
      }
      if (it.type === 'button') {
        const extras = [
          it.fontFamily ? `font:"${it.fontFamily}"` : null,
          it.shadow     ? `shadow:${it.shadow}` : null,
        ].filter(Boolean).join(' ');
        return `${indent}[BUTTON] "${it.text}"\n${indent}  → bg:${it.background} color:${it.color} size:${it.fontSize}px weight:${it.fontWeight} radius:${it.borderRadius}px pad:${it.paddingTop}/${it.paddingRight}/${it.paddingBottom}/${it.paddingLeft}px${extras ? ' ' + extras : ''}`;
      }
      if (it.type === 'image') {
        const dim = it.width && it.height ? ` (${Math.round(it.width)}×${Math.round(it.height)}px)` : '';
        return `${indent}[IMAGE] "${it.name}"${dim}`;
      }
      if (it.type === 'divider') {
        return `${indent}[DIVIDER] color:${it.color} thickness:${it.thickness}px`;
      }
      if (it.type === 'columns') {
        const colStr = it.columns.map((col, ci) => {
          const colHeader = `${indent}  ┌ Column ${ci + 1} (width:${col.gridWidth}/12${col.background ? ` bg:${col.background}` : ''})`;
          const colItems  = col.items.map(ci2 => fmtItem(ci2, indent + '  │ ')).join('\n');
          return `${colHeader}\n${colItems}`;
        }).join('\n');
        return `${indent}[${it.columns.length}-COLUMN LAYOUT]\n${colStr}`;
      }
      return '';
    }

    const spec = sections.map((sec, i) => {
      const meta = [
        `bg:${sec.background}`,
        sec.paddingTop || sec.paddingBottom ? `padding:${sec.paddingTop}/${sec.paddingRight}/${sec.paddingBottom}/${sec.paddingLeft}px` : null,
        sec.minHeight ? `minHeight:${sec.minHeight}px` : null,
        sec.shadow ? `shadow:${sec.shadow}` : null,
      ].filter(Boolean).join(' ');
      const content = sec.items.length
        ? sec.items.map(it => fmtItem(it)).join('\n')
        : '  (empty section)';
      return `━━━ SECTION ${i + 1}: "${sec.name}" | ${meta}\n${content}`;
    }).join('\n\n');

    const texts  = sections.flatMap(s => s.items.filter(it => it.type === 'text').map(it => it.text));
    const colors = [...globalColors].filter(Boolean).slice(0, 30);
    // Extract unique font families referenced in the spec (font:"FamilyName" markers)
    const fonts  = [...new Set([...spec.matchAll(/font:"([^"]+)"/g)].map(m => m[1]))].filter(Boolean).slice(0, 10);

    return { texts, colors, spec, sectionCount: sections.length, imageNodes, fonts };

  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('403')) {
      console.warn('[FunnelBuilder] figmaExtractContent: 403 — file not accessible to PAT, falling back to image-only mode.');
    } else {
      console.error('[FunnelBuilder] figmaExtractContent error:', msg);
    }
    return { texts: [], colors: [], spec: '', sectionCount: 0, imageNodes: [] };
  }
}

// Returns { token, authHeader } — token is the string, authHeader is the correct header object for Figma API
async function loadStoredFigmaToken(locationId) {
  // 1. Try OAuth token first (preferred)
  try {
    let oauth = await getFigmaOAuthToken(locationId);
    if (!oauth) {
      const configs = await getToolConfig(locationId);
      oauth = configs?.figmaOAuth || null;
      if (oauth) saveFigmaOAuthToken(locationId, oauth).catch(() => {});
    }
    if (oauth?.accessToken) {
      // Refresh if within 5 minutes of expiry
      if (oauth.expiresAt && Date.now() > oauth.expiresAt - 5 * 60 * 1000) {
        try {
          const refreshed = await figmaRefreshToken(oauth.refreshToken);
          await Promise.all([
            saveFigmaOAuthToken(locationId, refreshed),
            saveToolConfig(locationId, 'figmaOAuth', refreshed),
          ]);
          oauth = refreshed;
        } catch { /* use old token and hope it still works */ }
      }
      return { token: oauth.accessToken, authHeader: { 'Authorization': `Bearer ${oauth.accessToken}` } };
    }
  } catch { /* fall through */ }

  // 2. PAT fallback
  try {
    const pat = await getFigmaToken(locationId)
      || (await getToolConfig(locationId).catch(() => ({})))?.figmaToken?.token;
    if (pat) { const t = String(pat).trim(); return { token: t, authHeader: { 'X-Figma-Token': t } }; }
  } catch { /* fall through */ }

  return null;
}

async function figmaRefreshToken(refreshToken) {
  const data = await httpsPostForm('api.figma.com', '/v1/oauth/token', {}, {
    client_id:     process.env.FIGMA_CLIENT_ID,
    client_secret: process.env.FIGMA_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type:    'refresh_token',
  });
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt:    Date.now() + (data.expires_in || 7776000) * 1000,
  };
}

// ── AI Key persistence: GET / POST / DELETE /ai-key ──────────────────────────

router.get('/ai-key', async (req, res) => {
  try {
    const key = await loadStoredAiKey(req.locationId);
    if (!key) return res.json({ key: null, provider: null });
    res.json({ key, provider: detectProviderName(key) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ai-key', async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: '"key" is required' });
  try {
    await Promise.all([
      saveFunnelAiKey(req.locationId, key),
      saveToolConfig(req.locationId, 'funnelBuilderAiKey', { key }),
    ]);
    res.json({ success: true, provider: detectProviderName(key) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/ai-key', async (req, res) => {
  try {
    await Promise.all([
      deleteFunnelAiKey(req.locationId),
      saveToolConfig(req.locationId, 'funnelBuilderAiKey', { key: '' }),
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Figma Token: status / PAT save / disconnect ───────────────────────────────

router.get('/figma-token', async (req, res) => {
  try {
    const auth = await loadStoredFigmaToken(req.locationId);
    if (!auth) return res.json({ connected: false });
    res.json({ connected: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save PAT manually (fallback if user doesn't want OAuth)
router.post('/figma-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: '"token" is required' });
  try {
    await Promise.all([
      saveFigmaToken(req.locationId, token),
      saveToolConfig(req.locationId, 'figmaToken', { token }),
    ]);
    res.json({ success: true, method: 'pat' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect — remove both OAuth and PAT
router.delete('/figma-token', async (req, res) => {
  try {
    await Promise.all([
      deleteFigmaToken(req.locationId),
      deleteFigmaOAuthToken(req.locationId),
      saveToolConfig(req.locationId, 'figmaToken', { token: '' }),
      saveToolConfig(req.locationId, 'figmaOAuth', {}),
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Figma OAuth: /figma-auth → redirect + /figma-callback ────────────────────


// ── POST /generate — AI-powered native page generation + save to GHL ─────────

router.post('/generate', async (req, res) => {
  const {
    pageId,
    funnelId,
    pageType,
    niche,
    offer,
    audience,
    extraContext,
    colorScheme,
    agentId,       // optional: saved agent to use as persona
  } = req.body;

  if (!niche || !offer) {
    return res.status(400).json({ success: false, error: '"niche" and "offer" are required.' });
  }
  if (!funnelId && !pageId) {
    return res.status(400).json({ success: false, error: '"funnelId" is required (pageId is auto-detected from funnelId).' });
  }

  // Load stored AI key from Redis/Firebase if no header provided
  const storedAiKey = await loadStoredAiKey(req.locationId);
  const hasUserKey  = req.headers['x-anthropic-api-key'] || req.headers['x-openai-api-key'] || req.headers['x-groq-api-key'] || req.headers['x-google-api-key'] || req.headers['x-perplexity-api-key'] || storedAiKey;
  if (!hasUserKey && !aiService.getProvider()) {
    return res.status(503).json({ success: false, error: 'No AI provider configured. Enter your API key in the Funnel Builder.' });
  }

  // Step 1: Ensure Firebase is connected
  let idToken;
  try {
    idToken = await getFirebaseToken(req.locationId);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error:   'Firebase not connected. Call POST /funnel-builder/connect first.',
      detail:  err.message,
    });
  }

  // Step 1b: Auto-detect pageId from funnelId if not provided
  let resolvedPageId = pageId;
  if (!resolvedPageId && funnelId) {
    try {
      const result = await ghlClient.ghlRequest(req.locationId, 'GET', '/funnels/page', null, {
        locationId: req.locationId, funnelId, limit: 20, offset: '0',
      });
      const pages = result?.funnelPages || result?.pages || result?.pageList || result?.list || result?.data
                 || (Array.isArray(result) ? result : []);
      if (!pages.length) {
        return res.status(400).json({ success: false, error: 'No pages found in this funnel. Add a page in GHL first.' });
      }
      pages.sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));
      resolvedPageId = pages[0].id || pages[0]._id;
      console.log(`[FunnelBuilder] Auto-detected pageId: ${resolvedPageId} (first page in funnel ${funnelId})`);
    } catch (err) {
      return res.status(502).json({ success: false, error: `Failed to list funnel pages: ${err.message}` });
    }
  }

  // Step 2: Optionally fetch existing page context
  let pageContext = null;
  try {
    pageContext = await getPageData(req.locationId, resolvedPageId);
  } catch (err) {
    // Non-fatal — 404 is normal for new pages, log only unexpected errors
    if (!err.message.includes('404')) {
      console.warn(`[FunnelBuilder] Could not fetch page context for ${resolvedPageId}:`, err.message);
    }
  }

  // Step 2b: Load selected agent (optional)
  let selectedAgent = null;
  if (agentId) {
    try {
      selectedAgent = await agentStore.getAgent(req.locationId, agentId);
    } catch (err) {
      console.warn(`[FunnelBuilder] Could not load agent ${agentId}:`, err.message);
    }
  }

  // Step 2c: RAG context from agent knowledge base (optional)
  let ragContext = '';
  if (agentId && chroma.isEnabled()) {
    try {
      const ragQuery = `${niche} ${offer} ${audience || ''} ${extraContext || ''}`.trim();
      const chunks   = await chroma.queryKnowledge(req.locationId, agentId, ragQuery, 5);
      if (chunks.length > 0) {
        ragContext = `\n\nRelevant knowledge base context for this agent:\n${chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')}`;
      }
    } catch (e) {
      console.warn('[FunnelBuilder] RAG query failed:', e.message);
    }
  }

  // Step 3: Build Claude prompt
  const pageLabel    = pageType || 'Sales Page';
  const colors      = colorScheme || '';
  const hasCustomColors = colors && /#[0-9A-Fa-f]{6}/i.test(colors);
  const design      = selectFunnelDesign(niche, offer);
  const palette     = hasCustomColors ? extractColors(colors) : design.palette;
  if (!hasCustomColors) { palette.heroGradient = design.palette.heroGradient; palette.ctaGradient = design.palette.ctaGradient; }
  const imgSeeds    = buildImgSeeds(niche, offer);
  const imgKeyword   = (niche || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').find(Boolean) || 'business';
  const contextBlock = pageContext
    ? `\nExisting page context (use as reference for any brand/funnel details):\n${JSON.stringify(pageContext, null, 2).slice(0, 1500)}`
    : '';

  const agentIntro = selectedAgent
    ? `You are ${selectedAgent.name}. ${selectedAgent.persona || ''}\n\nYour training and instructions:\n${selectedAgent.instructions}${ragContext}\n\n---\n\n`
    : '';

  const ai       = resolveAI(req, storedAiKey);
  const provider = ai.isUserKey ? { name: ai.provider || 'user' } : (aiService.getProvider() || {});
  const isGroq   = ai.provider === 'groq' || (!ai.isUserKey && provider?.name === 'groq');

  // Groq compact schema — 3-section skeleton with exact brand colors injected
  const groqSystemPrompt = `${agentIntro}Output ONLY valid JSON. No explanation, no markdown.

REQUIRED output shape — 3 separate section objects in the array:
{"sections":[
  {"id":"section-A1B2C3D4","type":"section","name":"Hero","allowRowMaxWidth":false,"styles":{"backgroundColor":{"value":"${palette.heroBg}"},"paddingTop":{"value":100,"unit":"px"},"paddingBottom":{"value":100,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},"mobileStyles":{"paddingTop":{"value":60,"unit":"px"},"paddingBottom":{"value":60,"unit":"px"}},"children":[{"id":"row-A1B2C3D4","type":"row","children":[{"id":"col-A1B2C3D4","type":"column","width":12,"styles":{"textAlign":{"value":"center"}},"mobileStyles":{},"children":[HERO_ELEMENTS]}]}]},
  {"id":"section-E5F6G7H8","type":"section","name":"Benefits","allowRowMaxWidth":false,"styles":{"backgroundColor":{"value":"${palette.sectionBg}"},"paddingTop":{"value":80,"unit":"px"},"paddingBottom":{"value":80,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},"mobileStyles":{"paddingTop":{"value":50,"unit":"px"},"paddingBottom":{"value":50,"unit":"px"}},"children":[{"id":"row-E5F6G7H8","type":"row","children":[{"id":"col-E5F6G7H8","type":"column","width":12,"styles":{"textAlign":{"value":"left"}},"mobileStyles":{},"children":[BENEFITS_ELEMENTS]}]}]},
  {"id":"section-I9J0K1L2","type":"section","name":"CTA","allowRowMaxWidth":false,"styles":{"backgroundColor":{"value":"${palette.ctaBg}"},"paddingTop":{"value":100,"unit":"px"},"paddingBottom":{"value":100,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},"mobileStyles":{"paddingTop":{"value":60,"unit":"px"},"paddingBottom":{"value":60,"unit":"px"}},"children":[{"id":"row-I9J0K1L2","type":"row","children":[{"id":"col-I9J0K1L2","type":"column","width":12,"styles":{"textAlign":{"value":"center"}},"mobileStyles":{},"children":[CTA_ELEMENTS]}]}]}
]}

Replace HERO_ELEMENTS, BENEFITS_ELEMENTS, CTA_ELEMENTS with real element arrays. Use unique 8-char random IDs. Element types:
- {"id":"heading-XXXXXXXX","type":"heading","tag":"h1","text":"...","styles":{"color":{"value":"${palette.heroText}"},"fontSize":{"value":52,"unit":"px"},"fontWeight":{"value":"700"},"lineHeight":{"value":1.2}},"mobileStyles":{"fontSize":{"value":32,"unit":"px"}}}
- {"id":"sub-heading-XXXXXXXX","type":"sub-heading","text":"...","styles":{"color":{"value":"${palette.heroText}"},"fontSize":{"value":24,"unit":"px"},"fontWeight":{"value":"400"}},"mobileStyles":{"fontSize":{"value":18,"unit":"px"}}}
- {"id":"paragraph-XXXXXXXX","type":"paragraph","text":"Plain text only. No HTML.","styles":{"color":{"value":"#555555"},"fontSize":{"value":18,"unit":"px"},"lineHeight":{"value":1.7}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}}
- {"id":"button-XXXXXXXX","type":"button","text":"...","link":"#","styles":{"backgroundColor":{"value":"${palette.primary}"},"color":{"value":"${palette.buttonColor}"},"fontSize":{"value":18,"unit":"px"},"fontWeight":{"value":"700"},"paddingTop":{"value":18,"unit":"px"},"paddingBottom":{"value":18,"unit":"px"},"paddingLeft":{"value":40,"unit":"px"},"paddingRight":{"value":40,"unit":"px"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}}
- {"id":"bulletList-XXXXXXXX","type":"bulletList","items":["Benefit 1","Benefit 2","Benefit 3","Benefit 4"],"icon":{"name":"check","unicode":"f00c","fontFamily":"Font Awesome 5 Free"},"styles":{"color":{"value":"${palette.bodyText}"},"fontSize":{"value":18,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}}`;

  const fullSystemPrompt = `${agentIntro}You are an expert GoHighLevel funnel designer and copywriter. Generate complete, production-ready native GHL page JSON.

RULES:
1. Respond with ONLY valid JSON — no markdown, no code fences, no explanation.
2. Root object: { "sections": [ ... ] }
3. All IDs: type-XXXXXXXX (8 random alphanumeric chars).
4. Use persuasive, benefit-driven copy for the target audience.
5. Mobile styles reduce padding/font sizes to ~60% of desktop.
6. CRITICAL: Use "heading" (NOT "headline") and "sub-heading" (NOT "sub-headline") for element types.
7. CRITICAL: paragraph "text" must be plain text — NO HTML tags, no <p>, no <br>, no <strong>.
8. CRITICAL: bulletList "items" must be an array of plain strings — NOT objects. Example: ["Benefit 1","Benefit 2"]
9. CRITICAL: If a section template has "layout":"three-column" and "columns":[], KEEP both fields and fill in real testimonials in each column's "children" — do NOT flatten columns into "children".
10. DESIGN DEPTH: Hero/CTA sections need strong dark or gradient backgrounds — never plain white. Always include an image in hero sections. Buttons use bold accent colors with high contrast.

SCHEMA:
{"sections":[{"id":"section-X","type":"section","name":"name","allowRowMaxWidth":false,
"styles":{"backgroundColor":{"value":"#HEX"},"paddingTop":{"value":80,"unit":"px"},"paddingBottom":{"value":80,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},
"mobileStyles":{"paddingTop":{"value":40,"unit":"px"},"paddingBottom":{"value":40,"unit":"px"}},
"children":[{"id":"row-X","type":"row","children":[{"id":"column-X","type":"column","width":12,
"styles":{"textAlign":{"value":"center"}},"mobileStyles":{},
"children":[
{"id":"heading-X","type":"heading","text":"Headline text here","tag":"h1","styles":{"color":{"value":"#111827"},"fontSize":{"value":52,"unit":"px"},"fontWeight":{"value":"700"},"lineHeight":{"value":1.2}},"mobileStyles":{"fontSize":{"value":32,"unit":"px"}}},
{"id":"sub-heading-X","type":"sub-heading","text":"Subheading text here","styles":{"color":{"value":"#374151"},"fontSize":{"value":24,"unit":"px"},"fontWeight":{"value":"500"}},"mobileStyles":{"fontSize":{"value":18,"unit":"px"}}},
{"id":"paragraph-X","type":"paragraph","text":"Plain text body copy here. No HTML tags whatsoever.","styles":{"color":{"value":"#4B5563"},"fontSize":{"value":18,"unit":"px"},"lineHeight":{"value":1.7}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
{"id":"button-X","type":"button","text":"CTA Text","link":"#","styles":{"backgroundColor":{"value":"#1D4ED8"},"color":{"value":"#FFFFFF"},"fontSize":{"value":18,"unit":"px"},"fontWeight":{"value":"700"},"paddingTop":{"value":16,"unit":"px"},"paddingBottom":{"value":16,"unit":"px"},"paddingLeft":{"value":40,"unit":"px"},"paddingRight":{"value":40,"unit":"px"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
{"id":"bulletList-X","type":"bulletList","items":["Benefit one plain text","Benefit two plain text","Benefit three plain text"],"icon":{"name":"check","unicode":"f00c","fontFamily":"Font Awesome 5 Free"},"styles":{"color":{"value":"#111827"},"fontSize":{"value":18,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
{"id":"image-X","type":"image","src":"https://picsum.photos/seed/${imgKeyword}/800/450","alt":"${imgKeyword}","styles":{"width":{"value":100,"unit":"%"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{}}
]}]}]}]}`;

  const systemPrompt = isGroq ? groqSystemPrompt : fullSystemPrompt;

  const imgSrc = imgSeeds[0];
  const sectionPlan = getSectionPlan(pageLabel, imgSrc, palette, imgSeeds);
  const sectionsInstruction = isGroq ? sectionPlan.groq : sectionPlan.full;

  const userPrompt = `Generate a native GHL ${pageLabel} JSON for:

Business / Niche: ${niche}
Offer: ${offer}
Target Audience: ${audience || 'General prospects interested in the offer'}
Color Scheme: ${colors}
${extraContext ? `Additional Context: ${extraContext}` : ''}
${contextBlock}

${sectionsInstruction}

Output ONLY the JSON object. No markdown, no explanation.`;

  // Step 4: Call AI provider
  let pageJson;
  try {
    const rawText = (await ai.generate(systemPrompt, userPrompt, { maxTokens: 4096 })).trim();
    pageJson = parseJsonSafe(rawText);
    if (!pageJson.sections || !Array.isArray(pageJson.sections)) {
      throw new Error('AI response missing "sections" array.');
    }
  } catch (err) {
    console.error('[FunnelBuilder] AI generation error:', err.message);
    return res.status(500).json({
      success: false,
      error:   'Failed to generate page JSON: ' + err.message,
    });
  }

  // Step 4b: Ensure 3 proper sections regardless of how many the AI returned
  if (isGroq) {
    const crypto2 = require('crypto');
    const sid = () => crypto2.randomBytes(4).toString('hex');
    const makeSection = (name, bgColor, textAlign, elems) => ({
      id: `section-${sid()}`, type: 'section', name, allowRowMaxWidth: false,
      styles: { backgroundColor: { value: bgColor }, paddingTop: { value: 80, unit: 'px' }, paddingBottom: { value: 80, unit: 'px' }, paddingLeft: { value: 20, unit: 'px' }, paddingRight: { value: 20, unit: 'px' } },
      mobileStyles: {},
      children: [{ id: `row-${sid()}`, type: 'row', children: [{ id: `col-${sid()}`, type: 'column', width: 12, styles: { textAlign: { value: textAlign } }, mobileStyles: {}, children: elems }] }],
    });

    // Collect all elements from all AI sections
    const flat = [];
    const dig = nodes => nodes?.forEach(n =>
      n.type === 'row' || n.type === 'column' || n.type === 'section' ? dig(n.children) : n.type && flat.push(n)
    );
    pageJson.sections.forEach(s => dig(s.children));

    if (flat.length >= 2) {
      // Split: hero = up to (and including) first button
      const firstBtn  = flat.findIndex(e => e.type === 'button');
      const heroEnd   = firstBtn >= 0 ? firstBtn + 1 : Math.ceil(flat.length / 3);
      const heroElems = flat.slice(0, heroEnd);
      const rest      = flat.slice(heroEnd);

      // Benefits = everything between hero and last button
      const lastBtn      = rest.map(e => e.type).lastIndexOf('button');
      const ctaStart     = lastBtn > 0 ? lastBtn : Math.max(rest.length - 2, 1);
      const benefitElems = rest.slice(0, ctaStart);
      const ctaElems     = rest.slice(ctaStart);

      // Guarantee CTA section always has a heading + paragraph + button
      const fallbackCta = [
        { id: `heading-${sid()}`, type: 'heading', tag: 'h2', text: `Ready to start your journey?`, styles: { color: { value: '#ffffff' }, fontSize: { value: 36, unit: 'px' }, fontWeight: { value: '700' }, lineHeight: { value: 1.2, unit: 'em' }, textAlign: { value: 'center' }, marginTop: { value: 0, unit: 'px' }, marginRight: { value: 0, unit: 'px' }, marginBottom: { value: 16, unit: 'px' }, marginLeft: { value: 0, unit: 'px' }, typography: { value: 'var(--headlinefont)' }, linkTextColor: { value: '#ffffff' } }, mobileStyles: { fontSize: { value: 26, unit: 'px' }, lineHeight: { value: 1.2, unit: 'em' }, marginTop: { value: 0, unit: 'px' }, marginRight: { value: 0, unit: 'px' }, marginBottom: { value: 12, unit: 'px' }, marginLeft: { value: 0, unit: 'px' } } },
        { id: `paragraph-${sid()}`, type: 'paragraph', text: `Join thousands who have already taken the first step. Spots are limited — act now.`, styles: { color: { value: '#e2e8f0' }, fontSize: { value: 18, unit: 'px' }, lineHeight: { value: 1.6, unit: 'em' }, textAlign: { value: 'center' }, marginTop: { value: 0, unit: 'px' }, marginRight: { value: 0, unit: 'px' }, marginBottom: { value: 24, unit: 'px' }, marginLeft: { value: 0, unit: 'px' }, typography: { value: 'var(--contentfont)' }, linkTextColor: { value: '#e2e8f0' } }, mobileStyles: { fontSize: { value: 16, unit: 'px' }, lineHeight: { value: 1.6, unit: 'em' }, marginTop: { value: 0, unit: 'px' }, marginRight: { value: 0, unit: 'px' }, marginBottom: { value: 16, unit: 'px' }, marginLeft: { value: 0, unit: 'px' } } },
        { id: `button-${sid()}`, type: 'button', text: `Get Started Now`, link: '#', styles: { backgroundColor: { value: '#f59e0b' }, color: { value: '#1e3a5f' }, fontSize: { value: 18, unit: 'px' }, fontWeight: { value: '700' }, lineHeight: { value: 1.2, unit: 'em' }, paddingTop: { value: 16, unit: 'px' }, paddingBottom: { value: 16, unit: 'px' }, paddingLeft: { value: 40, unit: 'px' }, paddingRight: { value: 40, unit: 'px' }, borderRadius: { value: 8, unit: 'px' }, marginTop: { value: 0, unit: 'px' }, marginBottom: { value: 0, unit: 'px' }, marginLeft: { value: 0, unit: 'px' }, marginRight: { value: 0, unit: 'px' }, textAlign: { value: 'center' } }, mobileStyles: { fontSize: { value: 16, unit: 'px' }, paddingTop: { value: 14, unit: 'px' }, paddingBottom: { value: 14, unit: 'px' } } },
      ];

      // If CTA has no heading, prepend the fallback heading + paragraph before any AI button
      const ctaFinal = ctaElems.length
        ? (ctaElems.some(e => e.type === 'heading') ? ctaElems : [...fallbackCta.slice(0, 2), ...ctaElems])
        : fallbackCta;

      pageJson.sections = [
        makeSection('Hero',     '#ffffff', 'center', heroElems.length    ? heroElems    : [flat[0]]),
        makeSection('Benefits', '#f9fafb', 'left',   benefitElems.length ? benefitElems : flat.slice(Math.min(1, flat.length - 1))),
        makeSection('CTA',      '#1e3a5f', 'center', ctaFinal),
      ];
      console.log(`[FunnelBuilder] Sections rebuilt: Hero=${heroElems.length} Benefits=${benefitElems.length} CTA=${ctaElems.length || 'fallback'}`);
    }
  }

  // Step 5: Save to GHL backend (Firestore + Storage)
  let saveResult;
  try {
    saveResult = await saveWithFunnelHint(req.locationId, resolvedPageId, pageJson, funnelId, colorScheme);
  } catch (err) {
    console.error('[FunnelBuilder] savePageData error:', err.message);
    return res.status(500).json({
      success: false,
      error:   'Page JSON generated but failed to save to GHL.',
      detail:  err.message,
      hint:    err.message.includes('403') ? 'Firebase token expired. Use the bookmarklet to reconnect.' : undefined,
      pageJson,
    });
  }

  // Step 5b: PUT to GHL's backend API to update pageDataDownloadUrl in GHL's DB.
  // GHL's backend has its OWN database separate from Firestore — Firestore writes
  // alone don't update what the editor reads. We must call the backend API directly.
  let ghlPutStatus = null;
  let ghlPutData   = null;
  try {
    const { buildBackendHeaders } = require('../services/ghlPageBuilder');
    const fbTok2  = await getFirebaseToken(req.locationId);
    const beHdrs2 = buildBackendHeaders(fbTok2);
    const putBody = JSON.stringify({
      pageDataDownloadUrl: saveResult.downloadUrl,
      pageDataUrl:         saveResult.storagePath,
      sectionVersion:      saveResult.sectionVersion,
      pageVersion:         saveResult.pageVersion,
      version:             saveResult.version,
    });
    const pagePath = `/funnels/page/${resolvedPageId}?locationId=${encodeURIComponent(req.locationId)}`;
    const putRes = await new Promise((resolve) => {
      const r2 = https.request(
        { hostname: 'backend.leadconnectorhq.com', path: pagePath, method: 'PUT',
          headers: { ...beHdrs2, 'Content-Length': Buffer.byteLength(putBody) } },
        (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
          try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
          catch { resolve({ status: r.statusCode, data: d.slice(0, 300) }); }
        }); }
      );
      r2.on('error', e => resolve({ status: 0, error: e.message }));
      r2.write(putBody); r2.end();
    });
    ghlPutStatus = putRes.status;
    ghlPutData   = putRes.data;
    console.log(`[FunnelBuilder] GHL backend PUT /funnels/page → ${putRes.status}`, JSON.stringify(putRes.data).slice(0, 200));
  } catch (e) {
    console.warn('[FunnelBuilder] GHL PUT warning:', e.message);
    ghlPutStatus = 0;
    ghlPutData   = { error: e.message };
  }

  // Step 5c: POST to GHL's native copilot save endpoint (same as GHL's "Ask AI").
  // IMPORTANT: send AI-generated sections in GHL's expected nested-children format,
  // NOT the Storage native format (metaData + flat elements[]). Normalize element
  // type names to match what GHL's AI outputs ("headline" not "heading", etc.)
  function normalizeForCopilot(nodes) {
    return (nodes || []).map(n => {
      const typeMap = { heading: 'headline', 'sub-heading': 'sub-headline' };
      const out = { ...n, type: typeMap[n.type] || n.type };
      if (Array.isArray(n.children)) out.children = normalizeForCopilot(n.children);
      return out;
    });
  }

  let copilotPushStatus = null;
  let copilotPushData   = null;
  try {
    const { buildBackendHeaders } = require('../services/ghlPageBuilder');
    const fbTok2    = await getFirebaseToken(req.locationId);
    const beHdrs2   = buildBackendHeaders(fbTok2);

    // Send AI sections in nested-children format (GHL expects this, not native Storage format)
    const normalizedSects = normalizeForCopilot(pageJson.sections);
    const copilotBody = JSON.stringify({
      sections:            normalizedSects,
      pageDataDownloadUrl: saveResult.downloadUrl,
      pageDataUrl:         saveResult.storagePath,
      sectionVersion:      saveResult.sectionVersion,
      pageVersion:         saveResult.pageVersion,
      version:             saveResult.version,
    });
    const copilotPath = `/funnel-ai/copilot/page-data/${resolvedPageId}?locationId=${encodeURIComponent(req.locationId)}`;
    const cpRes = await new Promise((resolve) => {
      const r2 = https.request(
        { hostname: 'backend.leadconnectorhq.com', path: copilotPath, method: 'POST',
          headers: { ...beHdrs2, 'Content-Length': Buffer.byteLength(copilotBody) } },
        (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
          try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
          catch { resolve({ status: r.statusCode, data: d.slice(0, 300) }); }
        }); }
      );
      r2.on('error', e => resolve({ status: 0, error: e.message }));
      r2.write(copilotBody);
      r2.end();
    });
    copilotPushStatus = cpRes.status;
    console.log(`[FunnelBuilder] copilot POST → ${cpRes.status}`, JSON.stringify(cpRes.data).slice(0, 200));

    // Step 5c: GET copilot + GET /funnels/page to see what the editor would read
    const [cpGetRes, pageApiRes] = await Promise.all([
      new Promise((resolve) => {
        const r3 = https.request(
          { hostname: 'backend.leadconnectorhq.com', path: copilotPath, method: 'GET', headers: { ...beHdrs2 } },
          (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
            try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
            catch { resolve({ status: r.statusCode, data: d.slice(0, 300) }); }
          }); }
        );
        r3.on('error', e => resolve({ status: 0, error: e.message }));
        r3.end();
      }),
      new Promise((resolve) => {
        const pagePath = `/funnels/page/${resolvedPageId}?locationId=${encodeURIComponent(req.locationId)}`;
        const r4 = https.request(
          { hostname: 'backend.leadconnectorhq.com', path: pagePath, method: 'GET', headers: { ...beHdrs2 } },
          (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
            try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
            catch { resolve({ status: r.statusCode, data: d.slice(0, 200) }); }
          }); }
        );
        r4.on('error', e => resolve({ status: 0, error: e.message }));
        r4.end();
      }),
    ]);

    const cpD  = cpGetRes.data;
    const pgD  = pageApiRes.data;
    copilotPushData = {
      postStatus:  cpRes.status,
      postData:    cpRes.data,
      // What does the copilot GET return after our POST?
      copilotGet:  { status: cpGetRes.status, hasSections: Array.isArray(cpD?.sections) ? cpD.sections.length : 'no', downloadUrl: cpD?.pageDataDownloadUrl || null, raw: JSON.stringify(cpD).slice(0, 400) },
      // What does the regular page API return? (This is what the editor reads)
      pageApi:     { status: pageApiRes.status, sectionCount: Array.isArray(pgD?.sections) ? pgD.sections.length : 'no', downloadUrl: pgD?.pageDataDownloadUrl || null, sectionVersion: pgD?.sectionVersion, version: pgD?.version },
    };
    console.log(`[FunnelBuilder] pageApi after save → status=${pageApiRes.status} sections=${copilotPushData.pageApi.sectionCount} dlUrl=${!!copilotPushData.pageApi.downloadUrl}`);
  } catch (e) {
    console.warn('[FunnelBuilder] copilot push warning:', e.message);
    copilotPushStatus = 0;
    copilotPushData   = { error: e.message };
  }

  // Step 6: Build preview URL
  const previewUrl = funnelId
    ? `https://app.gohighlevel.com/v2/preview/${funnelId}/${resolvedPageId}`
    : null;

  res.json({
    success:      true,
    pageId:       resolvedPageId,
    previewUrl,
    sectionsCount: pageJson.sections.length,
    agentUsed:    selectedAgent ? { id: selectedAgent.id, name: selectedAgent.name, emoji: selectedAgent.emoji } : null,
    message:      `Page generated (${pageJson.sections.length} sections) and saved to GHL successfully.`,
    ghlResponse:  saveResult,
    ghlPut:       { status: ghlPutStatus, data: ghlPutData },
    copilotPush:  { status: copilotPushStatus, ...( typeof copilotPushData === 'object' ? copilotPushData : { data: copilotPushData } ) },
  });
});

// ── POST /generate-from-design — analyze Figma screenshot → GHL native page ──

router.post('/generate-from-design', upload.single('image'), async (req, res) => {
  const { funnelId, agentId, extraContext, colorScheme, figmaUrl } = req.body;

  if (!req.file && !figmaUrl) {
    return res.status(400).json({ success: false, error: 'Provide either an image upload or a Figma URL.' });
  }
  if (!funnelId) {
    return res.status(400).json({ success: false, error: '"funnelId" is required.' });
  }
  const storedAiKeyDesign = await loadStoredAiKey(req.locationId);
  const anyUserKey = req.headers['x-anthropic-api-key'] || req.headers['x-openai-api-key'] || req.headers['x-google-api-key'] || req.headers['x-groq-api-key'] || req.headers['x-perplexity-api-key'] || storedAiKeyDesign;
  if (!anyUserKey && !aiService.getProvider()) {
    return res.status(503).json({ success: false, error: 'No AI provider configured. Enter your API key in the Funnel Builder (Claude, OpenAI, Groq, or Gemini).' });
  }

  // Ensure Firebase connected
  try { await getFirebaseToken(req.locationId); } catch (err) {
    return res.status(400).json({ success: false, error: 'Firebase not connected. Call POST /funnel-builder/connect first.', detail: err.message });
  }

  // Load agent + RAG context
  let selectedAgent = null;
  if (agentId) {
    try { selectedAgent = await agentStore.getAgent(req.locationId, agentId); } catch {}
  }
  let ragContext = '';
  if (agentId && chroma.isEnabled()) {
    try {
      const chunks = await chroma.queryKnowledge(req.locationId, agentId, extraContext || 'page design conversion', 5);
      if (chunks.length > 0) ragContext = `\n\nRelevant knowledge base context:\n${chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')}`;
    } catch {}
  }

  // Get pages from funnel
  let pages;
  try {
    const result = await ghlClient.ghlRequest(req.locationId, 'GET', '/funnels/page', null, {
      locationId: req.locationId, funnelId, limit: 20, offset: '0',
    });
    pages = result?.funnelPages || result?.pages || result?.pageList || result?.list || result?.data
         || (Array.isArray(result) ? result : []);
  } catch (err) {
    return res.status(502).json({ success: false, error: `Failed to list funnel pages: ${err.message}` });
  }

  if (!Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ success: false, needsPages: true, error: 'This funnel has no pages yet. Add pages in GHL first.' });
  }

  pages.sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));
  pages = pages.map(p => ({ ...p, id: p.id || p._id }));

  // SSE setup — start streaming now that we have valid pages
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send('start', { total: pages.length, pages: pages.map(p => ({ id: p.id, name: p.name, stepOrder: p.stepOrder })) });
  send('log', { msg: `Found ${pages.length} page${pages.length !== 1 ? 's' : ''} in funnel`, level: 'info' });

  // Resolve image: either uploaded file or exported from Figma
  let imageBase64, imageMediaType;
  let figmaContent    = { texts: [], colors: [], spec: '', sectionCount: 0, imageNodes: [] };
  let figmaImageUrlMap = {};
  let figmaAuth       = null;
  let figmaFileKey    = null;   // kept for per-page frame loading in multi-frame mode
  let figmaFrames     = [];     // all top-level frames discovered
  let isMultiFrame    = false;  // true when we have N frames → N pages

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let figmaSpecSent = false; // send figma_spec event only once (first frame)

  /**
   * Load a single Figma frame: export PNG + extract spec + upload images.
   * Sets imageBase64, imageMediaType, figmaContent, figmaImageUrlMap in scope.
   */
  async function loadFigmaFrame(fileKey, nodeId, auth, logPrefix) {
    // Export PNG
    let imgResult;
    try {
      imgResult = await figmaExportImage(fileKey, nodeId, auth.authHeader);
    } catch (err) {
      const is403 = err.message.includes('403');
      throw new Error(is403
        ? 'Figma file access denied (403). In Figma: Share → Invite your Figma account with "can view" access.'
        : `Figma export error: ${err.message}`);
    }
    imageBase64    = imgResult.base64;
    imageMediaType = imgResult.mimeType;
    send('log', { msg: `${logPrefix}Frame exported — extracting design spec...`, level: 'info' });

    await sleep(400);
    const content = await figmaExtractContent(fileKey, nodeId, auth.authHeader);
    figmaContent  = content;
    if (content.spec) {
      send('log', { msg: `${logPrefix}Spec: ${content.texts.length} texts, ${content.colors.length} colors, ${content.imageNodes.length} images`, level: 'success' });
      // Send full spec to frontend for auto-improve context (only first frame)
      if (!figmaSpecSent) { figmaSpecSent = true; send('figma_spec', { spec: content.spec, colors: content.colors }); }
    } else {
      send('log', { msg: `${logPrefix}Spec unavailable — using image-only mode`, level: 'warn' });
    }

    // Upload image nodes to GHL media
    figmaImageUrlMap = {};
    if (content.imageNodes.length > 0) {
      try {
        const bufferMap = await figmaBatchExportImages(fileKey, content.imageNodes, auth.authHeader);
        await Promise.all(Object.entries(bufferMap).map(async ([nid, { buffer, name }]) => {
          const slug     = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
          const filename = `figma-${slug}-${nid.replace(/:/g, '-')}.png`;
          const ghlUrl   = await uploadImageToGHL(req.locationId, buffer, filename);
          if (ghlUrl) figmaImageUrlMap[nid] = ghlUrl;
        }));
        const uploaded = Object.keys(figmaImageUrlMap).length;
        send('log', { msg: `${logPrefix}Uploaded ${uploaded}/${content.imageNodes.length} image(s) to GHL media`, level: uploaded > 0 ? 'success' : 'warn' });
      } catch (e) {
        send('log', { msg: `${logPrefix}Image upload skipped: ${e.message}`, level: 'warn' });
      }
    }
  }

  if (figmaUrl) {
    figmaAuth = await loadStoredFigmaToken(req.locationId);
    if (!figmaAuth) {
      send('error', { error: 'Figma not connected. Enter your Figma Personal Access Token in the Design tab first.' });
      res.end(); return;
    }
    try {
      const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
      figmaFileKey = fileKey;

      if (!nodeId || nodeId === '0:1') {
        // No specific node pinned — discover all frames
        send('log', { msg: 'Discovering Figma frames...', level: 'info' });
        figmaFrames = await figmaGetAllFrames(fileKey, figmaAuth.authHeader);
        if (figmaFrames.length === 0) {
          send('error', { error: 'No frames found in this Figma file. Create at least one frame and try again.' });
          res.end(); return;
        }

        if (figmaFrames.length > 1 && pages.length > 1) {
          // Multi-frame mode: map frame[i] → page[i]
          isMultiFrame = true;
          send('log', { msg: `Found ${figmaFrames.length} frame(s) — mapping to ${pages.length} funnel page(s)`, level: 'success' });
          figmaFrames.slice(0, pages.length).forEach((f, i) =>
            send('log', { msg: `  Frame ${i + 1}: "${f.name}" → Page ${i + 1}: "${pages[i]?.name || '?'}"`, level: 'info' })
          );
          if (figmaFrames.length < pages.length) {
            send('log', { msg: `  ⚠️ Fewer frames than pages — last frame will be reused for remaining pages`, level: 'warn' });
          }
        } else {
          // Single-frame mode: use first frame for all pages
          const frame = figmaFrames[0];
          send('log', { msg: `Using frame: "${frame.name}"`, level: 'info' });
          await loadFigmaFrame(fileKey, frame.id, figmaAuth, '');
        }
      } else {
        // Specific node pinned in URL — single-frame mode
        send('log', { msg: `Using pinned Figma node: ${nodeId}`, level: 'info' });
        await loadFigmaFrame(fileKey, nodeId, figmaAuth, '');
      }
    } catch (err) {
      send('error', { error: `Figma error: ${err.message}` });
      res.end(); return;
    }
  } else {
    imageBase64    = req.file.buffer.toString('base64');
    imageMediaType = req.file.mimetype;
    send('log', { msg: 'Design image loaded — starting AI analysis', level: 'info' });
  }

  const agentIntro = selectedAgent
    ? `You are ${selectedAgent.name}. ${selectedAgent.persona || ''}\n\n${selectedAgent.instructions}${ragContext}\n\n---\n\n`
    : '';

  const aiDesign    = resolveAI(req, storedAiKeyDesign);
  const imgKwDesign = (extraContext || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').find(Boolean) || 'business';

  const systemPrompt = `${agentIntro}You are a pixel-perfect GoHighLevel page builder. You receive a Figma design spec and a screenshot. Your ONLY job is to convert every single design element into the GHL native JSON format — replicating every font, color, size, spacing, layout, and text exactly as specified.

ABSOLUTE RULES (never break these):
1. Output ONLY valid JSON. No markdown, no code fences, no explanation, no comments.
2. Root object: { "sections": [ ... ] }
3. Every SECTION in the spec → one section element. Never merge or skip sections.
4. Every text element → copy text VERBATIM. Never paraphrase, summarize, or invent words.
5. Every color → use the EXACT hex from the spec.
6. Every font size → use the EXACT value from the spec (in px).
7. Every font weight → use the EXACT value (e.g. "700", "400", "600").
8. Every button → match background color, text color, border-radius, padding from spec exactly.
9. Every [IMAGE] → image element with src "https://picsum.photos/seed/${imgKwDesign}/800/450".
10. Every [DIVIDER] → a horizontal rule or styled div as a visual separator.
11. [2-COLUMN LAYOUT] or [3-COLUMN LAYOUT] → multiple column elements in the same row, widths from spec.
12. All element IDs: type-XXXXXXXX (8 random alphanumeric chars). Never reuse IDs.
13. Mobile styles: set fontSize to ~60% of desktop, padding to ~50% of desktop.
14. CRITICAL type names: "heading" (NOT headline), "sub-heading" (NOT sub-headline), "paragraph", "button", "image", "bulletList".
15. paragraph "text" = plain string. NO HTML. NO <p> <br> <strong> tags.
16. bulletList "items" = array of plain strings.
17. Section padding: use EXACT padding values from spec. If spec says paddingTop:80px, set paddingTop value to 80.
18. If spec includes a gradient background, encode as CSS gradient string in backgroundColor.value.
19. If spec includes a box-shadow, add it to the section or element styles.
20. fontFamily: if spec specifies a font family, add it to the element's styles as fontFamily.value.

GHL NATIVE JSON SCHEMA:
{"sections":[
  {"id":"section-XXXXXXXX","type":"section","name":"hero","allowRowMaxWidth":false,
   "styles":{"backgroundColor":{"value":"#0F172A"},"paddingTop":{"value":80,"unit":"px"},"paddingBottom":{"value":80,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},
   "mobileStyles":{"paddingTop":{"value":40,"unit":"px"},"paddingBottom":{"value":40,"unit":"px"}},
   "children":[{"id":"row-XXXXXXXX","type":"row","children":[
     {"id":"column-XXXXXXXX","type":"column","width":6,"styles":{"textAlign":{"value":"left"}},"mobileStyles":{},"children":[
       {"id":"heading-XXXXXXXX","type":"heading","text":"Exact headline from spec","tag":"h1",
        "styles":{"color":{"value":"#FFFFFF"},"fontSize":{"value":56,"unit":"px"},"fontWeight":{"value":"700"},"fontFamily":{"value":"Inter"}},"mobileStyles":{"fontSize":{"value":32,"unit":"px"}}},
       {"id":"sub-heading-XXXXXXXX","type":"sub-heading","text":"Exact subheading from spec",
        "styles":{"color":{"value":"#94A3B8"},"fontSize":{"value":24,"unit":"px"},"fontWeight":{"value":"400"}},"mobileStyles":{"fontSize":{"value":18,"unit":"px"}}},
       {"id":"paragraph-XXXXXXXX","type":"paragraph","text":"Plain body text verbatim from spec.",
        "styles":{"color":{"value":"#CBD5E1"},"fontSize":{"value":18,"unit":"px"},"lineHeight":{"value":28,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}},
       {"id":"button-XXXXXXXX","type":"button","text":"Exact CTA text","link":"#",
        "styles":{"backgroundColor":{"value":"#F59E0B"},"color":{"value":"#000000"},"fontSize":{"value":18,"unit":"px"},"fontWeight":{"value":"700"},
         "paddingTop":{"value":16,"unit":"px"},"paddingBottom":{"value":16,"unit":"px"},"paddingLeft":{"value":48,"unit":"px"},"paddingRight":{"value":48,"unit":"px"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{}},
       {"id":"bulletList-XXXXXXXX","type":"bulletList","items":["Feature one verbatim","Feature two verbatim"],
        "icon":{"name":"check","unicode":"f00c","fontFamily":"Font Awesome 5 Free"},
        "styles":{"color":{"value":"#FFFFFF"},"fontSize":{"value":18,"unit":"px"}},"mobileStyles":{}}
     ]},
     {"id":"column-XXXXXXXX","type":"column","width":6,"styles":{"textAlign":{"value":"center"}},"mobileStyles":{},"children":[
       {"id":"image-XXXXXXXX","type":"image","src":"https://picsum.photos/seed/${imgKwDesign}/800/450","alt":"hero image",
        "styles":{"width":{"value":100,"unit":"%"},"borderRadius":{"value":12,"unit":"px"}},"mobileStyles":{}}
     ]}
   ]}]}
]}`;

  const results = [];

  for (let i = 0; i < pages.length; i++) {
    const page     = pages[i];
    const pageType = inferPageType(page.name || '');
    send('page_start', { index: i, pageId: page.id, name: page.name, pageType });

    // Multi-frame mode: load the Figma frame for this specific page
    if (isMultiFrame && figmaFileKey && figmaAuth) {
      const frame = figmaFrames[i] || figmaFrames[figmaFrames.length - 1];
      send('log', { msg: `[${i + 1}/${pages.length}] Loading Figma frame: "${frame.name}"`, level: 'info' });
      try {
        await loadFigmaFrame(figmaFileKey, frame.id, figmaAuth, `[${i + 1}/${pages.length}] `);
      } catch (err) {
        send('log', { msg: `[${i + 1}/${pages.length}] Frame load failed: ${err.message} — using previous frame design`, level: 'warn' });
      }
    }

    send('log', { msg: `[${i + 1}/${pages.length}] Analyzing "${page.name}" with AI vision...`, level: 'info' });

    let pageJson, genError;
    try {
      let visionText;
      if (figmaUrl && figmaContent.spec) {
        // Figma mode: full structural spec is the source of truth; image is visual reference only
        visionText = `Convert the Figma design below into a complete native GHL page JSON for "${page.name}".

The screenshot is provided as visual context. The FIGMA DESIGN SPEC is the authoritative source — it contains the EXACT text, colors, font sizes, font weights, font families, padding, border-radius, and layout from the actual Figma file. Follow every detail in the spec literally.

═══════════════════════════════════════════════════
FIGMA DESIGN SPEC (${figmaContent.sectionCount} sections):
═══════════════════════════════════════════════════
${figmaContent.spec}
═══════════════════════════════════════════════════

CONVERSION INSTRUCTIONS:
1. Create exactly ${figmaContent.sectionCount} section elements — one per ━━━ SECTION in the spec.
2. Each section: set backgroundColor from spec bg: value. Set paddingTop/Bottom/Left/Right from spec padding: values (or 80/80/20/20 if not specified).
3. For every [HEADLINE] → "heading" element (tag:"h1"), [SUBHEADLINE] → "heading" (tag:"h2"), [SUBHEADING] → "sub-heading", [PARAGRAPH] → "paragraph", [CAPTION] → "paragraph".
4. Copy EVERY text string VERBATIM — do not change a single word.
5. For every text element: set fontSize, fontWeight, color, and textAlign EXACTLY from spec. Include fontFamily if spec specifies one.
6. For every [BUTTON]: set backgroundColor, color, fontSize, fontWeight, borderRadius, and all padding values from spec exactly.
7. For every [IMAGE]: use the REAL GHL media URL from the image map below. If the nodeId is not in the map, use "https://picsum.photos/seed/${imgKwDesign}/800/450" as fallback.
   IMAGE URL MAP (nodeId → real uploaded GHL URL):
${Object.keys(figmaImageUrlMap).length > 0
  ? figmaContent.imageNodes.map(n => `   ${n.nodeId}: ${figmaImageUrlMap[n.nodeId] || '(not uploaded — use picsum fallback)'}`).join('\n')
  : '   (no images uploaded — use picsum fallback for all [IMAGE] elements)'}
8. For every [DIVIDER]: insert a visual separator (use a paragraph element with border-bottom style or a dedicated divider).
9. For [2-COLUMN LAYOUT]: create two column elements. Use gridWidth from spec (e.g. 7/12 and 5/12 → width:7 and width:5). Default to width:6 and width:6 if not specified.
10. For [3-COLUMN LAYOUT]: three column elements each with width:4.
11. If spec shows a gradient background (e.g. linear-gradient(...)), use that CSS string as backgroundColor.value.
12. Mobile styles: fontSize = 60% of desktop, paddingTop/Bottom = 50% of desktop.${extraContext ? `\n13. Additional instructions: ${extraContext}` : ''}
14. Add a top-level "figmaCSS" key: a CSS string for ANY effect GHL's native builder cannot achieve — custom Google Fonts (already imported via @import, just add font-family rules on c-heading/c-paragraph), gradient text (background:linear-gradient;-webkit-background-clip:text;-webkit-text-fill-color:transparent), glassmorphism (backdrop-filter:blur(...)), box-shadow on c-column or c-section, hover states, clip-path, or other advanced CSS. Target GHL elements: c-section, c-row, c-column, c-heading, c-paragraph, c-button, c-image. If nothing special is needed, set "figmaCSS":"".

Output ONLY the JSON object. No markdown, no explanation.`;
      } else {
        // Image upload mode
        const figmaColorNote = figmaContent.colors.length > 0
          ? `\n\nEXACT COLORS FROM DESIGN:\n${figmaContent.colors.join(', ')}`
          : '';
        visionText = `Reconstruct this design screenshot as a native GHL ${pageType} JSON for page "${page.name}".

CRITICAL requirements:
- Match the EXACT number of sections visible in the design
- Preserve every section's background color, padding, and layout
- Extract ALL text verbatim
- For every image/photo/visual → add an image element with src "https://picsum.photos/seed/${imgKwDesign}/800/450"
- For side-by-side layouts → use two column elements (width:6 each) in the same row
- Match button colors exactly from the design${figmaColorNote}${extraContext ? `\n\nUser notes: ${extraContext}` : ''}

Output ONLY the JSON object. No explanation.`;
      }
      const isTooLarge = (e) => {
        const m = e?.message || '';
        return m.toLowerCase().includes('too large') || m.includes('request_too_large') || m.includes('413') || m.startsWith('<') || m.includes('<html');
      };

      const minimalSystem = `You are a GHL page builder. Output ONLY valid JSON: {"sections":[...]}. Each section has id, type:"section", styles:{backgroundColor,paddingTop,paddingBottom,paddingLeft,paddingRight}, children:[rows→columns→elements]. Element types: heading(tag,text,styles), sub-heading, paragraph(text), button(text,link,styles), image(src,styles), bulletList(items[]). All styles use {"value":X,"unit":"px"} format. IDs: type-XXXXXXXX.`;
      const imageOnlyPrompt = `Reconstruct this design as GHL JSON. Match every section, color, text, and layout. Output ONLY the JSON object.`;

      // Helper: try vision call, return null on too-large errors
      const tryVision = async (sys, usr, b64, mime, opts) => {
        try {
          const t = (await aiDesign.generateWithVision(sys, usr, b64, mime, opts)).trim();
          if (t.startsWith('<')) return null; // HTML error page
          return t;
        } catch (e) {
          if (isTooLarge(e)) return null;
          throw e;
        }
      };

      // Attempt 1: full prompt + image at normal quality
      let rawText = await tryVision(systemPrompt, visionText, imageBase64, imageMediaType, { maxTokens: 8192 });

      // Attempt 2: truncated spec + image
      if (rawText === null) {
        send('log', { msg: `Response too large — retrying with truncated spec...`, level: 'warn' });
        console.warn(`[FunnelBuilder] Too large for "${page.name}" — retrying with truncated spec`);
        const truncated = visionText.length > 3000
          ? visionText.slice(0, 3000) + '\n...(truncated)\nOutput ONLY the JSON object.'
          : visionText;
        rawText = await tryVision(systemPrompt, truncated, imageBase64, imageMediaType, { maxTokens: 5000 });
      }

      // Attempt 3: minimal system + image only
      if (rawText === null) {
        send('log', { msg: `Still too large — switching to image-only mode...`, level: 'warn' });
        console.warn(`[FunnelBuilder] Still too large for "${page.name}" — retrying image-only`);
        rawText = await tryVision(minimalSystem, imageOnlyPrompt, imageBase64, imageMediaType, { maxTokens: 4096 });
      }

      // Attempt 4: re-export at scale=0.5 (JPEG, smallest possible) + minimal prompt
      if (rawText === null) {
        send('log', { msg: `Retrying with half-scale JPEG to reduce image size...`, level: 'warn' });
        console.warn(`[FunnelBuilder] Still too large for "${page.name}" — retrying with half-scale JPEG`);
        try {
          const { fileKey: fk, nodeId: fn } = parseFigmaUrl(figmaUrl || '');
          const smallData = await httpsGet('api.figma.com',
            `/v1/images/${fk}?ids=${encodeURIComponent(fn || effectiveNodeId || '0:1')}&format=jpg&scale=0.5`,
            figmaAuth?.authHeader || {}
          );
          const smallUrl = smallData?.images?.[fn || effectiveNodeId || '0:1'];
          if (smallUrl) {
            const smallBuf = await downloadUrl(smallUrl);
            rawText = await tryVision(minimalSystem, imageOnlyPrompt, smallBuf.toString('base64'), 'image/jpeg', { maxTokens: 4096 });
          }
        } catch { /* ignore — fall through to failure */ }
      }

      if (rawText === null) throw new Error('Design is too large for AI vision even after all size-reduction attempts. Try selecting a smaller frame in Figma.');

      console.log(`[FunnelBuilder] Vision raw output for "${page.name}" (first 300 chars):`, rawText.slice(0, 300));
      send('log', { msg: `AI response received — parsing JSON...`, level: 'info' });
      pageJson = parseJsonSafe(rawText);
      if (!pageJson.sections || !Array.isArray(pageJson.sections)) throw new Error('AI response missing "sections" array.');
      send('log', { msg: `Parsed ${pageJson.sections.length} sections — saving to GHL...`, level: 'info' });
    } catch (err) {
      genError = err;
      console.error(`[FunnelBuilder] Vision error for "${page.name}":`, err.message);
    }

    if (genError) {
      send('log', { msg: `"${page.name}" failed: ${genError.message}`, level: 'error' });
      send('page_error', { index: i, pageId: page.id, name: page.name, error: `AI generation failed: ${genError.message}` });
      results.push({ pageId: page.id, name: page.name, success: false, error: genError.message });
      continue;
    }

    try {
      const saveRes = await saveWithFunnelHint(req.locationId, page.id, pageJson, funnelId, colorScheme, { figmaFonts: figmaContent.fonts || [] });
      const warn    = saveRes?.firestoreWarning;
      send('log', { msg: `"${page.name}" saved — ${pageJson.sections.length} sections`, level: 'success' });
      send('page_done', { index: i, pageId: page.id, name: page.name, pageType, sectionsCount: pageJson.sections.length, warning: warn || undefined });
      results.push({ pageId: page.id, name: page.name, pageType, success: true, sectionsCount: pageJson.sections.length, warning: warn || undefined });
    } catch (err) {
      const errMsg = err?.message || String(err);
      console.error(`[FunnelBuilder] Save error for "${page.name}":`, errMsg);
      send('log', { msg: `Save failed for "${page.name}": ${errMsg}`, level: 'error' });
      send('page_error', { index: i, pageId: page.id, name: page.name, error: `Save failed: ${errMsg}` });
      results.push({ pageId: page.id, name: page.name, success: false, error: errMsg });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const firstPageId = results.find(r => r.success)?.pageId;
  const domain = (req.body.appDomain || 'https://app.gohighlevel.com').replace(/\/$/, '');
  const previewUrl = firstPageId ? `${domain}/v2/preview/${firstPageId}` : null;
  send('complete', { total: pages.length, succeeded, failed: pages.length - succeeded, results, previewUrl });
  res.end();
});

// ── POST /write-test-sections — write known-good GHL native sections to Firestore ──
// Usage: POST /funnel-builder/write-test-sections { pageId }
// Writes hardcoded sections from a confirmed-working GHL native AI page,
// to test whether the write mechanism works regardless of our generated format.

router.post('/write-test-sections', async (req, res) => {
  const { pageId } = req.body;
  if (!pageId) return res.status(400).json({ error: '"pageId" required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  // Minimal known-good section from GHL's native AI (confirmed working format)
  const testSections = [
    {
      id: 'section-test-native',
      type: 'section',
      name: 'Test Hero',
      allowRowMaxWidth: false,
      styles: {
        backgroundColor: { value: '#FFFFFF' },
        paddingTop:       { value: 80, unit: 'px' },
        paddingRight:     { value: 20, unit: 'px' },
        paddingBottom:    { value: 80, unit: 'px' },
        paddingLeft:      { value: 20, unit: 'px' },
      },
      mobileStyles: {
        paddingTop:    { value: 40, unit: 'px' },
        paddingRight:  { value: 15, unit: 'px' },
        paddingBottom: { value: 40, unit: 'px' },
        paddingLeft:   { value: 15, unit: 'px' },
      },
      children: [{
        id:   'row-test-native',
        type: 'row',
        children: [{
          id:    'column-test-native',
          type:  'column',
          width: 12,
          styles: {
            textAlign:                  { value: 'center' },
            forceColumnLayoutForMobile: { value: false },
            marginTop:                  { value: 0,      unit: 'px' },
            marginRight:                { value: 'auto', unit: ''   },
            marginBottom:               { value: 0,      unit: 'px' },
            marginLeft:                 { value: 'auto', unit: ''   },
            justifyContentColumnLayout: { value: 'flex-start' },
          },
          mobileStyles: {
            marginTop:    { value: 0,      unit: 'px' },
            marginRight:  { value: 'auto', unit: ''   },
            marginBottom: { value: 0,      unit: 'px' },
            marginLeft:   { value: 'auto', unit: ''   },
          },
          children: [
            {
              id:   'heading-test-native',
              type: 'heading',
              text: 'Hello from HL Pro Tools AI',
              tag:  'h1',
              styles: {
                color:         { value: '#0F172A' },
                fontSize:      { value: 56, unit: 'px' },
                lineHeight:    { value: 1.05, unit: 'em' },
                textAlign:     { value: 'center' },
                marginTop:     { value: 0,  unit: 'px' },
                marginRight:   { value: 0,  unit: 'px' },
                marginBottom:  { value: 20, unit: 'px' },
                marginLeft:    { value: 0,  unit: 'px' },
                typography:    { value: 'var(--headlinefont)' },
                linkTextColor: { value: '#0F172A' },
              },
              mobileStyles: {
                fontSize:      { value: 40,  unit: 'px' },
                lineHeight:    { value: 1.1, unit: 'em' },
                marginTop:     { value: 0,   unit: 'px' },
                marginRight:   { value: 0,   unit: 'px' },
                marginBottom:  { value: 16,  unit: 'px' },
                marginLeft:    { value: 0,   unit: 'px' },
              },
            },
            {
              id:    'paragraph-test-native',
              type:  'paragraph',
              text:  'This test section was written by HL Pro Tools to verify the GHL editor renders our format correctly.',
              styles: {
                color:         { value: '#6B7280' },
                fontSize:      { value: 18, unit: 'px' },
                lineHeight:    { value: 1.6, unit: 'em' },
                textAlign:     { value: 'center' },
                marginTop:     { value: 0,  unit: 'px' },
                marginRight:   { value: 0,  unit: 'px' },
                marginBottom:  { value: 30, unit: 'px' },
                marginLeft:    { value: 0,  unit: 'px' },
                typography:    { value: 'var(--contentfont)' },
                linkTextColor: { value: '#6B7280' },
              },
              mobileStyles: {
                fontSize:     { value: 16, unit: 'px' },
                marginBottom: { value: 24, unit: 'px' },
              },
            },
          ],
        }],
      }],
    },
  ];

  // Write to Firestore using same method as savePageData
  const { savePageData } = require('../services/ghlPageBuilder');
  try {
    const result = await savePageData(req.locationId, pageId, { sections: testSections }, {});
    res.json({ success: true, message: 'Test sections written to Firestore + Storage', result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /ghl-push — push sections directly to GHL's backend save API ─────────
// Usage: POST /funnel-builder/ghl-push { pageId, funnelId }
// Tries known GHL backend endpoints to write sections, similar to what GHL's
// native AI does internally. This finds + uses the correct save API.

router.post('/ghl-push', async (req, res) => {
  const { pageId, funnelId } = req.body;
  if (!pageId) return res.status(400).json({ error: '"pageId" required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  const { buildBackendHeaders } = require('../services/ghlPageBuilder');
  const beHeaders = { ...buildBackendHeaders(idToken), 'Content-Type': 'application/json' };

  // Read current Firestore sections to push
  const projectId = 'highlevel-backend';
  const fsPath    = `/v1/projects/${projectId}/databases/(default)/documents/funnel_pages/${pageId}`;
  const fsRes = await new Promise(resolve => {
    const r2 = https.request({ hostname: 'firestore.googleapis.com', path: fsPath, method: 'GET', headers: { Authorization: `Bearer ${idToken}` } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } }); });
    r2.on('error', () => resolve({}));
    r2.end();
  });

  // Decode sections from Firestore arrayValue
  function decodeFirestore(v) {
    if (!v) return null;
    if ('stringValue'  in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue'  in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue'    in v) return null;
    if ('arrayValue'   in v) return (v.arrayValue.values || []).map(decodeFirestore);
    if ('mapValue'     in v) {
      const o = {};
      for (const [k, fv] of Object.entries(v.mapValue.fields || {})) o[k] = decodeFirestore(fv);
      return o;
    }
    return null;
  }

  const rawSections = fsRes?.fields?.sections;
  const sections    = rawSections ? decodeFirestore(rawSections) : [];
  const downloadUrl = fsRes?.fields?.page_data_download_url?.stringValue || '';

  const tryPost = (path, body) => new Promise(resolve => {
    const payload = JSON.stringify(body);
    const r2 = https.request(
      { hostname: 'backend.leadconnectorhq.com', path, method: 'POST',
        headers: { ...beHeaders, 'Content-Length': Buffer.byteLength(payload) } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve({ path, status: r.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ path, status: r.statusCode, data: d.slice(0, 200) }); }
      }); });
    r2.on('error', e => resolve({ path, status: 0, error: e.message }));
    r2.write(payload); r2.end();
  });

  const tryPut = (path, body) => new Promise(resolve => {
    const payload = JSON.stringify(body);
    const r2 = https.request(
      { hostname: 'backend.leadconnectorhq.com', path, method: 'PUT',
        headers: { ...beHeaders, 'Content-Length': Buffer.byteLength(payload) } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve({ path, status: r.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ path, status: r.statusCode, data: d.slice(0, 200) }); }
      }); });
    r2.on('error', e => resolve({ path, status: 0, error: e.message }));
    r2.write(payload); r2.end();
  });

  const pagePayload = { sections, pageDataDownloadUrl: downloadUrl, pageDataUrl: downloadUrl };

  const results = await Promise.all([
    tryPost(`/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, pagePayload),
    tryPut(`/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, pagePayload),
    tryPost(`/funnels/page/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, pagePayload),
    tryPut(`/funnels/page/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, pagePayload),
    tryPost(`/funnel-ai/copilot/save/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, pagePayload),
    tryPost(`/funnels/${funnelId || 'x'}/pages/${pageId}/save`, pagePayload),
  ]);

  const success = results.filter(r => r.status >= 200 && r.status < 300);
  res.json({ sectionsAvailable: sections.length, results: results.map(r => ({ path: r.path, status: r.status })), successPaths: success.map(r => r.path), successDetails: success });
});

// ── POST /copilot-push — push current Firestore sections via GHL's native copilot API ──
// Usage: POST /funnel-builder/copilot-push { pageId }
// Reads what's currently in Firestore for this page and POSTs it to GHL's
// funnel-ai/copilot/page-data endpoint — the same endpoint GHL's "Ask AI" uses.
// If this makes the editor show content, we know the copilot endpoint is required.

router.post('/copilot-push', async (req, res) => {
  const { pageId } = req.body;
  if (!pageId) return res.status(400).json({ error: '"pageId" required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  const { buildBackendHeaders } = require('../services/ghlPageBuilder');
  const beHeaders = buildBackendHeaders(idToken);
  const projectId = 'highlevel-backend';

  // 1. Read current sections from Firestore
  const fsPath = `/v1/projects/${projectId}/databases/(default)/documents/funnel_pages/${pageId}`;
  const fsRes  = await new Promise(resolve => {
    const r2 = https.request({ hostname: 'firestore.googleapis.com', path: fsPath, method: 'GET', headers: { Authorization: `Bearer ${idToken}` } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d }); } }); });
    r2.on('error', e => resolve({ status: 0, error: e.message }));
    r2.end();
  });

  if (fsRes.status >= 400) return res.status(fsRes.status).json({ error: 'Firestore read failed', data: fsRes.data });

  // Decode Firestore values to plain JS
  function decodeFS(v) {
    if (!v) return null;
    if ('stringValue'  in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue'  in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue'    in v) return null;
    if ('arrayValue'   in v) return (v.arrayValue.values || []).map(decodeFS);
    if ('mapValue'     in v) { const o = {}; for (const [k, fv] of Object.entries(v.mapValue.fields || {})) o[k] = decodeFS(fv); return o; }
    return null;
  }

  const f           = fsRes.data?.fields || {};
  const sections    = decodeFS(f.sections);
  const downloadUrl = f.page_data_download_url?.stringValue || '';
  const storagePath = f.page_data_url?.stringValue || '';
  const sv          = Number(f.section_version?.integerValue || 1);
  const pv          = Number(f.page_version?.integerValue || 1);
  const ver         = Number(f.version?.integerValue || 1);

  if (!sections || !sections.length) {
    return res.status(400).json({ error: 'No sections in Firestore for this page. Generate content first.' });
  }

  // 2. POST to GHL copilot save endpoint
  const copilotBody = JSON.stringify({ sections, pageDataDownloadUrl: downloadUrl, pageDataUrl: storagePath, sectionVersion: sv, pageVersion: pv, version: ver });
  const copilotPath = `/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(req.locationId)}`;
  const copilotRes  = await new Promise(resolve => {
    const r2 = https.request(
      { hostname: 'backend.leadconnectorhq.com', path: copilotPath, method: 'POST',
        headers: { ...beHeaders, 'Content-Length': Buffer.byteLength(copilotBody) } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d.slice(0, 500) }); } }); }
    );
    r2.on('error', e => resolve({ status: 0, error: e.message }));
    r2.write(copilotBody);
    r2.end();
  });

  res.json({
    message:       'Copilot push attempted',
    sectionsCount: sections.length,
    copilotPath,
    copilotStatus: copilotRes.status,
    copilotData:   copilotRes.data,
  });
});

// ── GET /ghl-raw — call GHL's actual backend APIs and return raw responses ─────
// Usage: GET /funnel-builder/ghl-raw?pageId=xxx
// Calls ALL known GHL backend endpoints for a page so we can see exactly what
// GHL's editor reads (vs what we write to Firestore/Storage).

router.get('/ghl-raw', async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '"pageId" query param required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  const { buildBackendHeaders } = require('../services/ghlPageBuilder');
  const beHeaders = buildBackendHeaders(idToken);
  delete beHeaders['Content-Type'];

  const callGHL = (hostname, path, extraHeaders = {}) => new Promise(resolve => {
    const req2 = https.request(
      { hostname, path, method: 'GET', headers: { ...beHeaders, ...extraHeaders } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, data: d }); }
      }); }
    );
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.end();
  });

  // Probe multiple GHL backend paths to find where the editor reads sections from
  const [copilotData, funnelPage, funnelPageV2] = await Promise.all([
    callGHL('backend.leadconnectorhq.com', `/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(req.locationId)}`),
    callGHL('backend.leadconnectorhq.com', `/funnels/page/${pageId}?locationId=${encodeURIComponent(req.locationId)}`),
    callGHL('backend.leadconnectorhq.com', `/funnels/page/${pageId}`),
  ]);

  // Summarize what each endpoint returned
  const summarize = (r) => ({
    status: r.status,
    error: r.error,
    keys: typeof r.data === 'object' && r.data ? Object.keys(r.data) : null,
    hasSections: typeof r.data === 'object' && r.data
      ? (Array.isArray(r.data.sections) ? `array[${r.data.sections.length}]` :
         typeof r.data.sections !== 'undefined' ? 'present (non-array)' : 'absent')
      : null,
    firstSection: typeof r.data === 'object' && Array.isArray(r.data.sections)
      ? JSON.stringify(r.data.sections[0]).slice(0, 600) : null,
    // Critical: show the actual URL the editor would download for page content
    pageDataDownloadUrl: r.data?.pageDataDownloadUrl ?? null,
    pageDataUrl:         r.data?.pageDataUrl ?? null,
    sectionVersion:      r.data?.sectionVersion ?? null,
    pageVersion:         r.data?.pageVersion ?? null,
    version:             r.data?.version ?? null,
    rawSlice: typeof r.data === 'string' ? r.data.slice(0, 300) : null,
  });

  // Also try to download the actual file from GHL's pageDataDownloadUrl
  const pageData = funnelPage.data?.pageDataDownloadUrl || funnelPageV2.data?.pageDataDownloadUrl;
  let storageContent = null;
  if (pageData) {
    try {
      const u = new URL(pageData);
      storageContent = await new Promise(resolve => {
        const req2 = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET' },
          (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
            try { resolve({ ok: true, keys: Object.keys(JSON.parse(d)), sectionCount: JSON.parse(d)?.sections?.length }); }
            catch { resolve({ ok: false, raw: d.slice(0, 200) }); }
          }); });
        req2.on('error', e => resolve({ ok: false, error: e.message }));
        req2.end();
      });
    } catch (e) { storageContent = { error: e.message }; }
  }

  res.json({
    pageId,
    locationId: req.locationId,
    '/funnel-ai/copilot/page-data': summarize(copilotData),
    '/funnels/page/{pageId}?locationId': summarize(funnelPage),
    '/funnels/page/{pageId}': summarize(funnelPageV2),
    storageFileFromGhlUrl: storageContent,
  });
});

// ── GET /copilot-get — call GHL OAuth copilot GET + try PUT to trigger editor ──
// Tests the copilot endpoint that GHL's native AI uses to save sections.
// Usage: GET /funnel-builder/copilot-get?pageId=xxx

router.get('/copilot-get', async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '"pageId" required' });

  const results = {};

  // Try GET via OAuth client (services.leadconnectorhq.com)
  try {
    const getResp = await ghlClient.ghlRequest(
      req.locationId, 'GET',
      `/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(req.locationId)}`,
      null, { locationId: req.locationId }
    );
    results.copilotGet = { ok: true, data: getResp };
  } catch (err) {
    results.copilotGet = { ok: false, error: err.message, status: err.status };
  }

  // Also try a few other plausible paths via OAuth
  for (const path of [
    `/funnel-ai/copilot/sections/${pageId}?locationId=${encodeURIComponent(req.locationId)}`,
    `/funnels/page-builder/${pageId}?locationId=${encodeURIComponent(req.locationId)}`,
    `/funnel-ai/page/${pageId}?locationId=${encodeURIComponent(req.locationId)}`,
  ]) {
    try {
      const r = await ghlClient.ghlRequest(req.locationId, 'GET', path, null, { locationId: req.locationId });
      results[path] = { ok: true, keys: Object.keys(r || {}), data: r };
    } catch (err) {
      results[path] = { ok: false, status: err.status, error: err.message?.slice(0, 100) };
    }
  }

  res.json(results);
});

// ── GET /copilot-full — full untruncated copilot GET via Firebase backend token ─
// This shows EXACTLY what the GHL editor reads from the copilot endpoint.
// If our POST worked, sections will appear here. If empty/different, we know the POST format is wrong.
// Usage: GET /funnel-builder/copilot-full?pageId=xxx

router.get('/copilot-full', async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '"pageId" required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected' }); }

  const { buildBackendHeaders } = require('../services/ghlPageBuilder');
  const beHeaders = buildBackendHeaders(idToken);
  delete beHeaders['Content-Type'];

  const copilotPath = `/funnel-ai/copilot/page-data/${pageId}?locationId=${encodeURIComponent(req.locationId)}`;

  // GET copilot endpoint via Firebase backend token (same path our POST targets)
  const cpGet = await new Promise(resolve => {
    const r2 = https.request(
      { hostname: 'backend.leadconnectorhq.com', path: copilotPath, method: 'GET', headers: beHeaders },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, data: d }); }
      }); }
    );
    r2.on('error', e => resolve({ status: 0, error: e.message }));
    r2.end();
  });

  // Also GET /funnels/page/{pageId} for comparison
  const pageGet = await new Promise(resolve => {
    const r2 = https.request(
      { hostname: 'backend.leadconnectorhq.com', path: `/funnels/page/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, method: 'GET', headers: beHeaders },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, data: d }); }
      }); }
    );
    r2.on('error', e => resolve({ status: 0, error: e.message }));
    r2.end();
  });

  const cpData = cpGet.data;
  const pgData = pageGet.data;

  res.json({
    pageId,
    // ── Copilot endpoint (/funnel-ai/copilot/page-data) ──────────────────
    copilotEndpoint: {
      status:          cpGet.status,
      topLevelKeys:    typeof cpData === 'object' && cpData ? Object.keys(cpData) : null,
      hasSections:     Array.isArray(cpData?.sections) ? `array[${cpData.sections.length}]` : typeof cpData?.sections,
      sectionVersion:  cpData?.sectionVersion,
      pageVersion:     cpData?.pageVersion,
      version:         cpData?.version,
      firstSectionFull: Array.isArray(cpData?.sections) ? cpData.sections[0] : null,
      rawSlice:        typeof cpData === 'string' ? cpData.slice(0, 500) : null,
    },
    // ── Regular page endpoint (/funnels/page) ────────────────────────────
    pageEndpoint: {
      status:         pageGet.status,
      hasSections:    Array.isArray(pgData?.sections) ? `array[${pgData.sections.length}]` : typeof pgData?.sections,
      sectionVersion: pgData?.sectionVersion,
      firstSectionFull: Array.isArray(pgData?.sections) ? pgData.sections[0] : null,
    },
  });
});

// ── GET /ghl-full — return the raw untruncated GHL backend response for a page ─
// Usage: GET /funnel-builder/ghl-full?pageId=xxx

router.get('/ghl-full', async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '"pageId" required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected' }); }

  const { buildBackendHeaders } = require('../services/ghlPageBuilder');
  const beHeaders = buildBackendHeaders(idToken);
  delete beHeaders['Content-Type'];

  const result = await new Promise(resolve => {
    const r2 = https.request(
      { hostname: 'backend.leadconnectorhq.com', path: `/funnels/page/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, method: 'GET', headers: beHeaders },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, raw: d.slice(0, 500) }); } }); }
    );
    r2.on('error', e => resolve({ status: 0, error: e.message }));
    r2.end();
  });

  if (!result.data) return res.json(result);

  const d = result.data;
  // Return key diagnostic fields without sections (sections are large)
  res.json({
    status:          result.status,
    deleted:         d.deleted,
    templateType:    d.templateType,
    url:             d.url,
    name:            d.name,
    stepId:          d.stepId,
    funnelId:        d.funnelId,
    locationId:      d.locationId,
    sectionVersion:  d.sectionVersion,
    pageVersion:     d.pageVersion,
    version:         d.version,
    sectionCount:    Array.isArray(d.sections) ? d.sections.length : 'not array',
    firstElementTypes: Array.isArray(d.sections) && d.sections[0]
      ? (d.sections[0].children?.[0]?.children?.[0]?.children || []).map(e => `${e.type}:${(e.text||'').slice(0,30)}`)
      : null,
    pageDataDownloadUrl: d.pageDataDownloadUrl,
    colorsPresent:   !!d.colors,
    popupsPresent:   Array.isArray(d.popups) ? d.popups.length : 0,
    previewSnapshot: d.previewSnapshot ? d.previewSnapshot.slice(0, 100) : null,
  });
});

// ── GET /editor-check — returns FULL decoded sections from GHL API + Storage ──
// Shows exactly what the GHL page editor would see when it opens the page.
// Usage: GET /funnel-builder/editor-check?pageId=xxx

router.get('/editor-check', async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '"pageId" required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected' }); }

  const { buildBackendHeaders } = require('../services/ghlPageBuilder');
  const beHeaders = buildBackendHeaders(idToken);
  delete beHeaders['Content-Type'];

  // Step 1: fetch from GHL backend API (same call the editor makes)
  const apiResult = await new Promise(resolve => {
    const r2 = https.request(
      { hostname: 'backend.leadconnectorhq.com', path: `/funnels/page/${pageId}?locationId=${encodeURIComponent(req.locationId)}`, method: 'GET', headers: beHeaders },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode }); } }); }
    );
    r2.on('error', e => resolve({ status: 0, error: e.message }));
    r2.end();
  });

  // Step 2: decode each section and its full element tree from the API response
  const apiSections = apiResult.data?.sections || [];
  const decodedSections = apiSections.map((section, si) => {
    const rows    = section.children || [];
    const allElems = [];
    rows.forEach(row => {
      (row.children || []).forEach(col => {
        (col.children || []).forEach(el => {
          allElems.push({
            type:  el.type,
            id:    el.id,
            text:  el.text  || undefined,
            items: el.items || undefined,
            tag:   el.tag   || undefined,
            link:  el.link  || undefined,
            stylesKeys:       Object.keys(el.styles       || {}),
            mobileStylesKeys: Object.keys(el.mobileStyles || {}),
          });
        });
      });
    });
    return {
      sectionIndex: si,
      sectionId:    section.id,
      sectionName:  section.name,
      bgColor:      section.styles?.backgroundColor?.value,
      elementCount: allElems.length,
      elements:     allElems,
    };
  });

  // Step 3: also download the Storage file and decode it
  const dlUrl = apiResult.data?.pageDataDownloadUrl;
  let storageDecoded = null;
  if (dlUrl) {
    try {
      const u2 = new URL(dlUrl);
      const storageRaw = await new Promise(resolve => {
        const r3 = https.request({ hostname: u2.hostname, path: u2.pathname + u2.search, method: 'GET' },
          (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
        r3.on('error', () => resolve(null));
        r3.end();
      });
      if (storageRaw?.sections) {
        storageDecoded = storageRaw.sections.map((section, si) => {
          const allElems = [];
          (section.children || []).forEach(row => {
            (row.children || []).forEach(col => {
              (col.children || []).forEach(el => {
                allElems.push({ type: el.type, id: el.id, text: el.text || undefined, items: el.items || undefined });
              });
            });
          });
          return { sectionIndex: si, sectionId: section.id, elementCount: allElems.length, elements: allElems };
        });
      }
    } catch (e) { storageDecoded = { error: e.message }; }
  }

  res.json({
    apiStatus:        apiResult.status,
    sectionVersion:   apiResult.data?.sectionVersion,
    pageVersion:      apiResult.data?.pageVersion,
    totalSections:    decodedSections.length,
    sectionsFromAPI:  decodedSections,
    sectionsFromStorage: storageDecoded,
    match: JSON.stringify(decodedSections.map(s => s.elements.map(e => e.type))) ===
           JSON.stringify((storageDecoded || []).map(s => s.elements.map(e => e.type))),
  });
});

// ── GET /page-data — fetch existing GHL page data from Firestore + Storage ────
// Usage: GET /funnel-builder/page-data?pageId=xxx

router.get('/page-data', async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '"pageId" query param required' });

  let idToken;
  try { idToken = await getFirebaseToken(req.locationId); }
  catch (err) { return res.status(400).json({ error: 'Firebase not connected', detail: err.message }); }

  const projectId = 'highlevel-backend';
  const fsPath    = `/v1/projects/${projectId}/databases/(default)/documents/funnel_pages/${pageId}`;
  const fsRes     = await new Promise(resolve => {
    const req2 = https.request(
      { hostname: 'firestore.googleapis.com', path: fsPath, method: 'GET', headers: { Authorization: `Bearer ${idToken}` } },
      (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d }); } }); }
    );
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.end();
  });

  if (fsRes.status >= 400) return res.status(fsRes.status).json({ error: 'Firestore read failed', data: fsRes.data });

  const fields      = fsRes.data?.fields || {};
  const downloadUrl = fields.page_data_download_url?.stringValue;
  const sectionsRaw = fields.sections;

  let storageFile = null;
  if (downloadUrl) {
    const u    = new URL(downloadUrl);
    storageFile = await new Promise(resolve => {
      const req2 = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET' },
        (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); }
      );
      req2.on('error', () => resolve(null));
      req2.end();
    });
  }

  // Extract key metadata fields
  const sectionVersion = fields.section_version?.integerValue ?? fields.section_version?.stringValue ?? null;
  const pageVersion    = fields.page_version?.integerValue    ?? fields.page_version?.stringValue    ?? null;
  const templateType   = fields.template_type?.stringValue ?? null;

  res.json({
    pageId,
    firestoreFields:     Object.keys(fields),
    section_version:     sectionVersion,
    page_version:        pageVersion,
    template_type:       templateType,
    downloadUrl,
    // First section from Storage file (what GHL builder actually reads)
    storageFirstSection: Array.isArray(storageFile?.sections) ? storageFile.sections[0] : storageFile,
    storageSectionCount: Array.isArray(storageFile?.sections) ? storageFile.sections.length : null,
    // First section from Firestore sections field (decoded)
    firestoreSectionsPresent: !!sectionsRaw,
    firestoreSectionsSample:  sectionsRaw ? JSON.stringify(sectionsRaw).slice(0, 800) : null,
  });
});

// ── GET /list-pages — list pages in a funnel (debug / fetch) ─────────────────
// Usage: GET /funnel-builder/list-pages?funnelId=xxx

router.get('/list-pages', async (req, res) => {
  const { funnelId } = req.query;
  if (!funnelId) return res.status(400).json({ error: '"funnelId" query param required' });

  try {
    const result = await ghlClient.ghlRequest(req.locationId, 'GET', '/funnels/page', null, {
      locationId: req.locationId,
      funnelId,
      limit: 20,
      offset: '0',
    });
    const pages = result?.funnelPages || result?.pages || result?.pageList || result?.list || result?.data
               || (Array.isArray(result) ? result : []);
    res.json({ funnelId, count: pages.length, pages });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST /generate-funnel — list all funnel pages then generate each ──────────

/**
 * Curated design templates — each maps a niche pattern to a complete visual spec
 * including gradient backgrounds, accent colors, section alternation, and emphasis style.
 * Used as the "reference design" before content generation begins.
 */
const FUNNEL_DESIGN_TEMPLATES = [
  {
    id: 'fitness-transform',
    niches: /fitness|health|gym|weight|workout|nutrition|diet|sport|body|muscle|slim/,
    name: 'Fitness Transformation',
    palette: {
      heroBg: '#0A1628',
      heroGradient: 'linear-gradient(135deg, #0A1628 0%, #064E3B 100%)',
      ctaGradient:  'linear-gradient(135deg, #064E3B 0%, #0A1628 100%)',
      primary: '#10B981', buttonColor: '#FFFFFF',
      sectionBg: '#F0FDF4', altSectionBg: '#FFFFFF',
      heroText: '#FFFFFF', bodyText: '#111827',
    },
    emphasis: 'transformation results, before/after, speed of results',
    ctaStyle: 'urgency + social proof counter',
  },
  {
    id: 'beauty-luxury',
    niches: /beauty|spa|skin|hair|wellness|luxury|fashion|style|cosmetic|aesthetic/,
    name: 'Beauty & Luxury',
    palette: {
      heroBg: '#1A0A1C',
      heroGradient: 'linear-gradient(135deg, #1A0A1C 0%, #3B0764 100%)',
      ctaGradient:  'linear-gradient(135deg, #3B0764 0%, #1A0A1C 100%)',
      primary: '#D946EF', buttonColor: '#FFFFFF',
      sectionBg: '#FDF4FF', altSectionBg: '#FFFFFF',
      heroText: '#FFFFFF', bodyText: '#111827',
    },
    emphasis: 'transformation, confidence, exclusive experience',
    ctaStyle: 'elegance + scarcity',
  },
  {
    id: 'real-estate',
    niches: /real.?estate|property|home|realt|mortgage|house|land|invest.*prop/,
    name: 'Real Estate Pro',
    palette: {
      heroBg: '#0C1A2E',
      heroGradient: 'linear-gradient(135deg, #0C1A2E 0%, #1E3A5F 100%)',
      ctaGradient:  'linear-gradient(135deg, #1E3A5F 0%, #0C1A2E 100%)',
      primary: '#F59E0B', buttonColor: '#111827',
      sectionBg: '#FFFBF0', altSectionBg: '#FFFFFF',
      heroText: '#FFFFFF', bodyText: '#111827',
    },
    emphasis: 'ROI, market data, local expertise, trust',
    ctaStyle: 'authority + urgency (limited inventory)',
  },
  {
    id: 'coaching-education',
    niches: /coach|consult|mentor|training|course|education|teach|learn|certif|program/,
    name: 'Expert Coaching',
    palette: {
      heroBg: '#1E1B4B',
      heroGradient: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
      ctaGradient:  'linear-gradient(135deg, #4338CA 0%, #1E1B4B 100%)',
      primary: '#7C3AED', buttonColor: '#FFFFFF',
      sectionBg: '#F5F3FF', altSectionBg: '#FFFFFF',
      heroText: '#FFFFFF', bodyText: '#111827',
    },
    emphasis: 'authority, transformation stories, curriculum value',
    ctaStyle: 'enrollment urgency + community',
  },
  {
    id: 'finance-wealth',
    niches: /finance|invest|money|wealth|crypto|trading|insurance|loan|debt|retire/,
    name: 'Finance & Wealth',
    palette: {
      heroBg: '#0F2027',
      heroGradient: 'linear-gradient(135deg, #0F2027 0%, #203A43 50%, #2C5364 100%)',
      ctaGradient:  'linear-gradient(135deg, #2C5364 0%, #0F2027 100%)',
      primary: '#059669', buttonColor: '#FFFFFF',
      sectionBg: '#F0FDF4', altSectionBg: '#FFFFFF',
      heroText: '#FFFFFF', bodyText: '#111827',
    },
    emphasis: 'ROI, security, proven track record, risk reversal',
    ctaStyle: 'data-driven + guarantee',
  },
  {
    id: 'food-restaurant',
    niches: /restaurant|food|chef|catering|cafe|bakery|dining|meal|recipe/,
    name: 'Food & Hospitality',
    palette: {
      heroBg: '#1C0A0A',
      heroGradient: 'linear-gradient(135deg, #1C0A0A 0%, #7F1D1D 100%)',
      ctaGradient:  'linear-gradient(135deg, #7F1D1D 0%, #1C0A0A 100%)',
      primary: '#DC2626', buttonColor: '#FFFFFF',
      sectionBg: '#FFF5F5', altSectionBg: '#FFFFFF',
      heroText: '#FFFFFF', bodyText: '#111827',
    },
    emphasis: 'taste, experience, freshness, atmosphere',
    ctaStyle: 'appetite + exclusivity',
  },
  {
    id: 'tech-saas',
    niches: /tech|software|saas|app|digital|agency|marketing|seo|ads|automation|ai|crm/,
    name: 'Tech & SaaS',
    palette: {
      heroBg: '#0F172A',
      heroGradient: 'linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%)',
      ctaGradient:  'linear-gradient(135deg, #4338CA 0%, #0F172A 100%)',
      primary: '#6366F1', buttonColor: '#FFFFFF',
      sectionBg: '#EEF2FF', altSectionBg: '#FFFFFF',
      heroText: '#FFFFFF', bodyText: '#111827',
    },
    emphasis: 'ROI metrics, integrations, time saved, scale',
    ctaStyle: 'free trial + social proof logos',
  },
  {
    id: 'medical-clinic',
    niches: /dental|medical|clinic|therapy|mental|psychology|doctor|chiro|physio|health.*care/,
    name: 'Medical & Wellness',
    palette: {
      heroBg: '#0C1F3D',
      heroGradient: 'linear-gradient(135deg, #0C1F3D 0%, #0369A1 100%)',
      ctaGradient:  'linear-gradient(135deg, #0369A1 0%, #0C1F3D 100%)',
      primary: '#0EA5E9', buttonColor: '#FFFFFF',
      sectionBg: '#F0F9FF', altSectionBg: '#FFFFFF',
      heroText: '#FFFFFF', bodyText: '#111827',
    },
    emphasis: 'credentials, patient results, compassion, trust',
    ctaStyle: 'consultation booking + reassurance',
  },
  {
    id: 'legal-professional',
    niches: /law|legal|attorney|lawyer|accountant|cpa|tax|compliance|audit/,
    name: 'Legal & Professional',
    palette: {
      heroBg: '#1A1A2E',
      heroGradient: 'linear-gradient(135deg, #1A1A2E 0%, #16213E 50%, #0F3460 100%)',
      ctaGradient:  'linear-gradient(135deg, #0F3460 0%, #1A1A2E 100%)',
      primary: '#E2B04A', buttonColor: '#111827',
      sectionBg: '#FDFAF3', altSectionBg: '#FFFFFF',
      heroText: '#FFFFFF', bodyText: '#111827',
    },
    emphasis: 'track record, credentials, confidentiality, results',
    ctaStyle: 'authority + free consultation',
  },
  {
    id: 'ecommerce-product',
    niches: /ecommerce|product|store|shop|brand|merch|dropship|amazon|etsy/,
    name: 'E-Commerce & Product',
    palette: {
      heroBg: '#18181B',
      heroGradient: 'linear-gradient(135deg, #18181B 0%, #27272A 100%)',
      ctaGradient:  'linear-gradient(135deg, #3F3F46 0%, #18181B 100%)',
      primary: '#F97316', buttonColor: '#FFFFFF',
      sectionBg: '#FFF7ED', altSectionBg: '#FFFFFF',
      heroText: '#FFFFFF', bodyText: '#111827',
    },
    emphasis: 'product quality, reviews, fast shipping, guarantee',
    ctaStyle: 'scarcity + bundle offer',
  },
  // Default fallback
  {
    id: 'professional-default',
    niches: /.*/,
    name: 'Professional Business',
    palette: {
      heroBg: '#0F172A',
      heroGradient: 'linear-gradient(135deg, #0F172A 0%, #1E3A5F 100%)',
      ctaGradient:  'linear-gradient(135deg, #1E3A5F 0%, #0F172A 100%)',
      primary: '#1D4ED8', buttonColor: '#FFFFFF',
      sectionBg: '#F9FAFB', altSectionBg: '#FFFFFF',
      heroText: '#FFFFFF', bodyText: '#111827',
    },
    emphasis: 'value, results, credibility, trust',
    ctaStyle: 'strong guarantee + clear CTA',
  },
];

/**
 * Selects the best-matching design template for the given niche.
 * Returns a full design spec with palette, gradient, and copy emphasis hints.
 */
function selectFunnelDesign(niche = '', offer = '') {
  const query = `${niche} ${offer}`.toLowerCase();
  return FUNNEL_DESIGN_TEMPLATES.find(t => t.niches.test(query)) || FUNNEL_DESIGN_TEMPLATES[FUNNEL_DESIGN_TEMPLATES.length - 1];
}

/**
 * Returns a professional brand palette keyed to the niche.
 * Now delegates to selectFunnelDesign for consistency.
 */
function nicheAccentPalette(niche = '', offer = '') {
  return selectFunnelDesign(niche, offer).palette;
}

/**
 * Builds an array of 4 niche-specific picsum image URLs so each section
 * can have a visually distinct (but thematically related) image.
 */
function buildImgSeeds(niche = '', offer = '') {
  const stopWords = new Set(['your','this','that','with','from','have','will','they','what','when','where','which','their','these','about','into']);
  const words = `${niche} ${offer}`.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
  const base = words.length > 0 ? words.slice(0, 4) : ['business', 'success', 'team', 'office'];
  // Pad to 4 if fewer words
  while (base.length < 4) base.push(['team', 'office', 'growth', 'results'][base.length]);
  return base.map((kw, i) => `https://picsum.photos/seed/${kw}${i + 1}/800/450`);
}

// Infer page type from page name
function inferPageType(name = '') {
  const n = name.toLowerCase();
  if (/opt.?in|lead|capture|sign.?up|subscribe/.test(n))  return 'Opt-in / Lead Capture Page';
  if (/thank|thanks|success|welcome/.test(n))              return 'Thank You Page';
  if (/confirm|confirmation/.test(n))                      return 'Confirmation Page';
  if (/upsell|oto|one.time|bump/.test(n))                  return 'Upsell Page';
  if (/downsell|down.sell/.test(n))                        return 'Downsell Page';
  if (/order|checkout|payment|buy/.test(n))                return 'Order Page';
  if (/replay|watch/.test(n))                              return 'Webinar Replay Page';
  if (/webinar|registration|register/.test(n))             return 'Webinar Registration Page';
  if (/vsl|video.?sales/.test(n))                          return 'VSL Page';
  return 'Sales Page';
}

/**
 * Returns the section plan (ordered list of sections with element hints)
 * for a given page type. Drives how many sections the AI generates.
 */
function getSectionPlan(pageType, imgSrc, palette, imgSeeds) {
  const p = palette || {};
  const heroBg      = p.heroBg      || '#0F172A';
  const heroText    = p.heroText    || '#FFFFFF';
  const secBg       = p.sectionBg  || '#F9FAFB';
  const bodyText    = p.bodyText    || '#111827';
  const primary     = p.primary     || '#1D4ED8';
  const btnColor    = p.buttonColor || '#FFFFFF';
  const heroGrad    = p.heroGradient || null;
  const ctaGrad     = p.ctaGradient  || null;
  const seeds       = (imgSeeds && imgSeeds.length) ? imgSeeds : [imgSrc, imgSrc, imgSrc, imgSrc];
  let   seedIdx     = 0;

  // Helper: build a section — auto-applies gradient when bg matches heroBg (hero/CTA dark sections)
  const sec = (name, bg, textClr, pad, elements) => {
    // Apply hero gradient when bg matches the dark hero color, CTA gradient for last-section bg
    const gradient = (bg === heroBg && heroGrad) ? heroGrad
                   : (bg === (p.ctaBg || heroBg) && ctaGrad) ? ctaGrad
                   : null;
    return {
      type: 'section',
      name,
      styles: {
        backgroundColor: { value: bg },
        ...(gradient ? { backgroundGradient: { value: gradient } } : {}),
        paddingTop:    { value: pad[0], unit: 'px' },
        paddingBottom: { value: pad[1], unit: 'px' },
        paddingLeft:   { value: 20,     unit: 'px' },
        paddingRight:  { value: 20,     unit: 'px' },
      },
      mobileStyles: {
        paddingTop:    { value: Math.round(pad[0] * 0.6), unit: 'px' },
        paddingBottom: { value: Math.round(pad[1] * 0.6), unit: 'px' },
      },
      children: elements,
    };
  };

  // Element builders
  const h1  = (text, clr=heroText, sz=56)  => ({"type":"heading","tag":"h1","text":text,"styles":{"color":{"value":clr},"fontSize":{"value":sz,"unit":"px"},"fontWeight":{"value":"700"},"lineHeight":{"value":1.1}},"mobileStyles":{"fontSize":{"value":Math.max(sz-20,30),"unit":"px"}}});
  const h2  = (text, clr=bodyText, sz=38)  => ({"type":"heading","tag":"h2","text":text,"styles":{"color":{"value":clr},"fontSize":{"value":sz,"unit":"px"},"fontWeight":{"value":"700"},"lineHeight":{"value":1.2}},"mobileStyles":{"fontSize":{"value":Math.max(sz-12,24),"unit":"px"}}});
  const sub = (text, clr=heroText, sz=22)  => ({"type":"sub-heading","text":text,"styles":{"color":{"value":clr},"fontSize":{"value":sz,"unit":"px"},"fontWeight":{"value":"400"},"lineHeight":{"value":1.6}},"mobileStyles":{"fontSize":{"value":Math.max(sz-4,16),"unit":"px"}}});
  const par = (text, clr=heroText, sz=18)  => ({"type":"paragraph","text":text,"styles":{"color":{"value":clr},"fontSize":{"value":sz,"unit":"px"},"lineHeight":{"value":1.75}},"mobileStyles":{"fontSize":{"value":Math.max(sz-2,15),"unit":"px"}}});
  const btn = (text, bg=primary, clr=btnColor) => ({"type":"button","text":text,"link":"#","styles":{"backgroundColor":{"value":bg},"color":{"value":clr},"fontSize":{"value":18,"unit":"px"},"fontWeight":{"value":"700"},"paddingTop":{"value":20,"unit":"px"},"paddingBottom":{"value":20,"unit":"px"},"paddingLeft":{"value":52,"unit":"px"},"paddingRight":{"value":52,"unit":"px"},"borderRadius":{"value":6,"unit":"px"}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"},"paddingLeft":{"value":32,"unit":"px"},"paddingRight":{"value":32,"unit":"px"}}});
  const bul = (items, clr=bodyText, sz=18) => ({"type":"bulletList","items":items,"icon":{"name":"check","unicode":"f00c","fontFamily":"Font Awesome 5 Free"},"styles":{"color":{"value":clr},"fontSize":{"value":sz,"unit":"px"},"lineHeight":{"value":1.8}},"mobileStyles":{"fontSize":{"value":Math.max(sz-2,15),"unit":"px"}}});
  const img     = (alt='')                          => ({"type":"image","src":seeds[seedIdx++ % seeds.length],"alt":alt,"styles":{"width":{"value":100,"unit":"%"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{}});
  const vid     = ()                                 => ({"type":"video","src":"","styles":{}});
  const frm     = ()                                 => ({"type":"form","styles":{}});
  const orderFrm= ()                                 => ({"type":"orderForm","styles":{}});
  const orderConf=()                                 => ({"type":"orderConfirmation","styles":{}});
  const noThanks= (text, link='#thank-you')          => ({"type":"textLink","text":text,"link":link,"styles":{"fontSize":{"value":14,"unit":"px"}}});

  const plans = {

    'Sales Page': {
      groq: `3 sections:\n1. Hero bg="${heroBg}" — heading(h1,56px) + sub-heading(22px) + image + paragraph + button\n2. Benefits bg="${secBg}" — heading(h2,38px) + paragraph + bulletList(6 compelling outcome items) + button\n3. Final CTA bg="${heroBg}" — heading(h2,40px) + paragraph(powerful testimonial in quotes) + button + paragraph(trust line,13px)`,
      sections: [
        sec('Hero', heroBg, heroText, [100,100], [
          h1('[COMPELLING HEADLINE — promise the main benefit]'),
          sub('[Sub-headline — reinforce the promise and build curiosity]', heroText),
          img('hero image'),
          par('[1-2 sentence hook: identify the pain and tease the solution]', heroText),
          btn('Yes! I Want Access Now'),
        ]),
        sec('Problem / Agitation', secBg, bodyText, [80,80], [
          h2('[Problem-focused headline, e.g. "Are You Tired of...?"]', bodyText),
          par('[Empathy paragraph — describe the problem the audience faces, make them feel seen]', bodyText),
          bul(['[Pain point 1 — be specific]','[Pain point 2 — be specific]','[Pain point 3 — be specific]','[Pain point 4 — be specific]'], bodyText),
        ]),
        sec('Solution / Benefits', '#FFFFFF', bodyText, [80,80], [
          h2('[Solution headline — introduce the offer as the answer]', bodyText),
          img('solution image'),
          par('[Transition paragraph — bridge from the problem to your solution]', bodyText),
          bul(['[Core benefit 1 — outcome-focused]','[Core benefit 2 — outcome-focused]','[Core benefit 3 — outcome-focused]','[Core benefit 4 — outcome-focused]','[Core benefit 5 — outcome-focused]'], bodyText),
        ]),
        {
          type: 'section', name: 'Social Proof', layout: 'three-column',
          styles: { backgroundColor: { value: secBg }, paddingTop: { value: 80, unit: 'px' }, paddingBottom: { value: 80, unit: 'px' }, paddingLeft: { value: 20, unit: 'px' }, paddingRight: { value: 20, unit: 'px' } },
          mobileStyles: { paddingTop: { value: 48, unit: 'px' }, paddingBottom: { value: 48, unit: 'px' } },
          children: [h2('[Testimonials headline — "Here\'s What Our Clients Are Saying"]', bodyText)],
          columns: [
            { children: [img('client photo'), par('⭐⭐⭐⭐⭐', bodyText, 18), par('"[Testimonial 1: specific result with numbers — FirstName L., Title/Company]"', bodyText)] },
            { children: [img('client photo'), par('⭐⭐⭐⭐⭐', bodyText, 18), par('"[Testimonial 2: specific result with numbers — FirstName L., Title/Company]"', bodyText)] },
            { children: [img('client photo'), par('⭐⭐⭐⭐⭐', bodyText, 18), par('"[Testimonial 3: specific result with numbers — FirstName L., Title/Company]"', bodyText)] },
          ],
        },
        sec('Offer Details / Value Stack', '#FFFFFF', bodyText, [80,80], [
          h2('[Offer headline — everything they get]', bodyText),
          img('offer image'),
          bul(['[Deliverable 1 + value statement]','[Deliverable 2 + value statement]','[Deliverable 3 + value statement]','[Bonus 1 + value]','[Bonus 2 + value]'], bodyText),
          par('[Price reveal paragraph — anchor the full value, then show the actual price]', bodyText),
        ]),
        sec('Guarantee', secBg, bodyText, [80,80], [
          h2('[Guarantee headline, e.g. "100% Risk-Free Guarantee"]', bodyText),
          img('guarantee badge'),
          par('[Strong risk-reversal paragraph — describe the guarantee terms and make it feel truly risk-free]', bodyText),
        ]),
        sec('FAQ', '#FFFFFF', bodyText, [80,80], [
          h2('Frequently Asked Questions', bodyText),
          sub('[Q: Most common objection #1?]', bodyText, 20),
          par('[A: Clear, confident answer that removes the objection]', bodyText),
          sub('[Q: Most common objection #2?]', bodyText, 20),
          par('[A: Clear, confident answer]', bodyText),
          sub('[Q: Most common objection #3?]', bodyText, 20),
          par('[A: Clear, confident answer]', bodyText),
          sub('[Q: Most common objection #4?]', bodyText, 20),
          par('[A: Clear, confident answer]', bodyText),
        ]),
        sec('Final CTA', heroBg, heroText, [100,100], [
          h2('[Closing urgency headline — "This Offer Won\'t Last..."]', heroText, 40),
          par('[Scarcity/urgency paragraph — limited time, limited spots, or bonus expiry]', heroText),
          btn('Get Instant Access Now'),
          par('[Micro-commitment line below button, e.g. "30-day guarantee · No contracts · Cancel anytime"]', heroText, 14),
        ]),
      ],
    },

    'Opt-in / Lead Capture Page': {
      groq: `3 sections:\n1. Hero bg="${heroBg}" — heading(h1,56px) + sub-heading(22px) + image + paragraph + button\n2. What You Get bg="${secBg}" — heading(h2,38px) + bulletList(5 specific takeaway items) + paragraph\n3. Trust CTA bg="${heroBg}" — paragraph(social proof stat) + button + paragraph(privacy note,13px)`,
      sections: [
        sec('Hero', heroBg, heroText, [100,100], [
          h1('[Opt-in headline — lead magnet promise, e.g. "Get the Free Guide to..."]'),
          sub('[Sub-headline — who this is for and what they\'ll get]', heroText),
          img('lead magnet or hero image'),
          par('[1-2 sentence hook that makes the free offer irresistible]', heroText),
          btn('Yes! Send Me The Free Guide'),
        ]),
        sec('What You\'ll Get', secBg, bodyText, [80,80], [
          h2('[Benefits headline, e.g. "Here\'s Exactly What You\'ll Discover Inside..."]', bodyText),
          bul(['[Specific takeaway 1 — what they\'ll learn/get]','[Specific takeaway 2]','[Specific takeaway 3]','[Specific takeaway 4 — final compelling benefit]'], bodyText),
          par('[Supporting paragraph — reinforce the value of the free resource]', bodyText),
        ]),
        sec('Trust / Final CTA', heroBg, heroText, [80,80], [
          par('"[Social proof quote or stat — X people have already downloaded this / As seen in...]"', heroText),
          par('[Privacy reassurance: "We respect your privacy. No spam, ever. Unsubscribe anytime."]', heroText, 14),
          btn('Get Instant Free Access'),
        ]),
      ],
    },

    // ── Lead/Application funnel: general thank you, no order confirmation ─────
    'Thank You Page (Lead)': {
      groq: `3 sections:\n1. Hero bg="${heroBg}" — heading(h1) + sub-heading + paragraph(email instructions)\n2. Next Steps bg="${secBg}" — heading(h2) + bulletList(3 next steps)\n3. Community bg="#FFFFFF" — heading(h2) + paragraph + bulletList(social links)`,
      sections: [
        sec('You\'re In!', heroBg, heroText, [80,60], [
          h1('🎉 You\'re In! Check Your Inbox Now'),
          sub('[Sub-headline — confirm what they just signed up for and what\'s on its way]', heroText),
          par('[Email instructions: "Your [lead magnet / guide / access link] is on its way to [their email]. If you don\'t see it in the next 2 minutes, check your spam folder and mark us as safe sender."]', heroText),
        ]),
        sec('What to Do Next', secBg, bodyText, [60,60], [
          h2('Here\'s What Happens Now', bodyText),
          bul([
            '📧 Check your inbox — your [resource] is already on its way',
            '⭐ Add [sender email] to your contacts so you never miss our emails',
            '[Next step 3 — an optional action to get even more value: join a group, watch a video, book a call]',
          ], bodyText),
        ]),
        sec('Stay Connected', '#FFFFFF', bodyText, [60,60], [
          h2('[Community headline — "Join [X]+ [Audience] in Our Community"]', bodyText),
          par('[Warm invitation to follow on socials: "We share [type of content] every week — tips, behind-the-scenes, and resources you won\'t find anywhere else. Follow us to stay in the loop."]', bodyText),
          bul([
            '📘 Facebook Group: [Group name / link — "Join our free community"]',
            '📸 Instagram: @[handle] — "[What they post: daily tips / inspiration / case studies]"',
            '▶️ YouTube: [Channel name] — "[What they\'ll find: tutorials / interviews / free training]"',
            '💬 [Other platform: TikTok / LinkedIn / Podcast — with brief reason to follow]',
          ], bodyText),
          par('[Friendly sign-off — "We\'re thrilled to have you here. See you inside! — [Name / Team]"]', bodyText),
        ]),
      ],
    },

    // ── Purchase funnel: order confirmation element + access instructions ─────
    'Thank You Page (Purchase)': {
      groq: `3 sections:\n1. Hero bg="${heroBg}" — heading(h1) + sub-heading + paragraph\n2. Order Confirmation bg="#FFFFFF" — heading(h2) + orderConfirmation\n3. Getting Started bg="${secBg}" — heading(h2) + bulletList(access steps) + paragraph`,
      sections: [
        sec('Order Confirmed!', heroBg, heroText, [80,60], [
          h1('🎉 Order Confirmed — Welcome to the Family!'),
          sub('[Product name + the transformation they just unlocked — "You\'re now a [Program/Product] member"]', heroText),
          par('[Celebration + reassurance: "You just made a great decision. Your order has been processed successfully. Below you\'ll find your order details and everything you need to get started right away."]', heroText),
        ]),
        sec('Your Order Summary', '#FFFFFF', bodyText, [40,40], [
          h2('Your Purchase Details', bodyText),
          orderConf(),
        ]),
        sec('How to Get Started', secBg, bodyText, [60,60], [
          h2('Here\'s How to Access Your Purchase', bodyText),
          bul([
            '[Step 1 — how to access: "Check your email for your login details / download link / access instructions"]',
            '[Step 2 — first thing to do: "Log in and [start with / watch / complete] [specific first step]"]',
            '[Step 3 — where to get help: "If you have any questions, email us at [support email] or visit [help page]"]',
          ], bodyText),
          par('[Warm closing: "We\'re so excited for you to experience [product/program]. If you ever need anything, we\'re just one email away. — [Name / Team]"]', bodyText),
        ]),
      ],
    },

    // ── Webinar funnel thank you: after registration action or replay ─────────
    'Webinar Thank You Page': {
      groq: `3 sections:\n1. Hero bg="${heroBg}" — heading(h1) + sub-heading + paragraph\n2. What\'s Next bg="${secBg}" — heading(h2) + bulletList\n3. Community bg="#FFFFFF" — heading(h2) + paragraph + bulletList(socials)`,
      sections: [
        sec('Thank You!', heroBg, heroText, [80,60], [
          h1('[Thank you headline — e.g. "Thanks for Joining Us!" or "Thanks for Watching!"]'),
          sub('[What they just did + what\'s waiting for them next]', heroText),
          par('[Genuine appreciation + what comes next: "We appreciate you showing up / watching. [What happens next — replay access, offer expiry, next session, etc.]"]', heroText),
        ]),
        sec('What\'s Next', secBg, bodyText, [60,60], [
          h2('Here\'s What to Do Now', bodyText),
          bul([
            '[Step 1 — most important next action: claim the offer / check email / implement one thing]',
            '[Step 2 — where to get the replay / recording if applicable]',
            '[Step 3 — where to get community support or follow for more value]',
          ], bodyText),
        ]),
        sec('Stay Connected', '#FFFFFF', bodyText, [60,60], [
          h2('[Community invite headline]', bodyText),
          par('[Invitation to continue the conversation in the community / on socials — where they\'ll find more free training, Q&As, case studies]', bodyText),
          bul([
            '📘 Facebook Group: [Group name] — "[What value they\'ll get in the group]"',
            '📸 Instagram: @[handle] — "Follow for daily [tips/content type]"',
            '▶️ YouTube: [Channel] — "[Free training library / weekly videos]"',
          ], bodyText),
          par('[Closing line: "Thank you again for being here. See you on the inside! — [Name / Team]"]', bodyText),
        ]),
      ],
    },

    // ── Legacy fallback (kept for backward compat) ────────────────────────────
    'Thank You Page': {
      groq: `2 sections:\n1. Confirmation bg="${heroBg}" — heading(h1) + sub-heading + paragraph\n2. Next Steps bg="${secBg}" — heading(h2) + bulletList(3 steps) + button`,
      sections: [
        sec('Confirmation', heroBg, heroText, [80,60], [
          h1('🎉 You\'re In! Check Your Email Now'),
          sub('[Sub-headline confirming what they signed up for]', heroText),
          par('[What they\'ll receive, when, and what to do next — check spam, add to contacts]', heroText),
        ]),
        sec('Your Next Steps', secBg, bodyText, [60,60], [
          h2('Here\'s What Happens Next', bodyText),
          bul(['[Step 1 — check email and confirm subscription]','[Step 2 — what they receive / where to access]','[Step 3 — optional next action to get even more value]'], bodyText),
          btn('[Optional next action CTA — e.g. "Watch the Free Training Now"]'),
        ]),
      ],
    },

    'Order Page': {
      groq: `2 sections:\n1. Summary bg="${heroBg}" — heading(h1) + sub-heading + bulletList(what they get)\n2. Checkout bg="#FFFFFF" — heading(h2) + paragraph(guarantee) + orderForm + paragraph(trust micro-copy)`,
      sections: [
        sec('What You Get', heroBg, heroText, [60,60], [
          h1('[Order confirmation headline — e.g. "Yes! Complete My Order for [Product Name]"]'),
          sub('[One-line recap of the main transformation or promise]', heroText),
          bul(['[Item 1 — what\'s included + value]','[Item 2 — what\'s included + value]','[Item 3 — what\'s included + value]','[Bonus included + value]','[30-Day Money-Back Guarantee — Zero risk]'], heroText),
          par('[Value anchor: "Total value: $X. Your price today: $Y — Save $Z"]', heroText),
        ]),
        sec('Complete Your Order', '#FFFFFF', bodyText, [40,60], [
          h2('[Checkout headline — e.g. "Secure Your Spot — Fill In Your Details Below"]', bodyText),
          par('[Brief guarantee reassurance — "You\'re fully protected by our 30-day no-questions-asked money-back guarantee. If you don\'t love it, you pay nothing."]', bodyText),
          orderFrm(),
          par('[Trust micro-copy below form: "🔒 Secure checkout · SSL encrypted · Your information is 100% protected"]', bodyText, 13),
        ]),
      ],
    },

    'Upsell Page': {
      groq: `4 sections:\n1. Hook bg="${heroBg}" — heading(h1) + sub-heading + image\n2. The Offer bg="${secBg}" — heading(h2) + paragraph + bulletList\n3. Value Stack bg="#FFFFFF" — heading(h2) + paragraph + bulletList + paragraph\n4. Decision bg="${heroBg}" — heading(h2) + button + textLink(no thanks)`,
      sections: [
        sec('One-Time Offer Hook', heroBg, heroText, [60,40], [
          h1('⚡ Wait — One Special Offer Before You Go:'),
          sub('[Sub-headline: "Because you just purchased [X], you\'ve unlocked this exclusive one-time upgrade — available only right now"]', heroText),
          img('upsell product image'),
        ]),
        sec('The Upgrade', secBg, bodyText, [60,60], [
          h2('[Offer headline — the specific result this upgrade unlocks]', bodyText),
          par('[Compelling 2-3 sentence description — what this adds, why it perfectly complements what they just bought, what problem it solves that the core product alone doesn\'t fully address]', bodyText),
          bul(['[Upgrade benefit 1 — specific outcome they\'ll get]','[Upgrade benefit 2 — what they can do that they couldn\'t before]','[Upgrade benefit 3 — time/money saved]','[Why these two work better together]'], bodyText),
        ]),
        sec('Everything Included', '#FFFFFF', bodyText, [60,60], [
          h2('[Value stack headline — "Here\'s Everything You Get With This Upgrade"]', bodyText),
          bul(['[Deliverable 1 — value $X]','[Deliverable 2 — value $X]','[Bonus — value $X]','[Total value $X — yours for just $Y today]'], bodyText),
          par('[Price justification + one-time caveat: "This special pricing is ONLY available on this page. Once you leave, this offer is gone for good."]', bodyText),
        ]),
        sec('Your Decision', heroBg, heroText, [60,60], [
          h2('[Urgency headline — "This Is a One-Time Offer — It Disappears When You Leave"]', heroText, 32),
          btn('YES! Add This To My Order Now — $[Price]'),
          par('[Separator: "— or —"]', heroText, 14),
          noThanks('[No thanks text — e.g. "No thanks, I don\'t want [specific benefit]. I understand this offer expires when I leave this page. Take me to my purchase."]'),
        ]),
      ],
    },

    'VSL Page': {
      groq: `3 sections:\n1. VSL Hero bg="${heroBg}" — heading(h1,56px) + sub-heading(22px) + image(video thumbnail) + paragraph(curiosity teaser)\n2. Discoveries bg="${secBg}" — heading(h2,38px) + bulletList(5 specific revelation items) + paragraph(urgency)\n3. Offer + CTA bg="${heroBg}" — heading(h2,38px) + image + bulletList(4 included items) + paragraph(price anchor) + button + paragraph(guarantee,13px)`,
      sections: [
        sec('VSL Hero', heroBg, heroText, [100,80], [
          h1('[Curiosity/benefit headline — "Discover How to [Result] Without [Pain Point]"]'),
          sub('[Sub-headline — who this is for and why they need to watch]', heroText),
          img('video thumbnail / play button placeholder'),
          par('[Tease paragraph — hint at the most surprising or counterintuitive thing revealed in the video]', heroText),
        ]),
        sec('What You\'ll Discover', secBg, bodyText, [80,80], [
          h2('In This Free Video You\'ll Discover...', bodyText),
          bul(['[Revelation 1 — specific and intriguing]','[Revelation 2 — specific and intriguing]','[Revelation 3 — specific and intriguing]','[Revelation 4 — specific and intriguing]','[Big secret / surprising truth revealed in the video]'], bodyText),
          par('[Urgency note: "Watch the full video above before it comes down."]', bodyText),
        ]),
        sec('The Offer', '#FFFFFF', bodyText, [80,80], [
          h2('[Offer headline — what\'s available after watching]', bodyText),
          img('offer / product image'),
          bul(['[What\'s included — item 1]','[What\'s included — item 2]','[What\'s included — item 3]','[Bonus item]'], bodyText),
          par('[Value + price paragraph — "A $X value, available today for just $Y"]', bodyText),
          btn('Get Instant Access Now'),
        ]),
        sec('Final CTA', heroBg, heroText, [80,80], [
          h2('[Urgency headline — "This Offer Is Available For a Limited Time Only"]', heroText, 36),
          par('[Guarantee + scarcity paragraph]', heroText),
          btn('Yes! I\'m Ready to Get Started'),
          par('[Trust line: "Secure checkout · 30-day money-back guarantee"]', heroText, 13),
        ]),
      ],
    },

    'Webinar Registration Page': {
      groq: `3 sections:\n1. Hero bg="${heroBg}" — heading(h1,56px) + sub-heading(date+time,22px) + image + paragraph\n2. What You\'ll Learn bg="${secBg}" — heading(h2,38px) + bulletList(5 learning outcomes)\n3. Register bg="#FFFFFF" — heading(h2,36px) + paragraph + form + paragraph(reassurance,13px)`,
      sections: [
        sec('Webinar Hero', heroBg, heroText, [80,60], [
          h1('[Webinar title — compelling result or revelation headline]'),
          sub('[Free Live Training: Date · Time · Duration — "100% free, register below"]', heroText),
          img('webinar / presenter image'),
          par('[1-2 sentence teaser — what the most surprising or valuable thing revealed in the training will be]', heroText),
        ]),
        sec('What You\'ll Learn', secBg, bodyText, [60,60], [
          h2('In This Free Training You\'ll Discover...', bodyText),
          bul(['[Specific learning outcome 1 — what they\'ll know how to do]','[Learning outcome 2 — a mindset shift or insight]','[Learning outcome 3 — a strategy or framework]','[Learning outcome 4 — a common mistake they\'ll avoid]','[Bonus insight — the big surprise takeaway]'], bodyText),
          par('[Who this is for: "This free training is perfect if you\'re a [audience description] who wants [outcome] without [common pain]"]', bodyText),
        ]),
        sec('Register Free Below', '#FFFFFF', bodyText, [60,60], [
          h2('[Registration headline — "Claim Your Free Spot — Register Below Now"]', bodyText),
          par('[Brief call to action — "Fill in your details below and we\'ll send your confirmation and join link instantly."]', bodyText),
          frm(),
          par('[Reassurance below form: "Free to attend · No credit card required · Unsubscribe anytime"]', bodyText, 13),
        ]),
      ],
    },

    'Downsell Page': {
      groq: `3 sections:\n1. Alternative Offer bg="${heroBg}" — heading(h1) + sub-heading + image + paragraph\n2. What You Get bg="${secBg}" — heading(h2) + bulletList + paragraph\n3. Decision bg="${heroBg}" — heading(h2) + button + textLink(no thanks)`,
      sections: [
        sec('Alternative Offer', heroBg, heroText, [60,40], [
          h1('Wait — We Have a Better Option For You'),
          sub('[Sub-headline: "We get it — [full offer] may not be right for you right now. Here\'s a more accessible way to get [core result]..."]', heroText),
          img('downsell product image'),
          par('[Empathy paragraph — acknowledge the hesitation without pressure, introduce the stripped-down version as the smart starting point]', heroText),
        ]),
        sec('What\'s Included', secBg, bodyText, [60,60], [
          h2('[Downsell headline — "Get [Core Result] With [Downsell Product Name]"]', bodyText),
          bul(['[Core deliverable 1 — what they get]','[Core deliverable 2]','[Core deliverable 3]','[How this gets them the essential outcome]'], bodyText),
          par('[Value anchor + reduced price: "Normally $X, yours today for just $Y — a fraction of the full program"]', bodyText),
        ]),
        sec('Your Decision', heroBg, heroText, [60,60], [
          h2('[Last-chance headline — "This Is Your Final Opportunity to Grab [Product] at This Price"]', heroText, 32),
          btn('Yes! I\'ll Take This — $[Downsell Price]'),
          par('[Separator: "— or —"]', heroText, 14),
          noThanks('[No thanks text — e.g. "No thanks, I\'ll pass on this offer. I understand I won\'t see this price again. Take me to my purchase."]'),
        ]),
      ],
    },

    'Confirmation Page': {
      groq: `3 sections:\n1. Confirmed bg="${heroBg}" — heading(h1) + sub-heading + video/image + paragraph(join details)\n2. While You Wait bg="${secBg}" — heading(h2) + bulletList(what they'll cover) + paragraph(attendance tip)\n3. Calendar bg="#FFFFFF" — heading(h2) + paragraph + button`,
      sections: [
        sec('Registration Confirmed', heroBg, heroText, [80,60], [
          h1('🎉 You\'re Registered! Here\'s How to Join'),
          sub('[Event name + Date + Time + Format: "Join us live on [platform] — link below"]', heroText),
          vid(),
          par('[Join instructions — "Your confirmation + join link has been sent to your email. Here\'s what to do: [1. Check inbox 2. Save the link 3. Add to calendar]"]', heroText),
        ]),
        sec('What We\'ll Cover Together', secBg, bodyText, [60,60], [
          h2('A Sneak Peek at What\'s Coming...', bodyText),
          bul(['[What they\'ll learn / topic 1]','[Topic 2 — an insight they\'ve never heard before]','[Topic 3 — a common mistake they\'ve been making]','[Topic 4 — the actionable framework they\'ll leave with]','[Bonus: Live Q&A — bring your toughest questions]'], bodyText),
          par('[Attendance incentive: "Show up live and stay until the end — we have a special bonus for everyone who attends the full session."]', bodyText),
        ]),
        sec('Don\'t Miss It', '#FFFFFF', bodyText, [60,60], [
          h2('Add It to Your Calendar So You Don\'t Forget', bodyText),
          par('[Brief prep tip — "Grab a notebook, clear 60 minutes, and come ready to take action. This training is hands-on."]', bodyText),
          btn('Add to Google Calendar'),
        ]),
      ],
    },

    'Webinar Replay Page': {
      groq: `4 sections:\n1. Watch bg="${heroBg}" — heading(h1) + sub-heading + video + paragraph\n2. Takeaways bg="${secBg}" — heading(h2) + bulletList + paragraph\n3. Offer bg="#FFFFFF" — heading(h2) + bulletList + paragraph + button\n4. Final CTA bg="${heroBg}" — heading(h2) + paragraph + button + paragraph(trust)`,
      sections: [
        sec('Watch the Replay', heroBg, heroText, [80,60], [
          h1('[Replay headline — "Watch the Full Replay: [Webinar Title]"]'),
          sub('[Urgency line — "⚠️ This replay comes down on [Date]. Watch it now before it\'s gone."]', heroText),
          vid(),
          par('[Brief intro paragraph — "In this training you\'ll discover [top 2-3 insights]. Watch it all the way through — the most important part is at the end."]', heroText),
        ]),
        sec('What You\'ll Learn In This Training', secBg, bodyText, [60,60], [
          h2('The Biggest Insights From This Session', bodyText),
          bul(['[Key takeaway 1 — the most actionable thing they can implement today]','[Key takeaway 2 — a mindset shift or framework]','[Key takeaway 3 — the mistake most people make and how to avoid it]','[Key takeaway 4 — the strategy revealed near the end]','[The #1 thing to do immediately after watching]'], bodyText),
          par('[Bridge to offer: "If you\'re ready to implement all of this with support and accountability, here\'s what we put together for replay viewers only..."]', bodyText),
        ]),
        sec('Replay-Only Special Offer', '#FFFFFF', bodyText, [60,60], [
          h2('[Offer headline — what\'s available to replay viewers at a special price]', bodyText),
          bul(['[What\'s included — item 1 + outcome]','[What\'s included — item 2 + outcome]','[Bonus — only available with this offer]','[Guarantee — complete peace of mind]'], bodyText),
          par('[Price + urgency: "This special replay pricing expires at midnight. After that, the price goes back to $X."]', bodyText),
          btn('Claim the Replay Offer Now'),
        ]),
        sec('Final CTA', heroBg, heroText, [60,60], [
          h2('[Closing urgency — "This Offer and the Replay Both Come Down at Midnight"]', heroText, 36),
          par('[Guarantee reminder + final emotional nudge: "You\'re fully protected by our 30-day guarantee. The only risk is doing nothing."]', heroText),
          btn('Yes — I\'m Ready to Get Started'),
          par('[Trust line: "Secure checkout · 30-day money-back guarantee · Instant access"]', heroText, 13),
        ]),
      ],
    },

    'Application Page': {
      groq: `4 sections:\n1. Hero bg="${heroBg}" — heading(h1,56px) + sub-heading + image + paragraph\n2. Qualifiers bg="${secBg}" — heading(h2,38px) + paragraph + bulletList\n3. Transformation bg="#FFFFFF" — heading(h2,38px) + bulletList + paragraph\n4. Apply bg="${heroBg}" — heading(h2,36px) + paragraph + form + paragraph(reassurance)`,
      sections: [
        sec('Application Hero', heroBg, heroText, [80,60], [
          h1('[Exclusive opportunity headline — "Apply to Work With [Expert/Program Name] — Limited Spots"]'),
          sub('[Sub-headline — who this is ideal for and what transformation accepted applicants achieve]', heroText),
          img('premium / exclusive program image'),
          par('[1-2 sentences establishing exclusivity: "We work with a small number of [audience] at a time. If accepted, you\'ll [transformation]. Here\'s how to apply."]', heroText),
        ]),
        sec('Is This Right For You?', secBg, bodyText, [60,60], [
          h2('[Qualification headline — "This Program Is Exclusively For People Who..."]', bodyText),
          par('[Empathy paragraph — speak directly to the ideal client: their current frustration, what they\'ve tried, and the deeper desire driving them]', bodyText),
          bul(['[Qualifier 1 — the mindset: ready to invest in themselves]','[Qualifier 2 — the situation: currently experiencing X problem]','[Qualifier 3 — the commitment: willing to implement, not just learn]','[Qualifier 4 — the goal: serious about achieving [specific result]]'], bodyText),
        ]),
        sec('What You\'ll Achieve', '#FFFFFF', bodyText, [60,60], [
          h2('[Transformation headline — "By the End of [Program/Timeframe], You Will Have..."]', bodyText),
          bul(['[Outcome 1 — specific, measurable result]','[Outcome 2 — change in situation or status]','[Outcome 3 — skill or asset they\'ll own]','[Outcome 4 — business/life impact]','[The big vision — what their world looks like 90 days in]'], bodyText),
          par('[Social proof: "Our clients have achieved [specific result in numbers or specifics]. You could be next — if you qualify."]', bodyText),
        ]),
        sec('Apply Now', heroBg, heroText, [60,60], [
          h2('[Scarcity headline — "We Only Accept [X] New Applicants Per Month"]', heroText, 36),
          par('[Application process: "Fill out the short form below. We review every application personally and respond within 48 hours. There\'s no obligation — just a conversation to see if we\'re the right fit for each other."]', heroText),
          frm(),
          par('[Reassurance below form: "No sales pressure. No obligation. If we\'re not a good fit, we\'ll tell you honestly."]', heroText, 13),
        ]),
      ],
    },
  };

  const plan = plans[pageType] || plans['Sales Page'];
  const groqNote = plan.groq;
  const fullNote = `Generate exactly ${plan.sections.length} sections with this EXACT structure (fill in real content for the niche/offer, replace all [PLACEHOLDER] text with actual copy):\n${plan.sections.map((s, i) => `\nSection ${i+1}: ${JSON.stringify(s)}`).join('\n')}`;
  return { sections: plan.sections.length, groq: groqNote, full: fullNote, _sections: plan.sections };
}

// Each entry: name (display), url, stepOrder, type (maps to getSectionPlan key),
//             stage (TOFU/MOFU/BOFU), copyFocus (guides AI copy tone + angle)
const FUNNEL_TYPE_PAGES = {
  lead_gen: [
    { name: 'Opt-in Page',         url: 'opt-in',       stepOrder: 1, type: 'Opt-in / Lead Capture Page',    stage: 'TOFU', copyFocus: 'Curiosity-driven value promise, frictionless opt-in, zero-commitment' },
    { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 2, type: 'Thank You Page (Lead)',           stage: 'BOFU', copyFocus: 'Celebrate the opt-in, deliver clear next steps, invite to community and socials' },
  ],
  sales: [
    { name: 'Opt-in Page',         url: 'opt-in',       stepOrder: 1, type: 'Opt-in / Lead Capture Page',    stage: 'TOFU', copyFocus: 'Curiosity, value promise, low-friction entry — capture the lead' },
    { name: 'Sales Page',          url: 'sales',        stepOrder: 2, type: 'Sales Page',                    stage: 'MOFU', copyFocus: 'Problem-agitation-solution, deep desire, social proof, full offer reveal, risk reversal' },
    { name: 'Order Page',          url: 'order',        stepOrder: 3, type: 'Order Page',                    stage: 'BOFU', copyFocus: 'Summarize what they\'re getting, reassure with guarantee, show checkout form' },
    { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 4, type: 'Thank You Page (Purchase)',      stage: 'BOFU', copyFocus: 'Celebrate the purchase, show order confirmation, deliver access instructions' },
  ],
  vsl: [
    { name: 'VSL Page',            url: 'watch',        stepOrder: 1, type: 'VSL Page',                      stage: 'TOFU', copyFocus: 'Curiosity/pattern-interrupt headline, engage viewer to watch full video, tease key revelation' },
    { name: 'Order Page',          url: 'order',        stepOrder: 2, type: 'Order Page',                    stage: 'BOFU', copyFocus: 'Capture video momentum, summarize the offer, show checkout form, strong trust signals' },
    { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 3, type: 'Thank You Page (Purchase)',      stage: 'BOFU', copyFocus: 'Confirm order, show order confirmation, set access expectations, celebrate the decision' },
  ],
  webinar: [
    { name: 'Registration Page',   url: 'register',     stepOrder: 1, type: 'Webinar Registration Page',     stage: 'TOFU', copyFocus: 'Intrigue, free training value promise, low-commitment live event sign-up, form to register' },
    { name: 'Confirmation Page',   url: 'confirmation', stepOrder: 2, type: 'Confirmation Page',              stage: 'MOFU', copyFocus: 'Confirm registration with video/image, build anticipation, provide join details and calendar add' },
    { name: 'Webinar Replay Page', url: 'replay',       stepOrder: 3, type: 'Webinar Replay Page',            stage: 'MOFU', copyFocus: 'Deliver replay via embedded video, key takeaways, urgency on limited availability, offer CTA' },
    { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 4, type: 'Webinar Thank You Page',         stage: 'BOFU', copyFocus: 'Thank them for attending/watching, next steps, community invite and social follow' },
  ],
  tripwire: [
    { name: 'Opt-in Page',         url: 'opt-in',       stepOrder: 1, type: 'Opt-in / Lead Capture Page',    stage: 'TOFU', copyFocus: 'Irresistible free/low-cost entry offer, impulse action, capture the lead' },
    { name: 'Sales Page',          url: 'sales',        stepOrder: 2, type: 'Sales Page',                    stage: 'MOFU', copyFocus: 'Core offer value stack, benefits-heavy, build desire and justify the low price' },
    { name: 'Upsell Page',         url: 'upsell',       stepOrder: 3, type: 'Upsell Page',                   stage: 'BOFU', copyFocus: 'Amplify purchase momentum, exclusive one-time upgrade, no-thanks text link to thank you' },
    { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 4, type: 'Thank You Page (Purchase)',      stage: 'BOFU', copyFocus: 'Celebrate purchase, show order confirmation, deliver access instructions' },
  ],
  product_launch: [
    { name: 'Opt-in Page',         url: 'opt-in',       stepOrder: 1, type: 'Opt-in / Lead Capture Page',    stage: 'TOFU', copyFocus: 'Build anticipation for launch, exclusive early-access feel, qualify warm prospects' },
    { name: 'Sales Page',          url: 'sales',        stepOrder: 2, type: 'Sales Page',                    stage: 'MOFU', copyFocus: 'Full launch copy — story, proof, value stack, scarcity, FOMO, risk reversal' },
    { name: 'Upsell Page',         url: 'upsell',       stepOrder: 3, type: 'Upsell Page',                   stage: 'BOFU', copyFocus: 'Maximize cart value, complementary upgrade, no-thanks text link skips to thank you' },
    { name: 'Downsell Page',       url: 'downsell',     stepOrder: 4, type: 'Downsell Page',                 stage: 'BOFU', copyFocus: 'Recover declined upsell with lower-price alternative, no-thanks text link to thank you' },
    { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 5, type: 'Thank You Page (Purchase)',      stage: 'BOFU', copyFocus: 'Confirm purchase, show order confirmation, celebrate decision, set access expectations' },
  ],
  application: [
    { name: 'Opt-in Page',         url: 'opt-in',       stepOrder: 1, type: 'Opt-in / Lead Capture Page',    stage: 'TOFU', copyFocus: 'Qualify and intrigue premium prospects, position exclusivity and selectivity of the program' },
    { name: 'Application Page',    url: 'apply',        stepOrder: 2, type: 'Application Page',              stage: 'MOFU', copyFocus: 'Build desire through exclusivity, pre-qualify with form, escalate commitment before call' },
    { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 3, type: 'Thank You Page (Lead)',          stage: 'BOFU', copyFocus: 'Confirm application received, set review timeline expectations, invite to community' },
  ],
  free_shipping: [
    { name: 'Sales Page',          url: 'free-offer',   stepOrder: 1, type: 'Sales Page',                    stage: 'TOFU', copyFocus: 'Irresistible free + pay-shipping offer, FOMO and impulse, minimize friction' },
    { name: 'Order Page',          url: 'order',        stepOrder: 2, type: 'Order Page',                    stage: 'BOFU', copyFocus: 'Summarize free item + shipping, show checkout form, trust signals' },
    { name: 'Upsell Page',         url: 'upsell',       stepOrder: 3, type: 'Upsell Page',                   stage: 'BOFU', copyFocus: 'Maximize order value while buyer is in active purchase mode, no-thanks link to thank you' },
    { name: 'Thank You Page',      url: 'thank-you',    stepOrder: 4, type: 'Thank You Page (Purchase)',      stage: 'BOFU', copyFocus: 'Confirm order + shipping, show order confirmation, set delivery expectations' },
  ],
};

/**
 * Resolves the correct page type, funnel stage (TOFU/MOFU/BOFU), and copy focus
 * for a given page based on its funnel type and step position.
 * Priority: funnel type map → name-based inference.
 */
function inferPageTypeFromFunnel(funnelType, stepOrder, pageName) {
  const typePages = FUNNEL_TYPE_PAGES[funnelType];
  if (typePages && typePages.length) {
    // Exact match by stepOrder
    const match = typePages.find(p => p.stepOrder === stepOrder);
    if (match) return { type: match.type, stage: match.stage, copyFocus: match.copyFocus, roleName: match.name };
    // Position-based fallback (stepOrder might be 0-indexed or non-sequential in GHL)
    const idx = Math.min(Math.max(stepOrder - 1, 0), typePages.length - 1);
    const p   = typePages[idx];
    return { type: p.type, stage: p.stage, copyFocus: p.copyFocus, roleName: p.name };
  }
  // Name-based inference when funnel type unknown
  return { type: inferPageType(pageName), stage: 'MOFU', copyFocus: 'Conversion-focused copy appropriate for this page type', roleName: pageName };
}

router.post('/generate-funnel', async (req, res) => {
  const { funnelId, funnelType, audience, colorScheme, extraContext, agentId } = req.body;
  const niche = req.body.niche || 'this business';
  const offer = req.body.offer || 'their offer';

  if (!funnelId) return res.status(400).json({ success: false, error: '"funnelId" is required.' });

  const storedAiKeyFunnel = await loadStoredAiKey(req.locationId);
  const hasAnyKeyFunnel   = req.headers['x-anthropic-api-key'] || req.headers['x-openai-api-key'] || req.headers['x-groq-api-key'] || req.headers['x-google-api-key'] || req.headers['x-perplexity-api-key'] || storedAiKeyFunnel;
  if (!hasAnyKeyFunnel && !aiService.getProvider()) return res.status(503).json({ success: false, error: 'No AI provider configured. Enter your API key in the Funnel Builder.' });

  // Ensure Firebase connected
  try { await getFirebaseToken(req.locationId); } catch (err) {
    return res.status(400).json({ success: false, error: 'Firebase not connected. Connect first.', detail: err.message });
  }

  // Open SSE stream immediately so UI gets live feedback (including page creation progress)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // List pages in the funnel
  let pages;
  try {
    const result = await ghlClient.ghlRequest(req.locationId, 'GET', '/funnels/page', null, {
      locationId: req.locationId,
      funnelId,
      limit: 20,
      offset: '0',
    });
    pages = result?.funnelPages || result?.pages || result?.pageList || result?.list || result?.data
         || (Array.isArray(result) ? result : []);
    // Unwrap nested array-like objects (e.g. { funnelPages: { list: [...] } })
    if (pages && !Array.isArray(pages) && Array.isArray(pages.list))       pages = pages.list;
    if (pages && !Array.isArray(pages) && Array.isArray(pages.funnelPages)) pages = pages.funnelPages;
  } catch (err) {
    send('error', { error: `Failed to list funnel pages: ${err.message}` });
    return res.end();
  }

  // If funnel has no pages, instruct user to create blank pages in GHL first
  if (!Array.isArray(pages) || pages.length === 0) {
    const typePages = FUNNEL_TYPE_PAGES[funnelType] || FUNNEL_TYPE_PAGES.sales;
    const pageList  = typePages.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
    send('error', {
      error: `This funnel has no pages yet. GHL does not allow creating pages via API — please create them manually first:\n\nIn GHL → Funnels → open your funnel → click "+ Add New Step" for each:\n${pageList}\n\nThen run Full Funnel again.`,
      needsPages: true,
      pagesToCreate: typePages,
    });
    return res.end();
  }

  // Sort by stepOrder
  pages.sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));

  // Normalise page objects — GHL returns _id not id
  pages = pages.map(p => ({ ...p, id: p.id || p._id }));

  const aiFunnel = resolveAI(req, storedAiKeyFunnel);
  const provider = aiFunnel.isUserKey ? { name: aiFunnel.provider || 'user', model: 'user-key' } : (aiService.getProvider() || {});
  const isGroq   = aiFunnel.provider === 'groq' || (!aiFunnel.isUserKey && provider?.name === 'groq');
  const results  = [];

  send('log', { msg: `Using AI: ${provider?.name} (${provider?.model || 'claude-sonnet-4-6'})`, level: 'info' });
  send('start', { total: pages.length, pages: pages.map(p => ({ id: p.id, name: p.name, stepOrder: p.stepOrder })) });
  send('log', { msg: `Found ${pages.length} page(s) in funnel`, level: 'info' });

  let agentInfo = null;
  if (agentId) {
    try { agentInfo = await agentStore.getAgent(req.locationId, agentId); } catch {}
  }

  for (let i = 0; i < pages.length; i++) {
    const page      = pages[i];
    // Resolve page type, TOFU/MOFU/BOFU stage, and copy focus from funnel position
    const pageInfo  = inferPageTypeFromFunnel(funnelType, page.stepOrder || (i + 1), page.name || '');
    const pageType  = pageInfo.type;
    const pageStage = pageInfo.stage;           // 'TOFU' | 'MOFU' | 'BOFU'
    const pageFocus = pageInfo.copyFocus;       // AI copy angle for this page
    const pageRole  = pageInfo.roleName;        // friendly page role label
    send('page_start', { index: i, pageId: page.id, name: page.name, pageType, stage: pageStage });
    send('log', { msg: `[${i+1}/${pages.length}] "${page.name}" → ${pageRole} | ${pageType} [${pageStage}]`, level: 'info' });

    // ── Step A: Read current page via Firebase backend to verify step ID ────
    send('log', { msg: `[${i+1}/${pages.length}] Reading current page from GHL...`, level: 'info' });
    let currentPage = null;
    try {
      const { buildBackendHeaders } = require('../services/ghlPageBuilder');
      const fbToken  = await getFirebaseToken(req.locationId);
      const beHdrs   = buildBackendHeaders(fbToken);
      delete beHdrs['Content-Type'];
      const pagePath = `/funnels/page/${page.id}?locationId=${encodeURIComponent(req.locationId)}`;
      const pageRes  = await new Promise((resolve, reject) => {
        const r2 = https.request(
          { hostname: 'backend.leadconnectorhq.com', path: pagePath, method: 'GET', headers: beHdrs },
          (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve({ status: r.statusCode, data: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, data: d }); } }); }
        );
        r2.on('error', reject);
        r2.end();
      });
      if (pageRes.status === 200) {
        currentPage = pageRes.data;
        const stepId           = currentPage.stepId || currentPage.step_id || 'unknown';
        const existingSections = Array.isArray(currentPage.sections) ? currentPage.sections.length : 0;
        const sv               = currentPage.sectionVersion ?? '-';
        send('log', { msg: `[${i+1}/${pages.length}] Verified: stepId=${stepId} | sectionVersion=${sv} | existing sections=${existingSections}`, level: 'success' });
      } else {
        send('log', { msg: `[${i+1}/${pages.length}] Page read returned ${pageRes.status} — continuing`, level: 'warn' });
      }
    } catch (err) {
      send('log', { msg: `[${i+1}/${pages.length}] Page read warning: ${err.message.slice(0, 80)}`, level: 'warn' });
    }

    const colors     = colorScheme || 'modern, professional — white, dark navy, and gold accents';
    // ── Template selection: pick the best design template BEFORE generating ─────
    const design     = selectFunnelDesign(niche, offer);
    const hasCustomColors = colors && /#[0-9A-Fa-f]{6}/i.test(colors);
    const palette2   = hasCustomColors ? extractColors(colors) : design.palette;
    // Attach gradient strings to palette so section builder can apply them
    if (!hasCustomColors) {
      palette2.heroGradient = design.palette.heroGradient;
      palette2.ctaGradient  = design.palette.ctaGradient;
    }
    send('log', { msg: `Design template: "${design.name}" — ${design.emphasis}`, level: 'info' });

    const agentIntro = agentInfo ? `You are ${agentInfo.name}. ${agentInfo.persona || ''}\n${agentInfo.instructions}\n\n---\n\n` : '';
    const randId     = () => Math.random().toString(36).slice(2, 10);

    const imgSeeds2    = buildImgSeeds(niche, offer);
    const imgSrc2      = imgSeeds2[0];
    const sectionPlan2 = getSectionPlan(pageType, imgSrc2, palette2, imgSeeds2);

    // Groq system prompt — compact but rich schema
    const groqSysPrompt = `${agentIntro}You are a professional GHL funnel page JSON generator. Output ONLY valid JSON, no explanation, no markdown.
Root object: {"sections":[...]}. IDs MUST be unique: use {type}-${randId()} format for every id field.
CRITICAL element type names (exact): "heading","sub-heading","paragraph","button","bulletList","image". NO HTML in text fields. bulletList.items = array of plain strings ONLY.
Section children = FLAT array of elements — NO "row" or "column" wrapper objects.

Section schema: {"type":"section","name":"Name","styles":{"backgroundColor":{"value":"#HEX"},"paddingTop":{"value":100,"unit":"px"},"paddingBottom":{"value":100,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},"mobileStyles":{"paddingTop":{"value":60,"unit":"px"},"paddingBottom":{"value":60,"unit":"px"}},"children":[...]}

Element schemas — use EXACTLY these shapes, fill "text" field with real copy:
heading(h1): {"type":"heading","tag":"h1","text":"REAL HEADLINE","styles":{"color":{"value":"${palette2.heroText}"},"fontSize":{"value":56,"unit":"px"},"fontWeight":{"value":"700"},"lineHeight":{"value":1.1}},"mobileStyles":{"fontSize":{"value":34,"unit":"px"}}}
heading(h2): {"type":"heading","tag":"h2","text":"REAL SECTION HEADLINE","styles":{"color":{"value":"${palette2.bodyText}"},"fontSize":{"value":38,"unit":"px"},"fontWeight":{"value":"700"},"lineHeight":{"value":1.2}},"mobileStyles":{"fontSize":{"value":26,"unit":"px"}}}
sub-heading: {"type":"sub-heading","text":"REAL SUBHEAD","styles":{"color":{"value":"${palette2.heroText}"},"fontSize":{"value":22,"unit":"px"},"fontWeight":{"value":"400"},"lineHeight":{"value":1.6}},"mobileStyles":{"fontSize":{"value":18,"unit":"px"}}}
paragraph: {"type":"paragraph","text":"REAL body text. Plain text only, no HTML.","styles":{"color":{"value":"${palette2.heroText}"},"fontSize":{"value":18,"unit":"px"},"lineHeight":{"value":1.75}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}}
button: {"type":"button","text":"REAL CTA TEXT","link":"#","styles":{"backgroundColor":{"value":"${palette2.primary}"},"color":{"value":"${palette2.buttonColor}"},"fontSize":{"value":18,"unit":"px"},"fontWeight":{"value":"700"},"paddingTop":{"value":20,"unit":"px"},"paddingBottom":{"value":20,"unit":"px"},"paddingLeft":{"value":52,"unit":"px"},"paddingRight":{"value":52,"unit":"px"},"borderRadius":{"value":6,"unit":"px"}},"mobileStyles":{"paddingLeft":{"value":32,"unit":"px"},"paddingRight":{"value":32,"unit":"px"}}}
bulletList: {"type":"bulletList","items":["Real benefit 1","Real benefit 2","Real benefit 3"],"icon":{"name":"check","unicode":"f00c","fontFamily":"Font Awesome 5 Free"},"styles":{"color":{"value":"${palette2.bodyText}"},"fontSize":{"value":18,"unit":"px"},"lineHeight":{"value":1.8}},"mobileStyles":{}}
image: {"type":"image","src":"${imgSrc2}","alt":"relevant alt text","styles":{"width":{"value":100,"unit":"%"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{}}

DESIGN RULES:
- Hero and CTA sections: bg="${palette2.heroBg}", all text color="${palette2.heroText}"
- Middle content sections: alternate bg="${palette2.sectionBg}" and "#FFFFFF", text color="${palette2.bodyText}"
- Buttons always: bg="${palette2.primary}", color="${palette2.buttonColor}"
- Write compelling, conversion-focused copy specific to the niche and offer — NO placeholders
- Every section needs at least 3 children; hero needs at least 4
- You MUST generate the exact number of sections specified in the user message — no more, no less`;

    // Full system prompt for Claude/OpenAI/Gemini — includes explicit schema and template sections
    const fullSysPrompt = `${agentIntro}You are an expert GoHighLevel funnel copywriter and page builder. Your job: take the section templates below and fill in compelling, niche-specific copy for each element.

OUTPUT FORMAT — return ONLY valid JSON:
{
  "sections": [
    {
      "type": "section",
      "name": "Section Name",
      "styles": { "backgroundColor": {"value":"#HEX"}, "paddingTop":{"value":100,"unit":"px"}, "paddingBottom":{"value":100,"unit":"px"}, "paddingLeft":{"value":20,"unit":"px"}, "paddingRight":{"value":20,"unit":"px"} },
      "mobileStyles": { "paddingTop":{"value":60,"unit":"px"}, "paddingBottom":{"value":60,"unit":"px"} },
      "children": [ FLAT_ARRAY_OF_ELEMENTS ]
    }
  ]
}

CRITICAL RULES:
1. "children" is a FLAT array of element objects — NO "row" or "column" wrappers needed
2. Every section MUST have at least 2 elements in children
3. Element types: "heading", "sub-heading", "paragraph", "button", "bulletList", "image"
4. heading tag: "h1" for main headline, "h2" for section headlines
5. paragraph.text = plain text string, NEVER HTML tags
6. bulletList.items = plain string array ["Item 1","Item 2"], NEVER objects
7. Replace ALL [PLACEHOLDER] text with real, niche-specific copy
8. Keep all backgroundColor, fontSize, color, fontWeight values exactly as in the template
9. CRITICAL: If a section template has "layout":"three-column" and "columns":[], KEEP both fields. Fill in real testimonials in each column's "children" — do NOT flatten columns into "children"
10. Output ONLY the JSON — no markdown, no explanation, no code fences
11. DESIGN DEPTH: Hero and CTA sections should have strong background colors (no plain white heroes). Use the provided palette. Images get automatic 3D float animations — always include at least one image in hero sections.`;

    const systemPrompt = isGroq ? groqSysPrompt : fullSysPrompt;
    const sectionsNote = isGroq ? sectionPlan2.groq : sectionPlan2.full;

    const stageLabel = pageStage === 'TOFU'
      ? 'awareness and curiosity — the reader may not know your offer yet; attract and engage'
      : pageStage === 'MOFU'
      ? 'education and desire — the reader is warm; build authority, address objections, and deepen desire'
      : 'conversion and commitment — the reader is ready to buy; drive action with urgency and trust';

    const userPrompt = isGroq
      ? `Generate a native GHL ${pageType} JSON (page ${i + 1} of ${pages.length} — ${pageStage} stage).
Page role: "${pageRole}" | Copy focus: ${pageFocus}
Niche: ${niche} | Offer: ${offer} | Audience: ${audience || 'General prospects'}
Write ${stageLabel}.
${extraContext ? `Extra context: ${extraContext}\n` : ''}
${sectionsNote}
Output ONLY the JSON object.`
      : `You are filling in real copy for a ${pageType} — this is page ${i + 1} of ${pages.length} in the funnel.

FUNNEL POSITION:
- Page role: ${pageRole}
- Funnel stage: ${pageStage} — ${stageLabel}
- Copy focus: ${pageFocus}

BUSINESS CONTEXT:
- Niche: ${niche}
- Offer: ${offer}
- Target audience: ${audience || 'General prospects'}
- Color scheme: ${colors}
${extraContext ? `- Additional notes: ${extraContext}` : ''}

INSTRUCTIONS:
Take the section templates below and fill in compelling copy for this specific niche, offer, and funnel stage.
Every section must serve the page's goal: ${pageFocus}
Replace every [PLACEHOLDER] with real copy. Keep all styles/colors exactly as specified.

${sectionsNote}

Return ONLY the completed JSON object with real copy. No explanations.`;

    console.log(`[FunnelBuilder] userPrompt for "${page.name}" (first 800 chars):\n${userPrompt.slice(0, 800)}`);
    console.log(`[FunnelBuilder] systemPrompt for "${page.name}" (first 400 chars):\n${systemPrompt.slice(0, 400)}`);
    send('log', { msg: `[${i+1}/${pages.length}] Calling AI (${provider?.name}) to generate content...`, level: 'info' });

    // Count leaf elements for validation
    const countLeaves = (nodes) => {
      let n = 0;
      for (const node of (nodes || [])) {
        if (!node || typeof node !== 'object') continue;
        const ch = node.children || node.elements || [];
        if (node.type === 'row' || node.type === 'column' || node.type === 'section') n += countLeaves(ch);
        else n += 1;
      }
      return n;
    };

    let pageJson;
    let genError;

    if (isGroq) {
      // ── Groq: generate one section at a time to avoid the model stopping early ──
      // Build per-section prompts from the plan's sections array
      const planSections = sectionPlan2._sections; // raw section objects from the plan
      const groqSingleSys = `You are a GHL funnel section generator. Output ONLY a single valid JSON section object.
Return EXACTLY this structure — a raw JSON object, no array wrapper, no markdown:
{"type":"section","name":"NAME","styles":{"backgroundColor":{"value":"#HEX"},"paddingTop":{"value":100,"unit":"px"},"paddingBottom":{"value":100,"unit":"px"},"paddingLeft":{"value":20,"unit":"px"},"paddingRight":{"value":20,"unit":"px"}},"mobileStyles":{"paddingTop":{"value":60,"unit":"px"},"paddingBottom":{"value":60,"unit":"px"}},"children":[FLAT_ELEMENT_ARRAY]}
Element types: "heading","sub-heading","paragraph","button","bulletList","image"
heading: {"type":"heading","tag":"h1","text":"TEXT","styles":{"color":{"value":"#HEX"},"fontSize":{"value":56,"unit":"px"},"fontWeight":{"value":"700"},"lineHeight":{"value":1.1}},"mobileStyles":{"fontSize":{"value":34,"unit":"px"}}}
sub-heading: {"type":"sub-heading","text":"TEXT","styles":{"color":{"value":"#HEX"},"fontSize":{"value":22,"unit":"px"},"lineHeight":{"value":1.6}},"mobileStyles":{"fontSize":{"value":18,"unit":"px"}}}
paragraph: {"type":"paragraph","text":"TEXT","styles":{"color":{"value":"#HEX"},"fontSize":{"value":18,"unit":"px"},"lineHeight":{"value":1.75}},"mobileStyles":{"fontSize":{"value":16,"unit":"px"}}}
button: {"type":"button","text":"TEXT","link":"#","styles":{"backgroundColor":{"value":"${palette2.primary}"},"color":{"value":"${palette2.buttonColor}"},"fontSize":{"value":18,"unit":"px"},"fontWeight":{"value":"700"},"paddingTop":{"value":20,"unit":"px"},"paddingBottom":{"value":20,"unit":"px"},"paddingLeft":{"value":52,"unit":"px"},"paddingRight":{"value":52,"unit":"px"},"borderRadius":{"value":6,"unit":"px"}},"mobileStyles":{}}
bulletList: {"type":"bulletList","items":["Real item 1","Real item 2"],"icon":{"name":"check","unicode":"f00c","fontFamily":"Font Awesome 5 Free"},"styles":{"color":{"value":"#HEX"},"fontSize":{"value":18,"unit":"px"}},"mobileStyles":{}}
image: {"type":"image","src":"URL","alt":"alt","styles":{"width":{"value":100,"unit":"%"},"borderRadius":{"value":8,"unit":"px"}},"mobileStyles":{}}
RULES: All text fields must be real copy (no placeholders). bulletList.items = plain string array. No HTML in text.
THREE-COLUMN sections: If the prompt specifies "THREE-COLUMN", output the section with "layout":"three-column" and "columns":[{children:[...]},{children:[...]},{children:[...]}] — do NOT flatten into "children".`;

      const generatedSections = [];
      // Use plan sections if available, otherwise fall back to the groq description split
      const sectionTemplates = planSections && planSections.length
        ? planSections
        : sectionPlan2.groq.split('\n').filter(l => /^\d+\./.test(l)).map((l, idx) => ({ name: `Section ${idx+1}`, _desc: l }));

      for (let si = 0; si < sectionTemplates.length; si++) {
        const tmpl = sectionTemplates[si];
        const isHero = si === 0;
        const isLast = si === sectionTemplates.length - 1;
        const secBgColor   = isHero || isLast ? palette2.heroBg : (si % 2 === 0 ? '#FFFFFF' : palette2.sectionBg);
        const secTextColor = (isHero || isLast) ? palette2.heroText : palette2.bodyText;
        const secGradient  = isHero ? (palette2.heroGradient || null) : isLast ? (palette2.ctaGradient || null) : null;

        // Middle sections get a two-column hint: include an image element
        const isMidSection = !isHero && !isLast;
        const isThreeCol   = tmpl.layout === 'three-column';
        const secDesc = tmpl._desc || sectionPlan2.groq.split('\n').find(l => l.startsWith(`${si+1}.`)) || `Section ${si+1}`;
        const imgHint = isThreeCol
          ? `\nLAYOUT: THREE-COLUMN testimonial grid. Output "layout":"three-column" on the section object plus a "columns" array with exactly 3 objects. Each column "children": [image(src:"${imgSeeds2[si % imgSeeds2.length]}"), paragraph("⭐⭐⭐⭐⭐"), paragraph(real quote), paragraph(name+result)]. Section "children" = only the h2 heading.`
          : isMidSection
          ? `\nLAYOUT: Two-column section — include ONE image element (src="${imgSeeds2[si % imgSeeds2.length]}") plus heading, paragraph/bulletList, and optionally a button.`
          : `\nImage URL (use if adding an image): "${imgSeeds2[si % imgSeeds2.length]}"`;
        const gradHint = secGradient
          ? `\nGRADIENT: Add "backgroundGradient":{"value":"${secGradient}"} inside this section's styles object.`
          : '';
        const tmplName = tmpl.name || `Section ${si+1}`;
        const singleUserPrompt = `Generate section ${si+1} of ${sectionTemplates.length} for a "${pageType}" page.
This is page ${i+1} of ${pages.length} in a ${funnelType || 'sales'} funnel — ${pageStage} stage.
Page role: ${pageRole} | Page goal: ${pageFocus}
Section name: "${tmplName}" — the JSON "name" field MUST be exactly "${tmplName}".
Design theme: ${design.name} | Niche: ${niche} | Offer: ${offer} | Audience: ${audience || 'General prospects'}
Section structure and elements: ${secDesc}
Background: "${secBgColor}" | Text: "${secTextColor}" | Button: "${palette2.primary}"${gradHint}${imgHint}
Write ${stageLabel}. Make copy specific to this section's role ("${tmplName}"). No placeholders. Output ONLY the raw JSON section object.`;

        let secResult = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            if (attempt > 1) await new Promise(r => setTimeout(r, 3000));
            const raw = (await aiFunnel.generate(groqSingleSys, singleUserPrompt, { maxTokens: 1500 })).trim();
            // The response should be a section object, wrap in sections array for parseJsonSafe
            const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
            const parsed = JSON.parse(cleaned.startsWith('{') ? cleaned : `{${cleaned.split('{').slice(1).join('{')}}`);
            const validSection = parsed.type === 'section'
              && (Array.isArray(parsed.children) || (parsed.layout === 'three-column' && Array.isArray(parsed.columns)));
            if (validSection) {
              parsed.name = tmplName;
              // Preserve three-column layout from template if AI dropped it
              if (isThreeCol && !parsed.layout) {
                parsed.layout  = 'three-column';
                parsed.columns = tmpl.columns || parsed.columns || [];
              }
              secResult = parsed;
              break;
            }
          } catch (e) {
            send('log', { msg: `[${i+1}/${pages.length}] Section ${si+1} attempt ${attempt} failed: ${(e?.message||String(e)).slice(0,60)}`, level: 'warn' });
          }
        }

        if (secResult) {
          generatedSections.push(secResult);
          const kids = secResult.children || [];
          send('log', { msg: `[${i+1}/${pages.length}] Section ${si+1} "${secResult.name}" — ${kids.length} elements`, level: 'info' });
        } else {
          // Fallback: use the template section (preserves layout/columns for 3-col social proof)
          send('log', { msg: `[${i+1}/${pages.length}] Section ${si+1} failed — using template fallback`, level: 'warn' });
          if (tmpl.type === 'section') generatedSections.push({ ...tmpl });
        }
      }

      if (generatedSections.length > 0) {
        pageJson = { sections: generatedSections };
        genError = null;
      } else {
        genError = new Error('No sections generated by Groq');
      }

    } else {
      // ── Non-Groq (Claude/OpenAI/Gemini): single call with full template ──────
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (attempt > 1) {
            send('log', { msg: `[${i+1}/${pages.length}] Retry attempt ${attempt}/3...`, level: 'warn' });
            await new Promise(r => setTimeout(r, 1000));
          }
          const retryNote = attempt > 1 ? '\n\nIMPORTANT: Your previous response had invalid JSON. Output ONLY a raw JSON object, no text before or after, no code fences, no comments.' : '';
          const raw = (await aiFunnel.generate(systemPrompt, userPrompt + retryNote, { maxTokens: 8000 })).trim();
          send('log', { msg: `[${i+1}/${pages.length}] Raw AI (${raw.length} chars): ${raw.slice(0, 120)}`, level: 'info' });
          pageJson  = parseJsonSafe(raw);
          if (!pageJson.sections || !Array.isArray(pageJson.sections)) throw new Error('Missing sections array');
          const totalEls = pageJson.sections.reduce((sum, s) => sum + countLeaves(s.children || s.elements || []), 0);
          if (totalEls === 0) throw new Error('AI returned sections with no elements — retrying');
          genError = null;
          break;
        } catch (err) {
          genError = err;
          send('log', { msg: `[${i+1}/${pages.length}] AI attempt ${attempt} failed: ${(err?.message || String(err)).slice(0, 80)}`, level: 'warn' });
        }
      }
    }

    if (pageJson) {
      const secSummary = pageJson.sections.map((s, si) => {
        const kids = s.children || s.elements || [];
        return `s${si+1}:"${s.name||'?'}" kids=${kids.length} types=[${kids.map(k=>k?.type||'?').slice(0,4).join(',')}]`;
      }).join(' | ');
      send('log', { msg: `[${i+1}/${pages.length}] Parsed: ${secSummary}`, level: 'info' });
      const totalEls = pageJson.sections.reduce((sum, s) => sum + countLeaves(s.children || s.elements || []), 0);
      send('log', { msg: `[${i+1}/${pages.length}] AI generated ${pageJson.sections.length} sections, ${totalEls} elements`, level: 'success' });
    }
    if (genError) {
      send('log', { msg: `[${i+1}/${pages.length}] All AI attempts failed — skipping page`, level: 'error' });
      send('page_error', { index: i, pageId: page.id, name: page.name, error: `AI generation failed: ${genError.message}` });
      results.push({ pageId: page.id, name: page.name, success: false, error: genError.message });
      continue;
    }

    try {
      // ── Step C: Upload to Storage + write Firestore ──────────────────────
      send('log', { msg: `[${i+1}/${pages.length}] Uploading to Firebase Storage...`, level: 'info' });
      const saveRes = await saveWithFunnelHint(req.locationId, page.id, pageJson, funnelId, colorScheme, { figmaFonts: figmaContent.fonts || [] });
      const warn    = saveRes?.firestoreWarning;
      if (warn) {
        send('log', { msg: `[${i+1}/${pages.length}] Firestore warning: ${warn.slice(0, 120)}`, level: 'warn' });
      } else {
        send('log', { msg: `[${i+1}/${pages.length}] Firestore updated (v${saveRes.version}, sectionV${saveRes.sectionVersion})`, level: 'success' });
      }

      // ── Step D: POST to GHL's native copilot save endpoint ───────────────
      // This is the same endpoint GHL's own "Ask AI" feature calls internally.
      send('log', { msg: `[${i+1}/${pages.length}] Pushing to GHL backend save API...`, level: 'info' });
      try {
        const { buildBackendHeaders } = require('../services/ghlPageBuilder');
        const fbToken2  = await getFirebaseToken(req.locationId);
        const beHdrs2   = buildBackendHeaders(fbToken2);
        const ghlSects  = convertSectionsToGHL(pageJson.sections);
        const copilotBody = JSON.stringify({
          sections:            ghlSects,
          pageDataDownloadUrl: saveRes.downloadUrl,
          pageDataUrl:         saveRes.storagePath,
          sectionVersion:      saveRes.sectionVersion,
          pageVersion:         saveRes.pageVersion,
          version:             saveRes.version,
        });
        const copilotPath = `/funnel-ai/copilot/page-data/${page.id}?locationId=${encodeURIComponent(req.locationId)}`;
        const copilotRes  = await new Promise((resolve, reject) => {
          const r2 = https.request(
            { hostname: 'backend.leadconnectorhq.com', path: copilotPath, method: 'POST',
              headers: { ...beHdrs2, 'Content-Length': Buffer.byteLength(copilotBody) } },
            (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
              try { resolve({ status: r.statusCode, data: JSON.parse(d) }); }
              catch { resolve({ status: r.statusCode, data: d.slice(0, 200) }); }
            }); }
          );
          r2.on('error', reject);
          r2.write(copilotBody);
          r2.end();
        });
        if (copilotRes.status >= 200 && copilotRes.status < 300) {
          send('log', { msg: `[${i+1}/${pages.length}] GHL copilot save OK (${copilotRes.status}) — editor will refresh`, level: 'success' });
        } else {
          send('log', { msg: `[${i+1}/${pages.length}] GHL copilot save returned ${copilotRes.status} — Firestore write still active`, level: 'warn' });
        }
      } catch (putErr) {
        send('log', { msg: `[${i+1}/${pages.length}] GHL copilot save error: ${(putErr?.message || String(putErr)).slice(0, 80)}`, level: 'warn' });
      }

      send('page_done', { index: i, pageId: page.id, name: page.name, pageType, sectionsCount: pageJson.sections.length, warning: warn || undefined });
      results.push({ pageId: page.id, name: page.name, pageType, success: true, sectionsCount: pageJson.sections.length, warning: warn || undefined });
    } catch (err) {
      const errMsg = err?.message || String(err);
      send('log', { msg: `[${i+1}/${pages.length}] Save error: ${errMsg.slice(0, 120)}`, level: 'error' });
      send('page_error', { index: i, pageId: page.id, name: page.name, error: `Save failed: ${errMsg}` });
      results.push({ pageId: page.id, name: page.name, success: false, error: errMsg });
    }

    // Pace between pages for Groq TPM
    if (isGroq && i < pages.length - 1) {
      send('log', { msg: `Waiting 8s before next page (Groq rate limit)...`, level: 'info' });
      await new Promise(r => setTimeout(r, 8000));
    }
  }

  const succeeded = results.filter(r => r.success).length;
  send('log', { msg: `All done — ${succeeded}/${pages.length} pages generated successfully`, level: succeeded === pages.length ? 'success' : 'warn' });
  const firstPageId2 = results.find(r => r.success)?.pageId;
  const domain2 = (req.body.appDomain || 'https://app.gohighlevel.com').replace(/\/$/, '');
  const previewUrl2 = firstPageId2 ? `${domain2}/v2/preview/${firstPageId2}` : null;
  send('complete', { total: pages.length, succeeded, failed: pages.length - succeeded, results, previewUrl: previewUrl2 });
  res.end();
});

module.exports = router;
