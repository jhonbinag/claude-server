import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';
import SelfImprovementPanel from '../components/SelfImprovementPanel';

// ── API helper ────────────────────────────────────────────────────────────────

async function apiFetch(path, locationId, opts = {}) {
  const res = await fetch(path, {
    method:  opts.method || 'GET',
    headers: {
      'Content-Type':  'application/json',
      'x-location-id': locationId || '',
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ytThumb(videoId) {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

function fmtDuration(secs) {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function fmtViews(n) {
  if (!n) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1).replace('.0','') + 'K';
  return n.toLocaleString();
}

function publishedAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7)  return `${d} days ago`;
  if (d < 30) return `${Math.floor(d / 7)} week${Math.floor(d / 7) > 1 ? 's' : ''} ago`;
  if (d < 365) return `${Math.floor(d / 30)} month${Math.floor(d / 30) > 1 ? 's' : ''} ago`;
  return `${Math.floor(d / 365)} year${Math.floor(d / 365) > 1 ? 's' : ''} ago`;
}

function timeAgo(ts) {
  if (!ts) return 'Never';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function getBrainHealth(brain) {
  const docs = brain.docs || [];
  const pendingFromDocs = docs.filter(d => !d.chunkCount || d.chunkCount === 0).length;
  const pendingCount = (brain.pendingVideos || 0) + (brain.errorVideos || 0) || pendingFromDocs;
  const hasContent = (brain.docCount || 0) > 0 || (brain.videoCount || 0) > 0 || docs.length > 0;
  return { healthy: pendingCount === 0, pendingCount, hasContent };
}

// ── Colors ────────────────────────────────────────────────────────────────────

const C = {
  bg:         '#070b14',
  card:       '#0f1623',
  border:     '#1e2a3a',
  blue:       '#2563eb',
  blueDark:   '#1d4ed8',
  green:      '#10b981',
  amber:      '#f59e0b',
  red:        '#ef4444',
  textPri:    '#f9fafb',
  textSec:    '#9ca3af',
  textMuted:  '#6b7280',
  codeBg:     '#0a0f1a',
};

// ── Shared component styles ───────────────────────────────────────────────────

const inputStyle = {
  width: '100%', boxSizing: 'border-box', background: '#0a0f1a',
  border: `1px solid ${C.border}`, borderRadius: 8, color: C.textPri,
  padding: '9px 12px', fontSize: 14, marginBottom: 14, outline: 'none',
};

const btnPrimary = {
  background: C.blue, border: 'none', borderRadius: 8,
  color: '#fff', padding: '9px 18px', fontSize: 14, fontWeight: 600,
  cursor: 'pointer',
};

const btnSecondary = {
  background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
  color: C.textSec, padding: '7px 14px', fontSize: 13, cursor: 'pointer',
};

// ── Nav tabs ──────────────────────────────────────────────────────────────────

const NAV_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'search',    label: 'Search' },
];

// ── Add Channel Modal ─────────────────────────────────────────────────────────


// ── Docs Modal ────────────────────────────────────────────────────────────────

function DocsModal({ brain, onClose, onGenerate, generatingDocs }) {
  const history = brain.docsHistory || [];
  const sorted  = [...history].reverse(); // newest first
  const [expanded, setExpanded] = useState(() => new Set(sorted.length ? [sorted[0].id] : []));

  function toggle(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.textPri }}>📄 Brain Documentation</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: C.textMuted }}>
              {history.length} version{history.length !== 1 ? 's' : ''} · AI-generated · newest first
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={onGenerate} disabled={generatingDocs}
              style={{ ...btnPrimary, fontSize: 13, opacity: generatingDocs ? 0.5 : 1 }}>
              {generatingDocs ? '⟳ Generating…' : history.length ? '↺ Generate New Version' : '✦ Generate Docs'}
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: 24, flex: 1 }}>
          {sorted.length === 0 ? (
            <p style={{ color: C.textMuted, fontSize: 14 }}>
              No documentation yet. Click "Generate Docs" to have AI write documentation for this brain.
            </p>
          ) : sorted.map((entry, i) => (
            <div key={entry.id} style={{ marginBottom: 12, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <button onClick={() => toggle(entry.id)} style={{
                width: '100%', background: expanded.has(entry.id) ? '#0d1623' : C.card,
                border: 'none', padding: '14px 18px', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 5,
                    background: i === 0 ? `${C.blue}22` : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${i === 0 ? C.blue + '40' : C.border}`,
                    color: i === 0 ? C.blue : C.textMuted,
                  }}>
                    {i === 0 ? 'Latest · ' : ''}v{entry.version}
                  </span>
                  <span style={{ fontSize: 13, color: C.textMuted }}>
                    {new Date(entry.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {' at '}
                    {new Date(entry.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <span style={{ color: C.textMuted, fontSize: 13 }}>{expanded.has(entry.id) ? '▲' : '▼'}</span>
              </button>
              {expanded.has(entry.id) && (
                <div style={{ padding: '16px 18px', borderTop: `1px solid ${C.border}`, background: C.bg }}>
                  <pre style={{ margin: 0, fontSize: 13, color: C.textSec, lineHeight: 1.75, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                    {entry.content}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Change Log Modal ──────────────────────────────────────────────────────────

function ChangeLogModal({ brain, onClose }) {
  const syncEntries = (brain.syncLog || []).map(e => ({ ...e, _kind: 'sync' }));
  const noteEntries = (brain.notes   || []).map(e => ({ ...e, _kind: 'note' }));
  const all = [...syncEntries, ...noteEntries].sort((a, b) => new Date(b.ts) - new Date(a.ts));

  // Group by calendar date
  const groups = [];
  let curDate = null, curItems = [];
  for (const e of all) {
    const dk = new Date(e.ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (dk !== curDate) {
      if (curItems.length) groups.push({ date: curDate, entries: curItems });
      curDate = dk; curItems = [e];
    } else { curItems.push(e); }
  }
  if (curItems.length) groups.push({ date: curDate, entries: curItems });

  const TYPE_COLOR = { auto: '#9ca3af', docs: '#60a5fa', sync: '#10b981', note: '#a78bfa', fix: '#4ade80', update: '#a78bfa', issue: '#fbbf24' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.textPri }}>📋 Change Log</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: C.textMuted }}>
              {all.length} entr{all.length !== 1 ? 'ies' : 'y'} · auto-logged · grouped by date
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', padding: 24, flex: 1 }}>
          {all.length === 0 ? (
            <p style={{ color: C.textMuted, fontSize: 14 }}>
              No changes recorded yet. Changes will appear here automatically as you update this brain.
            </p>
          ) : groups.map(group => (
            <div key={group.date} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted, marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${C.border}44` }}>
                {group.date}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {group.entries.map((entry, i) => {
                  if (entry._kind === 'sync') {
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}44` }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.green, minWidth: 72, textTransform: 'uppercase', letterSpacing: '0.05em' }}>⟳ Sync</span>
                        <span style={{ fontSize: 13, color: C.textSec, flex: 1 }}>
                          +{entry.ingested || 0} videos{entry.errors > 0 ? ` · ${entry.errors} errors` : ''}{entry.channel ? ` · ${entry.channel}` : ''}
                        </span>
                        <span style={{ fontSize: 11, color: C.textMuted, flexShrink: 0 }}>
                          {new Date(entry.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  }
                  const color = TYPE_COLOR[entry.type] || '#9ca3af';
                  return (
                    <div key={entry.id || i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}44` }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 72, textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: 1 }}>{entry.type || 'note'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: C.textSec }}>{entry.title}</div>
                        {entry.text && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3, lineHeight: 1.5 }}>{entry.text}</div>}
                      </div>
                      <span style={{ fontSize: 11, color: C.textMuted, flexShrink: 0, paddingTop: 1 }}>
                        {new Date(entry.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
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

// ── Brain Detail view ─────────────────────────────────────────────────────────

function BrainDetail({ brain, locationId, onBack, onRefresh, initialModal, onModalOpened }) {
  const [tab,               setTab]               = useState('videos');
  const [docs,              setDocs]              = useState(brain.docs || []);
  const [channels,          setChannels]          = useState(brain.channels || []);

  const [generatingDocs,    setGeneratingDocs]    = useState(false);

  // Modals
  const [showDocsModal,      setShowDocsModal]      = useState(false);
  const [showChangeLogModal, setShowChangeLogModal] = useState(false);

  useEffect(() => {
    if (initialModal === 'docs')      { setShowDocsModal(true);      onModalOpened?.(); }
    else if (initialModal === 'changelog') { setShowChangeLogModal(true); onModalOpened?.(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Videos catalogue (from channel sync)
  const [videos,            setVideos]            = useState([]);
  const [loadingVideos,     setLoadingVideos]     = useState(false);
  // Pagination
  const [videoPage,        setVideoPage]        = useState(1);
  const [videoPageSize,    setVideoPageSize]    = useState(10);

  async function generateDocs() {
    setGeneratingDocs(true);
    try {
      const r = await apiFetch(`/brain/${brain.brainId}/generate-docs`, locationId, { method: 'POST' });
      if (r.success) {
        toast.success(`Documentation v${r.version || ''} generated.`);
        onRefresh();
      } else toast.error(r.error || 'Failed to generate docs.');
    } catch { toast.error('Request failed.'); }
    setGeneratingDocs(false);
  }

  useEffect(() => {
    setDocs(brain.docs || []);
    setChannels(brain.channels || []);
  }, [brain.brainId]);

  async function reloadVideos() {
    setLoadingVideos(true);
    try {
      const r = await apiFetch(`/brain/${brain.brainId}/videos`, locationId);
      if (r.success) setVideos(r.data || []);
    } catch {}
    setLoadingVideos(false);
  }

  // Load videos catalogue when Channels or Videos tab is opened
  useEffect(() => {
    if (tab === 'videos' || tab === 'channels') reloadVideos();
  }, [tab, brain.brainId]);

  const ytDocs = docs.filter(d => d.url && d.url.includes('youtube.com/watch'));
  const videoCount = videos.length || brain.videoCount || ytDocs.length;

  const isSharedBrain = !!brain.isShared;

  // Users see Channels (read-only) + Videos (read-only) — no management tabs
  const detailTabs = [
    { id: 'channels', label: `Channels (${channels.length})` },
    { id: 'videos',   label: `Videos (${videoCount})` },
  ];

  const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textMuted, borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: '12px 14px', fontSize: 13, color: C.textPri, borderBottom: `1px solid ${C.border}88`, verticalAlign: 'middle' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {showDocsModal && (
        <DocsModal brain={brain} onClose={() => setShowDocsModal(false)} onGenerate={generateDocs} generatingDocs={generatingDocs} />
      )}
      {showChangeLogModal && (
        <ChangeLogModal brain={brain} onClose={() => setShowChangeLogModal(false)} />
      )}

      {/* Back link */}
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.textSec, fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
        ← All brains
      </button>

      {/* Brain header */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.textPri }}>{brain.name}</h2>
              <code style={{ fontSize: 12, color: C.textMuted, background: C.codeBg, padding: '2px 8px', borderRadius: 4, border: `1px solid ${C.border}` }}>{brain.slug}</code>
            </div>
            {brain.description && <p style={{ margin: '8px 0 0', color: C.textMuted, fontSize: 13 }}>{brain.description}</p>}
            {/* Docs + Change Log quick-access badges */}
            {(() => {
              const docsHistory  = brain.docsHistory || [];
              const changeCount  = (brain.syncLog || []).length + (brain.notes || []).length;
              if (!docsHistory.length && !changeCount) return null;
              return (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {docsHistory.length > 0 && (
                    <button onClick={() => setShowDocsModal(true)} style={{ fontSize: 12, fontWeight: 600, color: C.blue, padding: '3px 10px', borderRadius: 6, background: `${C.blue}18`, border: `1px solid ${C.blue}33`, cursor: 'pointer' }}>
                      📄 Docs · v{docsHistory[docsHistory.length - 1]?.version}
                    </button>
                  )}
                  {changeCount > 0 && (
                    <button onClick={() => setShowChangeLogModal(true)} style={{ fontSize: 12, fontWeight: 600, color: C.textSec, padding: '3px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, cursor: 'pointer' }}>
                      📋 {changeCount} change{changeCount !== 1 ? 's' : ''}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
          {/* Read-only badge */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {isSharedBrain && (
              <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.3)', fontWeight: 600 }}>Shared by Admin</span>
            )}
          </div>
        </div>
      </div>


      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}`, marginBottom: 20 }}>
        {detailTabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: 'none', border: 'none', borderBottom: tab === t.id ? `2px solid ${C.blue}` : '2px solid transparent',
            color: tab === t.id ? C.textPri : C.textMuted, padding: '10px 18px', fontSize: 14, fontWeight: tab === t.id ? 600 : 400,
            cursor: 'pointer', marginBottom: -1,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Channels tab ── */}
      {tab === 'channels' && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {channels.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <p style={{ color: C.textMuted, fontSize: 14, margin: 0 }}>No channels yet. Add one to start syncing.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Handle / ID</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Videos</th>
                  <th style={thStyle}>Last synced</th>
                </tr>
              </thead>
              <tbody>
                {channels.map(ch => (
                  <tr key={ch.channelId || ch.channelName}>
                    <td style={tdStyle}>{ch.channelName}</td>
                    <td style={{ ...tdStyle, color: C.textSec, fontFamily: 'monospace', fontSize: 12 }}>{ch.handle || ch.channelUrl || '—'}</td>
                    <td style={tdStyle}>
                      {(ch.isPrimary || ch.type === 'primary')
                        ? <span style={{ background: `${C.blueDark}33`, color: '#93c5fd', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>primary</span>
                        : <span style={{ color: C.textMuted, fontSize: 12 }}>secondary</span>
                      }
                    </td>
                    <td style={{ ...tdStyle, color: C.textSec }}>
                      {videos.length > 0
                        ? videos.filter(v => v.channelId === ch.channelId).length
                        : (ch.videoCount || 0)}
                    </td>
                    <td style={{ ...tdStyle, color: C.textMuted, fontSize: 12 }}>{ch.lastSynced ? timeAgo(ch.lastSynced) : 'Never'}</td>
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
          {/* Header bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.textPri }}>{videos.length} video{videos.length !== 1 ? 's' : ''}</span>
              {videos.length > 0 && (
                <span style={{ fontSize: 12, color: C.textMuted, marginLeft: 10 }}>
                  {videos.filter(v => v.transcriptStatus === 'complete').length} indexed
                  {' · '}
                  {videos.filter(v => v.transcriptStatus === 'pending').length} pending
                  {videos.filter(v => v.transcriptStatus === 'error').length > 0 && (
                    <span style={{ color: C.red }}> · {videos.filter(v => v.transcriptStatus === 'error').length} errors</span>
                  )}
                </span>
              )}
            </div>
            <button onClick={reloadVideos} style={{ ...btnSecondary, fontSize: 12, padding: '6px 14px' }}>↻ Refresh</button>
          </div>

          {/* No videos state */}
          {!loadingVideos && videos.length === 0 && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>▶</div>
              <p style={{ color: C.textPri, fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>No videos yet</p>
              <p style={{ color: C.textMuted, fontSize: 13, margin: 0 }}>
                Videos will appear here once the admin syncs the connected channels.
              </p>
            </div>
          )}

          {loadingVideos && (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>Loading videos…</div>
          )}

          {/* Videos list with pagination */}
          {!loadingVideos && videos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Page size selector */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 12, color: C.textMuted }}>
                  Showing {Math.min((videoPage - 1) * videoPageSize + 1, videos.length)}\u2013{Math.min(videoPage * videoPageSize, videos.length)} of {videos.length}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: C.textMuted }}>Per page:</span>
                  {[5, 10, 25, 50].map(n => (
                    <button key={n} onClick={() => { setVideoPageSize(n); setVideoPage(1); }} style={{
                      background: videoPageSize === n ? C.blue : 'transparent',
                      color: videoPageSize === n ? '#fff' : C.textMuted,
                      border: `1px solid ${videoPageSize === n ? C.blue : C.border}`,
                      borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: videoPageSize === n ? 700 : 400,
                    }}>{n}</button>
                  ))}
                </div>
              </div>
              {videos.slice((videoPage - 1) * videoPageSize, videoPage * videoPageSize).map(video => {
                const status = video.transcriptStatus || 'pending';
                const statusConfig = {
                  complete:   { label: 'Indexed',     bg: '#052e16', color: '#4ade80', border: '#16a34a44' },
                  processing: { label: 'Processing…', bg: '#1c1400', color: '#fbbf24', border: '#d9770044' },
                  error:      { label: 'Error',        bg: '#1c0a00', color: '#f87171', border: '#dc262644' },
                  pending:    { label: 'Pending',      bg: C.bg,      color: C.textMuted, border: C.border },
                }[status] || { label: status, bg: C.bg, color: C.textMuted, border: C.border };

                return (
                  <div key={video.videoId} style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    {/* Thumbnail */}
                    <a href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
                      <div style={{ position: 'relative', width: 80, height: 45 }}>
                        <img
                          src={ytThumb(video.videoId)}
                          alt=""
                          style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 6, display: 'block' }}
                        />
                        <div style={{
                          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'rgba(0,0,0,0.35)', borderRadius: 6,
                        }}>
                          <span style={{ fontSize: 14, color: '#fff' }}>▶</span>
                        </div>
                      </div>
                    </a>

                    {/* Title + meta */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.textPri, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {video.title || video.videoId}
                      </div>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {video.channelName && <span>{video.channelName}</span>}
                        {video.publishDate && <><span>·</span><span>{publishedAgo(video.publishDate)}</span></>}
                        {video.lengthSecs && <><span>·</span><span style={{ fontFamily: 'monospace' }}>{fmtDuration(video.lengthSecs)}</span></>}
                        {video.viewCount > 0 && <><span>·</span><span>{fmtViews(video.viewCount)} views</span></>}
                      </div>
                    </div>

                    {/* Status badge */}
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
                      background: statusConfig.bg, color: statusConfig.color,
                      border: `1px solid ${statusConfig.border}`,
                      whiteSpace: 'nowrap', flexShrink: 0,
                      ...(status === 'processing' ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}),
                    }}>
                      {statusConfig.label}
                    </span>
                  </div>
                );
              })}

              {/* Pagination controls */}
              {videos.length > videoPageSize && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 8, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                  <button onClick={() => setVideoPage(1)} disabled={videoPage === 1} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 5, color: videoPage === 1 ? C.border : C.textSec, padding: '4px 8px', fontSize: 12, cursor: videoPage === 1 ? 'default' : 'pointer' }}>«</button>
                  <button onClick={() => setVideoPage(p => Math.max(1, p - 1))} disabled={videoPage === 1} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 5, color: videoPage === 1 ? C.border : C.textSec, padding: '4px 10px', fontSize: 12, cursor: videoPage === 1 ? 'default' : 'pointer' }}>‹</button>
                  <span style={{ fontSize: 12, color: C.textPri, fontWeight: 600, padding: '0 8px' }}>Page {videoPage} of {Math.ceil(videos.length / videoPageSize)}</span>
                  <button onClick={() => setVideoPage(p => Math.min(Math.ceil(videos.length / videoPageSize), p + 1))} disabled={videoPage >= Math.ceil(videos.length / videoPageSize)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 5, color: videoPage >= Math.ceil(videos.length / videoPageSize) ? C.border : C.textSec, padding: '4px 10px', fontSize: 12, cursor: videoPage >= Math.ceil(videos.length / videoPageSize) ? 'default' : 'pointer' }}>›</button>
                  <button onClick={() => setVideoPage(Math.ceil(videos.length / videoPageSize))} disabled={videoPage >= Math.ceil(videos.length / videoPageSize)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 5, color: videoPage >= Math.ceil(videos.length / videoPageSize) ? C.border : C.textSec, padding: '4px 8px', fontSize: 12, cursor: videoPage >= Math.ceil(videos.length / videoPageSize) ? 'default' : 'pointer' }}>»</button>
                </div>
              )}
            </div>
          )}

        </div>
      )}

    </div>
  );
}

// ── Dashboard view ────────────────────────────────────────────────────────────

function DashboardView({ brains, loading, onSelectBrain, locationId, onSyncBrain, onOpenModal }) {
  const [syncingId, setSyncingId] = useState(null);
  const totalVideos   = brains.reduce((a, b) => a + (b.videoCount || 0), 0);
  const totalIndexed   = brains.reduce((a, b) => a + (b.docCount || 0), 0);
  const totalChunks    = brains.reduce((a, b) => a + (b.chunkCount || 0), 0);
  const totalChannels  = brains.reduce((a, b) => a + (b.channels || []).length, 0);

  async function quickSync(e, brainId) {
    e.stopPropagation();
    setSyncingId(brainId);
    try {
      await apiFetch(`/brain/${brainId}/sync`, locationId, { method: 'POST' });
      if (onSyncBrain) onSyncBrain();
      // Open the brain detail so the user can see the batch processing
      onSelectBrain(brainId);
    } catch {}
    setSyncingId(null);
  }

  const statCards = [
    { label: 'Brains',   value: brains.length,  icon: '🧠' },
    { label: 'Channels', value: totalChannels,   icon: '📡' },
    { label: 'Videos',   value: totalVideos,     icon: '▶', sub: `${totalIndexed} indexed` },
    { label: 'Chunks',   value: totalChunks,     icon: '🧩' },
  ];

  return (
    <div>
      {/* Welcome header + stats bar */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: C.textPri }}>Welcome back</h1>
        <p style={{ margin: '0 0 20px', fontSize: 14, color: C.textMuted }}>Your YouTube knowledge bases at a glance</p>
        <div style={{ fontSize: 13, color: C.textSec, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 16px', display: 'inline-block' }}>
          {brains.length} brain{brains.length !== 1 ? 's' : ''} &nbsp;|&nbsp; {totalVideos.toLocaleString()} videos ({totalIndexed} indexed) &nbsp;|&nbsp; {totalChannels} channel{totalChannels !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        {statCards.map(s => (
          <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 28 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: C.textPri }}>{s.value.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>{s.label}{s.sub ? ` · ${s.sub}` : ''}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Brain grid */}
      {loading && <p style={{ color: C.textMuted, fontSize: 13 }}>Loading brains…</p>}

      {!loading && brains.length === 0 && (
        <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 16, padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🧠</div>
          <h3 style={{ margin: '0 0 8px', color: C.textPri, fontSize: 18 }}>No shared brains yet</h3>
          <p style={{ color: C.textMuted, fontSize: 14, margin: 0 }}>Your administrator will add knowledge bases here — you'll see them once created.</p>
        </div>
      )}

      {!loading && brains.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
          {brains.map(b => {
            const { healthy, pendingCount } = getBrainHealth(b);
            const channelCount = (b.channels || []).length;
            return (
              <div key={b.brainId} onClick={() => onSelectBrain(b.brainId)} style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
                padding: 20, cursor: 'pointer', transition: 'border-color .15s',
              }}
                onMouseEnter={e => e.currentTarget.style.borderColor = C.blue + '88'}
                onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
              >
                {/* Name + health badge */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: C.textPri, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                    {b.isShared && (
                      <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.35)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shared</span>
                    )}
                  </div>
                  {b.pipelineStage === 'syncing' || b.pipelineStage === 'processing' ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: C.blue, flexShrink: 0, marginLeft: 10 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.blue, display: 'inline-block' }} />
                      {b.pipelineStage === 'syncing' ? 'Syncing…' : 'Processing…'}
                    </span>
                  ) : (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: healthy ? C.green : C.amber, flexShrink: 0, marginLeft: 10 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: healthy ? C.green : C.amber, display: 'inline-block' }} />
                      {healthy ? 'Healthy' : 'Needs Attention'}
                    </span>
                  )}
                </div>

                {/* Slug */}
                <code style={{ fontSize: 11, color: C.textMuted, background: C.codeBg, padding: '2px 7px', borderRadius: 4, border: `1px solid ${C.border}`, display: 'inline-block', marginBottom: 14 }}>{b.slug}</code>

                {/* Mini stats */}
                <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                  {[
                    { icon: '📡', val: channelCount,        label: 'channels' },
                    { icon: '▶',  val: b.videoCount || 0,  label: 'videos' },
                    { icon: '✅', val: b.docCount || 0,    label: 'indexed' },
                    { icon: '🧩', val: b.chunkCount || 0,  label: 'chunks' },
                  ].map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 13 }}>{s.icon}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.textPri }}>{s.val.toLocaleString()}</span>
                      <span style={{ fontSize: 12, color: C.textMuted }}>{s.label}</span>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: pendingCount > 0 ? 10 : 0 }}>
                  Quality: No data &nbsp;·&nbsp; Last synced: {b.lastSynced ? timeAgo(b.lastSynced) : b.updatedAt ? timeAgo(b.updatedAt) : 'Never'}
                </div>

                {pendingCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#2d1f00', border: `1px solid ${C.amber}33`, borderRadius: 6, padding: '6px 10px', fontSize: 12, color: C.amber }}>
                    <span>⚠</span> {pendingCount} pending transcription
                  </div>
                )}

                {/* Footer links */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                  {(b.docsHistory?.length > 0 || b.autoDocs) && (
                    <button onClick={e => { e.stopPropagation(); onOpenModal ? onOpenModal(b.brainId, 'docs') : onSelectBrain(b.brainId); }} style={{ fontSize: 12, fontWeight: 600, color: C.blue, padding: '3px 8px', borderRadius: 6, background: `${C.blue}18`, border: `1px solid ${C.blue}33`, cursor: 'pointer' }}>
                      📄 Docs{b.docsHistory?.length ? ` · v${b.docsHistory.length}` : ''}
                    </button>
                  )}
                  {((b.notes || []).length > 0 || (b.syncLog || []).length > 0) && (
                    <button onClick={e => { e.stopPropagation(); onOpenModal ? onOpenModal(b.brainId, 'changelog') : onSelectBrain(b.brainId); }} style={{ fontSize: 12, color: C.textMuted, padding: '3px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, cursor: 'pointer' }}>
                      {((b.notes || []).length + (b.syncLog || []).length)} changes
                    </button>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {b.autoSync && (
                      <span title="Auto-sync enabled" style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>⟳ auto</span>
                    )}
                    {pendingCount > 0 && (
                      <span style={{ background: `${C.amber}22`, color: C.amber, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{pendingCount} pending</span>
                    )}
                    <button
                      title="Sync now"
                      onClick={e => quickSync(e, b.brainId)}
                      style={{
                        background: 'none', border: `1px solid ${C.border}`, borderRadius: 6,
                        color: syncingId === b.brainId ? C.blue : C.textMuted,
                        padding: '3px 8px', fontSize: 14, cursor: 'pointer', lineHeight: 1,
                      }}>
                      <span style={{ display: 'inline-block', animation: syncingId === b.brainId ? 'spin 1s linear infinite' : 'none' }}>↻</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Pipeline view ─────────────────────────────────────────────────────────────

function PipelineView({ brains, onSelectBrain }) {
  const columns = [
    { id: 'needs_sync',  label: 'Needs Sync',  subtitle: 'Waiting for first sync',     icon: '⊙', color: '#6b7280', bgColor: '#1a1f2a' },
    { id: 'syncing',     label: 'Syncing',     subtitle: 'Pulling from YouTube',        icon: '✦', color: C.blue,   bgColor: '#0d1a2e' },
    { id: 'processing',  label: 'Processing',  subtitle: 'Transcribing & embedding',   icon: '⚙', color: C.amber,  bgColor: '#2d1f00' },
    { id: 'ready',       label: 'Ready',       subtitle: 'Up to date & queryable',     icon: '✓', color: C.green,  bgColor: '#062010' },
  ];

  function categorizeBrain(b) {
    // Use stored pipelineStage if available, fall back to computed
    if (b.pipelineStage) return b.pipelineStage;
    const hasContent = (b.docCount || 0) > 0;
    if (!hasContent && (b.channels || []).length === 0) return 'needs_sync';
    if (!hasContent) return 'syncing';
    return 'ready';
  }

  const categorized = {};
  for (const col of columns) categorized[col.id] = brains.filter(b => categorizeBrain(b) === col.id);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: C.textPri }}>Pipeline</h2>
        <p style={{ margin: 0, fontSize: 14, color: C.textMuted }}>{brains.length} brain{brains.length !== 1 ? 's' : ''} across the ingestion pipeline</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {columns.map(col => {
          const items = categorized[col.id] || [];
          return (
            <div key={col.id}>
              {/* Column header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16, color: col.color }}>{col.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.textPri }}>{col.label}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>{col.subtitle}</div>
                  </div>
                </div>
                <span style={{ background: col.bgColor, color: col.color, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{items.length}</span>
              </div>

              {/* Brain mini-cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.length === 0 && (
                  <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 10, padding: '20px 14px', textAlign: 'center', fontSize: 12, color: C.border }}>
                    No brains
                  </div>
                )}
                {items.map(b => (
                  <div
                    key={b.brainId}
                    onClick={() => onSelectBrain && onSelectBrain(b.brainId)}
                    style={{
                      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px',
                      cursor: onSelectBrain ? 'pointer' : 'default', transition: 'border-color .15s',
                    }}
                    onMouseEnter={e => { if (onSelectBrain) e.currentTarget.style.borderColor = C.blue + '88'; }}
                    onMouseLeave={e => { if (onSelectBrain) e.currentTarget.style.borderColor = C.border; }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.textPri, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                    <code style={{ fontSize: 10, color: C.textMuted }}>{b.slug}</code>
                    <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: C.textSec }}>
                      <span>▶ {b.docCount || 0} videos</span>
                      <span>🧩 {b.chunkCount || 0} chunks</span>
                    </div>
                    {b.updatedAt && (
                      <div style={{ marginTop: 6, fontSize: 11, color: C.textMuted }}>{timeAgo(b.updatedAt)}</div>
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
}

// ── Source accordion card ─────────────────────────────────────────────────────

function SourceAccordion({ s, rank, pct, rankColor, rankLabel }) {
  const [open, setOpen] = useState(rank === 0); // #1 open by default
  return (
    <div style={{ border: `1px solid ${rank === 0 ? rankColor + '55' : 'rgba(255,255,255,0.07)'}`, borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: rank === 0 ? 'rgba(245,158,11,0.05)' : 'rgba(255,255,255,0.02)', border: 'none', cursor: 'pointer', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}
      >
        {/* Rank badge */}
        <span style={{ fontSize: 10, fontWeight: 800, color: rankColor, background: rankColor + '18', border: `1px solid ${rankColor}44`, borderRadius: 6, padding: '2px 7px', flexShrink: 0, minWidth: 42, textAlign: 'center' }}>
          {rankLabel}
        </span>
        {/* Accuracy bar */}
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
        {/* Controls */}
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

// ── Search view ───────────────────────────────────────────────────────────────

function SearchView({ brains, locationId }) {
  const [selectedBrainId, setSelectedBrainId] = useState(brains[0]?.brainId || '');
  const [query,           setQuery]           = useState('');
  const [asking,          setAsking]          = useState(false);
  const [answer,          setAnswer]          = useState('');
  const [sources,         setSources]         = useState(null);
  const [searchMethod,    setSearchMethod]    = useState('');
  const [noContext,       setNoContext]        = useState(false);
  const [error,           setError]           = useState('');
  const answerRef = useRef(null);

  useEffect(() => {
    if (!selectedBrainId && brains.length > 0) setSelectedBrainId(brains[0].brainId);
  }, [brains]);

  async function runAsk() {
    if (!query.trim() || !selectedBrainId || asking) return;
    setAsking(true);
    setAnswer('');
    setSources(null);
    setSearchMethod('');
    setNoContext(false);
    setError('');

    try {
      const res = await fetch(`/brain/${selectedBrainId}/ask`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-location-id': locationId || '' },
        body:    JSON.stringify({ query: query.trim(), k: 20 }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Server error ${res.status}`);
        setAsking(false);
        return;
      }

      const reader = res.body.getReader();
      const dec    = new TextDecoder();
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
            if (evt.type === 'sources')     { setSources(evt.sources); setSearchMethod(evt.searchMethod || 'keyword'); }
            if (evt.type === 'text')        { setAnswer(prev => prev + evt.text); }
            if (evt.type === 'no_context')  { setNoContext(true); }
            if (evt.type === 'error')       { setError(evt.error); }
            if (evt.type === 'done')        { setAsking(false); }
          } catch {}
        }
      }
    } catch (e) {
      setError(e.message);
    }
    setAsking(false);
  }


  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: C.textPri }}>Ask Brain</h2>
        <p style={{ margin: 0, fontSize: 14, color: C.textMuted }}>Ask any question — brain will analyze and answer from the transcripts.</p>
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <select
          value={selectedBrainId}
          onChange={e => { setSelectedBrainId(e.target.value); setAnswer(''); setSources(null); setNoContext(false); setError(''); }}
          style={{ ...inputStyle, marginBottom: 0, width: 220, flexShrink: 0 }}
        >
          {brains.map(b => <option key={b.brainId} value={b.brainId}>{b.name}</option>)}
        </select>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && runAsk()}
          placeholder="Ask anything about this brain…"
          style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
        />
        <button
          onClick={runAsk}
          disabled={asking || !query.trim() || !selectedBrainId}
          style={{ ...btnPrimary, flexShrink: 0, opacity: (asking || !query.trim() || !selectedBrainId) ? 0.5 : 1, minWidth: 90 }}
        >
          {asking ? '…' : 'Search'}
        </button>
      </div>


      {/* Thinking indicator while streaming starts */}
      {asking && !answer && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: C.textMuted, fontSize: 13 }}>
          <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: 16 }}>⟳</span>
          Analyzing transcripts…
        </div>
      )}

      {/* Best Answer */}
      {(answer || (asking && answer)) && (
        <div ref={answerRef} style={{ background: '#0a1628', border: `1px solid ${C.blue}33`, borderRadius: 12, padding: '20px 22px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.blue }}>Best Answer</span>
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
            {asking && <span style={{ display: 'inline-block', width: 2, height: '1em', background: C.blue, marginLeft: 2, animation: 'pulse 1s ease-in-out infinite', verticalAlign: 'text-bottom' }} />}
          </div>
        </div>
      )}

      {/* Self-improvement panel — auto-starts 3s after answer, runs continuously in background */}
      {answer && !asking && (
        <SelfImprovementPanel
          type="brain_answer"
          artifact={answer}
          context={{ query }}
          onApply={(improved) => setAnswer(improved)}
          autoStart={true}
          continuous={true}
        />
      )}

      {/* No context */}
      {noContext && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px', color: C.textMuted, fontSize: 13 }}>
          No indexed transcripts matched your query. Try syncing more videos or rephrasing your question.
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: '#1c0a00', border: `1px solid #dc262644`, borderRadius: 10, padding: '14px 16px', color: '#f87171', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Top 5 Answers — ranked excerpt cards */}
      {sources?.length > 0 && !asking && (() => {
        const ANS_COLORS = ['#f59e0b', '#94a3b8', '#cd7c4a', '#6b7280', '#6b7280'];
        const ANS_LABELS = ['#1 Best Match', '#2', '#3', '#4', '#5'];
        const maxScore   = Math.max(...sources.map(s => s.score || 0)) || 1;
        const top5ans    = [...sources].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
        return (
          <div style={{ marginBottom: 24 }}>
            <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Top 5 Answers by Accuracy
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {top5ans.map((s, i) => {
                const pct   = Math.round(((s.score || 0) / maxScore) * 100);
                const color = ANS_COLORS[i];
                return (
                  <div key={i} style={{ background: i === 0 ? 'rgba(245,158,11,0.05)' : C.card, border: `1px solid ${i === 0 ? '#f59e0b55' : C.border}`, borderRadius: 10, padding: '14px 16px' }}>
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color, background: color + '18', border: `1px solid ${color}44`, borderRadius: 6, padding: '2px 8px', flexShrink: 0 }}>
                        {ANS_LABELS[i]}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.sourceLabel || `Source ${i + 1}`}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 800, color, flexShrink: 0 }}>{pct}%</span>
                    </div>
                    {/* Accuracy bar */}
                    <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.07)', marginBottom: 12, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color }} />
                    </div>
                    {/* Answer excerpt */}
                    {s.excerpt && (
                      <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', lineHeight: 1.75 }}>
                        {s.excerpt}{s.excerpt.length >= 300 ? '…' : ''}
                      </p>
                    )}
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer"
                        style={{ display: 'inline-block', marginTop: 8, fontSize: 11, color: C.textMuted, textDecoration: 'none' }}>
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
            <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Top {top10.length} Sources
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {top10.map((s, i) => {
                const pct = Math.round(((s.score || 0) / maxScore) * 100);
                return (
                  <SourceAccordion key={i} s={s} rank={i} pct={pct} rankColor={RANK_COLORS[i]} rankLabel={RANK_LABELS[i]} />
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── MCP view ──────────────────────────────────────────────────────────────────

const MCP_TOOLS = [
  { name: 'search_knowledge',  desc: 'Semantic search within a specific brain.',                                          inputs: 'query (string), brain (string), top_k? (number)' },
  { name: 'chat_with_brain',   desc: 'Full RAG pipeline — retrieves context then generates a grounded response.',         inputs: 'message (string), brain (string), conversation_history? (Message[])' },
  { name: 'get_video',         desc: 'Get full transcript and metadata for a specific YouTube video.',                    inputs: 'video_id (string)' },
  { name: 'list_brains',       desc: 'Returns all brains with health metrics and channel info.',                          inputs: 'none' },
  { name: 'add_brain',         desc: 'Create a new brain from a YouTube channel URL.',                                   inputs: 'name (string), slug (string), channel_url (string), channel_name (string)' },
  { name: 'add_channel',       desc: 'Add a supplementary channel to an existing brain.',                                inputs: 'brain_slug (string), channel_url (string), channel_name (string)' },
];

function McpView({ brains }) {
  const [clientTab, setClientTab] = useState('claude');
  const [copied,    setCopied]    = useState(false);

  const baseUrl = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : 'http://localhost:3000';
  const sseUrl  = `${baseUrl}/sse`;

  const clientConfigs = {
    claude: {
      label: 'Claude Code',
      config: JSON.stringify({ mcpServers: { 'hl-pro-tools': { command: 'curl', args: ['-N', sseUrl] } } }, null, 2),
    },
    cursor: {
      label: 'Cursor',
      config: JSON.stringify({ mcp: { servers: { 'hl-pro-tools': { url: sseUrl, transport: 'sse' } } } }, null, 2),
    },
    windsurf: {
      label: 'Windsurf',
      config: JSON.stringify({ mcpServers: { 'hl-pro-tools': { serverUrl: sseUrl, transport: 'sse' } } }, null, 2),
    },
    generic: {
      label: 'Generic',
      config: JSON.stringify({ server: { url: sseUrl, transport: 'sse', protocol: 'mcp' } }, null, 2),
    },
  };

  const activeConfig = clientConfigs[clientTab]?.config || '';

  function copyConfig() {
    navigator.clipboard.writeText(activeConfig).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textMuted, borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: '12px 14px', fontSize: 13, color: C.textPri, borderBottom: `1px solid ${C.border}88`, verticalAlign: 'top' };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: C.textPri }}>MCP</h2>
        <p style={{ margin: 0, fontSize: 14, color: C.textMuted }}>Model Context Protocol server configuration</p>
      </div>

      {/* How it works */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: C.textPri }}>How it works</h3>
        <p style={{ margin: '0 0 12px', fontSize: 14, color: C.textSec, lineHeight: 1.7 }}>
          This server exposes a Model Context Protocol (MCP) endpoint over Server-Sent Events (SSE). Connect any MCP-compatible AI client to gain access to your brain knowledge bases.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <code style={{ background: C.codeBg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 13, color: '#93c5fd' }}>{sseUrl}</code>
          <span style={{ fontSize: 13, color: C.textMuted }}>&nbsp;·&nbsp; {MCP_TOOLS.length} tools available</span>
        </div>
      </div>

      {/* Client Configuration */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.textPri }}>Client Configuration</h3>
          <button onClick={copyConfig} style={{ ...btnSecondary, fontSize: 12, padding: '5px 12px' }}>
            {copied ? '✓ Copied!' : 'Copy config'}
          </button>
        </div>

        {/* Client tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: `1px solid ${C.border}` }}>
          {Object.entries(clientConfigs).map(([key, val]) => (
            <button key={key} onClick={() => setClientTab(key)} style={{
              background: 'none', border: 'none', borderBottom: clientTab === key ? `2px solid ${C.blue}` : '2px solid transparent',
              color: clientTab === key ? C.textPri : C.textMuted, padding: '8px 16px', fontSize: 13, fontWeight: clientTab === key ? 600 : 400,
              cursor: 'pointer', marginBottom: -1,
            }}>
              {val.label}
            </button>
          ))}
        </div>

        <pre style={{ background: C.codeBg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', fontSize: 12, color: '#93c5fd', overflowX: 'auto', margin: 0, lineHeight: 1.7 }}>
          {activeConfig}
        </pre>
      </div>

      {/* Active Brains */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: C.textPri }}>Active Brains</h3>
        {brains.length === 0 ? (
          <p style={{ color: C.textMuted, fontSize: 13, margin: 0 }}>No brains configured.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {brains.map(b => (
              <div key={b.brainId} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 14px' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.textPri }}>{b.name}</span>
                <code style={{ fontSize: 11, color: C.textMuted, background: C.codeBg, padding: '2px 6px', borderRadius: 4 }}>{b.slug}</code>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Available Tools */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.textPri }}>Available Tools</h3>
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
            {MCP_TOOLS.map(tool => (
              <tr key={tool.name}>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: 13 }}>{tool.name}</span>
                </td>
                <td style={{ ...tdStyle, color: C.textSec }}>{tool.desc}</td>
                <td style={{ ...tdStyle, color: C.textMuted, fontFamily: 'monospace', fontSize: 12 }}>{tool.inputs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Brain() {
  const { locationId } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab  = searchParams.get('tab')    || 'dashboard';
  const selectedId = searchParams.get('brain')  || null;

  // Helper: update search params while preserving parent hub's 'view' param
  const updateParams = (params) => {
    const next = new URLSearchParams(searchParams);
    // Clear brain-specific keys first
    next.delete('tab'); next.delete('brain');
    for (const [k, v] of Object.entries(params)) next.set(k, v);
    setSearchParams(next, { replace: true });
  };

  const [brains,        setBrains]        = useState([]);
  const [loadingBrains, setLoadingBrains] = useState(true);
  const [error,         setError]         = useState('');

  // Brain detail state
  const [selectedBrain, setSelectedBrain] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(!!selectedId);
  const [pendingModal,  setPendingModal]  = useState(null);

  const loadBrains = useCallback(async (silent = false) => {
    if (!locationId) return;
    if (!silent) setLoadingBrains(true);
    try {
      const r = await apiFetch('/brain/list', locationId);
      if (r.success) setBrains(r.data || []);
      else if (!silent) setError(r.error || 'Failed to load brains.');
    } catch {
      if (!silent) setError('Failed to connect to server.');
    }
    if (!silent) setLoadingBrains(false);
  }, [locationId]);

  useEffect(() => { loadBrains(); }, [loadBrains]);

  // Auto-load brain detail when selectedId is present in URL
  useEffect(() => {
    if (selectedId && locationId) loadBrainDetail(selectedId);
    else if (!selectedId) setSelectedBrain(null);
  }, [selectedId, locationId]);

  // Poll every 5s while any brain is actively syncing or processing
  useEffect(() => {
    const activeStages = ['syncing', 'processing'];
    const hasActive = brains.some(b => activeStages.includes(b.pipelineStage));
    if (!hasActive) return;
    const timer = setInterval(() => loadBrains(true), 5000);
    return () => clearInterval(timer);
  }, [brains, loadBrains]);

  async function loadBrainDetail(brainId) {
    setLoadingDetail(true);
    try {
      const r = await apiFetch(`/brain/${brainId}`, locationId);
      if (r.success) setSelectedBrain(r.data);
      else setSelectedBrain(null);
    } catch { setSelectedBrain(null); }
    setLoadingDetail(false);
  }

  function handleSelectBrain(brainId) {
    updateParams({ tab: 'detail', brain: brainId });
  }

  function handleOpenBrainModal(brainId, modal) {
    setPendingModal(modal);
    handleSelectBrain(brainId);
  }

  async function handleDeleted(brainId) {
    const r = await apiFetch(`/brain/${brainId}`, locationId, { method: 'DELETE' });
    if (r.success) {
      updateParams({ tab: 'dashboard' });
      await loadBrains();
    }
  }

  function handleBack() {
    updateParams({ tab: 'dashboard' });
  }

  return (
    <div style={{ height: '100%', background: C.bg, color: C.textPri, fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
      <Header icon="🧠" title="Brain" subtitle="Multi-brain YouTube RAG knowledge base" />

      {/* Top nav */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 24px' }}>
        <div style={{ display: 'flex', gap: 0, flex: 1 }}>
          {NAV_TABS.map(t => (
            <button key={t.id} onClick={() => updateParams({ tab: t.id })} style={{
              background: 'none', border: 'none', borderBottom: activeTab === t.id ? `2px solid ${C.blue}` : '2px solid transparent',
              color: activeTab === t.id ? C.textPri : C.textMuted,
              padding: '14px 18px', fontSize: 14, fontWeight: activeTab === t.id ? 600 : 400,
              cursor: 'pointer', marginBottom: -1,
            }}>
              {t.label}
            </button>
          ))}
          {selectedId && (
            <button onClick={() => updateParams({ tab: 'detail', brain: selectedId })} style={{
              background: 'none', border: 'none', borderBottom: activeTab === 'detail' ? `2px solid ${C.blue}` : '2px solid transparent',
              color: activeTab === 'detail' ? C.textPri : C.textMuted,
              padding: '14px 18px', fontSize: 14, fontWeight: activeTab === 'detail' ? 600 : 400,
              cursor: 'pointer', marginBottom: -1, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {selectedBrain ? selectedBrain.name : 'Brain'}
            </button>
          )}
        </div>
      </div>

      {/* Page content */}
      <div style={{ flex: 1, padding: 28, maxWidth: 1200, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {error && (
          <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, background: '#1c0a00', border: `1px solid ${C.red}44`, color: '#f87171', fontSize: 13 }}>
            {error}
          </div>
        )}

        {activeTab === 'dashboard' && (
          <DashboardView brains={brains} loading={loadingBrains} onAddBrain={() => setShowCreate(true)} onSelectBrain={handleSelectBrain} locationId={locationId} onSyncBrain={() => loadBrains(true)} onOpenModal={handleOpenBrainModal} />
        )}

        {activeTab === 'pipeline' && (
          <PipelineView brains={brains} onSelectBrain={handleSelectBrain} />
        )}

        {activeTab === 'search' && (
          <SearchView brains={brains} locationId={locationId} />
        )}

        {activeTab === 'mcp' && (
          <McpView brains={brains} />
        )}

        {activeTab === 'detail' && (
          <>
            {loadingDetail && <p style={{ color: C.textMuted, fontSize: 13 }}>Loading brain…</p>}
            {!loadingDetail && selectedBrain && (
              <BrainDetail
                brain={selectedBrain}
                locationId={locationId}
                onBack={handleBack}
                onDeleted={handleDeleted}
                onRefresh={() => { loadBrains(); if (selectedBrain?.brainId) loadBrainDetail(selectedBrain.brainId); }}
                initialModal={pendingModal}
                onModalOpened={() => setPendingModal(null)}
              />
            )}
            {!loadingDetail && !selectedBrain && (
              <div style={{ color: '#f87171', fontSize: 13, padding: 20, background: '#1c0a00', border: `1px solid ${C.red}33`, borderRadius: 8 }}>
                Failed to load brain details.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
