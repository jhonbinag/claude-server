import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const NAV = [
  { to: '/',               label: 'Dashboard',  icon: '⊞' },
  { to: '/builder',        label: 'Builder',    icon: '🏗', feature: 'funnel_builder' },
  { to: '/agents',         label: 'Agents',     icon: '�', feature: 'agents' },
  { to: '/workflows',      label: 'Workflows',  icon: '⟳',  feature: 'workflows' },
  { to: '/ads',            label: 'Ads',        icon: '⚡', feature: 'ads_generator' },
  { to: '/social',         label: 'Social',     icon: '📱', feature: 'social_planner' },
  { to: '/settings',       label: 'Settings',   icon: '⚙' },
];

export default function Sidebar({ collapsed, mobileOpen, onToggle, onMobileClose }) {
  const { logout, claudeReady, canAccess, isAuthenticated } = useApp();
  const { pathname } = useLocation();

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

        {/* ── Bottom: status dot + logout ── */}
        <div style={{
          flexShrink: 0,
          padding: collapsed ? '12px 0' : '12px 8px',
          borderTop: '1px solid var(--sidebar-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          {/* Status */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '7px 0' : '7px 10px',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: claudeReady ? '#4ade80' : '#f59e0b',
              boxShadow: claudeReady ? '0 0 6px #4ade8088' : '0 0 6px #f59e0b88',
            }} />
            </div>

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
    </>
  );
}
