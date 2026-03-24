import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';

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

function extractVideoId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
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

const labelStyle = {
  display: 'block', color: C.textSec, fontSize: 12, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
};

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
  { id: 'pipeline',  label: 'Pipeline' },
  { id: 'search',    label: 'Search' },
  { id: 'mcp',       label: 'MCP' },
];

// ── Create Brain Modal ────────────────────────────────────────────────────────

function CreateBrainModal({ onClose, onCreate }) {
  const [name,              setName]              = useState('');
  const [slug,              setSlug]              = useState('');
  const [description,       setDescription]       = useState('');
  const [docsUrl,           setDocsUrl]           = useState('');
  const [changelogUrl,      setChangelogUrl]      = useState('');
  const [channelName,       setChannelName]       = useState('');
  const [channelUrl,        setChannelUrl]        = useState('');
  const [secondaryChannels, setSecondaryChannels] = useState([]);
  const [syncNow,           setSyncNow]           = useState(true);
  const [slugEdited,        setSlugEdited]        = useState(false);
  const [creating,          setCreating]          = useState(false);
  const [error,             setError]             = useState('');

  useEffect(() => {
    if (!slugEdited && name) setSlug(slugify(name));
  }, [name, slugEdited]);

  function addSecondary() {
    setSecondaryChannels(prev => [...prev, { name: '', url: '' }]);
  }
  function updateSecondary(i, field, val) {
    setSecondaryChannels(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: val } : c));
  }
  function removeSecondary(i) {
    setSecondaryChannels(prev => prev.filter((_, idx) => idx !== i));
  }

  async function handleCreate() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setCreating(true);
    setError('');
    try {
      await onCreate({
        name:        name.trim(),
        slug:        slug.trim() || slugify(name),
        description: description.trim(),
        docsUrl:     docsUrl.trim() || undefined,
        changelogUrl: changelogUrl.trim() || undefined,
        primaryChannel: channelName.trim() ? { name: channelName.trim(), url: channelUrl.trim() } : undefined,
        secondaryChannels: secondaryChannels.filter(c => c.name.trim()),
        syncNow,
      });
    } catch (e) {
      setError(e.message || 'Failed to create brain.');
    }
    setCreating(false);
  }

  const sectionLabel = {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
    color: C.textMuted, marginBottom: 10, marginTop: 4,
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: 28, width: '100%', maxWidth: 480,
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.textPri }}>Create a new brain</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: C.textMuted }}>
              A brain groups YouTube channels into a searchable knowledge base.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 20, cursor: 'pointer', marginLeft: 12, flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ borderBottom: `1px solid ${C.border}`, margin: '16px 0' }} />

        {error && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#1c0a00', border: `1px solid ${C.red}44`, color: '#f87171', fontSize: 13 }}>
            {error}
          </div>
        )}

        <label style={labelStyle}>Name <span style={{ color: C.red }}>*</span></label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. AI Research" style={inputStyle} autoFocus />

        <label style={labelStyle}>Slug <span style={{ color: C.red }}>*</span></label>
        <input value={slug} onChange={e => { setSlug(e.target.value); setSlugEdited(true); }} placeholder="e.g. ai-research" style={{ ...inputStyle, marginBottom: 4 }} />
        <p style={{ margin: '0 0 14px', fontSize: 12, color: C.textMuted }}>URL-friendly ID. Auto-generated from name.</p>

        <label style={labelStyle}>Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this brain about?" rows={3} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />

        <label style={labelStyle}>Official Docs URL</label>
        <input value={docsUrl} onChange={e => setDocsUrl(e.target.value)} placeholder="https://docs.example.com" style={inputStyle} />

        <label style={labelStyle}>Changelog URL</label>
        <input value={changelogUrl} onChange={e => setChangelogUrl(e.target.value)} placeholder="https://example.com/changelog" style={inputStyle} />

        <div style={{ borderBottom: `1px solid ${C.border}`, margin: '4px 0 16px' }} />
        <div style={sectionLabel}>Primary Channel</div>

        <label style={labelStyle}>Channel name <span style={{ color: C.red }}>*</span></label>
        <input value={channelName} onChange={e => setChannelName(e.target.value)} placeholder="e.g. Andrej Karpathy" style={inputStyle} />

        <label style={labelStyle}>Channel URL <span style={{ color: C.red }}>*</span></label>
        <input value={channelUrl} onChange={e => setChannelUrl(e.target.value)} placeholder="https://youtube.com/@karpathy" style={{ ...inputStyle, marginBottom: 4 }} />
        <p style={{ margin: '0 0 14px', fontSize: 12, color: C.textMuted }}>Accepts @handle, channel URL, or UC ID.</p>

        {secondaryChannels.map((ch, i) => (
          <div key={i} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Secondary Channel {i + 1}</span>
              <button onClick={() => removeSecondary(i)} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <input value={ch.name} onChange={e => updateSecondary(i, 'name', e.target.value)} placeholder="Channel name" style={{ ...inputStyle, marginBottom: 8 }} />
            <input value={ch.url} onChange={e => updateSecondary(i, 'url', e.target.value)} placeholder="Channel URL or @handle" style={{ ...inputStyle, marginBottom: 0 }} />
          </div>
        ))}

        <button onClick={addSecondary} style={{ background: 'none', border: 'none', color: C.blue, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 20 }}>
          + Add a secondary channel (optional)
        </button>

        <div style={{ borderBottom: `1px solid ${C.border}`, margin: '0 0 16px' }} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={syncNow} onChange={e => setSyncNow(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.blue, cursor: 'pointer' }} />
          <span style={{ fontSize: 13, color: '#d1d5db' }}>Start initial sync immediately &amp; enable weekly updates</span>
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
          <button onClick={handleCreate} disabled={creating || !name.trim()} style={{ ...btnPrimary, opacity: (creating || !name.trim()) ? 0.5 : 1, cursor: (creating || !name.trim()) ? 'not-allowed' : 'pointer' }}>
            {creating ? 'Creating…' : 'Create brain'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Channel Modal ─────────────────────────────────────────────────────────

function AddChannelModal({ brainId, locationId, onClose, onAdded }) {
  const [channelName, setChannelName] = useState('');
  const [channelUrl,  setChannelUrl]  = useState('');
  const [isPrimary,   setIsPrimary]   = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  async function handleAdd() {
    if (!channelName.trim()) { setError('Channel name is required.'); return; }
    if (!channelUrl.trim())  { setError('Channel URL is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const r = await apiFetch(`/brain/${brainId}/channels`, locationId, {
        method: 'POST',
        body:   { channelName: channelName.trim(), channelUrl: channelUrl.trim(), isPrimary },
      });
      if (!r.success) throw new Error(r.error || 'Failed.');
      onAdded(r.data);
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.textPri }}>Add a channel</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: C.textMuted }}>Add another YouTube channel to this brain.</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 20, cursor: 'pointer', marginLeft: 12 }}>✕</button>
        </div>

        <div style={{ borderBottom: `1px solid ${C.border}`, margin: '16px 0' }} />

        {error && <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: '#1c0a00', border: `1px solid ${C.red}44`, color: '#f87171', fontSize: 13 }}>{error}</div>}

        <label style={labelStyle}>Channel name <span style={{ color: C.red }}>*</span></label>
        <input value={channelName} onChange={e => setChannelName(e.target.value)} placeholder="e.g. Andrej Karpathy" style={inputStyle} autoFocus />

        <label style={labelStyle}>Channel URL <span style={{ color: C.red }}>*</span></label>
        <input value={channelUrl} onChange={e => setChannelUrl(e.target.value)} placeholder="https://youtube.com/@handle" style={{ ...inputStyle, marginBottom: 4 }} />
        <p style={{ margin: '0 0 14px', fontSize: 12, color: C.textMuted }}>Accepts @handle, channel URL, or UC ID.</p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none', marginBottom: 24 }}>
          <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.blue }} />
          <span style={{ fontSize: 13, color: '#d1d5db' }}>Set as primary channel</span>
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
          <button onClick={handleAdd} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Adding…' : 'Add channel'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Brain Detail view ─────────────────────────────────────────────────────────

function BrainDetail({ brain, locationId, onBack, onDeleted, onRefresh }) {
  const [tab,               setTab]               = useState('channels');
  const [docs,              setDocs]              = useState(brain.docs || []);
  const [channels,          setChannels]          = useState(brain.channels || []);
  const [loadingDocs,       setLoadingDocs]       = useState(false);
  const [showAddChannel,    setShowAddChannel]    = useState(false);
  const [flash,             setFlash]             = useState(null);
  const [syncing,           setSyncing]           = useState(false);
  const [autoSync,          setAutoSync]          = useState(brain.autoSync === true);
  const [syncingChannelId,  setSyncingChannelId]  = useState(null);

  // Edit brain settings
  const [editName,          setEditName]          = useState(brain.name);
  const [editDesc,          setEditDesc]          = useState(brain.description || '');
  const [editDocsUrl,       setEditDocsUrl]       = useState(brain.docsUrl || '');
  const [editChangelogUrl,  setEditChangelogUrl]  = useState(brain.changelogUrl || '');
  const [saving,            setSaving]            = useState(false);

  // Videos catalogue (from channel sync)
  const [videos,            setVideos]            = useState([]);
  const [loadingVideos,     setLoadingVideos]     = useState(false);
  const [generatingIds,     setGeneratingIds]     = useState(new Set());
  const [batchProcessing,  setBatchProcessing]  = useState(false);
  const [batchProgress,    setBatchProgress]    = useState(null);
  const [batchCooldown,    setBatchCooldown]    = useState(0);
  const batchActiveRef = useRef(false);

  // Pagination
  const [videoPage,        setVideoPage]        = useState(1);
  const [videoPageSize,    setVideoPageSize]    = useState(10);

  // YouTube add (in Add Content section within Videos tab)
  const [ytUrl,             setYtUrl]             = useState('');
  const [ytTitle,           setYtTitle]           = useState('');
  const [ytPrimary,         setYtPrimary]         = useState(false);
  const [ingesting,         setIngesting]         = useState(false);

  // Channel / playlist discovery
  const [channelInfo,       setChannelInfo]       = useState(null);
  const [channelLoading,    setChannelLoading]    = useState(false);
  const [selectedPlaylists, setSelectedPlaylists] = useState({});
  const [playlistPrimary,   setPlaylistPrimary]   = useState(false);
  const [ingestingPlaylist, setIngestingPlaylist] = useState(false);
  const [playlistProgress,  setPlaylistProgress]  = useState(null);

  // Text doc add
  const [docText,           setDocText]           = useState('');
  const [docLabel,          setDocLabel]          = useState('');
  const [docUrl,            setDocUrl]            = useState('');
  const [docPrimary,        setDocPrimary]        = useState(false);
  const [addingDoc,         setAddingDoc]         = useState(false);

  const showFlash = (ok, text) => {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), 4000);
  };

  useEffect(() => {
    setDocs(brain.docs || []);
    setChannels(brain.channels || []);
    setEditName(brain.name);
    setEditDesc(brain.description || '');
    setEditDocsUrl(brain.docsUrl || '');
    setEditChangelogUrl(brain.changelogUrl || '');
  }, [brain.brainId]);

  async function reloadBrain() {
    setLoadingDocs(true);
    try {
      const r = await apiFetch(`/brain/${brain.brainId}`, locationId);
      if (r.success) {
        setDocs(r.data.docs || []);
        setChannels(r.data.channels || []);
      }
    } catch {}
    setLoadingDocs(false);
  }

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

  // Auto-refresh videos while batch processing is active
  useEffect(() => {
    if (!batchProcessing) return;
    const timer = setInterval(reloadVideos, 8000);
    return () => clearInterval(timer);
  }, [batchProcessing, brain.brainId]);

  // Cleanup batch processing on unmount
  useEffect(() => () => { batchActiveRef.current = false; }, []);

  // Batch processing loop — drives server-side /sync-batch from the frontend
  async function startBatchLoop() {
    if (batchActiveRef.current) return;
    batchActiveRef.current = true;
    setBatchProcessing(true);
    let totalDone = 0, totalErrors = 0, batchCount = 0;
    setBatchProgress({ done: 0, remaining: 0, total: 0, errors: 0 });

    const COOLDOWN_MS = 120_000; // 2 minutes between batches

    while (batchActiveRef.current) {
      try {
        const r = await apiFetch(`/brain/${brain.brainId}/sync-batch`, locationId, {
          method: 'POST', body: { batchSize: 2 },
        });
        if (!r.success) { showFlash(false, r.error || 'Batch processing failed.'); break; }
        totalDone += r.ingested || 0;
        totalErrors += r.errors || 0;
        batchCount++;
        setBatchProgress({
          done: totalDone,
          remaining: r.remaining || 0,
          total: totalDone + totalErrors + (r.remaining || 0),
          errors: totalErrors,
        });
        await reloadVideos();
        if (r.done) {
          showFlash(true, `Processing complete — ${totalDone} video${totalDone !== 1 ? 's' : ''} indexed${totalErrors > 0 ? `, ${totalErrors} error${totalErrors !== 1 ? 's' : ''}` : ''}.`);
          break;
        }
        // 2-minute cooldown between batches to avoid YouTube rate limiting
        if (batchActiveRef.current) {
          const endTime = Date.now() + COOLDOWN_MS;
          while (Date.now() < endTime && batchActiveRef.current) {
            setBatchCooldown(Math.ceil((endTime - Date.now()) / 1000));
            await new Promise(res => setTimeout(res, 1000));
          }
          setBatchCooldown(0);
        }
      } catch (e) { showFlash(false, `Processing error: ${e.message}`); break; }
    }

    batchActiveRef.current = false;
    setBatchProcessing(false);
    setBatchProgress(null);
    setBatchCooldown(0);
    onRefresh();
    await reloadBrain();
    await reloadVideos();
  }

  function stopBatchLoop() {
    batchActiveRef.current = false;
  }

  async function generateTranscript(videoId) {
    setGeneratingIds(prev => new Set([...prev, videoId]));
    // Optimistically mark as processing
    setVideos(prev => prev.map(v => v.videoId === videoId ? { ...v, transcriptStatus: 'processing' } : v));
    try {
      const r = await apiFetch(`/brain/${brain.brainId}/videos/${videoId}/transcript`, locationId, { method: 'POST' });
      if (r.success) {
        showFlash(true, `Transcript generated — ${r.chunks} chunks stored.`);
        await reloadVideos();
        onRefresh();
      } else {
        showFlash(false, r.error || 'Failed to generate transcript.');
        setVideos(prev => prev.map(v => v.videoId === videoId ? { ...v, transcriptStatus: 'error', transcriptError: r.error } : v));
      }
    } catch (e) {
      showFlash(false, e.message || 'Failed.');
      setVideos(prev => prev.map(v => v.videoId === videoId ? { ...v, transcriptStatus: 'error' } : v));
    }
    setGeneratingIds(prev => { const s = new Set(prev); s.delete(videoId); return s; });
  }

  async function ingestYoutube() {
    if (!ytUrl.trim()) return;
    setIngesting(true);
    setFlash(null);
    setChannelInfo(null);
    setSelectedPlaylists({});
    try {
      const data = await apiFetch(`/brain/${brain.brainId}/youtube`, locationId, {
        method: 'POST',
        body:   { url: ytUrl.trim(), title: ytTitle.trim() || undefined, isPrimary: ytPrimary },
      });
      if (data.success) {
        showFlash(true, `"${data.title}" ingested — ${data.chunks} chunks stored.`);
        setYtTitle('');
        setYtPrimary(false);
        await reloadBrain();
        onRefresh();
        discoverChannel(ytUrl.trim());
      } else {
        showFlash(false, data.error || 'Failed to ingest video.');
        setYtUrl('');
      }
    } catch { showFlash(false, 'Request failed.'); setYtUrl(''); }
    setIngesting(false);
  }

  async function discoverChannel(url) {
    setChannelLoading(true);
    try {
      const data = await apiFetch(`/brain/channel-info?videoUrl=${encodeURIComponent(url)}`, locationId);
      if (data.success && data.data.playlists.length) setChannelInfo(data.data);
    } catch {}
    setChannelLoading(false);
  }

  async function ingestPlaylists() {
    const ids = Object.entries(selectedPlaylists).filter(([, v]) => v).map(([k]) => k);
    if (!ids.length) return;
    setIngestingPlaylist(true);
    setPlaylistProgress({ done: 0, total: ids.length, current: '' });
    for (let i = 0; i < ids.length; i++) {
      const pl = channelInfo.playlists.find(p => p.id === ids[i]);
      setPlaylistProgress({ done: i, total: ids.length, current: pl?.title || ids[i] });
      try {
        await apiFetch(`/brain/${brain.brainId}/playlist`, locationId, {
          method: 'POST',
          body:   { playlistId: ids[i], isPrimary: playlistPrimary },
        });
      } catch {}
    }
    setPlaylistProgress({ done: ids.length, total: ids.length, current: '' });
    await reloadBrain();
    onRefresh();
    showFlash(true, `Ingested ${ids.length} playlist(s) successfully.`);
    setIngestingPlaylist(false);
    setSelectedPlaylists({});
    setChannelInfo(null);
    setYtUrl('');
  }

  async function addTextDoc() {
    if (!docText.trim()) return;
    setAddingDoc(true);
    setFlash(null);
    try {
      const data = await apiFetch(`/brain/${brain.brainId}/docs`, locationId, {
        method: 'POST',
        body:   { text: docText.trim(), sourceLabel: docLabel.trim() || undefined, url: docUrl.trim() || undefined, isPrimary: docPrimary },
      });
      if (data.success) {
        showFlash(true, `Document added — ${data.chunks} chunks stored.`);
        setDocText(''); setDocLabel(''); setDocUrl(''); setDocPrimary(false);
        await reloadBrain();
        onRefresh();
      } else {
        showFlash(false, data.error || 'Failed to add document.');
      }
    } catch { showFlash(false, 'Request failed.'); }
    setAddingDoc(false);
  }

  async function deleteDoc(docId, label) {
    if (!confirm(`Remove "${label}" from this brain?`)) return;
    try {
      await apiFetch(`/brain/${brain.brainId}/docs/${docId}`, locationId, { method: 'DELETE' });
      await reloadBrain();
      onRefresh();
    } catch { showFlash(false, 'Failed to delete document.'); }
  }

  async function deleteChannel(channelId, name) {
    if (!confirm(`Remove channel "${name}" from this brain?`)) return;
    try {
      const r = await apiFetch(`/brain/${brain.brainId}/channels/${channelId}`, locationId, { method: 'DELETE' });
      if (r.success) {
        setChannels(prev => prev.filter(c => c.channelId !== channelId));
        onRefresh();
      } else {
        showFlash(false, r.error || 'Failed to remove channel.');
      }
    } catch { showFlash(false, 'Failed to remove channel.'); }
  }

  async function syncChannel(channelId, name) {
    setSyncingChannelId(channelId);
    showFlash(true, `Discovering videos for "${name}"…`);
    try {
      // Incremental discovery — call /queue repeatedly until discovering: false
      let result;
      do {
        result = await apiFetch(`/brain/${brain.brainId}/channels/${channelId}/queue`, locationId, { method: 'POST' });
        if (!result.success) { showFlash(false, result.error || 'Failed to sync channel.'); setSyncingChannelId(null); return; }
        if (result.discovering) {
          showFlash(true, `Discovering videos for "${name}"… ${result.videoCount || 0} found so far`);
          await reloadVideos();
        }
      } while (result.discovering);

      const discovered = result.videoCount || result.queued || 0;
      showFlash(true, `"${name}" — ${discovered} videos discovered. Starting transcript processing…`);
      onRefresh();
      await reloadBrain();
      await reloadVideos();
      setTab('videos');
      startBatchLoop();
    } catch (e) { showFlash(false, e.message || 'Sync failed.'); }
    setSyncingChannelId(null);
  }

  function handleChannelAdded(ch) {
    setChannels(prev => [...prev, ch]);
    setShowAddChannel(false);
    showFlash(true, `Channel "${ch.channelName}" added.`);
    onRefresh();
  }

  const ytDocs = docs.filter(d => d.url && d.url.includes('youtube.com/watch'));
  const { pendingCount } = getBrainHealth({ ...brain, docs });
  const totalChunks = docs.reduce((a, d) => a + (d.chunkCount || 0), 0);
  const videoCount = videos.length || brain.videoCount || ytDocs.length;

  const detailTabs = [
    { id: 'channels', label: `Channels (${channels.length})` },
    { id: 'videos',   label: `Videos (${videoCount})` },
    { id: 'settings', label: 'Settings' },
  ];

  const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textMuted, borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: '12px 14px', fontSize: 13, color: C.textPri, borderBottom: `1px solid ${C.border}88`, verticalAlign: 'middle' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {showAddChannel && (
        <AddChannelModal brainId={brain.brainId} locationId={locationId} onClose={() => setShowAddChannel(false)} onAdded={handleChannelAdded} />
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
              {brain.docsUrl && <a href={brain.docsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.textSec, textDecoration: 'none' }}>Docs</a>}
              {brain.changelogUrl && <a href={brain.changelogUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.textSec, textDecoration: 'none' }}>Changelog</a>}
            </div>
            {brain.description && <p style={{ margin: '8px 0 0', color: C.textMuted, fontSize: 13 }}>{brain.description}</p>}
          </div>
          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {/* Auto-sync toggle */}
            <label title={autoSync ? 'Auto-sync ON — discovers new videos every Monday at 8am' : 'Auto-sync OFF — manual only'}
              onClick={async e => {
                e.preventDefault();
                const next = !autoSync;
                setAutoSync(next);
                try {
                  await apiFetch(`/brain/${brain.brainId}`, locationId, { method: 'PATCH', body: { autoSync: next } });
                  showFlash(true, next ? 'Auto-sync enabled — will discover new videos every Monday.' : 'Auto-sync disabled.');
                } catch { setAutoSync(!next); }
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', userSelect: 'none' }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>Auto</span>
              <div style={{
                width: 36, height: 20, borderRadius: 10, background: autoSync ? C.blue : C.border,
                position: 'relative', transition: 'background .2s', flexShrink: 0,
              }}>
                <div style={{
                  position: 'absolute', top: 3, left: autoSync ? 18 : 3,
                  width: 14, height: 14, borderRadius: '50%', background: '#fff',
                  transition: 'left .2s',
                }} />
              </div>
            </label>
            {/* Manual sync icon button */}
            <button
              title={batchProcessing ? 'Processing transcripts…' : 'Sync now'}
              disabled={syncing || batchProcessing}
              onClick={async () => {
                setSyncing(true);
                showFlash(true, 'Discovering videos for all channels…');
                try {
                  const chs = channels.filter(c => c.channelUrl);
                  let totalDiscovered = 0;
                  for (const ch of chs) {
                    // Incremental discovery per channel
                    let result;
                    do {
                      result = await apiFetch(`/brain/${brain.brainId}/channels/${ch.channelId}/queue`, locationId, { method: 'POST' });
                      if (!result.success) break;
                      if (result.discovering) {
                        showFlash(true, `Discovering "${ch.channelName}"… ${result.videoCount || 0} videos found`);
                        await reloadVideos();
                      }
                    } while (result.discovering);
                    if (result.success) totalDiscovered += result.videoCount || result.queued || 0;
                  }
                  showFlash(true, `${totalDiscovered} videos discovered. Starting transcript processing…`);
                  onRefresh();
                  await reloadBrain();
                  await reloadVideos();
                  setTab('videos');
                  startBatchLoop();
                } catch { showFlash(false, 'Sync failed.'); }
                setSyncing(false);
              }}
              style={{
                ...btnSecondary, padding: '7px 10px', fontSize: 16, lineHeight: 1,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                opacity: (syncing || batchProcessing) ? 0.5 : 1,
              }}>
              <span style={{
                display: 'inline-block',
                animation: (syncing || batchProcessing) ? 'spin 1s linear infinite' : 'none',
              }}>↻</span>
            </button>
            <button
              title="Re-index existing chunks into vector database"
              onClick={async () => {
                showFlash(true, 'Re-indexing into vector database…');
                try {
                  const r = await apiFetch(`/brain/${brain.brainId}/reindex`, locationId, { method: 'POST' });
                  if (r.success) showFlash(true, `✓ Vector index updated: ${r.vectors} chunks from ${r.docs} docs`);
                  else showFlash(false, r.error || 'Re-index failed.');
                } catch (e) { showFlash(false, e.message); }
              }}
              style={{ ...btnSecondary, fontSize: 12 }}>
              ⚡ Reindex
            </button>
            <button onClick={() => setShowAddChannel(true)} style={btnPrimary}>+ Add Channel</button>
          </div>
        </div>

        {pendingCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#2d1f00', border: `1px solid ${C.amber}44`, borderRadius: 8, padding: '9px 14px', marginTop: 8 }}>
            <span style={{ color: C.amber, fontSize: 14 }}>⚠</span>
            <span style={{ color: C.amber, fontSize: 13, fontWeight: 500 }}>Needs Attention</span>
            <span style={{ color: '#d97706', fontSize: 13 }}>· {pendingCount} videos pending transcription</span>
          </div>
        )}
      </div>

      {/* Flash */}
      {flash && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: flash.ok ? '#052e16' : '#1c0a00', border: `1px solid ${flash.ok ? C.green + '44' : C.red + '44'}`, color: flash.ok ? '#4ade80' : '#f87171', fontSize: 13 }}>
          {flash.ok ? '✓ ' : '✗ '}{flash.text}
        </div>
      )}

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
                  <th style={{ ...thStyle, width: 80 }}></th>
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
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <button
                        title={batchProcessing ? 'Processing transcripts…' : 'Sync this channel'}
                        disabled={syncingChannelId === ch.channelId || batchProcessing}
                        onClick={() => syncChannel(ch.channelId, ch.channelName)}
                        style={{ background: 'none', border: 'none', color: (syncingChannelId === ch.channelId || batchProcessing) ? C.blue : C.textMuted, cursor: (syncingChannelId === ch.channelId || batchProcessing) ? 'default' : 'pointer', fontSize: 14, padding: '2px 6px' }}>
                        <span style={{ display: 'inline-block', animation: syncingChannelId === ch.channelId ? 'spin 1s linear infinite' : 'none' }}>↻</span>
                      </button>
                      <button onClick={() => deleteChannel(ch.channelId, ch.channelName)} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', fontSize: 14, padding: '2px 6px' }}>✕</button>
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
            <div style={{ display: 'flex', gap: 8 }}>
              {batchProcessing ? (
                <button onClick={stopBatchLoop} style={{ ...btnSecondary, fontSize: 12, padding: '6px 14px', color: C.amber, borderColor: `${C.amber}66` }}>■ Stop Processing</button>
              ) : videos.some(v => v.transcriptStatus === 'pending') ? (
                <button onClick={startBatchLoop} style={{ ...btnPrimary, fontSize: 12, padding: '6px 14px' }}>▶ Process All Pending</button>
              ) : null}
              <button onClick={reloadVideos} style={{ ...btnSecondary, fontSize: 12, padding: '6px 14px' }}>↻ Refresh</button>
            </div>
          </div>

          {/* Batch processing progress */}
          {batchProcessing && batchProgress && (
            <div style={{ marginBottom: 16, background: '#0d1a2e', border: `1px solid ${C.blue}44`, borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#93c5fd' }}>
                  {batchCooldown > 0
                    ? `Next batch in ${Math.floor(batchCooldown / 60)}:${String(batchCooldown % 60).padStart(2, '0')}` 
                    : `Processing transcripts\u2026`
                  }
                  {' '}{batchProgress.done} indexed{batchProgress.errors > 0 ? `, ${batchProgress.errors} errors` : ''} \u2014 {batchProgress.remaining} remaining
                </span>
                <span style={{ fontSize: 12, color: C.textMuted }}>
                  {batchProgress.total > 0 ? Math.round(((batchProgress.done + batchProgress.errors) / batchProgress.total) * 100) : 0}%
                </span>
              </div>
              <div style={{ height: 6, background: '#1e2a3a', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  borderRadius: 3,
                  background: `linear-gradient(90deg, ${C.blue}, #60a5fa)`,
                  width: batchProgress.total > 0 ? `${((batchProgress.done + batchProgress.errors) / batchProgress.total) * 100}%` : '0%',
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          )}

          {/* No videos state */}
          {!loadingVideos && videos.length === 0 && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>▶</div>
              <p style={{ color: C.textPri, fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>No videos discovered yet</p>
              <p style={{ color: C.textMuted, fontSize: 13, margin: '0 0 20px' }}>
                Go to the Channels tab and click ↻ next to a channel to sync its video list.
              </p>
              <button onClick={() => setTab('channels')} style={{ ...btnPrimary, fontSize: 13 }}>Go to Channels</button>
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
                const isGenerating = generatingIds.has(video.videoId);
                const status = isGenerating ? 'processing' : (video.transcriptStatus || 'pending');
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

                    {/* Generate Transcript button */}
                    {(status === 'pending' || status === 'error') && (
                      <button
                        onClick={() => generateTranscript(video.videoId)}
                        disabled={isGenerating}
                        title={status === 'error' ? `Retry (${video.transcriptError || 'unknown error'})` : 'Generate transcript and index this video'}
                        style={{
                          background: status === 'error' ? '#1c0a00' : '#0d1e3a',
                          border: `1px solid ${status === 'error' ? '#dc262666' : C.blue + '66'}`,
                          borderRadius: 7, color: status === 'error' ? '#f87171' : '#60a5fa',
                          fontSize: 12, fontWeight: 600, padding: '5px 12px',
                          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                          display: 'flex', alignItems: 'center', gap: 5,
                        }}
                      >
                        <span>{status === 'error' ? '↺' : '▶'}</span>
                        <span>{status === 'error' ? 'Retry' : 'Generate Transcript'}</span>
                      </button>
                    )}

                    {/* Download + Delete for completed videos */}
                    {status === 'complete' && video.docId && (
                      <>
                        <button
                          onClick={async () => {
                            const res = await fetch(`/brain/${brain.brainId}/videos/${video.videoId}/transcript`, {
                              headers: { 'x-location-id': locationId || '' },
                            });
                            if (!res.ok) return alert('Transcript not available.');
                            const blob = await res.blob();
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = `${(video.title || video.videoId).replace(/[^a-z0-9]+/gi, '-')}.txt`;
                            a.click();
                            URL.revokeObjectURL(a.href);
                          }}
                          title="Download transcript as .txt"
                          style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 15, padding: '4px 6px', flexShrink: 0 }}
                        >
                          ⬇
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`Remove transcript for "${video.title || video.videoId}" from this brain?`)) return;
                            await apiFetch(`/brain/${brain.brainId}/docs/${video.docId}`, locationId, { method: 'DELETE' });
                            await reloadVideos();
                            await reloadBrain();
                            onRefresh();
                          }}
                          title="Remove transcript from brain"
                          style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 14, padding: '4px 6px', flexShrink: 0 }}
                        >
                          ✕
                        </button>
                      </>
                    )}
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

          {/* Add individual YouTube video */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginTop: 24 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: C.textPri }}>Add Individual Video</h3>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: C.textMuted }}>Paste a YouTube URL to immediately generate transcript and index it.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={ytUrl} onChange={e => setYtUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
              <button onClick={ingestYoutube} disabled={ingesting || !ytUrl.trim()} style={{ ...btnPrimary, whiteSpace: 'nowrap', opacity: (ingesting || !ytUrl.trim()) ? 0.5 : 1, cursor: (ingesting || !ytUrl.trim()) ? 'not-allowed' : 'pointer' }}>
                {ingesting ? 'Processing…' : '+ Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Settings tab ── */}
      {tab === 'settings' && (
        <div>
          {/* Brain Settings card */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: C.textPri }}>Brain Settings</h3>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: C.textMuted }}>Edit name, description, and reference links.</p>

            {/* Name + Slug side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 4 }}>
              <div>
                <label style={labelStyle}>Name <span style={{ color: C.red }}>*</span></label>
                <input value={editName} onChange={e => setEditName(e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
              </div>
              <div>
                <label style={labelStyle}>Slug</label>
                <input value={brain.slug} readOnly style={{ ...inputStyle, marginBottom: 0, opacity: 0.5, cursor: 'not-allowed' }} />
                <p style={{ margin: '4px 0 0', fontSize: 11, color: C.textMuted }}>Cannot be changed</p>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={labelStyle}>Description</label>
              <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
            </div>

            {/* Docs + Changelog side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Official docs URL</label>
                <input value={editDocsUrl} onChange={e => setEditDocsUrl(e.target.value)} placeholder="https://docs.example.com" style={{ ...inputStyle, marginBottom: 0 }} />
              </div>
              <div>
                <label style={labelStyle}>Changelog URL</label>
                <input value={editChangelogUrl} onChange={e => setEditChangelogUrl(e.target.value)} placeholder="https://example.com/changelog" style={{ ...inputStyle, marginBottom: 0 }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={async () => {
                setSaving(true);
                try {
                  const r = await apiFetch(`/brain/${brain.brainId}`, locationId, {
                    method: 'PATCH',
                    body: { name: editName, description: editDesc, docsUrl: editDocsUrl, changelogUrl: editChangelogUrl },
                  });
                  if (r.success) { showFlash(true, 'Brain settings saved.'); onRefresh(); }
                  else showFlash(false, r.error || 'Save failed.');
                } catch { showFlash(false, 'Request failed.'); }
                setSaving(false);
              }} style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }}>
                💾 {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div style={{ background: '#1a0808', border: `1px solid ${C.red}33`, borderRadius: 12, padding: 24, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: C.red, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚠</span> Danger Zone
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: C.textMuted }}>
              Permanently delete this brain and all its channels, videos, chunks, and documentation. This action cannot be undone.
            </p>
            <button onClick={() => { if (confirm(`Delete brain "${brain.name}"? This cannot be undone.`)) onDeleted(brain.brainId); }}
              style={{ background: 'none', border: `1px solid ${C.red}`, borderRadius: 8, color: C.red, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              🗑 Delete Brain
            </button>
          </div>

          {/* Sync Changelog */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: C.textPri, display: 'flex', alignItems: 'center', gap: 8 }}>
                  📋 Sync Changelog
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: C.textMuted }}>
                  History of all sync runs — videos ingested, errors, and total knowledge base size after each run.
                </p>
              </div>
              <button
                onClick={async () => {
                  if (!editDocsUrl && !editChangelogUrl) { showFlash(false, 'Set a Docs URL or Changelog URL in settings first.'); return; }
                  showFlash(true, 'Docs sync queued — this will run in the background.');
                }}
                style={{ ...btnPrimary, flexShrink: 0, marginLeft: 16, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
              >
                ↻ Sync Docs
              </button>
            </div>
            {(() => {
              const log = brain.syncLog || [];
              if (log.length === 0) {
                return <p style={{ margin: 0, fontSize: 13, color: C.textMuted }}>No sync runs yet.</p>;
              }
              return (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['When', 'Channel', 'Ingested', 'Errors', 'Total Docs', 'Total Chunks'].map(h => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {log.map((entry, i) => (
                        <tr key={i}>
                          <td style={{ padding: '8px 10px', color: C.textMuted, borderBottom: `1px solid ${C.border}44`, whiteSpace: 'nowrap' }}>{timeAgo(entry.ts)}</td>
                          <td style={{ padding: '8px 10px', color: C.textSec, borderBottom: `1px solid ${C.border}44` }}>{entry.channel || 'All channels'}</td>
                          <td style={{ padding: '8px 10px', color: C.green, fontWeight: 600, borderBottom: `1px solid ${C.border}44` }}>+{entry.ingested}</td>
                          <td style={{ padding: '8px 10px', color: entry.errors > 0 ? C.amber : C.textMuted, borderBottom: `1px solid ${C.border}44` }}>{entry.errors}</td>
                          <td style={{ padding: '8px 10px', color: C.textPri, borderBottom: `1px solid ${C.border}44` }}>{entry.docCount ?? '—'}</td>
                          <td style={{ padding: '8px 10px', color: C.textPri, borderBottom: `1px solid ${C.border}44` }}>{entry.chunkCount ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dashboard view ────────────────────────────────────────────────────────────

function DashboardView({ brains, loading, onAddBrain, onSelectBrain, locationId, onSyncBrain }) {
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
          <h3 style={{ margin: '0 0 8px', color: C.textPri, fontSize: 18 }}>No brains yet</h3>
          <p style={{ color: C.textMuted, fontSize: 14, margin: '0 0 24px' }}>Create a brain to start ingesting YouTube channels.</p>
          <button onClick={onAddBrain} style={btnPrimary}>+ Add Brain</button>
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
                  <span style={{ fontSize: 16, fontWeight: 700, color: C.textPri, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{b.name}</span>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                  {b.docsUrl
                    ? <a href={b.docsUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 12, color: C.textSec, textDecoration: 'none' }}>Docs</a>
                    : <span style={{ fontSize: 12, color: C.border }}>Docs</span>
                  }
                  {b.changelogUrl
                    ? <a href={b.changelogUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 12, color: C.textSec, textDecoration: 'none' }}>Changelog</a>
                    : <span style={{ fontSize: 12, color: C.border }}>Changelog</span>
                  }
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

function PipelineView({ brains }) {
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
                  <div key={b.brainId} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
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

  const hasResult = answer || noContext || error;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: C.textPri }}>Ask AI</h2>
        <p style={{ margin: 0, fontSize: 14, color: C.textMuted }}>Ask any question — Claude will analyze the brain and answer from the transcripts.</p>
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
          {asking ? '…' : 'Ask AI'}
        </button>
      </div>

      {/* Empty state */}
      {!hasResult && !asking && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>✦</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textSec, marginBottom: 8 }}>Ask anything</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>
            Claude will search the indexed transcripts and synthesize a direct answer.<br />
            Try: <em>"What's the best strategy for cold email outreach?"</em>
          </div>
        </div>
      )}

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
            <span style={{ fontSize: 14 }}>✦</span>
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

      {/* Top 5 Sources — accordion ranked by accuracy */}
      {sources?.length > 0 && !asking && (() => {
        const RANK_COLORS = ['#f59e0b', '#94a3b8', '#cd7c4a', '#6b7280', '#6b7280'];
        const RANK_LABELS = ['#1 Best', '#2', '#3', '#4', '#5'];
        const maxScore = Math.max(...sources.map(s => s.score || 0)) || 1;
        const top5 = [...sources]
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 5);
        return (
          <div>
            <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Top {top5.length} Sources
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {top5.map((s, i) => {
                const pct = Math.round(((s.score || 0) / maxScore) * 100);
                const rankColor = RANK_COLORS[i];
                return (
                  <SourceAccordion key={i} s={s} rank={i} pct={pct} rankColor={rankColor} rankLabel={RANK_LABELS[i]} />
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

  const [brains,        setBrains]        = useState([]);
  const [loadingBrains, setLoadingBrains] = useState(true);
  const [showCreate,    setShowCreate]    = useState(false);
  const [error,         setError]         = useState('');

  // Brain detail state
  const [selectedBrain, setSelectedBrain] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(!!selectedId);

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
    setSearchParams({ tab: 'detail', brain: brainId });
  }

  async function handleCreate(opts) {
    const r = await apiFetch('/brain/create', locationId, { method: 'POST', body: opts });
    if (!r.success) throw new Error(r.error || 'Failed to create brain.');
    setShowCreate(false);
    await loadBrains();
    setSearchParams({ tab: 'detail', brain: r.data.brainId });
  }

  async function handleDeleted(brainId) {
    const r = await apiFetch(`/brain/${brainId}`, locationId, { method: 'DELETE' });
    if (r.success) {
      setSearchParams({ tab: 'dashboard' });
      await loadBrains();
    }
  }

  function handleBack() {
    setSearchParams({ tab: 'dashboard' });
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.textPri, fontFamily: 'Inter, system-ui, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
      <Header icon="🧠" title="Brain" subtitle="Multi-brain YouTube RAG knowledge base" />

      {showCreate && (
        <CreateBrainModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}

      {/* Top nav */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 24px' }}>
        <div style={{ display: 'flex', gap: 0, flex: 1 }}>
          {NAV_TABS.map(t => (
            <button key={t.id} onClick={() => setSearchParams({ tab: t.id })} style={{
              background: 'none', border: 'none', borderBottom: activeTab === t.id ? `2px solid ${C.blue}` : '2px solid transparent',
              color: activeTab === t.id ? C.textPri : C.textMuted,
              padding: '14px 18px', fontSize: 14, fontWeight: activeTab === t.id ? 600 : 400,
              cursor: 'pointer', marginBottom: -1,
            }}>
              {t.label}
            </button>
          ))}
          {selectedId && (
            <button onClick={() => setSearchParams({ tab: 'detail', brain: selectedId })} style={{
              background: 'none', border: 'none', borderBottom: activeTab === 'detail' ? `2px solid ${C.blue}` : '2px solid transparent',
              color: activeTab === 'detail' ? C.textPri : C.textMuted,
              padding: '14px 18px', fontSize: 14, fontWeight: activeTab === 'detail' ? 600 : 400,
              cursor: 'pointer', marginBottom: -1, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {selectedBrain ? selectedBrain.name : 'Brain'}
            </button>
          )}
        </div>
        <button onClick={() => setShowCreate(true)} style={{ ...btnPrimary, fontSize: 13, padding: '8px 16px', flexShrink: 0 }}>
          + Add Brain
        </button>
      </div>

      {/* Page content */}
      <div style={{ flex: 1, padding: 28, maxWidth: 1200, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {error && (
          <div style={{ marginBottom: 20, padding: '10px 14px', borderRadius: 8, background: '#1c0a00', border: `1px solid ${C.red}44`, color: '#f87171', fontSize: 13 }}>
            {error}
          </div>
        )}

        {activeTab === 'dashboard' && (
          <DashboardView brains={brains} loading={loadingBrains} onAddBrain={() => setShowCreate(true)} onSelectBrain={handleSelectBrain} locationId={locationId} onSyncBrain={() => loadBrains(true)} />
        )}

        {activeTab === 'pipeline' && (
          <PipelineView brains={brains} />
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
                onRefresh={loadBrains}
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
