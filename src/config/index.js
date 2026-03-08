require('dotenv').config();

const config = {
  // Server
  port:    process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // GHL OAuth App Credentials (from Marketplace App settings)
  ghl: {
    clientId:     process.env.GHL_CLIENT_ID,
    clientSecret: process.env.GHL_CLIENT_SECRET,
    redirectUri:  process.env.GHL_REDIRECT_URI,

    // GHL OAuth & API base URLs
    oauthBaseUrl:    'https://marketplace.gohighlevel.com',
    oauthBaseUrlWL:  'https://marketplace.leadconnectorhq.com', // white-label
    oauthTokenUrl:   'https://services.leadconnectorhq.com/oauth/token',
    apiBaseUrl:      'https://services.leadconnectorhq.com',
    apiVersion:      '2021-07-28',

    // RSA public key used to verify incoming GHL webhook signatures (x-wh-signature)
    // Get the current key from: GHL Marketplace App → Settings → Webhook Authentication
    // Store the full PEM string in .env (escape newlines as \n)
    webhookPublicKey: process.env.GHL_WEBHOOK_PUBLIC_KEY
      ? process.env.GHL_WEBHOOK_PUBLIC_KEY.replace(/\\n/g, '\n')
      : null,

    // Optional: same-tab login mode for the OAuth chooselocation page
    loginWindowOpenMode: process.env.GHL_LOGIN_WINDOW_MODE || 'popup', // 'self' | 'popup'
  },

  // App's own private API key header name (inbound requests to this app)
  apiKeyHeader: 'x-api-key',

  // Token store file path (swap for Postgres/Redis in production)
  storePath: process.env.STORE_PATH || './data/store.json',

  // Anthropic / Claude AI
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },

  // ── Firebase Admin SDK ────────────────────────────────────────────────────
  // Encrypted tool config storage in Firestore (per sub-account API keys).
  // Set all three env vars to enable; omit to fall back to tokenStore.
  firebase: {
    projectId:   process.env.FIREBASE_PROJECT_ID   || null,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || null,
    // Replace escaped newlines — common when pasting PEM keys into .env
    privateKey:  process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : null,
  },

  // ── Tool Config Encryption ────────────────────────────────────────────────
  // AES-256-GCM key used to encrypt API keys before writing to Firestore.
  // Must be exactly 64 hex characters (32 bytes). Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  toolEncryptionKey: process.env.TOOL_ENCRYPTION_KEY || null,

  // ── Admin Access ──────────────────────────────────────────────────────────
  // Separate API key for the /admin/* routes. Never share with sub-accounts.
  adminApiKey: process.env.ADMIN_API_KEY || null,
};

// ── Derived flags ──────────────────────────────────────────────────────────────

const encKeyValid = config.toolEncryptionKey && config.toolEncryptionKey.length === 64;

config.isFirebaseEnabled = !!(
  config.firebase.projectId   &&
  config.firebase.clientEmail &&
  config.firebase.privateKey  &&
  encKeyValid
);

// ── Startup validation ─────────────────────────────────────────────────────────

const required = ['GHL_CLIENT_ID', 'GHL_CLIENT_SECRET', 'GHL_REDIRECT_URI'];
const missing  = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[Config] Missing required environment variables: ${missing.join(', ')}`);
  // Do not call process.exit() — would crash Vercel serverless functions.
  // Routes that need these vars will fail with their own errors at runtime.
}

if (!config.ghl.webhookPublicKey) {
  console.warn('[Config] GHL_WEBHOOK_PUBLIC_KEY not set — incoming webhook signatures will not be verified.');
}

if (!config.adminApiKey) {
  console.warn('[Config] ADMIN_API_KEY not set — /admin routes will return 503 until configured.');
}

if (!config.isFirebaseEnabled) {
  const reasons = [];
  if (!config.firebase.projectId)   reasons.push('FIREBASE_PROJECT_ID');
  if (!config.firebase.clientEmail) reasons.push('FIREBASE_CLIENT_EMAIL');
  if (!config.firebase.privateKey)  reasons.push('FIREBASE_PRIVATE_KEY');
  if (!config.toolEncryptionKey)    reasons.push('TOOL_ENCRYPTION_KEY');
  else if (!encKeyValid)            reasons.push('TOOL_ENCRYPTION_KEY (must be 64 hex chars)');
  console.warn(`[Config] Firebase storage disabled — tool configs use tokenStore fallback. Missing: ${reasons.join(', ')}`);
} else {
  console.log(`[Config] Firebase storage enabled (project: ${config.firebase.projectId})`);
}

module.exports = config;
