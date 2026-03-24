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
    res.json({ success: true, ran, total: due.length, results });
  } catch (err) {
    console.error('[Cron] run-schedules fatal error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /cron/brain-sync ──────────────────────────────────────────────────────
// Runs weekly — discovers new videos from all channels in brains with autoSync=true.
// Only collects video metadata (no transcript fetching) to stay within 60s timeout.

router.get('/brain-sync', cronAuth, async (req, res) => {
  const tag = '[cron/brain-sync]';
  console.log(tag, 'Starting weekly brain sync');

  try {
    const locationIds = await brain.listBrainLocations();
    console.log(tag, `Found ${locationIds.length} location(s) with brains`);

    const results = [];
    let totalChannels = 0;
    let totalVideos   = 0;

    for (const locationId of locationIds) {
      let brains;
      try {
        brains = await brain.listBrains(locationId);
      } catch (e) {
        console.error(tag, `listBrains failed for ${locationId}:`, e.message);
        continue;
      }

      const autoBrains = brains.filter(b => b.autoSync);
      if (!autoBrains.length) continue;

      console.log(tag, `  ${locationId} — ${autoBrains.length} auto-sync brain(s)`);

      for (const b of autoBrains) {
        const channels = (b.channels || []).filter(c => c.channelUrl);
        for (const ch of channels) {
          totalChannels++;
          try {
            const r = await brain.queueChannelSync(locationId, b.brainId, ch.channelId);
            totalVideos += r.videoCount || r.queued || 0;
            results.push({ locationId, brainId: b.brainId, channel: ch.channelName, videoCount: r.videoCount || r.queued, status: 'ok' });
            console.log(tag, `    ✓ ${ch.channelName} — ${r.videoCount || r.queued} videos`);
          } catch (e) {
            console.error(tag, `    ✗ ${ch.channelName}: ${e.message}`);
            results.push({ locationId, brainId: b.brainId, channel: ch.channelName, status: 'error', error: e.message });
          }
        }
      }
    }

    console.log(tag, `Done — ${totalChannels} channel(s), ${totalVideos} total videos catalogued`);
    res.json({ success: true, locations: locationIds.length, channels: totalChannels, videos: totalVideos, results });
  } catch (err) {
    console.error(tag, 'Fatal error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
