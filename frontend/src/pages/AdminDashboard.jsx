/**
 * frontend/src/pages/AdminDashboard.jsx
 *
 * Standalone Admin Dashboard — completely independent from the user app.
 * URL: /ui/admin-dashboard
 *
 * No AppContext dependency. Has its own locationId login form.
 * Tabs are controlled by the super admin via /admin → Dashboard Config.
 */

import { useState, useEffect, useCallback } from 'react';

// ── storage keys (separate namespace from main app) ───────────────────────────
const LS_LOC  = 'gtm_dash_location_id';
const LS_UID  = 'gtm_dash_user_id';
const LS_NAME = (id) => `gtm_dash_name_${id}`;

// ── API helper (uses /dashboard/* endpoints) ──────────────────────────────────
async function dashFetch(path, locationId, opts = {}, userId = null) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-location-id': locationId,
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(opts.headers || {}),
    },
  });
  return res.json();
}

// ── status pill styling ───────────────────────────────────────────────────────
const STATUS_META = {
  permanent:  { label: 'Permanent', color: '#34d399', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)'  },
  beta:       { label: 'Beta',      color: '#fbbf24', bg: 'rgba(251,191,36,0.10)',   border: 'rgba(251,191,36,0.28)' },
  not_shared: { label: 'Internal',  color: '#9ca3af', bg: 'rgba(156,163,175,0.08)', border: 'rgba(156,163,175,0.2)' },
};

const ROLE_COLORS = {
  owner: '#f59e0b', admin: '#60a5fa', mini_admin: '#a78bfa',
  manager: '#34d399', member: '#9ca3af', chats_only: '#6b7280',
};

const ASSIGNABLE_ROLES = [
  { id: 'mini_admin', label: 'Mini Admin' },
  { id: 'manager',    label: 'Manager'    },
  { id: 'member',     label: 'Member'     },
  { id: 'chats_only', label: 'Chat User'  },
];

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  // ── auth state ──────────────────────────────────────────────────────────────
  const [locationId,   setLocationId]   = useState(() => localStorage.getItem(LS_LOC) || '');
  const [userId,       setUserId]       = useState(() => localStorage.getItem(LS_UID) || '');
  const [locationName, setLocationName] = useState(() => {
    const id = localStorage.getItem(LS_LOC);
    return id ? (localStorage.getItem(LS_NAME(id)) || '') : '';
  });
  const [loginInput,   setLoginInput]   = useState('');
  const [uidInput,     setUidInput]     = useState('');
  const [loginErr,     setLoginErr]     = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [authed,       setAuthed]       = useState(() => !!localStorage.getItem(LS_LOC));

  // ── dashboard state ─────────────────────────────────────────────────────────
  const [tab,         setTab]         = useState('beta');
  const [enabledTabs, setEnabledTabs] = useState([]);
  const [role,        setRole]        = useState('');
  const [configLoaded,setConfigLoaded]= useState(false);

  // Beta Lab
  const [betaFeatures, setBetaFeatures] = useState([]);
  const [betaLoading,  setBetaLoading]  = useState(false);
  const [toggling,     setToggling]     = useState({});

  // Users
  const [users,        setUsers]        = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [roleSaving,   setRoleSaving]   = useState({});
  const [syncMsg,      setSyncMsg]      = useState('');

  // ── login ───────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    const loc = loginInput.trim();
    if (!loc) { setLoginErr('Enter a Location ID.'); return; }
    setLoginLoading(true);
    setLoginErr('');
    try {
      const data = await dashFetch('/dashboard/config', loc, {}, uidInput.trim() || null);
      if (data.success) {
        localStorage.setItem(LS_LOC, loc);
        if (uidInput.trim()) localStorage.setItem(LS_UID, uidInput.trim());
        if (data.locationName) localStorage.setItem(LS_NAME(loc), data.locationName);
        setLocationId(loc);
        setUserId(uidInput.trim());
        setLocationName(data.locationName || '');
        setEnabledTabs(data.data?.enabledTabs || []);
        setRole(data.role || 'owner');
        setAuthed(true);
      } else {
        setLoginErr(data.error || 'Invalid Location ID.');
      }
    } catch {
      setLoginErr('Could not connect. Check the Location ID and try again.');
    }
    setLoginLoading(false);
  };

  const handleLogout = () => {
    localStorage.removeItem(LS_LOC);
    localStorage.removeItem(LS_UID);
    setAuthed(false);
    setLocationId('');
    setUserId('');
    setLocationName('');
    setLoginInput('');
    setUidInput('');
    setBetaFeatures([]);
    setUsers([]);
  };

  // ── load config ─────────────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    if (!locationId) return;
    const data = await dashFetch('/dashboard/config', locationId, {}, userId || null);
    if (data.success) {
      setEnabledTabs(data.data?.enabledTabs || []);
      setRole(data.role || 'owner');
      if (data.locationName) {
        setLocationName(data.locationName);
        localStorage.setItem(LS_NAME(locationId), data.locationName);
      }
      setConfigLoaded(true);
    }
  }, [locationId, userId]);

  // ── load beta features ──────────────────────────────────────────────────────
  const loadBeta = useCallback(async () => {
    if (!locationId) return;
    setBetaLoading(true);
    const data = await dashFetch('/dashboard/beta', locationId, {}, userId || null);
    if (data.success) setBetaFeatures(data.data || []);
    setBetaLoading(false);
  }, [locationId, userId]);

  // ── load users ──────────────────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    if (!locationId) return;
    setUsersLoading(true);
    const data = await dashFetch('/dashboard/users', locationId, {}, userId || null);
    if (data.success) setUsers(data.users || []);
    setUsersLoading(false);
  }, [locationId, userId]);

  // ── on auth, load config then initial tab ───────────────────────────────────
  useEffect(() => {
    if (!authed || !locationId) return;
    loadConfig();
  }, [authed, locationId]); // eslint-disable-line

  useEffect(() => {
    if (!authed || !locationId || !configLoaded) return;
    // Default to first enabled tab
    const firstTab = enabledTabs[0] || 'beta';
    setTab(t => enabledTabs.includes(t) ? t : firstTab);
  }, [configLoaded]); // eslint-disable-line

  useEffect(() => {
    if (!authed || !locationId) return;
    if (tab === 'beta')  loadBeta();
    if (tab === 'users') loadUsers();
  }, [tab, authed]); // eslint-disable-line

  // ── toggle beta ─────────────────────────────────────────────────────────────
  const toggleFeature = async (featureId, enabled) => {
    setToggling(t => ({ ...t, [featureId]: true }));
    const data = await dashFetch(`/dashboard/beta/${featureId}/toggle`, locationId, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }, userId || null);
    if (data.success) {
      setBetaFeatures(prev => prev.map(f =>
        f.featureId === featureId ? { ...f, myEnabled: enabled } : f
      ));
    }
    setToggling(t => ({ ...t, [featureId]: false }));
  };

  // ── change user role ─────────────────────────────────────────────────────────
  const changeRole = async (targetUserId, newRole) => {
    setRoleSaving(s => ({ ...s, [targetUserId]: true }));
    const data = await dashFetch(`/dashboard/users/${targetUserId}`, locationId, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole }),
    }, userId || null);
    if (data.success) {
      setUsers(prev => prev.map(u => u.userId === targetUserId ? { ...u, role: newRole } : u));
    }
    setRoleSaving(s => ({ ...s, [targetUserId]: false }));
  };

  // ── sync users ───────────────────────────────────────────────────────────────
  const syncUsers = async () => {
    setSyncMsg('Syncing…');
    const data = await dashFetch('/dashboard/users/sync', locationId, { method: 'POST' }, userId || null);
    if (data.success) {
      setUsers(data.users || []);
      setSyncMsg(`Synced ${data.users?.length || 0} users`);
    } else {
      setSyncMsg(data.error || 'Sync failed');
    }
    setTimeout(() => setSyncMsg(''), 3500);
  };

  // ── shared styles ────────────────────────────────────────────────────────────
  const isMiniAdmin = ['mini_admin', 'owner', 'admin'].includes(role);

  const ALL_TABS_META = [
    { id: 'beta',  label: '🧪 Beta Lab' },
    { id: 'users', label: '👥 Users'    },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // LOGIN SCREEN
  // ═══════════════════════════════════════════════════════════════════════════
  if (!authed) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a0f',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif', padding: 16,
      }}>
        <div style={{
          width: '100%', maxWidth: 400,
          background: '#0f1117',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          padding: 32,
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🧩</div>
            <h1 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>Admin Dashboard</h1>
            <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>HL Pro Tools — location management</p>
          </div>

          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 5 }}>
            Location ID <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            value={loginInput}
            onChange={e => setLoginInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="e.g. abc123xyz"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#0a0f1a', border: '1px solid #1f2937',
              borderRadius: 8, color: '#f1f5f9', padding: '10px 14px',
              fontSize: 14, outline: 'none', marginBottom: 14,
            }}
          />

          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 5 }}>
            User ID <span style={{ color: '#4b5563', fontWeight: 400 }}>(optional — for role-based access)</span>
          </label>
          <input
            value={uidInput}
            onChange={e => setUidInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="Your GHL user ID"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#0a0f1a', border: '1px solid #1f2937',
              borderRadius: 8, color: '#f1f5f9', padding: '10px 14px',
              fontSize: 14, outline: 'none', marginBottom: 20,
            }}
          />

          {loginErr && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#f87171', marginBottom: 16 }}>
              {loginErr}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loginLoading}
            style={{
              width: '100%', background: '#6366f1', border: 'none',
              borderRadius: 8, color: '#fff', padding: '11px 0',
              fontSize: 14, fontWeight: 600, cursor: loginLoading ? 'not-allowed' : 'pointer',
              opacity: loginLoading ? 0.7 : 1, transition: 'opacity .15s',
            }}
          >
            {loginLoading ? 'Connecting…' : 'Access Dashboard'}
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCESS DENIED
  // ═══════════════════════════════════════════════════════════════════════════
  if (!isMiniAdmin) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <p style={{ fontSize: 36, margin: '0 0 12px' }}>🚫</p>
          <p style={{ fontSize: 16, color: '#e5e7eb', fontWeight: 600 }}>Access denied</p>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '8px 0 20px' }}>
            Your role (<strong style={{ color: '#9ca3af' }}>{role}</strong>) does not have access to this panel.
          </p>
          <button onClick={handleLogout} style={{ background: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#9ca3af', padding: '8px 20px', cursor: 'pointer', fontSize: 13 }}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════
  const visibleTabs = ALL_TABS_META.filter(t => enabledTabs.includes(t.id));

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Top bar ── */}
      <div style={{
        background: '#0f1117',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        height: 56,
      }}>
        <span style={{ fontSize: 20 }}>🧩</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.2 }}>Admin Dashboard</div>
          <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {locationName ? `${locationName} · ${locationId}` : locationId}
          </div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 600, flexShrink: 0,
          background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)',
          color: '#a78bfa', borderRadius: 99, padding: '3px 10px',
        }}>
          {role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Mini Admin'}
        </span>
        <button
          onClick={handleLogout}
          style={{
            flexShrink: 0, background: 'transparent',
            border: '1px solid #1f2937', borderRadius: 7,
            color: '#6b7280', padding: '5px 12px', cursor: 'pointer', fontSize: 12,
          }}
        >Sign out</button>
      </div>

      {/* ── Tab bar ── */}
      {visibleTabs.length > 1 && (
        <div style={{
          background: '#0f1117',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '0 24px',
          display: 'flex',
        }}>
          {visibleTabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: 'none', border: 'none',
                borderBottom: tab === t.id ? '2px solid #6366f1' : '2px solid transparent',
                color: tab === t.id ? '#a5b4fc' : '#6b7280',
                padding: '14px 20px',
                fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
                cursor: 'pointer',
              }}
            >{t.label}</button>
          ))}
        </div>
      )}

      {/* ── Content ── */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px' }}>

        {/* ── Beta Lab ── */}
        {tab === 'beta' && enabledTabs.includes('beta') && (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: '0 0 5px', fontSize: 17, fontWeight: 700 }}>🧪 Beta Lab</h2>
                <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>
                  Enable or disable beta features for your location. Users only see what you turn on.
                </p>
              </div>
              <button onClick={loadBeta} style={{ background: 'transparent', border: '1px solid #1f2937', borderRadius: 8, color: '#9ca3af', padding: '7px 14px', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>
                ↻ Refresh
              </button>
            </div>

            {betaLoading ? (
              <p style={{ color: '#4b5563', textAlign: 'center', padding: 60 }}>Loading…</p>
            ) : betaFeatures.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 72, color: '#374151' }}>
                <p style={{ fontSize: 36, margin: '0 0 12px' }}>🧪</p>
                <p style={{ fontSize: 14 }}>No features published yet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {betaFeatures.map(f => {
                  const sm = STATUS_META[f.status] || STATUS_META.not_shared;
                  const busy = toggling[f.featureId];
                  return (
                    <div key={f.featureId} style={{
                      background: '#111827',
                      border: `1px solid ${f.panelOnly ? '#1f2937' : f.myEnabled ? 'rgba(16,185,129,0.3)' : '#1f2937'}`,
                      borderRadius: 12, padding: '16px 18px',
                      display: 'flex', alignItems: 'center', gap: 16,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                          <span style={{ color: '#e5e7eb', fontWeight: 600, fontSize: 14 }}>{f.title}</span>
                          {f.version && (
                            <span style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', padding: '1px 7px', borderRadius: 99, fontSize: 11 }}>{f.version}</span>
                          )}
                          <span style={{ background: sm.bg, border: `1px solid ${sm.border}`, color: sm.color, padding: '1px 7px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{sm.label}</span>
                          {f.panelOnly && <span style={{ fontSize: 10, color: '#4b5563' }}>— admin view only</span>}
                        </div>
                        {f.description && (
                          <p style={{ margin: 0, fontSize: 13, color: '#9ca3af', lineHeight: 1.6 }}>{f.description}</p>
                        )}
                        {f.toggleable && (
                          <p style={{ margin: '6px 0 0', fontSize: 11, color: f.myEnabled ? '#34d399' : '#4b5563' }}>
                            {f.myEnabled ? '✓ Enabled for your users' : '✗ Disabled — users cannot see this'}
                          </p>
                        )}
                        {f.status === 'permanent' && (
                          <p style={{ margin: '6px 0 0', fontSize: 11, color: '#34d399' }}>✓ Automatically available to all users</p>
                        )}
                      </div>

                      {f.toggleable && (
                        <button
                          onClick={() => !busy && toggleFeature(f.featureId, !f.myEnabled)}
                          disabled={busy}
                          title={f.myEnabled ? 'Disable for users' : 'Enable for users'}
                          style={{
                            flexShrink: 0, position: 'relative',
                            width: 50, height: 27, borderRadius: 99,
                            background: f.myEnabled ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.06)',
                            border: `1px solid ${f.myEnabled ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.12)'}`,
                            cursor: busy ? 'not-allowed' : 'pointer',
                            padding: '0 3px', display: 'flex', alignItems: 'center',
                            transition: 'all .2s', opacity: busy ? 0.5 : 1,
                          }}
                        >
                          <span style={{
                            width: 19, height: 19, borderRadius: '50%',
                            background: f.myEnabled ? '#10b981' : '#4b5563',
                            transform: f.myEnabled ? 'translateX(23px)' : 'translateX(0)',
                            transition: 'all .2s', display: 'block',
                          }} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Users ── */}
        {tab === 'users' && enabledTabs.includes('users') && (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: '0 0 5px', fontSize: 17, fontWeight: 700 }}>👥 Users</h2>
                <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>Manage roles for users at this location.</p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                {syncMsg && <span style={{ fontSize: 12, color: '#9ca3af' }}>{syncMsg}</span>}
                <button onClick={loadUsers} style={{ background: 'transparent', border: '1px solid #1f2937', borderRadius: 8, color: '#9ca3af', padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}>↻ Refresh</button>
                <button onClick={syncUsers} style={{ background: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#9ca3af', padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}>⟳ Sync GHL</button>
              </div>
            </div>

            {usersLoading ? (
              <p style={{ color: '#4b5563', textAlign: 'center', padding: 60 }}>Loading…</p>
            ) : users.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 72, color: '#374151' }}>
                <p style={{ fontSize: 36, margin: '0 0 12px' }}>👥</p>
                <p style={{ fontSize: 14 }}>No users yet.</p>
                <button onClick={syncUsers} style={{ marginTop: 12, background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  Sync from GHL
                </button>
              </div>
            ) : (
              <div style={{ background: '#0f1117', border: '1px solid #1f2937', borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1f2937' }}>
                      {['User', 'Email', 'GHL Role', 'App Role'].map(h => (
                        <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#4b5563' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => {
                      const isSelf    = u.userId === userId;
                      const saving    = roleSaving[u.userId];
                      const roleColor = ROLE_COLORS[u.role] || '#9ca3af';
                      // mini_admin cannot escalate to owner/admin
                      const canAssign = role === 'owner'
                        ? ['owner', 'admin', ...ASSIGNABLE_ROLES.map(r => r.id)]
                        : ASSIGNABLE_ROLES.map(r => r.id);
                      const extraLabels = { owner: 'Owner', admin: 'Admin' };

                      return (
                        <tr key={u.userId} style={{ borderBottom: '1px solid #151e2d' }}>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb' }}>
                              {u.name || 'Unknown'}
                              {isSelf && <span style={{ marginLeft: 6, fontSize: 10, color: '#6366f1', background: 'rgba(99,102,241,0.15)', borderRadius: 99, padding: '1px 6px' }}>you</span>}
                            </div>
                            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#374151', marginTop: 2 }}>{u.userId}</div>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 12, color: '#6b7280' }}>{u.email || '—'}</td>
                          <td style={{ padding: '12px 16px', fontSize: 12, color: '#9ca3af' }}>{u.ghlRole || '—'}</td>
                          <td style={{ padding: '12px 16px' }}>
                            {isSelf ? (
                              <span style={{ fontSize: 12, color: roleColor, fontWeight: 600 }}>{u.role}</span>
                            ) : (
                              <select
                                value={u.role || 'chats_only'}
                                disabled={saving}
                                onChange={e => changeRole(u.userId, e.target.value)}
                                style={{
                                  background: '#1a2030', border: '1px solid #374151', borderRadius: 6,
                                  color: '#e5e7eb', padding: '5px 10px', fontSize: 12,
                                  cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1,
                                }}
                              >
                                {canAssign.map(rid => {
                                  const info = ASSIGNABLE_ROLES.find(r => r.id === rid);
                                  const label = info?.label || extraLabels[rid] || rid;
                                  return <option key={rid} value={rid}>{label}</option>;
                                })}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
