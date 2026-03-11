/**
 * Workflows.jsx — multi-tool AI workflow builder
 *
 * Tool palette → add steps → each step has structured config (GHL steps)
 * or a free-text instruction (external integrations).
 * "Run Workflow" sends everything to Claude as a single ordered prompt.
 */

import { useState, useCallback, useEffect } from 'react';
import { Link }           from 'react-router-dom';
import { useApp }         from '../context/AppContext';
import { useStreamFetch } from '../hooks/useStreamFetch';
import AuthGate           from '../components/AuthGate';
import Header             from '../components/Header';
import StreamOutput       from '../components/StreamOutput';
import Spinner            from '../components/Spinner';
import { INTEGRATIONS }   from '../lib/integrations';

// ─── Colours ──────────────────────────────────────────────────────────────────

const TOOL_COLOR = {
  ghl: '#22c55e', perplexity: '#6366f1', openai: '#10b981',
  facebook_ads: '#1877f2', sendgrid: '#00a8a8', slack: '#9333ea',
  apollo: '#f97316', heygen: '#a855f7',
};

// ─── GHL action catalogue ─────────────────────────────────────────────────────

const GHL_ACTIONS = [
  { key: 'funnel',   label: 'Build Funnel',      icon: '🚀', desc: 'Create funnel pages in GHL' },
  { key: 'website',  label: 'Build Website',     icon: '🌐', desc: 'Create website pages in GHL' },
  { key: 'blog',     label: 'Blog Post',         icon: '✍️', desc: 'Write & publish a blog post' },
  { key: 'email',    label: 'Email Campaign',    icon: '✉️', desc: 'Generate email sequence copy' },
  { key: 'pipeline', label: 'Pipeline / CRM',   icon: '📊', desc: 'Create or update opportunities' },
  { key: 'contacts', label: 'Contacts',          icon: '👥', desc: 'Search, create or tag contacts' },
  { key: 'social',   label: 'Social Posts',      icon: '📱', desc: 'Schedule social media posts' },
  { key: 'custom',   label: 'Custom Action',     icon: '⚡', desc: 'Write your own GHL instruction' },
];

const FUNNEL_TYPES = [
  { key: 'sales',          label: 'Sales Funnel',
    pages: [
      { key: 'opt-in',    label: 'Opt-in Page',    url: 'opt-in',    req: true },
      { key: 'sales',     label: 'Sales Page',     url: 'sales',     req: true },
      { key: 'order',     label: 'Order Page',     url: 'order',     req: true },
      { key: 'upsell',    label: 'Upsell Page',    url: 'upsell',    req: false },
      { key: 'thank-you', label: 'Thank You',      url: 'thank-you', req: true },
    ],
  },
  { key: 'webinar',        label: 'Webinar Funnel',
    pages: [
      { key: 'registration', label: 'Registration', url: 'register',  req: true },
      { key: 'confirmation', label: 'Confirmation', url: 'confirm',   req: true },
      { key: 'webinar-room', label: 'Webinar Room', url: 'webinar',   req: false },
      { key: 'replay',       label: 'Replay',       url: 'replay',    req: false },
      { key: 'thank-you',    label: 'Thank You',    url: 'thank-you', req: true },
    ],
  },
  { key: 'tripwire',       label: 'Tripwire Funnel',
    pages: [
      { key: 'landing',  label: 'Landing',      url: 'landing',   req: true },
      { key: 'tripwire', label: 'Tripwire Offer',url: 'offer',     req: true },
      { key: 'upsell',   label: 'Upsell',       url: 'upsell',    req: true },
      { key: 'downsell', label: 'Downsell',     url: 'downsell',  req: false },
      { key: 'thank-you',label: 'Thank You',    url: 'thank-you', req: true },
    ],
  },
  { key: 'lead-gen',       label: 'Lead Gen Funnel',
    pages: [
      { key: 'squeeze',   label: 'Squeeze Page', url: 'get-access', req: true },
      { key: 'thank-you', label: 'Thank You',    url: 'thank-you',  req: true },
    ],
  },
  { key: 'product-launch', label: 'Product Launch',
    pages: [
      { key: 'prelaunch', label: 'Pre-launch', url: 'coming-soon', req: true },
      { key: 'launch',    label: 'Launch',     url: 'launch',      req: true },
      { key: 'order',     label: 'Order',      url: 'order',       req: true },
      { key: 'thank-you', label: 'Thank You',  url: 'thank-you',   req: true },
    ],
  },
  { key: 'free-trial', label: 'Free Trial / SaaS',
    pages: [
      { key: 'landing', label: 'Landing', url: 'start',   req: true },
      { key: 'signup',  label: 'Sign Up', url: 'sign-up', req: true },
      { key: 'welcome', label: 'Welcome', url: 'welcome', req: true },
    ],
  },
  { key: 'squeeze-single', label: 'Squeeze Page',
    pages: [
      { key: 'squeeze',   label: 'Squeeze',    url: 'subscribe', req: true },
      { key: 'thank-you', label: 'Thank You',  url: 'thank-you', req: false },
    ],
  },
  { key: 'membership', label: 'Membership Funnel',
    pages: [
      { key: 'sales',        label: 'Sales',        url: 'join',     req: true },
      { key: 'registration', label: 'Registration', url: 'register', req: true },
      { key: 'member-area',  label: 'Member Area',  url: 'members',  req: false },
      { key: 'thank-you',    label: 'Thank You',    url: 'thank-you',req: true },
    ],
  },
];

const WEBSITE_TYPES = [
  { key: 'business',  label: 'Business Website',
    pages: [
      { key: 'home',     label: 'Home',       url: 'home',     req: true },
      { key: 'about',    label: 'About',      url: 'about',    req: true },
      { key: 'services', label: 'Services',   url: 'services', req: true },
      { key: 'contact',  label: 'Contact',    url: 'contact',  req: true },
      { key: 'blog',     label: 'Blog Index', url: 'blog',     req: false },
    ],
  },
  { key: 'service',   label: 'Service Business',
    pages: [
      { key: 'home',         label: 'Home',          url: 'home',    req: true },
      { key: 'services',     label: 'Services',      url: 'services',req: true },
      { key: 'testimonials', label: 'Testimonials',  url: 'reviews', req: false },
      { key: 'faq',          label: 'FAQ',           url: 'faq',     req: false },
      { key: 'contact',      label: 'Contact',       url: 'contact', req: true },
    ],
  },
  { key: 'portfolio', label: 'Portfolio',
    pages: [
      { key: 'home',      label: 'Home',      url: 'home',    req: true },
      { key: 'portfolio', label: 'Portfolio', url: 'work',    req: true },
      { key: 'about',     label: 'About',     url: 'about',   req: false },
      { key: 'contact',   label: 'Contact',   url: 'contact', req: true },
    ],
  },
  { key: 'landing',   label: 'Single Landing Page',
    pages: [{ key: 'landing', label: 'Landing Page', url: 'home', req: true }],
  },
];

const BLOG_TYPES = [
  { key: 'how-to',     label: 'How-To Guide' },
  { key: 'listicle',   label: 'Listicle' },
  { key: 'case-study', label: 'Case Study' },
  { key: 'news',       label: 'News / Announcement' },
  { key: 'seo',        label: 'SEO Pillar Post' },
  { key: 'comparison', label: 'Comparison Post' },
];

const EMAIL_TYPES = [
  { key: 'welcome',      label: 'Welcome' },
  { key: 'value',        label: 'Value / Nurture' },
  { key: 'case-study',   label: 'Case Study' },
  { key: 'objection',    label: 'Objection Handler' },
  { key: 'offer',        label: 'Sales / Offer' },
  { key: 'followup',     label: 'Follow-up' },
  { key: 'reengagement', label: 'Re-engagement' },
];

const PIPELINE_ACTIONS = [
  { key: 'create-opp',   label: 'Create opportunity',       desc: 'Add a new deal to the pipeline' },
  { key: 'update-stage', label: 'Move to stage',            desc: 'Update an existing deal stage' },
  { key: 'list-opps',    label: 'List open opportunities',  desc: 'Show all open deals' },
];

const CONTACT_ACTIONS = [
  { key: 'search',    label: 'Search contacts',   desc: 'Find contacts by name/email/tag' },
  { key: 'create',    label: 'Create contact',    desc: 'Add a new contact to the CRM' },
  { key: 'tag',       label: 'Add tags',          desc: 'Apply tags to matching contacts' },
  { key: 'workflow',  label: 'Add to workflow',   desc: 'Enrol contacts in a GHL workflow' },
];

// ─── Config → instruction text ────────────────────────────────────────────────

function configToInstruction(config, context) {
  const ctx = context ? ` Campaign context: ${context}.` : '';
  switch (config.action) {
    case 'funnel': {
      const ft    = FUNNEL_TYPES.find(f => f.key === config.funnelType);
      const pages = (config.selectedPages || []).map(p => `  - ${p.label} (/${p.url})`).join('\n');
      return `Build a complete ${ft?.label || 'funnel'} in GHL.${ctx}
Pages to create:
${pages}
Use list_funnels to find the funnel, then create each page with create_funnel_page using GHL native element sections.`;
    }
    case 'website': {
      const wt    = WEBSITE_TYPES.find(w => w.key === config.websiteType);
      const pages = (config.selectedPages || []).map(p => `  - ${p.label} (/${p.url})`).join('\n');
      return `Build a complete ${wt?.label || 'website'} in GHL.${ctx}
Pages to create:
${pages}
Use list_websites to find the website, then create each page with create_website_page using GHL native element sections.`;
    }
    case 'blog': {
      const bt = BLOG_TYPES.find(b => b.key === config.blogType);
      return `Write and publish a ${bt?.label || 'blog post'} in GHL.${ctx}
Write a complete SEO-optimised post (800-1200 words), generate and upload a featured image, then create it with create_blog_post.`;
    }
    case 'email': {
      const types = (config.emailTypes || []).map((k, i) => `  Email ${i + 1}: ${EMAIL_TYPES.find(e => e.key === k)?.label || k}`).join('\n');
      return `Generate a ${config.emailTypes?.length || 3}-email follow-up sequence.${ctx}
${types}
For each email write: subject line (2 A/B options), preview text, full body, P.S. line. Output as a table ready to paste into GHL.`;
    }
    case 'pipeline': {
      const pa = PIPELINE_ACTIONS.find(p => p.key === config.pipelineAction);
      return `GHL Pipeline: ${pa?.label || 'manage opportunities'}.${ctx} ${config.pipelineDetail || ''}`;
    }
    case 'contacts': {
      const ca = CONTACT_ACTIONS.find(c => c.key === config.contactAction);
      return `GHL Contacts: ${ca?.label || 'manage contacts'}.${ctx} ${config.contactDetail || ''}`;
    }
    case 'social':
      return `Create and schedule social media posts in GHL Social Planner.${ctx} ${config.socialDetail || 'Create posts for all connected social accounts.'}`;
    case 'custom':
    default:
      return config.customInstruction || '';
  }
}

// ─── Workflow prompt builder ───────────────────────────────────────────────────

function buildPrompt(steps, context) {
  const lines = steps.map((s, i) => {
    const instr = s.tool === 'ghl' && s.config
      ? configToInstruction(s.config, context)
      : s.instruction;
    return `STEP ${i + 1} [${s.label}]:\n${instr}`;
  }).join('\n\n');
  const ctx = context ? `\nContext: ${context}` : '';
  return `Execute this multi-step workflow in order. Complete every step before moving to the next.\n${ctx}\n\n${lines}\n\nAfter all steps: provide a full summary of everything created/actioned, with GHL IDs and URLs where applicable.`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkStep(tool, label, icon) {
  return {
    id:          `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    tool, label, icon,
    instruction: '',
    config:      tool === 'ghl' ? { action: null } : null,
  };
}

function applyEvent(prev, type, data) {
  if (type === 'text') {
    const last = prev[prev.length - 1];
    if (last?.type === 'text') return [...prev.slice(0, -1), { ...last, text: last.text + data.text }];
    return [...prev, { type: 'text', text: data.text }];
  }
  if (type === 'tool_call')   return [...prev, { type: 'tool_call',   name: data.name,  input:  data.input }];
  if (type === 'tool_result') return [...prev, { type: 'tool_result', name: data.name,  result: data.result }];
  if (type === 'done')        return [...prev, { type: 'done',        turns: data.turns, toolCallCount: data.toolCallCount }];
  if (type === 'error')       return [...prev, { type: 'error',       error: data.error }];
  return prev;
}

const TEMPLATES = [
  { name: '🚀 Full Campaign Launch',
    context: 'Complete go-to-market campaign',
    steps: [
      { tool: 'perplexity', label: 'Perplexity AI', icon: '🔍', instruction: 'Research the niche, competitors, target audience, and key messaging angles.', config: null },
      { tool: 'ghl', label: 'GHL CRM', icon: '⚡', instruction: '', config: { action: 'funnel', funnelType: 'sales', selectedPages: [{ key: 'opt-in', label: 'Opt-in Page', url: 'opt-in', req: true }, { key: 'sales', label: 'Sales Page', url: 'sales', req: true }, { key: 'order', label: 'Order Page', url: 'order', req: true }, { key: 'thank-you', label: 'Thank You', url: 'thank-you', req: true }] } },
      { tool: 'ghl', label: 'GHL CRM', icon: '⚡', instruction: '', config: { action: 'email', emailTypes: ['welcome', 'value', 'offer'] } },
      { tool: 'ghl', label: 'GHL CRM', icon: '⚡', instruction: '', config: { action: 'social', socialDetail: 'Create 3 posts promoting the funnel opt-in page.' } },
    ],
  },
  { name: '🔍 Research & Report',
    context: 'Research assistant workflow',
    steps: [
      { tool: 'perplexity', label: 'Perplexity AI', icon: '🔍', instruction: 'Research [topic] using live web data. Extract key stats, trends, and competitor insights.', config: null },
      { tool: 'openai',     label: 'OpenAI',        icon: '✨', instruction: 'Compile the research into a professional executive summary with key takeaways.', config: null },
    ],
  },
  { name: '🚀 Lead Outreach',
    context: 'B2B sales outreach',
    steps: [
      { tool: 'apollo', label: 'Apollo.io', icon: '🚀', instruction: 'Find 10 [job title] prospects at [industry] companies.', config: null },
      { tool: 'ghl',    label: 'GHL CRM',   icon: '⚡', instruction: '', config: { action: 'contacts', contactAction: 'create', contactDetail: 'Add found prospects as contacts tagged "apollo-lead".' } },
      { tool: 'sendgrid', label: 'SendGrid', icon: '📧', instruction: 'Send a personalised intro email to each new contact.', config: null },
    ],
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Workflows() {
  const { isAuthenticated, isAuthLoading, locationId, integrations } = useApp();
  const { isRunning, stream, stop } = useStreamFetch();

  const [steps,     setSteps]     = useState([]);
  const [wfName,    setWfName]    = useState('');
  const [context,   setContext]   = useState('');
  const [messages,  setMessages]  = useState([]);
  const [saved,     setSaved]     = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [webhookUrl,setWebhookUrl]= useState('');
  const [saving,    setSaving]    = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [copyDone,  setCopyDone]  = useState(false);

  const enabledKeys = new Set((integrations || []).filter(i => i.enabled).map(i => i.key));

  const loadSaved = useCallback(async () => {
    if (!locationId) return;
    try {
      const res  = await fetch('/workflows', { headers: { 'x-location-id': locationId } });
      const data = await res.json();
      if (data.success) setSaved(data.data || []);
    } catch { /* non-fatal */ }
  }, [locationId]);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const addStep = (tool, label, icon) =>
    setSteps(prev => [...prev, mkStep(tool, label, icon)]);

  const removeStep = id =>
    setSteps(prev => prev.filter(s => s.id !== id));

  const moveStep = (id, dir) => setSteps(prev => {
    const i = prev.findIndex(s => s.id === id);
    const next = [...prev];
    const j = i + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const setInstruction = (id, val) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, instruction: val } : s));

  const setConfig = (id, cfg) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, config: cfg } : s));

  const canRun = steps.length > 0 && steps.every(s => {
    if (s.tool === 'ghl' && s.config) return s.config.action !== null && s.config.action !== undefined;
    return s.instruction.trim().length > 0;
  });

  const run = useCallback(async () => {
    if (!steps.length || isRunning || !canRun) return;
    setMessages([]);
    const prompt  = buildPrompt(steps, context);
    const allowed = [...new Set(steps.map(s => s.tool).filter(t => t !== 'ghl'))];
    await stream(
      '/claude/task',
      { task: prompt, allowedIntegrations: allowed.length ? allowed : null },
      (evtType, data) => setMessages(prev => applyEvent(prev, evtType, data)),
      locationId,
    );
  }, [steps, context, isRunning, canRun, stream, locationId]);

  const save = async () => {
    if (!wfName.trim() || !steps.length) return;
    setSaving(true);
    try {
      const res  = await fetch('/workflows', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
        body:    JSON.stringify({ id: currentId, name: wfName.trim(), steps, context }),
      });
      const data = await res.json();
      if (data.success) {
        setCurrentId(data.data.id);
        setWebhookUrl(`${window.location.origin}/workflows/trigger/${data.data.webhookToken}`);
        await loadSaved();
        setShowSaved(false);
      }
    } catch { /* non-fatal */ }
    finally { setSaving(false); }
  };

  const loadWorkflow = wf => {
    setWfName(wf.name); setContext(wf.context || '');
    setSteps(wf.steps.map(s => ({ ...s, id: s.id || mkStep(s.tool, s.label, s.icon).id })));
    setCurrentId(wf.id);
    setWebhookUrl(`${window.location.origin}/workflows/trigger/${wf.webhookToken}`);
    setMessages([]); setShowSaved(false);
  };

  const deleteWorkflow = async id => {
    try {
      await fetch(`/workflows/${id}`, { method: 'DELETE', headers: { 'x-location-id': locationId } });
      await loadSaved();
      if (currentId === id) { setCurrentId(null); setWebhookUrl(''); }
    } catch { /* non-fatal */ }
  };

  const newWorkflow = () => {
    setWfName(''); setContext(''); setSteps([]);
    setMessages([]); setCurrentId(null); setWebhookUrl('');
  };

  const applyTemplate = tpl => {
    setWfName(tpl.name); setContext(tpl.context);
    setSteps(tpl.steps.map(s => ({ ...mkStep(s.tool, s.label, s.icon), instruction: s.instruction || '', config: s.config ?? (s.tool === 'ghl' ? { action: null } : null) })));
    setMessages([]); setCurrentId(null); setWebhookUrl('');
  };

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2000);
  };

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🔀" title="Workflow Builder" subtitle="Connect your API key to build AI workflows">
      <Link to="/" className="block text-center text-xs text-gray-500 mt-4 hover:text-gray-300">← Back</Link>
    </AuthGate>
  );

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: '#0f0f13' }}>
      <Header icon="🔀" title="Workflow Builder" subtitle="Chain tools together — Claude executes each step in order" />

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden" style={{ minHeight: 0 }}>

        {/* ── Tool Palette ── */}
        <ToolPalette enabledKeys={enabledKeys} onAdd={addStep} />

        {/* ── Canvas ── */}
        <div className="flex flex-col flex-1 overflow-hidden" style={{ borderRight: '1px solid rgba(255,255,255,0.06)', minHeight: 0 }}>

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
            <input value={wfName} onChange={e => setWfName(e.target.value)} placeholder="Workflow name…" className="field flex-1 text-sm" />
            <button onClick={newWorkflow} className="btn-ghost px-3 py-1.5 text-xs whitespace-nowrap">+ New</button>
            <button onClick={() => setShowSaved(v => !v)} className={`btn-ghost px-3 py-1.5 text-xs whitespace-nowrap${showSaved ? ' text-indigo-400' : ''}`}>
              📂 {saved.length > 0 ? `Saved (${saved.length})` : 'Saved'}
            </button>
          </div>

          {/* Saved list */}
          {showSaved && (
            <div className="flex-shrink-0 overflow-y-auto" style={{ maxHeight: 220, borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.3)' }}>
              {saved.length === 0
                ? <p className="text-xs text-gray-600 px-4 py-4 text-center">No saved workflows yet.</p>
                : saved.map(wf => (
                  <div key={wf.id} className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <button onClick={() => loadWorkflow(wf)} className="flex-1 text-left text-xs text-gray-300 hover:text-white truncate">
                      {wf.name} <span className="text-gray-600 ml-2">{wf.steps?.length} steps</span>
                    </button>
                    <button onClick={() => deleteWorkflow(wf.id)} className="text-gray-600 hover:text-red-400 text-sm px-1 flex-shrink-0">×</button>
                  </div>
                ))
              }
            </div>
          )}

          {/* Steps */}
          <div className="flex-1 overflow-y-auto p-4">

            {/* Templates — when empty */}
            {steps.length === 0 && (
              <div className="mb-6">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Quick Templates</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TEMPLATES.map(tpl => (
                    <button key={tpl.name} onClick={() => applyTemplate(tpl)}
                      className="text-left text-xs px-3 py-2.5 rounded-xl text-gray-400 hover:text-indigo-300 transition-all"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                      onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.35)'; }}
                      onMouseOut={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
                    >{tpl.name}</button>
                  ))}
                </div>
              </div>
            )}

            {steps.map((step, idx) => (
              <StepNode
                key={step.id}
                step={step}
                index={idx}
                total={steps.length}
                context={context}
                onDelete={() => removeStep(step.id)}
                onMoveUp={() => moveStep(step.id, -1)}
                onMoveDown={() => moveStep(step.id, 1)}
                onInstruction={val => setInstruction(step.id, val)}
                onConfig={cfg => setConfig(step.id, cfg)}
              />
            ))}

            {steps.length === 0 && (
              <div className="rounded-2xl flex flex-col items-center justify-center py-14" style={{ border: '1px dashed rgba(255,255,255,0.08)' }}>
                <p className="text-gray-600 text-sm mb-1">No steps yet</p>
                <p className="text-gray-700 text-xs">Click a tool in the palette to add your first step</p>
              </div>
            )}
            {steps.length > 0 && <p className="text-center text-xs text-gray-700 pt-3 pb-2">← Click a tool to add another step</p>}
          </div>

          {/* Bottom bar */}
          <div className="flex-shrink-0 px-4 py-3 space-y-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
            <input value={context} onChange={e => setContext(e.target.value)}
              placeholder="Campaign context (optional) — e.g. FitPro online coaching for busy moms, $297/mo"
              className="field w-full text-xs" />
            <div className="flex gap-2">
              <button onClick={isRunning ? stop : run} disabled={!isRunning && !canRun} className="btn-primary flex-1 py-2 text-sm">
                {isRunning
                  ? <span className="flex items-center justify-center gap-2"><span className="w-3 h-3 rounded-full border-2 inline-block" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff', animation: 'spin 0.8s linear infinite' }} />Stop</span>
                  : '▶  Run Workflow'}
              </button>
              <button onClick={save} disabled={saving || !wfName.trim() || !steps.length} className="btn-ghost px-4 py-2 text-sm">
                {saving ? '…' : '💾 Save'}
              </button>
              {messages.length > 0 && <button onClick={() => setMessages([])} className="btn-ghost px-3 py-2 text-sm">✕</button>}
            </div>
            {webhookUrl && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
                <span className="text-xs text-indigo-400 flex-shrink-0">🔗 Webhook</span>
                <input readOnly value={webhookUrl} className="flex-1 bg-transparent text-xs text-gray-400 outline-none min-w-0" onClick={e => e.target.select()} />
                <button onClick={copyWebhook} className="text-xs flex-shrink-0 px-2 py-0.5 rounded-md" style={{ color: copyDone ? '#4ade80' : '#818cf8' }}>
                  {copyDone ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Live Output ── */}
        <div className="flex flex-col overflow-hidden" style={{ width: '100%', maxWidth: 360, flexShrink: 0 }}>
          <div className="px-4 py-3 flex items-center gap-2 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="text-sm">⚡</span>
            <span className="text-sm font-semibold text-white">Live Output</span>
            {isRunning && (
              <span className="ml-auto text-xs text-yellow-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />Running…
              </span>
            )}
          </div>
          <StreamOutput messages={messages} isRunning={isRunning} placeholder={{ icon: '🔀', text: 'Build your workflow and click Run\nClaude executes each step in order' }} />
        </div>

      </div>
    </div>
  );
}

// ─── Tool Palette ─────────────────────────────────────────────────────────────

function ToolPalette({ enabledKeys, onAdd }) {
  const tools = [
    { key: 'ghl', label: 'GHL CRM', icon: '⚡', alwaysOn: true },
    ...INTEGRATIONS.map(i => ({ key: i.key, label: i.label, icon: i.icon })),
  ];
  return (
    <aside className="flex-shrink-0 md:w-48 md:flex-col md:overflow-y-auto flex flex-row overflow-x-auto border-b md:border-b-0 md:border-r"
      style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)', scrollbarWidth: 'none' }}>
      <div className="hidden md:block px-3 pt-3 pb-2 flex-shrink-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Tool Palette</p>
        <p className="text-xs text-gray-600 mt-0.5">Click to add a step</p>
      </div>
      <div className="flex md:flex-col flex-row gap-1 px-2 py-2 md:pb-3">
        {tools.map(t => {
          const enabled = t.alwaysOn || enabledKeys.has(t.key);
          const color   = TOOL_COLOR[t.key] || '#6366f1';
          return (
            <button key={t.key} onClick={() => enabled && onAdd(t.key, t.label, t.icon)}
              title={enabled ? `Add ${t.label} step` : `Connect ${t.label} in Settings first`}
              className="flex-shrink-0 flex items-center gap-2 md:gap-2.5 px-2.5 md:px-3 py-2 md:py-2.5 rounded-xl text-left transition-all"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', opacity: enabled ? 1 : 0.35, cursor: enabled ? 'pointer' : 'not-allowed' }}
              onMouseOver={e => { if (enabled) e.currentTarget.style.borderColor = `${color}60`; }}
              onMouseOut={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
            >
              <span className="text-base flex-shrink-0">{t.icon}</span>
              <div className="min-w-0">
                <div className="text-xs font-medium text-white whitespace-nowrap">{t.label}</div>
                <div className="text-xs hidden md:block" style={{ color: enabled ? color : '#6b7280' }}>
                  {enabled ? (t.alwaysOn ? 'Always on' : 'Connected ✓') : 'Not connected'}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="hidden md:flex flex-1" />
      <Link to="/settings" className="hidden md:block text-xs text-center text-indigo-400 hover:text-indigo-300 py-3">+ Connect APIs</Link>
    </aside>
  );
}

// ─── Step Node ────────────────────────────────────────────────────────────────

function StepNode({ step, index, total, context, onDelete, onMoveUp, onMoveDown, onInstruction, onConfig }) {
  const color = TOOL_COLOR[step.tool] || '#6366f1';
  const isGHL = step.tool === 'ghl';

  return (
    <div>
      {index > 0 && (
        <div className="flex flex-col items-center py-1">
          <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 11, lineHeight: 1 }}>▼</span>
        </div>
      )}
      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${color}28`, background: 'rgba(255,255,255,0.02)' }}>
        {/* Header */}
        <div className="flex items-center gap-2.5 px-3 py-2.5" style={{ background: `${color}10`, borderBottom: `1px solid ${color}20` }}>
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0" style={{ background: color, fontSize: 10 }}>{index + 1}</div>
          <span className="text-base flex-shrink-0">{step.icon}</span>
          <span className="text-xs font-semibold text-white flex-1 truncate">{step.label}</span>
          {isGHL && step.config?.action && (
            <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: `${color}20`, color }}>
              {GHL_ACTIONS.find(a => a.key === step.config.action)?.label}
            </span>
          )}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={onMoveUp}   disabled={index === 0}          className="text-gray-600 hover:text-gray-300 disabled:opacity-20 w-6 h-6 flex items-center justify-center rounded text-xs">↑</button>
            <button onClick={onMoveDown} disabled={index === total - 1}  className="text-gray-600 hover:text-gray-300 disabled:opacity-20 w-6 h-6 flex items-center justify-center rounded text-xs">↓</button>
            <button onClick={onDelete}   className="text-gray-600 hover:text-red-400 w-6 h-6 flex items-center justify-center rounded text-sm">×</button>
          </div>
        </div>

        {/* Body */}
        <div className="px-3 py-3">
          {isGHL
            ? <GHLStepConfig config={step.config || { action: null }} onChange={onConfig} />
            : (
              <textarea value={step.instruction} onChange={e => onInstruction(e.target.value)}
                placeholder={`What should ${step.label} do in this step?`}
                rows={3} className="w-full bg-transparent text-sm text-gray-300 placeholder-gray-600 outline-none resize-none leading-relaxed" />
            )
          }
        </div>
      </div>
    </div>
  );
}

// ─── GHL Step Config ──────────────────────────────────────────────────────────

function GHLStepConfig({ config, onChange }) {
  const set = (patch) => onChange({ ...config, ...patch });

  return (
    <div className="space-y-3">
      {/* Action type picker */}
      <div>
        <p className="text-xs text-gray-500 mb-2">Select GHL action</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {GHL_ACTIONS.map(a => (
            <button key={a.key} onClick={() => set({ action: a.key })}
              className="flex flex-col items-center gap-1 rounded-lg py-2 px-1 text-center transition-all"
              style={{
                background:  config.action === a.key ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)',
                border:      `1px solid ${config.action === a.key ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.07)'}`,
              }}
            >
              <span className="text-base leading-none">{a.icon}</span>
              <span className="text-xs text-white leading-tight">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Action-specific config */}
      {config.action === 'funnel' && (
        <FunnelConfig config={config} set={set} />
      )}
      {config.action === 'website' && (
        <WebsiteConfig config={config} set={set} />
      )}
      {config.action === 'blog' && (
        <BlogConfig config={config} set={set} />
      )}
      {config.action === 'email' && (
        <EmailConfig config={config} set={set} />
      )}
      {config.action === 'pipeline' && (
        <PipelineConfig config={config} set={set} />
      )}
      {config.action === 'contacts' && (
        <ContactsConfig config={config} set={set} />
      )}
      {config.action === 'social' && (
        <div>
          <label className="block text-xs text-gray-400 mb-1">What to post about</label>
          <textarea value={config.socialDetail || ''} onChange={e => set({ socialDetail: e.target.value })}
            placeholder='e.g. "Promote the new sales funnel launch. Create 3 posts with different angles."'
            rows={2} className="w-full bg-transparent text-sm text-gray-300 placeholder-gray-600 outline-none resize-none leading-relaxed field" />
        </div>
      )}
      {config.action === 'custom' && (
        <div>
          <label className="block text-xs text-gray-400 mb-1">Custom GHL instruction</label>
          <textarea value={config.customInstruction || ''} onChange={e => set({ customInstruction: e.target.value })}
            placeholder="Describe what Claude should do with GHL in this step…"
            rows={3} className="w-full bg-transparent text-sm text-gray-300 placeholder-gray-600 outline-none resize-none leading-relaxed field" />
        </div>
      )}
    </div>
  );
}

function PageChecklist({ pages, selectedPages, onToggle }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 mt-2">
      {pages.map(page => {
        const checked = !!selectedPages?.find(p => p.key === page.key);
        return (
          <div key={page.key} onClick={() => !page.req && onToggle(page)}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 transition-all"
            style={{
              background: checked ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)',
              border:     `1px solid ${checked ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.06)'}`,
              cursor:     page.req ? 'default' : 'pointer',
              opacity:    page.req ? 1 : 0.9,
            }}>
            <div className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0"
              style={{ background: checked ? '#22c55e' : 'rgba(255,255,255,0.08)', border: `1px solid ${checked ? '#22c55e' : 'rgba(255,255,255,0.2)'}` }}>
              {checked && <span style={{ color: '#fff', fontSize: '0.55rem', fontWeight: 700 }}>✓</span>}
            </div>
            <span className="text-xs text-white truncate">{page.label}</span>
            {page.req && <span className="text-xs text-gray-700 ml-auto flex-shrink-0">req</span>}
          </div>
        );
      })}
    </div>
  );
}

function FunnelConfig({ config, set }) {
  const tmpl = FUNNEL_TYPES.find(f => f.key === config.funnelType);
  const togglePage = (page) => {
    const current = config.selectedPages || [];
    const next = current.find(p => p.key === page.key) ? current.filter(p => p.key !== page.key) : [...current, page];
    set({ selectedPages: next });
  };
  const pickType = (key) => {
    const ft = FUNNEL_TYPES.find(f => f.key === key);
    set({ funnelType: key, selectedPages: ft ? ft.pages.map(p => ({ ...p })) : [] });
  };
  return (
    <div className="space-y-2">
      <label className="block text-xs text-gray-400">Funnel type</label>
      <div className="grid grid-cols-2 gap-1.5">
        {FUNNEL_TYPES.map(ft => (
          <button key={ft.key} onClick={() => pickType(ft.key)}
            className="text-left text-xs px-2.5 py-2 rounded-lg transition-all"
            style={{ background: config.funnelType === ft.key ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${config.funnelType === ft.key ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.06)'}`, color: config.funnelType === ft.key ? '#86efac' : '#9ca3af' }}>
            {ft.label}
          </button>
        ))}
      </div>
      {tmpl && (
        <>
          <label className="block text-xs text-gray-400 mt-1">Pages to create</label>
          <PageChecklist pages={tmpl.pages} selectedPages={config.selectedPages} onToggle={togglePage} />
        </>
      )}
    </div>
  );
}

function WebsiteConfig({ config, set }) {
  const tmpl = WEBSITE_TYPES.find(w => w.key === config.websiteType);
  const togglePage = (page) => {
    const current = config.selectedPages || [];
    const next = current.find(p => p.key === page.key) ? current.filter(p => p.key !== page.key) : [...current, page];
    set({ selectedPages: next });
  };
  const pickType = (key) => {
    const wt = WEBSITE_TYPES.find(w => w.key === key);
    set({ websiteType: key, selectedPages: wt ? wt.pages.map(p => ({ ...p })) : [] });
  };
  return (
    <div className="space-y-2">
      <label className="block text-xs text-gray-400">Website type</label>
      <div className="grid grid-cols-2 gap-1.5">
        {WEBSITE_TYPES.map(wt => (
          <button key={wt.key} onClick={() => pickType(wt.key)}
            className="text-left text-xs px-2.5 py-2 rounded-lg transition-all"
            style={{ background: config.websiteType === wt.key ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${config.websiteType === wt.key ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.06)'}`, color: config.websiteType === wt.key ? '#86efac' : '#9ca3af' }}>
            {wt.label}
          </button>
        ))}
      </div>
      {tmpl && (
        <>
          <label className="block text-xs text-gray-400 mt-1">Pages to create</label>
          <PageChecklist pages={tmpl.pages} selectedPages={config.selectedPages} onToggle={togglePage} />
        </>
      )}
    </div>
  );
}

function BlogConfig({ config, set }) {
  return (
    <div className="space-y-2">
      <label className="block text-xs text-gray-400">Blog post type</label>
      <div className="grid grid-cols-2 gap-1.5">
        {BLOG_TYPES.map(bt => (
          <button key={bt.key} onClick={() => set({ blogType: bt.key })}
            className="text-left text-xs px-2.5 py-2 rounded-lg transition-all"
            style={{ background: config.blogType === bt.key ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${config.blogType === bt.key ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.06)'}`, color: config.blogType === bt.key ? '#86efac' : '#9ca3af' }}>
            {bt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmailConfig({ config, set }) {
  const toggleType = (key) => {
    const current = config.emailTypes || [];
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    set({ emailTypes: next });
  };
  return (
    <div className="space-y-2">
      <label className="block text-xs text-gray-400">Emails to generate ({(config.emailTypes || []).length} selected)</label>
      <div className="grid grid-cols-2 gap-1.5">
        {EMAIL_TYPES.map(et => {
          const on = (config.emailTypes || []).includes(et.key);
          return (
            <div key={et.key} onClick={() => toggleType(et.key)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-all"
              style={{ background: on ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${on ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.06)'}` }}>
              <div className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0"
                style={{ background: on ? '#22c55e' : 'rgba(255,255,255,0.08)', border: `1px solid ${on ? '#22c55e' : 'rgba(255,255,255,0.2)'}` }}>
                {on && <span style={{ color: '#fff', fontSize: '0.55rem', fontWeight: 700 }}>✓</span>}
              </div>
              <span className="text-xs text-white">{et.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PipelineConfig({ config, set }) {
  return (
    <div className="space-y-2">
      <label className="block text-xs text-gray-400">Pipeline action</label>
      <div className="space-y-1.5">
        {PIPELINE_ACTIONS.map(pa => (
          <div key={pa.key} onClick={() => set({ pipelineAction: pa.key })}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer transition-all"
            style={{ background: config.pipelineAction === pa.key ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${config.pipelineAction === pa.key ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.06)'}` }}>
            <div className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0"
              style={{ background: config.pipelineAction === pa.key ? '#22c55e' : 'rgba(255,255,255,0.08)', border: `1px solid ${config.pipelineAction === pa.key ? '#22c55e' : 'rgba(255,255,255,0.2)'}` }}>
              {config.pipelineAction === pa.key && <span style={{ color: '#fff', fontSize: '0.55rem', fontWeight: 700 }}>✓</span>}
            </div>
            <div>
              <div className="text-xs text-white">{pa.label}</div>
              <div className="text-xs text-gray-600">{pa.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <textarea value={config.pipelineDetail || ''} onChange={e => set({ pipelineDetail: e.target.value })}
        placeholder='e.g. "Move all contacts tagged lead-hot to Proposal Sent stage"'
        rows={2} className="w-full bg-transparent text-sm text-gray-300 placeholder-gray-600 outline-none resize-none leading-relaxed field mt-1" />
    </div>
  );
}

function ContactsConfig({ config, set }) {
  return (
    <div className="space-y-2">
      <label className="block text-xs text-gray-400">Contact action</label>
      <div className="space-y-1.5">
        {CONTACT_ACTIONS.map(ca => (
          <div key={ca.key} onClick={() => set({ contactAction: ca.key })}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer transition-all"
            style={{ background: config.contactAction === ca.key ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${config.contactAction === ca.key ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.06)'}` }}>
            <div className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0"
              style={{ background: config.contactAction === ca.key ? '#22c55e' : 'rgba(255,255,255,0.08)', border: `1px solid ${config.contactAction === ca.key ? '#22c55e' : 'rgba(255,255,255,0.2)'}` }}>
              {config.contactAction === ca.key && <span style={{ color: '#fff', fontSize: '0.55rem', fontWeight: 700 }}>✓</span>}
            </div>
            <div>
              <div className="text-xs text-white">{ca.label}</div>
              <div className="text-xs text-gray-600">{ca.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <textarea value={config.contactDetail || ''} onChange={e => set({ contactDetail: e.target.value })}
        placeholder='e.g. "Search for contacts tagged lead and add them to the nurture workflow"'
        rows={2} className="w-full bg-transparent text-sm text-gray-300 placeholder-gray-600 outline-none resize-none leading-relaxed field mt-1" />
    </div>
  );
}
