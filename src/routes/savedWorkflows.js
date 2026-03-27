/**
 * src/routes/savedWorkflows.js
 *
 * Mounts at /workflows
 *
 * Endpoints:
 *   GET    /workflows                    List saved workflows for a location
 *   POST   /workflows                    Save / update a workflow
 *   DELETE /workflows/:id               Delete a workflow
 *   POST   /workflows/trigger/:token    Webhook trigger — runs workflow, returns JSON result
 */

const express          = require('express');
const router           = express.Router();
const authenticate     = require('../middleware/authenticate');
const workflowStore    = require('../services/workflowStore');
const scheduleStore    = require('../services/scheduleStore');
const claudeService    = require('../services/claudeService');
const activityLogger   = require('../services/activityLogger');
const toolRegistry     = require('../tools/toolRegistry');

// ── Build structured prompt from workflow steps ───────────────────────────────

function buildPrompt(steps, context, webhookPayload) {
  const stepLines = steps
    .map((s, i) => `STEP ${i + 1} [${s.label || s.tool.toUpperCase()}]:\n${s.instruction}`)
    .join('\n\n');
  const ctxNote     = context ? `\n\nContext: ${context}` : '';
  const payloadNote = webhookPayload && Object.keys(webhookPayload).length
    ? `\n\nWebhook payload received: ${JSON.stringify(webhookPayload)}`
    : '';
  return `Execute this multi-step workflow:\n\n${stepLines}${ctxNote}${payloadNote}\n\nComplete all steps in order and summarize results at the end.`;
}

// ── GET /workflows ────────────────────────────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  try {
    const list = await workflowStore.listWorkflows(req.locationId);
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /workflows ───────────────────────────────────────────────────────────

router.post('/', authenticate, async (req, res) => {
  const { id, name, steps, context } = req.body;
  if (!name || !Array.isArray(steps) || !steps.length) {
    return res.status(400).json({ success: false, error: '"name" and at least one step are required.' });
  }
  try {
    const wf = await workflowStore.saveWorkflow(req.locationId, { id, name, steps, context });
    activityLogger.log({
      locationId: req.locationId,
      event:      'workflow_save',
      detail:     { workflowId: wf.id, workflowName: name, steps: steps.length, isUpdate: !!id },
      success:    true,
    });
    res.json({ success: true, data: wf });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /workflows/schedules — list schedules for this location ───────────────

router.get('/schedules', authenticate, async (req, res) => {
  try {
    const list = await scheduleStore.listSchedules(req.locationId);
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /workflows/schedules — create a schedule ─────────────────────────────

router.post('/schedules', authenticate, async (req, res) => {
  const { workflowId, type, scheduledAt, time, dayOfWeek, dayOfMonth } = req.body;
  if (!workflowId || !type) {
    return res.status(400).json({ success: false, error: '"workflowId" and "type" are required.' });
  }
  try {
    const list = await workflowStore.listWorkflows(req.locationId);
    const wf   = list.find((w) => w.id === workflowId);
    if (!wf) return res.status(404).json({ success: false, error: 'Workflow not found.' });

    const sched = await scheduleStore.createSchedule(req.locationId, {
      workflowId,
      workflowName: wf.name,
      webhookToken: wf.webhookToken,
      type, scheduledAt, time, dayOfWeek, dayOfMonth,
    });
    activityLogger.log({
      locationId: req.locationId,
      event:      'workflow_schedule_create',
      detail:     { scheduleId: sched.id, workflowId, type, nextRun: sched.nextRun },
      success:    true,
    });
    res.json({ success: true, data: sched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /workflows/schedules/:id — delete a schedule ──────────────────────
// IMPORTANT: must be registered before DELETE /:id to avoid route collision

router.delete('/schedules/:id', authenticate, async (req, res) => {
  try {
    await scheduleStore.deleteSchedule(req.params.id, req.locationId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /workflows/:id ─────────────────────────────────────────────────────

router.delete('/:id', authenticate, async (req, res) => {
  try {
    await workflowStore.deleteWorkflow(req.locationId, req.params.id);
    activityLogger.log({
      locationId: req.locationId,
      event:      'workflow_delete',
      detail:     { workflowId: req.params.id },
      success:    true,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /workflows/trigger/:token — Webhook (no auth, uses token) ────────────
// Useful for triggering from external systems (GHL automations, Zapier, etc.)
// Optional JSON body is forwarded to Claude as webhook payload context.

router.post('/trigger/:token', async (req, res) => {
  try {
    const found = await workflowStore.getByWebhookToken(req.params.token);
    if (!found) return res.status(404).json({ success: false, error: 'Workflow not found or token invalid.' });

    const { locationId, workflow } = found;
    const prompt    = buildPrompt(workflow.steps, workflow.context, req.body);
    const requested = [...new Set(workflow.steps.map((s) => s.tool).filter((t) => t !== 'ghl'))];
    const shared    = await toolRegistry.getSharedIntegrations(locationId);
    const allowed   = requested.filter((category) => shared.includes(category));

    const result = await claudeService.runTask({
      task:                prompt,
      locationId,
      allowedIntegrations: allowed,
    });

    activityLogger.log({
      locationId,
      event:   'workflow_trigger',
      detail:  { workflowId: workflow.id, workflowName: workflow.name, steps: workflow.steps.length, turns: result.turns, toolCallCount: result.toolCallCount },
      success: true,
    });

    res.json({
      success:       true,
      workflow:      workflow.name,
      result:        result.result,
      turns:         result.turns,
      toolCallCount: result.toolCallCount,
    });
  } catch (err) {
    activityLogger.log({ locationId: req.params.token, event: 'workflow_trigger', detail: { error: err.message }, success: false });
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
