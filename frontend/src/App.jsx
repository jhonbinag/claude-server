import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { useApp }      from './context/AppContext';

// ── Error Boundary — catches React render errors (shows message vs blank page) ─
class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#f1f5f9', background: '#07080f', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
          <h2 style={{ color: '#f87171', marginBottom: 16 }}>Something went wrong</h2>
          <pre style={{ color: '#fbbf24', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#0f1117', padding: 16, borderRadius: 8, border: '1px solid rgba(251,191,36,0.2)' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
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
      <AppErrorBoundary>
        <Routes>
          <Route path="/*" element={<AdminDashboard />} />
        </Routes>
      </AppErrorBoundary>
    );
  }
  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin-dashboard')) {
    return (
      <AppErrorBoundary>
        <Routes>
          <Route path="/*" element={<Admin />} />
        </Routes>
      </AppErrorBoundary>
    );
  }
  return (
    <AppErrorBoundary>
      <AppRoutes />
    </AppErrorBoundary>
  );
}
