import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useApp }         from '../context/AppContext';
import { useStreamFetch } from '../hooks/useStreamFetch';
import AuthGate     from '../components/AuthGate';
import Header       from '../components/Header';
import StreamOutput from '../components/StreamOutput';
import Spinner      from '../components/Spinner';

const AD_TYPES = [
  { value: 'facebook',   label: '📘 Facebook Ads',    desc: 'Campaigns, ad sets & creatives' },
  { value: 'google',     label: '🔎 Google Ads',       desc: 'Search, display & video' },
  { value: 'instagram',  label: '📸 Instagram Ads',    desc: 'Stories, reels & feed' },
  { value: 'linkedin',   label: '💼 LinkedIn Ads',     desc: 'Sponsored content & InMail' },
];

const OBJECTIVES = [
  'Brand Awareness', 'Lead Generation', 'Website Traffic',
  'Conversions', 'Engagement', 'App Installs', 'Video Views',
];

const TONES = [
  'Professional', 'Friendly', 'Urgent', 'Inspirational',
  'Humorous', 'Educational', 'Authoritative',
];

const TEMPLATES = [
  {
    name: '🛍️ Product Launch',
    adType: 'facebook',
    objective: 'Conversions',
    tone: 'Urgent',
    product: 'New SaaS Product',
    audience: 'Marketing professionals aged 25-45',
    budget: '50',
    variants: '3',
    extra: 'Include a limited-time offer and strong CTA.',
  },
  {
    name: '🎓 Lead Gen Course',
    adType: 'facebook',
    objective: 'Lead Generation',
    tone: 'Educational',
    product: 'Online Marketing Course',
    audience: 'Small business owners interested in digital marketing',
    budget: '30',
    variants: '3',
    extra: 'Emphasize transformation and results from past students.',
  },
  {
    name: '🏪 Local Business',
    adType: 'instagram',
    objective: 'Brand Awareness',
    tone: 'Friendly',
    product: 'Local Restaurant / Service Business',
    audience: 'People within 10 miles of [city], ages 18-55',
    budget: '20',
    variants: '2',
    extra: 'Highlight community involvement and local values.',
  },
  {
    name: '💼 B2B SaaS',
    adType: 'linkedin',
    objective: 'Lead Generation',
    tone: 'Professional',
    product: 'B2B Software Solution',
    audience: 'C-suite executives and department heads at companies with 50+ employees',
    budget: '100',
    variants: '2',
    extra: 'Focus on ROI, efficiency gains, and enterprise features.',
  },
];

function applyEvent(prev, evtType, data) {
  if (evtType === 'text') {
    const last = prev[prev.length - 1];
    if (last?.type === 'text') {
      return [...prev.slice(0, -1), { ...last, text: last.text + data.text }];
    }
    return [...prev, { type: 'text', text: data.text }];
  }
  if (evtType === 'tool_call')   return [...prev, { type: 'tool_call',   name: data.name,   input:  data.input }];
  if (evtType === 'tool_result') return [...prev, { type: 'tool_result', name: data.name,   result: data.result }];
  if (evtType === 'done')        return [...prev, { type: 'done',  turns: data.turns, toolCallCount: data.toolCallCount }];
  if (evtType === 'error')       return [...prev, { type: 'error', error: data.error }];
  return prev;
}

function buildPrompt({ adType, objective, tone, product, audience, budget, variants, extra }) {
  const platform = AD_TYPES.find(t => t.value === adType)?.label || adType;
  return `Generate ${variants} ${platform} ad variants for the following campaign:

Product/Service: ${product}
Target Audience: ${audience}
Campaign Objective: ${objective}
Tone: ${tone}
Daily Budget: $${budget}

For each variant provide:
1. Headline (max 40 chars)
2. Primary Text / Body copy (max 125 chars for feed, 90 for stories)
3. Call-to-Action button text
4. Image/creative direction (describe what the visual should look like)
5. Targeting suggestions (interests, behaviours, demographics)

${extra ? `Additional requirements: ${extra}` : ''}

Format each variant clearly as "Variant 1:", "Variant 2:", etc. with all elements labelled.`;
}

export default function AdsGenerator() {
  const { isAuthenticated, isAuthLoading, apiKey, integrations } = useApp();
  const { isRunning, stream, stop } = useStreamFetch();

  const [adType,    setAdType]    = useState('facebook');
  const [objective, setObjective] = useState('Lead Generation');
  const [tone,      setTone]      = useState('Professional');
  const [product,   setProduct]   = useState('');
  const [audience,  setAudience]  = useState('');
  const [budget,    setBudget]    = useState('50');
  const [variants,  setVariants]  = useState('3');
  const [extra,     setExtra]     = useState('');
  const [messages,  setMessages]  = useState([]);

  const fbEnabled = (integrations || []).some(i => i.key === 'facebook_ads' && i.enabled);
  const aiEnabled = (integrations || []).some(i => i.key === 'openai' && i.enabled);

  const generate = useCallback(async () => {
    if (!product.trim() || !audience.trim() || isRunning) return;
    setMessages([]);

    const taskPrompt = buildPrompt({ adType, objective, tone, product, audience, budget, variants, extra });
    const allowedIntegrations = ['openai', ...(fbEnabled ? ['facebook_ads'] : [])];

    await stream(
      '/claude/task',
      { task: taskPrompt, allowedIntegrations },
      (evtType, data) => setMessages(prev => applyEvent(prev, evtType, data)),
      apiKey,
    );
  }, [adType, objective, tone, product, audience, budget, variants, extra, isRunning, stream, apiKey, fbEnabled]);

  const applyTemplate = tpl => {
    setAdType(tpl.adType);
    setObjective(tpl.objective);
    setTone(tpl.tone);
    setProduct(tpl.product);
    setAudience(tpl.audience);
    setBudget(tpl.budget);
    setVariants(tpl.variants);
    setExtra(tpl.extra || '');
    setMessages([]);
  };

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🎯" title="Bulk Ads Generator" subtitle="Connect your API key to generate AI-powered ads">
      <Link to="/" className="block text-center text-xs text-gray-500 mt-4 hover:text-gray-300">
        ← Back to Dashboard
      </Link>
    </AuthGate>
  );

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: '#0f0f13' }}>
      <Header
        icon="🎯"
        title="Bulk Ads Generator"
        subtitle="Claude · OpenAI · Facebook Ads — AI-powered ad creative at scale"
      />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left — Form ──────────────────────────────────────────────── */}
        <div
          className="flex flex-col overflow-y-auto"
          style={{ width: '420px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="p-5 space-y-5 flex-1">

            {/* Status banner */}
            {!aiEnabled && (
              <div
                className="flex items-start gap-3 px-4 py-3 rounded-xl text-xs"
                style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', color: '#fbbf24' }}
              >
                <span className="text-base flex-shrink-0">⚠️</span>
                <div>
                  <div className="font-medium mb-0.5">OpenAI not connected</div>
                  <div className="text-yellow-600">Claude will generate ads without GPT-4o assistance.</div>
                  <Link to="/settings" className="text-yellow-400 hover:underline mt-1 inline-block">Connect OpenAI →</Link>
                </div>
              </div>
            )}

            {/* Templates */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Quick Templates</p>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map(tpl => (
                  <button
                    key={tpl.name}
                    onClick={() => applyTemplate(tpl)}
                    className="text-left text-xs px-3 py-2 rounded-xl transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      color: '#9ca3af',
                    }}
                    onMouseOver={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#a5b4fc'; }}
                    onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#9ca3af'; }}
                  >
                    {tpl.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Platform */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Ad Platform</p>
              <div className="grid grid-cols-2 gap-2">
                {AD_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setAdType(t.value)}
                    className="text-left px-3 py-2.5 rounded-xl transition-all"
                    style={{
                      background: adType === t.value ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${adType === t.value ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'}`,
                    }}
                  >
                    <div className="text-sm text-white">{t.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Objective + Tone */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Objective</label>
                <select value={objective} onChange={e => setObjective(e.target.value)} className="field w-full text-sm">
                  {OBJECTIVES.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Tone</label>
                <select value={tone} onChange={e => setTone(e.target.value)} className="field w-full text-sm">
                  {TONES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* Product */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Product / Service <span className="text-red-500">*</span></label>
              <input
                value={product}
                onChange={e => setProduct(e.target.value)}
                placeholder="e.g. CRM Software for Real Estate Agents"
                className="field w-full text-sm"
              />
            </div>

            {/* Audience */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Target Audience <span className="text-red-500">*</span></label>
              <textarea
                value={audience}
                onChange={e => setAudience(e.target.value)}
                placeholder="e.g. Real estate agents aged 30-50 interested in productivity tools"
                rows={3}
                className="field w-full text-sm"
                style={{ resize: 'vertical' }}
              />
            </div>

            {/* Budget + Variants */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Daily Budget ($)</label>
                <input
                  type="number"
                  value={budget}
                  onChange={e => setBudget(e.target.value)}
                  min="1"
                  className="field w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Variants</label>
                <select value={variants} onChange={e => setVariants(e.target.value)} className="field w-full text-sm">
                  {['1','2','3','4','5'].map(n => <option key={n} value={n}>{n} variant{n > 1 ? 's' : ''}</option>)}
                </select>
              </div>
            </div>

            {/* Additional requirements */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Additional Requirements <span className="text-gray-600">(optional)</span>
              </label>
              <textarea
                value={extra}
                onChange={e => setExtra(e.target.value)}
                placeholder="e.g. Include a discount code, focus on pain points, avoid competitor mentions…"
                rows={2}
                className="field w-full text-sm"
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>

          {/* Generate button */}
          <div className="p-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              onClick={isRunning ? stop : generate}
              disabled={!isRunning && (!product.trim() || !audience.trim())}
              className="btn-primary w-full py-3 gap-2 text-base"
            >
              {isRunning
                ? <><span className="spinner w-4 h-4 rounded-full border-2" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> Stop</>
                : `🎯 Generate ${variants} Ad Variant${variants > 1 ? 's' : ''}`}
            </button>
            {fbEnabled && (
              <p className="text-xs text-center text-gray-600 mt-2">
                Facebook Ads connected — Claude can create campaigns directly
              </p>
            )}
          </div>
        </div>

        {/* ── Right — Output ───────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div
            className="px-5 py-3 flex items-center gap-3 flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)' }}
          >
            <span className="text-sm">✨</span>
            <span className="text-sm font-semibold text-white">Generated Ad Copy</span>
            {isRunning && (
              <span className="ml-auto text-xs text-yellow-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                Generating…
              </span>
            )}
            {messages.length > 0 && !isRunning && (
              <button
                onClick={() => setMessages([])}
                className="ml-auto btn-ghost px-3 py-1 text-xs"
              >
                Clear
              </button>
            )}
          </div>

          <StreamOutput
            messages={messages}
            isRunning={isRunning}
            placeholder={{
              icon: '🎯',
              text: 'Fill in the form and click Generate\nClaude will create compelling ad copy tailored to your audience',
            }}
          />
        </div>
      </div>
    </div>
  );
}
