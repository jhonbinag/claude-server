import { useState, useEffect, useCallback } from 'react';
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

function extractVideoId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const labelStyle = {
  display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6,
};

const inputStyle = {
  width: '100%', boxSizing: 'border-box', background: '#111', border: '1px solid #333',
  borderRadius: 8, color: '#e5e7eb', padding: '9px 12px', fontSize: 14, marginBottom: 14,
  outline: 'none',
};

const btnPrimary = {
  background: '#7c3aed', border: 'none', borderRadius: 8,
  color: '#fff', padding: '10px 18px', fontSize: 14, fontWeight: 600,
  cursor: 'pointer',
};

const btnSecondary = {
  background: 'none', border: '1px solid #333', borderRadius: 6,
  color: '#9ca3af', padding: '6px 14px', fontSize: 13, cursor: 'pointer',
};

// ── Create Brain Modal ────────────────────────────────────────────────────────

function CreateBrainModal({ onClose, onCreate }) {
  const [name,           setName]           = useState('');
  const [slug,           setSlug]           = useState('');
  const [description,    setDescription]    = useState('');
  const [docsUrl,        setDocsUrl]        = useState('');
  const [changelogUrl,   setChangelogUrl]   = useState('');
  const [channelName,    setChannelName]    = useState('');
  const [channelUrl,     setChannelUrl]     = useState('');
  const [secondaryChannels, setSecondaryChannels] = useState([]);  // [{ name, url }]
  const [syncNow,        setSyncNow]        = useState(true);
  const [slugEdited,     setSlugEdited]     = useState(false);
  const [creating,       setCreating]       = useState(false);
  const [error,          setError]          = useState('');

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
    color: '#6b7280', marginBottom: 10, marginTop: 4,
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 16,
        padding: 28, width: '100%', maxWidth: 480,
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#e5e7eb' }}>Create a new brain</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
              A brain groups YouTube channels into a searchable knowledge base.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 20, cursor: 'pointer', marginLeft: 12, flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ borderBottom: '1px solid #2a2a2a', margin: '16px 0' }} />

        {error && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#1c0a00', border: '1px solid #ef444444', color: '#f87171', fontSize: 13 }}>
            {error}
          </div>
        )}

        <label style={labelStyle}>Name <span style={{ color: '#ef4444' }}>*</span></label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. AI Research"
          style={inputStyle}
          autoFocus
        />

        <label style={labelStyle}>Slug <span style={{ color: '#ef4444' }}>*</span></label>
        <input
          value={slug}
          onChange={e => { setSlug(e.target.value); setSlugEdited(true); }}
          placeholder="e.g. ai-research"
          style={{ ...inputStyle, marginBottom: 4 }}
        />
        <p style={{ margin: '0 0 14px', fontSize: 12, color: '#6b7280' }}>URL-friendly ID. Auto-generated from name.</p>

        <label style={labelStyle}>Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What is this brain about?"
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
        />

        <label style={labelStyle}>Official docs URL</label>
        <input
          value={docsUrl}
          onChange={e => setDocsUrl(e.target.value)}
          placeholder="https://docs.example.com"
          style={inputStyle}
        />

        <label style={labelStyle}>Changelog URL</label>
        <input
          value={changelogUrl}
          onChange={e => setChangelogUrl(e.target.value)}
          placeholder="https://example.com/changelog"
          style={inputStyle}
        />

        <div style={{ borderBottom: '1px solid #2a2a2a', margin: '4px 0 16px' }} />
        <div style={sectionLabel}>Primary Channel</div>

        <label style={labelStyle}>Channel name <span style={{ color: '#ef4444' }}>*</span></label>
        <input
          value={channelName}
          onChange={e => setChannelName(e.target.value)}
          placeholder="e.g. Andrej Karpathy"
          style={inputStyle}
        />

        <label style={labelStyle}>Channel URL <span style={{ color: '#ef4444' }}>*</span></label>
        <input
          value={channelUrl}
          onChange={e => setChannelUrl(e.target.value)}
          placeholder="https://youtube.com/@karpathy"
          style={{ ...inputStyle, marginBottom: 4 }}
        />
        <p style={{ margin: '0 0 14px', fontSize: 12, color: '#6b7280' }}>Accepts @handle, channel URL, or UC ID.</p>

        {secondaryChannels.map((ch, i) => (
          <div key={i} style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Secondary Channel {i + 1}</span>
              <button onClick={() => removeSecondary(i)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <input
              value={ch.name}
              onChange={e => updateSecondary(i, 'name', e.target.value)}
              placeholder="Channel name"
              style={{ ...inputStyle, marginBottom: 8 }}
            />
            <input
              value={ch.url}
              onChange={e => updateSecondary(i, 'url', e.target.value)}
              placeholder="Channel URL or @handle"
              style={{ ...inputStyle, marginBottom: 0 }}
            />
          </div>
        ))}

        <button onClick={addSecondary} style={{ background: 'none', border: 'none', color: '#7c3aed', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 20 }}>
          + Add a secondary channel (optional)
        </button>

        <div style={{ borderBottom: '1px solid #2a2a2a', margin: '0 0 16px' }} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={syncNow}
            onChange={e => setSyncNow(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: '#7c3aed', cursor: 'pointer' }}
          />
          <span style={{ fontSize: 13, color: '#d1d5db' }}>Start initial sync immediately &amp; enable weekly updates</span>
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            style={{ ...btnPrimary, opacity: (creating || !name.trim()) ? 0.5 : 1, cursor: (creating || !name.trim()) ? 'not-allowed' : 'pointer' }}
          >
            {creating ? 'Creating…' : 'Create brain'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Brain Detail Panel ────────────────────────────────────────────────────────

function BrainDetail({ brain, locationId, onDeleted, onRefresh }) {
  const [tab,          setTab]          = useState('videos');
  const [docs,         setDocs]         = useState(brain.docs || []);
  const [loadingDocs,  setLoadingDocs]  = useState(false);

  // YouTube add
  const [ytUrl,        setYtUrl]        = useState('');
  const [ytTitle,      setYtTitle]      = useState('');
  const [ytPrimary,    setYtPrimary]    = useState(false);
  const [ingesting,    setIngesting]    = useState(false);

  // Channel / playlist discovery
  const [channelInfo,     setChannelInfo]     = useState(null);  // { channelId, channelName, playlists }
  const [channelLoading,  setChannelLoading]  = useState(false);
  const [selectedPlaylists, setSelectedPlaylists] = useState({});  // playlistId → bool
  const [playlistPrimary,   setPlaylistPrimary]   = useState(false);
  const [ingestingPlaylist, setIngestingPlaylist] = useState(false);
  const [playlistProgress,  setPlaylistProgress]  = useState(null);

  // Text doc add
  const [docText,      setDocText]      = useState('');
  const [docLabel,     setDocLabel]     = useState('');
  const [docUrl,       setDocUrl]       = useState('');
  const [docPrimary,   setDocPrimary]   = useState(false);
  const [addingDoc,    setAddingDoc]    = useState(false);

  // Search
  const [query,        setQuery]        = useState('');
  const [querying,     setQuerying]     = useState(false);
  const [queryResults, setQueryResults] = useState(null);

  // Flash
  const [flash,        setFlash]        = useState(null);

  const showFlash = (ok, text) => {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), 4000);
  };

  // Load docs whenever brain changes
  useEffect(() => {
    setDocs(brain.docs || []);
    setTab('videos');
    setQueryResults(null);
  }, [brain.brainId]);

  async function reloadDocs() {
    setLoadingDocs(true);
    try {
      const r = await apiFetch(`/brain/${brain.brainId}`, locationId);
      if (r.success) setDocs(r.data.docs || []);
    } catch {}
    setLoadingDocs(false);
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
        await reloadDocs();
        onRefresh();
        // Auto-discover channel playlists after successful ingest
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
      if (data.success && data.data.playlists.length) {
        setChannelInfo(data.data);
      }
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
    await reloadDocs();
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
        setDocText('');
        setDocLabel('');
        setDocUrl('');
        setDocPrimary(false);
        await reloadDocs();
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
      await reloadDocs();
      onRefresh();
    } catch { showFlash(false, 'Failed to delete document.'); }
  }

  async function runQuery() {
    if (!query.trim()) return;
    setQuerying(true);
    setQueryResults(null);
    try {
      const data = await apiFetch(`/brain/${brain.brainId}/query`, locationId, {
        method: 'POST',
        body:   { query: query.trim(), k: 5 },
      });
      setQueryResults(data.success ? data.data : []);
    } catch { setQueryResults([]); }
    setQuerying(false);
  }

  const totalChunks = docs.reduce((a, d) => a + (d.chunkCount || 0), 0);
  const primaryCount = docs.filter(d => d.isPrimary).length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Brain header */}
      <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                🧠
              </div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#e5e7eb' }}>{brain.name}</h2>
              {brain.slug && (
                <span style={{ fontSize: 11, color: '#4b5563', background: '#111', padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace' }}>
                  {brain.slug}
                </span>
              )}
            </div>
            {brain.description && (
              <p style={{ margin: '4px 0 0 46px', color: '#6b7280', fontSize: 13 }}>{brain.description}</p>
            )}
          </div>
          <button
            onClick={() => { if (confirm(`Delete brain "${brain.name}"? This cannot be undone.`)) onDeleted(brain.brainId); }}
            style={{ ...btnSecondary, color: '#ef4444', borderColor: '#33111144', flexShrink: 0 }}
          >
            Delete brain
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          {[
            { label: 'Videos',   value: docs.filter(d => d.url && d.url.includes('youtube')).length, icon: '▶' },
            { label: 'Chunks',   value: totalChunks,  icon: '🧩' },
            { label: 'Channels', value: (brain.channels || []).length + primaryCount, icon: '📡' },
          ].map(s => (
            <div key={s.label} style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15 }}>{s.icon}</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#e5e7eb' }}>{s.value}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Flash message */}
      {flash && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: flash.ok ? '#052e16' : '#1c0a00', border: `1px solid ${flash.ok ? '#22c55e44' : '#ef444444'}`, color: flash.ok ? '#4ade80' : '#f87171', fontSize: 13 }}>
          {flash.ok ? '✓ ' : '✗ '}{flash.text}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, background: '#111', border: '1px solid #222', borderRadius: 10, marginBottom: 20, overflow: 'hidden' }}>
        {[
          { id: 'videos',  label: 'Videos' },
          { id: 'add',     label: 'Add Content' },
          { id: 'search',  label: 'Search' },
        ].map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setQueryResults(null); }}
            style={{ flex: 1, padding: '10px 8px', background: tab === t.id ? '#7c3aed' : 'transparent', color: tab === t.id ? '#fff' : '#6b7280', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, transition: 'all .15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Videos tab ── */}
      {tab === 'videos' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: '#6b7280' }}>{docs.length} document{docs.length !== 1 ? 's' : ''} ingested</span>
            <button onClick={reloadDocs} style={btnSecondary}>↻ Refresh</button>
          </div>

          {loadingDocs && <p style={{ color: '#4b5563', fontSize: 13 }}>Loading…</p>}

          {!loadingDocs && docs.length === 0 && (
            <div style={{ background: '#1a1a1a', border: '1px dashed #333', borderRadius: 12, padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🧠</div>
              <p style={{ color: '#4b5563', margin: 0, fontSize: 14 }}>
                No content yet.<br />
                Switch to "Add Content" to ingest YouTube videos or paste text.
              </p>
            </div>
          )}

          {!loadingDocs && docs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {docs.map(doc => {
                const isYt  = doc.url && doc.url.includes('youtube.com/watch');
                const vidId = isYt ? extractVideoId(doc.url) : null;
                return (
                  <div key={doc.docId} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 10, overflow: 'hidden' }}>
                    {vidId && (
                      <div style={{ position: 'relative' }}>
                        <img src={ytThumb(vidId)} alt="" style={{ width: '100%', display: 'block', height: 120, objectFit: 'cover', opacity: 0.75 }} />
                        {doc.isPrimary && (
                          <span style={{ position: 'absolute', top: 8, left: 8, background: '#7c3aed', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Primary
                          </span>
                        )}
                      </div>
                    )}
                    <div style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: '0 0 4px', color: '#e5e7eb', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {isYt ? '▶ ' : '📄 '}{doc.sourceLabel || doc.url || 'Untitled'}
                          </p>
                          <p style={{ margin: 0, color: '#4b5563', fontSize: 11 }}>
                            {doc.chunkCount} chunk{doc.chunkCount !== 1 ? 's' : ''} · {timeAgo(doc.addedAt)}
                            {!isYt && doc.isPrimary && (
                              <span style={{ marginLeft: 6, background: '#7c3aed33', color: '#a78bfa', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>PRIMARY</span>
                            )}
                          </p>
                        </div>
                        <button
                          onClick={() => deleteDoc(doc.docId, doc.sourceLabel || 'this document')}
                          style={{ background: 'none', border: '1px solid #33111144', borderRadius: 6, color: '#ef4444', padding: '3px 8px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
                        >
                          ✕
                        </button>
                      </div>
                      {doc.url && (
                        <a href={doc.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#4b5563', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', whiteSpace: 'nowrap', marginTop: 4 }}>
                          {doc.url}
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Add Content tab ── */}
      {tab === 'add' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* YouTube */}
          <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#e5e7eb' }}>Add YouTube Video</h3>

            <label style={labelStyle}>YouTube URL</label>
            <input
              value={ytUrl}
              onChange={e => setYtUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              style={inputStyle}
            />

            <label style={labelStyle}>Title (optional)</label>
            <input
              value={ytTitle}
              onChange={e => setYtTitle(e.target.value)}
              placeholder="e.g. Marketing Strategy 2025"
              style={inputStyle}
            />

            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', fontSize: 13, cursor: 'pointer', marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={ytPrimary}
                onChange={e => setYtPrimary(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: '#7c3aed' }}
              />
              <span style={{ color: '#9ca3af' }}>Primary channel? <span style={{ color: '#4b5563', fontWeight: 400 }}>(boosts search score 1.5×)</span></span>
            </label>

            <button
              onClick={ingestYoutube}
              disabled={ingesting || !ytUrl.trim()}
              style={{ ...btnPrimary, width: '100%', opacity: (ingesting || !ytUrl.trim()) ? 0.5 : 1, cursor: (ingesting || !ytUrl.trim()) ? 'not-allowed' : 'pointer' }}
            >
              {ingesting ? '⏳ Extracting transcript…' : 'Add to Brain'}
            </button>
          </div>

          {/* Channel / Playlist picker — shown after successful video ingest */}
          {(channelLoading || channelInfo) && (
            <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: 20 }}>
              {channelLoading && (
                <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>⏳ Discovering channel playlists…</p>
              )}
              {channelInfo && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <span style={{ fontSize: 22 }}>📺</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb' }}>{channelInfo.channelName}</div>
                      <div style={{ fontSize: 12, color: '#4b5563' }}>{channelInfo.playlists.length} playlists found</div>
                    </div>
                    <button onClick={() => { setChannelInfo(null); setYtUrl(''); }} style={{ ...btnSecondary, marginLeft: 'auto', fontSize: 11, padding: '4px 10px' }}>✕</button>
                  </div>

                  <p style={{ margin: '0 0 12px', fontSize: 12, color: '#6b7280' }}>Select playlists to bulk-ingest into this brain:</p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto', marginBottom: 14 }}>
                    {channelInfo.playlists.map(pl => (
                      <label key={pl.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: selectedPlaylists[pl.id] ? '#1e1050' : '#111', border: `1px solid ${selectedPlaylists[pl.id] ? '#7c3aed55' : '#222'}`, borderRadius: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!selectedPlaylists[pl.id]}
                          onChange={e => setSelectedPlaylists(prev => ({ ...prev, [pl.id]: e.target.checked }))}
                          style={{ width: 15, height: 15, accentColor: '#7c3aed', flexShrink: 0 }}
                        />
                        {pl.thumbnail && <img src={pl.thumbnail} alt="" style={{ width: 48, height: 27, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.title}</div>
                          {pl.videoCount && <div style={{ fontSize: 11, color: '#4b5563' }}>{pl.videoCount} videos</div>}
                        </div>
                      </label>
                    ))}
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9ca3af', marginBottom: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={playlistPrimary} onChange={e => setPlaylistPrimary(e.target.checked)} style={{ width: 14, height: 14, accentColor: '#7c3aed' }} />
                    Mark playlist videos as primary source
                  </label>

                  {ingestingPlaylist && playlistProgress && (
                    <div style={{ marginBottom: 12, padding: '8px 12px', background: '#0d0d0d', borderRadius: 8, fontSize: 12, color: '#9ca3af' }}>
                      ⏳ Ingesting playlist {playlistProgress.done}/{playlistProgress.total}
                      {playlistProgress.current && ` — "${playlistProgress.current}"`}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setSelectedPlaylists(Object.fromEntries(channelInfo.playlists.map(p => [p.id, true])))}
                      style={{ ...btnSecondary, flex: 1, fontSize: 12 }}
                    >
                      Select All
                    </button>
                    <button
                      onClick={ingestPlaylists}
                      disabled={ingestingPlaylist || !Object.values(selectedPlaylists).some(Boolean)}
                      style={{ ...btnPrimary, flex: 2, opacity: (ingestingPlaylist || !Object.values(selectedPlaylists).some(Boolean)) ? 0.5 : 1, cursor: 'pointer' }}
                    >
                      {ingestingPlaylist ? '⏳ Ingesting…' : `Ingest ${Object.values(selectedPlaylists).filter(Boolean).length} Playlist(s)`}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Text doc */}
          <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#e5e7eb' }}>Paste Text / Document</h3>

            <label style={labelStyle}>Source label (optional)</label>
            <input
              value={docLabel}
              onChange={e => setDocLabel(e.target.value)}
              placeholder="e.g. Company SOP v3"
              style={inputStyle}
            />

            <label style={labelStyle}>URL (optional)</label>
            <input
              value={docUrl}
              onChange={e => setDocUrl(e.target.value)}
              placeholder="https://..."
              style={inputStyle}
            />

            <label style={labelStyle}>Text content *</label>
            <textarea
              value={docText}
              onChange={e => setDocText(e.target.value)}
              placeholder="Paste article, transcript, notes, SOPs…"
              rows={6}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
            />

            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', fontSize: 13, cursor: 'pointer', marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={docPrimary}
                onChange={e => setDocPrimary(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: '#7c3aed' }}
              />
              <span style={{ color: '#9ca3af' }}>Mark as primary source <span style={{ color: '#4b5563', fontWeight: 400 }}>(boosts score 1.5×)</span></span>
            </label>

            <button
              onClick={addTextDoc}
              disabled={addingDoc || !docText.trim()}
              style={{ ...btnPrimary, width: '100%', opacity: (addingDoc || !docText.trim()) ? 0.5 : 1, cursor: (addingDoc || !docText.trim()) ? 'not-allowed' : 'pointer' }}
            >
              {addingDoc ? '⏳ Processing…' : 'Add to Brain'}
            </button>
          </div>
        </div>
      )}

      {/* ── Search tab ── */}
      {tab === 'search' && (
        <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#e5e7eb' }}>Search this Brain</h3>

          <label style={labelStyle}>Query</label>
          <textarea
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="e.g. What were the key marketing takeaways?"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', marginBottom: 16 }}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), runQuery())}
          />

          <button
            onClick={runQuery}
            disabled={querying || !query.trim()}
            style={{ ...btnPrimary, width: '100%', opacity: (querying || !query.trim()) ? 0.5 : 1, cursor: (querying || !query.trim()) ? 'not-allowed' : 'pointer' }}
          >
            {querying ? '⏳ Searching…' : 'Search Brain'}
          </button>

          {queryResults !== null && (
            <div style={{ marginTop: 20 }}>
              {queryResults.length === 0
                ? <p style={{ color: '#6b7280', fontSize: 13 }}>No relevant content found.</p>
                : queryResults.map((r, i) => (
                  <div key={i} style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>
                        {r.isPrimary ? '★ ' : ''}📄 {r.sourceLabel || 'Unknown source'}
                      </span>
                      <span style={{ fontSize: 11, color: '#4b5563' }}>score: {r.score ? r.score.toFixed(2) : '—'}</span>
                    </div>
                    <p style={{ margin: 0, color: '#d1d5db', fontSize: 13, lineHeight: 1.6 }}>{r.text}</p>
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

// ── Main Component ────────────────────────────────────────────────────────────

export default function Brain() {
  const { locationId } = useApp();

  const [brains,        setBrains]        = useState([]);
  const [loadingBrains, setLoadingBrains] = useState(true);
  const [selectedId,    setSelectedId]    = useState(null);
  const [selectedBrain, setSelectedBrain] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showCreate,    setShowCreate]    = useState(false);
  const [error,         setError]         = useState('');

  const loadBrains = useCallback(async () => {
    if (!locationId) return;
    setLoadingBrains(true);
    try {
      const r = await apiFetch('/brain/list', locationId);
      if (r.success) setBrains(r.data || []);
      else setError(r.error || 'Failed to load brains.');
    } catch (e) {
      setError('Failed to connect to server.');
    }
    setLoadingBrains(false);
  }, [locationId]);

  useEffect(() => { loadBrains(); }, [loadBrains]);

  async function loadBrainDetail(brainId) {
    setLoadingDetail(true);
    setSelectedId(brainId);
    try {
      const r = await apiFetch(`/brain/${brainId}`, locationId);
      if (r.success) setSelectedBrain(r.data);
      else setSelectedBrain(null);
    } catch {
      setSelectedBrain(null);
    }
    setLoadingDetail(false);
  }

  async function handleCreate(opts) {
    const r = await apiFetch('/brain/create', locationId, { method: 'POST', body: opts });
    if (!r.success) throw new Error(r.error || 'Failed to create brain.');
    setShowCreate(false);
    await loadBrains();
    await loadBrainDetail(r.data.brainId);
  }

  async function handleDeleted(brainId) {
    const r = await apiFetch(`/brain/${brainId}`, locationId, { method: 'DELETE' });
    if (r.success) {
      setSelectedId(null);
      setSelectedBrain(null);
      await loadBrains();
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', color: '#e5e7eb', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <Header icon="🧠" title="Brain" subtitle="Multi-brain YouTube RAG knowledge base" />

      {showCreate && (
        <CreateBrainModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* ── Left sidebar: brain list ── */}
        <div style={{ width: 280, flexShrink: 0, background: '#111', borderRight: '1px solid #1f1f1f', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ padding: '20px 16px 12px' }}>
            <button
              onClick={() => setShowCreate(true)}
              style={{ ...btnPrimary, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13 }}
            >
              <span style={{ fontSize: 16 }}>+</span> Create Brain
            </button>
          </div>

          {error && (
            <div style={{ margin: '0 16px 12px', padding: '10px 12px', borderRadius: 8, background: '#1c0a00', border: '1px solid #ef444433', color: '#f87171', fontSize: 12 }}>
              {error}
            </div>
          )}

          {loadingBrains && (
            <p style={{ color: '#4b5563', fontSize: 13, padding: '12px 16px', margin: 0 }}>Loading…</p>
          )}

          {!loadingBrains && brains.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🧠</div>
              <p style={{ color: '#4b5563', fontSize: 13, margin: 0 }}>No brains yet.<br />Create one to get started.</p>
            </div>
          )}

          <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {brains.map(b => (
              <button
                key={b.brainId}
                onClick={() => loadBrainDetail(b.brainId)}
                style={{
                  width: '100%', textAlign: 'left', background: selectedId === b.brainId ? '#7c3aed22' : 'transparent',
                  border: selectedId === b.brainId ? '1px solid #7c3aed44' : '1px solid transparent',
                  borderRadius: 8, padding: '10px 12px', cursor: 'pointer', transition: 'all .15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 15 }}>🧠</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: selectedId === b.brainId ? '#a78bfa' : '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.name}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#4b5563', paddingLeft: 23 }}>
                  {b.docCount || 0} doc{(b.docCount || 0) !== 1 ? 's' : ''} · {b.chunkCount || 0} chunks
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Right panel: brain detail ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {!selectedId && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 300 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🧠</div>
              <h2 style={{ margin: '0 0 8px', fontSize: 20, color: '#e5e7eb', fontWeight: 600 }}>Select a Brain</h2>
              <p style={{ color: '#4b5563', fontSize: 14, margin: '0 0 24px', textAlign: 'center', maxWidth: 340 }}>
                Choose a brain from the sidebar or create a new one to start ingesting YouTube videos and documents.
              </p>
              <button onClick={() => setShowCreate(true)} style={btnPrimary}>
                + Create your first brain
              </button>
            </div>
          )}

          {selectedId && loadingDetail && (
            <p style={{ color: '#4b5563', fontSize: 13 }}>Loading brain…</p>
          )}

          {selectedId && !loadingDetail && selectedBrain && (
            <BrainDetail
              brain={selectedBrain}
              locationId={locationId}
              onDeleted={handleDeleted}
              onRefresh={loadBrains}
            />
          )}

          {selectedId && !loadingDetail && !selectedBrain && (
            <div style={{ color: '#f87171', fontSize: 13, padding: 20, background: '#1c0a00', border: '1px solid #ef444433', borderRadius: 8 }}>
              Failed to load brain details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
