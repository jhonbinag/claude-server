/**
 * src/services/promptStore.js
 *
 * Firestore-backed prompt library.
 *
 * Collections:
 *   promptLibrary  / {locationId}   — folders + prompts metadata (JSON blob)
 *   promptTraining / {locationId}_{promptId} — full training conversation history
 *
 * Training history is stored in its own collection so it doesn't bloat the
 * main library document and is visible as a distinct collection in Firebase.
 * Falls back to in-memory maps when Firebase is disabled.
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

const LIB_COL      = 'promptLibrary';
const TRAIN_COL    = 'promptTraining';
const memLibrary   = {}; // fallback for dev
const memTraining  = {}; // fallback for dev

// ── Prompt Library (folders + prompts metadata) ───────────────────────────────

async function getLibrary(locationId) {
  const d = db();
  if (d) {
    const snap = await d.collection(LIB_COL).doc(locationId).get();
    if (!snap.exists) return { folders: [] };
    try { return { folders: JSON.parse(snap.data().folders || '[]') }; }
    catch { return { folders: [] }; }
  }
  return { folders: memLibrary[locationId] || [] };
}

async function saveLibrary(locationId, folders) {
  const d = db();
  if (d) {
    const admin = require('firebase-admin');
    // Strip trainHistory from embedded prompt objects before saving —
    // training data lives in promptTraining collection, not here.
    const clean = folders.map(f => ({
      ...f,
      prompts: (f.prompts || []).map(({ trainHistory: _th, ...p }) => p),
    }));
    await d.collection(LIB_COL).doc(locationId).set({
      folders:   JSON.stringify(clean),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    memLibrary[locationId] = folders;
  }
}

// ── Training History (separate collection) ────────────────────────────────────

/**
 * Save training conversation history for a specific prompt.
 * Document ID: {locationId}_{promptId}
 */
async function saveTraining(locationId, promptId, trainHistory, meta = {}) {
  const d = db();
  const key = `${locationId}_${promptId}`;
  if (d) {
    const admin = require('firebase-admin');
    await d.collection(TRAIN_COL).doc(key).set({
      locationId,
      promptId,
      folderId:     meta.folderId    || null,
      promptTitle:  meta.promptTitle || null,
      isDraft:      meta.isDraft     ?? true,
      trainHistory,
      messageCount: trainHistory.length,
      updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[PromptStore] Saved training for ${key} (${trainHistory.length} messages)`);
  } else {
    console.warn(`[PromptStore] Firebase not connected — training for ${key} saved to memory only`);
    memTraining[key] = { locationId, promptId, trainHistory, ...meta };
  }
}

/**
 * Load training history for a specific prompt.
 * Returns [] if none found.
 */
async function getTraining(locationId, promptId) {
  const d = db();
  const key = `${locationId}_${promptId}`;
  if (d) {
    const snap = await d.collection(TRAIN_COL).doc(key).get();
    if (!snap.exists) return [];
    return snap.data().trainHistory || [];
  }
  return memTraining[key]?.trainHistory || [];
}

/**
 * Delete training history when a prompt is deleted.
 */
async function deleteTraining(locationId, promptId) {
  const d = db();
  const key = `${locationId}_${promptId}`;
  if (d) {
    await d.collection(TRAIN_COL).doc(key).delete();
  } else {
    delete memTraining[key];
  }
}

module.exports = { getLibrary, saveLibrary, saveTraining, getTraining, deleteTraining };
