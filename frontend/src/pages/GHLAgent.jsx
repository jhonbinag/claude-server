/**
 * GHLAgent.jsx
 *
 * Bridge between our AI copy generation and GHL Agent Studio.
 * 1. User fills in funnel details
 * 2. Claude generates a rich structured agent prompt
 * 3. User can edit the prompt
 * 4. "Execute Agent" sends it to the GHL Agent Studio webhook
 */

import { useState } from 'react';
import { Link }     from 'react-router-dom';
import { useApp }   from '../context/AppContext';
import AuthGate     from '../components/AuthGate';
import Header       from '../components/Header';
import Spinner      from '../components/Spinner';

const FUNNEL_TYPES = [
  'Sales Funnel', 'Webinar Funnel', 'Lead Gen / Squeeze',
  'Tripwire Funnel', 'Product Launch', 'Free Trial / SaaS',
  'Membership Funnel', 'Application Funnel', 'VSL Funnel',
];

const PAGE_OPTIONS = [
  'Opt-in Page', 'Sales Page', 'Order Page', 'Upsell Page',
  'Thank You Page', 'Webinar Registration', 'Webinar Confirmation',
  'VSL Page', 'Application Page', 'Booking Page', 'Bridge Page',
];

export default function GHLAgent() {
  const { isAuthenticated, isAuthLoading, locationId, integrations } = useApp();

  // Form inputs
  const [niche,        setNiche]        = useState('');
  const [offer,        setOffer]        = useState('');
  const [audience,     setAudience]     = useState('');
  const [funnelType,   setFunnelType]   = useState('Sales Funnel');
  const [pages,        setPages]        = useState(['Opt-in Page', 'Sales Page', 'Thank You Page']);
  const [extraContext, setExtraContext] = useState('');

  // Generated brief
  const [brief,        setBrief]        = useState('');
  const [generating,   setGenerating]   = useState(false);
  const [executing,    setExecuting]    = useState(false);
  const [status,       setStatus]       = useState(null); // { type: 'success'|'error', msg }

  const agentConfigured = (integrations || []).some(i => i.key === 'ghl_agent' && i.enabled);

  function togglePage(page) {
    setPages(prev =>
      prev.includes(page) ? prev.filter(p => p !== page) : [...prev, page]
    );
  }

  async function generate() {
    if (!niche.trim() || !offer.trim()) return;
    setGenerating(true);
    setBrief('');
    setStatus(null);
    try {
      const res  = await fetch('/agent/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
        body:    JSON.stringify({ niche, offer, audience, funnelType, pages, extraContext }),
      });
      const data = await res.json();
      if (data.success) setBrief(data.brief);
      else setStatus({ type: 'error', msg: data.error || 'Generation failed.' });
    } catch (err) {
      setStatus({ type: 'error', msg: err.message });
    } finally {
      setGenerating(false);
    }
  }

  async function execute() {
    if (!brief.trim()) return;
    setExecuting(true);
    setStatus(null);
    try {
      const res  = await fetch('/agent/execute', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
        body:    JSON.stringify({
          brief,
          metadata: { niche, offer, audience, funnelType, pages },
        }),
      });
      const data = await res.json();
      if (data.success) setStatus({ type: 'success', msg: data.message });
      else setStatus({ type: 'error', msg: data.error || 'Execution failed.' });
    } catch (err) {
      setStatus({ type: 'error', msg: err.message });
    } finally {
      setExecuting(false);
    }
  }

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🤖" title="GHL Agent Builder" subtitle="Connect your API key to use GHL Agent Studio">
      <Link to="/" className="block text-center text-xs text-gray-500 mt-4 hover:text-gray-300">← Back</Link>
    </AuthGate>
  );

  return (
    <div className="flex flex-col" style={{ height: '100%', background: '#0f0f13' }}>
      <Header icon="🤖" title="GHL Agent Builder" subtitle="Generate a brief → Execute in GHL Agent Studio" />

      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>

        {/* ── Left: Inputs ── */}
        <div className="flex-shrink-0 flex flex-col overflow-y-auto p-5 gap-4"
          style={{ width: 340, borderRight: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Funnel Details</p>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Niche / Business *</label>
                <input value={niche} onChange={e => setNiche(e.target.value)}
                  placeholder="e.g. fitness coaching, real estate, SaaS"
                  className="field text-xs w-full" />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Offer / Product *</label>
                <input value={offer} onChange={e => setOffer(e.target.value)}
                  placeholder="e.g. 12-week body transformation, $297/mo"
                  className="field text-xs w-full" />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Target Audience</label>
                <input value={audience} onChange={e => setAudience(e.target.value)}
                  placeholder="e.g. busy moms 30-45, B2B SaaS founders"
                  className="field text-xs w-full" />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Funnel Type</label>
                <select value={funnelType} onChange={e => setFunnelType(e.target.value)}
                  className="field text-xs w-full">
                  {FUNNEL_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Pages to Build</p>
            <div className="flex flex-wrap gap-1.5">
              {PAGE_OPTIONS.map(p => (
                <button key={p} onClick={() => togglePage(p)}
                  className="text-xs px-2.5 py-1 rounded-lg transition-all"
                  style={{
                    background: pages.includes(p) ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
                    border:     pages.includes(p) ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.08)',
                    color:      pages.includes(p) ? '#a5b4fc' : '#6b7280',
                  }}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">Extra Context</label>
            <textarea value={extraContext} onChange={e => setExtraContext(e.target.value)}
              placeholder="Brand colors, competitor to beat, key objections, price point, guarantee..."
              className="field text-xs w-full resize-none" rows={4} />
          </div>

          <button onClick={generate} disabled={generating || !niche.trim() || !offer.trim()}
            className="btn-primary py-2.5 text-sm w-full">
            {generating ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating Brief…
              </span>
            ) : '✨ Generate Agent Brief'}
          </button>

          {!agentConfigured && (
            <div className="rounded-xl p-3 text-xs" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}>
              ⚠️ GHL Agent webhook not configured.{' '}
              <Link to="/settings" className="underline">Add it in Settings</Link> to execute agents.
            </div>
          )}
        </div>

        {/* ── Right: Brief editor + execute ── */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ minWidth: 0 }}>

          {/* Brief header */}
          <div className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)' }}>
            <span className="text-sm font-semibold text-white flex-1">Agent Prompt / Brief</span>
            {brief && (
              <span className="text-xs text-gray-500">{brief.length} chars</span>
            )}
            {brief && (
              <button onClick={() => { navigator.clipboard.writeText(brief); }}
                className="btn-ghost text-xs px-3 py-1.5">
                📋 Copy
              </button>
            )}
            <button
              onClick={execute}
              disabled={executing || !brief.trim() || !agentConfigured}
              title={!agentConfigured ? 'Configure GHL Agent webhook in Settings first' : ''}
              className="btn-primary px-5 py-1.5 text-sm"
            >
              {executing ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending…
                </span>
              ) : '🤖 Execute in GHL Agent Studio'}
            </button>
          </div>

          {/* Status banner */}
          {status && (
            <div className="px-5 py-3 flex-shrink-0 flex items-center gap-3"
              style={{
                background: status.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
              <span>{status.type === 'success' ? '✅' : '❌'}</span>
              <p className="text-sm flex-1" style={{ color: status.type === 'success' ? '#4ade80' : '#f87171' }}>
                {status.msg}
              </p>
              {status.type === 'success' && (
                <a href="https://app.gohighlevel.com" target="_blank" rel="noreferrer"
                  className="text-xs text-green-400 underline">Open GHL →</a>
              )}
            </div>
          )}

          {/* Brief textarea */}
          <div className="flex-1 overflow-hidden p-5">
            {!brief && !generating ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
                <span className="text-5xl">🤖</span>
                <div>
                  <p className="text-gray-400 text-sm font-medium">No brief generated yet</p>
                  <p className="text-gray-600 text-xs mt-1">Fill in the funnel details and click Generate Agent Brief</p>
                </div>
                <div className="rounded-xl p-4 text-left max-w-md"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-xs font-semibold text-gray-400 mb-2">How it works:</p>
                  <ol className="text-xs text-gray-500 space-y-1.5 list-decimal list-inside">
                    <li>Fill in your niche, offer, and funnel details</li>
                    <li>Claude generates a detailed structured brief</li>
                    <li>Review and edit the prompt if needed</li>
                    <li>Click Execute — sent to your GHL Agent Studio agent</li>
                    <li>Agent builds native funnel pages inside GHL</li>
                  </ol>
                </div>
                <div className="rounded-xl p-3 text-xs max-w-md"
                  style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', color: '#a5b4fc' }}>
                  ℹ️ Set up your GHL Agent Studio agent first with funnel-building instructions, then connect its trigger webhook in Settings → GHL Agent Studio.
                </div>
              </div>
            ) : generating ? (
              <div className="h-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                  <p className="text-gray-400 text-sm">Claude is writing your agent brief…</p>
                </div>
              </div>
            ) : (
              <textarea
                value={brief}
                onChange={e => setBrief(e.target.value)}
                className="w-full h-full resize-none text-sm text-gray-200 bg-transparent outline-none"
                style={{ fontFamily: 'inherit', lineHeight: 1.7 }}
                placeholder="Generated brief will appear here…"
              />
            )}
          </div>

          {/* Footer hint */}
          <div className="px-5 py-2 flex-shrink-0 flex items-center gap-4"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
            <p className="text-xs text-gray-600 flex-1">
              You can edit the brief directly before executing. The agent receives the full prompt text.
            </p>
            {!agentConfigured && (
              <Link to="/settings" className="text-xs text-indigo-400 hover:text-indigo-300 whitespace-nowrap">
                ⚙️ Configure webhook →
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
