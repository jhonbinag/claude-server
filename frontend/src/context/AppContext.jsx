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

export function AppProvider({ children }) {
  const [locationId,         setLocationId]         = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('locationId') || localStorage.getItem('gtm_location_id') || '';
  });
  const [isAuthenticated,    setIsAuthenticated]    = useState(false);
  const [isAuthLoading,      setIsAuthLoading]      = useState(true);
  const [claudeReady,        setClaudeReady]        = useState(false);
  const [enabledTools,       setEnabledTools]       = useState([]);
  const [integrations,       setIntegrations]       = useState([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);

  // ── Verify a locationId is activated (has Anthropic key stored) ───────────
  const verifyLocation = useCallback(async (locId) => {
    try {
      const data = await apiFetch('/claude/status', locId);
      if (!data.success) return false;
      setIsAuthenticated(true);
      setClaudeReady(data.claudeReady || false);
      setEnabledTools(data.enabledTools || []);
      localStorage.setItem('gtm_location_id', locId);
      return true;
    } catch {
      return false;
    }
  }, []);

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

  // ── Auto-login on mount ───────────────────────────────────────────────────
  useEffect(() => {
    // Persist locationId from URL and clean URL
    const params = new URLSearchParams(window.location.search);
    const urlLoc = params.get('locationId');
    if (urlLoc) {
      localStorage.setItem('gtm_location_id', urlLoc);
      setLocationId(urlLoc);
      window.history.replaceState({}, '', window.location.pathname);
    }

    const locId = urlLoc || locationId;
    if (!locId) { setIsAuthLoading(false); return; }

    verifyLocation(locId)
      .then(ok => { if (ok) loadIntegrations(locId); })
      .finally(() => setIsAuthLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── First-time setup: activate with Anthropic key ────────────────────────
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
      // Re-verify now that key is stored
      const ok = await verifyLocation(locationId);
      if (ok) loadIntegrations(locationId);
      return ok;
    } catch {
      return false;
    }
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = () => {
    localStorage.removeItem('gtm_location_id');
    setLocationId('');
    setIsAuthenticated(false);
    setIntegrations([]);
    setIntegrationsLoaded(false);
  };

  // ── Refresh status + integrations ────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    if (!locationId) return;
    try {
      const data = await apiFetch('/claude/status', locationId);
      if (data.success) {
        setEnabledTools(data.enabledTools || []);
        setClaudeReady(data.claudeReady || false);
      }
    } catch {}
    await loadIntegrations();
  }, [locationId, loadIntegrations]);

  return (
    <AppContext.Provider value={{
      locationId,
      apiKey: locationId, // alias — pages use locationId as the auth token
      isAuthenticated,
      isAuthLoading,
      claudeReady,
      enabledTools,
      integrations,
      integrationsLoaded,
      activate,
      login: activate,   // alias for components that still call login()
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
