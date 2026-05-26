# /cruxdev-adjust — Targeted modification with zero-regression auditing

Adjust an existing artifact with a specific change. Impact analysis first, then apply, then verify zero regressions. Supports derivatives (copy + adjust, original untouched).

## Arguments

$ARGUMENTS = target path + change description + optional flags

Parse from arguments:
- First argument: target path or shortcut
- Remaining text in quotes: change description
- `--derivative`: copy original, adjust the copy, original untouched
- `--name SUFFIX`: derivative filename suffix (e.g., WHITELABEL)
- `--quick`/`--deep`: depth override

## Protocol

### Step 1: Start adjustment

```
Call adjust_start(target=<path>, change_description=<change>, derivative=<bool>, derivative_name=<suffix>)
```

### Step 2: Adjustment loop

Repeat until done:

1. Read the task from the response
2. Execute based on type:
   - **"impact_analysis"**: Read the target. Analyze what the change affects: directly affected sections, ripple effects, cross-references, whether research is needed. Submit as: `{"affected_sections": [...], "ripple_effects": [...], "research_needed": true/false}`
   - **"apply_adjustment"**: Read the working file (derivative if applicable). Apply the change to ALL affected sections. Update cross-references. ZERO regressions. Submit as: `{}` when done.
   - **"integrity_audit"**: Find every REGRESSION caused by this change. Check: stale references, broken cross-references, wrong calculations, contradictions, incoherent flow, new gaps, orphaned content, side effects, broken invariants. Submit as: `{"findings": [...]}` or `{"findings": []}` if clean.
   - **"deliver"**: Show diff between original and adjusted. Ask user for approval. Submit as: `{"approved": true}` or `{"approved": false}`.
   - **"done"**: Adjustment converged. Zero regressions.
   - **"escalated"**: Engine stopped. Report why.
   - **"rejected"**: User rejected. Original untouched.
3. Call `adjust_submit_result(session_id, result_json)`
4. Response contains next task — go to step 2

## Rules

- **Zero regressions is the convergence standard.** Not a goal — a hard requirement.
- **Impact analysis FIRST.** Before any change, understand what it affects.
- **Independent auditors.** For integrity_audit tasks, spawn a separate agent.
- **Derivatives preserve the original.** The original file is NEVER modified in derivative mode.
- **Two consecutive clean integrity audit passes = converged.**
