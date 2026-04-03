/**
 * src/services/conversationStore.js
 *
 * Firestore-backed chat conversation history.
 *
 * Collections:
 *   chatConversations / {locationId}   — index doc: [{id, title, preview, updatedAt}]
 *   chatMessages      / {locationId}_{convId} — full message array (JSON blob)
 *
 * Falls back to in-memory maps when Firebase is disabled (dev mode).
 */

const config = require('../config');

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

const INDEX_COL = 'chatConversations'; // one doc per location: { index: JSON[] }
const MSG_COL   = 'chatMessages';      // one doc per conversation: { title, messages: JSON[], updatedAt }
const MAX_CONVS = 100;                 // keep at most 100 per location

const memIndex = {}; // { [locationId]: [{id, title, preview, updatedAt}] }
const memMsg   = {}; // { [docId]: { title, messages } }

// ── List conversations (metadata only) ────────────────────────────────────────

async function listConversations(locationId) {
  const d = db();
  if (d) {
    const snap = await d.collection(INDEX_COL).doc(locationId).get();
    if (!snap.exists) return [];
    try { return JSON.parse(snap.data().index || '[]'); }
    catch { return []; }
  }
  return memIndex[locationId] || [];
}

// ── Get a single conversation (with full messages) ─────────────────────────────

async function getConversation(locationId, convId) {
  const d = db();
  const docId = `${locationId}_${convId}`;
  if (d) {
    const snap = await d.collection(MSG_COL).doc(docId).get();
    if (!snap.exists) return null;
    const data = snap.data();
    return {
      id: convId,
      title: data.title || 'Conversation',
      messages: JSON.parse(data.messages || '[]'),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      ...(data.personaId ? { personaId: data.personaId } : {}),
    };
  }
  const m = memMsg[docId];
  if (!m) return null;
  return { id: convId, ...m };
}

// ── Save (create or update) a conversation ─────────────────────────────────────

async function saveConversation(locationId, { id, title, messages, personaId }) {
  const d = db();
  const docId  = `${locationId}_${id}`;
  const now    = new Date().toISOString();
  const safeTitle   = (title || 'New conversation').slice(0, 80);
  const previewMsg  = messages.find(m => m.role === 'user' || m.role === 'assistant');
  const preview     = previewMsg ? (previewMsg.content || '').slice(0, 120) : '';

  if (d) {
    const admin   = require('firebase-admin');
    const msgRef  = d.collection(MSG_COL).doc(docId);
    const idxRef  = d.collection(INDEX_COL).doc(locationId);

    const batch = d.batch();

    const msgSnap = await msgRef.get();
    const createdAt = msgSnap.exists ? msgSnap.data().createdAt : now;
    batch.set(msgRef, {
      title: safeTitle,
      locationId,
      messages: JSON.stringify(messages),
      createdAt,
      updatedAt: now,
      ...(personaId ? { personaId } : {}),
    });

    const idxSnap = await idxRef.get();
    let index = [];
    if (idxSnap.exists) {
      try { index = JSON.parse(idxSnap.data().index || '[]'); }
      catch { index = []; }
    }
    const entry = { id, title: safeTitle, preview, updatedAt: now, ...(personaId ? { personaId } : {}) };
    const pos   = index.findIndex(c => c.id === id);
    if (pos >= 0) index[pos] = entry;
    else index.unshift(entry);
    index = index.slice(0, MAX_CONVS);

    batch.set(idxRef, { index: JSON.stringify(index) }, { merge: true });
    await batch.commit();
  } else {
    memMsg[docId] = { title: safeTitle, messages, updatedAt: now, ...(personaId ? { personaId } : {}) };
    if (!memIndex[locationId]) memIndex[locationId] = [];
    const idx  = memIndex[locationId];
    const pos  = idx.findIndex(c => c.id === id);
    const entry = { id, title: safeTitle, preview, updatedAt: now, ...(personaId ? { personaId } : {}) };
    if (pos >= 0) idx[pos] = entry;
    else idx.unshift(entry);
    memIndex[locationId] = idx.slice(0, MAX_CONVS);
  }
}

// ── Delete a conversation ──────────────────────────────────────────────────────

async function deleteConversation(locationId, convId) {
  const d = db();
  const docId = `${locationId}_${convId}`;

  if (d) {
    const batch  = d.batch();
    const idxRef = d.collection(INDEX_COL).doc(locationId);

    batch.delete(d.collection(MSG_COL).doc(docId));

    const idxSnap = await idxRef.get();
    if (idxSnap.exists) {
      let index = [];
      try { index = JSON.parse(idxSnap.data().index || '[]'); }
      catch { index = []; }
      index = index.filter(c => c.id !== convId);
      batch.set(idxRef, { index: JSON.stringify(index) }, { merge: true });
    }
    await batch.commit();
  } else {
    delete memMsg[docId];
    if (memIndex[locationId]) {
      memIndex[locationId] = memIndex[locationId].filter(c => c.id !== convId);
    }
  }
}

module.exports = { listConversations, getConversation, saveConversation, deleteConversation };
