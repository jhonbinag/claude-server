/**
 * billingService.js
 *
 * Handles GHL External Billing integration.
 *
 * When your Marketplace App is marked as "Paid" with External Billing enabled,
 * GHL redirects installing users to your Billing URL with:
 *   { clientId, installType, locationId?, companyId? }
 *
 * After collecting payment on your side, you MUST call GHL's billing webhook
 * to confirm payment and allow the installation to complete.
 *
 * GHL Billing Webhook: POST https://services.leadconnectorhq.com/oauth/billing/webhook
 * Auth headers: x-ghl-client-key + x-ghl-client-secret
 *
 * Important: Call separately per location/company — no bulk calls.
 */

const axios  = require('axios');
const config = require('../config');

const GHL_BILLING_WEBHOOK_URL = 'https://services.leadconnectorhq.com/oauth/billing/webhook';

/**
 * Notify GHL that payment was completed for a location installation.
 *
 * @param {object} options
 * @param {string} options.locationId     - Sub-account location ID
 * @param {string} options.companyId      - Agency company ID
 * @param {string} options.installType    - 'location' | 'agency' | 'both'
 * @param {'one-time'|'recurring'} options.paymentType
 * @param {number} options.amount         - Amount billed (in cents or units)
 * @param {string} [options.subscriptionId] - For recurring payments
 * @param {string} [options.paymentId]      - For one-time payments
 * @returns {object} GHL billing webhook response
 */
async function confirmPayment({ locationId, companyId, installType, paymentType, amount, subscriptionId, paymentId }) {
  const body = {
    clientId:    config.ghl.clientId,
    installType,
    status:      'COMPLETED',
    amount,
    paymentType,
    ...(locationId     && { locationId }),
    ...(companyId      && { companyId }),
    ...(subscriptionId && { subscriptionId }),
    ...(paymentId      && { paymentId }),
  };

  const response = await axios.post(GHL_BILLING_WEBHOOK_URL, body, {
    headers: {
      'x-ghl-client-key':    config.ghl.clientId,
      'x-ghl-client-secret': config.ghl.clientSecret,
      'Content-Type':        'application/json',
    },
  });

  console.log(`[BillingService] Payment confirmed for ${locationId || companyId}: COMPLETED`);
  return response.data;
}

/**
 * Notify GHL that payment FAILED for a location installation.
 *
 * @param {object} options
 * @param {string} options.locationId
 * @param {string} options.companyId
 * @param {string} options.installType
 * @param {string} [options.reason] - Reason for failure
 */
async function reportPaymentFailed({ locationId, companyId, installType, reason }) {
  const body = {
    clientId:    config.ghl.clientId,
    installType,
    status:      'FAILED',
    amount:      0,
    ...(locationId && { locationId }),
    ...(companyId  && { companyId }),
    ...(reason     && { reason }),
  };

  const response = await axios.post(GHL_BILLING_WEBHOOK_URL, body, {
    headers: {
      'x-ghl-client-key':    config.ghl.clientId,
      'x-ghl-client-secret': config.ghl.clientSecret,
      'Content-Type':        'application/json',
    },
  });

  console.log(`[BillingService] Payment failure reported for ${locationId || companyId}`);
  return response.data;
}

module.exports = { confirmPayment, reportPaymentFailed };
