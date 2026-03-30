import Header   from '../components/Header';
import AuthGate from '../components/AuthGate';
import Spinner  from '../components/Spinner';
import { useApp } from '../context/AppContext';
import { Link }   from 'react-router-dom';

export default function Chats() {
  const { isAuthenticated, isAuthLoading } = useApp();

  if (isAuthLoading)    return <Spinner />;
  if (!isAuthenticated) return (
    <AuthGate icon="💬" title="Chats" subtitle="Connect your API key to access Chats">
      <Link to="/" className="block text-center text-xs text-gray-500 mt-4 hover:text-gray-300">← Back</Link>
    </AuthGate>
  );

  return (
    <div className="flex flex-col" style={{ height: '100%', background: '#0f0f13' }}>
      <Header icon="💬" title="Chats" subtitle="Chat with your GHL contacts" />
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
          <p className="text-white font-semibold text-base mb-2">Chats coming soon</p>
          <p className="text-gray-500 text-sm">More details to follow.</p>
        </div>
      </div>
    </div>
  );
}
