import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Built assets served at /ui/ so React Router basename="/ui" works
  base: '/ui/',
  build: {
    outDir:     '../public/ui',
    emptyOutDir: true,
  },
  server: {
    port: 3001,
    // Proxy all API calls to Express in dev so no CORS issues
    proxy: {
      '/claude': 'http://localhost:3000',
      '/tools':  'http://localhost:3000',
      '/ads':    'http://localhost:3000',
      '/api':    'http://localhost:3000',
      '/oauth':  'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
