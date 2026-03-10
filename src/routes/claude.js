/**
 * src/routes/claude.js
 *
 * Claude AI Task Router
 *
 * Mounts at /claude — requires x-api-key authentication (same as /api/v1).
 *
 * Endpoints:
 *
 *   POST /claude/task          → Stream task execution via SSE
 *   POST /claude/task/sync     → Run task synchronously, return JSON result
 *
 * Request body (both endpoints):
 *   {
 *     "task": "Search for all contacts tagged 'lead' and send them an intro SMS",
 *     "stream": true   (only relevant for /task — defaults to true)
 *   }
 *
 * Authentication injects req.locationId, req.companyId from x-api-key header.
 *
 * SSE event format (for /claude/task):
 *   event: text         → { text: "..." }          Claude response text delta
 *   event: tool_call    → { name, input }           Claude is calling a GHL tool
 *   event: tool_result  → { name, result }          GHL tool returned data
 *   event: done         → { message, turns, toolCallCount }
 *   event: error        → { error: "..." }
 */

const express      = require('express');
const multer       = require('multer');
const FormData     = require('form-data');
const axios        = require('axios');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const claudeSvc    = require('../services/claudeService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// All Claude routes require a valid x-api-key
router.use(authenticate);

// ─── POST /claude/task — Streaming SSE ────────────────────────────────────────

router.post('/task', async (req, res) => {
  const { task, allowedIntegrations } = req.body;

  if (!task || typeof task !== 'string' || !task.trim()) {
    return res.status(400).json({
      success: false,
      error:   'Request body must include a non-empty "task" string.',
    });
  }

  // Set up SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  const send = (eventName, data) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await claudeSvc.runTask({
      task:                task.trim(),
      locationId:          req.locationId,
      companyId:           req.companyId,
      allowedIntegrations: Array.isArray(allowedIntegrations) ? allowedIntegrations : null,
      onEvent: (evt) => {
        switch (evt.type) {
          case 'text':
            send('text', { text: evt.text });
            break;
          case 'tool_call':
            send('tool_call', { name: evt.name, input: evt.input });
            break;
          case 'tool_result':
            send('tool_result', { name: evt.name, result: evt.result });
            break;
          case 'done':
            send('done', {
              message:       evt.message,
              turns:         evt.turns,
              toolCallCount: evt.toolCallCount,
            });
            break;
          case 'error':
            send('error', { error: evt.error });
            break;
        }
      },
    });
  } catch (err) {
    send('error', { error: err.message });
  }

  res.end();
});

// ─── POST /claude/task/sync — Synchronous JSON response ───────────────────────

router.post('/task/sync', async (req, res) => {
  const { task, allowedIntegrations } = req.body;

  if (!task || typeof task !== 'string' || !task.trim()) {
    return res.status(400).json({
      success: false,
      error:   'Request body must include a non-empty "task" string.',
    });
  }

  try {
    const result = await claudeSvc.runTask({
      task:                task.trim(),
      locationId:          req.locationId,
      companyId:           req.companyId,
      allowedIntegrations: Array.isArray(allowedIntegrations) ? allowedIntegrations : null,
    });

    res.json({
      success:       true,
      result:        result.result,
      turns:         result.turns,
      toolCallCount: result.toolCallCount,
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ─── POST /claude/voice — Transcribe audio then run as task ──────────────────
// Accepts multipart/form-data with an "audio" file (webm, mp4, wav, m4a, ogg).
// Transcribes via OpenAI Whisper, then streams the task result.

router.post('/voice', upload.single('audio'), async (req, res) => {
  const registry = require('../tools/toolRegistry');

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No audio file uploaded. Send field name: audio' });
  }

  // Get OpenAI key — from location toolConfigs or global env
  const toolConfigs = await registry.loadToolConfigs(req.locationId);
  const openAiKey   = (toolConfigs.openai && toolConfigs.openai.apiKey) || process.env.OPENAI_API_KEY;

  if (!openAiKey) {
    return res.status(400).json({
      success: false,
      error:   'Voice transcription requires an OpenAI API key. Connect OpenAI in the dashboard or set OPENAI_API_KEY.',
    });
  }

  // Transcribe with Whisper
  let transcript;
  try {
    const form = new FormData();
    form.append('file',  req.file.buffer, { filename: req.file.originalname || 'audio.webm', contentType: req.file.mimetype });
    form.append('model', 'whisper-1');
    form.append('language', 'en');

    const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${openAiKey}` },
    });
    transcript = whisperRes.data.text;
  } catch (err) {
    return res.status(502).json({ success: false, error: `Whisper transcription failed: ${err.message}` });
  }

  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ success: false, error: 'Could not transcribe audio — audio may be silent or unclear.' });
  }

  // Stream the task result (same as /claude/task)
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (eventName, data) => res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);

  // First emit the transcript so the UI can display what was heard
  send('transcript', { text: transcript });

  try {
    await claudeSvc.runTask({
      task:       transcript.trim(),
      locationId: req.locationId,
      companyId:  req.companyId,
      onEvent: (evt) => {
        switch (evt.type) {
          case 'text':        send('text',        { text: evt.text });                           break;
          case 'tool_call':   send('tool_call',   { name: evt.name, input: evt.input });         break;
          case 'tool_result': send('tool_result', { name: evt.name, result: evt.result });       break;
          case 'done':        send('done',        { message: evt.message, turns: evt.turns, toolCallCount: evt.toolCallCount }); break;
          case 'error':       send('error',       { error: evt.error });                         break;
        }
      },
    });
  } catch (err) {
    send('error', { error: err.message });
  }

  res.end();
});

// ─── GET /claude/status — Quick health check ──────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const registry = require('../tools/toolRegistry');
    const config   = require('../config');
    const configs  = await registry.loadToolConfigs(req.locationId);
    const tools    = await registry.getTools(req.locationId);
    const hasKey   = !!(configs.anthropic?.apiKey || config.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY);
    res.json({
      success:      true,
      locationId:   req.locationId,
      claudeReady:  hasKey,
      model:        'claude-opus-4-6',
      enabledTools: tools.map((t) => t.name),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;