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
  install:        '#4ade80',
  uninstall:      '#f87171',
  restore:        '#60a5fa',
  tool_connect:   '#34d399',
  tool_disconnect:'#fb923c',
  tool_reconnect: '#a78bfa',
  tool_call:      '#94a3b8',
  admin_refresh:  '#fbbf24',
  admin_revoke:   '#f43f5e',
};

function EventBadge({ event }) {
  const color = EVENT_COLORS[event] || '#9ca3af';
  return (
    <span style={{ color, fontFamily: 'monospace', fontSize: 12 }}>{event}</span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Admin() {
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

  const [logFilter,  setLogFilter]  = useState({ locationId: '', event: '' });
  const [expandedId, setExpandedId] = useState(null);
  const [detailData, setDetailData] = useState({});

  // App Settings state
  const [appSettingsData,   setAppSettingsData]   = useState(null);
  const [appSettingsForm,   setAppSettingsForm]   = useState({ clientId: '', clientSecret: '', redirectUri: 'https://claudeserver.vercel.app/oauth/callback' });
  const [appSettingsEdit,   setAppSettingsEdit]   = useState({ clientId: false, clientSecret: false, redirectUri: false });
  const [appSettingsSaving, setAppSettingsSaving] = useState(false);

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

  useEffect(() => {
    if (!authed) return;
    if (tab === 'overview')     loadStats();
    if (tab === 'locations')    loadLocations();
    if (tab === 'logs')         loadLogs();
    if (tab === 'app-settings') loadAppSettings();
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
    if (detailData[locationId]) return;
    const data = await adminFetch(`/admin/locations/${locationId}`, { adminKey });
    if (data.success) {
      setDetailData((prev) => ({ ...prev, [locationId]: data.data }));
    }
  };

  // ── Login screen ──────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: 40, width: 360 }}>
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
      <div style={{ background: '#1a1a1a', borderBottom: '1px solid #2a2a2a', padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>🛡️</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: '#fff' }}>HL Pro Tools — Admin</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => { loadStats(); loadLocations(); }} style={{ background: 'none', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>↻ Refresh</button>
          <button onClick={logout} style={{ background: 'none', border: '1px solid #333', borderRadius: 8, color: '#f87171', padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>Sign Out</button>
        </div>
      </div>

      {/* Action flash message */}
      {actionMsg && (
        <div style={{ background: actionMsg.startsWith('✓') ? '#14532d' : '#450a0a', color: '#fff', padding: '10px 28px', fontSize: 14 }}>
          {actionMsg}
        </div>
      )}

      <div style={{ padding: '24px 28px' }}>

        {/* Stats cards */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 28 }}>
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
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {[
            { key: 'overview',     label: 'Overview' },
            { key: 'locations',    label: 'Locations' },
            { key: 'logs',         label: 'Logs' },
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

            <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
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
                            <DetailPanel data={detailData[loc.locationId]} />
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
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
              <input
                placeholder="Filter by locationId…"
                value={logFilter.locationId}
                onChange={(e) => setLogFilter((f) => ({ ...f, locationId: e.target.value }))}
                style={{ padding: '8px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, width: 260 }}
              />
              <select
                value={logFilter.event}
                onChange={(e) => setLogFilter((f) => ({ ...f, event: e.target.value }))}
                style={{ padding: '8px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13 }}
              >
                <option value="">All events</option>
                {['install','uninstall','restore','tool_connect','tool_disconnect','tool_reconnect','tool_call','admin_refresh','admin_revoke'].map((e) => (
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

function DetailPanel({ data }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, padding: '14px 0' }}>
      <div>
        <p style={{ color: '#9ca3af', fontSize: 12, margin: '0 0 6px' }}>CONNECTED INTEGRATIONS</p>
        {data.connectedCategories?.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {data.connectedCategories.map((c) => (
              <span key={c} style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 10px', borderRadius: 10, fontSize: 12 }}>{c}</span>
            ))}
          </div>
        ) : <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>None</p>}

        {data.tokenRecord && (
          <>
            <p style={{ color: '#9ca3af', fontSize: 12, margin: '16px 0 4px' }}>TOOL SESSION TOKEN</p>
            <code style={{ color: '#a78bfa', fontSize: 11, wordBreak: 'break-all' }}>{data.tokenRecord.token}</code>
          </>
        )}
      </div>
      <div>
        <p style={{ color: '#9ca3af', fontSize: 12, margin: '0 0 6px' }}>RECENT LOGS</p>
        <div style={{ maxHeight: 160, overflowY: 'auto' }}>
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
  );
}

// ── Log table ─────────────────────────────────────────────────────────────────

function LogTable({ logs }) {
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
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
