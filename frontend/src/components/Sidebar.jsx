import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const NAV = [
  { to: '/',               label: 'Dashboard',         icon: '⊞' },
  { to: '/funnel-builder', label: 'Builder',            icon: '🏗', feature: 'funnel_builder' },
  { to: '/agents',         label: 'Agents',             icon: '🤖' },
  { to: '/workflows',      label: 'Workflows',          icon: '⟳',  feature: 'workflows' },
  { to: '/ads',            label: 'Ads',                icon: '⚡' },
  { to: '/social',         label: 'ManyChat & Socials', icon: '💬' },
  { to: '/settings',       label: 'Settings',           icon: '⚙' },
];

const CHANGELOG = [
  {
    version: 'v2.6',
    date: 'Mar 2026',
    label: 'new',
    items: [
      'AI Assistant: persistent conversation history — all chats saved, resumable from history panel',
      'AI Assistant: save any prompt to library with a modal + toast notification',
      'AI Assistant: contact data correctly maps GHL display name (contactName)',
      'Sub-account sync: switching locations resets all assistant state and reloads fresh data',
    ],
  },
  {
    version: 'v2.5',
    date: 'Mar 2026',
    label: 'new',
    items: [
      'AI Assistant: brain selector in training mode — use an existing brain as a persona instantly',
      'AI Assistant: two-way conversation with user message bubbles',
      'AI Assistant: auto-improve panel after AI responses (continuous mode)',
      'Command box: smart routing — plain text = conversation, /command = tool execution',
    ],
  },
  {
    version: 'v2.4',
    date: 'Mar 2026',
    label: 'new',
    items: [
      'Dashboard redesigned as metrics overview (tools, workflows, brains, agents, socials, ads, websites)',
      'Workflows: AI Assistant tab with full chat interface moved from old Dashboard',
      'Workflows: canvas only opens when creating or loading a workflow',
      'Settings: Profile and Billing tabs added alongside Integrations',
    ],
  },
  {
    version: 'v2.3',
    date: 'Mar 2026',
    label: 'update',
    items: [
      'Sidebar restructured into 7 hub pages (Agents, Ads, ManyChat & Socials)',
      'Agents: Agents + Brain combined with tabs',
      'Ads: Bulk Ads + Ad Library combined with tabs',
      'Social: ManyChat + Social Planner combined with tabs',
    ],
  },
  {
    version: 'v2.2',
    date: 'Mar 2026',
    label: 'update',
    items: [
      'Brain: auto-improve search answers with continuous loop',
      'Brain: processing state persists across page reloads',
      'Brain: AI-generated docs and changelog modals',
      'Figma: auto-inject CSS for effects GHL native cannot achieve natively',
    ],
  },
  {
    version: 'v2.1',
    date: 'Feb 2026',
    label: 'update',
    items: [
      'GHL Native Page Builder: reads from Firestore sections — confirmed working',
      'Admin Dashboard: stats cards, location table, action buttons, log viewer',
      'Token lifecycle: 7-day sliding window with active / idle / expired states',
      'Reconnect button in Settings for idle or expired sessions',
    ],
  },
  {
    version: 'v2.0',
    date: 'Jan 2026',
    label: 'update',
    items: [
      'Firebase Firestore encrypted storage (AES-256-GCM) for per-location API keys',
      'Upstash Redis caching for tool configs (1h TTL) and tool session tokens',
      'Three-tier config loading: Redis cache → Firebase → tokenStore fallback',
      'Tool session tokens (tst_) generated after each connect / disconnect',
    ],
  },
];

const LABEL_COLORS = {
  new:    { bg: 'rgba(99,102,241,0.2)',  border: 'rgba(99,102,241,0.5)',  color: '#a5b4fc' },
  update: { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.4)',  color: '#34d399' },
};

export default function Sidebar({ collapsed, mobileOpen, onToggle, onMobileClose }) {
  const { logout, canAccess, isAuthenticated } = useApp();
  const { pathname } = useLocation();
  const [changelogOpen, setChangelogOpen] = useState(false);

  const visible = NAV.filter(({ feature }) => !feature || !isAuthenticated || canAccess(feature));

  const sidebarClass = [
    'hl-sidebar',
    collapsed ? 'collapsed' : 'expanded',
    mobileOpen  ? 'mobile-open' : '',
  ].filter(Boolean).join(' ');

  const iconStyle = { fontSize: 17, flexShrink: 0, width: 20, textAlign: 'center', lineHeight: 1 };
  const labelStyle = collapsed ? { display: 'none' } : { overflow: 'hidden', textOverflow: 'ellipsis' };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="hl-sidebar-overlay" onClick={onMobileClose} />
      )}

      <aside className={sidebarClass}>
        {/* ── Brand + collapse toggle ── */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: collapsed ? '14px 0' : '14px 14px 14px 16px',
          borderBottom: '1px solid var(--sidebar-border)',
          flexShrink: 0,
          gap: 8,
          minHeight: 52,
        }}>
          {!collapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>🧩</span>
              <span style={{
                fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
                letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                HL Pro Tools
              </span>
            </div>
          )}
          <button
            onClick={onToggle}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              flexShrink: 0,
              width: 28, height: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent',
              border: '1px solid var(--sidebar-border)',
              borderRadius: 6,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 12,
              transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--nav-hover-bg)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        {/* ── Navigation ── */}
        <nav style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '10px 8px',
          scrollbarWidth: 'thin',
        }}>
          {visible.map(({ to, label, icon }) => {
            const active = to === '/' ? pathname === '/' : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                title={collapsed ? label : undefined}
                onClick={onMobileClose}
                className={`hl-nav-item${active ? ' active' : ''}`}
                style={{
                  padding: collapsed ? '10px 0' : '9px 10px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                }}
              >
                <span style={iconStyle}>{icon}</span>
                <span style={labelStyle}>{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* ── Bottom: changelog + logout ── */}
        <div style={{
          flexShrink: 0,
          padding: collapsed ? '12px 0' : '12px 8px',
          borderTop: '1px solid var(--sidebar-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          {/* What's New */}
          <button
            onClick={() => setChangelogOpen(true)}
            title={collapsed ? "What's New" : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? '9px 0' : '9px 10px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 13,
              borderRadius: 8,
              width: '100%',
              transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--nav-hover-bg)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <span style={iconStyle}>📋</span>
            {!collapsed && <span>What's New</span>}
          </button>

          {/* Logout */}
          <button
            onClick={logout}
            title={collapsed ? 'Log out' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? '9px 0' : '9px 10px',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 13,
              borderRadius: 8,
              width: '100%',
              transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--nav-hover-bg)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <span style={iconStyle}>↩</span>
            {!collapsed && <span>Log out</span>}
          </button>
        </div>
      </aside>

      {/* ── Changelog modal ── */}
      {changelogOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setChangelogOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 520, maxHeight: '80vh',
              background: '#13131a', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 16, display: 'flex', flexDirection: 'column',
              boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
              flexShrink: 0,
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>📋 What's New</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>HL Pro Tools — release history</p>
              </div>
              <button
                onClick={() => setChangelogOpen(false)}
                style={{
                  width: 28, height: 28, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent', color: '#6b7280', cursor: 'pointer', fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >✕</button>
            </div>

            {/* Entries */}
            <div style={{ overflowY: 'auto', padding: '12px 20px 20px', flex: 1 }}>
              {CHANGELOG.map((entry, idx) => {
                const lc = LABEL_COLORS[entry.label] || LABEL_COLORS.update;
                return (
                  <div key={entry.version} style={{ marginBottom: idx < CHANGELOG.length - 1 ? 20 : 0 }}>
                    {/* Version row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{
                        fontSize: 13, fontWeight: 700, color: '#e2e8f0',
                      }}>{entry.version}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
                        background: lc.bg, border: `1px solid ${lc.border}`, color: lc.color,
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}>{entry.label}</span>
                      <span style={{ fontSize: 11, color: '#4b5563', marginLeft: 'auto' }}>{entry.date}</span>
                    </div>
                    {/* Bullet list */}
                    <ul style={{ margin: 0, padding: '0 0 0 14px', listStyle: 'disc' }}>
                      {entry.items.map((item, i) => (
                        <li key={i} style={{
                          fontSize: 12, color: '#9ca3af', lineHeight: 1.7,
                          paddingLeft: 4,
                        }}>{item}</li>
                      ))}
                    </ul>
                    {idx < CHANGELOG.length - 1 && (
                      <div style={{ marginTop: 16, borderBottom: '1px solid rgba(255,255,255,0.05)' }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
