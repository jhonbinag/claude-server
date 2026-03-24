/**
 * src/routes/cron.js
 *
 * Mounts at /cron
 *
 * GET /cron/run-schedules — called by Vercel cron every hour
 *   Validates CRON_SECRET, finds all due workflow schedules, executes them.
 */

const express       = require('express');
const router        = express.Router();
const scheduleStore = require('../services/scheduleStore');
const workflowStore = require('../services/workflowStore');
const claudeService = require('../services/claudeService');
const activityLogger = require('../services/activityLogger');
const brain         = require('../services/brainStore');

// ── Auth ──────────────────────────────────────────────────────────────────────

function cronAuth(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return next(); // dev: skip auth if not configured
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Prompt builder (simple linear) ────────────────────────────────────────────

function buildPrompt(steps, context) {
  const stepLines = (steps || [])
    .map((s, i) => `STEP ${i + 1} [${s.label || (s.tool || '').toUpperCase()}]:\n${s.instruction || `Execute ${s.label}`}`)
    .join('\n\n');
  const ctxNote = context ? `\n\nContext: ${context}` : '';
  return `Execute this multi-step workflow:\n\n${stepLines}${ctxNote}\n\nComplete all steps in order and summarize results.`;
}

// ── GET /cron/run-schedules ───────────────────────────────────────────────────

router.get('/run-schedules', cronAuth, async (req, res) => {
  try {
    const due = await scheduleStore.getDueSchedules();

    if (due.length === 0) {
      return res.json({ success: true, ran: 0, message: 'No schedules due.' });
    }

    const results = [];

    for (const sched of due) {
      try {
        const found = await workflowStore.getByWebhookToken(sched.webhookToken);
        if (!found) {
          // Workflow deleted — clean up orphaned schedule
          await scheduleStore.deleteSchedule(sched.id, sched.locationId);
          results.push({ scheduleId: sched.id, status: 'skipped', reason: 'workflow not found' });
          continue;
        }

        const { locationId, workflow } = found;
        const prompt  = buildPrompt(workflow.steps, workflow.context);
        const allowed = [...new Set((workflow.steps || []).map((s) => s.tool).filter((t) => t && t !== 'ghl'))];

        const result = await claudeService.runTask({
          task:                prompt,
          locationId,
          allowedIntegrations: allowed.length ? allowed : null,
        });

        await scheduleStore.markRan(sched.id);

        activityLogger.log({
          locationId,
          event:   'workflow_scheduled_run',
          detail:  {
            scheduleId:   sched.id,
            scheduleType: sched.type,
            workflowId:   workflow.id,
            workflowName: workflow.name,
            turns:        result.turns,
            toolCallCount: result.toolCallCount,
          },
          success: true,
        });

        results.push({ scheduleId: sched.id, workflowId: workflow.id, status: 'ok', turns: result.turns });
      } catch (err) {
        console.error('[Cron] schedule run error:', sched.id, err.message);
        activityLogger.log({
          locationId: sched.locationId,
          event:      'workflow_scheduled_run',
          detail:     { scheduleId: sched.id, error: err.message },
          success:    false,
        });
        results.push({ scheduleId: sched.id, status: 'error', error: err.message });
      }
    }

    const ran = results.filter((r) => r.status === 'ok').length;
    console.log(`[Cron] Ran ${ran}/${due.length} scheduled workflows.`);

    // Also check brain auto-sync (lightweight Redis-only check)
    const brainsFlagged = await checkBrainAutoSync();

    res.json({ success: true, ran, total: due.length, brainsFlagged, results });
  } catch (err) {
    console.error('[Cron] run-schedules fatal error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Brain auto-sync check (runs as part of daily run-schedules) ──────────────
// Lightweight: only reads Redis, flags brains that need sync (no YouTube calls).
// The frontend picks up `needs_sync` and drives incremental discovery + batch processing.

async function checkBrainAutoSync() {
  const tag = '[cron/brain-autosync]';
  const SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  try {
    const locationIds = await brain.listBrainLocations();
    let flagged = 0;
    for (const locationId of locationIds) {
      let brainList;
      try { brainList = await brain.listBrains(locationId); } catch { continue; }
      for (const b of brainList) {
        if (!b.autoSync) continue;
        const last = b.lastSynced ? new Date(b.lastSynced).getTime() : 0;
        if (Date.now() - last >= SYNC_INTERVAL_MS && b.pipelineStage !== 'syncing' && b.pipelineStage !== 'processing') {
          await brain.updateBrainMeta(locationId, b.brainId, { pipelineStage: 'needs_sync' });
          flagged++;
          console.log(tag, `Flagged ${b.name} (${b.brainId.slice(-6)}) — last synced: ${b.lastSynced || 'never'}`);
        }
      }
    }
    console.log(tag, `Done — ${flagged} brain(s) flagged for sync`);
    return flagged;
  } catch (e) {
    console.error(tag, 'Error:', e.message);
    return 0;
  }
}

module.exports = router;
