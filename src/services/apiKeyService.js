/**
 * apiKeyService.js
 *
 * Manages the app's own private API keys issued per location.
 * These keys are separate from GHL tokens — they authenticate
 * inbound requests to THIS app's endpoints.
 *
 * Key format:  hlpt_{locationId_prefix}_{32-char random hex}
 * Example:     hlpt_abc123_f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c5
 */

const crypto = require('crypto');
const store  = require('./tokenStore');

/**
 * Generate a new private API key for a location and persist it.
 *
 * @param {string} locationId
 * @returns {string} The generated API key
 */
async function generateApiKey(locationId) {
  const prefix = locationId.slice(0, 6);
  const secret = crypto.randomBytes(32).toString('hex');
  const apiKey = `hlpt_${prefix}_${secret}`;

  await store.saveApiKey(locationId, apiKey);
  console.log(`[ApiKeyService] API key generated for location: ${locationId}`);
  return apiKey;
}

/**
 * Validate an API key and return the associated locationId.
 * Returns null if the key is not found.
 *
 * @param {string} apiKey
 * @returns {string|null} locationId or null
 */
async function validateApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return null;
  if (!apiKey.startsWith('hlpt_')) return null;
  return store.findLocationByApiKey(apiKey);
}

/**
 * Rotate the API key for a location (invalidates old key).
 *
 * @param {string} locationId
 * @returns {string} New API key
 */
async function rotateApiKey(locationId) {
  const existing = await store.getApiKey(locationId);
  if (!existing) throw new Error(`No API key found for location: ${locationId}`);

  const newKey = await generateApiKey(locationId);
  console.log(`[ApiKeyService] API key rotated for location: ${locationId}`);
  return newKey;
}

/**
 * Get the current API key for a location.
 *
 * @param {string} locationId
 * @returns {Promise<string|null>}
 */
async function getApiKey(locationId) {
  return store.getApiKey(locationId);
}

module.exports = {
  generateApiKey,
  validateApiKey,
  rotateApiKey,
  getApiKey,
};
