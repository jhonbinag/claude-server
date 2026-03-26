/**
 * src/routes/vibeAi.js
 *
 * Proxy to GHL's native Vibe AI Builder (AI Studio).
 * Mounts at /vibe-ai
 *
 * POST /vibe-ai/generate   — create a Vibe AI project (prompt + optional image), stream progress
 * GET  /vibe-ai/projects   — list projects for this location
 * GET  /vibe-ai/projects/:id — get project status/result
 */

const express    = require('express');
const https      = require('https');
const router     = express.Router();
const authenticate = require('../middleware/authenticate');
const ghlClient  = require('../services/ghlClient');

const VIBE_HOST = 'leadgen-vibe-ai-builder.leadconnectorhq.com';

// ── Low-level HTTPS helper ─────────────────────────────────────────────────────

function vibeRequest(method, path, token, body = null, isMultipart = false, multipartBoundary = null) {
  return new Promise((resolve, reject) => {
    const payload = body && !isMultipart ? JSON.stringify(body) : body;
    const contentType = isMultipart
      ? `multipart/form-data; boundary=${multipartBoundary}`
      : 'application/json';

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request(
      { hostname: VIBE_HOST, path, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          try {
            const parsed = JSON.parse(raw);
            if (res.statusCode >= 400) {
              reject(new Error(`Vibe AI ${res.statusCode}: ${JSON.stringify(parsed).slice(0, 300)}`));
            } else {
              resolve(parsed);
            }
          } catch {
            // Some responses may be non-JSON
            if (res.statusCode >= 400) reject(new Error(`Vibe AI ${res.statusCode}: ${raw.slice(0, 300)}`));
            else resolve({ raw });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Middleware ─────────────────────────────────────────────────────────────────

router.use(authenticate);

// ── POST /vibe-ai/generate ─────────────────────────────────────────────────────
// Body: { prompt, imageBase64?, imageMediaType?, pageType? }
// Streams SSE: log | created | status | done | error

router.post('/generate', async (req, res) => {
  const { prompt, imageBase64, imageMediaType, pageType = 'funnel' } = req.body;

  if (!prompt) return res.status(400).json({ error: '"prompt" is required.' });

  // SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) =>
    res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);

  try {
    const token = await ghlClient.getValidAccessToken(req.locationId);

    send('log', { msg: 'Connecting to GHL AI Studio...', level: 'info' });

    // Build the project payload
    const projectPayload = {
      name:        prompt.slice(0, 200),
      description: prompt,
      alt_id:      req.locationId,
      alt_type:    'location',
      type:        pageType, // 'funnel' | 'website'
    };

    // If image supplied, attach it
    if (imageBase64) {
      projectPayload.imageData    = imageBase64;
      projectPayload.imageType    = imageMediaType || 'image/png';
    }

    send('log', { msg: 'Creating AI Studio project...', level: 'info' });

    const project = await vibeRequest('POST', '/vibe-ai/projects', token, projectPayload);
    const projectId = project?.id || project?.data?.id;

    if (!projectId) {
      throw new Error(`No project ID returned. Response: ${JSON.stringify(project).slice(0, 200)}`);
    }

    send('created', { projectId, project });
    send('log', { msg: `Project created (${projectId}) — waiting for generation...`, level: 'info' });

    // Poll for completion
    const POLL_INTERVAL = 4000;
    const MAX_POLLS     = 60; // 4 min max
    let polls = 0;

    while (polls < MAX_POLLS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      polls++;

      let status;
      try {
        status = await vibeRequest('GET', `/vibe-ai/projects/${projectId}`, token);
      } catch (pollErr) {
        send('log', { msg: `Poll error (${pollErr.message.slice(0, 80)}) — retrying...`, level: 'warn' });
        continue;
      }

      const state = (status?.status || status?.data?.status || '').toLowerCase();
      send('status', { state, polls, projectId, project: status });
      send('log', { msg: `[${polls}/${MAX_POLLS}] Status: ${state || 'unknown'}`, level: 'info' });

      if (state === 'completed' || state === 'done' || state === 'success') {
        send('done', { projectId, project: status });
        res.end();
        return;
      }
      if (state === 'failed' || state === 'error' || state === 'cancelled') {
        throw new Error(`AI Studio generation ${state}: ${JSON.stringify(status).slice(0, 200)}`);
      }
    }

    throw new Error('AI Studio generation timed out after 4 minutes.');
  } catch (err) {
    console.error('[VibeAI] Error:', err.message);
    send('error', { error: err.message });
    res.end();
  }
});

// ── GET /vibe-ai/projects — list all projects for this location ────────────────

router.get('/projects', async (req, res) => {
  try {
    const token    = await ghlClient.getValidAccessToken(req.locationId);
    const projects = await vibeRequest(
      'GET',
      `/vibe-ai/projects?alt_id=${req.locationId}&alt_type=location`,
      token
    );
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /vibe-ai/projects/:id — get single project status/result ──────────────

router.get('/projects/:id', async (req, res) => {
  try {
    const token   = await ghlClient.getValidAccessToken(req.locationId);
    const project = await vibeRequest('GET', `/vibe-ai/projects/${req.params.id}`, token);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
