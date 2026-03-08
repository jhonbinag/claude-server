import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useApp }          from '../context/AppContext';
import { useStreamFetch }  from '../hooks/useStreamFetch';
import AuthGate      from '../components/AuthGate';
import Header        from '../components/Header';
import StreamOutput  from '../components/StreamOutput';
import Spinner       from '../components/Spinner';

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
  const { isAuthenticated, isAuthLoading, apiKey, enabledTools, integrations } = useApp();
  const [task, setTask]       = useState('');
  const [messages, setMessages] = useState([]);
  const { isRunning, stream, stop } = useStreamFetch();

  const run = useCallback(async (taskText) => {
    if (!taskText.trim() || isRunning) return;
    setMessages([]);
    await stream('/claude/task', { task: taskText.trim() }, (evtType, data) => {
      setMessages(prev => applyEvent(prev, evtType, data));
    }, apiKey);
  }, [isRunning, stream, apiKey]);

  const handleSubmit = () => { run(task); };
  const handleChip   = (prompt) => { setTask(prompt); run(prompt); };

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🤖" title="GTM AI Command Center" subtitle="Enter your location API key to continue">
      <p className="text-center text-xs text-gray-600 mt-4">
        Get your key from GHL → Settings → API Keys
      </p>
    </AuthGate>
  );

  const connected = (integrations || []).filter(i => i.enabled);

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: '#0f0f13' }}>
      <Header
        icon="🤖"
        title="GTM AI Command Center"
        subtitle={`Claude Opus 4.6 · ${enabledTools.length} tools active · ${connected.length} integrations`}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside
          className="w-64 glass flex flex-col overflow-y-auto flex-shrink-0"
          style={{ borderRight: '1px solid rgba(255,255,255,0.08)' }}
        >
          {/* GHL */}
          <div className="p-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-2 mb-1">
              <span>⚡</span>
              <span className="text-sm font-semibold text-white">GoHighLevel</span>
              <span className="ml-auto badge-on text-xs px-2 py-0.5 rounded-full">Connected</span>
            </div>
            <p className="text-xs text-gray-500">CRM, contacts, workflows, blogs</p>
          </div>

          {/* Integrations */}
          <div className="p-4 flex-1">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Integrations</span>
              <Link to="/settings" className="text-xs text-indigo-400 hover:text-indigo-300">+ Connect</Link>
            </div>
            <div className="space-y-1.5">
              {(integrations || []).length === 0 && (
                <div className="text-xs text-gray-600 text-center py-4">Loading…</div>
              )}
              {(integrations || []).map(item => (
                <div
                  key={item.key}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                >
                  <span className="text-base flex-shrink-0">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white truncate">{item.label}</div>
                    <div className="text-xs text-gray-600">{item.toolCount} tools</div>
                  </div>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.enabled ? 'bg-green-400' : 'bg-gray-700'}`} />
                </div>
              ))}
            </div>
            {connected.length === 0 && (
              <Link to="/settings" className="block mt-4 text-center text-xs text-indigo-400 hover:underline">
                Connect your first integration →
              </Link>
            )}
          </div>

          {/* Links */}
          <div className="p-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Quick links</p>
            <div className="space-y-1">
              <Link to="/workflows"     className="block text-xs text-gray-400 hover:text-indigo-400 py-1">🔀 Workflow Builder</Link>
              <Link to="/ads-generator" className="block text-xs text-gray-400 hover:text-indigo-400 py-1">🎯 Bulk Ads Generator</Link>
              <Link to="/settings"      className="block text-xs text-gray-400 hover:text-indigo-400 py-1">⚙️ Integration Settings</Link>
            </div>
          </div>
        </aside>

        {/* ── Main ─────────────────────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Quick action chips */}
          <div
            className="p-3.5 flex flex-wrap gap-2 flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.15)' }}
          >
            {QUICK_ACTIONS.map(({ label, prompt }) => (
              <button
                key={label}
                onClick={() => handleChip(prompt)}
                disabled={isRunning}
                className="text-xs px-3 py-1.5 rounded-full border transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  borderColor: 'rgba(255,255,255,0.08)',
                  color: '#9ca3af',
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
          />

          {/* Input */}
          <div
            className="p-4 flex-shrink-0"
            style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="flex gap-3 items-end">
              <textarea
                value={task}
                onChange={e => setTask(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder="Describe what you want Claude to do across your connected tools…"
                rows={3}
                className="field flex-1 text-sm leading-relaxed"
                style={{ resize: 'none' }}
              />
              <div className="flex flex-col gap-2 flex-shrink-0">
                <button
                  onClick={isRunning ? stop : handleSubmit}
                  disabled={!isRunning && !task.trim()}
                  className="btn-primary px-5 py-2.5 gap-2"
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
            <p className="text-xs text-gray-600 mt-2">
              Enter to run · Shift+Enter for new line · Claude chains tool calls automatically
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
