import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import Header from '../components/Header';

// ── API helper ────────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const { apiKey, locationId } = opts;
  const res = await fetch(path, {
    method:  opts.method || 'GET',
    headers: {
      'Content-Type':  'application/json',
      'x-api-key':     apiKey  || '',
      'x-location-id': locationId || '',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ytThumb(videoId) {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

function extractVideoId(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Brain() {
  const { apiKey, locationId } = useApp();
  const auth = { apiKey, locationId };

  const [status,       setStatus]       = useState(null);
  const [docs,         setDocs]         = useState([]);
  const [loadingDocs,  setLoadingDocs]  = useState(true);

  // Add YouTube
  const [ytUrl,        setYtUrl]        = useState('');
  const [ytTitle,      setYtTitle]      = useState('');
  const [ytPreview,    setYtPreview]    = useState(null);
  const [ingesting,    setIngesting]    = useState(false);
  const [ingestMsg,    setIngestMsg]    = useState(null);

  // Add text/URL doc
  const [docText,      setDocText]      = useState('');
  const [docUrl,       setDocUrl]       = useState('');
  const [docLabel,     setDocLabel]     = useState('');
  const [addingDoc,    setAddingDoc]    = useState(false);

  // Query / search
  const [query,        setQuery]        = useState('');
  const [querying,     setQuerying]     = useState(false);
  const [queryResults, setQueryResults] = useState(null);

  // Active tab: 'youtube' | 'document' | 'query'
  const [tab,          setTab]          = useState('youtube');

  const ytInputRef = useRef(null);

  // ── Load status + docs ─────────────────────────────────────────────────────

  async function loadBrain() {
    setLoadingDocs(true);
    const [st, dl] = await Promise.all([
      apiFetch('/knowledge/brain/status', auth),
      apiFetch('/knowledge/brain/docs',   auth),
    ]);
    setStatus(st);
    setDocs(Array.isArray(dl.data) ? dl.data : []);
    setLoadingDocs(false);
  }

  useEffect(() => { loadBrain(); }, []);

  // ── YouTube preview on URL change ──────────────────────────────────────────

  useEffect(() => {
    const vid = extractVideoId(ytUrl);
    setYtPreview(vid ? vid : null);
  }, [ytUrl]);

  // ── Ingest YouTube ─────────────────────────────────────────────────────────

  async function ingestYoutube() {
    if (!ytUrl.trim()) return;
    setIngesting(true);
    setIngestMsg(null);
    try {
      const data = await apiFetch('/knowledge/brain/youtube', {
        ...auth, method: 'POST',
        body: { url: ytUrl.trim(), title: ytTitle.trim() || undefined },
      });
      if (data.success) {
        setIngestMsg({ ok: true, text: `✓ "${data.title}" ingested — ${data.chunks} chunks stored.` });
        setYtUrl('');
        setYtTitle('');
        loadBrain();
      } else {
        setIngestMsg({ ok: false, text: `✗ ${data.error}` });
      }
    } catch { setIngestMsg({ ok: false, text: '✗ Request failed.' }); }
    setIngesting(false);
  }

  // ── Add document ───────────────────────────────────────────────────────────

  async function addDocument() {
    if (!docText.trim() && !docUrl.trim()) return;
    setAddingDoc(true);
    try {
      const data = await apiFetch('/knowledge/brain/docs', {
        ...auth, method: 'POST',
        body: { text: docText.trim() || undefined, url: docUrl.trim() || undefined, sourceLabel: docLabel.trim() || undefined },
      });
      if (data.success) {
        setIngestMsg({ ok: true, text: `✓ Document added — ${data.chunks} chunks stored.` });
        setDocText('');
        setDocUrl('');
        setDocLabel('');
        loadBrain();
      } else {
        setIngestMsg({ ok: false, text: `✗ ${data.error}` });
      }
    } catch { setIngestMsg({ ok: false, text: '✗ Request failed.' }); }
    setAddingDoc(false);
  }

  // ── Delete doc ─────────────────────────────────────────────────────────────

  async function deleteDoc(docId, label) {
    if (!confirm(`Remove "${label}" from the Brain?`)) return;
    await apiFetch(`/knowledge/brain/docs/${docId}`, { ...auth, method: 'DELETE' });
    loadBrain();
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  async function runQuery() {
    if (!query.trim()) return;
    setQuerying(true);
    setQueryResults(null);
    try {
      const data = await apiFetch('/knowledge/brain/query', {
        ...auth, method: 'POST', body: { query: query.trim(), k: 5 },
      });
      setQueryResults(data.success ? data.data : []);
    } catch { setQueryResults([]); }
    setQuerying(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────


  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', color: '#e5e7eb', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <Header icon="🧠" title="Brain" subtitle="Knowledge base — the system's long-term memory" />
      <div style={{ flex: 1, padding: '32px 24px', overflowY: 'auto' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🧠</div>
            <div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Brain</h1>
              <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>Knowledge base — the system's long-term memory</p>
            </div>
          </div>

          {/* Stats bar */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
            {[
              { label: 'Documents', value: status ? docs.length : '—', icon: '📄' },
              { label: 'Chunks',    value: status?.chunks ?? '—',      icon: '🧩' },
              { label: 'Storage', value: status?.backend === 'redis' ? 'Redis' : status?.backend === 'memory' ? 'Memory' : '—', icon: '🔗', color: '#22c55e' },
            ].map(s => (
              <div key={s.label} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 10, padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>{s.icon}</span>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: s.color || '#fff' }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {status?.backend && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#4b5563' }}>
              Storage: <span style={{ color: status.backend === 'redis' ? '#22c55e' : '#9ca3af' }}>{status.backend === 'redis' ? 'Redis (Upstash)' : 'In-memory'}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

          {/* ── Left: Add content + query ── */}
          <div>
            {/* Tab switcher */}
            <div style={{ display: 'flex', gap: 0, background: '#111', border: '1px solid #222', borderRadius: 10, marginBottom: 20, overflow: 'hidden' }}>
              {[
                { id: 'youtube',  label: '▶ YouTube' },
                { id: 'document', label: '📄 Document' },
                { id: 'query',    label: '🔍 Search' },
              ].map(t => (
                <button key={t.id} onClick={() => { setTab(t.id); setIngestMsg(null); }}
                  style={{ flex: 1, padding: '10px 8px', background: tab === t.id ? '#7c3aed' : 'transparent', color: tab === t.id ? '#fff' : '#6b7280', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, transition: 'all .15s' }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Flash message */}
            {ingestMsg && (
              <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: ingestMsg.ok ? '#052e16' : '#1c0a00', border: `1px solid ${ingestMsg.ok ? '#22c55e44' : '#ef444444'}`, color: ingestMsg.ok ? '#4ade80' : '#f87171', fontSize: 13 }}>
                {ingestMsg.text}
              </div>
            )}

            {/* ── YouTube tab ── */}
            {tab === 'youtube' && (
              <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#e5e7eb' }}>Ingest YouTube Video</h3>

                {ytPreview && (
                  <div style={{ marginBottom: 14, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                    <img src={ytThumb(ytPreview)} alt="thumbnail" style={{ width: '100%', display: 'block', borderRadius: 8 }} />
                    <a href={`https://www.youtube.com/watch?v=${ytPreview}`} target="_blank" rel="noreferrer"
                      style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', fontSize: 36, textDecoration: 'none' }}>
                      ▶
                    </a>
                  </div>
                )}

                <label style={labelStyle}>YouTube URL</label>
                <input ref={ytInputRef} value={ytUrl} onChange={e => setYtUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  style={inputStyle}
                  onKeyDown={e => e.key === 'Enter' && ingestYoutube()}
                />

                <label style={labelStyle}>Title (optional)</label>
                <input value={ytTitle} onChange={e => setYtTitle(e.target.value)}
                  placeholder="e.g. Marketing Strategy 2025"
                  style={{ ...inputStyle, marginBottom: 16 }}
                  onKeyDown={e => e.key === 'Enter' && ingestYoutube()}
                />

                <button onClick={ingestYoutube} disabled={ingesting || !ytUrl.trim()}
                  style={{ ...btnPrimary, width: '100%', opacity: (ingesting || !ytUrl.trim()) ? 0.5 : 1, cursor: (ingesting || !ytUrl.trim()) ? 'not-allowed' : 'pointer' }}>
                  {ingesting ? '⏳ Extracting transcript…' : '🧠 Add to Brain'}
                </button>
                <p style={{ margin: '10px 0 0', color: '#4b5563', fontSize: 12 }}>
                  The video's captions/transcript will be chunked, embedded, and stored in the vector database.
                </p>
              </div>
            )}

            {/* ── Document tab ── */}
            {tab === 'document' && (
              <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#e5e7eb' }}>Add Document or URL</h3>

                <label style={labelStyle}>URL (fetches page content via Jina)</label>
                <input value={docUrl} onChange={e => setDocUrl(e.target.value)}
                  placeholder="https://example.com/article"
                  style={inputStyle}
                />

                <label style={labelStyle}>— or paste text directly —</label>
                <textarea value={docText} onChange={e => setDocText(e.target.value)}
                  placeholder="Paste article, transcript, notes, SOPs…"
                  rows={6}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                />

                <label style={labelStyle}>Source label (optional)</label>
                <input value={docLabel} onChange={e => setDocLabel(e.target.value)}
                  placeholder="e.g. Company SOP v3"
                  style={{ ...inputStyle, marginBottom: 16 }}
                />

                <button onClick={addDocument} disabled={addingDoc || (!docText.trim() && !docUrl.trim())}
                  style={{ ...btnPrimary, width: '100%', opacity: (addingDoc || (!docText.trim() && !docUrl.trim())) ? 0.5 : 1, cursor: (addingDoc || (!docText.trim() && !docUrl.trim())) ? 'not-allowed' : 'pointer' }}>
                  {addingDoc ? '⏳ Processing…' : '🧠 Add to Brain'}
                </button>
              </div>
            )}

            {/* ── Query tab ── */}
            {tab === 'query' && (
              <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#e5e7eb' }}>Search the Brain</h3>

                <label style={labelStyle}>Question or search query</label>
                <textarea value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="e.g. What did the video say about email marketing strategies?"
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical', marginBottom: 16 }}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), runQuery())}
                />

                <button onClick={runQuery} disabled={querying || !query.trim()}
                  style={{ ...btnPrimary, width: '100%', opacity: (querying || !query.trim()) ? 0.5 : 1, cursor: (querying || !query.trim()) ? 'not-allowed' : 'pointer' }}>
                  {querying ? '⏳ Searching…' : '🔍 Search Brain'}
                </button>

                {queryResults !== null && (
                  <div style={{ marginTop: 20 }}>
                    {queryResults.length === 0
                      ? <p style={{ color: '#6b7280', fontSize: 13 }}>No relevant content found.</p>
                      : queryResults.map((r, i) => (
                        <div key={i} style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>📄 {r.sourceLabel || 'Unknown source'}</span>
                            <span style={{ fontSize: 11, color: '#4b5563' }}>score: {r.score ? r.score.toFixed(3) : '—'}</span>
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

          {/* ── Right: Document list ── */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 15, color: '#e5e7eb' }}>Knowledge Base</h3>
              <button onClick={loadBrain} style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#6b7280', padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>↻ Refresh</button>
            </div>

            {loadingDocs
              ? <p style={{ color: '#4b5563', fontSize: 13 }}>Loading…</p>
              : docs.length === 0
                ? (
                  <div style={{ background: '#1a1a1a', border: '1px dashed #333', borderRadius: 12, padding: '32px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>🧠</div>
                    <p style={{ color: '#4b5563', margin: 0, fontSize: 14 }}>No content yet.<br />Add YouTube videos or documents to get started.</p>
                  </div>
                )
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 600, overflowY: 'auto' }}>
                    {docs.map(doc => {
                      const isYt = doc.url && doc.url.includes('youtube.com/watch');
                      const vidId = isYt ? extractVideoId(doc.url) : null;
                      return (
                        <div key={doc.docId} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 10, overflow: 'hidden' }}>
                          {vidId && (
                            <img src={ytThumb(vidId)} alt="" style={{ width: '100%', display: 'block', height: 100, objectFit: 'cover', opacity: 0.7 }} />
                          )}
                          <div style={{ padding: '10px 14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ margin: '0 0 4px', color: '#e5e7eb', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {isYt ? '▶ ' : '📄 '}{doc.sourceLabel || doc.url || 'Untitled'}
                                </p>
                                <p style={{ margin: 0, color: '#4b5563', fontSize: 11 }}>
                                  {doc.chunkCount} chunk{doc.chunkCount !== 1 ? 's' : ''} · {timeAgo(doc.addedAt)}
                                </p>
                              </div>
                              <button onClick={() => deleteDoc(doc.docId, doc.sourceLabel || 'this document')}
                                style={{ background: 'none', border: '1px solid #33111144', borderRadius: 6, color: '#ef4444', padding: '3px 8px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>
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
                )
            }
          </div>
        </div>
      </div>
      </div>
    </div>
  );
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
  color: '#fff', padding: '11px 20px', fontSize: 14, fontWeight: 600,
};
