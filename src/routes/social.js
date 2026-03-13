/**
 * social.js — Social Planner routes
 * Proxies GoHighLevel Social Media Posting API endpoints.
 * Requires GHL OAuth tokens (req.ghl set by authenticate middleware).
 */

const express      = require('express');
const router       = express.Router();
const axios        = require('axios');
const authenticate = require('../middleware/authenticate');
const ghlClient    = require('../services/ghlClient');
const toolRegistry = require('../tools/toolRegistry');
const config       = require('../config');

router.use(authenticate);

// Normalize GHL platform type strings → our internal keys
function normalizePlatformType(raw = '') {
  const t = raw.toLowerCase();
  if (t.includes('facebook'))   return 'facebook';
  if (t.includes('instagram'))  return 'instagram';
  if (t.includes('tiktok'))     return 'tiktok';
  if (t.includes('youtube'))    return 'youtube';
  if (t.includes('linkedin'))   return 'linkedin';
  if (t.includes('pinterest'))  return 'pinterest';
  if (t.includes('twitter') || t.includes('x.com')) return 'twitter';
  if (t.includes('gmb') || t.includes('google'))    return 'gmb';
  return t;
}

// Auto-sync GHL social accounts into toolRegistry so the command center
// knows which platforms are connected (stored as a single 'ghl_social_planner' key).
async function syncGhlAccountsToRegistry(locationId, accounts) {
  if (!accounts || !accounts.length) return;
  try {
    const platforms = [...new Set(accounts.map(a => normalizePlatformType(a.type || a.platform || a.accountType || '')))];
    await toolRegistry.saveToolConfig(locationId, 'ghl_social_planner', {
      accounts:           accounts.map(a => ({
        id:       a.id || a.accountId,
        name:     a.name || a.displayName,
        type:     a.type || a.platform || a.accountType,
        platform: normalizePlatformType(a.type || a.platform || a.accountType || ''),
        avatar:   a.avatar || a.picture || a.profilePicture,
        followers: a.followers || a.followerCount || null,
      })),
      platforms,
      syncedAt: new Date().toISOString(),
    });
    console.log(`[Social] Synced ${accounts.length} GHL social accounts to toolRegistry for ${locationId}`);
  } catch (e) {
    console.warn('[Social] Failed to sync accounts to toolRegistry:', e.message);
  }
}

// GET /social/debug — diagnose token + GHL social API for this location
router.get('/debug', async (req, res) => {
  const tokenStore = require('../services/tokenStore');
  const record = await tokenStore.getTokenRecord(req.locationId).catch(() => null);
  let ghlRaw = null;
  let ghlError = null;
  if (req.ghl) {
    try {
      ghlRaw = await req.ghl('GET', `/social-media-posting/${req.locationId}/accounts`);
    } catch (e) {
      ghlError = e.message;
    }
  }
  res.json({
    locationId:    req.locationId,
    hasRecord:     !!record,
    hasAccessToken: !!(record && record.accessToken),
    tokenExpired:  record ? (Date.now() >= record.expiresAt) : null,
    companyId:     record?.companyId || null,
    ghlAttached:   !!req.ghl,
    ghlRaw,
    ghlError,
  });
});

// GET /social/accounts — list connected social accounts (GHL + toolRegistry)
router.get('/accounts', async (req, res) => {
  let ghlAccounts = [];
  let ghlError    = null;

  // Try GHL social planner first (requires OAuth)
  if (req.ghl) {
    try {
      const data = await req.ghl('GET', `/social-media-posting/${req.locationId}/accounts`);
      console.log('[Social] accounts raw:', JSON.stringify(data)?.substring(0, 300));
      // GHL returns { results: { accounts: [...], groups: [...] } }
      ghlAccounts = Array.isArray(data) ? data
        : data?.results?.accounts || data?.accounts || data?.data || data?.socialAccounts || data?.result || [];
      // Auto-sync to toolRegistry in background
      syncGhlAccountsToRegistry(req.locationId, ghlAccounts);
    } catch (err) {
      ghlError = err.message;
      console.error('[Social] GHL accounts error:', err.message);
    }
  }

  // Also read toolRegistry social entries (direct OAuth connections via socialAuth.js)
  let registryAccounts = [];
  try {
    const configs = await toolRegistry.getToolConfig(req.locationId);
    console.log('[Social] registry configs keys:', Object.keys(configs || {}));
    const socialKeys = ['social_facebook', 'social_instagram', 'social_tiktok_organic', 'social_youtube', 'social_linkedin_organic', 'social_pinterest', 'social_twitter', 'social_gmb'];
    for (const key of socialKeys) {
      const c = configs[key];
      // Accept any config that has any sign of connection (not just pageName)
      const isConnected = c && (c.pageName || c.pageId || c.accessToken || c.pageAccessToken || c.channelId || c.organizationId || c.openId);
      if (isConnected) {
        const platform = key.replace('social_', '').replace('_organic', '');
        registryAccounts.push({
          id:        c.pageId || c.channelId || c.organizationId || c.openId || key,
          name:      c.pageName || c.channelName || c.name || platform,
          type:      platform,
          platform:  platform,
          avatar:    c.picture || c.avatar || '',
          followers: c.followers || 0,
          source:    'registry',
        });
      }
    }
    console.log('[Social] registryAccounts:', registryAccounts.map(a => `${a.platform}:${a.name}`));
  } catch (e) {
    console.error('[Social] registryAccounts error:', e.message);
  }

  // Merge: GHL accounts take priority; add registry-only accounts if not already in GHL list
  // Always inject a normalized `platform` field so the frontend can reliably match tiles.
  const merged = [...ghlAccounts.map(a => {
    const platform = normalizePlatformType(a.type || a.platform || a.accountType || a.account_type || '');
    return { ...a, platform, source: 'ghl' };
  })];
  console.log('[Social] ghlAccounts normalized:', merged.map(a => `${a.platform}:${a.name || a.id}`));
  for (const ra of registryAccounts) {
    const alreadyPresent = merged.some(a => a.platform === ra.platform);
    if (!alreadyPresent) merged.push(ra);
  }
  console.log('[Social] merged accounts:', merged.map(a => `${a.platform}:${a.name}`));

  res.json({
    accounts: merged,
    ghlConnected: !!req.ghl,
    ghlError: ghlError || undefined,
  });
});

// Maps GHL social planner accounts → individual social_* toolRegistry keys
// so they appear as "Connected via GHL" in External Integrations.
async function mapGhlAccountsToIntegrationKeys(locationId, accounts) {
  const platformKeyMap = {
    facebook:  'social_facebook',
    instagram: 'social_instagram',
    youtube:   'social_youtube',
    linkedin:  'social_linkedin_organic',
    tiktok:    'social_tiktok_organic',
    pinterest: 'social_pinterest',
    twitter:   'social_twitter',
    gmb:       'social_gmb',
  };
  for (const acc of accounts) {
    const platform = normalizePlatformType(acc.type || acc.platform || acc.accountType || '');
    const toolKey  = platformKeyMap[platform];
    if (!toolKey) continue;
    // Read existing config so we don't overwrite manually-entered tokens
    const existing = (await toolRegistry.getToolConfig(locationId))[toolKey] || {};
    // Only write if not already manually configured (no pageAccessToken or accessToken)
    if (existing.pageAccessToken || existing.accessToken) continue;
    await toolRegistry.saveToolConfig(locationId, toolKey, {
      ...existing,
      pageName:     acc.name || acc.displayName || platform,
      pageId:       acc.id   || acc.accountId   || '',
      picture:      acc.avatar || acc.profilePicture || '',
      followers:    acc.followers || acc.followerCount || 0,
      ghlConnected: true,   // flag: came from GHL, no direct token
      connectedAt:  new Date().toISOString(),
    });
    console.log(`[Social] Mapped GHL ${platform} → ${toolKey} for location ${locationId}`);
  }
}

// POST /social/sync — explicit sync: pull GHL accounts → toolRegistry
router.post('/sync', async (req, res) => {
  if (!req.ghl) {
    return res.status(200).json({
      success:     false,
      synced:      0,
      platforms:   [],
      code:        'GHL_OAUTH_REQUIRED',
      error:       'GHL OAuth not connected for this location.',
      reinstallUrl: '/oauth/install',
    });
  }
  try {
    // Fetch social planner accounts + location data in parallel
    const [socialData, locationData] = await Promise.allSettled([
      req.ghl('GET', `/social-media-posting/${req.locationId}/accounts`),
      req.ghl('GET', `/locations/${req.locationId}`),
    ]);

    const raw      = socialData.status === 'fulfilled' ? socialData.value : {};
    const accounts = Array.isArray(raw) ? raw
      : raw?.results?.accounts || raw?.accounts || raw?.data || raw?.socialAccounts || raw?.result || [];

    const locInfo  = locationData.status === 'fulfilled' ? locationData.value?.location || locationData.value : {};

    // Sync social planner → ghl_social_planner aggregate key
    await syncGhlAccountsToRegistry(req.locationId, accounts);

    // Map each platform account → individual social_* key (without token)
    await mapGhlAccountsToIntegrationKeys(req.locationId, accounts);

    // Extract any location-level social/integration info
    const locationSocial = locInfo.social || {};

    // ── Auto-configure facebook_ads from existing social_facebook token ────────
    // If social_facebook has a token but facebook_ads is not yet configured,
    // use the page access token to discover the linked ad account.
    const integrations = await toolRegistry.getToolConfig(req.locationId);
    const fbPageToken  = integrations.social_facebook?.pageAccessToken || integrations.social_facebook?.accessToken;
    const adsConfig    = integrations.facebook_ads || {};
    if (fbPageToken && !adsConfig.adAccountId) {
      try {
        const adResp = await axios.get('https://graph.facebook.com/v20.0/me/adaccounts', {
          params: { access_token: fbPageToken, fields: 'id,name,account_status,currency', limit: 10 },
        });
        const activeAds = (adResp.data?.data || []).filter(a => a.account_status === 1);
        if (activeAds.length > 0) {
          const best = activeAds[0];
          await toolRegistry.saveToolConfig(req.locationId, 'facebook_ads', {
            ...adsConfig,
            accessToken:   fbPageToken,
            adAccountId:   best.id.replace('act_', ''),
            adAccountName: best.name || '',
            ghlConnected:  true,
            connectedAt:   new Date().toISOString(),
          });
          console.log(`[Social] Auto-configured facebook_ads → ad account ${best.id} for location ${req.locationId}`);
        }
      } catch (e) {
        console.warn('[Social] Could not auto-detect Facebook ad account during sync:', e.message);
      }
    }

    const platforms = [...new Set(accounts.map(a => normalizePlatformType(a.type || a.platform || a.accountType || '')))];
    res.json({
      success:  true,
      synced:   accounts.length,
      platforms,
      detected: {
        facebookUrl:  locationSocial.facebookUrl  || null,
        instagramUrl: locationSocial.instagramUrl  || null,
        linkedInUrl:  locationSocial.linkedIn      || null,
        twitterUrl:   locationSocial.twitter       || null,
        youtubeUrl:   locationSocial.youtube       || null,
        pinterestUrl: locationSocial.pinterest     || null,
      },
    });
  } catch (err) {
    console.error('[Social] sync error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /social/posts?status=SCHEDULED|PUBLISHED|DRAFT&page=1&limit=20
router.get('/posts', async (req, res) => {
  if (!req.ghl) return res.status(503).json({ error: 'GHL OAuth not connected.', code: 'GHL_OAUTH_REQUIRED' });
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const params = { page, limit };
    if (status) params.status = status;
    const data = await req.ghl('GET', `/social-media-posting/${req.locationId}/posts`, null, params);
    res.json(data);
  } catch (err) {
    console.error('[Social] posts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /social/posts — create / schedule a social post
router.post('/posts', async (req, res) => {
  if (!req.ghl) return res.status(503).json({ error: 'GHL OAuth not connected.', code: 'GHL_OAUTH_REQUIRED' });
  try {
    const { summary, status = 'NOW', scheduledDate, accountIds } = req.body;
    if (!summary)                         return res.status(400).json({ error: 'summary is required.' });
    if (!accountIds || !accountIds.length) return res.status(400).json({ error: 'At least one accountId is required.' });

    const payload = { summary, status, accountIds };
    if (scheduledDate) payload.scheduledDate = scheduledDate;

    const data = await req.ghl('POST', `/social-media-posting/${req.locationId}/posts`, payload);
    res.json(data);
  } catch (err) {
    console.error('[Social] create post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /social/posts/:postId
router.delete('/posts/:postId', async (req, res) => {
  if (!req.ghl) return res.status(503).json({ error: 'GHL OAuth not connected.', code: 'GHL_OAUTH_REQUIRED' });
  try {
    const data = await req.ghl('DELETE', `/social-media-posting/${req.locationId}/posts/${req.params.postId}`);
    res.json(data);
  } catch (err) {
    console.error('[Social] delete post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /social/connect/:platform — get GHL OAuth start URL for a social platform
router.get('/connect/:platform', async (req, res) => {
  if (!req.ghl) return res.status(503).json({ error: 'GHL OAuth not connected.', code: 'GHL_OAUTH_REQUIRED' });
  try {
    const { platform } = req.params;
    const { reconnect = 'false' } = req.query;

    // Resolve userId
    let userId = req.userId;
    if (!userId) {
      try {
        const users = await req.ghl('GET', '/users/search', null, { locationId: req.locationId });
        const list = users?.users || users?.data || users || [];
        userId = Array.isArray(list) && list[0]?.id;
      } catch (e) {
        console.warn('[Social] Could not fetch userId from Users API:', e.message);
      }
    }

    const params = { locationId: req.locationId, reconnect };
    if (userId) params.userId = userId;

    const accessToken = await ghlClient.getValidAccessToken(req.locationId);
    const apiUrl = `${config.ghl.apiBaseUrl}/social-media-posting/oauth/${platform}/start`;

    let url = null;
    try {
      const resp = await axios.get(apiUrl, {
        headers: { Authorization: `Bearer ${accessToken}`, Version: config.ghl.apiVersion },
        params,
        maxRedirects: 0,
        validateStatus: s => s < 400,
      });
      url = resp.data?.url || resp.data?.authUrl ||
            (typeof resp.data === 'string' && resp.data.startsWith('http') ? resp.data : null) ||
            resp.headers?.location;
    } catch (redirectErr) {
      url = redirectErr.response?.headers?.location;
      if (!url) throw redirectErr;
    }

    console.log('[Social] connect OAuth URL:', url?.substring(0, 80));
    if (!url) return res.status(502).json({ error: 'GHL did not return an OAuth URL.' });
    res.json({ url });
  } catch (err) {
    console.error('[Social] connect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /social/accounts/:accountId — disconnect a social account
router.delete('/accounts/:accountId', async (req, res) => {
  if (!req.ghl) return res.status(503).json({ error: 'GHL OAuth not connected.', code: 'GHL_OAUTH_REQUIRED' });
  try {
    const data = await req.ghl(
      'DELETE',
      `/social-media-posting/${req.locationId}/accounts/${req.params.accountId}`
    );
    res.json(data);
  } catch (err) {
    console.error('[Social] disconnect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
