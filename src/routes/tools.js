/**
 * src/routes/tools.js
 *
 * Tool Integration Management API
 *
 * Mounts at /tools — requires x-api-key authentication.
 *
 * Endpoints:
 *   GET    /tools                     List all integrations + enabled status
 *   GET    /tools/sync                Full sync status with token health info
 *   POST   /tools/reconnect           Refresh token when idle/expired
 *   POST   /tools/test/:category      Live API credential validation
 *   GET    /tools/:category           Get masked config for one integration
 *   POST   /tools/:category           Save/update config → Firebase + cache + token
 *   DELETE /tools/:category           Disconnect → Firebase + cache + revoke token
 *
 * Route ordering: /sync, /reconnect, /test/:category MUST come before /:category
 */

const express          = require('express');
const axios            = require('axios');
const router           = express.Router();
const authenticate     = require('../middleware/authenticate');
const firebaseStore    = require('../services/firebaseStore');
const toolTokenService = require('../services/toolTokenService');
const tokenStore       = require('../services/tokenStore');
const toolRegistry     = require('../tools/toolRegistry');
const activityLogger   = require('../services/activityLogger');
const config           = require('../config');

router.use(authenticate);

// ─── Mask sensitive values for GET responses ──────────────────────────────────

function maskConfig(cfg) {
  if (!cfg) return {};
  const masked = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (typeof v === 'string' && v.length > 8) {
      masked[k] = v.slice(0, 4) + '•'.repeat(8) + v.slice(-4);
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

// ─── Helper: persist config through the correct tier ─────────────────────────

async function persistToolConfig(locationId, category, configObj) {
  if (config.isFirebaseEnabled) {
    await firebaseStore.saveToolConfig(locationId, category, configObj);
  } else {
    const existing = await toolRegistry.getToolConfig(locationId);
    tokenStore.saveToolConfig(locationId, { ...existing, [category]: configObj });
  }
}

async function deletePersistedToolConfig(locationId, category) {
  if (config.isFirebaseEnabled) {
    await firebaseStore.deleteToolConfig(locationId, category);
  } else {
    const existing = await toolRegistry.getToolConfig(locationId);
    const updated  = { ...existing };
    delete updated[category];
    tokenStore.saveToolConfig(locationId, updated);
  }
}

// ─── GET /tools — list all integrations ──────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const allMeta = toolRegistry.getAllIntegrationsMeta();
    const configs = await toolRegistry.getToolConfig(req.locationId);
    const enabled = new Set(await toolRegistry.getEnabledIntegrations(req.locationId));

    const list = allMeta.map((meta) => ({
      ...meta,
      enabled:       enabled.has(meta.key),
      configPreview: enabled.has(meta.key) ? maskConfig(configs[meta.key]) : null,
    }));

    res.json({ success: true, data: list });
  } catch (err) {
    console.error('[Tools] GET / error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list integrations.' });
  }
});

// ─── GET /tools/sync — full sync status with token health ────────────────────

router.get('/sync', async (req, res) => {
  try {
    const allMeta   = toolRegistry.getAllIntegrationsMeta();
    const enabled   = new Set(await toolRegistry.getEnabledIntegrations(req.locationId));
    const allTools  = await toolRegistry.getTools(req.locationId);
    const tokenStat = await toolTokenService.getTokenStatus(req.locationId);

    const integrations = allMeta.map((meta) => ({
      key:       meta.key,
      label:     meta.label,
      icon:      meta.icon,
      enabled:   enabled.has(meta.key),
      toolCount: meta.toolCount,
      toolNames: meta.toolNames,
    }));

    res.json({
      success:         true,
      locationId:      req.locationId,
      totalTools:      allTools.length,
      tokenStatus:     tokenStat.status,           // 'active' | 'idle' | 'expired' | 'none'
      tokenIdleDays:   tokenStat.idleDays,          // days since lastActive
      tokenLastActive: tokenStat.lastActive,        // epoch ms
      idleThresholdDays:   toolTokenService.TOKEN_IDLE_DAYS,    // 3
      expireThresholdDays: toolTokenService.TOKEN_EXPIRE_DAYS,  // 7
      integrations,
    });
  } catch (err) {
    console.error('[Tools] GET /sync error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to sync integrations.' });
  }
});

// ─── POST /tools/reconnect — refresh token when idle/expired ─────────────────
// The user hits "Reconnect" in the UI after 3+ days idle.
// This resets lastActive and regenerates the token without touching configs.

router.post('/reconnect', async (req, res) => {
  try {
    const enabledCategories = await toolRegistry.getEnabledIntegrations(req.locationId);
    const token = await toolTokenService.generateToolSessionToken(req.locationId, enabledCategories);

    activityLogger.log({
      locationId: req.locationId,
      event:      'tool_reconnect',
      detail:     { categories: enabledCategories },
      success:    true,
      ip:         req.ip,
    });

    console.log(`[Tools] Reconnect for location ${req.locationId} (${enabledCategories.length} integrations)`);

    res.json({
      success:    true,
      message:    'Connection refreshed successfully.',
      toolToken:  token,
      categories: enabledCategories,
    });
  } catch (err) {
    console.error('[Tools] POST /reconnect error:', err.message);
    res.status(500).json({ success: false, error: 'Reconnect failed: ' + err.message });
  }
});

// ─── POST /tools/test/:category — live API validation ────────────────────────

router.post('/test/:category', async (req, res) => {
  const { category } = req.params;
  const allMeta = toolRegistry.getAllIntegrationsMeta();
  const meta    = allMeta.find((m) => m.key === category);

  if (!meta) return res.status(404).json({ success: false, error: `Unknown integration: ${category}` });

  try {
    const configs = await toolRegistry.getToolConfig(req.locationId);
    const cfg     = configs[category];

    if (!cfg || Object.keys(cfg).length === 0) {
      return res.status(400).json({ success: false, error: `${meta.label} is not configured yet.` });
    }

    let info = `${meta.label} connected`;

    if (category === 'perplexity') {
      await axios.post('https://api.perplexity.ai/chat/completions',
        { model: 'sonar', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 },
        { headers: { Authorization: `Bearer ${cfg.apiKey}` }, timeout: 10000 }
      );
    } else if (category === 'openai') {
      await axios.get('https://api.openai.com/v1/models',
        { headers: { Authorization: `Bearer ${cfg.apiKey}` }, params: { limit: 1 }, timeout: 10000 }
      );
    } else if (category === 'facebook_ads') {
      const r = await axios.get('https://graph.facebook.com/v20.0/me', {
        params: { access_token: cfg.accessToken, fields: 'id,name' },
        timeout: 10000,
      });
      info = `Facebook connected as ${r.data.name || r.data.id}`;
    } else if (category === 'sendgrid') {
      const r = await axios.get('https://api.sendgrid.com/v3/user/profile', {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        timeout: 10000,
      });
      info = `SendGrid connected (${r.data.email || 'verified'})`;
    } else if (category === 'slack') {
      const r = await axios.post('https://slack.com/api/auth.test', null, {
        headers: { Authorization: `Bearer ${cfg.botToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      });
      if (!r.data.ok) throw new Error(r.data.error);
      info = `Slack connected (workspace: ${r.data.team})`;
    } else if (category === 'apollo') {
      await axios.post('https://api.apollo.io/v1/auth/health', {},
        { headers: { 'X-Api-Key': cfg.apiKey, 'Content-Type': 'application/json' }, timeout: 10000 }
      );
    } else if (category === 'heygen') {
      await axios.get('https://api.heygen.com/v1/user/remaining.quota', {
        headers: { 'X-Api-Key': cfg.apiKey },
        timeout: 10000,
      });
    }

    res.json({ success: true, info });
  } catch (err) {
    const msg = err.response?.data?.error?.message
      || err.response?.data?.message
      || err.response?.data?.error
      || err.message;
    res.json({ success: false, error: String(msg) });
  }
});

// ─── GET /tools/:category — masked config ────────────────────────────────────

router.get('/:category', async (req, res) => {
  const { category } = req.params;
  const allMeta      = toolRegistry.getAllIntegrationsMeta();
  const meta         = allMeta.find((m) => m.key === category);

  if (!meta) return res.status(404).json({ success: false, error: `Unknown integration: ${category}` });

  try {
    const configs = await toolRegistry.getToolConfig(req.locationId);
    res.json({
      success: true,
      data: {
        ...meta,
        enabled:       !!(configs[category] && Object.keys(configs[category]).length),
        configPreview: maskConfig(configs[category] || {}),
      },
    });
  } catch (err) {
    console.error(`[Tools] GET /${category} error:`, err.message);
    res.status(500).json({ success: false, error: 'Failed to load integration config.' });
  }
});

// ─── POST /tools/:category — save config ─────────────────────────────────────

router.post('/:category', async (req, res) => {
  const { category } = req.params;
  const allMeta      = toolRegistry.getAllIntegrationsMeta();
  const meta         = allMeta.find((m) => m.key === category);

  if (!meta) return res.status(404).json({ success: false, error: `Unknown integration: ${category}` });

  const allowedKeys = meta.configFields.map((f) => f.key);
  const filtered    = {};
  for (const key of allowedKeys) {
    if (req.body[key] !== undefined && req.body[key] !== '') {
      filtered[key] = req.body[key];
    }
  }

  if (Object.keys(filtered).length === 0) {
    return res.status(400).json({ success: false, error: 'No valid config fields provided.' });
  }

  try {
    await persistToolConfig(req.locationId, category, filtered);
    await toolTokenService.invalidateToolConfigCache(req.locationId);

    const enabledCategories = await toolRegistry.getEnabledIntegrations(req.locationId);
    const token = await toolTokenService.generateToolSessionToken(req.locationId, enabledCategories);

    activityLogger.log({
      locationId: req.locationId,
      event:      'tool_connect',
      detail:     { category, label: meta.label },
      success:    true,
      ip:         req.ip,
    });

    console.log(`[Tools] ${meta.label} connected for location ${req.locationId}`);

    res.json({
      success:       true,
      message:       `${meta.label} connected successfully.`,
      enabled:       true,
      configPreview: maskConfig(filtered),
      toolToken:     token,
    });
  } catch (err) {
    activityLogger.log({
      locationId: req.locationId,
      event:      'tool_connect',
      detail:     { category, error: err.message },
      success:    false,
      ip:         req.ip,
    });
    console.error(`[Tools] POST /${category} error:`, err.message);
    res.status(500).json({ success: false, error: `Failed to save ${meta.label} config: ${err.message}` });
  }
});

// ─── DELETE /tools/:category — disconnect ────────────────────────────────────

router.delete('/:category', async (req, res) => {
  const { category } = req.params;
  const allMeta      = toolRegistry.getAllIntegrationsMeta();
  const meta         = allMeta.find((m) => m.key === category);
  const label        = meta?.label ?? category;

  try {
    const configs = await toolRegistry.getToolConfig(req.locationId);

    if (!configs[category] || Object.keys(configs[category]).length === 0) {
      return res.status(404).json({ success: false, error: `${label} is not currently connected.` });
    }

    await deletePersistedToolConfig(req.locationId, category);
    await toolTokenService.invalidateToolConfigCache(req.locationId);

    const enabledCategories = await toolRegistry.getEnabledIntegrations(req.locationId);
    const token = await toolTokenService.generateToolSessionToken(req.locationId, enabledCategories);

    activityLogger.log({
      locationId: req.locationId,
      event:      'tool_disconnect',
      detail:     { category, label },
      success:    true,
      ip:         req.ip,
    });

    console.log(`[Tools] ${label} disconnected for location ${req.locationId}`);

    res.json({ success: true, message: `${label} disconnected successfully.`, toolToken: token });
  } catch (err) {
    console.error(`[Tools] DELETE /${category} error:`, err.message);
    res.status(500).json({ success: false, error: `Failed to disconnect ${label}: ${err.message}` });
  }
});

module.exports = router;
