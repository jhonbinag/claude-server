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

const express       = require('express');
const router        = express.Router();
const authenticate  = require('../middleware/authenticate');
const workflowStore = require('../services/workflowStore');
const claudeService = require('../services/claudeService');

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
    res.json({ success: true, data: wf });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /workflows/:id ─────────────────────────────────────────────────────

router.delete('/:id', authenticate, async (req, res) => {
  try {
    await workflowStore.deleteWorkflow(req.locationId, req.params.id);
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
    const prompt  = buildPrompt(workflow.steps, workflow.context, req.body);
    const allowed = [...new Set(workflow.steps.map((s) => s.tool).filter((t) => t !== 'ghl'))];

    const result = await claudeService.runTask({
      task:                prompt,
      locationId,
      allowedIntegrations: allowed.length ? allowed : null,
    });

    res.json({
      success:       true,
      workflow:      workflow.name,
      result:        result.result,
      turns:         result.turns,
      toolCallCount: result.toolCallCount,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
