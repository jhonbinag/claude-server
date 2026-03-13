/**
 * Agents.jsx — Agent Studio Manager
 *
 * Create, edit, delete, and execute custom AI agents connected to GHL Agent Studio.
 * Each agent has its own persona, instructions, and webhook URL.
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp }   from '../context/AppContext';
import AuthGate     from '../components/AuthGate';
import Header       from '../components/Header';
import Spinner      from '../components/Spinner';

// ── Pre-built templates ───────────────────────────────────────────────────────

const TEMPLATES = [
  {
    name: 'Funnel Builder',
    emoji: '🚀',
    role: 'funnel-builder',
    persona: 'You are an expert GHL funnel strategist and conversion rate optimizer with 10+ years building high-converting sales funnels for 7-figure businesses.',
    instructions: `Build complete, conversion-optimized funnels natively inside GoHighLevel.

When given a funnel task:
1. Create a logical page flow (opt-in → sales → order → upsell → thank you)
2. Write compelling headlines using proven formulas (AIDA, PAS, BAB)
3. Specify exact GHL element settings: button colors, form fields, countdown timers
4. Include social proof placement, urgency triggers, and trust badges
5. Write all copy in full — no placeholders
6. Provide color palettes and font recommendations
7. Output step-by-step build instructions a GHL agent can follow exactly`,
  },
  {
    name: 'Website Builder',
    emoji: '🌐',
    role: 'website-builder',
    persona: 'You are a professional web designer and GHL website specialist who creates stunning, high-converting business websites natively inside GoHighLevel.',
    instructions: `Design and build complete business websites inside GHL Websites.

For each website task:
1. Plan a full site structure (Home, About, Services, Testimonials, Contact, Blog)
2. Create compelling hero sections with H1, subheadline, and primary CTA
3. Specify navigation layout, footer structure, and mobile-responsive settings
4. Write all page copy — headlines, body text, CTAs
5. Recommend color schemes, typography, and spacing
6. Include SEO meta titles and descriptions for each page
7. Provide exact GHL website builder instructions element by element`,
  },
  {
    name: 'Content Creator',
    emoji: '✍️',
    role: 'content-creator',
    persona: 'You are a prolific content strategist and copywriter who creates scroll-stopping content for GHL blogs, social posts, and email campaigns.',
    instructions: `Create high-quality marketing content deployable inside GoHighLevel.

For each content task:
1. Write blog posts with proper H1/H2/H3 structure, meta description, and internal links
2. Create email sequences with subject lines, preview text, and full body copy
3. Draft social media posts optimized for each platform
4. Include relevant CTAs and lead capture integration points
5. Follow brand voice guidelines provided in the task
6. Optimize for SEO when writing blog content
7. Format output so it can be copy-pasted directly into GHL content editors`,
  },
  {
    name: 'CRM Manager',
    emoji: '📊',
    role: 'crm-manager',
    persona: 'You are a GHL CRM expert who optimizes contact management, pipeline stages, and automation workflows to maximize revenue and efficiency.',
    instructions: `Manage and optimize CRM operations inside GoHighLevel.

For each CRM task:
1. Design pipeline stages that reflect your actual sales process
2. Create smart contact tags and segmentation strategies
3. Set up automation triggers for lead nurturing and follow-up
4. Write personalized SMS and email templates for each pipeline stage
5. Configure task assignments and team notifications
6. Build custom fields and contact scoring rules
7. Provide exact GHL CRM configuration steps with all field values`,
  },
  {
    name: 'Social Media',
    emoji: '📱',
    role: 'social-media',
    persona: 'You are a social media growth expert specializing in creating viral content strategies and scheduling systems inside GHL Social Planner.',
    instructions: `Plan and execute social media campaigns through GHL Social Planner.

For each social task:
1. Create a 30-day content calendar with post types and themes
2. Write platform-specific captions (Instagram, Facebook, LinkedIn, Twitter/X, TikTok)
3. Suggest hashtag strategies and engagement hooks
4. Design content pillars: educational, inspirational, promotional, behind-the-scenes
5. Schedule posts at optimal times for each platform
6. Include story and reel concepts with scripts
7. Provide GHL Social Planner scheduling instructions for each post`,
  },
  {
    name: 'Lead Gen',
    emoji: '🎯',
    role: 'lead-gen',
    persona: 'You are a lead generation specialist who builds automated systems inside GHL to capture, qualify, and convert prospects into paying customers.',
    instructions: `Build end-to-end lead generation systems inside GoHighLevel.

For each lead gen task:
1. Design high-converting lead capture forms with the right fields
2. Create compelling lead magnets and opt-in offers
3. Build automated follow-up sequences (SMS + email + voicemail drops)
4. Set up lead scoring and qualification workflows
5. Configure appointment booking flows with confirmation sequences
6. Write all touchpoint copy — ads, landing pages, emails, texts
7. Provide step-by-step GHL setup instructions for the entire funnel`,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLES = [
  'funnel-builder', 'website-builder', 'content-creator',
  'crm-manager', 'social-media', 'lead-gen', 'custom',
];

const EMOJIS = ['🤖', '🚀', '🌐', '✍️', '📊', '📱', '🎯', '⚡', '🧠', '💡', '🔥', '🎨', '📈', '🛠️'];

function blank() {
  return { name: '', emoji: '🤖', role: 'custom', persona: '', instructions: '', webhookUrl: '' };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Agents() {
  const { isAuthenticated, isAuthLoading, locationId } = useApp();

  const [agents,        setAgents]        = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);

  // Modal state
  const [modal,         setModal]         = useState(null); // null | 'create' | 'edit' | 'execute' | 'templates'
  const [editTarget,    setEditTarget]    = useState(null); // agent being edited
  const [form,          setForm]          = useState(blank());
  const [saving,        setSaving]        = useState(false);

  // Execute panel state
  const [execAgent,     setExecAgent]     = useState(null);
  const [execTask,      setExecTask]      = useState('');
  const [execNiche,     setExecNiche]     = useState('');
  const [execOffer,     setExecOffer]     = useState('');
  const [execAudience,  setExecAudience]  = useState('');
  const [execExtra,     setExecExtra]     = useState('');
  const [execMode,      setExecMode]      = useState('task'); // 'task' | 'form'
  const [executing,     setExecuting]     = useState(false);
  const [execResult,    setExecResult]    = useState(null); // { brief, status: 'ok'|'err', msg }

  // ── API helpers ─────────────────────────────────────────────────────────────

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    'x-location-id': locationId,
  }), [locationId]);

  async function loadAgents() {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/agent/agents', { headers: headers() });
      const data = await res.json();
      if (data.success) setAgents(data.data);
      else setError(data.error || 'Failed to load agents.');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAuthenticated) loadAgents();
  }, [isAuthenticated]); // eslint-disable-line

  async function saveAgent() {
    if (!form.name.trim() || !form.instructions.trim()) return;
    setSaving(true);
    try {
      const url    = editTarget ? `/agent/agents/${editTarget.id}` : '/agent/agents';
      const method = editTarget ? 'PUT' : 'POST';
      const res    = await fetch(url, { method, headers: headers(), body: JSON.stringify(form) });
      const data   = await res.json();
      if (data.success) {
        await loadAgents();
        closeModal();
      } else {
        alert(data.error || 'Save failed.');
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteAgent(agent) {
    if (!confirm(`Delete agent "${agent.name}"?`)) return;
    try {
      await fetch(`/agent/agents/${agent.id}`, { method: 'DELETE', headers: headers() });
      setAgents(prev => prev.filter(a => a.id !== agent.id));
    } catch (e) {
      alert(e.message);
    }
  }

  async function executeAgent() {
    if (!execAgent) return;
    const hasTask = execMode === 'task' ? execTask.trim() : (execNiche.trim() && execOffer.trim());
    if (!hasTask) return;

    setExecuting(true);
    setExecResult(null);
    try {
      const body = execMode === 'task'
        ? { task: execTask }
        : { niche: execNiche, offer: execOffer, audience: execAudience, extraContext: execExtra };

      const res  = await fetch(`/agent/agents/${execAgent.id}/execute`, {
        method: 'POST', headers: headers(), body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setExecResult({ brief: data.brief, status: 'ok', msg: data.message });
      } else {
        setExecResult({ brief: '', status: 'err', msg: data.error || 'Execution failed.' });
      }
    } catch (e) {
      setExecResult({ brief: '', status: 'err', msg: e.message });
    } finally {
      setExecuting(false);
    }
  }

  // ── Modal helpers ───────────────────────────────────────────────────────────

  function openCreate() {
    setEditTarget(null);
    setForm(blank());
    setModal('create');
  }

  function openEdit(agent) {
    setEditTarget(agent);
    setForm({
      name: agent.name, emoji: agent.emoji, role: agent.role,
      persona: agent.persona || '', instructions: agent.instructions,
      webhookUrl: agent.webhookUrl || '',
    });
    setModal('edit');
  }

  function openExecute(agent) {
    setExecAgent(agent);
    setExecTask('');
    setExecNiche('');
    setExecOffer('');
    setExecAudience('');
    setExecExtra('');
    setExecMode('task');
    setExecResult(null);
    setModal('execute');
  }

  function applyTemplate(tpl) {
    setForm({ ...blank(), ...tpl });
    setModal('create');
  }

  function closeModal() {
    setModal(null);
    setEditTarget(null);
    setExecAgent(null);
    setExecResult(null);
  }

  // ── Render guards ───────────────────────────────────────────────────────────

  if (isAuthLoading) return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🤖" title="Agent Studio" subtitle="Manage your GHL agents">
      <p className="text-xs text-gray-600 text-center mt-2">Connect your API key to get started.</p>
    </AuthGate>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ height: '100vh', background: '#0f0f13' }}>
      <Header icon="🤖" title="Agent Studio" subtitle="Create and manage GHL agents" />

      <div className="flex-1 overflow-y-auto p-5" style={{ minHeight: 0 }}>

        {/* Top bar */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1">
            <h2 className="text-white font-semibold text-sm">Your Agents</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Each agent has its own persona and is connected to a GHL Agent Studio webhook.
            </p>
          </div>
          <button onClick={() => setModal('templates')}
            className="btn-ghost text-xs px-3 py-1.5">
            📋 Templates
          </button>
          <button onClick={openCreate} className="btn-primary text-xs px-4 py-1.5">
            + New Agent
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl p-4 mb-4 text-sm"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loading && agents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-5 text-center">
            <span className="text-6xl">🤖</span>
            <div>
              <p className="text-white font-semibold">No agents yet</p>
              <p className="text-gray-500 text-xs mt-1">
                Create an agent with a persona and GHL webhook to get started.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setModal('templates')} className="btn-ghost text-sm px-5 py-2">
                📋 Start from Template
              </button>
              <button onClick={openCreate} className="btn-primary text-sm px-5 py-2">
                + Create Agent
              </button>
            </div>
          </div>
        )}

        {/* Agent grid */}
        {!loading && agents.length > 0 && (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {agents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onEdit={() => openEdit(agent)}
                onDelete={() => deleteAgent(agent)}
                onExecute={() => openExecute(agent)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Templates modal ─────────────────────────────────────────────────── */}
      {modal === 'templates' && (
        <Modal title="Agent Templates" onClose={closeModal} wide>
          <p className="text-xs text-gray-500 mb-4">
            Start from a pre-built agent configuration. You can customize it after selecting.
          </p>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {TEMPLATES.map(tpl => (
              <button
                key={tpl.name}
                onClick={() => applyTemplate(tpl)}
                className="text-left rounded-xl p-4 transition-all hover:scale-[1.02]"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{tpl.emoji}</span>
                  <span className="text-sm font-semibold text-white">{tpl.name}</span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">{tpl.persona}</p>
                <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>
                  {tpl.role}
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* ── Create / Edit modal ──────────────────────────────────────────────── */}
      {(modal === 'create' || modal === 'edit') && (
        <Modal title={modal === 'edit' ? `Edit: ${editTarget?.name}` : 'New Agent'} onClose={closeModal} wide>
          <div className="flex flex-col gap-4">

            {/* Name + Emoji row */}
            <div className="flex gap-3">
              <div style={{ width: 72 }}>
                <label className="text-xs text-gray-400 block mb-1">Emoji</label>
                <select value={form.emoji} onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))}
                  className="field text-lg w-full text-center">
                  {EMOJIS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-400 block mb-1">Agent Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Funnel Builder Pro" className="field text-sm w-full" />
              </div>
              <div style={{ width: 160 }}>
                <label className="text-xs text-gray-400 block mb-1">Role</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  className="field text-xs w-full">
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>

            {/* Persona */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Persona / Identity
                <span className="text-gray-600 ml-1">— how Claude thinks of itself when generating briefs</span>
              </label>
              <textarea value={form.persona} onChange={e => setForm(f => ({ ...f, persona: e.target.value }))}
                placeholder="You are an expert GHL funnel strategist with 10+ years building high-converting funnels for 7-figure businesses..."
                className="field text-xs w-full resize-none" rows={3} />
            </div>

            {/* Instructions */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Agent Instructions *
                <span className="text-gray-600 ml-1">— training and rules for this agent</span>
              </label>
              <textarea value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                placeholder="Step-by-step instructions this agent follows when given a task. Be specific — include GHL-specific actions, copy rules, output format..."
                className="field text-xs w-full resize-none" rows={8} />
            </div>

            {/* Webhook */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                GHL Agent Studio Webhook URL
                <span className="text-gray-600 ml-1">— the inbound webhook trigger in your GHL workflow</span>
              </label>
              <input value={form.webhookUrl} onChange={e => setForm(f => ({ ...f, webhookUrl: e.target.value }))}
                placeholder="https://backend.leadconnectorhq.com/hooks/..." className="field text-xs w-full font-mono" />
              <p className="text-xs text-gray-600 mt-1">
                In GHL: Automation → Workflows → New → Trigger: Inbound Webhook → copy the webhook URL here.
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-1">
              <button onClick={closeModal} className="btn-ghost text-sm px-4 py-2">Cancel</button>
              <button
                onClick={saveAgent}
                disabled={saving || !form.name.trim() || !form.instructions.trim()}
                className="btn-primary text-sm px-6 py-2"
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving…
                  </span>
                ) : modal === 'edit' ? '💾 Save Changes' : '✅ Create Agent'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Execute modal ────────────────────────────────────────────────────── */}
      {modal === 'execute' && execAgent && (
        <Modal title={`Execute: ${execAgent.emoji} ${execAgent.name}`} onClose={closeModal} wide>
          <div className="flex flex-col gap-4">

            {/* Mode toggle */}
            <div className="flex gap-2">
              {[
                { key: 'task', label: '📝 Free-form task' },
                { key: 'form', label: '📋 Structured form' },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setExecMode(key)}
                  className="text-xs px-3 py-1.5 rounded-lg transition-all"
                  style={{
                    background: execMode === key ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)',
                    border: execMode === key ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.08)',
                    color: execMode === key ? '#a5b4fc' : '#6b7280',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Task input */}
            {execMode === 'task' ? (
              <div>
                <label className="text-xs text-gray-400 block mb-1">Task Description</label>
                <textarea value={execTask} onChange={e => setExecTask(e.target.value)}
                  placeholder={`Describe what you want ${execAgent.name} to do inside GHL...\n\ne.g. "Build a complete sales funnel for a fitness coaching program targeting busy moms aged 30-45. Offer: 12-week body transformation for $997. Include opt-in, sales, order, upsell, and thank you pages."`}
                  className="field text-xs w-full resize-none" rows={6} />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Niche / Business *</label>
                    <input value={execNiche} onChange={e => setExecNiche(e.target.value)}
                      placeholder="e.g. fitness coaching" className="field text-xs w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Offer / Product *</label>
                    <input value={execOffer} onChange={e => setExecOffer(e.target.value)}
                      placeholder="e.g. 12-week transformation $997" className="field text-xs w-full" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Target Audience</label>
                  <input value={execAudience} onChange={e => setExecAudience(e.target.value)}
                    placeholder="e.g. busy moms 30-45" className="field text-xs w-full" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Extra Context</label>
                  <textarea value={execExtra} onChange={e => setExecExtra(e.target.value)}
                    placeholder="Brand colors, competitors, key objections, guarantee, price point..."
                    className="field text-xs w-full resize-none" rows={3} />
                </div>
              </div>
            )}

            {/* Webhook warning */}
            {!execAgent.webhookUrl && (
              <div className="rounded-xl p-3 text-xs"
                style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}>
                ⚠️ This agent has no webhook URL configured. Edit the agent to add a GHL Agent Studio webhook before executing.
              </div>
            )}

            {/* Result */}
            {execResult && (
              <div className="rounded-xl overflow-hidden"
                style={{ border: `1px solid ${execResult.status === 'ok' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                <div className="flex items-center gap-2 px-3 py-2"
                  style={{ background: execResult.status === 'ok' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>
                  <span>{execResult.status === 'ok' ? '✅' : '❌'}</span>
                  <p className="text-xs flex-1"
                    style={{ color: execResult.status === 'ok' ? '#4ade80' : '#f87171' }}>
                    {execResult.msg}
                  </p>
                  {execResult.status === 'ok' && execResult.brief && (
                    <button onClick={() => navigator.clipboard.writeText(execResult.brief)}
                      className="btn-ghost text-xs px-2 py-1">📋 Copy Brief</button>
                  )}
                </div>
                {execResult.brief && (
                  <div className="p-3 max-h-64 overflow-y-auto"
                    style={{ background: 'rgba(0,0,0,0.3)' }}>
                    <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                      {execResult.brief}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-1">
              <button onClick={closeModal} className="btn-ghost text-sm px-4 py-2">Close</button>
              <button
                onClick={executeAgent}
                disabled={executing || !execAgent.webhookUrl || (execMode === 'task' ? !execTask.trim() : (!execNiche.trim() || !execOffer.trim()))}
                className="btn-primary text-sm px-6 py-2"
              >
                {executing ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Executing…
                  </span>
                ) : `🚀 Execute ${execAgent.name}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── AgentCard ─────────────────────────────────────────────────────────────────

function AgentCard({ agent, onEdit, onDelete, onExecute }) {
  return (
    <div className="rounded-xl flex flex-col"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>

      {/* Header */}
      <div className="p-4 flex items-start gap-3">
        <span className="text-3xl flex-shrink-0">{agent.emoji}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-semibold text-sm truncate">{agent.name}</h3>
          <span className="text-xs px-2 py-0.5 rounded-full mt-1 inline-block"
            style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>
            {agent.role}
          </span>
        </div>
      </div>

      {/* Persona preview */}
      {agent.persona && (
        <div className="px-4 pb-3">
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{agent.persona}</p>
        </div>
      )}

      {/* Webhook status */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: agent.webhookUrl ? '#4ade80' : '#6b7280' }} />
          <span className="text-xs" style={{ color: agent.webhookUrl ? '#4ade80' : '#6b7280' }}>
            {agent.webhookUrl ? 'Webhook configured' : 'No webhook'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-auto p-3 pt-0 flex gap-2">
        <button onClick={onExecute}
          className="flex-1 text-xs py-2 rounded-lg font-medium transition-all"
          style={{ background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)' }}>
          🚀 Execute
        </button>
        <button onClick={onEdit}
          className="text-xs px-3 py-2 rounded-lg transition-all"
          style={{ background: 'rgba(255,255,255,0.05)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.08)' }}>
          ✏️
        </button>
        <button onClick={onDelete}
          className="text-xs px-3 py-2 rounded-lg transition-all"
          style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)' }}>
          🗑️
        </button>
      </div>
    </div>
  );
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex flex-col rounded-2xl overflow-hidden"
        style={{
          width: wide ? 'min(760px, 95vw)' : 'min(480px, 95vw)',
          maxHeight: '90vh',
          background: '#16161e',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
        }}>

        {/* Modal header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <h3 className="text-white font-semibold text-sm flex-1">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">×</button>
        </div>

        {/* Modal body */}
        <div className="overflow-y-auto p-5 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
