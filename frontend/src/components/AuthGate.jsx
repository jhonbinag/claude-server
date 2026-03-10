import { useApp } from '../context/AppContext';

export default function AuthGate({ icon = '🤖', title, subtitle }) {
  const { locationId } = useApp();

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: '#0f0f13' }}>
      <div className="glass rounded-2xl p-10 w-full max-w-sm text-center">
        <div className="text-5xl mb-4">{icon}</div>
        <h1 className="text-xl font-bold text-white mb-2">{title || 'Access Required'}</h1>

        {locationId ? (
          <>
            <p className="text-gray-400 text-sm mb-4">
              Unable to connect for location:<br />
              <span className="text-gray-300 font-mono text-xs">{locationId}</span>
            </p>
            <p className="text-gray-500 text-xs">
              Please contact your administrator or try refreshing the page.
            </p>
          </>
        ) : (
          <>
            <p className="text-gray-400 text-sm mb-4">
              {subtitle || 'Open this app from your GoHighLevel account to get access.'}
            </p>
            <p className="text-gray-500 text-xs">
              This app must be launched from GHL with a valid location ID.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
