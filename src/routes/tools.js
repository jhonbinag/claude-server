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
const planTierStore    = require('../services/planTierStore');
const billingStore     = require('../services/billingStore');
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
// Delegates entirely to toolRegistry.saveToolConfig which handles Firebase/Redis
// correctly and always repopulates the cache — avoids stale-empty-cache bugs.

async function persistToolConfig(locationId, category, configObj) {
  await toolRegistry.saveToolConfig(locationId, category, configObj);
}

async function deletePersistedToolConfig(locationId, category) {
  if (config.isFirebaseEnabled) {
    await firebaseStore.deleteToolConfig(locationId, category);
  } else {
    const existing = await toolRegistry.getToolConfig(locationId);
    const updated  = { ...existing };
    delete updated[category];
    await toolTokenService.setCachedToolConfig(locationId, updated, 90 * 24 * 3600);
  }
}

// ─── GET /tools — list all integrations ──────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const allMeta = toolRegistry.getAllIntegrationsMeta();
    const configs = await toolRegistry.getToolConfig(req.locationId);
    const enabled = new Set(await toolRegistry.getEnabledIntegrations(req.locationId));

    // Tier info
    let tierKey = 'bronze';
    let tierCfg = null;
    try {
      const billing = await billingStore.getBilling(req.locationId);
      tierKey = billing?.tier || 'bronze';
      tierCfg = await planTierStore.getTier(tierKey);
    } catch { /* non-fatal */ }

    const list = allMeta.map((meta) => {
      const isEnabled    = enabled.has(meta.key);
      const tierAllowed  = !tierCfg || tierCfg.allowedIntegrations === null || (Array.isArray(tierCfg.allowedIntegrations) && tierCfg.allowedIntegrations.includes(meta.key));
      const limitReached = !isEnabled && tierCfg && tierCfg.integrationLimit !== -1 && enabled.size >= tierCfg.integrationLimit;
      return {
        ...meta,
        enabled:       isEnabled,
        configPreview: isEnabled ? maskConfig(configs[meta.key]) : null,
        tierLocked:    !isEnabled && (!tierAllowed || limitReached),
        tierReason:    !isEnabled && !tierAllowed
          ? `Not available on ${tierCfg?.name || 'your'} plan`
          : !isEnabled && limitReached
            ? `${tierCfg?.name || 'Your'} plan limit reached (${tierCfg?.integrationLimit} max)`
            : null,
      };
    });

    res.json({ success: true, data: list, tier: tierKey, tierConfig: tierCfg });
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
      if (!cfg.webhookUrl) throw new Error('Slack webhook URL not configured.');
      const r = await axios.post(cfg.webhookUrl, { text: '✅ HL Pro Tools — Slack integration connected successfully!' }, { timeout: 10000 });
      if (r.data !== 'ok') throw new Error('Webhook returned unexpected response');
      info = 'Slack webhook verified — test message sent';
    } else if (category === 'apollo') {
      await axios.post('https://api.apollo.io/v1/auth/health', {},
        { headers: { 'X-Api-Key': cfg.apiKey, 'Content-Type': 'application/json' }, timeout: 10000 }
      );
    } else if (category === 'heygen') {
      await axios.get('https://api.heygen.com/v1/user/remaining.quota', {
        headers: { 'X-Api-Key': cfg.apiKey },
        timeout: 10000,
      });
    } else if (category === 'stripe') {
      if (!cfg.secretKey) throw new Error('Secret key not configured.');
      const r = await axios.get('https://api.stripe.com/v1/account', {
        auth: { username: cfg.secretKey, password: '' },
        timeout: 10000,
      });
      info = `Stripe connected (${r.data.email || r.data.id})`;
    } else if (category === 'paypal') {
      if (!cfg.clientId || !cfg.clientSecret) throw new Error('Client ID and Secret required.');
      const base = cfg.mode === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
      const r = await axios.post(`${base}/v1/oauth2/token`,
        'grant_type=client_credentials',
        {
          auth: { username: cfg.clientId, password: cfg.clientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        }
      );
      info = `PayPal connected (${cfg.mode || 'live'} — token ok)`;
    } else if (category === 'square') {
      if (!cfg.accessToken) throw new Error('Access token not configured.');
      const base = cfg.environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
      const r = await axios.get(`${base}/v2/merchants`, {
        headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Square-Version': '2024-01-18' },
        timeout: 10000,
      });
      const merchant = r.data?.merchant?.[0];
      info = `Square connected${merchant ? ` (${merchant.business_name || merchant.id})` : ''}`;
    } else if (category === 'manychat') {
      if (!cfg.apiKey) throw new Error('API Key not configured.');
      const r = await axios.get('https://api.manychat.com/fb/page/getInfo', {
        headers: { Authorization: `Bearer ${cfg.apiKey}` }, timeout: 10000,
      });
      info = `ManyChat connected (${r.data?.data?.name || r.data?.data?.id || 'page ok'})`;
    } else if (category === 'google_my_business') {
      if (!cfg.accessToken) throw new Error('Access token not configured.');
      const r = await axios.get('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: 10000,
      });
      const acct = r.data?.accounts?.[0];
      info = `Google Business Profile connected (${acct?.accountName || acct?.name || 'ok'})`;
    } else if (category === 'shopify') {
      if (!cfg.shopDomain || !cfg.accessToken) throw new Error('Shop domain and access token required.');
      const r = await axios.get(`https://${cfg.shopDomain}/admin/api/2024-01/shop.json`, {
        headers: { 'X-Shopify-Access-Token': cfg.accessToken }, timeout: 10000,
      });
      info = `Shopify connected (${r.data?.shop?.name || cfg.shopDomain})`;
    } else if (category === 'woocommerce') {
      if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) throw new Error('Site URL, consumer key and secret required.');
      await axios.get(`${cfg.siteUrl}/wp-json/wc/v3/system_status`, {
        auth: { username: cfg.consumerKey, password: cfg.consumerSecret }, timeout: 10000,
      });
      info = `WooCommerce connected (${cfg.siteUrl})`;
    } else if (category === 'google_calendar') {
      if (!cfg.accessToken) throw new Error('Access token not configured.');
      const r = await axios.get('https://www.googleapis.com/calendar/v3/calendars/primary', {
        headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: 10000,
      });
      info = `Google Calendar connected (${r.data?.summary || r.data?.id || 'ok'})`;
    } else if (category === 'linkedin') {
      if (!cfg.accessToken) throw new Error('Access token not configured.');
      const r = await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: 10000,
      });
      info = `LinkedIn connected (${r.data?.name || r.data?.email || 'ok'})`;
    } else if (category === 'google_contacts') {
      if (!cfg.accessToken) throw new Error('Access token not configured.');
      const r = await axios.get('https://people.googleapis.com/v1/people/me', {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        params: { personFields: 'names,emailAddresses' }, timeout: 10000,
      });
      info = `Google Contacts connected (${r.data?.names?.[0]?.displayName || 'ok'})`;
    } else if (category === 'google_forms') {
      if (!cfg.accessToken) throw new Error('Access token not configured.');
      const r = await axios.get('https://www.googleapis.com/drive/v3/files', {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        params: { q: "mimeType='application/vnd.google-apps.form'", pageSize: 1 }, timeout: 10000,
      });
      info = `Google Forms connected (${r.data?.files?.length ?? 0}+ forms found)`;
    } else if (category === 'airtable') {
      if (!cfg.apiKey || !cfg.baseId) throw new Error('API key and Base ID required.');
      const r = await axios.get(`https://api.airtable.com/v0/meta/bases/${cfg.baseId}/tables`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` }, timeout: 10000,
      });
      info = `Airtable connected (${r.data?.tables?.length || 0} tables in base)`;
    } else if (category === 'monday') {
      if (!cfg.apiToken) throw new Error('API token not configured.');
      const r = await axios.post('https://api.monday.com/v2',
        { query: '{ me { id name } }' },
        { headers: { Authorization: cfg.apiToken, 'Content-Type': 'application/json' }, timeout: 10000 }
      );
      info = `Monday.com connected (${r.data?.data?.me?.name || 'ok'})`;
    } else if (category === 'typeform') {
      if (!cfg.accessToken) throw new Error('Access token not configured.');
      const r = await axios.get('https://api.typeform.com/me', {
        headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: 10000,
      });
      info = `Typeform connected (${r.data?.alias || r.data?.email || 'ok'})`;
    } else if (category === 'asana') {
      if (!cfg.accessToken) throw new Error('Access token not configured.');
      const r = await axios.get('https://app.asana.com/api/1.0/users/me', {
        headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: 10000,
      });
      info = `Asana connected (${r.data?.data?.name || r.data?.data?.email || 'ok'})`;
    } else if (category === 'canva') {
      if (!cfg.accessToken) throw new Error('Access token not configured.');
      const r = await axios.get('https://api.canva.com/rest/v1/users/me', {
        headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: 10000,
      });
      info = `Canva connected (${r.data?.display_name || r.data?.email || 'ok'})`;
    } else if (category === 'tiktok_ads') {
      if (!cfg.accessToken) throw new Error('Access token not configured.');
      const r = await axios.get('https://business-api.tiktok.com/open_api/v1.3/user/info/', {
        headers: { 'Access-Token': cfg.accessToken }, timeout: 10000,
      });
      info = `TikTok Ads connected (${r.data?.data?.display_name || 'ok'})`;
    } else if (category === 'google_ads') {
      if (!cfg.accessToken || !cfg.customerId || !cfg.developerToken) throw new Error('Access token, customer ID and developer token required.');
      await axios.get(`https://googleads.googleapis.com/v17/customers/${cfg.customerId}`, {
        headers: { Authorization: `Bearer ${cfg.accessToken}`, 'developer-token': cfg.developerToken },
        timeout: 10000,
      });
      info = `Google Ads connected (customer ${cfg.customerId})`;
    } else if (category === 'openrouter') {
      if (!cfg.apiKey) throw new Error('API key not configured.');
      await axios.get('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${cfg.apiKey}` }, params: { limit: 1 }, timeout: 10000,
      });
      info = 'OpenRouter connected';
    } else if (category === 'gravity_forms') {
      if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) throw new Error('Site URL, consumer key and secret required.');
      const r = await axios.get(`${cfg.siteUrl}/wp-json/gf/v2/forms`, {
        auth: { username: cfg.consumerKey, password: cfg.consumerSecret }, timeout: 10000,
      });
      const count = Array.isArray(r.data) ? r.data.length : Object.keys(r.data || {}).length;
      info = `Gravity Forms connected (${count} forms)`;
    } else if (category === 'http_client') {
      const targetUrl = cfg.baseUrl || 'https://httpbin.org/get';
      let parsedHeaders = {};
      try { if (cfg.defaultHeaders) parsedHeaders = JSON.parse(cfg.defaultHeaders); } catch { /* ignore */ }
      await axios.get(targetUrl, { headers: parsedHeaders, timeout: 10000 });
      info = `HTTP Client connected (${targetUrl} reachable)`;
    } else if (category === 'hubspot') {
      if (!cfg.accessToken) throw new Error('Private App Token not configured.');
      const r = await axios.get('https://api.hubapi.com/crm/v3/objects/contacts', {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        params: { limit: 1 },
        timeout: 10000,
      });
      info = `HubSpot connected (${r.data.total ?? 0} contacts)`;
    } else if (category === 'keap') {
      if (!cfg.apiKey) throw new Error('API Key not configured.');
      const r = await axios.get('https://api.infusionsoft.com/crm/rest/v1/account/profile', {
        headers: { 'X-Keap-API-Key': cfg.apiKey },
        timeout: 10000,
      });
      info = `Keap connected (${r.data.name || r.data.account_name || 'account ok'})`;
    } else if (category === 'authorizenet') {
      if (!cfg.apiLoginId || !cfg.transactionKey) throw new Error('API Login ID and Transaction Key required.');
      const host = cfg.mode === 'live' ? 'https://api.authorize.net' : 'https://apitest.authorize.net';
      const r = await axios.post(`${host}/xml/v1/request.api`, {
        authenticateTestRequest: {
          merchantAuthentication: { name: cfg.apiLoginId, transactionKey: cfg.transactionKey },
        },
      }, { timeout: 10000 });
      if (r.data?.messages?.resultCode !== 'Ok') {
        throw new Error(r.data?.messages?.message?.[0]?.text || 'Authentication failed');
      }
      info = `Authorize.net connected (${cfg.mode || 'sandbox'})`;

    } else if (category === 'social_facebook') {
      const { pageAccessToken, pageId } = cfg;
      if (!pageAccessToken) throw new Error('Page Access Token required');
      const r = await axios.get(`https://graph.facebook.com/v19.0/${pageId || 'me'}`, { params: { access_token: pageAccessToken, fields: 'id,name,fan_count' } });
      info = `Facebook Page: ${r.data.name} (${r.data.fan_count?.toLocaleString() || 0} followers)`;

    } else if (category === 'social_instagram') {
      const { pageAccessToken, igUserId } = cfg;
      if (!pageAccessToken || !igUserId) throw new Error('Facebook Page Access Token and Instagram User ID required');
      const r = await axios.get(`https://graph.facebook.com/v19.0/${igUserId}`, { params: { access_token: pageAccessToken, fields: 'id,name,followers_count' } });
      info = `Instagram: @${r.data.name} (${r.data.followers_count?.toLocaleString() || 0} followers)`;

    } else if (category === 'social_tiktok_organic') {
      const { accessToken } = cfg;
      if (!accessToken) throw new Error('TikTok Access Token required');
      const r = await axios.get('https://open.tiktokapis.com/v2/user/info/', { headers: { Authorization: `Bearer ${accessToken}` }, params: { fields: 'display_name,follower_count' } });
      info = `TikTok: @${r.data.data?.user?.display_name} (${r.data.data?.user?.follower_count?.toLocaleString() || 0} followers)`;

    } else if (category === 'social_youtube') {
      const { accessToken, channelId } = cfg;
      if (!accessToken || !channelId) throw new Error('OAuth Access Token and Channel ID required');
      const r = await axios.get('https://www.googleapis.com/youtube/v3/channels', { headers: { Authorization: `Bearer ${accessToken}` }, params: { part: 'snippet,statistics', id: channelId } });
      const ch = r.data.items?.[0];
      info = `YouTube: ${ch?.snippet?.title} (${parseInt(ch?.statistics?.subscriberCount || 0).toLocaleString()} subscribers)`;

    } else if (category === 'social_linkedin_organic') {
      const { accessToken, organizationId } = cfg;
      if (!accessToken || !organizationId) throw new Error('OAuth Access Token and Organization ID required');
      const r = await axios.get(`https://api.linkedin.com/v2/organizations/${organizationId}`, { headers: { Authorization: `Bearer ${accessToken}`, 'LinkedIn-Version': '202401' } });
      info = `LinkedIn: ${r.data.localizedName} — connected`;

    } else if (category === 'social_pinterest') {
      const { accessToken } = cfg;
      if (!accessToken) throw new Error('Pinterest Access Token required');
      const r = await axios.get('https://api.pinterest.com/v5/user_account', { headers: { Authorization: `Bearer ${accessToken}` } });
      info = `Pinterest: @${r.data.username} (${r.data.follower_count?.toLocaleString() || 0} followers)`;
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

  // ── Tier enforcement ──────────────────────────────────────────────────────
  try {
    const billing        = await billingStore.getBilling(req.locationId);
    const tierKey        = billing?.tier || 'bronze';
    const currentEnabled = await toolRegistry.getEnabledIntegrations(req.locationId);
    // Only count if this is a new integration (not already enabled)
    const alreadyEnabled = currentEnabled.includes(category);
    if (!alreadyEnabled) {
      const { allowed, reason } = await planTierStore.checkTierAccess(tierKey, category, currentEnabled.length);
      if (!allowed) {
        return res.status(403).json({ success: false, error: reason, tierLocked: true });
      }
    }
  } catch (tierErr) {
    console.warn('[Tools] Tier check failed (non-fatal):', tierErr.message);
    // Non-fatal — allow the connection if tier check fails
  }

  try {
    await persistToolConfig(req.locationId, category, filtered);
    // Cache already updated by toolRegistry.saveToolConfig — no separate invalidation needed

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

  // The Anthropic/Claude API key is a permanent connection — it can only be
  // removed by explicitly deleting it from the database (admin action), never
  // through the generic tools disconnect flow.
  if (category === 'anthropic') {
    return res.status(403).json({
      success: false,
      error:   'The Claude API key cannot be removed through this endpoint. Delete it directly from the database if needed.',
    });
  }

  const allMeta      = toolRegistry.getAllIntegrationsMeta();
  const meta         = allMeta.find((m) => m.key === category);
  const label        = meta?.label ?? category;

  try {
    const configs = await toolRegistry.getToolConfig(req.locationId);

    if (!configs[category] || Object.keys(configs[category]).length === 0) {
      return res.status(404).json({ success: false, error: `${label} is not currently connected.` });
    }

    await deletePersistedToolConfig(req.locationId, category);
    // Explicitly invalidate cache after delete so next read hits Firebase fresh
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
