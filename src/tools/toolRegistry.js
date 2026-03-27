/**
 * src/tools/toolRegistry.js
 *
 * Unified tool registry — combines GHL tools (always available) with
 * external tools (available only when configured for a location).
 *
 * Config Loading — Three-Tier Priority:
 *
 *   Tier 1 — Redis cache (toolTokenService)
 *             1-hour TTL. Eliminates Firestore reads on every request.
 *             Invalidated automatically when integrations change.
 *
 *   Tier 2 — Firebase Firestore (firebaseStore)
 *             Source of truth for AES-256-encrypted API keys.
 *             Only read on cache miss; result repopulates the cache.
 *
 *   Tier 3 — tokenStore fallback (file JSON or Upstash location record)
 *             Used in development when Firebase is not configured.
 *
 * All exported functions are async.
 */

const config           = require('../config');
const tokenStore       = require('../services/tokenStore');
const firebaseStore    = require('../services/firebaseStore');
const toolTokenService = require('../services/toolTokenService');
const { getToolDefinitions: getGhlDefs, executeGhlTool } = require('./ghlTools');
const { EXTERNAL_TOOL_DEFINITIONS, TOOL_METADATA, executeExternalTool } = require('./externalTools');

// Map every external tool name → its category key (built once at module load)
const EXTERNAL_TOOL_CATEGORY = {};
for (const [category, defs] of Object.entries(EXTERNAL_TOOL_DEFINITIONS)) {
  for (const def of defs) {
    EXTERNAL_TOOL_CATEGORY[def.name] = category;
  }
}

// ── Three-Tier Config Loader ───────────────────────────────────────────────────

/**
 * Load tool configs for a location using the three-tier strategy.
 *
 * @param {string} locationId
 * @returns {Promise<object>}  Map of category → config object
 */
async function loadToolConfigs(locationId) {
  let configs = {};

  // Tier 1: Firebase Firestore — primary source of truth when enabled.
  // If Firebase returns data, use it directly and warm the Redis cache.
  if (config.isFirebaseEnabled) {
    try {
      configs = await firebaseStore.getToolConfig(locationId);
      if (Object.keys(configs).length > 0) {
        // Warm Redis so writes and other services can use the cache
        try { await toolTokenService.setCachedToolConfig(locationId, configs); } catch { /* non-fatal */ }
        return configs;
      }
    } catch (err) {
      console.error(`[ToolRegistry] Firebase read failed for ${locationId}:`, err.message);
    }
  }

  // Tier 2: Redis — used for first-time entries not yet committed to Firebase,
  // or when Firebase is disabled / temporarily unavailable.
  try {
    const cached = await toolTokenService.getCachedToolConfig(locationId);
    if (cached !== null && Object.keys(cached).length > 0) return cached;
  } catch { /* cache unavailable — continue to next tier */ }

  // Tier 3: tokenStore fallback (dev / no-Firebase mode)
  try {
    const fallback = await Promise.resolve(tokenStore.getToolConfig(locationId));
    if (Object.keys(fallback || {}).length > 0) configs = fallback;
  } catch { /* ignore */ }

  return configs;
}

async function loadToolSharing(locationId) {
  let sharing = {};

  if (config.isFirebaseEnabled && typeof firebaseStore.getToolSharing === 'function') {
    try {
      sharing = await firebaseStore.getToolSharing(locationId);
      if (Object.keys(sharing).length > 0) return sharing;
    } catch (err) {
      console.error(`[ToolRegistry] Firebase sharing read failed for ${locationId}:`, err.message);
    }
  }

  try {
    const fallback = await Promise.resolve(tokenStore.getToolSharing?.(locationId));
    if (fallback && Object.keys(fallback).length > 0) sharing = fallback;
  } catch { /* ignore */ }

  return sharing;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Get all tool definitions available for a location.
 * Always includes GHL tools; adds external defs for each connected integration.
 *
 * @param {string}        locationId
 * @param {string[]|null} allowedCategories  Whitelist; null = all enabled; [] = GHL only.
 * @returns {Promise<Array>}
 */
async function getTools(locationId, allowedCategories = null, options = {}) {
  const ghlTools    = getGhlDefs();
  const { userVisibleOnly = false } = options || {};
  const [toolConfigs, sharedIntegrations] = await Promise.all([
    loadToolConfigs(locationId),
    userVisibleOnly ? getSharedIntegrations(locationId) : Promise.resolve(null),
  ]);
  const external    = [];
  const sharedSet   = sharedIntegrations ? new Set(sharedIntegrations) : null;

  for (const [category, defs] of Object.entries(EXTERNAL_TOOL_DEFINITIONS)) {
    if (allowedCategories !== null && !allowedCategories.includes(category)) continue;
    if (sharedSet && !sharedSet.has(category)) continue;
    if (toolConfigs[category] && Object.keys(toolConfigs[category]).length > 0) {
      external.push(...defs);
    }
  }

  return [...ghlTools, ...external];
}

/**
 * Execute a tool call by name for a given location.
 *
 * @param {string} toolName
 * @param {object} input
 * @param {string} locationId
 * @param {string} [companyId]
 * @returns {Promise<object>}
 */
async function executeTool(toolName, input, locationId, companyId) {
  const category = EXTERNAL_TOOL_CATEGORY[toolName];
  if (category) {
    const toolConfigs = await loadToolConfigs(locationId);
    return executeExternalTool(toolName, input, toolConfigs);
  }
  return executeGhlTool(toolName, input, locationId, companyId);
}

/**
 * Get the list of enabled integration categories for a location.
 *
 * @param {string} locationId
 * @returns {Promise<string[]>}
 */
async function getEnabledIntegrations(locationId, options = {}) {
  const { userVisibleOnly = false } = options || {};
  const [toolConfigs, sharedIntegrations] = await Promise.all([
    loadToolConfigs(locationId),
    userVisibleOnly ? getSharedIntegrations(locationId) : Promise.resolve(null),
  ]);
  const sharedSet = sharedIntegrations ? new Set(sharedIntegrations) : null;
  return Object.keys(toolConfigs).filter(
    (k) => toolConfigs[k]
      && Object.keys(toolConfigs[k]).length > 0
      && (!sharedSet || sharedSet.has(k)),
  );
}

async function getSharedIntegrations(locationId) {
  const sharing = await loadToolSharing(locationId);
  return Object.entries(sharing)
    .filter(([, isShared]) => !!isShared)
    .map(([category]) => category);
}

async function setIntegrationShared(locationId, category, isShared) {
  if (typeof firebaseStore.saveToolSharing === 'function' && config.isFirebaseEnabled) {
    await firebaseStore.saveToolSharing(locationId, { [category]: !!isShared });
    return;
  }
  if (typeof tokenStore.saveToolSharing === 'function') {
    await Promise.resolve(tokenStore.saveToolSharing(locationId, { [category]: !!isShared }));
  }
}

/**
 * List all available integration categories with metadata.
 * Synchronous — used by the Settings UI.
 *
 * @returns {Array}
 */
function getAllIntegrationsMeta() {
  return Object.entries(TOOL_METADATA).map(([key, meta]) => ({
    key,
    ...meta,
    toolCount: (EXTERNAL_TOOL_DEFINITIONS[key] || []).length,
    toolNames: (EXTERNAL_TOOL_DEFINITIONS[key] || []).map((t) => t.name),
  }));
}

/**
 * Expose the config loader so routes/tools.js can use the same
 * three-tier cache without duplicating logic.
 *
 * @param {string} locationId
 * @returns {Promise<object>}
 */
async function getToolConfig(locationId) {
  return loadToolConfigs(locationId);
}

/**
 * Save a single integration's config for a location.
 * Writes to Firebase (if enabled) or tokenStore, then updates Redis cache
 * with the full merged config so refreshStatus sees the change immediately.
 */
async function saveToolConfig(locationId, category, configData) {
  const existing = await loadToolConfigs(locationId);
  const merged   = { ...existing, [category]: { ...(existing[category] || {}), ...configData } };

  if (config.isFirebaseEnabled) {
    await firebaseStore.saveToolConfig(locationId, category, configData);
    // Firebase is primary; also populate 1h read cache for fast lookups
    try { await toolTokenService.setCachedToolConfig(locationId, merged); } catch { /* non-fatal */ }
  } else {
    // No Firebase — Redis IS the primary store; use 365-day TTL so keys survive restarts
    try { await toolTokenService.setCachedToolConfig(locationId, merged, 365 * 24 * 3600); } catch { /* non-fatal */ }
    // Also write to tokenStore for local dev / in-memory fallback
    try { await Promise.resolve(tokenStore.saveToolConfig(locationId, merged)); } catch { /* non-fatal */ }
  }
}

module.exports = {
  getTools,
  executeTool,
  getEnabledIntegrations,
  getAllIntegrationsMeta,
  getToolConfig,
  getSharedIntegrations,
  loadToolConfigs,
  loadToolSharing,
  saveToolConfig,
  setIntegrationShared,
};
