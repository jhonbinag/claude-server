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

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList,
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
  { key: 'affiliate',    label: 'Affiliate',       icon: '🤝' },
  { key: 'integrations', label: 'Integrations', icon: '🔌' },
  { key: 'officer',      label: 'Officer',       icon: '🎯' },
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

function Sidebar({ section, billingTab, onNav, onBillingTab, locationId, onDisconnect, open, onClose }) {
  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="rpt-backdrop"
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }}
        />
      )}

      <aside
        className={open ? 'rpt-sidebar rpt-sidebar--open' : 'rpt-sidebar'}
        style={{
          width: 232, flexShrink: 0, background: C.sidebar,
          borderRight: `1px solid ${C.border}`, display: 'flex',
          flexDirection: 'column', height: '100vh', overflow: 'hidden',
          transition: 'transform .22s ease',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 16px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>📊</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Reporting</span>
            </div>
            {/* Close button — visible on mobile */}
            <button
              className="rpt-close-btn"
              onClick={onClose}
              style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, borderRadius: 7, color: C.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '4px 9px' }}
            >✕</button>
          </div>
          <div style={{ padding: '5px 9px', background: 'rgba(99,102,241,0.08)', border: `1px solid ${C.accentBdr}`, borderRadius: 7 }}>
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
                  onClick={() => { onNav(item.key); onClose(); }}
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
                        onClick={() => { onBillingTab(tab.key); onClose(); }}
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
    </>
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

function CustomRangePanel({ locationId, initialStart = '', initialEnd = '' }) {
  const [startDate, setStartDate] = useState(initialStart);
  const [endDate,   setEndDate]   = useState(initialEnd);
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

// ── usePipelines hook ─────────────────────────────────────────────────────────
// Returns { pipelines, pipelineMap }
// pipelineMap: { [pipelineId]: { name, stages: { [stageId]: stageName } } }

function usePipelines(locationId) {
  const [pipelines, setPipelines] = useState([]);
  const [pipelineMap, setPipelineMap] = useState({});

  useEffect(() => {
    fetch('/rpt/pipelines', { headers: { 'x-location-id': locationId } })
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        setPipelines(d.data);
        const map = {};
        (d.data || []).forEach(p => {
          const stages = {};
          (p.stages || []).forEach(s => { stages[s.id] = s.name; });
          map[p.id] = { name: p.name, stages };
        });
        setPipelineMap(map);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  return { pipelines, pipelineMap };
}

// ── Chart Drill Modal ─────────────────────────────────────────────────────────

function ChartDrillModal({ title, url, locationId, columns, section, tab = null, onClose }) {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail,  setDetail]  = useState(null);

  useEffect(() => {
    fetch(url, { headers: { 'x-location-id': locationId } })
      .then(r => r.json())
      .then(d => { if (d.success) setRows(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}
    >
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '24px 28px', maxWidth: 900, width: '100%', maxHeight: '82vh', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '3px 10px' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <DataTable columns={columns} rows={rows} loading={loading} loaded={!loading} onRowClick={setDetail} />
        </div>
        {!loading && rows.length > 0 && (
          <div style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>{rows.length} record{rows.length !== 1 ? 's' : ''} — click a row for details</div>
        )}
      </div>
      {detail && <DetailModal record={detail} section={section} tab={tab} onClose={() => setDetail(null)} />}
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

function ChartCard({ title, children, loading, action }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
        {action}
      </div>
      {loading
        ? <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>Loading…</div>
        : children}
    </div>
  );
}

const _toIso   = ms  => new Date(ms).toISOString().slice(0, 10);
const _daysAgo = n   => _toIso(Date.now() - n * 86400000);
const _today   = ()  => _toIso(Date.now());

// Pie chart — new leads by window, clickable, with counts in legend
function LeadsFunnelChart({ stats, loading, locationId }) {
  const [drill,         setDrill]         = useState(null);
  const [customStart,   setCustomStart]   = useState('');
  const [customEnd,     setCustomEnd]     = useState('');
  const [customCount,   setCustomCount]   = useState(null);
  const [customLoading, setCustomLoading] = useState(false);
  const d = stats?.contacts;

  const isCustom = !!(customStart || customEnd);

  const WINDOWS = [
    { key: '1d', label: 'Last 1 Day',  cumul: d?.recent1d || 0,
      excl: d?.recent1d || 0,
      fill: '#818cf8', startDate: _daysAgo(1), endDate: _today() },
    { key: '3d', label: 'Last 3 Days', cumul: d?.recent3d || 0,
      excl: Math.max(0, (d?.recent3d||0) - (d?.recent1d||0)),
      fill: '#6366f1', startDate: _daysAgo(3), endDate: _today() },
    { key: '7d', label: 'Last 7 Days', cumul: d?.weekly   || 0,
      excl: Math.max(0, (d?.weekly||0) - (d?.recent3d||0)),
      fill: '#10b981', startDate: _daysAgo(7), endDate: _today() },
  ];

  // Fetch count for custom date range whenever dates change
  useEffect(() => {
    if (!customStart && !customEnd) { setCustomCount(null); return; }
    setCustomLoading(true);
    const params = new URLSearchParams({ limit: 1, page: 1 });
    if (customStart) params.set('startDate', customStart);
    if (customEnd)   params.set('endDate',   customEnd);
    fetch(`/rpt/contacts?${params}`, { headers: { 'x-location-id': locationId } })
      .then(r => r.json())
      .then(d => { if (d.success) setCustomCount(d.meta?.total ?? 0); })
      .catch(() => {})
      .finally(() => setCustomLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, customStart, customEnd]);

  // When custom dates are set, show a single slice for the custom count
  const customLabel = [customStart, customEnd].filter(Boolean).join(' → ') || 'Custom';
  const CUSTOM_WINDOW = {
    key: 'custom', label: customLabel,
    cumul: customCount ?? 0, excl: customCount ?? 0,
    fill: '#f59e0b',
    startDate: customStart, endDate: customEnd,
  };

  const activeWindows = isCustom ? [CUSTOM_WINDOW] : WINDOWS;
  const pieData = activeWindows.map(w => ({ ...w, value: w.excl > 0 ? w.excl : 0.3 }));
  const hasData = activeWindows.some(w => w.cumul > 0) || (isCustom && customCount !== null);

  const openDrill = (w) => {
    const params = new URLSearchParams({ limit: 100, page: 1 });
    if (w.startDate) params.set('startDate', w.startDate);
    if (w.endDate)   params.set('endDate',   w.endDate);
    setDrill({ title: `${w.label} — Contacts Added`, url: `/rpt/contacts?${params}` });
  };

  const _RADIAN = Math.PI / 180;
  const renderPieLabel = ({ cx, cy, midAngle, outerRadius, index }) => {
    const w = activeWindows[index];
    if (!w || w.cumul === 0) return null;
    const r = outerRadius + 24;
    const x = cx + r * Math.cos(-midAngle * _RADIAN);
    const y = cy + r * Math.sin(-midAngle * _RADIAN);
    const short = isCustom ? 'Custom' : ({ '1d': '1D', '3d': '3D', '7d': '7D' }[w.key] || w.key);
    return (
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
        fill={w.fill} fontSize={11} fontWeight="700" style={{ pointerEvents: 'none' }}>
        {short}: {w.cumul}
      </text>
    );
  };

  const showEmpty = !isCustom && !hasData;
  const showCustomLoading = isCustom && customLoading;

  return (
    <ChartCard title="New Leads — by Time Window" loading={loading && !stats}>
      {showEmpty
        ? <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>No new contacts in the last 7 days</div>
        : showCustomLoading
          ? <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>Loading…</div>
          : (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={pieData} nameKey="label" cx="50%" cy="50%"
                  innerRadius={42} outerRadius={62}
                  paddingAngle={2} dataKey="value"
                  label={renderPieLabel} labelLine={false}
                  onClick={(entry) => { const w = activeWindows.find(w => w.label === entry.name); if (w) openDrill(w); }}
                  style={{ cursor: 'pointer' }}
                >
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="transparent" />)}
                </Pie>
                <RTooltip
                  {...CHART_TOOLTIP_STYLE}
                  formatter={(_, name) => {
                    const w = activeWindows.find(w => w.label === name);
                    return [w ? `${w.cumul} contacts` : _, name];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}

      {/* Custom date picker */}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Custom Date Range</div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
            style={{ ...S.input, fontSize: 11, padding: '5px 7px', flex: 1, minWidth: 0 }} />
          <span style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}>→</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
            style={{ ...S.input, fontSize: 11, padding: '5px 7px', flex: 1, minWidth: 0 }} />
          {isCustom && (
            <button
              onClick={() => { setCustomStart(''); setCustomEnd(''); setCustomCount(null); }}
              style={{ flexShrink: 0, padding: '5px 8px', borderRadius: 7, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, cursor: 'pointer' }}
            >✕</button>
          )}
        </div>
        {isCustom && customCount !== null && !customLoading && (
          <button
            onClick={() => openDrill(CUSTOM_WINDOW)}
            style={{ marginTop: 6, width: '100%', padding: '7px', borderRadius: 8,
              background: C.accentBg, border: `1px solid ${C.accentBdr}`, color: '#a5b4fc',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'opacity .15s' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            {customCount} leads — View →
          </button>
        )}
      </div>

      {drill && (
        <ChartDrillModal title={drill.title} url={drill.url} locationId={locationId}
          columns={LEAD_COLS} section="contacts" onClose={() => setDrill(null)} />
      )}
    </ChartCard>
  );
}

// Bar chart — opportunities by status, clickable bars with count labels
function OppsBarChart({ locationId, pipelineId: externalPid, onPipelineChange }) {
  const [pipelineId,   setPipelineId]   = useState(externalPid || '');
  const [pipelineName, setPipelineName] = useState('');
  const [bs,           setBs]           = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [drill,        setDrill]        = useState(null);
  const { pipelines, pipelineMap } = usePipelines(locationId);

  // Sync when parent changes the external pipeline id
  useEffect(() => {
    if (externalPid !== undefined && externalPid !== pipelineId) {
      setPipelineId(externalPid || '');
      setPipelineName('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPid]);

  useEffect(() => {
    setBs(null);
    setLoading(true);

    const ctrl = new AbortController();
    const params = new URLSearchParams();
    if (pipelineId) params.set('pipelineId', pipelineId);

    fetch(`/rpt/opp-stats?${params}`, { headers: { 'x-location-id': locationId }, signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { if (d.success) setBs(d.data); })
      .catch(e => { if (e.name !== 'AbortError') setBs({ open: 0, won: 0, lost: 0, abandoned: 0 }); })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [locationId, pipelineId]);

  const data = [
    { status: 'Open',      count: bs?.open      ?? 0, fill: '#818cf8' },
    { status: 'Won',       count: bs?.won        ?? 0, fill: '#10b981' },
    { status: 'Lost',      count: bs?.lost       ?? 0, fill: '#ef4444' },
    { status: 'Abandoned', count: bs?.abandoned  ?? 0, fill: '#f59e0b' },
  ];

  const handleBarClick = (barData) => {
    if (!barData) return;
    const statusKey = barData.status.toLowerCase();
    const params = new URLSearchParams({ limit: 100, page: 1, status: statusKey });
    if (pipelineId) params.set('pipelineId', pipelineId);
    const label = pipelineName ? ` — ${pipelineName}` : '';
    setDrill({ title: `${barData.status} Opportunities${label}`, url: `/rpt/opportunities?${params}` });
  };

  const handlePipelineSelect = (e) => {
    const pid  = e.target.value;
    const name = e.target.options[e.target.selectedIndex].text;
    setPipelineId(pid);
    setPipelineName(pid ? name : '');
    onPipelineChange?.(pid);
  };

  const subtitle = pipelineName
    ? <span style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 400 }}> · {pipelineName}</span>
    : null;

  const dropdown = pipelines.length > 0 && (
    <select value={pipelineId} onChange={handlePipelineSelect}
      style={{ ...S.input, padding: '5px 10px', fontSize: 12, maxWidth: 180 }}>
      <option value="">All Pipelines</option>
      {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );

  return (
    <ChartCard title={<>Opportunities by Status{subtitle}</>} loading={loading} action={dropdown}>
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={data} margin={{ top: 22, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="status" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <RTooltip {...CHART_TOOLTIP_STYLE} formatter={v => [v, 'Count']} />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} onClick={handleBarClick} style={{ cursor: 'pointer' }}>
            <LabelList dataKey="count" position="top" style={{ fill: C.text, fontSize: 12, fontWeight: 700 }} />
            {data.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {drill && (
        <ChartDrillModal title={drill.title} url={drill.url} locationId={locationId}
          columns={makeOppCols(pipelineMap)} section="opportunities" onClose={() => setDrill(null)} />
      )}
    </ChartCard>
  );
}

// Minimal columns for the drill-down inside the chart (OPP_COLS is defined later in file)
const OPP_COLS_DASHBOARD = [
  { key: 'name',    label: 'Name' },
  { key: 'contact', label: 'Contact',  render: (_, r) => r.contact?.name || r.contactName || <span style={{ color: '#6b7280' }}>—</span> },
  { key: 'pipeline',label: 'Pipeline', render: (_, r) => r.pipeline?.name || r.pipelineName || <span style={{ color: '#6b7280' }}>—</span> },
  { key: 'stage',   label: 'Stage',    render: (_, r) => r.pipelineStage?.name || r.stageName || <span style={{ color: '#6b7280' }}>—</span> },
  { key: 'status',  label: 'Status',   render: v => v ? <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>{v}</span> : <span style={{ color: '#6b7280' }}>—</span> },
  { key: 'monetaryValue', label: 'Value', render: (_, r) => { const n = Number(r.monetaryValue); return n ? `$${n % 1 === 0 ? n.toFixed(2) : n}` : <span style={{ color: '#6b7280' }}>—</span>; } },
];

const RANGE_OPTIONS = [
  { value: 3,  label: 'Last 3 Months'  },
  { value: 6,  label: 'Last 6 Months'  },
  { value: 9,  label: 'Last 9 Months'  },
  { value: 12, label: 'Last 12 Months' },
];

// Line chart — billing over time, daily data points, live last-dot, clickable legend
function BillingLineChart({ locationId, startDate, endDate }) {
  const [data,        setData]        = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [loaded,      setLoaded]      = useState(false);
  const [drill,       setDrill]       = useState(null);
  const [hidden,      setHidden]      = useState({});
  const [rangeMonths, setRangeMonths] = useState(12);

  const headers = { 'x-location-id': locationId };

  // If the dashboard date picker is active, use those dates; otherwise use dropdown range
  const hasExternalDates = !!(startDate || endDate);
  const effectiveStart = hasExternalDates ? startDate : (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - rangeMonths);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  })();

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (effectiveStart) params.set('startDate', effectiveStart);
    if (endDate)        params.set('endDate',   endDate);
    const qs = params.toString();
    fetch(`/rpt/billing-chart${qs ? '?' + qs : ''}`, { headers })
      .then(r => r.json())
      .then(d => { if (d.success) setData(d.data); })
      .catch(() => {})
      .finally(() => { setLoading(false); setLoaded(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, effectiveStart, endDate]);

  const SERIES = [
    { key: 'subscriptions', label: 'Subscriptions', color: '#818cf8', tab: 'subscription' },
    { key: 'orders',        label: 'Orders',        color: '#10b981', tab: 'order'        },
    { key: 'transactions',  label: 'Transactions',  color: '#f59e0b', tab: 'transaction'  },
  ];

  // X-axis: one label per month, using the data point closest to the 10th of that month
  // e.g. Nov 10 → Dec 10 → Jan 10
  const monthTickLabels = (() => {
    if (!data.length) return new Set();
    const byMonth = {};
    data.forEach(d => {
      const ym = d.key?.slice(0, 7);
      if (!ym) return;
      if (!byMonth[ym]) byMonth[ym] = [];
      byMonth[ym].push(d);
    });
    const result = new Set();
    Object.values(byMonth).forEach(points => {
      const best = points.reduce((a, b) => {
        const dA = Math.abs(parseInt(a.key.slice(8), 10) - 10);
        const dB = Math.abs(parseInt(b.key.slice(8), 10) - 10);
        return dA <= dB ? a : b;
      });
      result.add(best.label);
    });
    return result;
  })();

  const openDrill = (seriesKey, point) => {
    const s = SERIES.find(s => s.key === seriesKey);
    if (!s || !point) return;
    const params = new URLSearchParams({ limit: 100, page: 1, type: s.tab, startDate: point.key, endDate: point.key });
    const cols   = INVOICE_COLS[s.tab] || INVOICE_COLS.subscription;
    setDrill({ title: `${s.label} — ${point.label}`, url: `/rpt/invoices?${params}`, cols, tab: s.tab });
  };

  // Custom dot: tiny dots on all points; last point = pulsing green live indicator + value
  const LIVE_COLOR = '#22c55e';
  const makeDot = (color, seriesKey) => (props) => {
    const { cx, cy, index, payload } = props;
    if (!cx || !cy) return null;
    const isLast = index === data.length - 1;
    const val    = payload?.[seriesKey];
    if (!isLast) return <circle key={index} cx={cx} cy={cy} r={2} fill={color} fillOpacity={0.5} />;
    return (
      <g key={`live-${seriesKey}`}>
        {/* outer pulse ring */}
        <circle cx={cx} cy={cy} r={12} fill={LIVE_COLOR} fillOpacity={0.18}
          style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: 'rpt-live-pulse 1.8s ease-in-out infinite' }} />
        {/* middle ring */}
        <circle cx={cx} cy={cy} r={7} fill={LIVE_COLOR} fillOpacity={0.3} />
        {/* solid core */}
        <circle cx={cx} cy={cy} r={4} fill={LIVE_COLOR} />
        {/* value label above */}
        {val > 0 && <>
          <rect x={cx - 14} y={cy - 28} width={28} height={14} rx={4} fill={LIVE_COLOR} fillOpacity={0.9} />
          <text x={cx} y={cy - 18} textAnchor="middle" fill="#fff" fontSize={10} fontWeight="700">{val}</text>
        </>}
      </g>
    );
  };

  const activeDotFor = (seriesKey) => ({
    r: 6, style: { cursor: 'pointer' },
    onClick: (e, payload) => openDrill(seriesKey, payload?.payload),
  });

  const toggleSeries = (key) => setHidden(h => ({ ...h, [key]: !h[key] }));

  const title = hasExternalDates
    ? `Billing Activity${startDate ? ` from ${startDate}` : ''}${endDate ? ` to ${endDate}` : ''}`
    : `Billing Activity — Last ${rangeMonths} Months`;

  return (
    <ChartCard title={title} loading={loading && !loaded}>
      <style>{`
        @keyframes rpt-live-pulse {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50%       { opacity: 0.45; transform: scale(1.7); }
        }
      `}</style>

      {/* Legend row: clickable series toggles + range dropdown */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SERIES.map(s => (
            <button key={s.key} onClick={() => toggleSeries(s.key)} style={{
              display: 'flex', alignItems: 'center', gap: 6, background: 'none',
              border: `1px solid ${hidden[s.key] ? C.border : 'transparent'}`,
              borderRadius: 20, cursor: 'pointer', padding: '3px 10px',
              opacity: hidden[s.key] ? 0.4 : 1, transition: 'all .15s',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: C.muted, textDecoration: hidden[s.key] ? 'line-through' : 'none' }}>
                {s.label}
              </span>
            </button>
          ))}
        </div>
        {!hasExternalDates && (
          <select
            value={rangeMonths}
            onChange={e => setRangeMonths(Number(e.target.value))}
            style={{ ...S.input, fontSize: 11, padding: '4px 8px', minWidth: 130 }}
          >
            {RANGE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 18, right: 24, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="label"
            tick={{ fill: C.muted, fontSize: 11 }}
            axisLine={false} tickLine={false} interval={0}
            tickFormatter={(label) => monthTickLabels.has(label) ? label : ''}
          />
          <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <RTooltip
            {...CHART_TOOLTIP_STYLE}
            labelFormatter={(_, payload) => {
              const key = payload?.[0]?.payload?.key;
              if (!key) return '';
              const [y, m, d] = key.split('-').map(Number);
              return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }}
          />
          <Line hide={!!hidden.subscriptions} type="monotone" dataKey="subscriptions" stroke="#818cf8" strokeWidth={2} dot={makeDot('#818cf8', 'subscriptions')} activeDot={activeDotFor('subscriptions')} />
          <Line hide={!!hidden.orders}        type="monotone" dataKey="orders"        stroke="#10b981" strokeWidth={2} dot={makeDot('#10b981', 'orders')}        activeDot={activeDotFor('orders')}        />
          <Line hide={!!hidden.transactions}  type="monotone" dataKey="transactions"  stroke="#f59e0b" strokeWidth={2} dot={makeDot('#f59e0b', 'transactions')}  activeDot={activeDotFor('transactions')}  />
        </LineChart>
      </ResponsiveContainer>

      {drill && (
        <ChartDrillModal title={drill.title} url={drill.url} locationId={locationId}
          columns={drill.cols} section="billing" tab={drill.tab} onClose={() => setDrill(null)} />
      )}
    </ChartCard>
  );
}

// ── Dashboard Section ─────────────────────────────────────────────────────────

function DashboardView({ locationId, oppPipelineId, onOppPipelineChange }) {
  const [stats,     setStats]     = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [dashStart, setDashStart] = useState('');
  const [dashEnd,   setDashEnd]   = useState('');

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

  const resetDates = () => { setDashStart(''); setDashEnd(''); };

  return (
    <div>
      {/* Header */}
      <div className="rpt-dash-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: C.text }}>Overview</h1>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Summary of your GHL sub-account metrics.</p>
        </div>
        {/* Shared date filter */}
        <div className="rpt-dash-dates" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label style={S.label}>From</label>
            <input type="date" value={dashStart} onChange={e => setDashStart(e.target.value)} style={{ ...S.input, width: '100%' }} />
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label style={S.label}>To</label>
            <input type="date" value={dashEnd} onChange={e => setDashEnd(e.target.value)} style={{ ...S.input, width: '100%' }} />
          </div>
          {(dashStart || dashEnd) && (
            <button onClick={resetDates}
              style={{ ...S.btn, background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, color: C.muted, fontSize: 12, padding: '8px 14px' }}>
              ✕ Reset
            </button>
          )}
          <button onClick={loadStats} disabled={loading}
            style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 14px', fontSize: 12, color: C.muted, cursor: 'pointer' }}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="rpt-stat-cards" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <StatCard icon="👥" label="Total Contacts"      value={stats?.contacts?.total}     loading={loading && !stats} />
        <StatCard icon="💼" label="Total Opportunities" value={stats?.opportunities?.total} loading={loading && !stats} color={C.green} />
        <StatCard icon="💬" label="Total Conversations" value={stats?.conversations?.total} loading={loading && !stats} color={C.amber} />
      </div>

      {/* Charts row — Pie + Bar, stack on mobile */}
      <div className="rpt-charts-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
        <LeadsFunnelChart stats={stats} loading={loading} locationId={locationId} />
        <OppsBarChart     locationId={locationId} pipelineId={oppPipelineId} onPipelineChange={onOppPipelineChange} />
      </div>

      {/* Billing line chart — full width */}
      <div style={{ marginBottom: 22 }}>
        <BillingLineChart locationId={locationId} startDate={dashStart} endDate={dashEnd} />
      </div>

      {/* New Leads table */}
      <div className="rpt-leads-box" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '22px 26px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
            {dashStart || dashEnd ? 'Leads — Custom Range' : 'Leads Added Today'}
          </h2>
          {!dashStart && !dashEnd && (
            <span style={{ padding: '2px 9px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: C.accentBg, color: '#a5b4fc' }}>
              {loading && !stats ? '…' : (stats?.contacts?.recent1d ?? 0)} lead{stats?.contacts?.recent1d !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="rpt-table-wrap">
          {dashStart || dashEnd
            ? <CustomRangePanel key={dashStart + dashEnd} locationId={locationId} initialStart={dashStart} initialEnd={dashEnd} />
            : <LeadsTabPanel key="1d" locationId={locationId} days={1} />
          }
        </div>
      </div>
    </div>
  );
}

// ── FiltersBar ────────────────────────────────────────────────────────────────

function FiltersBar({ startDate, endDate, limit, onStart, onEnd, onLimit, onLoad, loading, children }) {
  return (
    <div className="rpt-filters" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20, padding: '16px 18px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
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
    <div className="rpt-table-wrap" style={{ overflowX: 'auto', borderRadius: 12, border: `1px solid ${C.border}` }}>
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

// OPP_COLS takes a pipelineMap to resolve IDs → names since GHL returns
// pipelineId/pipelineStageId strings, not nested objects, in search results.
function makeOppCols(pipelineMap = {}) {
  const resolvePipeline = r =>
    r.pipeline?.name || r.pipelineName ||
    (r.pipelineId ? pipelineMap[r.pipelineId]?.name : null) || null;

  const resolveStage = r =>
    r.pipelineStage?.name || r.stageName || r.stage?.name ||
    (r.pipelineId && r.pipelineStageId
      ? pipelineMap[r.pipelineId]?.stages?.[r.pipelineStageId]
      : null) || null;

  return [
    { key: 'name',    label: 'Name' },
    { key: 'contact', label: 'Contact',  render: (_, r) => r.contact?.name || r.contactName || <span style={{ color: C.muted }}>—</span> },
    { key: 'pipeline',label: 'Pipeline', render: (_, r) => resolvePipeline(r) || <span style={{ color: C.muted }}>—</span> },
    { key: 'stage',   label: 'Stage',    render: (_, r) => resolveStage(r)    || <span style={{ color: C.muted }}>—</span> },
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
}
// Static fallback used in places that don't have pipelineMap yet
const OPP_COLS = makeOppCols();

function OpportunitiesView({ locationId, initialPipelineId = '' }) {
  const [rows,       setRows]       = useState([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [limit,      setLimit]      = useState(20);
  const [start,      setStart]      = useState('');
  const [end,        setEnd]        = useState('');
  const [status,     setStatus]     = useState('');
  const [email,      setEmail]      = useState('');
  const [pipelineId, setPipelineId] = useState(initialPipelineId);
  const [loading,    setLoading]    = useState(false);
  const [loaded,     setLoaded]     = useState(false);
  const { pipelines, pipelineMap }  = usePipelines(locationId);

  const headers = { 'x-location-id': locationId };

  // Sync if parent passes a new initialPipelineId (e.g. navigated from dashboard chart)
  useEffect(() => {
    if (initialPipelineId !== pipelineId) {
      setPipelineId(initialPipelineId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPipelineId]);

  const load = useCallback(async (p = 1, overridePid) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, page: p });
      if (start)  params.set('startDate',  start);
      if (end)    params.set('endDate',    end);
      if (status) params.set('status',     status);
      if (email)  params.set('q',          email);
      const pid = overridePid !== undefined ? overridePid : pipelineId;
      if (pid)   params.set('pipelineId', pid);
      const r = await fetch(`/rpt/opportunities?${params}`, { headers });
      const d = await r.json();
      if (d.success) { setRows(d.data); setTotal(d.meta?.total ?? d.data.length); }
    } catch (_) {}
    setLoading(false);
    setLoaded(true);
  }, [locationId, limit, start, end, status, email, pipelineId]);

  // Reload when pipelineId changes (covers both local select and initialPipelineId sync)
  useEffect(() => { load(1); }, [locationId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (loaded) { setPage(1); load(1, pipelineId); } }, [pipelineId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selected, setSelected] = useState(null);
  const handleLoad = () => { setPage(1); load(1); };
  const handlePage = p  => { setPage(p); load(p); };

  const handlePipelineChange = (newPid) => {
    setPipelineId(newPid);
    // useEffect above will trigger load when state propagates
  };

  const oppCols = makeOppCols(pipelineMap);

  return (
    <div>
      <h1 style={{ margin: '0 0 22px', fontSize: 22, fontWeight: 700, color: C.text }}>💼 Opportunities</h1>
      <FiltersBar startDate={start} endDate={end} limit={limit} onStart={setStart} onEnd={setEnd} onLimit={setLimit} onLoad={handleLoad} loading={loading}>
        <div>
          <label style={S.label}>Pipeline</label>
          <select value={pipelineId} onChange={e => handlePipelineChange(e.target.value)} style={{ ...S.input, minWidth: 160 }}>
            <option value="">All Pipelines</option>
            {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
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
      <DataTable columns={oppCols} rows={rows} loading={loading} loaded={loaded} onRowClick={setSelected} />
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

  // Live polling — silent refresh every 30s, only updates rows (no spinner)
  useEffect(() => {
    if (!loaded) return;
    const interval = setInterval(async () => {
      try {
        const params = new URLSearchParams({ limit, page });
        if (start) params.set('startDate', start);
        if (end)   params.set('endDate',   end);
        const r = await fetch(`/rpt/conversations?${params}`, { headers: { 'x-location-id': locationId } });
        const d = await r.json();
        if (d.success) {
          setRows(d.data);
          setTotal(d.meta?.total ?? d.data.length);
        }
      } catch (_) {}
    }, 30000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, locationId, limit, page, start, end]);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 22px', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text }}>💬 Conversations</h1>
        {loaded && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.muted }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 0 2px rgba(16,185,129,0.3)', animation: 'rpt-pulse 2s infinite' }} />
            Live
          </span>
        )}
        <style>{`@keyframes rpt-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
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
      {loaded && <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Showing most recent 100 conversations (GHL API limit). Use date filters to narrow results.</div>}
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

// ── Integrations View ─────────────────────────────────────────────────────────

const INTEGRATION_CARDS = [
  {
    key:         'slack',
    label:       'Slack',
    icon:        '💬',
    description: 'Post messages and notifications to your Slack channels.',
    fields: [
      { key: 'webhookUrl',     label: 'Incoming Webhook URL', type: 'password', placeholder: 'https://hooks.slack.com/services/T.../B.../...' },
      { key: 'defaultChannel', label: 'Default Channel',      type: 'text',     placeholder: '#general' },
    ],
    howTo: 'Go to api.slack.com/apps → Your App → Incoming Webhooks → Add New Webhook → copy the URL',
    tools: ['Send messages to channels', 'Post alerts and reports'],
  },
  {
    key:         'clickup',
    label:       'ClickUp',
    icon:        '✅',
    description: 'Create tasks, list projects, and update work items in ClickUp.',
    fields: [
      { key: 'apiKey', label: 'Personal API Token', type: 'password', placeholder: 'pk_...' },
    ],
    howTo: 'In ClickUp go to Settings (bottom-left avatar) → Apps → API Token → Generate → copy the token',
    tools: ['Get tasks', 'Create tasks', 'Update tasks', 'List all spaces & lists'],
  },
  {
    key:         'anthropic',
    label:       'Claude AI',
    icon:        '🤖',
    description: 'Required for the Reporting Officer to run AI-powered commands and summaries.',
    fields: [
      { key: 'apiKey', label: 'Anthropic API Key', type: 'password', placeholder: 'sk-ant-...' },
    ],
    howTo: 'Go to console.anthropic.com → API Keys → Create Key → copy the key starting with sk-ant-',
    tools: ['Power the Officer AI commands', 'Generate summaries', 'Execute reporting tasks'],
  },
];

function IntegrationCard({ card, locationId }) {
  const h = { 'x-location-id': locationId };
  const [values,     setValues]     = useState({});
  const [saved,      setSaved]      = useState({});   // { field: maskedValue }
  const [editing,    setEditing]    = useState({});
  const [saving,     setSaving]     = useState(false);
  const [connected,  setConnected]  = useState(false);
  const [showHow,    setShowHow]    = useState(false);

  useEffect(() => {
    fetch(`/rpt/integrations/${card.key}`, { headers: h })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.config) {
          setSaved(d.config);
          setConnected(d.connected || false);
        }
      })
      .catch(() => {});
  }, [locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    try {
      const payload = {};
      for (const f of card.fields) {
        if (values[f.key]?.trim()) payload[f.key] = values[f.key].trim();
      }
      const res = await fetch(`/rpt/integrations/${card.key}`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (d.success) {
        setSaved(d.configPreview || payload);
        setConnected(true);
        setValues({});
        setEditing({});
      } else {
        alert(d.error || 'Save failed.');
      }
    } catch (err) {
      alert(err.message);
    }
    setSaving(false);
  }

  async function disconnect() {
    if (!window.confirm(`Disconnect ${card.label}?`)) return;
    await fetch(`/rpt/integrations/${card.key}`, { method: 'DELETE', headers: h });
    setSaved({});
    setConnected(false);
    setValues({});
  }

  const card_ = { background: C.card, border: `1px solid ${connected ? C.greenBdr : C.border}`, borderRadius: 14, padding: '20px 22px', marginBottom: 14 };
  const inp   = { ...S.input, width: '100%' };
  const hasEdits = card.fields.some(f => values[f.key]?.trim());

  return (
    <div style={card_}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: connected ? C.greenBg : C.accentBg, border: `1px solid ${connected ? C.greenBdr : C.accentBdr}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
          {card.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{card.label}</span>
            {connected && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: C.greenBg, border: `1px solid ${C.greenBdr}`, color: C.green }}>● Connected</span>}
          </div>
          <p style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{card.description}</p>
        </div>
        {connected && (
          <button onClick={disconnect} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 7, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: C.red, cursor: 'pointer', flexShrink: 0 }}>
            Disconnect
          </button>
        )}
      </div>

      {/* Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {card.fields.map(f => (
          <div key={f.key}>
            <label style={S.label}>{f.label}</label>
            {connected && saved[f.key] && !editing[f.key] ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input style={{ ...inp, flex: 1, opacity: 0.6 }} value={saved[f.key]} readOnly />
                <button
                  onClick={() => setEditing(p => ({ ...p, [f.key]: true }))}
                  style={{ fontSize: 12, padding: '7px 12px', borderRadius: 7, background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', flexShrink: 0 }}
                >✏️ Edit</button>
              </div>
            ) : (
              <input
                style={inp}
                type={editing[f.key] || !connected ? f.type : 'text'}
                value={values[f.key] || ''}
                onChange={e => setValues(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
              />
            )}
          </div>
        ))}
      </div>

      {/* How to get credentials */}
      <div style={{ marginBottom: 14 }}>
        <button
          onClick={() => setShowHow(p => !p)}
          style={{ fontSize: 11, color: C.accent, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {showHow ? '▲ Hide instructions' : '▼ How to get credentials'}
        </button>
        {showHow && (
          <p style={{ fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.6, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: `1px solid ${C.border}` }}>
            {card.howTo}
          </p>
        )}
      </div>

      {/* Available tools */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {card.tools.map(t => (
          <span key={t} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 20, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, color: C.muted }}>
            {t}
          </span>
        ))}
      </div>

      {/* Save button */}
      {(!connected || hasEdits) && (
        <button
          onClick={save}
          disabled={saving || !hasEdits}
          style={{ ...S.btn, opacity: (saving || !hasEdits) ? 0.5 : 1 }}
        >
          {saving ? '⏳ Saving…' : connected ? 'Update' : `Connect ${card.label}`}
        </button>
      )}
    </div>
  );
}

// ── ClickUp Task Picker Modal ─────────────────────────────────────────────────

function TaskPickerModal({ locationId, onSelect, onClose }) {
  const h = { 'x-location-id': locationId };
  const [spaces,      setSpaces]      = useState([]);
  const [selectedList, setSelectedList] = useState('');
  const [tasks,       setTasks]       = useState([]);
  const [query,       setQuery]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [listsLoading, setListsLoading] = useState(true);
  const [error,       setError]       = useState('');

  // Load lists on mount
  useEffect(() => {
    setListsLoading(true);
    fetch('/rpt/clickup/lists', { headers: h })
      .then(r => r.json())
      .then(d => {
        if (d.success) setSpaces(d.spaces || []);
        else setError(d.error || 'Failed to load lists.');
      })
      .catch(() => setError('Could not reach server.'))
      .finally(() => setListsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load tasks when list changes or search is triggered
  useEffect(() => {
    if (!selectedList && !query) { setTasks([]); return; }
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedList) params.set('listId', selectedList);
    if (query.trim()) params.set('query', query.trim());
    fetch(`/rpt/clickup/tasks?${params}`, { headers: h })
      .then(r => r.json())
      .then(d => { if (d.success) setTasks(d.tasks || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedList]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch(e) {
    if (e.key !== 'Enter') return;
    if (!query.trim()) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedList) params.set('listId', selectedList);
    params.set('query', query.trim());
    fetch(`/rpt/clickup/tasks?${params}`, { headers: h })
      .then(r => r.json())
      .then(d => { if (d.success) setTasks(d.tasks || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  const allLists = spaces.flatMap(s => s.lists.map(l => ({ ...l, spaceName: s.spaceName })));

  const statusColor = (status) => {
    if (!status) return C.muted;
    const s = status.toLowerCase();
    if (s.includes('done') || s.includes('complete') || s.includes('closed')) return C.green;
    if (s.includes('progress') || s.includes('active') || s.includes('open')) return C.accent;
    return C.amber;
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, width: '100%', maxWidth: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>✅ Pick a ClickUp Task</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Select a task to use as context for your command</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, cursor: 'pointer', fontSize: 16, padding: '4px 10px' }}>✕</button>
        </div>

        {/* Filters */}
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 10, flexShrink: 0 }}>
          <select
            value={selectedList}
            onChange={e => setSelectedList(e.target.value)}
            style={{ ...S.input, flex: 1, fontSize: 12 }}
            disabled={listsLoading}
          >
            <option value="">— All lists (search below) —</option>
            {allLists.map(l => (
              <option key={l.id} value={l.id}>{l.spaceName} › {l.name}</option>
            ))}
          </select>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleSearch}
            placeholder="Search tasks… (Enter)"
            style={{ ...S.input, flex: 1, fontSize: 12 }}
          />
        </div>

        {/* Task list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {error && (
            <div style={{ padding: '12px', color: '#f87171', fontSize: 13 }}>{error}</div>
          )}
          {listsLoading && (
            <div style={{ padding: '20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading lists…</div>
          )}
          {!listsLoading && !loading && tasks.length === 0 && !error && (
            <div style={{ padding: '20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>
              {selectedList || query ? 'No tasks found.' : 'Select a list or search to browse tasks.'}
            </div>
          )}
          {loading && (
            <div style={{ padding: '20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading tasks…</div>
          )}
          {!loading && tasks.map(task => (
            <div
              key={task.id}
              onClick={() => onSelect(task)}
              style={{
                padding: '10px 12px', borderRadius: 10, marginBottom: 6, cursor: 'pointer',
                background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`,
                transition: 'all .12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = C.accentBg; e.currentTarget.style.borderColor = C.accentBdr; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = C.border; }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                    {task.listName && <span style={{ marginRight: 8 }}>📂 {task.listName}</span>}
                    {task.dueDate && <span style={{ marginRight: 8 }}>📅 {task.dueDate}</span>}
                    <span style={{ fontFamily: 'monospace', color: C.dim }}>ID: {task.id}</span>
                  </div>
                </div>
                {task.status && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', color: statusColor(task.status), border: `1px solid ${statusColor(task.status)}33`, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {task.status}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Officer View ─────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  {
    key:   'daily_summary',
    icon:  '📋',
    label: 'Daily Summary → Slack',
    color: '#10b981',
    bg:    'rgba(16,185,129,0.1)',
    bdr:   'rgba(16,185,129,0.25)',
    task:  (snap) => `Post a daily summary update to Slack. Here is today's GHL data snapshot:\n${snap}\n\nCreate a concise, professional daily summary message with key metrics (new contacts, open opportunities, total conversations) and any notable highlights. Post it to the default Slack channel.`,
  },
  {
    key:   'followup_tasks',
    icon:  '✅',
    label: 'Follow-up Tasks → ClickUp',
    color: '#6366f1',
    bg:    'rgba(99,102,241,0.1)',
    bdr:   'rgba(99,102,241,0.25)',
    task:  (snap) => `Create follow-up tasks in ClickUp based on today's GHL pipeline data:\n${snap}\n\nLook at the open opportunities count and recent contacts. Create actionable follow-up tasks in ClickUp — for example a task to review open opportunities, a task to follow up with recent leads, and any other relevant action items. Find the available lists first, then create the tasks.`,
  },
  {
    key:   'full_update',
    icon:  '🚀',
    label: 'Full Update → Slack + ClickUp',
    color: '#f59e0b',
    bg:    'rgba(245,158,11,0.1)',
    bdr:   'rgba(245,158,11,0.25)',
    task:  (snap) => `Do a full reporting update using today's GHL data:\n${snap}\n\n1. Post a summary to Slack with today's key metrics and highlights.\n2. Create follow-up tasks in ClickUp for the team — review open opportunities, follow up with new leads, and any other action items from the data.\nComplete both steps.`,
  },
];

function OfficerView({ locationId }) {
  const h = { 'x-location-id': locationId };

  const [slackOk,     setSlackOk]     = useState(null);
  const [clickupOk,   setClickupOk]   = useState(null);
  const [anthropicOk, setAnthropicOk] = useState(null);
  const [snap,        setSnap]        = useState(null);
  const [snapLoad,    setSnapLoad]    = useState(false);
  const [command,     setCommand]     = useState('');
  const [running,     setRunning]     = useState(false);
  const [output,      setOutput]      = useState([]);
  const [activeBtn,   setActiveBtn]   = useState(null);
  const [pickerOpen,  setPickerOpen]  = useState(false);
  const [pinnedTask,  setPinnedTask]  = useState(null); // { id, name, status, listName }

  // Check integration status
  useEffect(() => {
    fetch('/rpt/integrations/slack',     { headers: h }).then(r => r.json()).then(d => setSlackOk(d.connected || false)).catch(() => setSlackOk(false));
    fetch('/rpt/integrations/clickup',   { headers: h }).then(r => r.json()).then(d => setClickupOk(d.connected || false)).catch(() => setClickupOk(false));
    fetch('/rpt/integrations/anthropic', { headers: h }).then(r => r.json()).then(d => setAnthropicOk(d.connected || false)).catch(() => setAnthropicOk(false));
  }, [locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch dashboard snapshot on mount
  useEffect(() => {
    setSnapLoad(true);
    fetch('/rpt/dashboard', { headers: h })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          const { contacts, opportunities, conversations } = d.data;
          const lines = [
            `Contacts: ${contacts?.total ?? '?'} total, ${contacts?.recent1d ?? 0} new today, ${contacts?.recent3d ?? 0} last 3 days, ${contacts?.weekly ?? 0} this week`,
            `Opportunities: ${opportunities?.total ?? '?'} total | Open: ${opportunities?.byStatus?.open ?? 0} | Won: ${opportunities?.byStatus?.won ?? 0} | Lost: ${opportunities?.byStatus?.lost ?? 0}`,
            `Conversations: ${conversations?.total ?? '?'} total`,
          ];
          setSnap(lines.join('\n'));
        }
      })
      .catch(() => {})
      .finally(() => setSnapLoad(false));
  }, [locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runTask(task) {
    if (running) return;
    setRunning(true);
    setOutput([]);

    try {
      const res = await fetch('/claude/task', {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, allowedIntegrations: ['slack', 'clickup'] }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        setOutput([{ type: 'error', text: err.error || 'Request failed' }]);
        setRunning(false);
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const evtLine  = part.match(/^event:\s*(.+)/m);
          const dataLine = part.match(/^data:\s*(.+)/m);
          if (!evtLine || !dataLine) continue;
          const evtType = evtLine[1].trim();
          let payload;
          try { payload = JSON.parse(dataLine[1]); } catch { continue; }

          if (evtType === 'text') {
            setOutput(prev => {
              const last = prev[prev.length - 1];
              if (last?.type === 'text') return [...prev.slice(0, -1), { type: 'text', text: last.text + payload.text }];
              return [...prev, { type: 'text', text: payload.text }];
            });
          } else if (evtType === 'tool_call') {
            setOutput(prev => [...prev, { type: 'tool_call', text: payload.name, input: payload.input }]);
          } else if (evtType === 'tool_result') {
            setOutput(prev => [...prev, { type: 'tool_result', text: payload.name, result: payload.result }]);
          } else if (evtType === 'error') {
            setOutput(prev => [...prev, { type: 'error', text: payload.error }]);
          } else if (evtType === 'done') {
            setOutput(prev => [...prev, { type: 'done', text: `Done — ${payload.toolCallCount ?? 0} tool call(s)` }]);
          }
        }
      }
    } catch (err) {
      setOutput(prev => [...prev, { type: 'error', text: err.message }]);
    }
    setRunning(false);
    setActiveBtn(null);
  }

  const canRun = anthropicOk && !running;

  function handleQuickAction(action) {
    if (!snap || !canRun) return;
    setActiveBtn(action.key);
    runTask(action.task(snap));
  }

  function handleCustomCommand() {
    const t = command.trim();
    if (!t) return;
    setCommand('');
    const taskCtx = pinnedTask
      ? `\n\n[Pinned ClickUp Task]\nName: "${pinnedTask.name}"\nID: ${pinnedTask.id}\nStatus: ${pinnedTask.status || 'unknown'}${pinnedTask.listName ? `\nList: ${pinnedTask.listName}` : ''}\nUse taskId "${pinnedTask.id}" when calling clickup_update_task.`
      : '';
    runTask(t + taskCtx);
  }

  const StatusBadge = ({ ok, label, icon }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7,
      padding: '6px 14px', borderRadius: 20,
      background: ok === null ? 'rgba(255,255,255,0.04)' : ok ? C.greenBg : 'rgba(239,68,68,0.08)',
      border: `1px solid ${ok === null ? C.border : ok ? C.greenBdr : 'rgba(239,68,68,0.2)'}`,
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: ok === null ? C.muted : ok ? C.green : '#f87171' }}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: ok === null ? C.dim : ok ? C.green : '#f87171' }}>
        {ok === null ? '…' : ok ? '● Connected' : '○ Not connected'}
      </span>
    </div>
  );

  return (
    <div style={{ maxWidth: 760 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 6 }}>Reporting Officer</h1>
        <p style={{ fontSize: 13, color: C.muted }}>
          Post updates to Slack, create ClickUp tasks, and run reporting commands with AI.
        </p>
      </div>

      {/* Integration status */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: anthropicOk === false ? 12 : 24 }}>
        <StatusBadge ok={anthropicOk} label="Claude AI" icon="🤖" />
        <StatusBadge ok={slackOk}     label="Slack"     icon="💬" />
        <StatusBadge ok={clickupOk}   label="ClickUp"   icon="✅" />
        {(!slackOk || !clickupOk || !anthropicOk) && (
          <a
            href="/reporting/integrations"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, background: C.accentBg, border: `1px solid ${C.accentBdr}`, color: '#a5b4fc', fontSize: 12, textDecoration: 'none' }}
          >
            🔌 Connect integrations →
          </a>
        )}
      </div>

      {/* Blocking warning if no AI key */}
      {anthropicOk === false && (
        <div style={{ marginBottom: 20, padding: '12px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, fontSize: 13, color: '#f87171' }}>
          ⚠ Claude AI key not configured. Go to <a href="/reporting/integrations" style={{ color: '#f87171', fontWeight: 600 }}>Integrations</a> and add your Anthropic API key to enable Officer commands.
        </div>
      )}

      {/* GHL Snapshot */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Live GHL Snapshot</div>
        {snapLoad ? (
          <div style={{ color: C.muted, fontSize: 13 }}>Loading…</div>
        ) : snap ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {snap.split('\n').map((line, i) => (
              <div key={i} style={{ fontSize: 13, color: C.text, padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 7, borderLeft: `3px solid ${C.accentBdr}` }}>
                {line}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: '#f87171', fontSize: 13 }}>Could not load GHL data — check your location connection.</div>
        )}
      </div>

      {/* Quick actions */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Quick Actions</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {QUICK_ACTIONS.map(action => (
            <button
              key={action.key}
              disabled={!canRun || !snap}
              onClick={() => handleQuickAction(action)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 18px', borderRadius: 10, cursor: !canRun || !snap ? 'not-allowed' : 'pointer',
                background: activeBtn === action.key ? action.bg : 'rgba(255,255,255,0.04)',
                border: `1px solid ${activeBtn === action.key ? action.bdr : C.border}`,
                color: activeBtn === action.key ? action.color : C.text,
                fontSize: 13, fontWeight: 600, transition: 'all .15s',
                opacity: !canRun && activeBtn !== action.key ? 0.4 : 1,
              }}
              onMouseEnter={e => { if (canRun && snap) { e.currentTarget.style.background = action.bg; e.currentTarget.style.borderColor = action.bdr; e.currentTarget.style.color = action.color; } }}
              onMouseLeave={e => { if (activeBtn !== action.key) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.text; } }}
            >
              <span>{action.icon}</span>
              {activeBtn === action.key && running ? 'Running…' : action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Free-text command */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Custom Command</div>
          {clickupOk && (
            <button
              onClick={() => setPickerOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 12px', borderRadius: 8, background: 'rgba(99,102,241,0.1)', border: `1px solid ${C.accentBdr}`, color: '#a5b4fc', cursor: 'pointer' }}
            >
              ✅ Pick Task
            </button>
          )}
        </div>

        {/* Pinned task chip */}
        {pinnedTask && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '7px 12px', background: 'rgba(99,102,241,0.08)', border: `1px solid ${C.accentBdr}`, borderRadius: 8 }}>
            <span style={{ fontSize: 12, color: '#a5b4fc', fontWeight: 600, flexShrink: 0 }}>📌 Task:</span>
            <span style={{ fontSize: 12, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pinnedTask.name}</span>
            {pinnedTask.status && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: C.muted, flexShrink: 0 }}>{pinnedTask.status}</span>}
            <span style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace', flexShrink: 0 }}>{pinnedTask.id}</span>
            <button onClick={() => setPinnedTask(null)} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, padding: '0 2px', flexShrink: 0 }}>✕</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <input
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleCustomCommand()}
            placeholder={pinnedTask ? `e.g. Update this task status to "done"…` : 'e.g. Post a weekly pipeline summary to Slack and create a review task in ClickUp…'}
            disabled={!canRun}
            style={{ ...S.input, flex: 1, fontSize: 13, opacity: !canRun ? 0.4 : 1 }}
          />
          <button
            onClick={handleCustomCommand}
            disabled={!canRun || !command.trim()}
            style={{ ...S.btn, flexShrink: 0, opacity: !canRun || !command.trim() ? 0.5 : 1, cursor: !canRun || !command.trim() ? 'not-allowed' : 'pointer' }}
          >
            {running ? 'Running…' : 'Run →'}
          </button>
        </div>
      </div>

      {/* Output stream */}
      {output.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Output</div>
            <button onClick={() => setOutput([])} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer' }}>Clear</button>
          </div>
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
            {output.map((item, i) => {
              if (item.type === 'text') {
                return (
                  <div key={i} style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {item.text}
                  </div>
                );
              }
              if (item.type === 'tool_call') {
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', background: 'rgba(99,102,241,0.08)', border: `1px solid ${C.accentBdr}`, borderRadius: 8 }}>
                    <span style={{ fontSize: 12, color: '#a5b4fc', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>⚡ Tool</span>
                    <div>
                      <span style={{ fontSize: 12, color: '#a5b4fc', fontWeight: 600 }}>{item.text}</span>
                      {item.input && Object.keys(item.input).length > 0 && (
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 3, fontFamily: 'monospace' }}>
                          {JSON.stringify(item.input, null, 2).slice(0, 300)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }
              if (item.type === 'tool_result') {
                const resultStr = typeof item.result === 'string' ? item.result : JSON.stringify(item.result);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', background: C.greenBg, border: `1px solid ${C.greenBdr}`, borderRadius: 8 }}>
                    <span style={{ fontSize: 12, color: C.green, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓ Result</span>
                    <span style={{ fontSize: 11, color: C.green, fontFamily: 'monospace', wordBreak: 'break-word' }}>{resultStr.slice(0, 400)}</span>
                  </div>
                );
              }
              if (item.type === 'error') {
                return (
                  <div key={i} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, fontSize: 12, color: '#f87171' }}>
                    ⚠ {item.text}
                  </div>
                );
              }
              if (item.type === 'done') {
                return (
                  <div key={i} style={{ padding: '8px 12px', background: C.greenBg, border: `1px solid ${C.greenBdr}`, borderRadius: 8, fontSize: 12, color: C.green, fontWeight: 600 }}>
                    ✓ {item.text}
                  </div>
                );
              }
              return null;
            })}
            {running && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', color: C.muted, fontSize: 12 }}>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
                Thinking…
                <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Task picker modal */}
      {pickerOpen && (
        <TaskPickerModal
          locationId={locationId}
          onSelect={task => { setPinnedTask(task); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function IntegrationsView({ locationId }) {
  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 6 }}>Integrations</h1>
        <p style={{ fontSize: 13, color: C.muted }}>
          Connect your accounts to make Slack and ClickUp available as tools in this dashboard.
        </p>
      </div>
      {INTEGRATION_CARDS.map(card => (
        <IntegrationCard key={card.key} card={card} locationId={locationId} />
      ))}
    </div>
  );
}

// ── Affiliate Section ─────────────────────────────────────────────────────────

const AFFILIATE_COLS = [
  { key: 'name',      label: 'Name',       render: (_, r) => [r.firstName, r.lastName].filter(Boolean).join(' ') || <span style={{ color: C.muted }}>—</span> },
  { key: 'email',     label: 'Email',      render: v => v || <span style={{ color: C.muted }}>—</span> },
  { key: 'phone',     label: 'Phone',      render: v => v || <span style={{ color: C.muted }}>—</span> },
  {
    key: 'tags', label: 'Tags',
    render: (_, r) => {
      const contactTags = (r.tags || []).map(t => typeof t === 'string' ? t : t?.name || '').filter(Boolean);
      if (!contactTags.length) return <span style={{ color: C.muted }}>—</span>;
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {contactTags.map(t => (
            <span key={t} style={{ padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.25)' }}>
              {t}
            </span>
          ))}
        </div>
      );
    },
  },
  { key: 'dateAdded', label: 'Date Added', render: (v, r) => { const d = v ?? r.dateCreated ?? r.createdAt; return d ? new Date(d).toLocaleDateString() : <span style={{ color: C.muted }}>—</span>; } },
];

function AffiliateView({ locationId }) {
  const [rows,       setRows]       = useState([]);
  const [total,      setTotal]      = useState(0);
  const [page,       setPage]       = useState(1);
  const [limit]                     = useState(20);
  const [start,      setStart]      = useState('');
  const [end,        setEnd]        = useState('');
  const [email,      setEmail]      = useState('');
  const [tags,       setTags]       = useState([]);
  const [tagOpen,    setTagOpen]    = useState(false);
  const [tagSearch,  setTagSearch]  = useState('');
  const [allTags,    setAllTags]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [loaded,     setLoaded]     = useState(false);

  const headers = { 'x-location-id': locationId };

  // Fetch all location tags for the dropdown
  useEffect(() => {
    fetch('/rpt/tags', { headers: { 'x-location-id': locationId } })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.tags?.length) {
          setAllTags(d.tags);
        }
      })
      .catch(() => {});
  }, [locationId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!tagOpen) return;
    const close = e => { if (!e.target.closest('.aff-tag-dd')) { setTagOpen(false); setTagSearch(''); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [tagOpen]);

  const toggleTag = t => setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  const filteredTagOptions = allTags.filter(t => t.toLowerCase().includes(tagSearch.toLowerCase()));

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, page: p });
      if (start)       params.set('startDate', start);
      if (end)         params.set('endDate',   end);
      if (email)       params.set('email',     email);
      if (tags.length) params.set('tags',      tags.join(','));
      const r = await fetch(`/rpt/affiliates?${params}`, { headers: { 'x-location-id': locationId } });
      const d = await r.json();
      if (d.success) {
        setRows(d.data);
        setTotal(d.meta?.total ?? d.data.length);
        // Collect tags from contacts as fallback if location tags API returned nothing
        setAllTags(prev => {
          if (prev.length) return prev;
          const contactTagSet = new Set();
          (d.data || []).forEach(c => {
            (c.tags || []).forEach(t => {
              const name = typeof t === 'string' ? t : t?.name || '';
              if (name) contactTagSet.add(name);
            });
          });
          return contactTagSet.size ? [...contactTagSet].sort((a, b) => a.localeCompare(b)) : prev;
        });
      }
    } catch (_) {}
    setLoading(false);
    setLoaded(true);
  }, [locationId, limit, start, end, email, tags]);

  useEffect(() => { load(1); }, [locationId]);

  const handleLoad = () => { setPage(1); load(1); };
  const handlePage = p  => { setPage(p); load(p); };

  const totalPages = Math.ceil(total / limit);

  const tagLabel = tags.length === 0
    ? 'Filter by tag…'
    : tags.length === 1
      ? tags[0]
      : `${tags.length} tags selected`;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text }}>🤝 Affiliate</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>All contacts — filter by tag, email, or date</p>
        </div>
        {loaded && (
          <div style={{ padding: '8px 18px', borderRadius: 10, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>
            {total.toLocaleString()} contact{total !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px', marginBottom: 20 }}>
        <div className="rpt-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>

          {/* Email search */}
          <div style={{ flex: '1 1 180px', minWidth: 160 }}>
            <label style={S.label}>Search by Email</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLoad()}
              placeholder="e.g. john@example.com"
              style={{ ...S.input, width: '100%' }}
            />
          </div>

          {/* Multi-select searchable tag dropdown */}
          <div className="aff-tag-dd" style={{ flex: '1 1 260px', minWidth: 220, position: 'relative' }}>
            <label style={S.label}>Filter by Tag</label>
            <button
              onClick={() => { setTagOpen(o => !o); setTagSearch(''); }}
              style={{
                ...S.input, width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left',
                color: tags.length ? C.text : C.muted, userSelect: 'none',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                {tags.length === 0 ? 'Select tags…' : tags.length === 1 ? tags[0] : `${tags.length} tags selected`}
              </span>
              <span style={{ marginLeft: 8, fontSize: 10, color: C.muted, flexShrink: 0 }}>{tagOpen ? '▲' : '▼'}</span>
            </button>
            {tagOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
                background: '#1a1a27', border: `1px solid ${C.border}`, borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                {/* Search input */}
                <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.border}` }}>
                  <input
                    autoFocus
                    value={tagSearch}
                    onChange={e => setTagSearch(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    placeholder="Search tags…"
                    style={{ ...S.input, width: '100%', fontSize: 12, padding: '6px 10px' }}
                  />
                </div>
                {/* Clear selection */}
                {tags.length > 0 && (
                  <div
                    onClick={() => setTags([])}
                    style={{ padding: '8px 14px', fontSize: 11, cursor: 'pointer', color: '#f87171', borderBottom: `1px solid ${C.border}` }}
                  >
                    ✕ Clear selection ({tags.length})
                  </div>
                )}
                {/* Options list */}
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {filteredTagOptions.length === 0 && (
                    <div style={{ padding: '10px 14px', fontSize: 12, color: C.muted }}>
                      {allTags.length === 0 ? 'Loading tags…' : 'No tags match'}
                    </div>
                  )}
                  {filteredTagOptions.map(t => {
                    const checked = tags.includes(t);
                    return (
                      <div
                        key={t}
                        onClick={() => toggleTag(t)}
                        style={{
                          padding: '8px 14px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                          background: checked ? 'rgba(99,102,241,0.1)' : 'transparent',
                          color: checked ? '#a5b4fc' : C.text,
                        }}
                      >
                        <span style={{
                          width: 14, height: 14, borderRadius: 4, border: `1px solid ${checked ? C.accent : C.dim}`,
                          background: checked ? C.accent : 'transparent', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', flexShrink: 0, fontSize: 9, color: '#fff',
                        }}>{checked ? '✓' : ''}</span>
                        {t}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Start date */}
          <div style={{ flex: '0 0 140px' }}>
            <label style={S.label}>Start Date</label>
            <input type="date" value={start} onChange={e => setStart(e.target.value)} style={{ ...S.input, width: '100%' }} />
          </div>

          {/* End date */}
          <div style={{ flex: '0 0 140px' }}>
            <label style={S.label}>End Date</label>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={{ ...S.input, width: '100%' }} />
          </div>

          {/* Load button */}
          <div style={{ flex: '0 0 auto' }}>
            <button
              onClick={handleLoad}
              disabled={loading}
              style={{ ...S.btn, opacity: loading ? 0.6 : 1, whiteSpace: 'nowrap' }}
            >
              {loading ? 'Loading…' : '⟳ Load'}
            </button>
          </div>
        </div>

        {/* Active filter pills */}
        {(tags.length > 0 || email || start || end) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {tags.map(t => (
              <span key={t} onClick={() => toggleTag(t)} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.25)', cursor: 'pointer' }}>
                {t} ✕
              </span>
            ))}
            {email && <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)' }}>Email: {email}</span>}
            {start && <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)' }}>From: {start}</span>}
            {end   && <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)' }}>To: {end}</span>}
            <button
              onClick={() => { setTags([]); setEmail(''); setStart(''); setEnd(''); }}
              style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}
            >✕ Clear all</button>
          </div>
        )}
      </div>

      {/* Table */}
      <DataTable columns={AFFILIATE_COLS} rows={rows} loading={loading} loaded={loaded} />

      {/* Pagination */}
      {loaded && total > limit && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 12, color: C.muted }}>
            Showing {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total.toLocaleString()}
          </span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button
              onClick={() => handlePage(1)}
              disabled={page === 1}
              style={{ padding: '6px 10px', borderRadius: 7, border: `1px solid ${C.border}`, background: 'transparent', color: page === 1 ? C.dim : C.text, cursor: page === 1 ? 'default' : 'pointer', fontSize: 12 }}
            >«</button>
            <button
              onClick={() => handlePage(page - 1)}
              disabled={page === 1}
              style={{ padding: '6px 10px', borderRadius: 7, border: `1px solid ${C.border}`, background: 'transparent', color: page === 1 ? C.dim : C.text, cursor: page === 1 ? 'default' : 'pointer', fontSize: 12 }}
            >‹</button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p;
              if (totalPages <= 7) p = i + 1;
              else if (page <= 4)  p = i + 1;
              else if (page >= totalPages - 3) p = totalPages - 6 + i;
              else p = page - 3 + i;
              return (
                <button
                  key={p}
                  onClick={() => handlePage(p)}
                  style={{
                    padding: '6px 11px', borderRadius: 7, fontSize: 12, fontWeight: p === page ? 700 : 400,
                    border: `1px solid ${p === page ? C.accent : C.border}`,
                    background: p === page ? C.accentBg : 'transparent',
                    color: p === page ? '#a5b4fc' : C.text,
                    cursor: 'pointer',
                  }}
                >{p}</button>
              );
            })}
            <button
              onClick={() => handlePage(page + 1)}
              disabled={page === totalPages}
              style={{ padding: '6px 10px', borderRadius: 7, border: `1px solid ${C.border}`, background: 'transparent', color: page === totalPages ? C.dim : C.text, cursor: page === totalPages ? 'default' : 'pointer', fontSize: 12 }}
            >›</button>
            <button
              onClick={() => handlePage(totalPages)}
              disabled={page === totalPages}
              style={{ padding: '6px 10px', borderRadius: 7, border: `1px solid ${C.border}`, background: 'transparent', color: page === totalPages ? C.dim : C.text, cursor: page === totalPages ? 'default' : 'pointer', fontSize: 12 }}
            >»</button>
          </div>
        </div>
      )}
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
  affiliate:     '/affiliate',
  integrations:  '/integrations',
  officer:       '/officer',
};

// ── Root component ────────────────────────────────────────────────────────────

export default function Reporting() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [locationId,    setLocationId]    = useState(() => localStorage.getItem('rpt_location_id') || '');
  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [oppPipelineId, setOppPipelineId] = useState('');

  // Derive section + billing sub-tab from URL
  const segs    = pathname.replace(/^\//, '').split('/');
  const section = { contacts: 'contacts', opportunities: 'opportunities', conversations: 'conversations', billing: 'billing', affiliate: 'affiliate', integrations: 'integrations', officer: 'officer' }[segs[0]] || 'dashboard';
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

  const SECTION_LABELS = { dashboard: 'Overview', contacts: 'Contacts', opportunities: 'Opportunities', conversations: 'Conversations', billing: 'Billing', affiliate: 'Affiliate', integrations: 'Integrations', officer: 'Reporting Officer' };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: C.bg, fontFamily: 'system-ui, -apple-system, sans-serif', color: C.text }}>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        select option { background: #1a1a2e; color: #e2e8f0; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }

        /* Sidebar — desktop: always visible, mobile: slide-in overlay */
        .rpt-sidebar {
          position: relative;
          z-index: 50;
        }
        .rpt-close-btn { display: none; }
        .rpt-hamburger { display: none; }
        .rpt-topbar { display: none; }

        @media (max-width: 768px) {
          .rpt-sidebar {
            position: fixed;
            top: 0; left: 0;
            height: 100vh;
            transform: translateX(-100%);
            z-index: 50;
          }
          .rpt-sidebar--open {
            transform: translateX(0);
          }
          .rpt-close-btn { display: block; }
          .rpt-hamburger { display: flex; }
          .rpt-topbar {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            background: ${C.sidebar};
            border-bottom: 1px solid ${C.border};
            position: sticky;
            top: 0;
            z-index: 10;
            flex-shrink: 0;
          }
        }
      `}</style>

      {/* Sidebar — always in DOM, slide-in on mobile */}
      <Sidebar
        section={section}
        billingTab={billingTab}
        onNav={handleNav}
        onBillingTab={handleBillingTab}
        locationId={locationId}
        onDisconnect={handleDisconnect}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main content — full width on mobile */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Mobile top bar */}
        <div className="rpt-topbar">
          <button
            className="rpt-hamburger"
            onClick={() => setSidebarOpen(true)}
            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '6px 10px' }}
          >☰</button>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
            {SECTION_LABELS[section] || 'Reporting'}
          </span>
        </div>

        <main style={{ flex: 1, overflowY: 'auto', padding: '34px 40px' }} className="rpt-main">
          <style>{`
            @media (max-width: 768px) {
              .rpt-main { padding: 16px 12px !important; }
              .rpt-dash-header { flex-direction: column !important; align-items: stretch !important; }
              .rpt-dash-dates  { flex-direction: column !important; align-items: stretch !important; }
              .rpt-dash-dates input[type="date"] { width: 100% !important; }
              .rpt-stat-cards  { flex-direction: column !important; }
              .rpt-stat-cards > * { min-width: 0 !important; }
              .rpt-charts-grid { grid-template-columns: 1fr !important; }
              .rpt-leads-box   { padding: 16px 14px !important; }
              .rpt-table-wrap  { overflow-x: auto !important; }
              .rpt-filters     { flex-direction: column !important; align-items: stretch !important; }
              .rpt-filters input, .rpt-filters select { width: 100% !important; }
            }
          `}</style>
          {section === 'dashboard'     && <DashboardView     locationId={locationId} oppPipelineId={oppPipelineId} onOppPipelineChange={setOppPipelineId} />}
          {section === 'contacts'      && <ContactsView      locationId={locationId} />}
          {section === 'opportunities' && <OpportunitiesView locationId={locationId} initialPipelineId={oppPipelineId} />}
          {section === 'conversations' && <ConversationsView locationId={locationId} />}
          {section === 'billing'       && <BillingView       locationId={locationId} tab={billingTab} />}
          {section === 'affiliate'     && <AffiliateView     locationId={locationId} />}
          {section === 'integrations'  && <IntegrationsView  locationId={locationId} />}
          {section === 'officer'       && <OfficerView       locationId={locationId} />}
        </main>
      </div>
    </div>
  );
}
