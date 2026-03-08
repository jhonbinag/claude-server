// Absolute minimum — no custom modules, just express
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ ok: true, node: process.version, env: process.env.NODE_ENV });
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));

if (process.env.NODE_ENV !== 'production') {
  app.listen(3000, () => console.log('Dev server on :3000'));
}

module.exports = app;
