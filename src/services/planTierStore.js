/**
 * src/services/planTierStore.js
 *
 * Plan Tier configuration — global (not per-location).
 * Stored in Firebase Firestore `planTiers/config` document.
 * Falls back to DEFAULT_TIERS when Firebase is unavailable.
 *
 * Tier schema:
 *   {
 *     name:                 'Bronze',
 *     icon:                 '🥉',
 *     integrationLimit:     2,          // -1 = unlimited
 *     allowedIntegrations:  ['perplexity', 'openai'],  // null = all integrations allowed
 *     description:          'Up to 2 integrations',
 *   }
 */

const config = require('../config');

// ── In-memory cache (busted on save) ──────────────────────────────────────────

let _cache = null;

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_TIERS = {
  bronze: {
    name:                'Bronze',
    icon:                '🥉',
    integrationLimit:    2,
    allowedIntegrations: ['perplexity', 'openai'],
    allowedFeatures:     ['ads_generator', 'ad_library', 'social_planner'],
    description:         'Up to 2 integrations — great for getting started.',
    price:               0,
    interval:            'mo',
  },
  silver: {
    name:                'Silver',
    icon:                '🥈',
    integrationLimit:    6,
    allowedIntegrations: ['perplexity', 'openai', 'facebook_ads', 'sendgrid', 'slack', 'apollo'],
    allowedFeatures:     ['funnel_builder', 'website_builder', 'ads_generator', 'social_planner', 'email_builder', 'ad_library', 'campaign_builder'],
    description:         'Up to 6 integrations — ideal for growing teams.',
    price:               49,
    interval:            'mo',
  },
  gold: {
    name:                'Gold',
    icon:                '🥇',
    integrationLimit:    10,
    allowedIntegrations: ['perplexity', 'openai', 'facebook_ads', 'sendgrid', 'slack', 'apollo', 'heygen', 'hubspot', 'keap', 'manychat', 'google_calendar', 'airtable', 'monday', 'typeform', 'asana', 'openrouter', 'shopify', 'social_facebook', 'social_instagram', 'social_tiktok_organic', 'social_youtube', 'social_linkedin_organic', 'social_pinterest'],
    allowedFeatures:     ['funnel_builder', 'website_builder', 'ads_generator', 'social_planner', 'email_builder', 'ad_library', 'campaign_builder', 'agents', 'ghl_agent', 'workflows', 'manychat', 'settings'],
    description:         'Up to 10 integrations — full toolkit access.',
    price:               99,
    interval:            'mo',
  },
  diamond: {
    name:                'Diamond',
    icon:                '💎',
    integrationLimit:    -1,
    allowedIntegrations: null,
    allowedFeatures:     null,
    description:         'Unlimited integrations — everything, no limits.',
    price:               199,
    interval:            'mo',
  },
};

// ── Firebase helpers ───────────────────────────────────────────────────────────

async function fbGet() {
  if (!config.isFirebaseEnabled) return null;
  try {
    const { getFirestore } = require('firebase-admin/firestore');
    const doc = await getFirestore().collection('planTiers').doc('config').get();
    return doc.exists ? doc.data() : null;
  } catch { return null; }
}

async function fbSet(data) {
  if (!config.isFirebaseEnabled) return;
  try {
    const { getFirestore } = require('firebase-admin/firestore');
    await getFirestore().collection('planTiers').doc('config').set(data, { merge: true });
  } catch (err) {
    console.error('[PlanTierStore] Firebase write failed:', err.message);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Get all tier configs (merged defaults + saved overrides).
 */
async function getTiers() {
  if (_cache) return _cache;
  const saved = await fbGet();
  _cache = saved
    ? Object.fromEntries(
        Object.entries(DEFAULT_TIERS).map(([k, def]) => [k, { ...def, ...(saved[k] || {}) }])
      )
    : { ...DEFAULT_TIERS };
  return _cache;
}

/**
 * Get a single tier by key.
 */
async function getTier(tierKey) {
  const tiers = await getTiers();
  return tiers[tierKey] || null;
}

/**
 * Save one tier's config. Partial update — only provided fields are overwritten.
 */
async function saveTier(tierKey, updates) {
  const current = await getTiers();
  const merged  = { ...current, [tierKey]: { ...(current[tierKey] || {}), ...updates } };
  _cache = merged;
  await fbSet({ [tierKey]: merged[tierKey] });
  return merged[tierKey];
}

/**
 * Check if a location (given its tier key) can connect a specific integration.
 *
 * @param {string}   tierKey                 e.g. 'bronze' | 'silver' | 'gold' | 'diamond'
 * @param {string}   integrationCategory     e.g. 'openai'
 * @param {number}   currentEnabledCount     how many integrations are already enabled
 * @returns {{ allowed: boolean, reason: string|null }}
 */
async function checkTierAccess(tierKey, integrationCategory, currentEnabledCount) {
  const tier = tierKey ? await getTier(tierKey) : await getTier('bronze');
  if (!tier) return { allowed: true, reason: null }; // unknown tier → allow

  // Diamond / unlimited
  if (tier.integrationLimit === -1 && tier.allowedIntegrations === null) {
    return { allowed: true, reason: null };
  }

  // Check if this specific integration is whitelisted for the tier
  if (Array.isArray(tier.allowedIntegrations) && !tier.allowedIntegrations.includes(integrationCategory)) {
    return {
      allowed: false,
      reason:  `${integrationCategory} is not available on the ${tier.name} plan. Upgrade to unlock it.`,
    };
  }

  // Check integration count limit
  if (tier.integrationLimit !== -1 && currentEnabledCount >= tier.integrationLimit) {
    return {
      allowed: false,
      reason:  `Your ${tier.name} plan allows up to ${tier.integrationLimit} integration${tier.integrationLimit !== 1 ? 's' : ''}. You've reached the limit. Upgrade to add more.`,
    };
  }

  return { allowed: true, reason: null };
}

module.exports = { getTiers, getTier, saveTier, checkTierAccess, DEFAULT_TIERS };
