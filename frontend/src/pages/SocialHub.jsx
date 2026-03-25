import { useState } from 'react';
import { useApp } from '../context/AppContext';
import AuthGate from '../components/AuthGate';
import Spinner from '../components/Spinner';
import ManyChatPage from './ManyChat';
import SocialPlanner from './SocialPlanner';

const TABS = [
  { key: 'manychat', label: '💬 ManyChat'       },
  { key: 'social',   label: '📱 Social Planner' },
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

export default function SocialHub() {
  const { isAuthenticated, isAuthLoading } = useApp();
  const [tab, setTab] = useState('manychat');

  if (isAuthLoading) return <Spinner />;
  if (!isAuthenticated) return <AuthGate icon="💬" title="ManyChat & Socials" subtitle="Open this app from GHL to access social tools." />;

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
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {tab === 'manychat' ? <ManyChatPage /> : <SocialPlanner />}
      </div>
    </div>
  );
}
