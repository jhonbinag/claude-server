/**
 * src/services/roleService.js
 *
 * Role-Based Access Control (RBAC) for per-location users.
 *
 * Built-in roles (read-only):
 *   owner   — all features
 *   admin   — all tools except billing
 *   manager — content tools only
 *   member  — basic tools
 *
 * Custom roles: stored per-location in Firestore/memory.
 *   Admin can create any role with any combination of features.
 *
 * Firestore schema:
 *   Collection: locationRoles
 *   Document:   {locationId}
 *   Fields:
 *     users:       { [userId]: { userId, name, email, role, ghlRole, syncedAt } }
 *     customRoles: { [roleId]: { id, name, features, createdAt, updatedAt } }
 *     updatedAt:   timestamp
 */

const crypto = require('crypto');
const config = require('../config');

// ── All available features (shown as checkboxes in role editor) ───────────────

const ALL_FEATURES = [
  { key: 'funnel_builder',   label: 'Funnel Builder',        icon: '🏗️' },
  { key: 'website_builder',  label: 'Website Builder',       icon: '🌐' },
  { key: 'ads_generator',    label: 'Bulk Ads Generator',    icon: '🎯' },
  { key: 'social_planner',   label: 'Social Planner',        icon: '📱' },
  { key: 'email_builder',    label: 'Email Builder',         icon: '📧' },
  { key: 'ad_library',       label: 'Ad Library Intel',      icon: '📊' },
  { key: 'campaign_builder', label: 'Campaign Builder',      icon: '📣' },
  { key: 'agents',           label: 'AI Agents',             icon: '🤖' },
  { key: 'ghl_agent',        label: 'GHL Agent',             icon: '⚡' },
  { key: 'workflows',        label: 'Workflow Builder',      icon: '🔀' },
  { key: 'manychat',         label: 'ManyChat Integration',  icon: '💬' },
  { key: 'settings',         label: 'Integration Settings',  icon: '⚙️' },
];

// ── Built-in role definitions (cannot be edited/deleted) ─────────────────────

const BUILTIN_ROLES = {
  owner:   { id: 'owner',   name: 'Owner',   features: ['*'],                        builtin: true },
  admin:   { id: 'admin',   name: 'Admin',   features: ALL_FEATURES.map(f => f.key), builtin: true },
  manager: { id: 'manager', name: 'Manager', features: ['funnel_builder', 'website_builder', 'ads_generator', 'social_planner', 'email_builder', 'ad_library', 'campaign_builder'], builtin: true },
  member:  { id: 'member',  name: 'Member',  features: ['ads_generator', 'social_planner', 'ad_library'], builtin: true },
};

const BUILTIN_ROLE_KEYS = Object.keys(BUILTIN_ROLES);

// ── Firebase setup ────────────────────────────────────────────────────────────

let _db = null;

function getDb() {
  if (_db) return _db;
  if (!config.isFirebaseEnabled) return null;
  try {
    const admin = require('firebase-admin');
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

// ── Firestore / memory helpers ────────────────────────────────────────────────

const _memStore = {};

async function getLocationDoc(locationId) {
  if (config.isFirebaseEnabled) {
    const db = getDb();
    if (!db) return null;
    const snap = await db.collection('locationRoles').doc(locationId).get();
    return snap.exists ? snap.data() : null;
  }
  return _memStore[locationId] || null;
}

async function setLocationDoc(locationId, data) {
  if (config.isFirebaseEnabled) {
    const db = getDb();
    if (!db) return;
    await db.collection('locationRoles').doc(locationId).set(data, { merge: true });
  } else {
    _memStore[locationId] = { ...(_memStore[locationId] || {}), ...data };
  }
}

// ── Custom roles API ──────────────────────────────────────────────────────────

/**
 * Get all custom roles for a location.
 * @returns {object} map of roleId → { id, name, features, builtin?, createdAt }
 */
async function getCustomRoles(locationId) {
  try {
    const doc = await getLocationDoc(locationId);
    return doc?.customRoles || {};
  } catch {
    return {};
  }
}

/**
 * Get all roles (built-in + custom) for a location.
 * @returns {{ id, name, features, builtin? }[]}
 */
async function getAllRoles(locationId) {
  const custom = await getCustomRoles(locationId);
  return [
    ...Object.values(BUILTIN_ROLES),
    ...Object.values(custom),
  ];
}

/**
 * Create or update a role (built-in or custom).
 * Built-in roles can be overridden per-location; their override is stored
 * in customRoles under the same key (e.g. 'owner', 'admin').
 *
 * @param {string} locationId
 * @param {string|null} roleId  — null to auto-generate ID for new custom roles
 * @param {string} name
 * @param {string[]} features
 * @returns {{ id, name, features, createdAt, updatedAt, builtin? }}
 */
async function saveCustomRole(locationId, roleId, name, features, tier) {
  if (!name || !name.trim()) throw new Error('Role name is required.');
  if (!Array.isArray(features))  throw new Error('features must be an array.');

  // Validate feature keys
  const validKeys = new Set(ALL_FEATURES.map(f => f.key));
  const invalid = features.filter(f => f !== '*' && !validKeys.has(f));
  if (invalid.length) throw new Error(`Unknown features: ${invalid.join(', ')}`);

  const id = roleId || `custom_${crypto.randomBytes(4).toString('hex')}`;
  const isBuiltin = BUILTIN_ROLE_KEYS.includes(id);

  const existing = await getCustomRoles(locationId);
  const now = Date.now();
  const role = {
    id,
    name: name.trim(),
    features,
    ...(isBuiltin ? { builtin: true } : {}),
    ...(tier ? { tier } : {}),
    createdAt: existing[id]?.createdAt || now,
    updatedAt: now,
  };

  existing[id] = role;
  await setLocationDoc(locationId, { customRoles: existing, updatedAt: now });
  return role;
}

/**
 * Reset a built-in role back to its default features for this location
 * (removes the per-location override).
 */
async function resetBuiltinRole(locationId, roleId) {
  if (!BUILTIN_ROLE_KEYS.includes(roleId)) throw new Error(`${roleId} is not a built-in role.`);
  const existing = await getCustomRoles(locationId);
  delete existing[roleId];
  await setLocationDoc(locationId, { customRoles: existing, updatedAt: Date.now() });
  return BUILTIN_ROLES[roleId];
}

/**
 * Delete a custom role.
 */
async function deleteCustomRole(locationId, roleId) {
  if (BUILTIN_ROLE_KEYS.includes(roleId)) throw new Error('Cannot delete built-in roles.');
  const existing = await getCustomRoles(locationId);
  if (!existing[roleId]) throw new Error(`Role not found: ${roleId}`);
  delete existing[roleId];
  await setLocationDoc(locationId, { customRoles: existing, updatedAt: Date.now() });
}

// ── Users API ─────────────────────────────────────────────────────────────────

async function getUsersForLocation(locationId) {
  try {
    const doc = await getLocationDoc(locationId);
    return doc?.users || {};
  } catch {
    return {};
  }
}

async function saveUsersForLocation(locationId, users) {
  await setLocationDoc(locationId, { users, updatedAt: Date.now() });
}

async function getUserRole(locationId, userId) {
  const users = await getUsersForLocation(locationId);
  return users[userId] || null;
}

async function setUserRole(locationId, userId, role) {
  // Accept built-in roles OR any custom role that exists for this location
  const isBuiltin = BUILTIN_ROLE_KEYS.includes(role);
  if (!isBuiltin) {
    const custom = await getCustomRoles(locationId);
    if (!custom[role]) throw new Error(`Invalid role: "${role}". Must be a built-in role or an existing custom role for this location.`);
  }

  const users = await getUsersForLocation(locationId);
  if (!users[userId]) {
    users[userId] = { userId, name: 'Unknown', email: '', ghlRole: 'user', syncedAt: Date.now() };
  }
  users[userId].role      = role;
  users[userId].updatedAt = Date.now();
  await saveUsersForLocation(locationId, users);
  return users[userId];
}

// ── Feature resolution ────────────────────────────────────────────────────────

/**
 * Get features for a role — looks up built-in first, then custom roles.
 * @param {string} locationId  (needed to look up custom roles)
 * @param {string} role
 * @returns {Promise<string[]>}
 */
async function getFeaturesForRole(locationId, role) {
  if (BUILTIN_ROLES[role]) return BUILTIN_ROLES[role].features;
  const custom = await getCustomRoles(locationId);
  return custom[role]?.features || BUILTIN_ROLES.member.features;
}

/**
 * Synchronous version — only works for built-in roles (used by middleware).
 */
function getFeaturesForBuiltinRole(role) {
  return (BUILTIN_ROLES[role] || BUILTIN_ROLES.member).features;
}

function canAccess(role, feature) {
  const features = getFeaturesForBuiltinRole(role);
  return features.includes('*') || features.includes(feature);
}

// ── GHL User Sync ─────────────────────────────────────────────────────────────

async function syncUsers(locationId, ghlRequest, ownerUserId) {
  try {
    const resp     = await ghlRequest('GET', '/users/', null, { locationId });
    const ghlUsers = resp?.users || [];
    const existing = await getUsersForLocation(locationId);

    const merged = {};
    for (const u of ghlUsers) {
      const id = u.id || u.userId;
      if (!id) continue;
      const ghlRole    = u.roles?.type || u.role || 'user';
      const defaultRole = id === ownerUserId ? 'owner' : mapGhlRole(ghlRole);
      merged[id] = {
        userId:   id,
        name:     u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown',
        email:    u.email || '',
        role:     existing[id]?.role || defaultRole,
        ghlRole,
        syncedAt: Date.now(),
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

module.exports = {
  ALL_FEATURES,
  BUILTIN_ROLES,
  BUILTIN_ROLE_KEYS,
  // Custom roles
  getCustomRoles,
  getAllRoles,
  saveCustomRole,
  deleteCustomRole,
  resetBuiltinRole,
  // Users
  syncUsers,
  getUsersForLocation,
  saveUsersForLocation,
  getUserRole,
  setUserRole,
  // Features
  getFeaturesForRole,
  getFeaturesForBuiltinRole,
  canAccess,
};
