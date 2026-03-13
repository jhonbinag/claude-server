/**
 * src/services/promptStore.js
 *
 * Firestore-backed prompt library.
 * Collection: promptLibrary / {locationId}
 * Stores folders + prompts as a JSON string (no encryption needed — prompts are not secrets).
 * Falls back to in-memory map when Firebase is disabled.
 */

const config = require('../config');

let _db = null;

// Lazy — resolves after firebaseStore.js has initialized the Admin SDK.
function db() {
  if (_db) return _db;
  if (!config.isFirebaseEnabled) return null;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length) {
      _db = admin.app().firestore();
    }
  } catch { /* ignore */ }
  return _db;
}

const COLLECTION = 'promptLibrary';
const memStore   = {}; // fallback for dev

async function getLibrary(locationId) {
  const d = db();
  if (d) {
    const snap = await d.collection(COLLECTION).doc(locationId).get();
    if (!snap.exists) return { folders: [] };
    try { return { folders: JSON.parse(snap.data().folders || '[]') }; }
    catch { return { folders: [] }; }
  }
  return { folders: memStore[locationId] || [] };
}

async function saveLibrary(locationId, folders) {
  const d = db();
  if (d) {
    const admin = require('firebase-admin');
    await d.collection(COLLECTION).doc(locationId).set({
      folders:   JSON.stringify(folders),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    memStore[locationId] = folders;
  }
}

module.exports = { getLibrary, saveLibrary };
