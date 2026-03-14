import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
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

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/"              element={<Dashboard />} />
        <Route path="/settings"      element={<Settings />} />
        <Route path="/workflows"     element={<Workflows />} />
        <Route path="/ads-generator"    element={<AdsGenerator />} />
        <Route path="/agents"           element={<Agents />} />
        <Route path="/billing"       element={<Billing />} />
        {/* Admin dashboard — uses separate x-admin-key auth */}
        <Route path="/admin"         element={<Admin />} />
        <Route path="/social"        element={<SocialPlanner />} />
        <Route path="/ad-library"    element={<AdLibrary />} />
        <Route path="/manychat"      element={<ManyChatPage />} />
        <Route path="/ghl-agent"       element={<GHLAgent />} />
        <Route path="/funnel-builder"  element={<FunnelBuilder />} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  );
}
