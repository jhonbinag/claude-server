/**
 * src/services/roleService.js
 *
 * Role-Based Access Control (RBAC) for per-location users.
 *
 * Roles:
 *   owner   — all features
 *   admin   — all tools except billing management
 *   manager — content tools only
 *   member  — basic read/post tools
 *
 * Firestore schema:
 *   Collection: locationRoles
 *   Document:   {locationId}
 *   Fields:
 *     users: map { [userId]: { userId, name, email, role, ghlRole, syncedAt } }
 *     updatedAt: timestamp
 */

const config = require('../config');

// ── Role definitions ──────────────────────────────────────────────────────────

const ROLE_FEATURES = {
  owner:   ['*'],
  admin:   ['funnel_builder', 'website_builder', 'ads_generator', 'social_planner',
            'email_builder', 'ad_library', 'agents', 'ghl_agent', 'workflows',
            'settings', 'manychat', 'campaign_builder'],
  manager: ['funnel_builder', 'website_builder', 'ads_generator', 'social_planner',
            'email_builder', 'ad_library', 'campaign_builder'],
  member:  ['ads_generator', 'social_planner', 'ad_library'],
};

const VALID_ROLES = Object.keys(ROLE_FEATURES);

// ── Firebase setup (mirrors firebaseStore.js pattern) ────────────────────────

let _db = null;

function getDb() {
  if (_db) return _db;
  if (!config.isFirebaseEnabled) return null;
  try {
    const admin = require('firebase-admin');
    // Reuse existing initialized app from firebaseStore
    _db = admin.firestore();
    return _db;
  } catch {
    return null;
  }
}

// ── Map GHL built-in role to our app role ─────────────────────────────────────

function mapGhlRole(ghlRole) {
  if (!ghlRole) return 'member';
  const r = String(ghlRole).toLowerCase();
  if (r === 'admin')   return 'admin';
  if (r === 'owner')   return 'owner';
  if (r === 'manager') return 'manager';
  return 'member';
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function getLocationDoc(locationId) {
  const db = getDb();
  if (!db) return null;
  const snap = await db.collection('locationRoles').doc(locationId).get();
  return snap.exists ? snap.data() : null;
}

async function setLocationDoc(locationId, data) {
  const db = getDb();
  if (!db) return;
  await db.collection('locationRoles').doc(locationId).set(data, { merge: true });
}

// ── In-memory fallback (when Firebase not configured) ─────────────────────────

const _memStore = {};

function memGet(locationId) {
  return _memStore[locationId] || null;
}

function memSet(locationId, data) {
  _memStore[locationId] = data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sync GHL users for a location (called after OAuth install).
 * Fetches users from GHL API and stores them with default roles.
 * Existing role overrides are preserved.
 *
 * @param {string} locationId
 * @param {function} ghlRequest - bound ghlRequest(method, endpoint, data, params)
 * @param {string} [ownerUserId] - userId from the OAuth token (gets owner role)
 */
async function syncUsers(locationId, ghlRequest, ownerUserId) {
  try {
    const resp = await ghlRequest('GET', '/users/', null, { locationId });
    const ghlUsers = resp?.users || [];

    const existing = await getUsersForLocation(locationId);

    const merged = {};
    for (const u of ghlUsers) {
      const id = u.id || u.userId;
      if (!id) continue;
      const ghlRole = u.roles?.type || u.role || 'user';
      const defaultRole = id === ownerUserId ? 'owner' : mapGhlRole(ghlRole);
      // Preserve any manually-set role override
      const existingRole = existing[id]?.role;
      merged[id] = {
        userId:    id,
        name:      u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown',
        email:     u.email || '',
        role:      existingRole || defaultRole,
        ghlRole,
        syncedAt:  Date.now(),
      };
    }

    await saveUsersForLocation(locationId, merged);
    console.log(`[RoleService] Synced ${Object.keys(merged).length} users for location ${locationId}`);
    return merged;
  } catch (err) {
    console.warn(`[RoleService] User sync failed for ${locationId}:`, err.message);
    return {};
  }
}

/**
 * Get all users for a location.
 * @returns {object} map of userId → user record
 */
async function getUsersForLocation(locationId) {
  try {
    const doc = config.isFirebaseEnabled
      ? await getLocationDoc(locationId)
      : memGet(locationId);
    return doc?.users || {};
  } catch {
    return {};
  }
}

/**
 * Save the full users map for a location.
 */
async function saveUsersForLocation(locationId, users) {
  const data = { users, updatedAt: Date.now() };
  if (config.isFirebaseEnabled) {
    await setLocationDoc(locationId, data);
  } else {
    memSet(locationId, data);
  }
}

/**
 * Get a single user's role record.
 * @returns {{ userId, name, email, role, ghlRole, syncedAt } | null}
 */
async function getUserRole(locationId, userId) {
  const users = await getUsersForLocation(locationId);
  return users[userId] || null;
}

/**
 * Set a user's role (admin override).
 */
async function setUserRole(locationId, userId, role) {
  if (!VALID_ROLES.includes(role)) throw new Error(`Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`);
  const users = await getUsersForLocation(locationId);
  if (!users[userId]) {
    users[userId] = { userId, name: 'Unknown', email: '', ghlRole: 'user', syncedAt: Date.now() };
  }
  users[userId].role = role;
  users[userId].updatedAt = Date.now();
  await saveUsersForLocation(locationId, users);
  return users[userId];
}

/**
 * Get allowed features for a role.
 * @param {string} role
 * @returns {string[]}
 */
function getFeaturesForRole(role) {
  return ROLE_FEATURES[role] || ROLE_FEATURES.member;
}

/**
 * Check if a role can access a feature.
 * @param {string} role
 * @param {string} feature
 */
function canAccess(role, feature) {
  const features = getFeaturesForRole(role);
  return features.includes('*') || features.includes(feature);
}

module.exports = {
  VALID_ROLES,
  ROLE_FEATURES,
  syncUsers,
  getUsersForLocation,
  saveUsersForLocation,
  getUserRole,
  setUserRole,
  getFeaturesForRole,
  canAccess,
};
