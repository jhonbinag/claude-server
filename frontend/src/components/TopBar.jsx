import { useState, useRef, useEffect } from 'react';
import { toast } from 'react-toastify';
import { useApp } from '../context/AppContext';

const FEATURE_META = {
  dashboard:        { label: 'Dashboard',           icon: '⊞'  },
  chats:            { label: 'Chats',               icon: '💬' },
  settings:         { label: 'Settings',            icon: '⚙️' },
  agents:           { label: 'AI Agents',           icon: '🤖' },
  ghl_agent:        { label: 'GHL Agent',           icon: '⚡' },
  workflows:        { label: 'Workflow Builder',    icon: '🔀' },
  brain:            { label: 'Brain',               icon: '🧠' },
  funnel_builder:   { label: 'Funnel Builder',      icon: '🏗️' },
  website_builder:  { label: 'Website Builder',     icon: '🌐' },
  email_builder:    { label: 'Email Builder',       icon: '📧' },
  campaign_builder: { label: 'Campaign Builder',    icon: '📣' },
  ads_generator:    { label: 'Bulk Ads Generator',  icon: '🎯' },
  ad_library:       { label: 'Ad Library Intel',    icon: '📊' },
  social_planner:   { label: 'Social Planner',      icon: '📱' },
  manychat:         { label: 'ManyChat',            icon: '📩' },
};

export default function TopBar({ onMenuClick }) {
  const {
    theme, toggleTheme, claudeReady, locationId, locationName,
    betaFeatures, unreadBetaCount, acknowledgeBeta, toggleBeta, userRole,
  } = useApp();
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [betaOpen,    setBetaOpen]    = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (searchOpen && inputRef.current) inputRef.current.focus();
  }, [searchOpen]);

  const isDark = theme === 'dark';
  const isMiniAdmin = userRole === 'mini_admin' || userRole === 'owner' || userRole === 'admin';

  // Visible (non-panel-only) features for the banner panel
  const visibleFeatures = betaFeatures.filter(f => f.visible && !f.panelOnly);

  return (
    <>
      {/* ── Beta banner strip ── shown when there are unread features */}
      {unreadBetaCount > 0 && (
        <div
          style={{
            background: 'linear-gradient(90deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.12) 100%)',
            borderBottom: '1px solid rgba(99,102,241,0.3)',
            padding: '7px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            fontSize: 13,
          }}
          onClick={() => setBetaOpen(true)}
        >
          <span style={{ fontSize: 15 }}>🧪</span>
          <span style={{ color: '#a5b4fc', fontWeight: 600 }}>
            {unreadBetaCount} new update{unreadBetaCount > 1 ? 's' : ''} available
          </span>
          <span style={{ color: '#6b7280', marginLeft: 4 }}>— click to view</span>
          <span style={{
            marginLeft: 'auto', fontSize: 11, background: '#6366f1', color: '#fff',
            borderRadius: 99, padding: '2px 9px', fontWeight: 600,
          }}>{unreadBetaCount}</span>
        </div>
      )}

      <header className="hl-topbar">

        {/* Left — hamburger, mobile only (hidden on md+) */}
        <div className="md:hidden" style={{ flexShrink: 0 }}>
          <button
            onClick={onMenuClick}
            style={{
              width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent',
              border: '1px solid var(--sidebar-border)',
              borderRadius: 7,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 14,
            }}
            aria-label="Toggle menu"
          >
            ☰
          </button>
        </div>

        {/* Center — search */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {searchOpen ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative', width: '100%', maxWidth: 420 }}>
              <span style={{ position: 'absolute', left: 10, color: 'var(--text-muted)', fontSize: 13, pointerEvents: 'none' }}>🔍</span>
              <input
                ref={inputRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onBlur={() => { setSearchOpen(false); setSearchQuery(''); }}
                onKeyDown={e => { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); } }}
                placeholder="Search…"
                style={{
                  width: '100%',
                  background: 'var(--search-bg)',
                  border: '1px solid var(--nav-active-clr)',
                  borderRadius: 8,
                  padding: '7px 12px 7px 32px',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <button
                onMouseDown={() => { setSearchOpen(false); setSearchQuery(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '0 4px', flexShrink: 0 }}
              >✕</button>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--search-bg)',
                border: '1px solid var(--search-border)',
                borderRadius: 8,
                padding: '7px 14px',
                color: 'var(--text-muted)',
                fontSize: 13,
                cursor: 'pointer',
                transition: 'border-color .15s',
                width: '100%',
                maxWidth: 420,
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--nav-active-clr)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--search-border)'}
            >
              <span style={{ fontSize: 13 }}>🔍</span>
              <span>Search…</span>
              <span style={{
                marginLeft: 'auto', fontSize: 10, opacity: 0.4,
                background: 'var(--divider, rgba(255,255,255,0.08))',
                border: '1px solid var(--search-border)',
                borderRadius: 4, padding: '1px 5px', fontFamily: 'monospace',
              }}>⌘K</span>
            </button>
          )}
        </div>

        {/* Right — beta bell + status dot + theme toggle */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, width: 'auto', justifyContent: 'flex-end' }}>

          {/* Beta Lab bell — always visible when there are any visible features */}
          {visibleFeatures.length > 0 && (
            <button
              onClick={() => setBetaOpen(true)}
              title="What's New / Beta Features"
              style={{
                position: 'relative',
                width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: unreadBetaCount > 0 ? 'rgba(99,102,241,0.15)' : 'transparent',
                border: `1px solid ${unreadBetaCount > 0 ? 'rgba(99,102,241,0.4)' : 'var(--sidebar-border)'}`,
                borderRadius: 8,
                color: unreadBetaCount > 0 ? '#a5b4fc' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 14,
                transition: 'all .15s',
              }}
            >
              🧪
              {unreadBetaCount > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  background: '#6366f1', color: '#fff',
                  fontSize: 9, fontWeight: 700,
                  width: 16, height: 16, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{unreadBetaCount}</span>
              )}
            </button>
          )}

          {locationId && (
            <div
              title={locationName ? `${locationName} (${locationId})` : locationId}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                minWidth: 0,
                maxWidth: 220,
              }}
            >
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100%',
              }}>
                {locationName || 'Connected Location'}
              </span>
              <span style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100%',
              }}>
                {locationId}
              </span>
            </div>
          )}

          {/* Status dot */}
          <div title={claudeReady ? 'API connected' : 'API not configured'} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: claudeReady ? '#4ade80' : '#f59e0b',
              boxShadow: claudeReady ? '0 0 5px #4ade8088' : '0 0 5px #f59e0b88',
            }} />
            <span style={{ fontSize: 12, color: claudeReady ? '#4ade80' : '#f59e0b', fontWeight: 500 }}>
              {claudeReady ? 'Live' : 'Setup'}
            </span>
          </div>

          {/* Theme toggle pill */}
          <button
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              position: 'relative',
              width: 52, height: 28,
              borderRadius: 99,
              background: isDark ? 'rgba(99,102,241,0.18)' : 'rgba(251,191,36,0.15)',
              border: `1px solid ${isDark ? 'rgba(99,102,241,0.35)' : 'rgba(251,191,36,0.4)'}`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '0 3px',
              transition: 'background .2s, border-color .2s',
              flexShrink: 0,
            }}
            aria-label="Toggle theme"
          >
            <span style={{ position: 'absolute', left: 6, fontSize: 10, opacity: isDark ? 0.9 : 0.3, transition: 'opacity .2s' }}>🌙</span>
            <span style={{ position: 'absolute', right: 6, fontSize: 10, opacity: isDark ? 0.3 : 0.9, transition: 'opacity .2s' }}>☀️</span>
            <span style={{
              width: 20, height: 20,
              borderRadius: '50%',
              background: isDark ? '#6366f1' : '#f59e0b',
              transform: isDark ? 'translateX(0px)' : 'translateX(24px)',
              transition: 'transform .2s, background .2s',
              boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
              flexShrink: 0,
              zIndex: 1,
              position: 'relative',
            }} />
          </button>
        </div>
      </header>

      {/* ── Beta Lab slide-in panel ── */}
      {betaOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
          }}
          onClick={() => setBetaOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 420, height: '100%',
              background: '#13131a',
              borderLeft: '1px solid rgba(255,255,255,0.1)',
              display: 'flex', flexDirection: 'column',
              boxShadow: '-24px 0 64px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              flexShrink: 0,
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>🧪 Beta Lab</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>
                  {isMiniAdmin ? 'Toggle features for your location' : 'New features available'}
                </p>
              </div>
              <button
                onClick={() => setBetaOpen(false)}
                style={{
                  width: 28, height: 28, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent', color: '#6b7280', cursor: 'pointer', fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >✕</button>
            </div>

            {/* Feature list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 20px' }}>
              {visibleFeatures.length === 0 ? (
                <p style={{ color: '#6b7280', fontSize: 13, marginTop: 20, textAlign: 'center' }}>No updates right now.</p>
              ) : (
                visibleFeatures.map(f => (
                  <div key={f.featureId} style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid ${f.acknowledged ? 'rgba(255,255,255,0.06)' : 'rgba(99,102,241,0.3)'}`,
                    borderRadius: 12,
                    padding: '14px 16px',
                    marginBottom: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{f.title}</span>
                          {f.version && (
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
                              background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', color: '#a5b4fc',
                            }}>{f.version}</span>
                          )}
                          {f.status === 'beta' && (
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
                              background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24',
                            }}>BETA</span>
                          )}
                          {f.status === 'permanent' && (
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
                              background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399',
                            }}>NEW</span>
                          )}
                        </div>
                        {f.description && (
                          <p style={{ margin: '0 0 6px', fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>{f.description}</p>
                        )}
                        {(f.linkedFeatures || []).length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                            {(f.linkedFeatures || []).map((key, i) => {
                              const meta = FEATURE_META[key];
                              return (
                                <span key={i} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)',
                                  borderRadius: 99, padding: '2px 8px', color: '#818cf8', fontSize: 11,
                                }}>
                                  {meta ? <span>{meta.icon}</span> : null}
                                  {meta ? meta.label : key}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* mini_admin toggle for beta features */}
                      {isMiniAdmin && f.toggleable && (
                        <button
                          onClick={async () => {
                            await toggleBeta(f.featureId, !f.myEnabled);
                            toast.success(f.myEnabled ? 'Feature disabled for your location' : 'Feature enabled for your location');
                          }}
                          style={{
                            flexShrink: 0,
                            position: 'relative',
                            width: 44, height: 24,
                            borderRadius: 99,
                            background: f.myEnabled ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.08)',
                            border: `1px solid ${f.myEnabled ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.15)'}`,
                            cursor: 'pointer',
                            padding: '0 3px',
                            display: 'flex',
                            alignItems: 'center',
                            transition: 'all .2s',
                          }}
                        >
                          <span style={{
                            width: 16, height: 16, borderRadius: '50%',
                            background: f.myEnabled ? '#10b981' : '#4b5563',
                            transform: f.myEnabled ? 'translateX(20px)' : 'translateX(0px)',
                            transition: 'all .2s',
                            display: 'block',
                          }} />
                        </button>
                      )}
                    </div>

                    {/* Acknowledge button for unread features */}
                    {!f.acknowledged && (
                      <button
                        onClick={async () => {
                          await acknowledgeBeta(f.featureId);
                          toast.success("Got it! You're all caught up on this update.");
                        }}
                        style={{
                          marginTop: 10, width: '100%',
                          background: 'rgba(99,102,241,0.12)',
                          border: '1px solid rgba(99,102,241,0.3)',
                          borderRadius: 8, padding: '6px 0',
                          color: '#a5b4fc', fontSize: 12, cursor: 'pointer',
                          fontWeight: 500,
                          transition: 'background .15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(99,102,241,0.12)'}
                      >
                        Got it ✓
                      </button>
                    )}
                    {f.acknowledged && (
                      <p style={{ margin: '8px 0 0', fontSize: 11, color: '#4b5563', textAlign: 'right' }}>✓ Acknowledged</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
