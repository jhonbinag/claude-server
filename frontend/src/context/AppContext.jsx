import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const AppContext = createContext(null);

// Snapshot URL params immediately before React strips them — used for debug panel
window.__ghlInitParams = window.location.search || '(empty)';

// Base API call using x-location-id header
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

function extractLocFromReferrer() {
  try {
    const ref = document.referrer;
    if (!ref) return '';
    // GHL URL pattern: /location/{locationId}/ or /location/{locationId}
    const m = ref.match(/\/location\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : '';
  } catch { return ''; }
}

function getInitialLocationId() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('locationId')) return params.get('locationId');
  // Try referrer — GHL parent URL contains /location/{id}/ when embedded as iframe
  const refLoc = extractLocFromReferrer();
  if (refLoc) {
    localStorage.setItem('gtm_location_id', refLoc);
    return refLoc;
  }
  return localStorage.getItem('gtm_location_id') || '';
}

function getInitialUserId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('userId') || localStorage.getItem('gtm_user_id') || '';
}

function getCachedLocationName(locationId) {
  if (!locationId) return '';
  return localStorage.getItem(`gtm_location_name_${locationId}`) || '';
}

function extractLocationName(payload) {
  const source = payload?.data || payload || {};
  return (
    source?.location?.name ||
    source?.name ||
    source?.business?.name ||
    source?.companyName ||
    ''
  );
}

export function AppProvider({ children }) {
  // ── Theme ─────────────────────────────────────────────────────────────────
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('hl_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    return saved;
  });

  const toggleTheme = () => {
    setThemeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('hl_theme', next);
      document.documentElement.setAttribute('data-theme', next);
      return next;
    });
  };

  const [locationId,         setLocationId]         = useState(getInitialLocationId);
  const [locationName,       setLocationName]       = useState(() => getCachedLocationName(getInitialLocationId()));
  const [ghlMessages,        setGhlMessages]        = useState([]);
  // Auth is immediate: if we have a locationId, user is in. No API gatekeeping.
  const [isAuthenticated,    setIsAuthenticated]    = useState(() => !!getInitialLocationId());
  const [isAuthLoading,      setIsAuthLoading]      = useState(false);
  // Seed claudeReady from localStorage so it never flickers to false on reload
  // when the API key is already saved in the database for this location.
  const [claudeReady,        setClaudeReady]        = useState(() => {
    const locId = getInitialLocationId();
    return locId ? localStorage.getItem(`claude_ready_${locId}`) === '1' : false;
  });
  const [enabledTools,       setEnabledTools]       = useState([]);
  const [aiProvider,         setAiProvider]         = useState(null); // 'anthropic' | 'openai' | 'google' | null
  const [providerPreviews,   setProviderPreviews]   = useState({});   // { anthropic: 'sk-ant-...', openai: 'sk-...' }
  const [integrations,       setIntegrations]       = useState([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);

  // ── RBAC state ────────────────────────────────────────────────────────────
  const [userId,           setUserId]           = useState(getInitialUserId);
  const [userRole,         setUserRole]         = useState('owner');   // default: full access
  const [allowedFeatures,  setAllowedFeatures]  = useState(['*']);

  // ── Load integrations ─────────────────────────────────────────────────────
  const loadIntegrations = useCallback(async (locId) => {
    const id = locId || locationId;
    if (!id) return;
    try {
      const data = await apiFetch('/tools', id);
      if (data.success) {
        setIntegrations(data.data || []);
        setIntegrationsLoaded(true);
      }
    } catch {}
  }, [locationId]);

  // ── Fetch role + allowed features ─────────────────────────────────────────
  const fetchRole = useCallback(async (locId, uid) => {
    if (!locId) return;
    try {
      const data = await apiFetch('/roles/my-features', locId, {}, uid || null);
      if (data.success) {
        setUserRole(data.role || 'owner');
        setAllowedFeatures(data.features || ['*']);
      }
    } catch {}
  }, []);

  const fetchLocationMeta = useCallback(async (locId) => {
    if (!locId) return;
    try {
      const data = await apiFetch(`/api/locations/${encodeURIComponent(locId)}`, locId);
      const nextName = extractLocationName(data);
      if (nextName) {
        setLocationName(nextName);
        localStorage.setItem(`gtm_location_name_${locId}`, nextName);
      }
    } catch {}
  }, []);

  // ── Fetch status in background (claudeReady, enabledTools) ───────────────
  const fetchStatus = useCallback(async (locId) => {
    try {
      const data = await apiFetch('/claude/status', locId);
      if (data.success) {
        const ready = data.claudeReady || false;
        // Only update React state when the server confirms ready.
        // If ready===false (e.g. transient cache miss), keep whatever state was
        // initialised from localStorage — avoids flickering to "Key required".
        if (data.provider) setAiProvider(data.provider);
        if (data.providerPreviews) setProviderPreviews(data.providerPreviews);
        if (ready) {
          setClaudeReady(true);
          setEnabledTools(data.enabledTools || []);
          localStorage.setItem(`claude_ready_${locId}`, '1');
        } else {
          setEnabledTools(data.enabledTools || []);
        }
      }
      // If the request fails entirely, or claudeReady is false, leave the last-known
      // localStorage state intact. A transient cache miss / network blip should NOT
      // wipe a previously-confirmed ready state — only an explicit logout() does that.
      // We intentionally never call localStorage.removeItem here.
    } catch {}
  }, []);

  // ── On mount: clean URL params and persist locationId/userId ─────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlLoc = params.get('locationId');
    const urlUid = params.get('userId');
    const ssoKey = params.get('ssoKey');

    if (urlLoc) {
      localStorage.setItem('gtm_location_id', urlLoc);
      setLocationId(urlLoc);
      setIsAuthenticated(true);
    }
    if (urlUid) {
      localStorage.setItem('gtm_user_id', urlUid);
      setUserId(urlUid);
    }

    if (urlLoc || urlUid) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    // ── GHL SSO key — verify with backend to get the real locationId ─────
    // GHL Marketplace passes ?ssoKey=xxx on every iframe load.
    // Verify it server-side; reload if it reveals a different location.
    if (ssoKey) {
      fetch(`/oauth/sso?ssoKey=${encodeURIComponent(ssoKey)}`)
        .then(r => r.json())
        .then(data => {
          if (data.success && data.locationId) {
            const current = localStorage.getItem('gtm_location_id');
            if (data.locationId !== current) {
              localStorage.setItem('gtm_location_id', data.locationId);
              if (data.userId) localStorage.setItem('gtm_user_id', data.userId);
              window.location.reload();
            } else {
              window.history.replaceState({}, '', window.location.pathname);
            }
          }
        })
        .catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── GHL postMessage protocol ──────────────────────────────────────────────
  useEffect(() => {
    function applyNewLocation(newLoc, newUid) {
      const currentLoc = localStorage.getItem('gtm_location_id');
      if (!newLoc || newLoc === currentLoc) return;
      localStorage.setItem('gtm_location_id', newLoc);
      if (newUid) localStorage.setItem('gtm_user_id', newUid);
      window.location.reload();
    }

    function handleGHLMessage(event) {
      const d = event.data;
      if (!d || typeof d !== 'object') return;

      // Store every message so Settings debug panel can display it
      const entry = { ts: new Date().toISOString(), raw: JSON.stringify(d) };
      setGhlMessages(prev => [entry, ...prev].slice(0, 20));

      // Cover all known GHL SDK message formats
      const sub    = d.data || d.payload || d.detail || d.location || {};
      const newLoc =
        d.locationId      || d.location_id   || d.activeLocation  ||
        sub.locationId    || sub.location_id  || sub.activeLocation ||
        sub.id            || // { location: { id: 'xxx' } }
        d.location?.id;     // { location: { id: 'xxx' } }
      const newUid =
        d.userId   || d.user_id   ||
        sub.userId || sub.user_id;

      applyNewLocation(newLoc, newUid);
    }

    window.addEventListener('message', handleGHLMessage);

    // Request current user data from GHL parent immediately + poll every 3s
    // so location changes are caught within 3 seconds even if GHL doesn't push
    const request = () => window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
    request();
    const interval = setInterval(request, 3000);

    return () => {
      window.removeEventListener('message', handleGHLMessage);
      clearInterval(interval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-fetch everything whenever locationId changes ───────────────────────
  useEffect(() => {
    if (!locationId) return;

    // Reset all per-location state immediately
    setLocationName(getCachedLocationName(locationId));
    setClaudeReady(localStorage.getItem(`claude_ready_${locationId}`) === '1');
    setEnabledTools([]);
    setIntegrations([]);
    setIntegrationsLoaded(false);
    setUserRole('owner');
    setAllowedFeatures(['*']);

    // Fetch fresh data for this location
    fetchLocationMeta(locationId);
    fetchStatus(locationId);
    loadIntegrations(locationId);
    fetchRole(locationId, userId);

    // Poll integrations every 20s so admin-shared tools appear without a page refresh
    const poll = setInterval(() => loadIntegrations(locationId), 20000);
    const onVisible = () => { if (document.visibilityState === 'visible') loadIntegrations(locationId); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };

    fetch('/social/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
    }).catch(() => {});
  }, [locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helper: check if a feature is accessible ─────────────────────────────
  const canAccess = useCallback((feature) => {
    if (!feature) return true;
    if (allowedFeatures.includes('*')) return true;
    return allowedFeatures.includes(feature);
  }, [allowedFeatures]);

  // ── Activate with Anthropic key ───────────────────────────────────────────
  const activate = async (apiKey) => {
    if (!locationId) return false;
    try {
      const res = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, apiKey }),
      });
      const data = await res.json();
      if (!data.success) return false;
      await fetchStatus(locationId);
      await loadIntegrations(locationId);
      return true;
    } catch {
      return false;
    }
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = () => {
    if (locationId) localStorage.removeItem(`claude_ready_${locationId}`);
    localStorage.removeItem('gtm_location_id');
    localStorage.removeItem('gtm_user_id');
    setLocationId('');
    setLocationName('');
    setUserId('');
    setIsAuthenticated(false);
    setClaudeReady(false);
    setIntegrations([]);
    setIntegrationsLoaded(false);
    setUserRole('owner');
    setAllowedFeatures(['*']);
  };

  // ── Refresh status + integrations ────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    if (!locationId) return;
    await fetchStatus(locationId);
    await loadIntegrations();
  }, [locationId, fetchStatus, loadIntegrations]);

  return (
    <AppContext.Provider value={{
      locationId,
      locationName,
      ghlMessages,
      apiKey: locationId,
      isAuthenticated,
      isAuthLoading,
      claudeReady,
      aiProvider,
      providerPreviews,
      enabledTools,
      integrations,
      integrationsLoaded,
      // RBAC
      userId,
      userRole,
      allowedFeatures,
      canAccess,
      // Theme
      theme,
      toggleTheme,
      // Actions
      activate,
      login: activate,
      logout,
      loadIntegrations,
      refreshStatus,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
};
