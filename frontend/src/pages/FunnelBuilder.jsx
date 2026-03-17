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

import { useState, useEffect, useCallback, useRef } from 'react';
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

const FUNNEL_TYPES = [
  { key: 'lead_gen',          emoji: '🧲', label: 'Lead Gen',          desc: 'Capture leads',                    pages: ['Opt-in Page', 'Thank You Page'] },
  { key: 'sales',             emoji: '💰', label: 'Sales Funnel',       desc: 'Opt-in → Sales → Order',           pages: ['Opt-in Page', 'Sales Page', 'Order Page', 'Thank You Page'] },
  { key: 'vsl',               emoji: '🎥', label: 'VSL Funnel',         desc: 'Video sales letter',               pages: ['VSL Page', 'Order Page', 'Thank You Page'] },
  { key: 'webinar',           emoji: '📡', label: 'Webinar Funnel',     desc: 'Register → Attend → Convert',      pages: ['Registration Page', 'Confirmation Page', 'Webinar Replay Page', 'Thank You Page'] },
  { key: 'tripwire',          emoji: '⚡', label: 'Tripwire Funnel',    desc: 'Low-cost offer + upsell',          pages: ['Opt-in Page', 'Sales Page', 'Upsell Page', 'Thank You Page'] },
  { key: 'product_launch',    emoji: '🚀', label: 'Product Launch',     desc: 'Full launch with upsell/downsell', pages: ['Opt-in Page', 'Sales Page', 'Upsell Page', 'Downsell Page', 'Thank You Page'] },
  { key: 'application',       emoji: '📋', label: 'Application Funnel', desc: 'Qualify before sales call',        pages: ['Opt-in Page', 'Application Page', 'Thank You Page'] },
  { key: 'free_shipping',     emoji: '📦', label: 'Free + Shipping',    desc: 'Free offer with shipping upsell',  pages: ['Sales Page', 'Order Page', 'Upsell Page', 'Thank You Page'] },
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
  const { isAuthenticated, isAuthLoading, apiKey, locationId } = useApp(); // eslint-disable-line no-unused-vars

  const [toastState,    setToastState]    = useState(null);
  const [fbStatus,      setFbStatus]      = useState(null);
  const [fbLoading,     setFbLoading]     = useState(true);

  // Tab: 'text' | 'design' | 'funnel'
  const [genMode,       setGenMode]       = useState('text');

  // Connect panel
  const [token,         setToken]         = useState('');
  const [connecting,    setConnecting]    = useState(false);

  // Generate form (text mode)
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
  const [genSteps,      setGenSteps]      = useState([]);
  const [result,        setResult]        = useState(null);
  const stepsRef = useRef(null);

  // Full funnel mode
  const [fullFunnelId,  setFullFunnelId]  = useState('');
  const [funnelType,    setFunnelType]    = useState('');
  const [funnelPages,   setFunnelPages]   = useState([]); // [{ id, name, pageType, status, sectionsCount, error }]
  const [funnelRunning, setFunnelRunning] = useState(false);
  const [needsPages,    setNeedsPages]    = useState(null); // { pagesToCreate: [...] }

  // Design upload mode
  const [designFile,    setDesignFile]    = useState(null);   // File object
  const [designPreview, setDesignPreview] = useState(null);   // object URL
  const [designPageId,  setDesignPageId]  = useState('');
  const [designFunnelId,setDesignFunnelId]= useState('');
  const [designContext, setDesignContext] = useState('');
  const [designAgent,   setDesignAgent]   = useState('');
  const [designDragging,setDesignDragging]= useState(false);
  const [analyzing,     setAnalyzing]     = useState(false);
  const fileInputRef                      = useRef(null);

  // Agent selector
  const [agents,        setAgents]        = useState([]);
  const [selectedAgent, setSelectedAgent] = useState('');

  // ── load Firebase connection status + saved agents ───────────────────────────

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

  useEffect(() => {
    if (!apiKey) return;
    api.getWithKey('/agent/agents', apiKey)
      .then(d => { if (d.success) setAgents(d.data || []); })
      .catch(() => {});
  }, [apiKey]);

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

  function handleDesignFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      toast(setToastState, 'Only PNG, JPG, WEBP, or GIF images are accepted.', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast(setToastState, 'Image must be under 10 MB.', 'error');
      return;
    }
    setDesignFile(file);
    if (designPreview) URL.revokeObjectURL(designPreview);
    setDesignPreview(URL.createObjectURL(file));
    setResult(null);
  }

  async function handleAnalyzeDesign(e) {
    e.preventDefault();
    if (!designFile)              { toast(setToastState, 'Upload a design image first.', 'error'); return; }
    if (!designPageId.trim())     { toast(setToastState, 'Page ID is required.', 'error'); return; }
    if (!designFunnelId.trim())   { toast(setToastState, 'Funnel ID is required.', 'error'); return; }

    const formData = new FormData();
    formData.append('image', designFile);
    formData.append('pageId', designPageId.trim());
    formData.append('funnelId', designFunnelId.trim());
    if (designContext.trim())  formData.append('extraContext', designContext.trim());
    if (designAgent)           formData.append('agentId', designAgent);

    const locId = locationId || localStorage.getItem('gtm_location_id') || '';
    if (!locId) {
      toast(setToastState, 'Location ID not found. Please refresh the page.', 'error');
      return;
    }

    setAnalyzing(true);
    setResult(null);
    try {
      const resp = await fetch(`/funnel-builder/generate-from-design`, {
        method:  'POST',
        headers: { 'x-location-id': locId },
        body:    formData,
      });
      const d = await resp.json();
      if (d.success) {
        setResult(d);
        toast(setToastState, `Design analyzed (${d.sectionsCount} sections) and saved to GHL!`);
      } else {
        toast(setToastState, d.error || 'Analysis failed.', 'error');
        if (d.pageJson) setResult({ pageJson: d.pageJson, failed: true });
      }
    } catch (err) {
      toast(setToastState, err.message || 'Analysis failed.', 'error');
    }
    setAnalyzing(false);
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (!pageId.trim())   { toast(setToastState, 'Page ID is required.', 'error'); return; }
    if (!funnelId.trim()) { toast(setToastState, 'Funnel ID is required.', 'error'); return; }
    if (!niche.trim())    { toast(setToastState, 'Niche / Business is required.', 'error'); return; }
    if (!offer.trim())    { toast(setToastState, 'Offer is required.', 'error'); return; }

    const colorScheme = colorPreset || customColor || COLOR_PRESETS[0].value;

    setGenerating(true);
    setResult(null);
    setGenSteps([{ text: 'Sending request to AI…', status: 'running' }]);
    setTimeout(() => stepsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    try {
      setGenSteps(s => [...s.slice(0,-1), { text: 'AI generating page JSON…', status: 'running' }]);
      const d = await api.postWithKey('/funnel-builder/generate', {
        pageId:      pageId.trim(),
        funnelId:    funnelId.trim() || undefined,
        pageType,
        niche:       niche.trim(),
        offer:       offer.trim(),
        audience:    audience.trim() || undefined,
        colorScheme,
        extraContext: extraContext.trim() || undefined,
        agentId:     selectedAgent || undefined,
      }, apiKey);

      if (d.success) {
        setGenSteps(s => [
          ...s.slice(0,-1),
          { text: `✓ Page JSON generated (${d.sectionsCount} sections)`, status: 'done' },
          { text: '✓ Saved to GHL successfully', status: 'done' },
        ]);
        setResult(d);
        toast(setToastState, `Page generated (${d.sectionsCount} sections) and saved to GHL!`);
      } else {
        setGenSteps(s => [...s.slice(0,-1), { text: `✗ ${d.error || 'Generation failed'}`, status: 'error' }]);
        toast(setToastState, d.error || 'Generation failed.', 'error');
        if (d.pageJson) setResult({ pageJson: d.pageJson, failed: true });
      }
    } catch (err) {
      setGenSteps(s => [...s.slice(0,-1), { text: `✗ ${err.message || 'Generation failed'}`, status: 'error' }]);
      toast(setToastState, err.message || 'Generation failed.', 'error');
    }
    setGenerating(false);
  }

  // ── Full Funnel Generator ─────────────────────────────────────────────────
  async function handleGenerateFunnel(e) {
    e.preventDefault();
    if (!funnelType)          { toast(setToastState, 'Please select a funnel type.', 'error'); return; }
    if (!fullFunnelId.trim()) { toast(setToastState, 'Funnel ID is required.', 'error'); return; }

    setFunnelRunning(true);
    setFunnelPages([]);
    setNeedsPages(null);
    const colorScheme = colorPreset || customColor || COLOR_PRESETS[0].value;

    try {
      const res = await fetch('/funnel-builder/generate-funnel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
        body:    JSON.stringify({
          funnelId:    fullFunnelId.trim(),
          funnelType:  funnelType || undefined,
          niche:       niche.trim(),
          offer:       offer.trim(),
          audience:    audience.trim() || undefined,
          colorScheme,
          extraContext: extraContext.trim() || undefined,
          agentId:     selectedAgent || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (errData.needsPages && errData.pagesToCreate) {
          setNeedsPages(errData.pagesToCreate);
          setFunnelRunning(false);
          return;
        }
        throw new Error(errData.error || `Server error ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const eventLine = part.match(/^event: (.+)$/m)?.[1];
          const dataLine  = part.match(/^data: (.+)$/m)?.[1];
          if (!eventLine || !dataLine) continue;
          try {
            const d = JSON.parse(dataLine);
            if (eventLine === 'start') {
              setFunnelPages(d.pages.map(p => ({ ...p, status: 'pending' })));
            } else if (eventLine === 'page_start') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: 'running', pageType: d.pageType } : p));
            } else if (eventLine === 'page_done') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: 'done', sectionsCount: d.sectionsCount, pageType: d.pageType } : p));
            } else if (eventLine === 'page_error') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: 'error', error: d.error } : p));
            } else if (eventLine === 'complete') {
              toast(setToastState, `Done! ${d.succeeded}/${d.total} pages generated.`, d.failed > 0 ? 'error' : 'success');
            }
          } catch {}
        }
      }
    } catch (err) {
      toast(setToastState, err.message || 'Funnel generation failed.', 'error');
    }
    setFunnelRunning(false);
  }

  // ── render ───────────────────────────────────────────────────────────────────

  if (isAuthLoading) return <Spinner />;
  if (!isAuthenticated) return <AuthGate icon="🏗️" title="Native Funnel Builder" />;

  return (
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
                    className="ml-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    Reconnect
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="ml-1 text-xs text-gray-500 hover:text-red-400 transition-colors"
                  >
                    Disconnect
                  </button>
                </span>
              )}
            </div>

            {!fbStatus?.connected && (
              <>
                {fbLoading ? (
                  <p className="text-xs text-gray-500">Checking connection…</p>
                ) : (
                  <>
                    {/* Console snippet */}
                    {(() => {
                      const serverUrl = window.location.origin;
                      const locId = locationId || '';
                      const snippet =
`(async()=>{
  const post=t=>fetch('${serverUrl}/funnel-builder/connect',{method:'POST',headers:{'Content-Type':'application/json','x-location-id':'${locId}'},body:JSON.stringify({refreshedToken:t})}).then(r=>r.json()).then(d=>{if(d.success)alert('✅ Connected! Go back to your app.');else alert('❌ '+(d.error||'Failed: '+JSON.stringify(d)));});
  // Try localStorage first (Firebase v8)
  const lsKey=Object.keys(localStorage).find(k=>k.startsWith('firebase:authUser:'));
  const lsUser=lsKey?JSON.parse(localStorage.getItem(lsKey)||'null'):null;
  const lsToken=lsUser?.stsTokenManager?.accessToken;
  if(lsToken){console.log('Using localStorage token');return post(lsToken);}
  // Try IndexedDB (Firebase v9+)
  const db=await new Promise((res,rej)=>{const r=indexedDB.open('firebaseLocalStorageDb');r.onsuccess=e=>res(e.target.result);r.onerror=()=>rej(r.error);});
  const idbToken=await new Promise((res,rej)=>{const tx=db.transaction('firebaseLocalStorage','readonly');const req=tx.objectStore('firebaseLocalStorage').getAll();req.onsuccess=e=>{const rec=e.target.result.find(r=>r&&r.value&&r.value.stsTokenManager);res(rec?.value?.stsTokenManager?.accessToken||null);};req.onerror=()=>res(null);});
  if(idbToken){console.log('Using IndexedDB token');return post(idbToken);}
  // Fallback: refreshedToken from localStorage
  const rt=localStorage.getItem('refreshedToken');
  if(rt){console.log('Using refreshedToken');return post(rt);}
  alert('No Firebase token found. Make sure you are logged in to GHL and try again.');
})();`;
                      return (
                        <div className="mb-4">
                          <p className="text-xs text-gray-300 font-semibold mb-1">Step 1 — Copy this snippet:</p>
                          <div className="relative">
                            <pre className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs text-green-400 overflow-x-auto whitespace-pre-wrap break-all">{snippet}</pre>
                            <button
                              onClick={() => { navigator.clipboard.writeText(snippet); }}
                              className="absolute top-2 right-2 px-2 py-1 rounded text-xs font-semibold"
                              style={{ background: '#4f46e5', color: '#fff' }}
                            >Copy</button>
                          </div>
                          <p className="text-xs text-gray-400 mt-2">
                            <strong className="text-gray-300">Step 2</strong> — Go to <code className="text-green-400">app.gohighlevel.com</code>, open DevTools (F12), paste into the <strong>Console</strong> tab and press Enter.
                          </p>
                          <p className="text-xs text-gray-500 mt-1">You'll see a ✅ popup when connected.</p>
                        </div>
                      );
                    })()}

                    {/* Manual fallback */}
                    <p className="text-xs text-gray-600 mb-2 mt-3">Or paste the token manually:</p>
                    <form onSubmit={handleConnect} className="flex gap-2">
                      <input
                        type="password"
                        value={token}
                        onChange={e => setToken(e.target.value)}
                        placeholder="Paste Firebase token from GHL…"
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
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center"
                  style={{ background: '#1e3a5f' }}>2</span>
                <h2 className="text-sm font-semibold text-white">Generate Native Page</h2>
              </div>
              {/* Mode tabs */}
              <div className="flex rounded-lg overflow-hidden border border-gray-700">
                {[
                  { key: 'text',   label: '✍️ From Brief' },
                  { key: 'design', label: '🎨 From Design' },
                  { key: 'funnel', label: '🚀 Full Funnel' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setGenMode(key)}
                    className="px-3 py-1.5 text-xs font-medium transition-all"
                    style={{
                      background: genMode === key ? '#4f46e5' : 'transparent',
                      color: genMode === key ? '#fff' : '#9ca3af',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Design Upload Mode ────────────────────────────────────── */}
            {genMode === 'design' && (
              <form onSubmit={handleAnalyzeDesign} className="space-y-4">
                <p className="text-xs text-gray-400">
                  Screenshot your Figma design (or any page design) and upload it. Claude Vision will analyze the layout and recreate it as native GHL elements.
                </p>

                {/* Drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setDesignDragging(true); }}
                  onDragLeave={() => setDesignDragging(false)}
                  onDrop={e => { e.preventDefault(); setDesignDragging(false); handleDesignFile(e.dataTransfer.files[0]); }}
                  onClick={() => fileInputRef.current?.click()}
                  className="relative rounded-xl border-2 border-dashed transition-all cursor-pointer overflow-hidden"
                  style={{
                    borderColor: designDragging ? '#6366f1' : designPreview ? '#374151' : '#374151',
                    background:  designDragging ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
                    minHeight:   designPreview ? 'auto' : 120,
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={e => handleDesignFile(e.target.files[0])}
                  />
                  {designPreview ? (
                    <div className="relative">
                      <img
                        src={designPreview}
                        alt="Design preview"
                        className="w-full rounded-xl object-contain max-h-96"
                      />
                      <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-all rounded-xl flex items-center justify-center opacity-0 hover:opacity-100">
                        <span className="text-white text-xs font-medium bg-black/60 px-3 py-1.5 rounded-lg">
                          Click to replace
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-8">
                      <span className="text-3xl">🖼️</span>
                      <p className="text-xs text-gray-400 text-center">
                        Drag & drop your Figma screenshot here<br />
                        <span className="text-gray-600">or click to browse · PNG, JPG, WEBP up to 10 MB</span>
                      </p>
                    </div>
                  )}
                </div>

                {designFile && (
                  <p className="text-xs text-gray-500">
                    {designFile.name} · {(designFile.size / 1024).toFixed(0)} KB
                    <button
                      type="button"
                      onClick={() => { setDesignFile(null); setDesignPreview(null); }}
                      className="ml-2 text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </p>
                )}

                {/* Page identifiers */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      GHL Page ID <span className="text-red-400">*</span>
                    </label>
                    <input
                      value={designPageId}
                      onChange={e => setDesignPageId(e.target.value)}
                      placeholder="e.g. YbcohnneHGj8YGoDIY4k"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                    />
                    <p className="text-xs text-gray-600 mt-1">From GHL → Funnels → Page URL → last segment</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Funnel ID <span className="text-red-400">*</span>
                      <span className="text-gray-600 ml-1">— from GHL URL: /funnels/<strong className="text-gray-400">THIS_ID</strong>/...</span>
                    </label>
                    <input
                      value={designFunnelId}
                      onChange={e => setDesignFunnelId(e.target.value)}
                      placeholder="e.g. abc123xyz"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Agent selector */}
                {agents.length > 0 && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      AI Agent Persona <span className="text-gray-600">(optional)</span>
                    </label>
                    <select
                      value={designAgent}
                      onChange={e => setDesignAgent(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">— Default (no persona) —</option>
                      {agents.map(a => (
                        <option key={a.id} value={a.id}>{a.emoji || '🤖'} {a.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Extra context */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Design Notes <span className="text-gray-600">(optional — describe the design, brand, or anything not obvious from the screenshot)</span>
                  </label>
                  <textarea
                    value={designContext}
                    onChange={e => setDesignContext(e.target.value)}
                    rows={2}
                    placeholder="e.g. This is a fitness coaching sales page. The blue is #1D4ED8. Replace placeholder images with fitness imagery."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={analyzing || !designFile}
                  className="w-full py-3 rounded-xl text-sm font-bold transition-all"
                  style={{
                    background: analyzing ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                    color: '#fff',
                    opacity: analyzing || !designFile ? 0.7 : 1,
                  }}
                >
                  {analyzing ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      Analyzing design with Claude Vision…
                    </span>
                  ) : '🎨 Analyze Design & Save to GHL'}
                </button>
              </form>
            )}

            {/* ── Full Funnel Mode ─────────────────────────────────────── */}
            {genMode === 'funnel' && (
              <form onSubmit={handleGenerateFunnel} className="space-y-4">
                <p className="text-xs text-gray-400">Select a funnel type and enter your Funnel ID. <span className="text-yellow-400 font-medium">Before generating: open each page in GHL's native builder at least once</span> — this initializes the page so native elements will display correctly.</p>

                {/* Funnel type grid */}
                <div>
                  <label className="block text-xs text-gray-400 mb-2">Funnel Type <span className="text-red-400">*</span></label>
                  <div className="grid grid-cols-2 gap-2">
                    {FUNNEL_TYPES.map(ft => (
                      <button
                        key={ft.key}
                        type="button"
                        onClick={() => setFunnelType(ft.key)}
                        className="text-left rounded-lg p-2.5 transition-all"
                        style={{
                          background: funnelType === ft.key ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${funnelType === ft.key ? 'rgba(99,102,241,0.7)' : 'rgba(255,255,255,0.08)'}`,
                        }}
                      >
                        <div className="text-base mb-0.5">{ft.emoji} <span className="text-xs font-semibold text-white">{ft.label}</span></div>
                        <div className="text-xs text-gray-500">{ft.desc}</div>
                      </button>
                    ))}
                  </div>

                  {/* Page preview */}
                  {funnelType && (() => {
                    const ft = FUNNEL_TYPES.find(f => f.key === funnelType);
                    return ft ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ft.pages.map((p, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' }}>
                            {i + 1}. {p}
                          </span>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">GHL Funnel ID <span className="text-red-400">*</span></label>
                  <input value={fullFunnelId} onChange={e => setFullFunnelId(e.target.value)} placeholder="e.g. abc123xyz" className="field w-full text-sm" />
                </div>

                <details className="group">
                  <summary className="cursor-pointer text-xs text-indigo-400 hover:text-indigo-300 select-none list-none flex items-center gap-1">
                    <span className="group-open:rotate-90 transition-transform inline-block">▶</span> Advanced Options (optional)
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Niche / Business</label>
                        <input value={niche} onChange={e => setNiche(e.target.value)} placeholder="e.g. Online fitness coaching" className="field w-full text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Offer</label>
                        <input value={offer} onChange={e => setOffer(e.target.value)} placeholder="e.g. 12-week transformation program" className="field w-full text-sm" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Target Audience</label>
                        <input value={audience} onChange={e => setAudience(e.target.value)} placeholder="e.g. Busy moms 30-50" className="field w-full text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Color Scheme</label>
                        <select value={colorPreset} onChange={e => setColorPreset(e.target.value)} className="field w-full text-sm">
                          {COLOR_PRESETS.map(p => <option key={p.label} value={p.value}>{p.label}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </details>

                <button type="submit" disabled={funnelRunning} className="w-full py-3 rounded-xl text-sm font-bold transition-all"
                  style={{ background: funnelRunning ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #6366f1, #4f46e5)', color: '#fff', opacity: funnelRunning ? 0.7 : 1 }}>
                  {funnelRunning
                    ? <span className="flex items-center justify-center gap-2"><span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />Generating all pages…</span>
                    : '🚀 Generate All Funnel Pages'}
                </button>

                {/* Needs pages instruction */}
                {needsPages && (
                  <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)' }}>
                    <p className="text-xs font-semibold text-yellow-400">⚠️ This funnel has no pages yet</p>
                    <p className="text-xs text-gray-400">Go to <strong className="text-white">GHL → Funnels → open your funnel</strong>, add these pages, then <strong className="text-white">open each page in the native builder once</strong> to initialize it. Then click Generate again:</p>
                    <div className="space-y-1 mt-1">
                      {needsPages.map((p, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="w-4 h-4 rounded-full text-center text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(251,191,36,0.2)', color: '#fbbf24' }}>{i + 1}</span>
                          <span className="text-white">{p.name}</span>
                          <span className="text-gray-500">— url: /{p.url}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Per-page progress */}
                {funnelPages.length > 0 && (
                  <div className="rounded-xl p-3 space-y-2 text-xs" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <p className="text-gray-400 font-medium mb-2">Pages ({funnelPages.filter(p => p.status === 'done').length}/{funnelPages.length} done)</p>
                    {funnelPages.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-2">
                        {p.status === 'pending' && <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />}
                        {p.status === 'running' && <span className="animate-spin w-3 h-3 border border-indigo-400 border-t-transparent rounded-full flex-shrink-0" />}
                        {p.status === 'done'    && <span className="text-emerald-400 flex-shrink-0">✓</span>}
                        {p.status === 'error'   && <span className="text-red-400 flex-shrink-0">✗</span>}
                        <span style={{ color: p.status === 'error' ? '#f87171' : p.status === 'done' ? '#6ee7b7' : p.status === 'running' ? '#a5b4fc' : '#6b7280' }}>
                          {i + 1}. {p.name}
                          {p.pageType && p.status !== 'pending' && <span className="ml-1 opacity-60">({p.pageType})</span>}
                          {p.status === 'done'  && <span className="ml-1 opacity-60">— {p.sectionsCount} sections</span>}
                          {p.status === 'error' && <span className="ml-1 opacity-60">— {p.error}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </form>
            )}

            {/* ── Text Brief Mode ──────────────────────────────────────── */}
            {genMode === 'text' && (

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
                    Funnel ID <span className="text-red-400">*</span>
                      <span className="text-gray-600 ml-1">— from GHL URL: /funnels/<strong className="text-gray-400">THIS_ID</strong>/steps/...</span>
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

              {/* Agent selector */}
              {agents.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    AI Agent Persona <span className="text-gray-600">(optional — applies agent's persona to generation)</span>
                  </label>
                  <select
                    value={selectedAgent}
                    onChange={e => setSelectedAgent(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">— Default (no persona) —</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.emoji || '🤖'} {a.name}{a.role ? ` · ${a.role}` : ''}
                      </option>
                    ))}
                  </select>
                  {selectedAgent && (() => {
                    const ag = agents.find(a => a.id === selectedAgent);
                    return ag?.persona ? (
                      <p className="text-xs text-gray-600 mt-1 truncate">{ag.persona}</p>
                    ) : null;
                  })()}
                </div>
              )}

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

              {/* Processing steps — always visible */}
              <div ref={stepsRef} className="mt-3 rounded-xl p-3 text-xs" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', minHeight: 40 }}>
                {genSteps.length === 0 ? (
                  <span className="text-gray-600">Processing steps will appear here when you click Generate…</span>
                ) : (
                  <div className="space-y-1.5">
                    {genSteps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2">
                        {step.status === 'running' && <span className="animate-spin inline-block w-3 h-3 border border-indigo-400 border-t-transparent rounded-full flex-shrink-0" />}
                        {step.status === 'done'    && <span className="text-emerald-400 flex-shrink-0">✓</span>}
                        {step.status === 'error'   && <span className="text-red-400 flex-shrink-0">✗</span>}
                        <span style={{ color: step.status === 'error' ? '#f87171' : step.status === 'done' ? '#6ee7b7' : '#a5b4fc' }}>{step.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </form>
            )}

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
                  {result.agentUsed && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">Agent used</span>
                      <span className="text-white">{result.agentUsed.emoji} {result.agentUsed.name}</span>
                    </div>
                  )}
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
  );
}
