# /cruxdev-plan — Create a CruxDev build plan

Create a structured build plan that the convergence engine can execute.

## Arguments

$ARGUMENTS = the goal (what to build, fix, or migrate)

## Protocol

### Step 1: Get methodology

Call `get_methodology()` to load the CruxDev development patterns. Read them — they define how plans should be structured.

### Step 2: Generate template

Call `create_plan_template(goal=$ARGUMENTS, project_dir=<absolute project dir>)`. **`project_dir` is required** — there is no cwd fallback; the shared cruxdev MCP server's working directory is not your project. Pass the absolute path to the project you are planning for.

The tool returns structured JSON: `{template, output_path, bp_number}`.
- `template` — the rendered plan skeleton (heading already carries the real allocated BP number, no literal `NNN`).
- `output_path` — the absolute path inside `<project_dir>/build_plans/` where you must write the filled-in plan.
- `bp_number` — the atomically-allocated BP number (used in the filename and heading).

### Step 3: Research and fill in

1. Read the codebase to understand current state
2. Fill in each phase with specific, actionable tasks
3. Add checklist items (`- [ ]`) for every task
4. Add test commands
5. Add convergence criteria
6. **Write the filled-in plan to the engine-returned `output_path` field — never compose `BUILD_PLAN_NNN_<slug>.md` manually.** (BP262 Phase 3.7: the engine owns BP-number allocation and filename composition; LLM improvisation here is what produced the dropship `docs/<slug>.md` incident.)

### Step 4: Validate

Call `validate_plan_structure(plan_file)` to check the plan has everything the engine needs.

Fix any errors. Address warnings if possible.

### Step 5: Confirm with user

Show the plan to the user. Ask if they want to adjust anything before convergence.

## Plan quality guidelines

- Each phase should be completable in one session
- Checklists should be specific enough that "done" is unambiguous
- Test commands should exist and pass before convergence starts
- Dependencies between phases should be explicit
- Include a "Definition of Done" section
