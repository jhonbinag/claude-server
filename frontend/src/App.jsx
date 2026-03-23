import { Routes, Route, Navigate, Link } from 'react-router-dom';
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

// ── Access-denied screen shown when a user lacks a required feature ────────────
function AccessDenied({ feature }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
        <h2 style={{ color: '#fff', margin: '0 0 8px', fontSize: 20 }}>Access Restricted</h2>
        <p style={{ color: '#6b7280', margin: '0 0 24px', fontSize: 14 }}>
          Your current role does not include the <strong style={{ color: '#a78bfa' }}>{feature.replace(/_/g, ' ')}</strong> feature.
          Contact your administrator to request access.
        </p>
        <Link to="/" style={{ display: 'inline-block', background: '#7c3aed', color: '#fff', padding: '10px 24px', borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

// ── Route wrapper: renders page only if user has the required feature ──────────
function Gated({ feature, element }) {
  const { canAccess, isAuthenticated } = useApp();
  // Not authenticated yet — let the page's own AuthGate handle it
  if (!isAuthenticated) return element;
  if (!canAccess(feature)) return <AccessDenied feature={feature} />;
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
        <Route path="/billing"      element={<Billing />} />
        {/* Admin dashboard — uses separate x-admin-key auth, not RBAC */}
        <Route path="/admin"        element={<Admin />} />
        <Route path="*"             element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  );
}
