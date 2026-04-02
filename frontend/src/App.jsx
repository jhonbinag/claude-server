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
import AdminDashboard  from './pages/AdminDashboard';

// ── Route wrapper: redirects to first accessible page if feature is blocked ───
const FALLBACK_ORDER = ['/chats', '/agents', '/ads', '/social', '/workflows', '/funnel-builder', '/settings'];
function Gated({ feature, element }) {
  const { canAccess, isAuthenticated } = useApp();
  if (!isAuthenticated) return element; // let the page's own AuthGate handle it
  if (canAccess(feature)) return element;
  // Find first page the user CAN access
  const featureMap = { '/chats': 'chats', '/agents': 'agents', '/ads': 'ads_generator', '/social': 'social_planner', '/workflows': 'workflows', '/funnel-builder': 'funnel_builder', '/settings': 'settings' };
  const fallback = FALLBACK_ORDER.find(p => canAccess(featureMap[p])) || '/chats';
  return <Navigate to={fallback} replace />;
}

// ── AppProvider wrapper for routes that need it ───────────────────────────────
function AppRoutes() {
  return (
    <AppProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/"                element={<Gated feature="dashboard"      element={<Dashboard />} />} />
          <Route path="/chats"           element={<Gated feature="chats"          element={<Chats />} />} />
          <Route path="/funnel-builder"  element={<Gated feature="funnel_builder" element={<FunnelBuilder />} />} />
          <Route path="/agents"          element={<Gated feature="agents"         element={<AgentsHub />} />} />
          <Route path="/workflows"       element={<Gated feature="workflows"      element={<Workflows />} />} />
          <Route path="/ads"             element={<Gated feature="ads_generator"  element={<AdsHub />} />} />
          <Route path="/social"          element={<Gated feature="social_planner" element={<SocialHub />} />} />
          <Route path="/settings"        element={<Gated feature="settings"       element={<Settings />} />} />

          {/* Legacy redirects */}
          <Route path="/brain"           element={<Navigate to="/agents"        replace />} />
          <Route path="/ads-generator"   element={<Navigate to="/ads"           replace />} />
          <Route path="/ad-library"      element={<Navigate to="/ads"           replace />} />
          <Route path="/manychat"        element={<Navigate to="/social"        replace />} />
          <Route path="/billing"         element={<Navigate to="/settings"      replace />} />
          <Route path="/builder"         element={<Navigate to="/funnel-builder" replace />} />

          <Route path="*"                element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}

const pathname = window.location.pathname;

export default function App() {
  if (pathname.startsWith('/admin-dashboard')) {
    return (
      <Routes>
        <Route path="/*" element={<AdminDashboard />} />
      </Routes>
    );
  }
  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin-dashboard')) {
    return (
      <Routes>
        <Route path="/*" element={<Admin />} />
      </Routes>
    );
  }
  return <AppRoutes />;
}
