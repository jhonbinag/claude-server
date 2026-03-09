import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [apiKey,            setApiKey]            = useState(() => localStorage.getItem('gtm_api_key') || '');
  const [isAuthenticated,   setIsAuthenticated]   = useState(false);
  const [isAuthLoading,     setIsAuthLoading]     = useState(true);
  const [locationId,        setLocationId]        = useState('');
  const [claudeReady,       setClaudeReady]       = useState(false);
  const [enabledTools,      setEnabledTools]      = useState([]);
  const [integrations,      setIntegrations]      = useState([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);

  // ── Verify a key and populate auth state ─────────────────────────────────
  const verifyKey = useCallback(async (key) => {
    try {
      const data = await api.getWithKey('/claude/status', key);
      if (!data.success) return false;
      setApiKey(key);
      setIsAuthenticated(true);
      setLocationId(data.locationId || '');
      setClaudeReady(data.claudeReady || false);
      setEnabledTools(data.enabledTools || []);
      localStorage.setItem('gtm_api_key', key);
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Load integrations (called after login + on refresh) ───────────────────
  const loadIntegrations = useCallback(async (key) => {
    const k = key || apiKey;
    if (!k) return;
    try {
      const data = await api.getWithKey('/tools', k);
      if (data.success) {
        setIntegrations(data.data || []);
        setIntegrationsLoaded(true);
      }
    } catch {}
  }, [apiKey]);

  // ── Auto-login on mount (also reads ?apiKey= from URL after OAuth install) ──
  useEffect(() => {
    const params  = new URLSearchParams(window.location.search);
    const urlKey  = params.get('apiKey');
    const urlLoc  = params.get('locationId');

    // If GHL OAuth redirected here with credentials, use them
    if (urlKey) {
      if (urlLoc) localStorage.setItem('gtm_location_id', urlLoc);
      // Clean URL without reloading
      window.history.replaceState({}, '', window.location.pathname);
      verifyKey(urlKey)
        .then(ok => { if (ok) loadIntegrations(urlKey); })
        .finally(() => setIsAuthLoading(false));
      return;
    }

    if (!apiKey) { setIsAuthLoading(false); return; }
    verifyKey(apiKey)
      .then(ok => { if (ok) loadIntegrations(apiKey); })
      .finally(() => setIsAuthLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Public login ──────────────────────────────────────────────────────────
  const login = async (key) => {
    const ok = await verifyKey(key);
    if (ok) loadIntegrations(key);
    return ok;
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = () => {
    localStorage.removeItem('gtm_api_key');
    setApiKey('');
    setIsAuthenticated(false);
    setLocationId('');
    setIntegrations([]);
    setIntegrationsLoaded(false);
  };

  // ── Refresh both status + integrations (call after connect/disconnect) ────
  const refreshStatus = useCallback(async () => {
    if (!apiKey) return;
    const [status] = await Promise.allSettled([
      api.getWithKey('/claude/status', apiKey),
    ]);
    if (status.value?.success) {
      setEnabledTools(status.value.enabledTools || []);
      setClaudeReady(status.value.claudeReady || false);
    }
    await loadIntegrations();
  }, [apiKey, loadIntegrations]);

  return (
    <AppContext.Provider value={{
      apiKey,
      isAuthenticated,
      isAuthLoading,
      locationId,
      claudeReady,
      enabledTools,
      integrations,
      integrationsLoaded,
      login,
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
