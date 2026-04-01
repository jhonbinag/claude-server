# HL Pro Tools — Claude Code Project

## Rewyse AI — Digital Product Agent (`rewyse-ai/`)

A 10-phase pipeline for building complete digital products in Notion using AI.
See `rewyse-ai/CLAUDE.md` for full pipeline documentation.

**Quick start:**
- `/rewyse-onboard` — First-time setup (Notion token, Node.js, prerequisites)
- `/build-product` — Start a new digital product build
- `/rewyse-help` — Q&A, troubleshooting, and project status

**All commands:** `/build-product`, `/product-idea`, `/build-database`, `/expert-profile`,
`/content-blueprint`, `/write-prompt`, `/test-content`, `/generate-content`, `/design-product`,
`/product-qa`, `/product-expand`, `/home-page`, `/subpage-views`, `/prompt-generator`,
`/rewyse-help`, `/rewyse-onboard`

**Prerequisites:** Notion MCP server connected, Node.js 18+

---

## Rewyse AI Evolve — Self-Improvement Agent (`rewyse-ai-evolve/`)

Add-on that learns from completed builds and automatically improves the pipeline over time.
Requires the main Rewyse AI pipeline to be installed.

**Usage:**
1. Complete a product build with `/build-product`
2. Run `/analyze-build {slug}` to feed it into the learning system
3. After 2+ analyzed builds, run `/evolve` to apply improvements

**Commands:** `/analyze-build`, `/evolve`, `/evolve-help`

See `rewyse-ai-evolve/CLAUDE.md` for full documentation.
