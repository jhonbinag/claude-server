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
  install:                  '#4ade80',
  uninstall:                '#f87171',
  restore:                  '#60a5fa',
  tool_connect:             '#34d399',
  tool_disconnect:          '#fb923c',
  tool_reconnect:           '#a78bfa',
  tool_call:                '#94a3b8',
  claude_task:              '#818cf8',
  voice_task:               '#c084fc',
  workflow_save:            '#2dd4bf',
  workflow_delete:          '#f97316',
  workflow_trigger:         '#f0abfc',
  admin_refresh:            '#fbbf24',
  admin_revoke:             '#f43f5e',
  admin_workflow_edit:      '#fbbf24',
  admin_workflow_delete:    '#f43f5e',
  admin_connection_clear:   '#fb923c',
  admin_connection_update:  '#34d399',
  admin_run_task:           '#818cf8',
  app_settings_update:      '#60a5fa',
  billing_update:           '#4ade80',
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
  const [taskLogs,          setTaskLogs]          = useState({}); // { [locationId]: [] }
  const [adminModal,        setAdminModal]        = useState(null); // { type, locationId, data }

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

  // Plan Tiers state
  const [tiers,              setTiers]              = useState(null);
  const [tiersLoading,       setTiersLoading]       = useState(false);
  const [tierModal,          setTierModal]          = useState(null); // { tier, data }
  const [ghlProducts,        setGhlProducts]        = useState([]);
  const [ghlProductsLocId,   setGhlProductsLocId]   = useState('');
  const [ghlProductsLoading, setGhlProductsLoading] = useState(false);

  // All available integration keys (hardcoded to match backend)
  const ALL_INTEGRATIONS = [
    { key: 'perplexity',   label: 'Perplexity AI',  icon: '🔍' },
    { key: 'openai',       label: 'OpenAI',          icon: '✨' },
    { key: 'facebook_ads', label: 'Facebook Ads',    icon: '📘' },
    { key: 'sendgrid',     label: 'SendGrid',         icon: '📧' },
    { key: 'slack',        label: 'Slack',            icon: '💬' },
    { key: 'apollo',       label: 'Apollo.io',        icon: '🚀' },
    { key: 'heygen',       label: 'HeyGen',           icon: '🎬' },
  ];

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

  const loadTiers = useCallback(async () => {
    setTiersLoading(true);
    const data = await adminFetch('/admin/plan-tiers', { adminKey });
    if (data.success) setTiers(data.data);
    setTiersLoading(false);
  }, [adminKey]);

  useEffect(() => {
    if (!authed) return;
    if (tab === 'overview')     loadStats();
    if (tab === 'locations')    loadLocations();
    if (tab === 'logs')         loadLogs();
    if (tab === 'app-settings') loadAppSettings();
    if (tab === 'billing')      loadBilling();
    if (tab === 'plan-tiers')   loadTiers();
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
      const [connRes, wfRes, wfLogsRes, taskLogsRes] = await Promise.all([
        adminFetch(`/admin/locations/${locationId}/connections`, { adminKey }),
        adminFetch(`/admin/locations/${locationId}/workflows`, { adminKey }),
        adminFetch(`/admin/logs?locationId=${locationId}&event=workflow_trigger&limit=100`, { adminKey }),
        adminFetch(`/admin/logs?locationId=${locationId}&limit=200`, { adminKey }),
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
        [locationId]: wfLogsRes.success ? wfLogsRes.data : [],
      }));
      setTaskLogs((prev) => ({
        ...prev,
        [locationId]: taskLogsRes.success
          ? taskLogsRes.data.filter(l => l.event === 'claude_task' || l.event === 'voice_task')
          : [],
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

  const editWorkflow = (locationId, wf) => {
    setAdminModal({ type: 'edit-workflow', locationId, data: wf });
  };

  const editConnection = (locationId, cat, cfg) => {
    setAdminModal({ type: 'edit-connection', locationId, data: { cat, cfg } });
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
            { key: 'plan-tiers',   label: '🏅 Plan Tiers' },
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
                              taskLogs={taskLogs[loc.locationId] || []}
                              locationId={loc.locationId}
                              adminKey={adminKey}
                              onClearConnection={(cat) => clearConnection(loc.locationId, cat)}
                              onDeleteWorkflow={(id, name) => deleteWorkflow(loc.locationId, id, name)}
                              onEditWorkflow={(wf) => editWorkflow(loc.locationId, wf)}
                              onEditConnection={(cat, cfg) => editConnection(loc.locationId, cat, cfg)}
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
                {[
                  'install','uninstall','restore',
                  'tool_connect','tool_disconnect','tool_reconnect',
                  'claude_task','voice_task',
                  'workflow_save','workflow_delete','workflow_trigger',
                  'admin_refresh','admin_revoke','admin_workflow_edit','admin_workflow_delete',
                  'admin_connection_clear','admin_connection_update','admin_run_task',
                  'app_settings_update','billing_update',
                ].map((e) => (
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

        {/* ── Plan Tiers Tab ────────────────────────────────────────── */}
        {tab === 'plan-tiers' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h3 style={{ color: '#fff', margin: '0 0 4px', fontSize: 16 }}>🏅 Plan Tiers</h3>
                <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>
                  Configure which integrations are available per tier. Assign tiers to locations via the Billing tab.
                </p>
              </div>
              <button onClick={loadTiers} style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>↻ Reload</button>
            </div>

            {tiersLoading && <p style={{ color: '#6b7280', fontSize: 13 }}>Loading tiers…</p>}

            {/* ── GHL Product Sync ── */}
            <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: 16, marginBottom: 20 }}>
              <p style={{ color: '#e5e7eb', fontSize: 13, fontWeight: 600, margin: '0 0 10px' }}>🔗 Sync with GHL Products</p>
              <p style={{ color: '#6b7280', fontSize: 12, margin: '0 0 12px' }}>
                Enter a location ID to load its GHL products, then link each tier to a GHL product so prices stay in sync.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  placeholder="Enter Location ID…"
                  value={ghlProductsLocId}
                  onChange={e => setGhlProductsLocId(e.target.value)}
                  style={{ flex: 1, minWidth: 200, padding: '8px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13 }}
                />
                <button
                  disabled={!ghlProductsLocId.trim() || ghlProductsLoading}
                  onClick={async () => {
                    setGhlProductsLoading(true);
                    try {
                      const data = await adminFetch(`/admin/ghl-products?locationId=${encodeURIComponent(ghlProductsLocId.trim())}`, { adminKey });
                      if (data.success) { setGhlProducts(data.data); flash(`✓ Loaded ${data.data.length} GHL products`); }
                      else flash(`✗ ${data.error || 'Failed to load products'}`);
                    } catch { flash('✗ Request failed'); }
                    setGhlProductsLoading(false);
                  }}
                  style={{ padding: '8px 16px', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (!ghlProductsLocId.trim() || ghlProductsLoading) ? 0.5 : 1 }}
                >
                  {ghlProductsLoading ? 'Loading…' : '⬇ Load Products'}
                </button>
              </div>
              {ghlProducts.length > 0 && (
                <p style={{ color: '#4ade80', fontSize: 12, margin: '8px 0 0' }}>✓ {ghlProducts.length} products loaded — open a tier to assign one</p>
              )}
            </div>

            {tiers && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {['bronze', 'silver', 'gold', 'diamond'].map(tierKey => {
                  const tier = tiers[tierKey];
                  if (!tier) return null;
                  const tierColor = { bronze: '#cd7f32', silver: '#9ca3af', gold: '#fbbf24', diamond: '#a78bfa' }[tierKey];
                  return (
                    <div key={tierKey} style={{ background: '#1a1a1a', border: `1px solid ${tierColor}44`, borderRadius: 12, padding: 20 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 22 }}>{tier.icon}</span>
                            <span style={{ color: tierColor, fontWeight: 700, fontSize: 16 }}>{tier.name}</span>
                          </div>
                          <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>{tier.description}</p>
                        </div>
                        <button
                          onClick={() => setTierModal({ tier: tierKey, data: { ...tier } })}
                          style={{ background: 'none', border: `1px solid ${tierColor}55`, borderRadius: 6, color: tierColor, padding: '4px 12px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
                        >✏️ Edit</button>
                      </div>

                      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                        <div>
                          <p style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>Integrations</p>
                          <span style={{ color: tierColor, fontWeight: 700, fontSize: 18 }}>
                            {tier.integrationLimit === -1 ? '∞' : tier.integrationLimit}
                          </span>
                          <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 4 }}>{tier.integrationLimit === -1 ? 'unlimited' : 'max'}</span>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>Price</p>
                          <span style={{ color: '#e5e7eb', fontWeight: 700, fontSize: 18 }}>
                            {tier.price ? `$${tier.price}` : 'Free'}
                          </span>
                          {tier.price > 0 && <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 4 }}>/{tier.interval || 'mo'}</span>}
                        </div>
                      </div>
                      {tier.ghlProductName && (
                        <p style={{ color: '#6366f1', fontSize: 11, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                          🔗 <span>{tier.ghlProductName}</span>
                        </p>
                      )}

                      <div>
                        <p style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
                          Allowed Integrations
                        </p>
                        {tier.allowedIntegrations === null ? (
                          <span style={{ color: '#4ade80', fontSize: 12 }}>✓ All integrations</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {ALL_INTEGRATIONS.map(({ key, label, icon }) => {
                              const allowed = tier.allowedIntegrations?.includes(key);
                              return (
                                <span
                                  key={key}
                                  style={{
                                    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                                    background: allowed ? `${tierColor}22` : '#1e1e1e',
                                    color: allowed ? tierColor : '#4b5563',
                                    border: `1px solid ${allowed ? tierColor + '44' : '#2a2a2a'}`,
                                  }}
                                >
                                  {icon} {label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Tier Edit Modal */}
            {tierModal && (
              <TierEditModal
                tierKey={tierModal.tier}
                data={tierModal.data}
                allIntegrations={ALL_INTEGRATIONS}
                ghlProducts={ghlProducts}
                adminKey={adminKey}
                onClose={() => setTierModal(null)}
                onSaved={(tierKey, saved) => {
                  setTierModal(null);
                  flash(`✓ ${saved.name} tier updated`);
                  setTiers(prev => ({ ...prev, [tierKey]: saved }));
                }}
                onFlash={flash}
              />
            )}
          </div>
        )}

      </div>

      {/* Admin Edit Modals */}
      {adminModal?.type === 'edit-workflow' && (
        <EditWorkflowModal
          modal={adminModal}
          adminKey={adminKey}
          onClose={() => setAdminModal(null)}
          onSaved={(locationId, updatedWf) => {
            setAdminModal(null);
            flash(`✓ Workflow "${updatedWf.name}" updated`);
            setTroubleshootData((prev) => {
              const loc = prev[locationId] || {};
              return { ...prev, [locationId]: { ...loc, workflows: (loc.workflows || []).map(w => w.id === updatedWf.id ? updatedWf : w) } };
            });
          }}
          onFlash={flash}
        />
      )}
      {adminModal?.type === 'edit-connection' && (
        <EditConnectionModal
          modal={adminModal}
          adminKey={adminKey}
          onClose={() => setAdminModal(null)}
          onSaved={(locationId, cat, newCfg) => {
            setAdminModal(null);
            flash(`✓ ${cat} connection updated`);
            setTroubleshootData((prev) => {
              const loc = prev[locationId] || {};
              return { ...prev, [locationId]: { ...loc, connections: { ...loc.connections, [cat]: newCfg } } };
            });
          }}
          onFlash={flash}
        />
      )}
    </div>
  );
}

// ── Billing Modal ─────────────────────────────────────────────────────────────

function BillingModal({ modal, adminKey, onClose, onSaved, onFlash }) {
  const [form, setForm] = useState({
    locationId:  modal.data?.locationId || modal.locationId || '',
    plan:        modal.data?.plan       || 'trial',
    tier:        modal.data?.tier       || 'bronze',
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
            plan: form.plan, tier: form.tier, status: form.status,
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

            <label style={lbl}>Tier (Integration Access)</label>
            <select style={sel} value={form.tier} onChange={e => set('tier', e.target.value)}>
              <option value="bronze">🥉 Bronze — 2 integrations</option>
              <option value="silver">🥈 Silver — 6 integrations</option>
              <option value="gold">🥇 Gold — 10 integrations</option>
              <option value="diamond">💎 Diamond — Unlimited</option>
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

function DetailPanel({ data, troubleshoot, workflowRunLogs, taskLogs, locationId, adminKey,
                        onClearConnection, onDeleteWorkflow, onEditWorkflow, onEditConnection }) {
  const [tsTab,       setTsTab]       = useState('tasks');
  const [runTask,     setRunTask]     = useState('');
  const [runResult,   setRunResult]   = useState(null);
  const [runLoading,  setRunLoading]  = useState(false);

  const execRunTask = async () => {
    if (!runTask.trim() || runLoading) return;
    setRunLoading(true);
    setRunResult(null);
    try {
      const res = await adminFetch(`/admin/locations/${locationId}/run-task`, {
        method: 'POST', adminKey, body: { task: runTask.trim() },
      });
      setRunResult(res);
    } catch (e) {
      setRunResult({ success: false, error: e.message });
    }
    setRunLoading(false);
  };

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
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {[
            { key: 'tasks',       label: `🤖 Tasks (${taskLogs.length})` },
            { key: 'run',         label: `🚀 Run Task` },
            { key: 'workflows',   label: `🔀 Workflows (${troubleshoot?.workflows?.length ?? 0})` },
            { key: 'connections', label: `🔌 Connections (${Object.keys(troubleshoot?.connections || {}).length})` },
            { key: 'logs',        label: `📋 All Logs` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTsTab(key)}
              style={{
                padding: '4px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500, border: 'none',
                background: tsTab === key ? '#7c3aed' : '#2a2a2a',
                color: tsTab === key ? '#fff' : '#9ca3af',
              }}
            >{label}</button>
          ))}
        </div>

        {/* Tasks sub-tab — claude_task + voice_task executions */}
        {tsTab === 'tasks' && (
          <div>
            {taskLogs.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>No Claude task executions logged yet for this location.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {taskLogs.slice(0, 50).map((log, i) => (
                  <div key={i} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <EventBadge event={log.event} />
                      <span style={{ color: log.success ? '#4ade80' : '#f87171', fontSize: 11 }}>{log.success ? '✓ OK' : '✗ Failed'}</span>
                      {log.detail?.source && (
                        <span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '1px 8px', borderRadius: 10, fontSize: 10 }}>{log.detail.source}</span>
                      )}
                      <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 'auto' }}>{relTime(log.timestamp)}</span>
                    </div>
                    {log.detail?.task && (
                      <p style={{ color: '#e5e7eb', fontSize: 12, margin: '0 0 4px', lineHeight: 1.4 }}>
                        "{log.detail.task.substring(0, 180)}{log.detail.task.length > 180 ? '…' : ''}"
                      </p>
                    )}
                    {log.detail?.transcript && (
                      <p style={{ color: '#e5e7eb', fontSize: 12, margin: '0 0 4px', lineHeight: 1.4 }}>
                        🎤 "{log.detail.transcript.substring(0, 180)}{log.detail.transcript.length > 180 ? '…' : ''}"
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#9ca3af', flexWrap: 'wrap' }}>
                      {log.detail?.turns !== undefined && <span>{log.detail.turns} turns</span>}
                      {log.detail?.toolCallCount !== undefined && <span>{log.detail.toolCallCount} tool calls</span>}
                      {log.detail?.toolsCalled?.length > 0 && (
                        <span style={{ color: '#818cf8' }}>{log.detail.toolsCalled.join(', ')}</span>
                      )}
                      {log.detail?.error && <span style={{ color: '#f87171' }}>Error: {log.detail.error}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Run Task sub-tab — admin runs a Claude task as this location */}
        {tsTab === 'run' && (
          <div>
            <p style={{ color: '#9ca3af', fontSize: 12, margin: '0 0 10px' }}>
              Run any Claude task as this location to reproduce issues or test tool access.
            </p>
            <textarea
              value={runTask}
              onChange={e => setRunTask(e.target.value)}
              placeholder="e.g. List the 5 most recent contacts in GHL"
              rows={4}
              style={{
                width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #333',
                borderRadius: 8, color: '#e5e7eb', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', marginBottom: 8,
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <button
                onClick={execRunTask}
                disabled={runLoading || !runTask.trim()}
                style={{
                  background: runLoading ? '#4c1d95' : '#7c3aed', border: 'none', borderRadius: 8,
                  color: '#fff', padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: runLoading ? 'wait' : 'pointer',
                  opacity: (!runTask.trim()) ? 0.5 : 1,
                }}
              >
                {runLoading ? '⏳ Running…' : '▶ Run Task'}
              </button>
              {runResult && (
                <button onClick={() => setRunResult(null)} style={{ background: 'none', border: '1px solid #333', borderRadius: 8, color: '#6b7280', padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}>
                  Clear
                </button>
              )}
            </div>
            {runResult && (
              <div style={{ background: '#111', border: `1px solid ${runResult.success ? '#166534' : '#7f1d1d'}`, borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <span style={{ color: runResult.success ? '#4ade80' : '#f87171', fontWeight: 600, fontSize: 13 }}>
                    {runResult.success ? '✓ Success' : '✗ Failed'}
                  </span>
                  {runResult.success && (
                    <>
                      <span style={{ color: '#6b7280', fontSize: 12 }}>{runResult.turns} turns</span>
                      <span style={{ color: '#6b7280', fontSize: 12 }}>· {runResult.toolCallCount} tool calls</span>
                    </>
                  )}
                </div>
                <pre style={{ color: '#e5e7eb', fontSize: 12, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflowY: 'auto' }}>
                  {runResult.success ? (runResult.result || '(no text output)') : runResult.error}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* All Logs sub-tab */}
        {tsTab === 'logs' && (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {!data.recentLogs?.length ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>No logs for this location.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #333' }}>
                    {['Time', 'Event', 'Status', 'Detail'].map(h => (
                      <th key={h} style={{ color: '#6b7280', fontWeight: 600, padding: '4px 8px', textAlign: 'left', fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recentLogs.map((log, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #1e1e1e' }}>
                      <td style={{ color: '#6b7280', padding: '4px 8px', whiteSpace: 'nowrap' }}>{relTime(log.timestamp)}</td>
                      <td style={{ padding: '4px 8px' }}><EventBadge event={log.event} /></td>
                      <td style={{ padding: '4px 8px', color: log.success ? '#4ade80' : '#f87171' }}>{log.success ? '✓' : '✗'}</td>
                      <td style={{ padding: '4px 8px', color: '#9ca3af', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {JSON.stringify(log.detail || {}).substring(0, 120)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

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
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => onEditConnection(cat, cfg)}
                        title={`Edit ${cat} config`}
                        style={{ background: 'none', border: '1px solid #7c3aed44', borderRadius: 6, color: '#a78bfa', padding: '3px 10px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
                      >✏️ Edit</button>
                      <button
                        onClick={() => onClearConnection(cat)}
                        title={`Clear ${cat} connection`}
                        style={{ background: 'none', border: '1px solid #dc262644', borderRadius: 6, color: '#dc2626', padding: '3px 10px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
                      >✕ Clear</button>
                    </div>
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
                            onClick={() => onEditWorkflow(wf)}
                            style={{ background: 'none', border: '1px solid #7c3aed44', borderRadius: 6, color: '#a78bfa', padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
                          >✏️ Edit</button>
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

// ── Tier Edit Modal ────────────────────────────────────────────────────────────

function TierEditModal({ tierKey, data, allIntegrations, ghlProducts, adminKey, onClose, onSaved, onFlash }) {
  const tierColor = { bronze: '#cd7f32', silver: '#9ca3af', gold: '#fbbf24', diamond: '#a78bfa' }[tierKey] || '#9ca3af';

  const [name,             setName]             = useState(data.name || '');
  const [icon,             setIcon]             = useState(data.icon || '');
  const [description,      setDescription]      = useState(data.description || '');
  const [price,            setPrice]            = useState(data.price ?? 0);
  const [interval,         setInterval]         = useState(data.interval || 'mo');
  const [ghlProductId,     setGhlProductId]     = useState(data.ghlProductId || '');
  const [ghlPriceId,       setGhlPriceId]       = useState(data.ghlPriceId   || '');
  const [ghlProductName,   setGhlProductName]   = useState(data.ghlProductName || '');
  const [integrationLimit, setIntegrationLimit] = useState(data.integrationLimit ?? 2);
  const [unlimited,        setUnlimited]        = useState(data.integrationLimit === -1);

  // Prices of the currently selected GHL product
  const selectedGhlProduct = ghlProducts?.find(p => p.id === ghlProductId) || null;
  const [allAllowed,       setAllAllowed]        = useState(data.allowedIntegrations === null);
  const [selected,         setSelected]         = useState(() =>
    data.allowedIntegrations === null
      ? new Set(allIntegrations.map(i => i.key))
      : new Set(data.allowedIntegrations || [])
  );
  const [saving, setSaving] = useState(false);

  const toggleIntegration = (key) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        name:                name.trim() || data.name,
        icon:                icon.trim() || data.icon,
        description:         description.trim(),
        price:               Number(price) || 0,
        interval:            interval || 'mo',
        ghlProductId:        ghlProductId  || null,
        ghlPriceId:          ghlPriceId    || null,
        ghlProductName:      ghlProductName || null,
        integrationLimit:    unlimited ? -1 : Number(integrationLimit),
        allowedIntegrations: allAllowed ? null : [...selected],
      };
      const res = await adminFetch(`/admin/plan-tiers/${tierKey}`, { method: 'POST', adminKey, body });
      if (res.success) onSaved(tierKey, res.data);
      else onFlash(`✗ ${res.error || 'Save failed'}`);
    } catch { onFlash('✗ Request failed'); }
    setSaving(false);
  };

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
  const box     = { background: '#1a1a1a', border: `1px solid ${tierColor}55`, borderRadius: 12, padding: 24, width: 'min(520px, 100%)', maxHeight: '90vh', overflowY: 'auto' };
  const inp     = { width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box', marginBottom: 12 };
  const lbl     = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ color: tierColor, margin: 0, fontSize: 16 }}>{data.icon} Edit {data.name} Tier</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={lbl}>Tier Name</label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder={data.name} />
          </div>
          <div>
            <label style={lbl}>Icon</label>
            <input style={inp} value={icon} onChange={e => setIcon(e.target.value)} placeholder={data.icon} />
          </div>
        </div>

        <label style={lbl}>Description</label>
        <input style={inp} value={description} onChange={e => setDescription(e.target.value)} placeholder="Plan description…" />

        {/* Pricing */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 8, marginBottom: 4 }}>
          <div>
            <label style={lbl}>Price (USD)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 13 }}>$</span>
              <input
                type="number" min={0} step={0.01}
                style={{ ...inp, paddingLeft: 22, marginBottom: 12 }}
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <div>
            <label style={lbl}>Interval</label>
            <select
              style={{ ...inp, marginBottom: 12 }}
              value={interval}
              onChange={e => setInterval(e.target.value)}
            >
              <option value="mo">/ month</option>
              <option value="yr">/ year</option>
            </select>
          </div>
        </div>

        {/* GHL Product Link */}
        <label style={lbl}>GHL Product (optional)</label>
        {(!ghlProducts || ghlProducts.length === 0) ? (
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
            Load GHL products from the Plan Tiers tab first to link a product.
          </p>
        ) : (
          <>
            <select
              style={{ ...inp, marginBottom: 8 }}
              value={ghlProductId}
              onChange={e => {
                const pid = e.target.value;
                setGhlProductId(pid);
                setGhlPriceId('');
                const prod = ghlProducts.find(p => p.id === pid);
                setGhlProductName(prod ? prod.name : '');
              }}
            >
              <option value="">— No GHL product linked —</option>
              {ghlProducts.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            {selectedGhlProduct && selectedGhlProduct.prices?.length > 0 && (
              <>
                <label style={lbl}>GHL Price / Variant</label>
                <select
                  style={{ ...inp, marginBottom: 8 }}
                  value={ghlPriceId}
                  onChange={e => {
                    const pid = e.target.value;
                    setGhlPriceId(pid);
                    const pr = selectedGhlProduct.prices.find(p => p.id === pid);
                    if (pr) {
                      setPrice(pr.amount);
                      setInterval(pr.recurring?.interval === 'year' ? 'yr' : 'mo');
                    }
                  }}
                >
                  <option value="">— Select a price —</option>
                  {selectedGhlProduct.prices.map(pr => (
                    <option key={pr.id} value={pr.id}>
                      {pr.name} — ${pr.amount}/{pr.recurring?.interval || 'mo'}
                    </option>
                  ))}
                </select>
                {ghlPriceId && (
                  <p style={{ fontSize: 11, color: '#4ade80', marginBottom: 12 }}>✓ Price auto-synced from GHL product</p>
                )}
              </>
            )}
          </>
        )}

        {/* Integration limit */}
        <label style={lbl}>Integration Limit</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#e5e7eb' }}>
            <input type="checkbox" checked={unlimited} onChange={e => setUnlimited(e.target.checked)} />
            Unlimited (Diamond)
          </label>
          {!unlimited && (
            <input
              type="number"
              min={1}
              max={100}
              value={integrationLimit}
              onChange={e => setIntegrationLimit(e.target.value)}
              style={{ ...inp, width: 80, marginBottom: 0 }}
            />
          )}
        </div>

        {/* Allowed integrations */}
        <label style={lbl}>Allowed Integrations</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#e5e7eb', marginBottom: 12 }}>
          <input type="checkbox" checked={allAllowed} onChange={e => {
            setAllAllowed(e.target.checked);
            if (e.target.checked) setSelected(new Set(allIntegrations.map(i => i.key)));
          }} />
          All integrations (unlimited access)
        </label>

        {!allAllowed && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {allIntegrations.map(({ key, label, icon: iIcon }) => {
              const checked = selected.has(key);
              return (
                <label
                  key={key}
                  onClick={() => toggleIntegration(key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8,
                    cursor: 'pointer', fontSize: 13,
                    background: checked ? `${tierColor}18` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${checked ? tierColor + '55' : 'rgba(255,255,255,0.08)'}`,
                    color: checked ? tierColor : '#6b7280',
                    userSelect: 'none',
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={() => {}} style={{ accentColor: tierColor }} />
                  <span>{iIcon}</span>
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{ flex: 1, padding: '10px', background: tierColor, border: 'none', borderRadius: 8, color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : `Save ${data.name} Tier`}
          </button>
          <button onClick={onClose} style={{ padding: '10px 20px', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Workflow Modal ────────────────────────────────────────────────────────

function EditWorkflowModal({ modal, adminKey, onClose, onSaved, onFlash }) {
  const wf = modal.data;
  const [name,    setName]    = useState(wf.name    || '');
  const [context, setContext] = useState(wf.context || '');
  const [steps,   setSteps]   = useState(wf.steps   ? JSON.stringify(wf.steps, null, 2) : '[]');
  const [saving,  setSaving]  = useState(false);
  const [stepsErr, setStepsErr] = useState('');

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
  const box     = { background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: 24, width: 'min(580px, 100%)', maxHeight: '90vh', overflowY: 'auto' };
  const inp     = { width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box', marginBottom: 12 };
  const lbl     = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };

  const save = async () => {
    let parsedSteps;
    try { parsedSteps = JSON.parse(steps); setStepsErr(''); } catch { setStepsErr('Invalid JSON in steps.'); return; }
    setSaving(true);
    try {
      const res = await adminFetch(`/admin/locations/${modal.locationId}/workflows/${wf.id}`, {
        method: 'PUT', adminKey,
        body: { name: name.trim(), context: context.trim(), steps: parsedSteps },
      });
      if (res.success) onSaved(modal.locationId, res.data || { ...wf, name: name.trim(), context: context.trim(), steps: parsedSteps });
      else onFlash(`✗ ${res.error || 'Save failed'}`);
    } catch { onFlash('✗ Request failed'); }
    setSaving(false);
  };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ color: '#fff', margin: 0, fontSize: 16 }}>Edit Workflow</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>
        <label style={lbl}>Workflow Name</label>
        <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="My Workflow" />
        <label style={lbl}>Context / Instructions</label>
        <textarea
          value={context}
          onChange={e => setContext(e.target.value)}
          rows={4}
          placeholder="System prompt / context for this workflow…"
          style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }}
        />
        <label style={lbl}>Steps (JSON array)</label>
        <textarea
          value={steps}
          onChange={e => { setSteps(e.target.value); setStepsErr(''); }}
          rows={8}
          style={{ ...inp, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', lineHeight: 1.5 }}
        />
        {stepsErr && <p style={{ color: '#f87171', fontSize: 12, margin: '-8px 0 10px' }}>{stepsErr}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            style={{ flex: 1, padding: '10px', background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: (saving || !name.trim()) ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Save Workflow'}
          </button>
          <button onClick={onClose} style={{ padding: '10px 20px', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Connection Modal ──────────────────────────────────────────────────────

function EditConnectionModal({ modal, adminKey, onClose, onSaved, onFlash }) {
  const { cat, cfg } = modal.data;
  const [fields, setFields] = useState(() => {
    const init = {};
    Object.keys(cfg || {}).forEach(k => { init[k] = cfg[k]; });
    return init;
  });
  const [newKey,   setNewKey]   = useState('');
  const [newVal,   setNewVal]   = useState('');
  const [saving,   setSaving]   = useState(false);

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
  const box     = { background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: 24, width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto' };
  const inp     = { width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box' };
  const lbl     = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };

  const save = async () => {
    if (Object.keys(fields).length === 0) { onFlash('✗ No config fields to save.'); return; }
    setSaving(true);
    try {
      const res = await adminFetch(`/admin/locations/${modal.locationId}/connections/${cat}`, {
        method: 'PUT', adminKey, body: fields,
      });
      if (res.success) onSaved(modal.locationId, cat, fields);
      else onFlash(`✗ ${res.error || 'Save failed'}`);
    } catch { onFlash('✗ Request failed'); }
    setSaving(false);
  };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ color: '#fff', margin: 0, fontSize: 16 }}>Edit <span style={{ color: '#60a5fa' }}>{cat}</span> Connection</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>
        <p style={{ color: '#9ca3af', fontSize: 12, margin: '0 0 16px' }}>Edit API credentials for this location. Saving will invalidate the token cache and generate a new session token.</p>

        {Object.keys(fields).map(k => (
          <div key={k} style={{ marginBottom: 14 }}>
            <label style={lbl}>{k}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...inp, flex: 1 }}
                value={fields[k]}
                onChange={e => setFields(p => ({ ...p, [k]: e.target.value }))}
                placeholder={`Enter ${k}…`}
              />
              <button
                onClick={() => setFields(p => { const n = { ...p }; delete n[k]; return n; })}
                title="Remove field"
                style={{ background: 'none', border: '1px solid #7f1d1d', borderRadius: 6, color: '#f87171', padding: '0 10px', cursor: 'pointer', fontSize: 14 }}
              >×</button>
            </div>
          </div>
        ))}

        {/* Add new field */}
        <div style={{ marginBottom: 16, padding: 12, background: '#111', borderRadius: 8, border: '1px dashed #333' }}>
          <p style={{ color: '#6b7280', fontSize: 11, margin: '0 0 8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Add Field</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inp, flex: 1 }} value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="field name (e.g. apiKey)" />
            <input style={{ ...inp, flex: 2 }} value={newVal} onChange={e => setNewVal(e.target.value)} placeholder="value" />
            <button
              onClick={() => {
                if (!newKey.trim()) return;
                setFields(p => ({ ...p, [newKey.trim()]: newVal }));
                setNewKey(''); setNewVal('');
              }}
              style={{ background: '#7c3aed', border: 'none', borderRadius: 6, color: '#fff', padding: '0 14px', cursor: 'pointer', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}
            >+ Add</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{ flex: 1, padding: '10px', background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Save Connection'}
          </button>
          <button onClick={onClose} style={{ padding: '10px 20px', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
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
