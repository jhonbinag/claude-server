import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Dashboard       from './pages/Dashboard';
import Settings        from './pages/Settings';
import Workflows       from './pages/Workflows';
import AdsGenerator    from './pages/AdsGenerator';
import CampaignBuilder from './pages/CampaignBuilder';
import Billing         from './pages/Billing';
import Admin           from './pages/Admin';
import SocialPlanner  from './pages/SocialPlanner';
import AdLibrary      from './pages/AdLibrary';

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/"              element={<Dashboard />} />
        <Route path="/settings"      element={<Settings />} />
        <Route path="/workflows"     element={<Workflows />} />
        <Route path="/ads-generator"    element={<AdsGenerator />} />
        <Route path="/campaign-builder" element={<CampaignBuilder />} />
        <Route path="/billing"       element={<Billing />} />
        {/* Admin dashboard — uses separate x-admin-key auth */}
        <Route path="/admin"         element={<Admin />} />
        <Route path="/social"        element={<SocialPlanner />} />
        <Route path="/ad-library"    element={<AdLibrary />} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  );
}
