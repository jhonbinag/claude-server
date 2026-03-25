import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useApp }                 from '../context/AppContext';
import { useStreamFetch }         from '../hooks/useStreamFetch';
import AuthGate                   from '../components/AuthGate';
import Header                     from '../components/Header';
import Spinner                    from '../components/Spinner';
import SelfImprovementPanel       from '../components/SelfImprovementPanel';

const FORMATS = [
  { value: 'feed',  label: '🖼️ Feed',  desc: '1200×628' },
  { value: 'story', label: '📱 Story', desc: '1080×1920' },
  { value: 'reel',  label: '🎬 Reel',  desc: '1080×1920' },
];

const TONES = [
  { value: 'direct_response', label: '🎯 Direct Response', desc: 'Hard-hitting, conversion-first' },
  { value: 'emotional',       label: '❤️ Emotional',       desc: 'Empathy & transformation' },
  { value: 'pas',             label: '🔥 PAS Framework',   desc: 'Problem → Agitate → Solution' },
  { value: 'storytelling',    label: '📖 Storytelling',    desc: 'Narrative, relatable journey' },
  { value: 'curiosity',       label: '🤔 Curiosity',       desc: 'Pattern interrupt, open loops' },
  { value: 'social_proof',    label: '⭐ Social Proof',    desc: 'Results, numbers, testimonials' },
  { value: 'fomo',            label: '⏰ FOMO',            desc: 'Urgency & scarcity' },
  { value: 'educational',     label: '🎓 Educational',     desc: 'Authority, how-to, value-first' },
];

const QUICK_NICHES = [
  '🏋️ Fitness Coaching', '💰 Make Money Online', '🏠 Real Estate',
  '💆 Health & Wellness', '📚 Online Courses', '🛍️ eCommerce',
];

// ─── Ad Card ─────────────────────────────────────────────────────────────────

function AdCard({ ad, index }) {
  const [expanded, setExpanded] = useState(false);
  const { copy } = ad;
  if (!copy) return null;

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {/* Image placeholder */}
      <div
        className="flex flex-col items-center justify-center gap-1 flex-shrink-0"
        style={{ background: 'rgba(0,0,0,0.25)', height: 90, borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <span style={{ fontSize: 22 }}>🖼️</span>
        <p className="text-xs text-gray-600">Creative placeholder</p>
      </div>

      {/* Card body */}
      <div className="flex flex-col flex-1 p-3 gap-2">
        {/* Badge row */}
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider">Ad #{index + 1}</span>
          <span
            className="text-xs px-2 py-0.5 rounded-full truncate"
            style={{ background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', maxWidth: 100 }}
          >
            {copy.angle || 'direct'}
          </span>
        </div>

        {/* Headline */}
        <p className="text-sm font-bold text-white leading-snug">{copy.headline}</p>

        {/* Primary text */}
        <p
          className="text-xs text-gray-400 leading-relaxed whitespace-pre-line"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: expanded ? 'unset' : 3,
            WebkitBoxOrient: 'vertical',
            overflow: expanded ? 'visible' : 'hidden',
          }}
        >
          {copy.primaryText}
        </p>

        {copy.primaryText?.length > 100 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-left"
            style={{ color: '#818cf8' }}
          >
            {expanded ? '▲ less' : '▼ more'}
          </button>
        )}

        {/* CTA */}
        <div className="mt-auto pt-1">
          <span
            className="inline-block px-3 py-1 rounded-lg text-xs font-semibold"
            style={{ background: '#1877f2', color: '#fff' }}
          >
            {copy.callToAction || 'Learn More'}
          </span>
        </div>

        {/* Why it works */}
        {copy.whyItWorks && (
          <div
            className="text-xs px-2.5 py-2 rounded-xl leading-snug"
            style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.15)', color: '#6ee7b7' }}
          >
            💡 {copy.whyItWorks}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Analysis Card ────────────────────────────────────────────────────────────

function AnalysisCard({ analysis }) {
  const [open, setOpen] = useState(false);
  if (!analysis) return null;
  return (
    <div
      className="rounded-2xl overflow-hidden mb-3"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-white">📊 Market Research Insights</span>
        <span className="text-gray-500 text-xs">{open ? '▲ collapse' : '▼ expand'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-2 gap-4 text-xs">
          {analysis.summary && <div className="col-span-2 text-gray-400 italic">{analysis.summary}</div>}
          {analysis.topHooks?.length > 0 && (
            <div>
              <p className="text-gray-500 uppercase tracking-wider mb-1.5">Top Hooks</p>
              <ul className="space-y-1">{analysis.topHooks.map((h, i) => <li key={i} className="text-gray-300">• {h}</li>)}</ul>
            </div>
          )}
          {analysis.painPoints?.length > 0 && (
            <div>
              <p className="text-gray-500 uppercase tracking-wider mb-1.5">Pain Points</p>
              <ul className="space-y-1">{analysis.painPoints.map((p, i) => <li key={i} className="text-gray-300">• {p}</li>)}</ul>
            </div>
          )}
          {analysis.emotionalTriggers?.length > 0 && (
            <div>
              <p className="text-gray-500 uppercase tracking-wider mb-1.5">Emotional Triggers</p>
              <ul className="space-y-1">{analysis.emotionalTriggers.map((t, i) => <li key={i} className="text-gray-300">• {t}</li>)}</ul>
            </div>
          )}
          {analysis.ctaPatterns?.length > 0 && (
            <div>
              <p className="text-gray-500 uppercase tracking-wider mb-1.5">CTA Patterns</p>
              <ul className="space-y-1">{analysis.ctaPatterns.map((c, i) => <li key={i} className="text-gray-300">• {c}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step Progress ────────────────────────────────────────────────────────────

function StepProgress({ step }) {
  if (!step) return null;
  const pct = Math.round((step.step / step.total) * 100);
  return (
    <div className="mb-3 px-1">
      <div className="flex justify-between text-xs text-gray-500 mb-1.5">
        <span>{step.label}</span>
        <span>{step.step}/{step.total}</span>
      </div>
      <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }} />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdsGenerator() {
  const { isAuthenticated, isAuthLoading, apiKey } = useApp();
  const { isRunning, stream, stop } = useStreamFetch();

  const [keywords,       setKeywords]       = useState('');
  const [competitorPage, setCompetitorPage] = useState('');
  const [offer,          setOffer]          = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [brandVoice,     setBrandVoice]     = useState('');
  const [tone,           setTone]           = useState('direct_response');
  const [numVariations,  setNumVariations]  = useState(8);
  const [format,         setFormat]         = useState('feed');

  const [step,     setStep]     = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [ads,      setAds]      = useState([]);
  const [libInfo,  setLibInfo]  = useState(null);
  const [error,    setError]    = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [done,     setDone]     = useState(false);
  const [doneInfo, setDoneInfo] = useState(null);

  const adsRef = useRef([]);

  const reset = () => {
    setStep(null); setAnalysis(null); setAds([]); setLibInfo(null);
    setError(null); setWarnings([]); setDone(false); setDoneInfo(null);
    adsRef.current = [];
  };

  const generate = useCallback(async () => {
    if (!keywords.trim() || isRunning) return;
    reset();

    await stream(
      '/ads/generate',
      { keywords: keywords.trim(), competitorPage: competitorPage.trim() || undefined, offer, targetAudience, brandVoice, tone, numVariations, format },
      (evtType, data) => {
        if (evtType === 'step')        { setStep(data); }
        if (evtType === 'library_ads') { setLibInfo(data); }
        if (evtType === 'analysis')    { setAnalysis(data); }
        if (evtType === 'warn')        { setWarnings(w => [...w, data.msg]); }
        if (evtType === 'ad_copy') {
          adsRef.current = [...adsRef.current];
          adsRef.current[data.index] = { index: data.index, copy: data.copy };
          setAds([...adsRef.current]);
        }
        if (evtType === 'done')  { setDone(true); setDoneInfo(data); setStep(null); }
        if (evtType === 'error') { setError(data.error); setStep(null); }
      },
      apiKey,
    );
  }, [keywords, competitorPage, offer, targetAudience, brandVoice, tone, numVariations, format, isRunning, stream, apiKey]);

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🎯" title="Bulk Ads Generator" subtitle="Connect your API key to generate AI-powered ads">
      <Link to="/" className="block text-center text-xs text-gray-500 mt-4 hover:text-gray-300">← Back to Dashboard</Link>
    </AuthGate>
  );

  const hasOutput = ads.length > 0 || analysis || isRunning || done || error;
  const selectedTone = TONES.find(t => t.value === tone);

  return (
    <div className="flex flex-col" style={{ height: '100%', background: '#0f0f13' }}>
      <Header icon="🎯" title="Bulk Ads Generator" subtitle="Competitor research → targeted copy → 4-column ad grid" />

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">

        {/* ── Left — Form ──────────────────────────────────────────────── */}
        <div
          className="flex flex-col flex-shrink-0 overflow-y-auto"
          style={{ width: '100%', maxWidth: 320, borderRight: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="p-4 space-y-4 flex-1">

            {/* Quick niche chips */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Quick Niche</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_NICHES.map(n => (
                  <button
                    key={n}
                    onClick={() => setKeywords(n.replace(/^\S+\s/, ''))}
                    className="text-xs px-2.5 py-1 rounded-full transition-all"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#9ca3af' }}
                    onMouseOver={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#a5b4fc'; }}
                    onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#9ca3af'; }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Keywords */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Niche / Keywords <span className="text-red-500">*</span>
              </label>
              <input
                value={keywords}
                onChange={e => setKeywords(e.target.value)}
                placeholder="e.g. fitness coaching, weight loss"
                className="field w-full text-sm"
                onKeyDown={e => e.key === 'Enter' && generate()}
              />
            </div>

            {/* Offer */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Offer / Product</label>
              <input
                value={offer}
                onChange={e => setOffer(e.target.value)}
                placeholder="e.g. 12-week online coaching program"
                className="field w-full text-sm"
              />
            </div>

            {/* Audience */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Target Audience</label>
              <input
                value={targetAudience}
                onChange={e => setTargetAudience(e.target.value)}
                placeholder="e.g. women 30-45 wanting to lose weight"
                className="field w-full text-sm"
              />
            </div>

            {/* Tone selector */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Copy Tone</p>
              <div className="grid grid-cols-2 gap-1.5">
                {TONES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setTone(t.value)}
                    className="text-left px-2.5 py-2 rounded-xl transition-all"
                    style={{
                      background: tone === t.value ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${tone === t.value ? 'rgba(99,102,241,0.55)' : 'rgba(255,255,255,0.06)'}`,
                    }}
                  >
                    <div className="text-xs font-medium" style={{ color: tone === t.value ? '#a5b4fc' : '#d1d5db' }}>{t.label}</div>
                    <div className="text-xs mt-0.5" style={{ color: tone === t.value ? '#818cf8' : '#6b7280' }}>{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Brand Voice */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Brand Voice <span className="text-gray-600">(optional)</span></label>
              <input
                value={brandVoice}
                onChange={e => setBrandVoice(e.target.value)}
                placeholder="e.g. empowering, bold, no-fluff"
                className="field w-full text-sm"
              />
            </div>

            {/* Competitor Page */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Competitor FB Page ID <span className="text-gray-600">(optional)</span></label>
              <input
                value={competitorPage}
                onChange={e => setCompetitorPage(e.target.value)}
                placeholder="Facebook Page ID to spy on"
                className="field w-full text-sm"
              />
            </div>

            {/* Format + Variations row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Format</p>
                <div className="flex flex-col gap-1">
                  {FORMATS.map(f => (
                    <button
                      key={f.value}
                      onClick={() => setFormat(f.value)}
                      className="text-left px-2.5 py-1.5 rounded-lg text-xs transition-all"
                      style={{
                        background: format === f.value ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${format === f.value ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.06)'}`,
                        color: format === f.value ? '#a5b4fc' : '#9ca3af',
                      }}
                    >
                      {f.label} <span style={{ color: '#6b7280' }}>{f.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Variations</label>
                <select value={numVariations} onChange={e => setNumVariations(Number(e.target.value))} className="field w-full text-sm">
                  {[4,6,8,10].map(n => <option key={n} value={n}>{n} ads</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Generate button */}
          <div className="p-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {selectedTone && (
              <div
                className="text-xs px-3 py-2 rounded-xl mb-3"
                style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', color: '#a5b4fc' }}
              >
                {selectedTone.label} — {selectedTone.desc}
              </div>
            )}
            <button
              onClick={isRunning ? stop : generate}
              disabled={!isRunning && !keywords.trim()}
              className="btn-primary w-full py-3 gap-2 text-sm"
            >
              {isRunning
                ? <><span className="spinner w-4 h-4 rounded-full border-2" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> Stop</>
                : `🎯 Generate ${numVariations} Ads`}
            </button>
          </div>
        </div>

        {/* ── Right — Output ───────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

          <div
            className="px-4 py-2.5 flex items-center gap-3 flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)' }}
          >
            <span className="text-sm">✨</span>
            <span className="text-sm font-semibold text-white">Generated Ads</span>
            {libInfo && (
              <span className="text-xs text-gray-500">{libInfo.analyzed} competitor ads analyzed</span>
            )}
            {isRunning && (
              <span className="ml-auto text-xs text-yellow-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                Working…
              </span>
            )}
            {done && !isRunning && (
              <span className="ml-auto text-xs text-green-400">
                ✓ {ads.length} ads · {doneInfo?.provider || 'AI'} · {doneInfo?.model}
              </span>
            )}
            {hasOutput && !isRunning && (
              <button onClick={reset} className="ml-auto btn-ghost px-3 py-1 text-xs">Clear</button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {!hasOutput && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <span className="text-4xl">🎯</span>
                <p className="text-gray-400 text-sm font-medium">Enter your niche and click Generate</p>
                <p className="text-gray-600 text-xs max-w-xs">
                  Pick a tone, describe your offer and audience — AI writes targeted copy that actually converts
                </p>
              </div>
            )}

            {step && <StepProgress step={step} />}

            {warnings.map((w, i) => (
              <div key={i} className="rounded-xl px-4 py-2.5 text-xs mb-3 flex items-start gap-2"
                style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', color: '#fde68a' }}>
                <span className="flex-shrink-0">⚠️</span>{w}
              </div>
            ))}

            {error && (
              <div className="rounded-xl px-4 py-3 text-sm mb-4"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
                ⚠️ {error}
              </div>
            )}

            <AnalysisCard analysis={analysis} />

            {/* 4-column grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {ads.map((ad, i) => ad && <AdCard key={i} ad={ad} index={i} />)}
            </div>

            {/* Skeleton loaders in 4-col grid */}
            {isRunning && ads.length === 0 && !analysis && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-2">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="h-48 rounded-2xl animate-pulse"
                    style={{ background: 'rgba(255,255,255,0.03)', animationDelay: `${i * 0.08}s` }} />
                ))}
              </div>
            )}

            {/* Self-improvement panel — auto-starts 3s after generation */}
            {ads.length > 0 && !isRunning && (
              <SelfImprovementPanel
                type="ad_copy"
                artifact={[ads[0]?.hook, ads[0]?.body, ads[0]?.cta].filter(Boolean).join('\n\n')}
                context={{ keywords, tone, format, offer, targetAudience }}
                autoStart={true}
                continuous={true}
                onApply={(improved) => {
                  const lines = improved.split('\n\n');
                  setAds(prev => prev.map((ad, i) => i === 0 ? { ...ad, hook: lines[0] || ad.hook, body: lines[1] || ad.body, cta: lines[2] || ad.cta } : ad));
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
