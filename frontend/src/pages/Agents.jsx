/**
 * Agents.jsx — Agent Studio Manager
 *
 * Create, edit, delete, and execute custom AI agents connected to GHL Agent Studio.
 * Each agent definition links to a real GHL Agent Studio agent via its ghlAgentId.
 * Execution calls POST /agent-studio/agent/:ghlAgentId/execute directly via GHL v2 API.
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

const PAGE_TYPES = [
  'Sales Page', 'Opt-in / Lead Capture Page', 'Thank You Page',
  'Webinar Registration Page', 'Order Page', 'Upsell Page',
  'VSL Page', 'Home Page', 'About Page', 'Product Page',
];

const COLOR_PRESETS = [
  { label: 'Navy & Gold',     value: 'dark navy (#0F172A) background with gold (#F59E0B) accents and white text' },
  { label: 'Bold Blue',       value: 'bright blue (#1D4ED8) accents on white, dark text' },
  { label: 'Dark & Modern',   value: 'charcoal (#111827) background, white text, emerald (#10B981) CTAs' },
  { label: 'Clean White',     value: 'clean white background, dark gray text (#111827), indigo (#6366F1) accents' },
  { label: 'Luxury Black',    value: 'pure black background, white text, gold (#D97706) CTAs' },
  { label: 'High Energy Red', value: 'white background, bold red (#DC2626) CTAs, dark text' },
];

const EMOJIS = ['🤖', '🚀', '🌐', '✍️', '📊', '📱', '🎯', '⚡', '🧠', '💡', '🔥', '🎨', '📈', '🛠️'];

function blank() {
  return { name: '', emoji: '🤖', role: 'custom', persona: '', instructions: '', ghlAgentId: '' };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Agents() {
  const { isAuthenticated, isAuthLoading, locationId } = useApp();

  const [agents,        setAgents]        = useState([]);
  const [ghlAgents,     setGhlAgents]     = useState([]);   // from GHL Agent Studio
  const [loading,       setLoading]       = useState(true);
  const [ghlLoading,    setGhlLoading]    = useState(false);
  const [error,         setError]         = useState(null);

  // Firebase page-builder connection status
  const [fbConnected,   setFbConnected]   = useState(false);

  // Modal state
  const [modal,         setModal]         = useState(null); // null | 'create' | 'edit' | 'execute' | 'templates'
  const [editTarget,    setEditTarget]    = useState(null);
  const [editTab,       setEditTab]       = useState('config'); // 'config' | 'kb'
  const [form,          setForm]          = useState(blank());
  const [saving,        setSaving]        = useState(false);

  // Execute panel — shared fields
  const [execAgent,     setExecAgent]     = useState(null);
  const [execMode,      setExecMode]      = useState('task'); // 'task' | 'form' | 'build-page'
  const [executing,     setExecuting]     = useState(false);
  const [execResult,    setExecResult]    = useState(null);

  // Execute — brief/studio fields
  const [execTask,      setExecTask]      = useState('');
  const [execNiche,     setExecNiche]     = useState('');
  const [execOffer,     setExecOffer]     = useState('');
  const [execAudience,  setExecAudience]  = useState('');
  const [execExtra,     setExecExtra]     = useState('');

  // Execute — build-page fields
  const [execPageId,    setExecPageId]    = useState('');
  const [execFunnelId,  setExecFunnelId]  = useState('');
  const [execPageType,  setExecPageType]  = useState(PAGE_TYPES[0]);
  const [execColor,     setExecColor]     = useState(COLOR_PRESETS[0].value);

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

  async function loadGhlAgents() {
    setGhlLoading(true);
    try {
      const res  = await fetch('/agent/agents/ghl', { headers: headers() });
      const data = await res.json();
      if (data.success) setGhlAgents(data.data || []);
    } catch (_) {
      // non-fatal — GHL agents list is optional for the picker
    } finally {
      setGhlLoading(false);
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      loadAgents();
      loadGhlAgents();
      // Check Firebase page-builder connection status
      fetch('/funnel-builder/status', { headers: headers() })
        .then(r => r.json())
        .then(d => { if (d.connected) setFbConnected(true); })
        .catch(() => {});
    }
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
    setExecuting(true);
    setExecResult(null);

    try {
      // ── Build Native Page mode ───────────────────────────────────────────────
      if (execMode === 'build-page') {
        const body = {
          pageId:      execPageId.trim(),
          funnelId:    execFunnelId.trim() || undefined,
          pageType:    execPageType,
          niche:       execNiche.trim(),
          offer:       execOffer.trim(),
          audience:    execAudience.trim() || undefined,
          colorScheme: execColor,
          extraContext: execExtra.trim() || undefined,
          agentId:     execAgent.id,
        };
        const res  = await fetch('/funnel-builder/generate', {
          method: 'POST', headers: headers(), body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.success) {
          setExecResult({ type: 'page', status: 'ok', sectionsCount: data.sectionsCount, pageId: data.pageId, previewUrl: data.previewUrl, msg: data.message });
        } else {
          setExecResult({ type: 'page', status: 'err', msg: data.error || 'Page generation failed.' });
        }
        return;
      }

      // ── Brief → GHL Agent Studio mode ───────────────────────────────────────
      const hasInput = execMode === 'task' ? execTask.trim() : (execNiche.trim() && execOffer.trim());
      if (!hasInput) return;

      const body = execMode === 'task'
        ? { task: execTask }
        : { niche: execNiche, offer: execOffer, audience: execAudience, extraContext: execExtra };

      const res  = await fetch(`/agent/agents/${execAgent.id}/execute`, {
        method: 'POST', headers: headers(), body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setExecResult({ type: 'brief', brief: data.brief, status: 'ok', msg: data.message, ghlResponse: data.ghlResponse });
      } else {
        setExecResult({ type: 'brief', brief: '', status: 'err', msg: data.error || 'Execution failed.' });
      }
    } catch (e) {
      setExecResult({ status: 'err', msg: e.message });
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
    setEditTab('config');
    setForm({
      name: agent.name, emoji: agent.emoji, role: agent.role,
      persona: agent.persona || '', instructions: agent.instructions,
      ghlAgentId: agent.ghlAgentId || '',
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
    setExecPageId('');
    setExecFunnelId('');
    setExecPageType(PAGE_TYPES[0]);
    setExecColor(COLOR_PRESETS[0].value);
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

  // GHL agent name lookup helper
  function ghlAgentName(id) {
    const a = ghlAgents.find(g => g.id === id || g._id === id);
    return a ? (a.name || a.title || id) : id;
  }

  // ── Auth guards ─────────────────────────────────────────────────────────────

  if (isAuthLoading) return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="🤖" title="Agent Studio" subtitle="Manage your GHL agents">
      <p className="text-xs text-gray-600 text-center mt-2">Connect your API key to get started.</p>
    </AuthGate>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ height: '100%', background: '#0f0f13' }}>
      <Header icon="🤖" title="Agent Studio" subtitle="Manage AI agents connected to GHL Agent Studio" />

      <div className="flex-1 overflow-y-auto p-5" style={{ minHeight: 0 }}>

        {/* Top bar */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1">
            <h2 className="text-white font-semibold text-sm">Your Agents</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Each agent has its own persona and links to a GHL Agent Studio agent via the v2 API.
            </p>
          </div>
          <button onClick={() => setModal('templates')} className="btn-ghost text-xs px-3 py-1.5">
            📋 Templates
          </button>
          <button onClick={openCreate} className="btn-primary text-xs px-4 py-1.5">
            + New Agent
          </button>
        </div>

        {/* GHL Agent Studio info banner */}
        {ghlAgents.length === 0 && !ghlLoading && (
          <div className="rounded-xl p-3 mb-4 text-xs flex items-start gap-2"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', color: '#a5b4fc' }}>
            <span className="flex-shrink-0 mt-0.5">ℹ️</span>
            <span>
              No GHL Agent Studio agents found for this location. Create agents in GHL → AI Agents → Agent Studio first, then link them here.
            </span>
          </div>
        )}

        {ghlAgents.length > 0 && (
          <div className="rounded-xl p-3 mb-4 text-xs flex items-center gap-2"
            style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.15)', color: '#4ade80' }}>
            <span>✅</span>
            <span>{ghlAgents.length} GHL Agent Studio agent{ghlAgents.length !== 1 ? 's' : ''} found — ready to link</span>
          </div>
        )}

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
                Create an agent with persona + training, then link it to a GHL Agent Studio agent.
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
                ghlAgentName={agent.ghlAgentId ? ghlAgentName(agent.ghlAgentId) : null}
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
            Start from a pre-built configuration. You can customize it after selecting.
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
          {/* Tab switcher — only in edit mode */}
          {modal === 'edit' && (
            <div className="flex gap-2 mb-5 border-b pb-3" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              {[
                { key: 'config', label: '⚙️ Agent Config' },
                { key: 'kb',     label: '📚 Knowledge Base' },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setEditTab(key)}
                  className="text-xs px-3 py-1.5 rounded-lg transition-all"
                  style={{
                    background: editTab === key ? 'rgba(99,102,241,0.2)' : 'transparent',
                    border:     editTab === key ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
                    color:      editTab === key ? '#a5b4fc' : '#6b7280',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Knowledge Base tab */}
          {modal === 'edit' && editTab === 'kb' && (
            <KnowledgeBasePanel agentId={editTarget.id} locationId={locationId} headers={headers} />
          )}

          {/* Agent Config tab */}
          {(modal === 'create' || editTab === 'config') && (
          <div className="flex flex-col gap-4">

            {/* Name + Emoji + Role */}
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

            {/* GHL Agent Studio link */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Link to GHL Agent Studio Agent
                <span className="text-gray-600 ml-1">— executes via POST /agent-studio/agent/:id/execute</span>
              </label>
              {ghlLoading ? (
                <div className="field text-xs text-gray-500">Loading GHL agents…</div>
              ) : ghlAgents.length > 0 ? (
                <select
                  value={form.ghlAgentId}
                  onChange={e => setForm(f => ({ ...f, ghlAgentId: e.target.value }))}
                  className="field text-xs w-full"
                >
                  <option value="">— Select a GHL Agent Studio agent —</option>
                  {ghlAgents.map(a => (
                    <option key={a.id || a._id} value={a.id || a._id}>
                      {a.name || a.title || a.id || a._id}
                    </option>
                  ))}
                </select>
              ) : (
                <div>
                  <input
                    value={form.ghlAgentId}
                    onChange={e => setForm(f => ({ ...f, ghlAgentId: e.target.value }))}
                    placeholder="GHL Agent ID (e.g. 686abc123…)"
                    className="field text-xs w-full font-mono"
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    No agents found via API. Enter the agent ID manually, or create agents in GHL → AI Agents → Agent Studio.
                  </p>
                </div>
              )}
            </div>

            {/* Persona */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Persona / Identity
                <span className="text-gray-600 ml-1">— how Claude thinks when generating the brief</span>
              </label>
              <textarea value={form.persona} onChange={e => setForm(f => ({ ...f, persona: e.target.value }))}
                placeholder="You are an expert GHL funnel strategist with 10+ years building high-converting funnels for 7-figure businesses..."
                className="field text-xs w-full resize-none" rows={3} />
            </div>

            {/* Instructions */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                Agent Instructions *
                <span className="text-gray-600 ml-1">— training rules sent as the brief to GHL Agent Studio</span>
              </label>
              <textarea value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                placeholder="Step-by-step instructions this agent follows when given a task. Be specific — include GHL-specific actions, copy rules, output format..."
                className="field text-xs w-full resize-none" rows={8} />
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
          )}
        </Modal>
      )}

      {/* ── Execute modal ────────────────────────────────────────────────────── */}
      {modal === 'execute' && execAgent && (
        <Modal title={`Execute: ${execAgent.emoji} ${execAgent.name}`} onClose={closeModal} wide>
          <div className="flex flex-col gap-4">

            {/* GHL agent indicator */}
            {execAgent.ghlAgentId && (
              <div className="flex items-center gap-2 text-xs"
                style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 8, padding: '8px 12px', color: '#4ade80' }}>
                <span>✅</span>
                <span>
                  Linked to GHL agent: <strong>{ghlAgentName(execAgent.ghlAgentId)}</strong>
                  <span className="text-gray-600 ml-1">({execAgent.ghlAgentId})</span>
                </span>
              </div>
            )}

            {/* Mode toggle */}
            <div className="flex gap-2 flex-wrap">
              {[
                { key: 'task',       label: '📝 Free-form task' },
                { key: 'form',       label: '📋 Structured form' },
                { key: 'build-page', label: '🏗️ Build Native Page' },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => { setExecMode(key); setExecResult(null); }}
                  className="text-xs px-3 py-1.5 rounded-lg transition-all"
                  style={{
                    background: execMode === key ? (key === 'build-page' ? 'rgba(16,185,129,0.2)' : 'rgba(99,102,241,0.25)') : 'rgba(255,255,255,0.04)',
                    border:     execMode === key ? (key === 'build-page' ? '1px solid rgba(16,185,129,0.5)' : '1px solid rgba(99,102,241,0.5)') : '1px solid rgba(255,255,255,0.08)',
                    color:      execMode === key ? (key === 'build-page' ? '#6ee7b7' : '#a5b4fc') : '#6b7280',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── Brief modes (task / form) ──────────────────────────────── */}
            {execMode === 'task' && (
              <div>
                <label className="text-xs text-gray-400 block mb-1">Task Description</label>
                <textarea value={execTask} onChange={e => setExecTask(e.target.value)}
                  placeholder={`Describe what you want ${execAgent.name} to do inside GHL...\n\ne.g. "Build a complete sales funnel for a fitness coaching program targeting busy moms aged 30-45. Offer: 12-week body transformation for $997."`}
                  className="field text-xs w-full resize-none" rows={6} />
              </div>
            )}

            {execMode === 'form' && (
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

            {/* ── Build Native Page mode ────────────────────────────────── */}
            {execMode === 'build-page' && (
              <div className="flex flex-col gap-3">

                {/* Firebase status check */}
                {!fbConnected ? (
                  <div className="rounded-xl p-3 text-xs"
                    style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}>
                    ⚠️ Page Builder not connected. In GHL, open F12 → Console and run:{' '}
                    <code className="mx-1 px-1.5 py-0.5 rounded" style={{ background: '#0d1117', color: '#7ee787' }}>
                      copy(localStorage.getItem('refreshedToken'))
                    </code>
                    {' '}then paste in{' '}
                    <a href="/ui/funnel-builder" className="underline hover:text-yellow-200">🏗️ Funnel Builder</a>.
                  </div>
                ) : (
                  <div className="rounded-xl p-2 px-3 text-xs flex items-center gap-2"
                    style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)', color: '#6ee7b7' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                    Page Builder connected · {execAgent.emoji} {execAgent.name} persona will guide generation
                  </div>
                )}

                {/* Page identifiers */}
                <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">GHL Page ID <span className="text-red-400">*</span></label>
                    <input value={execPageId} onChange={e => setExecPageId(e.target.value)}
                      placeholder="e.g. YbcohnneHGj8YGoDIY4k"
                      className="field text-xs w-full font-mono" />
                    <p className="text-xs text-gray-600 mt-0.5">From GHL page URL → last ID segment</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Funnel ID <span className="text-gray-600">(optional)</span></label>
                    <input value={execFunnelId} onChange={e => setExecFunnelId(e.target.value)}
                      placeholder="For preview link"
                      className="field text-xs w-full font-mono" />
                  </div>
                </div>

                {/* Page type */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Page Type</label>
                  <select value={execPageType} onChange={e => setExecPageType(e.target.value)} className="field text-xs w-full">
                    {PAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                {/* Niche + Offer */}
                <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Business / Niche <span className="text-red-400">*</span></label>
                    <input value={execNiche} onChange={e => setExecNiche(e.target.value)}
                      placeholder="e.g. fitness coaching" className="field text-xs w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Offer <span className="text-red-400">*</span></label>
                    <input value={execOffer} onChange={e => setExecOffer(e.target.value)}
                      placeholder="e.g. 12-week program $997" className="field text-xs w-full" />
                  </div>
                </div>

                {/* Audience + Color */}
                <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Target Audience</label>
                    <input value={execAudience} onChange={e => setExecAudience(e.target.value)}
                      placeholder="e.g. busy moms 30-45" className="field text-xs w-full" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Color Scheme</label>
                    <select value={execColor} onChange={e => setExecColor(e.target.value)} className="field text-xs w-full">
                      {COLOR_PRESETS.map(p => <option key={p.label} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Extra context */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Extra Context</label>
                  <textarea value={execExtra} onChange={e => setExecExtra(e.target.value)}
                    placeholder="Brand voice, testimonials, specific hooks, price anchoring notes..."
                    className="field text-xs w-full resize-none" rows={2} />
                </div>
              </div>
            )}

            {/* No GHL agent linked warning (brief modes only) */}
            {execMode !== 'build-page' && !execAgent.ghlAgentId && (
              <div className="rounded-xl p-3 text-xs"
                style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}>
                ⚠️ No GHL Agent Studio agent linked. Edit this agent and select a GHL agent to enable execution.
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
                  {execResult.status === 'ok' && execResult.type === 'brief' && execResult.brief && (
                    <button onClick={() => navigator.clipboard.writeText(execResult.brief)}
                      className="btn-ghost text-xs px-2 py-1">📋 Copy Brief</button>
                  )}
                </div>

                {/* Brief result */}
                {execResult.type === 'brief' && execResult.brief && (
                  <div className="p-3 max-h-56 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.3)' }}>
                    <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                      {execResult.brief}
                    </pre>
                  </div>
                )}

                {/* Build-page result */}
                {execResult.type === 'page' && execResult.status === 'ok' && (
                  <div className="p-3 flex flex-col gap-1.5" style={{ background: 'rgba(0,0,0,0.3)' }}>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Sections saved</span>
                      <span className="text-white font-semibold">{execResult.sectionsCount}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Page ID</span>
                      <code className="text-emerald-400">{execResult.pageId}</code>
                    </div>
                    {execResult.previewUrl && (
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">Preview</span>
                        <a href={execResult.previewUrl} target="_blank" rel="noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 underline">
                          Open in GHL →
                        </a>
                      </div>
                    )}
                    <p className="text-xs text-gray-600 mt-1">Open the page in GHL's builder — your content is there as native elements.</p>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-1">
              <button onClick={closeModal} className="btn-ghost text-sm px-4 py-2">Close</button>
              <button
                onClick={executeAgent}
                disabled={
                  executing ||
                  (execMode === 'build-page' && (!fbConnected || !execPageId.trim() || !execNiche.trim() || !execOffer.trim())) ||
                  (execMode === 'task'  && (!execAgent.ghlAgentId || !execTask.trim())) ||
                  (execMode === 'form'  && (!execAgent.ghlAgentId || !execNiche.trim() || !execOffer.trim()))
                }
                className="btn-primary text-sm px-6 py-2"
                style={ execMode === 'build-page' ? { background: 'linear-gradient(135deg,#10b981,#059669)' } : {} }
              >
                {executing ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {execMode === 'build-page' ? 'Generating & saving…' : 'Executing…'}
                  </span>
                ) : execMode === 'build-page'
                  ? '🏗️ Generate & Push to GHL'
                  : '🚀 Execute in GHL Agent Studio'
                }
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── AgentCard ─────────────────────────────────────────────────────────────────

function AgentCard({ agent, ghlAgentName, onEdit, onDelete, onExecute }) {
  return (
    <div className="rounded-xl flex flex-col"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>

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

      {agent.persona && (
        <div className="px-4 pb-3">
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{agent.persona}</p>
        </div>
      )}

      {/* GHL link status */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: agent.ghlAgentId ? '#4ade80' : '#6b7280' }} />
          <span className="text-xs truncate" style={{ color: agent.ghlAgentId ? '#4ade80' : '#6b7280' }}>
            {agent.ghlAgentId
              ? `GHL: ${ghlAgentName || agent.ghlAgentId}`
              : 'No GHL agent linked'}
          </span>
        </div>
      </div>

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

// ── KnowledgeBasePanel ────────────────────────────────────────────────────────

function KnowledgeBasePanel({ agentId, locationId, headers }) {
  const [status,    setStatus]    = useState(null);   // { enabled, chunks, docs }
  const [docs,      setDocs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [adding,    setAdding]    = useState(false);
  const [addMode,   setAddMode]   = useState('text'); // 'text' | 'url'
  const [addText,   setAddText]   = useState('');
  const [addUrl,    setAddUrl]    = useState('');
  const [addLabel,  setAddLabel]  = useState('');
  const [addErr,    setAddErr]    = useState('');
  const [addOk,     setAddOk]     = useState('');
  const [query,     setQuery]     = useState('');
  const [queryRes,  setQueryRes]  = useState(null);
  const [querying,  setQuerying]  = useState(false);
  const [deleting,  setDeleting]  = useState(null); // docId being deleted

  const h = () => ({ 'Content-Type': 'application/json', 'x-location-id': locationId });

  async function loadStatus() {
    try {
      const r = await fetch(`/knowledge/${agentId}/status`, { headers: h() });
      const d = await r.json();
      setStatus(d);
    } catch (_) {}
  }

  async function loadDocs() {
    try {
      const r = await fetch(`/knowledge/${agentId}/docs`, { headers: h() });
      const d = await r.json();
      if (d.success) setDocs(d.data || []);
    } catch (_) {}
    setLoading(false);
  }

  useEffect(() => {
    loadStatus();
    loadDocs();
  }, [agentId]); // eslint-disable-line

  async function handleAdd() {
    setAddErr('');
    setAddOk('');
    if (addMode === 'text' && !addText.trim()) { setAddErr('Enter some text first.'); return; }
    if (addMode === 'url'  && !addUrl.trim())  { setAddErr('Enter a URL first.'); return; }
    setAdding(true);
    try {
      const body = addMode === 'text'
        ? { text: addText.trim(), sourceLabel: addLabel.trim() || 'manual' }
        : { url:  addUrl.trim(),  sourceLabel: addLabel.trim() || addUrl.trim() };
      const r = await fetch(`/knowledge/${agentId}/docs`, {
        method: 'POST', headers: h(), body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.success) {
        setAddOk(`Added ${d.chunks} chunk${d.chunks !== 1 ? 's' : ''}.`);
        setAddText('');
        setAddUrl('');
        setAddLabel('');
        await loadStatus();
        await loadDocs();
      } else {
        setAddErr(d.error || 'Failed to add.');
      }
    } catch (e) {
      setAddErr(e.message);
    }
    setAdding(false);
  }

  async function handleDelete(docId) {
    setDeleting(docId);
    try {
      const r = await fetch(`/knowledge/${agentId}/docs/${docId}`, { method: 'DELETE', headers: h() });
      const d = await r.json();
      if (d.success) {
        setDocs(prev => prev.filter(doc => doc.docId !== docId));
        await loadStatus();
      }
    } catch (_) {}
    setDeleting(null);
  }

  async function handleQuery() {
    if (!query.trim()) return;
    setQuerying(true);
    setQueryRes(null);
    try {
      const r = await fetch(`/knowledge/${agentId}/query`, {
        method: 'POST', headers: h(), body: JSON.stringify({ query: query.trim(), k: 3 }),
      });
      const d = await r.json();
      if (d.success) setQueryRes(d.data);
      else setQueryRes([]);
    } catch (_) { setQueryRes([]); }
    setQuerying(false);
  }

  if (status && !status.enabled) {
    return (
      <div className="rounded-xl p-5 text-center" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
        <p className="text-sm text-indigo-300 font-semibold mb-2">📚 Knowledge Base — Not Configured</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          To enable RAG for this agent, set these environment variables on your server:<br />
          <code className="text-indigo-400">CHROMA_API_KEY</code>, <code className="text-indigo-400">CHROMA_TENANT</code>,{' '}
          <code className="text-indigo-400">CHROMA_DATABASE</code>, <code className="text-indigo-400">JINA_API_KEY</code>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Stats */}
      {status && (
        <div className="flex gap-3">
          {[
            { label: 'Documents', value: status.docs ?? '–' },
            { label: 'Chunks',    value: status.chunks ?? '–' },
            { label: 'Status',    value: status.enabled ? 'Active' : 'Off' },
          ].map(s => (
            <div key={s.label} className="flex-1 rounded-xl p-3 text-center"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="text-lg font-bold text-white">{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Add document */}
      <div className="rounded-xl p-4 flex flex-col gap-3"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-white">Add to Knowledge Base</p>
          <div className="flex gap-1">
            {['text', 'url'].map(m => (
              <button key={m} onClick={() => { setAddMode(m); setAddErr(''); setAddOk(''); }}
                className="text-xs px-2.5 py-1 rounded-lg transition-all"
                style={{
                  background: addMode === m ? 'rgba(99,102,241,0.2)' : 'transparent',
                  color:      addMode === m ? '#a5b4fc' : '#6b7280',
                  border:     '1px solid ' + (addMode === m ? 'rgba(99,102,241,0.4)' : 'transparent'),
                }}>
                {m === 'text' ? '📝 Text' : '🔗 URL'}
              </button>
            ))}
          </div>
        </div>

        {addMode === 'text' ? (
          <textarea value={addText} onChange={e => setAddText(e.target.value)}
            placeholder="Paste any knowledge text — product info, brand guide, FAQs, SOPs, testimonials..."
            className="field text-xs w-full resize-none" rows={5} />
        ) : (
          <input value={addUrl} onChange={e => setAddUrl(e.target.value)}
            placeholder="https://your-website.com/page  (Jina Reader will fetch & clean the text)"
            className="field text-xs w-full font-mono" />
        )}

        <input value={addLabel} onChange={e => setAddLabel(e.target.value)}
          placeholder="Source label (optional) — e.g. Brand Guide, FAQ, Case Study"
          className="field text-xs w-full" />

        {addErr && <p className="text-xs text-red-400">{addErr}</p>}
        {addOk  && <p className="text-xs text-emerald-400">✅ {addOk}</p>}

        <button onClick={handleAdd} disabled={adding}
          className="btn-primary text-xs py-2 self-start px-5">
          {adding ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {addMode === 'url' ? 'Fetching & indexing…' : 'Indexing…'}
            </span>
          ) : '+ Add Document'}
        </button>
      </div>

      {/* Document list */}
      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      ) : docs.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-gray-500">Documents ({docs.length})</p>
          {docs.map(doc => (
            <div key={doc.docId} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white font-medium truncate">{doc.sourceLabel}</p>
                {doc.url && <p className="text-xs text-gray-600 truncate">{doc.url}</p>}
                <p className="text-xs text-gray-600">{doc.chunks} chunk{doc.chunks !== 1 ? 's' : ''} · {new Date(doc.addedAt).toLocaleDateString()}</p>
              </div>
              <button onClick={() => handleDelete(doc.docId)}
                disabled={deleting === doc.docId}
                className="text-xs px-2 py-1 rounded-lg flex-shrink-0 transition-all"
                style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)' }}>
                {deleting === doc.docId ? '…' : '🗑️'}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-600 text-center py-4">No documents yet. Add text or a URL above to build this agent's knowledge base.</p>
      )}

      {/* Query preview */}
      {docs.length > 0 && (
        <div className="rounded-xl p-4 flex flex-col gap-3"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <p className="text-xs font-semibold text-gray-400">🔍 Test RAG Search</p>
          <div className="flex gap-2">
            <input value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleQuery()}
              placeholder="Enter a query to see what the agent retrieves..."
              className="field text-xs flex-1" />
            <button onClick={handleQuery} disabled={querying || !query.trim()}
              className="btn-ghost text-xs px-3 py-1.5">
              {querying ? '…' : 'Search'}
            </button>
          </div>
          {queryRes && (
            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
              {queryRes.length === 0
                ? <p className="text-xs text-gray-600">No results found.</p>
                : queryRes.map((r, i) => (
                  <div key={i} className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div className="flex justify-between mb-1">
                      <span className="text-xs text-gray-500">{r.sourceLabel}</span>
                      <span className="text-xs" style={{ color: r.score > 0.7 ? '#4ade80' : '#f59e0b' }}>
                        {(r.score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed line-clamp-3">{r.text}</p>
                  </div>
                ))
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

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
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <h3 className="text-white font-semibold text-sm flex-1">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">×</button>
        </div>
        <div className="overflow-y-auto p-5 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
