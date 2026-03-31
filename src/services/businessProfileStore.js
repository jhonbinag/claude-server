/**
 * src/services/businessProfileStore.js
 *
 * Stores the business branding profile in Firestore (appSettings/businessProfile).
 * Used to customise the app name, logo, and tagline shown across all interfaces:
 *   – Super Admin panel sidebar
 *   – Admin Dashboard login + topbar
 *   – User-facing app header
 *
 * Fields:
 *   name       — display name, e.g. "Acme Agency"  (default: "HL Pro Tools")
 *   tagline    — sub-line shown under name, e.g. "Powered by AI"  (default: "")
 *   logoUrl    — optional image URL for the logo
 *   logoEmoji  — emoji fallback shown when no logoUrl (default: "🧩")
 */

const config = require('../config');

const DOC = { col: 'appSettings', doc: 'businessProfile' };

let _db = null;
function db() {
  if (_db) return _db;
  if (!config.isFirebaseEnabled) return null;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length) _db = admin.app().firestore();
  } catch { /* ignore */ }
  return _db;
}

let _mem = null;

const DEFAULT = {
  name:       'HL Pro Tools',
  tagline:    '',
  logoUrl:    '',
  logoEmoji:  '🧩',
};

async function getProfile() {
  const d = db();
  if (d) {
    const snap = await d.collection(DOC.col).doc(DOC.doc).get();
    if (!snap.exists) return { ...DEFAULT };
    return { ...DEFAULT, ...snap.data() };
  }
  return _mem ? { ...DEFAULT, ..._mem } : { ...DEFAULT };
}

async function saveProfile(updates) {
  const current = await getProfile();
  const next = { ...current };

  if (updates.name      !== undefined) next.name      = String(updates.name      || '').trim() || DEFAULT.name;
  if (updates.tagline   !== undefined) next.tagline   = String(updates.tagline   || '').trim();
  if (updates.logoUrl   !== undefined) next.logoUrl   = String(updates.logoUrl   || '').trim();
  if (updates.logoEmoji !== undefined) next.logoEmoji = String(updates.logoEmoji || '').trim() || DEFAULT.logoEmoji;

  const d = db();
  if (d) {
    await d.collection(DOC.col).doc(DOC.doc).set(next, { merge: true });
  } else {
    _mem = next;
  }
  return next;
}

module.exports = { getProfile, saveProfile, DEFAULT };
