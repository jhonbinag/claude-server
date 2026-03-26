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

// ── Logger ─────────────────────────────────────────────────────────────────────

function log(level, locationId, action, data = {}) {
  const ts  = new Date().toISOString();
  const tag = `[VibeAI][${level.toUpperCase()}]`;
  const ctx = locationId ? ` loc=${locationId}` : '';
  const extra = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `${ts} ${tag}${ctx} ${action}${extra}`
  );
}

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
  const locId = req.locationId;

  if (!prompt) return res.status(400).json({ error: '"prompt" is required.' });

  log('info', locId, 'generate:start', { pageType, hasImage: !!imageBase64, promptLen: prompt.length });

  // SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) =>
    res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);

  const t0 = Date.now();

  try {
    const token = await ghlClient.getValidAccessToken(locId);
    log('info', locId, 'generate:token_ok');

    send('log', { msg: 'Connecting to GHL AI Studio...', level: 'info' });

    // Build the project payload
    const projectPayload = {
      name:        prompt.slice(0, 200),
      description: prompt,
      alt_id:      locId,
      alt_type:    'location',
      type:        pageType,
    };

    if (imageBase64) {
      projectPayload.imageData = imageBase64;
      projectPayload.imageType = imageMediaType || 'image/png';
      log('info', locId, 'generate:image_attached', { mediaType: imageMediaType || 'image/png' });
    }

    send('log', { msg: 'Creating AI Studio project...', level: 'info' });
    log('info', locId, 'generate:create_project', { name: projectPayload.name.slice(0, 60) });

    const project = await vibeRequest('POST', '/vibe-ai/projects', token, projectPayload);
    const projectId = project?.id || project?.data?.id;

    if (!projectId) {
      log('error', locId, 'generate:no_project_id', { response: JSON.stringify(project).slice(0, 200) });
      throw new Error(`No project ID returned. Response: ${JSON.stringify(project).slice(0, 200)}`);
    }

    log('info', locId, 'generate:project_created', { projectId });
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
        log('warn', locId, 'generate:poll_error', { projectId, poll: polls, error: pollErr.message.slice(0, 80) });
        send('log', { msg: `Poll error (${pollErr.message.slice(0, 80)}) — retrying...`, level: 'warn' });
        continue;
      }

      const state = (status?.status || status?.data?.status || '').toLowerCase();
      log('info', locId, 'generate:poll', { projectId, poll: polls, state });
      send('status', { state, polls, projectId, project: status });
      send('log', { msg: `[${polls}/${MAX_POLLS}] Status: ${state || 'unknown'}`, level: 'info' });

      if (state === 'completed' || state === 'done' || state === 'success') {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        log('info', locId, 'generate:done', { projectId, polls, elapsedSec: elapsed });
        send('done', { projectId, project: status });
        res.end();
        return;
      }
      if (state === 'failed' || state === 'error' || state === 'cancelled') {
        log('error', locId, 'generate:failed', { projectId, state, polls });
        throw new Error(`AI Studio generation ${state}: ${JSON.stringify(status).slice(0, 200)}`);
      }
    }

    log('error', locId, 'generate:timeout', { projectId, polls: MAX_POLLS });
    throw new Error('AI Studio generation timed out after 4 minutes.');
  } catch (err) {
    log('error', locId, 'generate:error', { error: err.message });
    send('error', { error: err.message });
    res.end();
  }
});

// ── GET /vibe-ai/projects — list all projects for this location ────────────────

router.get('/projects', async (req, res) => {
  const locId = req.locationId;
  log('info', locId, 'list_projects');
  try {
    const token    = await ghlClient.getValidAccessToken(locId);
    const projects = await vibeRequest(
      'GET',
      `/vibe-ai/projects?alt_id=${locId}&alt_type=location`,
      token
    );
    const count = Array.isArray(projects?.data) ? projects.data.length : Array.isArray(projects) ? projects.length : '?';
    log('info', locId, 'list_projects:ok', { count });
    res.json(projects);
  } catch (err) {
    log('error', locId, 'list_projects:error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /vibe-ai/projects/:id — get single project status/result ──────────────

router.get('/projects/:id', async (req, res) => {
  const locId     = req.locationId;
  const projectId = req.params.id;
  log('info', locId, 'get_project', { projectId });
  try {
    const token   = await ghlClient.getValidAccessToken(locId);
    const project = await vibeRequest('GET', `/vibe-ai/projects/${projectId}`, token);
    const state   = (project?.status || project?.data?.status || 'unknown').toLowerCase();
    log('info', locId, 'get_project:ok', { projectId, state });
    res.json(project);
  } catch (err) {
    log('error', locId, 'get_project:error', { projectId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
