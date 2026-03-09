// Diagnostic: pure express only — no custom modules
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ ok: true, node: process.version, env: process.env.NODE_ENV });
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));

module.exports = app;
