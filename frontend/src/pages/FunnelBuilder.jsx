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
import { toast } from 'react-toastify';
import { useApp }              from '../context/AppContext';
import AuthGate                from '../components/AuthGate';
import Header                  from '../components/Header';
import Spinner                 from '../components/Spinner';
import { api }                 from '../lib/api';
import SelfImprovementPanel    from '../components/SelfImprovementPanel';

// ── helpers ───────────────────────────────────────────────────────────────────

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

  const [fbStatus,      setFbStatus]      = useState(null);
  const [fbLoading,     setFbLoading]     = useState(true);

  // Top-level builder mode: 'funnel' | 'email' | 'website'
  const [builderMode,   setBuilderMode]   = useState('funnel');

  // Tab: 'text' | 'design' | 'funnel'
  const [genMode,       setGenMode]       = useState('text');

  // Email campaign state
  const [emailName,     setEmailName]     = useState('');
  const [emailSubject,  setEmailSubject]  = useState('');
  const [emailType,     setEmailType]     = useState('promotional');
  const [emailNiche,    setEmailNiche]    = useState('');
  const [emailOffer,    setEmailOffer]    = useState('');
  const [emailAudience, setEmailAudience] = useState('');
  const [emailTone,     setEmailTone]     = useState('professional and warm');
  const [emailCtaText,  setEmailCtaText]  = useState('Get Started');
  const [emailCtaUrl,   setEmailCtaUrl]   = useState('');
  const [emailBrand,    setEmailBrand]    = useState('');
  const [emailGenerating, setEmailGenerating] = useState(false);
  const [emailResult,   setEmailResult]   = useState(null);
  const [emailLog,      setEmailLog]      = useState([]);
  const [figmaSpec,     setFigmaSpec]     = useState('');

  // Website builder state
  const [websites,        setWebsites]        = useState([]);
  const [websitesLoading, setWebsitesLoading] = useState(false);
  const [webWebsiteId,    setWebWebsiteId]    = useState('');
  const [webWebsiteName,  setWebWebsiteName]  = useState('');
  const [webPages,        setWebPages]        = useState([]);
  const [webPagesLoading, setWebPagesLoading] = useState(false);
  const [webPageId,       setWebPageId]       = useState('');
  const [webPageName,     setWebPageName]     = useState('');
  const [webPageType,     setWebPageType]     = useState('landing');
  const [webNiche,        setWebNiche]        = useState('');
  const [webOffer,        setWebOffer]        = useState('');
  const [webAudience,     setWebAudience]     = useState('');
  const [webBrand,        setWebBrand]        = useState('');
  const [webColorScheme,  setWebColorScheme]  = useState('');
  const [webNotes,        setWebNotes]        = useState('');
  const [webGenerating,   setWebGenerating]   = useState(false);
  const [webResult,       setWebResult]       = useState(null);
  const [webLog,          setWebLog]          = useState([]);

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

  // Vibe AI Studio state
  const [vibePrompt,      setVibePrompt]      = useState('');
  const [vibeFile,        setVibeFile]        = useState(null);
  const [vibePreview,     setVibePreview]     = useState(null);
  const [vibePageType,    setVibePageType]    = useState('funnel');
  const [vibeGenerating,  setVibeGenerating]  = useState(false);
  const [vibeProjectId,   setVibeProjectId]   = useState(null);
  const [vibeLog,         setVibeLog]         = useState([]);
  const [vibeDone,        setVibeDone]        = useState(false);
  const [vibeDragging,    setVibeDragging]    = useState(false);
  const vibeFileRef                           = useRef(null);

  const saveFigmaPat = async () => {
    if (!figmaPat.trim() || !apiKey) return;
    setFigmaPatSaving(true);
    try {
      await api.postWithKey('/funnel-builder/figma-token', { token: figmaPat.trim() }, apiKey);
      setFigmaConnected(true);
      setFigmaPatSaved(true);
      setFigmaPat('');  // clear input — token is stored server-side, no need to keep it in memory
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
        toast.success('Page Builder connected!');
        setToken('');
        await loadStatus();
      } else {
        toast.error(d.error || 'Connection failed.');
      }
    } catch (err) {
      toast.error(err.message || 'Connection failed.');
    }
    setConnecting(false);
  }

  function handleDisconnect() {
    toast(({ closeToast }) => (
      <div>
        <p style={{ margin: '0 0 10px', fontWeight: 500 }}>Disconnect the Firebase page builder token?</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={async () => { closeToast(); try { await api.deleteWithKey('/funnel-builder/connect', apiKey); toast.success('Disconnected.'); setFbStatus({ connected: false, expiresAt: null }); } catch (err) { toast.error(err.message); } }} style={{ background: '#dc2626', border: 'none', borderRadius: 6, color: '#fff', padding: '5px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Disconnect</button>
          <button onClick={closeToast} style={{ background: '#333', border: 'none', borderRadius: 6, color: '#e5e7eb', padding: '5px 12px', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
        </div>
      </div>
    ), { autoClose: false, closeOnClick: false, draggable: false });
  }

  function handleDesignFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      toast.error('Only PNG, JPG, WEBP, or GIF images are accepted.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be under 10 MB.');
      return;
    }
    setDesignFile(file);
    if (designPreview) URL.revokeObjectURL(designPreview);
    setDesignPreview(URL.createObjectURL(file));
    setResult(null);
  }

  async function handleAnalyzeDesign(e) {
    e.preventDefault();
    if (designMode === 'upload' && !designFile) { toast.error('Upload a design image first.'); return; }
    if (designMode === 'figma'  && !figmaUrl.trim()) { toast.error('Paste a Figma URL first.'); return; }
    if (designMode === 'figma'  && !figmaConnected) { toast.error('Enter your Figma Personal Access Token above.'); return; }
    if (!designFunnelId.trim()) { toast.error('Funnel ID is required.'); return; }

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
      toast.error('Location ID not found. Please refresh the page.');
      return;
    }

    setAnalyzing(true);
    setFunnelPages([]);
    setNeedsPages(null);
    setResult(null);
    setLogLines([]);

    try {
      const resp = await fetch(`/funnel-builder/generate-from-design`, {
        method:  'POST',
        headers: { 'x-location-id': locId },
        body:    formData,
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        if (errData.needsPages) {
          toast.error(errData.error || 'No pages in this funnel.');
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
            if (eventLine === 'log') {
              setLogLines(prev => [...prev, { msg: d.msg, level: d.level || 'info', ts: Date.now() }]);
            } else if (eventLine === 'error') {
              toast.error(d.error || 'Design analysis failed.');
            } else if (eventLine === 'start') {
              setFunnelPages(d.pages.map(p => ({ ...p, status: 'pending' })));
            } else if (eventLine === 'page_start') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: 'running', pageType: d.pageType } : p));
            } else if (eventLine === 'page_done') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: d.warning ? 'warn' : 'done', sectionsCount: d.sectionsCount, pageType: d.pageType, warning: d.warning } : p));
            } else if (eventLine === 'page_error') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: 'error', error: d.error } : p));
            } else if (eventLine === 'figma_spec') {
              if (d.spec) setFigmaSpec(d.spec);
            } else if (eventLine === 'complete') {
              toast.success(`Done! ${d.succeeded}/${d.total} pages generated.`, d.failed > 0 ? 'error' : 'success');
              if (d.previewUrl) window.open(d.previewUrl, '_blank');
            }
          } catch {}
        }
      }
    } catch (err) {
      toast.error(err.message || 'Analysis failed.');
    }
    setAnalyzing(false);
  }

  async function handleVibeGenerate(e) {
    e.preventDefault();
    if (!vibePrompt.trim()) { toast.error('Prompt is required.'); return; }

    const locId = locationId || localStorage.getItem('gtm_location_id') || '';
    if (!locId) { toast.error('Location ID not found. Please refresh the page.'); return; }

    setVibeGenerating(true);
    setVibeProjectId(null);
    setVibeDone(false);
    setVibeLog([]);

    const addLog = (msg, level = 'info') => setVibeLog(prev => [...prev, { msg, level, ts: Date.now() }]);

    try {
      let imageBase64 = null;
      let imageMediaType = null;
      if (vibeFile) {
        const buf = await vibeFile.arrayBuffer();
        imageBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        imageMediaType = vibeFile.type || 'image/png';
      }

      const resp = await fetch('/vibe-ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': locId },
        body: JSON.stringify({ prompt: vibePrompt.trim(), imageBase64, imageMediaType, pageType: vibePageType }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${resp.status}`);
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
          const dataLine = part.match(/^data: (.+)$/m)?.[1];
          if (!dataLine) continue;
          try {
            const d = JSON.parse(dataLine);
            if (d.event === 'log')     addLog(d.msg, d.level || 'info');
            if (d.event === 'created') { setVibeProjectId(d.projectId); addLog(`Project created: ${d.projectId}`, 'info'); }
            if (d.event === 'status')  addLog(`[${d.polls}/60] Status: ${d.state || 'processing'}`, 'info');
            if (d.event === 'done')    { setVibeDone(true); addLog('Generation complete!', 'success'); }
            if (d.event === 'error')   { addLog(d.error, 'error'); toast.error(d.error); }
          } catch {}
        }
      }
    } catch (err) {
      addLog(err.message, 'error');
      toast.error(err.message || 'Generation failed.');
    }
    setVibeGenerating(false);
  }

  async function handleGenerate(e) {
    e.preventDefault();
    if (!funnelId.trim()) { toast.error('Funnel ID is required.'); return; }
    if (!niche.trim())    { toast.error('Niche / Business is required.'); return; }
    if (!offer.trim())    { toast.error('Offer is required.'); return; }

    const colorScheme = colorPreset || customColor || COLOR_PRESETS[0].value;

    setGenerating(true);
    setFunnelPages([]);
    setNeedsPages(null);
    setResult(null);
    setLogLines([]);

    try {
      const res = await fetch('/funnel-builder/generate-funnel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
        body:    JSON.stringify({
          funnelId:    funnelId.trim(),
          funnelType:  'lead_gen',
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
            } else if (eventLine === 'error') {
              if (d.needsPages) setNeedsPages(d.pagesToCreate || []);
              else toast.error(d.error || 'Generation failed.');
            } else if (eventLine === 'start') {
              setFunnelPages(d.pages.map(p => ({ ...p, status: 'pending' })));
            } else if (eventLine === 'page_start') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: 'running', pageType: d.pageType } : p));
            } else if (eventLine === 'page_done') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: d.warning ? 'warn' : 'done', sectionsCount: d.sectionsCount, pageType: d.pageType, warning: d.warning } : p));
            } else if (eventLine === 'page_error') {
              setFunnelPages(prev => prev.map(p => p.id === d.pageId ? { ...p, status: 'error', error: d.error } : p));
            } else if (eventLine === 'complete') {
              toast.success(`Done! ${d.succeeded}/${d.total} pages generated.`, d.failed > 0 ? 'error' : 'success');
              if (d.previewUrl) window.open(d.previewUrl, '_blank');
            }
          } catch {}
        }
      }
    } catch (err) {
      toast.error(err.message || 'Generation failed.');
    }
    setGenerating(false);
  }

  // ── Email Campaign Generator ──────────────────────────────────────────────
  async function handleEmailGenerate(e) {
    e.preventDefault();
    if (!emailNiche.trim()) { toast.error('Niche/topic is required.'); return; }
    setEmailGenerating(true);
    setEmailResult(null);
    setEmailLog([]);

    try {
      const res = await fetch('/email-builder/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': apiKey },
        body: JSON.stringify({
          campaignName: emailName || emailNiche + ' Campaign',
          subject:      emailSubject,
          emailType,
          niche:        emailNiche,
          offer:        emailOffer,
          audience:     emailAudience,
          tone:         emailTone,
          ctaText:      emailCtaText,
          ctaUrl:       emailCtaUrl,
          brandName:    emailBrand,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || `Error ${res.status}`);
        setEmailGenerating(false);
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const evtLine  = part.match(/^event: (.+)$/m)?.[1];
          const dataLine = part.match(/^data: (.+)$/m)?.[1];
          if (!evtLine || !dataLine) continue;
          try {
            const d = JSON.parse(dataLine);
            if (evtLine === 'step')    { setEmailLog(l => [...l, { msg: d.label, level: 'info' }]); }
            if (evtLine === 'content') { setEmailLog(l => [...l, { msg: `Subject: ${d.subject}`, level: 'success' }]); }
            if (evtLine === 'done')    { setEmailResult(d); }
            if (evtLine === 'error')   { setEmailLog(l => [...l, { msg: `Error: ${d.error}`, level: 'error' }]); toast.error(d.error); }
          } catch {}
        }
      }
    } catch (err) {
      toast.error(err.message);
    }
    setEmailGenerating(false);
  }

  // ── Website Builder ───────────────────────────────────────────────────────
  async function loadWebsites() {
    setWebsitesLoading(true);
    try {
      const res = await fetch('/website-builder/websites', { headers: { 'x-location-id': apiKey } });
      const j = await res.json();
      setWebsites(j.websites || []);
      if ((j.websites || []).length === 0) toast.error('No websites found for this location.');
    } catch (err) {
      toast.error('Could not load websites: ' + err.message);
    }
    setWebsitesLoading(false);
  }

  async function loadWebPages(wsId) {
    if (!wsId) return;
    setWebPagesLoading(true);
    setWebPages([]);
    setWebPageId('');
    setWebPageName('');
    try {
      const res = await fetch(`/website-builder/pages?websiteId=${encodeURIComponent(wsId)}`, { headers: { 'x-location-id': apiKey } });
      const j = await res.json();
      if (!res.ok || !j.success) {
        toast.error(`Pages error: ${j.error || res.status}`);
      } else if ((j.pages || []).length === 0) {
        toast.warning('No pages found for this website. Create a blank page in GHL first.');
      }
      setWebPages(j.pages || []);
    } catch (err) {
      toast.error('Could not load pages: ' + err.message);
    }
    setWebPagesLoading(false);
  }

  async function handleWebGenerate(e) {
    e.preventDefault();
    if (!webNiche.trim() && !webOffer.trim()) { toast.error('Enter a niche or offer.'); return; }
    if (!webWebsiteId.trim()) { toast.error('Select a website first.'); return; }
    if (!webPageId.trim()) { toast.error('Select a page or paste a Page ID to write content to.'); return; }
    setWebGenerating(true);
    setWebResult(null);
    setWebLog([]);

    try {
      const resolvedPageName = webPageName || (webPages.find(p => p.id === webPageId)?.name)
        || (webPageType.charAt(0).toUpperCase() + webPageType.slice(1) + ' Page');
      const res = await fetch('/website-builder/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': apiKey },
        body: JSON.stringify({
          websiteId:   webWebsiteId,
          websiteName: webWebsiteName,
          pageId:      webPageId,
          pageName:    resolvedPageName,
          pageType:    webPageType,
          niche:       webNiche,
          offer:       webOffer,
          audience:    webAudience,
          brand:       webBrand,
          colorScheme: webColorScheme,
          extraNotes:  webNotes,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || `Error ${res.status}`);
        setWebGenerating(false);
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const evtLine  = part.match(/^event: (.+)$/m)?.[1];
          const dataLine = part.match(/^data: (.+)$/m)?.[1];
          if (!evtLine || !dataLine) continue;
          try {
            const d = JSON.parse(dataLine);
            if (evtLine === 'step')    { setWebLog(l => [...l, { msg: d.label, level: 'info' }]); }
            if (evtLine === 'log')     { setWebLog(l => [...l, { msg: d.msg, level: d.level || 'info' }]); }
            if (evtLine === 'content') { setWebLog(l => [...l, { msg: `Generated ${d.sections?.length || 0} sections`, level: 'success' }]); }
            if (evtLine === 'warn')    { setWebLog(l => [...l, { msg: d.message, level: 'warn' }]); }
            if (evtLine === 'done')    { setWebResult(d); }
            if (evtLine === 'error')   { setWebLog(l => [...l, { msg: `Error: ${d.error}`, level: 'error' }]); toast.error(d.error); }
          } catch {}
        }
      }
    } catch (err) {
      toast.error(err.message);
    }
    setWebGenerating(false);
  }

  // ── Full Funnel Generator ─────────────────────────────────────────────────
  async function handleGenerateFunnel(e) {
    e.preventDefault();
    if (!funnelType)          { toast.error('Please select a funnel type.'); return; }
    if (!fullFunnelId.trim()) { toast.error('Funnel ID is required.'); return; }

    setFunnelRunning(true);
    setFunnelPages([]);
    setNeedsPages(null);
    setLogLines([]);
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
              toast.success(`Done! ${d.succeeded}/${d.total} pages generated.`, d.failed > 0 ? 'error' : 'success');
              if (d.previewUrl) window.open(d.previewUrl, '_blank');
            }
          } catch {}
        }
      }
    } catch (err) {
      toast.error(err.message || 'Funnel generation failed.');
    }
    setFunnelRunning(false);
  }

  // ── render ───────────────────────────────────────────────────────────────────

  if (isAuthLoading) return <Spinner />;
  if (!isAuthenticated) return <AuthGate icon="🏗️" title="Native Funnel Builder" />;

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white overflow-hidden">
        <Header icon="🏗️" title="Native Builder" subtitle="AI-powered GHL funnel pages, email campaigns & websites" />

        {/* Builder mode switcher */}
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 flex-wrap" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.2)' }}>
          {[
            { key: 'funnel',  label: '🏗️ Funnel Builder' },
            { key: 'email',   label: '📧 Email Campaign' },
            { key: 'website', label: '🌐 Website Builder' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setBuilderMode(key)}
              className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: builderMode === key ? '#4f46e5' : 'rgba(255,255,255,0.05)',
                color:      builderMode === key ? '#fff'    : '#9ca3af',
                border: `1px solid ${builderMode === key ? '#4f46e5' : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              {label}
            </button>
          ))}
          <span className="text-xs text-gray-600 ml-1">
            {builderMode === 'email' ? 'AI generates native GHL email template → saved as draft'
              : builderMode === 'website' ? 'AI generates website page copy → creates page in GHL'
              : 'AI generates native GHL funnel pages'}
          </span>
        </div>


        <div className="flex-1 overflow-y-auto p-4 max-w-4xl mx-auto w-full">

          {/* ── EMAIL CAMPAIGN MODE ───────────────────────────────────────── */}
          {builderMode === 'email' && (
            <div className="space-y-5">
              {/* Step 1: Connect (same as funnel) */}
              <section className="glass rounded-xl p-5">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center" style={{ background: fbStatus?.connected ? '#14532d' : '#1e3a5f' }}>1</span>
                  Connect GHL Builder
                  {fbStatus?.connected && <span className="ml-2 text-xs text-green-400 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" />Connected</span>}
                </h2>
                {!fbStatus?.connected && (
                  <p className="text-xs text-gray-400">Connect your GHL Firebase token in the Funnel Builder tab first, then come back here to generate email campaigns.</p>
                )}
                {fbStatus?.connected && <p className="text-xs text-green-600">Firebase token active — ready to create email templates.</p>}
              </section>

              {/* Step 2: Email Campaign Form */}
              <section
                className="glass rounded-xl p-5"
                style={{ opacity: fbStatus?.connected ? 1 : 0.45, pointerEvents: fbStatus?.connected ? 'auto' : 'none' }}
              >
                <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
                  <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center" style={{ background: '#1e3a5f' }}>2</span>
                  📧 Generate Email Campaign
                </h2>

                <form onSubmit={handleEmailGenerate} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Campaign Name</label>
                      <input value={emailName} onChange={e => setEmailName(e.target.value)} placeholder="e.g. Summer Promo Launch" className="field w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Brand Name</label>
                      <input value={emailBrand} onChange={e => setEmailBrand(e.target.value)} placeholder="e.g. FitLife Co." className="field w-full text-sm" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Niche / Topic <span className="text-red-500">*</span></label>
                    <input value={emailNiche} onChange={e => setEmailNiche(e.target.value)} placeholder="e.g. fitness coaching, SaaS onboarding" className="field w-full text-sm" />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Subject Line Hint</label>
                    <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="AI will refine this — or leave blank" className="field w-full text-sm" />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Email Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { key: 'promotional',  label: '🎯 Promotional' },
                        { key: 'welcome',      label: '👋 Welcome' },
                        { key: 'newsletter',   label: '📰 Newsletter' },
                        { key: 'followup',     label: '🔁 Follow-up' },
                        { key: 'reengagement', label: '💤 Re-engagement' },
                        { key: 'announcement', label: '📢 Announcement' },
                      ].map(t => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setEmailType(t.key)}
                          className="text-xs py-2 rounded-xl transition-all"
                          style={{
                            background: emailType === t.key ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${emailType === t.key ? 'rgba(99,102,241,0.55)' : 'rgba(255,255,255,0.06)'}`,
                            color: emailType === t.key ? '#a5b4fc' : '#9ca3af',
                          }}
                        >{t.label}</button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Offer / Product</label>
                      <input value={emailOffer} onChange={e => setEmailOffer(e.target.value)} placeholder="e.g. 12-week program" className="field w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Target Audience</label>
                      <input value={emailAudience} onChange={e => setEmailAudience(e.target.value)} placeholder="e.g. women 30-45" className="field w-full text-sm" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">CTA Button Text</label>
                      <input value={emailCtaText} onChange={e => setEmailCtaText(e.target.value)} placeholder="Get Started" className="field w-full text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">CTA URL</label>
                      <input value={emailCtaUrl} onChange={e => setEmailCtaUrl(e.target.value)} placeholder="https://…" className="field w-full text-sm" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Tone</label>
                    <select value={emailTone} onChange={e => setEmailTone(e.target.value)} className="field w-full text-sm">
                      {['professional and warm','direct and urgent','friendly and casual','authoritative and educational','empathetic and motivational'].map(t => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={emailGenerating || !emailNiche.trim()}
                    className="btn-primary w-full py-3 text-sm"
                  >
                    {emailGenerating ? '⏳ Generating email…' : '📧 Generate Email Campaign Draft'}
                  </button>
                </form>

                {/* Live log */}
                {emailLog.length > 0 && (
                  <div className="mt-4 rounded-xl p-3 space-y-1" style={{ background: 'rgba(0,0,0,0.3)', fontFamily: 'monospace' }}>
                    {emailLog.map((l, i) => (
                      <p key={i} className="text-xs" style={{ color: l.level === 'success' ? '#6ee7b7' : l.level === 'error' ? '#f87171' : '#9ca3af' }}>
                        {l.level === 'success' ? '✓' : l.level === 'error' ? '✗' : '›'} {l.msg}
                      </p>
                    ))}
                  </div>
                )}

                {/* Result */}
                {emailResult && (
                  <div className="mt-4 rounded-xl p-4 space-y-3" style={{
                    background: emailResult.success ? 'rgba(16,185,129,0.07)' : 'rgba(251,191,36,0.07)',
                    border: `1px solid ${emailResult.success ? 'rgba(16,185,129,0.2)' : 'rgba(251,191,36,0.2)'}`,
                  }}>
                    <p className="text-sm font-semibold" style={{ color: emailResult.success ? '#6ee7b7' : '#fbbf24' }}>
                      {emailResult.success ? '✅ Email draft created in GHL!' : '⚠️ Email content generated — GHL save failed'}
                    </p>

                    {emailResult.subject && (
                      <p className="text-gray-300 text-xs"><span className="text-gray-500">Subject: </span>{emailResult.subject || emailResult.content?.subject}</p>
                    )}

                    {emailResult.editUrl && (
                      <a href={emailResult.editUrl} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 text-xs font-medium">
                        ↗ Open in GHL Email Builder
                      </a>
                    )}

                    {!emailResult.success && emailResult.needsReinstall && (
                      <div className="mt-2 p-3 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                        <p className="text-xs text-red-400 font-semibold mb-1">Action required: Reinstall the app</p>
                        <p className="text-xs text-gray-400">The <code className="text-yellow-300">emails/builder.write</code> scope was added recently. Go to your GHL marketplace, uninstall and reinstall the GTM AI Toolkit app, then try again.</p>
                      </div>
                    )}

                    {!emailResult.success && emailResult.templateJson && (
                      <button
                        onClick={() => { navigator.clipboard.writeText(JSON.stringify(emailResult.templateJson, null, 2)); toast.success('Template JSON copied!'); }}
                        className="mt-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                        style={{ background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.4)' }}>
                        📋 Copy Template JSON
                      </button>
                    )}

                    {emailResult.content && (
                      <div className="mt-2 p-3 rounded-lg text-xs space-y-1" style={{ background: 'rgba(0,0,0,0.3)' }}>
                        <p className="text-white font-semibold">{emailResult.content.headline}</p>
                        <p className="text-gray-400 line-clamp-3">{emailResult.content.body?.split('\n')[0]}</p>
                      </div>
                    )}
                  </div>
                )}
                {/* Auto-improve email copy */}
                {emailResult?.content && (emailResult.content.headline || emailResult.content.body) && (
                  <SelfImprovementPanel
                    type="funnel_page"
                    artifact={[
                      emailResult.content.subject  && `Subject: ${emailResult.content.subject}`,
                      emailResult.content.headline && `Headline: ${emailResult.content.headline}`,
                      emailResult.content.body,
                    ].filter(Boolean).join('\n\n')}
                    context={{ niche: emailNiche, offer: emailOffer, audience: emailAudience }}
                    label="Email Copy"
                    autoStart={true}
                    continuous={true}
                    onApply={(improved) => setEmailResult(r => ({ ...r, content: { ...r.content, body: improved } }))}
                  />
                )}
              </section>
            </div>
          )}

          {/* ── FUNNEL BUILDER MODE ───────────────────────────────────────── */}
          {builderMode === 'funnel' && <>


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
  const post=(t,src)=>{console.log('[GHL Connect] Trying token from:',src,'length:',t.length,'prefix:',t.slice(0,30));return fetch(SERVER+'/funnel-builder/connect',{method:'POST',headers:{'Content-Type':'application/json','x-location-id':LOC},body:JSON.stringify({refreshedToken:t})}).then(r=>r.json()).then(d=>{console.log('[GHL Connect] Server response:',d);if(d.success)toast.success('Connected! Go back to your app.');else toast.error('❌ '+(d.error||JSON.stringify(d)));});};
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
  toast.error('No Firebase token found. Make sure you are logged in to GHL first.');
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
                  { key: 'vibe',   label: '✨ AI Studio' },
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
                  Upload a design screenshot or paste a Figma link to generate native GHL funnel pages from your design.
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
                    {/* PAT — show connected badge when saved, input only when not yet connected */}
                    {figmaConnected ? (
                      <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}>
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-400" />
                          <span className="text-xs font-medium text-green-400">Figma PAT connected</span>
                          <span className="text-xs text-gray-500">— stored securely per location</span>
                        </div>
                        <button type="button" onClick={clearFigmaPat}
                          className="text-xs text-gray-400 hover:text-red-400 transition-colors">Disconnect</button>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Figma Personal Access Token{' '}
                          <a href="https://www.figma.com/settings" target="_blank" rel="noreferrer" className="text-indigo-400 underline">Get one here</a>
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={figmaPat}
                            onChange={e => setFigmaPat(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveFigmaPat()}
                            placeholder="figd_xxxxxxxxxxxxxxxxxxxx"
                            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
                          />
                          <button type="button" onClick={saveFigmaPat} disabled={!figmaPat.trim() || figmaPatSaving}
                            className="text-xs font-semibold px-4 py-2 rounded-lg whitespace-nowrap transition-colors"
                            style={{ background: figmaPatSaving ? '#374151' : '#4f46e5', color: '#fff', opacity: !figmaPat.trim() ? 0.5 : 1 }}>
                            {figmaPatSaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                        <p className="text-xs text-gray-600 mt-1">Figma → Settings → Security → Personal access tokens → Generate new token</p>
                      </div>
                    )}

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
                      <span>Paste a link to a single frame <em>or</em> a file with multiple frames — each frame maps to one funnel page. Images are fetched from Figma, uploaded to your GHL media library, and injected as real image blocks. Text, colors, backgrounds, and layout are all reconstructed as native GHL sections.</span>
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

                {/* Inline live log */}
                {logLines.length > 0 && (
                  <div className="rounded-xl p-3" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Generation Log</p>
                      {funnelRunning && (
                        <span className="flex items-center gap-1.5 text-xs text-indigo-400">
                          <span className="animate-spin w-3 h-3 border border-indigo-400 border-t-transparent rounded-full" />
                          Running…
                        </span>
                      )}
                    </div>
                    <div
                      ref={logRef}
                      className="rounded-lg overflow-y-auto text-xs font-mono space-y-0.5"
                      style={{ background: 'rgba(0,0,0,0.5)', padding: '10px 12px', maxHeight: '220px', border: '1px solid rgba(255,255,255,0.04)' }}
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
                      {funnelRunning && (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="animate-pulse" style={{ color: '#6b7280' }}>›</span>
                          <span className="animate-pulse" style={{ color: '#4b5563' }}>_</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </form>
            )}

            {/* ── Text Brief Mode ──────────────────────────────────────── */}
            {genMode === 'text' && (

            <form onSubmit={handleGenerate} className="space-y-4">

              {/* Lead gen funnel badge */}
              <div className="rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}>
                <span className="text-indigo-400 text-sm">📋</span>
                <div>
                  <p className="text-xs font-semibold text-indigo-300">Lead Gen Funnel — 2 pages</p>
                  <p className="text-xs text-gray-500">Generates: <strong className="text-gray-400">1. Opt-in Page</strong> (TOFU) → <strong className="text-gray-400">2. Thank You Page</strong> (BOFU)</p>
                </div>
              </div>

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
                <p className="text-xs text-gray-600 mt-1">The funnel must have 2 blank pages already created in GHL (any name).</p>
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
                    Generating Opt-in + Thank You pages…
                  </span>
                ) : '📋 Generate Lead Gen Funnel'}
              </button>

              {/* Needs pages instruction */}
              {needsPages && (
                <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)' }}>
                  <p className="text-xs font-semibold text-yellow-400">⚠️ This funnel has no pages yet</p>
                  <p className="text-xs text-gray-400">
                    Go to <strong className="text-white">GHL → Funnels → open your funnel</strong> and add <strong className="text-white">2 blank steps</strong>:
                  </p>
                  <div className="text-xs text-gray-300 space-y-0.5 pl-2">
                    <p>1. <strong>Opt-in Page</strong> — any name, any URL slug</p>
                    <p>2. <strong>Thank You Page</strong> — any name, any URL slug</p>
                  </div>
                  <p className="text-xs text-gray-500">Then click Generate again — the system will fill both pages automatically.</p>
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

            {/* ── Vibe AI Studio Mode ───────────────────────────────────── */}
            {genMode === 'vibe' && (
              <form onSubmit={handleVibeGenerate} className="space-y-4">
                <div className="rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)' }}>
                  <span className="text-purple-400 text-sm">✨</span>
                  <div>
                    <p className="text-xs font-semibold text-purple-300">GHL Native AI Studio</p>
                    <p className="text-xs text-gray-500">Builds a funnel or website using GHL's own AI builder — result appears directly in your GHL account.</p>
                  </div>
                </div>

                {/* Page type */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Type</label>
                  <div className="flex rounded-lg overflow-hidden border border-gray-700">
                    {[['funnel','🚀 Funnel'],['website','🌐 Website']].map(([t, label]) => (
                      <button key={t} type="button"
                        onClick={() => setVibePageType(t)}
                        className="flex-1 text-xs py-2 font-medium transition-colors"
                        style={{ background: vibePageType === t ? '#7c3aed' : 'rgba(255,255,255,0.03)', color: vibePageType === t ? '#fff' : '#9ca3af' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Prompt */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Prompt <span className="text-red-400">*</span></label>
                  <textarea
                    value={vibePrompt}
                    onChange={e => setVibePrompt(e.target.value)}
                    rows={4}
                    placeholder="Describe what you want to build — niche, offer, audience, style, colors, sections..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 resize-none"
                  />
                </div>

                {/* Optional image upload */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Reference Design <span className="text-gray-600">(optional)</span></label>
                  <div
                    className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors"
                    style={{ borderColor: vibeDragging ? '#7c3aed' : 'rgba(255,255,255,0.1)', background: vibeDragging ? 'rgba(139,92,246,0.07)' : 'rgba(0,0,0,0.2)' }}
                    onClick={() => vibeFileRef.current?.click()}
                    onDragOver={ev => { ev.preventDefault(); setVibeDragging(true); }}
                    onDragLeave={() => setVibeDragging(false)}
                    onDrop={ev => {
                      ev.preventDefault(); setVibeDragging(false);
                      const f = ev.dataTransfer.files[0];
                      if (f && f.type.startsWith('image/')) {
                        setVibeFile(f);
                        setVibePreview(URL.createObjectURL(f));
                      }
                    }}
                  >
                    {vibePreview ? (
                      <div className="relative">
                        <img src={vibePreview} alt="preview" className="max-h-32 mx-auto rounded object-contain" />
                        <button type="button" className="absolute top-0 right-0 text-gray-400 hover:text-white text-xs px-1"
                          onClick={ev => { ev.stopPropagation(); setVibeFile(null); setVibePreview(null); }}>✕</button>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">Drag & drop or click to upload a design screenshot</p>
                    )}
                  </div>
                  <input ref={vibeFileRef} type="file" accept="image/*" className="hidden"
                    onChange={ev => {
                      const f = ev.target.files[0];
                      if (f) { setVibeFile(f); setVibePreview(URL.createObjectURL(f)); }
                    }} />
                </div>

                <button
                  type="submit"
                  disabled={vibeGenerating}
                  className="w-full py-3 rounded-xl text-sm font-bold transition-all"
                  style={{
                    background: vibeGenerating ? 'rgba(139,92,246,0.3)' : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                    color: '#fff',
                    opacity: vibeGenerating ? 0.7 : 1,
                  }}
                >
                  {vibeGenerating ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      Building with AI Studio…
                    </span>
                  ) : '✨ Generate with GHL AI Studio'}
                </button>

                {/* Log */}
                {vibeLog.length > 0 && (
                  <div className="rounded-lg overflow-y-auto text-xs font-mono space-y-0.5"
                    style={{ background: 'rgba(0,0,0,0.5)', padding: '10px 12px', maxHeight: '200px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    {vibeLog.map((l, i) => (
                      <div key={i} className="flex items-start gap-2 leading-5">
                        <span style={{ flexShrink: 0, color: l.level === 'success' ? '#6ee7b7' : l.level === 'error' ? '#f87171' : '#6b7280' }}>
                          {l.level === 'success' ? '✓' : l.level === 'error' ? '✗' : '›'}
                        </span>
                        <span style={{ color: l.level === 'success' ? '#a7f3d0' : l.level === 'error' ? '#fca5a5' : '#9ca3af' }}>{l.msg}</span>
                      </div>
                    ))}
                    {vibeGenerating && <div className="flex items-center gap-2 mt-1"><span className="animate-pulse text-gray-600">›</span><span className="animate-pulse text-gray-700">_</span></div>}
                  </div>
                )}

                {/* Done */}
                {vibeDone && vibeProjectId && (
                  <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)' }}>
                    <p className="text-xs font-semibold text-emerald-400">✓ Generation complete!</p>
                    <p className="text-xs text-gray-400">Your project is ready in GHL's AI Studio (Vibe section).</p>
                    <a
                      href={`${appDomain}/v2/location/${locationId}/vibe`}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-center py-2 rounded-lg text-xs font-semibold transition-all"
                      style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff' }}
                    >
                      Open in GHL AI Studio →
                    </a>
                    <p className="text-xs text-gray-600 text-center">Project ID: {vibeProjectId}</p>
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
                {(generating || funnelRunning || analyzing) && (
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
                {(generating || funnelRunning || analyzing) && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="animate-pulse" style={{ color: '#6b7280' }}>›</span>
                    <span className="animate-pulse" style={{ color: '#4b5563' }}>_</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Auto-improve funnel copy after generation ────────────── */}
          {!generating && !analyzing && funnelPages.some(p => p.status === 'done') && (niche || offer) && (
            <section className="glass rounded-xl p-5 mb-5">
              <SelfImprovementPanel
                type="funnel_page"
                artifact={[
                  niche  && `Business / Niche: ${niche}`,
                  offer  && `Offer: ${offer}`,
                  audience && `Audience: ${audience}`,
                  ...funnelPages.filter(p => p.status === 'done').map(p => `Page: ${p.name}${p.pageType ? ` (${p.pageType})` : ''}`),
                  figmaSpec && `\nDesign spec:\n${figmaSpec.slice(0, 1200)}`,
                ].filter(Boolean).join('\n')}
                context={{ niche, offer, audience: audience || undefined, figmaSpec: figmaSpec || undefined }}
                label="Funnel Copy"
                autoStart={true}
                continuous={true}
              />
            </section>
          )}

          {/* ── Result (legacy — kept for type safety) ──────────────────── */}
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
                      toast.success('Copied!');
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

          </> /* end builderMode === 'funnel' */}

          {/* ── WEBSITE BUILDER MODE ──────────────────────────────────────── */}
          {builderMode === 'website' && (
            <div className="space-y-5">

              {/* Step 1: Pick website */}
              <section className="glass rounded-xl p-5">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center" style={{ background: '#1e3a5f' }}>1</span>
                  Select Website & Page
                </h2>

                {/* Website picker */}
                <div className="flex gap-2 items-end mb-3">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1">GHL Website</label>
                    <select
                      value={webWebsiteId}
                      onChange={e => {
                        const w = websites.find(x => x.id === e.target.value);
                        setWebWebsiteId(e.target.value);
                        setWebWebsiteName(w?.name || '');
                        setWebPages([]);
                        setWebPageId('');
                        setWebPageName('');
                        if (e.target.value) loadWebPages(e.target.value);
                      }}
                      className="w-full rounded-lg px-3 py-2 text-sm text-white"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                    >
                      <option value="">— select a website —</option>
                      {websites.map(w => (
                        <option key={w.id} value={w.id}>{w.name || w.title || w.id}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={loadWebsites}
                    disabled={websitesLoading}
                    className="px-4 py-2 rounded-lg text-xs font-medium text-white"
                    style={{ background: '#1e3a5f', border: '1px solid rgba(99,102,241,0.3)', whiteSpace: 'nowrap' }}
                  >
                    {websitesLoading ? '⏳ Loading…' : '↻ Load Websites'}
                  </button>
                </div>

                {/* Page picker — shown once a website is selected */}
                {webWebsiteId && (
                  <div className="mt-3 space-y-3">
                    <label className="block text-xs text-gray-400">Select page to write content to <span className="text-red-400">*</span></label>

                    {/* Dropdown — try loading via backend API */}
                    <div className="flex gap-2 items-center">
                      <select
                        value={webPageId}
                        onChange={e => {
                          const p = webPages.find(x => x.id === e.target.value);
                          setWebPageId(e.target.value);
                          setWebPageName(p?.name || '');
                        }}
                        className="flex-1 rounded-lg px-3 py-2 text-sm text-white"
                        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                      >
                        <option value="">{webPages.length ? '— select a page —' : '— click ↻ to load pages —'}</option>
                        {webPages.map(p => (
                          <option key={p.id} value={p.id}>{p.name || p.title || p.url || p.id}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => loadWebPages(webWebsiteId)}
                        disabled={webPagesLoading}
                        title="Load pages from this website"
                        className="px-3 py-2 rounded-lg text-xs font-medium text-white"
                        style={{ background: '#1e3a5f', border: '1px solid rgba(99,102,241,0.3)', whiteSpace: 'nowrap' }}
                      >
                        {webPagesLoading ? '⏳' : '↻ Load'}
                      </button>
                    </div>

                    {/* Manual page ID — always visible */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Or paste Page ID from GHL URL
                        <span className="text-gray-600 ml-1">— open the page in GHL editor, copy the ID from: <code className="text-yellow-400">/page-builder/<strong>VNF7fG84...</strong>?source=website</code></span>
                      </label>
                      <input
                        value={webPages.find(p => p.id === webPageId) ? '' : webPageId}
                        onChange={e => { setWebPageId(e.target.value.trim()); setWebPageName(''); }}
                        placeholder="e.g. VNF7fG84sJv2nsY0m771"
                        className="w-full rounded-lg px-3 py-2 text-sm text-white font-mono"
                        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                      />
                    </div>

                    {webPageId
                      ? <p className="text-xs text-green-500">✓ Writing to: <span className="text-green-400 font-medium">{webPageName || webPageId}</span></p>
                      : <p className="text-xs text-amber-400">⚠ Select a page or paste a page ID to save content. Page must already exist in GHL.</p>
                    }
                  </div>
                )}

                {!webWebsiteId && (
                  <p className="text-xs text-gray-500 mt-1">Select a website above, then choose or paste a page ID.</p>
                )}
              </section>

              {/* Step 2: Page details form */}
              <section className="glass rounded-xl p-5">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
                  <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center" style={{ background: '#1e3a5f' }}>2</span>
                  Page Details
                </h2>
                <form onSubmit={handleWebGenerate} className="space-y-4">

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Page Name Override <span className="text-gray-600">(optional — defaults to selected page name)</span></label>
                    <input
                      value={webPageName}
                      onChange={e => setWebPageName(e.target.value)}
                      placeholder={webPages.find(p => p.id === webPageId)?.name || 'e.g. Home Page'}
                      className="w-full rounded-lg px-3 py-2 text-sm text-white"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-2">Page Type</label>
                    <div className="grid grid-cols-5 gap-2">
                      {[
                        { v: 'home',      l: '🏠 Home' },
                        { v: 'landing',   l: '🎯 Landing' },
                        { v: 'about',     l: '👤 About' },
                        { v: 'services',  l: '⚙️ Services' },
                        { v: 'pricing',   l: '💰 Pricing' },
                        { v: 'contact',   l: '📞 Contact' },
                        { v: 'portfolio', l: '🖼️ Portfolio' },
                        { v: 'faq',       l: '❓ FAQ' },
                        { v: 'blog',      l: '📝 Blog' },
                        { v: 'custom',    l: '✏️ Custom' },
                      ].map(({ v, l }) => (
                        <button
                          key={v} type="button"
                          onClick={() => setWebPageType(v)}
                          className="py-2 px-1 rounded-lg text-xs font-medium text-center transition-all"
                          style={{
                            background: webPageType === v ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${webPageType === v ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
                            color: webPageType === v ? '#a5b4fc' : '#6b7280',
                          }}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Business / Niche <span className="text-red-400">*</span></label>
                      <input
                        value={webNiche}
                        onChange={e => setWebNiche(e.target.value)}
                        placeholder="e.g. Online fitness coaching"
                        className="w-full rounded-lg px-3 py-2 text-sm text-white"
                        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Brand / Business Name</label>
                      <input
                        value={webBrand}
                        onChange={e => setWebBrand(e.target.value)}
                        placeholder="e.g. FitPro Elite"
                        className="w-full rounded-lg px-3 py-2 text-sm text-white"
                        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Offer / Service</label>
                    <input
                      value={webOffer}
                      onChange={e => setWebOffer(e.target.value)}
                      placeholder="e.g. 12-week 1-on-1 coaching program for busy professionals"
                      className="w-full rounded-lg px-3 py-2 text-sm text-white"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Target Audience</label>
                      <input
                        value={webAudience}
                        onChange={e => setWebAudience(e.target.value)}
                        placeholder="e.g. Busy professionals 35-55"
                        className="w-full rounded-lg px-3 py-2 text-sm text-white"
                        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Color Scheme</label>
                      <input
                        value={webColorScheme}
                        onChange={e => setWebColorScheme(e.target.value)}
                        placeholder="e.g. dark navy & gold, clean white"
                        className="w-full rounded-lg px-3 py-2 text-sm text-white"
                        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Extra Notes / Tone</label>
                    <textarea
                      value={webNotes}
                      onChange={e => setWebNotes(e.target.value)}
                      placeholder="Any specific messaging, tone, sections you want, or content to include…"
                      rows={2}
                      className="w-full rounded-lg px-3 py-2 text-sm text-white resize-none"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={webGenerating}
                    className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all"
                    style={{ background: webGenerating ? '#374151' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', cursor: webGenerating ? 'not-allowed' : 'pointer' }}
                  >
                    {webGenerating ? '⏳ Generating page…' : '🌐 Generate Website Page'}
                  </button>
                </form>

                {/* Log */}
                {webLog.length > 0 && (
                  <div className="mt-4 rounded-xl p-3 space-y-1" style={{ background: 'rgba(0,0,0,0.3)', fontFamily: 'monospace' }}>
                    {webLog.map((l, i) => (
                      <p key={i} className="text-xs" style={{ color: l.level === 'success' ? '#6ee7b7' : l.level === 'error' ? '#f87171' : l.level === 'warn' ? '#fbbf24' : '#9ca3af' }}>
                        {l.level === 'success' ? '✓' : l.level === 'error' ? '✗' : l.level === 'warn' ? '⚠' : '›'} {l.msg}
                      </p>
                    ))}
                  </div>
                )}

                {/* Result */}
                {webResult && (
                  <div className="mt-4 rounded-xl p-4 space-y-4" style={{
                    background: webResult.success ? 'rgba(16,185,129,0.07)' : 'rgba(99,102,241,0.07)',
                    border: `1px solid ${webResult.success ? 'rgba(16,185,129,0.2)' : 'rgba(99,102,241,0.2)'}`,
                  }}>
                    <p className="text-sm font-semibold" style={{ color: webResult.success ? '#6ee7b7' : '#a5b4fc' }}>
                      {webResult.success && !webResult.partial
                        ? `✅ "${webResult.pageName}" written to GHL with native sections!`
                        : webResult.success && webResult.partial
                        ? `⚠️ "${webResult.pageName}" — sections partially saved (check logs)`
                        : `✍️ Page copy generated — content not saved`}
                    </p>

                    {webResult.editUrl && (
                      <a href={webResult.editUrl} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 text-xs font-medium">
                        ↗ Open in GHL Website Builder
                      </a>
                    )}

                    {webResult.needsReinstall && (
                      <div className="p-3 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                        <p className="text-xs text-red-400 font-semibold mb-1">Action required: Reinstall the app</p>
                        <p className="text-xs text-gray-400">The <code className="text-yellow-300">websites.write</code> scope was added recently. Reinstall the GTM AI Toolkit to grant it, then retry.</p>
                      </div>
                    )}

                    {/* AI-generated sections preview */}
                    {webResult.content?.sections && (
                      <div className="space-y-3">
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Generated Page Sections</p>
                        {webResult.content.sections.map((s, i) => {
                          const children = s.children || [];
                          const headline  = children.find(c => c.type === 'headline' || c.type === 'heading');
                          const sub       = children.find(c => c.type === 'sub-heading');
                          const para      = children.find(c => c.type === 'paragraph');
                          const bullets   = children.find(c => c.type === 'bulletList');
                          const btn       = children.find(c => c.type === 'button');
                          return (
                          <div key={i} className="p-3 rounded-lg" style={{ background: 'rgba(0,0,0,0.3)' }}>
                            <p className="text-xs text-indigo-400 font-semibold uppercase mb-1">{s.name || `Section ${i + 1}`}</p>
                            {headline && <p className="text-sm text-white font-semibold mb-1">{headline.text}</p>}
                            {sub      && <p className="text-xs text-gray-400 mb-2">{sub.text}</p>}
                            {para     && <p className="text-xs text-gray-400 line-clamp-3">{para.text?.replace(/<[^>]+>/g, '')}</p>}
                            {bullets?.items && (
                              <ul className="mt-2 space-y-0.5">
                                {bullets.items.slice(0, 3).map((b, j) => <li key={j} className="text-xs text-gray-400">• {b}</li>)}
                              </ul>
                            )}
                            {btn && (
                              <span className="mt-2 inline-block px-3 py-1 rounded text-xs font-medium text-white" style={{ background: btn.styles?.backgroundColor?.value || '#6366f1' }}>
                                {btn.text}
                              </span>
                            )}
                          </div>
                          );
                        })}

                        {webResult.content?.seoTitle && (
                          <div className="p-3 rounded-lg" style={{ background: 'rgba(0,0,0,0.3)' }}>
                            <p className="text-xs text-indigo-400 font-semibold uppercase mb-1">SEO</p>
                            <p className="text-xs text-gray-300 font-medium">{webResult.content.seoTitle}</p>
                            <p className="text-xs text-gray-500 mt-1">{webResult.content.metaDescription}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          )} {/* end builderMode === 'website' */}

        </div>
      </div>
  );
}
