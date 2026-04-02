import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar  from './TopBar';

export default function AppShell() {
  const [collapsed,   setCollapsed]   = useState(false);
  const [mobileOpen,  setMobileOpen]  = useState(false);

  // When embedded in an iframe (e.g. mini admin dashboard), hide chrome entirely
  const embedded = new URLSearchParams(window.location.search).get('embed') === '1';

  // Close mobile sidebar on resize to desktop
  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 768) setMobileOpen(false);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (embedded) {
    return (
      <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, height: '100vh', background: 'var(--content-bg)' }}>
        <Outlet />
      </main>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggle={() => setCollapsed(c => !c)}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Main content column */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
        background: 'var(--content-bg)',
      }}>
        <TopBar onMenuClick={() => setMobileOpen(o => !o)} />

        {/* Page content */}
        <main style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          minHeight: 0,
          height: '100%',
        }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
