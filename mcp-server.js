#!/usr/bin/env node
/**
 * mcp-server.js — GTM Toolkit MCP Server Entry Point
 *
 * This file is the executable entry point for the MCP server.
 * Run it directly: node mcp-server.js
 * Or add it to your Claude Code / Claude Desktop MCP config.
 *
 * ─── Quick Setup for Claude Code ─────────────────────────────────────────────
 *
 * 1. Create a .mcp.json in this project directory (or add to ~/.claude/claude_desktop_config.json):
 *
 *    {
 *      "mcpServers": {
 *        "ghl-gtm-toolkit": {
 *          "command": "node",
 *          "args": ["mcp-server.js"],
 *          "cwd": "<absolute path to this project>",
 *          "env": {
 *            "MCP_LOCATION_ID":            "your_ghl_location_id",
 *            "MCP_COMPANY_ID":             "your_ghl_company_id",
 *            "GHL_CLIENT_ID":              "...",
 *            "GHL_CLIENT_SECRET":          "...",
 *            "GHL_REDIRECT_URI":           "...",
 *            "UPSTASH_REDIS_REST_URL":     "...",
 *            "UPSTASH_REDIS_REST_TOKEN":   "...",
 *            "ANTHROPIC_API_KEY":          "sk-ant-..."
 *          }
 *        }
 *      }
 *    }
 *
 * 2. In Claude Code: /mcp → select ghl-gtm-toolkit → tools appear automatically
 *
 * 3. Use via prompt: "Search GHL contacts for John Smith"
 *                    "Send an SMS to contact abc123 saying Hello!"
 *                    "Research our top 3 competitors on Perplexity"
 *
 * ─── Available Tool Categories ────────────────────────────────────────────────
 *   GHL (always): contacts, conversations, opportunities, calendars,
 *                 campaigns, workflows, social planner, blogs, users,
 *                 forms, surveys, products, invoices, knowledge base
 *
 *   External (connect in dashboard → /ui):
 *     Perplexity AI, OpenAI GPT-4o + DALL-E 3, Facebook Ads,
 *     SendGrid, Slack, Apollo.io, HeyGen
 */

require('./src/mcp/server.js');
