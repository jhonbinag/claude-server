/**
 * src/services/smtpConfigStore.js
 *
 * Stores SMTP email configuration in Firestore (appSettings/smtpConfig).
 * Falls back to in-memory when Firebase is not configured.
 *
 * Fields:
 *   host     — SMTP host (e.g. smtp.gmail.com)
 *   port     — SMTP port (587, 465, 25)
 *   secure   — boolean (true = TLS/SSL on port 465)
 *   user     — SMTP auth username / email
 *   pass     — SMTP auth password (stored as-is; collection is admin-only)
 *   from     — "From" address, e.g. '"HL Pro Tools" <noreply@example.com>'
 *   enabled  — boolean (false = fall back to env vars)
 */

const config = require('../config');

const DOC_PATH = { col: 'appSettings', doc: 'smtpConfig' };

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

let _mem = null; // in-memory fallback

const DEFAULT = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,
  user: '',
  pass: '',
  from: '"HL Pro Tools" <noreply@example.com>',
};

async function getSmtpConfig() {
  const d = db();
  if (d) {
    const snap = await d.collection(DOC_PATH.col).doc(DOC_PATH.doc).get();
    if (!snap.exists) return { ...DEFAULT };
    return { ...DEFAULT, ...snap.data() };
  }
  return _mem ? { ...DEFAULT, ..._mem } : { ...DEFAULT };
}

async function saveSmtpConfig(updates) {
  const current = await getSmtpConfig();
  const next = { ...current };

  if (updates.enabled  !== undefined) next.enabled = Boolean(updates.enabled);
  if (updates.host     !== undefined) next.host     = String(updates.host || '').trim();
  if (updates.port     !== undefined) next.port     = parseInt(updates.port) || 587;
  if (updates.secure   !== undefined) next.secure   = Boolean(updates.secure);
  if (updates.user     !== undefined) next.user     = String(updates.user || '').trim();
  if (updates.from     !== undefined) next.from     = String(updates.from || '').trim();
  // Only update password if a non-empty value was provided
  if (updates.pass?.trim()) next.pass = updates.pass.trim();

  const d = db();
  if (d) {
    await d.collection(DOC_PATH.col).doc(DOC_PATH.doc).set(next, { merge: true });
  } else {
    _mem = next;
  }
  return next;
}

module.exports = { getSmtpConfig, saveSmtpConfig, DEFAULT };
