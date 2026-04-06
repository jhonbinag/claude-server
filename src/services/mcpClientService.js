/**
 * src/services/mcpClientService.js
 *
 * Lightweight MCP (Model Context Protocol) HTTP client.
 *
 * Supports two MCP transports:
 *   1. Streamable HTTP  (POST to base URL — modern standard, MCP spec 2024-11-05)
 *   2. SSE             (GET /sse → session endpoint → POST /messages — older standard)
 *
 * Used by:
 *   • src/routes/mcpClient.js    — REST API for connect / list / disconnect
 *   • src/tools/toolRegistry.js  — executes MCP tool calls during Claude agentic loop
 */

const MCP_PREFIX     = '_mcp_';
const MCP_TIMEOUT_MS = 15000; // 15 seconds

// ── Core JSON-RPC helper ───────────────────────────────────────────────────────

async function jsonRpc(url, method, params = {}) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), MCP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body:    JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      signal:  ctrl.signal,
    });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const ct = res.headers.get('content-type') || '';
    let json;
    if (ct.includes('text/event-stream')) {
      // Server responded with SSE stream — parse the first data event
      const text  = await res.text();
      const match = text.match(/^data:\s*(.+)$/m);
      if (!match) throw new Error('No data in SSE response');
      json = JSON.parse(match[1]);
    } else {
      json = await res.json();
    }
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
    return json.result;
  } catch (err) {
    clearTimeout(tid);
    if (err.name === 'AbortError') throw new Error(`Timed out after ${MCP_TIMEOUT_MS / 1000}s`);
    throw err;
  }
}

// ── SSE handshake (legacy transport) ──────────────────────────────────────────

async function sseHandshake(sseUrl) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), MCP_TIMEOUT_MS);
  try {
    const res = await fetch(sseUrl, {
      headers: { Accept: 'text/event-stream' },
      signal:  ctrl.signal,
    });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`SSE endpoint HTTP ${res.status}`);

    const text  = await res.text();
    // Look for:  event: endpoint\ndata: /messages?sessionId=xxx
    const match = text.match(/^data:\s*(.+)$/m);
    if (!match) throw new Error('SSE endpoint event not found in response');

    const endpointPath = match[1].trim();
    if (endpointPath.startsWith('http')) return endpointPath;

    // Build absolute URL from the SSE base
    const base = new URL(sseUrl);
    return `${base.protocol}//${base.host}${endpointPath}`;
  } catch (err) {
    clearTimeout(tid);
    if (err.name === 'AbortError') throw new Error('SSE handshake timed out');
    throw err;
  }
}

// ── Server discovery ───────────────────────────────────────────────────────────

/**
 * Connect to an MCP server URL, perform initialization handshake, and list tools.
 *
 * @param {string} rawUrl  The URL pasted by the admin
 * @returns {{ transport: 'http'|'sse', tools: Array, callEndpoint: string }}
 */
async function discoverMcpServer(rawUrl) {
  const url = rawUrl.replace(/\/$/, '');

  // ── Attempt 1: Streamable HTTP ────────────────────────────────────────────
  try {
    await jsonRpc(url, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities:    {},
      clientInfo:      { name: 'hltools-gtm', version: '1.0.0' },
    });
    const result = await jsonRpc(url, 'tools/list', {});
    return { transport: 'http', callEndpoint: url, tools: result?.tools || [] };
  } catch (httpErr) {
    // ── Attempt 2: SSE transport ──────────────────────────────────────────
    try {
      const callEndpoint = await sseHandshake(url + '/sse');
      await jsonRpc(callEndpoint, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities:    {},
        clientInfo:      { name: 'hltools-gtm', version: '1.0.0' },
      });
      const result = await jsonRpc(callEndpoint, 'tools/list', {});
      return { transport: 'sse', callEndpoint, tools: result?.tools || [] };
    } catch (sseErr) {
      throw new Error(
        `Could not connect via Streamable HTTP (${httpErr.message}) or SSE (${sseErr.message}). ` +
        `Check the URL and make sure the server is running.`
      );
    }
  }
}

// ── Tool call proxy ────────────────────────────────────────────────────────────

/**
 * Call a tool on a connected MCP server.
 *
 * @param {{ callEndpoint: string, transport: string }} serverConfig  Stored config from toolConfigs
 * @param {string} originalToolName  The tool name as declared by the MCP server
 * @param {object} args              Arguments to pass
 * @returns {Promise<object>}
 */
async function callMcpTool(serverConfig, originalToolName, args) {
  const result = await jsonRpc(serverConfig.callEndpoint, 'tools/call', {
    name:      originalToolName,
    arguments: args || {},
  });
  // MCP tool result: { content: [{ type: 'text', text: '...' }], isError?: bool }
  // Normalize to something readable for Claude
  if (result?.content) {
    const text = (result.content || [])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    return { result: text || JSON.stringify(result), isError: result.isError || false };
  }
  return result;
}

// ── Slug helper ────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

module.exports = { MCP_PREFIX, discoverMcpServer, callMcpTool, slugify };
