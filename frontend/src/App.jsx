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
          <Route path="/"           element={<Dashboard />} />
          <Route path="/builder"    element={<Gated feature="funnel_builder" element={<FunnelBuilder />} />} />
          <Route path="/agents"     element={<Gated feature="agents"         element={<AgentsHub />} />} />
          <Route path="/workflows"  element={<Gated feature="workflows"      element={<Workflows />} />} />
          <Route path="/ads"        element={<Gated feature="ads_generator"  element={<AdsHub />} />} />
          <Route path="/social"     element={<Gated feature="social_planner" element={<SocialHub />} />} />
          <Route path="/settings"   element={<Settings />} />
          <Route path="*"           element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
