import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { useApp }      from './context/AppContext';
import Dashboard       from './pages/Dashboard';
import Settings        from './pages/Settings';
import Workflows       from './pages/Workflows';
import AdsGenerator    from './pages/AdsGenerator';
import Agents         from './pages/Agents';
import Billing         from './pages/Billing';
import Admin           from './pages/Admin';
import SocialPlanner  from './pages/SocialPlanner';
import AdLibrary      from './pages/AdLibrary';
import ManyChatPage   from './pages/ManyChat';
import GHLAgent       from './pages/GHLAgent';
import FunnelBuilder  from './pages/FunnelBuilder';
import Brain          from './pages/Brain';

// ── Route wrapper: redirects to dashboard if user lacks the required feature ───
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
        <Route path="/"             element={<Dashboard />} />
        <Route path="/settings"     element={<Gated feature="settings"         element={<Settings />} />} />
        <Route path="/workflows"    element={<Gated feature="workflows"        element={<Workflows />} />} />
        <Route path="/ads-generator"   element={<Gated feature="ads_generator"    element={<AdsGenerator />} />} />
        <Route path="/agents"          element={<Gated feature="agents"           element={<Agents />} />} />
        <Route path="/social"          element={<Gated feature="social_planner"   element={<SocialPlanner />} />} />
        <Route path="/ad-library"      element={<Gated feature="ad_library"       element={<AdLibrary />} />} />
        <Route path="/manychat"        element={<Gated feature="manychat"         element={<ManyChatPage />} />} />
        <Route path="/ghl-agent"       element={<Gated feature="ghl_agent"        element={<GHLAgent />} />} />
        <Route path="/funnel-builder"  element={<Gated feature="funnel_builder"   element={<FunnelBuilder />} />} />
        <Route path="/brain"           element={<Brain />} />
        <Route path="/billing"      element={<Billing />} />
        {/* Admin dashboard — uses separate x-admin-key auth, not RBAC */}
        <Route path="/admin"        element={<Admin />} />
        <Route path="*"             element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  );
}
