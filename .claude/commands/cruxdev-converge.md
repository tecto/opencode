# /cruxdev-converge — Run the CruxDev convergence engine

Execute the full convergence loop on a build plan. The engine owns all termination logic — you execute the tasks it gives you.

## Arguments

$ARGUMENTS = the build plan file path (e.g., BUILD_PLAN_001.md)

If no argument provided, look for BUILD_PLAN_*.md files in the current directory.

## Protocol

### Step 1: Start convergence

```
Call start_convergence(plan_file=$ARGUMENTS, plan_only=true)
```

Pass source_files, doc_files, and test_command if you know them. If not, read the plan file first to find them.

### Step 2: Convergence loop

Repeat until done:

1. Call `convergence_next_task(convergence_id)` to get your task
2. Read the task:
   - **"audit"**: Read the listed files. Check each dimension listed. Report findings as JSON.
   - **"doc_align"**: Read each alignment doc listed in metadata. Verify the plan conforms to it.
   - **"execute"**: Build the checklist item (green-field). Write code, write tests, run tests. The metadata includes `checklist_item` ID and progress.
   - **"fix"**: Fix the specific finding. Run tests if test_command is provided.
   - **"test"**: Run the test command. Report pass/fail.
   - **"write"**: Write or update the specified file.
   - **"done"**: Convergence complete. Report the final status.
   - **"escalated"**: Engine stopped. Report why and what to do next.
3. Execute the task thoroughly — read files, analyze code, fix issues
4. Call `convergence_submit_result(convergence_id, findings_json)`:
   - Clean pass: `"[]"`
   - Found issues: `[{"id": "f1", "file": "path", "dimension": "correctness", "severity": "high", "description": "what's wrong", "suggested_fix": "how to fix", "fixed": true}]`
5. Go to step 1

### Step 3: Post-Execution Convergence (Mandatory)

After the engine reports "done", you MUST complete these additional steps:

1. **Documentation convergence**: Audit all docs in `docs/` against the current code. Two clean passes.
2. **Website convergence** (if project has a website): Audit site against WEBSITE_PLANNING.md. Update metrics. Two clean passes.
3. **Deployment** (if project has a website/webapp):
   - If `docs/DEPLOYMENT.md` exists: follow it to deploy
   - If `docs/DEPLOYMENT.md` does NOT exist: ask the user these questions to create one:
     - Where is this deployed? (Vercel, Cloudflare Pages, Netlify, etc.)
     - What's the deploy command or CI/CD pipeline?
     - What environment variables or secrets are needed?
     - Is there a staging environment?
     - What's the domain and DNS provider?
   - Write `docs/DEPLOYMENT.md` from the answers, then deploy
4. **Gap analysis update**: If `docs/GAPS.md` exists, re-run gap analysis. Update with new gaps or gaps closed. Verify maturity level.
5. **Frontmatter update**: Update `last_updated` in YAML frontmatter for every modified document.
6. **Patterns update**: Capture learnings in DEVELOPMENT_PATTERNS_CRUXDEV.md if novel.
7. **Inbox check**: Call `check_inbox()` to see if other sessions reported issues or improvements for this project. Handle any that apply. Acknowledge all.

### Step 4: Report

When ALL convergence steps are complete, report:
- Total rounds completed
- Total findings found and fixed
- Time elapsed
- Final phase
- Documentation convergence status
- Website convergence status (if applicable)
- Deployment status (if applicable)

## Rules

- **Do NOT decide when to stop.** The engine decides. Keep looping until task_type is "done" or "escalated".
- **Do NOT skip dimensions.** The engine tells you which dimensions to audit. Check all of them.
- **Report honestly.** If you find issues, report them. Don't mark findings as "fixed" unless you actually fixed them.
- **Two consecutive clean passes = convergence.** One clean pass is not enough.
- **If escalated, explain why** and suggest what the user should do.
