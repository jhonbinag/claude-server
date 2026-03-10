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
import { Link } from 'react-router-dom';
import { useApp }   from '../context/AppContext';
import AuthGate     from '../components/AuthGate';
import Header       from '../components/Header';
import Spinner      from '../components/Spinner';
import { INTEGRATIONS } from '../lib/integrations';
import { api }      from '../lib/api';

export default function Settings() {
  const { isAuthenticated, isAuthLoading, apiKey, claudeReady, locationId, refreshStatus, integrations } = useApp();

  const [toast,       setToast]       = useState(null);
  const [testResults, setTestResults] = useState({});
  const [expanded,    setExpanded]    = useState({});
  const [formValues,  setFormValues]  = useState({});
  const [editMode,    setEditMode]    = useState({});
  const [tokenStatus, setTokenStatus] = useState(null);
  const [reconnecting, setReconnecting] = useState(false);

  // Anthropic key state
  const [anthropicKey,     setAnthropicKey]     = useState('');
  const [anthropicEditing, setAnthropicEditing] = useState(false);
  const [anthropicSaving,  setAnthropicSaving]  = useState(false);

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="⚙️" title="GTM Integration Hub" subtitle="Connect your API keys to sync all tools">
      <Link to="/" className="block text-center text-xs text-gray-500 mt-4 hover:text-gray-300">
        ← Back to Dashboard
      </Link>
    </AuthGate>
  );

  const sidebarUrl = `${window.location.origin}/ui`;
  // Build lookup: key → server integration record (has .enabled, .configPreview)
  const serverMap = Object.fromEntries((integrations || []).map(i => [i.key, i]));

  // ── Load token status ─────────────────────────────────────────────────────

  useEffect(() => {
    api.getWithKey('/tools/sync', apiKey)
      .then(d => { if (d.success) setTokenStatus(d); })
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

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0f0f13' }}>
      <Header icon="⚙️" title="Integration Hub" subtitle="Connect APIs · Sync Tools · Power Claude" />

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
                    <span className="font-semibold text-white text-sm">Claude Opus 4.6</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${claudeReady ? 'badge-on' : 'badge-off'}`}>
                      {claudeReady ? 'Active' : 'Key required'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {claudeReady
                      ? 'Your Anthropic API key is active. Claude is ready.'
                      : 'Enter your Anthropic API key to activate Claude AI.'}
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

        {/* ── External integrations ──────────────────────────────────────── */}
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">External Integrations</h2>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))' }}>
          {INTEGRATIONS.map(cfg => {
            const sv      = serverMap[cfg.key] || {};
            const enabled = sv.enabled || false;
            const isOpen  = expanded[cfg.key] || false;
            const tr      = testResults[cfg.key];

            // Detect if any field is currently being edited
            const anyEditing = cfg.fields.some(f => isEditing(cfg.key, f.key));
            // Detect if any new value has been typed
            const hasChanges = cfg.fields.some(f => getFormVal(cfg.key, f.key).trim());

            return (
              <div key={cfg.key} className={`card p-5${enabled ? ' connected' : ''}`}>

                {/* ── Card header ─────────────────────────────────────── */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                      style={{ background: cfg.color }}
                    >
                      {cfg.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white text-sm">{cfg.label}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${enabled ? 'badge-on' : 'badge-off'}`}>
                          {enabled ? 'Connected' : 'Not connected'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 leading-snug">{cfg.description}</p>
                    </div>
                  </div>
                  <a href={cfg.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-gray-600 hover:text-gray-400 flex-shrink-0 mt-1 ml-2">
                    Docs ↗
                  </a>
                </div>

                {/* ── Toggle button ────────────────────────────────────── */}
                <button onClick={() => toggleExpand(cfg.key)} className="btn-ghost w-full py-1.5 text-xs">
                  {isOpen
                    ? '▲ Collapse'
                    : enabled ? '⚙️ Manage credentials' : '+ Connect'}
                </button>

                {/* ── Expanded form ────────────────────────────────────── */}
                {isOpen && (
                  <div className="mt-4 space-y-4 fade-up">

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
                    <div className="flex gap-2 pt-1">
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
