/**
 * src/services/dashboardCredentialStore.js
 *
 * Manages Admin Dashboard login credentials.
 * Passwords are hashed with PBKDF2-SHA512 (Node crypto built-in).
 * Session tokens are stateless HMAC-signed payloads — no DB lookup needed.
 *
 * Firestore collection: dashboardCredentials
 *
 * Document fields:
 *   credentialId     — unique ID (dash_cred_{hex})
 *   name             — display name  (e.g. "John Smith")
 *   email            — email address (for activation + notifications)
 *   username         — login username (unique, lowercase)
 *   passwordHash     — PBKDF2 hex
 *   passwordSalt     — random 16-byte hex
 *   locationIds      — ['all'] | [locationId, ...] — which locations this credential can manage
 *   role             — 'mini_admin' | 'admin'
 *   status           — 'active' | 'inactive'
 *   activated        — boolean — false until email activation link is clicked
 *   activationToken  — random 32-byte hex | null (cleared after activation)
 *   activationExpires — timestamp (72h TTL) | null
 *   notes            — free text
 *   lastLoginAt      — timestamp or null
 *   lastLoginIp      — string or null
 *   loginCount       — number
 *   createdAt, updatedAt
 */

const crypto = require('crypto');
const config = require('../config');

// ── Firestore ─────────────────────────────────────────────────────────────────

const COL = 'dashboardCredentials';
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

const mem = {}; // in-memory fallback

// ── Password hashing ──────────────────────────────────────────────────────────

function newSalt() { return crypto.randomBytes(16).toString('hex'); }

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function verifyPassword(password, salt, hash) {
  return hashPassword(password, salt) === hash;
}

/** Generate a readable random password: 4 uppercase + 4 lowercase + 4 digits = 12 chars */
function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  let pwd = '';
  for (let i = 0; i < 4; i++) pwd += upper[crypto.randomInt(upper.length)];
  for (let i = 0; i < 4; i++) pwd += lower[crypto.randomInt(lower.length)];
  for (let i = 0; i < 4; i++) pwd += digits[crypto.randomInt(digits.length)];
  // Shuffle
  return pwd.split('').sort(() => crypto.randomInt(3) - 1).join('');
}

// ── Session tokens (stateless HMAC-signed, 8h TTL) ────────────────────────────

function getSecret() {
  return process.env.DASHBOARD_SESSION_SECRET || process.env.ADMIN_API_KEY || 'dev_dash_secret_change_me';
}

function signToken(credentialId) {
  const payload = JSON.stringify({ credentialId, exp: Date.now() + 8 * 3600 * 1000 });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig  = crypto.createHmac('sha256', getSecret()).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const b64 = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', getSecret()).update(b64).digest('hex');
  if (sig.length !== expected.length) return null;
  let eq;
  try { eq = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')); } catch { return null; }
  if (!eq) return null;
  try {
    const data = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (!data.credentialId || data.exp < Date.now()) return null;
    return data.credentialId;
  } catch { return null; }
}

// ── Activation tokens ─────────────────────────────────────────────────────────

function generateActivationToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function genId() { return `dash_cred_${crypto.randomBytes(6).toString('hex')}`; }

async function listCredentials() {
  const d = db();
  if (d) {
    const snap = await d.collection(COL).orderBy('createdAt', 'desc').get();
    return snap.docs.map(doc => ({ credentialId: doc.id, ...doc.data() }));
  }
  return Object.values(mem).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function getCredential(credentialId) {
  const d = db();
  if (d) {
    const snap = await d.collection(COL).doc(credentialId).get();
    if (!snap.exists) return null;
    return { credentialId: snap.id, ...snap.data() };
  }
  return mem[credentialId] || null;
}

async function getByUsername(username) {
  const lower = username.toLowerCase();
  const d = db();
  if (d) {
    const snap = await d.collection(COL).where('username', '==', lower).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { credentialId: doc.id, ...doc.data() };
  }
  return Object.values(mem).find(c => c.username === lower) || null;
}

/**
 * Create a new credential.
 * Password is auto-generated — not accepted from caller.
 * Returns the plaintext password so it can be emailed.
 *
 * @param {{ name, email, username, locationIds, role?, status?, notes? }} data
 * @returns {{ cred, plainPassword }}
 */
async function createCredential(data) {
  const { name, email, username, locationIds, role, status, notes } = data;
  if (!name?.trim())     throw new Error('name is required');
  if (!email?.trim())    throw new Error('email is required');
  if (!username?.trim()) throw new Error('username is required');
  if (!locationIds || !Array.isArray(locationIds) || locationIds.length === 0) {
    throw new Error('locationIds is required (["all"] or specific location IDs)');
  }

  const lower = username.toLowerCase().trim();
  const existing = await getByUsername(lower);
  if (existing) throw new Error(`Username "${lower}" is already taken.`);

  const plainPassword  = generatePassword();
  const salt           = newSalt();
  const hash           = hashPassword(plainPassword, salt);
  const id             = genId();
  const now            = Date.now();
  const activationToken   = generateActivationToken();
  const activationExpires = now + 72 * 3600 * 1000; // 72h

  const cred = {
    name:             name.trim(),
    email:            email.trim().toLowerCase(),
    username:         lower,
    passwordHash:     hash,
    passwordSalt:     salt,
    locationIds:      locationIds,
    role:             role || 'mini_admin',
    status:           status || 'active',
    activated:        false,
    activationToken,
    activationExpires,
    notes:            notes || '',
    lastLoginAt:      null,
    lastLoginIp:      null,
    loginCount:       0,
    createdAt:        now,
    updatedAt:        now,
  };

  const d = db();
  if (d) {
    await d.collection(COL).doc(id).set(cred);
  } else {
    mem[id] = { credentialId: id, ...cred };
  }
  return { cred: { credentialId: id, ...cred }, plainPassword };
}

/**
 * Update an existing credential.
 * Password is only updated if newPassword provided.
 */
async function updateCredential(credentialId, updates) {
  const cred = await getCredential(credentialId);
  if (!cred) throw new Error('Credential not found');

  const patch = { updatedAt: Date.now() };

  if (updates.name      !== undefined) patch.name      = updates.name.trim();
  if (updates.email     !== undefined) patch.email     = updates.email.trim().toLowerCase();
  if (updates.locationIds !== undefined) patch.locationIds = updates.locationIds;
  if (updates.role      !== undefined) patch.role      = updates.role;
  if (updates.status    !== undefined) patch.status    = updates.status;
  if (updates.notes     !== undefined) patch.notes     = updates.notes;

  // Username change — check uniqueness
  if (updates.username !== undefined) {
    const lower = updates.username.toLowerCase().trim();
    if (lower !== cred.username) {
      const taken = await getByUsername(lower);
      if (taken && taken.credentialId !== credentialId) throw new Error(`Username "${lower}" is already taken.`);
    }
    patch.username = lower;
  }

  // Password change
  if (updates.newPassword?.trim()) {
    patch.passwordSalt = newSalt();
    patch.passwordHash = hashPassword(updates.newPassword.trim(), patch.passwordSalt);
  }

  const d = db();
  if (d) {
    await d.collection(COL).doc(credentialId).set(patch, { merge: true });
  } else {
    Object.assign(mem[credentialId], patch);
  }
  return { ...cred, ...patch };
}

async function deleteCredential(credentialId) {
  const d = db();
  if (d) await d.collection(COL).doc(credentialId).delete();
  else delete mem[credentialId];
}

/**
 * Activate a credential by activation token.
 * Sets activated=true, clears token, sets status='active'.
 * Returns the credential or null/error.
 */
async function activateByToken(token) {
  if (!token) return { success: false, error: 'Missing activation token.' };

  const d = db();
  let cred = null;
  let credentialId = null;

  if (d) {
    const snap = await d.collection(COL).where('activationToken', '==', token).limit(1).get();
    if (snap.empty) return { success: false, error: 'Invalid or already used activation link.' };
    const doc = snap.docs[0];
    cred = { credentialId: doc.id, ...doc.data() };
    credentialId = doc.id;
  } else {
    const found = Object.values(mem).find(c => c.activationToken === token);
    if (!found) return { success: false, error: 'Invalid or already used activation link.' };
    cred = found;
    credentialId = found.credentialId;
  }

  if (cred.activationExpires && cred.activationExpires < Date.now()) {
    return { success: false, error: 'Activation link has expired. Ask your admin to resend it.' };
  }

  const patch = { activated: true, activationToken: null, activationExpires: null, status: 'active', updatedAt: Date.now() };
  if (d) {
    await d.collection(COL).doc(credentialId).set(patch, { merge: true });
  } else {
    Object.assign(mem[credentialId], patch);
  }

  return { success: true, credentialId };
}

/**
 * Generate a new activation token for an existing credential (for resend).
 * Returns { activationToken, activationExpires }.
 */
async function generateNewActivationToken(credentialId) {
  const cred = await getCredential(credentialId);
  if (!cred) throw new Error('Credential not found');

  const activationToken   = generateActivationToken();
  const activationExpires = Date.now() + 72 * 3600 * 1000;
  const patch = { activationToken, activationExpires, activated: false, updatedAt: Date.now() };

  const d = db();
  if (d) {
    await d.collection(COL).doc(credentialId).set(patch, { merge: true });
  } else {
    Object.assign(mem[credentialId], patch);
  }
  return { activationToken, activationExpires, cred: { ...cred, ...patch } };
}

// ── Login ─────────────────────────────────────────────────────────────────────

/**
 * Verify username + password. Returns session token + credential info (no hash).
 */
async function login(username, password, ip) {
  const cred = await getByUsername(username);
  if (!cred) return { success: false, error: 'Invalid username or password.' };
  if (!cred.activated) return { success: false, error: 'Account not yet activated. Please check your email for the activation link.' };
  if (cred.status !== 'active') return { success: false, error: 'This account is inactive.' };
  if (!verifyPassword(password, cred.passwordSalt, cred.passwordHash)) {
    return { success: false, error: 'Invalid username or password.' };
  }

  const patch = { lastLoginAt: Date.now(), lastLoginIp: ip || null, loginCount: (cred.loginCount || 0) + 1, updatedAt: Date.now() };
  const d = db();
  if (d) await d.collection(COL).doc(cred.credentialId).set(patch, { merge: true });
  else if (mem[cred.credentialId]) Object.assign(mem[cred.credentialId], patch);

  const token = signToken(cred.credentialId);
  const { passwordHash: _h, passwordSalt: _s, activationToken: _at, ...safe } = cred;
  return { success: true, token, credential: { ...safe, ...patch } };
}

module.exports = {
  listCredentials,
  getCredential,
  getByUsername,
  createCredential,
  updateCredential,
  deleteCredential,
  activateByToken,
  generateNewActivationToken,
  login,
  verifyToken,
  generatePassword,
};
