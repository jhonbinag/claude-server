import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AppContext = createContext(null);

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

function getInitialLocationId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('locationId') || localStorage.getItem('gtm_location_id') || '';
}

function getInitialUserId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('userId') || localStorage.getItem('gtm_user_id') || '';
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

      // Log every message so we can identify the exact GHL format
      console.log('[GHL msg]', JSON.stringify(d));

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
    setClaudeReady(localStorage.getItem(`claude_ready_${locationId}`) === '1');
    setEnabledTools([]);
    setIntegrations([]);
    setIntegrationsLoaded(false);
    setUserRole('owner');
    setAllowedFeatures(['*']);

    // Fetch fresh data for this location
    fetchStatus(locationId);
    loadIntegrations(locationId);
    fetchRole(locationId, userId);

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
  const activate = async (anthropicKey) => {
    if (!locationId) return false;
    try {
      const res = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, anthropicKey }),
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
      apiKey: locationId,
      isAuthenticated,
      isAuthLoading,
      claudeReady,
      aiProvider,
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
