# Evolve-Help Reference

Background knowledge for the `/evolve-help` support agent. This file contains the how-it-works explanation, FAQ, troubleshooting matrix, and glossary that the agent draws from when answering questions.

---

## Section 1: How the Self-Improvement System Works

The self-improvement system is an add-on for the Rewyse AI product-building pipeline. It watches how your product builds go, learns from each one, and makes your AI agents smarter over time.

### The 3-Step Learning Loop

The entire system revolves around a simple loop:

1. **Build** — You build a digital product using `/build-product` as you normally would. The pipeline runs through its 10 phases (idea, database, expert profile, blueprint, prompt, test, generate, design, QA, expand) and produces output files along the way.

2. **Analyze** — After a build is done (or at least through Phase 7), you run `/analyze-build {slug}`. This command reads the build's output files — especially the test content feedback (Phase 6) and the QA report (Phase 9) — and extracts structured insights. These insights are stored in `rewyse-ai/.evolution/learning-log.json`. Think of this as the system's memory: it remembers what went well, what went wrong, and what caused the issues.

3. **Evolve** — Once you have 2 or more analyzed builds, you can run `/evolve`. This command reads the learning log, looks for patterns that appear across multiple builds, and proposes targeted improvements to the SKILL.md instruction files that control how each agent behaves. You review every proposed change before it's applied — nothing happens without your approval.

### What Data Gets Captured

When `/analyze-build` runs, it looks at:

- **Test content feedback** (Phase 6) — The specific issues flagged during the quality review of sample pages, including what was wrong and what the root cause was.
- **QA report findings** (Phase 9) — Systemic issues found across all generated pages, categorized by severity and type.
- **Generation outcomes** — How many pages were generated successfully, how many needed fixes, and what kinds of problems appeared.
- **Phase progression** — Which phases needed revisions or retries, indicating where the pipeline struggled.
- **Root cause analysis** — The upstream file or instruction that caused downstream quality problems (e.g., a vague expert profile leading to inconsistent tone).

### What Changes Are Made

The `/evolve` command only modifies SKILL.md and reference.md instruction files — the files that tell each agent how to behave. Changes are always **additive**: the system adds new guidelines, warnings, or best practices based on what it learned. It never removes existing instructions.

Examples of real improvements:

- If QA reports kept flagging hallucinated statistics, `/evolve` would add an anti-hallucination checkpoint to the content generation instructions.
- If test content feedback repeatedly noted inconsistent tone, `/evolve` would add tone-anchoring guidance to the expert profile agent.
- If a specific product type (e.g., resource libraries) consistently had navigation issues, `/evolve` would add type-specific layout guidance to the design agent.

### How Safety Works

The system has four layers of protection:

1. **Backups** — Before any file is modified, the original version is copied to `rewyse-ai/.evolution/backups/`. Every backup is timestamped and linked to its evolution number.

2. **Changelog** — Every evolution is logged in `rewyse-ai/.evolution/changelog.md` with full details: which files were changed, what the change was, what learning triggered it, and before/after comparisons.

3. **Approval gates** — When `/evolve` proposes changes, you see every change before it's applied. You can approve all, approve selectively, or reject entirely.

4. **Rollback** — Running `/evolve rollback` instantly restores all files from the most recent evolution's backups. You can rollback multiple times to undo multiple evolutions (most recent first).

---

## Section 2: FAQ

### 1. "How many builds do I need before /evolve works?"

Minimum 2 analyzed builds. The system needs to see patterns across multiple builds to propose meaningful improvements. A single build might surface issues, but `/evolve` can't be confident they're systemic (rather than one-off) without corroboration from a second build.

### 2. "Will it break my agents?"

No. Changes are additive only — nothing is removed from your instruction files. The system adds new guidelines, warnings, and best practices on top of what already exists. Plus, you have full backups of every file before it was changed and `/evolve rollback` to instantly undo the last evolution if anything feels off.

### 3. "What exactly changes?"

The SKILL.md and reference.md instruction files inside the main Rewyse AI pipeline. These files control how each agent behaves — what it writes, how it formats content, what quality checks it runs. The changes add new guidance lines based on patterns observed across your builds.

### 4. "Can I see what was changed?"

Yes. Three ways:
- Run `/evolve-help` and choose **Status** to see a summary of all evolutions
- Read `rewyse-ai/.evolution/changelog.md` directly — it has full before/after diffs for every change
- Check `rewyse-ai/.evolution/backups/` to see the original file versions

### 5. "How do I undo changes?"

Run `/evolve rollback`. This restores all files modified in the most recent evolution back to their pre-evolution state using the backups. If you want to undo multiple evolutions, run rollback multiple times (it works like Ctrl+Z — most recent first).

### 6. "Should I run /analyze-build after every build?"

Yes, ideally. The more builds you analyze, the better the system gets at identifying patterns. Even if you don't plan to run `/evolve` right away, the learning log accumulates data that makes future evolutions more accurate and confident.

### 7. "Does it learn my writing preferences?"

Indirectly, yes. The system doesn't explicitly track your style preferences, but it notices the consequences. For example, if you consistently revise expert profiles to be more casual and your QA reports flag fewer tone issues as a result, the system learns that casual voice guidance produces better outcomes and will steer future builds in that direction.

### 8. "What if I build different product types?"

That's great — the system handles mixed product types well. Type-specific patterns (e.g., "resource libraries need better navigation") go into type-specific guidance that only activates for that product type. Universal patterns (e.g., "always verify external links") improve all builds regardless of type.

### 9. "How often should I run /evolve?"

After every 2-3 new analyzed builds is a good rhythm. Running it after every single build won't hurt, but the improvements tend to be more meaningful with a batch of new data. Think of it like a tune-up: you don't need one after every drive, but regular maintenance keeps things running well.

### 10. "Can it make changes I don't approve?"

No. Every proposed change is shown to you with full context before it's applied. You have three options: approve all changes, approve selectively (pick which ones to apply), or reject entirely. Nothing is modified without your explicit say-so.

### 11. "What happens if I never run /evolve?"

Nothing bad. The learning log continues to accumulate data from each `/analyze-build` run, but no changes are made to your agents. Your pipeline works exactly as it always has. The data just sits there, ready for whenever you decide to evolve.

### 12. "Does the system get better over time?"

Yes, meaningfully. More builds means more data points, which means higher confidence in identified patterns. Early evolutions tend to catch the big, obvious issues (hallucinated data, inconsistent formatting). Later evolutions refine nuances (tone calibration, section-level quality improvements). The improvements compound — each evolution makes the next build better, which gives the system cleaner data to learn from.

### 13. "Can I run /analyze-build on a build I did weeks ago?"

Yes, as long as the output files are still in `rewyse-ai/output/{slug}/`. The analysis reads from the saved output files, so the build doesn't need to be recent — just present. This means you can retroactively analyze older builds to backfill your learning log.

### 14. "What's the learning log?"

A JSON file at `rewyse-ai/.evolution/learning-log.json` that stores structured insights from every analyzed build. Each entry includes the build slug, product type, date, source (test content or QA report), the specific issue, its severity, the root cause, and the suggested improvement. The file grows with each `/analyze-build` run and is the primary input for `/evolve`.

### 15. "Is there a limit to how many evolutions I can run?"

No hard limit. However, after approximately 5 or more evolutions, the system may suggest a consolidation pass. This is because accumulated additive notes in instruction files can become redundant or verbose over time. A consolidation cleans up the additions into clean, integrated guidance — think of it as refactoring your instructions.

### 16. "What if /evolve suggests something I disagree with?"

During the approval step, choose **Selective** and only apply the changes you agree with. Or choose **No** to skip the entire evolution. The system doesn't take it personally. Your rejected proposals stay in the learning log as data — if the same pattern keeps appearing in future builds, `/evolve` will propose it again (possibly with stronger evidence), and you can reconsider.

---

## Section 3: Troubleshooting Matrix

### "/analyze-build says no builds found"

**Symptom:** You run `/analyze-build {slug}` and it reports that no build output was found.

**Cause:** The specified slug doesn't have output files in `rewyse-ai/output/{slug}/`. Either the build hasn't been started, it's stored under a different slug, or the output directory was moved or deleted.

**Fix:**
1. Check what builds exist: look inside `rewyse-ai/output/` for available slug directories
2. Verify you're using the correct slug (it must match the directory name exactly)
3. If no builds exist at all, run `/build-product` first to create one
4. The build needs to reach at least Phase 7 (content generation) to have enough data for analysis

**Command:** `/build-product` to create a new build, or `/build-product {slug}` to resume an existing one

---

### "/analyze-build says build not far enough"

**Symptom:** The build exists but `/analyze-build` says it hasn't progressed far enough for analysis.

**Cause:** The build hasn't reached Phase 7. The analysis needs test content feedback (Phase 6) or generated content (Phase 7+) to have meaningful data to extract.

**Fix:**
1. Check the build's progress file to see which phase it completed last
2. Resume the build and complete it through at least Phase 7
3. Ideally, complete through Phase 9 (QA) for the richest analysis data

**Command:** `/build-product {slug}` to resume the build

---

### "/evolve says not enough data"

**Symptom:** You run `/evolve` and it says there isn't enough data to identify patterns.

**Cause:** Fewer than 2 builds have been analyzed. The system needs at least 2 data points to distinguish systemic patterns from one-off issues.

**Fix:**
1. Check how many builds have been analyzed: run `/evolve-help` and choose Status
2. Complete and analyze more builds until you have at least 2
3. Older builds count too — if you have completed builds you haven't analyzed yet, run `/analyze-build` on them

**Command:** `/analyze-build {slug}` for each completed build you haven't analyzed yet

---

### "My agents seem worse after running /evolve"

**Symptom:** After an evolution, the quality of generated content feels lower or different in an unwanted way.

**Cause:** An improvement had unintended side effects. This can happen when a pattern identified from 2 builds doesn't generalize well, or when a new guideline conflicts with existing ones in edge cases.

**Fix:**
1. Run `/evolve rollback` immediately to restore all files to their pre-evolution state
2. Check `rewyse-ai/.evolution/changelog.md` to see exactly what was changed
3. If you can identify the specific problematic change, you can re-run `/evolve` in the future and use Selective approval to skip that particular change
4. Consider analyzing more builds before evolving again — more data means more confident (and safer) improvements

**Command:** `/evolve rollback` to undo the last evolution

---

### "What files were changed?"

**Symptom:** You want to see what an evolution actually modified.

**Cause:** Curiosity or need to audit.

**Fix:**
1. Read `rewyse-ai/.evolution/changelog.md` — it contains a complete record of every evolution, including which files were changed, what lines were added, and what learning triggered each change
2. For the original file versions, check `rewyse-ai/.evolution/backups/`
3. You can also run `/evolve-help` and choose Status for a summary view

**Command:** `/evolve-help` (choose Status)

---

### "Can I undo everything?"

**Symptom:** You want to reset all agents back to their original, pre-evolution state.

**Cause:** You've run multiple evolutions and want a clean slate.

**Fix:**
1. Run `/evolve rollback` once for each evolution you've applied
2. Each rollback undoes one evolution, starting with the most recent
3. Continue until all evolutions are rolled back
4. The learning log is preserved even after rollback — your analyzed build data is not lost, only the applied changes are reverted

**Command:** `/evolve rollback` (repeat for each evolution)

---

### "learning-log.json is missing"

**Symptom:** The file `rewyse-ai/.evolution/learning-log.json` doesn't exist.

**Cause:** The `.evolution/` directory and its files are created automatically by `/analyze-build` on its first run. If you haven't run `/analyze-build` yet, these files won't exist.

**Fix:**
1. Run `/analyze-build {slug}` on any completed build
2. The command will create the `.evolution/` directory, `learning-log.json`, and any other needed files automatically
3. No manual setup is required

**Command:** `/analyze-build {slug}`

---

### "How do I know the system is actually working?"

**Symptom:** You've run `/evolve` but aren't sure if it made a real difference.

**Cause:** Wanting proof of improvement (totally reasonable).

**Fix:**
1. The most direct test: compare `qa-report.md` from a build done before the evolution vs one done after. Fewer issues (especially in categories the evolution targeted) means it's working.
2. Check `rewyse-ai/.evolution/changelog.md` to see exactly what was changed and what problem it was addressing
3. Look at the specific issue categories — if evolution added anti-hallucination rules and your next QA report has zero hallucination flags, that's clear evidence
4. Over time, you should see QA reports getting shorter (fewer issues) and test content getting approved with fewer revision rounds

**Command:** `/evolve-help` (choose Status) to see the current state

---

## Section 4: Glossary

- **Learning log** — The JSON file at `rewyse-ai/.evolution/learning-log.json` that accumulates structured insights from every analyzed build. Each entry records the build slug, product type, analysis date, source phase, specific issue, severity, root cause, and suggested improvement. This file is the primary input for `/evolve`.

- **Evolution** — One round of improvements applied by `/evolve`. Each evolution is sequentially numbered (Evolution 1, Evolution 2, etc.) and recorded in the changelog. An evolution may modify one or more SKILL.md/reference.md files based on patterns found in the learning log.

- **Pattern** — A recurring signal that appears across 2 or more analyzed builds, suggesting a systemic issue worth addressing. Patterns are more trustworthy than one-off observations because they indicate a problem that persists regardless of the specific product being built.

- **Confidence** — A measure of how certain the system is about a proposed improvement. **HIGH** confidence means the pattern appeared in 2 or more builds with clear root causes. **MEDIUM** confidence means it appeared in 1 build but with an obvious, well-understood root cause. **LOW** confidence means it's an observation that may or may not be systemic (these are rarely proposed as changes).

- **Rollback** — The act of reverting all files modified in an evolution back to their pre-evolution state. Rollback uses the backup copies stored in `.evolution/backups/`. Each rollback undoes exactly one evolution, working most-recent-first.

- **Changelog** — The Markdown file at `rewyse-ai/.evolution/changelog.md` that tracks every evolution in detail. Each entry includes the evolution number, date, which files were modified, what was changed (with before/after comparisons), which learning log entries triggered the change, and the rationale.

- **Backup** — A copy of a file as it existed immediately before an evolution modified it. Backups are stored in `rewyse-ai/.evolution/backups/` and are organized by evolution number. They are the foundation of the rollback system.

- **Systemic issue** — A quality problem that appears across many entries within a single build (e.g., 15 out of 50 pages have the same formatting error) or across multiple builds. Systemic issues are the primary target for evolution because fixing the upstream cause improves all future output.

- **Root cause** — The upstream file or instruction that caused a downstream quality problem. For example, if generated pages consistently have an overly formal tone, the root cause might be the expert profile's voice description being too academic. Identifying root causes is what makes the system's improvements targeted rather than superficial.
