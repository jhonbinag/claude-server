/**
 * src/services/dashboardConfigStore.js
 *
 * Stores admin dashboard configuration — which tabs/sections
 * are enabled for the location-scoped Admin Dashboard.
 *
 * Firestore: appSettings/dashboardConfig
 * In-memory fallback when Firebase is disabled.
 *
 * Schema:
 *   enabledTabs: string[]  — e.g. ['beta', 'users']
 *   updatedAt:   number
 */

const config = require('../config');

const ALL_TABS = [
  { id: 'beta',  label: 'Beta Lab',  desc: 'Toggle beta features per location' },
  { id: 'users', label: 'Users',     desc: 'Manage user roles' },
];

const DEFAULT_CONFIG = {
  enabledTabs: ALL_TABS.map(t => t.id),
};

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

let _mem = { ...DEFAULT_CONFIG };

async function getConfig() {
  const d = db();
  if (d) {
    const snap = await d.collection('appSettings').doc('dashboardConfig').get();
    if (snap.exists) return { ...DEFAULT_CONFIG, ...snap.data() };
  }
  return { ..._mem };
}

async function saveConfig(updates) {
  const current = await getConfig();
  const next = { ...current, ...updates, updatedAt: Date.now() };
  const d = db();
  if (d) {
    await d.collection('appSettings').doc('dashboardConfig').set(next, { merge: true });
  } else {
    _mem = next;
  }
  return next;
}

module.exports = { ALL_TABS, DEFAULT_CONFIG, getConfig, saveConfig };
