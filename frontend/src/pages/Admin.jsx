/**
 * frontend/src/pages/Admin.jsx
 *
 * Admin Dashboard — separate from the user-facing app.
 * Uses its own admin key (x-admin-key) stored in localStorage.
 *
 * Tabs:
 *   Overview  — aggregate stats (total/active/idle/expired/uninstalled)
 *   Locations — table of all registered locations with actions
 *   Logs      — filterable activity log viewer
 */

import { useState, useEffect, useCallback, useRef } from 'react';

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const h = () => setM(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return m;
}

// ── API helper ────────────────────────────────────────────────────────────────

const BASE = '';

async function adminFetch(path, { method = 'GET', adminKey, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'x-admin-key':  adminKey,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    active:      { bg: '#1a3a2a', color: '#4ade80', label: 'Active' },
    idle:        { bg: '#3a2e0a', color: '#facc15', label: 'Idle' },
    expired:     { bg: '#3a1a1a', color: '#f87171', label: 'Expired' },
    none:        { bg: '#2a2a2a', color: '#9ca3af', label: 'No Token' },
    uninstalled: { bg: '#1e1e1e', color: '#6b7280', label: 'Uninstalled' },
  };
  const s = map[status] || map.none;
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
    }}>
      {s.label}
    </span>
  );
}

// ── Relative time helper ──────────────────────────────────────────────────────

function relTime(val) {
  if (!val) return '—';
  const ms   = typeof val === 'number' ? val : new Date(val).getTime();
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Event badge ───────────────────────────────────────────────────────────────

const EVENT_COLORS = {
  install:           '#4ade80',
  uninstall:         '#f87171',
  restore:           '#60a5fa',
  tool_connect:      '#34d399',
  tool_disconnect:   '#fb923c',
  tool_reconnect:    '#a78bfa',
  tool_call:         '#94a3b8',
  workflow_trigger:  '#f0abfc',
  admin_refresh:     '#fbbf24',
  admin_revoke:      '#f43f5e',
};

function EventBadge({ event }) {
  const color = EVENT_COLORS[event] || '#9ca3af';
  return (
    <span style={{ color, fontFamily: 'monospace', fontSize: 12 }}>{event}</span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Admin() {
  const isMobile = useIsMobile();

  const [adminKey,   setAdminKey]   = useState(() => localStorage.getItem('gtm_admin_key') || '');
  const [keyInput,   setKeyInput]   = useState('');
  const [authed,     setAuthed]     = useState(false);
  const [authError,  setAuthError]  = useState('');
  const [tab,        setTab]        = useState('overview');

  const [stats,      setStats]      = useState(null);
  const [locations,  setLocations]  = useState([]);
  const [logs,       setLogs]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [actionMsg,  setActionMsg]  = useState('');

  const [logFilter,       setLogFilter]       = useState({ locationId: '', event: '' });
  const [expandedId,        setExpandedId]        = useState(null);
  const [detailData,        setDetailData]        = useState({});
  const [troubleshootData,  setTroubleshootData]  = useState({}); // { [locationId]: { connections, workflows } }
  const [workflowRunLogs,   setWorkflowRunLogs]   = useState({}); // { [locationId]: [] }

  // App Settings state
  const [appSettingsData,   setAppSettingsData]   = useState(null);
  const [appSettingsForm,   setAppSettingsForm]   = useState({ clientId: '', clientSecret: '', redirectUri: 'https://claudeserver.vercel.app/oauth/callback' });
  const [appSettingsEdit,   setAppSettingsEdit]   = useState({ clientId: false, clientSecret: false, redirectUri: false });
  const [appSettingsSaving, setAppSettingsSaving] = useState(false);

  // Billing state
  const [billingRecords,  setBillingRecords]  = useState([]);
  const [billingSummary,  setBillingSummary]  = useState(null);
  const [billingExpanded, setBillingExpanded] = useState(null);
  const [billingModal,    setBillingModal]    = useState(null); // { type, locationId, data }
  const [billingLoading,  setBillingLoading]  = useState(false);

  // ── Auth ─────────────────────────────────────────────────────────────────

  const login = async (key) => {
    setAuthError('');
    try {
      const data = await adminFetch('/admin/stats', { adminKey: key });
      if (data.success) {
        setAdminKey(key);
        setAuthed(true);
        localStorage.setItem('gtm_admin_key', key);
        setStats(data.stats);
        setLogs(data.recentActivity || []);
      } else {
        setAuthError(data.error || 'Invalid admin key.');
      }
    } catch {
      setAuthError('Connection failed.');
    }
  };

  const logout = () => {
    localStorage.removeItem('gtm_admin_key');
    setAdminKey(''); setAuthed(false); setStats(null); setLocations([]);
  };

  // Auto-login on mount
  useEffect(() => {
    if (adminKey) login(adminKey);
  }, []); // eslint-disable-line

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadLocations = useCallback(async () => {
    setLoading(true);
    const data = await adminFetch('/admin/locations', { adminKey });
    if (data.success) setLocations(data.data || []);
    setLoading(false);
  }, [adminKey]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (logFilter.locationId) q.set('locationId', logFilter.locationId);
    if (logFilter.event)      q.set('event', logFilter.event);
    q.set('limit', '200');
    const data = await adminFetch(`/admin/logs?${q}`, { adminKey });
    if (data.success) setLogs(data.data || []);
    setLoading(false);
  }, [adminKey, logFilter]);

  const loadStats = useCallback(async () => {
    const data = await adminFetch('/admin/stats', { adminKey });
    if (data.success) { setStats(data.stats); setLogs(data.recentActivity || []); }
  }, [adminKey]);

  const loadAppSettings = useCallback(async () => {
    const data = await adminFetch('/admin/app-settings', { adminKey });
    if (data.success) setAppSettingsData(data.data);
  }, [adminKey]);

  const loadBilling = useCallback(async () => {
    setBillingLoading(true);
    const data = await adminFetch('/admin/billing', { adminKey });
    if (data.success) { setBillingRecords(data.data || []); setBillingSummary(data.summary); }
    setBillingLoading(false);
  }, [adminKey]);

  useEffect(() => {
    if (!authed) return;
    if (tab === 'overview')     loadStats();
    if (tab === 'locations')    loadLocations();
    if (tab === 'logs')         loadLogs();
    if (tab === 'app-settings') loadAppSettings();
    if (tab === 'billing')      loadBilling();
  }, [authed, tab]); // eslint-disable-line

  // ── Actions ──────────────────────────────────────────────────────────────

  const flash = (msg) => { setActionMsg(msg); setTimeout(() => setActionMsg(''), 3500); };

  const doAction = async (path, label) => {
    const data = await adminFetch(path, { method: 'POST', adminKey });
    if (data.success) {
      flash(`✓ ${label}`);
      loadLocations();
      loadStats();
    } else {
      flash(`✗ ${data.error}`);
    }
  };

  const loadDetail = async (locationId) => {
    if (expandedId === locationId) { setExpandedId(null); return; }
    setExpandedId(locationId);
    if (!detailData[locationId]) {
      const data = await adminFetch(`/admin/locations/${locationId}`, { adminKey });
      if (data.success) setDetailData((prev) => ({ ...prev, [locationId]: data.data }));
    }
    if (!troubleshootData[locationId]) {
      const [connRes, wfRes, logsRes] = await Promise.all([
        adminFetch(`/admin/locations/${locationId}/connections`, { adminKey }),
        adminFetch(`/admin/locations/${locationId}/workflows`, { adminKey }),
        adminFetch(`/admin/logs?locationId=${locationId}&event=workflow_trigger&limit=50`, { adminKey }),
      ]);
      setTroubleshootData((prev) => ({
        ...prev,
        [locationId]: {
          connections: connRes.success ? connRes.data : {},
          workflows:   wfRes.success   ? wfRes.data  : [],
        },
      }));
      setWorkflowRunLogs((prev) => ({
        ...prev,
        [locationId]: logsRes.success ? logsRes.data : [],
      }));
    }
  };

  const clearConnection = async (locationId, category) => {
    if (!confirm(`Clear ${category} connection for ${locationId}? The user will need to reconnect it.`)) return;
    const res = await adminFetch(`/admin/locations/${locationId}/connections/${category}`, { method: 'DELETE', adminKey });
    if (res.success) {
      flash(`✓ Cleared ${category} for ${locationId}`);
      // Refresh troubleshoot data
      setTroubleshootData((prev) => {
        const loc = prev[locationId] || {};
        const newConn = { ...loc.connections };
        delete newConn[category];
        return { ...prev, [locationId]: { ...loc, connections: newConn } };
      });
      setDetailData((prev) => {
        const d = prev[locationId];
        if (!d) return prev;
        return { ...prev, [locationId]: { ...d, connectedCategories: (d.connectedCategories || []).filter(c => c !== category) } };
      });
    } else {
      flash(`✗ ${res.error}`);
    }
  };

  const deleteWorkflow = async (locationId, wfId, wfName) => {
    if (!confirm(`Delete workflow "${wfName}"?`)) return;
    const res = await adminFetch(`/admin/locations/${locationId}/workflows/${wfId}`, { method: 'DELETE', adminKey });
    if (res.success) {
      flash(`✓ Deleted workflow "${wfName}"`);
      setTroubleshootData((prev) => {
        const loc = prev[locationId] || {};
        return { ...prev, [locationId]: { ...loc, workflows: (loc.workflows || []).filter(w => w.id !== wfId) } };
      });
    } else {
      flash(`✗ ${res.error}`);
    }
  };

  // ── Login screen ──────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: '32px 24px', width: '100%', maxWidth: 360 }}>
          <h2 style={{ color: '#fff', margin: '0 0 8px', fontSize: 22 }}>Admin Access</h2>
          <p style={{ color: '#888', margin: '0 0 24px', fontSize: 14 }}>Enter your ADMIN_API_KEY to continue.</p>
          <input
            type="password"
            placeholder="Admin API key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && login(keyInput)}
            style={{ width: '100%', padding: '10px 14px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 14, boxSizing: 'border-box', marginBottom: 12 }}
          />
          {authError && <p style={{ color: '#f87171', fontSize: 13, margin: '0 0 12px' }}>{authError}</p>}
          <button
            onClick={() => login(keyInput)}
            style={{ width: '100%', padding: '10px', background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  const TAB_STYLE = (active) => ({
    padding: '8px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500,
    background: active ? '#7c3aed' : 'transparent',
    color: active ? '#fff' : '#9ca3af',
    border: 'none',
  });

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ background: '#1a1a1a', borderBottom: '1px solid #2a2a2a', padding: isMobile ? '12px 16px' : '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🛡️</span>
          <span style={{ fontWeight: 700, fontSize: isMobile ? 15 : 18, color: '#fff' }}>HL Pro Tools — Admin</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => { loadStats(); loadLocations(); }} style={{ background: 'none', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}>↻</button>
          <button onClick={logout} style={{ background: 'none', border: '1px solid #333', borderRadius: 8, color: '#f87171', padding: '6px 10px', cursor: 'pointer', fontSize: 12 }}>Sign Out</button>
        </div>
      </div>

      {/* Action flash message */}
      {actionMsg && (
        <div style={{ background: actionMsg.startsWith('✓') ? '#14532d' : '#450a0a', color: '#fff', padding: '10px 28px', fontSize: 14 }}>
          {actionMsg}
        </div>
      )}

      <div style={{ padding: isMobile ? '16px 12px' : '24px 28px' }}>

        {/* Stats cards */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Total Locations', value: stats.total,       color: '#fff' },
              { label: 'Active',          value: stats.active,      color: '#4ade80' },
              { label: 'Idle (3+ days)',  value: stats.idle,        color: '#facc15' },
              { label: 'Expired (7+ d)', value: stats.expired,      color: '#f87171' },
              { label: 'Uninstalled',    value: stats.uninstalled,   color: '#6b7280' },
            ].map((c) => (
              <div key={c.label} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '16px 20px' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: c.color }}>{c.value ?? '—'}</div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{c.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { key: 'overview',     label: 'Overview' },
            { key: 'locations',    label: 'Locations' },
            { key: 'logs',         label: 'Logs' },
            { key: 'billing',      label: '💳 Billing' },
            { key: 'app-settings', label: '⚙️ App Settings' },
          ].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={TAB_STYLE(tab === t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── App Settings Tab ─────────────────────────────────────────── */}
        {tab === 'app-settings' && (
          <div style={{ maxWidth: 560 }}>
            <h3 style={{ color: '#fff', margin: '0 0 6px', fontSize: 16 }}>GHL App Credentials</h3>
            <p style={{ color: '#9ca3af', fontSize: 13, margin: '0 0 24px' }}>
              Set your GoHighLevel Marketplace App credentials. These are used for the OAuth install flow and token exchange.
              {appSettingsData?.configured
                ? <span style={{ color: '#4ade80', marginLeft: 8 }}>✓ Configured</span>
                : <span style={{ color: '#f87171', marginLeft: 8 }}>✗ Not yet configured</span>}
            </p>

            {[
              { key: 'clientId',     label: 'GHL Client ID',     type: 'text',     placeholder: 'Enter Client ID from GHL Marketplace App' },
              { key: 'clientSecret', label: 'GHL Client Secret', type: 'password', placeholder: 'Enter Client Secret' },
              { key: 'redirectUri',  label: 'Redirect URI',      type: 'text',     placeholder: 'https://claudeserver.vercel.app/oauth/callback' },
            ].map((f) => {
              const hasDb  = !!(appSettingsData?.[f.key]);
              const isEdit = appSettingsEdit[f.key];
              const dbVal  = appSettingsData?.[f.key] || '';

              return (
                <div key={f.key} style={{ marginBottom: 18 }}>
                  <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {f.label}
                    {hasDb && !isEdit && <span style={{ color: '#4ade80', marginLeft: 8, textTransform: 'none', fontWeight: 400 }}>✓ saved</span>}
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <input
                        type={isEdit || !hasDb ? f.type : 'text'}
                        value={isEdit ? appSettingsForm[f.key] : hasDb ? dbVal : appSettingsForm[f.key]}
                        readOnly={hasDb && !isEdit}
                        onChange={(e) => {
                          if (hasDb && !isEdit) return;
                          setAppSettingsForm((p) => ({ ...p, [f.key]: e.target.value }));
                        }}
                        placeholder={isEdit ? `Enter new ${f.label}…` : !hasDb ? f.placeholder : ''}
                        style={{
                          width: '100%', padding: '10px 36px 10px 12px', boxSizing: 'border-box',
                          background: hasDb && !isEdit ? 'rgba(255,255,255,0.03)' : '#1a1a1a',
                          border: '1px solid #333', borderRadius: 8, color: hasDb && !isEdit ? '#6b7280' : '#fff',
                          fontSize: 13, cursor: hasDb && !isEdit ? 'default' : 'text',
                        }}
                      />
                      {hasDb && !isEdit && (
                        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 12 }}>🔒</span>
                      )}
                    </div>
                    {hasDb ? (
                      isEdit ? (
                        <button
                          onClick={() => setAppSettingsEdit((p) => ({ ...p, [f.key]: false }))}
                          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid #444', borderRadius: 8, color: '#9ca3af', padding: '0 12px', cursor: 'pointer', fontSize: 13 }}
                        >✕</button>
                      ) : (
                        <button
                          onClick={() => {
                            setAppSettingsEdit((p) => ({ ...p, [f.key]: true }));
                            setAppSettingsForm((p) => ({ ...p, [f.key]: '' }));
                          }}
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #444', borderRadius: 8, color: '#9ca3af', padding: '0 12px', cursor: 'pointer', fontSize: 14 }}
                        >✏️</button>
                      )
                    ) : null}
                  </div>
                </div>
              );
            })}

            <button
              disabled={appSettingsSaving}
              onClick={async () => {
                const payload = {};
                ['clientId', 'clientSecret', 'redirectUri'].forEach((k) => {
                  if (appSettingsForm[k].trim()) payload[k] = appSettingsForm[k].trim();
                });
                if (!Object.keys(payload).length) { flash('No changes to save.'); return; }
                setAppSettingsSaving(true);
                const data = await adminFetch('/admin/app-settings', { method: 'POST', adminKey, body: payload });
                setAppSettingsSaving(false);
                if (data.success) {
                  flash('✓ GHL app credentials saved.');
                  setAppSettingsEdit({ clientId: false, clientSecret: false, redirectUri: false });
                  setAppSettingsForm({ clientId: '', clientSecret: '', redirectUri: '' });
                  loadAppSettings();
                } else {
                  flash(`✗ ${data.error}`);
                }
              }}
              style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: appSettingsSaving ? 0.6 : 1 }}
            >
              {appSettingsSaving ? 'Saving…' : 'Save Credentials'}
            </button>

            <div style={{ marginTop: 28, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: 16 }}>
              <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>
                <strong style={{ color: '#e5e7eb' }}>Install URL:</strong>{' '}
                <code style={{ color: '#a5b4fc' }}>https://claudeserver.vercel.app/oauth/install</code>
              </p>
              <p style={{ color: '#9ca3af', fontSize: 12, margin: '8px 0 0' }}>
                <strong style={{ color: '#e5e7eb' }}>Callback / Redirect URI:</strong>{' '}
                <code style={{ color: '#a5b4fc' }}>https://claudeserver.vercel.app/oauth/callback</code>
              </p>
              <p style={{ color: '#9ca3af', fontSize: 12, margin: '8px 0 0' }}>
                <strong style={{ color: '#e5e7eb' }}>Webhook URL:</strong>{' '}
                <code style={{ color: '#a5b4fc' }}>https://claudeserver.vercel.app/webhooks/ghl</code>
              </p>
            </div>
          </div>
        )}

        {/* ── Overview Tab ─────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div>
            <h3 style={{ color: '#fff', margin: '0 0 16px', fontSize: 16 }}>Recent Activity</h3>
            <LogTable logs={logs} />
          </div>
        )}

        {/* ── Locations Tab ────────────────────────────────────────────── */}
        {tab === 'locations' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ color: '#fff', margin: 0, fontSize: 16 }}>
                All Locations {loading ? '…' : `(${locations.length})`}
              </h3>
              <button onClick={loadLocations} style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>↻ Reload</button>
            </div>

            <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 600 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#9ca3af', textAlign: 'left' }}>
                    {['Location ID', 'Status', 'Integrations', 'Last Active', 'Installed', 'Actions'].map((h) => (
                      <th key={h} style={{ padding: '10px 14px', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {locations.map((loc) => (
                    <>
                      <tr
                        key={loc.locationId}
                        onClick={() => loadDetail(loc.locationId)}
                        style={{ borderBottom: '1px solid #222', cursor: 'pointer', background: expandedId === loc.locationId ? '#1e1e2e' : 'transparent' }}
                      >
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#a78bfa' }}>
                          {loc.locationId}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <StatusBadge status={loc.status === 'uninstalled' ? 'uninstalled' : loc.tokenStatus || 'none'} />
                        </td>
                        <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                          {loc.integrations ?? '—'}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                          {relTime(loc.lastActive)}
                          {loc.tokenIdleDays > 0 && (
                            <span style={{ marginLeft: 6, color: '#facc15', fontSize: 11 }}>
                              ({loc.tokenIdleDays}d idle)
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: 12 }}>
                          {loc.installedAt ? new Date(loc.installedAt).toLocaleDateString() : '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <ActionBtn
                              title="Refresh connection"
                              icon="↻"
                              color="#7c3aed"
                              onClick={() => doAction(`/admin/locations/${loc.locationId}/refresh`, `Refreshed ${loc.locationId}`)}
                            />
                            {loc.status === 'uninstalled' ? (
                              <ActionBtn
                                title="Restore location"
                                icon="⟳"
                                color="#059669"
                                onClick={() => doAction(`/admin/locations/${loc.locationId}/restore`, `Restored ${loc.locationId}`)}
                              />
                            ) : (
                              <ActionBtn
                                title="Revoke token (force reconnect)"
                                icon="✕"
                                color="#dc2626"
                                onClick={() => doAction(`/admin/locations/${loc.locationId}/revoke`, `Token revoked for ${loc.locationId}`)}
                              />
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {expandedId === loc.locationId && detailData[loc.locationId] && (
                        <tr key={`${loc.locationId}-detail`}>
                          <td colSpan={6} style={{ padding: '0 14px 14px', background: '#111' }}>
                            <DetailPanel
                              data={detailData[loc.locationId]}
                              troubleshoot={troubleshootData[loc.locationId]}
                              workflowRunLogs={workflowRunLogs[loc.locationId] || []}
                              onClearConnection={(cat) => clearConnection(loc.locationId, cat)}
                              onDeleteWorkflow={(id, name) => deleteWorkflow(loc.locationId, id, name)}
                            />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                  {locations.length === 0 && !loading && (
                    <tr>
                      <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                        No locations registered yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Logs Tab ─────────────────────────────────────────────────── */}
        {tab === 'logs' && (
          <div>
            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                placeholder="Filter by locationId…"
                value={logFilter.locationId}
                onChange={(e) => setLogFilter((f) => ({ ...f, locationId: e.target.value }))}
                style={{ padding: '8px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, width: '100%', maxWidth: 260 }}
              />
              <select
                value={logFilter.event}
                onChange={(e) => setLogFilter((f) => ({ ...f, event: e.target.value }))}
                style={{ padding: '8px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13 }}
              >
                <option value="">All events</option>
                {['install','uninstall','restore','tool_connect','tool_disconnect','tool_reconnect','tool_call','workflow_trigger','admin_refresh','admin_revoke'].map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
              <button onClick={loadLogs} style={{ padding: '8px 16px', background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, cursor: 'pointer' }}>
                Apply
              </button>
              <span style={{ color: '#6b7280', fontSize: 13 }}>
                {loading ? 'Loading…' : `${logs.length} entries`}
              </span>
            </div>
            <LogTable logs={logs} />
          </div>
        )}

        {/* ── Billing Tab ──────────────────────────────────────────────── */}
        {tab === 'billing' && (
          <div>
            {/* Summary cards */}
            {billingSummary && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10, marginBottom: 20 }}>
                {[
                  { label: 'Total',      value: billingSummary.total,     color: '#e5e7eb' },
                  { label: 'Active',     value: billingSummary.active,    color: '#4ade80' },
                  { label: 'Trial',      value: billingSummary.trial,     color: '#60a5fa' },
                  { label: 'Past Due',   value: billingSummary.pastDue,   color: '#f87171' },
                  { label: 'Cancelled',  value: billingSummary.cancelled, color: '#6b7280' },
                  { label: 'MRR (USD)',  value: `$${billingSummary.revenue}`, color: '#34d399' },
                ].map(c => (
                  <div key={c.label} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: c.color }}>{c.value ?? '—'}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{c.label}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ color: '#fff', margin: 0, fontSize: 16 }}>
                All Billing Records {billingLoading ? '…' : `(${billingRecords.length})`}
              </h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setBillingModal({ type: 'new-subscription', locationId: '', data: {} })}
                  style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}
                >
                  + New Record
                </button>
                <button onClick={loadBilling} style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>↻ Reload</button>
              </div>
            </div>

            <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#9ca3af', textAlign: 'left' }}>
                    {['Location ID', 'Plan', 'Status', 'Amount', 'Payment Method', 'Next Renewal', 'Invoices', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {billingRecords.map(rec => {
                    const statusColor = { active: '#4ade80', trial: '#60a5fa', past_due: '#f87171', cancelled: '#6b7280', suspended: '#fb923c' }[rec.status] || '#9ca3af';
                    return (
                      <>
                        <tr
                          key={rec.locationId}
                          onClick={() => setBillingExpanded(billingExpanded === rec.locationId ? null : rec.locationId)}
                          style={{ borderBottom: '1px solid #222', cursor: 'pointer', background: billingExpanded === rec.locationId ? '#1a1a2a' : 'transparent' }}
                        >
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#a78bfa', fontSize: 12 }}>{rec.locationId}</td>
                          <td style={{ padding: '10px 14px', textTransform: 'capitalize', color: '#e5e7eb' }}>{rec.plan}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ color: statusColor, fontWeight: 600, fontSize: 12 }}>{rec.status?.replace('_', ' ')}</span>
                          </td>
                          <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                            {rec.amount > 0 ? `$${rec.amount}/${rec.interval || 'mo'}` : 'Free'}
                          </td>
                          <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: 12 }}>
                            {rec.paymentMethod ? `${rec.paymentMethod.brand} ••••${rec.paymentMethod.last4}` : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: 12 }}>
                            {rec.currentPeriodEnd ? new Date(rec.currentPeriodEnd).toLocaleDateString() : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                            {(rec.invoices || []).length}
                          </td>
                          <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: 5 }}>
                              <ActionBtn icon="✏️" title="Edit subscription" color="#7c3aed"
                                onClick={() => setBillingModal({ type: 'edit-subscription', locationId: rec.locationId, data: rec })} />
                              <ActionBtn icon="＋" title="Add invoice" color="#059669"
                                onClick={() => setBillingModal({ type: 'add-invoice', locationId: rec.locationId, data: {} })} />
                              <ActionBtn icon="🗑" title="Delete all billing data" color="#dc2626"
                                onClick={async () => {
                                  if (!confirm(`Delete ALL billing data for ${rec.locationId}?`)) return;
                                  await adminFetch(`/admin/billing/${rec.locationId}`, { method: 'DELETE', adminKey });
                                  flash(`✓ Deleted billing for ${rec.locationId}`);
                                  loadBilling();
                                }} />
                            </div>
                          </td>
                        </tr>

                        {/* Invoice rows */}
                        {billingExpanded === rec.locationId && (
                          <tr key={`${rec.locationId}-inv`}>
                            <td colSpan={8} style={{ padding: '0 14px 14px', background: '#111' }}>
                              <div style={{ marginTop: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                  <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invoices</span>
                                  <button
                                    onClick={() => setBillingModal({ type: 'add-invoice', locationId: rec.locationId, data: {} })}
                                    style={{ background: 'none', border: '1px solid #059669', borderRadius: 6, color: '#059669', padding: '2px 10px', cursor: 'pointer', fontSize: 12 }}
                                  >+ Add Invoice</button>
                                </div>
                                {(rec.invoices || []).length === 0 ? (
                                  <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>No invoices yet.</p>
                                ) : (
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                    <thead>
                                      <tr style={{ color: '#6b7280', textAlign: 'left' }}>
                                        {['ID', 'Description', 'Amount', 'Status', 'Date', 'Actions'].map(h => (
                                          <th key={h} style={{ padding: '4px 10px', fontWeight: 500 }}>{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(rec.invoices || []).map(inv => {
                                        const invColor = { paid: '#4ade80', pending: '#facc15', overdue: '#f87171', refunded: '#6b7280', void: '#6b7280' }[inv.status] || '#9ca3af';
                                        return (
                                          <tr key={inv.id} style={{ borderTop: '1px solid #1e1e1e' }}>
                                            <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: '#6b7280' }}>{inv.id?.slice(-8)}</td>
                                            <td style={{ padding: '5px 10px', color: '#e5e7eb' }}>{inv.description}</td>
                                            <td style={{ padding: '5px 10px', color: '#94a3b8' }}>${inv.amount}</td>
                                            <td style={{ padding: '5px 10px' }}>
                                              <span style={{ color: invColor, fontWeight: 600 }}>{inv.status}</span>
                                            </td>
                                            <td style={{ padding: '5px 10px', color: '#6b7280' }}>
                                              {inv.date ? new Date(inv.date).toLocaleDateString() : '—'}
                                            </td>
                                            <td style={{ padding: '5px 10px' }}>
                                              <div style={{ display: 'flex', gap: 4 }}>
                                                <ActionBtn icon="✏️" title="Edit invoice" color="#7c3aed"
                                                  onClick={() => setBillingModal({ type: 'edit-invoice', locationId: rec.locationId, data: inv })} />
                                                {inv.status === 'paid' && (
                                                  <ActionBtn icon="↩" title="Refund" color="#f97316"
                                                    onClick={async () => {
                                                      if (!confirm(`Refund $${inv.amount} invoice?`)) return;
                                                      await adminFetch(`/admin/billing/${rec.locationId}/refund/${inv.id}`, { method: 'POST', adminKey });
                                                      flash(`✓ Refunded ${inv.id}`);
                                                      loadBilling();
                                                    }} />
                                                )}
                                                <ActionBtn icon="🗑" title="Delete invoice" color="#dc2626"
                                                  onClick={async () => {
                                                    if (!confirm('Delete this invoice?')) return;
                                                    await adminFetch(`/admin/billing/${rec.locationId}/invoice/${inv.id}`, { method: 'DELETE', adminKey });
                                                    flash(`✓ Invoice deleted`);
                                                    loadBilling();
                                                  }} />
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                                {rec.notes && (
                                  <p style={{ color: '#6b7280', fontSize: 12, marginTop: 8, fontStyle: 'italic' }}>📝 {rec.notes}</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {billingRecords.length === 0 && !billingLoading && (
                    <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>No billing records yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Billing Modal */}
            {billingModal && (
              <BillingModal
                modal={billingModal}
                adminKey={adminKey}
                onClose={() => setBillingModal(null)}
                onSaved={() => { setBillingModal(null); loadBilling(); flash('✓ Saved'); }}
                onFlash={flash}
              />
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ── Billing Modal ─────────────────────────────────────────────────────────────

function BillingModal({ modal, adminKey, onClose, onSaved, onFlash }) {
  const [form, setForm] = useState({
    locationId:  modal.data?.locationId || modal.locationId || '',
    plan:        modal.data?.plan       || 'trial',
    status:      modal.data?.status     || 'trial',
    amount:      modal.data?.amount     ?? '',
    currency:    modal.data?.currency   || 'usd',
    interval:    modal.data?.interval   || 'month',
    notes:       modal.data?.notes      || '',
    // invoice fields
    description: modal.data?.description || '',
    invAmount:   modal.data?.amount      || '',
    invStatus:   modal.data?.status      || 'pending',
    invDate:     modal.data?.date        ? new Date(modal.data.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      let res;
      if (modal.type === 'new-subscription' || modal.type === 'edit-subscription') {
        const locId = form.locationId || modal.locationId;
        if (!locId) { onFlash('✗ Location ID required.'); setSaving(false); return; }
        res = await adminFetch(`/admin/billing/${locId}`, {
          method: 'POST', adminKey,
          body: {
            plan: form.plan, status: form.status,
            amount: form.amount !== '' ? Number(form.amount) : undefined,
            currency: form.currency, interval: form.interval, notes: form.notes,
          },
        });
      } else if (modal.type === 'add-invoice') {
        res = await adminFetch(`/admin/billing/${modal.locationId}/invoice`, {
          method: 'POST', adminKey,
          body: { amount: Number(form.invAmount), description: form.description, status: form.invStatus, date: new Date(form.invDate).getTime() },
        });
      } else if (modal.type === 'edit-invoice') {
        res = await adminFetch(`/admin/billing/${modal.locationId}/invoice/${modal.data.id}`, {
          method: 'PATCH', adminKey,
          body: { amount: Number(form.invAmount), description: form.description, status: form.invStatus, date: new Date(form.invDate).getTime() },
        });
      }
      if (res?.success) onSaved();
      else onFlash(`✗ ${res?.error || 'Save failed'}`);
    } catch { onFlash('✗ Request failed'); }
    setSaving(false);
  };

  const isInvoice = modal.type === 'add-invoice' || modal.type === 'edit-invoice';
  const isNew     = modal.type === 'new-subscription';

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
  const box     = { background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: 24, width: 'min(420px, 94vw)', maxHeight: '90vh', overflowY: 'auto' };
  const inp     = { width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box', marginBottom: 12 };
  const sel     = { ...inp, cursor: 'pointer' };
  const lbl     = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };

  const titles = { 'new-subscription': 'New Billing Record', 'edit-subscription': 'Edit Subscription', 'add-invoice': 'Add Invoice', 'edit-invoice': 'Edit Invoice' };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ color: '#fff', margin: 0, fontSize: 16 }}>{titles[modal.type]}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        {isNew && (
          <>
            <label style={lbl}>Location ID</label>
            <input style={inp} value={form.locationId} onChange={e => set('locationId', e.target.value)} placeholder="e.g. n26oX9nNg6MdIrAlZQDg" />
          </>
        )}

        {!isInvoice && (
          <>
            <label style={lbl}>Plan</label>
            <select style={sel} value={form.plan} onChange={e => set('plan', e.target.value)}>
              {['trial', 'starter', 'pro', 'agency'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>

            <label style={lbl}>Status</label>
            <select style={sel} value={form.status} onChange={e => set('status', e.target.value)}>
              {['trial', 'active', 'past_due', 'cancelled', 'suspended'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
              <div>
                <label style={lbl}>Amount (USD)</label>
                <input style={inp} type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="99" />
              </div>
              <div>
                <label style={lbl}>Currency</label>
                <select style={sel} value={form.currency} onChange={e => set('currency', e.target.value)}>
                  <option value="usd">USD</option>
                  <option value="eur">EUR</option>
                  <option value="gbp">GBP</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Interval</label>
                <select style={sel} value={form.interval} onChange={e => set('interval', e.target.value)}>
                  <option value="month">Monthly</option>
                  <option value="year">Yearly</option>
                </select>
              </div>
            </div>

            <label style={lbl}>Notes</label>
            <input style={inp} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Internal notes…" />
          </>
        )}

        {isInvoice && (
          <>
            <label style={lbl}>Description</label>
            <input style={inp} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Pro Plan - March 2026" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div>
                <label style={lbl}>Amount</label>
                <input style={inp} type="number" value={form.invAmount} onChange={e => set('invAmount', e.target.value)} placeholder="99" />
              </div>
              <div>
                <label style={lbl}>Status</label>
                <select style={sel} value={form.invStatus} onChange={e => set('invStatus', e.target.value)}>
                  {['pending', 'paid', 'overdue', 'refunded', 'void'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Date</label>
                <input style={inp} type="date" value={form.invDate} onChange={e => set('invDate', e.target.value)} />
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{ flex: 1, padding: '10px', background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            style={{ padding: '10px 20px', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Action icon button ────────────────────────────────────────────────────────

function ActionBtn({ icon, title, color, onClick }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: 'none', border: `1px solid ${color}33`, borderRadius: 6,
        color, padding: '4px 10px', cursor: 'pointer', fontSize: 14, fontWeight: 700,
      }}
    >
      {icon}
    </button>
  );
}

// ── Detail panel (expanded row) ───────────────────────────────────────────────

function DetailPanel({ data, troubleshoot, workflowRunLogs, onClearConnection, onDeleteWorkflow }) {
  const [tsTab, setTsTab] = useState('connections');

  return (
    <div style={{ padding: '14px 0' }}>

      {/* Top row: integrations + token + logs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div>
          <p style={{ color: '#9ca3af', fontSize: 11, margin: '0 0 6px', fontWeight: 600, letterSpacing: '0.05em' }}>CONNECTED INTEGRATIONS</p>
          {data.connectedCategories?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {data.connectedCategories.map((c) => (
                <span key={c} style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 10px', borderRadius: 10, fontSize: 12 }}>{c}</span>
              ))}
            </div>
          ) : <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>None connected</p>}

          {data.tokenRecord && (
            <>
              <p style={{ color: '#9ca3af', fontSize: 11, margin: '14px 0 4px', fontWeight: 600, letterSpacing: '0.05em' }}>TOOL SESSION TOKEN</p>
              <code style={{ color: '#a78bfa', fontSize: 11, wordBreak: 'break-all' }}>{data.tokenRecord.token}</code>
            </>
          )}
        </div>
        <div>
          <p style={{ color: '#9ca3af', fontSize: 11, margin: '0 0 6px', fontWeight: 600, letterSpacing: '0.05em' }}>RECENT LOGS</p>
          <div style={{ maxHeight: 140, overflowY: 'auto' }}>
            {(data.recentLogs || []).slice(0, 10).map((log, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px solid #222', alignItems: 'center' }}>
                <EventBadge event={log.event} />
                <span style={{ color: log.success ? '#4ade80' : '#f87171', fontSize: 11 }}>{log.success ? '✓' : '✗'}</span>
                <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 'auto' }}>{relTime(log.timestamp)}</span>
              </div>
            ))}
            {!data.recentLogs?.length && <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>No logs yet.</p>}
          </div>
        </div>
      </div>

      {/* Troubleshoot section */}
      <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: 14 }}>
        <p style={{ color: '#fbbf24', fontSize: 11, margin: '0 0 10px', fontWeight: 600, letterSpacing: '0.05em' }}>🔧 TROUBLESHOOT</p>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {['connections', 'workflows'].map((t) => (
            <button
              key={t}
              onClick={() => setTsTab(t)}
              style={{
                padding: '4px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500, border: 'none',
                background: tsTab === t ? '#7c3aed' : '#2a2a2a',
                color: tsTab === t ? '#fff' : '#9ca3af',
              }}
            >{t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>

        {/* Connections sub-tab */}
        {tsTab === 'connections' && (
          <div>
            {!troubleshoot ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>Loading…</p>
            ) : Object.keys(troubleshoot.connections || {}).length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>No tool connections found.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(troubleshoot.connections).map(([cat, cfg]) => (
                  <div key={cat} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ color: '#60a5fa', fontSize: 12, fontWeight: 600 }}>{cat}</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {Object.entries(cfg || {}).map(([k, v]) => (
                          <span key={k} style={{ background: '#111', border: '1px solid #333', borderRadius: 4, padding: '1px 8px', fontSize: 11, color: '#9ca3af' }}>
                            <span style={{ color: '#6b7280' }}>{k}: </span>
                            <span style={{ color: '#e5e7eb', fontFamily: 'monospace' }}>{String(v)}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => onClearConnection(cat)}
                      title={`Clear ${cat} connection`}
                      style={{ background: 'none', border: '1px solid #dc262644', borderRadius: 6, color: '#dc2626', padding: '3px 10px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
                    >✕ Clear</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Workflows sub-tab */}
        {tsTab === 'workflows' && (
          <div>
            {!troubleshoot ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>Loading…</p>
            ) : !troubleshoot.workflows?.length ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>No saved workflows.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {troubleshoot.workflows.map((wf) => {
                  const runs = (workflowRunLogs || []).filter(l => l.detail?.workflowId === wf.id);
                  return (
                    <div key={wf.id} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ color: '#e5e7eb', fontSize: 13, fontWeight: 600 }}>{wf.name}</span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ color: '#6b7280', fontSize: 11 }}>{wf.steps?.length || 0} steps</span>
                          <span style={{ color: '#6b7280', fontSize: 11 }}>· {relTime(wf.updatedAt)}</span>
                          <button
                            onClick={() => onDeleteWorkflow(wf.id, wf.name)}
                            style={{ background: 'none', border: '1px solid #dc262644', borderRadius: 6, color: '#dc2626', padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
                          >✕ Delete</button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                        {(wf.steps || []).map((s, i) => (
                          <span key={i} style={{ background: '#1e3a5f', color: '#60a5fa', padding: '1px 8px', borderRadius: 4, fontSize: 11 }}>
                            {i + 1}. {s.label || s.tool}
                          </span>
                        ))}
                      </div>
                      {wf.webhookToken && (
                        <p style={{ color: '#6b7280', fontSize: 10, margin: '4px 0 6px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          🔗 /workflows/trigger/{wf.webhookToken}
                        </p>
                      )}
                      {/* Execution run history */}
                      {runs.length > 0 && (
                        <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: 8, marginTop: 4 }}>
                          <p style={{ color: '#9ca3af', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 5px' }}>
                            Recent Runs ({runs.length})
                          </p>
                          {runs.slice(0, 5).map((r, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0', fontSize: 11 }}>
                              <span style={{ color: r.success ? '#4ade80' : '#f87171' }}>{r.success ? '✓' : '✗'}</span>
                              <span style={{ color: '#9ca3af' }}>{r.detail?.toolCallCount ?? 0} tool calls</span>
                              <span style={{ color: '#9ca3af' }}>· {r.detail?.turns ?? 0} turns</span>
                              <span style={{ color: '#6b7280', marginLeft: 'auto' }}>{relTime(r.timestamp)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Unmatched run logs (webhook runs without a matched saved workflow) */}
            {workflowRunLogs?.length > 0 && troubleshoot?.workflows?.length === 0 && (
              <div style={{ marginTop: 12 }}>
                <p style={{ color: '#9ca3af', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>Webhook Trigger History</p>
                {workflowRunLogs.slice(0, 10).map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 12, borderBottom: '1px solid #1e1e1e' }}>
                    <span style={{ color: r.success ? '#4ade80' : '#f87171' }}>{r.success ? '✓' : '✗'}</span>
                    <span style={{ color: '#e5e7eb' }}>{r.detail?.workflowName || '—'}</span>
                    <span style={{ color: '#6b7280' }}>{r.detail?.toolCallCount ?? 0} calls</span>
                    <span style={{ color: '#6b7280', marginLeft: 'auto' }}>{relTime(r.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Log table ─────────────────────────────────────────────────────────────────

function LogTable({ logs }) {
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 500 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#9ca3af', textAlign: 'left' }}>
            {['Time', 'Location', 'Event', 'Status', 'Detail'].map((h) => (
              <th key={h} style={{ padding: '9px 14px', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.map((log, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #1e1e1e' }}>
              <td style={{ padding: '8px 14px', color: '#6b7280', whiteSpace: 'nowrap', fontSize: 12 }}>
                {relTime(log.timestamp)}
              </td>
              <td style={{ padding: '8px 14px', fontFamily: 'monospace', color: '#a78bfa', fontSize: 12 }}>
                {log.locationId?.slice(0, 12)}…
              </td>
              <td style={{ padding: '8px 14px' }}>
                <EventBadge event={log.event} />
              </td>
              <td style={{ padding: '8px 14px' }}>
                <span style={{ color: log.success ? '#4ade80' : '#f87171', fontSize: 12 }}>
                  {log.success ? '✓ OK' : '✗ Fail'}
                </span>
              </td>
              <td style={{ padding: '8px 14px', color: '#6b7280', fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {log.detail ? JSON.stringify(log.detail) : ''}
              </td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                No activity logs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
