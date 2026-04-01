# Rewyse AI — Self-Improvement Agent

Make your AI agents smarter with every product you build. The Self-Improvement Agent analyzes every interaction and automatically updates your pipeline to learn from previous builds. Every product you create makes the next one faster, sharper, and higher quality.

---

## How It Works

```
Build a product → Analyze the build → Evolve the system → Next build is smarter
```

1. **Build products** with `/build-product` as normal
2. **Analyze** each completed build with `/analyze-build {project-name}`
3. **Evolve** after 2+ builds with `/evolve` — see proposed improvements, approve, done

The system captures what worked, what didn't, and what could be better — then turns those insights into targeted upgrades to your AI agents' instructions.

---

## Quick Install

**Requires:** Rewyse AI main pipeline already installed (`rewyse-ai/` directory).

```bash
curl -sL "https://rewyse-install.alexs-8cf.workers.dev/install-evolve?key=YOUR_KEY" | bash
```

Replace `YOUR_KEY` with the access key you received.

---

## Commands

| Command | What It Does |
|---------|-------------|
| `/analyze-build {slug}` | Extract learnings from a completed build into the learning log |
| `/evolve` | Identify patterns across builds and propose improvements to your agents |
| `/evolve rollback` | Undo the last evolution (restore all files from backup) |
| `/evolve-help` | Get help, see status, or troubleshoot the self-improvement system |

---

## What Gets Improved

The system modifies the instruction files (SKILL.md and reference.md) that control how your AI agents work. Examples:

| Pattern Detected | What Changes |
|---|---|
| QA keeps finding hallucinated statistics | Anti-hallucination rule added to prompt assembly instructions |
| Content openings are repetitive across entries | Variation requirement added to content generation |
| Word counts consistently exceed targets | Hard word count caps added to blueprint instructions |
| Expert voice rejected as "too formal" | Default tone guidance shifted to conversational |
| Rate limit failures in generation | Batch size reduced in generation instructions |

---

## Safety

Your agents are always safe:

- **Backups** — Every file is backed up before modification
- **Changelog** — Full history of every change with before/after details
- **Approval gates** — Nothing changes without your explicit "Yes"
- **Rollback** — `/evolve rollback` instantly undoes the last evolution
- **Additive only** — The system only adds guidance, never removes existing instructions

---

## Recommended Rhythm

1. Run `/analyze-build` after every completed product build
2. Run `/evolve` after every 2-3 new analyzed builds
3. Run `/evolve-help` anytime you have questions

The more builds you analyze, the smarter the system gets.

---

## FAQ

**How many builds before it works?** Minimum 2 analyzed builds. The system needs to see patterns across builds.

**Will it break my agents?** No. Changes are additive only. Plus you have backups and instant rollback.

**Can I see what changed?** Yes. The changelog at `rewyse-ai/.evolution/changelog.md` tracks everything, or run `/evolve-help` → Status.

**Does it learn my preferences?** Indirectly. If you keep adjusting tone to be more casual, the system learns to suggest casual defaults.

**What if I disagree with a suggestion?** Choose "Selective" during approval and only apply what you want, or "No" to skip entirely.

---

## Support

Run `/evolve-help` inside Claude Code for instant answers about how the system works, current status, or troubleshooting.

---

Built with Claude Code.
