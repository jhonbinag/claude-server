# Rewyse AI — Self-Improvement Agent

An add-on for the Rewyse AI pipeline that makes your agents smarter with every
product build. Analyzes build output, identifies recurring patterns, and
automatically updates SKILL.md files to improve future builds.

## Skills

### analyze-build
**Slash command:** `/analyze-build`
**Triggers:** "analyze this build", "feed build to learning system", "extract learnings",
"analyze my last product", "add build to learning log"
**Description:** Reads a completed product build's output files and extracts structured
learnings into the self-improvement learning log.

### evolve
**Slash command:** `/evolve`
**Triggers:** "improve my agents", "evolve the system", "apply learnings", "make agents smarter",
"self-improve", "run evolution", "evolve rollback", "undo evolution"
**Description:** Analyzes all past builds in the learning log, identifies cross-build patterns,
and proposes targeted improvements to the pipeline's SKILL.md and reference.md files.
Supports rollback.

### evolve-help
**Slash command:** `/evolve-help`
**Triggers:** "how does self-improvement work", "evolution status", "what was changed",
"help with evolve", "troubleshoot evolution", "self-improvement help"
**Description:** Support agent for the self-improvement system. Three modes:
Guide (walkthrough), Status (dashboard), Troubleshoot (diagnose issues).

## Prerequisites

- Rewyse AI main pipeline must be installed (`rewyse-ai/` directory)
- At least one completed product build (Phase 7+)

## Getting Started

1. Build a product with `/build-product`
2. Run `/analyze-build {slug}` to feed it into the learning system
3. After 2+ analyzed builds, run `/evolve` to apply improvements
4. Run `/evolve-help` anytime for guidance
