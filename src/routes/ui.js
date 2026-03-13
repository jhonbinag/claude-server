/**
 * src/routes/ui.js
 *
 * Serves the React SPA (built to public/ui/) for all /ui/* paths.
 * React Router (basename="/ui") handles client-side routing.
 * Auth is handled client-side via x-api-key stored in localStorage.
 */

const express = require('express');
const path    = require('path');
const router  = express.Router();

const SPA = path.join(__dirname, '../../public/ui/index.html');

// Serve static assets (JS, CSS, images) from public/ui/
// Express static is already mounted in server.js for /public,
// but Vite builds to public/ui/ so assets are served at /ui/assets/*.
// The catch-all below only handles HTML navigation requests.

// All /ui/* routes → serve index.html (SPA handles routing)
// No-cache on HTML so browsers always pick up new asset filenames after deploy
router.get('/*', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.sendFile(SPA);
});

module.exports = router;
