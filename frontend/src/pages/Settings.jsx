/**
 * frontend/src/pages/Settings.jsx
 *
 * Integration Hub — connect external tool API keys.
 *
 * Field behaviour:
 *   • Key exists in DB → fetched masked value shown in a READ-ONLY field
 *                         + ✏️ edit icon beside it
 *   • Click ✏️ → field becomes editable (clears to blank for new input)
 *                + ✕ cancel icon to revert back to read-only
 *   • No key in DB → empty editable field (normal input)
 *   • "Save & Test" sends only the edited / newly-filled fields
 *   • "Update" per individual field is the same as Save & Test but
 *     focused on just that one field
 */

import { useState, useEffect } from 'react';
import { useApp }   from '../context/AppContext';
import AuthGate     from '../components/AuthGate';
import Header       from '../components/Header';
import Spinner      from '../components/Spinner';
import { INTEGRATIONS } from '../lib/integrations';
import { api }      from '../lib/api';
import Billing      from './Billing';

// ── OAuth popup helper ────────────────────────────────────────────────────────
// Opens a platform OAuth popup and resolves with the postMessage payload.
function openOAuthPopup(platform, locationId) {
  return new Promise((resolve, reject) => {
    const url  = `/social-auth/${platform}?locationId=${encodeURIComponent(locationId)}`;
    const win  = window.open(url, `${platform}_oauth`, 'width=600,height=700,left=200,top=100');
    if (!win) { reject(new Error('Popup blocked')); return; }

    function onMessage(e) {
      if (!e.data || e.data.type !== 'social_oauth') return;
      if (e.data.platform !== platform) return;
      window.removeEventListener('message', onMessage);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data);
    }
    window.addEventListener('message', onMessage);

    // Clean up if popup closed without postMessage
    const poll = setInterval(() => {
      if (win.closed) { clearInterval(poll); window.removeEventListener('message', onMessage); resolve(null); }
    }, 500);
  });
}

export default function Settings() {
  const { isAuthenticated, isAuthLoading, apiKey, claudeReady, aiProvider, locationId, refreshStatus, integrations, ghlMessages } = useApp();

  const [toast,       setToast]       = useState(null);
  const [testResults, setTestResults] = useState({});
  const [expanded,    setExpanded]    = useState({});
  const [formValues,  setFormValues]  = useState({});
  const [editMode,    setEditMode]    = useState({});
  const [tokenStatus, setTokenStatus] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [tierInfo,     setTierInfo]     = useState(null); // { tier, tierConfig, data (per key) }
  const [settingsTab,  setSettingsTab]  = useState('integrations');
  const [manualLocId,  setManualLocId]  = useState('');

  // Anthropic key state
  const [anthropicKey,     setAnthropicKey]     = useState('');
  const [anthropicEditing, setAnthropicEditing] = useState(false);
  const [anthropicSaving,  setAnthropicSaving]  = useState(false);

  // ── Load token status (hooks must be before any conditional returns) ───────

  useEffect(() => {
    if (!apiKey) return;
    api.getWithKey('/tools/sync', apiKey)
      .then(d => { if (d.success) setTokenStatus(d); })
      .catch(() => {});
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey) return;
    api.getWithKey('/tools', apiKey)
      .then(d => {
        if (d.success) {
          const byKey = Object.fromEntries((d.data || []).map(i => [i.key, i]));
          setTierInfo({ tier: d.tier, tierConfig: d.tierConfig, byKey });
        }
      })
      .catch(() => {});
  }, [apiKey]);

  // Auto-expand connected integrations on first load
  useEffect(() => {
    if (!integrations?.length) return;
    const initial = {};
    for (const i of integrations) {
      if (i.enabled) initial[i.key] = true;
    }
    setExpanded(prev => ({ ...initial, ...prev }));
  }, [integrations]);

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return <AuthGate icon="⚙️" title="GTM Integration Hub" subtitle="Connect your API keys to sync all tools" />;

  const sidebarUrl = `${window.location.origin}/ui`;
  // Build lookup: key → server integration record (has .enabled, .configPreview)
  const serverMap = Object.fromEntries((integrations || []).map(i => [i.key, i]));

  // ── Toast helper ──────────────────────────────────────────────────────────

  const showToast = (msg, ok) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Field helpers ─────────────────────────────────────────────────────────

  const toggleExpand = key => setExpanded(p => ({ ...p, [key]: !p[key] }));

  const fkey = (key, field) => `${key}_${field}`;

  // Current value typed in the form (only when editing)
  const getFormVal = (key, field) => formValues[fkey(key, field)] || '';
  const setFormVal = (key, field, val) => setFormValues(p => ({ ...p, [fkey(key, field)]: val }));

  // Masked value from the database (served by /tools endpoint via configPreview)
  const getMasked = (key, field) => serverMap[key]?.configPreview?.[field] || '';

  const isEditing = (key, field) => !!editMode[fkey(key, field)];
  const hasDbValue = (key, field) => !!getMasked(key, field);

  // Enter edit mode for one field
  const startEdit = (key, field) => {
    setEditMode(p => ({ ...p, [fkey(key, field)]: true }));
    setFormVal(key, field, ''); // clear so user types fresh
  };

  // Cancel edit — revert to read-only masked display
  const cancelEdit = (key, field) => {
    setEditMode(p => ({ ...p, [fkey(key, field)]: false }));
    setFormVal(key, field, '');
  };

  // ── Save / update ─────────────────────────────────────────────────────────

  /**
   * Save all edited fields for a given integration.
   * Sends only fields that have new values typed (or all fields if nothing was connected yet).
   */
  const save = async cfg => {
    const body = {};
    for (const f of cfg.fields) {
      const v = getFormVal(cfg.key, f.key);
      if (v.trim()) body[f.key] = v.trim();
    }

    if (!Object.keys(body).length) {
      showToast('No changes to save. Click the ✏️ icon next to a field to edit it.', false);
      return;
    }

    const data = await api.post(`/tools/${cfg.key}`, body);
    if (!data.success) { showToast(data.error, false); return; }

    // Reset edit modes for this integration's fields
    const resetEdit = { ...editMode };
    for (const f of cfg.fields) resetEdit[fkey(cfg.key, f.key)] = false;
    setEditMode(resetEdit);

    const resetForm = { ...formValues };
    for (const f of cfg.fields) delete resetForm[fkey(cfg.key, f.key)];
    setFormValues(resetForm);

    showToast(`${cfg.label} saved. Testing connection…`, true);
    await testConn(cfg.key);
    await refreshStatus();
  };

  /**
   * Save a single field (called from inline "Update" on a per-field basis).
   */
  const saveField = async (cfg, fieldKey) => {
    const v = getFormVal(cfg.key, fieldKey);
    if (!v.trim()) { showToast('Field is empty — enter a value first.', false); return; }

    const data = await api.post(`/tools/${cfg.key}`, { [fieldKey]: v.trim() });
    if (!data.success) { showToast(data.error, false); return; }

    cancelEdit(cfg.key, fieldKey);
    showToast(`${cfg.label} ${fieldKey} updated.`, true);
    await testConn(cfg.key);
    await refreshStatus();
  };

  // ── Test connection ───────────────────────────────────────────────────────

  const testConn = async key => {
    setTestResults(p => ({ ...p, [key]: { status: 'loading' } }));
    const data = await api.post(`/tools/test/${key}`, {});
    setTestResults(p => ({
      ...p,
      [key]: data.success
        ? { status: 'ok',  info: data.info  }
        : { status: 'err', info: data.error },
    }));
    if (data.success) refreshStatus();
  };

  // ── Disconnect ────────────────────────────────────────────────────────────

  const disconnect = async cfg => {
    if (!confirm(`Disconnect ${cfg.label}? API keys will be removed from the database.`)) return;
    const data = await api.del(`/tools/${cfg.key}`);
    if (data.success) {
      showToast('Disconnected.', true);
      setEditMode({});
      setFormValues({});
      await refreshStatus();
    } else {
      showToast(data.error, false);
    }
  };

  // ── Reconnect (token refresh) ─────────────────────────────────────────────

  const reconnect = async () => {
    setReconnecting(true);
    try {
      const data = await api.post('/tools/reconnect', {});
      if (data.success) {
        showToast('Connection refreshed successfully.', true);
        const sync = await api.getWithKey('/tools/sync', apiKey);
        if (sync.success) setTokenStatus(sync);
      } else {
        showToast(data.error || 'Reconnect failed.', false);
      }
    } catch {
      showToast('Reconnect failed.', false);
    }
    setReconnecting(false);
  };

  // ── Anthropic API key ─────────────────────────────────────────────────────

  const saveAnthropicKey = async () => {
    if (!anthropicKey.trim().startsWith('sk-ant-')) {
      showToast('Key must start with sk-ant-', false);
      return;
    }
    setAnthropicSaving(true);
    try {
      const data = await api.post('/api/activate', { locationId, anthropicKey: anthropicKey.trim() });
      if (data.success) {
        showToast('Anthropic API key saved. Claude is now active!', true);
        setAnthropicKey('');
        setAnthropicEditing(false);
        await refreshStatus();
      } else {
        showToast(data.error || 'Failed to save key.', false);
      }
    } catch {
      showToast('Failed to save key.', false);
    }
    setAnthropicSaving(false);
  };

  // ── Copy sidebar URL ──────────────────────────────────────────────────────

  const copySidebarUrl = () => {
    navigator.clipboard.writeText(sidebarUrl);
    showToast('Sidebar URL copied!', true);
  };

  // ─────────────────────────────────────────────────────────────────────────

  const needsReconnect = tokenStatus?.tokenStatus === 'idle' || tokenStatus?.tokenStatus === 'expired';

  const SETTINGS_TABS = [
    { key: 'integrations', label: '🔗 Integrations' },
    { key: 'profile',      label: '👤 Profile'      },
    { key: 'billing',      label: '💳 Billing'      },
  ];

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0f0f13' }}>
      <Header icon="⚙️" title="Settings" subtitle="Integrations · Profile · Billing" />

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '0 16px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0,
        background: '#0f0f13',
      }}>
        {SETTINGS_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSettingsTab(key)}
            style={{
              padding: '11px 18px',
              fontSize: 13, fontWeight: 500,
              border: 'none',
              borderBottom: `2px solid ${settingsTab === key ? '#6366f1' : 'transparent'}`,
              cursor: 'pointer',
              transition: 'color .15s, border-color .15s',
              background: 'transparent',
              color: settingsTab === key ? '#a5b4fc' : '#6b7280',
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Billing tab ── */}
      {settingsTab === 'billing' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <Billing />
        </div>
      )}

      {/* ── Profile tab ── */}
      {settingsTab === 'profile' && (
        <main className="flex-1 overflow-y-auto p-4 md:p-6" style={{ maxWidth: '60rem', margin: '0 auto', width: '100%' }}>
          <div className="space-y-6">

            {/* Location card */}
            <div className="glass rounded-2xl p-6" style={{ border: '1px solid rgba(99,102,241,0.2)' }}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">👤</span>
                <div>
                  <h2 className="font-bold text-white">Profile</h2>
                  <p className="text-xs text-gray-500">Your location and connection details</p>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="text-sm text-gray-400">Location ID</span>
                  <span className="text-sm font-mono text-gray-300">{locationId || '—'}</span>
                </div>
                {tierInfo && (
                  <div className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <span className="text-sm text-gray-400">Plan</span>
                    <span className="text-sm text-white capitalize font-medium">{tierInfo.tier || 'bronze'}</span>
                  </div>
                )}
                <div className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="text-sm text-gray-400">AI Provider</span>
                  <span className="text-sm text-white">
                    {aiProvider === 'google' ? 'Gemini 2.5 Flash'
                      : aiProvider === 'openai' ? 'GPT-4o-mini'
                      : aiProvider === 'groq'   ? 'Groq Llama 3.3 70B'
                      : 'Claude Opus 4.6'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-sm text-gray-400">AI Status</span>
                  <span className={`text-sm font-medium ${claudeReady ? 'text-green-400' : 'text-yellow-400'}`}>
                    {claudeReady ? '✓ Active' : '⚠ Key required'}
                  </span>
                </div>
              </div>
            </div>

            {/* GHL Sidebar URL */}
            <div className="glass rounded-2xl p-6" style={{ border: '1px solid rgba(99,102,241,0.2)' }}>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🔗</span>
                    <h2 className="font-bold text-white">GHL Sidebar Link</h2>
                  </div>
                  <p className="text-sm text-gray-400">
                    Add this URL as a Custom Link in GHL → Settings → Custom Links to embed this hub in the sidebar.
                  </p>
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/ui`); showToast('Sidebar URL copied!', true); }}
                  className="btn-primary px-4 py-2 gap-2 whitespace-nowrap flex-shrink-0"
                >
                  📋 Copy URL
                </button>
              </div>
              <div
                className="rounded-xl px-4 py-3 text-sm break-all"
                style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', color: '#a5b4fc' }}
              >
                {`${window.location.origin}/ui`}
              </div>
              <p className="text-xs text-gray-500 mt-3">
                In GHL: <strong className="text-gray-400">Settings → Custom Links → Add Link</strong> → paste URL above → set display as iFrame.
              </p>
            </div>

            {/* GHL Debug Panel */}
            <div className="glass rounded-2xl p-6" style={{ border: '1px solid rgba(99,102,241,0.2)' }}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">🛰️</span>
                <div>
                  <h2 className="font-bold text-white">GHL Location Debug</h2>
                  <p className="text-xs text-gray-500">Fix location mismatch or inspect raw GHL messages</p>
                </div>
              </div>
              <div className="space-y-4">
                {/* Active location */}
                <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="text-sm text-gray-400">Active Location ID</span>
                  <span className="text-sm font-mono" style={{ color: locationId ? '#4ade80' : '#f87171' }}>
                    {locationId || '(none)'}
                  </span>
                </div>

                {/* Manual override */}
                <div>
                  <p className="text-xs text-gray-400 mb-2 font-medium">Force switch location (paste ID from GHL URL)</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualLocId}
                      onChange={e => setManualLocId(e.target.value)}
                      placeholder="e.g. eGEbX2zBnorRW8StzLEn"
                      className="flex-1 rounded-lg px-3 py-2 text-sm font-mono"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e5e7eb', outline: 'none' }}
                    />
                    <button
                      onClick={() => {
                        const id = manualLocId.trim();
                        if (!id) return;
                        localStorage.setItem('gtm_location_id', id);
                        window.location.reload();
                      }}
                      disabled={!manualLocId.trim()}
                      className="btn-primary px-4 py-2 text-sm whitespace-nowrap"
                      style={{ opacity: manualLocId.trim() ? 1 : 0.4 }}
                    >
                      Apply & Reload
                    </button>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Copy the ID from your GHL URL: /location/<strong className="text-gray-500">{'<id>'}</strong>/dashboard</p>
                </div>

                {/* Raw messages */}
                <div>
                  <p className="text-xs text-gray-500 mb-2">GHL postMessages received ({ghlMessages.length}):</p>
                  {ghlMessages.length === 0 ? (
                    <p className="text-xs text-gray-600 italic">No messages yet — waiting for GHL to respond to REQUEST_USER_DATA</p>
                  ) : (
                    <div className="space-y-1" style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {ghlMessages.map((m, i) => (
                        <div key={i} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                          <p className="text-xs text-gray-500 mb-0.5">{m.ts}</p>
                          <p className="text-xs font-mono break-all" style={{ color: '#a5b4fc' }}>{m.raw}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </main>
      )}

      {/* ── Integrations tab ── */}
      {settingsTab === 'integrations' && (
      <main className="flex-1 overflow-y-auto p-4 md:p-6" style={{ maxWidth: '72rem', margin: '0 auto', width: '100%' }}>

        {/* ── Token status banner (shows when idle/expired) ─────────────── */}
        {needsReconnect && (
          <div
            className="rounded-2xl p-4 mb-6 flex items-center justify-between gap-4"
            style={{
              background: tokenStatus.tokenStatus === 'expired' ? 'rgba(239,68,68,0.08)' : 'rgba(251,191,36,0.08)',
              border: `1px solid ${tokenStatus.tokenStatus === 'expired' ? 'rgba(239,68,68,0.3)' : 'rgba(251,191,36,0.3)'}`,
            }}
          >
            <div>
              <p className="font-semibold text-sm" style={{ color: tokenStatus.tokenStatus === 'expired' ? '#f87171' : '#fbbf24' }}>
                {tokenStatus.tokenStatus === 'expired'
                  ? '⚠️ Your connection has expired'
                  : `⏱ Idle for ${tokenStatus.tokenIdleDays} day${tokenStatus.tokenIdleDays !== 1 ? 's' : ''}`}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {tokenStatus.tokenStatus === 'expired'
                  ? 'Reconnect to restore tool access. Your API keys are still saved.'
                  : 'Reconnect to refresh your session and keep tools in sync.'}
              </p>
            </div>
            <button
              onClick={reconnect}
              disabled={reconnecting}
              className="btn-primary px-5 py-2 whitespace-nowrap"
            >
              {reconnecting ? '↻ Reconnecting…' : '↻ Reconnect'}
            </button>
          </div>
        )}

        {/* ── GHL Sidebar URL Banner ─────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6 mb-8" style={{ border: '1px solid rgba(99,102,241,0.2)' }}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🔗</span>
                <h2 className="font-bold text-white">Your GHL Sidebar Link</h2>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc' }}
                >
                  Permanent URL
                </span>
              </div>
              <p className="text-gray-400 text-sm">
                Add this URL as a Custom Link in GHL → Settings → Custom Links to embed this hub in the sidebar.
              </p>
            </div>
            <button onClick={copySidebarUrl} className="btn-primary px-4 py-2 gap-2 whitespace-nowrap flex-shrink-0">
              📋 Copy URL
            </button>
          </div>
          <div
            className="rounded-xl px-4 py-3 text-sm break-all"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', color: '#a5b4fc' }}
          >
            {sidebarUrl}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            💡 In GHL: <strong className="text-gray-400">Settings → Custom Links → Add Link</strong> → paste URL above → set display as iFrame.
          </p>
        </div>

        {/* ── Built-in services ──────────────────────────────────────────── */}
        <div className="space-y-3 mb-8">

          {/* Claude API Key card */}
          <div className={`card p-5${claudeReady ? ' connected' : ''}`} style={!claudeReady ? { borderColor: 'rgba(251,191,36,0.3)' } : {}}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: 'rgba(99,102,241,0.15)' }}>🤖</div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white text-sm">
                      {aiProvider === 'google' ? 'Gemini 2.5 Flash' : aiProvider === 'openai' ? 'GPT-4o-mini' : aiProvider === 'groq' ? 'Groq — Llama 3.3 70B' : 'Claude Opus 4.6'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${claudeReady ? 'badge-on' : 'badge-off'}`}>
                      {claudeReady ? 'Active' : 'Key required'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {claudeReady
                      ? aiProvider === 'groq'   ? 'Groq Llama 3.3 70B is active (free tier, fastest).'
                        : aiProvider === 'google' ? 'Google Gemini 2.5 Flash is active (free tier).'
                        : aiProvider === 'openai' ? 'OpenAI GPT-4o-mini is active.'
                        : 'Anthropic Claude is active.'
                      : 'Enter an API key to activate AI features (Anthropic, OpenAI, Groq, or Google Gemini).'}
                  </p>
                </div>
              </div>
              <div className="text-right text-xs flex-shrink-0">
                {claudeReady
                  ? <div className="text-green-400 font-medium">✓ Ready</div>
                  : !anthropicEditing && (
                    <button onClick={() => setAnthropicEditing(true)} className="btn-primary px-4 py-1.5 text-xs">
                      Add Key →
                    </button>
                  )}
              </div>
            </div>

            {/* Key input — shown when editing or not yet set */}
            {(anthropicEditing || !claudeReady) && (
              <div className="mt-4 fade-up">
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">Anthropic API Key</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={anthropicKey}
                    onChange={e => setAnthropicKey(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveAnthropicKey()}
                    placeholder="sk-ant-..."
                    className="field flex-1"
                    autoFocus
                    autoComplete="new-password"
                  />
                  <button
                    onClick={saveAnthropicKey}
                    disabled={anthropicSaving || !anthropicKey.trim()}
                    className="btn-primary px-4 py-2 text-xs"
                  >
                    {anthropicSaving ? 'Saving…' : 'Save'}
                  </button>
                  {claudeReady && (
                    <button
                      onClick={() => { setAnthropicEditing(false); setAnthropicKey(''); }}
                      className="px-3 py-2 rounded-xl text-xs text-gray-400"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >✕</button>
                  )}
                </div>
                <p className="text-xs text-gray-600 mt-1.5">
                  Get your key at <span className="text-indigo-400">console.anthropic.com</span> → API Keys
                </p>
              </div>
            )}

            {/* Update key button when already set */}
            {claudeReady && !anthropicEditing && (
              <div className="mt-3">
                <button
                  onClick={() => setAnthropicEditing(true)}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >✏️ Update API key</button>
              </div>
            )}
          </div>

          <BuiltInCard
            icon="⚡" label="GoHighLevel CRM" badge="Connected"
            color="rgba(34,197,94,0.1)"
            description="Contacts, conversations, opportunities, workflows, calendars, blogs, social planner — 26 tools available."
            rightLabel="OAuth installed" rightSub="Always on"
          />
        </div>

        {/* ── Social Hub ─────────────────────────────────────────────────── */}
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Social Hub</h2>
        <div className="mb-8">
          <SocialHubCard />
        </div>

        {/* ── External integrations ──────────────────────────────────────── */}
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">External Integrations</h2>

        {/* Payment Hub — unified card for all payment providers */}
        <div className="mb-4">
          <PaymentHubCard serverMap={serverMap} showToast={showToast} refreshStatus={refreshStatus} />
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))' }}>
          {INTEGRATIONS.map(cfg => {
            const sv      = serverMap[cfg.key] || {};
            const enabled = sv.enabled || false;
            const isOpen     = expanded[cfg.key] || false;
            const tr         = testResults[cfg.key];
            const tierEntry  = tierInfo?.byKey?.[cfg.key];
            const tierLocked = !enabled && tierEntry?.tierLocked;
            const tierReason = tierEntry?.tierReason;

            // Detect if any field is currently being edited
            const anyEditing = cfg.fields.some(f => isEditing(cfg.key, f.key));
            // Detect if any new value has been typed
            const hasChanges = cfg.fields.some(f => getFormVal(cfg.key, f.key).trim());

            return (
              <div
                key={cfg.key}
                className={`card p-5${enabled ? ' connected' : ''}`}
                style={tierLocked ? { opacity: 0.65, border: '1px solid rgba(255,255,255,0.06)' } : {}}
              >

                {/* ── Card header ─────────────────────────────────────── */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                      style={{ background: tierLocked ? 'rgba(255,255,255,0.04)' : cfg.color }}
                    >
                      {tierLocked ? '🔒' : cfg.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white text-sm">{cfg.label}</span>
                        {tierLocked ? (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>
                            🔒 Locked
                          </span>
                        ) : (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${enabled ? 'badge-on' : 'badge-off'}`}>
                            {enabled ? 'Connected' : 'Not connected'}
                          </span>
                        )}
                        {enabled && sv.configPreview?.ghlConnected && (
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}>
                            via GHL
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 leading-snug">
                        {tierLocked ? tierReason || 'Upgrade your plan to unlock this integration.' : cfg.description}
                      </p>
                    </div>
                  </div>
                  <a href={cfg.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-gray-600 hover:text-gray-400 flex-shrink-0 mt-1 ml-2">
                    Docs ↗
                  </a>
                </div>

                {/* ── Toggle / upgrade button ───────────────────────────── */}
                {tierLocked ? (
                  <button onClick={() => setSettingsTab('billing')} className="btn-ghost w-full py-1.5 text-xs text-center block" style={{ color: '#fbbf24', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                    ⬆ Upgrade plan to unlock
                  </button>
                ) : (
                <button onClick={() => toggleExpand(cfg.key)} className="btn-ghost w-full py-1.5 text-xs">
                  {isOpen
                    ? '▲ Collapse'
                    : enabled ? '⚙️ Manage credentials' : '+ Connect'}
                </button>
                )}

                {/* ── Expanded form ────────────────────────────────────── */}
                {!tierLocked && isOpen && (
                  <div className="mt-4 space-y-4 fade-up">

                    {/* Facebook Ads — OAuth connect button */}
                    {cfg.key === 'facebook_ads' && (
                      <FacebookOAuthButton
                        apiKey={apiKey}
                        enabled={enabled}
                        showToast={showToast}
                        onConnected={refreshStatus}
                      />
                    )}

                    {cfg.fields.map(f => {
                      const dbVal    = getMasked(cfg.key, f.key);
                      const hasDb    = !!dbVal;
                      const editing  = isEditing(cfg.key, f.key);
                      const newVal   = getFormVal(cfg.key, f.key);

                      return (
                        <div key={f.key}>
                          <label className="block text-xs text-gray-400 mb-1.5 font-medium">
                            {f.label}
                            {hasDb && !editing && (
                              <span
                                className="ml-2 text-xs font-normal"
                                style={{ color: '#4ade80' }}
                              >
                                ✓ saved
                              </span>
                            )}
                          </label>

                          <div className="flex gap-2 items-center">
                            {/* Input field */}
                            <div className="relative flex-1">
                              <input
                                type={editing || !hasDb ? f.type : 'text'}
                                value={
                                  editing ? newVal
                                  : hasDb  ? dbVal
                                  : newVal
                                }
                                onChange={e => {
                                  if (!editing && hasDb) return; // read-only guard
                                  setFormVal(cfg.key, f.key, e.target.value);
                                }}
                                readOnly={!editing && hasDb}
                                placeholder={
                                  editing  ? `Enter new ${f.label}…`
                                  : !hasDb ? f.placeholder
                                  : ''
                                }
                                className="field w-full"
                                style={
                                  !editing && hasDb
                                    ? { color: '#9ca3af', cursor: 'default', background: 'rgba(255,255,255,0.03)' }
                                    : {}
                                }
                                autoComplete="new-password"
                              />
                              {/* Read-only lock indicator */}
                              {hasDb && !editing && (
                                <span
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 text-xs"
                                  title="Read-only — click ✏️ to edit"
                                >
                                  🔒
                                </span>
                              )}
                            </div>

                            {/* Edit / Cancel icon button */}
                            {hasDb && (
                              editing ? (
                                <div className="flex gap-1 flex-shrink-0">
                                  {/* Inline Update for this single field */}
                                  <button
                                    onClick={() => saveField(cfg, f.key)}
                                    title="Update this field"
                                    style={{
                                      background: 'rgba(99,102,241,0.15)',
                                      border: '1px solid rgba(99,102,241,0.4)',
                                      borderRadius: 8, padding: '6px 10px',
                                      color: '#a5b4fc', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => cancelEdit(cfg.key, f.key)}
                                    title="Cancel — revert to saved value"
                                    style={{
                                      background: 'rgba(255,255,255,0.05)',
                                      border: '1px solid rgba(255,255,255,0.1)',
                                      borderRadius: 8, padding: '6px 10px',
                                      color: '#9ca3af', cursor: 'pointer', fontSize: 12,
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => startEdit(cfg.key, f.key)}
                                  title="Edit this field"
                                  style={{
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: 8, padding: '6px 10px',
                                    color: '#9ca3af', cursor: 'pointer', fontSize: 13,
                                    flexShrink: 0,
                                  }}
                                >
                                  ✏️
                                </button>
                              )
                            )}
                          </div>

                          {/* Hint when editing */}
                          {editing && (
                            <p className="text-xs mt-1" style={{ color: '#6b7280' }}>
                              Type the new value. Click <strong>Save</strong> to update just this field, or use <strong>Save All</strong> below.
                            </p>
                          )}
                        </div>
                      );
                    })}

                    {/* Test result */}
                    {tr && (
                      <div className={`text-xs font-medium ${
                        tr.status === 'ok'      ? 'text-green-400' :
                        tr.status === 'loading' ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        {tr.status === 'loading' ? '⏳ Testing connection…' :
                         tr.status === 'ok'      ? `✓ ${tr.info}` : `✗ ${tr.info}`}
                      </div>
                    )}

                    {/* Action row */}
                    <div className="flex gap-2 pt-1 flex-wrap">
                      {/* Save All — only shown if any edits / new values exist */}
                      {(!enabled || hasChanges) && (
                        <button onClick={() => save(cfg)} className="btn-primary flex-1 py-2">
                          {enabled && hasChanges ? 'Save All & Test' : 'Save & Test'}
                        </button>
                      )}

                      {/* Test connection button (always shown when connected) */}
                      {enabled && (
                        <button
                          onClick={() => testConn(cfg.key)}
                          style={{
                            background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                            borderRadius: 12, padding: '8px 14px',
                            color: '#a5b4fc', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                          }}
                        >
                          ↻ Test
                        </button>
                      )}

                      {/* Facebook Ads — Sync Leads to CRM */}
                      {enabled && cfg.key === 'facebook_ads' && (
                        <FbLeadSyncButton apiKey={apiKey} showToast={showToast} />
                      )}

                      {/* Disconnect */}
                      {enabled && (
                        <button
                          onClick={() => disconnect(cfg)}
                          className="px-3 py-2 rounded-xl text-red-400 text-xs"
                          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}
                        >
                          ✕ Disconnect
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </main>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium fade-up"
          style={toast.ok
            ? { background: 'rgba(34,197,94,0.15)',  border: '1px solid rgba(34,197,94,0.3)',  color: '#4ade80' }
            : { background: 'rgba(239,68,68,0.15)',  border: '1px solid rgba(239,68,68,0.3)',  color: '#f87171' }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Payment Hub Card ──────────────────────────────────────────────────────────

const PAYMENT_PROVIDERS = [
  {
    key: 'stripe', label: 'Stripe', icon: '💳',
    color: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    fields: [
      { key: 'secretKey', label: 'Secret Key', type: 'password', placeholder: 'sk_live_...' },
    ],
  },
  {
    key: 'paypal', label: 'PayPal', icon: '🅿️',
    color: 'rgba(0,112,240,0.12)', borderColor: 'rgba(0,112,240,0.4)',
    docsUrl: 'https://developer.paypal.com/dashboard',
    fields: [
      { key: 'clientId',     label: 'Client ID',     type: 'text',     placeholder: 'AaBbCc...' },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'Your client secret' },
      { key: 'mode',         label: 'Mode',          type: 'text',     placeholder: 'live' },
    ],
  },
  {
    key: 'square', label: 'Square', icon: '⬛',
    color: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.25)',
    docsUrl: 'https://developer.squareup.com/apps',
    fields: [
      { key: 'accessToken',  label: 'Access Token',  type: 'password', placeholder: 'EAAAl...' },
      { key: 'locationId',   label: 'Location ID',   type: 'text',     placeholder: 'Your Square location ID' },
      { key: 'environment',  label: 'Environment',   type: 'text',     placeholder: 'production' },
    ],
  },
  {
    key: 'authorizenet', label: 'Authorize.net', icon: '🔐',
    color: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.35)',
    docsUrl: 'https://developer.authorize.net/hello_world/',
    fields: [
      { key: 'apiLoginId',     label: 'API Login ID',    type: 'text',     placeholder: 'Your API Login ID' },
      { key: 'transactionKey', label: 'Transaction Key', type: 'password', placeholder: 'Your Transaction Key' },
      { key: 'mode',           label: 'Mode',            type: 'text',     placeholder: 'live' },
    ],
  },
];

function PaymentHubCard({ serverMap, showToast, refreshStatus }) {
  const [selected,    setSelected]    = useState(null);      // active provider key
  const [formVals,    setFormVals]    = useState({});         // { fieldKey: value }
  const [saving,      setSaving]      = useState(false);
  const [testing,     setTesting]     = useState(false);
  const [testResult,  setTestResult]  = useState(null);
  const [isOpen,      setIsOpen]      = useState(false);

  const provider = PAYMENT_PROVIDERS.find(p => p.key === selected);
  const connectedProviders = PAYMENT_PROVIDERS.filter(p => serverMap[p.key]?.enabled);
  const anyConnected = connectedProviders.length > 0;

  const selectProvider = (key) => {
    setSelected(key);
    setFormVals({});
    setTestResult(null);
  };

  const save = async () => {
    if (!provider) return;
    const body = {};
    for (const f of provider.fields) {
      if (formVals[f.key]?.trim()) body[f.key] = formVals[f.key].trim();
    }
    if (!Object.keys(body).length) { showToast('Enter at least one field.', false); return; }
    setSaving(true);
    const data = await api.post(`/tools/${provider.key}`, body);
    setSaving(false);
    if (!data.success) { showToast(data.error, false); return; }
    showToast(`${provider.label} connected. Testing…`, true);
    setFormVals({});
    await testConn();
    await refreshStatus();
  };

  const testConn = async () => {
    if (!provider) return;
    setTesting(true);
    setTestResult(null);
    const data = await api.post(`/tools/test/${provider.key}`, {});
    setTesting(false);
    setTestResult(data.success ? { ok: true, msg: data.info } : { ok: false, msg: data.error });
    if (data.success) refreshStatus();
  };

  const disconnect = async (providerKey) => {
    const p = PAYMENT_PROVIDERS.find(x => x.key === providerKey);
    if (!confirm(`Disconnect ${p?.label}? Credentials will be removed.`)) return;
    const data = await api.del(`/tools/${providerKey}`);
    if (data.success) {
      showToast(`${p?.label} disconnected.`, true);
      if (selected === providerKey) { setSelected(null); setFormVals({}); setTestResult(null); }
      await refreshStatus();
    } else {
      showToast(data.error, false);
    }
  };

  return (
    <div className={`card p-5${anyConnected ? ' connected' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{ background: 'rgba(99,102,241,0.12)' }}>💰</div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white text-sm">Payment Hub</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${anyConnected ? 'badge-on' : 'badge-off'}`}>
                {anyConnected ? `${connectedProviders.length} connected` : 'Not connected'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Stripe · PayPal · Square · Authorize.net</p>
          </div>
        </div>
        <button onClick={() => setIsOpen(o => !o)} className="btn-ghost px-4 py-1.5 text-xs">
          {isOpen ? '▲ Collapse' : anyConnected ? '⚙️ Manage' : '+ Connect'}
        </button>
      </div>

      {/* Connected provider pills */}
      {anyConnected && !isOpen && (
        <div className="flex flex-wrap gap-2 mt-1">
          {connectedProviders.map(p => (
            <span key={p.key} style={{
              background: p.color, border: `1px solid ${p.borderColor}`,
              borderRadius: 10, padding: '2px 10px', fontSize: 12, color: '#e2e8f0',
            }}>
              {p.icon} {p.label}
            </span>
          ))}
        </div>
      )}

      {/* Expanded panel */}
      {isOpen && (
        <div className="mt-4 fade-up">
          {/* Provider selector tabs */}
          <div className="flex flex-wrap gap-2 mb-4">
            {PAYMENT_PROVIDERS.map(p => {
              const isConn = serverMap[p.key]?.enabled;
              const isActive = selected === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => selectProvider(p.key)}
                  style={{
                    padding: '6px 14px', borderRadius: 10, fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', transition: 'all .15s',
                    background: isActive ? p.color : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isActive ? p.borderColor : 'rgba(255,255,255,0.1)'}`,
                    color: isActive ? '#e2e8f0' : '#9ca3af',
                  }}
                >
                  {p.icon} {p.label}
                  {isConn && <span style={{ marginLeft: 6, color: '#4ade80', fontSize: 10 }}>●</span>}
                </button>
              );
            })}
          </div>

          {/* Provider detail panel */}
          {!selected && (
            <p className="text-xs text-gray-500 text-center py-4">
              Select a payment provider above to connect or manage it.
            </p>
          )}

          {selected && provider && (() => {
            const isConn = serverMap[provider.key]?.enabled;
            const preview = serverMap[provider.key]?.configPreview || {};
            return (
              <div style={{
                background: 'rgba(255,255,255,0.03)', border: `1px solid ${provider.borderColor}`,
                borderRadius: 14, padding: 16,
              }}>
                {/* Provider header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 22 }}>{provider.icon}</span>
                    <div>
                      <span className="font-semibold text-white text-sm">{provider.label}</span>
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${isConn ? 'badge-on' : 'badge-off'}`}>
                        {isConn ? 'Connected' : 'Not connected'}
                      </span>
                    </div>
                  </div>
                  <a href={provider.docsUrl} target="_blank" rel="noreferrer"
                    className="text-xs text-gray-600 hover:text-gray-400">Docs ↗</a>
                </div>

                {/* Fields */}
                <div className="space-y-3 mb-4">
                  {provider.fields.map(f => {
                    const savedVal = preview[f.key];
                    const hasDb = !!savedVal;
                    return (
                      <div key={f.key}>
                        <label className="block text-xs text-gray-400 mb-1 font-medium">
                          {f.label}
                          {hasDb && !formVals[f.key] && (
                            <span className="ml-2 text-xs text-green-400 font-normal">✓ saved</span>
                          )}
                        </label>
                        <input
                          type={f.type}
                          value={formVals[f.key] ?? ''}
                          onChange={e => setFormVals(v => ({ ...v, [f.key]: e.target.value }))}
                          placeholder={hasDb && !formVals[f.key] ? savedVal : f.placeholder}
                          className="field w-full"
                          autoComplete="new-password"
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Test result */}
                {testResult && (
                  <div className={`text-xs font-medium mb-3 ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                    {testResult.ok ? `✓ ${testResult.msg}` : `✗ ${testResult.msg}`}
                  </div>
                )}
                {testing && <div className="text-xs text-yellow-400 mb-3">⏳ Testing connection…</div>}

                {/* Action row */}
                <div className="flex gap-2">
                  <button
                    onClick={save}
                    disabled={saving || !provider.fields.some(f => formVals[f.key]?.trim())}
                    className="btn-primary flex-1 py-2 text-xs"
                  >
                    {saving ? 'Saving…' : isConn ? 'Update & Test' : 'Save & Connect'}
                  </button>
                  {isConn && (
                    <>
                      <button
                        onClick={testConn}
                        disabled={testing}
                        style={{
                          background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                          borderRadius: 12, padding: '8px 14px', color: '#a5b4fc',
                          cursor: 'pointer', fontSize: 12, fontWeight: 500,
                        }}
                      >
                        ↻ Test
                      </button>
                      <button
                        onClick={() => disconnect(provider.key)}
                        style={{
                          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                          borderRadius: 12, padding: '8px 12px', color: '#f87171',
                          cursor: 'pointer', fontSize: 12,
                        }}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function BuiltInCard({ icon, label, badge, color, description, rightLabel, rightSub }) {
  return (
    <div className="card connected p-5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: color }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white text-sm">{label}</span>
            <span className="badge-on text-xs px-2 py-0.5 rounded-full">{badge}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 leading-snug">{description}</p>
        </div>
      </div>
      <div className="text-right text-xs text-gray-500 flex-shrink-0">
        <div className="text-green-400 font-medium">{rightLabel}</div>
        {rightSub && <div className="mt-0.5">{rightSub}</div>}
      </div>
    </div>
  );
}

// ── Social Hub Card — GHL-native connect/disconnect ───────────────────────────

const PLATFORM_META = {
  facebook:  { label: 'Facebook',  icon: '📘', bg: '#1877f2', color: 'rgba(24,119,242,0.12)',  border: 'rgba(24,119,242,0.4)' },
  instagram: { label: 'Instagram', icon: '📸', bg: '#e1306c', color: 'rgba(225,48,108,0.12)',  border: 'rgba(225,48,108,0.4)' },
  tiktok:    { label: 'TikTok',    icon: '🎵', bg: '#010101', color: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.2)' },
  youtube:   { label: 'YouTube',   icon: '📺', bg: '#ff0000', color: 'rgba(255,0,0,0.1)',      border: 'rgba(255,0,0,0.35)' },
  linkedin:  { label: 'LinkedIn',  icon: '💼', bg: '#0077b5', color: 'rgba(0,119,181,0.12)',   border: 'rgba(0,119,181,0.4)' },
  pinterest: { label: 'Pinterest', icon: '📌', bg: '#e60023', color: 'rgba(230,0,35,0.1)',     border: 'rgba(230,0,35,0.35)' },
  twitter:   { label: 'Twitter',   icon: '🐦', bg: '#1da1f2', color: 'rgba(29,161,242,0.1)',   border: 'rgba(29,161,242,0.35)' },
  gmb:       { label: 'Google My Business', icon: '🔵', bg: '#4285f4', color: 'rgba(66,133,244,0.1)', border: 'rgba(66,133,244,0.35)' },
};

// ── Facebook OAuth Connect Button — for facebook_ads card ────────────────────
function FacebookOAuthButton({ apiKey, enabled, showToast, onConnected }) {
  const [connecting, setConnecting] = useState(false);

  async function connect() {
    if (!apiKey) { showToast('No location key found.', false); return; }
    setConnecting(true);
    try {
      const result = await openOAuthPopup('facebook', apiKey);
      if (result === null) { /* popup closed */ return; }
      showToast(`Facebook connected: ${result.account?.name || 'page saved'}`, true);
      if (onConnected) onConnected();
    } catch (err) {
      showToast(`Facebook connect failed: ${err.message}`, false);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div style={{ background: 'rgba(24,119,242,0.08)', border: '1px solid rgba(24,119,242,0.3)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
          📘 Connect with Facebook
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>
          {enabled ? 'Reconnect to update your page / token.' : 'Sign in with Facebook to select your Page — no manual token needed.'}
        </p>
      </div>
      <button
        onClick={connect}
        disabled={connecting}
        style={{
          background: connecting ? 'rgba(24,119,242,0.3)' : '#1877f2',
          border: 'none', borderRadius: 8, padding: '8px 16px',
          color: '#fff', fontSize: 12, fontWeight: 700, cursor: connecting ? 'not-allowed' : 'pointer',
          flexShrink: 0, whiteSpace: 'nowrap',
        }}
      >
        {connecting ? '⏳ Connecting…' : enabled ? '↻ Reconnect' : '+ Connect'}
      </button>
    </div>
  );
}

// ── Facebook Lead Sync Button — pulls FB Lead Ads leads → GHL contacts ───────
function FbLeadSyncButton({ apiKey, showToast }) {
  const [syncing,  setSyncing]  = useState(false);
  const [result,   setResult]   = useState(null); // { synced, total }

  async function handleSync() {
    if (!apiKey) return;
    setSyncing(true);
    setResult(null);
    try {
      const d = await api.postWithKey('/ads/facebook/sync-leads', {}, apiKey);
      if (d.success) {
        const msg = d.synced > 0
          ? `${d.synced} lead${d.synced !== 1 ? 's' : ''} synced to CRM`
          : 'No new leads to sync';
        setResult({ synced: d.synced, total: d.total });
        showToast(msg, d.synced > 0);
      } else {
        showToast(d.error || 'Lead sync failed.', false);
      }
    } catch (e) {
      showToast('Lead sync error: ' + e.message, false);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        onClick={handleSync}
        disabled={syncing}
        style={{
          background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: 12, padding: '8px 14px',
          color: '#4ade80', cursor: syncing ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 500,
          opacity: syncing ? 0.7 : 1,
        }}
        title="Fetch lead form submissions from Facebook & Instagram and create them as contacts in your CRM"
      >
        {syncing ? '⏳ Syncing leads…' : '⬇ Sync Leads to CRM'}
      </button>
      {result && (
        <span style={{ fontSize: 11, color: result.synced > 0 ? '#4ade80' : '#9ca3af', textAlign: 'center' }}>
          {result.synced}/{result.total} leads synced
        </span>
      )}
    </div>
  );
}

// Normalize GHL type strings to our platform keys
// GHL returns values like: facebookPage, instagramBusiness, linkedinPage, twitterProfile, etc.
function normalizePlatform(raw = '') {
  const t = raw.toLowerCase();
  if (t.includes('facebook'))  return 'facebook';
  if (t.includes('instagram')) return 'instagram';
  if (t.includes('tiktok'))    return 'tiktok';
  if (t.includes('youtube'))   return 'youtube';
  if (t.includes('linkedin'))  return 'linkedin';
  if (t.includes('pinterest')) return 'pinterest';
  if (t.includes('twitter') || t.includes('x.com')) return 'twitter';
  if (t.includes('gmb') || t.includes('google')) return 'gmb';
  return t;
}

// Platforms that can be connected (shown as tiles even when not connected)
const CONNECTABLE = ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin', 'pinterest', 'twitter', 'gmb'];

// Platforms that have OAuth connect buttons.
// Some use a parent platform's flow (instagram → facebook, gmb → google).
const OAUTH_PLATFORMS = new Set(['facebook', 'instagram', 'google', 'gmb', 'linkedin', 'tiktok', 'pinterest']);
// Maps a platform key to the actual OAuth route to open
const OAUTH_PLATFORM_ROUTE = {
  instagram: 'facebook', // Instagram Business connects via Facebook OAuth
  gmb:       'google',   // Google My Business connects via Google OAuth
};

function SocialHubCard() {
  const { apiKey, refreshStatus: refreshIntegrations } = useApp();
  const [accounts,      setAccounts]      = useState([]);
  const [status,        setStatus]        = useState({}); // { facebook: { connected, name, avatar }, ... }
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [isOpen,        setIsOpen]        = useState(true);
  const [ghlConnected,  setGhlConnected]  = useState(true);
  const [connecting,    setConnecting]    = useState(null); // platformKey being connected

  async function connectPlatform(platformKey) {
    if (!apiKey) { setError('No location key found.'); return; }
    setConnecting(platformKey);
    try {
      const oauthRoute = OAUTH_PLATFORM_ROUTE[platformKey] || platformKey;
      const result = await openOAuthPopup(oauthRoute, apiKey);
      if (result === null) return; // popup closed without completing
      await loadAccounts();
      if (refreshIntegrations) refreshIntegrations();
    } catch (err) {
      setError(`${platformKey} connect failed: ${err.message}`);
    } finally {
      setConnecting(null);
    }
  }

  async function loadAccounts() {
    setLoading(true);
    setError(null);
    try {
      // Load both in parallel: account list (for details/disconnect) + status (authoritative per-platform)
      const [accData, statusData] = await Promise.all([
        api.get('/social/accounts'),
        api.get('/social/status'),
      ]);
      const list = Array.isArray(accData) ? accData : (accData.accounts || accData.data || []);
      console.log('[SocialHub] /social/status _debug:', statusData?._debug);
      console.log('[SocialHub] /social/accounts list:', list.map(a => `${a.platform}:${a.name}`));

      // Merge status from /social/status with platform fields from /social/accounts
      // so either source can mark a platform as connected
      const mergedStatus = { ...(statusData?.status || {}) };
      list.forEach(a => {
        if (a.platform && !mergedStatus[a.platform]?.connected) {
          mergedStatus[a.platform] = { connected: true, name: a.name || null, avatar: a.avatar || a.picture || null };
        }
      });
      console.log('[SocialHub] merged connected:', Object.entries(mergedStatus).filter(([,v]) => v.connected).map(([k]) => k));

      setAccounts(list);
      setStatus(mergedStatus);
      setGhlConnected(accData?.ghlConnected !== false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAccounts(); }, []);


  const connectedCount = Object.values(status).filter(s => s.connected).length;
  const anyConnected   = connectedCount > 0 || accounts.length > 0;

  return (
    <div className={`card p-5${anyConnected ? ' connected' : ''}`}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: 'rgba(99,102,241,0.12)' }}>📱</div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white text-sm">Social Hub</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${anyConnected ? 'badge-on' : 'badge-off'}`}>
                {loading ? 'Loading…' : connectedCount > 0 ? `${connectedCount} connected` : 'Not connected'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Facebook · Instagram · TikTok · YouTube · LinkedIn · Pinterest</p>
          </div>
        </div>
        <button onClick={() => setIsOpen(o => !o)} className="btn-ghost px-4 py-1.5 text-xs">
          {isOpen ? '▲ Collapse' : anyConnected ? '⚙️ Manage' : '+ Connect'}
        </button>
      </div>

      {/* Collapsed pill preview */}
      {anyConnected && !isOpen && (
        <div className="flex flex-wrap gap-2 mt-1">
          {accounts.map(acc => {
            const type = normalizePlatform(acc.type || acc.platform || acc.accountType || '');
            const meta = PLATFORM_META[type] || { icon: '🔗', bg: '#6366f1', color: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.4)' };
            return (
              <span key={acc.id || acc.accountId} style={{ display: 'flex', alignItems: 'center', gap: 5, background: meta.color, border: `1px solid ${meta.border}`, borderRadius: 20, padding: '3px 10px 3px 6px', fontSize: 12, color: '#e2e8f0' }}>
                {acc.avatar || acc.picture
                  ? <img src={acc.avatar || acc.picture} alt="" style={{ width: 16, height: 16, borderRadius: '50%', objectFit: 'cover' }} />
                  : <span>{meta.icon}</span>}
                {acc.name || acc.displayName || type}
              </span>
            );
          })}
        </div>
      )}

      {/* ── Expanded grid ── */}
      {isOpen && (
        <div style={{ marginTop: '1rem' }}>
          {loading && <p style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', padding: '1rem 0' }}>Loading social accounts…</p>}

          {!ghlConnected && (
            <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 10, padding: '0.75rem 1rem', fontSize: 13, color: '#fbbf24', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
              <div>
                <strong style={{ display: 'block', marginBottom: 3 }}>GHL OAuth not connected</strong>
                Social accounts cannot be synced because this location's GHL app token is missing.
                This usually happens when the app was installed before credentials were configured.{' '}
                <a href="/oauth/install" style={{ color: '#93c5fd', textDecoration: 'underline', fontWeight: 600 }}>
                  Click here to reinstall the app
                </a>{' '}
                to fix this. You can still connect platforms directly below.
              </div>
            </div>
          )}
          {error && typeof error === 'string' && (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '0.75rem 1rem', fontSize: 13, color: '#f87171', marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          {!loading && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem' }}>
              {CONNECTABLE.map(platformKey => {
                const meta        = PLATFORM_META[platformKey];
                const s           = status[platformKey] || {};
                const isConnected = !!s.connected;

                return (
                  <div key={platformKey} style={{
                    background: isConnected ? meta.color : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isConnected ? meta.border : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 14, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem',
                  }}>
                    {/* Platform header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 20 }}>{meta.icon}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{meta.label}</span>
                      </div>
                      {isConnected && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#34d399', flexShrink: 0 }} />}
                    </div>

                    {isConnected ? (
                      /* ── Connected ── */
                      <>
                        {s.name && (
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</p>
                        )}
                        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: '#34d399' }}>
                          <span>✓</span> Connected
                        </div>
                      </>
                    ) : (
                      /* ── Not connected ── */
                      <div style={{ marginTop: 'auto' }}>
                        {OAUTH_PLATFORMS.has(platformKey) ? (
                          <button
                            onClick={() => connectPlatform(platformKey)}
                            disabled={connecting === platformKey}
                            style={{
                              width: '100%', padding: '6px 0', borderRadius: 8,
                              background: connecting === platformKey ? 'rgba(255,255,255,0.06)' : meta.color,
                              border: `1px solid ${meta.border}`,
                              color: '#e2e8f0', fontSize: 12, fontWeight: 600, cursor: connecting === platformKey ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {connecting === platformKey ? '⏳ Connecting…' : `+ Connect ${meta.label}`}
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, color: '#6b7280' }}>Not connected</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
