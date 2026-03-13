import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const NAV = [
  { to: '/',                 label: 'Dashboard',  icon: '🏠' },
  { to: '/campaign-builder', label: 'Builder',    icon: '🏗️' },
  { to: '/workflows',        label: 'Workflows',  icon: '🔀' },
  { to: '/ads-generator',    label: 'Bulk Ads',   icon: '🎯' },
  { to: '/ad-library',       label: 'Ad Library', icon: '📊' },
  { to: '/manychat',         label: 'ManyChat',   icon: '💙' },
  { to: '/ghl-agent',        label: 'GHL Agent',  icon: '🤖' },
  { to: '/social',           label: 'Social',     icon: '📱' },
  { to: '/billing',          label: 'Billing',    icon: '💳' },
  { to: '/settings',         label: 'Settings',   icon: '⚙️' },
];

export default function Header({ icon, title, subtitle, onMenuClick }) {
  const { logout, enabledTools, claudeReady } = useApp();
  const { pathname } = useLocation();

  return (
    <header
      className="glass flex-shrink-0 flex items-center gap-1"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', zIndex: 10, padding: '8px 12px' }}
    >
      {/* Hamburger — only when a sidebar toggle is provided (< lg) */}
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="nav-link flex-shrink-0 lg:hidden"
          style={{ padding: '5px 8px', fontSize: '1rem' }}
          aria-label="Toggle menu"
        >
          ☰
        </button>
      )}

      {/* Brand */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-base flex-shrink-0">{icon}</span>
        <div className="min-w-0 hidden md:block">
          <h1 className="font-bold text-white leading-none text-sm truncate">{title}</h1>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate" style={{ maxWidth: '240px' }}>{subtitle}</p>}
        </div>
      </div>

      {/* Nav — icons only on mobile, icons + label on lg+ */}
      <nav className="flex items-center gap-0.5 flex-shrink-0">
        {NAV.map(({ to, label, icon: navIcon }) => (
          <Link
            key={to}
            to={to}
            title={label}
            className={`nav-link flex items-center gap-1${pathname === to ? ' active' : ''}`}
            style={{ padding: '5px 7px' }}
          >
            <span style={{ fontSize: '0.95rem' }}>{navIcon}</span>
            <span className="hidden lg:inline text-xs">{label}</span>
          </Link>
        ))}
      </nav>

      {/* Right */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: claudeReady ? '#4ade80' : '#f59e0b' }}
        />
        <span className="text-xs text-green-400 hidden lg:inline">
          {claudeReady ? 'Live' : 'Setup'}
        </span>
        {enabledTools.length > 0 && (
          <span
            className="text-xs px-1.5 py-0.5 rounded-full hidden xl:inline"
            style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}
          >
            {enabledTools.length} active tools
          </span>
        )}
        <button onClick={logout} className="nav-link text-gray-500 text-xs" style={{ padding: '5px 7px' }}>Out</button>
      </div>
    </header>
  );
}
