# /cruxdev-execute — Execute a converged build plan

Execute a plan that has already been converged via /converge. This does the work described in the plan, with adversarial output auditing baked in.

**Lifecycle:** Write plan → /converge → /execute

## Arguments

$ARGUMENTS = the build plan file path or shortcut (e.g., BP121, BUILD_PLAN_121_IMPROVE_COMMAND.md)

## Resolve Target

If the argument is a shortcut like "BP121" or "bp121" or just "121":
1. Search `build_plans/BUILD_PLAN_{number}_*.md` for a match
2. If exactly one match, use it
3. If multiple or none, ask the user to clarify

## Protocol

### Step 1: Validate the plan is converged

Read the plan file. Check that its status contains "CONVERGED" or "PLAN CONVERGED". If not, tell the user: "This plan hasn't been converged yet. Run /converge first."

### Step 2: Start execution

```
Call start_convergence(plan_file=<resolved path>, skip_to_phase="executing")
```

This creates a NEW convergence run starting at the executing phase, bypassing plan auditing. Pass test_command if you know it from reading the plan.

### Step 3: Execution loop

Repeat until done:

1. Read the task from the response (or call `convergence_next_task(convergence_id)`)
2. Execute the task:
   - **"execute"**: Build the checklist item. Write code, write tests, run tests. The metadata includes `checklist_item` ID and progress.
   - **"audit"**: Adversarial audit of the deliverables. Read the listed files. Check each dimension. Report findings as JSON. This is BAKED IN — not a separate step you choose to do.
   - **"doc_align"**: Verify documentation matches what was built.
   - **"test"**: Run the test command. Report pass/fail.
   - **"write"**: Write or update the specified file.
   - **"done"**: Execution complete. Report the final status.
   - **"escalated"**: Engine stopped. Report why and suggest next steps.
3. Execute thoroughly — write real code, run real tests, fix real issues
4. **Edit the plan-file checkbox** (BP250 — REQUIRED before submit): in `<plan_file>`, find `- [ ] **<checklist_item>** …` and change it to `- [x] **<checklist_item>** …`. **The checkbox flip is the completion signal** — `findings_json: "[]"` alone bumps `consecutive_clean` but does NOT advance the `done` counter. The engine reads checkbox state from the plan file to compute progress; without flipping the box, the engine cannot tell the item is done. (Post-BP250: a no-progress submit returns `task_type: "no_progress"` instead of advancing — you cannot bypass.)
5. Call `convergence_submit_result(convergence_id, findings_json)`:
   - Clean pass: `"[]"`
   - Found issues: `[{"id": "f1", "file": "path", "dimension": "correctness", "severity": "high", "description": "what's wrong", "suggested_fix": "how to fix", "fixed": true}]`
6. The response contains the next task inline — go to step 2

### Step 4: Report

When the engine reports "done", report:
- Deliverables completed
- Total audit rounds on deliverables
- Total findings found and fixed
- Tests passing
- Final status

## Rules

- **Plan MUST be converged first.** Do not execute an unconverged plan.
- **Output auditing is automatic.** The engine will send audit tasks after execution. You don't skip them.
- **Do NOT decide when to stop.** The engine decides. Keep looping until "done" or "escalated".
- **Report honestly.** If deliverables have issues, report them.
- **Two consecutive clean passes on output = execution converged.** The engine handles this.
- **Drive ALL phases to completion (BP251).** Do NOT stop at phase boundaries. Time-of-day, effort estimation ("multi-hour scope"), session quantization ("too much for tonight"), phase-boundary preference without engine signal, and "needs a fresh session" without compaction signal are NOT legitimate stop criteria. The only legitimate stops are: (1) **compaction imminent** — call `mcp__cruxdev__cruxdev_clear` and recommend `/clear`; (2) **hard blocker** requiring human judgment, named explicitly; (3) **engine reports `task_type: "escalated"`**; (4) **user explicitly said stop**. See CLAUDE.md §11 (canonical) and `feedback_execute_means_all_phases.md`.
