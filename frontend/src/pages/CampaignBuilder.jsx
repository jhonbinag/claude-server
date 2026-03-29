import { useState, useCallback, useEffect } from 'react';
import { useApp }         from '../context/AppContext';
import { useStreamFetch } from '../hooks/useStreamFetch';
import AuthGate     from '../components/AuthGate';
import Header       from '../components/Header';
import StreamOutput        from '../components/StreamOutput';
import Spinner             from '../components/Spinner';
import SelfImprovementPanel from '../components/SelfImprovementPanel';

// ─── Static data ──────────────────────────────────────────────────────────────

const CONTENT_TYPES = [
  { key: 'funnel',  label: 'Funnel',    icon: '🚀', desc: 'Conversion funnel — opt-in, sales, order, thank-you' },
  { key: 'website', label: 'Website',   icon: '🌐', desc: 'Multi-page informational website' },
  { key: 'blog',    label: 'Blog Post', icon: '✍️', desc: 'SEO article or news post' },
];

const FUNNEL_TEMPLATES = [
  { key: 'sales',          label: 'Sales Funnel',        desc: 'Classic product/service sale',
    pages: [
      { key: 'opt-in',    label: 'Opt-in Page',   url: 'opt-in',    required: true },
      { key: 'sales',     label: 'Sales Page',    url: 'sales',     required: true },
      { key: 'order',     label: 'Order Page',    url: 'order',     required: true },
      { key: 'upsell',    label: 'Upsell Page',   url: 'upsell',    required: false },
      { key: 'thank-you', label: 'Thank You',     url: 'thank-you', required: true },
    ],
  },
  { key: 'webinar',        label: 'Webinar Funnel',       desc: 'Live or recorded webinar registration',
    pages: [
      { key: 'registration', label: 'Registration Page', url: 'register',  required: true },
      { key: 'confirmation', label: 'Confirmation Page', url: 'confirm',   required: true },
      { key: 'webinar-room', label: 'Webinar Room',      url: 'webinar',   required: false },
      { key: 'replay',       label: 'Replay Page',       url: 'replay',    required: false },
      { key: 'thank-you',    label: 'Thank You',         url: 'thank-you', required: true },
    ],
  },
  { key: 'tripwire',       label: 'Tripwire Funnel',      desc: 'Low-cost offer → premium upsell',
    pages: [
      { key: 'landing',  label: 'Landing Page',   url: 'landing',   required: true },
      { key: 'tripwire', label: 'Tripwire Offer', url: 'offer',     required: true },
      { key: 'upsell',   label: 'Upsell Page',    url: 'upsell',    required: true },
      { key: 'downsell', label: 'Downsell Page',  url: 'downsell',  required: false },
      { key: 'thank-you',label: 'Thank You',      url: 'thank-you', required: true },
    ],
  },
  { key: 'lead-gen',       label: 'Lead Gen Funnel',      desc: 'Free lead magnet to capture emails',
    pages: [
      { key: 'squeeze',   label: 'Squeeze Page',  url: 'get-access', required: true },
      { key: 'thank-you', label: 'Thank You',     url: 'thank-you',  required: true },
    ],
  },
  { key: 'product-launch', label: 'Product Launch',       desc: 'Build anticipation then launch',
    pages: [
      { key: 'prelaunch', label: 'Pre-launch Page', url: 'coming-soon', required: true },
      { key: 'launch',    label: 'Launch Page',     url: 'launch',      required: true },
      { key: 'order',     label: 'Order Page',      url: 'order',       required: true },
      { key: 'thank-you', label: 'Thank You',       url: 'thank-you',   required: true },
    ],
  },
  { key: 'free-trial',     label: 'Free Trial / SaaS',    desc: 'Sign-up flow for software or membership',
    pages: [
      { key: 'landing', label: 'Landing Page', url: 'start',   required: true },
      { key: 'signup',  label: 'Sign Up Page', url: 'sign-up', required: true },
      { key: 'welcome', label: 'Welcome Page', url: 'welcome', required: true },
    ],
  },
  { key: 'squeeze',        label: 'Squeeze Page',         desc: 'Single focused opt-in page',
    pages: [
      { key: 'squeeze',   label: 'Squeeze Page', url: 'subscribe', required: true },
      { key: 'thank-you', label: 'Thank You',    url: 'thank-you', required: false },
    ],
  },
  { key: 'membership',     label: 'Membership Funnel',    desc: 'Recurring subscription or course access',
    pages: [
      { key: 'sales',        label: 'Sales Page',        url: 'join',     required: true },
      { key: 'registration', label: 'Registration Page', url: 'register', required: true },
      { key: 'member-area',  label: 'Member Area',       url: 'members',  required: false },
      { key: 'thank-you',    label: 'Thank You',         url: 'thank-you',required: true },
    ],
  },
];

const WEBSITE_TEMPLATES = [
  { key: 'business',  label: 'Business Website',      desc: 'Professional company presence',
    pages: [
      { key: 'home',     label: 'Home',       url: 'home',     required: true },
      { key: 'about',    label: 'About Us',   url: 'about',    required: true },
      { key: 'services', label: 'Services',   url: 'services', required: true },
      { key: 'contact',  label: 'Contact',    url: 'contact',  required: true },
      { key: 'blog',     label: 'Blog Index', url: 'blog',     required: false },
    ],
  },
  { key: 'service',   label: 'Service Business',      desc: 'Local or agency service provider',
    pages: [
      { key: 'home',         label: 'Home',            url: 'home',    required: true },
      { key: 'services',     label: 'Services',        url: 'services',required: true },
      { key: 'testimonials', label: 'Testimonials',    url: 'reviews', required: false },
      { key: 'faq',          label: 'FAQ',             url: 'faq',     required: false },
      { key: 'contact',      label: 'Contact / Book',  url: 'contact', required: true },
    ],
  },
  { key: 'portfolio', label: 'Portfolio / Freelancer', desc: 'Showcase work and attract clients',
    pages: [
      { key: 'home',      label: 'Home',      url: 'home',    required: true },
      { key: 'portfolio', label: 'Portfolio', url: 'work',    required: true },
      { key: 'about',     label: 'About',     url: 'about',   required: false },
      { key: 'contact',   label: 'Contact',   url: 'contact', required: true },
    ],
  },
  { key: 'landing',   label: 'Single Landing Page',   desc: 'One page for a product or offer',
    pages: [
      { key: 'landing', label: 'Landing Page', url: 'home', required: true },
    ],
  },
];

const BLOG_TEMPLATES = [
  { key: 'how-to',     label: 'How-To Guide',        desc: 'Step-by-step instructional article' },
  { key: 'listicle',   label: 'Listicle',             desc: 'Top 10 / best-of list article' },
  { key: 'case-study', label: 'Case Study',           desc: 'Result-driven story post' },
  { key: 'news',       label: 'News / Announcement',  desc: 'Company update or industry news' },
  { key: 'seo',        label: 'SEO Pillar Post',       desc: 'Long-form keyword-targeted article' },
  { key: 'comparison', label: 'Comparison Post',       desc: 'X vs Y breakdown article' },
];

const TONES = ['Professional', 'Friendly', 'Urgent', 'Inspirational', 'Conversational', 'Authoritative', 'Educational'];

const EMAIL_TYPES = [
  { key: 'welcome',    label: 'Welcome',           desc: 'First email after opt-in' },
  { key: 'value',      label: 'Value / Nurture',   desc: 'Educate and build trust' },
  { key: 'case-study', label: 'Case Study',        desc: 'Social proof story' },
  { key: 'objection',  label: 'Objection Handler', desc: 'Address common hesitations' },
  { key: 'offer',      label: 'Sales / Offer',     desc: 'Direct pitch with CTA' },
  { key: 'followup',   label: 'Follow-up',         desc: 'Chase non-openers / non-buyers' },
  { key: 'reengagement', label: 'Re-engagement',   desc: 'Win back cold leads' },
];

const WORKFLOW_TRIGGERS = [
  { key: 'opt-in-form',        label: 'Opt-in form submitted' },
  { key: 'tag-added',          label: 'Tag added to contact' },
  { key: 'contact-created',    label: 'New contact created' },
  { key: 'appointment-booked', label: 'Appointment booked' },
  { key: 'purchase',           label: 'Purchase / payment made' },
  { key: 'pipeline-stage',     label: 'Pipeline stage changed' },
];

const WORKFLOW_DELAYS = ['immediately', '1 hour', '4 hours', '1 day', '2 days', '3 days', '1 week'];

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt({ contentType, template, selectedPages, campaignName, offer, audience, tone, keywords, extra, emailSeq, workflow, brainContext, brainName }) {

  // Brain knowledge context block — injected first so Claude grounds everything in it
  const brainBlock = brainContext ? `
## KNOWLEDGE BASE: "${brainName || 'Brain'}"
The following excerpts are from the brand's knowledge base. You MUST base all copy, messaging, voice, offers, and claims on this information. Do NOT invent facts, testimonials, or details that contradict or fall outside this knowledge:

${brainContext}

---
` : '';

  // Email sequence section — Claude generates copy; GHL API can't bulk-create email templates
  const emailSection = emailSeq.enabled ? `

## STEP: Generate & Document Email Sequence
Write a complete ${emailSeq.numEmails}-email follow-up sequence (one email per type selected):
${emailSeq.types.map((t, i) => `  Email ${i + 1}: ${EMAIL_TYPES.find(e => e.key === t)?.label || t}`).join('\n')}
From name: ${emailSeq.fromName || campaignName || 'the brand'}
Primary CTA in every email: ${emailSeq.cta || offer || 'visit the page / book a call'}

For EACH email write ALL of the following:
- Subject line (A/B test with 2 options)
- Preview text (1 sentence)
- Full body: opening hook, value/story paragraph, CTA paragraph
- P.S. line

After writing the sequence, output a ready-to-use summary table:
| # | Type | Subject line | Send timing |
the user will copy these directly into GHL's email builder or workflow steps.` : '';

  // Workflow section — GHL API does NOT allow creating workflows; Claude designs + gives manual setup steps
  const workflowSection = workflow.enabled ? `

## STEP: Design GHL Workflow Automation (Manual Setup Guide)
Design the complete automation sequence the user will build in GHL → Automations → Workflows.
Trigger: ${WORKFLOW_TRIGGERS.find(t => t.key === workflow.trigger)?.label || workflow.trigger}
Total steps: ${workflow.numSteps} | Delay between steps: ${workflow.delay}

Output the workflow as a numbered setup checklist:
Step 1 — Trigger: [exact trigger config in GHL UI]
${Array.from({ length: workflow.numSteps }, (_, i) => `Step ${i + 2} — Wait ${workflow.delay} → [Action: Email/SMS/Tag] — [Message or tag name]`).join('\n')}

For each action step include the FULL message copy (subject line + body for email, full text for SMS).
${emailSeq.enabled ? 'Use the email copy from the Email Sequence section above for the email action steps.' : ''}
End with: "✅ What Claude created automatically" vs "📋 What you need to set up manually in GHL" — a clear 2-column summary so the user knows exactly what is live and what still needs their attention.` : '';

  if (contentType === 'funnel') {
    const pages = selectedPages.map(p => `  - ${p.label} (url slug: "${p.url}")`).join('\n');
    return `Build a complete ${template.label} in GHL for this campaign:
${brainBlock}
Campaign name: ${campaignName || 'My Campaign'}
Core offer: ${offer || '(describe the product or service)'}
Target audience: ${audience || '(describe the ideal customer)'}
Tone: ${tone}
${keywords ? `Keywords / niche: ${keywords}` : ''}
${extra ? `Additional notes: ${extra}` : ''}

Pages to create:
${pages}

Execute this full build sequence — do NOT stop until all steps are done:
1. Research the niche and define the messaging angle
2. Generate complete copy for every page (headline, subheadline, bullets, CTA, social proof)
3. Generate and upload a hero image for each page
4. Use list_funnels to find an existing funnel, then create each page with create_funnel_page using GHL native element sections
5. Create a blog post promoting this funnel
6. Create social media posts for all connected accounts
${emailSection}${workflowSection}
7. End with a full summary: every asset created (name, type, GHL ID, URL) — then a clear "✅ Auto-created in GHL" vs "📋 Set up manually in GHL" checklist`;
  }

  if (contentType === 'website') {
    const pages = selectedPages.map(p => `  - ${p.label} (url slug: "${p.url}")`).join('\n');
    return `Build a complete ${template.label} in GHL for this business:
${brainBlock}
Business / brand name: ${campaignName || 'My Business'}
What we offer: ${offer || '(describe the products or services)'}
Target audience: ${audience || '(describe the ideal customer)'}
Tone: ${tone}
${keywords ? `Industry / keywords: ${keywords}` : ''}
${extra ? `Additional notes: ${extra}` : ''}

Pages to create:
${pages}

Execute this full build sequence — do NOT stop until all steps are done:
1. Research the niche and define the brand messaging
2. Generate complete copy for every page
3. Generate and upload images (hero, service images)
4. Use list_websites to find an existing website, then create each page with create_website_page using GHL native element sections
5. Create social media posts promoting the website
${emailSection}${workflowSection}
6. End with: every page created (name, GHL ID, URL) — then "✅ Auto-created in GHL" vs "📋 Set up manually in GHL" checklist`;
  }

  if (contentType === 'blog') {
    return `Write and publish a ${template.label} blog post in GHL:
${brainBlock}
Title / topic: ${campaignName || '(your blog topic)'}
Target audience: ${audience || '(describe the reader)'}
Core message or offer: ${offer || '(what should readers do after reading)'}
Tone: ${tone}
${keywords ? `Target keywords: ${keywords}` : ''}
${extra ? `Additional notes: ${extra}` : ''}

Execute this full build sequence — do NOT stop until all steps are done:
1. Research the topic and competitors
2. Write a complete, SEO-optimised ${template.label} post (800–1200 words)
3. Generate and upload a featured image
4. Create the post with create_blog_post using GHL native element sections
5. Create 2–3 social media posts promoting the article
${emailSection}${workflowSection}
6. End with: blog post URL + GHL ID — then "✅ Auto-created in GHL" vs "📋 Set up manually in GHL" checklist`;
  }

  return '';
}

// ─── Reusable UI atoms ────────────────────────────────────────────────────────

function Checkbox({ checked, onChange, disabled }) {
  return (
    <div
      onClick={disabled ? undefined : onChange}
      className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
      style={{
        background:  checked ? '#6366f1' : 'rgba(255,255,255,0.08)',
        border:      `1px solid ${checked ? '#6366f1' : 'rgba(255,255,255,0.2)'}`,
        cursor:      disabled ? 'default' : 'pointer',
      }}
    >
      {checked && <span style={{ color: '#fff', fontSize: '0.65rem', fontWeight: 700 }}>✓</span>}
    </div>
  );
}

function AddonToggle({ icon, title, desc, enabled, onToggle, children }) {
  return (
    <div
      className="rounded-xl border transition-all"
      style={{
        borderColor: enabled ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.07)',
        background:  enabled ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
      }}
    >
      <button
        className="w-full flex items-center gap-3 p-4 text-left"
        onClick={onToggle}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-base"
          style={{ background: enabled ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.06)' }}
        >{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="text-xs text-gray-500">{desc}</div>
        </div>
        <div
          className="w-10 h-5 rounded-full flex-shrink-0 transition-all relative"
          style={{ background: enabled ? '#6366f1' : 'rgba(255,255,255,0.12)' }}
        >
          <div
            className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
            style={{ left: enabled ? '22px' : '2px' }}
          />
        </div>
      </button>
      {enabled && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: 'rgba(99,102,241,0.2)' }}>
          <div className="pt-4">{children}</div>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const DEFAULT_EMAIL = { enabled: false, numEmails: 3, types: ['welcome', 'value', 'offer'], fromName: '', cta: '' };
const DEFAULT_WF    = { enabled: false, trigger: 'opt-in-form', numSteps: 3, delay: '1 day' };

export default function CampaignBuilder() {
  const { isAuthenticated, isAuthLoading, apiKey, locationId } = useApp();
  const { isRunning, stream, stop } = useStreamFetch();

  const [step, setStep]                   = useState(1);
  const [contentType, setContentType]     = useState(null);
  const [template, setTemplate]           = useState(null);
  const [selectedPages, setSelectedPages] = useState([]);
  const [campaignName, setCampaignName]   = useState('');
  const [offer, setOffer]                 = useState('');
  const [audience, setAudience]           = useState('');
  const [tone, setTone]                   = useState('Professional');
  const [keywords, setKeywords]           = useState('');
  const [extra, setExtra]                 = useState('');
  const [emailSeq, setEmailSeq]           = useState({ ...DEFAULT_EMAIL });
  const [workflow, setWorkflow]           = useState({ ...DEFAULT_WF });
  const [messages, setMessages]           = useState([]);

  // Brain / knowledge base
  const [brains,          setBrains]          = useState([]);
  const [selectedBrainId, setSelectedBrainId] = useState('');
  const [brainContext,    setBrainContext]     = useState('');
  const [brainLoading,    setBrainLoading]     = useState(false);

  const loc = locationId || apiKey;

  // Load available brains
  useEffect(() => {
    if (!loc) return;
    fetch('/brain/list', { headers: { 'x-location-id': loc } })
      .then(r => r.json())
      .then(d => { if (d.success) setBrains(d.data || []); })
      .catch(() => {});
  }, [loc]);

  function pickType(key) {
    setContentType(key); setTemplate(null); setSelectedPages([]); setStep(2);
  }

  function pickTemplate(tmpl) {
    setTemplate(tmpl);
    setSelectedPages(tmpl.pages ? tmpl.pages.map(p => ({ ...p })) : []);
    setStep(3);
  }

  function togglePage(page) {
    if (page.required) return;
    setSelectedPages(prev =>
      prev.find(p => p.key === page.key) ? prev.filter(p => p.key !== page.key) : [...prev, page]
    );
  }

  function toggleEmailType(key) {
    setEmailSeq(prev => {
      const has = prev.types.includes(key);
      const next = has ? prev.types.filter(k => k !== key) : [...prev.types, key];
      return { ...prev, types: next, numEmails: next.length || 1 };
    });
  }

  const run = useCallback(async () => {
    if (!contentType || !template) return;
    setMessages([]);
    setStep(4);

    // Fetch brain context before generating
    let ctx = '';
    let ctxBrainName = '';
    if (selectedBrainId && loc) {
      setBrainLoading(true);
      try {
        const q = [offer, audience, keywords, campaignName].filter(Boolean).join('. ');
        const res = await fetch(`/brain/${selectedBrainId}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-location-id': loc },
          body: JSON.stringify({ query: q, k: 12 }),
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          ctx = data.data.map(c => c.text || c.content || '').filter(Boolean).join('\n\n');
        }
        const brain = brains.find(b => b.brainId === selectedBrainId);
        ctxBrainName = brain?.name || 'Knowledge Base';
      } catch { /* non-fatal */ }
      setBrainContext(ctx);
      setBrainLoading(false);
    }

    const prompt = buildPrompt({ contentType, template, selectedPages, campaignName, offer, audience, tone, keywords, extra, emailSeq, workflow, brainContext: ctx, brainName: ctxBrainName });
    if (!prompt) return;

    await stream('/claude/task', { task: prompt }, (evtType, data) => {
      setMessages(prev => {
        if (evtType === 'text') {
          const last = prev[prev.length - 1];
          if (last?.type === 'text') return [...prev.slice(0, -1), { ...last, text: last.text + data.text }];
          return [...prev, { type: 'text', text: data.text }];
        }
        if (evtType === 'tool_call')   return [...prev, { type: 'tool_call',   name: data.name,  input: data.input }];
        if (evtType === 'tool_result') return [...prev, { type: 'tool_result', name: data.name,  result: data.result }];
        if (evtType === 'done')        return [...prev, { type: 'done',  turns: data.turns, toolCallCount: data.toolCallCount }];
        if (evtType === 'error')       return [...prev, { type: 'error', error: data.error }];
        return prev;
      });
    }, apiKey);
  }, [contentType, template, selectedPages, campaignName, offer, audience, tone, keywords, extra, emailSeq, workflow, selectedBrainId, brains, loc, stream, apiKey]);

  if (isAuthLoading) return <Spinner />;
  if (!isAuthenticated) return <AuthGate icon="🏗️" title="Campaign Builder" subtitle="Enter your location API key to continue" />;

  const templates = contentType === 'funnel' ? FUNNEL_TEMPLATES : contentType === 'website' ? WEBSITE_TEMPLATES : BLOG_TEMPLATES;

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: '#0f0f13' }}>
      <Header icon="🏗️" title="Campaign Builder" subtitle="Build funnels, websites & blog posts with AI" />

      {step < 4 ? (
        <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{ maxWidth: 860, margin: '0 auto', width: '100%' }}>

          {/* Progress bar */}
          <div className="flex items-center gap-2 mb-6">
            {[1,2,3].map(n => (
              <div key={n} className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: step >= n ? '#6366f1' : 'rgba(255,255,255,0.08)', color: step >= n ? '#fff' : '#6b7280' }}
                >{n}</div>
                {n < 3 && <div className="h-px flex-1 min-w-8" style={{ background: step > n ? '#6366f1' : 'rgba(255,255,255,0.08)' }} />}
              </div>
            ))}
            <span className="text-xs text-gray-500 ml-2">
              {step === 1 ? 'Choose type' : step === 2 ? 'Choose template' : 'Details & add-ons'}
            </span>
          </div>

          {/* ── Step 1 ── */}
          {step === 1 && (
            <>
              <h2 className="text-white font-semibold text-lg mb-4">What do you want to build?</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {CONTENT_TYPES.map(ct => (
                  <button
                    key={ct.key}
                    onClick={() => pickType(ct.key)}
                    className="rounded-xl border border-transparent p-5 text-left transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)' }}
                    onMouseOver={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; e.currentTarget.style.borderColor = '#6366f1'; }}
                    onMouseOut={e  => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'transparent'; }}
                  >
                    <div className="text-3xl mb-2">{ct.icon}</div>
                    <div className="text-white font-semibold text-sm">{ct.label}</div>
                    <div className="text-gray-500 text-xs mt-1">{ct.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && (
            <>
              <div className="flex items-center gap-3 mb-4">
                <button onClick={() => setStep(1)} className="text-gray-500 hover:text-indigo-400 text-xs">← Back</button>
                <h2 className="text-white font-semibold text-lg">
                  {contentType === 'funnel' ? 'What kind of funnel?' : contentType === 'website' ? 'What kind of website?' : 'What type of blog post?'}
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {templates.map(tmpl => (
                  <button
                    key={tmpl.key}
                    onClick={() => pickTemplate(tmpl)}
                    className="rounded-xl border border-transparent p-4 text-left transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)' }}
                    onMouseOver={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; e.currentTarget.style.borderColor = '#6366f1'; }}
                    onMouseOut={e  => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'transparent'; }}
                  >
                    <div className="text-white font-semibold text-sm">{tmpl.label}</div>
                    <div className="text-gray-500 text-xs mt-1">{tmpl.desc}</div>
                    {tmpl.pages && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {tmpl.pages.map(p => (
                          <span key={p.key} className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>{p.label}</span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Step 3 ── */}
          {step === 3 && template && (
            <>
              <div className="flex items-center gap-3 mb-4">
                <button onClick={() => setStep(2)} className="text-gray-500 hover:text-indigo-400 text-xs">← Back</button>
                <h2 className="text-white font-semibold text-lg">{template.label} — Details</h2>
              </div>

              {/* Campaign details + page checklist */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

                {/* Left: campaign fields */}
                <div className="space-y-3">

                  {/* Brain selector */}
                  {brains.length > 0 && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">
                        🧠 Knowledge Base <span className="text-gray-600">(ground all content in your brain)</span>
                      </label>
                      <div className="space-y-1.5">
                        {/* None option */}
                        <div
                          onClick={() => { setSelectedBrainId(''); setBrainContext(''); }}
                          className="flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer text-xs transition-all"
                          style={{
                            background: !selectedBrainId ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${!selectedBrainId ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'}`,
                          }}
                        >
                          <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: !selectedBrainId ? '#6366f1' : 'rgba(255,255,255,0.08)', border: `1px solid ${!selectedBrainId ? '#6366f1' : 'rgba(255,255,255,0.2)'}` }}>
                            {!selectedBrainId && <span style={{ color: '#fff', fontSize: '0.6rem', fontWeight: 700 }}>✓</span>}
                          </div>
                          <div>
                            <div className="text-white font-medium">No brain (generate from scratch)</div>
                            <div className="text-gray-600">Claude uses only the details you provide below</div>
                          </div>
                        </div>
                        {/* Brain options */}
                        {brains.map(b => {
                          const isSelected = selectedBrainId === b.brainId;
                          const health = b.docCount > 0 || b.videoCount > 0;
                          return (
                            <div
                              key={b.brainId}
                              onClick={() => setSelectedBrainId(b.brainId)}
                              className="flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer text-xs transition-all"
                              style={{
                                background: isSelected ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.03)',
                                border: `1px solid ${isSelected ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.06)'}`,
                              }}
                            >
                              <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                                style={{ background: isSelected ? '#10b981' : 'rgba(255,255,255,0.08)', border: `1px solid ${isSelected ? '#10b981' : 'rgba(255,255,255,0.2)'}` }}>
                                {isSelected && <span style={{ color: '#fff', fontSize: '0.6rem', fontWeight: 700 }}>✓</span>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-white font-medium truncate">{b.name}</div>
                                <div className="text-gray-600">
                                  {b.docCount > 0 && `${b.docCount} doc${b.docCount > 1 ? 's' : ''}`}
                                  {b.docCount > 0 && b.videoCount > 0 && ' · '}
                                  {b.videoCount > 0 && `${b.videoCount} video${b.videoCount > 1 ? 's' : ''}`}
                                  {!health && 'Empty brain'}
                                </div>
                              </div>
                              {isSelected && (
                                <span className="flex-shrink-0 text-green-400 text-xs font-medium">Active</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {selectedBrainId && (
                        <p className="text-xs text-green-400 mt-1.5">
                          🧠 All content will be grounded in "{brains.find(b => b.brainId === selectedBrainId)?.name || 'Brain'}" — Claude will match the exact voice, offers and facts from your knowledge base.
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      {contentType === 'blog' ? 'Article title / topic *' : 'Campaign / brand name *'}
                    </label>
                    <input value={campaignName} onChange={e => setCampaignName(e.target.value)}
                      placeholder={contentType === 'blog' ? 'e.g. "10 Ways to Generate More Leads"' : 'e.g. "FitPro 30-Day Challenge"'}
                      className="field w-full text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      {contentType === 'blog' ? 'Core message / CTA after reading *' : 'Core offer / product *'}
                    </label>
                    <input value={offer} onChange={e => setOffer(e.target.value)}
                      placeholder={contentType === 'blog' ? 'e.g. "Book a free consultation"' : 'e.g. "Online fitness coaching, $297/mo"'}
                      className="field w-full text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Target audience *</label>
                    <input value={audience} onChange={e => setAudience(e.target.value)}
                      placeholder='e.g. "Busy moms aged 30-45 who want to lose weight"'
                      className="field w-full text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">{contentType === 'blog' ? 'Target keywords (SEO)' : 'Niche / industry keywords'}</label>
                    <input value={keywords} onChange={e => setKeywords(e.target.value)}
                      placeholder='e.g. "fitness coaching, weight loss, online trainer"'
                      className="field w-full text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Tone</label>
                    <div className="flex flex-wrap gap-1.5">
                      {TONES.map(t => (
                        <button key={t} onClick={() => setTone(t)}
                          className="text-xs px-2.5 py-1 rounded-full border transition-all"
                          style={{
                            background:  tone === t ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                            borderColor: tone === t ? '#6366f1' : 'rgba(255,255,255,0.08)',
                            color:       tone === t ? '#a5b4fc' : '#9ca3af',
                          }}
                        >{t}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Extra instructions (optional)</label>
                    <textarea value={extra} onChange={e => setExtra(e.target.value)}
                      placeholder='e.g. "Use testimonials from real clients. Brand colors: navy and gold."'
                      rows={3} className="field w-full text-sm" style={{ resize: 'none' }} />
                  </div>
                </div>

                {/* Right: pages checklist */}
                <div>
                  {template.pages ? (
                    <>
                      <label className="block text-xs text-gray-400 mb-2">Pages to create</label>
                      <div className="space-y-2">
                        {template.pages.map(page => {
                          const checked = !!selectedPages.find(p => p.key === page.key);
                          return (
                            <div
                              key={page.key}
                              className="flex items-center gap-3 rounded-lg p-3"
                              style={{
                                background: checked ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)',
                                border: `1px solid ${checked ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'}`,
                                cursor: page.required ? 'default' : 'pointer',
                                opacity: page.required ? 1 : 0.9,
                              }}
                              onClick={() => togglePage(page)}
                            >
                              <Checkbox checked={checked} onChange={() => togglePage(page)} disabled={page.required} />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-white">{page.label}</div>
                                <div className="text-xs text-gray-600">/{page.url}</div>
                              </div>
                              {page.required && <span className="text-xs text-gray-600">required</span>}
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-600 mt-2">Required pages are always included.</p>
                    </>
                  ) : (
                    <div className="rounded-xl p-4 h-full" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="text-white text-sm font-semibold mb-1">{template.label}</div>
                      <div className="text-gray-500 text-xs">{template.desc}</div>
                      <div className="mt-3 text-xs text-gray-500 leading-relaxed">Claude will write a full article with intro, featured image, structured body sections, and a CTA — then publish it directly to GHL.</div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Add-ons ── */}
              <div className="space-y-3 mb-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Add-ons (optional)</p>

                {/* Email Sequence */}
                <AddonToggle
                  icon="✉️"
                  title="Email Sequence"
                  desc="Claude writes complete email copy — subject lines, body, P.S. — ready to paste into GHL"
                  enabled={emailSeq.enabled}
                  onToggle={() => setEmailSeq(p => ({ ...p, enabled: !p.enabled }))}
                >
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs text-gray-400 mb-2">Select emails to include ({emailSeq.types.length} selected)</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {EMAIL_TYPES.map(et => {
                          const on = emailSeq.types.includes(et.key);
                          return (
                            <div
                              key={et.key}
                              className="flex items-center gap-2.5 rounded-lg p-2.5 cursor-pointer"
                              style={{
                                background: on ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)',
                                border: `1px solid ${on ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'}`,
                              }}
                              onClick={() => toggleEmailType(et.key)}
                            >
                              <Checkbox checked={on} onChange={() => toggleEmailType(et.key)} />
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-white">{et.label}</div>
                                <div className="text-xs text-gray-600">{et.desc}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">From name</label>
                        <input value={emailSeq.fromName} onChange={e => setEmailSeq(p => ({ ...p, fromName: e.target.value }))}
                          placeholder='e.g. "Sarah from FitPro"' className="field w-full text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Primary CTA / destination</label>
                        <input value={emailSeq.cta} onChange={e => setEmailSeq(p => ({ ...p, cta: e.target.value }))}
                          placeholder='e.g. "Book a free call" or paste the funnel URL' className="field w-full text-sm" />
                      </div>
                    </div>
                  </div>
                </AddonToggle>

                {/* Workflow Automation */}
                <AddonToggle
                  icon="⚡"
                  title="Workflow Automation"
                  desc="Claude designs the full automation sequence + step-by-step GHL setup guide (GHL API doesn't support auto-creating workflows)"
                  enabled={workflow.enabled}
                  onToggle={() => setWorkflow(p => ({ ...p, enabled: !p.enabled }))}
                >
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs text-gray-400 mb-2">Workflow trigger</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {WORKFLOW_TRIGGERS.map(tr => (
                          <div
                            key={tr.key}
                            className="flex items-center gap-2.5 rounded-lg p-2.5 cursor-pointer"
                            style={{
                              background: workflow.trigger === tr.key ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)',
                              border: `1px solid ${workflow.trigger === tr.key ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'}`,
                            }}
                            onClick={() => setWorkflow(p => ({ ...p, trigger: tr.key }))}
                          >
                            <Checkbox checked={workflow.trigger === tr.key} onChange={() => setWorkflow(p => ({ ...p, trigger: tr.key }))} />
                            <div className="text-xs text-white">{tr.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-2">Number of steps</label>
                        <div className="flex gap-1.5 flex-wrap">
                          {[2,3,4,5,6,7].map(n => (
                            <button key={n} onClick={() => setWorkflow(p => ({ ...p, numSteps: n }))}
                              className="w-8 h-8 rounded-lg text-xs font-semibold transition-all"
                              style={{
                                background:  workflow.numSteps === n ? '#6366f1' : 'rgba(255,255,255,0.06)',
                                color:       workflow.numSteps === n ? '#fff'    : '#9ca3af',
                              }}
                            >{n}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-2">Delay between steps</label>
                        <div className="flex flex-wrap gap-1.5">
                          {WORKFLOW_DELAYS.map(d => (
                            <button key={d} onClick={() => setWorkflow(p => ({ ...p, delay: d }))}
                              className="text-xs px-2 py-1 rounded-full border transition-all"
                              style={{
                                background:  workflow.delay === d ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                                borderColor: workflow.delay === d ? '#6366f1' : 'rgba(255,255,255,0.08)',
                                color:       workflow.delay === d ? '#a5b4fc' : '#9ca3af',
                              }}
                            >{d}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </AddonToggle>
              </div>

              <div className="flex items-center justify-between">
                {selectedBrainId ? (
                  <p className="text-xs text-green-500">
                    🧠 Brain: {brains.find(b => b.brainId === selectedBrainId)?.name || 'Selected'}
                  </p>
                ) : (
                  <span />
                )}
                <button
                  onClick={run}
                  disabled={!campaignName.trim() || !offer.trim() || !audience.trim() || brainLoading}
                  className="btn-primary px-6 py-2.5"
                >
                  {brainLoading ? '🧠 Loading brain…' : '🚀 Build with Claude →'}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        /* ── Step 4: output ── */
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
              <span className="text-white text-sm font-semibold">{template?.label}</span>
              {campaignName && <span className="text-gray-500 text-xs">— {campaignName}</span>}
              {emailSeq.enabled && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>✉️ Email sequence</span>}
              {workflow.enabled  && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>⚡ Workflow</span>}
              {brainContext && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.15)', color: '#6ee7b7' }}>🧠 {brains.find(b => b.brainId === selectedBrainId)?.name || 'Brain'}</span>}
            </div>
            {!isRunning && (
              <button
                onClick={() => {
                  setStep(1); setMessages([]); setContentType(null); setTemplate(null);
                  setCampaignName(''); setOffer(''); setAudience('');
                  setEmailSeq({ ...DEFAULT_EMAIL }); setWorkflow({ ...DEFAULT_WF });
                  setBrainContext('');
                }}
                className="btn-ghost text-xs px-3 py-1.5"
              >← New Build</button>
            )}
          </div>
          <StreamOutput messages={messages} isRunning={isRunning} placeholder={{ icon: '🏗️', text: 'Starting build…' }} />
          {isRunning && (
            <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <button onClick={stop} className="btn-ghost px-4 py-2 text-sm">Stop</button>
            </div>
          )}
          {/* Auto-improve campaign copy after streaming completes */}
          {!isRunning && messages.length > 0 && (() => {
            const text = messages.filter(m => m.type === 'text').map(m => m.text).join('').trim();
            if (!text) return null;
            return (
              <div className="p-4 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <SelfImprovementPanel
                  type={emailSeq.enabled ? 'manychat_message' : 'funnel_page'}
                  artifact={text.slice(0, 4000)}
                  context={{
                    campaignName, offer, audience, tone, contentType,
                    ...(brainContext ? {
                      knowledgeBase: brainContext.slice(0, 2000),
                      instruction: `All improvements MUST stay grounded in the knowledge base. Do not add claims, testimonials, or details that contradict the brand's documented information.`,
                    } : {}),
                  }}
                  label="Campaign Copy"
                  autoStart={true}
                  continuous={true}
                  onApply={(improved) => setMessages(prev => {
                    const nonText = prev.filter(m => m.type !== 'text');
                    return [...nonText, { type: 'text', text: improved }];
                  })}
                />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
