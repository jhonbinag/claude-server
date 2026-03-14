/**
 * FunnelBuilder.jsx — Native GHL Page Builder (AI-powered)
 *
 * Users paste their GHL Firebase token once → AI generates complete native
 * GHL page JSON → saved directly to backend.leadconnectorhq.com.
 *
 * Steps:
 *   1. Connect — paste refreshedToken from GHL localStorage key "refreshedToken"
 *   2. Enter pageId + funnel details
 *   3. Generate → Claude writes native page JSON → saved to GHL
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp }  from '../context/AppContext';
import AuthGate    from '../components/AuthGate';
import Header      from '../components/Header';
import Spinner     from '../components/Spinner';
import { api }     from '../lib/api';

// ── helpers ───────────────────────────────────────────────────────────────────

function toast(setToast, msg, type = 'success') {
  setToast({ msg, type });
  setTimeout(() => setToast(null), 4000);
}

const PAGE_TYPES = [
  'Sales Page',
  'Opt-in / Lead Capture Page',
  'Thank You Page',
  'Webinar Registration Page',
  'Order Page',
  'Upsell Page',
  'Downsell Page',
  'VSL Page',
  'About Page',
  'Home Page',
  'Product Page',
];

const COLOR_PRESETS = [
  { label: 'Navy & Gold',      value: 'dark navy (#0F172A) background with gold (#F59E0B) accents and white text' },
  { label: 'Bold Blue',        value: 'bright blue (#1D4ED8) accents on white, dark text' },
  { label: 'Dark & Modern',    value: 'charcoal (#111827) background, white text, emerald (#10B981) CTAs' },
  { label: 'Clean White',      value: 'clean white background, dark gray text (#111827), indigo (#6366F1) accents' },
  { label: 'Luxury Black',     value: 'pure black background, white text, gold (#D97706) CTAs and highlights' },
  { label: 'High Energy Red',  value: 'white background, bold red (#DC2626) CTAs, dark text — urgency-driven' },
  { label: 'Trust Green',      value: 'white background, dark green (#065F46) headings, soft green accents' },
  { label: 'Custom…',          value: '' },
];

// ── component ─────────────────────────────────────────────────────────────────

export default function FunnelBuilder() {
  const { isAuthenticated, isAuthLoading, apiKey, locationId } = useApp();

  const [toastState,    setToastState]    = useState(null);
  const [fbStatus,      setFbStatus]      = useState(null);   // { connected, expiresAt }
  const [fbLoading,     setFbLoading]     = useState(true);

  // Connect panel
  const [token,         setToken]         = useState('');
  const [connecting,    setConnecting]    = useState(false);

  // Generate form
  const [pageId,        setPageId]        = useState('');
  const [funnelId,      setFunnelId]      = useState('');
  const [pageType,      setPageType]      = useState(PAGE_TYPES[0]);
  const [niche,         setNiche]         = useState('');
  const [offer,         setOffer]         = useState('');
  const [audience,      setAudience]      = useState('');
  const [colorPreset,   setColorPreset]   = useState(COLOR_PRESETS[0].value);
  const [customColor,   setCustomColor]   = useState('');
  const [extraContext,  setExtraContext]  = useState('');
  const [generating,    setGenerating]    = useState(false);
  const [result,        setResult]        = useState(null);

  // ── load Firebase connection status ─────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    if (!apiKey) return;
    setFbLoading(true);
    try {
      const d = await api.getWithKey('/funnel-builder/status', apiKey);
      if (d.success) setFbStatus(d);
    } catch {}
    setFbLoading(false);
  }, [apiKey]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // ── handlers ─────────────────────────────────────────────────────────────────

  async function handleConnect(e) {
    e.preventDefault();
    if (!token.trim()) return;
    setConnecting(true);
    try {
      const d = await api.postWithKey('/funnel-builder/connect', { refreshedToken: token.trim() }, apiKey);
      if (d.success) {
        toast(setToastState, 'Page Builder connected!');
        setToken('');
        await loadStatus();
      } else {
        toast(setToastState, d.error || 'Connection failed.', 'error');
      }
    } catch (err) {
      toast(setToastState, err.message || 'Connection failed.', 'error');
    }
    setConnecting(false);
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect the Firebase page builder token?')) return;
    try {
      await api.deleteWithKey('/funnel-builder/connect', apiKey);
      toast(setToastState, 'Disconnected.');
      setFbStatus({ connected: false, expiresAt: null });
    } catch (err) {
      toast(setToastState, err.message, 'error');
    }
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (!pageId.trim()) { toast(setToastState, 'Page ID is required.', 'error'); return; }
    if (!niche.trim())  { toast(setToastState, 'Niche / Business is required.', 'error'); return; }
    if (!offer.trim())  { toast(setToastState, 'Offer is required.', 'error'); return; }

    const colorScheme = colorPreset || customColor || COLOR_PRESETS[0].value;

    setGenerating(true);
    setResult(null);
    try {
      const d = await api.postWithKey('/funnel-builder/generate', {
        pageId:      pageId.trim(),
        funnelId:    funnelId.trim() || undefined,
        pageType,
        niche:       niche.trim(),
        offer:       offer.trim(),
        audience:    audience.trim() || undefined,
        colorScheme,
        extraContext: extraContext.trim() || undefined,
      }, apiKey);

      if (d.success) {
        setResult(d);
        toast(setToastState, `Page generated (${d.sectionsCount} sections) and saved to GHL!`);
      } else {
        toast(setToastState, d.error || 'Generation failed.', 'error');
        if (d.pageJson) setResult({ pageJson: d.pageJson, failed: true });
      }
    } catch (err) {
      toast(setToastState, err.message || 'Generation failed.', 'error');
    }
    setGenerating(false);
  }

  // ── render ───────────────────────────────────────────────────────────────────

  if (isAuthLoading) return <Spinner />;

  return (
    <AuthGate>
      <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
        <Header icon="🏗️" title="Native Funnel Builder" subtitle="AI-powered GHL page generation" />

        {/* Toast */}
        {toastState && (
          <div
            className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-lg"
            style={{ background: toastState.type === 'error' ? '#7f1d1d' : '#14532d', color: '#fff', maxWidth: 360 }}
          >
            {toastState.msg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 max-w-4xl mx-auto w-full">

          {/* ── Step 1: Connect ─────────────────────────────────────────── */}
          <section className="glass rounded-xl p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center"
                  style={{ background: fbStatus?.connected ? '#14532d' : '#1e3a5f' }}>1</span>
                Connect GHL Page Builder
              </h2>
              {fbStatus?.connected && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-xs text-green-400">Connected</span>
                  {fbStatus.expiresAt && (
                    <span className="text-xs text-gray-500 ml-1">
                      · expires {new Date(fbStatus.expiresAt).toLocaleString()}
                    </span>
                  )}
                  <button
                    onClick={handleDisconnect}
                    className="ml-3 text-xs text-gray-500 hover:text-red-400 transition-colors"
                  >
                    Disconnect
                  </button>
                </span>
              )}
            </div>

            {!fbStatus?.connected && (
              <>
                <p className="text-xs text-gray-400 mb-3 leading-relaxed">
                  To build native GHL pages, we need your Firebase page-builder token. Here's how to get it:
                </p>
                <ol className="text-xs text-gray-400 mb-4 space-y-1 pl-4 list-decimal leading-relaxed">
                  <li>Open GoHighLevel and navigate to any Funnel or Website page</li>
                  <li>Open DevTools → Application → Local Storage → <code className="text-indigo-400">app.gohighlevel.com</code></li>
                  <li>Find the key <code className="text-indigo-400">refreshedToken</code> and copy its value</li>
                  <li>Paste it below — it starts with <code className="text-gray-300">eyJ…</code></li>
                </ol>
                <form onSubmit={handleConnect} className="flex gap-2">
                  <input
                    type="password"
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    placeholder="Paste refreshedToken from GHL localStorage…"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={connecting || !token.trim()}
                    className="px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                    style={{ background: '#4f46e5', color: '#fff', opacity: connecting || !token.trim() ? 0.5 : 1 }}
                  >
                    {connecting ? 'Connecting…' : 'Connect'}
                  </button>
                </form>
              </>
            )}

            {fbStatus?.connected && (
              <p className="text-xs text-gray-400">
                Firebase page-builder token is active. Token auto-refreshes before expiry — you only need to reconnect if it stops working.
              </p>
            )}
          </section>

          {/* ── Step 2: Generate ────────────────────────────────────────── */}
          <section
            className="glass rounded-xl p-5 mb-5 transition-all"
            style={{ opacity: fbStatus?.connected ? 1 : 0.45, pointerEvents: fbStatus?.connected ? 'auto' : 'none' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center"
                style={{ background: '#1e3a5f' }}>2</span>
              <h2 className="text-sm font-semibold text-white">Generate Native Page</h2>
            </div>

            <form onSubmit={handleGenerate} className="space-y-4">

              {/* Page identifiers */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    GHL Page ID <span className="text-red-400">*</span>
                    <span className="ml-1 text-gray-600">(from page URL or API)</span>
                  </label>
                  <input
                    value={pageId}
                    onChange={e => setPageId(e.target.value)}
                    placeholder="e.g. YbcohnneHGj8YGoDIY4k"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    Copy from: GHL → Funnels → Page → URL → last segment after /page/
                  </p>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Funnel ID <span className="text-gray-600">(optional — for preview link)</span>
                  </label>
                  <input
                    value={funnelId}
                    onChange={e => setFunnelId(e.target.value)}
                    placeholder="e.g. abc123xyz"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Page type */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Page Type</label>
                <select
                  value={pageType}
                  onChange={e => setPageType(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {PAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* Niche + offer */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Business / Niche <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={niche}
                    onChange={e => setNiche(e.target.value)}
                    placeholder="e.g. Online fitness coaching for women"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Offer <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={offer}
                    onChange={e => setOffer(e.target.value)}
                    placeholder="e.g. 12-week body transformation program ($997)"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Audience */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Target Audience</label>
                <input
                  value={audience}
                  onChange={e => setAudience(e.target.value)}
                  placeholder="e.g. Busy moms 30-50 who want to lose weight without a gym"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Color scheme */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Color Scheme</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                  {COLOR_PRESETS.map(p => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => { setColorPreset(p.value); }}
                      className="px-2 py-1.5 rounded-lg text-xs transition-all text-left"
                      style={{
                        background: colorPreset === p.value ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${colorPreset === p.value ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
                        color: colorPreset === p.value ? '#a5b4fc' : '#9ca3af',
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {colorPreset === '' && (
                  <input
                    value={customColor}
                    onChange={e => setCustomColor(e.target.value)}
                    placeholder="Describe your color scheme…"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                )}
              </div>

              {/* Extra context */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Extra Context <span className="text-gray-600">(optional)</span></label>
                <textarea
                  value={extraContext}
                  onChange={e => setExtraContext(e.target.value)}
                  rows={3}
                  placeholder="Brand voice, competitor differentiation, testimonials to include, specific hooks, etc."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={generating}
                className="w-full py-3 rounded-xl text-sm font-bold transition-all"
                style={{
                  background: generating ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  color: '#fff',
                  opacity: generating ? 0.7 : 1,
                }}
              >
                {generating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    Generating & saving to GHL…
                  </span>
                ) : '🏗️ Generate & Save Native Page'}
              </button>
            </form>
          </section>

          {/* ── Result ──────────────────────────────────────────────────── */}
          {result && (
            <section className="glass rounded-xl p-5 mb-5">
              <h2 className="text-sm font-semibold text-white mb-3">
                {result.failed ? '⚠️ Generated (save failed)' : '✅ Page Saved to GHL'}
              </h2>

              {!result.failed && (
                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">Sections generated</span>
                    <span className="text-white font-semibold">{result.sectionsCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">Page ID</span>
                    <code className="text-indigo-400">{result.pageId}</code>
                  </div>
                  {result.previewUrl && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">Preview</span>
                      <a
                        href={result.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 underline"
                      >
                        Open in GHL →
                      </a>
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">Generated JSON</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(result.pageJson || result.ghlResponse, null, 2));
                      toast(setToastState, 'Copied!');
                    }}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <pre
                  className="text-xs text-gray-400 bg-gray-900 rounded-lg p-3 overflow-auto max-h-64 leading-relaxed"
                  style={{ fontFamily: 'monospace' }}
                >
                  {JSON.stringify(result.pageJson || result.ghlResponse, null, 2)}
                </pre>
              </div>
            </section>
          )}

          {/* ── How it works ────────────────────────────────────────────── */}
          <section className="glass rounded-xl p-5">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">How it works</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { icon: '🔑', title: 'Token Bridge', desc: 'Your GHL Firebase token authenticates directly with backend.leadconnectorhq.com — the same API GHL\'s own page builder uses.' },
                { icon: '🤖', title: 'Claude Generates', desc: 'Claude writes a complete native GHL page JSON with real sections, elements, copy, and styles based on your business.' },
                { icon: '💾', title: 'Saved Natively', desc: 'The page JSON is pushed directly to GHL\'s backend. Open the page in GHL\'s builder and your content is there.' },
              ].map(({ icon, title, desc }) => (
                <div key={title} className="bg-gray-900 rounded-lg p-3">
                  <div className="text-xl mb-2">{icon}</div>
                  <div className="text-xs font-semibold text-white mb-1">{title}</div>
                  <div className="text-xs text-gray-500 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>
    </AuthGate>
  );
}
