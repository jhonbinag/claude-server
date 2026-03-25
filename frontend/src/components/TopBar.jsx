import { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function TopBar({ onMenuClick }) {
  const { theme, toggleTheme, claudeReady } = useApp();
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (searchOpen && inputRef.current) inputRef.current.focus();
  }, [searchOpen]);

  const isDark = theme === 'dark';

  return (
    <header className="hl-topbar">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuClick}
        className="md:hidden"
        style={{
          flexShrink: 0,
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

      {/* Search area */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        {searchOpen ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative', flex: 1, maxWidth: 340 }}>
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
              minWidth: 140,
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

      {/* Right: status dot + theme toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {/* Status */}
        <div title={claudeReady ? 'API connected' : 'API not configured'} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: claudeReady ? '#4ade80' : '#f59e0b',
            boxShadow: claudeReady ? '0 0 5px #4ade8088' : '0 0 5px #f59e0b88',
          }} />
          <span style={{ fontSize: 12, color: claudeReady ? '#4ade80' : '#f59e0b', fontWeight: 500 }}
            className="hidden lg:inline">
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
          {/* Track icons */}
          <span style={{
            position: 'absolute', left: 6, fontSize: 10, opacity: isDark ? 0.9 : 0.3, transition: 'opacity .2s',
          }}>🌙</span>
          <span style={{
            position: 'absolute', right: 6, fontSize: 10, opacity: isDark ? 0.3 : 0.9, transition: 'opacity .2s',
          }}>☀️</span>
          {/* Thumb */}
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
  );
}
