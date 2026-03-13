import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import Header from '../components/Header';

/* ── Platform icons / colours ─────────────────────────────────────────── */
const PLATFORM_META = {
  facebook:   { icon: '📘', label: 'Facebook',   color: '#1877f2' },
  instagram:  { icon: '📸', label: 'Instagram',  color: '#e1306c' },
  google:     { icon: '📍', label: 'Google',     color: '#4285f4' },
  linkedin:   { icon: '💼', label: 'LinkedIn',   color: '#0077b5' },
  tiktok:     { icon: '🎵', label: 'TikTok',     color: '#010101' },
  twitter:    { icon: '🐦', label: 'Twitter/X',  color: '#1da1f2' },
  youtube:    { icon: '📺', label: 'YouTube',    color: '#ff0000' },
};

function platformOf(account) {
  const t = (account.type || account.platform || '').toLowerCase();
  for (const key of Object.keys(PLATFORM_META)) {
    if (t.includes(key)) return PLATFORM_META[key];
  }
  return { icon: '🌐', label: account.type || 'Unknown', color: '#6366f1' };
}

/* ── Helpers ──────────────────────────────────────────────────────────── */
function fmt(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_STYLES = {
  SCHEDULED: { bg: 'rgba(99,102,241,0.15)', color: '#818cf8', label: 'Scheduled' },
  PUBLISHED:  { bg: 'rgba(16,185,129,0.15)', color: '#34d399', label: 'Published' },
  DRAFT:      { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af', label: 'Draft' },
};

/* ── Main component ───────────────────────────────────────────────────── */
export default function SocialPlanner() {
  const [accounts, setAccounts]     = useState([]);
  const [posts, setPosts]           = useState([]);
  const [tab, setTab]               = useState('SCHEDULED');
  const [loadingAcc, setLoadingAcc] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [accError, setAccError]     = useState('');
  const [postError, setPostError]   = useState('');
  const [ghlConnected, setGhlConnected] = useState(true);

  // Composer state
  const [composerOpen, setComposerOpen] = useState(false);
  const [postText, setPostText]         = useState('');
  const [selectedAccs, setSelectedAccs] = useState([]);
  const [scheduleMode, setScheduleMode] = useState('NOW');   // NOW | SCHEDULED | DRAFT
  const [scheduledDate, setScheduledDate] = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [submitMsg, setSubmitMsg]       = useState('');

  /* fetch accounts — response: { accounts, ghlConnected, ghlError? } */
  const loadAccounts = useCallback(async () => {
    setLoadingAcc(true); setAccError('');
    try {
      const d = await api.get('/social/accounts');
      const list = Array.isArray(d) ? d : (Array.isArray(d?.accounts) ? d.accounts : []);
      setAccounts(list);
      setGhlConnected(d?.ghlConnected !== false);
      if (d?.ghlError && list.length === 0) setAccError(d.ghlError);
    } catch (e) {
      setAccError(e.message);
      setAccounts([]);
    } finally {
      setLoadingAcc(false);
    }
  }, []);

  /* fetch posts for current tab */
  const loadPosts = useCallback(async (status) => {
    setLoadingPosts(true); setPostError('');
    try {
      const d = await api.get(`/social/posts?status=${status}&limit=50`);
      if (d && d.error) { setPostError(d.error); setPosts([]); return; }
      const list = Array.isArray(d) ? d : (Array.isArray(d?.posts) ? d.posts : []);
      setPosts(list);
    } catch (e) {
      setPostError(e.message);
      setPosts([]);
    } finally {
      setLoadingPosts(false);
    }
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadPosts(tab); }, [loadPosts, tab]);

  /* toggle account selection in composer */
  function toggleAccount(id) {
    setSelectedAccs(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  /* submit post */
  async function handleSubmit(e) {
    e.preventDefault();
    if (!postText.trim()) return;
    if (selectedAccs.length === 0) { setSubmitMsg('Select at least one account.'); return; }
    if (scheduleMode === 'SCHEDULED' && !scheduledDate) { setSubmitMsg('Pick a scheduled date/time.'); return; }

    setSubmitting(true); setSubmitMsg('');
    try {
      const payload = {
        summary: postText.trim(),
        status: scheduleMode,
        accountIds: selectedAccs,
      };
      if (scheduleMode === 'SCHEDULED') payload.scheduledDate = new Date(scheduledDate).toISOString();

      const r = await api.post('/social/posts', payload);
      if (r && r.error) { setSubmitMsg('❌ ' + r.error); return; }
      setSubmitMsg('✅ Post created!');
      setPostText(''); setSelectedAccs([]); setScheduledDate('');
      setTimeout(() => { setComposerOpen(false); setSubmitMsg(''); loadPosts(tab); }, 1500);
    } catch (err) {
      setSubmitMsg('❌ ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  /* delete post */
  async function handleDelete(postId) {
    if (!confirm('Delete this post?')) return;
    try {
      await api.del(`/social/posts/${postId}`);
      loadPosts(tab);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }

  /* ── Render ───────────────────────────────────────────────────────── */
  return (
    <div style={{ minHeight: '100vh', background: '#0f0f13', color: '#e2e8f0', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column' }}>

      {/* Shared top nav */}
      <Header icon="📱" title="Social Planner" subtitle={`${accounts.length} account${accounts.length !== 1 ? 's' : ''} connected`} />

      <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem' }}>

        {/* ── Page hero ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 0.25rem' }}>📱 Social Planner</h1>
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Compose, schedule and track posts across all connected social accounts.</p>
          </div>
          <button
            onClick={() => { setComposerOpen(true); setSubmitMsg(''); }}
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 12px rgba(99,102,241,0.35)' }}
          >
            + New Post
          </button>
        </div>

        {/* ── Connected Accounts card ─────────────────────────────────── */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Connected Accounts</span>
              {accounts.length > 0 && (
                <span style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399', borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>
                  {accounts.length}
                </span>
              )}
            </div>
            <button onClick={loadAccounts} disabled={loadingAcc}
              style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 6, padding: '4px 12px', fontSize: 11, color: '#a5b4fc', cursor: 'pointer', opacity: loadingAcc ? 0.5 : 1 }}>
              {loadingAcc ? '↻ Syncing…' : '↻ Sync'}
            </button>
          </div>

          {!ghlConnected && (
            <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8, padding: '0.5rem 0.9rem', fontSize: 12, color: '#fbbf24', marginBottom: '0.75rem' }}>
              ⚠️ GHL OAuth not connected — cached accounts shown only.
            </div>
          )}

          {loadingAcc ? (
            <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>Syncing from GoHighLevel…</p>
          ) : accError ? (
            <p style={{ color: '#fca5a5', fontSize: 13, margin: 0 }}>{accError}</p>
          ) : accounts.length === 0 ? (
            <p style={{ color: '#4b5563', fontSize: 13, margin: 0 }}>
              No accounts found. Connect via <strong style={{ color: '#9ca3af' }}>GHL → Marketing → Social Planner → Settings</strong>.
            </p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {accounts.map(acc => {
                const pm = platformOf(acc);
                return (
                  <div key={acc.id} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '0.45rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <span style={{ fontSize: 15 }}>{pm.icon}</span>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', margin: 0, lineHeight: 1.2 }}>{acc.name || acc.displayName || acc.username}</p>
                      <p style={{ fontSize: 10, color: '#6b7280', margin: 0 }}>{pm.label}</p>
                    </div>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', marginLeft: 4, flexShrink: 0 }} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Composer Modal ─────────────────────────────────────────── */}
        {composerOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '1.5rem', width: '100%', maxWidth: 540 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h3 style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>Compose Post</h3>
                <button onClick={() => setComposerOpen(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>

              <form onSubmit={handleSubmit}>
                {/* Post text */}
                <textarea
                  value={postText}
                  onChange={e => setPostText(e.target.value)}
                  placeholder="What would you like to post?"
                  rows={5}
                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#e2e8f0', fontSize: 14, padding: '0.75rem', resize: 'vertical', boxSizing: 'border-box' }}
                />

                {/* Account selector */}
                <p style={{ fontSize: 12, color: '#9ca3af', margin: '1rem 0 0.4rem', fontWeight: 600 }}>POST TO</p>
                {accounts.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#6b7280' }}>No accounts available — connect them in GHL first.</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                    {accounts.map(acc => {
                      const pm   = platformOf(acc);
                      const sel  = selectedAccs.includes(acc.id);
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => toggleAccount(acc.id)}
                          style={{
                            background: sel ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                            border: sel ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 8, padding: '4px 10px', fontSize: 12, color: sel ? '#c7d2fe' : '#9ca3af', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 4,
                          }}
                        >
                          {pm.icon} {acc.name || acc.displayName || acc.username}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Timing */}
                <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: '0.4rem', fontWeight: 600 }}>TIMING</p>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: scheduleMode === 'SCHEDULED' ? '0.75rem' : '1rem' }}>
                  {[['NOW', 'Post Now'], ['SCHEDULED', 'Schedule'], ['DRAFT', 'Save Draft']].map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setScheduleMode(val)}
                      style={{
                        flex: 1,
                        background: scheduleMode === val ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                        border: scheduleMode === val ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8, padding: '6px', fontSize: 12, color: scheduleMode === val ? '#c7d2fe' : '#9ca3af', cursor: 'pointer',
                      }}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>

                {scheduleMode === 'SCHEDULED' && (
                  <input
                    type="datetime-local"
                    value={scheduledDate}
                    onChange={e => setScheduledDate(e.target.value)}
                    style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#e2e8f0', fontSize: 13, padding: '0.5rem 0.75rem', boxSizing: 'border-box', marginBottom: '1rem' }}
                  />
                )}

                {submitMsg && (
                  <p style={{ fontSize: 13, color: submitMsg.startsWith('✅') ? '#34d399' : '#fca5a5', marginBottom: '0.75rem' }}>{submitMsg}</p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  style={{ width: '100%', background: submitting ? '#4b5563' : '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '0.65rem', fontWeight: 700, fontSize: 14, cursor: submitting ? 'default' : 'pointer' }}
                >
                  {submitting ? 'Posting…' : scheduleMode === 'DRAFT' ? 'Save Draft' : scheduleMode === 'SCHEDULED' ? 'Schedule Post' : 'Post Now'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ── Posts Table ─────────────────────────────────────────────── */}
        <section>
          {/* Tabs + refresh */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.25rem', background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 4 }}>
              {['SCHEDULED', 'PUBLISHED', 'DRAFT'].map(s => (
                <button key={s} onClick={() => setTab(s)} style={{
                  background: tab === s ? 'rgba(99,102,241,0.3)' : 'transparent',
                  border: tab === s ? '1px solid rgba(99,102,241,0.5)' : '1px solid transparent',
                  borderRadius: 7, padding: '5px 18px', fontSize: 12, fontWeight: 600,
                  color: tab === s ? '#c7d2fe' : '#6b7280', cursor: 'pointer',
                }}>
                  {STATUS_STYLES[s]?.label || s}
                </button>
              ))}
            </div>
            <button onClick={() => loadPosts(tab)} disabled={loadingPosts}
              style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 6, padding: '4px 12px', fontSize: 11, color: '#a5b4fc', cursor: 'pointer', opacity: loadingPosts ? 0.5 : 1 }}>
              {loadingPosts ? '↻ Loading…' : '↻ Refresh'}
            </button>
          </div>

          {loadingPosts ? (
            <p style={{ color: '#6b7280', fontSize: 13 }}>Loading posts…</p>
          ) : postError ? (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '0.75rem 1rem', color: '#fca5a5', fontSize: 13 }}>
              ❌ {postError}
            </div>
          ) : posts.length === 0 ? (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '3rem', textAlign: 'center' }}>
              <p style={{ color: '#4b5563', fontSize: 14, margin: 0 }}>No {STATUS_STYLES[tab]?.label.toLowerCase()} posts yet.</p>
            </div>
          ) : (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 160px 100px 80px', gap: '0.5rem', padding: '0.6rem 1.25rem', background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {['Content', 'Platforms', 'Date', 'Status', ''].map((h, i) => (
                  <span key={i} style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
                ))}
              </div>
              {/* Table rows */}
              {posts.map((post, idx) => {
                const ss  = STATUS_STYLES[post.status] || STATUS_STYLES.DRAFT;
                const pid = post.id || post._id;
                const date = post.status === 'PUBLISHED' ? post.publishedDate : post.scheduledDate;
                return (
                  <div key={pid} style={{
                    display: 'grid', gridTemplateColumns: '1fr 140px 160px 100px 80px',
                    gap: '0.5rem', padding: '0.85rem 1.25rem', alignItems: 'center',
                    borderBottom: idx < posts.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    transition: 'background 0.15s',
                  }}
                    onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseOut={e  => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Content */}
                    <p style={{ fontSize: 13, color: '#e2e8f0', margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.5 }}>
                      {post.summary || post.content || post.text || <span style={{ color: '#4b5563' }}>(no content)</span>}
                    </p>
                    {/* Platforms */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                      {(post.accounts || []).length === 0
                        ? <span style={{ fontSize: 11, color: '#4b5563' }}>—</span>
                        : (post.accounts || []).map(acc => {
                            const pm = platformOf(acc);
                            return (
                              <span key={acc.id} title={`${pm.label}: ${acc.name || acc.displayName || ''}`}
                                style={{ fontSize: 13, background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: '2px 6px' }}>
                                {pm.icon}
                              </span>
                            );
                          })
                      }
                    </div>
                    {/* Date */}
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>
                      {date ? fmt(date) : <span style={{ color: '#4b5563' }}>—</span>}
                    </span>
                    {/* Status badge */}
                    <span style={{ background: ss.bg, color: ss.color, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {ss.label}
                    </span>
                    {/* Actions */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      {post.status !== 'PUBLISHED' && (
                        <button onClick={() => handleDelete(pid)} title="Delete"
                          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: '#f87171', padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      </div>
    </div>
  );
}
