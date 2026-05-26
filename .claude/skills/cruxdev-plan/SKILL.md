---
name: cruxdev-plan
description: "Create a CruxDev build plan. Allocates a BP number, lays down a template under build_plans/, and runs the engine-driven validator. Use whenever the user asks to plan, draft, or scaffold a build plan / BP."
---

# /cruxdev-plan — Create a CruxDev Build Plan

## Arguments

`$ARGUMENTS` = the goal of the plan (one short sentence, e.g. "decompose the
chat-flow pipeline").

## When to invoke

The user said any of:

- "plan X", "create a build plan for X", "draft a BP for X"
- "scaffold a plan", "new BP", "bp-next"
- "let's plan ..." in a context where the next artifact should be a
  `build_plans/BUILD_PLAN_NNN_SLUG.md`

Do **not** invoke this for the *Execute* or *Converge* phases — those are
`/cruxdev-execute` and `/cruxdev-converge` respectively. This skill stops at
"plan exists, validated, ready for convergence".

## Protocol

### Step 1: Allocate number + render template

Call `mcp__cruxdev__create_plan_template` with the **required** parameters:

```jsonc
{
  "goal": "<the user's plan goal verbatim>",
  "project_dir": "<absolute path to the target project — REQUIRED, no cwd fallback>"
}
```

The MCP tool returns structured JSON:

```jsonc
{
  "template":     "...rendered # BUILD_PLAN_NNN: <goal> body...",
  "output_path":  "<project_dir>/build_plans/BUILD_PLAN_NNN_SLUG.md",
  "bp_number":    NNN,
  "validation":   { "valid": true|false, "errors": [...], "warnings": [...] }
}
```

The engine has already:

- Atomically allocated `NNN` via `allocate_bp_number` (no scan-and-improvise
  race window).
- Computed the absolute output path under `<project_dir>/build_plans/` —
  never `docs/`, never the cwd.
- Renamed the reservation placeholder to the final `BUILD_PLAN_NNN_SLUG.md`
  and written the template body in place.
- Run `validate_plan` against the freshly-written file as a **mandatory
  post-write step** (BP262 Phase 6.5) and returned the verdict in
  `validation`.

Do **not** improvise either the BP number or the file path. If you find
yourself constructing a `BUILD_PLAN_NNN_*.md` filename in your head, stop —
the engine already did it.

### Step 2: Fill in the phases

`Edit` the file at `output_path` to expand the template's placeholder
phases with the real work (Document Alignment, Phase 1..N, Convergence
Criteria, Test Command). Keep the `# BUILD_PLAN_NNN: <goal>` heading
exactly as the template rendered it.

The Tier-2 placement gate (BP262 Phase 6.4) will reject any `Write`/`Edit`
that lands build-plan content (`# BUILD_PLAN` heading) at a path outside
`build_plans/`. If you see a `BLOCKED: Build plan write outside
build_plans/` message, surface it to the user — you tried to write to the
wrong location.

### Step 3: Re-validate after edits

Call `mcp__cruxdev__validate_plan_structure` with the `output_path`. Treat
any `errors` as hard failures — fix and re-validate. Surface `warnings`
verbatim so the user (and the convergence pass) sees them.

### Step 4: Hand off to convergence

Once `validate_plan_structure` returns `valid: true`, the plan is ready
for `/cruxdev-converge` (or `start_convergence(plan_file=output_path)`
directly). Do not start convergence inside this skill — that is the next
slash command's job.

## Conventions enforced by the engine (BP262)

- Filename: `BUILD_PLAN_NNN_SLUG.md`, uppercase slug, three-digit zero-padded
  number. Validator regex: `^BUILD_PLAN_\d+_[A-Z0-9_]+\.md$`.
- Parent directory: `build_plans/` — **not** `docs/`, **not** project root.
- BP number: monotone, no duplicates. The validator surfaces collisions as
  hard errors (Phase 6.3).
- Required sections: title (`# `), at least one checklist item (`- [ ]`),
  and (warned-on, not required) `## Document Alignment`, a test command
  reference, and convergence criteria.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Plan must live in build_plans/, found in <dir>` | You wrote to `docs/` or project root | Move the file to `build_plans/` (or call `create_plan_template` again to get a fresh path) |
| `Duplicate BP number N — collides with: ...` | Two `BUILD_PLAN_N_*.md` files exist | Re-run `create_plan_template` to allocate a fresh number |
| `Plan filename '...' does not match required format` | Lowercase slug, missing number, or `.txt` extension | Rename to `BUILD_PLAN_NNN_SLUG.md` (uppercase) |
| `BLOCKED: Build plan write outside build_plans/` | Tier-2 placement gate caught a misplaced `Write`/`Edit` | Re-target the call to the engine-built `output_path` |
| `create_plan_template_for` errored on `project_dir` | The required `project_dir` parameter was missing or wrong | Pass an absolute path to the target project root |

## Why this skill exists

The dropship incident (a request to "create a build plan for X" that landed
in `docs/`) is the canonical failure mode BP262 is closing. This skill is
the user-facing surface of that fix: every plan invocation goes through the
engine-allocated path and the engine-driven validator, so the LLM never
improvises a filename, a number, or a directory.
