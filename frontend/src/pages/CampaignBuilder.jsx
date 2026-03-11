import { useState, useCallback } from 'react';
import { useApp }         from '../context/AppContext';
import { useStreamFetch } from '../hooks/useStreamFetch';
import AuthGate     from '../components/AuthGate';
import Header       from '../components/Header';
import StreamOutput from '../components/StreamOutput';
import Spinner      from '../components/Spinner';

// ─── Data ─────────────────────────────────────────────────────────────────────

const CONTENT_TYPES = [
  { key: 'funnel',  label: 'Funnel',   icon: '🚀', desc: 'Conversion funnel — opt-in, sales, order, thank-you' },
  { key: 'website', label: 'Website',  icon: '🌐', desc: 'Multi-page informational website' },
  { key: 'blog',    label: 'Blog Post', icon: '✍️', desc: 'SEO article or news post' },
];

const FUNNEL_TEMPLATES = [
  {
    key: 'sales',
    label: 'Sales Funnel',
    desc: 'Classic product/service sale',
    pages: [
      { key: 'opt-in',    label: 'Opt-in Page',    url: 'opt-in',    required: true },
      { key: 'sales',     label: 'Sales Page',      url: 'sales',     required: true },
      { key: 'order',     label: 'Order Page',      url: 'order',     required: true },
      { key: 'upsell',    label: 'Upsell Page',     url: 'upsell',    required: false },
      { key: 'thank-you', label: 'Thank You Page',  url: 'thank-you', required: true },
    ],
  },
  {
    key: 'webinar',
    label: 'Webinar Funnel',
    desc: 'Live or recorded webinar registration',
    pages: [
      { key: 'registration', label: 'Registration Page', url: 'register',   required: true },
      { key: 'confirmation', label: 'Confirmation Page', url: 'confirm',    required: true },
      { key: 'webinar-room', label: 'Webinar Room',      url: 'webinar',    required: false },
      { key: 'replay',       label: 'Replay Page',       url: 'replay',     required: false },
      { key: 'thank-you',    label: 'Thank You Page',    url: 'thank-you',  required: true },
    ],
  },
  {
    key: 'tripwire',
    label: 'Tripwire Funnel',
    desc: 'Low-cost offer → premium upsell',
    pages: [
      { key: 'landing',   label: 'Landing Page',    url: 'landing',   required: true },
      { key: 'tripwire',  label: 'Tripwire Offer',  url: 'offer',     required: true },
      { key: 'upsell',    label: 'Upsell Page',     url: 'upsell',    required: true },
      { key: 'downsell',  label: 'Downsell Page',   url: 'downsell',  required: false },
      { key: 'thank-you', label: 'Thank You Page',  url: 'thank-you', required: true },
    ],
  },
  {
    key: 'lead-gen',
    label: 'Lead Gen Funnel',
    desc: 'Free lead magnet to capture emails',
    pages: [
      { key: 'squeeze',   label: 'Squeeze Page',    url: 'get-access', required: true },
      { key: 'thank-you', label: 'Thank You Page',  url: 'thank-you',  required: true },
    ],
  },
  {
    key: 'product-launch',
    label: 'Product Launch',
    desc: 'Build anticipation then launch',
    pages: [
      { key: 'prelaunch', label: 'Pre-launch Page',  url: 'coming-soon', required: true },
      { key: 'launch',    label: 'Launch Page',       url: 'launch',      required: true },
      { key: 'order',     label: 'Order Page',        url: 'order',       required: true },
      { key: 'thank-you', label: 'Thank You Page',    url: 'thank-you',   required: true },
    ],
  },
  {
    key: 'free-trial',
    label: 'Free Trial / SaaS',
    desc: 'Sign-up flow for software/membership',
    pages: [
      { key: 'landing',  label: 'Landing Page',   url: 'start',    required: true },
      { key: 'signup',   label: 'Sign Up Page',   url: 'sign-up',  required: true },
      { key: 'welcome',  label: 'Welcome Page',   url: 'welcome',  required: true },
    ],
  },
  {
    key: 'squeeze',
    label: 'Squeeze Page',
    desc: 'Single focused opt-in page',
    pages: [
      { key: 'squeeze',   label: 'Squeeze Page',   url: 'subscribe', required: true },
      { key: 'thank-you', label: 'Thank You Page', url: 'thank-you', required: false },
    ],
  },
  {
    key: 'membership',
    label: 'Membership Funnel',
    desc: 'Recurring subscription or course access',
    pages: [
      { key: 'sales',        label: 'Sales Page',        url: 'join',        required: true },
      { key: 'registration', label: 'Registration Page', url: 'register',    required: true },
      { key: 'member-area',  label: 'Member Area',       url: 'members',     required: false },
      { key: 'thank-you',    label: 'Thank You Page',    url: 'thank-you',   required: true },
    ],
  },
];

const WEBSITE_TEMPLATES = [
  {
    key: 'business',
    label: 'Business Website',
    desc: 'Professional company presence',
    pages: [
      { key: 'home',     label: 'Home',        url: 'home',     required: true },
      { key: 'about',    label: 'About Us',    url: 'about',    required: true },
      { key: 'services', label: 'Services',    url: 'services', required: true },
      { key: 'contact',  label: 'Contact',     url: 'contact',  required: true },
      { key: 'blog',     label: 'Blog Index',  url: 'blog',     required: false },
    ],
  },
  {
    key: 'service',
    label: 'Service Business',
    desc: 'Local or agency service provider',
    pages: [
      { key: 'home',          label: 'Home',             url: 'home',          required: true },
      { key: 'services',      label: 'Services',         url: 'services',      required: true },
      { key: 'testimonials',  label: 'Testimonials',     url: 'reviews',       required: false },
      { key: 'faq',           label: 'FAQ',              url: 'faq',           required: false },
      { key: 'contact',       label: 'Contact / Book',   url: 'contact',       required: true },
    ],
  },
  {
    key: 'portfolio',
    label: 'Portfolio / Freelancer',
    desc: 'Showcase work and attract clients',
    pages: [
      { key: 'home',      label: 'Home',      url: 'home',      required: true },
      { key: 'portfolio', label: 'Portfolio', url: 'work',      required: true },
      { key: 'about',     label: 'About',     url: 'about',     required: false },
      { key: 'contact',   label: 'Contact',   url: 'contact',   required: true },
    ],
  },
  {
    key: 'landing',
    label: 'Single Landing Page',
    desc: 'One page for a product or offer',
    pages: [
      { key: 'landing', label: 'Landing Page', url: 'home', required: true },
    ],
  },
];

const BLOG_TEMPLATES = [
  { key: 'how-to',      label: 'How-To Guide',        desc: 'Step-by-step instructional article' },
  { key: 'listicle',    label: 'Listicle',             desc: 'Top 10 / best-of list article' },
  { key: 'case-study',  label: 'Case Study',           desc: 'Result-driven story post' },
  { key: 'news',        label: 'News / Announcement',  desc: 'Company update or industry news' },
  { key: 'seo',         label: 'SEO Pillar Post',       desc: 'Long-form keyword-targeted article' },
  { key: 'comparison',  label: 'Comparison Post',       desc: 'X vs Y breakdown article' },
];

const TONES = ['Professional', 'Friendly', 'Urgent', 'Inspirational', 'Conversational', 'Authoritative', 'Educational'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyEvent(prev, evtType, data) {
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
}

function buildPrompt({ contentType, template, selectedPages, campaignName, offer, audience, tone, keywords, extra }) {
  if (contentType === 'funnel') {
    const pages = selectedPages.map(p => `  - ${p.label} (url slug: "${p.url}")`).join('\n');
    return `Build a complete ${template.label} in GHL for this campaign:

Campaign name: ${campaignName || 'My Campaign'}
Core offer: ${offer || '(describe the product or service)'}
Target audience: ${audience || '(describe the ideal customer)'}
Tone: ${tone}
${keywords ? `Keywords / niche: ${keywords}` : ''}
${extra ? `Additional notes: ${extra}` : ''}

Pages to create:
${pages}

Follow the full campaign build sequence:
1. Research the niche and define the messaging angle
2. Generate complete copy for every page (headline, subheadline, bullets, CTA, social proof)
3. Generate and upload a hero image for each page
4. Use list_funnels to find an existing funnel, then create each page with create_funnel_page using GHL native element sections
5. After creating funnel pages, create a blog post promoting this funnel
6. Create social media posts for all connected accounts
7. Report all created assets with GHL IDs and URLs`;
  }

  if (contentType === 'website') {
    const pages = selectedPages.map(p => `  - ${p.label} (url slug: "${p.url}")`).join('\n');
    return `Build a complete ${template.label} in GHL for this business:

Business / brand name: ${campaignName || 'My Business'}
What we offer: ${offer || '(describe the products or services)'}
Target audience: ${audience || '(describe the ideal customer)'}
Tone: ${tone}
${keywords ? `Industry / keywords: ${keywords}` : ''}
${extra ? `Additional notes: ${extra}` : ''}

Pages to create:
${pages}

Follow the full build sequence:
1. Research the niche and define the brand messaging
2. Generate complete copy for every page
3. Generate and upload images (hero, team photo, service images)
4. Use list_websites to find an existing website, then create each page with create_website_page using GHL native element sections
5. Report all created pages with GHL IDs and live URLs`;
  }

  if (contentType === 'blog') {
    return `Write and publish a ${template.label} blog post in GHL:

Title / topic: ${campaignName || '(your blog topic)'}
Target audience: ${audience || '(describe the reader)'}
Core message or offer: ${offer || '(what should readers do after reading)'}
Tone: ${tone}
${keywords ? `Target keywords: ${keywords}` : ''}
${extra ? `Additional notes: ${extra}` : ''}

Steps:
1. Research the topic and competitors
2. Write a complete, SEO-optimised ${template.label} post (800–1200 words)
3. Generate and upload a featured image
4. Create the post with create_blog_post using GHL native element sections
5. Create 2–3 social media posts promoting the article
6. Report the blog post URL and GHL ID`;
  }

  return '';
}

// ─── Step components ──────────────────────────────────────────────────────────

const card = (active, onClick, children) => (
  <button
    onClick={onClick}
    className={`text-left rounded-xl border transition-all p-4 w-full${active ? ' border-indigo-500' : ' border-transparent'}`}
    style={{
      background: active ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)',
      outline: active ? '1px solid #6366f1' : 'none',
    }}
  >
    {children}
  </button>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CampaignBuilder() {
  const { isAuthenticated, isAuthLoading, apiKey } = useApp();
  const { isRunning, stream, stop } = useStreamFetch();

  const [step, setStep]                 = useState(1);
  const [contentType, setContentType]   = useState(null);
  const [template, setTemplate]         = useState(null);
  const [selectedPages, setSelectedPages] = useState([]);
  const [campaignName, setCampaignName] = useState('');
  const [offer, setOffer]               = useState('');
  const [audience, setAudience]         = useState('');
  const [tone, setTone]                 = useState('Professional');
  const [keywords, setKeywords]         = useState('');
  const [extra, setExtra]               = useState('');
  const [messages, setMessages]         = useState([]);

  // Step 1 → 2
  function pickType(key) {
    setContentType(key);
    setTemplate(null);
    setSelectedPages([]);
    setStep(2);
  }

  // Step 2 → 3
  function pickTemplate(tmpl) {
    setTemplate(tmpl);
    // Pre-select all pages
    setSelectedPages(tmpl.pages ? tmpl.pages.map(p => ({ ...p })) : []);
    setStep(3);
  }

  function togglePage(page) {
    if (page.required) return; // can't deselect required pages
    setSelectedPages(prev =>
      prev.find(p => p.key === page.key)
        ? prev.filter(p => p.key !== page.key)
        : [...prev, page]
    );
  }

  const run = useCallback(async () => {
    const prompt = buildPrompt({ contentType, template, selectedPages, campaignName, offer, audience, tone, keywords, extra });
    if (!prompt) return;
    setMessages([]);
    setStep(4);
    await stream('/claude/task', { task: prompt }, (evtType, data) => {
      setMessages(prev => applyEvent(prev, evtType, data));
    }, apiKey);
  }, [contentType, template, selectedPages, campaignName, offer, audience, tone, keywords, extra, stream, apiKey]);

  if (isAuthLoading) return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🏗️" title="Campaign Builder" subtitle="Enter your location API key to continue" />
  );

  const templates = contentType === 'funnel' ? FUNNEL_TEMPLATES : contentType === 'website' ? WEBSITE_TEMPLATES : BLOG_TEMPLATES;

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: '#0f0f13' }}>
      <Header icon="🏗️" title="Campaign Builder" subtitle="Build funnels, websites & blog posts with AI" />

      {step < 4 ? (
        <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{ maxWidth: 800, margin: '0 auto', width: '100%' }}>

          {/* Progress */}
          <div className="flex items-center gap-2 mb-6">
            {[1,2,3].map(n => (
              <div key={n} className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{
                    background: step >= n ? '#6366f1' : 'rgba(255,255,255,0.08)',
                    color: step >= n ? '#fff' : '#6b7280',
                  }}
                >{n}</div>
                {n < 3 && <div className="h-px flex-1 min-w-8" style={{ background: step > n ? '#6366f1' : 'rgba(255,255,255,0.08)' }} />}
              </div>
            ))}
            <span className="text-xs text-gray-500 ml-2">
              {step === 1 ? 'Choose type' : step === 2 ? 'Choose template' : 'Details & pages'}
            </span>
          </div>

          {/* ── Step 1: content type ── */}
          {step === 1 && (
            <>
              <h2 className="text-white font-semibold text-lg mb-4">What do you want to build?</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {CONTENT_TYPES.map(ct => (
                  <button
                    key={ct.key}
                    onClick={() => pickType(ct.key)}
                    className="rounded-xl border border-transparent p-5 text-left transition-all hover:border-indigo-500"
                    style={{ background: 'rgba(255,255,255,0.04)' }}
                    onMouseOver={e => e.currentTarget.style.background = 'rgba(99,102,241,0.1)'}
                    onMouseOut={e  => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  >
                    <div className="text-3xl mb-2">{ct.icon}</div>
                    <div className="text-white font-semibold text-sm">{ct.label}</div>
                    <div className="text-gray-500 text-xs mt-1">{ct.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Step 2: template ── */}
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
                    className="rounded-xl border border-transparent p-4 text-left transition-all hover:border-indigo-500"
                    style={{ background: 'rgba(255,255,255,0.04)' }}
                    onMouseOver={e => e.currentTarget.style.background = 'rgba(99,102,241,0.1)'}
                    onMouseOut={e  => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
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

          {/* ── Step 3: details ── */}
          {step === 3 && template && (
            <>
              <div className="flex items-center gap-3 mb-4">
                <button onClick={() => setStep(2)} className="text-gray-500 hover:text-indigo-400 text-xs">← Back</button>
                <h2 className="text-white font-semibold text-lg">{template.label} — Details</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left: form */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      {contentType === 'blog' ? 'Article title / topic *' : 'Campaign / brand name *'}
                    </label>
                    <input
                      value={campaignName}
                      onChange={e => setCampaignName(e.target.value)}
                      placeholder={contentType === 'blog' ? 'e.g. "10 Ways to Generate More Leads"' : 'e.g. "FitPro 30-Day Challenge"'}
                      className="field w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      {contentType === 'blog' ? 'Core message / CTA after reading' : 'Core offer / product *'}
                    </label>
                    <input
                      value={offer}
                      onChange={e => setOffer(e.target.value)}
                      placeholder={contentType === 'blog' ? 'e.g. "Book a free consultation"' : 'e.g. "Online fitness coaching, $297/mo"'}
                      className="field w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Target audience *</label>
                    <input
                      value={audience}
                      onChange={e => setAudience(e.target.value)}
                      placeholder='e.g. "Busy moms aged 30-45 who want to lose weight"'
                      className="field w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      {contentType === 'blog' ? 'Target keywords (SEO)' : 'Niche / industry keywords'}
                    </label>
                    <input
                      value={keywords}
                      onChange={e => setKeywords(e.target.value)}
                      placeholder='e.g. "fitness coaching, weight loss, online trainer"'
                      className="field w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Tone</label>
                    <div className="flex flex-wrap gap-1.5">
                      {TONES.map(t => (
                        <button
                          key={t}
                          onClick={() => setTone(t)}
                          className="text-xs px-2.5 py-1 rounded-full border transition-all"
                          style={{
                            background:   tone === t ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                            borderColor:  tone === t ? '#6366f1' : 'rgba(255,255,255,0.08)',
                            color:        tone === t ? '#a5b4fc' : '#9ca3af',
                          }}
                        >{t}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Extra instructions (optional)</label>
                    <textarea
                      value={extra}
                      onChange={e => setExtra(e.target.value)}
                      placeholder='e.g. "Use testimonials from real clients. Include a countdown timer. Brand colors: navy and gold."'
                      rows={3}
                      className="field w-full text-sm"
                      style={{ resize: 'none' }}
                    />
                  </div>
                </div>

                {/* Right: pages checklist (funnel/website only) */}
                <div>
                  {template.pages ? (
                    <>
                      <label className="block text-xs text-gray-400 mb-2">Pages to create</label>
                      <div className="space-y-2">
                        {template.pages.map(page => {
                          const checked = !!selectedPages.find(p => p.key === page.key);
                          return (
                            <label
                              key={page.key}
                              className="flex items-center gap-3 rounded-lg p-3 cursor-pointer"
                              style={{
                                background:   checked ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)',
                                border:       `1px solid ${checked ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'}`,
                                opacity:      page.required ? 1 : 0.85,
                                cursor:       page.required ? 'default' : 'pointer',
                              }}
                              onClick={() => togglePage(page)}
                            >
                              <div
                                className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                                style={{ background: checked ? '#6366f1' : 'rgba(255,255,255,0.08)', border: `1px solid ${checked ? '#6366f1' : 'rgba(255,255,255,0.2)'}` }}
                              >
                                {checked && <span style={{ color: '#fff', fontSize: '0.65rem', fontWeight: 700 }}>✓</span>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-white">{page.label}</div>
                                <div className="text-xs text-gray-600">/{page.url}</div>
                              </div>
                              {page.required && (
                                <span className="text-xs text-gray-600 flex-shrink-0">required</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-600 mt-2">Required pages cannot be deselected. Optional pages can be added or removed.</p>
                    </>
                  ) : (
                    <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="text-white text-sm font-semibold mb-1">{template.label}</div>
                      <div className="text-gray-500 text-xs">{template.desc}</div>
                      <div className="mt-3 text-xs text-gray-500">Claude will write a full article with intro, featured image, body sections, and a CTA.</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  onClick={run}
                  disabled={!campaignName.trim() || !offer.trim() || !audience.trim()}
                  className="btn-primary px-6 py-2.5"
                >
                  🚀 Build with Claude →
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        /* ── Step 4: running ── */
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex-1 min-w-0">
              <span className="text-white text-sm font-semibold">{template?.label}</span>
              {campaignName && <span className="text-gray-500 text-xs ml-2">— {campaignName}</span>}
            </div>
            {!isRunning && (
              <button
                onClick={() => { setStep(1); setMessages([]); setContentType(null); setTemplate(null); setCampaignName(''); setOffer(''); setAudience(''); }}
                className="btn-ghost text-xs px-3 py-1.5"
              >
                ← New Build
              </button>
            )}
          </div>
          <StreamOutput
            messages={messages}
            isRunning={isRunning}
            placeholder={{ icon: '🏗️', text: 'Starting build…' }}
          />
          {isRunning && (
            <div className="p-3 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <button onClick={stop} className="btn-ghost px-4 py-2 text-sm">Stop</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
