import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import App from './App';
import './index.css';

// Catch any JS errors that prevent React from mounting (bypasses Error Boundary)
window.addEventListener('error', (ev) => {
  const root = document.getElementById('root');
  if (root && !root.firstChild) {
    root.style.cssText = 'padding:40px;font-family:monospace;background:#07080f;color:#f1f5f9;min-height:100vh';
    root.innerHTML = `<h2 style="color:#f87171">JS Error (pre-React)</h2><pre style="color:#fbbf24;white-space:pre-wrap;word-break:break-all">${ev.message}\n\n${ev.filename}:${ev.lineno}\n\n${ev.error?.stack || ''}</pre>`;
  }
});
window.addEventListener('unhandledrejection', (ev) => {
  const root = document.getElementById('root');
  if (root && !root.firstChild) {
    root.style.cssText = 'padding:40px;font-family:monospace;background:#07080f;color:#f1f5f9;min-height:100vh';
    root.innerHTML = `<h2 style="color:#f87171">Unhandled Promise Rejection</h2><pre style="color:#fbbf24;white-space:pre-wrap;word-break:break-all">${ev.reason?.message || ev.reason}\n\n${ev.reason?.stack || ''}</pre>`;
  }
});

function getBasename() {
  const p = window.location.pathname;
  if (p.startsWith('/admin-dashboard')) return '/admin-dashboard';
  if (p.startsWith('/admin')) return '/admin';
  return '/ui';
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* basename is dynamic — /ui, /admin-dashboard, or /admin */}
    <BrowserRouter basename={getBasename()}>
      <App />
      <ToastContainer
        position="bottom-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        theme="dark"
        style={{ fontSize: 13 }}
      />
    </BrowserRouter>
  </React.StrictMode>
);
