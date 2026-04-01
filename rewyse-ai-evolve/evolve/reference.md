# Evolve Reference — Schema, Patterns & Rules

This document contains the learning log schema, improvement patterns catalog, confidence
rules, product-type routing rules, and change scope limits for the `/evolve` skill.
Read this file at the start of every `/evolve` invocation.

---

## Section 1: Learning Log Schema

The learning log lives at `rewyse-ai/.evolution/learning-log.json`. It is an append-only
file managed by `/analyze-build`. The `/evolve` agent reads it but never writes to it.

### Top-Level Structure

```json
{
  "version": 1,
  "last_updated": "2026-03-30T14:22:00Z",
  "builds": [ ...build entries... ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | integer | Schema version. Currently `1`. |
| `last_updated` | string (ISO-8601) | Timestamp of the most recent build addition. |
| `builds` | array | Ordered list of analyzed build entries (oldest first). |

### Build Entry Schema

Each element in the `builds` array has this structure:

```json
{
  "slug": "hyrox-recovery-recipes",
  "product_type": "recipe",
  "niche": "Hyrox competition recovery nutrition",
  "icp": "Competitive Hyrox athletes aged 25-45 who train 4-6x/week",
  "entry_count": 80,
  "analyzed_at": "2026-03-28T10:15:00Z",
  "phases_completed": 9,
  "delivery_mode": "database",
  "phase_revisions": [
    {
      "phase": 3,
      "phase_name": "expert-profile",
      "revision_count": 2,
      "reason": "tone too formal for athlete audience"
    }
  ],
  "test_feedback": {
    "rounds": 1,
    "issues": [
      "Opening paragraphs across samples sound identical",
      "Calorie counts appear fabricated — not grounded in recipe variables"
    ],
    "upstream_fixes": [
      {
        "file": "expert-profile.md",
        "what_changed": "adjusted tone from clinical to conversational-coaching"
      },
      {
        "file": "generation-prompt.md",
        "what_changed": "added constraint: never fabricate specific nutrition numbers"
      }
    ]
  },
  "qa_summary": {
    "total_scanned": 80,
    "critical": 2,
    "warning": 45,
    "info": 120,
    "systemic_issues": [
      {
        "description": "52 entries open with nearly identical 'Recovery is essential...' phrasing",
        "root_cause": "generation prompt lacks variation instruction for opening paragraphs",
        "affected_count": 52,
        "category": "repetition"
      },
      {
        "description": "Specific calorie and macro numbers appear fabricated",
        "root_cause": "prompt does not restrict numeric claims to variable-provided data",
        "affected_count": 80,
        "category": "hallucination"
      }
    ],
    "top_issue_categories": ["repetition", "hallucination"],
    "prompt_improvements_recommended": [
      "Add variation instruction: vary opening approach across entries, never reuse the same first sentence pattern",
      "Add constraint: only include specific nutrition numbers if provided in the entry's database variables; otherwise use directional language"
    ]
  },
  "generation_stats": {
    "total_entries": 80,
    "published": 78,
    "failed": 2,
    "waves": 8,
    "batch_size": 10
  },
  "what_worked_well": [
    "Section structure consistently matched blueprint",
    "Expert voice was strong after Phase 3 revision",
    "Only 2 generation failures out of 80 entries"
  ]
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `slug` | string | Project directory name. Unique identifier for the build. |
| `product_type` | enum | One of: `recipe`, `sop`, `ebook`, `workbook`, `template`, `checklist`, `guide`, `prompt-pack`, `swipe-file`, `scripts`, `course`. |
| `niche` | string | Specific domain or topic area. |
| `icp` | string | Ideal customer profile — who this product is for. |
| `entry_count` | integer | Number of entries/pages in the database. |
| `analyzed_at` | string (ISO-8601) | When `/analyze-build` processed this build. |
| `phases_completed` | integer | Count of phases with status "approved" in state.json. Range: 7-10. |
| `delivery_mode` | enum | `database` or `page`. How content is structured in Notion. |
| `phase_revisions` | array | Phases that required revisions. Each has `phase` (number), `phase_name`, `revision_count`, and `reason`. Empty array if no revisions occurred. |
| `test_feedback` | object | Phase 6 test content results. `rounds` = feedback iterations, `issues` = problems found, `upstream_fixes` = files modified to fix them. |
| `test_feedback.rounds` | integer | Number of feedback rounds in Phase 6. 0 if samples passed first try. |
| `test_feedback.issues` | array of strings | Description of each issue raised during testing. |
| `test_feedback.upstream_fixes` | array of objects | Each has `file` (which artifact was modified) and `what_changed` (description of the modification). |
| `qa_summary` | object | Phase 9 QA results. Null if Phase 9 was not run. |
| `qa_summary.total_scanned` | integer | Number of entries the QA scan covered. |
| `qa_summary.critical` | integer | Count of critical-severity issues. |
| `qa_summary.warning` | integer | Count of warning-severity issues. |
| `qa_summary.info` | integer | Count of info-severity issues. |
| `qa_summary.systemic_issues` | array | Issues affecting multiple entries. Each has `description`, `root_cause`, `affected_count`, and `category`. |
| `qa_summary.systemic_issues[].category` | enum | One of: `formatting`, `word_count`, `repetition`, `hallucination`, `tone_drift`, `missing_section`, `thin_content`, `other`. |
| `qa_summary.top_issue_categories` | array of strings | The 2-3 most frequent issue categories, ordered by prevalence. |
| `qa_summary.prompt_improvements_recommended` | array of strings | Verbatim recommendations from the QA report's "Recommended Actions" or "Prompt Improvements" sections. |
| `generation_stats` | object | Phase 7 generation results. |
| `generation_stats.total_entries` | integer | Total entries attempted. |
| `generation_stats.published` | integer | Successfully published entries. |
| `generation_stats.failed` | integer | Failed entries. |
| `generation_stats.waves` | integer | Number of generation waves/batches. |
| `generation_stats.batch_size` | integer | Entries per batch. |
| `what_worked_well` | array of strings | Positive observations — things that should be preserved in future builds. |

---

## Section 2: Improvement Patterns Catalog

Known patterns mapping build signals to target files and change templates. Each pattern
has an ID, a signal condition, a target file and section, and a specific change template.

When `/evolve` identifies a pattern match, it uses the change template as the basis for
the proposed edit. Templates can be adapted to the specific context but should preserve
the core instruction.

| ID | Signal | Target File | Target Section | Change Template |
|----|--------|-------------|----------------|-----------------|
| P001 | `qa_summary.systemic_issues` contains an entry where `category` is `"hallucination"` or `description` contains "hallucinated" | `rewyse-ai/write-prompt/SKILL.md` | Quality Constraints (Notes section) | Add: "Never include specific numbers, percentages, statistics, or citations unless they are provided in the entry's database variables. When the data is not available, use directional language ('significant improvement', 'meaningful reduction') instead of fabricated specifics." |
| P002 | `qa_summary.systemic_issues` contains an entry where `category` is `"repetition"` or `description` contains "cross-entry clones" or "identical opening" | `rewyse-ai/write-prompt/SKILL.md` | Content Structure section or Notes | Add: "Vary the opening approach for the first content section across entries. Never start 2 or more entries with the same sentence pattern. Use at least 3 distinct opening strategies: question, bold claim, scenario, analogy, or direct instruction." |
| P003 | `qa_summary.systemic_issues` contains an entry where `category` is `"word_count"` and `description` indicates overruns (not underruns) | `rewyse-ai/content-blueprint/SKILL.md` | Section design guidelines | Add: "Specify hard maximum word counts (not just ranges) for each section. The generation prompt should enforce upper bounds strictly. Example: 'Section must be 80-120 words. Hard maximum: 130 words. Content exceeding this limit must be trimmed.'" |
| P004 | `test_feedback.rounds` > 2 in a build AND `test_feedback.upstream_fixes` targets `expert-profile.md` | `rewyse-ai/expert-profile/SKILL.md` | Voice & Tone step | Add: "Default to a conversational-authoritative blend unless the niche specifically demands clinical or academic tone. If the first voice sample is rejected for being too formal, immediately shift to a warmer register: shorter sentences, second-person address, and occasional rhetorical questions." |
| P005 | `generation_stats.failed` / `generation_stats.total_entries` > 0.10 in 2+ builds | `rewyse-ai/generate-content/SKILL.md` | Batching rules or Notes | Add: "If previous builds for this product type experienced >10% failure rate, reduce batch size to 3-5 entries per wave and add a 500ms delay between API calls within each batch. Monitor the first wave's success rate before proceeding." |
| P006 | `qa_summary.systemic_issues` contains an entry where `category` is `"formatting"` | `rewyse-ai/product-qa/reference.md` | Universal Checks section | Add the specific formatting check that was missed. Derive the check from the systemic issue's `description` field. Example: if the issue is "inconsistent heading levels in tables", add: "- [ ] Tables use h3 for headers, not h2 or bold text." |
| P007 | `qa_summary.prompt_improvements_recommended` contains any entries | `rewyse-ai/write-prompt/SKILL.md` | Quality Constraints or Notes | Add the specific recommended constraint verbatim from the QA report. If multiple recommendations exist, consolidate related ones into a single coherent paragraph. Prefix with: "Based on QA findings:" |
| P008 | 2+ builds share the same `product_type` AND share a `systemic_issues` entry with the same `category` | `rewyse-ai/shared/product-types-reference.md` | The section for that product type | Add a type-specific guidance note. Example for recipe type with hallucination: "Recipe entries must only include nutrition data (calories, macros, micronutrients) when the database variables explicitly provide these values. Omit nutrition sections entirely if variables do not include nutrition data." |
| P009 | `qa_summary.systemic_issues` contains an entry where `category` is `"tone_drift"` | `rewyse-ai/expert-profile/SKILL.md` | Voice calibration or Notes | Add: "Include 2-3 'avoid' examples that demonstrate the unwanted tone alongside the desired tone examples. Format: 'AVOID: [example of unwanted tone]. INSTEAD: [example of desired tone].' This gives the generation prompt concrete negative boundaries." |
| P010 | `qa_summary.systemic_issues` contains an entry where `category` is `"thin_content"` in 2+ builds | `rewyse-ai/content-blueprint/SKILL.md` | Section design guidelines | Add: "Set minimum word counts at 75% of the target for each section. Instruct the generation prompt to 'err on the upper bound of the word count range' for depth-critical sections. Flag any section definition with a range wider than 100 words — tighten it." |

### Catalog Maintenance

This catalog is not static. After applying a NEW pattern (one not in the table above),
add it to this table with the next available ID (P011, P012, etc.). Include the signal,
target, and the change template that was actually applied. This keeps the catalog growing
with real-world patterns.

---

## Section 3: Confidence Rules

These rules determine whether a pattern is proposed to the user or merely logged.

### HIGH Confidence

**Criteria:** The signal appears in 2 or more analyzed builds.

**Action:** Propose the change. Present in the improvement report with full before/after diff.

**Examples:**
- Repetition flagged as a systemic issue in builds A and B
- Expert profile required revision in 3 out of 4 builds
- Word count overruns in 2 different product types

### MEDIUM Confidence

**Criteria:** The signal appears in only 1 build, BUT the QA report contains an explicit
root cause analysis with a specific fix recommendation (i.e., `prompt_improvements_recommended`
is not empty for this issue, or the root cause traces to a specific file and section).

**Action:** Propose the change, but flag it as MEDIUM confidence in the report. Add a note:
"Based on a single build — will be upgraded to HIGH if confirmed in the next build."

**Examples:**
- One build's QA report says "add a constraint against fabricated statistics" with a clear
  root cause pointing to the generation prompt
- A single build shows 15% generation failure rate with a specific error pattern

### LOW Confidence

**Criteria:** Single observation with no clear root cause. The issue appeared once, the QA
report does not offer a specific fix, and the pattern is not in the catalog.

**Action:** Do NOT propose a change. Mention in the report under "Emerging Signals" so the
user is aware. If the pattern appears again in a future build, it will be upgraded.

**Examples:**
- One build had 3 entries with slightly off tone, but QA flagged it as INFO not WARNING
- A single entry failed generation with a timeout error

### CONFLICTING

**Criteria:** Two builds suggest opposite changes for the same target. For example, one
build's feedback says "tone is too formal" and another says "tone is too casual."

**Action:** Do NOT propose a change. Mention in the report under "Mixed Signals" with both
data points. Let the user decide.

**Examples:**
- Build A: "expert profile tone too formal" → Build B: "expert profile tone too casual"
- Build A: "word counts too high" → Build B: "content is thin / not enough depth"

---

## Section 4: Product-Type Routing Rules

These rules determine whether an improvement is applied globally (to a SKILL.md file) or
scoped to a specific product type (in `product-types-reference.md`).

### Rule 1: All Builds Same Type

If ALL analyzed builds share the same `product_type`:

- Route ALL improvements to `rewyse-ai/shared/product-types-reference.md` under that
  type's section.
- Rationale: The pattern might be type-specific. Applying it globally could harm builds
  of other product types. Start narrow, broaden later.
- Exception: If the pattern clearly targets pipeline mechanics (e.g., batch size, generation
  failures), apply it to the SKILL.md file. Only content/quality patterns are type-scoped.

### Rule 2: Pattern Appears in One Type Only

If multiple product types exist in the builds, but a pattern appears ONLY in builds of
one specific type:

- Route to `rewyse-ai/shared/product-types-reference.md` under that type's section.
- Add a note in the change: "Observed only in {type} builds so far."

### Rule 3: Pattern Appears Across Types

If a pattern appears in builds of 2 or more different product types:

- Route to the relevant SKILL.md file as a global improvement.
- Rationale: Cross-type recurrence indicates a pipeline-level issue, not a type-specific one.

### Rule 4: Mixed Routing

A single evolution can contain both type-specific and global changes. Apply routing rules
per-pattern, not per-evolution.

---

## Section 5: Change Scope Limits

These limits prevent runaway modifications and maintain pipeline stability.

### Per-Evolution Limits

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max files modified | 8 | Keeps each evolution focused and reviewable |
| Max words added per file | 200 | Prevents bloating instruction files |
| Max total words added | 1,000 | Caps the total delta across all files |
| Changes must be additive | Always | Never remove or restructure existing instructions |
| Step numbering | Preserve | Never change step numbers or reorder steps |
| File structure | Preserve | Never add/remove/rename sections or headings |

### Additive-Only Rule

All changes must ADD to existing content. Specifically:

- **Allowed:** Adding bullet points to a list, adding a sentence to a paragraph, adding
  a row to a table, adding a check to a checklist, strengthening existing language with
  more specific wording.
- **Not allowed:** Removing instructions, rewording existing content (unless strengthening),
  restructuring sections, changing step numbers, moving content between sections, deleting
  checklist items.

### Consolidation Trigger

After 5 or more evolutions have been applied (check the changelog), present this suggestion
at the end of the evolution report:

> "This is Evolution {N}. The pipeline files now have {N} rounds of accumulated additions.
> Consider running a consolidation pass: I'll review all accumulated notes and additions in
> each modified file, and refactor them into the main instruction flow — cleaner and more
> integrated. This requires your approval for each file."

A consolidation pass is the ONE exception to the additive-only rule. During consolidation:
- Read all changelog entries to understand the history of changes
- Read each modified file
- Propose a rewrite of the affected sections that integrates the accumulated additions
  into the main flow, removing redundancy
- Present full before/after for approval
- Back up originals before applying
- Log as a "Consolidation" entry in the changelog (not a numbered evolution)
