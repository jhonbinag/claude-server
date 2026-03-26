/**
 * routes/api.js — Protected API Router Index
 *
 * Every request MUST pass the authenticate middleware (x-api-key → locationId).
 * req.locationId, req.companyId, and req.ghl() are injected by authenticate.js.
 *
 * All GHL v2 API resource groups are mounted here.
 * Base path: /api/v1
 */

const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');

// ─── Original sub-routers ─────────────────────────────────────────────────────
const businesses    = require('./api/businesses');
const calendars     = require('./api/calendars');
const campaigns     = require('./api/campaigns');
const contacts      = require('./api/contacts');
const conversations = require('./api/conversations');
const customObjects = require('./api/customObjects');
const emails        = require('./api/emails');
const forms         = require('./api/forms');
const funnels       = require('./api/funnels');
const invoices      = require('./api/invoices');
const links         = require('./api/links');
const locations     = require('./api/locations');
const media         = require('./api/media');
const opportunities = require('./api/opportunities');
const payments      = require('./api/payments');
const products      = require('./api/products');
const saas          = require('./api/saas');
const snapshots     = require('./api/snapshots');
const socialPlanner = require('./api/socialPlanner');
const surveys       = require('./api/surveys');
const users         = require('./api/users');
const workflows     = require('./api/workflows');
const blogs         = require('./api/blogs');
const courses       = require('./api/courses');

// ─── New sub-routers ──────────────────────────────────────────────────────────
const store          = require('./api/store');
const phoneSystem    = require('./api/phoneSystem');
const knowledgeBase  = require('./api/knowledgeBase');
const conversationAI = require('./api/conversationAI');
const companies      = require('./api/companies');
const associations   = require('./api/associations');
const lcEmail        = require('./api/lcEmail');
const customMenus    = require('./api/customMenus');

// ─── Public: Activate a location with any AI provider API key ────────────────
// No auth required — this IS the first-time setup step.
// Key prefix auto-detects the provider:
//   sk-ant- → anthropic, sk- → openai, gsk_ → groq, AIza → google

function detectAiProvider(key) {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('gsk_'))    return 'groq';
  if (key.startsWith('AIza'))    return 'google';
  if (key.startsWith('sk-'))     return 'openai';
  return null;
}

router.post('/activate', async (req, res) => {
  const { locationId, apiKey: rawKey, anthropicKey } = req.body;
  const key = (rawKey || anthropicKey || '').trim();
  if (!locationId || !key) {
    return res.status(400).json({ success: false, error: 'locationId and apiKey are required.' });
  }
  const provider = detectAiProvider(key);
  if (!provider) {
    return res.status(400).json({ success: false, error: 'Unrecognized key prefix. Use sk-ant- (Anthropic), sk- (OpenAI), gsk_ (Groq), or AIza (Google Gemini).' });
  }
  try {
    const registry = require('../tools/toolRegistry');
    await registry.saveToolConfig(locationId, provider, { apiKey: key });
    console.log(`[Activate] Location ${locationId} activated with provider: ${provider}`);
    res.json({ success: true, locationId, provider });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Apply authentication to ALL routes below this point
router.use(authenticate);

// ─── Health / Auth Check ──────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    success:    true,
    locationId: req.locationId,
    companyId:  req.companyId,
    message:    'Authenticated and ready.',
  });
});

// ─── Mount All Resource Routers ───────────────────────────────────────────────

// Core CRM
router.use('/businesses',      businesses);
router.use('/contacts',        contacts);
router.use('/opportunities',   opportunities);
router.use('/users',           users);

// Communication
router.use('/conversations',   conversations);
router.use('/lc-email',        lcEmail);

// Scheduling
router.use('/calendars',       calendars);

// Marketing
router.use('/campaigns',       campaigns);
router.use('/social-planner',  socialPlanner);
router.use('/blogs',           blogs);
router.use('/emails',          emails);
router.use('/forms',           forms);
router.use('/surveys',         surveys);
router.use('/funnels',         funnels);
router.use('/links',           links);

// Commerce
router.use('/payments',        payments);
router.use('/invoices',        invoices);
router.use('/products',        products);
router.use('/store',           store);

// Content & AI
router.use('/knowledge-base',  knowledgeBase);
router.use('/conversation-ai', conversationAI);
router.use('/courses',         courses);

// Data
router.use('/objects',         customObjects);
router.use('/associations',    associations);

// Infrastructure
router.use('/locations',       locations);
router.use('/companies',       companies);
router.use('/saas',            saas);
router.use('/snapshots',       snapshots);
router.use('/workflows',       workflows);
router.use('/medias',          media);

// Phone
router.use('/phone',           phoneSystem);

// App UI
router.use('/custom-menus',    customMenus);

module.exports = router;
