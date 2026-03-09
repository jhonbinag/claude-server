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

const express        = require('express');
const router         = express.Router();
const ghlClient      = require('../services/ghlClient');
const apiKeyService  = require('../services/apiKeyService');
const tokenStore     = require('../services/tokenStore');
const billingService = require('../services/billingService');
const appSettings    = require('../services/appSettings');
const config         = require('../config');

// ─── All scopes requested during install ─────────────────────────────────────

const ALL_SCOPES = [
  // Businesses
  'businesses.readonly', 'businesses.write',
  // Calendars
  'calendars.readonly', 'calendars.write',
  'calendars/groups.readonly', 'calendars/groups.write',
  'calendars/resources.readonly', 'calendars/resources.write',
  'calendars/events.readonly', 'calendars/events.write',
  // Campaigns
  'campaigns.readonly',
  // Companies (Agency — requires $497 plan)
  'companies.readonly',
  // Contacts
  'contacts.readonly', 'contacts.write',
  // Custom Objects
  'objects/schema.readonly', 'objects/schema.write',
  'objects/record.readonly', 'objects/record.write',
  // Associations
  'associations.readonly', 'associations.write',
  'associations/relation.readonly', 'associations/relation.write',
  // Conversations
  'conversations.readonly', 'conversations.write',
  'conversations/message.readonly', 'conversations/message.write',
  'conversations/livechat.write',
  // Courses
  'courses.write',
  // Custom Menu Links
  'custom-menu-link.readonly', 'custom-menu-link.write',
  // Emails
  'emails/builder.readonly', 'emails/builder.write', 'emails/schedule.readonly',
  // Blogs
  'blogs/post.write', 'blogs/post-update.write', 'blogs/check-slug.readonly',
  'blogs/category.readonly', 'blogs/author.readonly',
  'blogs/posts.readonly', 'blogs/list.readonly',
  // Forms & Surveys
  'forms.readonly', 'surveys.readonly',
  // Funnels
  'funnels/funnel.readonly', 'funnels/page.readonly',
  'funnels/pagecount.readonly',
  'funnels/redirect.readonly', 'funnels/redirect.write',
  // Invoices
  'invoices.readonly', 'invoices.write',
  'invoices/schedule.readonly', 'invoices/schedule.write',
  'invoices/template.readonly', 'invoices/template.write',
  // LC Email
  'lc-email.readonly',
  // Links
  'links.readonly', 'links.write',
  // Locations / Sub-Accounts
  'locations.readonly', 'locations.write',
  'locations/customValues.readonly', 'locations/customValues.write',
  'locations/customFields.readonly', 'locations/customFields.write',
  'locations/tags.readonly', 'locations/tags.write',
  'locations/templates.readonly', 'locations/tasks.readonly',
  // Media
  'medias.readonly', 'medias.write',
  // Opportunities
  'opportunities.readonly', 'opportunities.write',
  // OAuth (Agency)
  'oauth.readonly', 'oauth.write',
  // Payments
  'payments/integration.readonly', 'payments/integration.write',
  'payments/orders.readonly', 'payments/orders.write',
  'payments/transactions.readonly', 'payments/subscriptions.readonly',
  // Products
  'products.readonly', 'products.write',
  'products/prices.readonly', 'products/prices.write',
  // SaaS (Agency — requires $497 plan)
  'saas/location.read', 'saas/location.write', 'saas/company.write',
  // Snapshots (Agency)
  'snapshots.readonly',
  // Store
  'store/shipping.readonly', 'store/shipping.write',
  'store/setting.readonly', 'store/setting.write',
  // Social Planner
  'socialplanner/account.readonly', 'socialplanner/account.write',
  'socialplanner/post.readonly', 'socialplanner/post.write',
  'socialplanner/csv.readonly', 'socialplanner/csv.write',
  'socialplanner/category.readonly',
  'socialplanner/oauth.readonly', 'socialplanner/oauth.write',
  'socialplanner/tag.readonly',
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

    console.log(`[Auth] Installation complete for location: ${locationId}`);

    // Redirect to the app UI so the user lands on the dashboard after install.
    // Pass the apiKey and locationId as query params so the SPA can store them.
    const appUrl = `${req.protocol}://${req.get('host')}/ui/?locationId=${locationId}&apiKey=${apiKey}`;
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
// Protect these routes with an admin secret or IP allowlist in production.

router.get('/key/:locationId', (req, res) => {
  const apiKey = apiKeyService.getApiKey(req.params.locationId);
  if (!apiKey) {
    return res.status(404).json({ success: false, error: 'No API key found for this location.' });
  }
  res.json({ success: true, locationId: req.params.locationId, apiKey });
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

module.exports = router;
