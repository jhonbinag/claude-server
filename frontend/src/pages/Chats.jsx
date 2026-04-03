/**
 * Chats.jsx — Claude/ChatGPT-style persistent chat with persona agents
 *
 * Home screen shows active persona cards — click one to start a conversation.
 * Each chat session tracks which persona it belongs to.
 * Messages go through a two-pass improve loop on the backend (Haiku draft → Sonnet improve).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'react-toastify';
import { useApp } from '../context/AppContext';
import AuthGate   from '../components/AuthGate';
import Spinner    from '../components/Spinner';

// ── GHL Action Panel ──────────────────────────────────────────────────────────

const GHL_ACTIONS = [
  { key: 'search',      label: 'Search Contact',       icon: '🔍' },
  { key: 'add',         label: 'Add Contact',          icon: '➕' },
  { key: 'update',      label: 'Update Contact',       icon: '✏️' },
  { key: 'tag',         label: 'Add Tag',              icon: '🏷️' },
  { key: 'workflow',    label: 'Add to Workflow',      icon: '⚡' },
  { key: 'opportunity', label: 'Add to Opportunity',   icon: '💼' },
];

function GhlPanel({ locationId, onClose }) {
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [locationInfo,      setLocationInfo]      = useState(null);
  const [confirming,        setConfirming]        = useState(true);
  const [action,            setAction]            = useState(null);
  const [loading,           setLoading]           = useState(false);
  const [result,            setResult]            = useState(null);

  // Search state
  const [searchQ,     setSearchQ]     = useState('');
  const [searchRes,   setSearchRes]   = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);

  // Form states
  const [form, setForm] = useState({});

  // Workflows & pipelines (loaded on demand)
  const [workflows,  setWorkflows]  = useState([]);
  const [pipelines,  setPipelines]  = useState([]);

  const headers = { 'Content-Type': 'application/json', 'x-location-id': locationId };

  // Step 1 — confirm location on mount
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/chats/ghl/location', { headers });
        const d = await r.json();
        if (d.success) { setLocationInfo(d.data); }
      } catch {}
      setConfirming(false);
    })();
  }, [locationId]);

  const confirm = () => {
    setLocationConfirmed(true);
    toast.success(`Connected to: ${locationInfo?.name || locationId}`);
  };

  const ghlFetch = async (path, options = {}) => {
    const r = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'GHL request failed');
    return d.data;
  };

  const selectAction = async (key) => {
    setAction(key); setResult(null); setForm({}); setSelectedContact(null); setSearchRes([]);
    if (key === 'workflow' && !workflows.length) {
      try { const d = await ghlFetch('/chats/ghl/workflows'); setWorkflows(d); } catch {}
    }
    if (key === 'opportunity' && !pipelines.length) {
      try { const d = await ghlFetch('/chats/ghl/pipelines'); setPipelines(d); } catch {}
    }
  };

  const doSearch = async () => {
    if (!searchQ.trim()) return;
    setLoading(true);
    try {
      const d = await ghlFetch(`/chats/ghl/search?q=${encodeURIComponent(searchQ)}`);
      setSearchRes(d);
      if (!d.length) toast.info('No contacts found.');
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  };

  const doAdd = async () => {
    if (!form.email && !form.phone) { toast.error('Email or phone required.'); return; }
    setLoading(true);
    try {
      const d = await ghlFetch('/chats/ghl/contacts', {
        method: 'POST',
        body: JSON.stringify({ firstName: form.firstName, lastName: form.lastName, email: form.email, phone: form.phone }),
      });
      setResult(d);
      toast.success(`Contact created: ${form.firstName || ''} ${form.lastName || ''}`);
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  };

  const doUpdate = async () => {
    if (!selectedContact) { toast.error('Search and select a contact first.'); return; }
    setLoading(true);
    try {
      await ghlFetch(`/chats/ghl/contacts/${selectedContact.id}`, {
        method: 'PUT',
        body: JSON.stringify({ firstName: form.firstName, lastName: form.lastName, email: form.email, phone: form.phone }),
      });
      toast.success('Contact updated.');
      setResult({ ...selectedContact, ...form });
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  };

  const doTag = async () => {
    if (!selectedContact) { toast.error('Search and select a contact first.'); return; }
    if (!form.tags?.trim()) { toast.error('Enter at least one tag.'); return; }
    setLoading(true);
    try {
      await ghlFetch(`/chats/ghl/contacts/${selectedContact.id}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tags: form.tags.split(',').map(t => t.trim()).filter(Boolean) }),
      });
      toast.success(`Tags added to ${selectedContact.firstName || selectedContact.email}.`);
      setResult({ tagged: true });
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  };

  const doWorkflow = async () => {
    if (!selectedContact) { toast.error('Search and select a contact first.'); return; }
    if (!form.workflowId) { toast.error('Select a workflow.'); return; }
    setLoading(true);
    try {
      await ghlFetch(`/chats/ghl/contacts/${selectedContact.id}/workflow/${form.workflowId}`, { method: 'POST' });
      const wf = workflows.find(w => w.id === form.workflowId);
      toast.success(`Added to workflow: ${wf?.name || form.workflowId}`);
      setResult({ enrolled: true, workflow: wf?.name });
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  };

  const doOpportunity = async () => {
    if (!selectedContact) { toast.error('Search and select a contact first.'); return; }
    if (!form.pipelineId) { toast.error('Select a pipeline.'); return; }
    setLoading(true);
    try {
      const d = await ghlFetch('/chats/ghl/opportunities', {
        method: 'POST',
        body: JSON.stringify({
          contactId: selectedContact.id, pipelineId: form.pipelineId,
          pipelineStageId: form.stageId || undefined,
          name: form.oppName || `${selectedContact.firstName || ''} ${selectedContact.lastName || ''}`.trim() || 'New Opportunity',
          monetaryValue: parseFloat(form.value) || 0,
        }),
      });
      toast.success('Opportunity created.');
      setResult(d);
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  };

  const inp = { width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box', outline: 'none' };
  const lbl = { display: 'block', fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };

  // ── Contact search widget (reused across actions) ───────────────────────────
  const SearchWidget = () => (
    <div style={{ marginBottom: 14 }}>
      <label style={lbl}>Find Contact (email / phone / name)</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={searchQ} onChange={e => setSearchQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} placeholder="john@example.com or +1555…" style={{ ...inp, flex: 1 }} />
        <button onClick={doSearch} disabled={loading} style={{ padding: '8px 14px', borderRadius: 8, background: '#4f46e5', border: 'none', color: '#fff', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>Search</button>
      </div>
      {searchRes.length > 0 && (
        <div style={{ marginTop: 8, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
          {searchRes.map(c => (
            <div key={c.id} onClick={() => { setSelectedContact(c); setForm(f => ({ ...f, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone })); setSearchRes([]); }}
              style={{ padding: '8px 12px', cursor: 'pointer', background: selectedContact?.id === c.id ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 13 }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = selectedContact?.id === c.id ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)'}
            >
              <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{c.firstName} {c.lastName}</span>
              <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 8 }}>{c.email || c.phone}</span>
              {c.tags?.length > 0 && <span style={{ marginLeft: 8, fontSize: 10, color: '#818cf8' }}>{c.tags.slice(0,3).join(', ')}</span>}
            </div>
          ))}
        </div>
      )}
      {selectedContact && (
        <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#34d399' }}>✓ {selectedContact.firstName} {selectedContact.lastName} · {selectedContact.email || selectedContact.phone}</span>
          <button onClick={() => { setSelectedContact(null); setForm({}); }} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14 }}>×</button>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#14141e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>⚡ GHL Actions</h3>
            {locationConfirmed && locationInfo && (
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#4ade80' }}>✓ {locationInfo.name}</p>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {/* Step 1 — Location confirmation */}
          {!locationConfirmed ? (
            <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
              {confirming ? (
                <p style={{ color: '#6b7280', fontSize: 13 }}>Connecting to GHL…</p>
              ) : locationInfo ? (
                <>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>🏢</div>
                  <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{locationInfo.name}</p>
                  <p style={{ margin: '0 0 4px', fontSize: 12, color: '#6b7280' }}>ID: {locationInfo.locationId}</p>
                  {locationInfo.email && <p style={{ margin: '0 0 16px', fontSize: 12, color: '#6b7280' }}>{locationInfo.email}</p>}
                  <p style={{ margin: '0 0 18px', fontSize: 13, color: '#9ca3af' }}>Confirm this is the correct GHL sub-account before making any changes.</p>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <button onClick={confirm} style={{ padding: '10px 28px', borderRadius: 10, background: '#4f46e5', border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Yes, confirm
                    </button>
                    <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', fontSize: 13, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div>
                  <p style={{ color: '#f87171', fontSize: 13 }}>⚠️ Could not load location info. GHL may not be connected.</p>
                  <button onClick={onClose} style={{ marginTop: 12, padding: '8px 20px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', fontSize: 13, cursor: 'pointer' }}>Close</button>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Action picker */}
              {!action && (
                <div>
                  <p style={{ margin: '0 0 14px', fontSize: 13, color: '#9ca3af' }}>What would you like to do?</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {GHL_ACTIONS.map(a => (
                      <button key={a.key} onClick={() => selectAction(a.key)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0', cursor: 'pointer', fontSize: 13, textAlign: 'left', transition: 'all .15s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.12)'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                      >
                        <span style={{ fontSize: 20 }}>{a.icon}</span>
                        <span style={{ fontWeight: 500 }}>{a.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Search ── */}
              {action === 'search' && (
                <div>
                  <button onClick={() => setAction(null)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, marginBottom: 14, padding: 0 }}>← Back</button>
                  <h4 style={{ margin: '0 0 14px', color: '#f1f5f9', fontSize: 14 }}>🔍 Search Contact</h4>
                  <SearchWidget />
                  {selectedContact && (
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 14, fontSize: 13 }}>
                      <p style={{ margin: '0 0 6px', fontWeight: 700, color: '#f1f5f9' }}>{selectedContact.firstName} {selectedContact.lastName}</p>
                      {selectedContact.email && <p style={{ margin: '0 0 3px', color: '#9ca3af' }}>📧 {selectedContact.email}</p>}
                      {selectedContact.phone && <p style={{ margin: '0 0 3px', color: '#9ca3af' }}>📞 {selectedContact.phone}</p>}
                      {selectedContact.tags?.length > 0 && <p style={{ margin: '6px 0 0', color: '#818cf8', fontSize: 11 }}>Tags: {selectedContact.tags.join(', ')}</p>}
                    </div>
                  )}
                </div>
              )}

              {/* ── Add Contact ── */}
              {action === 'add' && (
                <div>
                  <button onClick={() => setAction(null)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, marginBottom: 14, padding: 0 }}>← Back</button>
                  <h4 style={{ margin: '0 0 14px', color: '#f1f5f9', fontSize: 14 }}>➕ Add New Contact</h4>
                  {[['firstName','First Name'],['lastName','Last Name'],['email','Email'],['phone','Phone']].map(([k,l]) => (
                    <div key={k} style={{ marginBottom: 12 }}>
                      <label style={lbl}>{l}</label>
                      <input value={form[k] || ''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} placeholder={l} style={inp} />
                    </div>
                  ))}
                  {result ? (
                    <p style={{ color: '#4ade80', fontSize: 13 }}>✓ Contact created (ID: {result.id})</p>
                  ) : (
                    <button onClick={doAdd} disabled={loading} style={{ width: '100%', padding: '10px', borderRadius: 10, background: '#4f46e5', border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
                      {loading ? 'Creating…' : 'Create Contact'}
                    </button>
                  )}
                </div>
              )}

              {/* ── Update Contact ── */}
              {action === 'update' && (
                <div>
                  <button onClick={() => setAction(null)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, marginBottom: 14, padding: 0 }}>← Back</button>
                  <h4 style={{ margin: '0 0 14px', color: '#f1f5f9', fontSize: 14 }}>✏️ Update Contact</h4>
                  <SearchWidget />
                  {selectedContact && (
                    <>
                      {[['firstName','First Name'],['lastName','Last Name'],['email','Email'],['phone','Phone']].map(([k,l]) => (
                        <div key={k} style={{ marginBottom: 12 }}>
                          <label style={lbl}>{l}</label>
                          <input value={form[k] || ''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} placeholder={l} style={inp} />
                        </div>
                      ))}
                      {result ? (
                        <p style={{ color: '#4ade80', fontSize: 13 }}>✓ Contact updated.</p>
                      ) : (
                        <button onClick={doUpdate} disabled={loading} style={{ width: '100%', padding: '10px', borderRadius: 10, background: '#4f46e5', border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
                          {loading ? 'Updating…' : 'Save Changes'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Add Tag ── */}
              {action === 'tag' && (
                <div>
                  <button onClick={() => setAction(null)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, marginBottom: 14, padding: 0 }}>← Back</button>
                  <h4 style={{ margin: '0 0 14px', color: '#f1f5f9', fontSize: 14 }}>🏷️ Add Tag to Contact</h4>
                  <SearchWidget />
                  {selectedContact && (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <label style={lbl}>Tags (comma separated)</label>
                        <input value={form.tags || ''} onChange={e => setForm(f => ({...f, tags: e.target.value}))} placeholder="lead, vip, follow-up" style={inp} />
                      </div>
                      {result ? (
                        <p style={{ color: '#4ade80', fontSize: 13 }}>✓ Tags added.</p>
                      ) : (
                        <button onClick={doTag} disabled={loading} style={{ width: '100%', padding: '10px', borderRadius: 10, background: '#4f46e5', border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
                          {loading ? 'Adding…' : 'Add Tags'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Add to Workflow ── */}
              {action === 'workflow' && (
                <div>
                  <button onClick={() => setAction(null)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, marginBottom: 14, padding: 0 }}>← Back</button>
                  <h4 style={{ margin: '0 0 14px', color: '#f1f5f9', fontSize: 14 }}>⚡ Add to Workflow</h4>
                  <SearchWidget />
                  {selectedContact && (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <label style={lbl}>Workflow</label>
                        <select value={form.workflowId || ''} onChange={e => setForm(f => ({...f, workflowId: e.target.value}))} style={{ ...inp }}>
                          <option value="">— select workflow —</option>
                          {workflows.map(w => <option key={w.id} value={w.id}>{w.name} {w.status === 'published' ? '✓' : ''}</option>)}
                        </select>
                      </div>
                      {result ? (
                        <p style={{ color: '#4ade80', fontSize: 13 }}>✓ Enrolled in: {result.workflow}</p>
                      ) : (
                        <button onClick={doWorkflow} disabled={loading} style={{ width: '100%', padding: '10px', borderRadius: 10, background: '#4f46e5', border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
                          {loading ? 'Enrolling…' : 'Add to Workflow'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Add to Opportunity ── */}
              {action === 'opportunity' && (
                <div>
                  <button onClick={() => setAction(null)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 12, marginBottom: 14, padding: 0 }}>← Back</button>
                  <h4 style={{ margin: '0 0 14px', color: '#f1f5f9', fontSize: 14 }}>💼 Add to Opportunity</h4>
                  <SearchWidget />
                  {selectedContact && (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <label style={lbl}>Pipeline</label>
                        <select value={form.pipelineId || ''} onChange={e => setForm(f => ({...f, pipelineId: e.target.value, stageId: ''}))} style={{ ...inp }}>
                          <option value="">— select pipeline —</option>
                          {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      {form.pipelineId && (() => {
                        const stages = pipelines.find(p => p.id === form.pipelineId)?.stages || [];
                        return stages.length > 0 ? (
                          <div style={{ marginBottom: 12 }}>
                            <label style={lbl}>Stage</label>
                            <select value={form.stageId || ''} onChange={e => setForm(f => ({...f, stageId: e.target.value}))} style={{ ...inp }}>
                              <option value="">— select stage —</option>
                              {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </div>
                        ) : null;
                      })()}
                      <div style={{ marginBottom: 12 }}>
                        <label style={lbl}>Opportunity Name</label>
                        <input value={form.oppName || ''} onChange={e => setForm(f => ({...f, oppName: e.target.value}))} placeholder="Deal name…" style={inp} />
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={lbl}>Value ($)</label>
                        <input type="number" value={form.value || ''} onChange={e => setForm(f => ({...f, value: e.target.value}))} placeholder="0" style={inp} />
                      </div>
                      {result ? (
                        <p style={{ color: '#4ade80', fontSize: 13 }}>✓ Opportunity created.</p>
                      ) : (
                        <button onClick={doOpportunity} disabled={loading} style={{ width: '100%', padding: '10px', borderRadius: 10, background: '#4f46e5', border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 4 }}>
                          {loading ? 'Creating…' : 'Create Opportunity'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date(), diff = now - d;
  if (diff < 60000)     return 'just now';
  if (diff < 3600000)   return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000)  return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

function groupByDate(chats) {
  const groups = {}, now = new Date();
  chats.forEach(c => {
    const diff = now - new Date(c.updatedAt || c.createdAt || 0);
    const group =
      diff < 86400000   ? 'Today' :
      diff < 172800000  ? 'Yesterday' :
      diff < 604800000  ? 'Last 7 Days' :
      diff < 2592000000 ? 'Last 30 Days' : 'Older';
    if (!groups[group]) groups[group] = [];
    groups[group].push(c);
  });
  return groups;
}

// Simple markdown renderer
function renderContent(text) {
  if (!text) return null;
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const lines = part.slice(3).split('\n');
      const lang  = lines[0].trim();
      const code  = lines.slice(1).join('\n').replace(/```$/, '').trim();
      return (
        <pre key={i} style={{ background:'rgba(0,0,0,0.4)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, padding:'12px 14px', overflowX:'auto', margin:'8px 0', fontSize:12, lineHeight:1.6 }}>
          {lang && <div style={{ fontSize:10, color:'#6b7280', marginBottom:6 }}>{lang}</div>}
          <code style={{ color:'#e2e8f0', fontFamily:'monospace' }}>{code}</code>
        </pre>
      );
    }
    return (
      <span key={i} style={{ whiteSpace:'pre-wrap' }}>
        {part.split(/(`[^`]+`)/).map((chunk, j) => {
          if (chunk.startsWith('`') && chunk.endsWith('`'))
            return <code key={j} style={{ background:'rgba(0,0,0,0.3)', padding:'1px 5px', borderRadius:4, fontFamily:'monospace', fontSize:'0.9em', color:'#a5b4fc' }}>{chunk.slice(1,-1)}</code>;
          return chunk.split(/(\*\*[^*]+\*\*)/).map((s, k) =>
            s.startsWith('**') && s.endsWith('**')
              ? <strong key={k} style={{ color:'#f1f5f9' }}>{s.slice(2,-2)}</strong>
              : s
          );
        })}
      </span>
    );
  });
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg, isStreaming, persona }) {
  const isUser = msg.role === 'user';
  const avatar = isUser ? '👤' : (persona?.avatar || '🤖');
  return (
    <div style={{ display:'flex', flexDirection: isUser ? 'row-reverse' : 'row', alignItems:'flex-start', gap:10, marginBottom:20, padding:'0 4px' }}>
      <div style={{ width:30, height:30, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background: isUser ? 'rgba(99,102,241,0.25)' : 'rgba(16,185,129,0.2)', border:`1px solid ${isUser ? 'rgba(99,102,241,0.4)' : 'rgba(16,185,129,0.3)'}`, fontSize:13 }}>
        {avatar}
      </div>
      <div style={{ maxWidth:'78%', background: isUser ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)', border:`1px solid ${isUser ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.07)'}`, borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px', padding:'10px 14px', fontSize:13.5, lineHeight:1.65, color:'#e2e8f0' }}>
        {renderContent(msg.content)}
        {isStreaming && <span style={{ display:'inline-block', width:8, height:14, background:'#6366f1', borderRadius:2, marginLeft:2, animation:'blink 0.8s step-start infinite', verticalAlign:'text-bottom' }} />}
        {msg.ts && <div style={{ fontSize:10, color:'#4b5563', marginTop:5, textAlign: isUser ? 'right' : 'left' }}>{formatTime(msg.ts)}</div>}
      </div>
    </div>
  );
}

// ── Persona agent card ────────────────────────────────────────────────────────

function PersonaCard({ persona, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={() => onClick(persona)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: 'pointer', padding: 20, borderRadius: 14,
        background: hovered ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${hovered ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`,
        transition: 'all .18s', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 42, lineHeight: 1 }}>{persona.avatar || '🧑‍💼'}</div>
      <div>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>{persona.name}</p>
        {persona.description && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>{persona.description}</p>}
      </div>
      <div style={{ marginTop: 2, fontSize: 11, padding: '4px 12px', borderRadius: 20, background: hovered ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${hovered ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`, color: hovered ? '#a5b4fc' : '#6b7280', transition: 'all .18s' }}>
        Start chatting →
      </div>
    </div>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ label }) {
  return (
    <div style={{ width: '100%', maxWidth: 640, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#374151', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
    </div>
  );
}

// ── Home / persona + agent picker ─────────────────────────────────────────────

function PersonaHome({ personas, personasLoading, agents, agentsLoading, onSelectPersona, onFreeChat }) {
  const hasPersonas = personas.length > 0;
  const hasAgents   = agents.length > 0;
  const loading     = personasLoading || agentsLoading;

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: '40px 24px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 44, marginBottom: 10 }}>💬</div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>Who do you want to talk to?</h2>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#6b7280' }}>Choose a persona or agent below, or start a free chat.</p>
      </div>

      {loading ? (
        <div style={{ color: '#4b5563', fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {/* Personas section */}
          {hasPersonas && (
            <>
              <SectionLabel label="Personas" />
              <div style={{ width: '100%', maxWidth: 640, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
                {personas.map(p => <PersonaCard key={p.personaId} persona={p} onClick={onSelectPersona} />)}
              </div>
            </>
          )}

          {/* Agents section */}
          {hasAgents && (
            <>
              <SectionLabel label="🤖 AI Agents" />
              <div style={{ width: '100%', maxWidth: 640, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
                {agents.map(a => (
                  <PersonaCard
                    key={a.agentId}
                    persona={{ ...a, personaId: a.agentId, avatar: a.avatar }}
                    onClick={onSelectPersona}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Free chat fallback */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
        <button
          onClick={() => onFreeChat()}
          style={{ fontSize: 13, padding: '9px 20px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', cursor: 'pointer', transition: 'all .15s' }}
          onMouseOver={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = '#e2e8f0'; }}
          onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#9ca3af'; }}
        >
          💬 Start a free chat
        </button>
        <p style={{ margin:0, fontSize:11, color:'#374151' }}>Tip: type <code style={{ background:'rgba(99,102,241,0.12)', color:'#818cf8', padding:'1px 5px', borderRadius:4 }}>/</code> in the message box to see available commands</p>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Chats() {
  const { isAuthenticated, isAuthLoading, locationId } = useApp();

  const [sessions,         setSessions]         = useState([]);
  const [personas,         setPersonas]         = useState([]);
  const [personasLoading,  setPersonasLoading]  = useState(false);
  const [agents,           setAgents]           = useState([]);
  const [agentsLoading,    setAgentsLoading]    = useState(false);
  const [activeId,         setActiveId]         = useState(null);
  const [activePersona,    setActivePersona]    = useState(null); // persona or agent for current session
  const [messages,         setMessages]         = useState([]);
  const [streamText,       setStreamText]       = useState('');
  const [streamStatus,     setStreamStatus]     = useState(''); // 'Thinking…' / '✨ Improving…'
  const [isStreaming,      setIsStreaming]       = useState(false);
  const [input,            setInput]            = useState('');
  const [search,           setSearch]           = useState('');
  const [sideOpen,         setSideOpen]         = useState(true);
  const [hoveredSession,   setHoveredSession]   = useState(null);
  const [cmdPalette,       setCmdPalette]       = useState([]);
  const [cmdIndex,         setCmdIndex]         = useState(0);
  const [showGhlPanel,     setShowGhlPanel]     = useState(false);

  const bottomRef    = useRef(null);
  const inputRef     = useRef(null);
  const abortRef     = useRef(null);
  const restoredRef  = useRef(false);

  // ── Load sessions ──────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    if (!locationId) return;
    try {
      const r = await fetch('/chats', { headers: { 'x-location-id': locationId } });
      const d = await r.json();
      if (d.success) setSessions((d.data || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    } catch (_) {}
  }, [locationId]);

  // ── Load personas ──────────────────────────────────────────────────────────

  const loadPersonas = useCallback(async () => {
    if (!locationId) return;
    setPersonasLoading(true);
    try {
      const r = await fetch('/chats/personas', { headers: { 'x-location-id': locationId } });
      const d = await r.json();
      if (d.success) setPersonas(d.data || []);
    } catch (_) {}
    setPersonasLoading(false);
  }, [locationId]);

  // ── Load shared system agents ──────────────────────────────────────────────

  const loadAgents = useCallback(async () => {
    if (!locationId) return;
    setAgentsLoading(true);
    try {
      const r = await fetch('/chats/agents', { headers: { 'x-location-id': locationId } });
      const d = await r.json();
      if (d.success) setAgents(d.data || []);
    } catch (_) {}
    setAgentsLoading(false);
  }, [locationId]);

  useEffect(() => {
    restoredRef.current = false;
    loadSessions(); loadPersonas(); loadAgents();
  }, [loadSessions, loadPersonas, loadAgents]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamText]);

  // ── Persist last active session to localStorage ────────────────────────────

  useEffect(() => {
    if (!locationId) return;
    if (activeId) localStorage.setItem(`chats_lastActive_${locationId}`, activeId);
  }, [activeId, locationId]);

  // ── Open a session ─────────────────────────────────────────────────────────

  const openSession = useCallback(async (session) => {
    if (!locationId) return;
    setActiveId(session.id);
    setStreamText('');
    setStreamStatus('');
    // Restore persona or agent from session metadata
    if (session.personaId) {
      const found = personas.find(x => x.personaId === session.personaId)
             || agents.find(x => x.agentId === session.personaId)
             || null;
      // Ensure agent objects have personaId set so sendMessage can forward it
      const p = found && found.agentId && !found.personaId
        ? { ...found, personaId: found.agentId }
        : found;
      setActivePersona(p);
    } else {
      setActivePersona(null);
    }
    try {
      const r = await fetch(`/chats/${session.id}`, { headers: { 'x-location-id': locationId } });
      const d = await r.json();
      if (d.success) setMessages(d.data.messages || []);
    } catch (_) { setMessages([]); }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [locationId, personas, agents]);

  // ── Restore last active session after page load ────────────────────────────

  useEffect(() => {
    if (restoredRef.current || !locationId || sessions.length === 0) return;
    restoredRef.current = true;
    const saved = localStorage.getItem(`chats_lastActive_${locationId}`);
    if (!saved) return;
    const session = sessions.find(s => s.id === saved);
    if (session) openSession(session);
  }, [sessions, locationId, openSession]);

  // ── Create new chat (with or without a persona) ────────────────────────────

  const newChat = useCallback(async (persona = null, initialMessage = '') => {
    const id = uid();
    const title = persona ? `Chat with ${persona.name}` : 'New Chat';
    // Agents use agentId; personas use personaId — both stored as personaId in session
    const sessionPersonaId = persona?.agentId || persona?.personaId || null;
    await fetch('/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
      body: JSON.stringify({ id, title, messages: [], personaId: sessionPersonaId }),
    }).catch(() => {});
    setActiveId(id);
    setActivePersona(persona);
    setMessages([]);
    setStreamText('');
    setStreamStatus('');
    await loadSessions();
    if (initialMessage) {
      setTimeout(() => sendMessage(id, initialMessage, [], persona), 50);
    } else {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, loadSessions]);

  // ── Delete session ─────────────────────────────────────────────────────────

  const deleteSession = useCallback((id, e) => {
    e.stopPropagation();
    const session = sessions.find(s => s.id === id);
    const title   = session?.title || 'this chat';

    toast(({ closeToast }) => (
      <div>
        <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 13, color: '#f1f5f9' }}>Delete "{title}"?</p>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#9ca3af' }}>This cannot be undone.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={async () => {
              closeToast();
              try {
                await fetch(`/chats/${id}`, { method: 'DELETE', headers: { 'x-location-id': locationId } });
                if (activeId === id) { setActiveId(null); setActivePersona(null); setMessages([]); }
                await loadSessions();
                toast.success('Chat deleted.');
              } catch {
                toast.error('Failed to delete chat. Please try again.');
              }
            }}
            style={{ flex: 1, padding: '7px', borderRadius: 7, background: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
          >Delete</button>
          <button
            onClick={closeToast}
            style={{ flex: 1, padding: '7px', borderRadius: 7, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af', cursor: 'pointer', fontSize: 12 }}
          >Cancel</button>
        </div>
      </div>
    ), { autoClose: false, closeButton: false, closeOnClick: false });
  }, [locationId, activeId, sessions, loadSessions]);

  // ── Send message ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (sessionId, text, currentMessages, persona) => {
    if (!text.trim() || isStreaming) return;
    const userMsg    = { role: 'user', content: text.trim(), ts: Date.now() };
    const newMsgs    = [...currentMessages, userMsg];
    setMessages(newMsgs);
    setInput('');
    setIsStreaming(true);
    setStreamText('');
    setStreamStatus('Thinking…');

    const history = currentMessages.map(m => ({ role: m.role, content: m.content }));

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const res = await fetch(`/chats/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': locationId },
        body: JSON.stringify({ message: text.trim(), history, personaId: persona?.agentId || persona?.personaId || null }),
        signal: ctrl.signal,
      });

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '', fullText = '', streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const lines = part.trim().split('\n');
          let evt = '', data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) evt  = line.slice(7);
            if (line.startsWith('data: '))  data = line.slice(6);
          }
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            if (evt === 'status') { setStreamStatus(parsed.text); setStreamText(''); }
            else if (evt === 'text') { fullText += parsed.text; setStreamText(fullText); setStreamStatus(''); }
            else if (evt === 'done' || evt === 'error') { streamDone = true; break; }
          } catch (_) {}
        }
      }

      setMessages(prev => [...prev, { role: 'assistant', content: fullText, ts: Date.now() }]);
      setStreamText('');
      setStreamStatus('');
      await loadSessions();
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.', ts: Date.now() }]);
        setStreamText('');
        setStreamStatus('');
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [isStreaming, locationId, loadSessions]);

  // ── Command palette ────────────────────────────────────────────────────────

  const allCommands = [
    ...personas.map(p => ({ id: p.personaId, name: p.name, avatar: p.avatar || '🧑‍💼', description: p.description, cmd: p.name.toLowerCase().replace(/\s+/g, '-'), type: 'persona' })),
    ...agents.map(a  => ({ id: a.agentId || a.personaId, name: a.name, avatar: a.avatar || '🤖', description: a.description, cmd: a.id || (a.name.toLowerCase().replace(/\s+/g, '-')), type: 'agent' })),
  ];

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInput(val);
    if (val.startsWith('/')) {
      const query = val.slice(1).toLowerCase();
      const matches = allCommands.filter(c =>
        c.cmd.includes(query) || c.name.toLowerCase().includes(query)
      );
      setCmdPalette(matches);
      setCmdIndex(0);
    } else {
      setCmdPalette([]);
    }
  };

  const selectCommand = (cmd) => {
    setCmdPalette([]);
    setInput('');
    const target = personas.find(p => p.personaId === cmd.id) || agents.find(a => (a.agentId || a.personaId) === cmd.id);
    if (!target) return;
    const normalized = { ...target, personaId: target.personaId || target.agentId, agentId: target.agentId };
    if (activeId) {
      // Switch the active persona/agent in the current chat without creating a new one
      setActivePersona(normalized);
      toast.success(`Switched to ${normalized.name}`);
    } else {
      newChat(normalized);
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;
    if (cmdPalette.length > 0) { selectCommand(cmdPalette[cmdIndex] || cmdPalette[0]); return; }
    if (!activeId) newChat(null, input);
    else sendMessage(activeId, input, messages, activePersona);
  };

  const handleKeyDown = (e) => {
    if (cmdPalette.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIndex(i => Math.min(i + 1, cmdPalette.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setCmdIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Escape')    { setCmdPalette([]); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const stopStream = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStreamText('');
    setStreamStatus('');
  };

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return <AuthGate icon="💬" title="Chats" subtitle="Connect your API key to access Chats" />;

  const filtered    = sessions.filter(s => !search || s.title?.toLowerCase().includes(search.toLowerCase()));
  const groups      = groupByDate(filtered);
  const groupOrder  = ['Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'Older'];

  const showHome = !activeId;

  return (
    <div style={{ display:'flex', height:'100%', background:'#0f0f13', overflow:'hidden' }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .chat-input:focus { outline:none; }
        .chat-scroll::-webkit-scrollbar { width:4px; }
        .chat-scroll::-webkit-scrollbar-track { background:transparent; }
        .chat-scroll::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:4px; }
      `}</style>

      {/* ── Left sidebar ── */}
      <div style={{ width: sideOpen ? 260 : 0, flexShrink:0, overflow:'hidden', transition:'width 0.2s ease', display:'flex', flexDirection:'column', background:'#0a0a0f', borderRight:'1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:260 }}>
          {/* Header */}
          <div style={{ padding:'14px 12px 10px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
            <button
              onClick={() => { setActiveId(null); setActivePersona(null); setMessages([]); setStreamText(''); setStreamStatus(''); }}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:8, padding:'9px 12px', borderRadius:10, background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.3)', color:'#a5b4fc', cursor:'pointer', fontSize:13, fontWeight:500, transition:'all .15s' }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(99,102,241,0.25)'}
              onMouseOut={e  => e.currentTarget.style.background = 'rgba(99,102,241,0.15)'}
            >
              <span style={{ fontSize:16 }}>🏠</span> All Agents
            </button>
          </div>

          {/* Search */}
          <div style={{ padding:'8px 10px', flexShrink:0 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chats…"
              style={{ width:'100%', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, padding:'6px 10px', fontSize:12, color:'#e2e8f0', outline:'none', boxSizing:'border-box' }} />
          </div>

          {/* Sessions list */}
          <div className="chat-scroll" style={{ flex:1, overflowY:'auto', padding:'0 6px 12px' }}>
            {sessions.length === 0 ? (
              <p style={{ fontSize:12, color:'#4b5563', textAlign:'center', padding:'24px 8px' }}>No chats yet.<br/>Pick a persona to start.</p>
            ) : (
              groupOrder.map(group => {
                const items = groups[group];
                if (!items?.length) return null;
                return (
                  <div key={group}>
                    <p style={{ fontSize:10, fontWeight:600, color:'#4b5563', textTransform:'uppercase', letterSpacing:'0.06em', padding:'10px 8px 4px' }}>{group}</p>
                    {items.map(s => {
                      const sp = personas.find(p => p.personaId === s.personaId);
                      const isHovered = hoveredSession === s.id;
                      return (
                        <div key={s.id} onClick={() => openSession(s)}
                          onMouseEnter={() => setHoveredSession(s.id)}
                          onMouseLeave={() => setHoveredSession(null)}
                          style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8, cursor:'pointer', background: activeId === s.id ? 'rgba(99,102,241,0.15)' : isHovered ? 'rgba(255,255,255,0.04)' : 'transparent', border:`1px solid ${activeId === s.id ? 'rgba(99,102,241,0.3)' : 'transparent'}`, marginBottom:2, transition:'all .12s' }}
                        >
                          <span style={{ fontSize:16, flexShrink:0 }}>{sp?.avatar || '💬'}</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <p style={{ margin:0, fontSize:12, fontWeight:500, color: activeId === s.id ? '#a5b4fc' : '#d1d5db', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.title || 'Chat'}</p>
                            <p style={{ margin:0, fontSize:10, color:'#4b5563' }}>{sp ? sp.name : 'Free chat'} · {formatTime(s.updatedAt || s.createdAt)}</p>
                          </div>
                          <button onClick={e => deleteSession(s.id, e)}
                            title="Delete chat"
                            style={{ flexShrink:0, background:'none', border:'none', cursor:'pointer', fontSize:16, padding:'2px 5px', borderRadius:4, color:'#fff', opacity: isHovered ? 0.7 : 0, transition:'opacity .15s', lineHeight:1, fontWeight:300 }}
                            onMouseEnter={e => e.currentTarget.style.opacity = 1}
                            onMouseLeave={e => e.currentTarget.style.opacity = isHovered ? 0.7 : 0}
                          >×</button>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>

        {/* Topbar */}
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'0 16px', height:52, borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, background:'rgba(0,0,0,0.2)' }}>
          <button onClick={() => setSideOpen(v => !v)} style={{ background:'none', border:'none', color:'#6b7280', cursor:'pointer', fontSize:16, padding:'4px 6px', borderRadius:6 }} title="Toggle sidebar">☰</button>
          {activePersona ? (
            <div style={{ display:'flex', alignItems:'center', gap:8, flex:1 }}>
              <span style={{ fontSize:20 }}>{activePersona.avatar}</span>
              <div>
                <p style={{ margin:0, fontSize:14, fontWeight:700, color:'#f1f5f9', lineHeight:1.2 }}>{activePersona.name}</p>
                {activePersona.description && <p style={{ margin:0, fontSize:11, color:'#6b7280' }}>{activePersona.description}</p>}
              </div>
            </div>
          ) : (
            <span style={{ fontSize:14, fontWeight:600, color:'#e2e8f0', flex:1 }}>
              {activeId ? (sessions.find(s => s.id === activeId)?.title || 'Chat') : 'Chats'}
            </span>
          )}
          {activeId && (
            <button
              onClick={() => setShowGhlPanel(v => !v)}
              style={{ fontSize:11, padding:'4px 10px', borderRadius:6, background: showGhlPanel ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)', border:`1px solid ${showGhlPanel ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`, color: showGhlPanel ? '#a5b4fc' : '#9ca3af', cursor:'pointer', transition:'all .15s' }}
              title="GHL Actions"
            >⚡ GHL</button>
          )}
          {isStreaming && (
            <button onClick={stopStream} style={{ fontSize:11, padding:'4px 10px', borderRadius:6, background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', color:'#f87171', cursor:'pointer' }}>⏹ Stop</button>
          )}
        </div>

        {/* Messages / Home */}
        <div className="chat-scroll" style={{ flex:1, overflowY:'auto', padding: showHome ? 0 : '20px 0' }}>
          {showHome ? (
            <PersonaHome
              personas={personas}
              personasLoading={personasLoading}
              agents={agents}
              agentsLoading={agentsLoading}
              onSelectPersona={persona => newChat(persona)}
              onFreeChat={() => newChat(null)}
            />
          ) : (
            <div style={{ maxWidth:760, margin:'0 auto', padding:'0 20px' }}>
              {/* Persona greeting at top of empty chat */}
              {messages.length === 0 && !isStreaming && activePersona && (
                <div style={{ textAlign:'center', padding:'40px 0 20px' }}>
                  <div style={{ fontSize:52, marginBottom:12 }}>{activePersona.avatar}</div>
                  <p style={{ margin:0, fontWeight:700, fontSize:16, color:'#f1f5f9' }}>Hi, I'm {activePersona.name}</p>
                  {activePersona.description && <p style={{ margin:'6px 0 0', fontSize:13, color:'#6b7280' }}>{activePersona.description}</p>}
                  <p style={{ margin:'16px 0 0', fontSize:12, color:'#4b5563' }}>What would you like to talk about?</p>
                </div>
              )}

              {messages.map((msg, i) => (
                <MessageBubble key={i} msg={msg} isStreaming={false} persona={activePersona} />
              ))}

              {/* Streaming indicator */}
              {isStreaming && !streamText && streamStatus && (
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 40px', color:'#6b7280', fontSize:13 }}>
                  <span style={{ display:'flex', gap:4 }}>
                    {[0,0.2,0.4].map((d, i) => (
                      <span key={i} style={{ width:6, height:6, borderRadius:'50%', background:'#6366f1', display:'inline-block', animation:`pulse 1.2s ease-in-out ${d}s infinite` }} />
                    ))}
                  </span>
                  {streamStatus}
                </div>
              )}

              {isStreaming && streamText && (
                <div>
                  <MessageBubble msg={{ role:'assistant', content: streamText }} isStreaming={true} persona={activePersona} />
                  {streamStatus === '✨ Improving…' && (
                    <div style={{ marginTop:-12, marginBottom:8, paddingLeft:42, display:'flex', alignItems:'center', gap:5 }}>
                      <span style={{ fontSize:11, color:'#6366f1', animation:'pulse 1.5s ease-in-out infinite' }}>✨</span>
                      <span style={{ fontSize:11, color:'#4b5563' }}>Improving response…</span>
                    </div>
                  )}
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input — only shown when in a chat session */}
        {!showHome && (
          <div style={{ padding:'12px 16px 16px', borderTop:'1px solid rgba(255,255,255,0.06)', background:'rgba(0,0,0,0.15)', flexShrink:0 }}>
            {activePersona && (
              <div style={{ maxWidth:760, margin:'0 auto 8px', display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:14 }}>{activePersona.avatar}</span>
                <span style={{ fontSize:11, color:'#4b5563' }}>Chatting with <span style={{ color:'#6b7280' }}>{activePersona.name}</span> · responses are AI-improved</span>
              </div>
            )}
            <div style={{ maxWidth:760, margin:'0 auto', position:'relative' }}>
              {/* Command palette */}
              {cmdPalette.length > 0 && (
                <div style={{ position:'absolute', bottom:'calc(100% + 8px)', left:0, right:0, background:'#1a1a24', border:'1px solid rgba(99,102,241,0.35)', borderRadius:12, overflow:'hidden', zIndex:50, boxShadow:'0 -8px 32px rgba(0,0,0,0.5)' }}>
                  <div style={{ padding:'6px 12px 4px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'#4b5563', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
                    Commands — ↑↓ navigate · Enter to select · Esc to close
                  </div>
                  {cmdPalette.slice(0, 8).map((cmd, i) => (
                    <div key={cmd.id} onMouseDown={() => selectCommand(cmd)}
                      style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 14px', cursor:'pointer', background: i === cmdIndex ? 'rgba(99,102,241,0.15)' : 'transparent', borderLeft: i === cmdIndex ? '2px solid #6366f1' : '2px solid transparent', transition:'all .1s' }}
                      onMouseEnter={() => setCmdIndex(i)}
                    >
                      <span style={{ fontSize:18, flexShrink:0 }}>{cmd.avatar}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600, color: i === cmdIndex ? '#a5b4fc' : '#e2e8f0' }}>
                          <span style={{ color:'#6366f1', fontFamily:'monospace' }}>/{cmd.cmd}</span>
                          <span style={{ marginLeft:8, fontWeight:400 }}>{cmd.name}</span>
                        </div>
                        {cmd.description && <div style={{ fontSize:11, color:'#4b5563', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:1 }}>{cmd.description}</div>}
                      </div>
                      <span style={{ fontSize:10, padding:'2px 7px', borderRadius:10, background: cmd.type === 'agent' ? 'rgba(16,185,129,0.12)' : 'rgba(99,102,241,0.12)', color: cmd.type === 'agent' ? '#34d399' : '#818cf8', flexShrink:0 }}>{cmd.type}</span>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                ref={inputRef}
                className="chat-input"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={activePersona ? `Message ${activePersona.name}… (type / for commands)` : 'Message… (type / for commands)'}
                rows={1}
                disabled={isStreaming}
                style={{ width:'100%', boxSizing:'border-box', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:12, padding:'11px 48px 11px 14px', fontSize:14, color:'#e2e8f0', resize:'none', lineHeight:1.5, maxHeight:160, overflowY:'auto', transition:'border-color .15s' }}
                onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,0.5)'}
                onBlur={e  => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; setTimeout(() => setCmdPalette([]), 150); }}
                onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', width:32, height:32, borderRadius:8, border:'none', cursor:'pointer', background: input.trim() && !isStreaming ? '#6366f1' : 'rgba(255,255,255,0.08)', color: input.trim() && !isStreaming ? '#fff' : '#4b5563', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, transition:'all .15s' }}
              >↑</button>
            </div>
          </div>
        )}
      </div>

      {/* GHL Action Panel overlay */}
      {showGhlPanel && <GhlPanel locationId={locationId} onClose={() => setShowGhlPanel(false)} />}
    </div>
  );
}
