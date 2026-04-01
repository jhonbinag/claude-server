---
name: evolve
description: "Use when someone wants to improve their Rewyse AI agents based on learnings from past builds. Analyzes the learning log, identifies patterns, and proposes targeted updates to SKILL.md and reference.md files."
argument-hint: [rollback]
---

## Context

This agent reads accumulated build learnings and proposes surgical improvements to the
Rewyse AI pipeline's instruction files. It never modifies build output, state files, or
the learning log — only SKILL.md and reference.md files in the main pipeline directory.

Before doing anything, read [reference.md](reference.md) for the learning log schema,
improvement patterns catalog, confidence rules, and change scope limits.

Cross-references:
- `/analyze-build` — Add builds to the learning log
- `/evolve-help` — Questions about the self-improvement system

**Learning log:** `rewyse-ai/.evolution/learning-log.json`
**Changelog:** `rewyse-ai/.evolution/changelog.md`
**Backups:** `rewyse-ai/.evolution/backups/`

---

## Step 0: Handle Rollback

If `$ARGUMENTS` is "rollback":

1. Read `rewyse-ai/.evolution/changelog.md`.
2. Find the most recent evolution entry (the last `## Evolution {N}` section).
3. Parse the entry to identify every file that was changed and its backup path.
4. For each file changed in that evolution:
   a. Read the backup from `rewyse-ai/.evolution/backups/{backup-filename}`
   b. Write it back to the original file path, fully restoring the previous version
5. Append a rollback entry to the changelog:

   ```markdown
   ## Rollback — {YYYY-MM-DD}

   Rolled back Evolution {N}.
   Files restored:
   - `{filepath}` ← `backups/{backup-filename}`
   - `{filepath}` ← `backups/{backup-filename}`
   ```

6. Present summary:

   > "Rolled back Evolution {N}. {count} files restored to their pre-evolution state.
   > Changelog updated."

7. Exit — do not continue to the remaining steps.

---

## Step 1: Load and Validate Learning Log

Read `rewyse-ai/.evolution/learning-log.json`.

- **If file does not exist:** tell the user: "No learning log found. Run `/analyze-build` after completing a product build to start collecting data."
- **If file exists but `builds` array has fewer than 2 entries:** tell the user: "Need at least 2 analyzed builds to identify cross-build patterns. You have {N}. Run `/analyze-build` after your next build."
- **If 2+ builds exist:** proceed. Present:

  > "Found {N} analyzed builds in the learning log. Analyzing cross-build patterns..."

Also read:
- `rewyse-ai/.evolution/changelog.md` — to determine the current evolution number
- The improvement patterns catalog from [reference.md](reference.md)

---

## Step 2: Cross-Build Pattern Analysis

Use a subagent (Agent tool, model: sonnet) to analyze ALL builds in the learning log.

### Subagent Prompt

> You are a pattern analysis engine for the Rewyse AI self-improvement system. You will
> receive the complete learning log (all analyzed builds) and a catalog of known improvement
> patterns. Your job is to identify actionable cross-build patterns.
>
> ## Learning Log
>
> {paste full learning-log.json content}
>
> ## Improvement Patterns Catalog
>
> {paste the patterns catalog from reference.md — the full table of pattern IDs, signals,
> target files, and change templates}
>
> ## Instructions
>
> 1. Compare all builds looking for recurring signals.
> 2. For each pattern in the catalog, check if the signal condition is met across the builds.
> 3. Also look for NEW patterns not in the catalog — issues that recur across builds but
>    do not match any existing pattern ID.
>
> For each identified pattern, produce:
>
> ```json
> {
>   "pattern_id": "P001 or NEW-{description}",
>   "pattern_name": "human-readable name",
>   "signal": "what data triggered this pattern",
>   "builds_affected": ["slug-1", "slug-2"],
>   "confidence": "HIGH|MEDIUM",
>   "target_file": "relative path to the file to modify",
>   "target_section": "name of the section within that file",
>   "evidence": "brief summary of evidence from the builds",
>   "change_template": "the specific text to add (from catalog or newly proposed)"
> }
> ```
>
> ## Confidence Rules
>
> - **HIGH** — Pattern seen in 2+ analyzed builds
> - **MEDIUM** — Seen once but the QA report contains explicit root cause analysis + fix recommendation
> - **LOW** — Single observation, no clear root cause → do NOT include, just mention as emerging signal
> - **CONFLICTING** — Two builds suggest opposite changes → do NOT include, flag as mixed signals
>
> ## Product-Type Routing Rules
>
> - If ALL builds are the same product type → route improvements to `shared/product-types-reference.md`
> - If a pattern appears ONLY in builds of one type (but other types exist) → type-specific improvement
> - If a pattern appears across 2+ different product types → global improvement to the relevant SKILL.md
>
> Return only HIGH and MEDIUM confidence patterns. Mention LOW and CONFLICTING patterns
> separately as "Emerging Signals" and "Mixed Signals".

### Process the Results

Parse the subagent output. For each pattern:
- Verify `target_file` is in the allowed list (see Step 3)
- Verify `confidence` is HIGH or MEDIUM
- Group patterns by target file

---

## Step 3: Read Current Target Files

For each proposed change, read the actual current file. Only these files can be modified:

| File Path | What It Controls |
|-----------|-----------------|
| `rewyse-ai/expert-profile/SKILL.md` | Voice, tone, vocabulary calibration |
| `rewyse-ai/content-blueprint/SKILL.md` | Section structure, word counts, formatting rules |
| `rewyse-ai/write-prompt/SKILL.md` | Prompt assembly, quality constraints |
| `rewyse-ai/generate-content/SKILL.md` | Batching, generation, error handling |
| `rewyse-ai/product-qa/SKILL.md` | QA scanning, quality checks |
| `rewyse-ai/product-qa/reference.md` | QA criteria, checklists, severity definitions |
| `rewyse-ai/test-content/SKILL.md` | Test generation, feedback loops |
| `rewyse-ai/shared/product-types-reference.md` | Product-type-specific guidance |

If a proposed change targets a file NOT in this list, discard it and note why.

Read each target file in full so you can locate the exact section to modify.

---

## Step 4: Generate Proposed Changes

For each target file with one or more matched patterns, generate the specific edit.

### Change Rules

- **SURGICAL changes only.** Modify the relevant section, not the whole file.
- **Additive only.** Add new bullet points, guidelines, checklist items, or notes. NEVER remove existing instructions. NEVER restructure the file or change step numbering.
- **Max 200 words of new content per file per evolution.** If multiple patterns target the same file, combine them into a coherent addition that stays under the limit.
- **Preserve voice and style.** New content must match the existing file's tone and formatting conventions — same bullet style, same heading levels, same level of specificity.
- **Use the change template from the catalog** when a known pattern (P001-P010) matches. For new patterns, write a change template that follows the same format: specific, actionable, and non-destructive.

### Typical Change Locations

- Adding a bullet to a "Notes" section at the bottom of a SKILL.md
- Adding a guideline to a specific step's instructions
- Adding a check to a quality checklist in reference.md
- Strengthening an existing instruction with more specific language
- Adding a product-type-specific note to product-types-reference.md

### Conflict Detection

If the target section was already modified by a previous evolution (check the changelog),
note this in the report:

> "This section was previously modified by Evolution {N}. The new change would add to
> the existing modification. Review both changes together."

---

## Step 5: Present Improvement Report

Show the full report to the user:

```
## Evolution Report

### Builds Analyzed: {N}

| Build | Product Type | Date | Top Issue |
|-------|-------------|------|-----------|
| {slug} | {type} | {analyzed_at date} | {most prominent systemic issue or "clean build"} |
| {slug} | {type} | {analyzed_at date} | {top issue} |

### Patterns Identified: {N} actionable ({M} HIGH, {K} MEDIUM)

1. **{Pattern name}** (seen in {N} builds, confidence: HIGH)
   Evidence: {brief evidence summary}
   Target: `{filename}`, Section: "{section name}"

2. **{Pattern name}** (seen in {N} builds, confidence: MEDIUM)
   Evidence: {brief evidence summary}
   Target: `{filename}`, Section: "{section name}"

### Emerging Signals (not yet actionable)

- {Description} — seen in 1 build, monitoring
- {Description} — conflicting data, skipping

### Proposed Changes

#### Change 1: `{filename}`

**Pattern:** {pattern name} ({pattern_id}, {confidence})
**Section:** {section name}

> **Current text:**
> {exact current text of the section being modified — enough context to show where the addition goes}

> **Proposed text:**
> {the section with the new content added — showing the addition in context}

**Words added:** {count}

---

#### Change 2: `{filename}`

...

---

### Summary

- Files to modify: {N}
- Total words of new content: {N}
- Backups to create: {N}

**Apply these changes?**
- **Yes** — Back up originals and apply all changes
- **Selective** — Tell me which changes to apply (by number)
- **No** — Cancel, no changes made
```

Wait for user approval before proceeding.

---

## Step 6: Apply Changes

For each approved change:

### 6a: Create Backup

1. Determine the backup version number: count existing backups in `rewyse-ai/.evolution/backups/`
   that start with the same file identifier. The first backup is `v1`, next is `v2`, etc.
2. Read the current file content.
3. Write the backup to: `rewyse-ai/.evolution/backups/{dirname}-{filename}-v{N}.md`
   - `{dirname}` = the parent directory name (e.g., `write-prompt`, `product-qa`, `shared`)
   - `{filename}` = the file name (e.g., `SKILL.md`, `reference.md`)
   - Example: `rewyse-ai/.evolution/backups/write-prompt-SKILL.md-v1.md`

### 6b: Apply the Edit

Use the Edit tool to apply the surgical change. Verify the edit succeeded by reading
the file after modification.

### 6c: Update Changelog

After all changes are applied, determine the evolution number (count existing
`## Evolution` entries in the changelog and increment). Append to
`rewyse-ai/.evolution/changelog.md`:

```markdown
## Evolution {N} — {YYYY-MM-DD}

Builds analyzed: {slug-1}, {slug-2}, ...
Patterns: {total identified} identified, {applied count} applied

### Changes Applied

#### `{filepath}`
- **Pattern:** {pattern name} ({pattern_id})
- **Section:** {section name}
- **Change:** {one-sentence description of what was added}
- **Backup:** `backups/{dirname}-{filename}-v{N}.md`
- **Words added:** {count}

#### `{filepath}`
- **Pattern:** {pattern name} ({pattern_id})
- **Section:** {section name}
- **Change:** {one-sentence description}
- **Backup:** `backups/{dirname}-{filename}-v{N}.md`
- **Words added:** {count}
```

### 6d: Present Final Summary

```
Evolution {N} complete.

- {file count} files modified
- {backup count} backups created in rewyse-ai/.evolution/backups/
- Changelog updated

Changes applied:
- `{filepath}`: {one-line summary}
- `{filepath}`: {one-line summary}

To undo all changes from this evolution: run /evolve rollback
```

---

## Notes

- **Never modify state.json, output files, or the learning log.** This agent only writes to SKILL.md and reference.md files in the main pipeline, plus the changelog and backups.
- **If a proposed change conflicts with a previous evolution's change** (same section already modified), note this and let the user decide. Show both the previous change and the new proposal side by side.
- **Keep changes minimal and impactful.** Quality over quantity. A single well-placed sentence in a Notes section is better than a paragraph of vague guidance.
- **The QA report's `prompt_improvements_recommended` field is the most actionable data source.** These are specific, already-analyzed recommendations. When available, they should be the primary basis for changes to `write-prompt/SKILL.md`.
- **If all builds are the same product type,** apply improvements as type-specific additions to `shared/product-types-reference.md` rather than global changes to SKILL.md files. This prevents over-fitting the pipeline to one product type.
- **The 200-word limit per file is strict.** If multiple patterns target the same file, merge them into a cohesive addition. Do not apply them as separate disconnected bullets if they address related concerns.
- **After 5+ evolutions,** suggest a consolidation: offer to refactor accumulated notes and additions into the main instruction flow of each affected file (with user approval). Accumulated marginal additions can become hard to parse.
- **Rollback is all-or-nothing for an evolution.** You cannot roll back a single change from an evolution — the entire evolution is reverted. If the user wants to keep some changes and discard others, they should manually edit after rollback.
- **Read reference.md before every run.** The patterns catalog and confidence rules may themselves be updated over time.
