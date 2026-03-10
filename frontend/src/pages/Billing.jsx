/**
 * frontend/src/pages/Billing.jsx
 *
 * Billing & Subscription page.
 * Tabs: All Invoices | Active / Recurring | Payment History
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApp }  from '../context/AppContext';
import AuthGate    from '../components/AuthGate';
import Header      from '../components/Header';
import Spinner     from '../components/Spinner';
import { api }     from '../lib/api';

const STATUS_COLOR = {
  active:    { bg: '#14532d', text: '#4ade80' },
  trial:     { bg: '#1e3a5f', text: '#60a5fa' },
  past_due:  { bg: '#450a0a', text: '#f87171' },
  cancelled: { bg: '#1e1e1e', text: '#6b7280' },
  suspended: { bg: '#3a1a00', text: '#fb923c' },
};

const INV_COLOR = {
  paid:     '#4ade80',
  pending:  '#facc15',
  overdue:  '#f87171',
  refunded: '#6b7280',
  void:     '#6b7280',
};

function relDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Billing() {
  const { isAuthenticated, isAuthLoading, locationId } = useApp();

  const [billing,         setBilling]         = useState(null);
  const [loading,         setLoading]         = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [tab,             setTab]             = useState('all');
  const [toast,           setToast]           = useState(null);

  const showToast = (msg, ok) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    if (!locationId) return;
    setLoading(true);
    api.get('/billing').then(data => {
      if (data.success) setBilling(data.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [locationId]);

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
            {/* ── Plan summary cards ───────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">

              {/* Plan */}
              <div className="card p-5">
                <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider font-semibold">Current Plan</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-lg font-bold text-white capitalize">{billing.plan || 'Free'}</p>
                  <span
                    className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                    style={{ background: planStatus.bg, color: planStatus.text }}
                  >
                    {billing.status?.replace('_', ' ')}
                  </span>
                </div>
                {billing.amount > 0 && (
                  <p className="text-sm text-gray-400 mt-1">${billing.amount} / {billing.interval || 'mo'}</p>
                )}
                {billing.status === 'trial' && billing.trialEnd && (
                  <p className="text-xs text-blue-400 mt-1">Trial ends {relDate(billing.trialEnd)}</p>
                )}
                {billing.status === 'active' && billing.currentPeriodEnd && (
                  <p className="text-xs text-gray-500 mt-1">Renews {relDate(billing.currentPeriodEnd)}</p>
                )}
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
              <div
                className="rounded-2xl p-10 text-center"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <p className="text-gray-500 text-sm">No invoices in this category yet.</p>
              </div>
            ) : (
              <div
                className="rounded-2xl overflow-hidden"
                style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}
              >
                {/* Table header */}
                <div
                  className="grid text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3"
                  style={{ gridTemplateColumns: '1fr 80px 90px 100px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <span>Description</span>
                  <span className="text-right">Amount</span>
                  <span className="text-center">Status</span>
                  <span className="text-right">Date</span>
                </div>

                {/* Rows */}
                {displayedInv.map((inv, i) => {
                  const color = INV_COLOR[inv.status] || '#9ca3af';
                  return (
                    <div
                      key={inv.id || i}
                      className="grid items-center px-5 py-3 text-sm"
                      style={{
                        gridTemplateColumns: '1fr 80px 90px 100px',
                        borderBottom: i < displayedInv.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      }}
                    >
                      <span className="text-gray-200 text-xs truncate pr-3">{inv.description || '—'}</span>
                      <span className="text-right text-gray-300 text-xs font-medium">${(inv.amount || 0).toFixed(2)}</span>
                      <span className="text-center">
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: `${color}18`, color }}
                        >
                          {inv.status}
                        </span>
                      </span>
                      <span className="text-right text-gray-500 text-xs">{relDate(inv.date)}</span>
                    </div>
                  );
                })}

                {/* Footer total */}
                <div
                  className="grid items-center px-5 py-3 text-xs font-semibold text-gray-400"
                  style={{ gridTemplateColumns: '1fr 80px 90px 100px', borderTop: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <span>Total ({displayedInv.length} invoice{displayedInv.length !== 1 ? 's' : ''})</span>
                  <span className="text-right text-white">
                    ${displayedInv.reduce((s, i) => s + (i.amount || 0), 0).toFixed(2)}
                  </span>
                  <span />
                  <span />
                </div>
              </div>
            )}

            {/* ── Notes ───────────────────────────────────────────────── */}
            {billing.notes && (
              <p className="text-xs text-gray-600 mt-4 italic">📝 {billing.notes}</p>
            )}
          </>
        )}

      </main>

      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium fade-up"
          style={toast.ok
            ? { background: 'rgba(34,197,94,0.15)',  border: '1px solid rgba(34,197,94,0.3)',  color: '#4ade80' }
            : { background: 'rgba(239,68,68,0.15)',  border: '1px solid rgba(239,68,68,0.3)',  color: '#f87171' }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
