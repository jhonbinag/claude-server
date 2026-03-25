import { useApp } from '../context/AppContext';
import { useSearchParams } from 'react-router-dom';
import AuthGate from '../components/AuthGate';
import Spinner from '../components/Spinner';
import Agents from './Agents';
import Brain from './Brain';

const TABS = [
  { key: 'agents', label: '🤖 Agents' },
  { key: 'brain',  label: '🧠 Brain'  },
];

const tabBarStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '0 16px',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
  flexShrink: 0,
  background: '#0f0f13',
};

const tabBtnBase = {
  padding: '11px 18px',
  fontSize: 13,
  fontWeight: 500,
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  transition: 'color 0.15s, border-color 0.15s',
  background: 'transparent',
  marginBottom: -1,
};

export default function AgentsHub() {
  const { isAuthenticated, isAuthLoading } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('view') || 'agents';
  const setTab = (t) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', t);
    // Clear Brain's internal params when switching away from brain tab
    if (t !== 'brain') { next.delete('tab'); next.delete('brain'); }
    setSearchParams(next, { replace: true });
  };

  if (isAuthLoading) return <Spinner />;
  if (!isAuthenticated) return <AuthGate icon="🤖" title="Agents & Brain" subtitle="Open this app from GHL to access agents and brain." />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f0f13' }}>
      <div style={tabBarStyle}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              ...tabBtnBase,
              color: tab === key ? '#a5b4fc' : '#6b7280',
              borderBottomColor: tab === key ? '#6366f1' : 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'agents' ? <Agents /> : <Brain />}
      </div>
    </div>
  );
}
