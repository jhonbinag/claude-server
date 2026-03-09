import { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function AuthGate({ icon = '🤖', title, subtitle, children }) {
  const { activate, locationId } = useApp();
  const [key, setKey]       = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleActivate = async () => {
    if (!key.trim()) return;
    setLoading(true);
    setError('');
    const ok = await activate(key.trim());
    if (!ok) setError('Invalid Anthropic API key or activation failed. Make sure it starts with sk-ant-');
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: '#0f0f13' }}>
      <div className="glass rounded-2xl p-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">{icon}</div>
          <h1 className="text-xl font-bold text-white">{title || 'Activate Your Account'}</h1>
          {subtitle && <p className="text-gray-400 text-sm mt-1">{subtitle}</p>}
          {!subtitle && (
            <p className="text-gray-400 text-sm mt-1">
              Enter your Anthropic API key to get started
            </p>
          )}
        </div>

        {locationId && (
          <p className="text-gray-500 text-xs text-center mb-4">
            Location: <span className="text-gray-300">{locationId}</span>
          </p>
        )}

        <input
          type="password"
          value={key}
          onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleActivate()}
          placeholder="sk-ant-..."
          className="field w-full mb-3"
          autoFocus
        />

        <button
          onClick={handleActivate}
          disabled={loading || !key.trim()}
          className="btn-primary w-full py-3"
        >
          {loading ? 'Activating…' : 'Activate →'}
        </button>

        {error && <p className="text-red-400 text-xs text-center mt-3">{error}</p>}

        {children}
      </div>
    </div>
  );
}
