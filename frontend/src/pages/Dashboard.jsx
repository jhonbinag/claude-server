import { useState, useCallback, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp }          from '../context/AppContext';
import { useStreamFetch }  from '../hooks/useStreamFetch';
import AuthGate      from '../components/AuthGate';
import Header        from '../components/Header';
import StreamOutput  from '../components/StreamOutput';
import Spinner       from '../components/Spinner';

// ── Voice input hook (Web Speech API) ────────────────────────────────────────
function useVoice(onTranscript) {
  const [listening, setListening]     = useState(false);
  const [supported, setSupported]     = useState(false);
  const [elapsed, setElapsed]         = useState(0);       // seconds
  const [liveText, setLiveText]       = useState('');      // interim preview
  const recognitionRef                = useRef(null);
  const finalTextRef                  = useRef('');        // accumulated finals
  const timerRef                      = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    setSupported(true);
    const r = new SR();
    r.continuous     = true;   // keep recording until user stops
    r.interimResults = true;
    r.lang           = 'en-US';

    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTextRef.current += t + ' ';
        else interim += t;
      }
      setLiveText(interim);
    };

    r.onerror = () => stopRecording(r);
    r.onend   = () => {
      // auto-restart if still listening (browser cuts off after ~60s silence)
      if (recognitionRef.current?._keepGoing) {
        try { r.start(); } catch (_) { stopRecording(r); }
      }
    };

    recognitionRef.current = r;
    return () => { r._keepGoing = false; r.abort(); clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopRecording(r) {
    if (!r) return;
    r._keepGoing = false;
    r.stop();
    clearInterval(timerRef.current);
    setListening(false);
    setElapsed(0);
    setLiveText('');
    const text = finalTextRef.current.trim();
    finalTextRef.current = '';
    if (text) onTranscript(text);
  }

  const toggle = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    if (listening) {
      stopRecording(r);
    } else {
      finalTextRef.current = '';
      setElapsed(0);
      setLiveText('');
      r._keepGoing = true;
      r.start();
      setListening(true);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);

  return { listening, supported, toggle, elapsed, liveText };
}

const QUICK_ACTIONS = [
  { label: 'Search contacts',       prompt: 'List the 10 most recently added contacts in GHL.' },
  { label: 'Active opportunities',  prompt: 'Show all open opportunities and their pipeline stages.' },
  { label: 'Pending appointments',  prompt: 'List all upcoming appointments for the next 7 days.' },
  { label: 'List workflows',        prompt: 'List all available GHL workflows and their status.' },
  { label: 'Bulk SMS draft',        prompt: 'Draft an SMS to all contacts tagged "lead". Show me the message before sending.' },
  { label: 'Research competitor',   prompt: 'Research our top 3 competitors using Perplexity and summarize their positioning.' },
  { label: 'Write blog post',       prompt: 'Write a 600-word SEO blog post about [topic]. Format it for GHL blog.' },
  { label: 'Create invoice',        prompt: 'List all GHL products and show me the steps to create a new invoice.' },
  { label: 'Apollo prospecting',    prompt: 'Find 10 marketing directors at SaaS companies using Apollo and add them as GHL contacts tagged "apollo-lead".' },
  { label: 'Email campaign',        prompt: 'Draft a promotional email campaign and send via SendGrid to all contacts tagged "subscribed".' },
  { label: 'Social post drafts',    prompt: 'List my connected social accounts, then create 3 engaging social media post drafts (status: DRAFT) for me to review in the Social Planner. Ask me for the topic or promotion first.' },
  { label: 'Week of social content',prompt: 'List my connected social accounts, then generate a full week of social media content (7 posts, one per day) and save each as DRAFT in the Social Planner. Ask me for the brand/topic first.' },
];

// Accumulate streamed text into messages array
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

export default function Dashboard() {
  const { isAuthenticated, isAuthLoading, apiKey, claudeReady, enabledTools, integrations, integrationsLoaded } = useApp();
  const [task, setTask]         = useState('');
  const [messages, setMessages] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isRunning, stream, stop } = useStreamFetch();

  const { listening, supported: voiceSupported, toggle: toggleVoice, elapsed, liveText } = useVoice(
    (transcript) => setTask(prev => (prev ? prev + ' ' + transcript : transcript))
  );

  const navigate = useNavigate();

  const run = useCallback(async (taskText) => {
    if (!taskText.trim() || isRunning) return;
    setMessages([]);
    await stream('/claude/task', { task: taskText.trim() }, (evtType, data) => {
      setMessages(prev => applyEvent(prev, evtType, data));
    }, apiKey);
  }, [isRunning, stream, apiKey]);

  const handleSubmit = () => { run(task); };
  const handleChip   = (prompt) => { setTask(prompt); run(prompt); setSidebarOpen(false); };

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🤖" title="GTM AI Command Center" subtitle="Enter your location API key to continue">
      <p className="text-center text-xs text-gray-600 mt-4">
        Get your key from GHL → Settings → API Keys
      </p>
    </AuthGate>
  );

  const connected = (integrations || []).filter(i => i.enabled);

  // Group social and payment tools into summary entries
  // ghl_social_planner = GHL-connected accounts; social_* = direct OAuth connections
  const SOCIAL_KEYS  = ['ghl_social_planner','social_facebook','social_instagram','social_tiktok_organic','social_youtube','social_linkedin_organic','social_pinterest','social_twitter','social_gmb'];
  const PAYMENT_KEYS = ['stripe','paypal','square','authorizenet'];

  const socialConnected  = connected.filter(i => SOCIAL_KEYS.includes(i.key));
  const paymentConnected = connected.filter(i => PAYMENT_KEYS.includes(i.key));
  // Exclude zero-toolCount items (e.g. ghl_social_planner) from individual display — they belong in groups only
  const otherConnected   = connected.filter(i => !SOCIAL_KEYS.includes(i.key) && !PAYMENT_KEYS.includes(i.key) && (i.toolCount || 0) > 0);

  // Count unique connected social platforms:
  // ghl_social_planner stores a platforms[] array; individual social_* keys each = 1 platform
  const socialPlatforms = new Set();
  socialConnected.forEach(i => {
    if (i.key === 'ghl_social_planner') {
      (i.configPreview?.platforms || []).forEach(p => socialPlatforms.add(p));
    } else {
      socialPlatforms.add(i.key.replace('social_', '').replace('_organic', ''));
    }
  });
  const socialCount = socialPlatforms.size || socialConnected.length;

  const sidebarItems = [
    ...otherConnected,
    ...(socialConnected.length  > 0 ? [{ key: '__social_hub', label: 'Social Hub',      icon: '📱', count: socialCount            }] : []),
    ...(paymentConnected.length > 0 ? [{ key: '__payment_gw', label: 'Payment Gateway', icon: '💳', count: paymentConnected.length }] : []),
  ];

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: '#0f0f13' }}>
      <Header
        icon="🤖"
        title="GTM AI Command Center"
        subtitle={`Claude Opus 4.6 · ${enabledTools.length} active tools · ${connected.length} connected`}
        onMenuClick={() => setSidebarOpen(v => !v)}
      />

      <div className="flex flex-1 overflow-hidden" style={{ position: 'relative' }}>

        {/* ── Backdrop overlay (mobile only) ──────────────────────────────── */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 lg:hidden"
            style={{ background: 'rgba(0,0,0,0.55)', zIndex: 25 }}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Sidebar drawer ───────────────────────────────────────────────── */}
        <aside
          className={`sidebar-drawer ${sidebarOpen ? 'open' : 'closed'} w-64 glass flex flex-col overflow-y-auto flex-shrink-0`}
          style={{ borderRight: '1px solid rgba(255,255,255,0.08)' }}
        >
          {/* Close button (mobile only) */}
          <div className="flex items-center justify-between p-3 lg:hidden" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Menu</span>
            <button onClick={() => setSidebarOpen(false)} className="nav-link text-gray-500" style={{ padding: '4px 8px' }}>✕</button>
          </div>

          {/* GHL */}
          <div className="p-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-2 mb-1">
              <span>⚡</span>
              <span className="text-sm font-semibold text-white">GoHighLevel</span>
              <span className="ml-auto badge-on text-xs px-2 py-0.5 rounded-full">Connected</span>
            </div>
            <p className="text-xs text-gray-500">CRM, contacts, workflows, blogs</p>
          </div>

          {/* Integrations — only show connected ones */}
          <div className="p-4 flex-1">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Active Tools {connected.length > 0 && <span className="text-gray-600 normal-case font-normal">({connected.length})</span>}
              </span>
              <Link to="/settings" className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => setSidebarOpen(false)}>+ Connect</Link>
            </div>
            <div className="space-y-1.5">
              {!integrationsLoaded && (
                <div className="text-xs text-gray-600 text-center py-4">Loading…</div>
              )}
              {integrationsLoaded && connected.length === 0 && (
                <div className="text-xs text-gray-600 text-center py-4">No integrations connected yet</div>
              )}
              {sidebarItems.map(item => (
                <div
                  key={item.key}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                >
                  <span className="text-base flex-shrink-0">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white truncate">{item.label}</div>
                    {item.count != null
                      ? <div className="text-xs text-green-400">{item.count} connected</div>
                      : <div className="text-xs text-gray-600">{item.toolCount} tools</div>
                    }
                  </div>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                </div>
              ))}
            </div>
            {connected.length === 0 && (
              <Link to="/settings" className="block mt-3 text-center text-xs text-indigo-400 hover:underline" onClick={() => setSidebarOpen(false)}>
                Connect your first integration →
              </Link>
            )}
          </div>

          {/* Links */}
          <div className="p-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Quick links</p>
            <div className="space-y-1">
              <Link to="/campaign-builder" onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">🏗️ Campaign Builder</Link>
              <Link to="/workflows"        onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">🔀 Workflow Builder</Link>
              <Link to="/ads-generator"    onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">🎯 Bulk Ads Generator</Link>
              <Link to="/social"            onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">📱 Social Planner</Link>
              <Link to="/ad-library"       onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">📊 Ad Library Intel</Link>
              <Link to="/settings"         onClick={() => setSidebarOpen(false)} className="block text-xs text-gray-400 hover:text-indigo-400 py-1">⚙️ Integration Settings</Link>
            </div>
          </div>
        </aside>

        {/* ── Main ─────────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Claude API key banner */}
          {!claudeReady && (
            <div
              className="flex items-center justify-between gap-3 px-4 py-2.5 flex-shrink-0"
              style={{ background: 'rgba(251,191,36,0.08)', borderBottom: '1px solid rgba(251,191,36,0.2)' }}
            >
              <div className="min-w-0">
                <span className="text-yellow-400 text-xs font-semibold">⚠️ Anthropic API key required</span>
                <span className="text-gray-400 text-xs ml-1 hidden sm:inline">Add your key in Settings to activate Claude.</span>
              </div>
              <button
                onClick={() => navigate('/settings')}
                className="btn-primary px-3 py-1.5 text-xs whitespace-nowrap flex-shrink-0"
              >
                Add Key →
              </button>
            </div>
          )}

          {/* Quick action chips — horizontal carousel */}
          <div
            className="chips-row flex-shrink-0 gap-2 px-3 py-2.5"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.15)' }}
          >
            {QUICK_ACTIONS.map(({ label, prompt }) => (
              <button
                key={label}
                onClick={() => handleChip(prompt)}
                disabled={isRunning}
                className="text-xs px-3 py-1.5 rounded-full border transition-all flex-shrink-0"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  borderColor: 'rgba(255,255,255,0.08)',
                  color: '#9ca3af',
                  whiteSpace: 'nowrap',
                }}
                onMouseOver={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#a5b4fc'; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#9ca3af'; }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Stream output */}
          <StreamOutput
            messages={messages}
            isRunning={isRunning}
            placeholder={{
              icon: '🤖',
              text: 'Type a task below or click a quick action\nClaude will use all your connected tools automatically',
            }}
            voice={{ listening, supported: voiceSupported, toggle: toggleVoice, elapsed, liveText }}
          />

          {/* Input */}
          <div
            className="p-3 flex-shrink-0"
            style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
          >
            {/* Listening indicator bar */}
            {listening && (
              <div
                className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-xl text-xs font-medium"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse 1s infinite' }} />
                Listening… speak your command, then pause to finish
              </div>
            )}

            <div className="flex gap-2 items-end">
              <div className="relative flex-1">
                <textarea
                  value={task}
                  onChange={e => setTask(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                  placeholder={listening ? 'Listening…' : 'Describe what you want Claude to do…'}
                  rows={3}
                  className="field w-full text-sm leading-relaxed"
                  style={{ resize: 'none', paddingRight: voiceSupported ? '2.75rem' : undefined }}
                />
                {/* Mic button — inside textarea (bottom-right corner) */}
                {voiceSupported && (
                  <button
                    onClick={toggleVoice}
                    title={listening ? 'Stop recording' : 'Voice input'}
                    style={{
                      position: 'absolute',
                      bottom: '8px',
                      right: '10px',
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      border: listening ? '1.5px solid #ef4444' : '1.5px solid rgba(255,255,255,0.15)',
                      background: listening ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      fontSize: 14,
                      animation: listening ? 'pulse 1s infinite' : 'none',
                    }}
                  >
                    {listening ? '⏹' : '🎤'}
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2 flex-shrink-0">
                <button
                  onClick={isRunning ? stop : handleSubmit}
                  disabled={!isRunning && !task.trim()}
                  className="btn-primary px-4 py-2.5 gap-2"
                >
                  {isRunning
                    ? <><span className="spinner w-4 h-4 rounded-full border-2" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> Stop</>
                    : '▶ Run'}
                </button>
                {messages.length > 0 && (
                  <button onClick={() => setMessages([])} className="btn-ghost px-3 py-1.5 text-xs">Clear</button>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-1.5 hidden sm:block">
              Enter to run · Shift+Enter for new line · {voiceSupported ? '🎤 Click mic or ' : ''}Claude chains tool calls automatically
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
