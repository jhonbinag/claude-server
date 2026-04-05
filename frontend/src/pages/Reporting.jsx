/**
 * Reporting.jsx — Standalone reporting dashboard at /reporting
 *
 * No AppShell wrapper — has its own sidebar and layout.
 * Auth: locationId stored in localStorage as 'rpt_location_id'.
 *       On first visit a simple prompt collects the location ID.
 * API:  All calls go to /rpt/* (backend at src/routes/reporting.js).
 *
 * Sections:
 *   Dashboard    — stat cards + weekly/monthly leads + custom date filter
 *   Contacts     — table with date/query filter, pagination
 *   Opportunities— table with date/status filter, pagination
 *   Conversations— table with date filter, pagination
 *   Invoices     — tabs: Invoices / Subscriptions / Orders / Transactions
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  PieChart, Pie, Cell, Tooltip as RTooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from 'recharts';

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  bg:          '#0f0f13',
  sidebar:     '#0a0a0f',
  card:        '#14141e',
  border:      'rgba(255,255,255,0.07)',
  borderHover: 'rgba(255,255,255,0.14)',
  text:        '#e2e8f0',
  muted:       '#6b7280',
  dim:         '#374151',
  accent:      '#6366f1',
  accentBg:    'rgba(99,102,241,0.15)',
  accentBdr:   'rgba(99,102,241,0.3)',
  green:       '#10b981',
  greenBg:     'rgba(16,185,129,0.12)',
  greenBdr:    'rgba(16,185,129,0.3)',
  amber:       '#f59e0b',
  red:         '#ef4444',
};

// ── Shared inline styles ──────────────────────────────────────────────────────

const S = {
  input: {
    background: 'rgba(255,255,255,0.06)',
    border: `1px solid rgba(255,255,255,0.1)`,
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 13,
    color: C.text,
    outline: 'none',
    colorScheme: 'dark',
  },
  btn: {
    padding: '9px 22px',
    borderRadius: 9,
    background: C.accent,
    border: 'none',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity .15s',
  },
  label: {
    display: 'block',
    fontSize: 11,
    color: C.muted,
    fontWeight: 600,
    marginBottom: 5,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
};

// ── Sidebar nav config ────────────────────────────────────────────────────────

const NAV = [
  { key: 'dashboard',     label: 'Dashboard',      icon: '📊' },
  { key: 'contacts',      label: 'Contacts',        icon: '👥' },
  { key: 'opportunities', label: 'Opportunities',   icon: '💼' },
  { key: 'conversations', label: 'Conversations',   icon: '💬' },
  {
    key: 'billing', label: 'Billing', icon: '💳',
    tabs: [
      { key: 'subscription', label: 'Subscriptions' },
      { key: 'order',        label: 'Orders' },
      { key: 'transaction',  label: 'Transactions' },
    ],
  },
];

// ── Auth Gate ─────────────────────────────────────────────────────────────────

function AuthGate({ onConnect }) {
  const [id, setId]   = useState('');
  const [err, setErr] = useState('');

  const submit = () => {
    const v = id.trim();
    if (!v) { setErr('Location ID is required.'); return; }
    onConnect(v);
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 20, padding: '44px 52px', maxWidth: 460, width: '90%', textAlign: 'center' }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>📊</div>
        <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: C.text }}>Reporting Dashboard</h1>
        <p style={{ margin: '0 0 32px', fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
          Enter your GHL Location ID to connect and start viewing reports for your sub-account.
        </p>
        <div style={{ textAlign: 'left', marginBottom: 16 }}>
          <label style={S.label}>GHL Location ID</label>
          <input
            value={id}
            onChange={e => { setId(e.target.value); setErr(''); }}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="e.g. abc123xyz…"
            style={{ ...S.input, width: '100%', boxSizing: 'border-box', fontSize: 14, padding: '11px 14px' }}
          />
          {err && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#f87171' }}>{err}</p>}
        </div>
        <button onClick={submit} style={{ ...S.btn, width: '100%', padding: 12, fontSize: 14 }}>
          Connect →
        </button>
        <p style={{ margin: '18px 0 0', fontSize: 11, color: C.dim }}>
          Your location ID is saved locally in your browser only.
        </p>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ section, billingTab, onNav, onBillingTab, locationId, onDisconnect }) {
  return (
    <aside style={{
      width: 232, flexShrink: 0, background: C.sidebar,
      borderRight: `1px solid ${C.border}`, display: 'flex',
      flexDirection: 'column', height: '100vh', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>📊</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Reporting</span>
        </div>
        <div style={{ marginTop: 8, padding: '5px 9px', background: 'rgba(99,102,241,0.08)', border: `1px solid ${C.accentBdr}`, borderRadius: 7 }}>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Location ID</div>
          <div style={{ fontSize: 11, color: '#a5b4fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={locationId}>
            {locationId}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
        {NAV.map(item => {
          const active = section === item.key;
          return (
            <div key={item.key}>
              <button
                onClick={() => onNav(item.key)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                  padding: '9px 11px', borderRadius: 9, cursor: 'pointer',
                  background: active ? C.accentBg : 'transparent',
                  border: `1px solid ${active ? C.accentBdr : 'transparent'}`,
                  color: active ? '#a5b4fc' : C.text,
                  fontSize: 13, fontWeight: active ? 600 : 400,
                  textAlign: 'left', marginBottom: 2, transition: 'all .12s',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontSize: 15, flexShrink: 0 }}>{item.icon}</span>
                {item.label}
              </button>

              {/* Billing sub-tabs */}
              {item.tabs && active && (
                <div style={{ marginLeft: 16, marginTop: 2, marginBottom: 4 }}>
                  {item.tabs.map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => onBillingTab(tab.key)}
                      style={{
                        width: '100%', padding: '7px 10px', borderRadius: 7,
                        cursor: 'pointer', fontSize: 12, textAlign: 'left',
                        color: billingTab === tab.key ? '#a5b4fc' : C.muted,
                        background: billingTab === tab.key ? 'rgba(99,102,241,0.1)' : 'transparent',
                        border: 'none',
                        borderLeft: `2px solid ${billingTab === tab.key ? C.accent : 'transparent'}`,
                        transition: 'all .1s', display: 'block', marginBottom: 1,
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: '12px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
        <button
          onClick={onDisconnect}
          style={{ width: '100%', padding: '8px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: 12, cursor: 'pointer', transition: 'all .15s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.15)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
        >
          ⬡ Disconnect
        </button>
      </div>
    </aside>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color = C.accent, loading }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 24px', flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 26, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: loading ? C.muted : C.text }}>
        {loading ? '…' : (value != null ? Number(value).toLocaleString() : '—')}
      </div>
    </div>
  );
}

// ── Leads tile ────────────────────────────────────────────────────────────────

function LeadsTile({ label, value, color, bg, bdr, loading }) {
  return (
    <div style={{ flex: 1, minWidth: 140, background: bg, border: `1px solid ${bdr}`, borderRadius: 12, padding: '18px 22px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 38, fontWeight: 700, color }}>{loading ? '…' : (value ?? '—')}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>new contacts</div>
    </div>
  );
}

// ── Dashboard — leads tab (7d / 30d contacts table) ──────────────────────────

const LEAD_COLS = [
  { key: 'name',      label: 'Name',    render: (_, r) => [r.firstName, r.lastName].filter(Boolean).join(' ') || <span style={{ color: C.muted }}>—</span> },
  { key: 'email',     label: 'Email',   render: v => v || <span style={{ color: C.muted }}>—</span> },
  { key: 'phone',     label: 'Phone',   render: v => v || <span style={{ color: C.muted }}>—</span> },
  { key: 'tags',      label: 'Tags',    render: v => Array.isArray(v) && v.length ? v.slice(0, 3).map(t => <span key={t} style={{ marginRight: 4, padding: '1px 7px', borderRadius: 8, background: C.accentBg, color: '#a5b4fc', fontSize: 11 }}>{t}</span>) : <span style={{ color: C.muted }}>—</span> },
  { key: 'dateAdded', label: 'Added',   render: (v, r) => { const d = v ?? r.dateCreated ?? r.createdAt; return d ? new Date(d).toLocaleDateString() : <span style={{ color: C.muted }}>—</span>; } },
];

function LeadsTabPanel({ locationId, days }) {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [limit,   setLimit]   = useState(20);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);

  const headers = { 'x-location-id': locationId };

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const params = new URLSearchParams({ limit, page: p, startDate });
      const r = await fetch(`/rpt/contacts?${params}`, { headers });
      const d = await r.json();
      if (d.success) { setRows(d.data); setTotal(d.meta?.total ?? d.data.length); }
    } catch (_) {}
    setLoading(false);
    setLoaded(true);
  }, [locationId, limit, days]);

  // Auto-load on mount
  useEffect(() => { load(1); }, [load]);

  const handlePage = p => { setPage(p); load(p); };
  const handleLimit = n => { setLimit(n); setPage(1); };

  return (
    <div>
      {/* Per-page + refresh row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <label style={{ ...S.label, margin: 0 }}>Per page</label>
        <select
          value={limit}
          onChange={e => handleLimit(Number(e.target.value))}
          style={{ ...S.input, padding: '5px 10px', fontSize: 12 }}
        >
          {[10, 20, 30, 40, 50].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <button
          onClick={() => { setPage(1); load(1); }}
          disabled={loading}
          style={{ ...S.btn, padding: '6px 14px', fontSize: 12, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
        {loaded && !loading && (
          <span style={{ fontSize: 12, color: C.muted }}>
            {total > 0 ? `${total.toLocaleString()} contact${total !== 1 ? 's' : ''} added in the last ${days} days` : 'No contacts found'}
          </span>
        )}
      </div>

      <DataTable columns={LEAD_COLS} rows={rows} loading={loading} loaded={loaded} />
      {loaded && total > 0 && <Pagination page={page} total={total} limit={limit} onChange={handlePage} />}
    </div>
  );
}

// ── Custom date range panel (used by "Custom" leads tab) ──────────────────────

function CustomRangePanel({ locationId }) {
  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [limit,   setLimit]   = useState(20);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);

  const headers = { 'x-location-id': locationId };

  const load = useCallback(async (p = 1) => {
    if (!startDate && !endDate) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, page: p });
      if (startDate) params.set('startDate', startDate);
      if (endDate)   params.set('endDate',   endDate);
      const r = await fetch(`/rpt/contacts?${params}`, { headers });
      const d = await r.json();
      if (d.success) { setRows(d.data); setTotal(d.meta?.total ?? d.data.length); }
    } catch (_) {}
    setLoading(false);
    setLoaded(true);
  }, [locationId, limit, startDate, endDate]);

  const handlePage = p => { setPage(p); load(p); };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <label style={S.label}>From</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={S.input} />
        </div>
        <div>
          <label style={S.label}>To</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={S.input} />
        </div>
        <div>
          <label style={S.label}>Per Page</label>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={{ ...S.input, paddingRight: 10 }}>
            {[10, 20, 30, 40, 50].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button
          onClick={() => { setPage(1); load(1); }}
          disabled={loading || (!startDate && !endDate)}
          style={{ ...S.btn, opacity: (loading || (!startDate && !endDate)) ? 0.6 : 1, marginTop: 2 }}
        >
          {loading ? 'Loading…' : '↻ Load'}
        </button>
        {loaded && !loading && (
          <span style={{ fontSize: 12, color: C.muted }}>
            {total > 0 ? `${total.toLocaleString()} contacts found` : 'No contacts found'}
          </span>
        )}
      </div>
      {!loaded && !loading && (
        <div style={{ padding: '28px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
          Select a date range and click <strong>Load</strong> to view contacts.
        </div>
      )}
      {(loaded || loading) && <DataTable columns={LEAD_COLS} rows={rows} loading={loading} loaded={loaded} />}
      {loaded && total > 0 && <Pagination page={page} total={total} limit={limit} onChange={handlePage} />}
    </div>
  );
}

// ── Chart helpers ─────────────────────────────────────────────────────────────

const CHART_TOOLTIP_STYLE = {
  contentStyle: { background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12, color: '#e2e8f0' },
  itemStyle:    { color: '#e2e8f0' },
  labelStyle:   { color: '#9ca3af', fontWeight: 600, marginBottom: 4 },
  cursor:       { fill: 'rgba(255,255,255,0.04)' },
};

function ChartCard({ title, children, loading }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 18 }}>{title}</div>
      {loading
        ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>Loading…</div>
        : children}
    </div>
  );
}

// Pie chart — new leads by window (exclusive slices)
function LeadsFunnelChart({ stats, loading }) {
  const d = stats?.contacts;
  // exclusive slices so they sum correctly in the pie
  const data = [
    { name: 'Last 1 Day',   value: d?.recent1d || 0,                         fill: '#818cf8' },
    { name: '1–3 Days',     value: Math.max(0, (d?.recent3d||0) - (d?.recent1d||0)), fill: '#6366f1' },
    { name: '3–7 Days',     value: Math.max(0, (d?.weekly||0)  - (d?.recent3d||0)), fill: '#10b981' },
    { name: '7–30 Days',    value: Math.max(0, (d?.monthly||0) - (d?.weekly||0)),   fill: '#f59e0b' },
  ];
  const hasData = data.some(s => s.value > 0);

  return (
    <ChartCard title="New Leads — Funnel by Window" loading={loading && !stats}>
      {!hasData
        ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>No new contacts in the last 30 days</div>
        : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                {data.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="transparent" />)}
              </Pie>
              <RTooltip {...CHART_TOOLTIP_STYLE} formatter={(v, name) => [v, name]} />
              <Legend
                iconType="circle" iconSize={8}
                formatter={(value) => <span style={{ color: C.muted, fontSize: 11 }}>{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
    </ChartCard>
  );
}

// Bar chart — opportunities by status
function OppsBarChart({ stats, loading }) {
  const bs = stats?.opportunities?.byStatus;
  const data = [
    { status: 'Open',      count: bs?.open      || 0, fill: '#818cf8' },
    { status: 'Won',       count: bs?.won        || 0, fill: '#10b981' },
    { status: 'Lost',      count: bs?.lost       || 0, fill: '#ef4444' },
    { status: 'Abandoned', count: bs?.abandoned  || 0, fill: '#f59e0b' },
  ];

  return (
    <ChartCard title="Opportunities by Status" loading={loading && !stats}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="status" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <RTooltip {...CHART_TOOLTIP_STYLE} formatter={v => [v, 'Count']} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// Line chart — billing (sub/order/txn) over last 6 months
function BillingLineChart({ locationId }) {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);

  const headers = { 'x-location-id': locationId };

  useEffect(() => {
    setLoading(true);
    fetch('/rpt/billing-chart', { headers })
      .then(r => r.json())
      .then(d => { if (d.success) setData(d.data); })
      .catch(() => {})
      .finally(() => { setLoading(false); setLoaded(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  return (
    <ChartCard title="Billing Activity — Last 6 Months" loading={loading && !loaded}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <RTooltip {...CHART_TOOLTIP_STYLE} />
          <Legend iconType="circle" iconSize={8} formatter={v => <span style={{ color: C.muted, fontSize: 11 }}>{v}</span>} />
          <Line type="monotone" dataKey="subscriptions" stroke="#818cf8" strokeWidth={2} dot={{ fill: '#818cf8', r: 3 }} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="orders"        stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="transactions"  stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ── Dashboard Section ─────────────────────────────────────────────────────────

function DashboardView({ locationId }) {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [leadsTab, setLeadsTab] = useState('7d');

  const headers = { 'x-location-id': locationId };

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/rpt/dashboard', { headers });
      const d = await r.json();
      if (d.success) setStats(d.data);
    } catch (_) {}
    setLoading(false);
  }, [locationId]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const TABS = [
    { key: '3d',     label: 'Last 3 Days',  days: 3,  color: '#a5b4fc', bg: 'rgba(99,102,241,0.08)',  bdr: C.accentBdr },
    { key: '7d',     label: 'Last 7 Days',  days: 7,  color: '#34d399', bg: C.greenBg,                bdr: C.greenBdr  },
    { key: '30d',    label: 'Last 30 Days', days: 30, color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',   bdr: 'rgba(245,158,11,0.3)' },
    { key: 'custom', label: 'Custom',       days: 0,  color: '#e2e8f0', bg: 'rgba(255,255,255,0.05)', bdr: C.border },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: C.text }}>Overview</h1>
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Summary of your GHL sub-account metrics.</p>
          </div>
          <button onClick={loadStats} disabled={loading} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 14px', fontSize: 11, color: C.muted, cursor: 'pointer' }}>
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatCard icon="👥" label="Total Contacts"      value={stats?.contacts?.total}     loading={loading && !stats} />
        <StatCard icon="💼" label="Total Opportunities" value={stats?.opportunities?.total} loading={loading && !stats} color={C.green} />
        <StatCard icon="💬" label="Total Conversations" value={stats?.conversations?.total} loading={loading && !stats} color={C.amber} />
      </div>

      {/* Charts row — Pie + Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <LeadsFunnelChart stats={stats} loading={loading} />
        <OppsBarChart     stats={stats} loading={loading} />
      </div>

      {/* Line chart — full width */}
      <div style={{ marginBottom: 24 }}>
        <BillingLineChart locationId={locationId} />
      </div>

      {/* New Leads table with tabs */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '22px 26px' }}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: C.text }}>New Leads — Contacts Added</h2>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TABS.map(tab => {
              const active   = leadsTab === tab.key;
              const countMap = { '3d': stats?.contacts?.recent3d, '7d': stats?.contacts?.weekly, '30d': stats?.contacts?.monthly };
              const count    = countMap[tab.key];
              return (
                <button
                  key={tab.key}
                  onClick={() => setLeadsTab(tab.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 18px', borderRadius: 10, cursor: 'pointer',
                    background: active ? tab.bg : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${active ? tab.bdr : C.border}`,
                    color: active ? tab.color : C.muted,
                    fontSize: 13, fontWeight: active ? 600 : 400,
                    transition: 'all .15s',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 16 }}>
                    {loading && !stats ? '…' : (count ?? '—')}
                  </span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        {leadsTab === '3d'     && <LeadsTabPanel key="3d"     locationId={locationId} days={3}  />}
        {leadsTab === '7d'     && <LeadsTabPanel key="7d"     locationId={locationId} days={7}  />}
        {leadsTab === '30d'    && <LeadsTabPanel key="30d"    locationId={locationId} days={30} />}
        {leadsTab === 'custom' && <CustomRangePanel key="custom" locationId={locationId} />}
      </div>
    </div>
  );
}

// ── FiltersBar ────────────────────────────────────────────────────────────────

function FiltersBar({ startDate, endDate, limit, onStart, onEnd, onLimit, onLoad, loading, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20, padding: '16px 18px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
      <div>
        <label style={S.label}>From</label>
        <input type="date" value={startDate} onChange={e => onStart(e.target.value)} style={S.input} />
      </div>
      <div>
        <label style={S.label}>To</label>
        <input type="date" value={endDate} onChange={e => onEnd(e.target.value)} style={S.input} />
      </div>
      {children}
      <div>
        <label style={S.label}>Per Page</label>
        <select value={limit} onChange={e => onLimit(Number(e.target.value))} style={{ ...S.input, paddingRight: 10 }}>
          {[10, 20, 30, 40, 50].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <button onClick={onLoad} disabled={loading} style={{ ...S.btn, opacity: loading ? 0.6 : 1, marginTop: 2 }}>
        {loading ? 'Loading…' : '↻ Load Records'}
      </button>
    </div>
  );
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

function fmtDate(v) { return v ? new Date(v).toLocaleString() : null; }
function fmtAmt(v)  { if (v == null) return null; const n = Number(v); return `$${n % 1 === 0 ? n.toFixed(2) : n}`; }

function getRecordFields(section, tab, r) {
  if (section === 'contacts') return [
    { label: 'Name',         value: [r.firstName, r.lastName].filter(Boolean).join(' ') || null },
    { label: 'Email',        value: r.email || null },
    { label: 'Phone',        value: r.phone || null },
    { label: 'Company',      value: r.companyName || null },
    { label: 'Tags',         value: Array.isArray(r.tags) && r.tags.length ? r.tags.join(', ') : null },
    { label: 'Source',       value: r.source || null },
    { label: 'Address',      value: [r.address1, r.city, r.state, r.postalCode, r.country].filter(Boolean).join(', ') || null },
    { label: 'Website',      value: r.website || null },
    { label: 'Date Added',   value: fmtDate(r.dateAdded || r.createdAt) },
    { label: 'Last Updated', value: fmtDate(r.dateUpdated || r.updatedAt) },
  ];
  if (section === 'opportunities') return [
    { label: 'Name',       value: r.name || null },
    { label: 'Contact',    value: r.contact?.name || r.contactName || null },
    { label: 'Email',      value: r.contact?.email || null },
    { label: 'Pipeline',   value: r.pipeline?.name || r.pipelineName || null },
    { label: 'Stage',      value: r.pipelineStage?.name || r.stageName || r.stage?.name || null },
    { label: 'Status',     value: r.status ? <StatusPill value={r.status} /> : null },
    { label: 'Value',      value: fmtAmt(r.monetaryValue) },
    { label: 'Source',     value: r.source || null },
    { label: 'Close Date', value: fmtDate(r.closeDate) },
    { label: 'Created',    value: fmtDate(r.createdAt) },
    { label: 'Updated',    value: fmtDate(r.updatedAt) },
  ];
  if (section === 'conversations') return [
    { label: 'Contact',       value: r.contactName || null },
    { label: 'Channel',       value: r.type || null },
    { label: 'Last Message',  value: r.lastMessageBody || null },
    { label: 'Unread',        value: r.unreadCount != null ? String(r.unreadCount) : null },
    { label: 'Last Activity', value: fmtDate(r.dateUpdated) },
    { label: 'Created',       value: fmtDate(r.dateCreated || r.createdAt) },
  ];
  if (section === 'billing' && tab === 'subscription') return [
    { label: 'ID',          value: r.id || null },
    { label: 'Contact',     value: r.contact?.name || r.contactSnapshot?.name || r.contactName || r.customer?.name || null },
    { label: 'Email',       value: r.contact?.email || r.contactSnapshot?.email || r.customer?.email || null },
    { label: 'Status',      value: r.status ? <StatusPill value={r.status} /> : null },
    { label: 'Product',     value: r.product?.name || r.planTitle || r.entitySourceName || null },
    { label: 'Source',      value: r.paymentProvider || r.entitySourceType || (typeof r.source === 'string' ? r.source : r.source?.type) || null },
    { label: 'Amount',      value: fmtAmt(r.amount) },
    { label: 'Interval',    value: r.interval ? `${r.intervalCount || 1}× ${r.interval}` : null },
    { label: 'Period End',  value: fmtDate(r.currentPeriodEnd) },
    { label: 'Created',     value: fmtDate(r.createdAt) },
  ];
  if (section === 'billing' && tab === 'order') return [
    { label: 'ID',       value: r.id || null },
    { label: 'Contact',  value: r.contactName || r.contact?.name || r.contactSnapshot?.name || null },
    { label: 'Email',    value: r.contactSnapshot?.email || r.contact?.email || null },
    { label: 'Status',   value: r.status ? <StatusPill value={r.status} /> : null },
    { label: 'Source',   value: r.paymentProvider || r.entitySourceType || (typeof r.source === 'string' ? r.source : r.source?.type) || null },
    { label: 'Amount',   value: fmtAmt(r.amount) },
    { label: 'Currency', value: r.currency?.toUpperCase() || null },
    { label: 'Created',  value: fmtDate(r.createdAt) },
  ];
  if (section === 'billing' && tab === 'transaction') return [
    { label: 'ID',      value: r.id || null },
    { label: 'Contact', value: r.contactName || r.contact?.name || r.contactSnapshot?.name || r.customer?.name || null },
    { label: 'Email',   value: r.contactSnapshot?.email || r.contact?.email || r.customer?.email || null },
    { label: 'Status',  value: r.status ? <StatusPill value={r.status} /> : null },
    { label: 'Source',  value: r.paymentProvider || r.entitySourceType || (typeof r.source === 'string' ? r.source : r.source?.type) || null },
    { label: 'Amount',  value: fmtAmt(r.amount) },
    { label: 'Type',    value: r.type || null },
    { label: 'Created', value: fmtDate(r.createdAt) },
  ];
  return [];
}

function DetailModal({ record, section, tab, onClose }) {
  const fields = getRecordFields(section, tab, record).filter(f => f.value != null && f.value !== '');
  const titleMap = {
    contacts:      [record.firstName, record.lastName].filter(Boolean).join(' ') || 'Contact',
    opportunities: record.name || 'Opportunity',
    conversations: record.contactName || 'Conversation',
    billing:       tab === 'subscription' ? 'Subscription' : tab === 'order' ? 'Order' : 'Transaction',
  };
  const title = titleMap[section] || 'Record';

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '28px 32px', maxWidth: 560, width: '100%', maxHeight: '82vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
              {section === 'billing' ? tab : section}
            </div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>{title}</h2>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '3px 10px', flexShrink: 0, marginLeft: 16 }}
          >×</button>
        </div>
        <div>
          {fields.map(({ label, value }, i) => (
            <div key={label} style={{ display: 'flex', gap: 16, padding: '10px 0', borderBottom: i < fields.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 110, paddingTop: 2, flexShrink: 0 }}>{label}</div>
              <div style={{ fontSize: 13, color: C.text, flex: 1, wordBreak: 'break-word' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── DataTable ─────────────────────────────────────────────────────────────────

function DataTable({ columns, rows, loading, loaded, onRowClick }) {
  if (loading && !loaded) return <div style={{ padding: '24px 0', color: C.muted, fontSize: 13 }}>Loading records…</div>;
  if (!loaded) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>
        Set your filters and click <strong>Load Records</strong> to view data.
      </div>
    );
  }
  if (loading) return <div style={{ padding: '24px 0', color: C.muted, fontSize: 13 }}>Loading records…</div>;
  if (!rows.length) return (
    <div style={{ padding: '32px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
      No records found for the selected filters.
    </div>
  );

  return (
    <div style={{ overflowX: 'auto', borderRadius: 12, border: `1px solid ${C.border}` }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
            {columns.map(col => (
              <th key={col.key} style={{ textAlign: 'left', padding: '11px 14px', borderBottom: `1px solid ${C.border}`, color: C.muted, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}
              onClick={() => onRowClick?.(row)}
              style={{ borderBottom: `1px solid rgba(255,255,255,0.04)`, transition: 'background .1s', cursor: onRowClick ? 'pointer' : 'default' }}
              onMouseEnter={e => e.currentTarget.style.background = onRowClick ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {columns.map(col => (
                <td key={col.key} style={{ padding: '11px 14px', color: C.text, verticalAlign: 'middle', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...col.tdStyle }}>
                  {col.render ? col.render(row[col.key], row) : (row[col.key] ?? <span style={{ color: C.muted }}>—</span>)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({ page, total, limit, onChange }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit + 1;
  const end   = Math.min(page * limit, total);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
      <button
        onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1}
        style={{ padding: '6px 14px', borderRadius: 7, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, color: page <= 1 ? C.dim : C.text, cursor: page <= 1 ? 'not-allowed' : 'pointer', fontSize: 12 }}
      >← Prev</button>

      <span style={{ fontSize: 12, color: C.muted }}>
        {total > 0 ? `${start}–${end} of ${total.toLocaleString()}` : '0 results'} · Page {page}/{pages}
      </span>

      <button
        onClick={() => onChange(Math.min(pages, page + 1))} disabled={page >= pages}
        style={{ padding: '6px 14px', borderRadius: 7, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, color: page >= pages ? C.dim : C.text, cursor: page >= pages ? 'not-allowed' : 'pointer', fontSize: 12 }}
      >Next →</button>
    </div>
  );
}

// ── Contacts Section ──────────────────────────────────────────────────────────

const CONTACT_COLS = [
  { key: 'name',      label: 'Name',    render: (_, r) => [r.firstName, r.lastName].filter(Boolean).join(' ') || <span style={{ color: C.muted }}>—</span> },
  { key: 'email',     label: 'Email',   render: v => v || <span style={{ color: C.muted }}>—</span> },
  { key: 'phone',     label: 'Phone',   render: v => v || <span style={{ color: C.muted }}>—</span> },
  { key: 'tags',      label: 'Tags',    render: v => Array.isArray(v) && v.length ? v.slice(0, 3).map(t => <span key={t} style={{ marginRight: 4, padding: '1px 7px', borderRadius: 8, background: C.accentBg, color: '#a5b4fc', fontSize: 11 }}>{t}</span>) : <span style={{ color: C.muted }}>—</span> },
  { key: 'dateAdded', label: 'Created', render: (v, r) => { const d = v ?? r.dateCreated ?? r.createdAt; return d ? new Date(d).toLocaleDateString() : <span style={{ color: C.muted }}>—</span>; } },
];

function ContactsView({ locationId }) {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [limit,   setLimit]   = useState(20);
  const [start,   setStart]   = useState('');
  const [end,     setEnd]     = useState('');
  const [query,   setQuery]   = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);

  const headers = { 'x-location-id': locationId };

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, page: p });
      if (start) params.set('startDate', start);
      if (end)   params.set('endDate',   end);
      if (query) params.set('query',     query);
      const r = await fetch(`/rpt/contacts?${params}`, { headers });
      const d = await r.json();
      if (d.success) { setRows(d.data); setTotal(d.meta?.total ?? d.data.length); }
    } catch (_) {}
    setLoading(false);
    setLoaded(true);
  }, [locationId, limit, start, end, query]);

  // Auto-load on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(1); }, [locationId]);

  const [selected, setSelected] = useState(null);
  const handleLoad = () => { setPage(1); load(1); };
  const handlePage = p  => { setPage(p); load(p); };

  return (
    <div>
      <h1 style={{ margin: '0 0 22px', fontSize: 22, fontWeight: 700, color: C.text }}>👥 Contacts</h1>
      <FiltersBar startDate={start} endDate={end} limit={limit} onStart={setStart} onEnd={setEnd} onLimit={setLimit} onLoad={handleLoad} loading={loading}>
        <div>
          <label style={S.label}>Search</label>
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLoad()} placeholder="Name, email, phone…" style={{ ...S.input, minWidth: 200 }} />
        </div>
      </FiltersBar>
      <DataTable columns={CONTACT_COLS} rows={rows} loading={loading} loaded={loaded} onRowClick={setSelected} />
      {loaded && total > 0 && <Pagination page={page} total={total} limit={limit} onChange={handlePage} />}
      {selected && <DetailModal record={selected} section="contacts" tab={null} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Opportunities Section ─────────────────────────────────────────────────────

const STATUS_COLORS = {
  won:       { bg: 'rgba(16,185,129,0.15)', color: '#34d399' },
  lost:      { bg: 'rgba(239,68,68,0.15)',  color: '#f87171' },
  open:      { bg: C.accentBg,              color: '#a5b4fc' },
  abandoned: { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24' },
};

const OPP_COLS = [
  { key: 'name',    label: 'Name' },
  { key: 'contact', label: 'Contact',  render: (_, r) => r.contact?.name || r.contactName || <span style={{ color: C.muted }}>—</span> },
  { key: 'pipeline',label: 'Pipeline', render: (_, r) => r.pipeline?.name || r.pipelineName || <span style={{ color: C.muted }}>—</span> },
  { key: 'stage',   label: 'Stage',    render: (_, r) => r.pipelineStage?.name || r.stageName || r.stage?.name || <span style={{ color: C.muted }}>—</span> },
  {
    key: 'status', label: 'Status',
    render: v => {
      if (!v) return <span style={{ color: C.muted }}>—</span>;
      const sc = STATUS_COLORS[v] || { bg: 'rgba(255,255,255,0.07)', color: C.text };
      return <span style={{ padding: '2px 9px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>{v}</span>;
    },
  },
  { key: 'monetaryValue', label: 'Value',   render: (_, r) => fmtAmt(r.monetaryValue) || <span style={{ color: C.muted }}>—</span> },
  { key: 'createdAt',     label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : <span style={{ color: C.muted }}>—</span> },
];

function OpportunitiesView({ locationId }) {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [limit,   setLimit]   = useState(20);
  const [start,   setStart]   = useState('');
  const [end,     setEnd]     = useState('');
  const [status,  setStatus]  = useState('');
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);

  const headers = { 'x-location-id': locationId };

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, page: p });
      if (start)  params.set('startDate', start);
      if (end)    params.set('endDate',   end);
      if (status) params.set('status',    status);
      if (email)  params.set('q',         email);
      const r = await fetch(`/rpt/opportunities?${params}`, { headers });
      const d = await r.json();
      if (d.success) {
        setRows(d.data); setTotal(d.meta?.total ?? d.data.length);
        if (d.data.length > 0) {
          console.log('[Opportunity] keys:', Object.keys(d.data[0]));
          console.log('[Opportunity] first record:', d.data[0]);
        }
      }
    } catch (_) {}
    setLoading(false);
    setLoaded(true);
  }, [locationId, limit, start, end, status, email]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(1); }, [locationId]);

  const [selected, setSelected] = useState(null);
  const handleLoad = () => { setPage(1); load(1); };
  const handlePage = p  => { setPage(p); load(p); };

  return (
    <div>
      <h1 style={{ margin: '0 0 22px', fontSize: 22, fontWeight: 700, color: C.text }}>💼 Opportunities</h1>
      <FiltersBar startDate={start} endDate={end} limit={limit} onStart={setStart} onEnd={setEnd} onLimit={setLimit} onLoad={handleLoad} loading={loading}>
        <div>
          <label style={S.label}>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...S.input }}>
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="abandoned">Abandoned</option>
          </select>
        </div>
        <div>
          <label style={S.label}>Search Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLoad()} placeholder="Filter by email…" style={{ ...S.input, minWidth: 200 }} />
        </div>
      </FiltersBar>
      <DataTable columns={OPP_COLS} rows={rows} loading={loading} loaded={loaded} onRowClick={setSelected} />
      {loaded && total > 0 && <Pagination page={page} total={total} limit={limit} onChange={handlePage} />}
      {selected && <DetailModal record={selected} section="opportunities" tab={null} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Unread Conversations Modal ────────────────────────────────────────────────

function UnreadModal({ convs, onMarkRead, onClose }) {
  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '28px 32px', maxWidth: 600, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Unread Messages</div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>
              🔔 {convs.length} Unread Conversation{convs.length !== 1 ? 's' : ''}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '3px 10px' }}
          >×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {convs.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
              All conversations are read.
            </div>
          ) : convs.map((conv, i) => (
            <div key={conv.id || i} style={{ padding: '16px 0', borderBottom: i < convs.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{conv.contactName || 'Unknown Contact'}</span>
                    <span style={{ padding: '1px 8px', borderRadius: 8, background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: 11, fontWeight: 700 }}>
                      {conv.unreadCount} unread
                    </span>
                    {conv.type && <span style={{ fontSize: 11, color: C.muted }}>{conv.type}</span>}
                  </div>
                  {conv.lastMessageBody && (
                    <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, wordBreak: 'break-word' }}>
                      {conv.lastMessageBody}
                    </div>
                  )}
                  {conv.dateUpdated && (
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>{new Date(conv.dateUpdated).toLocaleString()}</div>
                  )}
                </div>
                <button
                  onClick={() => onMarkRead(conv)}
                  style={{ flexShrink: 0, padding: '6px 14px', borderRadius: 8, background: C.accentBg, border: `1px solid ${C.accentBdr}`, color: '#a5b4fc', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'opacity .15s' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  Mark Read
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Conversations Section ─────────────────────────────────────────────────────

const CONV_COLS = [
  { key: 'contactName',     label: 'Contact',      render: v => v || <span style={{ color: C.muted }}>Unknown</span> },
  { key: 'type',            label: 'Channel',      render: v => v || <span style={{ color: C.muted }}>—</span> },
  { key: 'lastMessageBody', label: 'Last Message', render: v => v || <span style={{ color: C.muted }}>—</span>, tdStyle: { whiteSpace: 'normal', wordBreak: 'break-word', maxWidth: 340, overflow: 'visible' } },
  {
    key: 'unreadCount', label: 'Unread',
    render: v => v > 0 ? <span style={{ padding: '1px 8px', borderRadius: 8, background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: 11, fontWeight: 700 }}>{v}</span> : <span style={{ color: C.muted }}>0</span>,
  },
  { key: 'dateUpdated', label: 'Last Activity', render: v => v ? new Date(v).toLocaleDateString() : <span style={{ color: C.muted }}>—</span> },
];

function ConversationsView({ locationId }) {
  const [rows,       setRows]       = useState([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [limit,      setLimit]      = useState(20);
  const [start,      setStart]      = useState('');
  const [end,        setEnd]        = useState('');
  const [loading,    setLoading]    = useState(false);
  const [loaded,     setLoaded]     = useState(false);
  const [selected,   setSelected]   = useState(null);
  const [showUnread, setShowUnread] = useState(false);

  const headers = { 'x-location-id': locationId };

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, page: p });
      if (start) params.set('startDate', start);
      if (end)   params.set('endDate',   end);
      const r = await fetch(`/rpt/conversations?${params}`, { headers });
      const d = await r.json();
      if (d.success) { setRows(d.data); setTotal(d.meta?.total ?? d.data.length); }
    } catch (_) {}
    setLoading(false);
    setLoaded(true);
  }, [locationId, limit, start, end]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(1); }, [locationId]);

  const handleLoad = () => { setPage(1); load(1); };
  const handlePage = p  => { setPage(p); load(p); };

  const unreadConvs = rows.filter(r => r.unreadCount > 0);

  const handleMarkRead = async (conv) => {
    try {
      await fetch(`/rpt/conversations/${conv.id}/read`, { method: 'PUT', headers });
    } catch (_) {}
    // Update local state regardless of API result
    setRows(prev => prev.map(r => r.id === conv.id ? { ...r, unreadCount: 0 } : r));
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 22px' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text }}>💬 Conversations</h1>
        {loaded && unreadConvs.length > 0 && (
          <button
            onClick={() => setShowUnread(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.18)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
          >
            🔔 {unreadConvs.length} Unread
          </button>
        )}
      </div>
      <FiltersBar startDate={start} endDate={end} limit={limit} onStart={setStart} onEnd={setEnd} onLimit={setLimit} onLoad={handleLoad} loading={loading} />
      <DataTable columns={CONV_COLS} rows={rows} loading={loading} loaded={loaded} onRowClick={setSelected} />
      {loaded && total > 0 && <Pagination page={page} total={total} limit={limit} onChange={handlePage} />}
      {selected && <DetailModal record={selected} section="conversations" tab={null} onClose={() => setSelected(null)} />}
      {showUnread && (
        <UnreadModal
          convs={rows.filter(r => r.unreadCount > 0)}
          onMarkRead={handleMarkRead}
          onClose={() => setShowUnread(false)}
        />
      )}
    </div>
  );
}

// ── Invoices Section ──────────────────────────────────────────────────────────

const INVOICE_COLS = {
  invoice: [
    { key: 'invoiceNumber', label: 'Invoice #',  render: v => v || <span style={{ color: C.muted }}>—</span> },
    { key: 'name',          label: 'Name',       render: v => v || <span style={{ color: C.muted }}>—</span> },
    { key: 'contact',       label: 'Contact',    render: (_, r) => r.contact?.name || r.contactName || <span style={{ color: C.muted }}>—</span> },
    { key: 'status',        label: 'Status',     render: v => v ? <StatusPill value={v} /> : <span style={{ color: C.muted }}>—</span> },
    { key: 'total',         label: 'Total',      render: v => { if (v == null) return <span style={{ color: C.muted }}>—</span>; const n = Number(v); return `$${n % 1 === 0 ? n.toFixed(2) : n}`; } },
    { key: 'dueDate',       label: 'Due Date',   render: v => v ? new Date(v).toLocaleDateString() : <span style={{ color: C.muted }}>—</span> },
  ],
  subscription: [
    { key: 'id',        label: 'ID',      render: v => v ? <code style={{ fontSize: 11, color: '#a5b4fc' }}>{String(v).slice(0, 14)}…</code> : '—' },
    { key: 'entityId',  label: 'Contact', render: (_, r) => r.contact?.name || r.contactSnapshot?.name || r.contactName || r.customer?.name || <span style={{ color: C.muted }}>—</span> },
    { key: 'status',    label: 'Status',  render: v => v ? <StatusPill value={v} /> : <span style={{ color: C.muted }}>—</span> },
    { key: 'product',   label: 'Product', render: (_, r) => r.product?.name || r.planTitle || r.entitySourceName || r.productName || <span style={{ color: C.muted }}>—</span> },
    { key: 'source',    label: 'Source',  render: (_, r) => r.paymentProvider || r.entitySourceType || (typeof r.source === 'string' ? r.source : r.source?.type) || r.paymentSource || <span style={{ color: C.muted }}>—</span> },
    { key: 'amount',    label: 'Amount',  render: v => { if (v == null) return <span style={{ color: C.muted }}>—</span>; const n = Number(v); return `$${n % 1 === 0 ? n.toFixed(2) : n}`; } },
    { key: 'createdAt', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : <span style={{ color: C.muted }}>—</span> },
  ],
  order: [
    { key: 'id',        label: 'Order ID', render: v => v ? <code style={{ fontSize: 11, color: '#a5b4fc' }}>{String(v).slice(0, 14)}…</code> : '—' },
    { key: 'contactName',label: 'Contact', render: (_, r) => r.contactName || r.contact?.name || r.contactSnapshot?.name || <span style={{ color: C.muted }}>—</span> },
    { key: 'status',    label: 'Status',   render: v => v ? <StatusPill value={v} /> : <span style={{ color: C.muted }}>—</span> },
    { key: 'source',    label: 'Source',   render: (_, r) => r.paymentProvider || r.entitySourceType || (typeof r.source === 'string' ? r.source : r.source?.type) || r.paymentSource || <span style={{ color: C.muted }}>—</span> },
    { key: 'amount',    label: 'Amount',   render: v => { if (v == null) return <span style={{ color: C.muted }}>—</span>; const n = Number(v); return `$${n % 1 === 0 ? n.toFixed(2) : n}`; } },
    { key: 'currency',  label: 'Currency', render: v => v ? v.toUpperCase() : <span style={{ color: C.muted }}>—</span> },
    { key: 'createdAt', label: 'Created',  render: v => v ? new Date(v).toLocaleDateString() : <span style={{ color: C.muted }}>—</span> },
  ],
  transaction: [
    { key: 'id',        label: 'Txn ID',  render: v => v ? <code style={{ fontSize: 11, color: '#a5b4fc' }}>{String(v).slice(0, 14)}…</code> : '—' },
    { key: 'entityId',  label: 'Contact', render: (_, r) => r.contactName || r.contact?.name || r.contactSnapshot?.name || r.customer?.name || <span style={{ color: C.muted }}>—</span> },
    { key: 'status',    label: 'Status',  render: v => v ? <StatusPill value={v} /> : <span style={{ color: C.muted }}>—</span> },
    { key: 'source',    label: 'Source',  render: (_, r) => r.paymentProvider || r.entitySourceType || (typeof r.source === 'string' ? r.source : r.source?.type) || r.paymentSource || <span style={{ color: C.muted }}>—</span> },
    { key: 'amount',    label: 'Amount',  render: v => { if (v == null) return <span style={{ color: C.muted }}>—</span>; const n = Number(v); return `$${n % 1 === 0 ? n.toFixed(2) : n}`; } },
    { key: 'type',      label: 'Type',    render: v => v || <span style={{ color: C.muted }}>—</span> },
    { key: 'createdAt', label: 'Created', render: v => v ? new Date(v).toLocaleDateString() : <span style={{ color: C.muted }}>—</span> },
  ],
};

function StatusPill({ value }) {
  const map = {
    paid:      { bg: C.greenBg,              color: '#34d399' },
    active:    { bg: C.greenBg,              color: '#34d399' },
    succeeded: { bg: C.greenBg,              color: '#34d399' },
    pending:   { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24' },
    open:      { bg: C.accentBg,              color: '#a5b4fc' },
    void:      { bg: 'rgba(107,114,128,0.15)', color: C.muted },
    canceled:  { bg: 'rgba(239,68,68,0.15)',  color: '#f87171' },
    failed:    { bg: 'rgba(239,68,68,0.15)',  color: '#f87171' },
  };
  const s = map[value?.toLowerCase()] || { bg: 'rgba(255,255,255,0.07)', color: C.text };
  return <span style={{ padding: '2px 9px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>{value}</span>;
}

function BillingView({ locationId, tab }) {
  const [allRows,      setAllRows]      = useState([]);  // all records from last fetch
  const [page,         setPage]         = useState(1);
  const [perPage,      setPerPage]      = useState(20);  // display only — never triggers re-fetch
  const [start,        setStart]        = useState('');
  const [end,          setEnd]          = useState('');
  const [emailFilter,  setEmailFilter]  = useState('');
  const [loading,      setLoading]      = useState(false);
  const [loaded,       setLoaded]       = useState(false);

  const headers = { 'x-location-id': locationId };

  // Fetch up to 100 records; date filters applied server-side
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100, page: 1, type: tab });
      if (start) params.set('startDate', start);
      if (end)   params.set('endDate',   end);
      const r = await fetch(`/rpt/invoices?${params}`, { headers });
      const d = await r.json();
      if (d.success) {
        setAllRows(d.data);
        if (d.data.length > 0) {
          console.log(`[Billing:${tab}] keys:`, Object.keys(d.data[0]));
          console.log(`[Billing:${tab}] first record:`, d.data[0]);
        }
      }
    } catch (_) {}
    setLoading(false);
    setLoaded(true);
    setPage(1);
  }, [locationId, start, end, tab]);

  // Reset + auto-load when tab or locationId changes
  useEffect(() => {
    setAllRows([]); setPage(1); setLoaded(false); setEmailFilter('');
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, tab]);

  // Client-side email filter (checks all common email field paths)
  const getEmail = r => (r.email || r.customer?.email || r.contactEmail || r.entityEmail || '').toLowerCase();
  const filteredRows = emailFilter.trim()
    ? allRows.filter(r => getEmail(r).includes(emailFilter.trim().toLowerCase()))
    : allRows;

  const total         = filteredRows.length;
  const rows          = filteredRows.slice((page - 1) * perPage, page * perPage);
  const [selected, setSelected] = useState(null);
  const handleLoad    = () => { setEmailFilter(''); load(); };
  const handlePage    = p  => setPage(p);
  const handlePerPage = n  => { setPerPage(n); setPage(1); };
  const handleEmail   = v  => { setEmailFilter(v); setPage(1); };

  const LABELS = { subscription: 'Subscriptions', order: 'Orders', transaction: 'Transactions' };
  const cols   = INVOICE_COLS[tab] || INVOICE_COLS.subscription;

  return (
    <div>
      <h1 style={{ margin: '0 0 22px', fontSize: 22, fontWeight: 700, color: C.text }}>💳 {LABELS[tab] || 'Billing'}</h1>
      <FiltersBar startDate={start} endDate={end} limit={perPage} onStart={setStart} onEnd={setEnd} onLimit={handlePerPage} onLoad={handleLoad} loading={loading}>
        <div>
          <label style={S.label}>Search Email</label>
          <input
            value={emailFilter}
            onChange={e => handleEmail(e.target.value)}
            placeholder="Filter by email…"
            style={{ ...S.input, minWidth: 200 }}
          />
        </div>
      </FiltersBar>
      <DataTable columns={cols} rows={rows} loading={loading} loaded={loaded} onRowClick={setSelected} />
      {loaded && total > 0 && <Pagination page={page} total={total} limit={perPage} onChange={handlePage} />}
      {selected && <DetailModal record={selected} section="billing" tab={tab} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── URL ↔ section mapping ─────────────────────────────────────────────────────

const BILLING_PATH_TO_TAB = {
  subscriptions: 'subscription',
  orders:        'order',
  transactions:  'transaction',
};
const BILLING_TAB_TO_PATH = {
  subscription: 'subscriptions',
  order:        'orders',
  transaction:  'transactions',
};
const SECTION_TO_PATH = {
  dashboard:     '/',
  contacts:      '/contacts',
  opportunities: '/opportunities',
  conversations: '/conversations',
  billing:       '/billing/subscriptions',
};

// ── Root component ────────────────────────────────────────────────────────────

export default function Reporting() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [locationId, setLocationId] = useState(() => localStorage.getItem('rpt_location_id') || '');

  // Derive section + billing sub-tab from URL
  const segs    = pathname.replace(/^\//, '').split('/');
  const section = { contacts: 'contacts', opportunities: 'opportunities', conversations: 'conversations', billing: 'billing' }[segs[0]] || 'dashboard';
  const billingTab = section === 'billing' ? (BILLING_PATH_TO_TAB[segs[1]] || 'subscription') : 'subscription';

  const handleConnect = (id) => {
    localStorage.setItem('rpt_location_id', id);
    setLocationId(id);
  };

  const handleDisconnect = () => {
    localStorage.removeItem('rpt_location_id');
    setLocationId('');
    navigate('/');
  };

  const handleNav = (key) => {
    navigate(SECTION_TO_PATH[key] || '/');
  };

  const handleBillingTab = (tabKey) => {
    navigate(`/billing/${BILLING_TAB_TO_PATH[tabKey] || 'subscriptions'}`);
  };

  if (!locationId) return <AuthGate onConnect={handleConnect} />;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: C.bg, fontFamily: 'system-ui, -apple-system, sans-serif', color: C.text }}>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        select option { background: #1a1a2e; color: #e2e8f0; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }
      `}</style>

      <Sidebar
        section={section}
        billingTab={billingTab}
        onNav={handleNav}
        onBillingTab={handleBillingTab}
        locationId={locationId}
        onDisconnect={handleDisconnect}
      />

      <main style={{ flex: 1, overflowY: 'auto', padding: '34px 40px', minWidth: 0 }}>
        {section === 'dashboard'     && <DashboardView     locationId={locationId} />}
        {section === 'contacts'      && <ContactsView      locationId={locationId} />}
        {section === 'opportunities' && <OpportunitiesView locationId={locationId} />}
        {section === 'conversations' && <ConversationsView locationId={locationId} />}
        {section === 'billing'       && <BillingView       locationId={locationId} tab={billingTab} />}
      </main>
    </div>
  );
}
