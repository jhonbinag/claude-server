import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const NAV = [
  { to: '/',              label: 'Dashboard' },
  { to: '/workflows',     label: '🔀 Workflows' },
  { to: '/ads-generator', label: '🎯 Bulk Ads' },
  { to: '/settings',      label: '⚙️ Settings' },
];

export default function Header({ icon, title, subtitle }) {
  const { locationId, logout, enabledTools, claudeReady } = useApp();
  const { pathname } = useLocation();

  return (
    <header
      className="glass flex-shrink-0 px-5 py-3.5 flex items-center justify-between"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', zIndex: 10 }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-xl flex-shrink-0">{icon}</span>
        <div className="min-w-0">
          <h1 className="font-bold text-white leading-none text-sm truncate">{title}</h1>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex items-center gap-1 mx-4">
        {NAV.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className={`nav-link${pathname === to ? ' active' : ''}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* Right */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className="pulse-dot w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: claudeReady ? '#4ade80' : '#f59e0b' }}
        />
        <span className="text-xs text-green-400 hidden sm:inline">
          {claudeReady ? 'Live' : 'Connecting'}
        </span>
        {enabledTools.length > 0 && (
          <span
            className="text-xs px-2 py-0.5 rounded-full hidden md:inline"
            style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}
          >
            {enabledTools.length} tools
          </span>
        )}
        {locationId && (
          <span
            className="text-xs px-2.5 py-0.5 rounded-full glass text-gray-400 hidden lg:inline"
            title={locationId}
          >
            {locationId.slice(0, 8)}…
          </span>
        )}
        <button onClick={logout} className="nav-link text-gray-500">Sign out</button>
      </div>
    </header>
  );
}
