/**
 * src/routes/billing.js
 *
 * User-facing billing endpoints. Mounts at /billing.
 * Requires standard x-location-id authentication.
 *
 * Endpoints:
 *   GET  /billing              → get subscription + invoices for this location
 *   POST /billing/checkout     → create Stripe Checkout session (Stripe only)
 *   GET  /billing/checkout/ok  → Stripe redirect after successful checkout
 */

const express           = require('express');
const router            = express.Router();
const authenticate      = require('../middleware/authenticate');
const billing           = require('../services/billingStore');
const planTierStore     = require('../services/planTierStore');
const toolTokenService  = require('../services/toolTokenService');
const firebaseSvc       = require('../services/firebaseStore');

router.use(authenticate);

const PAYMENT_HUB_KEYS = ['stripe', 'paypal', 'square', 'authorizenet'];

async function getConnectedPaymentProviders(locationId) {
  try {
    let cfg = await toolTokenService.getCachedToolConfig(locationId) || {};
    if (!Object.keys(cfg).length && firebaseSvc.isEnabled()) {
      cfg = await firebaseSvc.getToolConfig(locationId) || {};
    }
    return PAYMENT_HUB_KEYS.filter(key => {
      const c = cfg[key];
      return c && Object.values(c).some(v => v && String(v).trim());
    });
  } catch {
    return [];
  }
}

// ── GET /billing — subscription + invoice summary ─────────────────────────────

router.get('/', async (req, res) => {
  try {
    const rec = await billing.getOrCreateBilling(req.locationId);

    // Mask sensitive fields before sending to client
    const connectedPaymentProviders = await getConnectedPaymentProviders(req.locationId);

    const safe = {
      plan:             rec.plan,
      tier:             rec.tier || 'bronze',
      status:           rec.status,
      amount:           rec.amount,
      currency:         rec.currency,
      interval:         rec.interval,
      trialEnd:         rec.trialEnd,
      currentPeriodEnd: rec.currentPeriodEnd,
      paymentMethod:    rec.paymentMethod
        ? { brand: rec.paymentMethod.brand, last4: rec.paymentMethod.last4, expiry: rec.paymentMethod.expiry }
        : null,
      invoices:    (rec.invoices || []).slice(0, 50),
      stripeEnabled: !!process.env.STRIPE_SECRET_KEY,
      connectedPaymentProviders,
    };

    res.json({ success: true, data: safe });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /billing/checkout — create Stripe Checkout session ──────────────────
// Returns { url } to redirect user to Stripe's hosted payment page.

router.post('/checkout', async (req, res) => {
  const stripe = billing.getStripe();
  if (!stripe) {
    return res.status(400).json({ success: false, error: 'Stripe is not configured. Contact support to upgrade your plan.' });
  }

  const { plan = 'pro', successUrl, cancelUrl } = req.body;
  const plans = billing.PLANS;
  if (!plans[plan] || plan === 'trial') {
    return res.status(400).json({ success: false, error: 'Invalid plan selected.' });
  }

  try {
    const rec = await billing.getOrCreateBilling(req.locationId);

    // Get or create Stripe customer
    let customerId = rec.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { locationId: req.locationId },
      });
      customerId = customer.id;
      await billing.updateSubscription(req.locationId, { stripeCustomerId: customerId });
    }

    const origin = process.env.APP_URL || 'https://claudeserver.vercel.app';
    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      mode:       'subscription',
      line_items: [{
        price_data: {
          currency:     'usd',
          unit_amount:  plans[plan].amount * 100,
          recurring:    { interval: 'month' },
          product_data: { name: `HL Pro Tools — ${plans[plan].name}` },
        },
        quantity: 1,
      }],
      success_url: successUrl || `${origin}/billing/checkout/ok?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancelUrl  || `${origin}/ui/settings`,
      metadata:    { locationId: req.locationId, plan },
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /billing/checkout/ok — post-checkout landing ─────────────────────────
// Stripe redirects here after success. Activate the subscription.

router.get('/checkout/ok', async (req, res) => {
  const stripe = billing.getStripe();
  const { session_id } = req.query;
  if (!stripe || !session_id) {
    return res.redirect('/ui/settings?billing=ok');
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription', 'subscription.default_payment_method'],
    });

    const locationId = session.metadata?.locationId;
    const plan       = session.metadata?.plan || 'pro';
    const sub        = session.subscription;

    if (locationId && sub) {
      const pm = sub.default_payment_method?.card;
      await billing.updateSubscription(locationId, {
        plan,
        status:           sub.status === 'active' ? 'active' : sub.status,
        stripeSubId:      sub.id,
        currentPeriodEnd: sub.current_period_end * 1000,
        paymentMethod:    pm ? { brand: pm.brand, last4: pm.last4, expiry: `${pm.exp_month}/${String(pm.exp_year).slice(-2)}` } : null,
      });

      await billing.createInvoice(locationId, {
        amount:      billing.PLANS[plan]?.amount || 0,
        description: `${billing.PLANS[plan]?.name || plan} Plan`,
        status:      'paid',
        stripeInvoiceId: sub.latest_invoice || null,
      });
    }
  } catch { /* non-fatal — redirect anyway */ }

  res.redirect('/ui/settings?billing=ok');
});

// ── GET /billing/tiers — all tier configs (for user upgrade modal) ────────────

router.get('/tiers', async (req, res) => {
  try {
    const tiers = await planTierStore.getTiers();
    res.json({ success: true, data: tiers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /billing/upgrade-tier — self-service tier selection ──────────────────

const VALID_TIERS = ['bronze', 'silver', 'gold', 'diamond'];

router.post('/upgrade-tier', async (req, res) => {
  const { tier } = req.body;
  if (!tier || !VALID_TIERS.includes(tier)) {
    return res.status(400).json({ success: false, error: `Invalid tier. Valid: ${VALID_TIERS.join(', ')}` });
  }
  try {
    const rec = await billing.getOrCreateBilling(req.locationId);
    await billing.updateSubscription(req.locationId, { ...rec, tier });
    res.json({ success: true, tier });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /billing/downgrade-tier — self-service tier downgrade ───────────────

router.post('/downgrade-tier', async (req, res) => {
  const { tier } = req.body;
  if (!tier || !VALID_TIERS.includes(tier)) {
    return res.status(400).json({ success: false, error: `Invalid tier. Valid: ${VALID_TIERS.join(', ')}` });
  }
  try {
    const rec = await billing.getOrCreateBilling(req.locationId);
    const currentIdx  = VALID_TIERS.indexOf(rec.tier || 'bronze');
    const requestedIdx = VALID_TIERS.indexOf(tier);
    if (requestedIdx >= currentIdx) {
      return res.status(400).json({ success: false, error: 'Use /billing/upgrade-tier for upgrades.' });
    }
    await billing.updateSubscription(req.locationId, { ...rec, tier });
    // Create a note invoice for the downgrade record
    await billing.createInvoice(req.locationId, {
      amount:      0,
      description: `Downgraded to ${tier} tier`,
      status:      'void',
    });
    res.json({ success: true, tier });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /billing/create-upgrade-invoice — GHL Marketplace payment ────────────
// If tier has a linked GHL product, creates a GHL Invoice and returns payment URL.
// If no GHL product is linked, returns { useCardForm: true } to fall back to card form.

router.post('/create-upgrade-invoice', async (req, res) => {
  const { tier } = req.body;
  if (!tier || !VALID_TIERS.includes(tier)) {
    return res.status(400).json({ success: false, error: 'Invalid tier.' });
  }

  try {
    const tierConfig = await planTierStore.getTier(tier);

    // No GHL product linked — fall back to card form
    if (!tierConfig?.ghlProductId || !tierConfig?.ghlPriceId) {
      return res.json({ success: true, useCardForm: true });
    }

    // Create GHL Invoice via Marketplace OAuth token
    const invoiceData = {
      altId:    req.locationId,
      altType:  'location',
      name:     `${tierConfig.name} Plan — HL Pro Tools`,
      currency: 'USD',
      status:   'draft',
      lineItems: [{
        name:       `${tierConfig.name} Integration Tier`,
        qty:        1,
        unitAmt:    Math.round((tierConfig.price || 0) * 100),
        productId:  tierConfig.ghlProductId,
        priceId:    tierConfig.ghlPriceId,
      }],
    };

    const invoice = await req.ghl('POST', '/invoices/', invoiceData);

    // Send the invoice so the payment link becomes live
    const invoiceId = invoice?.invoice?.id || invoice?.id;
    if (invoiceId) {
      try {
        await req.ghl('POST', `/invoices/${invoiceId}/send`, {
          action: 'sms_and_email',
        });
      } catch { /* non-fatal — payment URL still works */ }
    }

    const paymentUrl =
      invoice?.invoice?.liveMode?.paymentUrl ||
      invoice?.invoice?.paymentUrl ||
      invoice?.paymentUrl ||
      null;

    if (!paymentUrl) {
      // GHL invoice created but no URL — fall back to card form
      return res.json({ success: true, useCardForm: true, invoiceId });
    }

    res.json({ success: true, paymentUrl, invoiceId });
  } catch (err) {
    // If GHL API fails, fall back gracefully
    console.error('[billing] create-upgrade-invoice error:', err.message);
    res.json({ success: true, useCardForm: true });
  }
});

module.exports = router;
