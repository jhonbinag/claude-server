/**
 * Workflows.jsx — n8n-style multi-tool workflow builder
 *
 * Left panel  : Tool palette — click any connected tool to add a step
 * Center panel: Ordered step nodes (numbered cards with connector arrows)
 * Right panel : Live streaming output
 *
 * Each workflow is saved server-side (Redis, 1-year TTL) and gets a
 * unique webhook URL so external systems can trigger it automatically.
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

// ── Tool colours ───────────────────────────────────────────────────────────────

const TOOL_COLOR = {
  ghl:          '#22c55e',
  perplexity:   '#6366f1',
  openai:       '#10b981',
  facebook_ads: '#1877f2',
  sendgrid:     '#00a8a8',
  slack:        '#9333ea',
  apollo:       '#f97316',
  heygen:       '#a855f7',
};

// ── Templates ──────────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    name: '🔍 Research & Report',
    context: 'Research assistant workflow',
    steps: [
      { tool: 'perplexity', label: 'Perplexity AI', icon: '🔍', instruction: 'Research [topic] using live web data. Extract key statistics, trends, and competitor insights.' },
      { tool: 'openai',     label: 'OpenAI',        icon: '✨', instruction: 'Compile the research into a professional executive summary with key takeaways.' },
    ],
  },
  {
    name: '🚀 Lead Outreach',
    context: 'B2B sales outreach',
    steps: [
      { tool: 'apollo',   label: 'Apollo.io', icon: '🚀', instruction: 'Find 10 [job title] prospects at [industry] companies.' },
      { tool: 'ghl',      label: 'GHL CRM',   icon: '⚡', instruction: 'Add found prospects as GHL contacts tagged "apollo-lead".' },
      { tool: 'sendgrid', label: 'SendGrid',  icon: '📧', instruction: 'Send a personalised intro email to each new contact.' },
      { tool: 'slack',    label: 'Slack',     icon: '💬', instruction: 'Post a summary of new leads to the #sales channel.' },
    ],
  },
  {
    name: '📧 Email Campaign',
    context: 'Email marketing campaign',
    steps: [
      { tool: 'openai',   label: 'OpenAI',   icon: '✨', instruction: 'Write 3 subject line variations and full email body for [product/offer].' },
      { tool: 'ghl',      label: 'GHL CRM',  icon: '⚡', instruction: 'Get all contacts tagged "subscribed".' },
      { tool: 'sendgrid', label: 'SendGrid', icon: '📧', instruction: 'Send the campaign to all subscribed contacts.' },
    ],
  },
  {
    name: '📱 Content + Notify',
    context: 'Content creation and distribution',
    steps: [
      { tool: 'perplexity', label: 'Perplexity AI', icon: '🔍', instruction: 'Find trending topics and news in [niche].' },
      { tool: 'openai',     label: 'OpenAI',        icon: '✨', instruction: "Generate a week's worth of social media posts based on trends." },
      { tool: 'ghl',        label: 'GHL CRM',       icon: '⚡', instruction: 'Schedule the posts via GHL Social Planner.' },
      { tool: 'slack',      label: 'Slack',         icon: '💬', instruction: 'Send the content calendar to #marketing channel.' },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function applyEvent(prev, type, data) {
  if (type === 'text') {
    const last = prev[prev.length - 1];
    if (last?.type === 'text') return [...prev.slice(0, -1), { ...last, text: last.text + data.text }];
    return [...prev, { type: 'text', text: data.text }];
  }
  if (type === 'tool_call')   return [...prev, { type: 'tool_call',   name: data.name,   input:  data.input }];
  if (type === 'tool_result') return [...prev, { type: 'tool_result', name: data.name,   result: data.result }];
  if (type === 'done')        return [...prev, { type: 'done',        turns: data.turns, toolCallCount: data.toolCallCount }];
  if (type === 'error')       return [...prev, { type: 'error',       error: data.error }];
  return prev;
}

function buildPrompt(steps, context) {
  const lines = steps
    .map((s, i) => `STEP ${i + 1} [${s.label || s.tool.toUpperCase()}]:\n${s.instruction}`)
    .join('\n\n');
  const ctx = context ? `\n\nContext: ${context}` : '';
  return `Execute this multi-step workflow:\n\n${lines}${ctx}\n\nComplete all steps in order and summarise results at the end.`;
}

function mkStep(tool, label, icon) {
  return {
    id:          `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    tool, label, icon,
    instruction: '',
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function Workflows() {
  const { isAuthenticated, isAuthLoading, locationId, integrations } = useApp();
  const { isRunning, stream, stop } = useStreamFetch();

  const [steps,      setSteps]      = useState([]);
  const [wfName,     setWfName]     = useState('');
  const [context,    setContext]    = useState('');
  const [messages,   setMessages]   = useState([]);
  const [saved,      setSaved]      = useState([]);
  const [currentId,  setCurrentId]  = useState(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [saving,     setSaving]     = useState(false);
  const [showSaved,  setShowSaved]  = useState(false);
  const [copyDone,   setCopyDone]   = useState(false);

  const enabledKeys = new Set((integrations || []).filter(i => i.enabled).map(i => i.key));

  // Load saved workflows
  const loadSaved = useCallback(async () => {
    if (!locationId) return;
    try {
      const res  = await fetch('/workflows', { headers: { 'x-location-id': locationId } });
      const data = await res.json();
      if (data.success) setSaved(data.data || []);
    } catch { /* non-fatal */ }
  }, [locationId]);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  // ── Step management ──────────────────────────────────────────────────────────

  const addStep = (tool, label, icon) =>
    setSteps(prev => [...prev, mkStep(tool, label, icon)]);

  const removeStep = (id) =>
    setSteps(prev => prev.filter(s => s.id !== id));

  const moveStep = (id, dir) => setSteps(prev => {
    const i    = prev.findIndex(s => s.id === id);
    const next = [...prev];
    const j    = i + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const setInstruction = (id, val) =>
    setSteps(prev => prev.map(s => s.id === id ? { ...s, instruction: val } : s));

  // ── Run ──────────────────────────────────────────────────────────────────────

  const run = useCallback(async () => {
    if (!steps.length || isRunning) return;
    if (steps.some(s => !s.instruction.trim())) return;
    setMessages([]);
    const prompt  = buildPrompt(steps, context);
    const allowed = [...new Set(steps.map(s => s.tool).filter(t => t !== 'ghl'))];
    await stream(
      '/claude/task',
      { task: prompt, allowedIntegrations: allowed.length ? allowed : null },
      (evtType, data) => setMessages(prev => applyEvent(prev, evtType, data)),
      locationId,
    );
  }, [steps, context, isRunning, stream, locationId]);

  // ── Save / load ──────────────────────────────────────────────────────────────

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

  const loadWorkflow = (wf) => {
    setWfName(wf.name);
    setContext(wf.context || '');
    setSteps(wf.steps.map(s => ({ ...s, id: s.id || mkStep(s.tool, s.label, s.icon).id })));
    setCurrentId(wf.id);
    setWebhookUrl(`${window.location.origin}/workflows/trigger/${wf.webhookToken}`);
    setMessages([]);
    setShowSaved(false);
  };

  const deleteWorkflow = async (id) => {
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

  const applyTemplate = (tpl) => {
    setWfName(tpl.name); setContext(tpl.context);
    setSteps(tpl.steps.map(s => ({ ...mkStep(s.tool, s.label, s.icon), instruction: s.instruction })));
    setMessages([]); setCurrentId(null); setWebhookUrl('');
  };

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2000);
  };

  // ── Guards ───────────────────────────────────────────────────────────────────

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🔀" title="Workflow Builder" subtitle="Connect your API key to build AI workflows">
      <Link to="/" className="block text-center text-xs text-gray-500 mt-4 hover:text-gray-300">← Back</Link>
    </AuthGate>
  );

  const canRun = steps.length > 0 && steps.every(s => s.instruction.trim());

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: '#0f0f13' }}>
      <Header icon="🔀" title="Workflow Builder" subtitle="Build multi-tool AI pipelines · Claude as orchestrator" />

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden" style={{ minHeight: 0 }}>

        {/* ── Tool Palette ──────────────────────────────────────────────── */}
        <ToolPalette enabledKeys={enabledKeys} onAdd={addStep} />

        {/* ── Workflow Canvas ───────────────────────────────────────────── */}
        <div
          className="flex flex-col flex-1 overflow-hidden"
          style={{ borderRight: '1px solid rgba(255,255,255,0.06)', minHeight: 0 }}
        >
          {/* Toolbar */}
          <div
            className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}
          >
            <input
              value={wfName}
              onChange={e => setWfName(e.target.value)}
              placeholder="Workflow name…"
              className="field flex-1 text-sm"
            />
            <button onClick={newWorkflow} className="btn-ghost px-3 py-1.5 text-xs whitespace-nowrap">
              + New
            </button>
            <button
              onClick={() => setShowSaved(v => !v)}
              className={`btn-ghost px-3 py-1.5 text-xs whitespace-nowrap ${showSaved ? 'text-indigo-400' : ''}`}
            >
              📂 {saved.length > 0 ? `Saved (${saved.length})` : 'Saved'}
            </button>
          </div>

          {/* Saved list dropdown */}
          {showSaved && (
            <div
              className="flex-shrink-0 overflow-y-auto"
              style={{ maxHeight: 220, borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.3)' }}
            >
              {saved.length === 0
                ? <p className="text-xs text-gray-600 px-4 py-4 text-center">No saved workflows yet.</p>
                : saved.map(wf => (
                  <div
                    key={wf.id}
                    className="flex items-center gap-2 px-4 py-2.5"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <button
                      onClick={() => loadWorkflow(wf)}
                      className="flex-1 text-left text-xs text-gray-300 hover:text-white truncate"
                    >
                      {wf.name}
                      <span className="text-gray-600 ml-2">{wf.steps?.length} steps</span>
                    </button>
                    <button
                      onClick={() => deleteWorkflow(wf.id)}
                      className="text-gray-600 hover:text-red-400 text-sm px-1 flex-shrink-0"
                    >×</button>
                  </div>
                ))
              }
            </div>
          )}

          {/* Canvas */}
          <div className="flex-1 overflow-y-auto p-4">

            {/* Templates — only when empty */}
            {steps.length === 0 && (
              <div className="mb-6">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  Quick Templates
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATES.map(tpl => (
                    <button
                      key={tpl.name}
                      onClick={() => applyTemplate(tpl)}
                      className="text-left text-xs px-3 py-2.5 rounded-xl text-gray-400 hover:text-indigo-300 transition-all"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                      onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.35)'; }}
                      onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
                    >
                      {tpl.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step nodes */}
            {steps.map((step, idx) => (
              <StepNode
                key={step.id}
                step={step}
                index={idx}
                total={steps.length}
                onDelete={() => removeStep(step.id)}
                onMoveUp={() => moveStep(step.id, -1)}
                onMoveDown={() => moveStep(step.id, 1)}
                onInstruction={val => setInstruction(step.id, val)}
              />
            ))}

            {/* Empty state */}
            {steps.length === 0 && (
              <div
                className="rounded-2xl flex flex-col items-center justify-center py-14"
                style={{ border: '1px dashed rgba(255,255,255,0.08)' }}
              >
                <p className="text-gray-600 text-sm mb-1">No steps yet</p>
                <p className="text-gray-700 text-xs">Click a tool in the palette to add your first step</p>
              </div>
            )}

            {steps.length > 0 && (
              <p className="text-center text-xs text-gray-700 pt-3 pb-2">
                ← Click a tool to add another step
              </p>
            )}
          </div>

          {/* Bottom bar */}
          <div
            className="flex-shrink-0 px-4 py-3 space-y-2.5"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}
          >
            <input
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="Global context (optional) — e.g. We sell B2B SaaS to marketing teams"
              className="field w-full text-xs"
            />

            <div className="flex gap-2">
              <button
                onClick={isRunning ? stop : run}
                disabled={!isRunning && !canRun}
                className="btn-primary flex-1 py-2 text-sm"
              >
                {isRunning
                  ? <span className="flex items-center justify-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full border-2 inline-block"
                        style={{
                          borderColor:    'rgba(255,255,255,0.3)',
                          borderTopColor: '#fff',
                          animation:      'spin 0.8s linear infinite',
                        }}
                      />
                      Stop
                    </span>
                  : '▶  Run Workflow'}
              </button>
              <button
                onClick={save}
                disabled={saving || !wfName.trim() || !steps.length}
                className="btn-ghost px-4 py-2 text-sm"
              >
                {saving ? '…' : '💾 Save'}
              </button>
              {messages.length > 0 && (
                <button onClick={() => setMessages([])} className="btn-ghost px-3 py-2 text-sm">✕</button>
              )}
            </div>

            {/* Webhook URL (shown after save) */}
            {webhookUrl && (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}
              >
                <span className="text-xs text-indigo-400 flex-shrink-0">🔗 Webhook</span>
                <input
                  readOnly
                  value={webhookUrl}
                  className="flex-1 bg-transparent text-xs text-gray-400 outline-none min-w-0"
                  onClick={e => e.target.select()}
                />
                <button
                  onClick={copyWebhook}
                  className="text-xs flex-shrink-0 px-2 py-0.5 rounded-md"
                  style={{ color: copyDone ? '#4ade80' : '#818cf8' }}
                >
                  {copyDone ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Live Output ───────────────────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden" style={{ width: '100%', maxWidth: 360, flexShrink: 0 }}>
          <div
            className="px-4 py-3 flex items-center gap-2 flex-shrink-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span className="text-sm">⚡</span>
            <span className="text-sm font-semibold text-white">Live Output</span>
            {isRunning && (
              <span className="ml-auto text-xs text-yellow-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                Running…
              </span>
            )}
          </div>
          <StreamOutput
            messages={messages}
            isRunning={isRunning}
            placeholder={{ icon: '🔀', text: 'Build your workflow and click Run\nClaude executes each step in order' }}
          />
        </div>

      </div>
    </div>
  );
}

// ── Tool Palette ───────────────────────────────────────────────────────────────

function ToolPalette({ enabledKeys, onAdd }) {
  const tools = [
    { key: 'ghl', label: 'GHL CRM', icon: '⚡', alwaysOn: true },
    ...INTEGRATIONS.map(i => ({ key: i.key, label: i.label, icon: i.icon })),
  ];

  return (
    <aside
      className="flex-shrink-0 md:w-48 md:flex-col md:overflow-y-auto flex flex-row overflow-x-auto border-b md:border-b-0 md:border-r"
      style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)', scrollbarWidth: 'none' }}
    >
      {/* Desktop header */}
      <div className="hidden md:block px-3 pt-3 pb-2 flex-shrink-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Tool Palette</p>
        <p className="text-xs text-gray-600 mt-0.5">Click to add a step</p>
      </div>

      <div className="flex md:flex-col flex-row gap-1 px-2 py-2 md:pb-3">
        {tools.map(t => {
          const enabled = t.alwaysOn || enabledKeys.has(t.key);
          const color   = TOOL_COLOR[t.key] || '#6366f1';
          return (
            <button
              key={t.key}
              onClick={() => enabled && onAdd(t.key, t.label, t.icon)}
              title={enabled ? `Add ${t.label} step` : `Connect ${t.label} in Settings first`}
              className="flex-shrink-0 flex items-center gap-2 md:gap-2.5 px-2.5 md:px-3 py-2 md:py-2.5 rounded-xl text-left transition-all"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border:     '1px solid rgba(255,255,255,0.06)',
                opacity:    enabled ? 1 : 0.35,
                cursor:     enabled ? 'pointer' : 'not-allowed',
              }}
              onMouseOver={e => { if (enabled) e.currentTarget.style.borderColor = `${color}60`; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
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
      <Link
        to="/settings"
        className="hidden md:block text-xs text-center text-indigo-400 hover:text-indigo-300 py-3"
      >
        + Connect APIs
      </Link>
    </aside>
  );
}

// ── Step Node ──────────────────────────────────────────────────────────────────

function StepNode({ step, index, total, onDelete, onMoveUp, onMoveDown, onInstruction }) {
  const color = TOOL_COLOR[step.tool] || '#6366f1';

  return (
    <div>
      {/* Connector arrow */}
      {index > 0 && (
        <div className="flex flex-col items-center py-1">
          <div className="w-px h-4" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 11, lineHeight: 1 }}>▼</span>
        </div>
      )}

      {/* Card */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: `1px solid ${color}28`, background: 'rgba(255,255,255,0.02)' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2.5 px-3 py-2.5"
          style={{ background: `${color}10`, borderBottom: `1px solid ${color}20` }}
        >
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
            style={{ background: color, fontSize: 10 }}
          >
            {index + 1}
          </div>
          <span className="text-base flex-shrink-0">{step.icon}</span>
          <span className="text-xs font-semibold text-white flex-1 truncate">{step.label}</span>

          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={onMoveUp}
              disabled={index === 0}
              className="text-gray-600 hover:text-gray-300 disabled:opacity-20 w-6 h-6 flex items-center justify-center rounded text-xs"
            >↑</button>
            <button
              onClick={onMoveDown}
              disabled={index === total - 1}
              className="text-gray-600 hover:text-gray-300 disabled:opacity-20 w-6 h-6 flex items-center justify-center rounded text-xs"
            >↓</button>
            <button
              onClick={onDelete}
              className="text-gray-600 hover:text-red-400 w-6 h-6 flex items-center justify-center rounded text-sm"
            >×</button>
          </div>
        </div>

        {/* Instruction */}
        <div className="px-3 py-2.5">
          <textarea
            value={step.instruction}
            onChange={e => onInstruction(e.target.value)}
            placeholder={`What should ${step.label} do in this step?`}
            rows={3}
            className="w-full bg-transparent text-sm text-gray-300 placeholder-gray-600 outline-none resize-none leading-relaxed"
          />
        </div>
      </div>
    </div>
  );
}
