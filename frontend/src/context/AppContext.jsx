import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AppContext = createContext(null);

// Base API call using x-location-id header
async function apiFetch(path, locationId, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-location-id': locationId,
      ...(opts.headers || {}),
    },
  });
  return res.json();
}

function getInitialLocationId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('locationId') || localStorage.getItem('gtm_location_id') || '';
}

export function AppProvider({ children }) {
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
  const [integrations,       setIntegrations]       = useState([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);

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

  // ── Fetch status in background (claudeReady, enabledTools) ───────────────
  const fetchStatus = useCallback(async (locId) => {
    try {
      const data = await apiFetch('/claude/status', locId);
      if (data.success) {
        const ready = data.claudeReady || false;
        // Only update React state when the server confirms ready.
        // If ready===false (e.g. transient cache miss), keep whatever state was
        // initialised from localStorage — avoids flickering to "Key required".
        if (ready) {
          setClaudeReady(true);
          setEnabledTools(data.enabledTools || []);
          localStorage.setItem(`claude_ready_${locId}`, '1');
        } else {
          // Still update tools list even if ready is false; just don't wipe claudeReady.
          setEnabledTools(data.enabledTools || []);
        }
      }
      // If the request fails entirely, or claudeReady is false, leave the last-known
      // localStorage state intact. A transient cache miss / network blip should NOT
      // wipe a previously-confirmed ready state — only an explicit logout() does that.
      // We intentionally never call localStorage.removeItem here.
    } catch {}
  }, []);

  // ── On mount: clean URL, save locationId, fetch background status ─────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlLoc = params.get('locationId');

    if (urlLoc) {
      localStorage.setItem('gtm_location_id', urlLoc);
      setLocationId(urlLoc);
      setIsAuthenticated(true);
      // Clean URL (remove query params)
      window.history.replaceState({}, '', window.location.pathname);
    }

    const locId = urlLoc || locationId;
    if (!locId) return;

    // Fetch claude status + integrations in background — doesn't block render
    fetchStatus(locId);
    loadIntegrations(locId);
    // Fire-and-forget: sync GHL social accounts → toolRegistry so the
    // command center counts social connections even before Settings is visited.
    fetch('/social/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-location-id': locId },
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    setLocationId('');
    setIsAuthenticated(false);
    setClaudeReady(false);
    setIntegrations([]);
    setIntegrationsLoaded(false);
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
      enabledTools,
      integrations,
      integrationsLoaded,
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
