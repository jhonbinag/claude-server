---
name: analyze-build
description: "Use when someone has completed a product build and wants to feed it into the self-improvement system. Extracts structured learnings from build output files."
argument-hint: [project-slug]
---

## Context

Read-only analysis agent. Reads build artifacts from a completed product build, extracts
structured learnings, and appends them to `rewyse-ai/.evolution/learning-log.json`. This
agent never modifies the build output files or any SKILL.md files.

Cross-references:
- `/evolve` — Apply improvements based on accumulated learnings
- `/evolve-help` — Questions about the self-improvement system

**State directory:** `rewyse-ai/output/{project-slug}/`

**Reads:**
- `state.json` — Phase statuses, revision counts, delivery mode, completion dates
- `product-idea.md` — Product type, niche, ICP, entry count, delivery mode recommendation
- `expert-profile.md` — Tone direction, vocabulary level (metadata only)
- `content-blueprint.md` — Section count, section names, word count targets
- `generation-prompt.md` — Prompt length, quality constraints listed
- `test-results.md` — Feedback rounds, issues raised, upstream root causes, fixes applied
- `content-log.json` — Published/failed counts, failure reasons, wave count, batch sizes
- `qa-report.md` — Severity counts, systemic issues, root cause analysis, prompt improvement recommendations
- `design-config.json` — Final delivery mode

**Writes:**
- `rewyse-ai/.evolution/learning-log.json` — Append-only structured learning log
- `rewyse-ai/.evolution/changelog.md` — Created if missing (not written to by this agent)
- `rewyse-ai/.evolution/backups/` — Created if missing (not written to by this agent)

---

## Step 1: Locate the Build

If `$ARGUMENTS` is provided, use it as the project slug.

Otherwise, scan `rewyse-ai/output/` for subdirectories containing a `state.json` file.

- **If one project found:** use it. Confirm with the user: "Found project `{slug}`. Analyzing this build."
- **If multiple projects found:** present a numbered list and ask the user to choose:

  > Found multiple completed builds:
  > 1. `hyrox-recovery-recipes` — Phase 9 complete
  > 2. `coaching-scripts` — Phase 10 complete
  >
  > Which build should I analyze?

- **If no projects found:** tell the user: "No build output found in `rewyse-ai/output/`. Complete a build with `/build-product` first."

### Validate Build Readiness

Read `state.json` from the selected project. Check that Phase 7 (generate-content) has
`status: "approved"`:

```
state.json → phases.7_generate_content.status === "approved"
```

If Phase 7 is not approved, explain:

> "The self-improvement system needs at least a completed content generation (Phase 7)
> to have meaningful data to learn from. This build is currently at Phase {N}. Run the
> build further and come back when content has been generated."

If Phase 7 is approved but Phase 9 (product-qa) was not run, note this but proceed:

> "Phase 9 (QA) was not run for this build. The analysis will proceed with available
> data, but QA data is the most valuable input for the self-improvement system. Consider
> running `/product-qa` before analyzing if you want richer learnings."

---

## Step 2: Read Build Artifacts

Read these files from `rewyse-ai/output/{slug}/`. All files are optional except `state.json`
and `product-idea.md` — for missing files, note them as "not available" in the analysis.

| File | What to Extract |
|------|-----------------|
| `state.json` | Per-phase statuses (approved/skipped/in_progress), revision counts per phase, `delivery_mode`, completion timestamps |
| `product-idea.md` | `product_type`, `niche`, `icp`, `entry_count`, delivery mode recommendation, value proposition |
| `expert-profile.md` | Primary tone, secondary tone, vocabulary level, perspective (metadata only — do not extract full prose) |
| `content-blueprint.md` | Total section count, list of section names, word count targets per section |
| `generation-prompt.md` | Total prompt length (word count), list of quality constraints or rules mentioned |
| `test-results.md` | Number of feedback rounds, description of each issue raised, which upstream file was identified as root cause for each issue, what specific fixes were applied |
| `content-log.json` | `total_entries`, `published` count, `failed` count, failure reasons (grouped), `wave_count`, `batch_size` |
| `qa-report.md` | **This is the most important file.** Extract: total entries scanned, counts by severity (critical/warning/info), every systemic issue (description + root cause + affected count + category), top issue categories, and especially any "Prompt Improvements Recommended" or "Recommended Actions" sections — extract these verbatim |
| `design-config.json` | Final `delivery_mode` |

### Extraction Priority

1. `qa-report.md` — Root Cause Analysis and Recommended Actions sections are the highest-value data
2. `test-results.md` — Feedback rounds and upstream fixes reveal pipeline friction points
3. `content-log.json` — Failure rates indicate generation reliability
4. Everything else — Supporting context

For each file read, note the key data points extracted. For missing files, record:
`"file": "not_available"` in the corresponding section.

---

## Step 3: Extract Structured Learnings

Use a subagent (Agent tool, model: sonnet) to analyze all the artifacts and produce a
structured JSON entry. Pass all the read file contents to the subagent.

### Subagent Prompt

> You are a build analysis engine for the Rewyse AI self-improvement system. You will
> receive the contents of multiple build artifact files from a completed digital product
> build. Your job is to extract structured learnings into a single JSON object.
>
> ## Build Artifacts
>
> {paste all file contents here, labeled by filename}
>
> ## Instructions
>
> Analyze all artifacts and produce a JSON object matching this exact schema:
>
> ```json
> {
>   "slug": "project-slug",
>   "product_type": "recipe|sop|ebook|workbook|template|checklist|guide|prompt-pack|swipe-file|scripts|course",
>   "niche": "string — the specific domain or topic",
>   "icp": "string — ideal customer profile description",
>   "entry_count": 50,
>   "analyzed_at": "ISO-8601 timestamp",
>   "phases_completed": 9,
>   "delivery_mode": "database|page",
>   "phase_revisions": [
>     {
>       "phase": 3,
>       "phase_name": "expert-profile",
>       "revision_count": 2,
>       "reason": "tone too formal"
>     }
>   ],
>   "test_feedback": {
>     "rounds": 1,
>     "issues": ["description of each issue raised during Phase 6 testing"],
>     "upstream_fixes": [
>       {
>         "file": "expert-profile.md",
>         "what_changed": "adjusted tone from clinical to conversational"
>       }
>     ]
>   },
>   "qa_summary": {
>     "total_scanned": 52,
>     "critical": 1,
>     "warning": 82,
>     "info": 190,
>     "systemic_issues": [
>       {
>         "description": "string — what the issue is",
>         "root_cause": "string — why it happens",
>         "affected_count": 52,
>         "category": "formatting|word_count|repetition|hallucination|tone_drift|missing_section|thin_content|other"
>       }
>     ],
>     "top_issue_categories": ["hallucination", "repetition"],
>     "prompt_improvements_recommended": ["specific recommendation strings extracted verbatim from qa-report.md"]
>   },
>   "generation_stats": {
>     "total_entries": 52,
>     "published": 52,
>     "failed": 0,
>     "waves": 6,
>     "batch_size": 10
>   },
>   "what_worked_well": ["list of positive observations — clean entries, strong voice match, good structure, etc."]
> }
> ```
>
> ## Rules
>
> - Extract data faithfully from the source files. Do not invent issues that are not in the data.
> - If a file was not available, set its corresponding fields to null (for objects) or empty arrays (for lists).
> - For `phase_revisions`: only include phases where `revision_count > 0` in state.json.
> - For `qa_summary.systemic_issues`: extract EVERY systemic issue listed in the QA report, not just the top ones.
> - For `prompt_improvements_recommended`: copy the exact text from the QA report's recommendations. Do not paraphrase.
> - For `what_worked_well`: look for clean entry counts, positive QA notes, successful generation stats (0 failures), low revision counts. If QA found few issues relative to entry count, note that.
> - `phases_completed` = count of phases with status "approved" in state.json.
> - Return only the JSON object, no surrounding text.

### Validate the Output

After the subagent returns, verify:
1. `slug` matches the project slug
2. `product_type` is one of the valid enum values
3. `analyzed_at` is a valid ISO-8601 timestamp
4. `qa_summary` fields are present (even if null/empty when QA was skipped)
5. JSON is valid and parseable

If validation fails, fix the issues before proceeding.

---

## Step 4: Append to Learning Log

1. Read `rewyse-ai/.evolution/learning-log.json`.
   - If the file does not exist, create it with this initial structure:
     ```json
     {
       "version": 1,
       "last_updated": "",
       "builds": []
     }
     ```

2. Check for duplicate: if a build with the same `slug` already exists in the `builds`
   array, ask the user:
   > "A learning entry for `{slug}` already exists (analyzed {date}). Replace it with
   > a fresh analysis, or keep both?"
   - **Replace:** remove the old entry, append the new one
   - **Keep both:** append with a `-v2` suffix on the slug

3. Append the new build entry to the `builds` array.

4. Update `last_updated` to the current ISO-8601 timestamp.

5. Write the file back to `rewyse-ai/.evolution/learning-log.json`.

6. Ensure these paths exist (create if missing — do not write content, just create):
   - `rewyse-ai/.evolution/changelog.md` — initialize with:
     ```markdown
     # Evolution Changelog

     Records all improvements applied to Rewyse AI pipeline files by `/evolve`.

     ---
     ```
   - `rewyse-ai/.evolution/backups/` — create the directory

---

## Step 5: Present Summary

Show the following summary to the user:

```
Build Analysis Complete: {slug}

Product: {product_type} — {niche} ({entry_count} entries)
Phases completed: {phases_completed}/10
Delivery mode: {delivery_mode}

Key Findings:
- Test phase: {rounds} feedback round(s){, root causes traced to {file list} | , no upstream fixes needed}
- QA: {critical} critical, {warning} warning, {info} info issues across {total_scanned} entries
- Systemic issues: {top 3 systemic issue descriptions, one line each}
- Prompt improvements identified: {count of prompt_improvements_recommended}
- What worked well: {top 2-3 items from what_worked_well}

Learning log updated. Total builds analyzed: {total builds in learning-log.json}
```

### Cross-Build Patterns (2+ builds only)

If the learning log now contains 2 or more builds, scan for patterns and append:

```
Cross-build patterns emerging:
- {pattern description} (seen in {N}/{total} builds)
- {pattern description} (seen in {N}/{total} builds)

Run /evolve to apply improvements based on all {total} analyzed builds.
```

Pattern detection rules:
- Same `qa_summary.systemic_issues.category` appears in 2+ builds
- Same upstream file in `test_feedback.upstream_fixes` across 2+ builds
- Same `product_type` with similar issues (type-specific pattern)
- Generation failure rate > 10% in 2+ builds
- `phase_revisions` on the same phase in 2+ builds

If fewer than 2 builds exist, show instead:

```
This is the first analyzed build. After analyzing 1 more build, /evolve can
identify cross-build patterns and propose pipeline improvements.
```

---

## Notes

- **Never modify build output files.** This agent is strictly read-only on the `rewyse-ai/output/` directory. It only writes to `rewyse-ai/.evolution/`.
- **The QA report's "Root Cause Analysis" and "Recommended Actions" sections are the most valuable data.** Prioritize extracting these verbatim. If they contain specific prompt edits or constraint additions, capture them exactly as written.
- **If `qa-report.md` does not exist** (user skipped Phase 9), note this prominently in the summary but still analyze all other available artifacts. The learning entry will have null/empty QA fields.
- **Keep the extraction faithful to the source.** Do not invent issues that are not in the data. Do not infer problems from general knowledge — only report what the artifacts contain.
- **Duplicate detection matters.** If the user re-runs analysis on the same build (e.g., after running QA for the first time), give them the option to replace the stale entry. Two entries for the same slug with different data is confusing.
- **The subagent does the heavy lifting.** Pass it ALL file contents in a single prompt so it can cross-reference (e.g., tracing a QA systemic issue back to a test feedback item). Do not split the analysis across multiple subagents.
- **Phase revision counts come from state.json**, not from reading file diffs. Each phase in state.json may have a revision_count or the status history may show how many times it was set back to "in_progress".
- **`what_worked_well` is not filler.** Positive signals matter — they tell `/evolve` which parts of the pipeline to preserve during improvements. A build with 0 critical issues and strong voice consistency has lessons worth logging.
