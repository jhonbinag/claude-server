import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

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

  // Composer state
  const [composerOpen, setComposerOpen] = useState(false);
  const [postText, setPostText]         = useState('');
  const [selectedAccs, setSelectedAccs] = useState([]);
  const [scheduleMode, setScheduleMode] = useState('NOW');   // NOW | SCHEDULED | DRAFT
  const [scheduledDate, setScheduledDate] = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [submitMsg, setSubmitMsg]       = useState('');

  /* fetch accounts */
  const loadAccounts = useCallback(async () => {
    setLoadingAcc(true); setAccError('');
    try {
      const d = await api.get('/social/accounts');
      if (d && d.error) { setAccError(d.error); setAccounts([]); return; }
      const list = Array.isArray(d) ? d : (Array.isArray(d?.accounts) ? d.accounts : []);
      setAccounts(list);
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
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary, #0f0f1a)', color: '#e2e8f0', fontFamily: 'sans-serif' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Link to="/" style={{ color: '#6366f1', textDecoration: 'none', fontSize: 13 }}>← Back</Link>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>📱 Social Planner</span>
          </div>
          <button
            onClick={() => { setComposerOpen(true); setSubmitMsg(''); }}
            style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            + New Post
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem' }}>

        {/* ── Connected Accounts ──────────────────────────────────────── */}
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
            Connected Accounts
          </h2>

          {loadingAcc ? (
            <p style={{ color: '#6b7280', fontSize: 13 }}>Loading accounts…</p>
          ) : accError ? (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '0.75rem 1rem', fontSize: 13, color: '#fca5a5' }}>
              {accError.includes('OAuth') ? (
                <>GHL OAuth not connected for this location. <Link to="/settings" style={{ color: '#818cf8' }}>Go to Settings →</Link></>
              ) : accError}
            </div>
          ) : accounts.length === 0 ? (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.5rem', textAlign: 'center' }}>
              <p style={{ color: '#6b7280', fontSize: 13, marginBottom: '0.5rem' }}>No social accounts connected in GoHighLevel.</p>
              <p style={{ color: '#4b5563', fontSize: 12 }}>Connect accounts via <strong style={{ color: '#9ca3af' }}>GHL → Marketing → Social Planner → Settings</strong>.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {accounts.map(acc => {
                const pm = platformOf(acc);
                return (
                  <div key={acc.id} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 160 }}>
                    <span style={{ fontSize: 18 }}>{pm.icon}</span>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', margin: 0 }}>{acc.name || acc.displayName || acc.username}</p>
                      <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>{pm.label}</p>
                    </div>
                    <span style={{ marginLeft: 'auto', width: 7, height: 7, borderRadius: '50%', background: '#34d399', flexShrink: 0 }} title="Connected" />
                  </div>
                );
              })}
            </div>
          )}
        </section>

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

        {/* ── Posts List ─────────────────────────────────────────────── */}
        <section>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
            {['SCHEDULED', 'PUBLISHED', 'DRAFT'].map(s => (
              <button
                key={s}
                onClick={() => setTab(s)}
                style={{
                  background: tab === s ? 'rgba(99,102,241,0.3)' : 'transparent',
                  border: tab === s ? '1px solid rgba(99,102,241,0.5)' : '1px solid transparent',
                  borderRadius: 7, padding: '5px 16px', fontSize: 12, fontWeight: 600,
                  color: tab === s ? '#c7d2fe' : '#6b7280', cursor: 'pointer',
                }}
              >
                {STATUS_STYLES[s]?.label || s}
              </button>
            ))}
          </div>

          {loadingPosts ? (
            <p style={{ color: '#6b7280', fontSize: 13 }}>Loading posts…</p>
          ) : postError ? (
            <p style={{ color: '#fca5a5', fontSize: 13 }}>Error: {postError}</p>
          ) : posts.length === 0 ? (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: '#4b5563', fontSize: 13 }}>No {STATUS_STYLES[tab]?.label.toLowerCase()} posts yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {posts.map(post => {
                const ss = STATUS_STYLES[post.status] || STATUS_STYLES.DRAFT;
                return (
                  <div key={post.id || post._id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem 1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, color: '#e2e8f0', margin: '0 0 0.4rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {post.summary || post.content || post.text || '(no content)'}
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                          <span style={{ background: ss.bg, color: ss.color, borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>{ss.label}</span>
                          {post.scheduledDate && (
                            <span style={{ fontSize: 11, color: '#6b7280' }}>🕐 {fmt(post.scheduledDate)}</span>
                          )}
                          {post.publishedDate && (
                            <span style={{ fontSize: 11, color: '#6b7280' }}>✅ {fmt(post.publishedDate)}</span>
                          )}
                          {(post.accounts || []).map(acc => {
                            const pm = platformOf(acc);
                            return <span key={acc.id} style={{ fontSize: 12 }} title={pm.label}>{pm.icon}</span>;
                          })}
                        </div>
                      </div>
                      {post.status !== 'PUBLISHED' && (
                        <button
                          onClick={() => handleDelete(post.id || post._id)}
                          title="Delete post"
                          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: '#f87171', padding: '4px 10px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
                        >
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
  );
}
