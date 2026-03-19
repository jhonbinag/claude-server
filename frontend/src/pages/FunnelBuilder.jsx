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
  const [funnelId,      setFunnelId]      = useState('');
  const [niche,         setNiche]         = useState('');
  const [offer,         setOffer]         = useState('');
  const [audience,      setAudience]      = useState('');
  const [colorPreset,   setColorPreset]   = useState(COLOR_PRESETS[0].value);
  const [customColor,   setCustomColor]   = useState('');
  const [extraContext,  setExtraContext]  = useState('');
  const [generating,    setGenerating]    = useState(false);
  const [result,        setResult]        = useState(null);
  const [logLines,      setLogLines]      = useState([]);  // live progress log
  const logRef                            = useRef(null);

  // Full funnel mode
  const [fullFunnelId,  setFullFunnelId]  = useState('');
  const [funnelType,    setFunnelType]    = useState('');
  const [funnelPages,   setFunnelPages]   = useState([]); // [{ id, name, pageType, status, sectionsCount, error }]
  const [funnelRunning, setFunnelRunning] = useState(false);
  const [needsPages,    setNeedsPages]    = useState(null); // { pagesToCreate: [...] }

  // Design upload mode
  const [designFile,    setDesignFile]    = useState(null);   // File object
  const [designPreview, setDesignPreview] = useState(null);   // object URL
  const [designFunnelId,setDesignFunnelId]= useState('');
  const [designContext, setDesignContext] = useState('');
  const [designAgent,   setDesignAgent]   = useState('');
  const [designDragging,setDesignDragging]= useState(false);
  const [analyzing,     setAnalyzing]     = useState(false);
  const [designMode,      setDesignMode]      = useState('upload'); // 'upload' | 'figma'
  const [figmaUrl,        setFigmaUrl]        = useState('');
  const [figmaConnected,  setFigmaConnected]  = useState(false);
  const fileInputRef                          = useRef(null);

  const [figmaPat,        setFigmaPat]        = useState('');
  const [figmaPatSaving,  setFigmaPatSaving]  = useState(false);
  const [figmaPatSaved,   setFigmaPatSaved]   = useState(false);

  const saveFigmaPat = async (val) => {
    setFigmaPat(val);
    if (!val || !apiKey) return;
    setFigmaPatSaving(true);
    setFigmaPatSaved(false);
    try {
      await api.postWithKey('/funnel-builder/figma-token', { token: val }, apiKey);
      setFigmaConnected(true);
      setFigmaPatSaved(true);
      setTimeout(() => setFigmaPatSaved(false), 3000);
    } catch { /* non-fatal */ }
    finally { setFigmaPatSaving(false); }
  };

  const clearFigmaPat = async () => {
    setFigmaPat('');
    setFigmaConnected(false);
    if (!apiKey) return;
    try { await api.deleteWithKey('/funnel-builder/figma-token', apiKey); } catch { /* non-fatal */ }
  };

  // Agent selector
  const [agents,        setAgents]        = useState([]);
  const [selectedAgent, setSelectedAgent] = useState('');

  // User's own AI API key — persisted to Redis + Firebase via backend
  const [aiApiKey,     setAiApiKey]     = useState('');
  const [aiKeySaving,  setAiKeySaving]  = useState(false);
  const [aiKeySaved,   setAiKeySaved]   = useState(false);

  const detectProvider = (key) => {
    if (!key) return null;
    if (key.startsWith('sk-ant-')) return { name: 'Claude (Anthropic)', header: 'x-anthropic-api-key', color: '#6d28d9', link: 'https://console.anthropic.com/account/keys' };
    if (key.startsWith('sk-') && !key.startsWith('sk-ant-')) return { name: 'OpenAI (GPT-4o)', header: 'x-openai-api-key', color: '#065f46', link: 'https://platform.openai.com/api-keys' };
    if (key.startsWith('gsk_')) return { name: 'Groq', header: 'x-groq-api-key', color: '#92400e', link: 'https://console.groq.com/keys' };
    if (key.startsWith('AIza')) return { name: 'Google Gemini', header: 'x-google-api-key', color: '#1e3a5f', link: 'https://aistudio.google.com/app/apikey' };
    return { name: 'Unknown', header: null, color: '#374151', link: null };
  };
  const detectedProvider = detectProvider(aiApiKey);
  const aiKeyHeaders = (detectedProvider?.header && aiApiKey)
    ? { [detectedProvider.header]: aiApiKey }
    : {};

  const saveAiApiKey = async (key) => {
    setAiApiKey(key);
    if (!key || !apiKey) return;
    setAiKeySaving(true);
    setAiKeySaved(false);
    try {
      await api.postWithKey('/funnel-builder/ai-key', { key }, apiKey);
      setAiKeySaved(true);
      setTimeout(() => setAiKeySaved(false), 3000);
    } catch { /* non-fatal */ }
    finally { setAiKeySaving(false); }
  };

  const clearAiApiKey = async () => {
    setAiApiKey('');
    if (!apiKey) return;
    try { await api.deleteWithKey('/funnel-builder/ai-key', apiKey); } catch { /* non-fatal */ }
  };

  // Detect the white-label GHL domain from the iframe parent referrer
  const appDomain = (() => {
    try {
      const ref = document.referrer;
      if (ref) return new URL(ref).origin;
    } catch {}
    return 'https://app.gohighlevel.com';
  })();

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

  // Re-check status whenever the user switches back to this tab (e.g. after running the console snippet in GHL)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') loadStatus(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadStatus]);

  useEffect(() => {
    if (!apiKey) return;
    api.getWithKey('/agent/agents', apiKey)
      .then(d => { if (d.success) setAgents(d.data || []); })
      .catch(() => {});
  }, [apiKey]);

  // Load stored AI key + Figma token from backend on mount
  useEffect(() => {
    if (!apiKey) return;
    api.getWithKey('/funnel-builder/ai-key', apiKey)
      .then(d => { if (d.key) setAiApiKey(d.key); })
      .catch(() => {});
    api.getWithKey('/funnel-builder/figma-token', apiKey)
      .then(d => { if (d.connected) { setFigmaConnected(true); setFigmaPat(d.token || '●●●●●●●●'); } })
      .catch(() => {});
  }, [apiKey]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

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
    if (designMode === 'upload' && !designFile) { toast(setToastState, 'Upload a design image first.', 'error'); return; }
    if (designMode === 'figma'  && !figmaUrl.trim()) { toast(setToastState, 'Paste a Figma URL first.', 'error'); return; }
    if (designMode === 'figma'  && !figmaConnected) { toast(setToastState, 'Enter your Figma Personal Access Token above.', 'error'); return; }
    if (!designFunnelId.trim()) { toast(setToastState, 'Funnel ID is required.', 'error'); return; }

    const colorScheme = colorPreset || customColor || COLOR_PRESETS[0].value;
    const formData = new FormData();
    formData.append('funnelId', designFunnelId.trim());
    formData.append('colorScheme', colorScheme);
    if (designMode === 'upload') formData.append('image', designFile);
    if (designMode === 'figma')  formData.append('figmaUrl', figmaUrl.trim());
    if (designContext.trim()) formData.append('extraContext', designContext.trim());
    if (designAgent)          formData.append('agentId', designAgent);

    const locId = locationId || localStorage.getItem('gtm_location_id') || '';
    if (!locId) {
      toast(setToastState, 'Location ID not found. Please refresh the page.', 'error');
      return;
    }

    setAnalyzing(true);
    setFunnelPages([]);
    setNeedsPages(null);
    setResult(null);

    try {
      const resp = await fetch(`/funnel-builder/generate-from-design`, {
        method:  'POST',
        headers: { 'x-location-id': locId, ...aiKeyHeaders },
        body:    formData,
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        if (errData.needsPages) {
          toast(setToastState, errData.error || 'No pages in this funnel.', 'error');
          setAnalyzing(false);
          return;
        }
        throw new Error(errData.error || `Server error ${resp.status}`);
      }

      const reader  = resp.body.getReader();
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
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: d.warning ? 'warn' : 'done', sectionsCount: d.sectionsCount, pageType: d.pageType, warning: d.warning } : p));
            } else if (eventLine === 'page_error') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: 'error', error: d.error } : p));
            } else if (eventLine === 'complete') {
              toast(setToastState, `Done! ${d.succeeded}/${d.total} pages generated.`, d.failed > 0 ? 'error' : 'success');
              if (d.previewUrl) window.open(d.previewUrl, '_blank');
            }
          } catch {}
        }
      }
    } catch (err) {
      toast(setToastState, err.message || 'Analysis failed.', 'error');
    }
    setAnalyzing(false);
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (!funnelId.trim()) { toast(setToastState, 'Funnel ID is required.', 'error'); return; }
    if (!niche.trim())    { toast(setToastState, 'Niche / Business is required.', 'error'); return; }
    if (!offer.trim())    { toast(setToastState, 'Offer is required.', 'error'); return; }

    const colorScheme = colorPreset || customColor || COLOR_PRESETS[0].value;

    setGenerating(true);
    setFunnelPages([]);
    setNeedsPages(null);
    setResult(null);
    setLogLines([]);

    try {
      const res = await fetch('/funnel-builder/generate-funnel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': locationId, ...aiKeyHeaders },
        body:    JSON.stringify({
          funnelId:    funnelId.trim(),
          niche:       niche.trim(),
          offer:       offer.trim(),
          audience:    audience.trim() || undefined,
          colorScheme,
          extraContext: extraContext.trim() || undefined,
          agentId:     selectedAgent || undefined,
          appDomain,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        if (errData.needsPages && errData.pagesToCreate) {
          setNeedsPages(errData.pagesToCreate);
          setGenerating(false);
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
            if (eventLine === 'log') {
              setLogLines(prev => [...prev, { msg: d.msg, level: d.level || 'info', ts: Date.now() }]);
            } else if (eventLine === 'start') {
              setFunnelPages(d.pages.map(p => ({ ...p, status: 'pending' })));
            } else if (eventLine === 'page_start') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: 'running', pageType: d.pageType } : p));
            } else if (eventLine === 'page_done') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: d.warning ? 'warn' : 'done', sectionsCount: d.sectionsCount, pageType: d.pageType, warning: d.warning } : p));
            } else if (eventLine === 'page_error') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: 'error', error: d.error } : p));
            } else if (eventLine === 'complete') {
              toast(setToastState, `Done! ${d.succeeded}/${d.total} pages generated.`, d.failed > 0 ? 'error' : 'success');
              if (d.previewUrl) window.open(d.previewUrl, '_blank');
            }
          } catch {}
        }
      }
    } catch (err) {
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
    setLogLines([]);
    const colorScheme = colorPreset || customColor || COLOR_PRESETS[0].value;

    try {
      const res = await fetch('/funnel-builder/generate-funnel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': locationId, ...aiKeyHeaders },
        body:    JSON.stringify({
          funnelId:    fullFunnelId.trim(),
          funnelType:  funnelType || undefined,
          niche:       niche.trim(),
          offer:       offer.trim(),
          audience:    audience.trim() || undefined,
          colorScheme,
          extraContext: extraContext.trim() || undefined,
          agentId:     selectedAgent || undefined,
          appDomain,
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
            if (eventLine === 'log') {
              setLogLines(prev => [...prev, { msg: d.msg, level: d.level || 'info', ts: Date.now() }]);
            } else if (eventLine === 'start') {
              setFunnelPages(d.pages.map(p => ({ ...p, status: 'pending' })));
            } else if (eventLine === 'page_start') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: 'running', pageType: d.pageType } : p));
            } else if (eventLine === 'page_done') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: d.warning ? 'warn' : 'done', sectionsCount: d.sectionsCount, pageType: d.pageType, warning: d.warning } : p));
            } else if (eventLine === 'page_error') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: 'error', error: d.error } : p));
            } else if (eventLine === 'complete') {
              toast(setToastState, `Done! ${d.succeeded}/${d.total} pages generated.`, d.failed > 0 ? 'error' : 'success');
              if (d.previewUrl) window.open(d.previewUrl, '_blank');
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

          {/* ── AI API Key ───────────────────────────────────────────────── */}
          <section className="glass rounded-xl p-5 mb-5">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
              <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center"
                style={{ background: detectedProvider ? '#14532d' : '#1e3a5f' }}>🔑</span>
              Your AI API Key
              {detectedProvider && detectedProvider.name !== 'Unknown' && (
                <span className="text-xs font-normal px-2 py-0.5 rounded-full text-white" style={{ background: detectedProvider.color }}>
                  {detectedProvider.name}
                </span>
              )}
              {aiApiKey && detectedProvider?.name === 'Unknown' && (
                <span className="text-yellow-400 text-xs font-normal">⚠ unrecognized key format</span>
              )}
              {aiKeySaved && <span className="text-green-400 text-xs font-normal">● saved</span>}
              {aiKeySaving && <span className="text-gray-400 text-xs font-normal">saving…</span>}
            </h2>

            {/* Supported providers list */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {[
                { name: 'Claude (Anthropic)', prefix: 'sk-ant-...', color: '#6d28d9', link: 'https://console.anthropic.com/account/keys' },
                { name: 'OpenAI (GPT-4o)',    prefix: 'sk-...',     color: '#065f46', link: 'https://platform.openai.com/api-keys' },
                { name: 'Groq',               prefix: 'gsk_...',    color: '#92400e', link: 'https://console.groq.com/keys' },
                { name: 'Google Gemini',       prefix: 'AIza...',    color: '#1e3a5f', link: 'https://aistudio.google.com/app/apikey' },
              ].map(p => (
                <a key={p.name} href={p.link} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-white hover:opacity-80 transition-opacity"
                  style={{ background: p.color + '33', border: `1px solid ${p.color}55` }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
                  <span className="font-medium">{p.name}</span>
                  <span className="text-gray-400 font-mono ml-auto">{p.prefix}</span>
                </a>
              ))}
            </div>
            <p className="text-xs text-gray-400 mb-2">
              Enter your API key — auto-detected by prefix. Saved securely to your account (Redis + Firebase encrypted).
            </p>

            <div className="flex gap-2">
              <input
                type="password"
                placeholder="sk-ant-... / sk-... / gsk_... / AIza..."
                value={aiApiKey}
                onChange={e => saveAiApiKey(e.target.value)}
                className="field flex-1 text-sm font-mono"
                autoComplete="off"
              />
              {aiApiKey && (
                <button type="button" onClick={clearAiApiKey}
                  className="btn-secondary text-xs px-3">Clear</button>
              )}
            </div>
          </section>

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
                  <span className={`w-2 h-2 rounded-full ${fbStatus.expired ? 'bg-yellow-400' : 'bg-green-400'}`} />
                  <span className={`text-xs ${fbStatus.expired ? 'text-yellow-400' : 'text-green-400'}`}>
                    {fbStatus.expired ? 'Token expired' : 'Connected'}
                  </span>
                  {fbStatus.expiresAt && !fbStatus.expired && (
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

            {fbStatus?.connected && fbStatus?.expired && (
              <p className="text-xs text-yellow-400 mb-3">
                Your Firebase session expired. Run the snippet again in GHL to reconnect with a fresh token.
              </p>
            )}

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
  const SERVER='${serverUrl}',LOC='${locId}';
  const post=(t,src)=>{console.log('[GHL Connect] Trying token from:',src,'length:',t.length,'prefix:',t.slice(0,30));return fetch(SERVER+'/funnel-builder/connect',{method:'POST',headers:{'Content-Type':'application/json','x-location-id':LOC},body:JSON.stringify({refreshedToken:t})}).then(r=>r.json()).then(d=>{console.log('[GHL Connect] Server response:',d);if(d.success)alert('✅ Connected! Go back to your app.');else alert('❌ '+(d.error||JSON.stringify(d)));});};
  // 1st: Firebase refresh token from IndexedDB (Firebase v9+ — never expires, best option)
  try{
    const db=await new Promise((res,rej)=>{const r=indexedDB.open('firebaseLocalStorageDb');r.onsuccess=e=>res(e.target.result);r.onerror=()=>rej(r.error);});
    const rows=await new Promise((res,rej)=>{const tx=db.transaction('firebaseLocalStorage','readonly');const req=tx.objectStore('firebaseLocalStorage').getAll();req.onsuccess=e=>res(e.target.result||[]);req.onerror=()=>res([]);});
    console.log('[GHL Connect] IndexedDB rows:',rows.length);
    const stm=rows.find(r=>r?.value?.stsTokenManager)?.value?.stsTokenManager;
    console.log('[GHL Connect] IndexedDB stsTokenManager:',stm?{hasRefresh:!!stm.refreshToken,hasAccess:!!stm.accessToken,exp:stm.expirationTime}:'not found');
    if(stm?.refreshToken){return post(stm.refreshToken,'IndexedDB refreshToken');}
    if(stm?.accessToken){return post(stm.accessToken,'IndexedDB accessToken');}
  }catch(e){console.warn('[GHL Connect] IndexedDB failed:',e);}
  // 2nd: Firebase auth from localStorage (Firebase v8)
  const lsKey=Object.keys(localStorage).find(k=>k.startsWith('firebase:authUser:'));
  const lsStm=lsKey?JSON.parse(localStorage.getItem(lsKey)||'null')?.stsTokenManager:null;
  console.log('[GHL Connect] localStorage stsTokenManager:',lsStm?{hasRefresh:!!lsStm.refreshToken,hasAccess:!!lsStm.accessToken}:'not found');
  if(lsStm?.refreshToken){return post(lsStm.refreshToken,'localStorage refreshToken');}
  if(lsStm?.accessToken){return post(lsStm.accessToken,'localStorage accessToken');}
  // 3rd: GHL refreshedToken (last resort — may be expired)
  const rt=localStorage.getItem('refreshedToken');
  console.log('[GHL Connect] refreshedToken:',rt?'found (length '+rt.length+')':'not found');
  if(rt){return post(rt,'GHL refreshedToken');}
  alert('❌ No Firebase token found. Make sure you are logged in to GHL first.');
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
                          <p className="text-xs text-gray-500 mt-1">
                            You'll see a ✅ popup when connected. Then{' '}
                            <button
                              type="button"
                              onClick={loadStatus}
                              className="text-indigo-400 underline hover:text-indigo-300"
                            >click here to refresh</button>
                            {' '}or switch back to this tab — it checks automatically.
                          </p>
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
                {fbStatus.canRefresh
                  ? 'Firebase token is active and will auto-refresh before expiry.'
                  : <span>Firebase token is active but <strong className="text-yellow-400">cannot auto-refresh</strong> — it will expire in ~1 hour. Re-run the snippet to get a long-lived token (make sure <code className="text-green-400">refreshedToken</code> exists in GHL localStorage).</span>
                }
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
                  Analyze a Figma link or upload a screenshot — AI Vision will extract all elements, text, images, and colors and recreate them as native GHL sections.
                </p>

                {/* Mode toggle */}
                <div className="flex rounded-lg overflow-hidden border border-gray-700">
                  {[['upload','📷 Upload Image'],['figma','🎨 Figma Link']].map(([m, label]) => (
                    <button key={m} type="button"
                      onClick={() => setDesignMode(m)}
                      className="flex-1 text-xs py-2 font-medium transition-colors"
                      style={{ background: designMode === m ? '#4f46e5' : 'rgba(255,255,255,0.03)', color: designMode === m ? '#fff' : '#9ca3af' }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Upload mode */}
                {designMode === 'upload' && (<>
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
                    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden" onChange={e => handleDesignFile(e.target.files[0])} />
                    {designPreview ? (
                      <div className="relative">
                        <img src={designPreview} alt="Design preview" className="w-full rounded-xl object-contain max-h-96" />
                        <div className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-all rounded-xl flex items-center justify-center opacity-0 hover:opacity-100">
                          <span className="text-white text-xs font-medium bg-black/60 px-3 py-1.5 rounded-lg">Click to replace</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 py-8">
                        <span className="text-3xl">🖼️</span>
                        <p className="text-xs text-gray-400 text-center">
                          Drag & drop your design screenshot here<br />
                          <span className="text-gray-600">or click to browse · PNG, JPG, WEBP up to 10 MB</span>
                        </p>
                      </div>
                    )}
                  </div>
                  {designFile && (
                    <p className="text-xs text-gray-500">
                      {designFile.name} · {(designFile.size / 1024).toFixed(0)} KB
                      <button type="button" onClick={() => { setDesignFile(null); setDesignPreview(null); }}
                        className="ml-2 text-red-400 hover:text-red-300">Remove</button>
                    </p>
                  )}
                </>)}

                {/* Figma Link mode */}
                {designMode === 'figma' && (
                  <div className="space-y-3">
                    {/* PAT input */}
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Figma Personal Access Token{' '}
                        <a href="https://www.figma.com/settings" target="_blank" rel="noreferrer" className="text-indigo-400 underline">Get one here</a>
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={figmaPat}
                          onChange={e => saveFigmaPat(e.target.value)}
                          placeholder="figd_xxxxxxxxxxxxxxxxxxxx"
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                        />
                        {figmaConnected && (
                          <button type="button" onClick={clearFigmaPat}
                            className="btn-secondary text-xs px-3 py-1.5 whitespace-nowrap">Clear</button>
                        )}
                      </div>
                      <p className="text-xs mt-1" style={{ color: figmaPatSaved ? '#34d399' : figmaPatSaving ? '#6b7280' : '#6b7280' }}>
                        {figmaPatSaved ? '✓ Token saved' : figmaPatSaving ? 'Saving…' : figmaConnected ? '✓ Token saved' : 'Figma → Settings → Security → Personal access tokens → Generate'}
                      </p>
                    </div>

                    {/* Figma URL input */}
                    {figmaConnected && (
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Figma Frame URL <span className="text-red-400">*</span>
                        </label>
                        <input
                          value={figmaUrl}
                          onChange={e => setFigmaUrl(e.target.value)}
                          placeholder="https://www.figma.com/design/abc123/My-Design?node-id=1-2"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                        />
                        <p className="text-xs text-gray-600 mt-1">Right-click any frame in Figma → Copy link to selection → paste here</p>
                      </div>
                    )}

                    <div className="rounded-lg px-3 py-2 text-xs text-indigo-300 flex gap-2" style={{ background: 'rgba(99,102,241,0.08)' }}>
                      <span>ℹ️</span>
                      <span>We export your Figma frame as PNG and extract all text + colors — then reconstruct them as native GHL sections.</span>
                    </div>
                  </div>
                )}

                {/* Funnel ID */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Funnel ID <span className="text-red-400">*</span>
                    <span className="text-gray-600 ml-1">— from GHL URL: /funnels/<strong className="text-gray-400">THIS_ID</strong>/steps/...</span>
                  </label>
                  <input
                    value={designFunnelId}
                    onChange={e => setDesignFunnelId(e.target.value)}
                    placeholder="e.g. abc123xyz"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-xs text-gray-600 mt-1">AI will apply this design to all pages in the funnel.</p>
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
                  disabled={analyzing || (designMode === 'upload' ? !designFile : !figmaUrl.trim() || !figmaConnected)}
                  className="w-full py-3 rounded-xl text-sm font-bold transition-all"
                  style={{
                    background: analyzing ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                    color: '#fff',
                    opacity: analyzing || (designMode === 'upload' ? !designFile : !figmaUrl.trim() || !figmaConnected) ? 0.7 : 1,
                  }}
                >
                  {analyzing ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      Analyzing design with Claude Vision…
                    </span>
                  ) : '🎨 Analyze Design & Save All Pages'}
                </button>

                {/* Per-page progress */}
                {funnelPages.length > 0 && (
                  <div className="rounded-xl p-3 space-y-2 text-xs" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <p className="text-gray-400 font-medium mb-2">Pages ({funnelPages.filter(p => p.status === 'done').length}/{funnelPages.length} done)</p>
                    {funnelPages.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-2">
                        {p.status === 'pending' && <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />}
                        {p.status === 'pending' && <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />}
                        {p.status === 'running' && <span className="animate-spin w-3 h-3 border border-indigo-400 border-t-transparent rounded-full flex-shrink-0" />}
                        {p.status === 'done'    && <span className="text-emerald-400 flex-shrink-0">✓</span>}
                        {p.status === 'warn'    && <span className="text-yellow-400 flex-shrink-0">⚠</span>}
                        {p.status === 'error'   && <span className="text-red-400 flex-shrink-0">✗</span>}
                        <span style={{ color: p.status === 'error' ? '#f87171' : p.status === 'warn' ? '#fbbf24' : p.status === 'done' ? '#6ee7b7' : p.status === 'running' ? '#a5b4fc' : '#6b7280' }}>
                          {i + 1}. {p.name}
                          {p.pageType && p.status !== 'pending' && <span className="ml-1 opacity-60">({p.pageType})</span>}
                          {(p.status === 'done' || p.status === 'warn') && <span className="ml-1 opacity-60">— {p.sectionsCount} sections</span>}
                          {p.status === 'warn'  && <span className="ml-1 opacity-60">— ⚠ Firestore update failed (token may lack GHL claims). Reconnect &amp; regenerate.</span>}
                          {p.status === 'error' && <span className="ml-1 opacity-60">— {p.error}</span>}
                        </span>
                        {p.status === 'warn' && p.warning && (
                          <div className="w-full mt-1 ml-5 text-yellow-300 opacity-70" style={{ fontSize: '10px', wordBreak: 'break-all' }}>{p.warning}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
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
                        {p.status === 'pending' && <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />}
                        {p.status === 'running' && <span className="animate-spin w-3 h-3 border border-indigo-400 border-t-transparent rounded-full flex-shrink-0" />}
                        {p.status === 'done'    && <span className="text-emerald-400 flex-shrink-0">✓</span>}
                        {p.status === 'warn'    && <span className="text-yellow-400 flex-shrink-0">⚠</span>}
                        {p.status === 'error'   && <span className="text-red-400 flex-shrink-0">✗</span>}
                        <span style={{ color: p.status === 'error' ? '#f87171' : p.status === 'warn' ? '#fbbf24' : p.status === 'done' ? '#6ee7b7' : p.status === 'running' ? '#a5b4fc' : '#6b7280' }}>
                          {i + 1}. {p.name}
                          {p.pageType && p.status !== 'pending' && <span className="ml-1 opacity-60">({p.pageType})</span>}
                          {(p.status === 'done' || p.status === 'warn') && <span className="ml-1 opacity-60">— {p.sectionsCount} sections</span>}
                          {p.status === 'warn'  && <span className="ml-1 opacity-60">— ⚠ Firestore update failed (token may lack GHL claims). Reconnect &amp; regenerate.</span>}
                          {p.status === 'error' && <span className="ml-1 opacity-60">— {p.error}</span>}
                        </span>
                        {p.status === 'warn' && p.warning && (
                          <div className="w-full mt-1 ml-5 text-yellow-300 opacity-70" style={{ fontSize: '10px', wordBreak: 'break-all' }}>{p.warning}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </form>
            )}

            {/* ── Text Brief Mode ──────────────────────────────────────── */}
            {genMode === 'text' && (

            <form onSubmit={handleGenerate} className="space-y-4">

              {/* Funnel ID */}
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
                <p className="text-xs text-gray-600 mt-1">AI will auto-generate all pages in this funnel from your brief.</p>
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
                    Generating all pages…
                  </span>
                ) : '🏗️ Generate All Funnel Pages'}
              </button>

              {/* Needs pages instruction */}
              {needsPages && (
                <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)' }}>
                  <p className="text-xs font-semibold text-yellow-400">⚠️ This funnel has no pages yet</p>
                  <p className="text-xs text-gray-400">Go to <strong className="text-white">GHL → Funnels → open your funnel</strong>, add pages, then <strong className="text-white">open each in the native builder once</strong> to initialize it. Then click Generate again.</p>
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
                      {p.status === 'warn'    && <span className="text-yellow-400 flex-shrink-0">⚠</span>}
                      {p.status === 'error'   && <span className="text-red-400 flex-shrink-0">✗</span>}
                      <span style={{ color: p.status === 'error' ? '#f87171' : p.status === 'warn' ? '#fbbf24' : p.status === 'done' ? '#6ee7b7' : p.status === 'running' ? '#a5b4fc' : '#6b7280' }}>
                        {i + 1}. {p.name}
                        {p.pageType && p.status !== 'pending' && <span className="ml-1 opacity-60">({p.pageType})</span>}
                        {(p.status === 'done' || p.status === 'warn') && <span className="ml-1 opacity-60">— {p.sectionsCount} sections</span>}
                        {p.status === 'warn'  && <span className="ml-1 opacity-60">— ⚠ Firestore update failed (token may lack GHL claims). Reconnect &amp; regenerate.</span>}
                        {p.status === 'error' && <span className="ml-1 opacity-60">— {p.error}</span>}
                      </span>
                      {p.status === 'warn' && p.warning && (
                        <div className="w-full mt-1 ml-5 text-yellow-300 opacity-70" style={{ fontSize: '10px', wordBreak: 'break-all' }}>{p.warning}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </form>
            )}

          </section>

          {/* ── Live Generation Log ─────────────────────────────────────── */}
          {logLines.length > 0 && (
            <section className="glass rounded-xl p-4 mb-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Generation Log</p>
                {(generating || funnelRunning) && (
                  <span className="flex items-center gap-1.5 text-xs text-indigo-400">
                    <span className="animate-spin w-3 h-3 border border-indigo-400 border-t-transparent rounded-full" />
                    Running…
                  </span>
                )}
              </div>
              <div
                ref={logRef}
                className="rounded-lg overflow-y-auto text-xs font-mono space-y-0.5"
                style={{ background: 'rgba(0,0,0,0.5)', padding: '10px 12px', maxHeight: '220px', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                {logLines.map((l, i) => (
                  <div key={i} className="flex items-start gap-2 leading-5">
                    <span style={{ flexShrink: 0, color: l.level === 'success' ? '#6ee7b7' : l.level === 'error' ? '#f87171' : l.level === 'warn' ? '#fbbf24' : '#6b7280' }}>
                      {l.level === 'success' ? '✓' : l.level === 'error' ? '✗' : l.level === 'warn' ? '⚠' : '›'}
                    </span>
                    <span style={{ color: l.level === 'success' ? '#a7f3d0' : l.level === 'error' ? '#fca5a5' : l.level === 'warn' ? '#fde68a' : '#9ca3af' }}>
                      {l.msg}
                    </span>
                  </div>
                ))}
                {(generating || funnelRunning) && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="animate-pulse" style={{ color: '#6b7280' }}>›</span>
                    <span className="animate-pulse" style={{ color: '#4b5563' }}>_</span>
                  </div>
                )}
              </div>
            </section>
          )}

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
