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
  // Tier 1: Redis 1-hour cache (fastest)
  try {
    const cached = await toolTokenService.getCachedToolConfig(locationId);
    if (cached !== null) return cached;
  } catch { /* cache unavailable — continue to next tier */ }

  let configs = {};

  // Tier 2: Firebase Firestore (source of truth when enabled)
  if (config.isFirebaseEnabled) {
    try {
      configs = await firebaseStore.getToolConfig(locationId);
    } catch (err) {
      console.error(`[ToolRegistry] Firebase read failed for ${locationId}:`, err.message);
    }
  }

  // Tier 3: tokenStore fallback (dev / no-Firebase mode)
  if (!config.isFirebaseEnabled || Object.keys(configs).length === 0) {
    try {
      const fallback = await Promise.resolve(tokenStore.getToolConfig(locationId));
      if (Object.keys(configs).length === 0) configs = fallback;
    } catch { /* ignore */ }
  }

  // Populate cache so next request skips Firebase
  try {
    await toolTokenService.setCachedToolConfig(locationId, configs);
  } catch { /* cache write failure is non-fatal */ }

  return configs;
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
async function getTools(locationId, allowedCategories = null) {
  const ghlTools    = getGhlDefs();
  const toolConfigs = await loadToolConfigs(locationId);
  const external    = [];

  for (const [category, defs] of Object.entries(EXTERNAL_TOOL_DEFINITIONS)) {
    if (allowedCategories !== null && !allowedCategories.includes(category)) continue;
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
async function getEnabledIntegrations(locationId) {
  const toolConfigs = await loadToolConfigs(locationId);
  return Object.keys(toolConfigs).filter(
    (k) => toolConfigs[k] && Object.keys(toolConfigs[k]).length > 0,
  );
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
 * Writes to Firebase (if enabled) or tokenStore, then invalidates Redis cache.
 */
async function saveToolConfig(locationId, category, configData) {
  const existing = await loadToolConfigs(locationId);
  const merged   = { ...existing, [category]: { ...(existing[category] || {}), ...configData } };

  if (config.isFirebaseEnabled) {
    await firebaseStore.saveToolConfig(locationId, category, configData);
    // Invalidate cache so next read picks up from Firebase
    try { await toolTokenService.invalidateToolConfigCache(locationId); } catch { /* non-fatal */ }
  } else {
    // No Firebase — persist directly to Redis with 90-day TTL (acts as primary store)
    try { await toolTokenService.setCachedToolConfig(locationId, merged, 90 * 24 * 3600); } catch { /* non-fatal */ }
    // Also write to tokenStore for local dev
    try { await Promise.resolve(tokenStore.saveToolConfig(locationId, merged)); } catch { /* non-fatal */ }
  }
}

module.exports = {
  getTools,
  executeTool,
  getEnabledIntegrations,
  getAllIntegrationsMeta,
  getToolConfig,
  loadToolConfigs,
  saveToolConfig,
};
