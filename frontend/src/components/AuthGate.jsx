import { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function AuthGate({ icon = '🤖', title, subtitle }) {
  const { locationId, locationName } = useApp();
  const [manualId, setManualId]         = useState('');
  const [showManual, setShowManual]     = useState(false);

  function handleManualConnect(e) {
    e.preventDefault();
    const id = manualId.trim();
    if (!id) return;
    // Store the locationId the same way the URL-param flow does and reload
    localStorage.setItem('gtm_location_id', id);
    window.location.reload();
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: '#0f0f13' }}>
      <div className="glass rounded-2xl p-10 w-full max-w-sm text-center">
        <div className="text-5xl mb-4">{icon}</div>
        <h1 className="text-xl font-bold text-white mb-2">{title || 'Access Required'}</h1>

        {locationId ? (
          <>
            <p className="text-gray-400 text-sm mb-4">
              Unable to connect for location:<br />
              <span className="text-gray-200 font-medium">{locationName || 'Unknown Location'}</span><br />
              <span className="text-gray-300 font-mono text-xs">{locationId}</span>
            </p>
            <p className="text-gray-500 text-xs">
              Please contact your administrator or try refreshing the page.
            </p>
          </>
        ) : (
          <>
            <p className="text-gray-400 text-sm mb-6">
              {subtitle || 'Connect your GoHighLevel account to get started.'}
            </p>

            {/* Primary action: OAuth install */}
            <a
              href="/oauth/install"
              className="block w-full py-3 px-4 rounded-xl font-semibold text-sm text-white mb-3 transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              Connect with GoHighLevel
            </a>

            {/* Secondary: manual location ID (for team members at installed locations) */}
            {!showManual ? (
              <button
                onClick={() => setShowManual(true)}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Already installed? Enter your Location ID
              </button>
            ) : (
              <form onSubmit={handleManualConnect} className="mt-1">
                <input
                  type="text"
                  value={manualId}
                  onChange={e => setManualId(e.target.value)}
                  placeholder="Paste your GHL Location ID"
                  className="w-full rounded-lg px-3 py-2 text-sm text-white mb-2"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', outline: 'none' }}
                  autoFocus
                />
                <button
                  type="submit"
                  className="w-full py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
                  style={{ background: 'rgba(99,102,241,0.4)', border: '1px solid rgba(99,102,241,0.5)' }}
                >
                  Connect
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
