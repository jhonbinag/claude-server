import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useApp }         from '../context/AppContext';
import { useStreamFetch } from '../hooks/useStreamFetch';
import AuthGate     from '../components/AuthGate';
import Header       from '../components/Header';
import StreamOutput from '../components/StreamOutput';
import Spinner      from '../components/Spinner';
import { INTEGRATIONS } from '../lib/integrations';

const MAX_SAVED = 20;
const STORAGE_KEY = 'gtm_workflows';

const TEMPLATES = [
  {
    name: '🔍 Research & Report',
    context: 'Research assistant workflow',
    prompt: 'Research [topic] using Perplexity and compile a detailed report. Include key insights, statistics, and competitive analysis. Format as a professional summary.',
    tools: ['perplexity', 'openai'],
  },
  {
    name: '📧 Email Campaign',
    context: 'Email marketing workflow',
    prompt: 'Draft a promotional email campaign for [product/offer]. Write 3 subject line variations and the full email body. Then send via SendGrid to all GHL contacts tagged "subscribed".',
    tools: ['sendgrid', 'openai'],
  },
  {
    name: '📱 Social Content',
    context: 'Social media workflow',
    prompt: 'Create a week\'s worth of social media content for [brand/topic]. Include captions, hashtags, and image prompts for each post. Notify the team on Slack when ready.',
    tools: ['openai', 'slack'],
  },
  {
    name: '🚀 Lead Outreach',
    context: 'Sales prospecting workflow',
    prompt: 'Find 10 [job title] at [industry] companies using Apollo. Enrich their profiles, add them to GHL as contacts tagged "apollo-lead", and draft a personalised outreach email for each.',
    tools: ['apollo', 'sendgrid'],
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

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function saveToDisk(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
}

export default function Workflows() {
  const { isAuthenticated, isAuthLoading, apiKey, integrations } = useApp();
  const { isRunning, stream, stop } = useStreamFetch();

  // Node toggles — keys of active external integrations
  const [activeTools, setActiveTools] = useState(new Set());
  // Workflow fields
  const [wfName,    setWfName]    = useState('');
  const [wfContext, setWfContext] = useState('');
  const [prompt,    setPrompt]    = useState('');
  // Output
  const [messages, setMessages] = useState([]);
  // Saved workflows (localStorage)
  const [saved,    setSaved]    = useState(loadSaved);

  // Sync activeTools when integrations load (auto-enable connected ones)
  const didSync = useRef(false);
  useEffect(() => {
    if (!didSync.current && integrations?.length > 0) {
      didSync.current = true;
      const connected = new Set(integrations.filter(i => i.enabled).map(i => i.key));
      setActiveTools(connected);
    }
  }, [integrations]);

  const toggleTool = key =>
    setActiveTools(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const run = useCallback(async () => {
    if (!prompt.trim() || isRunning) return;
    setMessages([]);
    const allowedIntegrations = activeTools.size > 0 ? [...activeTools] : null;
    const taskText = wfContext.trim()
      ? `[Context: ${wfContext.trim()}]\n\n${prompt.trim()}`
      : prompt.trim();

    await stream(
      '/claude/task',
      { task: taskText, allowedIntegrations },
      (evtType, data) => setMessages(prev => applyEvent(prev, evtType, data)),
      apiKey,
    );
  }, [prompt, wfContext, isRunning, stream, apiKey, activeTools]);

  const saveWorkflow = () => {
    if (!prompt.trim()) return;
    const wf = {
      id:      Date.now(),
      name:    wfName.trim() || `Workflow ${new Date().toLocaleDateString()}`,
      context: wfContext.trim(),
      prompt:  prompt.trim(),
      tools:   [...activeTools],
    };
    const next = [wf, ...saved].slice(0, MAX_SAVED);
    setSaved(next);
    saveToDisk(next);
  };

  const loadWorkflow = wf => {
    setWfName(wf.name);
    setWfContext(wf.context);
    setPrompt(wf.prompt);
    setActiveTools(new Set(wf.tools));
    setMessages([]);
  };

  const deleteWorkflow = id => {
    const next = saved.filter(w => w.id !== id);
    setSaved(next);
    saveToDisk(next);
  };

  const applyTemplate = tpl => {
    setWfName(tpl.name);
    setWfContext(tpl.context);
    setPrompt(tpl.prompt);
    setActiveTools(new Set(tpl.tools));
    setMessages([]);
  };

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🔀" title="Workflow Builder" subtitle="Connect your API key to build AI workflows">
      <Link to="/" className="block text-center text-xs text-gray-500 mt-4 hover:text-gray-300">
        ← Back to Dashboard
      </Link>
    </AuthGate>
  );

  const serverMap = Object.fromEntries((integrations || []).map(i => [i.key, i]));

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: '#0f0f13' }}>
      <Header icon="🔀" title="Workflow Builder" subtitle="Design multi-tool AI pipelines · Claude as command center" />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left Panel — Tool Nodes ──────────────────────────────────── */}
        <aside
          className="w-56 flex flex-col overflow-y-auto flex-shrink-0 p-3 gap-2"
          style={{ borderRight: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}
        >
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1 pt-1 mb-1">Pipeline Nodes</p>

          {/* Always-on nodes */}
          <AlwaysOnNode icon="🤖" label="Claude Opus 4.6" sub="Reasoning Engine" color="#6366f1" />
          <AlwaysOnNode icon="⚡" label="GoHighLevel CRM" sub="26 tools · Always on" color="#22c55e" />

          <div className="border-t my-1" style={{ borderColor: 'rgba(255,255,255,0.06)' }} />
          <p className="text-xs text-gray-600 px-1">External integrations</p>

          {INTEGRATIONS.map(cfg => {
            const sv       = serverMap[cfg.key] || {};
            const enabled  = sv.enabled || false;
            const isActive = activeTools.has(cfg.key);
            return (
              <ToolNode
                key={cfg.key}
                cfg={cfg}
                enabled={enabled}
                isActive={isActive}
                onToggle={() => toggleTool(cfg.key)}
              />
            );
          })}

          <div className="flex-1" />
          <Link
            to="/settings"
            className="text-xs text-center text-indigo-400 hover:text-indigo-300 py-2"
          >
            + Connect more APIs
          </Link>
        </aside>

        {/* ── Center — Builder ─────────────────────────────────────────── */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ flex: '1 1 0', borderRight: '1px solid rgba(255,255,255,0.06)' }}
        >
          {/* Flow bar */}
          <FlowBar activeTools={activeTools} serverMap={serverMap} />

          {/* Builder form */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            {/* Templates */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Templates</p>
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

            {/* Workflow name */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Workflow Name</label>
              <input
                value={wfName}
                onChange={e => setWfName(e.target.value)}
                placeholder="e.g. Weekly Lead Outreach"
                className="field w-full text-sm"
              />
            </div>

            {/* Context */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Context <span className="text-gray-600">(optional — extra background for Claude)</span>
              </label>
              <input
                value={wfContext}
                onChange={e => setWfContext(e.target.value)}
                placeholder="e.g. We sell B2B SaaS to marketing teams"
                className="field w-full text-sm"
              />
            </div>

            {/* Prompt */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Prompt / Task</label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) run(); }}
                placeholder="Describe what Claude should do across the selected tools…"
                rows={6}
                className="field w-full text-sm leading-relaxed"
                style={{ resize: 'vertical' }}
              />
              <p className="text-xs text-gray-600 mt-1">Ctrl+Enter to run</p>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={isRunning ? stop : run}
                disabled={!isRunning && !prompt.trim()}
                className="btn-primary flex-1 py-2.5 gap-2"
              >
                {isRunning
                  ? <><span className="spinner w-3.5 h-3.5 rounded-full border-2" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> Stop</>
                  : '▶ Run Workflow'}
              </button>
              <button
                onClick={saveWorkflow}
                disabled={!prompt.trim()}
                className="btn-ghost px-4 py-2.5 text-sm"
              >
                💾 Save
              </button>
              {messages.length > 0 && (
                <button onClick={() => setMessages([])} className="btn-ghost px-3 py-2.5 text-sm">Clear</button>
              )}
            </div>

            {/* Saved workflows */}
            {saved.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Saved Workflows</p>
                <div className="flex flex-wrap gap-2">
                  {saved.map(wf => (
                    <div
                      key={wf.id}
                      className="flex items-center gap-1 text-xs rounded-full px-3 py-1 cursor-pointer"
                      style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)', color: '#a5b4fc' }}
                      onClick={() => loadWorkflow(wf)}
                    >
                      {wf.name}
                      <button
                        onClick={e => { e.stopPropagation(); deleteWorkflow(wf.id); }}
                        className="ml-1 text-gray-600 hover:text-red-400"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right Panel — Stream output ──────────────────────────────── */}
        <div className="flex flex-col overflow-hidden" style={{ width: '380px', flexShrink: 0 }}>
          <div
            className="px-4 py-3 flex items-center gap-2 flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span className="text-sm">⚡</span>
            <span className="text-sm font-semibold text-white">Live Output</span>
            {isRunning && (
              <span className="ml-auto text-xs text-yellow-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                Running…
              </span>
            )}
          </div>
          <StreamOutput
            messages={messages}
            isRunning={isRunning}
            placeholder={{
              icon: '🔀',
              text: 'Configure your workflow and click Run\nClaude will execute across selected tools',
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AlwaysOnNode({ icon, label, sub, color }) {
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
      style={{ background: `${color}18`, border: `1px solid ${color}40` }}
    >
      <span className="text-base">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-white truncate">{label}</div>
        <div className="text-xs" style={{ color: `${color}cc` }}>{sub}</div>
      </div>
      <span className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
    </div>
  );
}

function ToolNode({ cfg, enabled, isActive, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
      style={{
        background: isActive ? `${cfg.color}` : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isActive ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.06)'}`,
        opacity: !enabled ? 0.45 : 1,
      }}
    >
      <span className="text-base flex-shrink-0">{cfg.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-white truncate">{cfg.label}</div>
        <div className="text-xs text-gray-600">{enabled ? 'Connected' : 'Not connected'}</div>
      </div>
      <span
        className="w-3 h-3 rounded-sm flex-shrink-0 flex items-center justify-center"
        style={{
          background: isActive ? '#6366f1' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${isActive ? '#6366f1' : 'rgba(255,255,255,0.1)'}`,
        }}
      >
        {isActive && <span className="text-white" style={{ fontSize: '8px', lineHeight: 1 }}>✓</span>}
      </span>
    </button>
  );
}

function FlowBar({ activeTools, serverMap }) {
  const nodes = [
    { key: '__input', label: 'Input', icon: '📝', color: '#6366f1' },
    { key: '__claude', label: 'Claude', icon: '🤖', color: '#8b5cf6' },
    { key: '__ghl',   label: 'GHL',    icon: '⚡', color: '#22c55e' },
    ...[...activeTools].map(key => {
      const sv = serverMap[key] || {};
      return { key, label: sv.label || key, icon: sv.icon || '🔌', color: '#6366f1' };
    }),
  ];

  return (
    <div
      className="flex items-center gap-1 px-4 py-2.5 flex-shrink-0 overflow-x-auto"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)' }}
    >
      {nodes.map((node, i) => (
        <div key={node.key} className="flex items-center gap-1 flex-shrink-0">
          {i > 0 && <span className="text-gray-700 text-xs">→</span>}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
            style={{
              background: `${node.color}18`,
              border: `1px solid ${node.color}40`,
              color: node.color,
            }}
          >
            <span>{node.icon}</span>
            <span className="font-medium">{node.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
