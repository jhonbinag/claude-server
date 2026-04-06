/**
 * src/routes/mcpClient.js
 *
 * Admin-facing REST API for managing connected MCP servers.
 *
 * Mounts at /mcp-client
 *
 * GET    /mcp-client/servers          — list connected servers + their tools
 * POST   /mcp-client/servers          — connect a new server { name, url }
 * DELETE /mcp-client/servers/:slug    — disconnect a server
 * POST   /mcp-client/servers/:slug/refresh — re-discover tools from a connected server
 *
 * MCP server configs are stored in the standard toolConfig store under the
 * key prefix "_mcp_" so they persist through the same Firebase/Redis/tokenStore
 * three-tier system used by all other integrations.
 *
 * Tool names exposed to Claude use the format:
 *   mcp__<serverSlug>__<originalToolName>
 */

const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const toolRegistry = require('../tools/toolRegistry');
const { MCP_PREFIX, discoverMcpServer, slugify } = require('../services/mcpClientService');

router.use(authenticate);

// ── GET /mcp-client/servers ────────────────────────────────────────────────────

router.get('/servers', async (req, res) => {
  try {
    const configs = await toolRegistry.getToolConfig(req.locationId);
    const servers = Object.entries(configs)
      .filter(([k, v]) => k.startsWith(MCP_PREFIX) && v?.url)
      .map(([k, v]) => ({
        slug:         k.slice(MCP_PREFIX.length),
        name:         v.name || k.slice(MCP_PREFIX.length),
        url:          v.url,
        transport:    v.transport || 'http',
        toolCount:    (v.tools || []).length,
        tools:        (v.tools || []).map(t => ({
          name:         t.name,          // prefixed: mcp__slug__original
          originalName: t._original,
          description:  t.description,
        })),
        connectedAt:  v.connectedAt,
      }));
    res.json({ success: true, servers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /mcp-client/servers ───────────────────────────────────────────────────

router.post('/servers', async (req, res) => {
  const { name, url } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Server name is required.' });
  if (!url?.trim())  return res.status(400).json({ success: false, error: 'Server URL is required.' });

  const slug      = slugify(name.trim());
  const configKey = MCP_PREFIX + slug;

  try {
    const { transport, callEndpoint, tools } = await discoverMcpServer(url.trim());

    // Prefix tool names with server slug so they're unique across all servers
    const toolDefs = (tools || []).map(t => ({
      name:         `mcp__${slug}__${t.name}`,
      description:  t.description || `${t.name} (from ${name})`,
      input_schema: t.inputSchema || { type: 'object', properties: {}, required: [] },
      _original:    t.name,
    }));

    await toolRegistry.saveToolConfig(req.locationId, configKey, {
      name:          name.trim(),
      url:           url.trim().replace(/\/$/, ''),
      callEndpoint,
      transport,
      tools:         toolDefs,
      connectedAt:   new Date().toISOString(),
    });

    res.json({
      success:   true,
      slug,
      name:      name.trim(),
      transport,
      toolCount: toolDefs.length,
      tools:     toolDefs.map(t => ({ name: t.name, originalName: t._original, description: t.description })),
    });
  } catch (err) {
    console.error('[MCPClient] connect error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── POST /mcp-client/servers/:slug/refresh ────────────────────────────────────

router.post('/servers/:slug/refresh', async (req, res) => {
  const configKey = MCP_PREFIX + req.params.slug;
  try {
    const configs      = await toolRegistry.getToolConfig(req.locationId);
    const serverConfig = configs[configKey];
    if (!serverConfig?.url) return res.status(404).json({ success: false, error: 'Server not found.' });

    const { transport, callEndpoint, tools } = await discoverMcpServer(serverConfig.url);

    const toolDefs = (tools || []).map(t => ({
      name:         `mcp__${req.params.slug}__${t.name}`,
      description:  t.description || `${t.name} (from ${serverConfig.name})`,
      input_schema: t.inputSchema || { type: 'object', properties: {}, required: [] },
      _original:    t.name,
    }));

    await toolRegistry.saveToolConfig(req.locationId, configKey, {
      ...serverConfig,
      callEndpoint,
      transport,
      tools:       toolDefs,
      refreshedAt: new Date().toISOString(),
    });

    res.json({ success: true, toolCount: toolDefs.length, tools: toolDefs.map(t => ({ name: t.name, description: t.description })) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /mcp-client/servers/:slug ──────────────────────────────────────────

router.delete('/servers/:slug', async (req, res) => {
  const configKey = MCP_PREFIX + req.params.slug;
  try {
    await toolRegistry.deleteToolConfig(req.locationId, configKey);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
