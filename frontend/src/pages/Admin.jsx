/**
 * frontend/src/pages/Admin.jsx
 *
 * Admin Dashboard — separate from the user-facing app.
 * Uses its own admin key (x-admin-key) stored in localStorage.
 *
 * Tabs:
 *   Overview  — aggregate stats (total/active/idle/expired/uninstalled)
 *   Locations — table of all registered locations with actions
 *   Logs      — filterable activity log viewer
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';

function confirmToast(message, onConfirm, confirmLabel = 'Confirm', confirmColor = '#dc2626') {
  toast(({ closeToast }) => (
    <div>
      <p style={{ margin: '0 0 10px', fontWeight: 500 }}>{message}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => { closeToast(); onConfirm(); }}
          style={{ background: confirmColor, border: 'none', borderRadius: 6, color: '#fff', padding: '5px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >{confirmLabel}</button>
        <button
          onClick={closeToast}
          style={{ background: '#333', border: 'none', borderRadius: 6, color: '#e5e7eb', padding: '5px 12px', cursor: 'pointer', fontSize: 13 }}
        >Cancel</button>
      </div>
    </div>
  ), { autoClose: false, closeOnClick: false, draggable: false });
}

// ── Static feature/role defaults (mirrors roleService.js) ─────────────────────
const ALL_FEATURES_DEFAULT = [
  // Pages
  { key: 'dashboard',        label: 'Dashboard',             icon: '⊞',  group: 'Pages' },
  { key: 'chats',            label: 'Chats',                 icon: '💬', group: 'Pages' },
  { key: 'settings',         label: 'Settings',              icon: '⚙️', group: 'Pages' },
  // Agents & Automation
  { key: 'agents',           label: 'AI Agents',             icon: '🤖', group: 'Agents & Automation' },
  { key: 'ghl_agent',        label: 'GHL Agent',             icon: '⚡', group: 'Agents & Automation' },
  { key: 'workflows',        label: 'Workflow Builder',      icon: '🔀', group: 'Agents & Automation' },
  { key: 'brain',            label: 'Brain (Knowledge Base)', icon: '🧠', group: 'Agents & Automation' },
  // Builders
  { key: 'funnel_builder',   label: 'Funnel Builder',        icon: '🏗️', group: 'Builders' },
  { key: 'website_builder',  label: 'Website Builder',       icon: '🌐', group: 'Builders' },
  { key: 'email_builder',    label: 'Email Builder',         icon: '📧', group: 'Builders' },
  { key: 'campaign_builder', label: 'Campaign Builder',      icon: '📣', group: 'Builders' },
  // Ads
  { key: 'ads_generator',    label: 'Bulk Ads Generator',    icon: '🎯', group: 'Ads' },
  { key: 'ad_library',       label: 'Ad Library Intel',      icon: '📊', group: 'Ads' },
  // Social
  { key: 'social_planner',   label: 'Social Planner',        icon: '📱', group: 'Social' },
  { key: 'manychat',         label: 'ManyChat Integration',  icon: '📩', group: 'Social' },
];

const ALL_FEATURE_KEYS = ALL_FEATURES_DEFAULT.map(f => f.key);

const TIER_ALLOWED_FEATURES = {
  bronze:  ['ads_generator', 'ad_library', 'social_planner'],
  silver:  ['funnel_builder','website_builder','ads_generator','social_planner','email_builder','ad_library','campaign_builder'],
  gold:    ['funnel_builder','website_builder','ads_generator','social_planner','email_builder','ad_library','campaign_builder','agents','ghl_agent','workflows','manychat','settings','brain'],
  diamond: null, // all
};

const TIER_COLORS = { bronze: '#cd7f32', silver: '#9ca3af', gold: '#f59e0b', diamond: '#60a5fa' };
const TIER_ICONS  = { bronze: '🥉', silver: '🥈', gold: '🥇', diamond: '💎' };

// Which external integrations each app feature requires (null = GHL-native, always available)
const FEATURE_INTEGRATION_MAP = {
  funnel_builder:   null,
  website_builder:  null,
  ads_generator:    ['facebook_ads', 'google_ads', 'tiktok_ads'],
  social_planner:   ['social_facebook', 'social_instagram', 'social_tiktok_organic', 'social_youtube', 'social_linkedin_organic', 'social_pinterest'],
  email_builder:    ['sendgrid'],
  ad_library:       ['facebook_ads', 'google_ads'],
  campaign_builder: null,
  agents:           ['openai', 'openrouter', 'perplexity'],
  ghl_agent:        null,
  workflows:        null,
  manychat:         ['manychat'],
  settings:         null,
};

const BUILTIN_ROLES_DEFAULT = [
  { id: 'owner',      name: 'Owner',      features: ['*'],            builtin: true },
  { id: 'admin',      name: 'Admin',      features: ALL_FEATURE_KEYS, builtin: true },
  { id: 'mini_admin', name: 'Mini Admin', features: ['*'],            builtin: true, description: 'Full access + can toggle beta features per location' },
  { id: 'manager',    name: 'Manager',    features: ['dashboard','funnel_builder','website_builder','email_builder','campaign_builder','ads_generator','ad_library','social_planner','manychat','settings'], builtin: true },
  { id: 'member',     name: 'Member',     features: ['dashboard','ads_generator','ad_library','social_planner'], builtin: true },
  { id: 'chats_only', name: 'Chat User',  features: ['dashboard','chats'], builtin: true, description: 'Default — Chats access only' },
];

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const h = () => setM(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return m;
}

// ── API helper ────────────────────────────────────────────────────────────────

const BASE = '';

async function adminFetch(path, { method = 'GET', adminKey, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'x-admin-key':  adminKey,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

function shortLocationId(locationId, maxLength = 10) {
  if (!locationId) return '';
  return locationId.length > maxLength ? `${locationId.slice(0, maxLength)}...` : locationId;
}

function getLocationNameFromList(locations, locationId) {
  if (!locationId || locationId === '__shared__') return '';
  const match = locations.find((loc) => loc.locationId === locationId);
  return match?.name?.trim() || '';
}

function formatLocationLabelFromList(locations, locationId, fallbackName = 'Unnamed Location') {
  if (locationId === '__shared__') return 'Shared Across All Locations';
  if (!locationId) return fallbackName;
  const name = getLocationNameFromList(locations, locationId);
  return name ? `${name} · ${locationId}` : locationId;
}

function LocationIdentity({
  locationId,
  name,
  fallbackName = 'Unnamed Location',
  nameColor = '#e5e7eb',
  idColor = '#a78bfa',
  nameWeight = 600,
  idFontSize = 12,
  compact = false,
  shortId = false,
}) {
  if (locationId === '__shared__') {
    return <span style={{ color: nameColor, fontWeight: nameWeight }}>Shared Across All Locations</span>;
  }

  const displayName = name?.trim() || fallbackName;
  const displayId = shortId ? shortLocationId(locationId) : locationId;

  if (compact) {
    return (
      <span style={{ color: nameColor }}>
        {displayName}
        {locationId ? <span style={{ color: idColor, fontFamily: 'monospace', fontSize: idFontSize }}> {' · '}{displayId}</span> : null}
      </span>
    );
  }

  return (
    <div>
      <div style={{ color: nameColor, fontWeight: nameWeight }}>{displayName}</div>
      {locationId ? (
        <div style={{ fontFamily: 'monospace', color: idColor, fontSize: idFontSize, marginTop: 2 }}>
          {displayId}
        </div>
      ) : null}
    </div>
  );
}

// ── Brain Detail helper constants ─────────────────────────────────────────────

const BD = {
  bg:'#070b14', card:'#0f1623', border:'#1e2a3a',
  blue:'#2563eb', blueDark:'#1d4ed8', green:'#10b981', amber:'#f59e0b', red:'#ef4444',
  textPri:'#f9fafb', textSec:'#9ca3af', textMuted:'#6b7280', codeBg:'#0a0f1a',
};
const bdLabel = { display:'block', color:BD.textSec, fontSize:12, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 };
const bdInput = { width:'100%', boxSizing:'border-box', background:'#0a0f1a', border:`1px solid ${BD.border}`, borderRadius:8, color:BD.textPri, padding:'9px 12px', fontSize:14, marginBottom:14, outline:'none' };
const bdBtnP = { background:BD.blue, border:'none', borderRadius:8, color:'#fff', padding:'9px 18px', fontSize:14, fontWeight:600, cursor:'pointer' };
const bdBtnS = { background:'none', border:`1px solid ${BD.border}`, borderRadius:6, color:BD.textSec, padding:'7px 14px', fontSize:13, cursor:'pointer' };
const bdTh = { padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:BD.textMuted, borderBottom:`1px solid ${BD.border}` };
const bdTd = { padding:'12px 14px', fontSize:13, color:BD.textPri, borderBottom:`1px solid ${BD.border}88`, verticalAlign:'middle' };

function bdYtThumb(vId) { return `https://img.youtube.com/vi/${vId}/mqdefault.jpg`; }
function bdFmtDuration(s) {
  if (!s) return '—';
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function bdFmtViews(n) {
  if (!n) return '—';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1).replace('.0','')+'K';
  return n.toLocaleString();
}
function bdTimeAgo(ts) {
  if (!ts) return 'Never';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff/60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}
function bdPublishedAgo(d) {
  if (!d) return '—';
  const days = Math.floor((Date.now()-new Date(d).getTime())/86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days/7)}w ago`;
  if (days < 365) return `${Math.floor(days/30)}mo ago`;
  return `${Math.floor(days/365)}y ago`;
}

// ── Admin Source Accordion (mirrors Brain.jsx SourceAccordion) ────────────────

function AdminSourceAccordion({ s, rank, pct, rankColor, rankLabel }) {
  const [open, setOpen] = useState(rank === 0);
  return (
    <div style={{ border: `1px solid ${rank === 0 ? rankColor + '55' : 'rgba(255,255,255,0.07)'}`, borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: rank === 0 ? 'rgba(245,158,11,0.05)' : 'rgba(255,255,255,0.02)', border: 'none', cursor: 'pointer', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}
      >
        <span style={{ fontSize: 10, fontWeight: 800, color: rankColor, background: rankColor + '18', border: `1px solid ${rankColor}44`, borderRadius: 6, padding: '2px 7px', flexShrink: 0, minWidth: 42, textAlign: 'center' }}>
          {rankLabel}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.sourceLabel || `Source ${rank + 1}`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: rankColor, transition: 'width 0.4s ease' }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: rankColor, flexShrink: 0 }}>{pct}%</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {s.url && (
            <a href={s.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>↗</a>
          )}
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
        </div>
      </button>
      {open && s.excerpt && (
        <div style={{ padding: '10px 14px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
          <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
            {s.excerpt}{s.excerpt.length >= 300 ? '…' : ''}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Admin Search View (mirrors Brain.jsx SearchView) ──────────────────────────

function AdminSearchView({ brains, adminKey, getLocationLabel }) {
  const [selectedBrainVal, setSelectedBrainVal] = useState(() => {
    if (brains.length === 0) return '';
    const b = brains[0];
    const locQ = (b._locationId && b._locationId !== '__shared__') ? `?loc=${encodeURIComponent(b._locationId)}` : '';
    return JSON.stringify({ brainId: b.brainId, locQ });
  });
  const [query,        setQuery]        = useState('');
  const [asking,       setAsking]       = useState(false);
  const [answer,       setAnswer]       = useState('');
  const [sources,      setSources]      = useState(null);
  const [searchMethod, setSearchMethod] = useState('');
  const [noContext,    setNoContext]     = useState(false);
  const [error,        setError]        = useState('');

  useEffect(() => {
    if (!selectedBrainVal && brains.length > 0) {
      const b = brains[0];
      const locQ = (b._locationId && b._locationId !== '__shared__') ? `?loc=${encodeURIComponent(b._locationId)}` : '';
      setSelectedBrainVal(JSON.stringify({ brainId: b.brainId, locQ }));
    }
  }, [brains]);

  async function runAsk() {
    if (!query.trim() || !selectedBrainVal || asking) return;
    const { brainId, locQ } = JSON.parse(selectedBrainVal);
    setAsking(true); setAnswer(''); setSources(null); setSearchMethod(''); setNoContext(false); setError('');
    try {
      const res = await fetch(`/brain/${brainId}/ask${locQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
        body: JSON.stringify({ query: query.trim(), k: 20 }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Server error ${res.status}`);
        setAsking(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'sources')    { setSources(evt.sources); setSearchMethod(evt.searchMethod || 'keyword'); }
            if (evt.type === 'text')       { setAnswer(prev => prev + evt.text); }
            if (evt.type === 'no_context') { setNoContext(true); }
            if (evt.type === 'error')      { setError(evt.error); }
            if (evt.type === 'done')       { setAsking(false); }
          } catch {}
        }
      }
    } catch (e) { setError(e.message); }
    setAsking(false);
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: BD.textPri }}>Ask Brain</h2>
        <p style={{ margin: 0, fontSize: 14, color: BD.textMuted }}>Ask any question — brain will analyze and answer from the transcripts.</p>
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <select
          value={selectedBrainVal}
          onChange={e => { setSelectedBrainVal(e.target.value); setAnswer(''); setSources(null); setNoContext(false); setError(''); }}
          style={{ ...bdInput, marginBottom: 0, width: 220, flexShrink: 0 }}
        >
          {brains.map(b => {
            const locQ = (b._locationId && b._locationId !== '__shared__') ? `?loc=${encodeURIComponent(b._locationId)}` : '';
            return (
              <option key={`${b._locationId}-${b.brainId}`} value={JSON.stringify({ brainId: b.brainId, locQ })}>
                {b.name}{b._locationId && b._locationId !== '__shared__' ? ` (${getLocationLabel?.(b._locationId) || b._locationId})` : ' (Shared Across All Locations)'}
              </option>
            );
          })}
        </select>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && runAsk()}
          placeholder="Ask anything about this brain…"
          style={{ ...bdInput, marginBottom: 0, flex: 1 }}
        />
        <button
          onClick={runAsk}
          disabled={asking || !query.trim() || !selectedBrainVal}
          style={{ ...bdBtnP, flexShrink: 0, opacity: (asking || !query.trim() || !selectedBrainVal) ? 0.5 : 1, minWidth: 90 }}
        >
          {asking ? '…' : 'Search'}
        </button>
      </div>

      {/* Thinking indicator */}
      {asking && !answer && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: BD.textMuted, fontSize: 13 }}>
          <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: 16 }}>⟳</span>
          Analyzing transcripts…
        </div>
      )}

      {/* Best Answer */}
      {(answer || (asking && answer)) && (
        <div style={{ background: '#0a1628', border: `1px solid ${BD.blue}33`, borderRadius: 12, padding: '20px 22px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: BD.blue }}>Best Answer</span>
            {searchMethod && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                padding: '2px 7px', borderRadius: 99,
                background: searchMethod === 'vector' ? 'rgba(99,102,241,0.15)' : 'rgba(245,158,11,0.12)',
                color:      searchMethod === 'vector' ? '#a5b4fc'               : '#fbbf24',
                border:     `1px solid ${searchMethod === 'vector' ? 'rgba(99,102,241,0.3)' : 'rgba(245,158,11,0.25)'}`,
              }}>
                {searchMethod === 'vector' ? '⚡ Vector DB' : '🔤 Keyword'}
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {answer}
            {asking && <span style={{ display: 'inline-block', width: 2, height: '1em', background: BD.blue, marginLeft: 2, animation: 'pulse 1s ease-in-out infinite', verticalAlign: 'text-bottom' }} />}
          </div>
        </div>
      )}

      {/* No context */}
      {noContext && (
        <div style={{ background: BD.card, border: `1px solid ${BD.border}`, borderRadius: 10, padding: '16px 18px', color: BD.textMuted, fontSize: 13 }}>
          No indexed transcripts matched your query. Try syncing more videos or rephrasing your question.
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: '#1c0a00', border: `1px solid #dc262644`, borderRadius: 10, padding: '14px 16px', color: '#f87171', fontSize: 13 }}>{error}</div>
      )}

      {/* Top 5 Answers — ranked excerpt cards */}
      {sources?.length > 0 && !asking && (() => {
        const ANS_COLORS = ['#f59e0b', '#94a3b8', '#cd7c4a', '#6b7280', '#6b7280'];
        const ANS_LABELS = ['#1 Best Match', '#2', '#3', '#4', '#5'];
        const maxScore   = Math.max(...sources.map(s => s.score || 0)) || 1;
        const top5ans    = [...sources].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
        return (
          <div style={{ marginBottom: 24 }}>
            <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: BD.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Top 5 Answers by Accuracy
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {top5ans.map((s, i) => {
                const pct   = Math.round(((s.score || 0) / maxScore) * 100);
                const color = ANS_COLORS[i];
                return (
                  <div key={i} style={{ background: i === 0 ? 'rgba(245,158,11,0.05)' : BD.card, border: `1px solid ${i === 0 ? '#f59e0b55' : BD.border}`, borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color, background: color + '18', border: `1px solid ${color}44`, borderRadius: 6, padding: '2px 8px', flexShrink: 0 }}>
                        {ANS_LABELS[i]}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.sourceLabel || `Source ${i + 1}`}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 800, color, flexShrink: 0 }}>{pct}%</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.07)', marginBottom: 12, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color }} />
                    </div>
                    {s.excerpt && (
                      <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', lineHeight: 1.75 }}>
                        {s.excerpt}{s.excerpt.length >= 300 ? '…' : ''}
                      </p>
                    )}
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer"
                        style={{ display: 'inline-block', marginTop: 8, fontSize: 11, color: BD.textMuted, textDecoration: 'none' }}>
                        ↗ Watch on YouTube
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Top 10 Sources — accordion */}
      {sources?.length > 0 && !asking && (() => {
        const RANK_COLORS = ['#f59e0b','#94a3b8','#cd7c4a','#6b7280','#6b7280','#6b7280','#6b7280','#6b7280','#6b7280','#6b7280'];
        const RANK_LABELS = ['#1','#2','#3','#4','#5','#6','#7','#8','#9','#10'];
        const maxScore = Math.max(...sources.map(s => s.score || 0)) || 1;
        const top10    = [...sources].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10);
        return (
          <div>
            <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: BD.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Top {top10.length} Sources
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {top10.map((s, i) => {
                const pct = Math.round(((s.score || 0) / maxScore) * 100);
                return <AdminSourceAccordion key={i} s={s} rank={i} pct={pct} rankColor={RANK_COLORS[i]} rankLabel={RANK_LABELS[i]} />;
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Admin Brain Modals ────────────────────────────────────────────────────────

function AdminAddChannelModal({ brainId, adminKey, brainLocQ, onClose, onAdded }) {
  const [channelName, setChannelName] = useState('');
  const [channelUrl,  setChannelUrl]  = useState('');
  const [isPrimary,   setIsPrimary]   = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  async function handleAdd() {
    if (!channelName.trim()) { setError('Channel name is required.'); return; }
    if (!channelUrl.trim())  { setError('Channel URL is required.'); return; }
    setSaving(true); setError('');
    try {
      const r = await adminFetch(`/brain/${brainId}/channels${brainLocQ}`, {
        method: 'POST', adminKey, body: { channelName: channelName.trim(), channelUrl: channelUrl.trim(), isPrimary },
      });
      if (!r.success) throw new Error(r.error || 'Failed.');
      onAdded(r.data);
    } catch(e) { setError(e.message); }
    setSaving(false);
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:16, padding:28, width:'100%', maxWidth:440 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
          <div>
            <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:BD.textPri }}>Add a channel</h2>
            <p style={{ margin:'4px 0 0', fontSize:13, color:BD.textMuted }}>Add another YouTube channel to this brain.</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:BD.textMuted, fontSize:20, cursor:'pointer', marginLeft:12 }}>✕</button>
        </div>
        <div style={{ borderBottom:`1px solid ${BD.border}`, margin:'16px 0' }} />
        {error && <div style={{ marginBottom:14, padding:'10px 14px', borderRadius:8, background:'#1c0a00', border:`1px solid ${BD.red}44`, color:'#f87171', fontSize:13 }}>{error}</div>}
        <label style={bdLabel}>Channel name <span style={{ color:BD.red }}>*</span></label>
        <input value={channelName} onChange={e => setChannelName(e.target.value)} placeholder="e.g. Andrej Karpathy" style={bdInput} autoFocus />
        <label style={bdLabel}>Channel URL <span style={{ color:BD.red }}>*</span></label>
        <input value={channelUrl} onChange={e => setChannelUrl(e.target.value)} placeholder="https://youtube.com/@handle" style={{ ...bdInput, marginBottom:4 }} />
        <p style={{ margin:'0 0 14px', fontSize:12, color:BD.textMuted }}>Accepts @handle, channel URL, or UC ID.</p>
        <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', userSelect:'none', marginBottom:24 }}>
          <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} style={{ width:16, height:16, accentColor:BD.blue }} />
          <span style={{ fontSize:13, color:'#d1d5db' }}>Set as primary channel</span>
        </label>
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={bdBtnS}>Cancel</button>
          <button onClick={handleAdd} disabled={saving} style={{ ...bdBtnP, opacity:saving?0.5:1 }}>{saving?'Adding…':'Add channel'}</button>
        </div>
      </div>
    </div>
  );
}

function AdminDocsModal({ brain, adminKey, brainLocQ, onClose, onRefresh }) {
  const [generatingDocs, setGeneratingDocs] = useState(false);
  const history = brain.docsHistory || [];
  const sorted  = [...history].reverse();
  const [expanded, setExpanded] = useState(() => new Set(sorted.length ? [sorted[0].id] : []));

  function toggle(id) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function generateDocs() {
    setGeneratingDocs(true);
    try {
      const r = await adminFetch(`/brain/${brain.brainId}/generate-docs${brainLocQ}`, { method:'POST', adminKey });
      if (r.success) onRefresh();
    } catch {}
    setGeneratingDocs(false);
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:16, width:'100%', maxWidth:760, maxHeight:'90vh', display:'flex', flexDirection:'column' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'20px 24px', borderBottom:`1px solid ${BD.border}`, flexShrink:0 }}>
          <div>
            <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:BD.textPri }}>📄 Brain Documentation</h2>
            <p style={{ margin:'4px 0 0', fontSize:13, color:BD.textMuted }}>{history.length} version{history.length!==1?'s':''} · AI-generated · newest first</p>
          </div>
          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <button onClick={generateDocs} disabled={generatingDocs} style={{ ...bdBtnP, fontSize:13, opacity:generatingDocs?0.5:1 }}>
              {generatingDocs?'⟳ Generating…':history.length?'↺ Generate New Version':'✦ Generate Docs'}
            </button>
            <button onClick={onClose} style={{ background:'none', border:'none', color:BD.textMuted, fontSize:22, cursor:'pointer', lineHeight:1 }}>✕</button>
          </div>
        </div>
        <div style={{ overflowY:'auto', padding:24, flex:1 }}>
          {sorted.length === 0 ? (
            <p style={{ color:BD.textMuted, fontSize:14 }}>No documentation yet. Click "Generate Docs" to have AI write documentation for this brain.</p>
          ) : sorted.map((entry, i) => (
            <div key={entry.id} style={{ marginBottom:12, border:`1px solid ${BD.border}`, borderRadius:12, overflow:'hidden' }}>
              <button onClick={() => toggle(entry.id)} style={{ width:'100%', background:expanded.has(entry.id)?'#0d1623':BD.card, border:'none', padding:'14px 18px', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontSize:11, fontWeight:700, padding:'2px 9px', borderRadius:5, background:i===0?`${BD.blue}22`:'rgba(255,255,255,0.05)', border:`1px solid ${i===0?BD.blue+'40':BD.border}`, color:i===0?BD.blue:BD.textMuted }}>
                    {i===0?'Latest · ':''}v{entry.version}
                  </span>
                  <span style={{ fontSize:13, color:BD.textMuted }}>{new Date(entry.ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}{' at '}{new Date(entry.ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</span>
                </div>
                <span style={{ color:BD.textMuted, fontSize:13 }}>{expanded.has(entry.id)?'▲':'▼'}</span>
              </button>
              {expanded.has(entry.id) && (
                <div style={{ padding:'16px 18px', borderTop:`1px solid ${BD.border}`, background:BD.bg }}>
                  <pre style={{ margin:0, fontSize:13, color:BD.textSec, lineHeight:1.75, whiteSpace:'pre-wrap', fontFamily:'inherit' }}>{entry.content}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminChangeLogModal({ brain, onClose }) {
  const syncEntries = (brain.syncLog || []).map(e => ({ ...e, _kind:'sync' }));
  const noteEntries = (brain.notes   || []).map(e => ({ ...e, _kind:'note' }));
  const all = [...syncEntries, ...noteEntries].sort((a,b) => new Date(b.ts)-new Date(a.ts));
  const TYPE_COLOR = { auto:'#9ca3af', docs:'#60a5fa', sync:'#10b981', note:'#a78bfa', fix:'#4ade80', update:'#a78bfa', issue:'#fbbf24' };
  const groups = [];
  let curDate = null, curItems = [];
  for (const e of all) {
    const dk = new Date(e.ts).toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
    if (dk !== curDate) { if (curItems.length) groups.push({ date:curDate, entries:curItems }); curDate=dk; curItems=[e]; }
    else curItems.push(e);
  }
  if (curItems.length) groups.push({ date:curDate, entries:curItems });

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:16, width:'100%', maxWidth:680, maxHeight:'90vh', display:'flex', flexDirection:'column' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'20px 24px', borderBottom:`1px solid ${BD.border}`, flexShrink:0 }}>
          <div>
            <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:BD.textPri }}>📋 Change Log</h2>
            <p style={{ margin:'4px 0 0', fontSize:13, color:BD.textMuted }}>{all.length} entr{all.length!==1?'ies':'y'} · auto-logged · grouped by date</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:BD.textMuted, fontSize:22, cursor:'pointer', lineHeight:1 }}>✕</button>
        </div>
        <div style={{ overflowY:'auto', padding:24, flex:1 }}>
          {all.length === 0 ? (
            <p style={{ color:BD.textMuted, fontSize:14 }}>No changes recorded yet.</p>
          ) : groups.map(group => (
            <div key={group.date} style={{ marginBottom:24 }}>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:BD.textMuted, marginBottom:10, paddingBottom:8, borderBottom:`1px solid ${BD.border}44` }}>{group.date}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {group.entries.map((entry, i) => {
                  if (entry._kind === 'sync') {
                    return (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.02)', border:`1px solid ${BD.border}44` }}>
                        <span style={{ fontSize:11, fontWeight:700, color:BD.green, minWidth:72, textTransform:'uppercase', letterSpacing:'0.05em' }}>⟳ Sync</span>
                        <span style={{ fontSize:13, color:BD.textSec, flex:1 }}>+{entry.ingested||0} videos{entry.errors>0?` · ${entry.errors} errors`:''}{entry.channel?` · ${entry.channel}`:''}</span>
                        <span style={{ fontSize:11, color:BD.textMuted }}>{new Date(entry.ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</span>
                      </div>
                    );
                  }
                  const color = TYPE_COLOR[entry.type] || '#9ca3af';
                  return (
                    <div key={entry.id||i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 14px', borderRadius:8, background:'rgba(255,255,255,0.02)', border:`1px solid ${BD.border}44` }}>
                      <span style={{ fontSize:11, fontWeight:700, color, minWidth:72, textTransform:'uppercase', letterSpacing:'0.05em', paddingTop:1 }}>{entry.type||'note'}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, color:BD.textSec }}>{entry.title}</div>
                        {entry.text && <div style={{ fontSize:12, color:BD.textMuted, marginTop:3, lineHeight:1.5 }}>{entry.text}</div>}
                      </div>
                      <span style={{ fontSize:11, color:BD.textMuted, flexShrink:0, paddingTop:1 }}>{new Date(entry.ts).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── AdminBrainDetail ──────────────────────────────────────────────────────────

function AdminBrainDetail({ brain: initialBrain, adminKey, brainLocQ, onBack, onRefresh, onFlash, onDeleted, onBrainUpdated }) {
  const [brain,             setBrain]             = useState(initialBrain);
  const [tab,               setTab]               = useState('progress');
  const [channels,          setChannels]          = useState(initialBrain.channels || []);
  const [syncing,           setSyncing]           = useState(false);
  const [autoSync,          setAutoSync]          = useState(!!initialBrain.autoSync);
  const [syncingChannelId,  setSyncingChannelId]  = useState(null);
  const [editName,          setEditName]          = useState(initialBrain.name || '');
  const [editDesc,          setEditDesc]          = useState(initialBrain.description || '');
  const [generatingDocs,    setGeneratingDocs]    = useState(false);
  const [saving,            setSaving]            = useState(false);
  const [showAddChannel,    setShowAddChannel]    = useState(false);
  const [showDocsModal,     setShowDocsModal]     = useState(false);
  const [showChangeLogModal,setShowChangeLogModal]= useState(false);
  const [videos,            setVideos]            = useState([]);
  const [loadingVideos,     setLoadingVideos]     = useState(false);
  const [generatingIds,     setGeneratingIds]     = useState(new Set());
  const [batchProcessing,   setBatchProcessing]   = useState(false);
  const [batchProgress,     setBatchProgress]     = useState(null);
  const [batchCooldown,     setBatchCooldown]     = useState(0);
  const batchActiveRef = useRef(false);
  const [videoPage,         setVideoPage]         = useState(1);
  const [videoPageSize,     setVideoPageSize]     = useState(10);
  const [ytUrl,             setYtUrl]             = useState('');
  const [ingesting,         setIngesting]         = useState(false);
  const [noteTitle,         setNoteTitle]         = useState('');
  const [noteText,          setNoteText]          = useState('');
  const [noteType,          setNoteType]          = useState('note');
  const [noteAdding,        setNoteAdding]        = useState(false);
  const [showNoteForm,      setShowNoteForm]      = useState(false);

  useEffect(() => {
    setBrain(initialBrain);
    setChannels(initialBrain.channels || []);
    setEditName(initialBrain.name || '');
    setEditDesc(initialBrain.description || '');
    setAutoSync(!!initialBrain.autoSync);
  }, [initialBrain.brainId]); // eslint-disable-line

  async function reloadBrain() {
    try {
      const r = await adminFetch(`/brain/${brain.brainId}${brainLocQ}`, { adminKey });
      if (r.success) {
        const updated = r.data;
        setBrain(prev => ({ ...prev, ...updated }));
        setChannels(updated.channels || []);
        onBrainUpdated?.(updated);
      }
    } catch {}
  }

  async function reloadVideos() {
    setLoadingVideos(true);
    try {
      const r = await adminFetch(`/brain/${brain.brainId}/videos${brainLocQ}`, { adminKey });
      if (r.success) setVideos(r.data || []);
    } catch {}
    setLoadingVideos(false);
  }

  useEffect(() => {
    if (tab === 'videos' || tab === 'channels' || tab === 'progress') reloadVideos();
    if (tab === 'settings') reloadBrain();
  }, [tab, brain.brainId]); // eslint-disable-line

  useEffect(() => {
    if (!batchProcessing) return;
    const timer = setInterval(reloadVideos, 8000);
    return () => clearInterval(timer);
  }, [batchProcessing, brain.brainId]); // eslint-disable-line

  useEffect(() => () => { batchActiveRef.current = false; }, []);

  async function startBatchLoop() {
    if (batchActiveRef.current) return;
    batchActiveRef.current = true;
    setBatchProcessing(true);
    let totalDone = 0, totalErrors = 0;
    setBatchProgress({ done:0, remaining:0, total:0, errors:0 });
    adminFetch(`/brain/${brain.brainId}${brainLocQ}`, { method:'PATCH', adminKey, body:{ pipelineStage:'processing' } });
    const COOLDOWN_MS = 120_000;
    while (batchActiveRef.current) {
      try {
        const r = await adminFetch(`/brain/${brain.brainId}/sync-batch${brainLocQ}`, { method:'POST', adminKey, body:{ batchSize:2 } });
        if (!r.success) { toast.error(r.error || 'Batch processing failed.'); break; }
        totalDone += r.ingested || 0;
        totalErrors += r.errors || 0;
        setBatchProgress({ done:totalDone, remaining:r.remaining||0, total:totalDone+totalErrors+(r.remaining||0), errors:totalErrors });
        await reloadVideos();
        if (r.done) {
          adminFetch(`/brain/${brain.brainId}${brainLocQ}`, { method:'PATCH', adminKey, body:{ pipelineStage:'ready' } });
          toast.success(`Processing complete — ${totalDone} video${totalDone!==1?'s':''} indexed${totalErrors>0?`, ${totalErrors} errors`:''}. `);
          break;
        }
        if (batchActiveRef.current) {
          const endTime = Date.now() + COOLDOWN_MS;
          while (Date.now() < endTime && batchActiveRef.current) {
            setBatchCooldown(Math.ceil((endTime-Date.now())/1000));
            await new Promise(res => setTimeout(res, 1000));
          }
          setBatchCooldown(0);
        }
      } catch(e) { toast.error(`Processing error: ${e.message}`); break; }
    }
    batchActiveRef.current = false;
    setBatchProcessing(false);
    setBatchProgress(null);
    setBatchCooldown(0);
    onRefresh?.();
    await reloadBrain();
    await reloadVideos();
  }

  function stopBatchLoop() { batchActiveRef.current = false; }

  async function generateTranscript(videoId) {
    setGeneratingIds(prev => new Set([...prev, videoId]));
    setVideos(prev => prev.map(v => v.videoId === videoId ? { ...v, transcriptStatus:'processing' } : v));
    try {
      const r = await adminFetch(`/brain/${brain.brainId}/videos/${videoId}/transcript${brainLocQ}`, { method:'POST', adminKey });
      if (r.success) {
        toast.success(`Transcript generated — ${r.chunks} chunks stored.`);
        await reloadVideos();
        onRefresh?.();
      } else {
        toast.error(r.error || 'Failed to generate transcript.');
        setVideos(prev => prev.map(v => v.videoId === videoId ? { ...v, transcriptStatus:'error', transcriptError:r.error } : v));
      }
    } catch(e) {
      toast.error(e.message || 'Failed.');
      setVideos(prev => prev.map(v => v.videoId === videoId ? { ...v, transcriptStatus:'error' } : v));
    }
    setGeneratingIds(prev => { const s = new Set(prev); s.delete(videoId); return s; });
  }

  async function ingestYoutube() {
    if (!ytUrl.trim()) return;
    setIngesting(true);
    try {
      const r = await adminFetch(`/brain/${brain.brainId}/youtube${brainLocQ}`, { method:'POST', adminKey, body:{ url:ytUrl.trim() } });
      if (r.success) {
        toast.success(`"${r.title}" ingested — ${r.chunks} chunks stored.`);
        setYtUrl('');
        await reloadBrain();
        onRefresh?.();
      } else {
        toast.error(r.error || 'Failed to ingest video.');
      }
    } catch { toast.error('Request failed.'); }
    setIngesting(false);
  }

  async function generateDocs() {
    setGeneratingDocs(true);
    try {
      const r = await adminFetch(`/brain/${brain.brainId}/generate-docs${brainLocQ}`, { method:'POST', adminKey });
      if (r.success) {
        toast.success(`Documentation v${r.version||''} generated.`);
        await reloadBrain();
        onRefresh?.();
      } else toast.error(r.error || 'Failed to generate docs.');
    } catch { toast.error('Request failed.'); }
    setGeneratingDocs(false);
  }

  function deleteChannel(channelId, name) {
    confirmToast(`Remove channel "${name}" from this brain?`, async () => {
      try {
        const r = await adminFetch(`/brain/${brain.brainId}/channels/${channelId}${brainLocQ}`, { method:'DELETE', adminKey });
        if (r.success) { setChannels(prev => prev.filter(c => c.channelId !== channelId)); onRefresh?.(); }
        else toast.error(r.error || 'Failed to remove channel.');
      } catch { toast.error('Failed to remove channel.'); }
    });
  }

  async function syncChannel(channelId, name) {
    setSyncingChannelId(channelId);
    toast.success(`Discovering videos for "${name}"…`);
    try {
      let result;
      do {
        result = await adminFetch(`/brain/${brain.brainId}/channels/${channelId}/queue${brainLocQ}`, { method:'POST', adminKey });
        if (!result.success) { toast.error(result.error||'Failed to sync channel.'); setSyncingChannelId(null); return; }
        if (result.discovering) {
          toast.info(`Discovering videos for "${name}"… ${result.videoCount||0} found so far`);
          await reloadVideos();
        }
      } while (result.discovering);
      const discovered = result.videoCount || result.queued || 0;
      toast.success(`"${name}" — ${discovered} videos discovered. Starting transcript processing…`);
      onRefresh?.();
      await reloadBrain();
      await reloadVideos();
      setTab('videos');
      startBatchLoop();
    } catch(e) { toast.error(e.message || 'Sync failed.'); }
    setSyncingChannelId(null);
  }

  async function syncAllChannels() {
    setSyncing(true);
    toast.info('Discovering videos for all channels…');
    try {
      let totalDiscovered = 0;
      for (const ch of channels.filter(c => c.channelUrl)) {
        let result;
        do {
          result = await adminFetch(`/brain/${brain.brainId}/channels/${ch.channelId}/queue${brainLocQ}`, { method:'POST', adminKey });
          if (!result.success) break;
          if (result.discovering) {
            toast.info(`Discovering "${ch.channelName}"… ${result.videoCount||0} videos found`);
            await reloadVideos();
          }
        } while (result.discovering);
        if (result.success) totalDiscovered += result.videoCount || result.queued || 0;
      }
      toast.success(`${totalDiscovered} videos discovered. Starting transcript processing…`);
      onRefresh?.();
      await reloadBrain();
      await reloadVideos();
      setTab('videos');
      startBatchLoop();
    } catch { toast.error('Sync failed.'); }
    setSyncing(false);
  }

  async function addNote() {
    if (!noteTitle.trim()) return;
    setNoteAdding(true);
    try {
      const r = await adminFetch(`/brain/${brain.brainId}/changelog${brainLocQ}`, {
        method:'POST', adminKey, body:{ title:noteTitle, text:noteText, noteType },
      });
      if (r.success) {
        toast.success('Note added.');
        setNoteTitle(''); setNoteText(''); setNoteType('note'); setShowNoteForm(false);
        await reloadBrain();
        onRefresh?.();
      } else toast.error(r.error || 'Failed to add note.');
    } catch { toast.error('Request failed.'); }
    setNoteAdding(false);
  }

  function deleteNote(entryId) {
    confirmToast('Delete this note?', async () => {
      try {
        const r = await adminFetch(`/brain/${brain.brainId}/changelog/${entryId}${brainLocQ}`, { method:'DELETE', adminKey });
        if (r.success) { toast.success('Note deleted.'); await reloadBrain(); onRefresh?.(); }
        else toast.error(r.error || 'Delete failed.');
      } catch { toast.error('Request failed.'); }
    });
  }

  const complete = videos.filter(v => v.transcriptStatus === 'complete').length;
  const pending  = videos.filter(v => v.transcriptStatus === 'pending' || v.transcriptStatus === 'queued').length;
  const errored  = videos.filter(v => v.transcriptStatus === 'error').length;
  const total    = videos.length || brain.videoCount || 0;
  const pct      = total > 0 ? Math.round(complete/total*100) : 0;

  const DETAIL_TABS = [
    { id:'progress',  label:'Progress' },
    { id:'channels',  label:`Channels (${channels.length})` },
    { id:'videos',    label:`Videos (${total})` },
    { id:'settings',  label:'Settings' },
    { id:'changelog', label:'Changelog' },
  ];

  const NOTE_TYPES = [
    { value:'note',   label:'📝 Note',   color:'#60a5fa' },
    { value:'fix',    label:'🔧 Fix',    color:'#4ade80' },
    { value:'update', label:'⬆ Update', color:'#a78bfa' },
    { value:'issue',  label:'⚠ Issue',  color:'#fbbf24' },
  ];

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
      {showAddChannel && (
        <AdminAddChannelModal
          brainId={brain.brainId} adminKey={adminKey} brainLocQ={brainLocQ}
          onClose={() => setShowAddChannel(false)}
          onAdded={ch => { setChannels(prev => [...prev, ch]); setShowAddChannel(false); toast.success(`Channel "${ch.channelName}" added.`); onRefresh?.(); }}
        />
      )}
      {showDocsModal && (
        <AdminDocsModal brain={brain} adminKey={adminKey} brainLocQ={brainLocQ} onClose={() => setShowDocsModal(false)} onRefresh={reloadBrain} />
      )}
      {showChangeLogModal && (
        <AdminChangeLogModal brain={brain} onClose={() => setShowChangeLogModal(false)} />
      )}

      {/* Back link */}
      <button onClick={onBack} style={{ background:'none', border:'none', color:BD.textSec, fontSize:13, cursor:'pointer', textAlign:'left', padding:0, marginBottom:20, display:'flex', alignItems:'center', gap:6 }}>
        ← All brains
      </button>

      {/* Brain header */}
      <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:'20px 24px', marginBottom:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:12 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <h2 style={{ margin:0, fontSize:20, fontWeight:700, color:BD.textPri }}>{brain.name}</h2>
              {brain.slug && <code style={{ fontSize:12, color:BD.textMuted, background:BD.codeBg, padding:'2px 8px', borderRadius:4, border:`1px solid ${BD.border}` }}>{brain.slug}</code>}
              {brain.isShared && <span style={{ fontSize:12, padding:'4px 10px', borderRadius:8, background:'rgba(99,102,241,0.15)', color:'#a5b4fc', border:'1px solid rgba(99,102,241,0.3)', fontWeight:600 }}>Shared</span>}
            </div>
            {brain.description && <p style={{ margin:'8px 0 0', color:BD.textMuted, fontSize:13 }}>{brain.description}</p>}
            {/* Docs + Changelog quick-access badges */}
            {(() => {
              const docsHistory = brain.docsHistory || [];
              const changeCount = (brain.syncLog||[]).length + (brain.notes||[]).length;
              if (!docsHistory.length && !changeCount) return null;
              return (
                <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
                  {docsHistory.length > 0 && (
                    <button onClick={() => setShowDocsModal(true)} style={{ fontSize:12, fontWeight:600, color:BD.blue, padding:'3px 10px', borderRadius:6, background:`${BD.blue}18`, border:`1px solid ${BD.blue}33`, cursor:'pointer' }}>
                      📄 Docs · v{docsHistory[docsHistory.length-1]?.version}
                    </button>
                  )}
                  {changeCount > 0 && (
                    <button onClick={() => setShowChangeLogModal(true)} style={{ fontSize:12, fontWeight:600, color:BD.textSec, padding:'3px 10px', borderRadius:6, background:'rgba(255,255,255,0.05)', border:`1px solid ${BD.border}`, cursor:'pointer' }}>
                      📋 {changeCount} change{changeCount!==1?'s':''}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
          {/* Action buttons */}
          <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
            <label title={autoSync?'Auto-sync ON':'Auto-sync OFF'}
              onClick={async e => {
                e.preventDefault();
                const next = !autoSync;
                setAutoSync(next);
                try {
                  await adminFetch(`/brain/${brain.brainId}${brainLocQ}`, { method:'PATCH', adminKey, body:{ autoSync:next } });
                  toast.success(next?'Auto-sync enabled.':'Auto-sync disabled.');
                } catch { setAutoSync(!next); }
              }}
              style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer', userSelect:'none' }}>
              <span style={{ fontSize:12, color:BD.textMuted }}>Auto</span>
              <div style={{ width:36, height:20, borderRadius:10, background:autoSync?BD.blue:BD.border, position:'relative', transition:'background .2s', flexShrink:0 }}>
                <div style={{ position:'absolute', top:3, left:autoSync?18:3, width:14, height:14, borderRadius:'50%', background:'#fff', transition:'left .2s' }} />
              </div>
            </label>
            <button title={batchProcessing?'Processing transcripts…':'Sync now'} disabled={syncing||batchProcessing} onClick={syncAllChannels}
              style={{ ...bdBtnS, padding:'7px 10px', fontSize:16, lineHeight:1, display:'inline-flex', alignItems:'center', justifyContent:'center', opacity:(syncing||batchProcessing)?0.5:1 }}>
              <span style={{ display:'inline-block', animation:(syncing||batchProcessing)?'spin 1s linear infinite':'none' }}>↻</span>
            </button>
            <button title="Re-index existing chunks into vector database"
              onClick={async () => {
                toast.info('Re-indexing into vector database…');
                try {
                  const r = await adminFetch(`/brain/${brain.brainId}/reindex${brainLocQ}`, { method:'POST', adminKey });
                  if (r.success) toast.success(`Vector index updated: ${r.vectors} chunks from ${r.docs} docs`);
                  else toast.error(r.error||'Re-index failed.');
                } catch(e) { toast.error(e.message); }
              }}
              style={{ ...bdBtnS, fontSize:12 }}>⚡ Reindex</button>
            <button onClick={() => setShowAddChannel(true)} style={bdBtnP}>+ Add Channel</button>
          </div>
        </div>
        {pending > 0 && (
          <div style={{ display:'flex', alignItems:'center', gap:8, background:'#2d1f00', border:`1px solid ${BD.amber}44`, borderRadius:8, padding:'9px 14px', marginTop:8 }}>
            <span style={{ color:BD.amber, fontSize:14 }}>⚠</span>
            <span style={{ color:BD.amber, fontSize:13, fontWeight:500 }}>Needs Attention</span>
            <span style={{ color:'#d97706', fontSize:13 }}>· {pending} videos pending transcription</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:`1px solid ${BD.border}`, marginBottom:20 }}>
        {DETAIL_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background:'none', border:'none', borderBottom:tab===t.id?`2px solid ${BD.blue}`:'2px solid transparent',
            color:tab===t.id?BD.textPri:BD.textMuted, padding:'10px 18px', fontSize:14, fontWeight:tab===t.id?600:400,
            cursor:'pointer', marginBottom:-1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Progress tab ── */}
      {tab === 'progress' && (() => {
        const STAGES = [
          { label:'Sync',       icon:'⟳', done:(brain.channels||[]).length>0&&(brain.lastSynced||complete>0||total>0), desc:`${(brain.channels||[]).length} channel${(brain.channels||[]).length!==1?'s':''} connected` },
          { label:'Transcribe', icon:'▶', done:complete>0, desc:`${complete} / ${total} videos` },
          { label:'Embed',      icon:'⚡', done:(brain.chunkCount||0)>0, desc:`${(brain.chunkCount||0).toLocaleString()} chunks` },
          { label:'Ready',      icon:'✓', done:brain.pipelineStage==='ready', desc:brain.pipelineStage==='ready'?'Searchable':(brain.pipelineStage||'Not ready') },
        ];
        return (
          <div>
            <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:24, marginBottom:20 }}>
              <h3 style={{ margin:'0 0 20px', fontSize:15, fontWeight:700, color:BD.textPri }}>Pipeline Stages</h3>
              <div style={{ display:'flex', alignItems:'center' }}>
                {STAGES.map((s,i) => (
                  <div key={s.label} style={{ display:'flex', alignItems:'center', flex:1 }}>
                    <div style={{ flex:1, textAlign:'center' }}>
                      <div style={{ width:48, height:48, borderRadius:'50%', margin:'0 auto 10px', display:'flex', alignItems:'center', justifyContent:'center', background:s.done?BD.green:BD.border, color:s.done?'#fff':BD.textMuted, fontSize:18, fontWeight:700, border:`3px solid ${s.done?BD.green:BD.border}` }}>
                        {s.done?'✓':s.icon}
                      </div>
                      <div style={{ fontSize:13, fontWeight:700, color:s.done?BD.textPri:BD.textMuted }}>{s.label}</div>
                      <div style={{ fontSize:11, color:BD.textMuted, marginTop:3 }}>{s.desc}</div>
                    </div>
                    {i<STAGES.length-1 && <div style={{ width:40, height:2, background:STAGES[i+1].done?BD.green:BD.border, flexShrink:0, marginBottom:28 }} />}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:24, marginBottom:20 }}>
              <h3 style={{ margin:'0 0 16px', fontSize:15, fontWeight:700, color:BD.textPri }}>Transcript Progress</h3>
              <div style={{ display:'flex', gap:28, marginBottom:16 }}>
                {[{label:'Indexed',val:complete,color:BD.green},{label:'Pending',val:pending,color:BD.textMuted},{label:'Errors',val:errored,color:errored>0?BD.red:BD.textMuted},{label:'Total',val:total,color:BD.textSec}].map(s => (
                  <div key={s.label}><div style={{ fontSize:26, fontWeight:700, color:s.color, lineHeight:1 }}>{s.val}</div><div style={{ fontSize:11, color:BD.textMuted, marginTop:4 }}>{s.label}</div></div>
                ))}
              </div>
              <div style={{ height:8, background:'#1e2a3a', borderRadius:4, overflow:'hidden', marginBottom:6 }}>
                <div style={{ height:'100%', borderRadius:4, background:`linear-gradient(90deg, ${BD.green}, #34d399)`, width:`${pct}%`, transition:'width 0.5s ease' }} />
              </div>
              <div style={{ fontSize:12, color:BD.textMuted }}>{pct}% indexed</div>
              {pending > 0 && (
                <button onClick={startBatchLoop} disabled={batchProcessing} style={{ ...bdBtnP, marginTop:16, fontSize:13, opacity:batchProcessing?0.5:1 }}>
                  {batchProcessing?'⟳ Processing…':`▶ Process ${pending} Pending`}
                </button>
              )}
              {batchProcessing && batchProgress && (
                <div style={{ marginTop:12, fontSize:12, color:BD.blue }}>
                  {batchProgress.done} indexed · {batchProgress.remaining} remaining
                  {batchCooldown>0&&` · next batch in ${Math.floor(batchCooldown/60)}:${String(batchCooldown%60).padStart(2,'0')}`}
                </div>
              )}
            </div>
            <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:24, marginBottom:20 }}>
              <h3 style={{ margin:'0 0 4px', fontSize:15, fontWeight:700, color:BD.textPri }}>Sync History</h3>
              <p style={{ margin:'0 0 16px', fontSize:13, color:BD.textMuted }}>History of all sync runs for this brain.</p>
              {(brain.syncLog||[]).length===0 ? (
                <p style={{ margin:0, fontSize:13, color:BD.textMuted }}>No sync runs yet.</p>
              ) : (
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead><tr>{['When','Channel','Ingested','Errors','Total Docs','Chunks'].map(h=><th key={h} style={bdTh}>{h}</th>)}</tr></thead>
                    <tbody>
                      {(brain.syncLog||[]).map((entry,i) => (
                        <tr key={i}>
                          <td style={{ ...bdTd, color:BD.textMuted, whiteSpace:'nowrap' }}>{bdTimeAgo(entry.ts)}</td>
                          <td style={bdTd}>{entry.channel||'All channels'}</td>
                          <td style={{ ...bdTd, color:BD.green, fontWeight:600 }}>+{entry.ingested}</td>
                          <td style={{ ...bdTd, color:entry.errors>0?BD.amber:BD.textMuted }}>{entry.errors}</td>
                          <td style={bdTd}>{entry.docCount??'—'}</td>
                          <td style={bdTd}>{entry.chunkCount??'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {videos.length > 0 && (
              <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:24 }}>
                <h3 style={{ margin:'0 0 4px', fontSize:15, fontWeight:700, color:BD.textPri }}>Recent Videos</h3>
                <p style={{ margin:'0 0 16px', fontSize:13, color:BD.textMuted }}>Last 10 discovered videos.</p>
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {[...videos].sort((a,b)=>new Date(b.addedAt||0)-new Date(a.addedAt||0)).slice(0,10).map(video => {
                    const st = video.transcriptStatus||'pending';
                    const stColor = {complete:BD.green,error:BD.red,processing:BD.amber,queued:BD.blue}[st]||BD.textMuted;
                    const stLabel = {complete:'Indexed',error:'Error',processing:'Processing',queued:'Queued',pending:'Pending'}[st]||st;
                    return (
                      <div key={video.videoId} style={{ display:'flex', alignItems:'center', gap:12 }}>
                        <a href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer" style={{ flexShrink:0 }}>
                          <img src={bdYtThumb(video.videoId)} alt="" style={{ width:64, height:36, objectFit:'cover', borderRadius:5, display:'block' }} />
                        </a>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, color:BD.textPri, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{video.title||video.videoId}</div>
                          <div style={{ fontSize:11, color:BD.textMuted, marginTop:2 }}>
                            {video.channelName||''}{video.publishDate?` · ${bdPublishedAgo(video.publishDate)}`:''}
                            {video.lengthSecs?` · ${bdFmtDuration(video.lengthSecs)}`:''}
                          </div>
                        </div>
                        <span style={{ fontSize:11, fontWeight:600, color:stColor, flexShrink:0 }}>{stLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Channels tab ── */}
      {tab === 'channels' && (
        <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, overflow:'hidden' }}>
          {channels.length === 0 ? (
            <div style={{ padding:'40px 20px', textAlign:'center' }}>
              <p style={{ color:BD.textMuted, fontSize:14, margin:0 }}>No channels yet. Add one to start syncing.</p>
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={bdTh}>Name</th><th style={bdTh}>Handle / ID</th><th style={bdTh}>Type</th>
                  <th style={bdTh}>Videos</th><th style={bdTh}>Last synced</th><th style={{ ...bdTh, width:80 }}></th>
                </tr>
              </thead>
              <tbody>
                {channels.map(ch => (
                  <tr key={ch.channelId||ch.channelName}>
                    <td style={bdTd}>{ch.channelName}</td>
                    <td style={{ ...bdTd, color:BD.textSec, fontFamily:'monospace', fontSize:12 }}>{ch.handle||ch.channelUrl||'—'}</td>
                    <td style={bdTd}>
                      {(ch.isPrimary||ch.type==='primary')
                        ? <span style={{ background:`${BD.blueDark}33`, color:'#93c5fd', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:4, textTransform:'uppercase', letterSpacing:'0.05em' }}>primary</span>
                        : <span style={{ color:BD.textMuted, fontSize:12 }}>secondary</span>}
                    </td>
                    <td style={{ ...bdTd, color:BD.textSec }}>{videos.length>0?videos.filter(v=>v.channelId===ch.channelId).length:(ch.videoCount||0)}</td>
                    <td style={{ ...bdTd, color:BD.textMuted, fontSize:12 }}>{ch.lastSynced?bdTimeAgo(ch.lastSynced):'Never'}</td>
                    <td style={{ ...bdTd, whiteSpace:'nowrap' }}>
                      <button title={batchProcessing?'Processing…':'Sync this channel'} disabled={syncingChannelId===ch.channelId||batchProcessing}
                        onClick={() => syncChannel(ch.channelId, ch.channelName)}
                        style={{ background:'none', border:'none', color:(syncingChannelId===ch.channelId||batchProcessing)?BD.blue:BD.textMuted, cursor:(syncingChannelId===ch.channelId||batchProcessing)?'default':'pointer', fontSize:14, padding:'2px 6px' }}>
                        <span style={{ display:'inline-block', animation:syncingChannelId===ch.channelId?'spin 1s linear infinite':'none' }}>↻</span>
                      </button>
                      <button onClick={() => deleteChannel(ch.channelId, ch.channelName)} style={{ background:'none', border:'none', color:BD.red, cursor:'pointer', fontSize:14, padding:'2px 6px' }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Videos tab ── */}
      {tab === 'videos' && (
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
            <div>
              <span style={{ fontSize:15, fontWeight:700, color:BD.textPri }}>{videos.length} video{videos.length!==1?'s':''}</span>
              {videos.length>0 && (
                <span style={{ fontSize:12, color:BD.textMuted, marginLeft:10 }}>
                  {complete} indexed · {pending} pending
                  {errored>0 && <span style={{ color:BD.red }}> · {errored} errors</span>}
                </span>
              )}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              {batchProcessing
                ? <button onClick={stopBatchLoop} style={{ ...bdBtnS, fontSize:12, padding:'6px 14px', color:BD.amber, borderColor:`${BD.amber}66` }}>■ Stop Processing</button>
                : videos.some(v=>v.transcriptStatus==='pending')
                  ? <button onClick={startBatchLoop} style={{ ...bdBtnP, fontSize:12, padding:'6px 14px' }}>▶ Process All Pending</button>
                  : null}
              <button onClick={reloadVideos} style={{ ...bdBtnS, fontSize:12, padding:'6px 14px' }}>↻ Refresh</button>
            </div>
          </div>
          {batchProcessing && batchProgress && (
            <div style={{ marginBottom:16, background:'#0d1a2e', border:`1px solid ${BD.blue}44`, borderRadius:10, padding:'12px 16px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <span style={{ fontSize:13, fontWeight:600, color:'#93c5fd' }}>
                  {batchCooldown>0?`Next batch in ${Math.floor(batchCooldown/60)}:${String(batchCooldown%60).padStart(2,'0')}`:'Processing transcripts…'}
                  {' '}{batchProgress.done} indexed{batchProgress.errors>0?`, ${batchProgress.errors} errors`:''} — {batchProgress.remaining} remaining
                </span>
                <span style={{ fontSize:12, color:BD.textMuted }}>{batchProgress.total>0?Math.round(((batchProgress.done+batchProgress.errors)/batchProgress.total)*100):0}%</span>
              </div>
              <div style={{ height:6, background:'#1e2a3a', borderRadius:3, overflow:'hidden' }}>
                <div style={{ height:'100%', borderRadius:3, background:`linear-gradient(90deg, ${BD.blue}, #60a5fa)`, width:batchProgress.total>0?`${((batchProgress.done+batchProgress.errors)/batchProgress.total)*100}%`:'0%', transition:'width 0.5s ease' }} />
              </div>
            </div>
          )}
          {!loadingVideos && videos.length===0 && (
            <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:'48px 24px', textAlign:'center' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>▶</div>
              <p style={{ color:BD.textPri, fontSize:15, fontWeight:600, margin:'0 0 8px' }}>No videos discovered yet</p>
              <p style={{ color:BD.textMuted, fontSize:13, margin:'0 0 20px' }}>Go to the Channels tab and click ↻ next to a channel to sync its video list.</p>
              <button onClick={() => setTab('channels')} style={{ ...bdBtnP, fontSize:13 }}>Go to Channels</button>
            </div>
          )}
          {loadingVideos && <div style={{ padding:'40px 24px', textAlign:'center', color:BD.textMuted, fontSize:13 }}>Loading videos…</div>}
          {!loadingVideos && videos.length>0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                <div style={{ fontSize:12, color:BD.textMuted }}>Showing {Math.min((videoPage-1)*videoPageSize+1,videos.length)}–{Math.min(videoPage*videoPageSize,videos.length)} of {videos.length}</div>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ fontSize:11, color:BD.textMuted }}>Per page:</span>
                  {[5,10,25,50].map(n => (
                    <button key={n} onClick={() => { setVideoPageSize(n); setVideoPage(1); }} style={{ background:videoPageSize===n?BD.blue:'transparent', color:videoPageSize===n?'#fff':BD.textMuted, border:`1px solid ${videoPageSize===n?BD.blue:BD.border}`, borderRadius:5, padding:'2px 8px', fontSize:11, cursor:'pointer', fontWeight:videoPageSize===n?700:400 }}>{n}</button>
                  ))}
                </div>
              </div>
              {videos.slice((videoPage-1)*videoPageSize, videoPage*videoPageSize).map(video => {
                const isGenerating = generatingIds.has(video.videoId);
                const status = isGenerating?'processing':(video.transcriptStatus||'pending');
                const statusConfig = {
                  complete:   {label:'Indexed',     bg:'#052e16',  color:'#4ade80',   border:'#16a34a44'},
                  processing: {label:'Processing…', bg:'#1c1400',  color:'#fbbf24',   border:'#d9770044'},
                  error:      {label:'Error',        bg:'#1c0a00',  color:'#f87171',   border:'#dc262644'},
                  pending:    {label:'Pending',      bg:BD.bg,      color:BD.textMuted, border:BD.border},
                }[status]||{label:status,bg:BD.bg,color:BD.textMuted,border:BD.border};
                return (
                  <div key={video.videoId} style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:10, padding:'12px 14px', display:'flex', alignItems:'center', gap:12 }}>
                    <a href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer" style={{ flexShrink:0 }}>
                      <div style={{ position:'relative', width:80, height:45 }}>
                        <img src={bdYtThumb(video.videoId)} alt="" style={{ width:80, height:45, objectFit:'cover', borderRadius:6, display:'block' }} />
                        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.35)', borderRadius:6 }}>
                          <span style={{ fontSize:14, color:'#fff' }}>▶</span>
                        </div>
                      </div>
                    </a>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:BD.textPri, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{video.title||video.videoId}</div>
                      <div style={{ fontSize:11, color:BD.textMuted, marginTop:3, display:'flex', alignItems:'center', gap:8 }}>
                        {video.channelName&&<span>{video.channelName}</span>}
                        {video.publishDate&&<><span>·</span><span>{bdPublishedAgo(video.publishDate)}</span></>}
                        {video.lengthSecs&&<><span>·</span><span style={{ fontFamily:'monospace' }}>{bdFmtDuration(video.lengthSecs)}</span></>}
                        {video.viewCount>0&&<><span>·</span><span>{bdFmtViews(video.viewCount)} views</span></>}
                      </div>
                    </div>
                    <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:10, background:statusConfig.bg, color:statusConfig.color, border:`1px solid ${statusConfig.border}`, whiteSpace:'nowrap', flexShrink:0, ...(status==='processing'?{animation:'pulse 1.5s ease-in-out infinite'}:{}) }}>
                      {statusConfig.label}
                    </span>
                    {(status==='pending'||status==='error') && (
                      <button onClick={() => generateTranscript(video.videoId)} disabled={isGenerating}
                        title={status==='error'?`Retry (${video.transcriptError||'unknown error'})`:'Generate transcript and index this video'}
                        style={{ background:status==='error'?'#1c0a00':'#0d1e3a', border:`1px solid ${status==='error'?'#dc262666':BD.blue+'66'}`, borderRadius:7, color:status==='error'?'#f87171':'#60a5fa', fontSize:12, fontWeight:600, padding:'5px 12px', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, display:'flex', alignItems:'center', gap:5 }}>
                        <span>{status==='error'?'↺':'▶'}</span>
                        <span>{status==='error'?'Retry':'Generate Transcript'}</span>
                      </button>
                    )}
                    {status==='complete' && video.docId && (
                      <>
                        <button
                          onClick={async () => {
                            const res = await fetch(`/brain/${brain.brainId}/videos/${video.videoId}/transcript${brainLocQ}`, { headers:{'x-admin-key':adminKey} });
                            if (!res.ok) return alert('Transcript not available.');
                            const blob = await res.blob();
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = `${(video.title||video.videoId).replace(/[^a-z0-9]+/gi,'-')}.txt`;
                            a.click(); URL.revokeObjectURL(a.href);
                          }}
                          title="Download transcript as .txt"
                          style={{ background:'none', border:'none', color:BD.textMuted, cursor:'pointer', fontSize:15, padding:'4px 6px', flexShrink:0 }}>⬇</button>
                        <button
                          onClick={() => {
                            confirmToast(`Remove transcript for "${video.title||video.videoId}" from this brain?`, async () => {
                              await adminFetch(`/brain/${brain.brainId}/docs/${video.docId}${brainLocQ}`, { method:'DELETE', adminKey });
                              await reloadVideos(); await reloadBrain(); onRefresh?.();
                            });
                          }}
                          title="Remove transcript from brain"
                          style={{ background:'none', border:'none', color:BD.textMuted, cursor:'pointer', fontSize:14, padding:'4px 6px', flexShrink:0 }}>✕</button>
                      </>
                    )}
                  </div>
                );
              })}
              {videos.length>videoPageSize && (
                <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap:6, marginTop:8, paddingTop:12, borderTop:`1px solid ${BD.border}` }}>
                  <button onClick={() => setVideoPage(1)} disabled={videoPage===1} style={{ background:'none', border:`1px solid ${BD.border}`, borderRadius:5, color:videoPage===1?BD.border:BD.textSec, padding:'4px 8px', fontSize:12, cursor:videoPage===1?'default':'pointer' }}>«</button>
                  <button onClick={() => setVideoPage(p=>Math.max(1,p-1))} disabled={videoPage===1} style={{ background:'none', border:`1px solid ${BD.border}`, borderRadius:5, color:videoPage===1?BD.border:BD.textSec, padding:'4px 10px', fontSize:12, cursor:videoPage===1?'default':'pointer' }}>‹</button>
                  <span style={{ fontSize:12, color:BD.textPri, fontWeight:600, padding:'0 8px' }}>Page {videoPage} of {Math.ceil(videos.length/videoPageSize)}</span>
                  <button onClick={() => setVideoPage(p=>Math.min(Math.ceil(videos.length/videoPageSize),p+1))} disabled={videoPage>=Math.ceil(videos.length/videoPageSize)} style={{ background:'none', border:`1px solid ${BD.border}`, borderRadius:5, color:videoPage>=Math.ceil(videos.length/videoPageSize)?BD.border:BD.textSec, padding:'4px 10px', fontSize:12, cursor:videoPage>=Math.ceil(videos.length/videoPageSize)?'default':'pointer' }}>›</button>
                  <button onClick={() => setVideoPage(Math.ceil(videos.length/videoPageSize))} disabled={videoPage>=Math.ceil(videos.length/videoPageSize)} style={{ background:'none', border:`1px solid ${BD.border}`, borderRadius:5, color:videoPage>=Math.ceil(videos.length/videoPageSize)?BD.border:BD.textSec, padding:'4px 8px', fontSize:12, cursor:videoPage>=Math.ceil(videos.length/videoPageSize)?'default':'pointer' }}>»</button>
                </div>
              )}
            </div>
          )}
          <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:20, marginTop:24 }}>
            <h3 style={{ margin:'0 0 4px', fontSize:14, fontWeight:700, color:BD.textPri }}>Add Individual Video</h3>
            <p style={{ margin:'0 0 14px', fontSize:12, color:BD.textMuted }}>Paste a YouTube URL to immediately generate transcript and index it.</p>
            <div style={{ display:'flex', gap:8 }}>
              <input value={ytUrl} onChange={e => setYtUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." style={{ ...bdInput, flex:1, marginBottom:0 }} />
              <button onClick={ingestYoutube} disabled={ingesting||!ytUrl.trim()} style={{ ...bdBtnP, whiteSpace:'nowrap', opacity:(ingesting||!ytUrl.trim())?0.5:1, cursor:(ingesting||!ytUrl.trim())?'not-allowed':'pointer' }}>
                {ingesting?'Processing…':'+ Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Settings tab ── */}
      {tab === 'settings' && (
        <div>
          <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:24, marginBottom:20 }}>
            <h3 style={{ margin:'0 0 4px', fontSize:15, fontWeight:700, color:BD.textPri }}>Brain Settings</h3>
            <p style={{ margin:'0 0 20px', fontSize:13, color:BD.textMuted }}>Edit name, description, and sync settings.</p>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:4 }}>
              <div>
                <label style={bdLabel}>Name <span style={{ color:BD.red }}>*</span></label>
                <input value={editName} onChange={e => setEditName(e.target.value)} style={{ ...bdInput, marginBottom:0 }} />
              </div>
              <div>
                <label style={bdLabel}>Slug</label>
                <input value={brain.slug||''} readOnly style={{ ...bdInput, marginBottom:0, opacity:0.5, cursor:'not-allowed' }} />
                <p style={{ margin:'4px 0 0', fontSize:11, color:BD.textMuted }}>Cannot be changed</p>
              </div>
            </div>
            <div style={{ marginTop:14 }}>
              <label style={bdLabel}>Description</label>
              <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3} style={{ ...bdInput, resize:'vertical', lineHeight:1.6 }} />
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:20 }}>
              <button onClick={async () => {
                setSaving(true);
                try {
                  const r = await adminFetch(`/brain/${brain.brainId}${brainLocQ}`, { method:'PATCH', adminKey, body:{ name:editName, description:editDesc } });
                  if (r.success) {
                    toast.success('Brain settings saved.');
                    setBrain(prev => ({ ...prev, name:editName, description:editDesc }));
                    onBrainUpdated?.({ brainId:brain.brainId, name:editName, description:editDesc });
                    onRefresh?.();
                  } else toast.error(r.error||'Save failed.');
                } catch { toast.error('Request failed.'); }
                setSaving(false);
              }} style={{ ...bdBtnP, opacity:saving?0.5:1 }}>
                💾 {saving?'Saving…':'Save changes'}
              </button>
            </div>
          </div>
          <div style={{ background:'#1a0808', border:`1px solid ${BD.red}33`, borderRadius:12, padding:24, marginBottom:20 }}>
            <h3 style={{ margin:'0 0 6px', fontSize:15, fontWeight:700, color:BD.red, display:'flex', alignItems:'center', gap:8 }}>⚠ Danger Zone</h3>
            <p style={{ margin:'0 0 16px', fontSize:13, color:BD.textMuted }}>Permanently delete this brain and all its channels, videos, chunks, and documentation. This cannot be undone.</p>
            <button onClick={() => {
                toast(
                  ({ closeToast }) => (
                    <div>
                      <p style={{ margin:'0 0 10px', fontWeight:600 }}>Delete &ldquo;{brain.name}&rdquo;?</p>
                      <p style={{ margin:'0 0 12px', fontSize:13, color:'#9ca3af' }}>This cannot be undone.</p>
                      <div style={{ display:'flex', gap:8 }}>
                        <button onClick={() => { closeToast(); onDeleted(brain.brainId); }}
                          style={{ background:'#dc2626', border:'none', borderRadius:6, color:'#fff', padding:'6px 14px', cursor:'pointer', fontSize:13, fontWeight:600 }}>
                          Delete
                        </button>
                        <button onClick={closeToast}
                          style={{ background:'#333', border:'none', borderRadius:6, color:'#e5e7eb', padding:'6px 14px', cursor:'pointer', fontSize:13 }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ),
                  { autoClose: false, closeOnClick: false, draggable: false }
                );
              }}
              style={{ background:'none', border:`1px solid ${BD.red}`, borderRadius:8, color:BD.red, padding:'8px 16px', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              🗑 Delete Brain
            </button>
          </div>
          {(() => {
            const docsHistory = brain.docsHistory||[];
            const latestDoc   = docsHistory[docsHistory.length-1];
            return (
              <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:24, marginBottom:20 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16 }}>
                  <div>
                    <h3 style={{ margin:'0 0 4px', fontSize:15, fontWeight:700, color:BD.textPri }}>📄 Brain Documentation</h3>
                    <p style={{ margin:0, fontSize:13, color:BD.textMuted }}>
                      {docsHistory.length>0?`${docsHistory.length} version${docsHistory.length!==1?'s':''} · last generated ${bdTimeAgo(latestDoc.ts)}`:'AI-generated documentation — not generated yet'}
                    </p>
                  </div>
                  <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                    {docsHistory.length>0 && <button onClick={() => setShowDocsModal(true)} style={{ ...bdBtnS, fontSize:13 }}>View Docs →</button>}
                    <button onClick={generateDocs} disabled={generatingDocs} style={{ ...bdBtnP, fontSize:13, opacity:generatingDocs?0.5:1 }}>
                      {generatingDocs?'⟳ Generating…':docsHistory.length?'↺ Regenerate':'✦ Generate Docs'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
          {(() => {
            const changeCount = (brain.syncLog||[]).length+(brain.notes||[]).length;
            const lastEntry = [...(brain.syncLog||[]),...(brain.notes||[])].sort((a,b)=>new Date(b.ts)-new Date(a.ts))[0];
            return (
              <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:24 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16 }}>
                  <div>
                    <h3 style={{ margin:'0 0 4px', fontSize:15, fontWeight:700, color:BD.textPri }}>📋 Change History</h3>
                    <p style={{ margin:0, fontSize:13, color:BD.textMuted }}>
                      {changeCount>0?`${changeCount} entr${changeCount!==1?'ies':'y'} · last change ${bdTimeAgo(lastEntry?.ts)}`:'Auto-logged — no changes recorded yet'}
                    </p>
                  </div>
                  {changeCount>0 && <button onClick={() => setShowChangeLogModal(true)} style={{ ...bdBtnS, fontSize:13, flexShrink:0 }}>View Change Log →</button>}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Changelog tab ── */}
      {tab === 'changelog' && (() => {
        const syncEntries = (brain.syncLog||[]).map(e => ({ ...e, _kind:'sync' }));
        const noteEntries = (brain.notes||[]).map(e => ({ ...e, _kind:'note' }));
        const allEntries  = [...syncEntries,...noteEntries].sort((a,b) => new Date(b.ts)-new Date(a.ts));
        return (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <div>
                <h3 style={{ margin:0, fontSize:16, fontWeight:700, color:BD.textPri }}>📋 {brain.name} — Changelog</h3>
                <p style={{ margin:'4px 0 0', fontSize:13, color:BD.textMuted }}>All sync runs and manual notes, newest first.</p>
              </div>
              <button onClick={() => setShowNoteForm(f => !f)} style={{ ...bdBtnP, display:'flex', alignItems:'center', gap:6, fontSize:13, flexShrink:0 }}>
                {showNoteForm?'✕ Cancel':'+ Add Note'}
              </button>
            </div>
            {showNoteForm && (
              <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:20, marginBottom:20 }}>
                <h4 style={{ margin:'0 0 14px', fontSize:14, fontWeight:700, color:BD.textPri }}>New Changelog Entry</h4>
                <div style={{ display:'flex', gap:8, marginBottom:14 }}>
                  {NOTE_TYPES.map(t => (
                    <button key={t.value} onClick={() => setNoteType(t.value)} style={{ padding:'5px 12px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:noteType===t.value?`${t.color}22`:'transparent', border:`1px solid ${noteType===t.value?t.color:BD.border}`, color:noteType===t.value?t.color:BD.textMuted, transition:'all .15s' }}>{t.label}</button>
                  ))}
                </div>
                <label style={{ display:'block', fontSize:12, fontWeight:600, color:BD.textMuted, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }}>Title <span style={{ color:BD.red }}>*</span></label>
                <input value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="e.g. Added new channel, Fixed transcript errors…" style={{ width:'100%', padding:'9px 12px', borderRadius:8, background:'#0a0f1a', border:`1px solid ${BD.border}`, color:BD.textPri, fontSize:13, marginBottom:12, boxSizing:'border-box' }} />
                <label style={{ display:'block', fontSize:12, fontWeight:600, color:BD.textMuted, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.05em' }}>Details (optional)</label>
                <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Describe what changed…" rows={4} style={{ width:'100%', padding:'9px 12px', borderRadius:8, background:'#0a0f1a', border:`1px solid ${BD.border}`, color:BD.textPri, fontSize:13, resize:'vertical', lineHeight:1.6, boxSizing:'border-box' }} />
                <div style={{ display:'flex', justifyContent:'flex-end', marginTop:14 }}>
                  <button onClick={addNote} disabled={!noteTitle.trim()||noteAdding} style={{ ...bdBtnP, opacity:(!noteTitle.trim()||noteAdding)?0.5:1 }}>
                    {noteAdding?'Saving…':'💾 Save Entry'}
                  </button>
                </div>
              </div>
            )}
            {allEntries.length===0 ? (
              <div style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:32, textAlign:'center' }}>
                <div style={{ fontSize:32, marginBottom:10 }}>📋</div>
                <p style={{ margin:0, fontSize:14, color:BD.textMuted }}>No entries yet. Run a sync or add a note to start the changelog.</p>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {allEntries.map((entry, i) => {
                  if (entry._kind === 'sync') {
                    return (
                      <div key={i} style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:'14px 18px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                          <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:5, background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.25)', color:BD.green, textTransform:'uppercase', letterSpacing:'0.05em' }}>⟳ Auto Sync</span>
                          {entry.channel && <span style={{ fontSize:12, color:BD.textSec }}>{entry.channel}</span>}
                          <span style={{ marginLeft:'auto', fontSize:12, color:BD.textMuted }}>{bdTimeAgo(entry.ts)}</span>
                        </div>
                        <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>
                          <div><div style={{ fontSize:18, fontWeight:700, color:BD.green, lineHeight:1 }}>+{entry.ingested||0}</div><div style={{ fontSize:11, color:BD.textMuted, marginTop:3 }}>Videos ingested</div></div>
                          <div><div style={{ fontSize:18, fontWeight:700, color:(entry.errors||0)>0?BD.amber:BD.textMuted, lineHeight:1 }}>{entry.errors||0}</div><div style={{ fontSize:11, color:BD.textMuted, marginTop:3 }}>Errors</div></div>
                          {entry.docCount!=null && <div><div style={{ fontSize:18, fontWeight:700, color:BD.textPri, lineHeight:1 }}>{entry.docCount}</div><div style={{ fontSize:11, color:BD.textMuted, marginTop:3 }}>Total docs</div></div>}
                          {entry.chunkCount!=null && <div><div style={{ fontSize:18, fontWeight:700, color:BD.textPri, lineHeight:1 }}>{entry.chunkCount?.toLocaleString()}</div><div style={{ fontSize:11, color:BD.textMuted, marginTop:3 }}>Total chunks</div></div>}
                        </div>
                      </div>
                    );
                  }
                  const t = NOTE_TYPES.find(x => x.value===entry.type)||NOTE_TYPES[0];
                  return (
                    <div key={entry.id||i} style={{ background:BD.card, border:`1px solid ${BD.border}`, borderRadius:12, padding:'14px 18px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:entry.text?10:0 }}>
                        <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:5, background:`${t.color}18`, border:`1px solid ${t.color}40`, color:t.color, textTransform:'uppercase', letterSpacing:'0.05em' }}>{t.label}</span>
                        <span style={{ fontSize:13, fontWeight:600, color:BD.textPri, flex:1 }}>{entry.title}</span>
                        <span style={{ fontSize:12, color:BD.textMuted, flexShrink:0 }}>{bdTimeAgo(entry.ts)}</span>
                        <button onClick={() => deleteNote(entry.id)} style={{ background:'none', border:'none', color:BD.textMuted, cursor:'pointer', fontSize:14, padding:'0 2px', lineHeight:1 }} title="Delete note">✕</button>
                      </div>
                      {entry.text && <p style={{ margin:0, fontSize:13, color:BD.textSec, lineHeight:1.6, whiteSpace:'pre-wrap' }}>{entry.text}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    active:      { bg: '#1a3a2a', color: '#4ade80', label: 'Active' },
    idle:        { bg: '#3a2e0a', color: '#facc15', label: 'Idle' },
    expired:     { bg: '#3a1a1a', color: '#f87171', label: 'Expired' },
    none:        { bg: '#2a2a2a', color: '#9ca3af', label: 'No Token' },
    uninstalled: { bg: '#1e1e1e', color: '#6b7280', label: 'Uninstalled' },
  };
  const s = map[status] || map.none;
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
    }}>
      {s.label}
    </span>
  );
}

// ── Relative time helper ──────────────────────────────────────────────────────

function relTime(val) {
  if (!val) return '—';
  let ms;
  if (typeof val === 'number') {
    ms = val;
  } else if (val && typeof val === 'object' && (val._seconds != null || val.seconds != null)) {
    // Firestore Timestamp object ({ _seconds, _nanoseconds } or { seconds, nanoseconds })
    ms = (val._seconds ?? val.seconds) * 1000;
  } else {
    ms = new Date(val).getTime();
  }
  if (!ms || isNaN(ms)) return '—';
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Event badge ───────────────────────────────────────────────────────────────

const EVENT_COLORS = {
  install:                  '#4ade80',
  uninstall:                '#f87171',
  restore:                  '#60a5fa',
  tool_connect:             '#34d399',
  tool_disconnect:          '#fb923c',
  tool_reconnect:           '#a78bfa',
  tool_call:                '#94a3b8',
  claude_task:              '#818cf8',
  voice_task:               '#c084fc',
  workflow_save:            '#2dd4bf',
  workflow_delete:          '#f97316',
  workflow_trigger:         '#f0abfc',
  admin_refresh:            '#fbbf24',
  admin_revoke:             '#f43f5e',
  admin_workflow_edit:      '#fbbf24',
  admin_workflow_delete:    '#f43f5e',
  admin_connection_clear:   '#fb923c',
  admin_connection_update:  '#34d399',
  admin_tool_visibility_update: '#22c55e',
  admin_run_task:           '#818cf8',
  app_settings_update:      '#60a5fa',
  billing_update:           '#4ade80',
};

function EventBadge({ event }) {
  const color = EVENT_COLORS[event] || '#9ca3af';
  return (
    <span style={{ color, fontFamily: 'monospace', fontSize: 12 }}>{event}</span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Admin() {
  const isMobile = useIsMobile();

  const [adminKey,     setAdminKey]     = useState(() => localStorage.getItem('gtm_admin_key') || '');
  const [keyInput,     setKeyInput]     = useState('');
  // Seed authed from localStorage so the dashboard shows immediately on refresh
  // without waiting for the background verification call to return.
  const [authed,       setAuthed]       = useState(() => !!localStorage.getItem('gtm_admin_key'));
  const [authError,    setAuthError]    = useState('');
  const [tab,          setTab]          = useState(() => new URLSearchParams(window.location.search).get('tab') || 'overview');
  const [sidebarOpen,  setSidebarOpen]  = useState(false);

  // Keep ?tab= in sync so reload returns to the same section
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tab);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [tab]);

  const [stats,      setStats]      = useState(null);
  const [locations,  setLocations]  = useState([]);
  const [logs,       setLogs]       = useState([]);
  const [loading,    setLoading]    = useState(false);

  const [logFilter,       setLogFilter]       = useState({ locationId: '', event: '' });
  const [expandedId,        setExpandedId]        = useState(null);
  const [detailData,        setDetailData]        = useState({});
  const [troubleshootData,  setTroubleshootData]  = useState({}); // { [locationId]: { connections, workflows } }
  const [workflowRunLogs,   setWorkflowRunLogs]   = useState({}); // { [locationId]: [] }
  const [taskLogs,          setTaskLogs]          = useState({}); // { [locationId]: [] }
  const [adminModal,        setAdminModal]        = useState(null); // { type, locationId, data }

  // App Settings state
  const [appSettingsData,   setAppSettingsData]   = useState(null);
  const [appSettingsForm,   setAppSettingsForm]   = useState({ clientId: '', clientSecret: '', redirectUri: 'https://claudeserver.vercel.app/oauth/callback' });
  const [appSettingsEdit,   setAppSettingsEdit]   = useState({ clientId: false, clientSecret: false, redirectUri: false });
  const [appSettingsSaving, setAppSettingsSaving] = useState(false);
  const [appSettingsSubTab, setAppSettingsSubTab] = useState('ghl'); // 'ghl' | 'business'
  const [integrationsSubTab, setIntegrationsSubTab] = useState('integrations'); // 'integrations' | 'tool-access' | 'beta-lab'
  const [adminSubTab, setAdminSubTab] = useState('users-roles'); // 'users-roles' | 'dashboard-cfg' | 'credentials'
  const [personasSubTab, setPersonasSubTab] = useState('brain'); // 'brain' | 'personas'
  const [plansSubTab, setPlansSubTab] = useState('billing'); // 'billing' | 'plan-tiers'

  // Business profile state
  const [bizProfile,     setBizProfile]     = useState(null); // loaded from backend
  const [bizForm,        setBizForm]        = useState({ name:'', tagline:'', logoUrl:'', logoEmoji:'🧩' });
  const [bizSaving,      setBizSaving]      = useState(false);

  // Billing state
  const [billingRecords,  setBillingRecords]  = useState([]);
  const [billingSummary,  setBillingSummary]  = useState(null);
  const [billingExpanded, setBillingExpanded] = useState(null);
  const [billingModal,    setBillingModal]    = useState(null); // { type, locationId, data }
  const [billingLoading,  setBillingLoading]  = useState(false);

  // Users & Roles state
  const [rolesLocationId,    setRolesLocationId]    = useState('');
  const [rolesUsers,         setRolesUsers]         = useState([]);
  const [rolesLoading,       setRolesLoading]       = useState(false);
  const [rolesSaving,        setRolesSaving]        = useState({});
  const [rolesSyncMsg,       setRolesSyncMsg]       = useState('');
  const [allFeatures,        setAllFeatures]        = useState(ALL_FEATURES_DEFAULT);
  const [builtinRoles,       setBuiltinRoles]       = useState(BUILTIN_ROLES_DEFAULT);
  const [locationEnabledIntegrations, setLocationEnabledIntegrations] = useState(null); // null = not loaded
  const [customRoles,        setCustomRoles]        = useState([]);
  const [rolesSubTab,        setRolesSubTab]        = useState('users'); // 'users' | 'roles'
  const [roleModal,          setRoleModal]          = useState(null);   // null | { mode:'create'|'edit', role? }
  const [roleTiers,          setRoleTiers]          = useState({});
  const [defaultRoleId,      setDefaultRoleId]      = useState('chats_only');
  const [defaultRoleSaving,  setDefaultRoleSaving]  = useState(false);

  // Tool Access tab state
  const [toolAccessLocationId, setToolAccessLocationId] = useState('');
  const [toolAccessItems,      setToolAccessItems]      = useState([]);
  const [toolAccessLoading,    setToolAccessLoading]    = useState(false);
  const [toolAccessFilter,     setToolAccessFilter]     = useState('all'); // 'all' | 'shared' | 'hidden'
  const [toolAccessThirdParty, setToolAccessThirdParty] = useState([]); // 3rd-party integrations for location

  // Plan Tiers state
  const [tiers,              setTiers]              = useState(null);
  const [tiersLoading,       setTiersLoading]       = useState(false);
  const [tierModal,          setTierModal]          = useState(null); // { tier, data }
  const [ghlProducts,        setGhlProducts]        = useState([]);
  const [ghlProductsLocId,   setGhlProductsLocId]   = useState('');
  const [ghlProductsLoading, setGhlProductsLoading] = useState(false);

  // Brain (shared knowledge base) state
  const [sharedBrains,       setSharedBrains]       = useState([]);
  const [brainLoading,       setBrainLoading]        = useState(false);
  const [selectedBrain,      setSelectedBrain]       = useState(null); // full brain object

  // Chat Personas state
  const [personas,           setPersonas]           = useState([]);
  const [personasLoading,    setPersonasLoading]    = useState(false);
  const [personaModal,       setPersonaModal]       = useState(null); // null | 'create' | persona object (edit)
  const [personaForm,        setPersonaForm]        = useState({ name:'', description:'', avatar:'🧑‍💼', personality:'', content:'', assignedTo:'__all__', assignedLocations:[], status:'draft', webhookEnabled:false, webhookUrl:'' });
  const [personaImproving,   setPersonaImproving]   = useState(false);
  const [personaWebhookTest, setPersonaWebhookTest] = useState(null); // { loading, result }
  const [personaSaving,      setPersonaSaving]      = useState(false);

  // Admin Dashboard config state
  const [dashCfg,            setDashCfg]            = useState(null);  // { enabledTabs, allTabs }
  const [dashCfgSaving,      setDashCfgSaving]      = useState(false);
  const [dashCfgTabs,        setDashCfgTabs]        = useState([]);    // local edit copy

  // SMTP config state
  const [smtpCfg,            setSmtpCfg]            = useState(null);  // loaded from backend
  const [smtpForm,           setSmtpForm]           = useState({ enabled:false, host:'', port:587, secure:false, user:'', pass:'', from:'' });
  const [smtpSaving,         setSmtpSaving]         = useState(false);
  const [smtpTesting,        setSmtpTesting]        = useState(false);
  const [smtpTestTo,         setSmtpTestTo]         = useState('');
  const [smtpTestResult,     setSmtpTestResult]     = useState(null); // null | { ok, msg }
  const [smtpShowPass,       setSmtpShowPass]       = useState(false);

  // Beta Lab state
  const [betaFeatures,       setBetaFeatures]       = useState([]);
  const [betaLoading,        setBetaLoading]        = useState(false);
  const [betaModal,          setBetaModal]          = useState(null); // null | 'create' | feature obj (edit)
  const [betaForm,           setBetaForm]           = useState({ title:'', description:'', version:'', status:'not_shared', linkedFeatures:[] });
  const [betaSaving,         setBetaSaving]         = useState(false);

  // Credentials management state
  const [credentials,        setCredentials]        = useState([]);
  const [credLoading,        setCredLoading]        = useState(false);
  const [credModal,          setCredModal]          = useState(null); // null | 'create' | cred obj (edit)
  const [credForm,           setCredForm]           = useState({ name:'', email:'', username:'', locationIds:[], role:'mini_admin', status:'active', notes:'' });
  const [credSaving,         setCredSaving]         = useState(false);
  const [credShowPass,       setCredShowPass]       = useState(false);
  const [credActivateNow,    setCredActivateNow]    = useState(false);
  const [credPasswordModal,  setCredPasswordModal]  = useState(null); // null | { username, password }
  const [credNewPassword,    setCredNewPassword]    = useState('');
  const [credShowNewPass,    setCredShowNewPass]    = useState(false);

  // 3rd-party Integrations state
  const [builtinTools,       setBuiltinTools]       = useState([]); // GHL built-in tool metadata
  const [integrations,       setIntegrations]       = useState([]);
  const [intLoading,         setIntLoading]         = useState(false);
  const [intModal,           setIntModal]           = useState(null); // null | 'create' | integration obj
  const [intForm,            setIntForm]            = useState({ clientName:'', name:'', type:'webhook', apiKey:'', endpoint:'', method:'GET', headers:'', allowQuery:false, assignedTo:'__all__', assignedLocations:[], personaIds:[], status:'inactive' });
  const [intDiscovering,     setIntDiscovering]     = useState(null); // integrationId being discovered
  const [intDiscoverResult,  setIntDiscoverResult]  = useState({}); // { [id]: { found, title, error } }
  const [intSaving,          setIntSaving]          = useState(false);
  const [intTesting,         setIntTesting]         = useState(null); // integrationId being tested
  const [intTestResult,      setIntTestResult]      = useState({}); // { [id]: result }
  const [intOpenFolders,     setIntOpenFolders]     = useState({}); // { [clientName]: bool }
  const [brainDetailTab,     setBrainDetailTab]      = useState('progress'); // 'progress'|'channels'|'videos'|'settings'
  const [showCreateBrain,    setShowCreateBrain]     = useState(false);
  const [brainForm,          setBrainForm]           = useState({ name: '', description: '', primaryChannel: '' });
  const [brainFormSaving,    setBrainFormSaving]     = useState(false);
  const [brainStatus,        setBrainStatus]         = useState(null); // { stage, queuedCount, processedCount, ... }
  const [brainVideos,        setBrainVideos]         = useState([]);
  const [brainChannelInput,  setBrainChannelInput]   = useState('');
  const [brainChannelAdding, setBrainChannelAdding]  = useState(false);
  const [brainSettingsForm,  setBrainSettingsForm]   = useState({ name: '', description: '', autoSync: false });
  const [brainSettingsSaving,setBrainSettingsSaving] = useState(false);
  const [brainSyncing,       setBrainSyncing]        = useState(false);
  const [adminBrainView,     setAdminBrainView]      = useState('brains'); // 'brains'|'pipeline'|'search'|'mcp'
  const [brainSearchId,      setBrainSearchId]       = useState('');
  const [brainSearchQuery,   setBrainSearchQuery]    = useState('');
  const [brainSearching,     setBrainSearching]      = useState(false);
  const [brainAnswer,        setBrainAnswer]         = useState('');
  const [brainSources,       setBrainSources]        = useState(null);
  const [brainSearchErr,     setBrainSearchErr]      = useState('');
  const [brainMcpTab,        setBrainMcpTab]         = useState('claude');
  const [brainMcpCopied,     setBrainMcpCopied]      = useState(false);

  const getLocationName = useCallback((locationId) => (
    getLocationNameFromList(locations, locationId)
  ), [locations]);

  const getLocationLabel = useCallback((locationId, fallbackName = 'Unnamed Location') => (
    formatLocationLabelFromList(locations, locationId, fallbackName)
  ), [locations]);

  // All available integration keys (must match backend externalTools.js + planTierStore)
  const ALL_INTEGRATIONS = [
    { key: 'perplexity',              label: 'Perplexity AI',       icon: '🔍' },
    { key: 'openai',                  label: 'OpenAI',              icon: '✨' },
    { key: 'openrouter',              label: 'OpenRouter',          icon: '🤖' },
    { key: 'facebook_ads',            label: 'Facebook Ads',        icon: '📘' },
    { key: 'google_ads',              label: 'Google Ads',          icon: '🎯' },
    { key: 'sendgrid',                label: 'SendGrid',            icon: '📧' },
    { key: 'slack',                   label: 'Slack',               icon: '💬' },
    { key: 'apollo',                  label: 'Apollo.io',           icon: '🚀' },
    { key: 'heygen',                  label: 'HeyGen',              icon: '🎬' },
    { key: 'hubspot',                 label: 'HubSpot',             icon: '🟠' },
    { key: 'keap',                    label: 'Keap',                icon: '📋' },
    { key: 'manychat',                label: 'ManyChat',            icon: '💬' },
    { key: 'shopify',                 label: 'Shopify',             icon: '🛍️' },
    { key: 'woocommerce',             label: 'WooCommerce',         icon: '🛒' },
    { key: 'google_calendar',         label: 'Google Calendar',     icon: '📅' },
    { key: 'google_forms',            label: 'Google Forms',        icon: '📋' },
    { key: 'google_my_business',      label: 'Google My Business',  icon: '🏢' },
    { key: 'airtable',                label: 'Airtable',            icon: '📊' },
    { key: 'monday',                  label: 'Monday.com',          icon: '📌' },
    { key: 'typeform',                label: 'Typeform',            icon: '📝' },
    { key: 'asana',                   label: 'Asana',               icon: '✅' },
    { key: 'canva',                   label: 'Canva',               icon: '🎨' },
    { key: 'gravity_forms',           label: 'Gravity Forms',       icon: '📋' },
    { key: 'social_facebook',         label: 'Facebook (Social)',    icon: '👍' },
    { key: 'social_instagram',        label: 'Instagram',           icon: '📸' },
    { key: 'social_tiktok_organic',   label: 'TikTok',              icon: '🎵' },
    { key: 'social_youtube',          label: 'YouTube',             icon: '📹' },
    { key: 'social_linkedin_organic', label: 'LinkedIn (Social)',    icon: '💼' },
    { key: 'social_pinterest',        label: 'Pinterest',           icon: '📌' },
    { key: 'linkedin',                label: 'LinkedIn Ads',        icon: '💼' },
  ];

  // ── Auth ─────────────────────────────────────────────────────────────────

  const login = async (key) => {
    setAuthError('');
    try {
      const data = await adminFetch('/admin/stats', { adminKey: key });
      if (data.success) {
        setAdminKey(key);
        setAuthed(true);
        localStorage.setItem('gtm_admin_key', key);
        setStats(data.stats);
        setLogs(data.recentActivity || []);
      } else {
        // Key rejected — clear stored key and revert to login form
        localStorage.removeItem('gtm_admin_key');
        setAuthed(false);
        setAdminKey('');
        setAuthError(data.error || 'Invalid admin key.');
      }
    } catch {
      // Network error during background verify — leave authed as-is
      // so a transient failure doesn't log the admin out unexpectedly.
      if (!localStorage.getItem('gtm_admin_key')) setAuthError('Connection failed.');
    }
  };

  const logout = () => {
    localStorage.removeItem('gtm_admin_key');
    setAdminKey(''); setAuthed(false); setStats(null); setLocations([]);
  };

  // Auto-login on mount
  useEffect(() => {
    if (adminKey) login(adminKey);
  }, []); // eslint-disable-line


  // ── Data loading ─────────────────────────────────────────────────────────

  const loadLocations = useCallback(async () => {
    setLoading(true);
    const data = await adminFetch('/admin/locations', { adminKey });
    if (data.success) setLocations(data.data || []);
    setLoading(false);
  }, [adminKey]);

  useEffect(() => {
    if (!authed || !adminKey || locations.length > 0 || loading) return;
    loadLocations();
  }, [adminKey, authed, loadLocations, loading, locations.length]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (logFilter.locationId) q.set('locationId', logFilter.locationId);
    if (logFilter.event)      q.set('event', logFilter.event);
    q.set('limit', '200');
    const data = await adminFetch(`/admin/logs?${q}`, { adminKey });
    if (data.success) setLogs(data.data || []);
    setLoading(false);
  }, [adminKey, logFilter]);

  const loadStats = useCallback(async () => {
    const data = await adminFetch('/admin/stats', { adminKey });
    if (data.success) { setStats(data.stats); setLogs(data.recentActivity || []); }
  }, [adminKey]);

  const loadAppSettings = useCallback(async () => {
    const data = await adminFetch('/admin/app-settings', { adminKey });
    if (data.success) setAppSettingsData(data.data);
  }, [adminKey]);

  const loadBizProfile = useCallback(async () => {
    const data = await adminFetch('/admin/business-profile', { adminKey });
    if (data.success) {
      setBizProfile(data.profile);
      setBizForm({ name: data.profile.name || '', tagline: data.profile.tagline || '', logoUrl: data.profile.logoUrl || '', logoEmoji: data.profile.logoEmoji || '🧩' });
    }
  }, [adminKey]);

  const loadBilling = useCallback(async () => {
    setBillingLoading(true);
    const data = await adminFetch('/admin/billing', { adminKey });
    if (data.success) { setBillingRecords(data.data || []); setBillingSummary(data.summary); }
    setBillingLoading(false);
  }, [adminKey]);

  const loadTiers = useCallback(async () => {
    setTiersLoading(true);
    const data = await adminFetch('/admin/plan-tiers', { adminKey });
    if (data.success) setTiers(data.data);
    setTiersLoading(false);
  }, [adminKey]);

  const loadUsersForLocation = useCallback(async (locId) => {
    const id = locId || rolesLocationId;
    if (!id) return;
    setRolesLoading(true);
    try {
      const [usersData, rolesData, intData] = await Promise.all([
        adminFetch(`/admin/locations/${id}/users`, { adminKey }),
        adminFetch(`/admin/locations/${id}/custom-roles`, { adminKey }),
        adminFetch(`/admin/locations/${id}/enabled-integrations`, { adminKey }),
      ]);
      if (usersData.success) setRolesUsers(usersData.users || []);
      if (rolesData.success) {
        setAllFeatures(rolesData.allFeatures || []);
        setBuiltinRoles(rolesData.builtinRoles || []);
        setCustomRoles(rolesData.customRoles || []);
        if (rolesData.tiers) setRoleTiers(rolesData.tiers);
        if (rolesData.defaultRoleId) setDefaultRoleId(rolesData.defaultRoleId);
      }
      setLocationEnabledIntegrations(intData.success ? (intData.enabled || []) : []);
    } catch { toast.error('Failed to load users/roles'); }
    setRolesLoading(false);
  }, [adminKey, rolesLocationId]); // eslint-disable-line

  const loadCustomRoles = useCallback(async (locId) => {
    const id = locId || rolesLocationId;
    if (!id) return;
    try {
      const data = await adminFetch(`/admin/locations/${id}/custom-roles`, { adminKey });
      if (data.success) {
        setAllFeatures(data.allFeatures || []);
        setBuiltinRoles(data.builtinRoles || []);
        setCustomRoles(data.customRoles || []);
        if (data.tiers) setRoleTiers(data.tiers);
      }
    } catch {}
  }, [adminKey, rolesLocationId]); // eslint-disable-line

  const loadSharedBrains = useCallback(async () => {
    setBrainLoading(true);
    const data = await adminFetch('/brain/list', { adminKey });
    if (data.success) setSharedBrains(data.data || []);
    setBrainLoading(false);
  }, [adminKey]);

  const loadBrainDetail = useCallback((b) => {
    setSelectedBrain(b);
  }, []);

  const loadPersonas = useCallback(async () => {
    setPersonasLoading(true);
    const data = await adminFetch('/admin/personas', { adminKey });
    if (data.success) setPersonas(data.data || []);
    setPersonasLoading(false);
  }, [adminKey]);

  const loadIntegrations = useCallback(async () => {
    setIntLoading(true);
    const [data, metaData] = await Promise.all([
      adminFetch('/admin/integrations', { adminKey }),
      adminFetch('/admin/tools/meta', { adminKey }),
    ]);
    if (data.success) {
      setIntegrations(data.data || []);
      // Auto-open all folders
      const folders = {};
      (data.data || []).forEach(i => { folders[i.clientName] = true; });
      setIntOpenFolders(folders);
    }
    if (metaData.success) setBuiltinTools(metaData.data || []);
    setIntLoading(false);
  }, [adminKey]);

  const loadBetaFeatures = useCallback(async () => {
    setBetaLoading(true);
    const data = await adminFetch('/admin/beta-lab', { adminKey });
    if (data.success) setBetaFeatures(data.data || []);
    setBetaLoading(false);
  }, [adminKey]);

  const loadDashCfg = useCallback(async () => {
    const data = await adminFetch('/admin/dashboard-config', { adminKey });
    if (data.success) {
      setDashCfg(data);
      setDashCfgTabs(data.data?.enabledTabs || []);
    }
  }, [adminKey]);

  const loadSmtpConfig = useCallback(async () => {
    const data = await adminFetch('/admin/smtp-config', { adminKey });
    if (data.success) {
      setSmtpCfg(data.config);
      setSmtpForm(f => ({
        ...f,
        enabled: data.config.enabled || false,
        host:    data.config.host    || '',
        port:    data.config.port    || 587,
        secure:  data.config.secure  || false,
        user:    data.config.user    || '',
        from:    data.config.from    || '',
        pass:    '', // never pre-fill password
      }));
    }
  }, [adminKey]);

  const loadCredentials = useCallback(async () => {
    setCredLoading(true);
    const data = await adminFetch('/admin/dashboard-credentials', { adminKey });
    if (data.success) setCredentials(data.credentials || []);
    setCredLoading(false);
  }, [adminKey]);

  // Load business profile once on auth so sidebar shows correct name immediately
  useEffect(() => { if (authed) loadBizProfile(); }, [authed]); // eslint-disable-line

  useEffect(() => {
    if (!authed) return;
    if (tab === 'overview')     { loadStats(); loadBilling(); }
    if (tab === 'locations')    loadLocations();
    if (tab === 'logs')         loadLogs();
    if (tab === 'app-settings') { loadAppSettings(); loadBizProfile(); loadSmtpConfig(); }
    if (tab === 'billing')   { loadBilling(); loadTiers(); }
    if (tab === 'personas')  { loadSharedBrains(); loadPersonas(); }
    if (tab === 'integrations') { loadIntegrations(); loadBetaFeatures(); loadDashCfg(); loadCredentials(); if (locations.length === 0) loadLocations(); }
    // Users & Roles tab: ensure locations list + default role loaded
    if (tab === 'users-roles') {
      if (locations.length === 0) loadLocations();
      adminFetch('/admin/default-role', { adminKey }).then(r => { if (r.success) setDefaultRoleId(r.roleId); }).catch(() => {});
    }
    // Tool Access tab: ensure locations list is loaded for the dropdown
    if (tab === 'users-roles' && locations.length === 0) loadLocations();
  }, [authed, tab]); // eslint-disable-line

  // ── Actions ──────────────────────────────────────────────────────────────

  const doAction = async (path, label) => {
    const data = await adminFetch(path, { method: 'POST', adminKey });
    if (data.success) {
      toast.success(label);
      loadLocations();
      loadStats();
    } else {
      toast.error(data.error);
    }
  };

  const loadDetail = async (locationId) => {
    if (expandedId === locationId) { setExpandedId(null); return; }
    setExpandedId(locationId);
    if (!detailData[locationId]) {
      const data = await adminFetch(`/admin/locations/${locationId}`, { adminKey });
      if (data.success) setDetailData((prev) => ({ ...prev, [locationId]: data.data }));
    }
    if (!troubleshootData[locationId]) {
      const [connRes, accessRes, wfRes, wfLogsRes, taskLogsRes] = await Promise.all([
        adminFetch(`/admin/locations/${locationId}/connections`, { adminKey }),
        adminFetch(`/admin/locations/${locationId}/tool-access`, { adminKey }),
        adminFetch(`/admin/locations/${locationId}/workflows`, { adminKey }),
        adminFetch(`/admin/logs?locationId=${locationId}&event=workflow_trigger&limit=100`, { adminKey }),
        adminFetch(`/admin/logs?locationId=${locationId}&limit=200`, { adminKey }),
      ]);
      setTroubleshootData((prev) => ({
        ...prev,
        [locationId]: {
          connections: connRes.success ? connRes.data : {},
          toolAccess:  accessRes.success ? accessRes.data : [],
          workflows:   wfRes.success   ? wfRes.data  : [],
        },
      }));
      setWorkflowRunLogs((prev) => ({
        ...prev,
        [locationId]: wfLogsRes.success ? wfLogsRes.data : [],
      }));
      setTaskLogs((prev) => ({
        ...prev,
        [locationId]: taskLogsRes.success
          ? taskLogsRes.data.filter(l => l.event === 'claude_task' || l.event === 'voice_task')
          : [],
      }));
    }
  };

  const clearConnection = (locationId, category) => {
    const locationLabel = getLocationLabel(locationId);
    confirmToast(`Clear ${category} connection for ${locationLabel}? The user will need to reconnect it.`, async () => {
      const res = await adminFetch(`/admin/locations/${locationId}/connections/${category}`, { method: 'DELETE', adminKey });
      if (res.success) {
        toast.success(`Cleared ${category} for ${locationLabel}`);
        // Refresh troubleshoot data
        setTroubleshootData((prev) => {
          const loc = prev[locationId] || {};
          const newConn = { ...loc.connections };
          delete newConn[category];
          return {
            ...prev,
            [locationId]: {
              ...loc,
              connections: newConn,
              toolAccess: (loc.toolAccess || []).map((item) => (
                item.key === category
                  ? { ...item, connected: false, configPreview: null }
                  : item
              )),
            },
          };
        });
        setDetailData((prev) => {
          const d = prev[locationId];
          if (!d) return prev;
          return { ...prev, [locationId]: { ...d, connectedCategories: (d.connectedCategories || []).filter(c => c !== category) } };
        });
      } else {
        toast.error(res.error);
      }
    });
  };

  const deleteWorkflow = (locationId, wfId, wfName) => {
    const locationLabel = getLocationLabel(locationId);
    confirmToast(`Delete workflow "${wfName}" from ${locationLabel}?`, async () => {
      const res = await adminFetch(`/admin/locations/${locationId}/workflows/${wfId}`, { method: 'DELETE', adminKey });
      if (res.success) {
        toast.success(`Deleted workflow "${wfName}" from ${locationLabel}`);
        setTroubleshootData((prev) => {
          const loc = prev[locationId] || {};
          return { ...prev, [locationId]: { ...loc, workflows: (loc.workflows || []).filter(w => w.id !== wfId) } };
        });
      } else {
        toast.error(res.error);
      }
    });
  };

  const editWorkflow = (locationId, wf) => {
    setAdminModal({ type: 'edit-workflow', locationId, data: wf });
  };

  const editConnection = (locationId, cat, cfg) => {
    setAdminModal({ type: 'edit-connection', locationId, data: { cat, cfg } });
  };

  const loadToolAccess = async (locationId) => {
    if (!locationId) return;
    setToolAccessLoading(true);
    const [res, intRes] = await Promise.all([
      adminFetch(`/admin/locations/${locationId}/tool-access`, { adminKey }),
      adminFetch('/admin/integrations', { adminKey }),
    ]);
    setToolAccessItems(res.success ? res.data : []);
    if (intRes.success) {
      const all = intRes.data || [];
      const forLocation = all.filter(i =>
        i.status === 'active' && (
          i.assignedTo === '__all__' ||
          (i.assignedTo === 'specific' && Array.isArray(i.assignedLocations) && i.assignedLocations.includes(locationId))
        )
      );
      setToolAccessThirdParty(forLocation);
    } else {
      setToolAccessThirdParty([]);
    }
    setToolAccessLoading(false);
  };

  const toggleToolShared = async (locationId, category, shared) => {
    const locationLabel = getLocationLabel(locationId);

    const res = await adminFetch(`/admin/locations/${locationId}/tool-access/${category}`, {
      method: 'POST',
      adminKey,
      body: { shared },
    });

    if (res.success) {
      toast.success(`${shared ? 'Shared' : 'Hidden'} ${category} for ${locationLabel}`, { autoClose: 2500 });
      setTroubleshootData((prev) => {
        const loc = prev[locationId] || {};
        return {
          ...prev,
          [locationId]: {
            ...loc,
            toolAccess: (loc.toolAccess || []).map((item) => (
              item.key === category ? { ...item, shared } : item
            )),
          },
        };
      });
      // Also update the dedicated Tool Access tab if it's showing this location
      if (locationId === toolAccessLocationId) {
        setToolAccessItems((prev) => prev.map((item) => item.key === category ? { ...item, shared } : item));
      }
    } else {
      toast.error(res.error || 'Failed to update tool access');
    }
  };

  // ── Login screen ──────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: '32px 24px', width: '100%', maxWidth: 360 }}>
          <h2 style={{ color: '#fff', margin: '0 0 8px', fontSize: 22 }}>Admin Access</h2>
          <p style={{ color: '#888', margin: '0 0 24px', fontSize: 14 }}>Enter your ADMIN_API_KEY to continue.</p>
          <input
            type="password"
            placeholder="Admin API key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && login(keyInput)}
            style={{ width: '100%', padding: '10px 14px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 14, boxSizing: 'border-box', marginBottom: 12 }}
          />
          {authError && <p style={{ color: '#f87171', fontSize: 13, margin: '0 0 12px' }}>{authError}</p>}
          <button
            onClick={() => login(keyInput)}
            style={{ width: '100%', padding: '10px', background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  // Query suffix for brain API calls when the brain lives in a user location (not __shared__).
  // Use _locationId (not isShared) — a brain can be isShared:true but still stored under a real location.
  const brainLocQ = selectedBrain?._locationId && selectedBrain._locationId !== '__shared__'
    ? `?loc=${encodeURIComponent(selectedBrain._locationId)}`
    : '';

  // TAB_STYLE used for sub-tabs within each section (billing, brain, plan-tiers, etc.)
  const TAB_STYLE = (active) => ({
    padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500,
    background: active ? 'rgba(124,58,237,0.25)' : 'transparent',
    color: active ? '#a78bfa' : '#6b7280',
    border: active ? '1px solid rgba(124,58,237,0.4)' : '1px solid transparent',
    transition: 'all .15s',
  });

  const SIDEBAR_NAV = [
    { key: 'overview',     label: 'Dashboard',     icon: '⊞' },
    { key: 'locations',    label: 'Locations',     icon: '📍' },
    { key: 'users-roles',  label: 'Users & Roles', icon: '👥' },
    { key: 'personas',     label: 'Personas',      icon: '🧠' },
    { key: 'integrations', label: 'Integrations',  icon: '🔌' },
    { key: 'billing',      label: 'Plans',         icon: '💳' },
    { key: 'logs',         label: 'Activity Logs', icon: '📋' },
    { key: 'app-settings', label: 'App Settings',  icon: '⚙️' },
  ];

  const PAGE_TITLE = {
    overview: 'Dashboard', locations: 'Locations',
    'users-roles': 'Users & Roles', personas: 'Personas', integrations: 'Integrations',
    billing: 'Plans', logs: 'Activity Logs', 'app-settings': 'App Settings',
  };

  const navItemStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    padding: '9px 12px', borderRadius: 8, marginBottom: 1,
    background: active ? 'rgba(124,58,237,0.18)' : 'transparent',
    border: active ? '1px solid rgba(124,58,237,0.35)' : '1px solid transparent',
    color: active ? '#a78bfa' : '#6b7280',
    cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400,
    textAlign: 'left', transition: 'all .15s',
  });

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#09090f', color: '#e5e7eb', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Sidebar ── */}
      {(!isMobile || sidebarOpen) && (
        <>
          {isMobile && (
            <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 99, backdropFilter: 'blur(2px)' }} />
          )}
          <aside style={{
            width: 228, flexShrink: 0, background: '#0e0e16',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', flexDirection: 'column',
            position: 'fixed', top: 0, left: 0, height: '100vh', zIndex: 100,
          }}>
            {/* Brand */}
            <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>🛡️</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9', letterSpacing: '-0.01em' }}>{bizProfile?.name || 'HL Pro Tools'}</div>
                  <div style={{ fontSize: 11, color: '#374151', marginTop: 1 }}>{bizProfile?.tagline || 'Admin Console'}</div>
                </div>
              </div>
            </div>

            {/* Nav */}
            <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto', scrollbarWidth: 'none' }}>
              {SIDEBAR_NAV.map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => { setTab(key); if (isMobile) setSidebarOpen(false); }}
                  style={navItemStyle(tab === key)}
                  onMouseEnter={e => { if (tab !== key) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#9ca3af'; } }}
                  onMouseLeave={e => { if (tab !== key) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6b7280'; } }}
                >
                  <span style={{ fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                  {label}
                </button>
              ))}
            </nav>

            {/* Bottom */}
            <div style={{ padding: '8px 8px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
              <button
                onClick={() => { loadStats(); loadBilling(); if (tab !== 'overview') { if (tab === 'locations') loadLocations(); if (tab === 'logs') loadLogs(); } }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', borderRadius: 8, background: 'transparent', border: '1px solid transparent', color: '#374151', cursor: 'pointer', fontSize: 13, textAlign: 'left', transition: 'color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#9ca3af'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#374151'; }}
              >
                <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>↻</span> Refresh
              </button>
              <button
                onClick={logout}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', borderRadius: 8, background: 'transparent', border: '1px solid transparent', color: '#374151', cursor: 'pointer', fontSize: 13, textAlign: 'left', transition: 'color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#374151'; }}
              >
                <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>↩</span> Sign Out
              </button>
            </div>
          </aside>
        </>
      )}

      {/* ── Main area ── */}
      <div style={{ flex: 1, marginLeft: isMobile ? 0 : 228, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>

        {/* Top header */}
        <div style={{
          background: '#0e0e16', borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '0 24px', height: 58,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 50, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {isMobile && (
              <button onClick={() => setSidebarOpen(true)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 20, padding: 4, lineHeight: 1 }}>☰</button>
            )}
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{PAGE_TITLE[tab] || tab}</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {stats && !isMobile && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.18)' }}>
                  {stats.active} active
                </span>
                <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,0.04)', color: '#6b7280', border: '1px solid rgba(255,255,255,0.07)' }}>
                  {stats.total} locations
                </span>
              </div>
            )}
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
              A
            </div>
          </div>
        </div>

        {/* Page content */}
        <div style={{ padding: isMobile ? '16px' : '28px', flex: 1, overflowX: 'hidden' }}>

        {/* ── App Settings Tab ─────────────────────────────────────────── */}
        {tab === 'app-settings' && (
          <div style={{ maxWidth: 580 }}>

            {/* Sub-tab bar */}
            <div style={{ display:'flex', gap:0, borderBottom:'1px solid #1f2937', marginBottom:28 }}>
              {[{ id:'ghl', label:'Connections' }, { id:'business', label:'Business Profile' }, { id:'email', label:'Email Config' }].map(t => (
                <button key={t.id} onClick={() => setAppSettingsSubTab(t.id)} style={{
                  background:'none', border:'none',
                  borderBottom: appSettingsSubTab === t.id ? '2px solid #7c3aed' : '2px solid transparent',
                  color: appSettingsSubTab === t.id ? '#a78bfa' : '#6b7280',
                  padding:'10px 20px', fontSize:14, fontWeight: appSettingsSubTab === t.id ? 600 : 400,
                  cursor:'pointer', marginBottom:-1,
                }}>{t.label}</button>
              ))}
            </div>

            {/* ── Connections sub-tab ── */}
            {appSettingsSubTab === 'ghl' && <>
            <h3 style={{ color: '#fff', margin: '0 0 6px', fontSize: 16 }}>GHL App Credentials</h3>
            <p style={{ color: '#9ca3af', fontSize: 13, margin: '0 0 24px' }}>
              Set your GoHighLevel Marketplace App credentials. These are used for the OAuth install flow and token exchange.
              {appSettingsData?.configured
                ? <span style={{ color: '#4ade80', marginLeft: 8 }}>✓ Configured</span>
                : <span style={{ color: '#f87171', marginLeft: 8 }}>✗ Not yet configured</span>}
            </p>

            {[
              { key: 'clientId',     label: 'GHL Client ID',     type: 'text',     placeholder: 'Enter Client ID from GHL Marketplace App' },
              { key: 'clientSecret', label: 'GHL Client Secret', type: 'password', placeholder: 'Enter Client Secret' },
              { key: 'redirectUri',  label: 'Redirect URI',      type: 'text',     placeholder: 'https://claudeserver.vercel.app/oauth/callback' },
            ].map((f) => {
              const hasDb  = !!(appSettingsData?.[f.key]);
              const isEdit = appSettingsEdit[f.key];
              const dbVal  = appSettingsData?.[f.key] || '';

              return (
                <div key={f.key} style={{ marginBottom: 18 }}>
                  <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {f.label}
                    {hasDb && !isEdit && <span style={{ color: '#4ade80', marginLeft: 8, textTransform: 'none', fontWeight: 400 }}>✓ saved</span>}
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <input
                        type={isEdit || !hasDb ? f.type : 'text'}
                        value={isEdit ? appSettingsForm[f.key] : hasDb ? dbVal : appSettingsForm[f.key]}
                        readOnly={hasDb && !isEdit}
                        onChange={(e) => {
                          if (hasDb && !isEdit) return;
                          setAppSettingsForm((p) => ({ ...p, [f.key]: e.target.value }));
                        }}
                        placeholder={isEdit ? `Enter new ${f.label}…` : !hasDb ? f.placeholder : ''}
                        style={{
                          width: '100%', padding: '10px 36px 10px 12px', boxSizing: 'border-box',
                          background: hasDb && !isEdit ? 'rgba(255,255,255,0.03)' : '#1a1a1a',
                          border: '1px solid #333', borderRadius: 8, color: hasDb && !isEdit ? '#6b7280' : '#fff',
                          fontSize: 13, cursor: hasDb && !isEdit ? 'default' : 'text',
                        }}
                      />
                      {hasDb && !isEdit && (
                        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 12 }}>🔒</span>
                      )}
                    </div>
                    {hasDb ? (
                      isEdit ? (
                        <button
                          onClick={() => setAppSettingsEdit((p) => ({ ...p, [f.key]: false }))}
                          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid #444', borderRadius: 8, color: '#9ca3af', padding: '0 12px', cursor: 'pointer', fontSize: 13 }}
                        >✕</button>
                      ) : (
                        <button
                          onClick={() => {
                            setAppSettingsEdit((p) => ({ ...p, [f.key]: true }));
                            setAppSettingsForm((p) => ({ ...p, [f.key]: '' }));
                          }}
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #444', borderRadius: 8, color: '#9ca3af', padding: '0 12px', cursor: 'pointer', fontSize: 14 }}
                        >✏️</button>
                      )
                    ) : null}
                  </div>
                </div>
              );
            })}

            <button
              disabled={appSettingsSaving}
              onClick={async () => {
                const payload = {};
                ['clientId', 'clientSecret', 'redirectUri'].forEach((k) => {
                  if (appSettingsForm[k].trim()) payload[k] = appSettingsForm[k].trim();
                });
                if (!Object.keys(payload).length) { toast.info('No changes to save.'); return; }
                setAppSettingsSaving(true);
                const data = await adminFetch('/admin/app-settings', { method: 'POST', adminKey, body: payload });
                setAppSettingsSaving(false);
                if (data.success) {
                  toast.success('GHL app credentials saved.');
                  setAppSettingsEdit({ clientId: false, clientSecret: false, redirectUri: false });
                  setAppSettingsForm({ clientId: '', clientSecret: '', redirectUri: '' });
                  loadAppSettings();
                } else {
                  toast.error(data.error);
                }
              }}
              style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: appSettingsSaving ? 0.6 : 1 }}
            >
              {appSettingsSaving ? 'Saving…' : 'Save Credentials'}
            </button>

            <div style={{ marginTop: 28, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: 16 }}>
              <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>
                <strong style={{ color: '#e5e7eb' }}>Install URL:</strong>{' '}
                <code style={{ color: '#a5b4fc' }}>https://claudeserver.vercel.app/oauth/install</code>
              </p>
              <p style={{ color: '#9ca3af', fontSize: 12, margin: '8px 0 0' }}>
                <strong style={{ color: '#e5e7eb' }}>Callback / Redirect URI:</strong>{' '}
                <code style={{ color: '#a5b4fc' }}>https://claudeserver.vercel.app/oauth/callback</code>
              </p>
              <p style={{ color: '#9ca3af', fontSize: 12, margin: '8px 0 0' }}>
                <strong style={{ color: '#e5e7eb' }}>Webhook URL:</strong>{' '}
                <code style={{ color: '#a5b4fc' }}>https://claudeserver.vercel.app/webhooks/ghl</code>
              </p>
            </div>

            </>}

            {/* ── Business Profile sub-tab ── */}
            {appSettingsSubTab === 'business' && <>
            <h3 style={{ color: '#fff', margin: '0 0 6px', fontSize: 16 }}>Business Profile</h3>
            <p style={{ color: '#9ca3af', fontSize: 13, margin: '0 0 24px' }}>
              Customise the app name, logo, and tagline shown across the Admin Console, Admin Dashboard login, and user-facing app.
            </p>

            {/* Preview card */}
            <div style={{ background: '#0f1117', border: '1px solid #1f2937', borderRadius: 12, padding: '20px 24px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                {bizForm.logoUrl
                  ? <img src={bizForm.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 }} onError={(e) => { e.target.style.display = 'none'; }} />
                  : <span style={{ fontSize: 26 }}>{bizForm.logoEmoji || '🧩'}</span>}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#f1f5f9' }}>{bizForm.name || 'HL Pro Tools'}</div>
                {bizForm.tagline && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{bizForm.tagline}</div>}
              </div>
              <div style={{ marginLeft: 'auto', fontSize: 11, color: '#374151', background: 'rgba(255,255,255,0.04)', border: '1px solid #1f2937', borderRadius: 6, padding: '4px 10px' }}>Preview</div>
            </div>

            {/* App Name */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>App Name</label>
              <input
                type="text"
                value={bizForm.name}
                onChange={e => setBizForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Acme Agency"
                style={{ width: '100%', padding: '10px 12px', boxSizing: 'border-box', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13 }}
              />
            </div>

            {/* Tagline */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tagline <span style={{ textTransform: 'none', fontWeight: 400, color: '#4b5563' }}>(optional)</span></label>
              <input
                type="text"
                value={bizForm.tagline}
                onChange={e => setBizForm(p => ({ ...p, tagline: e.target.value }))}
                placeholder="e.g. Powered by AI"
                style={{ width: '100%', padding: '10px 12px', boxSizing: 'border-box', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13 }}
              />
            </div>

            {/* Logo Emoji */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Logo Emoji <span style={{ textTransform: 'none', fontWeight: 400, color: '#4b5563' }}>(fallback when no image URL)</span></label>
              <input
                type="text"
                value={bizForm.logoEmoji}
                onChange={e => setBizForm(p => ({ ...p, logoEmoji: e.target.value }))}
                placeholder="🧩"
                style={{ width: 80, padding: '10px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 22, textAlign: 'center' }}
              />
            </div>

            {/* Logo URL */}
            <div style={{ marginBottom: 28 }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Logo Image URL <span style={{ textTransform: 'none', fontWeight: 400, color: '#4b5563' }}>(optional, overrides emoji)</span></label>
              <input
                type="text"
                value={bizForm.logoUrl}
                onChange={e => setBizForm(p => ({ ...p, logoUrl: e.target.value }))}
                placeholder="https://example.com/logo.png"
                style={{ width: '100%', padding: '10px 12px', boxSizing: 'border-box', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13 }}
              />
            </div>

            <button
              disabled={bizSaving}
              onClick={async () => {
                setBizSaving(true);
                const data = await adminFetch('/admin/business-profile', { method: 'PUT', adminKey, body: bizForm });
                setBizSaving(false);
                if (data.success) {
                  setBizProfile(data.profile);
                  toast.success('Business profile saved.');
                } else {
                  toast.error(data.error || 'Failed to save.');
                }
              }}
              style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: bizSaving ? 0.6 : 1 }}
            >
              {bizSaving ? 'Saving…' : 'Save Profile'}
            </button>
            </>}

            {/* ── Email Config sub-tab ── */}
            {appSettingsSubTab === 'email' && <>
            <h3 style={{ color: '#fff', margin: '0 0 6px', fontSize: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              Email Configuration
              {smtpCfg && (
                <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99, background: smtpCfg.enabled ? 'rgba(74,222,128,0.1)' : 'rgba(107,114,128,0.1)', color: smtpCfg.enabled ? '#4ade80' : '#6b7280', border: `1px solid ${smtpCfg.enabled ? 'rgba(74,222,128,0.2)' : 'rgba(107,114,128,0.2)'}` }}>
                  {smtpCfg.enabled ? 'Enabled' : 'Disabled'}
                </span>
              )}
            </h3>
            <p style={{ color: '#9ca3af', fontSize: 13, margin: '0 0 20px' }}>
              SMTP settings for sending credential activation emails. Leave disabled to fall back to server environment variables.
            </p>

            <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: 20 }}>
              {(() => {
                const inp = { width:'100%', boxSizing:'border-box', background:'#0a0f1a', border:'1px solid #1f2937', borderRadius:8, color:'#e5e7eb', padding:'9px 12px', fontSize:14, outline:'none', marginBottom:14 };
                const lbl = { display:'block', color:'#9ca3af', fontSize:12, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:5 };
                return (
                  <>
                    <label style={{ display:'flex', alignItems:'center', gap:12, cursor:'pointer', marginBottom:20, padding:'12px 16px', background:'#0f1117', border:'1px solid #1f2937', borderRadius:8 }}>
                      <input type="checkbox" checked={smtpForm.enabled} onChange={e => setSmtpForm(f => ({ ...f, enabled: e.target.checked }))} style={{ width:17, height:17, accentColor:'#6366f1', cursor:'pointer' }} />
                      <div>
                        <div style={{ fontSize:14, fontWeight:600, color:'#e5e7eb' }}>Enable SMTP Email</div>
                        <div style={{ fontSize:12, color:'#4b5563', marginTop:2 }}>If disabled, falls back to SMTP_* env vars.</div>
                      </div>
                    </label>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                      <div>
                        <label style={lbl}>SMTP Host</label>
                        <input style={inp} placeholder="smtp.gmail.com" value={smtpForm.host} onChange={e => setSmtpForm(f => ({ ...f, host: e.target.value }))} />
                      </div>
                      <div>
                        <label style={lbl}>Port</label>
                        <input style={inp} type="number" placeholder="587" value={smtpForm.port} onChange={e => setSmtpForm(f => ({ ...f, port: parseInt(e.target.value) || 587 }))} />
                      </div>
                    </div>
                    <p style={{ fontSize:12, color:'#4b5563', margin:'0 0 14px', padding:'8px 12px', background:'rgba(255,255,255,0.03)', borderRadius:6, border:'1px solid #1f2937' }}>
                      SSL mode is auto-detected from port — port <strong style={{color:'#9ca3af'}}>465</strong> uses SSL, port <strong style={{color:'#9ca3af'}}>587</strong> uses STARTTLS.
                    </p>
                    <label style={lbl}>SMTP Username / Email</label>
                    <input style={inp} type="email" placeholder="you@gmail.com" value={smtpForm.user} onChange={e => setSmtpForm(f => ({ ...f, user: e.target.value }))} autoComplete="off" />
                    <label style={lbl}>{smtpCfg?.hasPassword ? 'Password (leave blank to keep current)' : 'Password'}</label>
                    <div style={{ position:'relative', marginBottom:14 }}>
                      <input
                        type={smtpShowPass ? 'text' : 'password'}
                        style={{ ...inp, marginBottom:0, paddingRight:44 }}
                        placeholder={smtpCfg?.hasPassword ? '••••••••' : 'Enter SMTP password'}
                        value={smtpForm.pass}
                        onChange={e => setSmtpForm(f => ({ ...f, pass: e.target.value }))}
                        autoComplete="new-password"
                      />
                      <button type="button" onClick={() => setSmtpShowPass(v => !v)} style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'#6b7280', cursor:'pointer', fontSize:13, padding:0 }}>
                        {smtpShowPass ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <label style={lbl}>From Address</label>
                    <input style={inp} placeholder={'"HL Pro Tools" <noreply@example.com>'} value={smtpForm.from} onChange={e => setSmtpForm(f => ({ ...f, from: e.target.value }))} />
                    <button
                      disabled={smtpSaving}
                      onClick={async () => {
                        setSmtpSaving(true);
                        const data = await adminFetch('/admin/smtp-config', { method:'PUT', adminKey, body: smtpForm });
                        if (data.success) { setSmtpCfg(data.config); toast.success('Email config saved'); }
                        else toast.error(data.error || 'Save failed');
                        setSmtpSaving(false);
                      }}
                      style={{ background:'#6366f1', border:'none', borderRadius:8, color:'#fff', padding:'9px 22px', cursor: smtpSaving ? 'not-allowed' : 'pointer', fontSize:13, fontWeight:600, opacity: smtpSaving ? 0.6 : 1, marginBottom:20 }}
                    >{smtpSaving ? 'Saving…' : 'Save Email Config'}</button>
                    <div style={{ borderTop:'1px solid #1f2937', paddingTop:16 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'#9ca3af', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.04em' }}>Send Test Email</div>
                      <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                        <input type="email" placeholder="test@example.com" value={smtpTestTo} onChange={e => { setSmtpTestTo(e.target.value); setSmtpTestResult(null); }} style={{ ...inp, marginBottom:0, flex:1 }} />
                        <button
                          disabled={smtpTesting || !smtpTestTo.trim()}
                          onClick={async () => {
                            setSmtpTesting(true); setSmtpTestResult(null);
                            const data = await adminFetch('/admin/smtp-config/test', { method:'POST', adminKey, body: { to: smtpTestTo } });
                            setSmtpTestResult(data.success ? { ok:true, msg:'Test email sent successfully!' } : { ok:false, msg: data.error || 'Send failed' });
                            setSmtpTesting(false);
                          }}
                          style={{ flexShrink:0, background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, color:'#a5b4fc', padding:'9px 16px', cursor: (smtpTesting || !smtpTestTo.trim()) ? 'not-allowed' : 'pointer', fontSize:13, fontWeight:600, opacity: (smtpTesting || !smtpTestTo.trim()) ? 0.5 : 1 }}
                        >{smtpTesting ? 'Sending…' : 'Send Test'}</button>
                      </div>
                      {smtpTestResult && (
                        <div style={{ marginTop:10, padding:'8px 12px', borderRadius:7, fontSize:13, background: smtpTestResult.ok ? 'rgba(74,222,128,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${smtpTestResult.ok ? 'rgba(74,222,128,0.2)' : 'rgba(239,68,68,0.2)'}`, color: smtpTestResult.ok ? '#4ade80' : '#f87171' }}>
                          {smtpTestResult.ok ? '✓ ' : '✗ '}{smtpTestResult.msg}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
            </>}

          </div>
        )}

        {/* ── Overview / Dashboard Tab ─────────────────────────────────── */}
        {tab === 'overview' && (
          <div>

            {/* ── Location stats ── */}
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Locations</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, marginBottom: 32 }}>
              {[
                { label: 'Total',          value: stats?.total,       color: '#f1f5f9', bg: 'rgba(255,255,255,0.04)',   border: 'rgba(255,255,255,0.08)' },
                { label: 'Active',         value: stats?.active,      color: '#4ade80', bg: 'rgba(74,222,128,0.07)',   border: 'rgba(74,222,128,0.18)' },
                { label: 'Idle (3+ days)', value: stats?.idle,        color: '#facc15', bg: 'rgba(250,204,21,0.07)',  border: 'rgba(250,204,21,0.18)' },
                { label: 'Expired (7+ d)', value: stats?.expired,     color: '#f87171', bg: 'rgba(248,113,113,0.07)', border: 'rgba(248,113,113,0.18)' },
                { label: 'Uninstalled',    value: stats?.uninstalled, color: '#4b5563', bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.06)' },
              ].map(c => (
                <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '20px 22px' }}>
                  <div style={{ fontSize: 34, fontWeight: 800, color: c.color, letterSpacing: '-0.03em', lineHeight: 1 }}>
                    {stats ? (c.value ?? 0) : '—'}
                  </div>
                  <div style={{ fontSize: 12, color: '#4b5563', marginTop: 8, fontWeight: 500 }}>{c.label}</div>
                </div>
              ))}
            </div>

            {/* ── Revenue / Billing stats ── */}
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Revenue</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, marginBottom: 32 }}>
              {[
                { label: 'Monthly Revenue', value: billingSummary ? `$${billingSummary.revenue}` : '—', color: '#34d399', bg: 'rgba(52,211,153,0.07)',  border: 'rgba(52,211,153,0.2)' },
                { label: 'Active Plans',    value: billingSummary?.active   ?? '—',                     color: '#4ade80', bg: 'rgba(74,222,128,0.07)',  border: 'rgba(74,222,128,0.18)' },
                { label: 'Trial',           value: billingSummary?.trial    ?? '—',                     color: '#60a5fa', bg: 'rgba(96,165,250,0.07)',  border: 'rgba(96,165,250,0.18)' },
                { label: 'Past Due',        value: billingSummary?.pastDue  ?? '—',                     color: '#f87171', bg: 'rgba(248,113,113,0.07)', border: 'rgba(248,113,113,0.18)' },
                { label: 'Cancelled',       value: billingSummary?.cancelled ?? '—',                    color: '#4b5563', bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.06)' },
              ].map(c => (
                <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '20px 22px' }}>
                  <div style={{ fontSize: 34, fontWeight: 800, color: c.color, letterSpacing: '-0.03em', lineHeight: 1 }}>
                    {c.value}
                  </div>
                  <div style={{ fontSize: 12, color: '#4b5563', marginTop: 8, fontWeight: 500 }}>{c.label}</div>
                </div>
              ))}
            </div>

            {/* ── Quick links ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 32 }}>
              {[
                { key: 'locations',   label: 'Manage Locations',  icon: '📍', desc: `${stats?.total ?? 0} registered` },
                { key: 'billing',     label: 'Billing',           icon: '💳', desc: `$${billingSummary?.revenue ?? 0} MRR` },
                { key: 'brain',       label: 'Shared Brains',     icon: '🧠', desc: 'Knowledge bases' },
                { key: 'users-roles', label: 'Users & Roles',     icon: '👥', desc: 'Permissions' },
                { key: 'tool-access', label: 'Tool Access',       icon: '🔧', desc: 'Per-location tools' },
                { key: 'plan-tiers',  label: 'Plan Tiers',        icon: '🏅', desc: 'Feature gating' },
                { key: 'logs',        label: 'Activity Logs',     icon: '📋', desc: 'Recent events' },
              ].map(item => (
                <button
                  key={item.key}
                  onClick={() => setTab(item.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: 12, padding: '14px 16px', cursor: 'pointer', transition: 'all .15s',
                    color: 'inherit',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.1)'; e.currentTarget.style.borderColor = 'rgba(124,58,237,0.3)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; }}
                >
                  <span style={{ fontSize: 20 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb' }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2 }}>{item.desc}</div>
                  </div>
                </button>
              ))}
            </div>

            {/* ── Recent activity ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Recent Activity</p>
              <button onClick={() => setTab('logs')} style={{ fontSize: 12, color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>View all →</button>
            </div>
            <LogTable logs={logs.slice(0, 12)} getLocationName={getLocationName} />
          </div>
        )}

        {/* ── Locations Tab ────────────────────────────────────────────── */}
        {tab === 'locations' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ color: '#fff', margin: 0, fontSize: 16 }}>
                All Locations {loading ? '…' : `(${locations.length})`}
              </h3>
              {expandedId && (
                <p style={{ margin: '4px 0 0', color: '#9ca3af', fontSize: 12 }}>
                  {getLocationLabel(expandedId)}
                </p>
              )}
              <button onClick={loadLocations} style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>↻ Reload</button>
            </div>

            <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 600 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#9ca3af', textAlign: 'left' }}>
                    {['Location', 'Status', 'Integrations', 'Last Active', 'Installed', 'Actions'].map((h) => (
                      <th key={h} style={{ padding: '10px 14px', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {locations.map((loc) => {
                    const locationName = loc.name || getLocationName(loc.locationId);
                    const locationLabel = getLocationLabel(loc.locationId);
                    return (
                    <>
                      <tr
                        key={loc.locationId}
                        onClick={() => loadDetail(loc.locationId)}
                        style={{ borderBottom: '1px solid #222', cursor: 'pointer', background: expandedId === loc.locationId ? '#1e1e2e' : 'transparent' }}
                      >
                        <td style={{ padding: '10px 14px' }}>
                          <LocationIdentity locationId={loc.locationId} name={locationName} />
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <StatusBadge status={loc.status === 'uninstalled' ? 'uninstalled' : loc.tokenStatus || 'none'} />
                        </td>
                        <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                          {loc.integrations ?? '—'}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                          {relTime(loc.lastActive)}
                          {loc.tokenIdleDays > 0 && (
                            <span style={{ marginLeft: 6, color: '#facc15', fontSize: 11 }}>
                              ({loc.tokenIdleDays}d idle)
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: 12 }}>
                          {loc.installedAt ? new Date(loc.installedAt).toLocaleDateString() : '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <ActionBtn
                              title="Refresh connection"
                              icon="↻"
                              color="#7c3aed"
                              onClick={() => doAction(`/admin/locations/${loc.locationId}/refresh`, `Refreshed ${locationLabel}`)}
                            />
                            {loc.status === 'uninstalled' ? (
                              <ActionBtn
                                title="Restore location"
                                icon="⟳"
                                color="#059669"
                                onClick={() => doAction(`/admin/locations/${loc.locationId}/restore`, `Restored ${locationLabel}`)}
                              />
                            ) : (
                              <ActionBtn
                                title="Revoke token (force reconnect)"
                                icon="✕"
                                color="#dc2626"
                                onClick={() => doAction(`/admin/locations/${loc.locationId}/revoke`, `Token revoked for ${locationLabel}`)}
                              />
                            )}
                            <ActionBtn
                              title="Manage user roles"
                              icon="👥"
                              color="#f59e0b"
                              onClick={() => {
                                setRolesLocationId(loc.locationId);
                                setRolesUsers([]);
                                setTab('users-roles');
                                loadUsersForLocation(loc.locationId);
                              }}
                            />
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {expandedId === loc.locationId && detailData[loc.locationId] && (
                        <tr key={`${loc.locationId}-detail`}>
                          <td colSpan={6} style={{ padding: '0 14px 14px', background: '#111' }}>
                            <DetailPanel
                              data={detailData[loc.locationId]}
                              troubleshoot={troubleshootData[loc.locationId]}
                              workflowRunLogs={workflowRunLogs[loc.locationId] || []}
                              taskLogs={taskLogs[loc.locationId] || []}
                              locationId={loc.locationId}
                              locationName={locationName}
                              adminKey={adminKey}
                              onClearConnection={(cat) => clearConnection(loc.locationId, cat)}
                              onDeleteWorkflow={(id, name) => deleteWorkflow(loc.locationId, id, name)}
                              onEditWorkflow={(wf) => editWorkflow(loc.locationId, wf)}
                              onEditConnection={(cat, cfg) => editConnection(loc.locationId, cat, cfg)}
                              onToggleToolShared={(category, shared) => toggleToolShared(loc.locationId, category, shared)}
                            />
                          </td>
                        </tr>
                      )}
                    </>
                    );
                  })}
                  {locations.length === 0 && !loading && (
                    <tr>
                      <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                        No locations registered yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Chat Personas Tab ────────────────────────────────────────── */}
        {tab === 'personas' && (
          <div>
            {/* Sub-tab bar */}
            <div style={{ display:'flex', gap:0, borderBottom:'1px solid #1f2937', marginBottom:28 }}>
              {[{ id:'brain', label:'Brain' }, { id:'personas', label:'Chat Personas' }].map(t => (
                <button key={t.id} onClick={() => setPersonasSubTab(t.id)} style={{
                  background:'none', border:'none',
                  borderBottom: personasSubTab === t.id ? '2px solid #7c3aed' : '2px solid transparent',
                  color: personasSubTab === t.id ? '#a78bfa' : '#6b7280',
                  padding:'10px 20px', fontSize:14, fontWeight: personasSubTab === t.id ? 600 : 400,
                  cursor:'pointer', marginBottom:-1,
                }}>{t.label}</button>
              ))}
            </div>
            {personasSubTab === 'personas' && <div>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
              <div>
                <h2 style={{ margin:0, fontSize:15, fontWeight:700, color:'#f1f5f9' }}>Chat Personas</h2>
                <p style={{ margin:'4px 0 0', fontSize:12, color:'#6b7280' }}>Create AI personas users chat with. Each persona gets a personality, knowledge content, and an AI-polished system prompt.</p>
              </div>
              <button
                onClick={() => { setPersonaForm({ name:'', description:'', avatar:'🧑‍💼', personality:'', content:'', assignedTo:'__all__', assignedLocations:[], status:'draft', webhookEnabled:false, webhookUrl:'' }); setPersonaWebhookTest(null); setPersonaModal('create'); }}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:8, background:'rgba(124,58,237,0.2)', border:'1px solid rgba(124,58,237,0.4)', color:'#a78bfa', cursor:'pointer', fontSize:13, fontWeight:600 }}
              >+ New Persona</button>
            </div>

            {personasLoading ? (
              <div style={{ textAlign:'center', padding:40, color:'#6b7280' }}>Loading…</div>
            ) : personas.length === 0 ? (
              <div style={{ textAlign:'center', padding:60, color:'#4b5563' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🎭</div>
                <p style={{ margin:0, fontSize:14 }}>No personas yet.</p>
                <p style={{ margin:'6px 0 0', fontSize:12 }}>Create one to give your users a custom AI personality to chat with.</p>
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:16 }}>
                {personas.map(p => (
                  <div key={p.personaId} style={{ background:'#0e1623', border:'1px solid #1e2a3a', borderRadius:12, padding:20, display:'flex', flexDirection:'column', gap:12 }}>
                    {/* Top row */}
                    <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                      <div style={{ fontSize:32, flexShrink:0 }}>{p.avatar || '🧑‍💼'}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                          <span style={{ fontWeight:700, fontSize:14, color:'#f1f5f9' }}>{p.name}</span>
                          <span style={{
                            fontSize:10, padding:'2px 8px', borderRadius:10, fontWeight:600,
                            background: p.status === 'active' ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
                            border: p.status === 'active' ? '1px solid rgba(16,185,129,0.35)' : '1px solid rgba(255,255,255,0.1)',
                            color: p.status === 'active' ? '#34d399' : '#6b7280',
                          }}>{p.status === 'active' ? 'Active' : 'Draft'}</span>
                          <span style={{ fontSize:10, color:'#4b5563', marginLeft:'auto' }}>
                            {p.assignedTo === '__all__' ? 'All locations' : `${(p.assignedLocations||[]).length} location(s)`}
                          </span>
                        </div>
                        {p.description && <p style={{ margin:'4px 0 0', fontSize:12, color:'#9ca3af' }}>{p.description}</p>}
                      </div>
                    </div>

                    {/* Personality preview */}
                    {p.systemPrompt ? (
                      <div style={{ background:'rgba(99,102,241,0.07)', border:'1px solid rgba(99,102,241,0.2)', borderRadius:8, padding:'8px 10px' }}>
                        <p style={{ margin:'0 0 3px', fontSize:10, color:'#6366f1', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>AI-Improved Prompt</p>
                        <p style={{ margin:0, fontSize:11, color:'#9ca3af', lineHeight:1.5, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical' }}>{p.systemPrompt}</p>
                      </div>
                    ) : p.personality ? (
                      <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:8, padding:'8px 10px' }}>
                        <p style={{ margin:'0 0 3px', fontSize:10, color:'#6b7280', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>Personality</p>
                        <p style={{ margin:0, fontSize:11, color:'#9ca3af', lineHeight:1.5, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>{p.personality}</p>
                      </div>
                    ) : null}

                    {/* Actions */}
                    <div style={{ display:'flex', gap:8, marginTop:'auto' }}>
                      <button
                        onClick={() => { setPersonaForm({ ...p, assignedLocations: p.assignedLocations || [], webhookEnabled: p.webhookEnabled || false, webhookUrl: p.webhookUrl || '' }); setPersonaWebhookTest(null); setPersonaModal(p); }}
                        style={{ flex:1, padding:'7px 0', borderRadius:7, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'#d1d5db', cursor:'pointer', fontSize:12 }}
                      >Edit</button>
                      <button
                        onClick={async () => {
                          setPersonaImproving(p.personaId);
                          const d = await adminFetch(`/admin/personas/${p.personaId}/improve`, { method:'POST', adminKey });
                          setPersonaImproving(null);
                          if (d.success) { loadPersonas(); } else alert(d.error || 'Improve failed');
                        }}
                        disabled={personaImproving === p.personaId || !p.personality}
                        style={{ flex:1, padding:'7px 0', borderRadius:7, background:'rgba(99,102,241,0.12)', border:'1px solid rgba(99,102,241,0.3)', color: p.personality ? '#a5b4fc' : '#4b5563', cursor: p.personality ? 'pointer' : 'not-allowed', fontSize:12 }}
                      >{personaImproving === p.personaId ? 'Improving…' : '✨ Improve'}</button>
                      <button
                        onClick={async () => {
                          const newStatus = p.status === 'active' ? 'draft' : 'active';
                          await adminFetch(`/admin/personas/${p.personaId}`, { method:'PUT', adminKey, body:{ status: newStatus } });
                          loadPersonas();
                        }}
                        style={{ padding:'7px 10px', borderRadius:7, background: p.status === 'active' ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)', border: p.status === 'active' ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.08)', color: p.status === 'active' ? '#34d399' : '#6b7280', cursor:'pointer', fontSize:12 }}
                        title={p.status === 'active' ? 'Deactivate' : 'Activate'}
                      >{p.status === 'active' ? '⏸' : '▶'}</button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Delete persona "${p.name}"?`)) return;
                          await adminFetch(`/admin/personas/${p.personaId}`, { method:'DELETE', adminKey });
                          loadPersonas();
                        }}
                        style={{ padding:'7px 10px', borderRadius:7, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', color:'#f87171', cursor:'pointer', fontSize:12 }}
                        title="Delete"
                      >✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Create / Edit Modal */}
            {personaModal && (
              <div onClick={() => setPersonaModal(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', backdropFilter:'blur(4px)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
                <div onClick={e => e.stopPropagation()} style={{ width:'100%', maxWidth:560, maxHeight:'90vh', overflowY:'auto', background:'#0e1623', border:'1px solid #1e2a3a', borderRadius:16, boxShadow:'0 24px 64px rgba(0,0,0,0.6)' }}>
                  {/* Modal header */}
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid #1e2a3a' }}>
                    <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:'#f1f5f9' }}>{personaModal === 'create' ? 'New Persona' : `Edit — ${personaModal.name}`}</h3>
                    <button onClick={() => setPersonaModal(null)} style={{ background:'none', border:'none', color:'#6b7280', cursor:'pointer', fontSize:16 }}>✕</button>
                  </div>

                  {/* Form */}
                  <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14 }}>
                    {/* Avatar + Name row */}
                    <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
                      <div style={{ flexShrink:0 }}>
                        <label style={bdLabel}>Avatar</label>
                        <input value={personaForm.avatar} onChange={e => setPersonaForm(f => ({ ...f, avatar: e.target.value }))}
                          style={{ ...bdInput, width:60, textAlign:'center', fontSize:20, marginBottom:0 }} placeholder="🧑" />
                      </div>
                      <div style={{ flex:1 }}>
                        <label style={bdLabel}>Name *</label>
                        <input value={personaForm.name} onChange={e => setPersonaForm(f => ({ ...f, name: e.target.value }))}
                          style={{ ...bdInput, marginBottom:0 }} placeholder="e.g. Alex Johnson" />
                      </div>
                    </div>

                    <div>
                      <label style={bdLabel}>Description</label>
                      <input value={personaForm.description} onChange={e => setPersonaForm(f => ({ ...f, description: e.target.value }))}
                        style={{ ...bdInput, marginBottom:0 }} placeholder="Sales coach, customer support expert…" />
                    </div>

                    <div>
                      <label style={bdLabel}>Personality / Background</label>
                      <p style={{ margin:'0 0 6px', fontSize:11, color:'#4b5563' }}>Describe this person — their tone, style, expertise, and how they speak. Click "Improve with AI" to turn this into a polished system prompt.</p>
                      <textarea value={personaForm.personality} onChange={e => setPersonaForm(f => ({ ...f, personality: e.target.value }))}
                        rows={4} style={{ ...bdInput, resize:'vertical', marginBottom:0 }}
                        placeholder="Alex is a warm, direct sales coach who has closed hundreds of deals. He speaks in short sentences, uses analogies, and always ends with a clear call to action…" />
                    </div>

                    <div>
                      <label style={bdLabel}>Knowledge Content</label>
                      <p style={{ margin:'0 0 6px', fontSize:11, color:'#4b5563' }}>Facts, expertise areas, product knowledge, or scripts the persona should know. Injected before brain context.</p>
                      <textarea value={personaForm.content} onChange={e => setPersonaForm(f => ({ ...f, content: e.target.value }))}
                        rows={4} style={{ ...bdInput, resize:'vertical', marginBottom:0 }}
                        placeholder="Our flagship product is X. Common objections: price (response: ROI pays back in 60 days), timing (response: every day you wait costs you…)" />
                    </div>

                    {/* AI-improved prompt preview */}
                    {(personaModal !== 'create' && personaModal.systemPrompt) && (
                      <div style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.2)', borderRadius:8, padding:12 }}>
                        <p style={{ margin:'0 0 6px', fontSize:11, color:'#6366f1', fontWeight:600 }}>AI-Improved System Prompt (read-only preview)</p>
                        <p style={{ margin:0, fontSize:11, color:'#9ca3af', lineHeight:1.6, whiteSpace:'pre-wrap' }}>{personaModal.systemPrompt}</p>
                      </div>
                    )}

                    {/* Assignment */}
                    <div>
                      <label style={bdLabel}>Assign To</label>
                      <div style={{ display:'flex', gap:8 }}>
                        {[['__all__','All Locations'],['specific','Specific Locations']].map(([v, label]) => (
                          <button key={v} onClick={() => setPersonaForm(f => ({ ...f, assignedTo: v }))}
                            style={{ flex:1, padding:'8px 0', borderRadius:7, border:'1px solid', cursor:'pointer', fontSize:12, fontWeight:500,
                              background: personaForm.assignedTo === v ? 'rgba(124,58,237,0.2)' : 'transparent',
                              borderColor: personaForm.assignedTo === v ? 'rgba(124,58,237,0.5)' : '#1e2a3a',
                              color: personaForm.assignedTo === v ? '#a78bfa' : '#6b7280',
                            }}
                          >{label}</button>
                        ))}
                      </div>
                      {personaForm.assignedTo === 'specific' && (
                        <div style={{ marginTop:8 }}>
                          <input
                            placeholder="Paste location IDs, comma-separated"
                            value={(personaForm.assignedLocations || []).join(', ')}
                            onChange={e => setPersonaForm(f => ({ ...f, assignedLocations: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                            style={{ ...bdInput, marginBottom:0 }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Status */}
                    <div>
                      <label style={bdLabel}>Status</label>
                      <div style={{ display:'flex', gap:8 }}>
                        {[['draft','Draft'],['active','Active']].map(([v, label]) => (
                          <button key={v} onClick={() => setPersonaForm(f => ({ ...f, status: v }))}
                            style={{ flex:1, padding:'8px 0', borderRadius:7, border:'1px solid', cursor:'pointer', fontSize:12, fontWeight:500,
                              background: personaForm.status === v ? (v === 'active' ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)') : 'transparent',
                              borderColor: personaForm.status === v ? (v === 'active' ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.15)') : '#1e2a3a',
                              color: personaForm.status === v ? (v === 'active' ? '#34d399' : '#9ca3af') : '#6b7280',
                            }}
                          >{label}</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ── External Data Connection section ── */}
                  <div style={{ padding:'0 20px 4px' }}>
                    <div style={{ borderTop:'1px solid #1e2a3a', paddingTop:16, marginTop:4 }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                        <label style={{ ...bdLabel, margin:0 }}>🔗 External Data Connection</label>
                        <label style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer' }}>
                          <input type="checkbox" checked={!!personaForm.webhookEnabled}
                            onChange={e => setPersonaForm(f => ({ ...f, webhookEnabled: e.target.checked }))} />
                          <span style={{ fontSize:12, color: personaForm.webhookEnabled ? '#34d399' : '#6b7280' }}>
                            {personaForm.webhookEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </label>
                      </div>

                      {/* Flow diagram */}
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:14, padding:'8px 10px', background:'rgba(0,0,0,0.2)', borderRadius:6, flexWrap:'wrap' }}>
                        <span style={{ fontSize:11, color:'#4b5563' }}>User message</span>
                        <span style={{ fontSize:11, color:'#374151' }}>→</span>
                        <span style={{ fontSize:11, color:'#a5b4fc' }}>POST to your URL</span>
                        <span style={{ fontSize:11, color:'#374151' }}>→</span>
                        <span style={{ fontSize:11, color:'#4b5563' }}>your tool returns data</span>
                        <span style={{ fontSize:11, color:'#374151' }}>→</span>
                        <span style={{ fontSize:11, color:'#34d399' }}>AI uses it to reply</span>
                      </div>

                      {/* Outbound URL */}
                      <div style={{ marginBottom:12 }}>
                        <label style={{ ...bdLabel, fontSize:11 }}>Your endpoint URL</label>
                        <p style={{ margin:'0 0 6px', fontSize:11, color:'#4b5563' }}>
                          When a user sends a message, we POST <code style={{ color:'#a5b4fc' }}>{"{ message, personaId, locationId, conversationId, history }"}</code> here. Return any JSON and it becomes context for the AI reply.
                        </p>
                        <input value={personaForm.webhookUrl}
                          onChange={e => setPersonaForm(f => ({ ...f, webhookUrl: e.target.value }))}
                          placeholder="https://your-tool.com/endpoint"
                          style={{ width:'100%', background:'#0d1117', border:'1px solid #1e2a3a', borderRadius:6, color:'#e5e7eb', padding:'7px 10px', fontSize:12, boxSizing:'border-box' }} />
                      </div>

                      {/* Test button */}
                      {personaModal !== 'create' && personaForm.webhookUrl && (
                        <div style={{ marginBottom:14 }}>
                          <button
                            disabled={personaWebhookTest?.loading}
                            onClick={async () => {
                              setPersonaWebhookTest({ loading: true, result: null });
                              const r = await adminFetch(`/admin/personas/${personaModal.personaId}/test-webhook`, { method:'POST', adminKey });
                              setPersonaWebhookTest({ loading: false, result: r });
                            }}
                            style={{ background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.35)', borderRadius:6, color:'#a5b4fc', padding:'6px 14px', cursor:'pointer', fontSize:12 }}
                          >{personaWebhookTest?.loading ? 'Testing…' : '⚡ Send Test'}</button>
                          {personaWebhookTest?.result && (
                            <div style={{ marginTop:8, padding:'8px 10px', borderRadius:6, background: personaWebhookTest.result.success ? 'rgba(16,185,129,0.08)' : 'rgba(220,38,38,0.08)', border:`1px solid ${personaWebhookTest.result.success ? 'rgba(16,185,129,0.2)' : 'rgba(220,38,38,0.2)'}`, fontSize:11, color: personaWebhookTest.result.success ? '#34d399' : '#f87171' }}>
                              {personaWebhookTest.result.success ? `✓ HTTP ${personaWebhookTest.result.status} — your endpoint received the message` : `✗ ${personaWebhookTest.result.error || 'Failed to reach endpoint'}`}
                              {personaWebhookTest.result.response && (
                                <pre style={{ margin:'6px 0 0', fontSize:10, color:'#9ca3af', whiteSpace:'pre-wrap', maxHeight:80, overflow:'auto' }}>{typeof personaWebhookTest.result.response === 'object' ? JSON.stringify(personaWebhookTest.result.response, null, 2) : String(personaWebhookTest.result.response)}</pre>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Inbound endpoint */}
                      {personaModal !== 'create' && personaModal.inboundToken && (
                        <div>
                          <label style={{ ...bdLabel, fontSize:11 }}>Push data to this persona</label>
                          <p style={{ margin:'0 0 6px', fontSize:11, color:'#4b5563' }}>
                            External tools can POST any JSON here at any time. The data is stored and injected as context in every chat with this persona until replaced.
                          </p>
                          <div style={{ background:'rgba(0,0,0,0.3)', border:'1px solid #1e2a3a', borderRadius:6, padding:'10px 12px' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                              <span style={{ fontSize:10, color:'#4b5563', flexShrink:0 }}>POST</span>
                              <code style={{ fontSize:11, color:'#34d399', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                {(typeof window !== 'undefined' ? window.location.origin : '')}/integrations/persona/{personaModal.inboundToken}
                              </code>
                              <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/integrations/persona/${personaModal.inboundToken}`)}
                                style={{ fontSize:10, padding:'2px 8px', borderRadius:5, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'#9ca3af', cursor:'pointer', flexShrink:0 }}>Copy</button>
                            </div>
                            <div style={{ fontSize:10, color:'#374151' }}>Body: any JSON — e.g. <code style={{ color:'#6b7280' }}>{"{ \"order\": \"ORD-123\", \"status\": \"shipped\" }"}</code></div>
                            {personaModal.lastInboundAt && (
                              <div style={{ fontSize:10, color:'#4b5563', marginTop:4 }}>Last received: {new Date(personaModal.lastInboundAt).toLocaleString()}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Modal footer */}
                  <div style={{ display:'flex', gap:8, padding:'12px 20px 20px', justifyContent:'flex-end' }}>
                    <button onClick={() => setPersonaModal(null)} style={bdBtnS}>Cancel</button>
                    <button
                      disabled={personaSaving}
                      onClick={async () => {
                        if (!personaForm.name.trim()) return alert('Name is required');
                        setPersonaSaving(true);
                        if (personaModal === 'create') {
                          await adminFetch('/admin/personas', { method:'POST', adminKey, body: personaForm });
                        } else {
                          await adminFetch(`/admin/personas/${personaModal.personaId}`, { method:'PUT', adminKey, body: personaForm });
                        }
                        setPersonaSaving(false);
                        setPersonaModal(null);
                        loadPersonas();
                      }}
                      style={{ ...bdBtnP, opacity: personaSaving ? 0.6 : 1 }}
                    >{personaSaving ? 'Saving…' : personaModal === 'create' ? 'Create Persona' : 'Save Changes'}</button>
                  </div>
                </div>
              </div>
            )}
          </div>}
          </div>
        )}

        {/* ── Integrations Tab ─────────────────────────────────────────── */}
        {tab === 'integrations' && (() => {
          const host = typeof window !== 'undefined' ? window.location.origin : '';
          const TYPE_COLORS = { webhook: { bg:'rgba(16,185,129,0.12)', border:'rgba(16,185,129,0.3)', color:'#34d399' }, api_key: { bg:'rgba(99,102,241,0.12)', border:'rgba(99,102,241,0.3)', color:'#a5b4fc' }, our_api: { bg:'rgba(245,158,11,0.12)', border:'rgba(245,158,11,0.3)', color:'#fbbf24' } };
          const TYPE_LABELS = { webhook:'Webhook', api_key:'API Key', our_api:'Our API' };
          const TYPE_ICONS  = { webhook:'🪝', api_key:'🔑', our_api:'⚡' };

          // Group by clientName
          const folders = {};
          integrations.forEach(i => { if (!folders[i.clientName]) folders[i.clientName] = []; folders[i.clientName].push(i); });
          const clientNames = Object.keys(folders).sort();

          const copyBtn = (text, label) => (
            <button onClick={() => navigator.clipboard.writeText(text)}
              style={{ fontSize:10, padding:'2px 8px', borderRadius:5, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'#9ca3af', cursor:'pointer' }}
              title="Copy">{label || 'Copy'}</button>
          );

          const INT_FORM_BLANK = { clientName:'', name:'', type:'webhook', apiKey:'', endpoint:'', method:'GET', headers:'', allowQuery:false, assignedTo:'__all__', assignedLocations:[], status:'inactive' };

          return (
            <div>
              {/* Sub-tab bar */}
              <div style={{ display:'flex', gap:0, borderBottom:'1px solid #1f2937', marginBottom:28 }}>
                {[
                  { id:'integrations', label:'Integrations' },
                  { id:'tool-access',  label:'Tool Access'  },
                  { id:'beta-lab',     label:'Beta Lab'     },
                ].map(t => (
                  <button key={t.id} onClick={() => setIntegrationsSubTab(t.id)} style={{
                    background:'none', border:'none',
                    borderBottom: integrationsSubTab === t.id ? '2px solid #7c3aed' : '2px solid transparent',
                    color: integrationsSubTab === t.id ? '#a78bfa' : '#6b7280',
                    padding:'10px 20px', fontSize:14, fontWeight: integrationsSubTab === t.id ? 600 : 400,
                    cursor:'pointer', marginBottom:-1,
                  }}>{t.label}</button>
                ))}
              </div>

              {integrationsSubTab === 'integrations' && <>
              {/* Header */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
                <div>
                  <h2 style={{ margin:0, fontSize:15, fontWeight:700, color:'#f1f5f9' }}>All Integrations</h2>
                  <p style={{ margin:'4px 0 0', fontSize:12, color:'#6b7280' }}>All tools in one place — GHL built-ins and 3rd-party connections. Use Tool Access to control what each location can see.</p>
                </div>
                <button onClick={() => { setIntForm({ ...INT_FORM_BLANK }); setIntModal('create'); }}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:8, background:'rgba(124,58,237,0.2)', border:'1px solid rgba(124,58,237,0.4)', color:'#a78bfa', cursor:'pointer', fontSize:13, fontWeight:600 }}>
                  + New Integration
                </button>
              </div>

              {/* ── Built-in GHL Tools section ── */}
              {builtinTools.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
                    <span style={{ color:'#9ca3af', fontSize:12, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em' }}>GHL Built-in Tools</span>
                    <div style={{ flex:1, height:1, background:'#1e1e1e' }} />
                    <span style={{ fontSize:11, color:'#4b5563' }}>Visibility controlled in Tool Access</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:8 }}>
                    {builtinTools.map(tool => (
                      <div key={tool.key} style={{ background:'#111', border:'1px solid #1e1e1e', borderRadius:8, padding:'10px 14px', display:'flex', alignItems:'flex-start', gap:10 }}>
                        <span style={{ fontSize:20, lineHeight:1, flexShrink:0 }}>{tool.icon || '🔧'}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ color:'#e5e7eb', fontWeight:600, fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{tool.label || tool.key}</div>
                          {tool.description && <div style={{ color:'#4b5563', fontSize:11, marginTop:2, lineHeight:1.4 }}>{tool.description}</div>}
                          <div style={{ marginTop:6, display:'flex', gap:4, flexWrap:'wrap' }}>
                            {(tool.toolNames || []).slice(0, 4).map(t => (
                              <span key={t} style={{ background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:3, padding:'1px 6px', fontSize:10, color:'#60a5fa', fontFamily:'monospace' }}>{t}</span>
                            ))}
                            {(tool.toolCount || 0) > 4 && <span style={{ color:'#4b5563', fontSize:10 }}>+{tool.toolCount - 4}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── 3rd-Party section header ── */}
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
                <span style={{ color:'#9ca3af', fontSize:12, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em' }}>3rd-Party Connections</span>
                <div style={{ flex:1, height:1, background:'#1e1e1e' }} />
              </div>

              {/* Type legend */}
              <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' }}>
                {Object.entries(TYPE_LABELS).map(([k, v]) => {
                  const c = TYPE_COLORS[k];
                  return <span key={k} style={{ fontSize:11, padding:'3px 10px', borderRadius:10, background:c.bg, border:`1px solid ${c.border}`, color:c.color }}>{TYPE_ICONS[k]} {v}</span>;
                })}
                <span style={{ fontSize:11, color:'#4b5563', alignSelf:'center', marginLeft:4 }}>· Webhook & Our API: 3rd party pushes data to you · API Key: you call their endpoint</span>
              </div>

              {intLoading ? (
                <div style={{ textAlign:'center', padding:40, color:'#6b7280' }}>Loading…</div>
              ) : integrations.length === 0 ? (
                <div style={{ textAlign:'center', padding:60, color:'#4b5563' }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🔌</div>
                  <p style={{ margin:0, fontSize:14 }}>No integrations yet.</p>
                  <p style={{ margin:'6px 0 0', fontSize:12 }}>Create one to connect a 3rd-party tool to your user chats.</p>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  {clientNames.map(clientName => {
                    const items = folders[clientName];
                    const open  = intOpenFolders[clientName] !== false;
                    return (
                      <div key={clientName} style={{ background:'#0e1623', border:'1px solid #1e2a3a', borderRadius:12, overflow:'hidden' }}>
                        {/* Folder header */}
                        <div onClick={() => setIntOpenFolders(f => ({ ...f, [clientName]: !open }))}
                          style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', cursor:'pointer', background: open ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                          <span style={{ fontSize:14 }}>{open ? '📂' : '📁'}</span>
                          <span style={{ fontWeight:700, fontSize:13, color:'#f1f5f9', flex:1 }}>{clientName}</span>
                          <span style={{ fontSize:11, color:'#4b5563' }}>{items.length} integration{items.length !== 1 ? 's' : ''}</span>
                          <span style={{ fontSize:12, color:'#4b5563' }}>{open ? '▲' : '▼'}</span>
                        </div>

                        {/* Integrations in this folder */}
                        {open && (
                          <div style={{ borderTop:'1px solid #1e2a3a' }}>
                            {items.map((integ, idx) => {
                              const tc = TYPE_COLORS[integ.type] || TYPE_COLORS.webhook;
                              const testR = intTestResult[integ.integrationId];
                              const discoverR = intDiscoverResult[integ.integrationId];
                              const linkedPersonaNames = (integ.personaIds||[]).map(pid => personas.find(p=>p.personaId===pid)?.name).filter(Boolean);
                              return (
                                <div key={integ.integrationId} style={{ padding:'14px 16px', borderBottom: idx < items.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                                  <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                                    <div style={{ flex:1, minWidth:0 }}>
                                      {/* Title row */}
                                      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                                        <span style={{ fontSize:13, fontWeight:700, color:'#f1f5f9' }}>{integ.name}</span>
                                        <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, background:tc.bg, border:`1px solid ${tc.border}`, color:tc.color }}>{TYPE_ICONS[integ.type]} {TYPE_LABELS[integ.type]}</span>
                                        <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, background: integ.status === 'active' ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.05)', border: integ.status === 'active' ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.08)', color: integ.status === 'active' ? '#34d399' : '#6b7280' }}>{integ.status === 'active' ? 'Active' : 'Inactive'}</span>
                                        {integ.lastReceivedAt && <span style={{ fontSize:10, color:'#4b5563' }}>Last data: {Math.round((Date.now() - integ.lastReceivedAt) / 60000)}m ago</span>}
                                      </div>

                                      {/* Webhook URL */}
                                      {integ.type === 'webhook' && integ.webhookToken && (
                                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                                          <span style={{ fontSize:11, color:'#6b7280', flexShrink:0 }}>Webhook URL:</span>
                                          <code style={{ fontSize:11, color:'#a5b4fc', background:'rgba(0,0,0,0.3)', padding:'2px 8px', borderRadius:5, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{host}/integrations/webhook/{integ.webhookToken}</code>
                                          {copyBtn(`${host}/integrations/webhook/${integ.webhookToken}`, 'Copy URL')}
                                        </div>
                                      )}

                                      {/* Our API */}
                                      {integ.type === 'our_api' && integ.ourApiKey && (
                                        <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:6 }}>
                                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                            <span style={{ fontSize:11, color:'#6b7280', flexShrink:0 }}>POST data:</span>
                                            <code style={{ fontSize:11, color:'#fbbf24', background:'rgba(0,0,0,0.3)', padding:'2px 8px', borderRadius:5, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{host}/integrations/api/{integ.ourApiKey}</code>
                                            {copyBtn(`${host}/integrations/api/${integ.ourApiKey}`, 'Copy')}
                                          </div>
                                          {integ.allowQuery && (
                                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                              <span style={{ fontSize:11, color:'#6b7280', flexShrink:0 }}>Query AI:</span>
                                              <code style={{ fontSize:11, color:'#fbbf24', background:'rgba(0,0,0,0.3)', padding:'2px 8px', borderRadius:5, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{host}/integrations/api/{integ.ourApiKey}?q=your+question</code>
                                              {copyBtn(`${host}/integrations/api/${integ.ourApiKey}?q=`, 'Copy')}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* API Key type — endpoint */}
                                      {integ.type === 'api_key' && integ.endpoint && (
                                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                                          <span style={{ fontSize:11, color:'#6b7280', flexShrink:0 }}>{integ.method || 'GET'}</span>
                                          <code style={{ fontSize:11, color:'#a5b4fc', background:'rgba(0,0,0,0.3)', padding:'2px 8px', borderRadius:5, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{integ.endpoint}</code>
                                        </div>
                                      )}

                                      {/* Last payload preview */}
                                      {integ.lastPayload && (
                                        <details style={{ marginTop:4 }}>
                                          <summary style={{ fontSize:11, color:'#4b5563', cursor:'pointer' }}>Last received payload ▸</summary>
                                          <pre style={{ fontSize:10, color:'#6b7280', background:'rgba(0,0,0,0.3)', borderRadius:6, padding:'8px 10px', marginTop:6, overflow:'auto', maxHeight:120 }}>
                                            {typeof integ.lastPayload === 'string' ? integ.lastPayload : JSON.stringify(JSON.parse(integ.lastPayload || '{}'), null, 2)}
                                          </pre>
                                        </details>
                                      )}

                                      {/* Test result */}
                                      {testR && (
                                        <div style={{ marginTop:6, padding:'6px 10px', borderRadius:6, background: testR.success ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: testR.success ? '1px solid rgba(16,185,129,0.25)' : '1px solid rgba(239,68,68,0.25)' }}>
                                          <span style={{ fontSize:11, color: testR.success ? '#34d399' : '#f87171' }}>{testR.success ? '✓' : '✗'} HTTP {testR.status}</span>
                                          {testR.response && <pre style={{ margin:'4px 0 0', fontSize:10, color:'#6b7280', overflow:'auto', maxHeight:80 }}>{typeof testR.response === 'object' ? JSON.stringify(testR.response, null, 2) : testR.response}</pre>}
                                        </div>
                                      )}

                                      {/* Discover result */}
                                      {discoverR && (
                                        <div style={{ marginTop:6, padding:'6px 10px', borderRadius:6, background: discoverR.success ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)', border: discoverR.success ? '1px solid rgba(245,158,11,0.25)' : '1px solid rgba(239,68,68,0.25)' }}>
                                          <span style={{ fontSize:11, color: discoverR.success ? '#fbbf24' : '#f87171' }}>{discoverR.success ? `🔍 Found ${discoverR.found} endpoints from "${discoverR.title || discoverR.specUrl}"` : `✗ ${discoverR.error}`}</span>
                                        </div>
                                      )}

                                      {/* MCP tools */}
                                      {integ.mcpTools?.length > 0 && (
                                        <details style={{ marginTop:6 }}>
                                          <summary style={{ fontSize:11, color:'#fbbf24', cursor:'pointer' }}>⚡ {integ.mcpTools.length} MCP Tools (auto-discovered) ▸</summary>
                                          <div style={{ marginTop:6, display:'flex', flexWrap:'wrap', gap:4 }}>
                                            {integ.mcpTools.map(t => (
                                              <span key={t.name} style={{ fontSize:10, padding:'2px 7px', borderRadius:6, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', color:'#d97706' }} title={t.description}>{t.name}</span>
                                            ))}
                                          </div>
                                        </details>
                                      )}

                                      {/* Linked personas */}
                                      {linkedPersonaNames.length > 0 && (
                                        <div style={{ marginTop:6, display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
                                          <span style={{ fontSize:10, color:'#4b5563' }}>Linked to:</span>
                                          {linkedPersonaNames.map(n => <span key={n} style={{ fontSize:10, padding:'2px 8px', borderRadius:10, background:'rgba(99,102,241,0.1)', border:'1px solid rgba(99,102,241,0.25)', color:'#a5b4fc' }}>{n}</span>)}
                                        </div>
                                      )}
                                    </div>

                                    {/* Action buttons */}
                                    <div style={{ display:'flex', flexDirection:'column', gap:6, flexShrink:0 }}>
                                      <button onClick={() => { setIntForm({ clientName:integ.clientName, name:integ.name, type:integ.type, apiKey:integ.apiKey||'', endpoint:integ.endpoint||'', method:integ.method||'GET', headers:integ.headers||'', allowQuery:!!integ.allowQuery, assignedTo:integ.assignedTo||'__all__', assignedLocations:integ.assignedLocations||[], personaIds:integ.personaIds||[], status:integ.status }); setIntModal(integ); }}
                                        style={{ padding:'5px 10px', borderRadius:6, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'#d1d5db', cursor:'pointer', fontSize:11 }}>Edit</button>
                                      {integ.type === 'api_key' && (
                                        <button onClick={async () => { setIntTesting(integ.integrationId); const r = await adminFetch(`/admin/integrations/${integ.integrationId}/test`, { method:'POST', adminKey }); setIntTestResult(p => ({ ...p, [integ.integrationId]: r })); setIntTesting(null); }}
                                          disabled={intTesting === integ.integrationId}
                                          style={{ padding:'5px 10px', borderRadius:6, background:'rgba(99,102,241,0.1)', border:'1px solid rgba(99,102,241,0.25)', color:'#a5b4fc', cursor:'pointer', fontSize:11 }}>{intTesting === integ.integrationId ? '…' : 'Test'}</button>
                                      )}
                                      <button onClick={async () => { const ns = integ.status === 'active' ? 'inactive' : 'active'; await adminFetch(`/admin/integrations/${integ.integrationId}`, { method:'PUT', adminKey, body:{ status:ns } }); loadIntegrations(); }}
                                        style={{ padding:'5px 10px', borderRadius:6, background: integ.status === 'active' ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.04)', border: integ.status === 'active' ? '1px solid rgba(16,185,129,0.25)' : '1px solid rgba(255,255,255,0.08)', color: integ.status === 'active' ? '#34d399' : '#6b7280', cursor:'pointer', fontSize:11 }}>{integ.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                                      {integ.type === 'api_key' && (
                                        <button onClick={async () => { setIntDiscovering(integ.integrationId); const r = await adminFetch(`/admin/integrations/${integ.integrationId}/discover`, { method:'POST', adminKey }); setIntDiscoverResult(p => ({ ...p, [integ.integrationId]: r })); setIntDiscovering(null); loadIntegrations(); }}
                                          disabled={intDiscovering === integ.integrationId}
                                          style={{ padding:'5px 10px', borderRadius:6, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.25)', color:'#fbbf24', cursor:'pointer', fontSize:11 }}
                                          title="Auto-discover OpenAPI spec and convert to MCP tools">{intDiscovering === integ.integrationId ? '…' : `🔍 ${integ.mcpTools?.length > 0 ? `${integ.mcpTools.length} tools` : 'Discover'}`}</button>
                                      )}
                                      <button onClick={async () => { if (!window.confirm(`Delete "${integ.name}"?`)) return; await adminFetch(`/admin/integrations/${integ.integrationId}`, { method:'DELETE', adminKey }); loadIntegrations(); }}
                                        style={{ padding:'5px 10px', borderRadius:6, background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', color:'#f87171', cursor:'pointer', fontSize:11 }}>Delete</button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Create / Edit Modal */}
              {intModal && (
                <div onClick={() => setIntModal(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(4px)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
                  <div onClick={e => e.stopPropagation()} style={{ width:'100%', maxWidth:520, maxHeight:'92vh', overflowY:'auto', background:'#0e1623', border:'1px solid #1e2a3a', borderRadius:16, boxShadow:'0 24px 64px rgba(0,0,0,0.7)' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid #1e2a3a' }}>
                      <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:'#f1f5f9' }}>{intModal === 'create' ? 'New Integration' : `Edit — ${intModal.name}`}</h3>
                      <button onClick={() => setIntModal(null)} style={{ background:'none', border:'none', color:'#6b7280', cursor:'pointer', fontSize:16 }}>✕</button>
                    </div>

                    <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14 }}>
                      {/* Client / Folder */}
                      <div>
                        <label style={bdLabel}>Client Name (Folder) *</label>
                        <input value={intForm.clientName} onChange={e => setIntForm(f => ({ ...f, clientName: e.target.value }))}
                          style={{ ...bdInput, marginBottom:0 }} placeholder="e.g. Acme Corp" list="existing-clients" />
                        <datalist id="existing-clients">{[...new Set(integrations.map(i => i.clientName))].map(c => <option key={c} value={c} />)}</datalist>
                        <p style={{ margin:'4px 0 0', fontSize:11, color:'#4b5563' }}>Integrations under the same client name share a folder.</p>
                      </div>

                      <div>
                        <label style={bdLabel}>Integration Name *</label>
                        <input value={intForm.name} onChange={e => setIntForm(f => ({ ...f, name: e.target.value }))}
                          style={{ ...bdInput, marginBottom:0 }} placeholder="e.g. HubSpot, Zapier, Salesforce" />
                      </div>

                      {/* Type selector */}
                      <div>
                        <label style={bdLabel}>Connection Type</label>
                        <div style={{ display:'flex', gap:8 }}>
                          {[['webhook','🪝 Webhook','3rd party pushes to you'],['api_key','🔑 API Key','You call their API'],['our_api','⚡ Our API','3rd party calls your endpoint']].map(([v, label, hint]) => (
                            <button key={v} onClick={() => setIntForm(f => ({ ...f, type: v }))}
                              style={{ flex:1, padding:'8px 4px', borderRadius:7, border:'1px solid', cursor:'pointer', fontSize:11, fontWeight:500, textAlign:'center', transition:'all .12s',
                                background: intForm.type === v ? TYPE_COLORS[v].bg : 'transparent',
                                borderColor: intForm.type === v ? TYPE_COLORS[v].border : '#1e2a3a',
                                color: intForm.type === v ? TYPE_COLORS[v].color : '#6b7280',
                              }}>
                              <div>{label}</div><div style={{ fontSize:9, marginTop:2, opacity:0.7 }}>{hint}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Type-specific fields */}
                      {intForm.type === 'api_key' && (
                        <>
                          <div>
                            <label style={bdLabel}>API Key</label>
                            <input value={intForm.apiKey} onChange={e => setIntForm(f => ({ ...f, apiKey: e.target.value }))}
                              type="password" style={{ ...bdInput, marginBottom:0 }} placeholder="their-api-key-here" />
                          </div>
                          <div>
                            <label style={bdLabel}>Endpoint URL</label>
                            <input value={intForm.endpoint} onChange={e => setIntForm(f => ({ ...f, endpoint: e.target.value }))}
                              style={{ ...bdInput, marginBottom:0 }} placeholder="https://api.example.com/data" />
                          </div>
                          <div style={{ display:'flex', gap:10 }}>
                            <div style={{ flex:1 }}>
                              <label style={bdLabel}>Method</label>
                              <select value={intForm.method} onChange={e => setIntForm(f => ({ ...f, method: e.target.value }))}
                                style={{ ...bdInput, marginBottom:0 }}>
                                <option>GET</option><option>POST</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label style={bdLabel}>Extra Headers (JSON)</label>
                            <textarea value={intForm.headers} onChange={e => setIntForm(f => ({ ...f, headers: e.target.value }))}
                              rows={2} style={{ ...bdInput, resize:'vertical', marginBottom:0 }} placeholder='{"X-Custom-Header": "value"}' />
                          </div>
                        </>
                      )}

                      {intForm.type === 'webhook' && (
                        <div style={{ padding:'10px 14px', borderRadius:8, background:'rgba(16,185,129,0.06)', border:'1px solid rgba(16,185,129,0.2)' }}>
                          <p style={{ margin:0, fontSize:12, color:'#6b7280', lineHeight:1.6 }}>After saving, a unique webhook URL will be generated. Paste it into Zapier, GHL, or any 3rd party tool. When data is received, it automatically becomes available in user chats.</p>
                        </div>
                      )}

                      {intForm.type === 'our_api' && (
                        <>
                          <div style={{ padding:'10px 14px', borderRadius:8, background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.2)' }}>
                            <p style={{ margin:0, fontSize:12, color:'#6b7280', lineHeight:1.6 }}>A unique API key and endpoint will be generated for you to share with the 3rd party. They can POST data to it or GET AI responses.</p>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                            <input type="checkbox" id="allowQuery" checked={intForm.allowQuery} onChange={e => setIntForm(f => ({ ...f, allowQuery: e.target.checked }))} />
                            <label htmlFor="allowQuery" style={{ fontSize:12, color:'#9ca3af', cursor:'pointer' }}>Allow AI queries via <code style={{ color:'#fbbf24', fontSize:11 }}>?q=question</code> (GET endpoint returns AI response)</label>
                          </div>
                        </>
                      )}

                      {/* Assignment */}
                      <div>
                        <label style={bdLabel}>Assign To</label>
                        <div style={{ display:'flex', gap:8 }}>
                          {[['__all__','All Locations'],['specific','Specific Locations']].map(([v, label]) => (
                            <button key={v} onClick={() => setIntForm(f => ({ ...f, assignedTo: v }))}
                              style={{ flex:1, padding:'8px 0', borderRadius:7, border:'1px solid', cursor:'pointer', fontSize:12, fontWeight:500,
                                background: intForm.assignedTo === v ? 'rgba(124,58,237,0.2)' : 'transparent',
                                borderColor: intForm.assignedTo === v ? 'rgba(124,58,237,0.5)' : '#1e2a3a',
                                color: intForm.assignedTo === v ? '#a78bfa' : '#6b7280',
                              }}>{label}</button>
                          ))}
                        </div>
                        {intForm.assignedTo === 'specific' && (
                          <input style={{ ...bdInput, marginTop:8, marginBottom:0 }}
                            placeholder="Location IDs, comma-separated"
                            value={(intForm.assignedLocations || []).join(', ')}
                            onChange={e => setIntForm(f => ({ ...f, assignedLocations: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} />
                        )}
                      </div>

                      {/* Link to Personas */}
                      {personas.length > 0 && (
                        <div>
                          <label style={bdLabel}>Link to Chat Personas</label>
                          <p style={{ margin:'0 0 8px', fontSize:11, color:'#4b5563' }}>When linked, this integration's data and tools are available to the persona during chats. For API Key integrations with discovered tools, Claude will call them live.</p>
                          <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:140, overflowY:'auto' }}>
                            {personas.filter(p => p.status === 'active').map(p => {
                              const linked = (intForm.personaIds || []).includes(p.personaId);
                              return (
                                <label key={p.personaId} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:8, cursor:'pointer', background: linked ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)', border:`1px solid ${linked ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.07)'}` }}>
                                  <input type="checkbox" checked={linked}
                                    onChange={e => setIntForm(f => ({ ...f, personaIds: e.target.checked ? [...(f.personaIds||[]), p.personaId] : (f.personaIds||[]).filter(id => id !== p.personaId) }))} />
                                  <span style={{ fontSize:16 }}>{p.avatar}</span>
                                  <span style={{ fontSize:13, color: linked ? '#a5b4fc' : '#9ca3af' }}>{p.name}</span>
                                  {p.description && <span style={{ fontSize:11, color:'#4b5563', marginLeft:'auto' }}>{p.description.slice(0,40)}</span>}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Status */}
                      <div>
                        <label style={bdLabel}>Status</label>
                        <div style={{ display:'flex', gap:8 }}>
                          {[['inactive','Inactive'],['active','Active']].map(([v, label]) => (
                            <button key={v} onClick={() => setIntForm(f => ({ ...f, status: v }))}
                              style={{ flex:1, padding:'8px 0', borderRadius:7, border:'1px solid', cursor:'pointer', fontSize:12, fontWeight:500,
                                background: intForm.status === v ? (v === 'active' ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)') : 'transparent',
                                borderColor: intForm.status === v ? (v === 'active' ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.15)') : '#1e2a3a',
                                color: intForm.status === v ? (v === 'active' ? '#34d399' : '#9ca3af') : '#6b7280',
                              }}>{label}</button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{ display:'flex', gap:8, padding:'12px 20px 20px', justifyContent:'flex-end' }}>
                      <button onClick={() => setIntModal(null)} style={bdBtnS}>Cancel</button>
                      <button disabled={intSaving}
                        onClick={async () => {
                          if (!intForm.clientName.trim()) return alert('Client name required');
                          if (!intForm.name.trim()) return alert('Integration name required');
                          setIntSaving(true);
                          if (intModal === 'create') {
                            await adminFetch('/admin/integrations', { method:'POST', adminKey, body: intForm });
                          } else {
                            await adminFetch(`/admin/integrations/${intModal.integrationId}`, { method:'PUT', adminKey, body: intForm });
                          }
                          setIntSaving(false);
                          setIntModal(null);
                          loadIntegrations();
                        }}
                        style={{ ...bdBtnP, opacity: intSaving ? 0.6 : 1 }}
                      >{intSaving ? 'Saving…' : intModal === 'create' ? 'Create Integration' : 'Save Changes'}</button>
                    </div>
                  </div>
                </div>
              )}
              </>}
            </div>
          );
        })()}

        {/* ── Logs Tab ─────────────────────────────────────────────────── */}
        {tab === 'logs' && (
          <div>
            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                placeholder="Filter by locationId…"
                value={logFilter.locationId}
                onChange={(e) => setLogFilter((f) => ({ ...f, locationId: e.target.value }))}
                style={{ padding: '8px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, width: '100%', maxWidth: 260 }}
              />
              <select
                value={logFilter.event}
                onChange={(e) => setLogFilter((f) => ({ ...f, event: e.target.value }))}
                style={{ padding: '8px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13 }}
              >
                <option value="">All events</option>
                {[
                  'install','uninstall','restore',
                  'tool_connect','tool_disconnect','tool_reconnect',
                  'claude_task','voice_task',
                  'workflow_save','workflow_delete','workflow_trigger',
                  'admin_refresh','admin_revoke','admin_workflow_edit','admin_workflow_delete',
                  'admin_tool_visibility_update',
                  'admin_connection_clear','admin_connection_update','admin_run_task',
                  'app_settings_update','billing_update',
                ].map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
              <button onClick={loadLogs} style={{ padding: '8px 16px', background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, cursor: 'pointer' }}>
                Apply
              </button>
              <span style={{ color: '#6b7280', fontSize: 13 }}>
                {loading ? 'Loading…' : `${logs.length} entries`}
              </span>
            </div>
            <LogTable logs={logs} getLocationName={getLocationName} />
          </div>
        )}

        {/* ── Billing Tab ──────────────────────────────────────────────── */}
        {tab === 'billing' && (
          <div>
            {/* Sub-tab bar */}
            <div style={{ display:'flex', gap:0, borderBottom:'1px solid #1f2937', marginBottom:28 }}>
              {[{ id:'billing', label:'Billing' }, { id:'plan-tiers', label:'Plan Tiers' }].map(t => (
                <button key={t.id} onClick={() => setPlansSubTab(t.id)} style={{
                  background:'none', border:'none',
                  borderBottom: plansSubTab === t.id ? '2px solid #7c3aed' : '2px solid transparent',
                  color: plansSubTab === t.id ? '#a78bfa' : '#6b7280',
                  padding:'10px 20px', fontSize:14, fontWeight: plansSubTab === t.id ? 600 : 400,
                  cursor:'pointer', marginBottom:-1,
                }}>{t.label}</button>
              ))}
            </div>
            {plansSubTab === 'billing' && <div>
            {/* Summary cards */}
            {billingSummary && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10, marginBottom: 20 }}>
                {[
                  { label: 'Total',      value: billingSummary.total,     color: '#e5e7eb' },
                  { label: 'Active',     value: billingSummary.active,    color: '#4ade80' },
                  { label: 'Trial',      value: billingSummary.trial,     color: '#60a5fa' },
                  { label: 'Past Due',   value: billingSummary.pastDue,   color: '#f87171' },
                  { label: 'Cancelled',  value: billingSummary.cancelled, color: '#6b7280' },
                  { label: 'MRR (USD)',  value: `$${billingSummary.revenue}`, color: '#34d399' },
                ].map(c => (
                  <div key={c.label} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: c.color }}>{c.value ?? '—'}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>{c.label}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ color: '#fff', margin: 0, fontSize: 16 }}>
                All Billing Records {billingLoading ? '…' : `(${billingRecords.length})`}
              </h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setBillingModal({ type: 'new-subscription', locationId: '', data: {} })}
                  style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}
                >
                  + New Record
                </button>
                <button onClick={loadBilling} style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>↻ Reload</button>
              </div>
            </div>

            <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#9ca3af', textAlign: 'left' }}>
                    {['Location', 'Plan', 'Status', 'Amount', 'Payment Method', 'Next Renewal', 'Invoices', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {billingRecords.map(rec => {
                    const statusColor = { active: '#4ade80', trial: '#60a5fa', past_due: '#f87171', cancelled: '#6b7280', suspended: '#fb923c' }[rec.status] || '#9ca3af';
                    const locationName = getLocationName(rec.locationId);
                    const locationLabel = getLocationLabel(rec.locationId, 'Unknown Location');
                    return (
                      <>
                        <tr
                          key={rec.locationId}
                          onClick={() => setBillingExpanded(billingExpanded === rec.locationId ? null : rec.locationId)}
                          style={{ borderBottom: '1px solid #222', cursor: 'pointer', background: billingExpanded === rec.locationId ? '#1a1a2a' : 'transparent' }}
                        >
                          <td style={{ padding: '10px 14px' }}>
                            <LocationIdentity locationId={rec.locationId} name={locationName} fallbackName="Unknown Location" />
                          </td>
                          <td style={{ padding: '10px 14px', textTransform: 'capitalize', color: '#e5e7eb' }}>{rec.plan}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ color: statusColor, fontWeight: 600, fontSize: 12 }}>{rec.status?.replace('_', ' ')}</span>
                          </td>
                          <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                            {rec.amount > 0 ? `$${rec.amount}/${rec.interval || 'mo'}` : 'Free'}
                          </td>
                          <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: 12 }}>
                            {rec.paymentMethod ? `${rec.paymentMethod.brand} ••••${rec.paymentMethod.last4}` : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: 12 }}>
                            {rec.currentPeriodEnd ? new Date(rec.currentPeriodEnd).toLocaleDateString() : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                            {(rec.invoices || []).length}
                          </td>
                          <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: 5 }}>
                              <ActionBtn icon="✏️" title="Edit subscription" color="#7c3aed"
                                onClick={() => setBillingModal({ type: 'edit-subscription', locationId: rec.locationId, data: rec })} />
                              <ActionBtn icon="＋" title="Add invoice" color="#059669"
                                onClick={() => setBillingModal({ type: 'add-invoice', locationId: rec.locationId, data: {} })} />
                              <ActionBtn icon="🗑" title="Delete all billing data" color="#dc2626"
                                onClick={() => {
                                  confirmToast(`Delete ALL billing data for ${locationLabel}?`, async () => {
                                    await adminFetch(`/admin/billing/${rec.locationId}`, { method: 'DELETE', adminKey });
                                    toast.success(`Deleted billing for ${locationLabel}`);
                                    loadBilling();
                                  });
                                }} />
                            </div>
                          </td>
                        </tr>

                        {/* Invoice rows */}
                        {billingExpanded === rec.locationId && (
                          <tr key={`${rec.locationId}-inv`}>
                            <td colSpan={8} style={{ padding: '0 14px 14px', background: '#111' }}>
                              <div style={{ marginTop: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                  <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invoices</span>
                                  <button
                                    onClick={() => setBillingModal({ type: 'add-invoice', locationId: rec.locationId, data: {} })}
                                    style={{ background: 'none', border: '1px solid #059669', borderRadius: 6, color: '#059669', padding: '2px 10px', cursor: 'pointer', fontSize: 12 }}
                                  >+ Add Invoice</button>
                                </div>
                                {(rec.invoices || []).length === 0 ? (
                                  <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>No invoices yet.</p>
                                ) : (
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                    <thead>
                                      <tr style={{ color: '#6b7280', textAlign: 'left' }}>
                                        {['ID', 'Description', 'Amount', 'Status', 'Date', 'Actions'].map(h => (
                                          <th key={h} style={{ padding: '4px 10px', fontWeight: 500 }}>{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(rec.invoices || []).map(inv => {
                                        const invColor = { paid: '#4ade80', pending: '#facc15', overdue: '#f87171', refunded: '#6b7280', void: '#6b7280' }[inv.status] || '#9ca3af';
                                        return (
                                          <tr key={inv.id} style={{ borderTop: '1px solid #1e1e1e' }}>
                                            <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: '#6b7280' }}>{inv.id?.slice(-8)}</td>
                                            <td style={{ padding: '5px 10px', color: '#e5e7eb' }}>{inv.description}</td>
                                            <td style={{ padding: '5px 10px', color: '#94a3b8' }}>${inv.amount}</td>
                                            <td style={{ padding: '5px 10px' }}>
                                              <span style={{ color: invColor, fontWeight: 600 }}>{inv.status}</span>
                                            </td>
                                            <td style={{ padding: '5px 10px', color: '#6b7280' }}>
                                              {inv.date ? new Date(inv.date).toLocaleDateString() : '—'}
                                            </td>
                                            <td style={{ padding: '5px 10px' }}>
                                              <div style={{ display: 'flex', gap: 4 }}>
                                                <ActionBtn icon="✏️" title="Edit invoice" color="#7c3aed"
                                                  onClick={() => setBillingModal({ type: 'edit-invoice', locationId: rec.locationId, data: inv })} />
                                                {inv.status === 'paid' && (
                                                  <ActionBtn icon="↩" title="Refund" color="#f97316"
                                                    onClick={() => {
                                                      confirmToast(`Refund $${inv.amount} invoice?`, async () => {
                                                        await adminFetch(`/admin/billing/${rec.locationId}/refund/${inv.id}`, { method: 'POST', adminKey });
                                                        toast.success(`Refunded ${inv.id}`);
                                                        loadBilling();
                                                      });
                                                    }} />
                                                )}
                                                <ActionBtn icon="🗑" title="Delete invoice" color="#dc2626"
                                                  onClick={() => {
                                                    confirmToast('Delete this invoice?', async () => {
                                                      await adminFetch(`/admin/billing/${rec.locationId}/invoice/${inv.id}`, { method: 'DELETE', adminKey });
                                                      toast.success('Invoice deleted');
                                                      loadBilling();
                                                    });
                                                  }} />
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                                {rec.notes && (
                                  <p style={{ color: '#6b7280', fontSize: 12, marginTop: 8, fontStyle: 'italic' }}>📝 {rec.notes}</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {billingRecords.length === 0 && !billingLoading && (
                    <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>No billing records yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Billing Modal */}
            {billingModal && (
              <BillingModal
                modal={billingModal}
                adminKey={adminKey}
                getLocationName={getLocationName}
                getLocationLabel={getLocationLabel}
                onClose={() => setBillingModal(null)}
                onSaved={() => { setBillingModal(null); loadBilling(); toast.success('Saved'); }}
                onFlash={(msg) => msg.startsWith('✗') ? toast.error(msg.replace(/^✗\s*/, '')) : toast.info(msg.replace(/^✓\s*/, ''))}
              />
            )}
          </div>}

        {tab === 'billing' && plansSubTab === 'plan-tiers' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h3 style={{ color: '#fff', margin: '0 0 4px', fontSize: 16 }}>🏅 Plan Tiers</h3>
                <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>
                  Configure which integrations are available per tier. Assign tiers to locations via the Billing tab.
                </p>
              </div>
              <button onClick={loadTiers} style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>↻ Reload</button>
            </div>

            {tiersLoading && <p style={{ color: '#6b7280', fontSize: 13 }}>Loading tiers…</p>}

            {/* ── GHL Product source ── */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
              <select
                value={ghlProductsLocId}
                onChange={e => setGhlProductsLocId(e.target.value)}
                style={{ flex: 1, minWidth: 200, padding: '8px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: ghlProductsLocId ? '#fff' : '#6b7280', fontSize: 13 }}
              >
                <option value="">— Select a location to load GHL products —</option>
                {locations.map(l => (
                  <option key={l.locationId} value={l.locationId}>{getLocationLabel(l.locationId)}</option>
                ))}
              </select>
              <button
                disabled={!ghlProductsLocId || ghlProductsLoading}
                onClick={async () => {
                  setGhlProductsLoading(true);
                  try {
                    const data = await adminFetch(`/admin/ghl-products?locationId=${encodeURIComponent(ghlProductsLocId)}`, { adminKey });
                    if (data.success) { setGhlProducts(data.data); toast.success(`${data.data.length} GHL products loaded`); }
                    else toast.error(data.error || 'Failed');
                  } catch { toast.error('Request failed'); }
                  setGhlProductsLoading(false);
                }}
                style={{ padding: '8px 16px', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', opacity: (!ghlProductsLocId || ghlProductsLoading) ? 0.5 : 1 }}
              >
                {ghlProductsLoading ? 'Loading…' : '⬇ Load Products'}
              </button>
              {ghlProducts.length > 0 && (
                <span style={{ fontSize: 12, color: '#4ade80' }}>✓ {ghlProducts.length} products</span>
              )}
            </div>

            {tiers && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {['bronze', 'silver', 'gold', 'diamond'].map(tierKey => {
                  const tier = tiers[tierKey];
                  if (!tier) return null;
                  const tierColor = { bronze: '#cd7f32', silver: '#9ca3af', gold: '#fbbf24', diamond: '#a78bfa' }[tierKey];
                  return (
                    <div key={tierKey} style={{ background: '#1a1a1a', border: `1px solid ${tierColor}44`, borderRadius: 12, padding: 20 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 22 }}>{tier.icon}</span>
                            <span style={{ color: tierColor, fontWeight: 700, fontSize: 16 }}>{tier.name}</span>
                          </div>
                          <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>{tier.description}</p>
                        </div>
                        <button
                          onClick={() => setTierModal({ tier: tierKey, data: { ...tier } })}
                          style={{ background: 'none', border: `1px solid ${tierColor}55`, borderRadius: 6, color: tierColor, padding: '4px 12px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
                        >✏️ Edit</button>
                      </div>

                      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                        <div>
                          <p style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>Integrations</p>
                          <span style={{ color: tierColor, fontWeight: 700, fontSize: 18 }}>
                            {tier.integrationLimit === -1 ? '∞' : tier.integrationLimit}
                          </span>
                          <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 4 }}>{tier.integrationLimit === -1 ? 'unlimited' : 'max'}</span>
                        </div>
                        <div>
                          <p style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>Price</p>
                          <span style={{ color: '#e5e7eb', fontWeight: 700, fontSize: 18 }}>
                            {tier.price ? `$${tier.price}` : 'Free'}
                          </span>
                          {tier.price > 0 && <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 4 }}>/{tier.interval || 'mo'}</span>}
                        </div>
                      </div>
                      {tier.ghlProductName && (
                        <p style={{ color: '#6366f1', fontSize: 11, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                          🔗 <span>{tier.ghlProductName}</span>
                        </p>
                      )}

                      <div>
                        <p style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
                          Allowed Integrations
                        </p>
                        {tier.allowedIntegrations === null ? (
                          <span style={{ color: '#4ade80', fontSize: 12 }}>✓ All integrations</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {ALL_INTEGRATIONS.map(({ key, label, icon }) => {
                              const allowed = tier.allowedIntegrations?.includes(key);
                              return (
                                <span
                                  key={key}
                                  style={{
                                    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                                    background: allowed ? `${tierColor}22` : '#1e1e1e',
                                    color: allowed ? tierColor : '#4b5563',
                                    border: `1px solid ${allowed ? tierColor + '44' : '#2a2a2a'}`,
                                  }}
                                >
                                  {icon} {label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Allowed App Features — sourced from live tier.allowedFeatures */}
                      <div style={{ marginTop: 12 }}>
                        <p style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
                          App Features ({tier.allowedFeatures === null ? 'All' : (tier.allowedFeatures?.length || 0)}/{ALL_FEATURES_DEFAULT.length})
                        </p>
                        {tier.allowedFeatures === null ? (
                          <span style={{ color: '#4ade80', fontSize: 12 }}>✓ All tools unlocked</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {ALL_FEATURES_DEFAULT.map(f => {
                              const allowed = tier.allowedFeatures?.includes(f.key);
                              const requiredInt = FEATURE_INTEGRATION_MAP[f.key];
                              return (
                                <span key={f.key}
                                  title={requiredInt ? `Requires: ${requiredInt.join(' or ')}` : 'GHL native — no integration required'}
                                  style={{
                                    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                                    background: allowed ? `${tierColor}22` : '#1e1e1e',
                                    color: allowed ? tierColor : '#4b5563',
                                    border: `1px solid ${allowed ? tierColor + '44' : '#2a2a2a'}`,
                                  }}>
                                  {f.icon} {f.label}{requiredInt ? ' 🔗' : ''}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        <p style={{ color: '#4b5563', fontSize: 11, margin: '6px 0 0' }}>🔗 = requires a connected integration</p>
                      </div>

                      {/* GHL Product dropdown — shown directly on card when products are loaded */}
                      <div style={{ marginTop: 12, borderTop: `1px solid ${tierColor}22`, paddingTop: 12 }}>
                        <p style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>
                          GHL Product
                        </p>
                        {ghlProducts.length > 0 ? (
                          <>
                            <select
                              value={tier.ghlProductId || ''}
                              onChange={async e => {
                                const pid  = e.target.value;
                                const prod = ghlProducts.find(p => p.id === pid);
                                const upd  = { ghlProductId: pid || null, ghlProductName: prod?.name || null, ghlPriceId: null };
                                try {
                                  const res = await adminFetch(`/admin/plan-tiers/${tierKey}`, { method: 'POST', adminKey, body: upd });
                                  if (res.success) { setTiers(prev => ({ ...prev, [tierKey]: res.data })); toast.success(`${tier.name}: GHL product updated`); }
                                  else toast.error(res.error);
                                } catch { toast.error('Save failed'); }
                              }}
                              style={{ width: '100%', padding: '6px 10px', background: '#111', border: `1px solid ${tierColor}33`, borderRadius: 6, color: '#e5e7eb', fontSize: 12 }}
                            >
                              <option value="">— No product linked —</option>
                              {ghlProducts.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>

                            {/* Price variant dropdown — shown when a product is selected */}
                            {tier.ghlProductId && (() => {
                              const prod = ghlProducts.find(p => p.id === tier.ghlProductId);
                              if (!prod?.prices?.length) return null;
                              return (
                                <select
                                  value={tier.ghlPriceId || ''}
                                  onChange={async e => {
                                    const pid = e.target.value;
                                    const pr  = prod.prices.find(p => p.id === pid);
                                    const upd = {
                                      ghlPriceId: pid || null,
                                      price:      pr ? pr.amount : tier.price,
                                      interval:   pr?.recurring?.interval === 'year' ? 'yr' : 'mo',
                                    };
                                    try {
                                      const res = await adminFetch(`/admin/plan-tiers/${tierKey}`, { method: 'POST', adminKey, body: upd });
                                      if (res.success) { setTiers(prev => ({ ...prev, [tierKey]: res.data })); toast.success(`${tier.name}: price synced from GHL`); }
                                      else toast.error(res.error);
                                    } catch { toast.error('Save failed'); }
                                  }}
                                  style={{ width: '100%', marginTop: 6, padding: '6px 10px', background: '#111', border: `1px solid ${tierColor}33`, borderRadius: 6, color: '#e5e7eb', fontSize: 12 }}
                                >
                                  <option value="">— Select price variant —</option>
                                  {prod.prices.map(pr => (
                                    <option key={pr.id} value={pr.id}>
                                      {pr.name} — ${pr.amount}/{pr.recurring?.interval || 'mo'}
                                    </option>
                                  ))}
                                </select>
                              );
                            })()}
                          </>
                        ) : (
                          <p style={{ color: '#4b5563', fontSize: 12, margin: 0 }}>
                            {tier.ghlProductName
                              ? `🔗 ${tier.ghlProductName}`
                              : 'Select a location above to load products'}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Tier Edit Modal */}
            {tierModal && (
              <TierEditModal
                tierKey={tierModal.tier}
                data={tierModal.data}
                allIntegrations={ALL_INTEGRATIONS}
                adminKey={adminKey}
                onClose={() => setTierModal(null)}
                onSaved={(tierKey, saved) => {
                  setTierModal(null);
                  toast.success(`${saved.name} tier updated`);
                  setTiers(prev => ({ ...prev, [tierKey]: saved }));
                }}
                onFlash={(msg) => msg.startsWith('✗') ? toast.error(msg.replace(/^✗\s*/, '')) : toast.success(msg.replace(/^✓\s*/, ''))}
              />
            )}
          </div>
        )}
          </div>
        )}
        {/* ── Users & Roles Tab ─────────────────────────────────────── */}
        {tab === 'users-roles' && (
          <div>
            {/* Sub-tab bar */}
            <div style={{ display:'flex', gap:0, borderBottom:'1px solid #1f2937', marginBottom:28 }}>
              {[
                { id:'users-roles',   label:'Users & Roles'   },
                { id:'dashboard-cfg', label:'Admin Dashboard' },
                { id:'credentials',   label:'Credentials'     },
              ].map(t => (
                <button key={t.id} onClick={() => setAdminSubTab(t.id)} style={{
                  background:'none', border:'none',
                  borderBottom: adminSubTab === t.id ? '2px solid #7c3aed' : '2px solid transparent',
                  color: adminSubTab === t.id ? '#a78bfa' : '#6b7280',
                  padding:'10px 20px', fontSize:14, fontWeight: adminSubTab === t.id ? 600 : 400,
                  cursor:'pointer', marginBottom:-1,
                }}>{t.label}</button>
              ))}
            </div>

            {adminSubTab === 'users-roles' && <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ color: '#fff', margin: '0 0 4px', fontSize: 16 }}>👥 Users &amp; Roles</h3>
                <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>Create custom roles with fine-grained feature access, then assign them to users per location.</p>
              </div>
            </div>

            {/* ── Default User Role banner ── */}
            <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 10, padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ color: '#a5b4fc', fontWeight: 700, fontSize: 13, marginBottom: 3 }}>Default User Role — All Locations</div>
                <div style={{ color: '#6b7280', fontSize: 12 }}>Applied to every new user across all sub-locations. Controls what they can access in the app. You can override per-user below.</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  value={defaultRoleId}
                  onChange={e => setDefaultRoleId(e.target.value)}
                  style={{ background: '#111', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 7, color: '#e5e7eb', padding: '7px 12px', fontSize: 13, minWidth: 160 }}
                >
                  {[...BUILTIN_ROLES_DEFAULT, ...customRoles].map(r => (
                    <option key={r.id} value={r.id}>{r.name}{r.id === 'chats_only' ? ' (default)' : ''}</option>
                  ))}
                </select>
                <button
                  disabled={defaultRoleSaving}
                  onClick={async () => {
                    setDefaultRoleSaving(true);
                    const r = await adminFetch('/admin/default-role', { method: 'PUT', adminKey, body: { roleId: defaultRoleId } });
                    setDefaultRoleSaving(false);
                    if (r.success) toast.success(`Default role set to "${r.role?.name || defaultRoleId}" for all locations`);
                    else toast.error(r.error || 'Failed to save');
                  }}
                  style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 7, color: '#a5b4fc', padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: defaultRoleSaving ? 0.6 : 1, whiteSpace: 'nowrap' }}
                >{defaultRoleSaving ? 'Saving…' : 'Save Default'}</button>
              </div>
            </div>

            {/* Location picker */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={rolesLocationId}
                onChange={e => {
                  const id = e.target.value;
                  setRolesLocationId(id);
                  setRolesUsers([]);
                  setCustomRoles([]);
                  setBuiltinRoles(BUILTIN_ROLES_DEFAULT);
                  setAllFeatures(ALL_FEATURES_DEFAULT);
                  setLocationEnabledIntegrations(null);
                  if (id) loadUsersForLocation(id);
                }}
                style={{ flex: 1, minWidth: 240, background: '#111', border: '1px solid #333', borderRadius: 8, color: rolesLocationId ? '#e5e7eb' : '#6b7280', padding: '8px 12px', fontSize: 13 }}
              >
                <option value="">— Select a location —</option>
                {locations.filter(l => l.status !== 'uninstalled').map(l => (
                  <option key={l.locationId} value={l.locationId}>{getLocationLabel(l.locationId)}</option>
                ))}
              </select>
              <button onClick={() => loadUsersForLocation(rolesLocationId)} disabled={!rolesLocationId}
                style={{ background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', padding: '8px 20px', cursor: rolesLocationId ? 'pointer' : 'not-allowed', fontSize: 13, opacity: rolesLocationId ? 1 : 0.5 }}>
                Load
              </button>
              <button onClick={async () => {
                  if (!rolesLocationId) return;
                  setRolesSyncMsg('');
                  try {
                    const data = await adminFetch(`/admin/locations/${rolesLocationId}/users/sync`, { method: 'POST', adminKey });
                    if (data.success) { setRolesUsers(data.users || []); setRolesSyncMsg(`✓ Synced ${data.users?.length || 0} users`); }
                    else setRolesSyncMsg(`✗ ${data.error}`);
                  } catch { setRolesSyncMsg('✗ Sync failed'); }
                  setTimeout(() => setRolesSyncMsg(''), 3000);
                }} disabled={!rolesLocationId}
                style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '8px 14px', cursor: rolesLocationId ? 'pointer' : 'not-allowed', fontSize: 13, opacity: rolesLocationId ? 1 : 0.5 }}>
                ↻ Sync GHL
              </button>
              {rolesSyncMsg && <span style={{ color: rolesSyncMsg.startsWith('✓') ? '#4ade80' : '#f87171', fontSize: 13 }}>{rolesSyncMsg}</span>}
            </div>

            {rolesLocationId && (
              <>
                {/* Sub-tabs */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #222', paddingBottom: 0 }}>
                  {[{ key: 'users', label: '👤 Users' }, { key: 'roles', label: '🎭 Manage Roles' }].map(st => (
                    <button key={st.key} onClick={() => setRolesSubTab(st.key)}
                      style={{ padding: '8px 20px', background: 'none', border: 'none', borderBottom: rolesSubTab === st.key ? '2px solid #7c3aed' : '2px solid transparent', color: rolesSubTab === st.key ? '#a78bfa' : '#6b7280', cursor: 'pointer', fontSize: 13, fontWeight: rolesSubTab === st.key ? 600 : 400, marginBottom: -1 }}>
                      {st.label}
                    </button>
                  ))}
                </div>

                {/* ── Users sub-tab ── */}
                {rolesSubTab === 'users' && (
                  rolesLoading ? <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading…</p>
                  : rolesUsers.length > 0 ? (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #222' }}>
                            {['Name', 'Email', 'GHL Role', 'App Role', 'Synced'].map(h => (
                              <th key={h} style={{ padding: '8px 14px', color: '#6b7280', fontWeight: 600, fontSize: 11, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rolesUsers.map(u => {
                            const allRoleOptions = [
                              ...builtinRoles,
                              ...customRoles,
                            ];
                            const roleColors = { owner: '#a78bfa', admin: '#60a5fa', manager: '#34d399', member: '#9ca3af' };
                            const curColor = roleColors[u.role] || '#f59e0b';
                            return (
                              <tr key={u.userId} style={{ borderBottom: '1px solid #1a1a1a' }}>
                                <td style={{ padding: '10px 14px', color: '#e5e7eb' }}>{u.name || '—'}</td>
                                <td style={{ padding: '10px 14px', color: '#9ca3af' }}>{u.email || '—'}</td>
                                <td style={{ padding: '10px 14px', color: '#6b7280', textTransform: 'capitalize' }}>{u.ghlRole || '—'}</td>
                                <td style={{ padding: '10px 14px' }}>
                                  <select
                                    value={u.role || 'member'}
                                    disabled={rolesSaving[u.userId]}
                                    onChange={async (e) => {
                                      const newRole = e.target.value;
                                      setRolesSaving(prev => ({ ...prev, [u.userId]: true }));
                                      try {
                                        const data = await adminFetch(`/admin/locations/${rolesLocationId}/users/${u.userId}/role`, { method: 'POST', adminKey, body: { role: newRole } });
                                        if (data.success) { setRolesUsers(prev => prev.map(x => x.userId === u.userId ? { ...x, role: newRole } : x)); toast.success(`${u.name || u.userId} → ${newRole}`); }
                                        else toast.error(data.error);
                                      } catch { toast.error('Save failed'); }
                                      setRolesSaving(prev => ({ ...prev, [u.userId]: false }));
                                    }}
                                    style={{ background: '#111', border: '1px solid #333', borderRadius: 6, color: curColor, padding: '4px 8px', fontSize: 12, cursor: 'pointer', opacity: rolesSaving[u.userId] ? 0.5 : 1 }}
                                  >
                                    {allRoleOptions.map(r => (
                                      <option key={r.id} value={r.id}>{r.name}{r.builtin ? '' : ' ★'}</option>
                                    ))}
                                  </select>
                                </td>
                                <td style={{ padding: '10px 14px', color: '#4b5563', fontSize: 12 }}>
                                  {u.syncedAt ? new Date(u.syncedAt).toLocaleDateString() : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: 32, textAlign: 'center', color: '#4b5563' }}>
                      Click <strong style={{ color: '#6366f1' }}>Load</strong> above to fetch users, or <strong style={{ color: '#9ca3af' }}>Sync GHL</strong> to pull fresh from GoHighLevel.
                    </div>
                  )
                )}

                {/* ── Roles sub-tab ── */}
                {rolesSubTab === 'roles' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>
                        Built-in roles are read-only. Create custom roles with any combination of tools.
                      </p>
                      <button onClick={() => setRoleModal({ mode: 'create' })}
                        style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        + New Role
                      </button>
                    </div>

                    {/* Built-in roles */}
                    <p style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Built-in Roles</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 24 }}>
                      {builtinRoles.map(r => {
                        const roleColors = { owner: '#a78bfa', admin: '#60a5fa', manager: '#34d399', member: '#9ca3af' };
                        const color = roleColors[r.id] || '#6b7280';
                        return (
                          <div key={r.id} style={{ background: '#1a1a1a', border: `1px solid ${color}33`, borderRadius: 10, padding: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color, fontWeight: 700, fontSize: 14, textTransform: 'capitalize' }}>{r.name}</span>
                                <span style={{ background: '#111', color: '#4b5563', fontSize: 10, padding: '1px 7px', borderRadius: 8 }}>built-in</span>
                                {r.overridden && <span style={{ background: '#78350f', color: '#fbbf24', fontSize: 10, padding: '1px 7px', borderRadius: 8 }}>customized</span>}
                              </div>
                              <button onClick={() => setRoleModal({ mode: 'edit', role: r, isBuiltin: true })}
                                style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#9ca3af', padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>✏️ Edit</button>
                            </div>
                            {r.features.includes('*') ? (
                              <span style={{ color: '#4ade80', fontSize: 12 }}>✓ All features</span>
                            ) : (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {r.features.map(f => (
                                  <span key={f} style={{ background: `${color}15`, color, fontSize: 10, padding: '2px 7px', borderRadius: 6, border: `1px solid ${color}33` }}>{f.replace(/_/g, ' ')}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Custom roles */}
                    <p style={{ color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Custom Roles</p>
                    {customRoles.length === 0 ? (
                      <div style={{ background: '#111', border: '1px dashed #333', borderRadius: 10, padding: 24, textAlign: 'center', color: '#4b5563' }}>
                        No custom roles yet. Click <strong style={{ color: '#7c3aed' }}>+ New Role</strong> to create one.
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                        {customRoles.map(r => (
                          <div key={r.id} style={{ background: '#1a1a1a', border: '1px solid #f59e0b33', borderRadius: 10, padding: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 14 }}>{r.name}</span>
                                <span style={{ background: '#111', color: '#f59e0b', fontSize: 10, padding: '1px 7px', borderRadius: 8 }}>custom</span>
                                {r.tier && (
                                  <span style={{ background: `${TIER_COLORS[r.tier]}22`, color: TIER_COLORS[r.tier], fontSize: 10, padding: '1px 7px', borderRadius: 8, border: `1px solid ${TIER_COLORS[r.tier]}44` }}>
                                    {TIER_ICONS[r.tier]} {r.tier}
                                  </span>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button onClick={() => setRoleModal({ mode: 'edit', role: r })}
                                  style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#9ca3af', padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>✏️ Edit</button>
                                <button onClick={() => {
                                    confirmToast(`Delete role "${r.name}"?`, async () => {
                                      try {
                                        const data = await adminFetch(`/admin/locations/${rolesLocationId}/custom-roles/${r.id}`, { method: 'DELETE', adminKey });
                                        if (data.success) { setCustomRoles(prev => prev.filter(x => x.id !== r.id)); toast.success(`Role "${r.name}" deleted`); }
                                        else toast.error(data.error);
                                      } catch { toast.error('Delete failed'); }
                                    });
                                  }}
                                  style={{ background: 'none', border: '1px solid #dc262644', borderRadius: 6, color: '#f87171', padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>✕</button>
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {(r.features || []).length === 0
                                ? <span style={{ color: '#4b5563', fontSize: 12 }}>No features assigned</span>
                                : r.features.map(f => (
                                    <span key={f} style={{ background: '#f59e0b15', color: '#f59e0b', fontSize: 10, padding: '2px 7px', borderRadius: 6, border: '1px solid #f59e0b33' }}>{f.replace(/_/g, ' ')}</span>
                                  ))
                              }
                            </div>
                            <p style={{ color: '#4b5563', fontSize: 11, margin: '8px 0 0' }}>
                              {r.features?.length || 0} of {allFeatures.length} tools enabled
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── Role Editor Modal ── */}
            {roleModal && (
              <RoleEditorModal
                mode={roleModal.mode}
                role={roleModal.role}
                isBuiltin={roleModal.isBuiltin || false}
                allFeatures={allFeatures}
                adminKey={adminKey}
                locationId={rolesLocationId}
                locationLabel={getLocationLabel(rolesLocationId)}
                tiers={roleTiers}
                enabledIntegrations={locationEnabledIntegrations}
                onClose={() => setRoleModal(null)}
                onSaved={(saved, isNew) => {
                  setRoleModal(null);
                  if (saved.builtin) {
                    setBuiltinRoles(prev => prev.map(r => r.id === saved.id ? { ...saved, overridden: true } : r));
                  } else if (isNew) {
                    setCustomRoles(prev => [...prev, saved]);
                  } else {
                    setCustomRoles(prev => prev.map(r => r.id === saved.id ? saved : r));
                  }
                  toast.success(`Role "${saved.name}" ${isNew ? 'created' : 'updated'}`);
                }}
                onReset={(reset) => {
                  setRoleModal(null);
                  setBuiltinRoles(prev => prev.map(r => r.id === reset.id ? { ...reset, overridden: false } : r));
                  toast.success(`"${reset.name}" role reset to defaults`);
                }}
                onFlash={(msg) => msg.startsWith('✗') ? toast.error(msg.replace(/^✗\s*/, '')) : toast.success(msg.replace(/^✓\s*/, ''))}
              />
            )}
            </>}
          </div>
        )}

        {/* ── Tool Access Tab ──────────────────────────────────────────── */}
        {tab === 'integrations' && integrationsSubTab === 'tool-access' && (
          <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24 }}>
              <div>
                <h3 style={{ color: '#fff', margin: '0 0 4px', fontSize: 16 }}>🔧 Tool Access</h3>
                <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>
                  Control which integrations are visible to users at each location. Users can only see and configure tools you share here.
                </p>
              </div>
            </div>

            {/* Location picker + filter */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={toolAccessLocationId}
                onChange={e => {
                  const id = e.target.value;
                  setToolAccessLocationId(id);
                  setToolAccessItems([]);
                  setToolAccessThirdParty([]);
                  setToolAccessFilter('all');
                  if (id) loadToolAccess(id);
                }}
                style={{ flex: 1, minWidth: 240, background: '#111', border: '1px solid #333', borderRadius: 8, color: toolAccessLocationId ? '#e5e7eb' : '#6b7280', padding: '8px 12px', fontSize: 13 }}
              >
                <option value="">— Select a location —</option>
                {locations.filter(l => l.status !== 'uninstalled').map(l => (
                  <option key={l.locationId} value={l.locationId}>
                    {l.name || l.locationId}{l.name ? ` · ${l.locationId.slice(0, 10)}…` : ''}
                  </option>
                ))}
              </select>
              {toolAccessItems.length > 0 && (
                <select
                  value={toolAccessFilter}
                  onChange={e => setToolAccessFilter(e.target.value)}
                  style={{ background: '#111', border: '1px solid #333', borderRadius: 8, color: '#e5e7eb', padding: '8px 12px', fontSize: 13 }}
                >
                  <option value="all">All integrations</option>
                  <option value="shared">Shared only</option>
                  <option value="hidden">Hidden only</option>
                </select>
              )}
              {toolAccessLocationId && (
                <button
                  onClick={() => loadToolAccess(toolAccessLocationId)}
                  style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}
                >⟳ Refresh</button>
              )}
            </div>

            {/* Summary badges */}
            {(toolAccessItems.length > 0 || toolAccessThirdParty.length > 0) && (() => {
              const sharedCount = toolAccessItems.filter(i => i.shared).length;
              const connectedCount = toolAccessItems.filter(i => i.connected).length;
              return (
                <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
                  <span style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 20, padding: '4px 14px', fontSize: 12, color: '#4ade80', fontWeight: 600 }}>
                    {sharedCount} shared to users
                  </span>
                  <span style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 20, padding: '4px 14px', fontSize: 12, color: '#f87171', fontWeight: 600 }}>
                    {toolAccessItems.length - sharedCount} hidden
                  </span>
                  <span style={{ background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 20, padding: '4px 14px', fontSize: 12, color: '#60a5fa', fontWeight: 600 }}>
                    {connectedCount} connected
                  </span>
                  {toolAccessThirdParty.length > 0 && (
                    <span style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 20, padding: '4px 14px', fontSize: 12, color: '#a5b4fc', fontWeight: 600 }}>
                      {toolAccessThirdParty.length} 3rd-party active
                    </span>
                  )}
                </div>
              );
            })()}

            {/* GHL Tool Integration cards */}
            {!toolAccessLocationId ? (
              <div style={{ textAlign: 'center', padding: '48px 0', color: '#4b5563', fontSize: 14 }}>
                Select a location to manage its tool access.
              </div>
            ) : toolAccessLoading ? (
              <div style={{ textAlign: 'center', padding: '48px 0', color: '#6b7280', fontSize: 13 }}>Loading integrations…</div>
            ) : toolAccessItems.length === 0 && toolAccessThirdParty.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 0', color: '#4b5563', fontSize: 14 }}>No integrations found.</div>
            ) : (
              <>
                {/* ── Section: GHL / Built-in Tools ── */}
                {toolAccessItems.length > 0 && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>GHL Integrations</span>
                      <div style={{ flex: 1, height: 1, background: '#1e1e1e' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10, marginBottom: 28 }}>
                      {toolAccessItems
                        .filter(item => toolAccessFilter === 'all' || (toolAccessFilter === 'shared' ? item.shared : !item.shared))
                        .map(item => (
                          <div key={item.key} style={{
                            background: '#111',
                            border: `1px solid ${item.shared ? 'rgba(74,222,128,0.2)' : '#1e1e1e'}`,
                            borderRadius: 10, padding: '14px 16px',
                            display: 'flex', flexDirection: 'column', gap: 10,
                          }}>
                            {/* Top row: icon + name + badges */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                              <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{item.icon || '🔌'}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <span style={{ color: '#e5e7eb', fontWeight: 600, fontSize: 14 }}>{item.label || item.key}</span>
                                  {item.shared ? (
                                    <span style={{ background: '#16331f', color: '#4ade80', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>Shared</span>
                                  ) : (
                                    <span style={{ background: '#2d1b1b', color: '#f87171', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>Hidden</span>
                                  )}
                                  {item.connected && (
                                    <span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '1px 8px', borderRadius: 999, fontSize: 11 }}>Connected</span>
                                  )}
                                </div>
                                <p style={{ color: '#6b7280', fontSize: 12, margin: '4px 0 0', lineHeight: 1.4 }}>
                                  {item.description || ''}
                                </p>
                              </div>
                            </div>

                            {/* Tool count + names */}
                            {item.toolCount > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {(item.toolNames || []).map(t => (
                                  <span key={t} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, padding: '1px 7px', fontSize: 11, color: '#60a5fa', fontFamily: 'monospace' }}>{t}</span>
                                ))}
                                {!item.toolNames?.length && (
                                  <span style={{ color: '#4b5563', fontSize: 12 }}>{item.toolCount} tool{item.toolCount !== 1 ? 's' : ''}</span>
                                )}
                              </div>
                            )}

                            {/* Config preview */}
                            {item.connected && Object.keys(item.configPreview || {}).length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                {Object.entries(item.configPreview).map(([k, v]) => (
                                  <span key={k} style={{ background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 4, padding: '1px 8px', fontSize: 11, color: '#9ca3af' }}>
                                    <span style={{ color: '#4b5563' }}>{k}: </span>
                                    <span style={{ fontFamily: 'monospace' }}>{String(v)}</span>
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Action button */}
                            <div style={{ marginTop: 2 }}>
                              <button
                                onClick={() => toggleToolShared(toolAccessLocationId, item.key, !item.shared)}
                                style={{
                                  background: 'none',
                                  border: `1px solid ${item.shared ? 'rgba(220,38,38,0.4)' : 'rgba(22,101,52,0.5)'}`,
                                  borderRadius: 6, color: item.shared ? '#f87171' : '#4ade80',
                                  padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                }}
                              >
                                {item.shared ? 'Hide from Users' : 'Share to Users'}
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </>
                )}

                {/* ── Section: 3rd-Party Integrations ── */}
                {toolAccessThirdParty.length > 0 && (() => {
                  const TYPE_COLORS = { webhook: { bg:'rgba(99,102,241,0.15)', border:'rgba(99,102,241,0.4)', color:'#a5b4fc', label:'Webhook' }, api_key: { bg:'rgba(251,191,36,0.12)', border:'rgba(251,191,36,0.35)', color:'#fbbf24', label:'API Key' }, our_api: { bg:'rgba(34,197,94,0.12)', border:'rgba(34,197,94,0.35)', color:'#4ade80', label:'Our API' } };
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                        <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>3rd-Party Integrations</span>
                        <div style={{ flex: 1, height: 1, background: '#1e1e1e' }} />
                        <button
                          onClick={() => setTab('integrations')}
                          style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: 6, color: '#6b7280', padding: '3px 10px', cursor: 'pointer', fontSize: 11 }}
                        >Manage →</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
                        {toolAccessThirdParty.map(integ => {
                          const tc = TYPE_COLORS[integ.type] || TYPE_COLORS.webhook;
                          const mcpTools = integ.mcpTools || [];
                          const linkedPersonas = (integ.personaIds || []).map(pid => personas.find(p => p.personaId === pid)?.name).filter(Boolean);
                          return (
                            <div key={integ.integrationId} style={{
                              background: '#111', border: '1px solid rgba(74,222,128,0.2)',
                              borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
                            }}>
                              {/* Header */}
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>🔌</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span style={{ color: '#e5e7eb', fontWeight: 600, fontSize: 14 }}>{integ.name}</span>
                                    <span style={{ background: tc.bg, border: `1px solid ${tc.border}`, color: tc.color, padding: '1px 8px', borderRadius: 999, fontSize: 11 }}>{tc.label}</span>
                                    <span style={{ background: '#16331f', color: '#4ade80', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>Active</span>
                                    {integ.assignedTo === '__all__' && (
                                      <span style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', padding: '1px 8px', borderRadius: 999, fontSize: 11 }}>All Locations</span>
                                    )}
                                  </div>
                                  <p style={{ color: '#6b7280', fontSize: 12, margin: '4px 0 0' }}>{integ.clientName}</p>
                                </div>
                              </div>

                              {/* MCP Tools */}
                              {mcpTools.length > 0 && (
                                <div>
                                  <div style={{ color: '#4b5563', fontSize: 11, marginBottom: 4 }}>⚡ {mcpTools.length} MCP tool{mcpTools.length !== 1 ? 's' : ''}</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {mcpTools.slice(0, 6).map(t => (
                                      <span key={t.name} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, padding: '1px 7px', fontSize: 11, color: '#60a5fa', fontFamily: 'monospace' }}>{t.name}</span>
                                    ))}
                                    {mcpTools.length > 6 && <span style={{ color: '#4b5563', fontSize: 11 }}>+{mcpTools.length - 6} more</span>}
                                  </div>
                                </div>
                              )}

                              {/* Linked personas */}
                              {linkedPersonas.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                                  <span style={{ color: '#4b5563', fontSize: 11 }}>Personas:</span>
                                  {linkedPersonas.map(name => (
                                    <span key={name} style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', color: '#fbbf24', padding: '1px 8px', borderRadius: 999, fontSize: 11 }}>{name}</span>
                                  ))}
                                </div>
                              )}

                              {/* Manage button */}
                              <div style={{ marginTop: 2 }}>
                                <button
                                  onClick={() => setTab('integrations')}
                                  style={{ background: 'none', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 6, color: '#a5b4fc', padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                                >Edit in Integrations →</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* ── Beta Lab Tab ─────────────────────────────────────────────── */}
        {tab === 'integrations' && integrationsSubTab === 'beta-lab' && (() => {
          const VALID_STATUS = ['permanent', 'beta', 'not_shared'];
          const STATUS_META = {
            permanent:  { label: 'Permanent',  color: '#34d399', bg: 'rgba(16,185,129,0.15)',  border: 'rgba(16,185,129,0.35)',  desc: 'Pushed to all locations automatically. Banner shown once.' },
            beta:       { label: 'Beta',       color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',   border: 'rgba(251,191,36,0.3)',   desc: 'Mini admin enables per-location first; users see it only if enabled.' },
            not_shared: { label: 'Not Shared', color: '#9ca3af', bg: 'rgba(156,163,175,0.1)',   border: 'rgba(156,163,175,0.2)', desc: 'Visible in admin/mini-admin panel only. Never shown to regular users.' },
          };

          const openCreate = () => {
            setBetaForm({ title: '', description: '', version: '', status: 'not_shared', linkedFeatures: [] });
            setBetaModal('create');
          };
          const openEdit = (f) => {
            setBetaForm({ title: f.title || '', description: f.description || '', version: f.version || '', status: f.status || 'not_shared', linkedFeatures: f.linkedFeatures || [] });
            setBetaModal(f);
          };
          const saveFeature = async () => {
            if (!betaForm.title.trim()) return toast.error('Title is required');
            setBetaSaving(true);
            const isCreate = betaModal === 'create';
            const method   = isCreate ? 'POST' : 'PUT';
            const path     = isCreate ? '/admin/beta-lab' : `/admin/beta-lab/${betaModal.featureId}`;
            const data     = await adminFetch(path, { method, adminKey, body: betaForm });
            if (data.success) {
              if (isCreate) setBetaFeatures(prev => [data.data, ...prev]);
              else setBetaFeatures(prev => prev.map(f => f.featureId === data.data.featureId ? data.data : f));
              toast.success(isCreate ? 'Feature created' : 'Feature updated');
              setBetaModal(null);
            } else {
              toast.error(data.error || 'Save failed');
            }
            setBetaSaving(false);
          };
          const deleteFeature = async (featureId, title) => {
            confirmToast(`Delete "${title}"? This cannot be undone.`, async () => {
              const data = await adminFetch(`/admin/beta-lab/${featureId}`, { method: 'DELETE', adminKey });
              if (data.success) {
                setBetaFeatures(prev => prev.filter(f => f.featureId !== featureId));
                toast.success('Feature deleted');
              } else {
                toast.error(data.error || 'Delete failed');
              }
            });
          };

          return (
            <div>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <h3 style={{ color: '#fff', margin: '0 0 4px', fontSize: 16 }}>🧪 Beta Lab</h3>
                  <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>
                    Manage feature announcements. Set status to control who sees each update.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={loadBetaFeatures} style={{ background: 'transparent', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>↻ Reload</button>
                  <button onClick={openCreate} style={{ background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>+ New Feature</button>
                </div>
              </div>

              {/* Status legend */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                {VALID_STATUS.map(s => {
                  const m = STATUS_META[s];
                  return (
                    <div key={s} style={{ background: m.bg, border: `1px solid ${m.border}`, borderRadius: 8, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                      <span style={{ color: m.color, fontSize: 12, fontWeight: 600 }}>{m.label}</span>
                      <span style={{ color: '#6b7280', fontSize: 11 }}>— {m.desc}</span>
                    </div>
                  );
                })}
              </div>

              {/* Feature list */}
              {betaLoading ? (
                <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>Loading…</p>
              ) : betaFeatures.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60, color: '#4b5563' }}>
                  <p style={{ fontSize: 36, marginBottom: 12 }}>🧪</p>
                  <p style={{ fontSize: 14 }}>No features yet. Create your first one.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {betaFeatures.map(f => {
                    const sm = STATUS_META[f.status] || STATUS_META.not_shared;
                    return (
                      <div key={f.featureId} style={{
                        background: '#111827', border: '1px solid #1f2937',
                        borderRadius: 12, padding: '14px 18px',
                        display: 'flex', alignItems: 'center', gap: 14,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                            <span style={{ color: '#e5e7eb', fontWeight: 600, fontSize: 14 }}>{f.title}</span>
                            {f.version && (
                              <span style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', padding: '1px 8px', borderRadius: 99, fontSize: 11 }}>{f.version}</span>
                            )}
                            <span style={{ background: sm.bg, border: `1px solid ${sm.border}`, color: sm.color, padding: '1px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600 }}>{sm.label}</span>
                          </div>
                          {f.description && (
                            <p style={{ color: '#6b7280', fontSize: 12, margin: '0 0 4px', lineHeight: 1.5 }}>{f.description}</p>
                          )}
                          {(f.linkedFeatures || []).length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                              {(f.linkedFeatures || []).map((key, i) => {
                                const feat = ALL_FEATURES_DEFAULT.find(x => x.key === key);
                                return (
                                  <span key={i} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                    background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
                                    borderRadius: 99, padding: '1px 8px', color: '#818cf8', fontSize: 11,
                                  }}>
                                    {feat ? <span>{feat.icon}</span> : null}
                                    {feat ? feat.label : key}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, color: '#4b5563' }}>
                              {f.enabledLocations?.length || 0} enabled · {f.acknowledgedBy?.length || 0} acknowledged
                            </span>
                            <span style={{ fontSize: 11, color: '#374151' }}>
                              {f.publishedAt ? new Date(f.publishedAt).toLocaleDateString() : '—'}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                          {/* Quick status cycle */}
                          <select
                            value={f.status}
                            onChange={async (e) => {
                              const newStatus = e.target.value;
                              const data = await adminFetch(`/admin/beta-lab/${f.featureId}`, {
                                method: 'PUT', adminKey, body: { status: newStatus },
                              });
                              if (data.success) {
                                setBetaFeatures(prev => prev.map(x => x.featureId === f.featureId ? data.data : x));
                                toast.success('Status updated');
                              } else {
                                toast.error(data.error || 'Failed to update status');
                              }
                            }}
                            style={{ background: sm.bg, border: `1px solid ${sm.border}`, borderRadius: 6, color: sm.color, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                          >
                            {VALID_STATUS.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                          </select>
                          <button
                            onClick={() => openEdit(f)}
                            style={{ background: 'transparent', border: '1px solid #374151', borderRadius: 6, color: '#9ca3af', padding: '5px 12px', cursor: 'pointer', fontSize: 12 }}
                          >Edit</button>
                          <button
                            onClick={() => deleteFeature(f.featureId, f.title)}
                            style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', padding: '5px 10px', cursor: 'pointer', fontSize: 12 }}
                          >✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Create / Edit modal */}
              {betaModal && (
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                  onClick={() => setBetaModal(null)}
                >
                  <div onClick={e => e.stopPropagation()} style={{
                    width: '100%', maxWidth: 560, background: '#13131a',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16,
                    padding: 24, boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
                    maxHeight: '90vh', overflowY: 'auto',
                  }}>
                    <h3 style={{ margin: '0 0 18px', fontSize: 15, color: '#f1f5f9', fontWeight: 700 }}>
                      {betaModal === 'create' ? '+ New Feature' : `Edit: ${betaModal.title}`}
                    </h3>
                    {[
                      { key: 'title', label: 'Title *', placeholder: 'e.g. AI Auto-Improve' },
                      { key: 'version', label: 'Version', placeholder: 'e.g. v2.8' },
                      { key: 'description', label: 'Description', placeholder: 'What does this feature do?', multiline: true },
                    ].map(({ key, label, placeholder, multiline }) => (
                      <div key={key} style={{ marginBottom: 14 }}>
                        <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, marginBottom: 5, fontWeight: 600 }}>{label}</label>
                        {multiline ? (
                          <textarea
                            value={betaForm[key]}
                            onChange={e => setBetaForm(p => ({ ...p, [key]: e.target.value }))}
                            placeholder={placeholder}
                            rows={3}
                            style={{ width: '100%', boxSizing: 'border-box', background: '#0a0f1a', border: '1px solid #1f2937', borderRadius: 8, color: '#f1f5f9', padding: '9px 12px', fontSize: 13, resize: 'vertical', outline: 'none' }}
                          />
                        ) : (
                          <input
                            value={betaForm[key]}
                            onChange={e => setBetaForm(p => ({ ...p, [key]: e.target.value }))}
                            placeholder={placeholder}
                            style={{ width: '100%', boxSizing: 'border-box', background: '#0a0f1a', border: '1px solid #1f2937', borderRadius: 8, color: '#f1f5f9', padding: '9px 12px', fontSize: 13, outline: 'none' }}
                          />
                        )}
                      </div>
                    ))}
                    <div style={{ marginBottom: 20 }}>
                      <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, marginBottom: 5, fontWeight: 600 }}>Status</label>
                      <select
                        value={betaForm.status}
                        onChange={e => setBetaForm(p => ({ ...p, status: e.target.value }))}
                        style={{ width: '100%', background: '#0a0f1a', border: '1px solid #1f2937', borderRadius: 8, color: '#f1f5f9', padding: '9px 12px', fontSize: 13, outline: 'none' }}
                      >
                        {VALID_STATUS.map(s => (
                          <option key={s} value={s}>{STATUS_META[s].label} — {STATUS_META[s].desc}</option>
                        ))}
                      </select>
                    </div>
                    {/* Linked Features multi-select */}
                    <div style={{ marginBottom: 20 }}>
                      <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Linked Features</label>
                      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#4b5563', lineHeight: 1.5 }}>
                        Select which app features this update is related to. Shown as badges in the user panel.
                      </p>
                      <div style={{ background: '#0a0f1a', border: '1px solid #1f2937', borderRadius: 10, padding: '12px 14px', maxHeight: 220, overflowY: 'auto' }}>
                        {Object.entries(
                          ALL_FEATURES_DEFAULT.reduce((acc, f) => {
                            if (!acc[f.group]) acc[f.group] = [];
                            acc[f.group].push(f);
                            return acc;
                          }, {})
                        ).map(([group, features]) => (
                          <div key={group} style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 10, color: '#4b5563', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{group}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {features.map(feat => {
                                const selected = (betaForm.linkedFeatures || []).includes(feat.key);
                                return (
                                  <button
                                    key={feat.key}
                                    type="button"
                                    onClick={() => setBetaForm(p => ({
                                      ...p,
                                      linkedFeatures: selected
                                        ? (p.linkedFeatures || []).filter(k => k !== feat.key)
                                        : [...(p.linkedFeatures || []), feat.key],
                                    }))}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 5,
                                      background: selected ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                                      border: `1px solid ${selected ? 'rgba(99,102,241,0.5)' : '#1f2937'}`,
                                      borderRadius: 8, padding: '5px 10px',
                                      color: selected ? '#a5b4fc' : '#6b7280',
                                      fontSize: 12, cursor: 'pointer', transition: 'all .15s',
                                    }}
                                  >
                                    <span style={{ fontSize: 13 }}>{feat.icon}</span>
                                    <span>{feat.label}</span>
                                    {selected && <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 700 }}>✓</span>}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                      {(betaForm.linkedFeatures || []).length > 0 && (
                        <p style={{ margin: '6px 0 0', fontSize: 11, color: '#6366f1' }}>
                          {(betaForm.linkedFeatures || []).length} feature{(betaForm.linkedFeatures || []).length > 1 ? 's' : ''} selected
                        </p>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                      <button onClick={() => setBetaModal(null)} style={{ background: 'none', border: '1px solid #374151', borderRadius: 8, color: '#9ca3af', padding: '8px 18px', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
                      <button
                        onClick={saveFeature}
                        disabled={betaSaving}
                        style={{ background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', padding: '8px 22px', cursor: betaSaving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: betaSaving ? 0.6 : 1 }}
                      >{betaSaving ? 'Saving…' : 'Save Feature'}</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Admin Dashboard Config Tab ───────────────────────────────── */}
        {tab === 'users-roles' && adminSubTab === 'dashboard-cfg' && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ color: '#fff', margin: '0 0 6px', fontSize: 16 }}>🛡️ Admin Dashboard</h3>
              <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>
                Configure what sections are visible on the Admin Dashboard (
                <code style={{ color: '#a5b4fc', fontSize: 12 }}>/ui/admin-dashboard</code>
                ). Share that link with your location admins.
              </p>
            </div>

            {/* Shareable link */}
            <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shareable Link</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <code style={{ flex: 1, background: '#0a0f1a', border: '1px solid #1f2937', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#a5b4fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {window.location.origin}/ui/admin-dashboard
                </code>
                <button
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/ui/admin-dashboard`); toast.success('Link copied'); }}
                  style={{ flexShrink: 0, background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, color: '#a5b4fc', padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                >Copy</button>
              </div>
              <p style={{ margin: '10px 0 0', fontSize: 12, color: '#4b5563' }}>
                Location admins enter their Location ID + User ID on the login screen. No separate credentials required.
              </p>
            </div>

            {/* Tab toggles */}
            {dashCfg ? (
              <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: '20px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb', marginBottom: 16 }}>Enabled Sections</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                  {(dashCfg.allTabs || []).map(t => {
                    const on = dashCfgTabs.includes(t.id);
                    return (
                      <div key={t.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: '#0f1117', border: `1px solid ${on ? 'rgba(99,102,241,0.3)' : '#1f2937'}`,
                        borderRadius: 8, padding: '12px 16px',
                      }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb' }}>{t.label}</div>
                          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{t.desc}</div>
                        </div>
                        <button
                          onClick={() => setDashCfgTabs(prev => on ? prev.filter(x => x !== t.id) : [...prev, t.id])}
                          style={{
                            flexShrink: 0, position: 'relative',
                            width: 46, height: 25, borderRadius: 99,
                            background: on ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
                            border: `1px solid ${on ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.12)'}`,
                            cursor: 'pointer', padding: '0 3px',
                            display: 'flex', alignItems: 'center', transition: 'all .2s',
                          }}
                        >
                          <span style={{
                            width: 17, height: 17, borderRadius: '50%',
                            background: on ? '#6366f1' : '#4b5563',
                            transform: on ? 'translateX(21px)' : 'translateX(0)',
                            transition: 'all .2s', display: 'block',
                          }} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  disabled={dashCfgSaving}
                  onClick={async () => {
                    setDashCfgSaving(true);
                    const data = await adminFetch('/admin/dashboard-config', { method: 'PUT', adminKey, body: { enabledTabs: dashCfgTabs } });
                    if (data.success) {
                      setDashCfg(d => ({ ...d, data: data.data }));
                      toast.success('Dashboard config saved');
                    } else {
                      toast.error(data.error || 'Save failed');
                    }
                    setDashCfgSaving(false);
                  }}
                  style={{
                    background: '#6366f1', border: 'none', borderRadius: 8,
                    color: '#fff', padding: '9px 22px', cursor: dashCfgSaving ? 'not-allowed' : 'pointer',
                    fontSize: 13, fontWeight: 600, opacity: dashCfgSaving ? 0.6 : 1,
                  }}
                >{dashCfgSaving ? 'Saving…' : 'Save Config'}</button>
              </div>
            ) : (
              <p style={{ color: '#4b5563', textAlign: 'center', padding: 40 }}>Loading…</p>
            )}

          </div>
        )}

        {/* ── Credentials Tab ──────────────────────────────────────────── */}
        {tab === 'users-roles' && adminSubTab === 'credentials' && (() => {
          const credRoleBadge = (role) => {
            const colors = { admin: { bg: 'rgba(239,68,68,0.12)', color: '#f87171', border: 'rgba(239,68,68,0.25)' }, mini_admin: { bg: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: 'rgba(124,58,237,0.25)' } };
            const c = colors[role] || colors.mini_admin;
            return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: c.bg, color: c.color, border: `1px solid ${c.border}`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{role === 'admin' ? 'Admin' : 'Mini Admin'}</span>;
          };
          const credStatusBadge = (cred) => {
            if (!cred.activated) return <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'rgba(251,191,36,0.1)', color:'#fbbf24', border:'1px solid rgba(251,191,36,0.25)' }}>Pending Email</span>;
            const on = cred.status === 'active';
            return <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:10, background: on ? 'rgba(74,222,128,0.1)' : 'rgba(107,114,128,0.12)', color: on ? '#4ade80' : '#6b7280', border:`1px solid ${on ? 'rgba(74,222,128,0.2)' : 'rgba(107,114,128,0.2)'}` }}>{on ? 'Active' : 'Inactive'}</span>;
          };
          const locationLabel = (ids) => {
            if (!ids || ids.length === 0) return <span style={{ color:'#374151' }}>—</span>;
            if (ids.includes('all')) return <span style={{ color:'#60a5fa', fontSize:12, fontWeight:600 }}>All Locations</span>;
            if (ids.length === 1) {
              const loc = locations.find(l => l.locationId === ids[0]);
              return <span style={{ fontSize:12, color:'#9ca3af' }}>{loc?.name || ids[0]}</span>;
            }
            return <span style={{ fontSize:12, color:'#9ca3af' }}>{ids.length} locations</span>;
          };
          const openCreate = () => {
            setCredForm({ name:'', email:'', username:'', locationIds:[], role:'mini_admin', status:'active', notes:'' });
            setCredActivateNow(false);
            setCredModal('create');
          };
          const openEdit = (cred) => {
            setCredForm({ name:cred.name, email:cred.email||'', username:cred.username, locationIds:cred.locationIds||(cred.locationId?[cred.locationId]:[]), role:cred.role||'mini_admin', status:cred.status||'active', notes:cred.notes||'' });
            setCredNewPassword('');
            setCredShowNewPass(false);
            setCredModal(cred);
          };
          const closeCredModal = () => { setCredModal(null); setCredNewPassword(''); setCredShowNewPass(false); };
          const genPassword = () => {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
            let pwd = '';
            for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
            setCredNewPassword(pwd);
            setCredShowNewPass(true);
          };
          const deleteCred = (cred) => {
            confirmToast(`Delete credential for "${cred.name}" (@${cred.username})?`, async () => {
              const r = await adminFetch(`/admin/dashboard-credentials/${cred.credentialId}`, { method:'DELETE', adminKey });
              if (r.success) { toast.success('Credential deleted'); loadCredentials(); }
              else toast.error(r.error || 'Delete failed');
            }, 'Delete', '#dc2626');
          };
          const resendActivation = async (cred) => {
            const r = await adminFetch(`/admin/dashboard-credentials/${cred.credentialId}/resend-activation`, { method:'POST', adminKey });
            if (r.success) {
              if (r.emailSent) toast.success('Activation email resent');
              else toast.error(r.emailError || 'Email not sent — SMTP not configured');
            }
            else toast.error(r.error || 'Failed');
          };
          const saveCred = async () => {
            setCredSaving(true);
            try {
              const isCreate = credModal === 'create';
              const body = { name:credForm.name, email:credForm.email, username:credForm.username, locationIds:credForm.locationIds, role:credForm.role, status:credForm.status, notes:credForm.notes };
              if (isCreate && credActivateNow) body.activateNow = true;
              if (!isCreate && credNewPassword.trim()) body.newPassword = credNewPassword.trim();
              const url = isCreate ? '/admin/dashboard-credentials' : `/admin/dashboard-credentials/${credModal.credentialId}`;
              const r = await adminFetch(url, { method: isCreate ? 'POST' : 'PUT', adminKey, body });
              if (r.success) {
                if (isCreate && r.activatedNow) {
                  setCredPasswordModal({ username: r.username, password: r.plainPassword });
                } else if (isCreate) {
                  if (r.emailSent) toast.success('Credential created — activation email sent!');
                  else toast.error(`Credential created but email failed: ${r.emailError || 'SMTP not configured'}`);
                } else {
                  if (credNewPassword.trim()) {
                    setCredPasswordModal({ username: credModal.username, password: credNewPassword.trim(), isChange: true });
                  } else {
                    toast.success('Credential updated');
                  }
                }
                closeCredModal(); loadCredentials();
              } else toast.error(r.error || 'Save failed');
            } finally { setCredSaving(false); }
          };
          const forceActivateCred = async (cred) => {
            const r = await adminFetch(`/admin/dashboard-credentials/${cred.credentialId}/force-activate`, { method:'POST', adminKey });
            if (r.success) { toast.success(`${cred.name} activated`); loadCredentials(); }
            else toast.error(r.error || 'Force activate failed');
          };
          const toggleLocId = (id) => {
            setCredForm(f => {
              const ids = f.locationIds.filter(x => x !== 'all');
              return { ...f, locationIds: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] };
            });
          };
          const inpStyle = { width:'100%', boxSizing:'border-box', background:'#0d1117', border:'1px solid #2a2a2a', borderRadius:8, color:'#e5e7eb', padding:'9px 12px', fontSize:14, outline:'none', marginBottom:14 };
          const lblStyle = { display:'block', color:'#9ca3af', fontSize:12, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:5 };
          const isAllLocs = credForm.locationIds.includes('all');
          return (
            <div>
              {/* Header row */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
                <div>
                  <h2 style={{ margin:0, fontSize:16, fontWeight:700, color:'#f1f5f9' }}>Admin Dashboard Credentials</h2>
                  <p style={{ margin:'4px 0 0', fontSize:13, color:'#6b7280' }}>Login accounts for <span style={{ color:'#a78bfa', fontFamily:'monospace', fontSize:12 }}>/ui/admin-dashboard</span>. Passwords are auto-generated and emailed.</p>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={loadCredentials} style={{ background:'transparent', border:'1px solid #2a2a2a', borderRadius:8, color:'#9ca3af', padding:'8px 14px', cursor:'pointer', fontSize:13 }}>↻ Reload</button>
                  <button onClick={openCreate} style={{ background:'#7c3aed', border:'none', borderRadius:8, color:'#fff', padding:'8px 16px', cursor:'pointer', fontSize:13, fontWeight:600 }}>+ New Credential</button>
                </div>
              </div>

              {/* Table */}
              {credLoading ? (
                <p style={{ color:'#4b5563', textAlign:'center', padding:40 }}>Loading…</p>
              ) : credentials.length === 0 ? (
                <div style={{ background:'#0e0e16', border:'1px dashed #2a2a2a', borderRadius:16, padding:'50px 20px', textAlign:'center' }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🔑</div>
                  <p style={{ color:'#4b5563', margin:0, fontSize:14 }}>No credentials yet. Create one to allow access to the Admin Dashboard.</p>
                </div>
              ) : (
                <div style={{ background:'#0e0e16', border:'1px solid #1e1e2e', borderRadius:12, overflow:'hidden', overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, minWidth:760 }}>
                    <thead>
                      <tr style={{ borderBottom:'1px solid #1e1e2e' }}>
                        {['Name / Username','Email','Locations','Role','Status','Last Login','Logins','Actions'].map(h => (
                          <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.05em', color:'#4b5563' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {credentials.map(cred => (
                        <tr key={cred.credentialId} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding:'12px 14px' }}>
                            <div style={{ fontWeight:600, color:'#e5e7eb' }}>{cred.name}</div>
                            <div style={{ fontFamily:'monospace', fontSize:12, color:'#6b7280', marginTop:2 }}>@{cred.username}</div>
                          </td>
                          <td style={{ padding:'12px 14px', fontSize:12, color:'#6b7280' }}>{cred.email || '—'}</td>
                          <td style={{ padding:'12px 14px' }}>{locationLabel(cred.locationIds)}</td>
                          <td style={{ padding:'12px 14px' }}>{credRoleBadge(cred.role)}</td>
                          <td style={{ padding:'12px 14px' }}>
                            <div style={{ display:'flex', flexDirection:'column', gap:4, alignItems:'flex-start' }}>
                              <button
                                title={cred.activated ? 'Click to toggle active/inactive' : 'Not yet activated'}
                                disabled={!cred.activated}
                                onClick={async () => {
                                  if (!cred.activated) return;
                                  const r = await adminFetch(`/admin/dashboard-credentials/${cred.credentialId}`, { method:'PUT', adminKey, body: { status: cred.status === 'active' ? 'inactive' : 'active' } });
                                  if (r.success) loadCredentials();
                                  else toast.error(r.error || 'Update failed');
                                }}
                                style={{ background:'none', border:'none', cursor: cred.activated ? 'pointer' : 'default', padding:0 }}
                              >{credStatusBadge(cred)}</button>
                              {!cred.activated && (
                                <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                                  <button
                                    onClick={() => resendActivation(cred)}
                                    style={{ background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.2)', borderRadius:5, color:'#fbbf24', padding:'2px 8px', cursor:'pointer', fontSize:10, fontWeight:600 }}
                                  >↻ Resend</button>
                                  <button
                                    onClick={() => forceActivateCred(cred)}
                                    title="Activate immediately — bypass email verification"
                                    style={{ background:'rgba(74,222,128,0.08)', border:'1px solid rgba(74,222,128,0.2)', borderRadius:5, color:'#4ade80', padding:'2px 8px', cursor:'pointer', fontSize:10, fontWeight:600 }}
                                  >✓ Activate Now</button>
                                </div>
                              )}
                            </div>
                          </td>
                          <td style={{ padding:'12px 14px', color:'#6b7280', fontSize:12, whiteSpace:'nowrap' }}>
                            {cred.lastLoginAt ? relTime(cred.lastLoginAt) : <span style={{ color:'#374151' }}>Never</span>}
                            {cred.lastLoginIp && <div style={{ fontSize:11, color:'#374151', marginTop:2 }}>{cred.lastLoginIp}</div>}
                          </td>
                          <td style={{ padding:'12px 14px', color:'#6b7280', textAlign:'center' }}>{cred.loginCount || 0}</td>
                          <td style={{ padding:'12px 14px' }}>
                            <div style={{ display:'flex', gap:6 }}>
                              <button onClick={() => openEdit(cred)} style={{ background:'rgba(124,58,237,0.1)', border:'1px solid rgba(124,58,237,0.2)', borderRadius:6, color:'#a78bfa', padding:'4px 10px', cursor:'pointer', fontSize:12 }}>Edit</button>
                              <button onClick={() => deleteCred(cred)} style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.18)', borderRadius:6, color:'#f87171', padding:'4px 10px', cursor:'pointer', fontSize:12 }}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Password reveal modal — shown after "Activate immediately" create */}
              {credPasswordModal && (
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:20, backdropFilter:'blur(6px)' }}>
                  <div style={{ background:'#0e0e16', border:'1px solid rgba(74,222,128,0.35)', borderRadius:16, padding:28, width:'100%', maxWidth:420 }}>
                    <div style={{ fontSize:32, textAlign:'center', marginBottom:10 }}>🔑</div>
                    <h3 style={{ margin:'0 0 6px', fontSize:16, fontWeight:700, color:'#f1f5f9', textAlign:'center' }}>{credPasswordModal?.isChange ? 'Password Updated' : 'Credential Created & Activated'}</h3>
                    <p style={{ margin:'0 0 20px', fontSize:12, color:'#6b7280', textAlign:'center', lineHeight:1.6 }}>
                      Copy these credentials now — the password will <strong style={{ color:'#f87171' }}>not</strong> be shown again.
                    </p>
                    <div style={{ background:'#0a0f1a', border:'1px solid #1f2937', borderRadius:10, padding:'12px 16px', marginBottom:10 }}>
                      <div style={{ fontSize:11, color:'#4b5563', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>Username</div>
                      <div style={{ fontFamily:'monospace', fontSize:15, color:'#a5b4fc', letterSpacing:'0.03em' }}>{credPasswordModal.username}</div>
                    </div>
                    <div style={{ background:'#0a0f1a', border:'1px solid #1f2937', borderRadius:10, padding:'12px 16px', marginBottom:20 }}>
                      <div style={{ fontSize:11, color:'#4b5563', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>Password</div>
                      <div style={{ fontFamily:'monospace', fontSize:15, color:'#4ade80', letterSpacing:'0.05em' }}>{credPasswordModal.password}</div>
                    </div>
                    <div style={{ display:'flex', gap:10 }}>
                      <button
                        onClick={() => { navigator.clipboard.writeText(`Username: ${credPasswordModal.username}\nPassword: ${credPasswordModal.password}`); toast.success('Copied to clipboard!'); }}
                        style={{ flex:1, background:'rgba(74,222,128,0.12)', border:'1px solid rgba(74,222,128,0.3)', borderRadius:8, color:'#4ade80', padding:'10px', fontSize:13, fontWeight:600, cursor:'pointer' }}
                      >📋 Copy Credentials</button>
                      <button
                        onClick={() => setCredPasswordModal(null)}
                        style={{ padding:'10px 18px', background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:8, color:'#9ca3af', fontSize:13, cursor:'pointer' }}
                      >Done</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Create / Edit Modal */}
              {credModal && (
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20, backdropFilter:'blur(4px)' }}>
                  <div style={{ background:'#0e0e16', border:'1px solid #1e2a3a', borderRadius:16, padding:28, width:'100%', maxWidth:500, maxHeight:'90vh', overflowY:'auto' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
                      <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:'#f1f5f9' }}>{credModal === 'create' ? 'New Credential' : `Edit — ${credModal.name}`}</h3>
                      <button onClick={closeCredModal} style={{ background:'none', border:'none', color:'#6b7280', cursor:'pointer', fontSize:18, lineHeight:1 }}>×</button>
                    </div>

                    {credModal === 'create' && (
                      <>
                        <label
                          style={{ display:'flex', alignItems:'flex-start', gap:12, cursor:'pointer', background: credActivateNow ? 'rgba(74,222,128,0.08)' : 'rgba(99,102,241,0.06)', border: `1px solid ${credActivateNow ? 'rgba(74,222,128,0.3)' : 'rgba(99,102,241,0.2)'}`, borderRadius:8, padding:'12px 14px', marginBottom:16, transition:'all .15s' }}
                        >
                          <input
                            type="checkbox"
                            checked={credActivateNow}
                            onChange={e => setCredActivateNow(e.target.checked)}
                            style={{ marginTop:2, width:16, height:16, accentColor:'#4ade80', cursor:'pointer', flexShrink:0 }}
                          />
                          <div>
                            <div style={{ fontSize:13, fontWeight:600, color: credActivateNow ? '#4ade80' : '#a5b4fc' }}>
                              {credActivateNow ? '✓ Activate immediately (skip email)' : 'Activate immediately (skip email)'}
                            </div>
                            <div style={{ fontSize:11, color:'#6b7280', marginTop:3, lineHeight:1.5 }}>
                              {credActivateNow
                                ? 'Account will be ready to log in now. The password will be shown once — copy it.'
                                : 'Leave unchecked to send an activation email instead (requires SMTP configured).'}
                            </div>
                          </div>
                        </label>
                        {!credActivateNow && (
                          <div style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.15)', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:12, color:'#818cf8', lineHeight:1.6 }}>
                            A password will be auto-generated and emailed to the user with an activation link.
                          </div>
                        )}
                      </>
                    )}

                    <label style={lblStyle}>Display Name</label>
                    <input style={inpStyle} placeholder="e.g. John Smith" value={credForm.name} onChange={e => setCredForm(f => ({ ...f, name: e.target.value }))} />

                    <label style={lblStyle}>Email Address</label>
                    <input style={inpStyle} type="email" placeholder="user@example.com" value={credForm.email} onChange={e => setCredForm(f => ({ ...f, email: e.target.value }))} />

                    <label style={lblStyle}>Username</label>
                    <input style={inpStyle} placeholder="e.g. jsmith" value={credForm.username} onChange={e => setCredForm(f => ({ ...f, username: e.target.value }))} autoComplete="off" />

                    {/* Location Access */}
                    <label style={lblStyle}>Location Access</label>
                    <div style={{ background:'#0a0f1a', border:'1px solid #2a2a2a', borderRadius:8, padding:'10px 12px', marginBottom:14 }}>
                      {/* All locations toggle */}
                      <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'6px 0', borderBottom:'1px solid #1a1a2e' }}>
                        <input
                          type="checkbox"
                          checked={isAllLocs}
                          onChange={e => setCredForm(f => ({ ...f, locationIds: e.target.checked ? ['all'] : [] }))}
                          style={{ width:16, height:16, accentColor:'#6366f1', cursor:'pointer' }}
                        />
                        <div>
                          <div style={{ fontSize:13, fontWeight:600, color:'#e5e7eb' }}>All Locations</div>
                          <div style={{ fontSize:11, color:'#4b5563' }}>Can access every installed location</div>
                        </div>
                      </label>
                      {/* Specific locations */}
                      {!isAllLocs && (
                        <div style={{ marginTop:8, maxHeight:180, overflowY:'auto' }}>
                          {locations.length === 0 ? (
                            <p style={{ color:'#374151', fontSize:12, margin:'8px 0 0' }}>No locations loaded. Go back and visit the Locations tab first.</p>
                          ) : (
                            locations.map(loc => (
                              <label key={loc.locationId} style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'5px 0' }}>
                                <input
                                  type="checkbox"
                                  checked={credForm.locationIds.includes(loc.locationId)}
                                  onChange={() => toggleLocId(loc.locationId)}
                                  style={{ width:15, height:15, accentColor:'#7c3aed', cursor:'pointer' }}
                                />
                                <div style={{ fontSize:13, color:'#9ca3af' }}>
                                  {loc.name && <span style={{ color:'#e5e7eb', fontWeight:500 }}>{loc.name} · </span>}
                                  <span style={{ fontFamily:'monospace', fontSize:12 }}>{loc.locationId}</span>
                                </div>
                              </label>
                            ))
                          )}
                        </div>
                      )}
                      {!isAllLocs && credForm.locationIds.length > 0 && (
                        <div style={{ marginTop:8, fontSize:11, color:'#6366f1', paddingTop:6, borderTop:'1px solid #1a1a2e' }}>
                          {credForm.locationIds.length} location{credForm.locationIds.length !== 1 ? 's' : ''} selected
                        </div>
                      )}
                    </div>

                    <label style={lblStyle}>Role</label>
                    <select style={{ ...inpStyle, cursor:'pointer' }} value={credForm.role} onChange={e => setCredForm(f => ({ ...f, role: e.target.value }))}>
                      <option value="mini_admin">Mini Admin</option>
                      <option value="admin">Admin</option>
                    </select>

                    <label style={lblStyle}>Status</label>
                    <select style={{ ...inpStyle, cursor:'pointer' }} value={credForm.status} onChange={e => setCredForm(f => ({ ...f, status: e.target.value }))}>
                      <option value="active">Active (after activation)</option>
                      <option value="inactive">Inactive</option>
                    </select>

                    <label style={lblStyle}>Notes (optional)</label>
                    <textarea
                      style={{ ...inpStyle, minHeight:72, resize:'vertical' }}
                      placeholder="Internal notes about this credential…"
                      value={credForm.notes}
                      onChange={e => setCredForm(f => ({ ...f, notes: e.target.value }))}
                    />

                    {/* Change Password — only shown when editing an existing credential */}
                    {credModal !== 'create' && (
                      <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid #1e2a3a', borderRadius:10, padding:'14px 16px', marginBottom:16 }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                          <label style={{ ...lblStyle, margin:0 }}>Change Password</label>
                          <button
                            type="button"
                            onClick={genPassword}
                            style={{ background:'rgba(99,102,241,0.12)', border:'1px solid rgba(99,102,241,0.25)', borderRadius:6, color:'#a5b4fc', padding:'4px 12px', cursor:'pointer', fontSize:12, fontWeight:600 }}
                          >Auto-generate</button>
                        </div>
                        <div style={{ position:'relative' }}>
                          <input
                            type={credShowNewPass ? 'text' : 'password'}
                            value={credNewPassword}
                            onChange={e => setCredNewPassword(e.target.value)}
                            placeholder="Leave blank to keep current password"
                            style={{ ...inpStyle, marginBottom:0, paddingRight:44, fontFamily: credNewPassword ? 'monospace' : 'inherit' }}
                            autoComplete="new-password"
                          />
                          <button
                            type="button"
                            onClick={() => setCredShowNewPass(v => !v)}
                            style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'#6b7280', cursor:'pointer', fontSize:13, padding:'2px 4px' }}
                          >{credShowNewPass ? '🙈' : '👁'}</button>
                        </div>
                        {credNewPassword && (
                          <p style={{ margin:'6px 0 0', fontSize:11, color:'#4ade80' }}>
                            ✓ New password set — will update on save and be shown once.
                          </p>
                        )}
                      </div>
                    )}

                    <div style={{ display:'flex', gap:10, marginTop:4 }}>
                      <button
                        onClick={saveCred}
                        disabled={credSaving}
                        style={{ flex:1, background:'#7c3aed', border:'none', borderRadius:8, color:'#fff', padding:'10px', fontSize:14, fontWeight:600, cursor: credSaving ? 'not-allowed' : 'pointer', opacity: credSaving ? 0.6 : 1 }}
                      >{credSaving ? 'Saving…' : credModal === 'create' ? (credActivateNow ? 'Create & Activate Now' : 'Create & Send Email') : (credNewPassword.trim() ? 'Save & Update Password' : 'Save Changes')}</button>
                      <button onClick={closeCredModal} style={{ padding:'10px 18px', background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:8, color:'#9ca3af', fontSize:14, cursor:'pointer' }}>Cancel</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Brain Tab ────────────────────────────────────────────────── */}
        {tab === 'personas' && personasSubTab === 'brain' && (
          <div>
            {/* View switcher — underline tab bar */}
            <div style={{ background: BD.card, border: `1px solid ${BD.border}`, borderRadius: 10, display: 'flex', alignItems: 'center', padding: '0 4px', marginBottom: 20, flexWrap: 'wrap', gap: 0, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 0 }}>
                {[
                  { id: 'brains',   label: '🧠 Brains' },
                  { id: 'pipeline', label: '⟳ Pipeline' },
                  { id: 'search',   label: '🔍 Search' },
                  { id: 'mcp',      label: '⚡ MCP' },
                ].map(v => (
                  <button key={v.id} onClick={() => { setAdminBrainView(v.id); setSelectedBrain(null); setBrainStatus(null); setBrainVideos([]); }} style={{
                    background: 'none', border: 'none',
                    borderBottom: adminBrainView === v.id ? `2px solid ${BD.blue}` : '2px solid transparent',
                    color: adminBrainView === v.id ? BD.textPri : BD.textMuted,
                    padding: '13px 18px', fontSize: 14, fontWeight: adminBrainView === v.id ? 600 : 400,
                    cursor: 'pointer', marginBottom: -1,
                  }}>
                    {v.label}
                  </button>
                ))}
              </div>
              {adminBrainView === 'brains' && !selectedBrain && (
                <div style={{ display: 'flex', gap: 8, paddingRight: 8 }}>
                  <button onClick={loadSharedBrains} style={{ background: 'transparent', border: `1px solid ${BD.border}`, borderRadius: 8, color: BD.textSec, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>↻ Reload</button>
                  <button
                    onClick={() => { setBrainForm({ name: '', description: '', primaryChannel: '' }); setShowCreateBrain(true); }}
                    style={{ background: BD.blue, border: 'none', borderRadius: 8, color: '#fff', padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                  >+ New Brain</button>
                </div>
              )}
              {adminBrainView === 'brains' && selectedBrain && (
                <button
                  onClick={() => { setSelectedBrain(null); setBrainStatus(null); setBrainVideos([]); }}
                  style={{ background: 'none', border: `1px solid ${BD.border}`, borderRadius: 8, color: BD.textSec, padding: '6px 12px', cursor: 'pointer', fontSize: 13, marginRight: 8 }}
                >← Back to Brains</button>
              )}
            </div>

            {/* ── Brains view ── */}
            {adminBrainView === 'brains' && (
            <div>
            {/* Brain List */}
            {!selectedBrain && (() => {
              const totalVideos   = sharedBrains.reduce((a, b) => a + (b.videoCount || 0), 0);
              const totalIndexed  = sharedBrains.reduce((a, b) => a + (b.docCount || 0), 0);
              const totalChunks   = sharedBrains.reduce((a, b) => a + (b.chunkCount || 0), 0);
              const totalChannels = sharedBrains.reduce((a, b) => a + (b.channels || []).length, 0);
              const getBrainHealth = (brain) => {
                const docs = brain.docs || [];
                const pendingFromDocs = docs.filter(d => !d.chunkCount || d.chunkCount === 0).length;
                const pendingCount = (brain.pendingVideos || 0) + (brain.errorVideos || 0) || pendingFromDocs;
                const hasContent = (brain.docCount || 0) > 0 || (brain.videoCount || 0) > 0 || docs.length > 0;
                return { healthy: pendingCount === 0 && hasContent, pendingCount, hasContent };
              };
              return (
                <div>
                  {/* Stat cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                    {[
                      { label: 'Brains',   value: sharedBrains.length, icon: '🧠' },
                      { label: 'Channels', value: totalChannels,        icon: '📡' },
                      { label: 'Videos',   value: totalVideos,          icon: '▶', sub: `${totalIndexed} indexed` },
                      { label: 'Chunks',   value: totalChunks,          icon: '🧩' },
                    ].map(s => (
                      <div key={s.label} style={{ background: BD.card, border: `1px solid ${BD.border}`, borderRadius: 12, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ fontSize: 28 }}>{s.icon}</div>
                        <div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: BD.textPri }}>{s.value.toLocaleString()}</div>
                          <div style={{ fontSize: 12, color: BD.textMuted }}>{s.label}{s.sub ? ` · ${s.sub}` : ''}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {brainLoading && <p style={{ color: BD.textMuted, fontSize: 13 }}>Loading brains…</p>}

                  {!brainLoading && sharedBrains.length === 0 && (
                    <div style={{ background: BD.card, border: `1px dashed ${BD.border}`, borderRadius: 16, padding: '60px 20px', textAlign: 'center' }}>
                      <div style={{ fontSize: 48, marginBottom: 16 }}>🧠</div>
                      <h3 style={{ margin: '0 0 8px', color: BD.textPri, fontSize: 18 }}>No brains yet</h3>
                      <p style={{ color: BD.textMuted, fontSize: 14, margin: 0 }}>Create a shared brain or connect a location brain to get started.</p>
                    </div>
                  )}

                  {!brainLoading && sharedBrains.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
                      {sharedBrains.map(b => {
                        const { healthy, pendingCount } = getBrainHealth(b);
                        const channelCount = (b.channels || []).length;
                        return (
                          <div key={`${b._locationId}-${b.brainId}`} onClick={() => loadBrainDetail(b)}
                            style={{ background: BD.card, border: `1px solid ${BD.border}`, borderRadius: 14, padding: 20, cursor: 'pointer', transition: 'border-color .15s' }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = BD.blue + '88'}
                            onMouseLeave={e => e.currentTarget.style.borderColor = BD.border}
                          >
                            {/* Name + health badge */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: 16, fontWeight: 700, color: BD.textPri, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                                {/* Sharing badge / toggle */}
                                {b._locationId === '__shared__' ? (
                                  // Native shared brain — always visible to all users
                                  <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.35)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    ⊕ Shared
                                  </span>
                                ) : (
                                  // Location brain — toggle sharing
                                  <button
                                    onClick={async e => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const next = !b.isShared;
                                      setSharedBrains(prev => prev.map(x => x.brainId === b.brainId ? { ...x, isShared: next } : x));
                                      const locQ = `?loc=${encodeURIComponent(b._locationId)}`;
                                      await adminFetch(`/brain/${b.brainId}${locQ}`, { method: 'PATCH', adminKey, body: { isShared: next } });
                                      loadSharedBrains();
                                    }}
                                    title={b.isShared ? 'Visible to all locations — click to make private' : 'Private — click to share with all locations'}
                                    style={{
                                      flexShrink: 0, cursor: 'pointer',
                                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                                      background: b.isShared ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)',
                                      color: b.isShared ? '#34d399' : BD.textMuted,
                                      border: `1px solid ${b.isShared ? 'rgba(16,185,129,0.35)' : BD.border}`,
                                      textTransform: 'uppercase', letterSpacing: '0.05em',
                                      transition: 'all .15s',
                                    }}
                                  >
                                    {b.isShared ? '⊕ Shared' : '○ Private'}
                                  </button>
                                )}
                              </div>
                              {b.pipelineStage === 'syncing' || b.pipelineStage === 'processing' ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: BD.blue, flexShrink: 0, marginLeft: 10 }}>
                                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: BD.blue, display: 'inline-block' }} />
                                  {b.pipelineStage === 'syncing' ? 'Syncing…' : 'Processing…'}
                                </span>
                              ) : (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: healthy ? BD.green : BD.amber, flexShrink: 0, marginLeft: 10 }}>
                                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: healthy ? BD.green : BD.amber, display: 'inline-block' }} />
                                  {healthy ? 'Healthy' : 'Needs Attention'}
                                </span>
                              )}
                            </div>

                            {/* Slug */}
                            {b.slug && <code style={{ fontSize: 11, color: BD.textMuted, background: BD.codeBg, padding: '2px 7px', borderRadius: 4, border: `1px solid ${BD.border}`, display: 'inline-block', marginBottom: 14 }}>{b.slug}</code>}
                            {b._locationId && b._locationId !== '__shared__' && (
                              <div style={{ marginBottom: 12 }}>
                                <LocationIdentity
                                  locationId={b._locationId}
                                  name={getLocationName(b._locationId)}
                                  fallbackName="Unknown Location"
                                  compact
                                  shortId
                                  nameColor={BD.textSec}
                                  idColor={BD.textMuted}
                                  idFontSize={11}
                                  nameWeight={500}
                                />
                              </div>
                            )}

                            {/* Mini stats */}
                            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                              {[
                                { icon: '📡', val: channelCount,       label: 'channels' },
                                { icon: '▶',  val: b.videoCount || 0, label: 'videos' },
                                { icon: '✅', val: b.docCount || 0,   label: 'indexed' },
                                { icon: '🧩', val: b.chunkCount || 0, label: 'chunks' },
                              ].map(s => (
                                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <span style={{ fontSize: 13 }}>{s.icon}</span>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: BD.textPri }}>{s.val.toLocaleString()}</span>
                                  <span style={{ fontSize: 12, color: BD.textMuted }}>{s.label}</span>
                                </div>
                              ))}
                            </div>

                            <div style={{ fontSize: 12, color: BD.textMuted, marginBottom: pendingCount > 0 ? 10 : 0 }}>
                              Last synced: {b.lastSynced ? bdTimeAgo(b.lastSynced) : b.updatedAt ? bdTimeAgo(b.updatedAt) : 'Never'}
                            </div>

                            {pendingCount > 0 && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#2d1f00', border: `1px solid ${BD.amber}33`, borderRadius: 6, padding: '6px 10px', fontSize: 12, color: BD.amber }}>
                                <span>⚠</span> {pendingCount} pending transcription
                              </div>
                            )}

                            {/* Footer: docs + changelog badges */}
                            {((b.docsHistory?.length > 0) || ((b.notes || []).length + (b.syncLog || []).length) > 0) && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${BD.border}` }}>
                                {b.docsHistory?.length > 0 && (
                                  <span style={{ fontSize: 12, fontWeight: 600, color: BD.blue, padding: '3px 8px', borderRadius: 6, background: `${BD.blue}18`, border: `1px solid ${BD.blue}33` }}>
                                    📄 Docs · v{b.docsHistory.length}
                                  </span>
                                )}
                                {((b.notes || []).length + (b.syncLog || []).length) > 0 && (
                                  <span style={{ fontSize: 12, color: BD.textMuted, padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: `1px solid ${BD.border}` }}>
                                    {(b.notes || []).length + (b.syncLog || []).length} changes
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Brain Detail ── */}
            {selectedBrain && (
              <AdminBrainDetail
                brain={selectedBrain}
                adminKey={adminKey}
                brainLocQ={brainLocQ}
                onBack={() => setSelectedBrain(null)}
                onRefresh={loadSharedBrains}
                onFlash={flash}
                onDeleted={async (brainId) => {
                  const locQ = selectedBrain?._locationId && selectedBrain._locationId !== '__shared__'
                    ? `?loc=${encodeURIComponent(selectedBrain._locationId)}` : '';
                  const res = await adminFetch(`/brain/${brainId}${locQ}`, { method: 'DELETE', adminKey });
                  if (res.success || res.deleted) {
                    setSelectedBrain(null);
                    toast.success('Brain deleted');
                    loadSharedBrains();
                  } else {
                    toast.error(res.error || 'Failed to delete brain');
                  }
                }}
                onBrainUpdated={(updated) => {
                  setSelectedBrain(prev => ({ ...prev, ...updated }));
                  setSharedBrains(prev => prev.map(b => b.brainId === updated.brainId ? { ...b, ...updated } : b));
                }}
              />
            )}
            {false && selectedBrain && (
              <div>
                {/* Sub-tabs */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
                  {['progress', 'channels', 'videos', 'settings'].map(t => (
                    <button key={t} onClick={() => setBrainDetailTab(t)} style={TAB_STYLE(brainDetailTab === t)}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Progress sub-tab */}
                {brainDetailTab === 'progress' && (
                  <div>
                    {brainStatus ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
                        {[
                          { label: 'Stage',      value: brainStatus.stage || '—', color: '#a5b4fc' },
                          { label: 'Queued',     value: brainStatus.queuedCount  ?? '—', color: '#facc15' },
                          { label: 'Processed',  value: brainStatus.processedCount ?? '—', color: '#4ade80' },
                          { label: 'Total',      value: brainStatus.totalChunks ?? '—', color: '#e5e7eb' },
                        ].map(c => (
                          <div key={c.label} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '14px 16px' }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</div>
                            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{c.label}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ color: '#6b7280', fontSize: 13 }}>Loading status…</p>
                    )}
                    <button
                      disabled={brainSyncing}
                      onClick={async () => {
                        setBrainSyncing(true);
                        await adminFetch(`/brain/${selectedBrain.brainId}/sync${brainLocQ}`, { method: 'POST', adminKey });
                        await loadBrainDetail(selectedBrain);
                        setBrainSyncing(false);
                        toast.success('Sync queued');
                      }}
                      style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '9px 20px', fontSize: 14, fontWeight: 600, cursor: brainSyncing ? 'not-allowed' : 'pointer', opacity: brainSyncing ? 0.6 : 1 }}
                    >
                      {brainSyncing ? 'Syncing…' : '↻ Trigger Sync'}
                    </button>
                  </div>
                )}

                {/* Channels sub-tab */}
                {brainDetailTab === 'channels' && (
                  <div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                      <input
                        value={brainChannelInput}
                        onChange={e => setBrainChannelInput(e.target.value)}
                        placeholder="YouTube channel URL or ID…"
                        style={{ flex: 1, padding: '9px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#e5e7eb', fontSize: 13 }}
                      />
                      <button
                        disabled={brainChannelAdding || !brainChannelInput.trim()}
                        onClick={async () => {
                          setBrainChannelAdding(true);
                          const res = await adminFetch(`/brain/${selectedBrain.brainId}/channels${brainLocQ}`, {
                            method: 'POST', adminKey, body: { channelUrl: brainChannelInput.trim() },
                          });
                          setBrainChannelAdding(false);
                          if (res.success) {
                            setBrainChannelInput('');
                            toast.success('Channel added');
                            await loadBrainDetail(selectedBrain);
                          } else {
                            toast.error(res.error);
                          }
                        }}
                        style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: (brainChannelAdding || !brainChannelInput.trim()) ? 'not-allowed' : 'pointer', opacity: (brainChannelAdding || !brainChannelInput.trim()) ? 0.5 : 1 }}
                      >
                        {brainChannelAdding ? 'Adding…' : '+ Add'}
                      </button>
                    </div>
                    {(selectedBrain.channels || []).length === 0 ? (
                      <p style={{ color: '#4b5563', fontSize: 13 }}>No channels yet.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {(selectedBrain.channels || []).map(ch => (
                          <div key={ch.channelId} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ overflow: 'hidden' }}>
                              <div style={{ color: '#e5e7eb', fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{ch.channelTitle || ch.channelId}</div>
                              <div style={{ color: '#4b5563', fontSize: 12, fontFamily: 'monospace' }}>{ch.channelUrl || ch.channelId}</div>
                            </div>
                            <button
                              onClick={() => {
                                confirmToast(`Remove channel "${ch.channelTitle || ch.channelId}"?`, async () => {
                                  const res = await adminFetch(`/brain/${selectedBrain.brainId}/channels/${ch.channelId}${brainLocQ}`, { method: 'DELETE', adminKey });
                                  if (res.success) { toast.success('Channel removed'); await loadBrainDetail(selectedBrain); }
                                  else toast.error(res.error);
                                });
                              }}
                              style={{ background: 'none', border: '1px solid #f87171', borderRadius: 8, color: '#f87171', padding: '4px 10px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
                            >Remove</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Videos sub-tab */}
                {brainDetailTab === 'videos' && (
                  <div>
                    <div style={{ marginBottom: 10, color: '#9ca3af', fontSize: 13 }}>
                      {brainVideos.length} video{brainVideos.length !== 1 ? 's' : ''} in this brain
                    </div>
                    {brainVideos.length === 0 ? (
                      <p style={{ color: '#4b5563', fontSize: 13 }}>No videos yet. Add channels and trigger a sync.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 500, overflowY: 'auto' }}>
                        {brainVideos.map((v, i) => (
                          <div key={v.videoId || i} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: v.processed ? '#14532d' : '#2a2a2a', color: v.processed ? '#4ade80' : '#6b7280', flexShrink: 0 }}>
                              {v.processed ? '✓' : '⏳'}
                            </span>
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                              <div style={{ color: '#e5e7eb', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.title || v.videoId}</div>
                              {v.channelTitle && <div style={{ color: '#4b5563', fontSize: 11 }}>{v.channelTitle}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Settings sub-tab */}
                {brainDetailTab === 'settings' && (
                  <div style={{ maxWidth: 480 }}>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Name</label>
                      <input
                        value={brainSettingsForm.name}
                        onChange={e => setBrainSettingsForm(p => ({ ...p, name: e.target.value }))}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#e5e7eb', fontSize: 14 }}
                      />
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Description</label>
                      <textarea
                        value={brainSettingsForm.description}
                        onChange={e => setBrainSettingsForm(p => ({ ...p, description: e.target.value }))}
                        rows={3}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#e5e7eb', fontSize: 14, resize: 'vertical' }}
                      />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 20 }}>
                      <input
                        type="checkbox"
                        checked={brainSettingsForm.autoSync}
                        onChange={e => setBrainSettingsForm(p => ({ ...p, autoSync: e.target.checked }))}
                      />
                      <span style={{ color: '#e5e7eb', fontSize: 14 }}>Auto-sync channels daily</span>
                    </label>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        disabled={brainSettingsSaving}
                        onClick={async () => {
                          setBrainSettingsSaving(true);
                          const res = await adminFetch(`/brain/${selectedBrain.brainId}${brainLocQ}`, {
                            method: 'PATCH', adminKey,
                            body: { name: brainSettingsForm.name, description: brainSettingsForm.description, autoSync: brainSettingsForm.autoSync },
                          });
                          setBrainSettingsSaving(false);
                          if (res.success) {
                            toast.success('Brain settings saved');
                            setSelectedBrain(prev => ({ ...prev, name: brainSettingsForm.name, description: brainSettingsForm.description, autoSync: brainSettingsForm.autoSync }));
                            setSharedBrains(prev => prev.map(b => b.brainId === selectedBrain.brainId ? { ...b, ...res.data } : b));
                          } else {
                            toast.error(res.error);
                          }
                        }}
                        style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: brainSettingsSaving ? 'not-allowed' : 'pointer', opacity: brainSettingsSaving ? 0.6 : 1 }}
                      >
                        {brainSettingsSaving ? 'Saving…' : 'Save Settings'}
                      </button>
                      <button
                        onClick={() => {
                          confirmToast(`Delete brain "${selectedBrain.name}"? This will remove all videos and data.`, async () => {
                            const res = await adminFetch(`/brain/${selectedBrain.brainId}${brainLocQ}`, { method: 'DELETE', adminKey });
                            if (res.success) {
                              toast.success('Brain deleted');
                              setSelectedBrain(null);
                              setBrainStatus(null);
                              setBrainVideos([]);
                              loadSharedBrains();
                            } else {
                              toast.error(res.error);
                            }
                          });
                        }}
                        style={{ background: 'none', border: '1px solid #f87171', borderRadius: 8, color: '#f87171', padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}
                      >Delete Brain</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Create Brain Modal */}
            {showCreateBrain && (
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                onClick={() => setShowCreateBrain(false)}
              >
                <div onClick={e => e.stopPropagation()} style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 16, padding: '24px 28px', width: '100%', maxWidth: 440 }}>
                  <h3 style={{ color: '#fff', margin: '0 0 20px', fontSize: 16 }}>Create Shared Brain</h3>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Name *</label>
                    <input
                      value={brainForm.name}
                      onChange={e => setBrainForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Company Knowledge Base"
                      autoFocus
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#e5e7eb', fontSize: 14 }}
                    />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Description</label>
                    <textarea
                      value={brainForm.description}
                      onChange={e => setBrainForm(p => ({ ...p, description: e.target.value }))}
                      placeholder="What knowledge does this brain contain?"
                      rows={2}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#e5e7eb', fontSize: 14, resize: 'vertical' }}
                    />
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Primary Channel (optional)</label>
                    <input
                      value={brainForm.primaryChannel}
                      onChange={e => setBrainForm(p => ({ ...p, primaryChannel: e.target.value }))}
                      placeholder="YouTube channel URL or ID"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#e5e7eb', fontSize: 14 }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      disabled={brainFormSaving || !brainForm.name.trim()}
                      onClick={async () => {
                        setBrainFormSaving(true);
                        const res = await adminFetch('/brain/create', {
                          method: 'POST', adminKey,
                          body: {
                            name: brainForm.name.trim(),
                            description: brainForm.description.trim(),
                            ...(brainForm.primaryChannel.trim() ? { primaryChannel: brainForm.primaryChannel.trim() } : {}),
                          },
                        });
                        setBrainFormSaving(false);
                        if (res.success) {
                          setShowCreateBrain(false);
                          toast.success('Brain created');
                          await loadSharedBrains();
                        } else {
                          toast.error(res.error);
                        }
                      }}
                      style={{ flex: 1, background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '10px', fontSize: 14, fontWeight: 600, cursor: (brainFormSaving || !brainForm.name.trim()) ? 'not-allowed' : 'pointer', opacity: (brainFormSaving || !brainForm.name.trim()) ? 0.5 : 1 }}
                    >
                      {brainFormSaving ? 'Creating…' : 'Create Brain'}
                    </button>
                    <button onClick={() => setShowCreateBrain(false)} style={{ padding: '10px 20px', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
            </div>
            )}

            {/* ── Pipeline view ── */}
            {adminBrainView === 'pipeline' && (() => {
              const PIPE_COLS = [
                { id: 'needs_sync',  label: 'Needs Sync',  subtitle: 'Waiting for first sync',    icon: '⊙', color: '#6b7280', bgColor: '#1a1f2a' },
                { id: 'syncing',     label: 'Syncing',     subtitle: 'Pulling from YouTube',       icon: '✦', color: BD.blue,   bgColor: '#0d1a2e' },
                { id: 'processing',  label: 'Processing',  subtitle: 'Transcribing & embedding',  icon: '⚙', color: BD.amber,  bgColor: '#2d1f00' },
                { id: 'ready',       label: 'Ready',       subtitle: 'Up to date & queryable',    icon: '✓', color: BD.green,  bgColor: '#062010' },
              ];
              function catBrain(b) {
                if (b.pipelineStage) return b.pipelineStage;
                if (!(b.docCount > 0) && !(b.channels?.length > 0)) return 'needs_sync';
                if (!(b.docCount > 0)) return 'syncing';
                return 'ready';
              }
              const cat = {};
              for (const col of PIPE_COLS) cat[col.id] = sharedBrains.filter(b => catBrain(b) === col.id);
              return (
                <div>
                  <div style={{ marginBottom: 24 }}>
                    <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: BD.textPri }}>Pipeline</h2>
                    <p style={{ margin: 0, fontSize: 14, color: BD.textMuted }}>{sharedBrains.length} brain{sharedBrains.length !== 1 ? 's' : ''} across the ingestion pipeline</p>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                    {PIPE_COLS.map(col => {
                      const items = cat[col.id] || [];
                      return (
                        <div key={col.id}>
                          {/* Column header */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 16, color: col.color }}>{col.icon}</span>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: BD.textPri }}>{col.label}</div>
                                <div style={{ fontSize: 11, color: BD.textMuted }}>{col.subtitle}</div>
                              </div>
                            </div>
                            <span style={{ background: col.bgColor, color: col.color, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{items.length}</span>
                          </div>
                          {/* Brain mini-cards */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {items.length === 0 && (
                              <div style={{ background: BD.card, border: `1px dashed ${BD.border}`, borderRadius: 10, padding: '20px 14px', textAlign: 'center', fontSize: 12, color: BD.border }}>
                                No brains
                              </div>
                            )}
                            {items.map(b => (
                              <div
                                key={`${b._locationId}-${b.brainId}`}
                                onClick={() => { setAdminBrainView('brains'); loadBrainDetail(b); }}
                                style={{ background: BD.card, border: `1px solid ${BD.border}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'border-color .15s' }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = BD.blue + '88'; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = BD.border; }}
                              >
                                <div style={{ fontSize: 13, fontWeight: 700, color: BD.textPri, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                                <code style={{ fontSize: 10, color: BD.textMuted }}>{b.slug}</code>
                                {b._locationId && b._locationId !== '__shared__' && (
                                  <div style={{ marginTop: 6, fontSize: 11, color: BD.textMuted }}>
                                    <LocationIdentity
                                      locationId={b._locationId}
                                      name={getLocationName(b._locationId)}
                                      fallbackName="Unknown Location"
                                      compact
                                      shortId
                                      nameColor={BD.textSec}
                                      idColor={BD.textMuted}
                                      idFontSize={10}
                                      nameWeight={500}
                                    />
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: BD.textSec }}>
                                  <span>▶ {b.docCount || 0} videos</span>
                                  <span>🧩 {b.chunkCount || 0} chunks</span>
                                </div>
                                {b.updatedAt && (
                                  <div style={{ marginTop: 6, fontSize: 11, color: BD.textMuted }}>{bdTimeAgo(b.updatedAt)}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── Search view ── */}
            {adminBrainView === 'search' && (
              <AdminSearchView brains={sharedBrains} adminKey={adminKey} getLocationLabel={getLocationLabel} />
            )}

            {/* ── DEAD CODE: old search view preserved ── */}
            {false && adminBrainView === 'search' && (
              <div>
                <div style={{ marginBottom: 20 }}>
                  <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>Ask Brain</h2>
                  <p style={{ margin: 0, fontSize: 14, color: '#6b7280' }}>Search across any brain using the admin key.</p>
                </div>
                {/* Controls */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                  <select
                    value={brainSearchId}
                    onChange={e => { setBrainSearchId(e.target.value); setBrainAnswer(''); setBrainSources(null); setBrainSearchErr(''); }}
                    style={{ padding: '9px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#e5e7eb', fontSize: 13, width: 220, flexShrink: 0 }}
                  >
                    <option value="">— Select a brain —</option>
                    {sharedBrains.map(b => (
                      <option key={`${b._locationId}-${b.brainId}`} value={JSON.stringify({ brainId: b.brainId, locQ: (!b.isShared && b._locationId) ? `?loc=${encodeURIComponent(b._locationId)}` : '' })}>
                        {b.name}{b.isShared ? '' : ` (${b._locationId?.slice(0,10)}…)`}
                      </option>
                    ))}
                  </select>
                  <input
                    value={brainSearchQuery}
                    onChange={e => setBrainSearchQuery(e.target.value)}
                    onKeyDown={async e => {
                      if (e.key !== 'Enter' || brainSearching || !brainSearchQuery.trim() || !brainSearchId) return;
                      const { brainId, locQ } = JSON.parse(brainSearchId);
                      setBrainSearching(true); setBrainAnswer(''); setBrainSources(null); setBrainSearchErr('');
                      try {
                        const res = await fetch(`/brain/${brainId}/ask${locQ}`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
                          body: JSON.stringify({ query: brainSearchQuery.trim(), k: 20 }),
                        });
                        if (!res.ok) { const j = await res.json().catch(() => ({})); setBrainSearchErr(j.error || `Error ${res.status}`); setBrainSearching(false); return; }
                        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
                        while (true) {
                          const { done, value } = await reader.read(); if (done) break;
                          buf += dec.decode(value, { stream: true });
                          const lines = buf.split('\n'); buf = lines.pop();
                          for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            try {
                              const evt = JSON.parse(line.slice(6));
                              if (evt.type === 'sources') setBrainSources(evt.sources);
                              if (evt.type === 'text') setBrainAnswer(prev => prev + evt.text);
                              if (evt.type === 'error') setBrainSearchErr(evt.error);
                              if (evt.type === 'done') setBrainSearching(false);
                            } catch {}
                          }
                        }
                      } catch (err) { setBrainSearchErr(err.message); }
                      setBrainSearching(false);
                    }}
                    placeholder="Ask anything… (press Enter)"
                    style={{ flex: 1, minWidth: 200, padding: '9px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#e5e7eb', fontSize: 13 }}
                  />
                  <button
                    disabled={brainSearching || !brainSearchQuery.trim() || !brainSearchId}
                    onClick={async () => {
                      if (brainSearching || !brainSearchQuery.trim() || !brainSearchId) return;
                      const { brainId, locQ } = JSON.parse(brainSearchId);
                      setBrainSearching(true); setBrainAnswer(''); setBrainSources(null); setBrainSearchErr('');
                      try {
                        const res = await fetch(`/brain/${brainId}/ask${locQ}`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
                          body: JSON.stringify({ query: brainSearchQuery.trim(), k: 20 }),
                        });
                        if (!res.ok) { const j = await res.json().catch(() => ({})); setBrainSearchErr(j.error || `Error ${res.status}`); setBrainSearching(false); return; }
                        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
                        while (true) {
                          const { done, value } = await reader.read(); if (done) break;
                          buf += dec.decode(value, { stream: true });
                          const lines = buf.split('\n'); buf = lines.pop();
                          for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            try {
                              const evt = JSON.parse(line.slice(6));
                              if (evt.type === 'sources') setBrainSources(evt.sources);
                              if (evt.type === 'text') setBrainAnswer(prev => prev + evt.text);
                              if (evt.type === 'error') setBrainSearchErr(evt.error);
                              if (evt.type === 'done') setBrainSearching(false);
                            } catch {}
                          }
                        }
                      } catch (err) { setBrainSearchErr(err.message); }
                      setBrainSearching(false);
                    }}
                    style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '9px 20px', fontSize: 14, fontWeight: 600, cursor: (brainSearching || !brainSearchQuery.trim() || !brainSearchId) ? 'not-allowed' : 'pointer', opacity: (brainSearching || !brainSearchQuery.trim() || !brainSearchId) ? 0.5 : 1, flexShrink: 0 }}
                  >{brainSearching ? '…' : 'Search'}</button>
                </div>
                {brainSearching && !brainAnswer && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: '#6b7280', fontSize: 13 }}>
                    <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: 16 }}>⟳</span>
                    Analyzing transcripts…
                  </div>
                )}
                {brainAnswer && (
                  <div style={{ background: '#0a1628', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 12, padding: '20px 22px', marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#2563eb', marginBottom: 10 }}>Best Answer</div>
                    <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {brainAnswer}
                      {brainSearching && <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#2563eb', marginLeft: 2, animation: 'pulse 1s ease-in-out infinite', verticalAlign: 'text-bottom' }} />}
                    </div>
                  </div>
                )}
                {brainSearchErr && (
                  <div style={{ background: '#1c0a00', border: '1px solid #dc262644', borderRadius: 10, padding: '14px 16px', color: '#f87171', fontSize: 13 }}>{brainSearchErr}</div>
                )}
                {brainSources?.length > 0 && !brainSearching && (() => {
                  const ANS_COLORS = ['#f59e0b', '#94a3b8', '#cd7c4a', '#6b7280', '#6b7280'];
                  const ANS_LABELS = ['#1 Best', '#2', '#3', '#4', '#5'];
                  const maxScore = Math.max(...brainSources.map(s => s.score || 0)) || 1;
                  const top5 = [...brainSources].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
                  return (
                    <div style={{ marginTop: 16 }}>
                      <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top 5 Sources</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {top5.map((s, i) => {
                          const pct = Math.round(((s.score || 0) / maxScore) * 100);
                          const color = ANS_COLORS[i];
                          return (
                            <div key={i} style={{ background: i === 0 ? 'rgba(245,158,11,0.05)' : '#1a1a1a', border: `1px solid ${i === 0 ? '#f59e0b55' : '#2a2a2a'}`, borderRadius: 10, padding: '14px 16px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                                <span style={{ fontSize: 10, fontWeight: 800, color, background: color + '18', border: `1px solid ${color}44`, borderRadius: 6, padding: '2px 8px' }}>{ANS_LABELS[i]}</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sourceLabel || `Source ${i + 1}`}</span>
                                <span style={{ fontSize: 13, fontWeight: 800, color }}>{pct}%</span>
                              </div>
                              <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.07)', marginBottom: 10, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color }} />
                              </div>
                              {s.excerpt && <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', lineHeight: 1.75 }}>{s.excerpt}{s.excerpt.length >= 300 ? '…' : ''}</p>}
                              {s.url && <a href={s.url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, fontSize: 11, color: '#6b7280', textDecoration: 'none' }}>↗ Watch on YouTube</a>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── MCP view ── */}
            {adminBrainView === 'mcp' && (() => {
              const MCP_TOOLS_ADMIN = [
                { name: 'search_knowledge', desc: 'Semantic search within a specific brain.',                                        inputs: 'query (string), brain (string), top_k? (number)' },
                { name: 'chat_with_brain',  desc: 'Full RAG pipeline — retrieves context then generates a grounded response.',       inputs: 'message (string), brain (string), conversation_history? (Message[])' },
                { name: 'get_video',        desc: 'Get full transcript and metadata for a specific YouTube video.',                  inputs: 'video_id (string)' },
                { name: 'list_brains',      desc: 'Returns all brains with health metrics and channel info.',                        inputs: 'none' },
                { name: 'add_brain',        desc: 'Create a new brain from a YouTube channel URL.',                                 inputs: 'name (string), slug (string), channel_url (string), channel_name (string)' },
                { name: 'add_channel',      desc: 'Add a supplementary channel to an existing brain.',                              inputs: 'brain_slug (string), channel_url (string), channel_name (string)' },
              ];
              const baseUrl = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : '';
              const sseUrl = `${baseUrl}/sse`;
              const clientConfigs = {
                claude:   { label: 'Claude Code', config: JSON.stringify({ mcpServers: { 'hl-pro-tools': { command: 'curl', args: ['-N', sseUrl] } } }, null, 2) },
                cursor:   { label: 'Cursor',      config: JSON.stringify({ mcp: { servers: { 'hl-pro-tools': { url: sseUrl, transport: 'sse' } } } }, null, 2) },
                windsurf: { label: 'Windsurf',    config: JSON.stringify({ mcpServers: { 'hl-pro-tools': { serverUrl: sseUrl, transport: 'sse' } } }, null, 2) },
                generic:  { label: 'Generic',     config: JSON.stringify({ server: { url: sseUrl, transport: 'sse', protocol: 'mcp' } }, null, 2) },
              };
              const activeConfig = clientConfigs[brainMcpTab]?.config || '';
              const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: BD.textMuted, borderBottom: `1px solid ${BD.border}` };
              const tdStyle = { padding: '12px 14px', fontSize: 13, color: BD.textPri, borderBottom: `1px solid ${BD.border}88`, verticalAlign: 'top' };
              return (
                <div>
                  <div style={{ marginBottom: 24 }}>
                    <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: BD.textPri }}>MCP</h2>
                    <p style={{ margin: 0, fontSize: 14, color: BD.textMuted }}>Model Context Protocol server configuration</p>
                  </div>
                  {/* How it works */}
                  <div style={{ background: BD.card, border: `1px solid ${BD.border}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
                    <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: BD.textPri }}>How it works</h3>
                    <p style={{ margin: '0 0 12px', fontSize: 14, color: BD.textSec, lineHeight: 1.7 }}>
                      This server exposes a Model Context Protocol (MCP) endpoint over Server-Sent Events (SSE). Connect any MCP-compatible AI client to gain access to your brain knowledge bases.
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <code style={{ background: BD.codeBg, border: `1px solid ${BD.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, color: '#93c5fd' }}>{sseUrl}</code>
                      <span style={{ fontSize: 13, color: BD.textMuted }}>&nbsp;·&nbsp; {MCP_TOOLS_ADMIN.length} tools available</span>
                    </div>
                  </div>
                  {/* Client Configuration */}
                  <div style={{ background: BD.card, border: `1px solid ${BD.border}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: BD.textPri }}>Client Configuration</h3>
                      <button
                        onClick={() => { navigator.clipboard.writeText(activeConfig).then(() => { setBrainMcpCopied(true); setTimeout(() => setBrainMcpCopied(false), 2000); }); }}
                        style={{ ...bdBtnS, fontSize: 12, padding: '5px 12px' }}
                      >{brainMcpCopied ? '✓ Copied!' : 'Copy config'}</button>
                    </div>
                    {/* Client tabs — underline style */}
                    <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: `1px solid ${BD.border}` }}>
                      {Object.entries(clientConfigs).map(([key, val]) => (
                        <button key={key} onClick={() => setBrainMcpTab(key)} style={{
                          background: 'none', border: 'none',
                          borderBottom: brainMcpTab === key ? `2px solid ${BD.blue}` : '2px solid transparent',
                          color: brainMcpTab === key ? BD.textPri : BD.textMuted,
                          padding: '8px 16px', fontSize: 13, fontWeight: brainMcpTab === key ? 600 : 400,
                          cursor: 'pointer', marginBottom: -1,
                        }}>{val.label}</button>
                      ))}
                    </div>
                    <pre style={{ background: BD.codeBg, border: `1px solid ${BD.border}`, borderRadius: 8, padding: '14px 16px', fontSize: 12, color: '#93c5fd', overflowX: 'auto', margin: 0, lineHeight: 1.7 }}>{activeConfig}</pre>
                  </div>
                  {/* Active Brains */}
                  <div style={{ background: BD.card, border: `1px solid ${BD.border}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
                    <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: BD.textPri }}>Active Brains</h3>
                    {sharedBrains.length === 0 ? (
                      <p style={{ color: BD.textMuted, fontSize: 13, margin: 0 }}>No brains configured.</p>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {sharedBrains.map(b => (
                          <div key={`${b._locationId}-${b.brainId}`} style={{ display: 'flex', alignItems: 'center', gap: 8, background: BD.bg, border: `1px solid ${BD.border}`, borderRadius: 8, padding: '8px 14px' }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: BD.textPri }}>{b.name}</span>
                            <code style={{ fontSize: 11, color: BD.textMuted, background: BD.codeBg, padding: '2px 6px', borderRadius: 4 }}>{b.slug}</code>
                            {!b.isShared && b._locationId && (
                              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 5, background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.24)', fontWeight: 600 }}>
                                {getLocationLabel(b._locationId, 'Unknown Location')}
                              </span>
                            )}
                            {b.isShared
                              ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 5, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)', fontWeight: 600 }}>shared</span>
                              : <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 5, background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', fontWeight: 600, fontFamily: 'monospace' }}>{b._locationId?.slice(0,10)}…</span>
                            }
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Available Tools */}
                  <div style={{ background: BD.card, border: `1px solid ${BD.border}`, borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BD.border}` }}>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: BD.textPri }}>Available Tools</h3>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Tool</th>
                          <th style={thStyle}>Description</th>
                          <th style={thStyle}>Inputs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {MCP_TOOLS_ADMIN.map(tool => (
                          <tr key={tool.name}>
                            <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}><span style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: 13 }}>{tool.name}</span></td>
                            <td style={{ ...tdStyle, color: BD.textSec }}>{tool.desc}</td>
                            <td style={{ ...tdStyle, color: BD.textMuted, fontFamily: 'monospace', fontSize: 12 }}>{tool.inputs}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        </div>
      </div>
      {/* ── end main area ── */}

      {/* Admin Edit Modals — rendered inside outer flex wrapper so they overlay everything */}
      {adminModal?.type === 'edit-workflow' && (
        <EditWorkflowModal
          modal={adminModal}
          adminKey={adminKey}
          locationLabel={getLocationLabel(adminModal.locationId)}
          onClose={() => setAdminModal(null)}
          onSaved={(locationId, updatedWf) => {
            setAdminModal(null);
            toast.success(`Workflow "${updatedWf.name}" updated`);
            setTroubleshootData((prev) => {
              const loc = prev[locationId] || {};
              return { ...prev, [locationId]: { ...loc, workflows: (loc.workflows || []).map(w => w.id === updatedWf.id ? updatedWf : w) } };
            });
          }}
          onFlash={(msg) => msg.startsWith('✗') ? toast.error(msg.replace(/^✗\s*/, '')) : toast.success(msg.replace(/^✓\s*/, ''))}
        />
      )}
      {adminModal?.type === 'edit-connection' && (
        <EditConnectionModal
          modal={adminModal}
          adminKey={adminKey}
          locationLabel={getLocationLabel(adminModal.locationId)}
          onClose={() => setAdminModal(null)}
          onSaved={(locationId, cat, newCfg) => {
            setAdminModal(null);
            toast.success(`${cat} connection updated`);
            setTroubleshootData((prev) => {
              const loc = prev[locationId] || {};
              return { ...prev, [locationId]: { ...loc, connections: { ...loc.connections, [cat]: newCfg } } };
            });
          }}
          onFlash={(msg) => msg.startsWith('✗') ? toast.error(msg.replace(/^✗\s*/, '')) : toast.success(msg.replace(/^✓\s*/, ''))}
        />
      )}
    </div>
  );
}

// ── Billing Modal ─────────────────────────────────────────────────────────────

function BillingModal({ modal, adminKey, getLocationName, getLocationLabel, onClose, onSaved, onFlash }) {
  const [form, setForm] = useState({
    locationId:  modal.data?.locationId || modal.locationId || '',
    tier:        modal.data?.tier       || 'bronze',
    status:      modal.data?.status     || 'trial',
    amount:      modal.data?.amount     ?? '',
    currency:    modal.data?.currency   || 'usd',
    interval:    modal.data?.interval   || 'month',
    notes:       modal.data?.notes      || '',
    // invoice fields
    description: modal.data?.description || '',
    invAmount:   modal.data?.amount      || '',
    invStatus:   modal.data?.status      || 'pending',
    invDate:     modal.data?.date        ? new Date(modal.data.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      let res;
      if (modal.type === 'new-subscription' || modal.type === 'edit-subscription') {
        const locId = form.locationId || modal.locationId;
        if (!locId) { onFlash('✗ Location ID required.'); setSaving(false); return; }
        res = await adminFetch(`/admin/billing/${locId}`, {
          method: 'POST', adminKey,
          body: {
            tier: form.tier, status: form.status,
            amount: form.amount !== '' ? Number(form.amount) : undefined,
            currency: form.currency, interval: form.interval, notes: form.notes,
          },
        });
      } else if (modal.type === 'add-invoice') {
        res = await adminFetch(`/admin/billing/${modal.locationId}/invoice`, {
          method: 'POST', adminKey,
          body: { amount: Number(form.invAmount), description: form.description, status: form.invStatus, date: new Date(form.invDate).getTime() },
        });
      } else if (modal.type === 'edit-invoice') {
        res = await adminFetch(`/admin/billing/${modal.locationId}/invoice/${modal.data.id}`, {
          method: 'PATCH', adminKey,
          body: { amount: Number(form.invAmount), description: form.description, status: form.invStatus, date: new Date(form.invDate).getTime() },
        });
      }
      if (res?.success) onSaved();
      else onFlash(`✗ ${res?.error || 'Save failed'}`);
    } catch { onFlash('✗ Request failed'); }
    setSaving(false);
  };

  const isInvoice = modal.type === 'add-invoice' || modal.type === 'edit-invoice';
  const isNew     = modal.type === 'new-subscription';
  const activeLocationId = form.locationId || modal.locationId || '';
  const activeLocationName = getLocationName?.(activeLocationId) || '';
  const activeLocationLabel = activeLocationId
    ? (getLocationLabel?.(activeLocationId, 'Unknown Location') || activeLocationId)
    : '';

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
  const box     = { background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: 24, width: 'min(420px, 94vw)', maxHeight: '90vh', overflowY: 'auto' };
  const inp     = { width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box', marginBottom: 12 };
  const sel     = { ...inp, cursor: 'pointer' };
  const lbl     = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };

  const titles = { 'new-subscription': 'New Billing Record', 'edit-subscription': 'Edit Subscription', 'add-invoice': 'Add Invoice', 'edit-invoice': 'Edit Invoice' };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ color: '#fff', margin: 0, fontSize: 16 }}>{titles[modal.type]}</h3>
            {activeLocationLabel && (
              <p style={{ color: activeLocationName ? '#9ca3af' : '#6b7280', margin: '4px 0 0', fontSize: 12 }}>
                {activeLocationLabel}
              </p>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        {isNew && (
          <>
            <label style={lbl}>Location ID</label>
            <input style={inp} value={form.locationId} onChange={e => set('locationId', e.target.value)} placeholder="e.g. n26oX9nNg6MdIrAlZQDg" />
            {activeLocationName && (
              <p style={{ color: '#9ca3af', fontSize: 12, margin: '-6px 0 12px' }}>
                Matching location: {activeLocationName}
              </p>
            )}
          </>
        )}

        {!isInvoice && (
          <>
            <label style={lbl}>Tier (Integration Access)</label>
            <select style={sel} value={form.tier} onChange={e => set('tier', e.target.value)}>
              <option value="bronze">🥉 Bronze — 2 integrations</option>
              <option value="silver">🥈 Silver — 6 integrations</option>
              <option value="gold">🥇 Gold — 10 integrations</option>
              <option value="diamond">💎 Diamond — Unlimited</option>
            </select>

            <label style={lbl}>Status</label>
            <select style={sel} value={form.status} onChange={e => set('status', e.target.value)}>
              {['trial', 'active', 'past_due', 'cancelled', 'suspended'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
              <div>
                <label style={lbl}>Amount (USD)</label>
                <input style={inp} type="number" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="99" />
              </div>
              <div>
                <label style={lbl}>Currency</label>
                <select style={sel} value={form.currency} onChange={e => set('currency', e.target.value)}>
                  <option value="usd">USD</option>
                  <option value="eur">EUR</option>
                  <option value="gbp">GBP</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Interval</label>
                <select style={sel} value={form.interval} onChange={e => set('interval', e.target.value)}>
                  <option value="month">Monthly</option>
                  <option value="year">Yearly</option>
                </select>
              </div>
            </div>

            <label style={lbl}>Notes</label>
            <input style={inp} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Internal notes…" />
          </>
        )}

        {isInvoice && (
          <>
            <label style={lbl}>Description</label>
            <input style={inp} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Pro Plan - March 2026" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div>
                <label style={lbl}>Amount</label>
                <input style={inp} type="number" value={form.invAmount} onChange={e => set('invAmount', e.target.value)} placeholder="99" />
              </div>
              <div>
                <label style={lbl}>Status</label>
                <select style={sel} value={form.invStatus} onChange={e => set('invStatus', e.target.value)}>
                  {['pending', 'paid', 'overdue', 'refunded', 'void'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Date</label>
                <input style={inp} type="date" value={form.invDate} onChange={e => set('invDate', e.target.value)} />
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{ flex: 1, padding: '10px', background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            style={{ padding: '10px 20px', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Role Editor Modal (2-step wizard) ─────────────────────────────────────────
// Step 1: Role name + tool checkboxes (all 12, no tier filter)
// Step 2: Tier association — see which selected tools the tier covers

function RoleEditorModal({ mode, role, isBuiltin, allFeatures, adminKey, locationId, locationLabel, tiers, enabledIntegrations, onClose, onSaved, onReset, onFlash }) {
  const [step,         setStep]         = useState(1);
  const [name,         setName]         = useState(role?.name     || '');
  const [features,     setFeatures]     = useState(new Set(
    (role?.features || []).includes('*') ? allFeatures.map(f => f.key) : (role?.features || [])
  ));
  const [saving,       setSaving]       = useState(false);
  const [resetting,    setResetting]    = useState(false);
  const [selectedTier, setSelectedTier] = useState(role?.tier || '');

  // Built-in roles skip the wizard and use a single-step flow
  const useWizard = !isBuiltin;

  // For step 2: tier's allowed features (null = no restriction / all unlocked)
  const activeTierAllowed = selectedTier && tiers?.[selectedTier]?.allowedFeatures !== undefined
    ? tiers[selectedTier].allowedFeatures
    : null;

  // Which features need an integration (informational badge only)
  const needsIntegration = (key) => {
    const required = FEATURE_INTEGRATION_MAP[key];
    if (!required || enabledIntegrations === null) return false;
    return !required.some(r => enabledIntegrations.includes(r));
  };

  const toggle = (key) => {
    setFeatures(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const selectAll = () => setFeatures(new Set(allFeatures.map(f => f.key)));
  const clearAll  = () => setFeatures(new Set());

  const goNext = () => {
    if (!isBuiltin && !name.trim()) { onFlash('✗ Role name is required.'); return; }
    setStep(2);
  };

  const save = async () => {
    if (!isBuiltin && !name.trim()) { onFlash('✗ Role name is required.'); return; }
    setSaving(true);
    try {
      const isNew = mode === 'create';
      const path  = isNew
        ? `/admin/locations/${locationId}/custom-roles`
        : `/admin/locations/${locationId}/custom-roles/${role.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const data = await adminFetch(path, { method, adminKey, body: { name: name.trim(), features: [...features], tier: selectedTier || null } });
      if (data.success) onSaved(data.role, isNew);
      else onFlash(`✗ ${data.error}`);
    } catch { onFlash('✗ Save failed'); }
    setSaving(false);
  };

  const reset = () => {
    confirmToast(`Reset "${role?.name}" to its default features? This will remove any customization.`, async () => {
      setResetting(true);
      try {
        const data = await adminFetch(`/admin/locations/${locationId}/custom-roles/${role.id}/reset`, { method: 'POST', adminKey });
        if (data.success) onReset(data.role);
        else onFlash(`✗ ${data.error}`);
      } catch { onFlash('✗ Reset failed'); }
      setResetting(false);
    });
  };

  // ── Step 2: tier summary helpers ──────────────────────────────────────────
  const selectedFeatureObjs = allFeatures.filter(f => features.has(f.key));
  const tierCoversFeature   = (key) => !activeTierAllowed || activeTierAllowed.includes(key);

  const TIER_OPTIONS = [
    { key: '', label: 'No Restriction', color: '#6366f1', icon: '∞' },
    { key: 'bronze',  label: 'Bronze',  color: TIER_COLORS.bronze,  icon: '🥉' },
    { key: 'silver',  label: 'Silver',  color: TIER_COLORS.silver,  icon: '🥈' },
    { key: 'gold',    label: 'Gold',    color: TIER_COLORS.gold,    icon: '🥇' },
    { key: 'diamond', label: 'Diamond', color: TIER_COLORS.diamond, icon: '💎' },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 14, width: '100%', maxWidth: 580, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #222' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: 0, color: '#fff', fontSize: 16 }}>
                {mode === 'create' ? '+ Create Custom Role' : `✏️ Edit Role: ${role?.name}`}
              </h3>
              {isBuiltin && <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 12 }}>Editing this built-in role's features for this location only.</p>}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 20, lineHeight: 1, flexShrink: 0 }}>×</button>
          </div>

          {/* Step indicator — wizard only */}
          {useWizard && (
            <div style={{ display: 'flex', gap: 0, marginTop: 14 }}>
              {['Select Tools', 'Assign Tier'].map((label, i) => {
                const stepNum = i + 1;
                const active  = step === stepNum;
                const done    = step > stepNum;
                return (
                  <div key={stepNum} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, flexShrink: 0,
                        background: done ? '#22c55e' : active ? '#7c3aed' : '#222',
                        color: done || active ? '#fff' : '#4b5563',
                        border: `2px solid ${done ? '#22c55e' : active ? '#7c3aed' : '#333'}`,
                      }}>
                        {done ? '✓' : stepNum}
                      </div>
                      <span style={{ fontSize: 13, color: active ? '#e5e7eb' : done ? '#9ca3af' : '#4b5563', fontWeight: active ? 600 : 400 }}>{label}</span>
                    </div>
                    {i < 1 && <div style={{ flex: 1, height: 1, background: step > 1 ? '#22c55e44' : '#222', margin: '0 10px' }} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>

          {/* ── STEP 1: Role name + tool checkboxes ── */}
          {(!useWizard || step === 1) && (
            <>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Role Name</label>
              <input
                value={name}
                onChange={e => !isBuiltin && setName(e.target.value)}
                readOnly={isBuiltin}
                placeholder="e.g. Sales Team, Content Creator…"
                style={{ width: '100%', boxSizing: 'border-box', background: isBuiltin ? '#0d0d0d' : '#111', border: '1px solid #333', borderRadius: 8, color: isBuiltin ? '#4b5563' : '#e5e7eb', padding: '9px 12px', fontSize: 14, marginBottom: 20, cursor: isBuiltin ? 'not-allowed' : 'text' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <label style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Tools &amp; Features{' '}
                  <span style={{ color: '#6366f1', fontWeight: 700 }}>({features.size}/{allFeatures.length} selected)</span>
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={selectAll} style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#9ca3af', padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>Select All</button>
                  <button onClick={clearAll}  style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#9ca3af', padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>Clear</button>
                </div>
              </div>

              {(() => {
                // Group features by their group field
                const groups = {};
                allFeatures.forEach(f => {
                  const g = f.group || 'Other';
                  if (!groups[g]) groups[g] = [];
                  groups[g].push(f);
                });
                return Object.entries(groups).map(([groupName, groupFeatures]) => (
                  <div key={groupName} style={{ marginBottom: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ color: '#4b5563', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{groupName}</span>
                      <div style={{ flex: 1, height: 1, background: '#1e1e1e' }} />
                      <button onClick={() => {
                        const allChecked = groupFeatures.every(f => features.has(f.key));
                        setFeatures(prev => {
                          const next = new Set(prev);
                          groupFeatures.forEach(f => allChecked ? next.delete(f.key) : next.add(f.key));
                          return next;
                        });
                      }} style={{ background: 'none', border: '1px solid #222', borderRadius: 5, color: '#4b5563', padding: '1px 8px', cursor: 'pointer', fontSize: 11 }}>
                        {groupFeatures.every(f => features.has(f.key)) ? 'Deselect' : 'Select all'}
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      {groupFeatures.map(f => {
                        const checked    = features.has(f.key);
                        const missingInt = needsIntegration(f.key);
                        return (
                          <label key={f.key} onClick={() => toggle(f.key)}
                            title={missingInt ? `Integration not connected` : ''}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, background: checked ? '#6366f115' : '#111', border: `1px solid ${checked ? '#6366f1' : '#2a2a2a'}`, borderRadius: 8, padding: '9px 12px', cursor: 'pointer', transition: 'all .15s' }}>
                            <div style={{ width: 15, height: 15, borderRadius: 3, border: `2px solid ${checked ? '#6366f1' : '#444'}`, background: checked ? '#6366f1' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              {checked && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1, fontWeight: 700 }}>✓</span>}
                            </div>
                            <span style={{ fontSize: 13 }}>{f.icon}</span>
                            <span style={{ color: checked ? '#e5e7eb' : '#9ca3af', fontSize: 12, fontWeight: checked ? 500 : 400, flex: 1 }}>{f.label}</span>
                            {missingInt && <span style={{ fontSize: 10, color: '#78350f', background: '#451a03', padding: '1px 5px', borderRadius: 4 }}>🔗</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </>
          )}

          {/* ── STEP 2: Tier association ── */}
          {useWizard && step === 2 && (
            <>
              {/* Selected tools summary */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  Selected Tools ({selectedFeatureObjs.length})
                </label>
                {selectedFeatureObjs.length === 0
                  ? <p style={{ color: '#4b5563', fontSize: 13, margin: 0 }}>No tools selected — go back to choose at least one.</p>
                  : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {selectedFeatureObjs.map(f => (
                        <span key={f.key} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: '#6366f115', border: '1px solid #6366f133', color: '#a5b4fc' }}>
                          {f.icon} {f.label}
                        </span>
                      ))}
                    </div>
                  )
                }
              </div>

              {/* Tier selector */}
              <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                Plan Tier <span style={{ color: '#4b5563', fontWeight: 400, textTransform: 'none' }}>(optional — restricts which tools are accessible)</span>
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {TIER_OPTIONS.map(t => {
                  const active = selectedTier === t.key;
                  return (
                    <button key={t.key} onClick={() => setSelectedTier(t.key)}
                      style={{
                        padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        background: active ? t.color + '22' : '#111',
                        color:      active ? t.color : '#6b7280',
                        border:     `1px solid ${active ? t.color : '#2a2a2a'}`,
                        transition: 'all .15s',
                      }}>
                      {t.icon} {t.label}
                    </button>
                  );
                })}
              </div>

              {/* Coverage breakdown */}
              {selectedFeatureObjs.length > 0 && (
                <div style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: '14px 16px' }}>
                  <p style={{ margin: '0 0 10px', color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {selectedTier ? `${TIER_OPTIONS.find(t => t.key === selectedTier)?.label} tier coverage` : 'No restriction — all selected tools accessible'}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedFeatureObjs.map(f => {
                      const covered = tierCoversFeature(f.key);
                      return (
                        <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>{covered ? '✅' : '🔒'}</span>
                          <span style={{ fontSize: 13, color: covered ? '#d1fae5' : '#6b7280', flex: 1 }}>{f.icon} {f.label}</span>
                          {!covered && <span style={{ fontSize: 11, color: '#92400e', background: '#451a0344', padding: '2px 8px', borderRadius: 4 }}>not in tier</span>}
                        </div>
                      );
                    })}
                  </div>
                  {selectedTier && activeTierAllowed && (
                    <p style={{ margin: '10px 0 0', color: '#6b7280', fontSize: 12 }}>
                      {selectedFeatureObjs.filter(f => tierCoversFeature(f.key)).length} of {selectedFeatureObjs.length} selected tools accessible on this tier.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #222', display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {isBuiltin && (
              <button onClick={reset} disabled={resetting}
                style={{ background: 'none', border: '1px solid #dc262644', borderRadius: 8, color: '#f87171', padding: '9px 16px', cursor: resetting ? 'not-allowed' : 'pointer', fontSize: 13, opacity: resetting ? 0.6 : 1 }}>
                {resetting ? 'Resetting…' : '↺ Reset to Default'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {/* Wizard: step 1 */}
            {useWizard && step === 1 && (
              <>
                <button onClick={onClose} style={{ background: 'none', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '9px 20px', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
                <button onClick={goNext}
                  style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '9px 24px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                  Next: Select Tier →
                </button>
              </>
            )}
            {/* Wizard: step 2 */}
            {useWizard && step === 2 && (
              <>
                <button onClick={() => setStep(1)} style={{ background: 'none', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '9px 20px', cursor: 'pointer', fontSize: 14 }}>← Back</button>
                <button onClick={save} disabled={saving}
                  style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '9px 24px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Saving…' : mode === 'create' ? 'Create Role' : 'Save Changes'}
                </button>
              </>
            )}
            {/* Built-in (single-step) */}
            {!useWizard && (
              <>
                <button onClick={onClose} style={{ background: 'none', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', padding: '9px 20px', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
                <button onClick={save} disabled={saving}
                  style={{ background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', padding: '9px 24px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Action icon button ────────────────────────────────────────────────────────

function ActionBtn({ icon, title, color, onClick }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: 'none', border: `1px solid ${color}33`, borderRadius: 6,
        color, padding: '4px 10px', cursor: 'pointer', fontSize: 14, fontWeight: 700,
      }}
    >
      {icon}
    </button>
  );
}

// ── Detail panel (expanded row) ───────────────────────────────────────────────

function DetailPanel({ data, troubleshoot, workflowRunLogs, taskLogs, locationId, locationName, adminKey,
                        onClearConnection, onDeleteWorkflow, onEditWorkflow, onEditConnection, onToggleToolShared }) {
  const [tsTab,       setTsTab]       = useState('tasks');
  const [runTask,     setRunTask]     = useState('');
  const [runResult,   setRunResult]   = useState(null);
  const [runLoading,  setRunLoading]  = useState(false);
  const toolAccessItems = troubleshoot?.toolAccess || [];

  // Billing edit state
  const [billingRec,     setBillingRec]     = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingEdits,   setBillingEdits]   = useState({});
  const [billingSaving,  setBillingSaving]  = useState(false);
  const [billingMsg,     setBillingMsg]     = useState(null); // { ok, text }

  const loadBillingRec = async () => {
    if (billingRec) return;
    setBillingLoading(true);
    const d = await adminFetch(`/admin/billing/${locationId}`, { adminKey });
    if (d.success) {
      setBillingRec(d.data);
      setBillingEdits({
        tier:   d.data.tier   || 'bronze',
        status: d.data.status || 'trial',
        amount: d.data.amount ?? 0,
        notes:  d.data.notes  || '',
      });
    }
    setBillingLoading(false);
  };

  const saveBilling = async () => {
    setBillingSaving(true);
    setBillingMsg(null);
    const d = await adminFetch(`/admin/billing/${locationId}`, {
      method: 'POST', adminKey,
      body: { tier: billingEdits.tier, status: billingEdits.status, amount: Number(billingEdits.amount), notes: billingEdits.notes },
    });
    setBillingSaving(false);
    if (d.success) {
      setBillingRec(d.data);
      setBillingMsg({ ok: true, text: '✓ Billing record saved' });
    } else {
      setBillingMsg({ ok: false, text: d.error || 'Save failed' });
    }
    setTimeout(() => setBillingMsg(null), 3000);
  };

  const execRunTask = async () => {
    if (!runTask.trim() || runLoading) return;
    setRunLoading(true);
    setRunResult(null);
    try {
      const res = await adminFetch(`/admin/locations/${locationId}/run-task`, {
        method: 'POST', adminKey, body: { task: runTask.trim() },
      });
      setRunResult(res);
    } catch (e) {
      setRunResult({ success: false, error: e.message });
    }
    setRunLoading(false);
  };

  return (
    <div style={{ padding: '14px 0' }}>
      <div style={{ background: '#14141c', border: '1px solid #242438', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
        <p style={{ color: '#6b7280', fontSize: 11, margin: '0 0 6px', fontWeight: 600, letterSpacing: '0.05em' }}>LOCATION</p>
        <LocationIdentity locationId={locationId} name={locationName} />
      </div>

      {/* Top row: integrations + token + logs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div>
          <p style={{ color: '#9ca3af', fontSize: 11, margin: '0 0 6px', fontWeight: 600, letterSpacing: '0.05em' }}>CONNECTED INTEGRATIONS</p>
          {data.connectedCategories?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {data.connectedCategories.map((c) => (
                <span key={c} style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 10px', borderRadius: 10, fontSize: 12 }}>{c}</span>
              ))}
            </div>
          ) : <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>None connected</p>}

          {data.tokenRecord && (
            <>
              <p style={{ color: '#9ca3af', fontSize: 11, margin: '14px 0 4px', fontWeight: 600, letterSpacing: '0.05em' }}>TOOL SESSION TOKEN</p>
              <code style={{ color: '#a78bfa', fontSize: 11, wordBreak: 'break-all' }}>{data.tokenRecord.token}</code>
            </>
          )}
        </div>
        <div>
          <p style={{ color: '#9ca3af', fontSize: 11, margin: '0 0 6px', fontWeight: 600, letterSpacing: '0.05em' }}>RECENT LOGS</p>
          <div style={{ maxHeight: 140, overflowY: 'auto' }}>
            {(data.recentLogs || []).slice(0, 10).map((log, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px solid #222', alignItems: 'center' }}>
                <EventBadge event={log.event} />
                <span style={{ color: log.success ? '#4ade80' : '#f87171', fontSize: 11 }}>{log.success ? '✓' : '✗'}</span>
                <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 'auto' }}>{relTime(log.timestamp)}</span>
              </div>
            ))}
            {!data.recentLogs?.length && <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>No logs yet.</p>}
          </div>
        </div>
      </div>

      {/* Troubleshoot section */}
      <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: 14 }}>
        <p style={{ color: '#fbbf24', fontSize: 11, margin: '0 0 10px', fontWeight: 600, letterSpacing: '0.05em' }}>🔧 TROUBLESHOOT</p>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {[
            { key: 'tasks',       label: `🤖 Tasks (${taskLogs.length})` },
            { key: 'run',         label: `🚀 Run Task` },
            { key: 'workflows',   label: `🔀 Workflows (${troubleshoot?.workflows?.length ?? 0})` },
            { key: 'connections', label: `🔌 Connections (${toolAccessItems.length || Object.keys(troubleshoot?.connections || {}).length})` },
            { key: 'billing',     label: `💳 Billing / Tier` },
            { key: 'logs',        label: `📋 All Logs` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setTsTab(key); if (key === 'billing') loadBillingRec(); }}
              style={{
                padding: '4px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500, border: 'none',
                background: tsTab === key ? '#7c3aed' : '#2a2a2a',
                color: tsTab === key ? '#fff' : '#9ca3af',
              }}
            >{label}</button>
          ))}
        </div>

        {/* Tasks sub-tab — claude_task + voice_task executions */}
        {tsTab === 'tasks' && (
          <div>
            {taskLogs.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>No Claude task executions logged yet for this location.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {taskLogs.slice(0, 50).map((log, i) => (
                  <div key={i} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <EventBadge event={log.event} />
                      <span style={{ color: log.success ? '#4ade80' : '#f87171', fontSize: 11 }}>{log.success ? '✓ OK' : '✗ Failed'}</span>
                      {log.detail?.source && (
                        <span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '1px 8px', borderRadius: 10, fontSize: 10 }}>{log.detail.source}</span>
                      )}
                      <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 'auto' }}>{relTime(log.timestamp)}</span>
                    </div>
                    {log.detail?.task && (
                      <p style={{ color: '#e5e7eb', fontSize: 12, margin: '0 0 4px', lineHeight: 1.4 }}>
                        "{log.detail.task.substring(0, 180)}{log.detail.task.length > 180 ? '…' : ''}"
                      </p>
                    )}
                    {log.detail?.transcript && (
                      <p style={{ color: '#e5e7eb', fontSize: 12, margin: '0 0 4px', lineHeight: 1.4 }}>
                        🎤 "{log.detail.transcript.substring(0, 180)}{log.detail.transcript.length > 180 ? '…' : ''}"
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#9ca3af', flexWrap: 'wrap' }}>
                      {log.detail?.turns !== undefined && <span>{log.detail.turns} turns</span>}
                      {log.detail?.toolCallCount !== undefined && <span>{log.detail.toolCallCount} tool calls</span>}
                      {log.detail?.toolsCalled?.length > 0 && (
                        <span style={{ color: '#818cf8' }}>{log.detail.toolsCalled.join(', ')}</span>
                      )}
                      {log.detail?.error && <span style={{ color: '#f87171' }}>Error: {log.detail.error}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Run Task sub-tab — admin runs a Claude task as this location */}
        {tsTab === 'run' && (
          <div>
            <p style={{ color: '#9ca3af', fontSize: 12, margin: '0 0 10px' }}>
              Run any Claude task as this location to reproduce issues or test tool access.
            </p>
            <textarea
              value={runTask}
              onChange={e => setRunTask(e.target.value)}
              placeholder="e.g. List the 5 most recent contacts in GHL"
              rows={4}
              style={{
                width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #333',
                borderRadius: 8, color: '#e5e7eb', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', marginBottom: 8,
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <button
                onClick={execRunTask}
                disabled={runLoading || !runTask.trim()}
                style={{
                  background: runLoading ? '#4c1d95' : '#7c3aed', border: 'none', borderRadius: 8,
                  color: '#fff', padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: runLoading ? 'wait' : 'pointer',
                  opacity: (!runTask.trim()) ? 0.5 : 1,
                }}
              >
                {runLoading ? '⏳ Running…' : '▶ Run Task'}
              </button>
              {runResult && (
                <button onClick={() => setRunResult(null)} style={{ background: 'none', border: '1px solid #333', borderRadius: 8, color: '#6b7280', padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}>
                  Clear
                </button>
              )}
            </div>
            {runResult && (
              <div style={{ background: '#111', border: `1px solid ${runResult.success ? '#166534' : '#7f1d1d'}`, borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <span style={{ color: runResult.success ? '#4ade80' : '#f87171', fontWeight: 600, fontSize: 13 }}>
                    {runResult.success ? '✓ Success' : '✗ Failed'}
                  </span>
                  {runResult.success && (
                    <>
                      <span style={{ color: '#6b7280', fontSize: 12 }}>{runResult.turns} turns</span>
                      <span style={{ color: '#6b7280', fontSize: 12 }}>· {runResult.toolCallCount} tool calls</span>
                    </>
                  )}
                </div>
                <pre style={{ color: '#e5e7eb', fontSize: 12, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflowY: 'auto' }}>
                  {runResult.success ? (runResult.result || '(no text output)') : runResult.error}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* All Logs sub-tab */}
        {tsTab === 'logs' && (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {!data.recentLogs?.length ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>No logs for this location.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #333' }}>
                    {['Time', 'Event', 'Status', 'Detail'].map(h => (
                      <th key={h} style={{ color: '#6b7280', fontWeight: 600, padding: '4px 8px', textAlign: 'left', fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recentLogs.map((log, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #1e1e1e' }}>
                      <td style={{ color: '#6b7280', padding: '4px 8px', whiteSpace: 'nowrap' }}>{relTime(log.timestamp)}</td>
                      <td style={{ padding: '4px 8px' }}><EventBadge event={log.event} /></td>
                      <td style={{ padding: '4px 8px', color: log.success ? '#4ade80' : '#f87171' }}>{log.success ? '✓' : '✗'}</td>
                      <td style={{ padding: '4px 8px', color: '#9ca3af', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {JSON.stringify(log.detail || {}).substring(0, 120)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Connections sub-tab */}
        {tsTab === 'connections' && (
          <div>
            {!troubleshoot ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>Loading…</p>
            ) : toolAccessItems.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>No tool access rules found.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {toolAccessItems.map((item) => (
                  <div key={item.key} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ color: '#60a5fa', fontSize: 12, fontWeight: 600 }}>{item.label || item.key}</span>
                        <span style={{ background: item.shared ? '#16331f' : '#2d1b1b', color: item.shared ? '#4ade80' : '#f87171', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                          {item.shared ? 'Shared to user' : 'Hidden from user'}
                        </span>
                        <span style={{ background: item.connected ? '#1e3a5f' : '#222', color: item.connected ? '#60a5fa' : '#6b7280', padding: '2px 8px', borderRadius: 999, fontSize: 11 }}>
                          {item.connected ? 'Connected' : 'Not connected'}
                        </span>
                        {item.toolCount > 0 && (
                          <span style={{ color: '#6b7280', fontSize: 11 }}>
                            {item.toolCount} tool{item.toolCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <p style={{ color: '#6b7280', fontSize: 12, margin: '6px 0 0' }}>
                        {item.description || 'No description available.'}
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {Object.entries(item.configPreview || {}).map(([k, v]) => (
                          <span key={k} style={{ background: '#111', border: '1px solid #333', borderRadius: 4, padding: '1px 8px', fontSize: 11, color: '#9ca3af' }}>
                            <span style={{ color: '#6b7280' }}>{k}: </span>
                            <span style={{ color: '#e5e7eb', fontFamily: 'monospace' }}>{String(v)}</span>
                          </span>
                        ))}
                        {!item.connected && (
                          <span style={{ color: '#6b7280', fontSize: 11 }}>User can only connect this after it is shared here.</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => onToggleToolShared(item.key, !item.shared)}
                        title={`${item.shared ? 'Hide' : 'Share'} ${item.label || item.key} for users`}
                        style={{ background: 'none', border: `1px solid ${item.shared ? '#dc262644' : '#16653466'}`, borderRadius: 6, color: item.shared ? '#f87171' : '#4ade80', padding: '3px 10px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
                      >{item.shared ? 'Hide from User' : 'Share to User'}</button>
                      {item.connected && (
                        <button
                          onClick={() => onEditConnection(item.key, item.configPreview || {})}
                          title={`Edit ${item.label || item.key} config`}
                          style={{ background: 'none', border: '1px solid #7c3aed44', borderRadius: 6, color: '#a78bfa', padding: '3px 10px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
                        >✏️ Edit</button>
                      )}
                      {item.connected && (
                        <button
                          onClick={() => onClearConnection(item.key)}
                          title={`Clear ${item.label || item.key} connection`}
                          style={{ background: 'none', border: '1px solid #dc262644', borderRadius: 6, color: '#dc2626', padding: '3px 10px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}
                        >✕ Clear</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Workflows sub-tab */}
        {tsTab === 'workflows' && (
          <div>
            {!troubleshoot ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>Loading…</p>
            ) : !troubleshoot.workflows?.length ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>No saved workflows.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {troubleshoot.workflows.map((wf) => {
                  const runs = (workflowRunLogs || []).filter(l => l.detail?.workflowId === wf.id);
                  return (
                    <div key={wf.id} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ color: '#e5e7eb', fontSize: 13, fontWeight: 600 }}>{wf.name}</span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ color: '#6b7280', fontSize: 11 }}>{wf.steps?.length || 0} steps</span>
                          <span style={{ color: '#6b7280', fontSize: 11 }}>· {relTime(wf.updatedAt)}</span>
                          <button
                            onClick={() => onEditWorkflow(wf)}
                            style={{ background: 'none', border: '1px solid #7c3aed44', borderRadius: 6, color: '#a78bfa', padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
                          >✏️ Edit</button>
                          <button
                            onClick={() => onDeleteWorkflow(wf.id, wf.name)}
                            style={{ background: 'none', border: '1px solid #dc262644', borderRadius: 6, color: '#dc2626', padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
                          >✕ Delete</button>
                        </div>
                      </div>
                      <WorkflowMiniCanvas steps={wf.steps || []} />
                      {wf.webhookToken && (
                        <p style={{ color: '#6b7280', fontSize: 10, margin: '4px 0 6px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          🔗 /workflows/trigger/{wf.webhookToken}
                        </p>
                      )}
                      {/* Execution run history */}
                      {runs.length > 0 && (
                        <div style={{ borderTop: '1px solid #2a2a2a', paddingTop: 8, marginTop: 4 }}>
                          <p style={{ color: '#9ca3af', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 5px' }}>
                            Recent Runs ({runs.length})
                          </p>
                          {runs.slice(0, 5).map((r, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0', fontSize: 11 }}>
                              <span style={{ color: r.success ? '#4ade80' : '#f87171' }}>{r.success ? '✓' : '✗'}</span>
                              <span style={{ color: '#9ca3af' }}>{r.detail?.toolCallCount ?? 0} tool calls</span>
                              <span style={{ color: '#9ca3af' }}>· {r.detail?.turns ?? 0} turns</span>
                              <span style={{ color: '#6b7280', marginLeft: 'auto' }}>{relTime(r.timestamp)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Unmatched run logs (webhook runs without a matched saved workflow) */}
            {workflowRunLogs?.length > 0 && troubleshoot?.workflows?.length === 0 && (
              <div style={{ marginTop: 12 }}>
                <p style={{ color: '#9ca3af', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>Webhook Trigger History</p>
                {workflowRunLogs.slice(0, 10).map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 12, borderBottom: '1px solid #1e1e1e' }}>
                    <span style={{ color: r.success ? '#4ade80' : '#f87171' }}>{r.success ? '✓' : '✗'}</span>
                    <span style={{ color: '#e5e7eb' }}>{r.detail?.workflowName || '—'}</span>
                    <span style={{ color: '#6b7280' }}>{r.detail?.toolCallCount ?? 0} calls</span>
                    <span style={{ color: '#6b7280', marginLeft: 'auto' }}>{relTime(r.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Billing / Tier sub-tab */}
        {tsTab === 'billing' && (
          <div>
            {billingLoading && <p style={{ color: '#6b7280', fontSize: 13 }}>Loading billing record…</p>}
            {!billingLoading && !billingRec && <p style={{ color: '#6b7280', fontSize: 13 }}>No billing record found.</p>}
            {billingRec && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Current values row */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Current Tier',   value: billingRec.tier   || 'bronze', color: { bronze: '#cd7f32', silver: '#9ca3af', gold: '#fbbf24', diamond: '#a78bfa' }[billingRec.tier] || '#9ca3af' },
                    { label: 'Status',         value: billingRec.status || 'trial',  color: '#4ade80' },
                    { label: 'Amount',         value: `$${billingRec.amount || 0}`,  color: '#34d399' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '6px 12px' }}>
                      <p style={{ color: '#6b7280', fontSize: 10, margin: '0 0 2px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                      <p style={{ color, fontSize: 13, fontWeight: 700, margin: 0, textTransform: 'capitalize' }}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Edit form */}
                <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: 14 }}>
                  <p style={{ color: '#9ca3af', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Edit Billing Record</p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>

                    <div>
                      <label style={{ color: '#6b7280', fontSize: 11, display: 'block', marginBottom: 4 }}>Integration Tier</label>
                      <select
                        value={billingEdits.tier}
                        onChange={e => setBillingEdits(p => ({ ...p, tier: e.target.value }))}
                        style={{ width: '100%', padding: '5px 8px', background: '#111', border: '1px solid #333', borderRadius: 6, color: '#e5e7eb', fontSize: 12 }}
                      >
                        {['bronze', 'silver', 'gold', 'diamond'].map(t => (
                          <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ color: '#6b7280', fontSize: 11, display: 'block', marginBottom: 4 }}>Status</label>
                      <select
                        value={billingEdits.status}
                        onChange={e => setBillingEdits(p => ({ ...p, status: e.target.value }))}
                        style={{ width: '100%', padding: '5px 8px', background: '#111', border: '1px solid #333', borderRadius: 6, color: '#e5e7eb', fontSize: 12 }}
                      >
                        {['trial', 'active', 'past_due', 'cancelled', 'suspended'].map(t => (
                          <option key={t} value={t}>{t.replace('_', ' ')}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ color: '#6b7280', fontSize: 11, display: 'block', marginBottom: 4 }}>Amount ($/mo)</label>
                      <input
                        type="number"
                        min="0"
                        value={billingEdits.amount}
                        onChange={e => setBillingEdits(p => ({ ...p, amount: e.target.value }))}
                        style={{ width: '100%', padding: '5px 8px', background: '#111', border: '1px solid #333', borderRadius: 6, color: '#e5e7eb', fontSize: 12, boxSizing: 'border-box' }}
                      />
                    </div>

                  </div>

                  <div style={{ marginTop: 10 }}>
                    <label style={{ color: '#6b7280', fontSize: 11, display: 'block', marginBottom: 4 }}>Notes</label>
                    <input
                      type="text"
                      placeholder="Internal admin note…"
                      value={billingEdits.notes}
                      onChange={e => setBillingEdits(p => ({ ...p, notes: e.target.value }))}
                      style={{ width: '100%', padding: '5px 8px', background: '#111', border: '1px solid #333', borderRadius: 6, color: '#e5e7eb', fontSize: 12, boxSizing: 'border-box' }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                    <button
                      disabled={billingSaving}
                      onClick={saveBilling}
                      style={{ padding: '6px 18px', borderRadius: 6, background: '#7c3aed', color: '#fff', border: 'none', cursor: billingSaving ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600, opacity: billingSaving ? 0.7 : 1 }}
                    >
                      {billingSaving ? 'Saving…' : '💾 Save Billing'}
                    </button>
                    {billingMsg && (
                      <span style={{ fontSize: 12, color: billingMsg.ok ? '#4ade80' : '#f87171' }}>{billingMsg.text}</span>
                    )}
                  </div>
                </div>

                {/* Payment Hub connections */}
                {billingRec.connectedPaymentProviders?.length > 0 && (
                  <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: 12 }}>
                    <p style={{ color: '#9ca3af', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>Payment Hub</p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {billingRec.connectedPaymentProviders.map(p => (
                        <span key={p} style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80', padding: '2px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>
                          ✓ {p.charAt(0).toUpperCase() + p.slice(1)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tier Edit Modal ────────────────────────────────────────────────────────────

function TierEditModal({ tierKey, data, allIntegrations, adminKey, onClose, onSaved, onFlash }) {
  const tierColor = { bronze: '#cd7f32', silver: '#9ca3af', gold: '#fbbf24', diamond: '#a78bfa' }[tierKey] || '#9ca3af';

  const [name,             setName]             = useState(data.name || '');
  const [icon,             setIcon]             = useState(data.icon || '');
  const [description,      setDescription]      = useState(data.description || '');
  const [price,            setPrice]            = useState(data.price ?? 0);
  const [interval,         setInterval]         = useState(data.interval || 'mo');
  const [ghlProductId,     setGhlProductId]     = useState(data.ghlProductId   || '');
  const [ghlPriceId,       setGhlPriceId]       = useState(data.ghlPriceId     || '');
  const [ghlProductName,   setGhlProductName]   = useState(data.ghlProductName || '');
  const [integrationLimit, setIntegrationLimit] = useState(data.integrationLimit ?? 2);
  const [unlimited,        setUnlimited]        = useState(data.integrationLimit === -1);
  const [allAllowed,       setAllAllowed]        = useState(data.allowedIntegrations === null);
  const [selected,         setSelected]         = useState(() =>
    data.allowedIntegrations === null
      ? new Set(allIntegrations.map(i => i.key))
      : new Set(data.allowedIntegrations || [])
  );
  const [saving, setSaving] = useState(false);

  const toggleIntegration = (key) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        name:                name.trim() || data.name,
        icon:                icon.trim() || data.icon,
        description:         description.trim(),
        price:               Number(price) || 0,
        interval:            interval || 'mo',
        ghlProductId:        ghlProductId  || null,
        ghlPriceId:          ghlPriceId    || null,
        ghlProductName:      ghlProductName || null,
        integrationLimit:    unlimited ? -1 : Number(integrationLimit),
        allowedIntegrations: allAllowed ? null : [...selected],
      };
      const res = await adminFetch(`/admin/plan-tiers/${tierKey}`, { method: 'POST', adminKey, body });
      if (res.success) onSaved(tierKey, res.data);
      else onFlash(`✗ ${res.error || 'Save failed'}`);
    } catch { onFlash('✗ Request failed'); }
    setSaving(false);
  };

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
  const box     = { background: '#1a1a1a', border: `1px solid ${tierColor}55`, borderRadius: 12, padding: 24, width: 'min(520px, 100%)', maxHeight: '90vh', overflowY: 'auto' };
  const inp     = { width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box', marginBottom: 12 };
  const lbl     = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ color: tierColor, margin: 0, fontSize: 16 }}>{data.icon} Edit {data.name} Tier</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={lbl}>Tier Name</label>
            <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder={data.name} />
          </div>
          <div>
            <label style={lbl}>Icon</label>
            <input style={inp} value={icon} onChange={e => setIcon(e.target.value)} placeholder={data.icon} />
          </div>
        </div>

        <label style={lbl}>Description</label>
        <input style={inp} value={description} onChange={e => setDescription(e.target.value)} placeholder="Plan description…" />

        {/* Pricing */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 8, marginBottom: 4 }}>
          <div>
            <label style={lbl}>Price (USD)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 13 }}>$</span>
              <input
                type="number" min={0} step={0.01}
                style={{ ...inp, paddingLeft: 22, marginBottom: 12 }}
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <div>
            <label style={lbl}>Interval</label>
            <select
              style={{ ...inp, marginBottom: 12 }}
              value={interval}
              onChange={e => setInterval(e.target.value)}
            >
              <option value="mo">/ month</option>
              <option value="yr">/ year</option>
            </select>
          </div>
        </div>

        {/* GHL Product — info only; assign from the tier card on the Plan Tiers tab */}
        {(ghlProductName || data.ghlProductName) && (
          <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <p style={{ ...lbl, margin: '0 0 2px' }}>🔗 GHL Product</p>
            <p style={{ color: '#6366f1', fontSize: 13, margin: 0 }}>{ghlProductName || data.ghlProductName}</p>
            {(ghlPriceId || data.ghlPriceId) && (
              <p style={{ color: '#4ade80', fontSize: 11, margin: '2px 0 0' }}>✓ Price synced from GHL</p>
            )}
          </div>
        )}

        {/* Integration limit */}
        <label style={lbl}>Integration Limit</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#e5e7eb' }}>
            <input type="checkbox" checked={unlimited} onChange={e => setUnlimited(e.target.checked)} />
            Unlimited (Diamond)
          </label>
          {!unlimited && (
            <input
              type="number"
              min={1}
              max={100}
              value={integrationLimit}
              onChange={e => setIntegrationLimit(e.target.value)}
              style={{ ...inp, width: 80, marginBottom: 0 }}
            />
          )}
        </div>

        {/* Allowed integrations */}
        <label style={lbl}>Allowed Integrations</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#e5e7eb', marginBottom: 12 }}>
          <input type="checkbox" checked={allAllowed} onChange={e => {
            setAllAllowed(e.target.checked);
            if (e.target.checked) setSelected(new Set(allIntegrations.map(i => i.key)));
          }} />
          All integrations (unlimited access)
        </label>

        {!allAllowed && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {allIntegrations.map(({ key, label, icon: iIcon }) => {
              const checked = selected.has(key);
              return (
                <label
                  key={key}
                  onClick={() => toggleIntegration(key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8,
                    cursor: 'pointer', fontSize: 13,
                    background: checked ? `${tierColor}18` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${checked ? tierColor + '55' : 'rgba(255,255,255,0.08)'}`,
                    color: checked ? tierColor : '#6b7280',
                    userSelect: 'none',
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={() => {}} style={{ accentColor: tierColor }} />
                  <span>{iIcon}</span>
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{ flex: 1, padding: '10px', background: tierColor, border: 'none', borderRadius: 8, color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : `Save ${data.name} Tier`}
          </button>
          <button onClick={onClose} style={{ padding: '10px 20px', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Workflow Modal ────────────────────────────────────────────────────────

const WF_TOOLS = [
  { key: 'ghl',          label: 'GoHighLevel',  icon: '⚡', color: '#4ade80' },
  { key: 'openai',       label: 'OpenAI',       icon: '✨', color: '#60a5fa' },
  { key: 'perplexity',   label: 'Perplexity',   icon: '🔍', color: '#a78bfa' },
  { key: 'sendgrid',     label: 'SendGrid',     icon: '📧', color: '#f472b6' },
  { key: 'apollo',       label: 'Apollo.io',    icon: '🚀', color: '#fb923c' },
  { key: 'slack',        label: 'Slack',        icon: '💬', color: '#34d399' },
  { key: 'facebook_ads', label: 'Facebook Ads', icon: '📘', color: '#60a5fa' },
  { key: 'heygen',       label: 'HeyGen',       icon: '🎬', color: '#f472b6' },
];

// Canvas layout constants
const CN_W = 220;   // node width (full modal canvas)
const CN_H = 68;    // node height
const CN_GAP = 72;  // vertical gap between nodes (space for connector line)
const CN_PAD = 24;  // canvas top/bottom padding

// Mini canvas constants (inline in troubleshoot card — horizontal layout)
const MN_W = 148;   // mini node width
const MN_H = 46;    // mini node height
const MN_GAP = 44;  // horizontal gap between mini nodes

function WorkflowMiniCanvas({ steps = [] }) {
  if (!steps.length) return null;
  const canvasW = steps.length * MN_W + (steps.length - 1) * MN_GAP + 2;
  const canvasH = MN_H + 16; // node + port overflow
  const nodeY   = 8;         // top padding for port overflow

  function nodeX(i) { return i * (MN_W + MN_GAP); }
  function hBezier(x1, y1, x2, y2) {
    const cx = (x1 + x2) / 2;
    return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
  }

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4, marginTop: 8 }}>
      <div style={{ position: 'relative', width: canvasW, height: canvasH, flexShrink: 0 }}>
        <svg
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
          width={canvasW} height={canvasH}
        >
          {steps.slice(0, -1).map((_, i) => {
            const tc = (WF_TOOLS.find(x => x.key === steps[i + 1]?.tool) || { color: '#4b5563' }).color;
            const x1 = nodeX(i) + MN_W;
            const y1 = nodeY + MN_H / 2;
            const x2 = nodeX(i + 1);
            const y2 = nodeY + MN_H / 2;
            return (
              <g key={i}>
                <path d={hBezier(x1, y1, x2, y2)} fill="none" stroke={tc + '50'} strokeWidth={2} strokeDasharray="4 3" />
                <circle r={3} fill={tc} opacity={0.85}>
                  <animateMotion dur="1.2s" repeatCount="indefinite" path={hBezier(x1, y1, x2, y2)} />
                </circle>
              </g>
            );
          })}
        </svg>

        {steps.map((step, i) => {
          const t = WF_TOOLS.find(x => x.key === step.tool) || { icon: '🔧', label: step.tool, color: '#9ca3af' };
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: nodeY, left: nodeX(i),
                width: MN_W, height: MN_H,
                background: '#0d0d0d',
                border: `1.5px solid ${t.color}55`,
                borderLeft: `3px solid ${t.color}`,
                borderRadius: 8,
                padding: '6px 10px',
                boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  width: 16, height: 16, borderRadius: '50%',
                  background: t.color + '22', color: t.color,
                  fontSize: 9, fontWeight: 700, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{i + 1}</span>
                <span style={{ fontSize: 10, color: t.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{t.icon} {t.label}</span>
              </div>
              <div style={{
                fontSize: 11, color: '#9ca3af', marginTop: 3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: MN_W - 20,
              }}>
                {step.label || <span style={{ color: '#374151', fontStyle: 'italic' }}>no label</span>}
              </div>

              {/* Output port — right center */}
              <span style={{
                position: 'absolute', right: -5, top: '50%', transform: 'translateY(-50%)',
                width: 9, height: 9, borderRadius: '50%',
                background: t.color, border: '2px solid #0d0d0d',
              }} />
              {/* Input port — left center */}
              {i > 0 && (
                <span style={{
                  position: 'absolute', left: -5, top: '50%', transform: 'translateY(-50%)',
                  width: 9, height: 9, borderRadius: '50%',
                  background: '#0d0d0d', border: `2px solid ${t.color}`,
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Workflow canvas node (visual) ─────────────────────────────────────────────

function WfNode({ step, index, selected, onSelect, onDelete }) {
  const t = WF_TOOLS.find(x => x.key === step.tool) || { icon: '🔧', label: step.tool, color: '#9ca3af' };
  return (
    <div
      onClick={onSelect}
      style={{
        width: CN_W, height: CN_H,
        background: selected ? '#1e1e2e' : '#141414',
        border: `2px solid ${selected ? t.color : t.color + '55'}`,
        borderRadius: 12, cursor: 'pointer', userSelect: 'none',
        padding: '10px 14px', boxSizing: 'border-box',
        boxShadow: selected ? `0 0 0 3px ${t.color}30` : 'none',
        transition: 'border-color .15s, box-shadow .15s',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
        position: 'relative',
      }}
    >
      {/* Delete button */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        style={{
          position: 'absolute', top: 6, right: 8,
          background: 'none', border: 'none', color: '#4b5563',
          cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0,
        }}
        title="Remove node"
      >✕</button>

      {/* Tool badge + step number */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 20, height: 20, borderRadius: '50%',
          background: t.color + '22', color: t.color,
          fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{index + 1}</span>
        <span style={{ fontSize: 11, color: t.color, fontWeight: 600 }}>{t.icon} {t.label}</span>
      </div>

      {/* Label */}
      <div style={{
        fontSize: 12, color: '#e5e7eb', fontWeight: 500,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth: CN_W - 40,
      }}>
        {step.label || <span style={{ color: '#4b5563', fontStyle: 'italic' }}>Untitled step</span>}
      </div>

      {/* Output port (bottom-center) */}
      <span style={{
        position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)',
        width: 12, height: 12, borderRadius: '50%',
        background: t.color, border: '2px solid #141414',
      }} />
      {/* Input port (top-center) */}
      {index > 0 && (
        <span style={{
          position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
          width: 12, height: 12, borderRadius: '50%',
          background: '#1a1a1a', border: `2px solid ${t.color}`,
        }} />
      )}
    </div>
  );
}

// Build SVG bezier path between two node center-bottom/top ports
function bezierPath(x1, y1, x2, y2) {
  const cy = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}`;
}

function EditWorkflowModal({ modal, adminKey, locationLabel, onClose, onSaved, onFlash }) {
  const wf = modal.data;
  const [name,     setName]     = useState(wf.name    || '');
  const [context,  setContext]  = useState(wf.context || '');
  const [steps,    setSteps]    = useState(() => {
    if (!Array.isArray(wf.steps) || wf.steps.length === 0)
      return [{ tool: 'ghl', label: '', instruction: '' }];
    return wf.steps.map(s => ({ tool: s.tool || 'ghl', label: s.label || '', instruction: s.instruction || '' }));
  });
  const [popupIdx, setPopupIdx] = useState(null); // which node's popup is open
  const [saving,   setSaving]   = useState(false);

  const inp = { width: '100%', padding: '8px 10px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#e5e7eb', fontSize: 13, boxSizing: 'border-box' };
  const lbl = { display: 'block', color: '#6b7280', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 };

  const updateStep = (i, s) => setSteps(p => p.map((x, j) => j === i ? s : x));
  const deleteStep = (i) => {
    setSteps(p => { const n = p.filter((_, j) => j !== i); return n.length ? n : [{ tool: 'ghl', label: '', instruction: '' }]; });
    setPopupIdx(null);
  };
  const addStep = () => { setSteps(p => [...p, { tool: 'ghl', label: '', instruction: '' }]); setPopupIdx(steps.length); };

  // Full-width canvas geometry — node centered horizontally
  const MODAL_W   = 860;
  const INNER_W   = MODAL_W - 48;        // canvas inner width with padding
  const FC_W      = 280;                  // full-canvas node width
  const FC_H      = 76;                   // node height
  const FC_GAP    = 80;                   // gap between nodes
  const FC_PAD    = 28;
  const FC_X      = (INNER_W - FC_W) / 2; // center node
  const canvasH   = steps.length * (FC_H + FC_GAP) - FC_GAP + FC_PAD * 2;
  const nodeTop   = (i) => FC_PAD + i * (FC_H + FC_GAP);

  // Popup appears to the right of the node; if no room, to the left
  const POPUP_W   = 300;
  const popupLeft = FC_X + FC_W + 18;
  const fitsRight = popupLeft + POPUP_W <= INNER_W + 10;
  const finalPopLeft = fitsRight ? popupLeft : FC_X - POPUP_W - 18;

  const save = async () => {
    const validSteps = steps.filter(s => s.instruction.trim());
    if (!validSteps.length) { onFlash('✗ At least one step with an instruction is required.'); return; }
    setSaving(true);
    try {
      const res = await adminFetch(`/admin/locations/${modal.locationId}/workflows/${wf.id}`, {
        method: 'PUT', adminKey,
        body: { name: name.trim(), context: context.trim(), steps: validSteps },
      });
      if (res.success) onSaved(modal.locationId, res.data || { ...wf, name: name.trim(), context: context.trim(), steps: validSteps });
      else onFlash(`✗ ${res.error || 'Save failed'}`);
    } catch { onFlash('✗ Request failed'); }
    setSaving(false);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) { setPopupIdx(null); onClose(); } }}
    >
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 16, width: `min(${MODAL_W}px, 100%)`, maxHeight: '94vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid #1e1e1e', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Workflow name…"
              style={{ background: 'none', border: 'none', color: '#fff', fontSize: 17, fontWeight: 700, width: '100%', outline: 'none', padding: 0 }}
            />
            <p style={{ color: '#4b5563', fontSize: 12, margin: '2px 0 0' }}>
              {steps.length} node{steps.length !== 1 ? 's' : ''} · {locationLabel || modal.locationId}
            </p>
          </div>
          {/* Context inline */}
          <input
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder="System prompt / context…"
            style={{ background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 8, color: '#9ca3af', fontSize: 12, padding: '6px 12px', width: 240, outline: 'none' }}
          />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 22, lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* Canvas body */}
        <div
          style={{ flex: 1, overflowY: 'auto', background: '#0a0a0a', padding: '0 24px', position: 'relative' }}
          onClick={e => { if (e.target === e.currentTarget) setPopupIdx(null); }}
        >
          {/* + Add Node */}
          <div style={{ padding: '14px 0 6px', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={addStep}
              style={{ background: 'transparent', border: '1px dashed #2a2a2a', borderRadius: 8, color: '#4b5563', fontSize: 12, padding: '5px 20px', cursor: 'pointer' }}
              onMouseOver={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.color = '#a78bfa'; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#4b5563'; }}
            >+ Add Node</button>
          </div>

          {/* Canvas */}
          <div style={{ position: 'relative', width: INNER_W, height: canvasH, margin: '0 auto' }}>

            {/* SVG bezier connectors */}
            <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }} width={INNER_W} height={canvasH}>
              {steps.slice(0, -1).map((_, i) => {
                const tc = (WF_TOOLS.find(x => x.key === steps[i + 1]?.tool) || { color: '#374151' }).color;
                const cx = FC_X + FC_W / 2;
                const y1 = nodeTop(i) + FC_H;
                const y2 = nodeTop(i + 1);
                const d  = bezierPath(cx, y1, cx, y2);
                return (
                  <g key={i}>
                    <path d={d} fill="none" stroke={tc + '55'} strokeWidth={2.5} strokeDasharray="6 4" />
                    <circle r={4.5} fill={tc} opacity={0.9}>
                      <animateMotion dur="1.3s" repeatCount="indefinite" path={d} />
                    </circle>
                  </g>
                );
              })}
            </svg>

            {/* Nodes + popups */}
            {steps.map((step, i) => {
              const t    = WF_TOOLS.find(x => x.key === step.tool) || { icon: '🔧', label: step.tool, color: '#9ca3af' };
              const isOpen = popupIdx === i;
              const popTop = nodeTop(i);

              return (
                <div key={i}>
                  {/* Node card */}
                  <div
                    onClick={e => { e.stopPropagation(); setPopupIdx(isOpen ? null : i); }}
                    style={{
                      position: 'absolute', top: nodeTop(i), left: FC_X,
                      width: FC_W, height: FC_H,
                      background: isOpen ? '#1a1a2a' : '#141414',
                      border: `2px solid ${isOpen ? t.color : t.color + '55'}`,
                      borderLeft: `4px solid ${t.color}`,
                      borderRadius: 12, cursor: 'pointer', userSelect: 'none',
                      padding: '10px 14px', boxSizing: 'border-box',
                      boxShadow: isOpen ? `0 0 0 3px ${t.color}25, 0 8px 32px rgba(0,0,0,0.5)` : '0 2px 8px rgba(0,0,0,0.4)',
                      transition: 'all .15s',
                      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5,
                    }}
                  >
                    {/* Delete */}
                    <button
                      onClick={e => { e.stopPropagation(); deleteStep(i); }}
                      style={{ position: 'absolute', top: 7, right: 9, background: 'none', border: 'none', color: '#374151', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}
                    >✕</button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 22, height: 22, borderRadius: '50%', background: t.color + '22', color: t.color, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ fontSize: 12, color: t.color, fontWeight: 600 }}>{t.icon} {t.label}</span>
                      <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 'auto', marginRight: 16 }}>
                        {isOpen ? '▲ close' : '▼ edit'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: FC_W - 32 }}>
                      {step.label || <span style={{ color: '#374151', fontStyle: 'italic' }}>click to edit</span>}
                    </div>

                    {/* Ports */}
                    <span style={{ position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)', width: 12, height: 12, borderRadius: '50%', background: t.color, border: '2px solid #141414' }} />
                    {i > 0 && <span style={{ position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)', width: 12, height: 12, borderRadius: '50%', background: '#141414', border: `2px solid ${t.color}` }} />}
                  </div>

                  {/* Floating popup */}
                  {isOpen && (
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{
                        position: 'absolute',
                        top: popTop,
                        left: finalPopLeft,
                        width: POPUP_W,
                        background: '#161620',
                        border: `1.5px solid ${t.color}60`,
                        borderRadius: 12,
                        padding: 16,
                        boxShadow: `0 12px 40px rgba(0,0,0,0.7), 0 0 0 1px ${t.color}20`,
                        zIndex: 10,
                      }}
                    >
                      {/* Popup arrow pointing left toward node */}
                      {fitsRight && (
                        <span style={{
                          position: 'absolute', left: -8, top: 26,
                          width: 0, height: 0,
                          borderTop: '8px solid transparent',
                          borderBottom: '8px solid transparent',
                          borderRight: `8px solid ${t.color}60`,
                        }} />
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                        <span style={{ color: t.color, fontSize: 12, fontWeight: 700 }}>{t.icon} Node {i + 1}</span>
                        <button onClick={() => setPopupIdx(null)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 16 }}>×</button>
                      </div>

                      <label style={lbl}>Tool</label>
                      <select
                        value={step.tool}
                        onChange={e => updateStep(i, { ...step, tool: e.target.value })}
                        style={{ ...inp, marginBottom: 12 }}
                      >
                        {WF_TOOLS.map(x => <option key={x.key} value={x.key}>{x.icon} {x.label}</option>)}
                      </select>

                      <label style={lbl}>Label</label>
                      <input
                        value={step.label || ''}
                        onChange={e => updateStep(i, { ...step, label: e.target.value })}
                        placeholder="Short display name…"
                        style={{ ...inp, marginBottom: 12 }}
                      />

                      <label style={lbl}>Instruction</label>
                      <textarea
                        value={step.instruction || ''}
                        onChange={e => updateStep(i, { ...step, instruction: e.target.value })}
                        rows={5}
                        placeholder="What should this step do?"
                        style={{ ...inp, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ height: 20 }} /> {/* bottom padding */}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid #1e1e1e' }}>
          <button
            onClick={save} disabled={saving || !name.trim()}
            style={{ flex: 1, padding: '11px', background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: (saving || !name.trim()) ? 0.6 : 1 }}
          >{saving ? 'Saving…' : 'Save Workflow'}</button>
          <button onClick={onClose} style={{ padding: '11px 22px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Connection Modal ──────────────────────────────────────────────────────

function EditConnectionModal({ modal, adminKey, locationLabel, onClose, onSaved, onFlash }) {
  const { cat, cfg } = modal.data;
  const [fields, setFields] = useState(() => {
    const init = {};
    Object.keys(cfg || {}).forEach(k => { init[k] = cfg[k]; });
    return init;
  });
  const [newKey,   setNewKey]   = useState('');
  const [newVal,   setNewVal]   = useState('');
  const [saving,   setSaving]   = useState(false);

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
  const box     = { background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: 24, width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto' };
  const inp     = { width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box' };
  const lbl     = { display: 'block', color: '#9ca3af', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 };

  const save = async () => {
    if (Object.keys(fields).length === 0) { onFlash('✗ No config fields to save.'); return; }
    setSaving(true);
    try {
      const res = await adminFetch(`/admin/locations/${modal.locationId}/connections/${cat}`, {
        method: 'PUT', adminKey, body: fields,
      });
      if (res.success) onSaved(modal.locationId, cat, fields);
      else onFlash(`✗ ${res.error || 'Save failed'}`);
    } catch { onFlash('✗ Request failed'); }
    setSaving(false);
  };

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ color: '#fff', margin: 0, fontSize: 16 }}>Edit <span style={{ color: '#60a5fa' }}>{cat}</span> Connection</h3>
            {locationLabel && <p style={{ color: '#9ca3af', margin: '4px 0 0', fontSize: 12 }}>{locationLabel}</p>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>
        <p style={{ color: '#9ca3af', fontSize: 12, margin: '0 0 16px' }}>Edit API credentials for this location. Saving will invalidate the token cache and generate a new session token.</p>

        {Object.keys(fields).map(k => (
          <div key={k} style={{ marginBottom: 14 }}>
            <label style={lbl}>{k}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...inp, flex: 1 }}
                value={fields[k]}
                onChange={e => setFields(p => ({ ...p, [k]: e.target.value }))}
                placeholder={`Enter ${k}…`}
              />
              <button
                onClick={() => setFields(p => { const n = { ...p }; delete n[k]; return n; })}
                title="Remove field"
                style={{ background: 'none', border: '1px solid #7f1d1d', borderRadius: 6, color: '#f87171', padding: '0 10px', cursor: 'pointer', fontSize: 14 }}
              >×</button>
            </div>
          </div>
        ))}

        {/* Add new field */}
        <div style={{ marginBottom: 16, padding: 12, background: '#111', borderRadius: 8, border: '1px dashed #333' }}>
          <p style={{ color: '#6b7280', fontSize: 11, margin: '0 0 8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Add Field</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inp, flex: 1 }} value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="field name (e.g. apiKey)" />
            <input style={{ ...inp, flex: 2 }} value={newVal} onChange={e => setNewVal(e.target.value)} placeholder="value" />
            <button
              onClick={() => {
                if (!newKey.trim()) return;
                setFields(p => ({ ...p, [newKey.trim()]: newVal }));
                setNewKey(''); setNewVal('');
              }}
              style={{ background: '#7c3aed', border: 'none', borderRadius: 6, color: '#fff', padding: '0 14px', cursor: 'pointer', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}
            >+ Add</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={save}
            disabled={saving}
            style={{ flex: 1, padding: '10px', background: '#7c3aed', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Save Connection'}
          </button>
          <button onClick={onClose} style={{ padding: '10px 20px', background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#9ca3af', fontSize: 14, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Log table ─────────────────────────────────────────────────────────────────

function LogTable({ logs, getLocationName }) {
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, overflow: 'hidden', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 500 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#9ca3af', textAlign: 'left' }}>
            {['Time', 'Location', 'Event', 'Status', 'Detail'].map((h) => (
              <th key={h} style={{ padding: '9px 14px', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.map((log, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #1e1e1e' }}>
              <td style={{ padding: '8px 14px', color: '#6b7280', whiteSpace: 'nowrap', fontSize: 12 }}>
                {relTime(log.timestamp)}
              </td>
              <td style={{ padding: '8px 14px' }}>
                <LocationIdentity
                  locationId={log.locationId}
                  name={getLocationName?.(log.locationId)}
                  fallbackName="Unknown Location"
                  shortId
                  idFontSize={11}
                  nameWeight={500}
                />
              </td>
              <td style={{ padding: '8px 14px' }}>
                <EventBadge event={log.event} />
              </td>
              <td style={{ padding: '8px 14px' }}>
                <span style={{ color: log.success ? '#4ade80' : '#f87171', fontSize: 12 }}>
                  {log.success ? '✓ OK' : '✗ Fail'}
                </span>
              </td>
              <td style={{ padding: '8px 14px', color: '#6b7280', fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {log.detail ? JSON.stringify(log.detail) : ''}
              </td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                No activity logs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
