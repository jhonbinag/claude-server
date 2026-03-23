/**
 * src/mcp/server.js
 *
 * MCP (Model Context Protocol) server — exposes all GHL + external tools
 * as MCP tools so Claude Code, Claude Desktop, and any MCP client can
 * call them directly via natural language or tool calls.
 *
 * Transport: stdio (for Claude Code local use)
 *            Also started automatically when process.env.MCP_HTTP_PORT is set
 *            to expose an HTTP/SSE endpoint for remote clients.
 *
 * Configuration (env vars):
 *   MCP_LOCATION_ID   — GHL location/sub-account this server operates on
 *   MCP_API_KEY       — your private API key for this location
 *   (+ all existing .env vars for GHL OAuth, Upstash, Anthropic, external tools)
 *
 * Tool names exposed:
 *   All 26 GHL tools + all configured external tools (Perplexity, OpenAI,
 *   Facebook Ads, SendGrid, Slack, Apollo, HeyGen).
 *
 * Claude Code setup:
 *   Add to ~/.claude/claude_desktop_config.json or project .mcp.json:
 *   {
 *     "mcpServers": {
 *       "ghl-toolkit": {
 *         "command": "node",
 *         "args": ["./mcp-server.js"],
 *         "cwd": "/path/to/hltools",
 *         "env": {
 *           "MCP_LOCATION_ID": "your_location_id",
 *           "MCP_API_KEY":     "your_api_key"
 *         }
 *       }
 *     }
 *   }
 */

require('dotenv').config();

const { Server }              = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const toolRegistry = require('../tools/toolRegistry');
const tokenStore   = require('../services/tokenStore');
const brain        = require('../services/brainStore');

const locationId = process.env.MCP_LOCATION_ID;
const companyId  = process.env.MCP_COMPANY_ID;

if (!locationId) {
  console.error('[MCP] MCP_LOCATION_ID env var is required. See setup instructions in src/mcp/server.js');
  process.exit(1);
}

// ─── Build MCP server ─────────────────────────────────────────────────────────

const server = new Server(
  { name: 'ghl-gtm-toolkit', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ── List Tools ────────────────────────────────────────────────────────────────

const BRAIN_TOOLS = [
  {
    name:        'query_brain',
    description: 'Search the Brain knowledge base — YouTube transcripts, documents, and other content stored for this location. Use this to answer questions about ingested content.',
    inputSchema: {
      type:       'object',
      properties: {
        query: { type: 'string', description: 'The question or search query to run against the knowledge base.' },
        k:     { type: 'number', description: 'Number of results to return (default 5, max 20).', default: 5 },
      },
      required: ['query'],
    },
  },
  {
    name:        'ingest_youtube_brain',
    description: 'Add a YouTube video transcript to the Brain knowledge base so it can be queried later.',
    inputSchema: {
      type:       'object',
      properties: {
        url:   { type: 'string', description: 'YouTube video URL or video ID.' },
        title: { type: 'string', description: 'Optional descriptive title to label this video in the knowledge base.' },
      },
      required: ['url'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const defs = await toolRegistry.getTools(locationId);

  return {
    tools: [
      ...defs.map((tool) => ({
        name:        tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
      })),
      ...BRAIN_TOOLS,
    ],
  };
});

// ── Call Tool ─────────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ── Brain tools ─────────────────────────────────────────────────────────────
  if (name === 'query_brain') {
    try {
      const results = await brain.queryKnowledge(locationId, 'brain', args.query, Math.min(args.k || 5, 20));
      if (!results.length) return { content: [{ type: 'text', text: 'No relevant content found in the Brain for that query.' }] };
      const text = results.map((r, i) =>
        `[${i + 1}] Source: ${r.sourceLabel}\n${r.text}`
      ).join('\n\n---\n\n');
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Brain query error: ${err.message}` }], isError: true };
    }
  }

  if (name === 'ingest_youtube_brain') {
    try {
      const result = await brain.addYoutubeVideo(locationId, 'brain', args.url, args.title || null);
      return { content: [{ type: 'text', text: `Video ingested: "${result.title}" — ${result.chunks} chunks stored. DocID: ${result.docId}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `YouTube ingest error: ${err.message}` }], isError: true };
    }
  }

  // ── Regular tools ────────────────────────────────────────────────────────────
  try {
    const result = await toolRegistry.executeTool(name, args || {}, locationId, companyId);
    return {
      content: [{
        type: 'text',
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[MCP] ghl-gtm-toolkit server running — location: ${locationId}`);
}

main().catch((err) => {
  console.error('[MCP] Fatal error:', err.message);
  process.exit(1);
});
