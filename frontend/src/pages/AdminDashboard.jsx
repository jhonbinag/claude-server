/**
 * frontend/src/pages/AdminDashboard.jsx
 *
 * Admin Dashboard — location-scoped management panel.
 * URL: /admin-dashboard  (full: /ui/admin-dashboard)
 *
 * Auth: same locationId-based session as user app.
 * Access: mini_admin, admin, or owner roles only.
 *
 * Tabs:
 *   Beta Lab  — toggle beta features on/off for this location
 *   Users     — view + reassign roles for users at this location
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';

// ── helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(path, locationId, opts = {}, userId = null) {
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

const STATUS_META = {
  permanent:  { label: 'Permanent', color: '#34d399', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)'  },
  beta:       { label: 'Beta',      color: '#fbbf24', bg: 'rgba(251,191,36,0.10)',   border: 'rgba(251,191,36,0.28)' },
  not_shared: { label: 'Internal',  color: '#9ca3af', bg: 'rgba(156,163,175,0.08)', border: 'rgba(156,163,175,0.2)' },
};

const ASSIGNABLE_ROLES = [
  { id: 'mini_admin', label: 'Mini Admin', color: '#a78bfa' },
  { id: 'manager',    label: 'Manager',    color: '#60a5fa' },
  { id: 'member',     label: 'Member',     color: '#9ca3af' },
  { id: 'chats_only', label: 'Chat User',  color: '#6b7280' },
];

// ── component ─────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { locationId, locationName, userId, userRole, isAuthenticated } = useApp();

  const [tab,         setTab]         = useState('beta');
  const [authChecked, setAuthChecked] = useState(false);
  const [hasAccess,   setHasAccess]   = useState(false);

  // Beta Lab state
  const [betaFeatures, setBetaFeatures] = useState([]);
  const [betaLoading,  setBetaLoading]  = useState(false);
  const [toggling,     setToggling]     = useState({});

  // Users state
  const [users,       setUsers]       = useState([]);
  const [usersLoading,setUsersLoading] = useState(false);
  const [roleSaving,  setRoleSaving]  = useState({});
  const [syncMsg,     setSyncMsg]     = useState('');

  // ── auth check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const isMiniAdmin = userRole === 'mini_admin' || userRole === 'owner' || userRole === 'admin';
    setHasAccess(isMiniAdmin && isAuthenticated && !!locationId);
    setAuthChecked(true);
  }, [userRole, isAuthenticated, locationId]);

  // ── fetch Beta Lab features ─────────────────────────────────────────────────
  const loadBeta = useCallback(async () => {
    if (!locationId) return;
    setBetaLoading(true);
    const data = await apiFetch('/beta/features', locationId, {}, userId || null);
    if (data.success) setBetaFeatures(data.data || []);
    setBetaLoading(false);
  }, [locationId, userId]);

  // ── fetch Users ─────────────────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    if (!locationId) return;
    setUsersLoading(true);
    const data = await apiFetch('/roles/users', locationId, {}, userId || null);
    if (data.success) setUsers(data.users || []);
    setUsersLoading(false);
  }, [locationId, userId]);

  useEffect(() => {
    if (!hasAccess) return;
    if (tab === 'beta')  loadBeta();
    if (tab === 'users') loadUsers();
  }, [tab, hasAccess]); // eslint-disable-line

  // ── toggle beta feature ─────────────────────────────────────────────────────
  const toggleFeature = async (featureId, enabled) => {
    setToggling(t => ({ ...t, [featureId]: true }));
    const data = await apiFetch(`/beta/features/${featureId}/toggle`, locationId, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }, userId || null);
    if (data.success) {
      setBetaFeatures(prev => prev.map(f => f.featureId === featureId ? { ...f, myEnabled: enabled } : f));
    }
    setToggling(t => ({ ...t, [featureId]: false }));
  };

  // ── change user role ────────────────────────────────────────────────────────
  const changeRole = async (targetUserId, newRole) => {
    setRoleSaving(s => ({ ...s, [targetUserId]: true }));
    const data = await apiFetch(`/roles/users/${targetUserId}`, locationId, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole }),
    }, userId || null);
    if (data.success) {
      setUsers(prev => prev.map(u => u.userId === targetUserId ? { ...u, role: newRole } : u));
    }
    setRoleSaving(s => ({ ...s, [targetUserId]: false }));
  };

  // ── sync GHL users ──────────────────────────────────────────────────────────
  const syncUsers = async () => {
    setSyncMsg('Syncing…');
    const data = await apiFetch('/roles/sync', locationId, { method: 'POST' }, userId || null);
    if (data.success) {
      setUsers(data.users || []);
      setSyncMsg(`Synced ${data.users?.length || 0} users`);
    } else {
      setSyncMsg(data.error || 'Sync failed');
    }
    setTimeout(() => setSyncMsg(''), 3000);
  };

  // ── render ──────────────────────────────────────────────────────────────────

  if (!authChecked) return null;

  if (!isAuthenticated || !locationId) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>🔒</p>
          <p style={{ fontSize: 15 }}>No location connected.</p>
          <p style={{ fontSize: 13, color: '#4b5563', marginTop: 6 }}>Open this app from GoHighLevel to connect your location.</p>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>🚫</p>
          <p style={{ fontSize: 15 }}>Access denied.</p>
          <p style={{ fontSize: 13, color: '#4b5563', marginTop: 6 }}>Mini Admin access requires the <strong style={{ color: '#a78bfa' }}>mini_admin</strong>, <strong style={{ color: '#60a5fa' }}>admin</strong>, or <strong style={{ color: '#f59e0b' }}>owner</strong> role.</p>
        </div>
      </div>
    );
  }

  const TABS = [
    { id: 'beta',  label: '🧪 Beta Lab',   desc: 'Enable or disable beta features for your location' },
    { id: 'users', label: '👥 Users',       desc: 'Manage user roles at your location' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Top bar ── */}
      <div style={{
        background: '#0f1117',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        height: 56,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 18 }}>🧩</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>Admin Dashboard</div>
          <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>
            {locationName || locationId}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 600,
            background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)',
            color: '#a78bfa', borderRadius: 99, padding: '3px 10px',
          }}>
            {userRole === 'owner' ? 'Owner' : userRole === 'admin' ? 'Admin' : 'Mini Admin'}
          </span>
          <a
            href="/ui/"
            style={{ fontSize: 12, color: '#4b5563', textDecoration: 'none', padding: '4px 10px', border: '1px solid #1f2937', borderRadius: 6 }}
          >← Back to App</a>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        background: '#0f1117',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '0 24px',
        display: 'flex',
        gap: 0,
      }}>
        {TABS.map(t => (
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
              transition: 'color .15s',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ── Content ── */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 24px' }}>

        {/* ── Beta Lab ── */}
        {tab === 'beta' && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700 }}>🧪 Beta Lab</h2>
              <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>
                Toggle new features on or off for your location. Users at this location will only see features you enable here.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
              <button
                onClick={loadBeta}
                style={{ background: 'transparent', border: '1px solid #1f2937', borderRadius: 8, color: '#9ca3af', padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}
              >↻ Refresh</button>
            </div>

            {betaLoading ? (
              <p style={{ color: '#4b5563', textAlign: 'center', padding: 48 }}>Loading…</p>
            ) : betaFeatures.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 64, color: '#374151' }}>
                <p style={{ fontSize: 36, margin: '0 0 12px' }}>🧪</p>
                <p style={{ fontSize: 14 }}>No features available right now.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {betaFeatures.map(f => {
                  const sm = STATUS_META[f.status] || STATUS_META.not_shared;
                  const isToggling = toggling[f.featureId];
                  return (
                    <div key={f.featureId} style={{
                      background: '#111827',
                      border: `1px solid ${f.panelOnly ? '#1f2937' : f.myEnabled ? 'rgba(16,185,129,0.25)' : '#1f2937'}`,
                      borderRadius: 12,
                      padding: '16px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      opacity: f.panelOnly ? 0.6 : 1,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ color: '#e5e7eb', fontWeight: 600, fontSize: 14 }}>{f.title}</span>
                          {f.version && (
                            <span style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', padding: '1px 7px', borderRadius: 99, fontSize: 11 }}>{f.version}</span>
                          )}
                          <span style={{ background: sm.bg, border: `1px solid ${sm.border}`, color: sm.color, padding: '1px 7px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{sm.label}</span>
                          {f.panelOnly && (
                            <span style={{ background: 'rgba(107,114,128,0.1)', border: '1px solid rgba(107,114,128,0.2)', color: '#6b7280', padding: '1px 7px', borderRadius: 99, fontSize: 10 }}>Admin view only</span>
                          )}
                        </div>
                        {f.description && (
                          <p style={{ margin: 0, fontSize: 13, color: '#9ca3af', lineHeight: 1.6 }}>{f.description}</p>
                        )}
                        {f.toggleable && (
                          <p style={{ margin: '6px 0 0', fontSize: 11, color: f.myEnabled ? '#34d399' : '#4b5563' }}>
                            {f.myEnabled ? '✓ Enabled for your location' : '✗ Not enabled — users cannot see this'}
                          </p>
                        )}
                        {f.status === 'permanent' && (
                          <p style={{ margin: '6px 0 0', fontSize: 11, color: '#34d399' }}>✓ Automatically available to all users</p>
                        )}
                      </div>

                      {/* Toggle — only for beta features */}
                      {f.toggleable && (
                        <button
                          onClick={() => !isToggling && toggleFeature(f.featureId, !f.myEnabled)}
                          disabled={isToggling}
                          style={{
                            flexShrink: 0,
                            position: 'relative',
                            width: 48, height: 26,
                            borderRadius: 99,
                            background: f.myEnabled ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.06)',
                            border: `1px solid ${f.myEnabled ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.12)'}`,
                            cursor: isToggling ? 'not-allowed' : 'pointer',
                            padding: '0 3px',
                            display: 'flex',
                            alignItems: 'center',
                            transition: 'all .2s',
                            opacity: isToggling ? 0.5 : 1,
                          }}
                          title={f.myEnabled ? 'Disable for this location' : 'Enable for this location'}
                        >
                          <span style={{
                            width: 18, height: 18, borderRadius: '50%',
                            background: f.myEnabled ? '#10b981' : '#4b5563',
                            transform: f.myEnabled ? 'translateX(22px)' : 'translateX(0)',
                            transition: 'all .2s',
                            display: 'block',
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
        {tab === 'users' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700 }}>👥 Users</h2>
                <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>
                  View and manage roles for users at this location.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {syncMsg && <span style={{ fontSize: 12, color: '#9ca3af' }}>{syncMsg}</span>}
                <button
                  onClick={syncUsers}
                  style={{ background: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#9ca3af', padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}
                >↻ Sync from GHL</button>
              </div>
            </div>

            {usersLoading ? (
              <p style={{ color: '#4b5563', textAlign: 'center', padding: 48 }}>Loading…</p>
            ) : users.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 64, color: '#374151' }}>
                <p style={{ fontSize: 36, margin: '0 0 12px' }}>👥</p>
                <p style={{ fontSize: 14 }}>No users synced yet.</p>
                <button onClick={syncUsers} style={{ marginTop: 12, background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
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
                      const isSelf = u.userId === userId;
                      const saving = roleSaving[u.userId];
                      // Determine which roles this mini_admin can assign (cannot set owner or admin above themselves)
                      const canAssign = userRole === 'owner'
                        ? ['owner', 'admin', ...ASSIGNABLE_ROLES.map(r => r.id)]
                        : ASSIGNABLE_ROLES.map(r => r.id); // mini_admin/admin can assign up to mini_admin

                      return (
                        <tr key={u.userId} style={{ borderBottom: '1px solid #1a2030' }}>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb' }}>
                              {u.name || 'Unknown'}
                              {isSelf && <span style={{ marginLeft: 6, fontSize: 10, color: '#6366f1', background: 'rgba(99,102,241,0.15)', borderRadius: 99, padding: '1px 6px' }}>you</span>}
                            </div>
                            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#4b5563', marginTop: 2 }}>{u.userId}</div>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 12, color: '#6b7280' }}>{u.email || '—'}</td>
                          <td style={{ padding: '12px 16px', fontSize: 12, color: '#9ca3af' }}>{u.ghlRole || '—'}</td>
                          <td style={{ padding: '12px 16px' }}>
                            {isSelf ? (
                              <span style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>{u.role}</span>
                            ) : (
                              <select
                                value={u.role || 'chats_only'}
                                disabled={saving}
                                onChange={e => changeRole(u.userId, e.target.value)}
                                style={{
                                  background: '#1a2030', border: '1px solid #374151', borderRadius: 6,
                                  color: '#e5e7eb', padding: '5px 10px', fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer',
                                  opacity: saving ? 0.5 : 1,
                                }}
                              >
                                {canAssign.map(rid => {
                                  const info = ASSIGNABLE_ROLES.find(r => r.id === rid) || { id: rid, label: rid };
                                  const extraRoles = [
                                    { id: 'owner', label: 'Owner' },
                                    { id: 'admin', label: 'Admin' },
                                  ];
                                  const label = info.label || extraRoles.find(r => r.id === rid)?.label || rid;
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

            {/* Role legend */}
            <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ASSIGNABLE_ROLES.map(r => (
                <div key={r.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #1f2937', borderRadius: 6, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: r.color, fontWeight: 600 }}>{r.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
