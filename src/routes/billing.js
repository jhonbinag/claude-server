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

const express        = require('express');
const router         = express.Router();
const authenticate   = require('../middleware/authenticate');
const billing        = require('../services/billingStore');
const planTierStore  = require('../services/planTierStore');

router.use(authenticate);

// ── GET /billing — subscription + invoice summary ─────────────────────────────

router.get('/', async (req, res) => {
  try {
    const rec = await billing.getOrCreateBilling(req.locationId);

    // Mask sensitive fields before sending to client
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

module.exports = router;
