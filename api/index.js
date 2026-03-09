// Vercel entry point — minimal diagnostic
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ ok: true, node: process.version, env: process.env.NODE_ENV });
});

app.use((req, res) => res.status(404).json({ error: 'not found', path: req.path }));

module.exports = app;
