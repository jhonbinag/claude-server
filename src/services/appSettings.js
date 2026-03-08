/**
 * src/services/appSettings.js
 *
 * Stores app-level settings (GHL Client ID, Client Secret, Redirect URI)
 * in Firestore under the `appSettings` collection, doc `ghl`.
 *
 * Falls back to tokenStore JSON file when Firebase is not enabled.
 *
 * These settings are configured once via the Admin UI and used by all
 * OAuth flows (install, callback, token refresh). This avoids hard-coding
 * GHL credentials as required env vars.
 */

const config      = require('../config');
const tokenStore  = require('./tokenStore');

// ── Firestore helpers ─────────────────────────────────────────────────────────

let _db    = null;
let _admin = null;

function db() {
  if (_db) return _db;
  if (!config.isFirebaseEnabled) return null;
  try {
    _admin = require('firebase-admin');
    _db    = _admin.firestore();
  } catch { _db = null; }
  return _db;
}

const COLLECTION = 'appSettings';
const DOC        = 'ghl';

// ── Fallback: tokenStore file ─────────────────────────────────────────────────

function getFromStore() {
  try {
    const raw = tokenStore.getAppSettings ? tokenStore.getAppSettings() : null;
    return raw || {};
  } catch { return {}; }
}

function saveToStore(settings) {
  try {
    if (tokenStore.saveAppSettings) tokenStore.saveAppSettings(settings);
  } catch { /* non-fatal */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get GHL app credentials.
 * Priority: Firestore → tokenStore fallback → env vars fallback
 *
 * @returns {Promise<{ clientId, clientSecret, redirectUri }>}
 */
async function getGhlSettings() {
  const d = db();

  if (d) {
    try {
      const snap = await d.collection(COLLECTION).doc(DOC).get();
      if (snap.exists) {
        const data = snap.data();
        return {
          clientId:     data.clientId     || config.ghl.clientId     || null,
          clientSecret: data.clientSecret || config.ghl.clientSecret || null,
          redirectUri:  data.redirectUri  || config.ghl.redirectUri  || null,
        };
      }
    } catch (err) {
      console.error('[AppSettings] Firestore read error:', err.message);
    }
  }

  // Fallback: tokenStore
  const stored = getFromStore();
  if (stored.clientId) return stored;

  // Last resort: env vars
  return {
    clientId:     config.ghl.clientId     || null,
    clientSecret: config.ghl.clientSecret || null,
    redirectUri:  config.ghl.redirectUri  || null,
  };
}

/**
 * Save GHL app credentials.
 *
 * @param {{ clientId, clientSecret, redirectUri }} settings
 */
async function saveGhlSettings({ clientId, clientSecret, redirectUri }) {
  const payload = {
    clientId:    clientId    || null,
    clientSecret: clientSecret || null,
    redirectUri: redirectUri || null,
    updatedAt:   new Date().toISOString(),
  };

  const d = db();
  if (d) {
    try {
      await d.collection(COLLECTION).doc(DOC).set(payload, { merge: true });
      console.log('[AppSettings] GHL credentials saved to Firestore');
      return;
    } catch (err) {
      console.error('[AppSettings] Firestore write error:', err.message);
    }
  }

  // Fallback: tokenStore
  saveToStore(payload);
  console.log('[AppSettings] GHL credentials saved to tokenStore fallback');
}

/**
 * Returns masked version of GHL settings for safe display in UI.
 */
async function getGhlSettingsMasked() {
  const s = await getGhlSettings();
  function mask(v) {
    if (!v || v.length <= 8) return v || '';
    return v.slice(0, 4) + '•'.repeat(8) + v.slice(-4);
  }
  return {
    clientId:     s.clientId     ? mask(s.clientId)     : '',
    clientSecret: s.clientSecret ? mask(s.clientSecret) : '',
    redirectUri:  s.redirectUri  || '',
    configured:   !!(s.clientId && s.clientSecret && s.redirectUri),
  };
}

module.exports = { getGhlSettings, saveGhlSettings, getGhlSettingsMasked };
