import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Dashboard    from './pages/Dashboard';
import Settings     from './pages/Settings';
import Workflows    from './pages/Workflows';
import AdsGenerator from './pages/AdsGenerator';
import Billing      from './pages/Billing';
import Admin        from './pages/Admin';

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/"              element={<Dashboard />} />
        <Route path="/settings"      element={<Settings />} />
        <Route path="/workflows"     element={<Workflows />} />
        <Route path="/ads-generator" element={<AdsGenerator />} />
        <Route path="/billing"       element={<Billing />} />
        {/* Admin dashboard — uses separate x-admin-key auth */}
        <Route path="/admin"         element={<Admin />} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  );
}
