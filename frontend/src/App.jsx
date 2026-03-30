import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { useApp }      from './context/AppContext';
import AppShell        from './components/AppShell';
import Dashboard       from './pages/Dashboard';
import Settings        from './pages/Settings';
import Workflows       from './pages/Workflows';
import Admin           from './pages/Admin';
import FunnelBuilder   from './pages/FunnelBuilder';
import AgentsHub       from './pages/AgentsHub';
import AdsHub          from './pages/AdsHub';
import SocialHub       from './pages/SocialHub';
import Chats           from './pages/Chats';

// ── Route wrapper: redirects to dashboard if user lacks the required feature ──
function Gated({ feature, element }) {
  const { canAccess, isAuthenticated } = useApp();
  if (!isAuthenticated) return element; // let the page's own AuthGate handle it
  if (!canAccess(feature)) return <Navigate to="/" replace />;
  return element;
}

export default function App() {
  return (
    <AppProvider>
      <Routes>
        {/* Admin uses its own full-screen layout (separate auth) */}
        <Route path="/admin" element={<Admin />} />

        {/* All other routes share the AppShell (sidebar + topbar) */}
        <Route element={<AppShell />}>
          <Route path="/"                element={<Dashboard />} />
          <Route path="/funnel-builder"  element={<Gated feature="funnel_builder" element={<FunnelBuilder />} />} />
          <Route path="/agents"          element={<AgentsHub />} />
          <Route path="/workflows"       element={<Gated feature="workflows"      element={<Workflows />} />} />
          <Route path="/ads"             element={<AdsHub />} />
          <Route path="/social"          element={<SocialHub />} />
          <Route path="/chats"           element={<Chats />} />
          <Route path="/settings"        element={<Settings />} />

          {/* Legacy redirects — keep old bookmarks/links working */}
          <Route path="/brain"           element={<Navigate to="/agents"   replace />} />
          <Route path="/ads-generator"   element={<Navigate to="/ads"      replace />} />
          <Route path="/ad-library"      element={<Navigate to="/ads"      replace />} />
          <Route path="/manychat"        element={<Navigate to="/social"   replace />} />
          <Route path="/billing"         element={<Navigate to="/settings" replace />} />
          <Route path="/builder"         element={<Navigate to="/funnel-builder" replace />} />

          <Route path="*"                element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
