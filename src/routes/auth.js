/**
 * routes/auth.js
 *
 * Full GHL Marketplace OAuth lifecycle + agency-level endpoints:
 *
 *  GET  /oauth/install              → Redirect to GHL authorization (standard)
 *  GET  /oauth/install/whitelabel   → Redirect to white-label authorization URL
 *  GET  /oauth/callback             → Exchange code for tokens, issue private API key
 *  POST /oauth/uninstall            → GHL webhook — app removed from a location
 *  GET  /oauth/installed-locations  → List all locations with the app installed (agency)
 *  POST /oauth/location-token       → Generate a location-scoped token (agency)
 *  GET  /oauth/rate-limits/:id      → Show current GHL rate limit status for location
 *  GET  /oauth/key/:locationId      → Retrieve private API key for a location
 *  POST /oauth/key/rotate/:id       → Rotate private API key
 *  POST /oauth/billing/confirm      → Confirm payment to GHL external billing webhook
 *  POST /oauth/billing/failed       → Report failed payment to GHL external billing webhook
 */

const express           = require('express');
const router            = express.Router();
const jwt               = require('jsonwebtoken');
const ghlClient         = require('../services/ghlClient');
const apiKeyService     = require('../services/apiKeyService');
const tokenStore        = require('../services/tokenStore');
const billingService    = require('../services/billingService');
const appSettings       = require('../services/appSettings');
const locationRegistry  = require('../services/locationRegistry');
const roleService       = require('../services/roleService');
const adminAuth         = require('../middleware/adminAuth');
const config            = require('../config');

// ─── All scopes requested during install ─────────────────────────────────────

const ALL_SCOPES = [
  // Businesses
  'businesses.readonly', 'businesses.write',
  // Calendars
  'calendars.readonly', 'calendars.write',
  'calendars/events.readonly',
  // Charges
  'charges.readonly', 'charges.write',
  // Contacts
  'contacts.readonly', 'contacts.write',
  // Conversation AI
  'conversation-ai.readonly', 'conversation-ai.write',
  // Conversations
  'conversations.readonly', 'conversations.write',
  // Courses
  'courses.readonly', 'courses.write',
  // Blogs
  'blogs/post.write', 'blogs/post-update.write', 'blogs/check-slug.readonly',
  'blogs/category.readonly', 'blogs/author.readonly',
  'blogs/posts.readonly', 'blogs/list.readonly',
  // Forms & Surveys
  'forms.readonly', 'forms.write', 'surveys.readonly',
  // Email Builder
  'emails/builder.readonly', 'emails/builder.write',
  // Websites
  'websites.readonly', 'websites.write',
  // Funnels + Websites (websites use the funnels API under the hood)
  'funnels/funnel.readonly', 'funnels/page.readonly', 'funnels/page.write',
  'funnels/pagecount.readonly',
  'funnels/redirect.readonly', 'funnels/redirect.write',
  // Knowledge Bases
  'knowledge-bases.readonly', 'knowledge-bases.write',
  // Locations
  'locations.readonly',
  'locations/customValues.readonly', 'locations/customValues.write',
  'locations/tags.readonly', 'locations/tags.write',
  // Media
  'medias.readonly', 'medias.write',
  // Opportunities
  'opportunities.readonly', 'opportunities.write',
  // OAuth
  'oauth.readonly', 'oauth.write',
  // Payments
  'payments/integration.readonly', 'payments/integration.write',
  'payments/orders.readonly', 'payments/orders.write',
  'payments/transactions.readonly', 'payments/subscriptions.readonly',
  'payments/coupons.readonly', 'payments/coupons.write',
  'payments/custom-provider.readonly', 'payments/custom-provider.write',
  // Products
  'products.readonly', 'products.write',
  'products/prices.readonly', 'products/prices.write',
  'products/collection.readonly', 'products/collection.write',
  // Social Planner
  'socialplanner/account.readonly', 'socialplanner/account.write',
  'socialplanner/post.readonly', 'socialplanner/post.write',
  'socialplanner/csv.readonly', 'socialplanner/csv.write',
  'socialplanner/category.readonly', 'socialplanner/category.write',
  'socialplanner/tag.readonly', 'socialplanner/tag.write',
  'socialplanner/statistics.readonly',
  'socialplanner/oauth.readonly', 'socialplanner/oauth.write',
  // Voice AI
  'voice-ai-dashboard.readonly',
  'voice-ai-agents.readonly', 'voice-ai-agents.write',
  'voice-ai-agent-goals.readonly', 'voice-ai-agent-goals.write',
  // Users & Workflows
  'users.readonly', 'users.write',
  'workflows.readonly',
].join(' ');

// ─── Install: Standard ────────────────────────────────────────────────────────

router.get('/install', async (req, res) => {
  const ghl = await appSettings.getGhlSettings();
  if (!ghl.clientId || !ghl.redirectUri) {
    return res.status(503).json({ success: false, error: 'GHL app credentials not configured. Set them in Admin → App Settings.' });
  }
  const authUrl = new URL(`${config.ghl.oauthBaseUrl}/oauth/chooselocation`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri',  ghl.redirectUri);
  authUrl.searchParams.set('client_id',     ghl.clientId);
  authUrl.searchParams.set('scope',         ALL_SCOPES);
  if (config.ghl.loginWindowOpenMode === 'self') {
    authUrl.searchParams.set('loginWindowOpenMode', 'self');
  }
  console.log('[Auth] Redirecting to GHL install (standard)');
  res.redirect(authUrl.toString());
});

// ─── Install: White-label ─────────────────────────────────────────────────────

router.get('/install/whitelabel', async (req, res) => {
  const ghl = await appSettings.getGhlSettings();
  if (!ghl.clientId || !ghl.redirectUri) {
    return res.status(503).json({ success: false, error: 'GHL app credentials not configured. Set them in Admin → App Settings.' });
  }
  const authUrl = new URL(`${config.ghl.oauthBaseUrlWL}/oauth/chooselocation`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri',  ghl.redirectUri);
  authUrl.searchParams.set('client_id',     ghl.clientId);
  authUrl.searchParams.set('scope',         ALL_SCOPES);
  if (config.ghl.loginWindowOpenMode === 'self') {
    authUrl.searchParams.set('loginWindowOpenMode', 'self');
  }
  console.log('[Auth] Redirecting to GHL install (white-label)');
  res.redirect(authUrl.toString());
});

// ─── Callback: Exchange Code for Tokens ──────────────────────────────────────

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error(`[Auth] GHL returned error: ${error}`);
    return res.status(400).json({ success: false, error });
  }
  if (!code) {
    return res.status(400).json({ success: false, error: 'Authorization code missing from callback.' });
  }

  try {
    const tokenData  = await ghlClient.exchangeCodeForTokens(code);
    const locationId = tokenData.locationId;

    let apiKey = await apiKeyService.getApiKey(locationId);
    if (!apiKey) apiKey = await apiKeyService.generateApiKey(locationId);

    // Register location in Redis so admin dashboard can see it
    locationRegistry.registerLocation(locationId, { companyId: tokenData.companyId }).catch(() => {});

    // Sync GHL users + assign default roles (fire-and-forget)
    const installingUserId = tokenData.userId || tokenData.user_id || null;
    roleService.syncUsers(
      locationId,
      (method, endpoint, data, params) => ghlClient.ghlRequest(locationId, method, endpoint, data, params),
      installingUserId,
    ).catch((e) => console.warn('[Auth] User sync failed:', e.message));

    console.log(`[Auth] Installation complete for location: ${locationId}`);

    // Redirect to the app UI so the user lands on the dashboard after install.
    // Only pass locationId and userId — never expose the private API key in the URL
    // (URL params appear in browser history, proxy logs, and server access logs).
    const uidParam = installingUserId ? `&userId=${installingUserId}` : '';
    const appUrl = `${req.protocol}://${req.get('host')}/ui/?locationId=${locationId}${uidParam}`;
    res.redirect(appUrl);
  } catch (err) {
    console.error('[Auth] Callback error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to complete OAuth flow.', detail: err.message });
  }
});

// ─── Uninstall Webhook ────────────────────────────────────────────────────────

router.post('/uninstall', (req, res) => {
  const { locationId } = req.body;
  if (!locationId) {
    return res.status(400).json({ success: false, error: 'locationId required.' });
  }
  tokenStore.removeLocation(locationId);
  locationRegistry.uninstallLocation(locationId).catch(() => {});
  console.log(`[Auth] App uninstalled for location: ${locationId}`);
  res.json({ success: true, message: `Location ${locationId} data removed.` });
});

// ─── Installed Locations (Agency) ─────────────────────────────────────────────

router.get('/installed-locations', async (req, res) => {
  const { companyId, agencyToken, limit, skip, isInstalled } = req.query;
  if (!companyId || !agencyToken) {
    return res.status(400).json({ success: false, error: 'companyId and agencyToken are required.' });
  }
  try {
    const data = await ghlClient.getInstalledLocations(agencyToken, companyId, { limit, skip, isInstalled });
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ─── Location Token (Agency → Sub-account) ────────────────────────────────────

router.post('/location-token', async (req, res) => {
  const { companyId, locationId, agencyToken } = req.body;
  if (!companyId || !locationId || !agencyToken) {
    return res.status(400).json({ success: false, error: 'companyId, locationId, and agencyToken are required.' });
  }
  try {
    const data = await ghlClient.getLocationToken(companyId, locationId, agencyToken);
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ─── Rate Limit Status ────────────────────────────────────────────────────────

router.get('/rate-limits/:locationId', (req, res) => {
  const status = ghlClient.getRateLimitStatus(req.params.locationId);
  if (!status) {
    return res.status(404).json({ success: false, error: 'No rate limit data yet for this location. Make an API call first.' });
  }
  res.json({ success: true, locationId: req.params.locationId, ...status });
});

// ─── Private API Key Management ───────────────────────────────────────────────
// Both routes require admin key — either the global ADMIN_API_KEY or the
// location's own hlpt_* key (which is scoped to that location only).

router.get('/key/:locationId', adminAuth, async (req, res) => {
  const { locationId } = req.params;
  // Scoped admin keys may only read their own location's key
  if (req.adminScoped && req.adminId !== locationId) {
    return res.status(403).json({ success: false, error: 'Not authorised for this location.' });
  }
  const apiKey = await apiKeyService.getApiKey(locationId);
  if (!apiKey) {
    return res.status(404).json({ success: false, error: 'No API key found for this location.' });
  }
  res.json({ success: true, locationId, apiKey });
});

router.post('/key/rotate/:locationId', async (req, res) => {
  try {
    const newKey = await apiKeyService.rotateApiKey(req.params.locationId);
    res.json({ success: true, locationId: req.params.locationId, apiKey: newKey, message: 'API key rotated. Update your integrations.' });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// ─── External Billing: Confirm Payment ───────────────────────────────────────

router.post('/billing/confirm', async (req, res) => {
  const { locationId, companyId, installType, paymentType, amount, subscriptionId, paymentId } = req.body;
  if (!installType || !paymentType || amount === undefined) {
    return res.status(400).json({ success: false, error: 'installType, paymentType, and amount are required.' });
  }
  try {
    const data = await billingService.confirmPayment({ locationId, companyId, installType, paymentType, amount, subscriptionId, paymentId });
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ─── External Billing: Report Failed Payment ──────────────────────────────────

router.post('/billing/failed', async (req, res) => {
  const { locationId, companyId, installType, reason } = req.body;
  if (!installType) {
    return res.status(400).json({ success: false, error: 'installType is required.' });
  }
  try {
    const data = await billingService.reportPaymentFailed({ locationId, companyId, installType, reason });
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ─── GHL SSO Key Verification ─────────────────────────────────────────────────
// GHL passes ?ssoKey=xxx when loading a Marketplace app iframe.
// Verify the JWT (signed with GHL_CLIENT_SECRET) and return the locationId.

router.get('/sso', (req, res) => {
  const { ssoKey } = req.query;
  if (!ssoKey) return res.json({ success: false, error: 'No ssoKey provided' });
  if (!config.ghl.clientSecret) return res.json({ success: false, error: 'GHL_CLIENT_SECRET not configured' });

  try {
    const payload = jwt.verify(ssoKey, config.ghl.clientSecret);
    const locationId = payload.activeLocation || payload.locationId || payload.location_id;
    if (!locationId) return res.json({ success: false, error: 'No locationId in SSO token' });
    res.json({ success: true, locationId, userId: payload.userId || payload.user_id || null });
  } catch (err) {
    res.json({ success: false, error: `SSO verification failed: ${err.message}` });
  }
});

module.exports = router;
