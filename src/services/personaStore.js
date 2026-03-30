/**
 * src/services/personaStore.js
 *
 * Admin-managed chat personas stored in Firestore.
 * Falls back to in-memory when Firebase is disabled.
 *
 * Each persona can be assigned to:
 *   '__all__'  — available to every location
 *   'specific' — only to locations listed in assignedLocations[]
 *
 * Collection: chatPersonas
 * Document ID: personaId
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

const COL = 'chatPersonas';
const mem = {}; // in-memory fallback keyed by personaId

// ── List all personas (newest first) ──────────────────────────────────────────

async function listPersonas() {
  const d = db();
  if (d) {
    const snap = await d.collection(COL).orderBy('createdAt', 'desc').get();
    return snap.docs.map(doc => ({ personaId: doc.id, ...doc.data() }));
  }
  return Object.values(mem).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ── Get single persona ────────────────────────────────────────────────────────

async function getPersona(personaId) {
  const d = db();
  if (d) {
    const snap = await d.collection(COL).doc(personaId).get();
    if (!snap.exists) return null;
    return { personaId: snap.id, ...snap.data() };
  }
  return mem[personaId] || null;
}

// ── Save (create or update) ───────────────────────────────────────────────────

async function savePersona(persona) {
  const { personaId, ...data } = persona;
  const now  = Date.now();
  const save = { ...data, updatedAt: now };
  if (!data.createdAt) save.createdAt = now;

  const d = db();
  if (d) {
    await d.collection(COL).doc(personaId).set(save, { merge: true });
  } else {
    mem[personaId] = { personaId, ...save };
  }
  return { personaId, ...save };
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function deletePersona(personaId) {
  const d = db();
  if (d) {
    await d.collection(COL).doc(personaId).delete();
  } else {
    delete mem[personaId];
  }
}

// ── Get the active persona for a location ─────────────────────────────────────
// Priority: location-specific > global ('__all__')

async function getPersonaForLocation(locationId) {
  try {
    const all    = await listPersonas();
    const active = all.filter(p => p.status === 'active');

    const specific = active.find(p =>
      p.assignedTo === 'specific' &&
      Array.isArray(p.assignedLocations) &&
      p.assignedLocations.includes(locationId)
    );
    if (specific) return specific;

    return active.find(p => p.assignedTo === '__all__') || null;
  } catch {
    return null;
  }
}

module.exports = { listPersonas, getPersona, savePersona, deletePersona, getPersonaForLocation };
