import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const NAV = [
  { to: '/',              label: 'Dashboard', icon: '🏠' },
  { to: '/workflows',     label: 'Workflows',  icon: '🔀' },
  { to: '/ads-generator', label: 'Bulk Ads',   icon: '🎯' },
  { to: '/settings',      label: 'Settings',   icon: '⚙️' },
];

export default function Header({ icon, title, subtitle }) {
  const { locationId, logout, enabledTools, claudeReady } = useApp();
  const { pathname } = useLocation();

  return (
    <header
      className="glass flex-shrink-0 flex items-center justify-between"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', zIndex: 10, padding: '10px 14px' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
        <span className="text-lg flex-shrink-0">{icon}</span>
        <div className="min-w-0 hidden sm:block">
          <h1 className="font-bold text-white leading-none text-sm truncate">{title}</h1>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{subtitle}</p>}
        </div>
      </div>

      {/* Nav — icons only on mobile, icons+label on sm+ */}
      <nav className="flex items-center gap-0.5 mx-2">
        {NAV.map(({ to, label, icon: navIcon }) => (
          <Link
            key={to}
            to={to}
            title={label}
            className={`nav-link flex items-center gap-1${pathname === to ? ' active' : ''}`}
          >
            <span>{navIcon}</span>
            <span className="hidden sm:inline">{label}</span>
          </Link>
        ))}
      </nav>

      {/* Right */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: claudeReady ? '#4ade80' : '#f59e0b' }}
        />
        <span className="text-xs text-green-400 hidden md:inline">
          {claudeReady ? 'Live' : 'Setup'}
        </span>
        {enabledTools.length > 0 && (
          <span
            className="text-xs px-2 py-0.5 rounded-full hidden lg:inline"
            style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}
          >
            {enabledTools.length} tools
          </span>
        )}
        <button onClick={logout} className="nav-link text-gray-500 text-xs">Out</button>
      </div>
    </header>
  );
}
