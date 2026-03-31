/**
 * frontend/src/pages/AdminDashboard.jsx
 *
 * Standalone Admin Dashboard — completely independent, own login.
 * URL: /ui/admin-dashboard
 *
 * Login: username + password → session token (8h, stored in localStorage).
 * If credential covers multiple locations, shows a location picker after login.
 * Activation: /dashboard/activate/:token redirects here with ?activated=1
 */

import { useState, useEffect, useCallback } from 'react';

// ── storage ───────────────────────────────────────────────────────────────────
const LS_TOKEN    = 'gtm_dash_token';
const LS_CRED     = 'gtm_dash_cred';
const LS_LOCATION = 'gtm_dash_location'; // active locationId for multi-location creds

function loadSession() {
  try {
    const token    = localStorage.getItem(LS_TOKEN);
    const cred     = JSON.parse(localStorage.getItem(LS_CRED) || 'null');
    const location = localStorage.getItem(LS_LOCATION) || null;
    return (token && cred) ? { token, cred, location } : null;
  } catch { return null; }
}

// ── API helper — uses x-dash-token + optional x-dash-location ─────────────────
async function dashFetch(path, token, activeLocationId, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'x-dash-token': token } : {}),
    ...(activeLocationId ? { 'x-dash-location': activeLocationId } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(path, { ...opts, headers });
  return res.json();
}

// ── static meta ───────────────────────────────────────────────────────────────
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

const fieldStyle = {
  width: '100%', boxSizing: 'border-box',
  background: '#0a0f1a', border: '1px solid #1f2937',
  borderRadius: 8, color: '#f1f5f9', padding: '10px 14px',
  fontSize: 14, outline: 'none',
};

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const session = loadSession();

  // ── auth / session state ────────────────────────────────────────────────────
  const [token,           setToken]           = useState(session?.token || null);
  const [cred,            setCred]            = useState(session?.cred  || null);
  const [authed,          setAuthed]          = useState(!!session);

  // Multi-location
  const [locationsList,   setLocationsList]   = useState([]); // available locations for picker
  const [activeLocationId, setActiveLocationId] = useState(session?.location || null);
  const [locationPicker,  setLocationPicker]  = useState(false); // show picker?

  // Login form
  const [usernameIn,      setUsernameIn]      = useState('');
  const [passwordIn,      setPasswordIn]      = useState('');
  const [showPass,        setShowPass]        = useState(false);
  const [loginErr,        setLoginErr]        = useState('');
  const [loginLoading,    setLoginLoading]    = useState(false);

  // Activation messages (from ?activated=1 / ?activation_error=...)
  const [activationMsg,   setActivationMsg]   = useState(null); // { type: 'success'|'error', text }

  // Dashboard
  const [tab,             setTab]             = useState('beta');
  const [enabledTabs,     setEnabledTabs]     = useState([]);
  const [configLoaded,    setConfigLoaded]    = useState(false);
  const [bizProfile,      setBizProfile]      = useState(null);

  // Beta Lab
  const [betaFeatures,    setBetaFeatures]    = useState([]);
  const [betaLoading,     setBetaLoading]     = useState(false);
  const [toggling,        setToggling]        = useState({});

  // Users
  const [users,           setUsers]           = useState([]);
  const [usersLoading,    setUsersLoading]    = useState(false);
  const [roleSaving,      setRoleSaving]      = useState({});
  const [syncMsg,         setSyncMsg]         = useState('');

  // ── parse URL params on mount ─────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('activated') === '1') {
      setActivationMsg({ type: 'success', text: 'Account activated! You can now sign in with your username and password.' });
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('activation_error')) {
      setActivationMsg({ type: 'error', text: params.get('activation_error') });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // ── helpers ───────────────────────────────────────────────────────────────
  const isSingleLocation = (c) => {
    if (!c) return false;
    const ids = c.locationIds || (c.locationId ? [c.locationId] : []);
    return ids.length === 1 && !ids.includes('all');
  };

  const needsLocationPicker = (c) => {
    if (!c) return false;
    const ids = c.locationIds || (c.locationId ? [c.locationId] : []);
    return ids.includes('all') || ids.length > 1;
  };

  const handleLogout = () => {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_CRED);
    localStorage.removeItem(LS_LOCATION);
    setAuthed(false); setToken(null); setCred(null);
    setActiveLocationId(null); setLocationsList([]);
    setLocationPicker(false);
    setUsernameIn(''); setPasswordIn('');
    setBetaFeatures([]); setUsers([]);
    setConfigLoaded(false);
  };

  // ── login ─────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!usernameIn.trim() || !passwordIn.trim()) {
      setLoginErr('Enter your username and password.');
      return;
    }
    setLoginLoading(true);
    setLoginErr('');
    try {
      const data = await fetch('/dashboard/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameIn.trim(), password: passwordIn }),
      }).then(r => r.json());

      if (data.success) {
        const credData = {
          name:        data.credential.name,
          email:       data.credential.email || '',
          username:    data.credential.username,
          locationIds: data.credential.locationIds || (data.credential.locationId ? [data.credential.locationId] : []),
          role:        data.credential.role,
        };
        localStorage.setItem(LS_TOKEN, data.token);
        localStorage.setItem(LS_CRED, JSON.stringify(credData));
        setToken(data.token);
        setCred(credData);

        // Determine if we need a location picker
        if (isSingleLocation(credData)) {
          const locId = credData.locationIds[0];
          localStorage.setItem(LS_LOCATION, locId);
          setActiveLocationId(locId);
          setAuthed(true);
        } else {
          // Multi or all — fetch locations then show picker
          setAuthed(true);
          setLocationPicker(true);
        }
      } else {
        setLoginErr(data.error || 'Login failed.');
      }
    } catch {
      setLoginErr('Could not connect to server.');
    }
    setLoginLoading(false);
  };

  // ── load locations for picker ─────────────────────────────────────────────
  const loadLocations = useCallback(async (tok) => {
    const t = tok || token;
    if (!t) return;
    const data = await dashFetch('/dashboard/locations', t, null);
    if (data.success) setLocationsList(data.locations || []);
  }, [token]);

  useEffect(() => {
    if (authed && locationPicker && token) loadLocations(token);
  }, [authed, locationPicker, token]); // eslint-disable-line

  const selectLocation = (locId) => {
    localStorage.setItem(LS_LOCATION, locId);
    setActiveLocationId(locId);
    setLocationPicker(false);
  };

  // ── load public config (enabled tabs) ─────────────────────────────────────
  const loadConfig = useCallback(async () => {
    const data = await fetch('/dashboard/public-config').then(r => r.json());
    if (data.success) {
      setEnabledTabs(data.enabledTabs || []);
      if (data.businessProfile) setBizProfile(data.businessProfile);
      setConfigLoaded(true);
    }
  }, []);

  // ── data loaders ──────────────────────────────────────────────────────────
  const loadBeta = useCallback(async () => {
    if (!token || !activeLocationId) return;
    setBetaLoading(true);
    const data = await dashFetch('/dashboard/beta', token, activeLocationId);
    if (data.success) setBetaFeatures(data.data || []);
    else if (data.error?.includes('expired') || data.error?.includes('Invalid')) handleLogout();
    setBetaLoading(false);
  }, [token, activeLocationId]); // eslint-disable-line

  const loadUsers = useCallback(async () => {
    if (!token || !activeLocationId) return;
    setUsersLoading(true);
    const data = await dashFetch('/dashboard/users', token, activeLocationId);
    if (data.success) setUsers(data.users || []);
    setUsersLoading(false);
  }, [token, activeLocationId]); // eslint-disable-line

  // ── effects ───────────────────────────────────────────────────────────────
  useEffect(() => { if (authed && !locationPicker) loadConfig(); }, [authed, locationPicker]); // eslint-disable-line

  useEffect(() => {
    if (!authed || !configLoaded) return;
    const firstTab = enabledTabs[0] || 'beta';
    setTab(t => enabledTabs.includes(t) ? t : firstTab);
  }, [configLoaded]); // eslint-disable-line

  useEffect(() => {
    if (!authed || locationPicker || !activeLocationId) return;
    if (tab === 'beta')  loadBeta();
    if (tab === 'users') loadUsers();
  }, [tab, authed, activeLocationId, locationPicker]); // eslint-disable-line

  // ── actions ───────────────────────────────────────────────────────────────
  const toggleFeature = async (featureId, enabled) => {
    setToggling(t => ({ ...t, [featureId]: true }));
    const data = await dashFetch(`/dashboard/beta/${featureId}/toggle`, token, activeLocationId, {
      method: 'POST', body: JSON.stringify({ enabled }),
    });
    if (data.success) setBetaFeatures(prev => prev.map(f => f.featureId === featureId ? { ...f, myEnabled: enabled } : f));
    setToggling(t => ({ ...t, [featureId]: false }));
  };

  const changeRole = async (targetUserId, newRole) => {
    setRoleSaving(s => ({ ...s, [targetUserId]: true }));
    const data = await dashFetch(`/dashboard/users/${targetUserId}`, token, activeLocationId, {
      method: 'PUT', body: JSON.stringify({ role: newRole }),
    });
    if (data.success) setUsers(prev => prev.map(u => u.userId === targetUserId ? { ...u, role: newRole } : u));
    setRoleSaving(s => ({ ...s, [targetUserId]: false }));
  };

  const syncUsers = async () => {
    setSyncMsg('Syncing…');
    const data = await dashFetch('/dashboard/users/sync', token, activeLocationId, { method: 'POST' });
    if (data.success) { setUsers(data.users || []); setSyncMsg(`Synced ${data.users?.length || 0} users`); }
    else setSyncMsg(data.error || 'Sync failed');
    setTimeout(() => setSyncMsg(''), 3500);
  };

  const isMiniAdmin = ['mini_admin', 'owner', 'admin'].includes(cred?.role);
  const ALL_TABS_META = [
    { id: 'beta',  label: '🧪 Beta Lab' },
    { id: 'users', label: '👥 Users'    },
  ];
  const visibleTabs = ALL_TABS_META.filter(t => enabledTabs.includes(t.id));

  // ── active location display name ──────────────────────────────────────────
  const activeLocationName = locationsList.find(l => l.locationId === activeLocationId)?.locationName || activeLocationId || '';

  // ═══════════════════════════════════════════════════════════════════════════
  // LOGIN SCREEN
  // ═══════════════════════════════════════════════════════════════════════════
  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', background: '#07080f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', padding: 16 }}>
        <div style={{ width: '100%', maxWidth: 400 }}>

          {/* Activation messages */}
          {activationMsg && (
            <div style={{
              marginBottom: 20, padding: '12px 16px', borderRadius: 10, fontSize: 13, lineHeight: 1.6,
              background: activationMsg.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${activationMsg.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: activationMsg.type === 'success' ? '#34d399' : '#f87171',
            }}>
              {activationMsg.type === 'success' ? '✓ ' : '✗ '}{activationMsg.text}
            </div>
          )}

          <div style={{ background: '#0f1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '36px 32px', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ fontSize: 38, marginBottom: 12 }}>
                {bizProfile?.logoUrl
                  ? <img src={bizProfile.logoUrl} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover' }} onError={e => { e.target.style.display='none'; }} />
                  : bizProfile?.logoEmoji || '🧩'}
              </div>
              <h1 style={{ margin: '0 0 6px', fontSize: 21, fontWeight: 700, color: '#f1f5f9' }}>Admin Dashboard</h1>
              <p style={{ margin: 0, fontSize: 13, color: '#4b5563' }}>{bizProfile?.name || 'HL Pro Tools'}</p>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 5 }}>Username</label>
              <input
                value={usernameIn}
                onChange={e => setUsernameIn(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="your username"
                autoComplete="username"
                style={fieldStyle}
              />
            </div>

            <div style={{ marginBottom: 22 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 5 }}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  value={passwordIn}
                  onChange={e => setPasswordIn(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  type={showPass ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={{ ...fieldStyle, paddingRight: 42 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: 14, padding: 0 }}
                >{showPass ? '🙈' : '👁️'}</button>
              </div>
            </div>

            {loginErr && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '9px 13px', fontSize: 13, color: '#f87171', marginBottom: 16 }}>
                {loginErr}
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={loginLoading}
              style={{ width: '100%', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', padding: '12px 0', fontSize: 14, fontWeight: 600, cursor: loginLoading ? 'not-allowed' : 'pointer', opacity: loginLoading ? 0.7 : 1 }}
            >
              {loginLoading ? 'Signing in…' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOCATION PICKER (multi-location credentials)
  // ═══════════════════════════════════════════════════════════════════════════
  if (locationPicker) {
    return (
      <div style={{ minHeight: '100vh', background: '#07080f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', padding: 16 }}>
        <div style={{ width: '100%', maxWidth: 460, background: '#0f1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '32px 28px', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📍</div>
            <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>Select a Location</h2>
            <p style={{ margin: 0, fontSize: 13, color: '#4b5563' }}>Hi {cred?.name} — choose which location to manage.</p>
          </div>

          {locationsList.length === 0 ? (
            <p style={{ color: '#4b5563', textAlign: 'center', fontSize: 13 }}>Loading locations…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {locationsList.map(loc => (
                <button
                  key={loc.locationId}
                  onClick={() => selectLocation(loc.locationId)}
                  style={{
                    background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)',
                    borderRadius: 10, padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
                    transition: 'all .15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.12)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.35)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.06)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.15)'; }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb' }}>{loc.locationName || 'Unnamed Location'}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#4b5563', marginTop: 3 }}>{loc.locationId}</div>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={handleLogout}
            style={{ width: '100%', marginTop: 20, background: 'transparent', border: '1px solid #1f2937', borderRadius: 8, color: '#4b5563', padding: '10px 0', fontSize: 13, cursor: 'pointer' }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: '100vh', background: '#07080f', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif' }}>

      {/* Top bar */}
      <div style={{ background: '#0f1117', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 14, height: 56 }}>
        <span style={{ fontSize: 20 }}>
          {bizProfile?.logoUrl
            ? <img src={bizProfile.logoUrl} alt="" style={{ width: 24, height: 24, borderRadius: 5, objectFit: 'cover', verticalAlign: 'middle' }} onError={e => { e.target.style.display='none'; }} />
            : bizProfile?.logoEmoji || '🧩'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{bizProfile?.name || 'Admin Dashboard'}</div>
          <div style={{ fontSize: 11, color: '#4b5563', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeLocationName || activeLocationId || '—'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Location switcher — only if multi-location credential */}
          {needsLocationPicker(cred) && (
            <button
              onClick={() => { loadLocations(); setLocationPicker(true); }}
              style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 7, color: '#a5b4fc', padding: '5px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
            >
              📍 Switch Location
            </button>
          )}

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb' }}>{cred?.name}</div>
            <div style={{ fontSize: 10, color: '#4b5563' }}>{cred?.username}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa', borderRadius: 99, padding: '3px 10px' }}>
            {cred?.role === 'admin' ? 'Admin' : 'Mini Admin'}
          </span>
          <button onClick={handleLogout} style={{ background: 'transparent', border: '1px solid #1f2937', borderRadius: 7, color: '#6b7280', padding: '5px 12px', cursor: 'pointer', fontSize: 12 }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Tab bar */}
      {visibleTabs.length > 1 && (
        <div style={{ background: '#0f1117', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '0 24px', display: 'flex' }}>
          {visibleTabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: 'none', border: 'none',
              borderBottom: tab === t.id ? '2px solid #6366f1' : '2px solid transparent',
              color: tab === t.id ? '#a5b4fc' : '#6b7280',
              padding: '14px 20px', fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400, cursor: 'pointer',
            }}>{t.label}</button>
          ))}
        </div>
      )}

      {/* Content */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px' }}>

        {/* ── Beta Lab ── */}
        {tab === 'beta' && enabledTabs.includes('beta') && (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: '0 0 5px', fontSize: 17, fontWeight: 700 }}>🧪 Beta Lab</h2>
                <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>
                  Enable or disable beta features for your location.
                </p>
              </div>
              <button onClick={loadBeta} style={{ background: 'transparent', border: '1px solid #1f2937', borderRadius: 8, color: '#9ca3af', padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}>
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
                  const sm   = STATUS_META[f.status] || STATUS_META.not_shared;
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
                          {f.version && <span style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', padding: '1px 7px', borderRadius: 99, fontSize: 11 }}>{f.version}</span>}
                          <span style={{ background: sm.bg, border: `1px solid ${sm.border}`, color: sm.color, padding: '1px 7px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{sm.label}</span>
                          {f.panelOnly && <span style={{ fontSize: 10, color: '#4b5563' }}>— admin view only</span>}
                        </div>
                        {f.description && <p style={{ margin: 0, fontSize: 13, color: '#9ca3af', lineHeight: 1.6 }}>{f.description}</p>}
                        {f.toggleable && (
                          <p style={{ margin: '6px 0 0', fontSize: 11, color: f.myEnabled ? '#34d399' : '#4b5563' }}>
                            {f.myEnabled ? '✓ Enabled for your users' : '✗ Disabled — users cannot see this'}
                          </p>
                        )}
                        {f.status === 'permanent' && <p style={{ margin: '6px 0 0', fontSize: 11, color: '#34d399' }}>✓ Available to all users automatically</p>}
                      </div>
                      {f.toggleable && (
                        <button onClick={() => !busy && toggleFeature(f.featureId, !f.myEnabled)} disabled={busy}
                          style={{ flexShrink: 0, position: 'relative', width: 50, height: 27, borderRadius: 99, background: f.myEnabled ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.06)', border: `1px solid ${f.myEnabled ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.12)'}`, cursor: busy ? 'not-allowed' : 'pointer', padding: '0 3px', display: 'flex', alignItems: 'center', transition: 'all .2s', opacity: busy ? 0.5 : 1 }}
                        >
                          <span style={{ width: 19, height: 19, borderRadius: '50%', background: f.myEnabled ? '#10b981' : '#4b5563', transform: f.myEnabled ? 'translateX(23px)' : 'translateX(0)', transition: 'all .2s', display: 'block' }} />
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
                <p style={{ fontSize: 14 }}>No users synced yet.</p>
                <button onClick={syncUsers} style={{ marginTop: 12, background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Sync from GHL</button>
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
                      const saving    = roleSaving[u.userId];
                      const roleColor = ROLE_COLORS[u.role] || '#9ca3af';
                      const canAssign = cred?.role === 'admin'
                        ? ['admin', ...ASSIGNABLE_ROLES.map(r => r.id)]
                        : ASSIGNABLE_ROLES.map(r => r.id);
                      return (
                        <tr key={u.userId} style={{ borderBottom: '1px solid #151e2d' }}>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb' }}>{u.name || 'Unknown'}</div>
                            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#374151', marginTop: 2 }}>{u.userId}</div>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: 12, color: '#6b7280' }}>{u.email || '—'}</td>
                          <td style={{ padding: '12px 16px', fontSize: 12, color: '#9ca3af' }}>{u.ghlRole || '—'}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <select
                              value={u.role || 'chats_only'}
                              disabled={saving}
                              onChange={e => changeRole(u.userId, e.target.value)}
                              style={{ background: '#1a2030', border: '1px solid #374151', borderRadius: 6, color: '#e5e7eb', padding: '5px 10px', fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1 }}
                            >
                              {canAssign.map(rid => {
                                const info = ASSIGNABLE_ROLES.find(r => r.id === rid);
                                return <option key={rid} value={rid}>{info?.label || rid}</option>;
                              })}
                            </select>
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
