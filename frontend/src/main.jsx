import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import App from './App';
import './index.css';

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
