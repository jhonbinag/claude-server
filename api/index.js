// Zero-dependency diagnostic — no require() at all
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, node: process.version, env: process.env.NODE_ENV, url: req.url }));
};
