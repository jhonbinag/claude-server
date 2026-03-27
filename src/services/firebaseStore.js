/**
 * src/services/firebaseStore.js
 *
 * Encrypted tool-config storage backed by Google Cloud Firestore.
 *
 * WHY FIREBASE:
 *   User-supplied API keys (Perplexity, OpenAI, FB Ads, SendGrid, Slack,
 *   Apollo, HeyGen) are sensitive credentials that must never live in a
 *   .env file or an in-memory/file store. Firebase Firestore provides:
 *     • Managed, encrypted-at-rest NoSQL database
 *     • Fine-grained security rules (admin SDK bypasses them; direct client
 *       access is denied by rule)
 *     • Per-document audit trails
 *
 * ENCRYPTION LAYER (defence in depth):
 *   Before any value reaches Firestore it is encrypted with AES-256-GCM
 *   using TOOL_ENCRYPTION_KEY. Even if the Firestore data were exported the
 *   plaintext credentials would not be recoverable without that key.
 *
 * FIRESTORE SCHEMA:
 *   Collection: toolConfigs
 *   Document:   {locationId}
 *   Fields:     updatedAt (server timestamp)
 *               configs   (map)
 *                 {category} → AES-256-GCM ciphertext string
 *
 * ACTIVATION:
 *   Requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY,
 *   and TOOL_ENCRYPTION_KEY (64-hex-char) in .env.
 *   config.isFirebaseEnabled must be true (set by config/index.js).
 *   Falls back gracefully when not configured (used only as a no-op).
 */

const crypto = require('crypto');
const config = require('../config');

// ── Firebase Admin SDK (lazy-loaded only when configured) ─────────────────────

let admin = null;
let _db   = null;

if (config.isFirebaseEnabled) {
  try {
    admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId:   config.firebase.projectId,
          clientEmail: config.firebase.clientEmail,
          privateKey:  config.firebase.privateKey,
        }),
      });
    }
    _db = admin.firestore();
    console.log(`[FirebaseStore] Connected to project: ${config.firebase.projectId}`);
  } catch (err) {
    console.error('[FirebaseStore] Failed to initialize Firebase Admin SDK:', err.message);
    console.error('[FirebaseStore] Ensure firebase-admin is installed: npm install firebase-admin');
    _db = null;
  }
}

function db() { return _db; }

// ── AES-256-GCM Encryption ─────────────────────────────────────────────────────

const ALGO       = 'aes-256-gcm';
const CRYPTO_KEY = config.toolEncryptionKey
  ? Buffer.from(config.toolEncryptionKey, 'hex')
  : null;

/**
 * Encrypt a plaintext string.
 * Output format: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
function encrypt(plaintext) {
  if (!CRYPTO_KEY) throw new Error('[FirebaseStore] TOOL_ENCRYPTION_KEY not configured');
  const iv      = crypto.randomBytes(16);
  const cipher  = crypto.createCipheriv(ALGO, CRYPTO_KEY, iv);
  const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt a ciphertext produced by encrypt().
 */
function decrypt(payload) {
  if (!CRYPTO_KEY) throw new Error('[FirebaseStore] TOOL_ENCRYPTION_KEY not configured');
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const [ivHex, tagHex, ctHex] = parts;
  const decipher = crypto.createDecipheriv(ALGO, CRYPTO_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

// ── Firestore Operations ───────────────────────────────────────────────────────

const COLLECTION = 'toolConfigs';

/**
 * Save (or update) the config for one integration category in Firestore.
 * Values are encrypted before writing.
 *
 * @param {string} locationId   GHL sub-account location ID
 * @param {string} category     Integration key, e.g. 'perplexity'
 * @param {object} configObj    Plain object of API credentials
 */
async function saveToolConfig(locationId, category, configObj) {
  const d = db();
  if (!d) return; // no-op when Firebase is disabled

  const encrypted = encrypt(JSON.stringify(configObj));

  // merge: true preserves other categories in the same document
  await d.collection(COLLECTION).doc(locationId).set(
    {
      [`configs.${category}`]: encrypted,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  console.log(`[FirebaseStore] Saved ${category} config for location ${locationId}`);
}

/**
 * Load and decrypt ALL integration configs for a location.
 * Returns {} if the document doesn't exist or Firebase is disabled.
 *
 * @param {string} locationId
 * @returns {Promise<object>}  Map of category → decrypted config object
 */
async function getToolConfig(locationId) {
  const d = db();
  if (!d) return {};

  const snap = await d.collection(COLLECTION).doc(locationId).get();
  if (!snap.exists) return {};

  const data = snap.data();

  // The Admin SDK's set({ 'configs.category': value }, { merge: true }) stores fields
  // with literal dots in the name (e.g. key = 'configs.manychat'), NOT as a nested map.
  // Parse all top-level keys that start with 'configs.' to reconstruct the category map.
  const configEntries = {};
  for (const [key, val] of Object.entries(data)) {
    if (key.startsWith('configs.') && typeof val === 'string') {
      configEntries[key.slice(8)] = val; // 8 = 'configs.'.length
    }
  }

  const result = {};
  for (const [category, ciphertext] of Object.entries(configEntries)) {
    try {
      result[category] = JSON.parse(decrypt(ciphertext));
    } catch (err) {
      console.error(`[FirebaseStore] Decrypt failed for ${locationId}/${category}:`, err.message);
    }
  }

  return result;
}

async function saveToolSharing(locationId, sharing) {
  const d = db();
  if (!d) return;

  const payload = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  for (const [category, isShared] of Object.entries(sharing || {})) {
    payload[`sharing.${category}`] = !!isShared;
  }

  await d.collection(COLLECTION).doc(locationId).set(payload, { merge: true });
  console.log(`[FirebaseStore] Saved tool sharing for location ${locationId}`);
}

async function getToolSharing(locationId) {
  const d = db();
  if (!d) return {};

  const snap = await d.collection(COLLECTION).doc(locationId).get();
  if (!snap.exists) return {};

  const data = snap.data();
  const result = {};

  for (const [key, val] of Object.entries(data || {})) {
    if (key.startsWith('sharing.')) {
      result[key.slice(8)] = !!val;
    }
  }

  return result;
}

/**
 * Delete one integration category from Firestore.
 *
 * @param {string} locationId
 * @param {string} category
 */
async function deleteToolConfig(locationId, category) {
  const d = db();
  if (!d) return;

  // The field is stored as a literal key 'configs.category' (dot in name, not nested).
  // Use FieldPath with a single-string constructor so the dot is treated as part of
  // the field name rather than a path separator.
  const fieldPath = new admin.firestore.FieldPath(`configs.${category}`);
  await d.collection(COLLECTION).doc(locationId).update(
    fieldPath, admin.firestore.FieldValue.delete(),
    'updatedAt', admin.firestore.FieldValue.serverTimestamp(),
  );

  console.log(`[FirebaseStore] Deleted ${category} config for location ${locationId}`);
}

/**
 * Remove all integration data for a location (called on app uninstall).
 *
 * @param {string} locationId
 */
async function removeLocation(locationId) {
  const d = db();
  if (!d) return;

  await d.collection(COLLECTION).doc(locationId).delete();
  console.log(`[FirebaseStore] Removed all tool configs for location ${locationId}`);
}

module.exports = {
  saveToolConfig,
  getToolConfig,
  saveToolSharing,
  getToolSharing,
  deleteToolConfig,
  removeLocation,
  isEnabled: () => !!db(),
};
