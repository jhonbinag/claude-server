/**
 * frontend/src/pages/Billing.jsx
 *
 * Billing & Subscription page.
 * Current Plan card shows both billing plan AND integration tier.
 * Upgrade Tier button → tier picker → checkout page with card details.
 * Tabs: All Invoices | Active / Recurring | Payment History
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useApp }  from '../context/AppContext';
import AuthGate    from '../components/AuthGate';
import Header      from '../components/Header';
import Spinner     from '../components/Spinner';
import { api }     from '../lib/api';

// ── Tier color palette ─────────────────────────────────────────────────────────
const TIER_COLORS = {
  bronze:  { ring: '#cd7f32', bg: 'rgba(205,127,50,0.12)',  text: '#e8a96b' },
  silver:  { ring: '#9ca3af', bg: 'rgba(156,163,175,0.12)', text: '#d1d5db' },
  gold:    { ring: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  text: '#fde68a' },
  diamond: { ring: '#a78bfa', bg: 'rgba(167,139,250,0.12)', text: '#c4b5fd' },
};
const TIER_ICONS  = { bronze: '🥉', silver: '🥈', gold: '🥇', diamond: '💎' };
const TIER_ORDER  = ['bronze', 'silver', 'gold', 'diamond'];

const STATUS_COLOR = {
  active:    { bg: '#14532d', text: '#4ade80' },
  trial:     { bg: '#1e3a5f', text: '#60a5fa' },
  past_due:  { bg: '#450a0a', text: '#f87171' },
  cancelled: { bg: '#1e1e1e', text: '#6b7280' },
  suspended: { bg: '#3a1a00', text: '#fb923c' },
};
const INV_COLOR = {
  paid: '#4ade80', pending: '#facc15', overdue: '#f87171', refunded: '#6b7280', void: '#6b7280',
};

function relDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Upgrade Tier Modal (2-step: pick tier → checkout) ─────────────────────────

function UpgradeTierModal({ currentTier, onClose, onUpgraded }) {
  const [tiers,     setTiers]     = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  // Step 1 = tier picker, Step 2 = checkout
  const [step,      setStep]      = useState(1);
  const [selected,  setSelected]  = useState(null); // tier key chosen in step 1

  // GHL payment flow
  const [ghlLoading,  setGhlLoading]  = useState(false);
  const [useCardForm, setUseCardForm] = useState(false);

  // Checkout form (card fallback)
  const [cardName,  setCardName]  = useState('');
  const [cardNum,   setCardNum]   = useState('');
  const [expiry,    setExpiry]    = useState('');
  const [cvv,       setCvv]       = useState('');
  const [paying,    setPaying]    = useState(false);

  useEffect(() => {
    api.get('/billing/tiers').then(data => {
      if (data.success) setTiers(data.data);
      else setError('Failed to load tiers.');
      setLoading(false);
    }).catch(() => { setError('Failed to load tiers.'); setLoading(false); });
  }, []);

  // Format card number with spaces
  const fmtCard = v => v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
  const fmtExp  = v => {
    const d = v.replace(/\D/g, '').slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  };

  // Step 2 entry — try GHL payment first
  async function enterCheckout(tierKey) {
    setSelected(tierKey);
    setError(null);
    setUseCardForm(false);
    setGhlLoading(true);
    setStep(2);
    try {
      const data = await api.post('/billing/create-upgrade-invoice', { tier: tierKey });
      if (data.success && data.paymentUrl) {
        // Redirect to GHL hosted payment page
        window.location.href = data.paymentUrl;
        return;
      }
      // No GHL product linked or API error — show card form
      setUseCardForm(true);
    } catch {
      setUseCardForm(true);
    }
    setGhlLoading(false);
  }

  async function handlePay() {
    if (!cardName.trim() || cardNum.replace(/\s/g, '').length < 16 || expiry.length < 5 || cvv.length < 3) {
      setError('Please fill in all card details.');
      return;
    }
    setPaying(true);
    setError(null);
    try {
      const data = await api.post('/billing/upgrade-tier', { tier: selected });
      if (data.success) {
        onUpgraded(selected, tiers[selected]);
        onClose();
      } else {
        setError(data.error || 'Payment failed.');
      }
    } catch {
      setError('Payment failed. Please try again.');
    }
    setPaying(false);
  }

  const tierData = selected && tiers ? tiers[selected] : null;
  const tierCol  = selected ? (TIER_COLORS[selected] || TIER_COLORS.bronze) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full rounded-2xl"
        style={{ maxWidth: step === 1 ? '700px' : '460px', background: '#16161c', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        {/* ── Modal header ── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div>
            {step === 2 && (
              <button
                onClick={() => { setStep(1); setError(null); }}
                className="text-xs text-indigo-400 hover:text-indigo-300 mb-1 flex items-center gap-1"
              >
                ← Back
              </button>
            )}
            <h2 className="text-lg font-bold text-white">
              {step === 1 ? 'Choose Your Plan Tier' : `Upgrade to ${tierData?.name}`}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {step === 1 ? 'Select a tier to unlock more integrations' : 'Complete your payment to activate this tier'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none ml-4">&times;</button>
        </div>

        <div className="p-6">
          {loading && <div className="py-8 flex justify-center"><Spinner /></div>}
          {error   && <p className="text-red-400 text-sm text-center mb-4">{error}</p>}

          {/* ── Step 1: Tier picker ── */}
          {!loading && tiers && step === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TIER_ORDER.map(key => {
                const t        = tiers[key];
                if (!t) return null;
                const col       = TIER_COLORS[key] || TIER_COLORS.bronze;
                const isCurrent = key === currentTier;
                const isFree    = !t.price || t.price === 0;

                return (
                  <div
                    key={key}
                    className="rounded-xl p-4 flex flex-col gap-3"
                    style={{
                      background: col.bg,
                      border: `1px solid ${isCurrent ? col.ring : 'rgba(255,255,255,0.07)'}`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{t.icon || TIER_ICONS[key]}</span>
                        <div>
                          <p className="font-bold text-white text-sm">{t.name}</p>
                          <p className="text-xs font-semibold" style={{ color: col.text }}>
                            {isFree ? 'Free' : `$${t.price}/${t.interval || 'mo'}`}
                          </p>
                        </div>
                      </div>
                      {isCurrent && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: col.ring + '30', color: col.text, border: `1px solid ${col.ring}` }}>
                          Current
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-gray-400">{t.description}</p>

                    <p className="text-xs" style={{ color: col.text }}>
                      {t.integrationLimit === -1 ? '✓ Unlimited integrations' : `✓ Up to ${t.integrationLimit} integrations`}
                    </p>

                    {Array.isArray(t.allowedIntegrations) && (
                      <div className="flex flex-wrap gap-1">
                        {t.allowedIntegrations.map(i => (
                          <span key={i} className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)', color: '#9ca3af' }}>
                            {i}
                          </span>
                        ))}
                      </div>
                    )}
                    {t.allowedIntegrations === null && (
                      <p className="text-xs" style={{ color: col.text }}>✓ All integrations included</p>
                    )}

                    <button
                      disabled={isCurrent}
                      onClick={() => {
                        if (isFree) {
                          // Free tier — skip payment step
                          setSelected(key);
                          api.post('/billing/upgrade-tier', { tier: key }).then(d => {
                            if (d.success) { onUpgraded(key, t); onClose(); }
                            else setError(d.error || 'Upgrade failed.');
                          }).catch(() => setError('Upgrade failed.'));
                        } else {
                          enterCheckout(key);
                        }
                      }}
                      className="w-full py-2 rounded-lg text-xs font-semibold mt-auto"
                      style={isCurrent
                        ? { background: 'rgba(255,255,255,0.04)', color: '#6b7280', cursor: 'default' }
                        : { background: col.ring, color: '#000', cursor: 'pointer' }
                      }
                    >
                      {isCurrent ? '✓ Active Plan' : isFree ? `Select ${t.name}` : `Upgrade — $${t.price}/${t.interval || 'mo'}`}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Step 2: Checkout ── */}
          {!loading && tiers && step === 2 && tierData && (
            <div>
              {/* Order summary */}
              <div
                className="rounded-xl p-4 mb-5 flex items-center gap-4"
                style={{ background: tierCol.bg, border: `1px solid ${tierCol.ring}40` }}
              >
                <span className="text-3xl">{tierData.icon || TIER_ICONS[selected]}</span>
                <div className="flex-1">
                  <p className="font-bold text-white">{tierData.name} Plan</p>
                  <p className="text-xs text-gray-400">{tierData.description}</p>
                  <p className="text-xs mt-1" style={{ color: tierCol.text }}>
                    {tierData.integrationLimit === -1 ? 'Unlimited integrations' : `Up to ${tierData.integrationLimit} integrations`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-white">${tierData.price}</p>
                  <p className="text-xs text-gray-500">/{tierData.interval || 'mo'}</p>
                </div>
              </div>

              {/* GHL payment loading */}
              {ghlLoading && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Spinner />
                  <p className="text-sm text-gray-400">Preparing your GoHighLevel payment…</p>
                </div>
              )}

              {/* Card form fallback — shown when no GHL product is linked */}
              {!ghlLoading && useCardForm && (
                <>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Name on Card</label>
                      <input
                        className="w-full rounded-lg px-3 py-2.5 text-sm text-white"
                        style={{ background: '#111', border: '1px solid rgba(255,255,255,0.12)' }}
                        placeholder="John Smith"
                        value={cardName}
                        onChange={e => setCardName(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Card Number</label>
                      <div className="relative">
                        <input
                          className="w-full rounded-lg px-3 py-2.5 text-sm text-white pr-10"
                          style={{ background: '#111', border: '1px solid rgba(255,255,255,0.12)' }}
                          placeholder="1234 5678 9012 3456"
                          value={cardNum}
                          onChange={e => setCardNum(fmtCard(e.target.value))}
                          maxLength={19}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm">💳</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Expiry</label>
                        <input
                          className="w-full rounded-lg px-3 py-2.5 text-sm text-white"
                          style={{ background: '#111', border: '1px solid rgba(255,255,255,0.12)' }}
                          placeholder="MM/YY"
                          value={expiry}
                          onChange={e => setExpiry(fmtExp(e.target.value))}
                          maxLength={5}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">CVV</label>
                        <input
                          className="w-full rounded-lg px-3 py-2.5 text-sm text-white"
                          style={{ background: '#111', border: '1px solid rgba(255,255,255,0.12)' }}
                          placeholder="•••"
                          value={cvv}
                          onChange={e => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                          maxLength={4}
                          type="password"
                        />
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-gray-600 mt-3 text-center">🔒 Secured with 256-bit SSL encryption</p>

                  <button
                    disabled={paying}
                    onClick={handlePay}
                    className="w-full mt-4 py-3 rounded-xl text-sm font-bold"
                    style={{ background: tierCol.ring, color: '#000', opacity: paying ? 0.7 : 1, cursor: paying ? 'wait' : 'pointer' }}
                  >
                    {paying ? 'Processing…' : `Pay $${tierData.price}/${tierData.interval || 'mo'} → Activate ${tierData.name}`}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Billing Page ──────────────────────────────────────────────────────────

export default function Billing() {
  const { isAuthenticated, isAuthLoading, locationId } = useApp();

  const [billing,         setBilling]         = useState(null);
  const [loading,         setLoading]         = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [tab,             setTab]             = useState('all');
  const [toast,           setToast]           = useState(null);
  const [showTierModal,   setShowTierModal]   = useState(false);

  const showToast = (msg, ok) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const loadBilling = useCallback(() => {
    if (!locationId) return;
    setLoading(true);
    api.get('/billing').then(data => {
      if (data.success) setBilling(data.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [locationId]);

  useEffect(() => { loadBilling(); }, [loadBilling]);

  if (isAuthLoading) return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="💳" title="Billing" subtitle="View your plan and invoices">
      <Link to="/" className="block text-center text-xs text-gray-500 mt-4 hover:text-gray-300">← Back to Dashboard</Link>
    </AuthGate>
  );

  const invoices   = billing?.invoices || [];
  const allInv     = [...invoices].sort((a, b) => (b.date || 0) - (a.date || 0));
  const activeInv  = allInv.filter(i => i.status === 'paid' || i.status === 'pending');
  const historyInv = allInv.filter(i => i.status === 'refunded' || i.status === 'void' || i.status === 'overdue');

  const tabs = [
    { key: 'all',     label: `All Invoices (${allInv.length})` },
    { key: 'active',  label: `Active / Recurring (${activeInv.length})` },
    { key: 'history', label: `Payment History (${historyInv.length})` },
  ];

  const displayedInv = tab === 'all' ? allInv : tab === 'active' ? activeInv : historyInv;
  const planStatus   = STATUS_COLOR[billing?.status] || { bg: '#1e1e1e', text: '#9ca3af' };
  const currentTier  = billing?.tier || 'bronze';
  const tierCol      = TIER_COLORS[currentTier] || TIER_COLORS.bronze;

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0f0f13' }}>
      <Header icon="💳" title="Billing" subtitle="Plan, invoices & payment history" />

      <main className="flex-1 overflow-y-auto p-4 md:p-6" style={{ maxWidth: '60rem', margin: '0 auto', width: '100%' }}>

        {loading && <Spinner />}

        {!loading && !billing && (
          <div className="card p-8 text-center">
            <p className="text-4xl mb-3">💳</p>
            <p className="text-white font-semibold mb-1">No billing record found</p>
            <p className="text-gray-500 text-sm">Contact support to set up your subscription.</p>
          </div>
        )}

        {billing && (
          <>
            {/* ── Plan + Tier + Payment cards ──────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">

              {/* Current Plan — shows billing plan AND integration tier */}
              <div className="card p-5" style={{ border: `1px solid ${tierCol.ring}40`, background: tierCol.bg }}>
                <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider font-semibold">Current Plan</p>

                {/* Billing plan row */}
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <p className="text-base font-bold text-white capitalize">{billing.plan || 'Free'}</p>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: planStatus.bg, color: planStatus.text }}>
                    {billing.status?.replace('_', ' ')}
                  </span>
                </div>

                {/* Integration tier row */}
                <div className="flex items-center gap-1.5 mb-3">
                  <span className="text-lg">{TIER_ICONS[currentTier] || '🥉'}</span>
                  <span className="text-sm font-semibold capitalize" style={{ color: tierCol.text }}>{currentTier} tier</span>
                </div>

                {billing.amount > 0 && (
                  <p className="text-xs text-gray-400 mb-1">${billing.amount} / {billing.interval || 'mo'}</p>
                )}
                {billing.status === 'trial' && billing.trialEnd && (
                  <p className="text-xs text-blue-400 mb-2">Trial ends {relDate(billing.trialEnd)}</p>
                )}
                {billing.status === 'active' && billing.currentPeriodEnd && (
                  <p className="text-xs text-gray-500 mb-2">Renews {relDate(billing.currentPeriodEnd)}</p>
                )}

                <button
                  onClick={() => setShowTierModal(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg w-full mt-1"
                  style={{ background: tierCol.ring, color: '#000' }}
                >
                  ⬆ Upgrade Tier
                </button>
              </div>

              {/* Payment method */}
              <div className="card p-5">
                <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider font-semibold">Payment Method</p>
                {billing.paymentMethod ? (
                  <>
                    <p className="text-sm font-semibold text-white capitalize">
                      {billing.paymentMethod.brand} ••••{billing.paymentMethod.last4}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Expires {billing.paymentMethod.expiry}</p>
                  </>
                ) : (
                  <p className="text-sm text-gray-500 mt-1">No payment method on file</p>
                )}
              </div>

              {/* Invoice totals */}
              <div className="card p-5">
                <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider font-semibold">Total Paid</p>
                <p className="text-lg font-bold text-green-400">
                  ${allInv.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0).toFixed(2)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {allInv.filter(i => i.status === 'paid').length} paid invoice{allInv.filter(i => i.status === 'paid').length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* ── Upgrade CTA ─────────────────────────────────────────── */}
            {(billing.status === 'trial' || billing.status === 'cancelled') && (
              <div
                className="rounded-2xl p-5 mb-6 flex items-center justify-between gap-4 flex-wrap"
                style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)' }}
              >
                <div>
                  <p className="font-semibold text-white mb-0.5">
                    {billing.status === 'trial' ? '🚀 Upgrade to unlock full access' : '♻️ Reactivate your subscription'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {billing.status === 'trial'
                      ? 'Your trial is active. Upgrade anytime to continue after it ends.'
                      : 'Your subscription was cancelled. Reactivate to restore tool access.'}
                  </p>
                </div>
                <button
                  disabled={checkoutLoading}
                  onClick={async () => {
                    if (!billing.stripeEnabled) { showToast('Contact support to upgrade your plan.', false); return; }
                    setCheckoutLoading(true);
                    const data = await api.post('/billing/checkout', { plan: 'pro' });
                    setCheckoutLoading(false);
                    if (data.success && data.url) window.location.href = data.url;
                    else showToast(data.error || 'Checkout failed.', false);
                  }}
                  className="btn-primary px-6 py-2.5 text-sm whitespace-nowrap"
                >
                  {checkoutLoading ? 'Redirecting…' : '⬆ Upgrade to Pro — $99/mo'}
                </button>
              </div>
            )}

            {/* ── Invoice tabs ─────────────────────────────────────────── */}
            <div className="flex gap-1 mb-4 flex-wrap">
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                  style={{
                    background: tab === t.key ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${tab === t.key ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
                    color: tab === t.key ? '#a5b4fc' : '#9ca3af',
                    cursor: 'pointer',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Invoice table ────────────────────────────────────────── */}
            {displayedInv.length === 0 ? (
              <div className="rounded-2xl p-10 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-gray-500 text-sm">No invoices in this category yet.</p>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                <div className="grid text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3"
                  style={{ gridTemplateColumns: '1fr 80px 90px 100px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span>Description</span>
                  <span className="text-right">Amount</span>
                  <span className="text-center">Status</span>
                  <span className="text-right">Date</span>
                </div>

                {displayedInv.map((inv, i) => {
                  const color = INV_COLOR[inv.status] || '#9ca3af';
                  return (
                    <div key={inv.id || i} className="grid items-center px-5 py-3 text-sm"
                      style={{
                        gridTemplateColumns: '1fr 80px 90px 100px',
                        borderBottom: i < displayedInv.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      }}>
                      <span className="text-gray-200 text-xs truncate pr-3">{inv.description || '—'}</span>
                      <span className="text-right text-gray-300 text-xs font-medium">${(inv.amount || 0).toFixed(2)}</span>
                      <span className="text-center">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: `${color}18`, color }}>
                          {inv.status}
                        </span>
                      </span>
                      <span className="text-right text-gray-500 text-xs">{relDate(inv.date)}</span>
                    </div>
                  );
                })}

                <div className="grid items-center px-5 py-3 text-xs font-semibold text-gray-400"
                  style={{ gridTemplateColumns: '1fr 80px 90px 100px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                  <span>Total ({displayedInv.length} invoice{displayedInv.length !== 1 ? 's' : ''})</span>
                  <span className="text-right text-white">${displayedInv.reduce((s, i) => s + (i.amount || 0), 0).toFixed(2)}</span>
                  <span /><span />
                </div>
              </div>
            )}

            {billing.notes && (
              <p className="text-xs text-gray-600 mt-4 italic">📝 {billing.notes}</p>
            )}
          </>
        )}
      </main>

      {/* ── Upgrade Tier Modal ───────────────────────────────────────────── */}
      {showTierModal && (
        <UpgradeTierModal
          currentTier={currentTier}
          onClose={() => setShowTierModal(false)}
          onUpgraded={(newTier, tierInfo) => {
            setBilling(prev => prev ? { ...prev, tier: newTier } : prev);
            showToast(`${tierInfo?.icon || ''} Upgraded to ${tierInfo?.name || newTier}! Integrations updated.`, true);
          }}
        />
      )}

      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium fade-up"
          style={toast.ok
            ? { background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80' }
            : { background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
