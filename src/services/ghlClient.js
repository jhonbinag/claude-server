/**
 * ghlClient.js
 *
 * Handles all GHL API communication:
 *  - Initial OAuth token exchange (auth code → access + refresh tokens)
 *  - Silent token refresh when access token is expired
 *  - Authenticated GHL API requests on behalf of a location
 *  - Rate limit tracking from GHL response headers
 *    (X-RateLimit-Limit-Daily, X-RateLimit-Remaining)
 */

const axios  = require('axios');
const config = require('../config');
const store  = require('./tokenStore');

// ─── Rate Limit Tracker ───────────────────────────────────────────────────────
// In-memory per-location rate limit state.
// Use Redis in production for multi-instance deployments.

const rateLimits = {};

function updateRateLimits(locationId, headers) {
  if (!headers) return;
  const daily     = headers['x-ratelimit-limit-daily'];
  const remaining = headers['x-ratelimit-remaining'];
  if (daily || remaining) {
    rateLimits[locationId] = {
      limitDaily:  daily     ? parseInt(daily, 10)     : null,
      remaining:   remaining ? parseInt(remaining, 10) : null,
      updatedAt:   Date.now(),
    };
  }
}

/**
 * Get the last known rate limit state for a location.
 * @param {string} locationId
 * @returns {{ limitDaily: number, remaining: number, updatedAt: number } | null}
 */
function getRateLimitStatus(locationId) {
  return rateLimits[locationId] || null;
}

// ─── OAuth Token Exchange ─────────────────────────────────────────────────────

/**
 * Exchange a one-time auth code (from the OAuth callback) for tokens.
 * Called once per installation.
 *
 * @param {string} code - Authorization code from GHL redirect
 * @returns {object} Token response from GHL
 */
async function exchangeCodeForTokens(code) {
  const appSettings = require('./appSettings');
  const ghl = await appSettings.getGhlSettings();

  if (!ghl.clientId || !ghl.clientSecret || !ghl.redirectUri) {
    throw new Error('GHL app credentials not configured. Set them in the Admin → App Settings UI.');
  }

  const params = new URLSearchParams({
    client_id:     ghl.clientId,
    client_secret: ghl.clientSecret,
    grant_type:    'authorization_code',
    code,
    redirect_uri:  ghl.redirectUri,
  });

  const response = await axios.post(config.ghl.oauthTokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const data       = response.data;
  const locationId = data.locationId;

  if (!locationId) throw new Error('GHL token response missing locationId');

  store.saveTokens(locationId, {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresIn:    data.expires_in,
    companyId:    data.companyId,
    scope:        data.scope,
    userId:       data.userId || data.user_id,
  });

  console.log(`[GHLClient] Tokens exchanged for location: ${locationId}`);
  return { locationId, ...data };
}

// ─── Agency Location Token ────────────────────────────────────────────────────

/**
 * Generate a location-scoped access token from an agency-level token.
 * Requires oauth.write scope.
 *
 * @param {string} companyId  - Agency company ID
 * @param {string} locationId - Target sub-account location ID
 * @param {string} agencyAccessToken - Valid agency-level access token
 * @returns {object} { access_token, token_type, expires_in, scope }
 */
async function getLocationToken(companyId, locationId, agencyAccessToken) {
  const response = await axios.post(
    `${config.ghl.apiBaseUrl}/oauth/locationToken`,
    { companyId, locationId },
    {
      headers: {
        Authorization:  `Bearer ${agencyAccessToken}`,
        Version:        config.ghl.apiVersion,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

// ─── Installed Locations ──────────────────────────────────────────────────────

/**
 * List all locations that have installed this OAuth app.
 * Requires oauth.readonly scope (agency-level token).
 *
 * @param {string} agencyAccessToken
 * @param {string} companyId
 * @param {object} [queryParams] - { limit, skip, isInstalled }
 * @returns {object} GHL response with installed locations
 */
async function getInstalledLocations(agencyAccessToken, companyId, queryParams = {}) {
  const response = await axios.get(`${config.ghl.apiBaseUrl}/oauth/installedLocations`, {
    headers: {
      Authorization: `Bearer ${agencyAccessToken}`,
      Version:       config.ghl.apiVersion,
    },
    params: { companyId, ...queryParams },
  });
  return response.data;
}

// ─── Token Refresh ────────────────────────────────────────────────────────────

/**
 * Refresh an expired access token using the stored refresh token.
 *
 * @param {string} locationId
 * @returns {string} New access token
 */
async function refreshAccessToken(locationId) {
  const record = await store.getTokenRecord(locationId);
  if (!record || !record.refreshToken) {
    throw new Error(`[GHLClient] No refresh token found for location: ${locationId}`);
  }

  const appSettings = require('./appSettings');
  const ghl = await appSettings.getGhlSettings();

  const params = new URLSearchParams({
    client_id:     ghl.clientId     || config.ghl.clientId,
    client_secret: ghl.clientSecret || config.ghl.clientSecret,
    grant_type:    'refresh_token',
    refresh_token: record.refreshToken,
    redirect_uri:  ghl.redirectUri  || config.ghl.redirectUri,
  });

  const response = await axios.post(config.ghl.oauthTokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const data = response.data;

  store.saveTokens(locationId, {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token || record.refreshToken,
    expiresIn:    data.expires_in,
    companyId:    record.companyId,
    scope:        record.scope,
  });

  console.log(`[GHLClient] Tokens refreshed for location: ${locationId}`);
  return data.access_token;
}

// ─── Get Valid Access Token ───────────────────────────────────────────────────

/**
 * Returns a valid access token for the location.
 * Automatically refreshes if expired.
 *
 * @param {string} locationId
 * @returns {string} Valid access token
 */
async function getValidAccessToken(locationId) {
  if (await store.isTokenExpired(locationId)) {
    console.log(`[GHLClient] Token expired, refreshing for location: ${locationId}`);
    return await refreshAccessToken(locationId);
  }
  const record = await store.getTokenRecord(locationId);
  return record.accessToken;
}

// ─── GHL API Request ──────────────────────────────────────────────────────────

/**
 * Make an authenticated GHL API v2 request on behalf of a location.
 * Automatically handles token refresh on 401 and tracks rate limit headers.
 *
 * @param {string} locationId  - The sub-location ID
 * @param {string} method      - HTTP method (GET, POST, PUT, PATCH, DELETE)
 * @param {string} endpoint    - GHL API path, e.g. '/contacts/'
 * @param {object} [data]      - Request body for POST/PUT/PATCH
 * @param {object} [params]    - Query string params
 * @returns {object}           - GHL API response data
 */
async function ghlRequest(locationId, method, endpoint, data = null, params = null) {
  let accessToken = await getValidAccessToken(locationId);

  const requestConfig = {
    method,
    url: `${config.ghl.apiBaseUrl}${endpoint}`,
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      Version:        config.ghl.apiVersion,
      'Content-Type': 'application/json',
    },
    ...(data   && { data }),
    ...(params && { params }),
  };

  try {
    const response = await axios(requestConfig);
    updateRateLimits(locationId, response.headers);
    return response.data;
  } catch (err) {
    // On 401, try once more with a fresh token
    if (err.response && err.response.status === 401) {
      console.warn(`[GHLClient] 401 received, forcing token refresh for: ${locationId}`);
      accessToken = await refreshAccessToken(locationId);
      requestConfig.headers.Authorization = `Bearer ${accessToken}`;
      const retryResponse = await axios(requestConfig);
      updateRateLimits(locationId, retryResponse.headers);
      return retryResponse.data;
    }

    // Log rate limit context on 429
    if (err.response && err.response.status === 429) {
      const status = getRateLimitStatus(locationId);
      console.error(`[GHLClient] 429 Rate limited for ${locationId}. Status:`, status);
    }

    const status  = err.response?.status;
    const message = err.response?.data?.message || err.message;
    const traceId = err.response?.headers?.['x-request-id'] || err.response?.data?.traceId;
    if (traceId) console.error(`[GHLClient] TraceId: ${traceId}`);
    throw new Error(`GHL API error [${status}]: ${message}`);
  }
}

module.exports = {
  exchangeCodeForTokens,
  getLocationToken,
  getInstalledLocations,
  refreshAccessToken,
  getValidAccessToken,
  getRateLimitStatus,
  ghlRequest,
};
