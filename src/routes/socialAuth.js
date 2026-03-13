/**
 * socialAuth.js — OAuth flows for social platform connections
 *
 * GET  /social-auth/:platform          → redirect user to platform OAuth
 * GET  /social-auth/:platform/callback → exchange code, postMessage result to opener
 * POST /social-auth/:platform/save     → save selected page/account to tool configs
 *
 * Supported platforms: facebook, google, linkedin, tiktok, pinterest
 *
 * Required env vars (set per-platform):
 *   FACEBOOK_APP_ID, FACEBOOK_APP_SECRET
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
 *   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
 *   PINTEREST_APP_ID, PINTEREST_APP_SECRET
 */

const express    = require('express');
const router     = express.Router();
const axios      = require('axios');
const crypto     = require('crypto');

// ── Platform definitions ──────────────────────────────────────────────────────

const PLATFORMS = {
  facebook: {
    authUrl:   'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl:  'https://graph.facebook.com/v19.0/oauth/access_token',
    scope:     'pages_read_engagement,pages_manage_posts,pages_show_list,instagram_basic,instagram_content_publish,ads_read,read_insights',
    clientId:  () => process.env.FACEBOOK_APP_ID,
    secret:    () => process.env.FACEBOOK_APP_SECRET,
  },
  google: {
    authUrl:   'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl:  'https://oauth2.googleapis.com/token',
    scope:     'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/business.manage',
    clientId:  () => process.env.GOOGLE_CLIENT_ID,
    secret:    () => process.env.GOOGLE_CLIENT_SECRET,
    extra:     { access_type: 'offline', prompt: 'consent' },
  },
  linkedin: {
    authUrl:   'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl:  'https://www.linkedin.com/oauth/v2/accessToken',
    scope:     'r_organization_social w_organization_social r_basicprofile r_organization_admin',
    clientId:  () => process.env.LINKEDIN_CLIENT_ID,
    secret:    () => process.env.LINKEDIN_CLIENT_SECRET,
  },
  tiktok: {
    authUrl:   'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl:  'https://open.tiktokapis.com/v2/oauth/token/',
    scope:     'user.info.basic,video.list',
    clientId:  () => process.env.TIKTOK_CLIENT_KEY,
    secret:    () => process.env.TIKTOK_CLIENT_SECRET,
    clientKey: true,  // TikTok uses client_key instead of client_id
  },
  pinterest: {
    authUrl:   'https://www.pinterest.com/oauth/',
    tokenUrl:  'https://api.pinterest.com/v5/oauth/token',
    scope:     'boards:read,pins:read,pins:write,user_accounts:read',
    clientId:  () => process.env.PINTEREST_APP_ID,
    secret:    () => process.env.PINTEREST_APP_SECRET,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function callbackUrl(req, platform) {
  const host = `${req.protocol}://${req.get('host')}`;
  return `${host}/social-auth/${platform}/callback`;
}

function postMessageHtml(data) {
  return `<!DOCTYPE html><html><head><title>Connecting…</title></head>
<body style="background:#0f0f1a;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
<div style="text-align:center">
  <div style="font-size:32px;margin-bottom:12px">${data.error ? '❌' : '✅'}</div>
  <p style="font-size:14px;color:${data.error ? '#fca5a5' : '#34d399'}">${data.error ? data.error : 'Connected! This window will close.'}</p>
</div>
<script>
  try {
    if(window.opener) {
      window.opener.postMessage(${JSON.stringify({ type: 'social_oauth', ...data })}, '*');
    }
  } catch(e){}
  setTimeout(function(){ window.close(); }, ${data.error ? 3000 : 1200});
</script>
</body></html>`;
}

// ── GET /social-auth/:platform — initiate OAuth ───────────────────────────────

router.get('/:platform', (req, res) => {
  const { platform } = req.params;
  const { locationId } = req.query;
  const cfg = PLATFORMS[platform];

  if (!cfg) return res.status(404).send('Unknown platform');
  if (!locationId) return res.status(400).send('Missing locationId');

  const clientId = cfg.clientId();
  if (!clientId) {
    return res.status(503).send(
      `<html><body style="background:#0f0f1a;color:#fca5a5;font-family:sans-serif;padding:2rem;">
        <h3>⚠️ ${platform} App not configured</h3>
        <p>Set <code>${platform.toUpperCase()}_APP_ID</code> / <code>${platform.toUpperCase()}_CLIENT_ID</code> and secret in your environment variables.</p>
        <button onclick="window.close()">Close</button>
      </body></html>`
    );
  }

  const state  = `${locationId}::${crypto.randomBytes(8).toString('hex')}`;
  const params = new URLSearchParams({
    ...(cfg.clientKey ? { client_key: clientId } : { client_id: clientId }),
    redirect_uri:  callbackUrl(req, platform),
    scope:         cfg.scope,
    response_type: 'code',
    state,
    ...(cfg.extra || {}),
  });

  res.redirect(`${cfg.authUrl}?${params.toString()}`);
});

// ── GET /social-auth/:platform/callback — exchange code, fetch accounts ───────

router.get('/:platform/callback', async (req, res) => {
  const { platform } = req.params;
  const { code, state, error } = req.query;
  const cfg = PLATFORMS[platform];

  if (!cfg) return res.status(404).send('Unknown platform');
  if (error) return res.send(postMessageHtml({ platform, error: `Authorization denied: ${error}` }));
  if (!code || !state) return res.send(postMessageHtml({ platform, error: 'Missing code or state' }));

  const locationId = state.split('::')[0];

  try {
    const clientId     = cfg.clientId();
    const clientSecret = cfg.secret();
    const redirectUri  = callbackUrl(req, platform);

    // ── Exchange code for access token ────────────────────────────────────────
    let accessToken, refreshToken;

    if (platform === 'tiktok') {
      const r = await axios.post(cfg.tokenUrl, new URLSearchParams({
        client_key: clientId, client_secret: clientSecret,
        code, grant_type: 'authorization_code', redirect_uri: redirectUri,
      }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      accessToken  = r.data.data?.access_token;
      refreshToken = r.data.data?.refresh_token;
    } else if (platform === 'pinterest') {
      const r = await axios.post(cfg.tokenUrl,
        new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: redirectUri }),
        { auth: { username: clientId, password: clientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      accessToken  = r.data.access_token;
      refreshToken = r.data.refresh_token;
    } else {
      const r = await axios.post(cfg.tokenUrl, new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        code, grant_type: 'authorization_code', redirect_uri: redirectUri,
      }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      accessToken  = r.data.access_token;
      refreshToken = r.data.refresh_token;
    }

    if (!accessToken) throw new Error('No access token received');

    // ── Fetch accounts/pages for selection ────────────────────────────────────
    let accounts = [];
    let autoSave = null; // if only one account, auto-save directly

    if (platform === 'facebook') {
      // Exchange for long-lived token
      try {
        const llr = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
          params: { grant_type: 'fb_exchange_token', client_id: clientId, client_secret: clientSecret, fb_exchange_token: accessToken },
        });
        if (llr.data.access_token) accessToken = llr.data.access_token;
      } catch { /* use short-lived token */ }

      // List pages
      const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
        params: { access_token: accessToken, fields: 'id,name,access_token,fan_count,picture{url}' },
      });
      accounts = (pagesRes.data.data || []).map(p => ({
        id:          p.id,
        name:        p.name,
        token:       p.access_token,
        followers:   p.fan_count,
        picture:     p.picture?.data?.url,
        platform:    'facebook',
        locationId,
      }));

    } else if (platform === 'google') {
      // YouTube channels
      const chRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'snippet,statistics', mine: true, access_token: accessToken },
      });
      accounts = (chRes.data.items || []).map(ch => ({
        id:         ch.id,
        name:       ch.snippet?.title,
        picture:    ch.snippet?.thumbnails?.default?.url,
        followers:  ch.statistics?.subscriberCount,
        token:      accessToken,
        refresh:    refreshToken,
        platform:   'google',
        locationId,
      }));

    } else if (platform === 'linkedin') {
      // Get user profile first
      const meRes = await axios.get('https://api.linkedin.com/v2/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      // Get organizations
      try {
        const orgRes = await axios.get('https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const orgs = orgRes.data.elements || [];
        for (const org of orgs.slice(0, 10)) {
          const urnId = org.organizationalTarget?.split(':').pop();
          if (!urnId) continue;
          try {
            const orgInfo = await axios.get(`https://api.linkedin.com/v2/organizations/${urnId}`, {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            accounts.push({
              id:       urnId,
              name:     orgInfo.data.localizedName || orgInfo.data.name?.localized?.en_US,
              token:    accessToken,
              refresh:  refreshToken,
              platform: 'linkedin',
              locationId,
            });
          } catch { /* skip */ }
        }
        // If no org pages, use personal profile
        if (!accounts.length) {
          accounts.push({
            id:       meRes.data.id,
            name:     `${meRes.data.localizedFirstName} ${meRes.data.localizedLastName}`,
            token:    accessToken,
            refresh:  refreshToken,
            platform: 'linkedin',
            isPersonal: true,
            locationId,
          });
        }
      } catch {
        accounts.push({
          id:       meRes.data.id,
          name:     `${meRes.data.localizedFirstName} ${meRes.data.localizedLastName}`,
          token:    accessToken,
          refresh:  refreshToken,
          platform: 'linkedin',
          locationId,
        });
      }

    } else if (platform === 'tiktok') {
      const infoRes = await axios.get('https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url,follower_count', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const user = infoRes.data.data?.user || {};
      autoSave = {
        id:        user.open_id || 'me',
        name:      user.display_name,
        picture:   user.avatar_url,
        followers: user.follower_count,
        token:     accessToken,
        refresh:   refreshToken,
        platform:  'tiktok',
        locationId,
      };

    } else if (platform === 'pinterest') {
      const userRes = await axios.get('https://api.pinterest.com/v5/user_account', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const user = userRes.data;
      autoSave = {
        id:        user.username,
        name:      user.business_name || user.username,
        picture:   user.profile_image,
        followers: user.follower_count,
        token:     accessToken,
        refresh:   refreshToken,
        platform:  'pinterest',
        locationId,
      };
    }

    // ── Auto-save single account, or send list to frontend ────────────────────
    if (autoSave || accounts.length === 1) {
      const account = autoSave || accounts[0];
      await saveAccount(locationId, platform, account);
      return res.send(postMessageHtml({ platform, locationId, saved: true, account: { id: account.id, name: account.name, picture: account.picture, followers: account.followers } }));
    }

    if (accounts.length === 0) {
      return res.send(postMessageHtml({ platform, locationId, error: `No ${platform === 'facebook' ? 'Pages' : 'accounts'} found. Make sure you have admin access to at least one.` }));
    }

    // Multiple accounts — send list for user to choose
    return res.send(postMessageHtml({ platform, locationId, accounts }));

  } catch (err) {
    console.error(`[SocialAuth] ${platform} callback error:`, err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.response?.data?.error_description || err.message;
    return res.send(postMessageHtml({ platform, locationId, error: msg }));
  }
});

// ── POST /social-auth/:platform/save — save selected account ─────────────────

router.post('/:platform/save', async (req, res) => {
  const { platform } = req.params;
  const { locationId, account } = req.body;
  if (!locationId || !account) return res.status(400).json({ error: 'Missing locationId or account' });

  try {
    await saveAccount(locationId, platform, account);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Persist account to tool configs ──────────────────────────────────────────

async function saveAccount(locationId, platform, account) {
  const registry = require('../tools/toolRegistry');
  const keyMap   = {
    facebook:  'social_facebook',
    google:    'social_youtube',
    linkedin:  'social_linkedin_organic',
    tiktok:    'social_tiktok_organic',
    pinterest: 'social_pinterest',
  };
  const toolKey = keyMap[platform] || `social_${platform}`;

  const config = {
    pageAccessToken: account.token,
    accessToken:     account.token,
    refreshToken:    account.refresh || '',
    pageId:          account.id,
    pageName:        account.name,
    picture:         account.picture || '',
    followers:       account.followers || 0,
    connectedAt:     new Date().toISOString(),
  };

  // Platform-specific field names
  if (platform === 'google')   config.channelId   = account.id;
  if (platform === 'linkedin') config.organizationId = account.id;
  if (platform === 'tiktok')   config.openId      = account.id;

  await registry.saveToolConfig(locationId, toolKey, config);
  console.log(`[SocialAuth] Saved ${platform} account "${account.name}" for location ${locationId}`);

  // ── When Facebook connects: auto-save Instagram + auto-detect Ads account ───
  if (platform === 'facebook' && account.token) {
    // 1. Instagram Business account linked to this Facebook Page
    try {
      const igRes = await axios.get(`https://graph.facebook.com/v19.0/${account.id}`, {
        params: { access_token: account.token, fields: 'instagram_business_account{id,name,username,followers_count,profile_picture_url}' },
      });
      const ig = igRes.data?.instagram_business_account;
      if (ig?.id) {
        await registry.saveToolConfig(locationId, 'social_instagram', {
          pageAccessToken: account.token,
          accessToken:     account.token,
          igUserId:        ig.id,
          igUsername:      ig.username || ig.name,
          pageName:        ig.name || ig.username,
          picture:         ig.profile_picture_url || '',
          followers:       ig.followers_count || 0,
          connectedVia:    'facebook',
          connectedAt:     new Date().toISOString(),
        });
        console.log(`[SocialAuth] Auto-saved Instagram account @${ig.username} for location ${locationId}`);
      }
    } catch (e) {
      console.warn('[SocialAuth] Could not auto-detect Instagram account:', e.message);
    }

    // 2. Facebook Ad Account
    try {
      const adResp = await axios.get('https://graph.facebook.com/v20.0/me/adaccounts', {
        params: { access_token: account.token, fields: 'id,name,account_status,currency,business', limit: 10 },
      });
      const adAccounts = (adResp.data.data || []).filter(a => a.account_status === 1);
      if (adAccounts.length > 0) {
        const best = adAccounts[0];
        const adAccountId = best.id.replace('act_', '');
        const existing = (await registry.getToolConfig(locationId)).facebook_ads || {};
        if (!existing.adAccountId) {
          await registry.saveToolConfig(locationId, 'facebook_ads', {
            ...existing,
            accessToken:   account.token,
            adAccountId,
            adAccountName: best.name || '',
            ghlConnected:  true,
            connectedAt:   new Date().toISOString(),
          });
          console.log(`[SocialAuth] Auto-configured facebook_ads with ad account ${adAccountId} for location ${locationId}`);
        }
      }
    } catch (e) {
      console.warn('[SocialAuth] Could not auto-detect Facebook ad account:', e.message);
    }
  }

  // ── When Google connects: also save Google My Business if accessible ─────────
  if (platform === 'google' && account.token) {
    try {
      const gmbRes = await axios.get('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${account.token}` },
      });
      const gmbAccounts = gmbRes.data?.accounts || [];
      if (gmbAccounts.length > 0) {
        const best = gmbAccounts[0];
        await registry.saveToolConfig(locationId, 'google_my_business', {
          accessToken:  account.token,
          refreshToken: account.refresh || '',
          accountId:    best.name,      // e.g. accounts/12345
          accountName:  best.accountName,
          connectedAt:  new Date().toISOString(),
        });
        console.log(`[SocialAuth] Auto-saved Google My Business account "${best.accountName}" for location ${locationId}`);
      }
    } catch (e) {
      // GMB API requires Business Profile API enabled — silently skip if not available
      console.warn('[SocialAuth] Could not auto-detect Google My Business account:', e.message);
    }
  }
}

module.exports = router;
