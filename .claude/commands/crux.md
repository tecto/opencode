# /crux — Universal CruxDev Entry Point

The single command for everything. Takes natural language, decomposes into the right tool sequence, and executes.

## Arguments

$ARGUMENTS = what you want to do (natural language)

## Protocol

### Step 1: Read the Command Matrix

Read `docs/COMMAND_MATRIX.md` to load the intent → tool sequence mapping.

### Step 2: Classify Intent

Match the user's request against the matrix entries. Consider:
- Keywords: "build", "fix", "improve", "create", "adjust", "align", "converge", "research", "teach", "status", "deploy", "commit", "push"
- Whether a plan file or artifact is referenced
- Whether multiple plans are referenced (group mode)
- Whether this is a question vs an action

### Step 3: Show Decomposition

ALWAYS show the exact tool sequence before executing. Be transparent:

```
DECOMPOSITION:
1. [tool_name] — description
2. [tool_name] — description
...
```

### Step 4: Execute

Call the matched command/skill:
- For /cruxdev-converge: Use the /cruxdev-converge skill
- For /cruxdev-improve: Use the /cruxdev-improve skill
- For /cruxdev-create: Use the /cruxdev-create skill
- For /cruxdev-adjust: Use the /cruxdev-adjust skill
- For /cruxdev-execute: Use the /cruxdev-execute skill
- For direct MCP tools: Call the tool directly

### Step 5: Gap Detection

If NO matrix entry matches:
1. Report the closest match
2. Ask: "No existing tool covers this. I can build one. Proceed?"
3. If yes: call /cruxdev-create to plan the new tool
4. After tool is built: retry the original request
5. Update COMMAND_MATRIX.md with the new mapping

### Step 6: Error Reporting

If any tool call fails, report in standardized format:
```json
{
  "tool_name": "...",
  "error_class": "transient|permanent|config|bug",
  "message": "...",
  "suggestion": "..."
}
```

## Rules

- ALWAYS show decomposition before executing (transparency requirement)
- ALWAYS use existing CruxDev MCP tools — NEVER access the internet directly
- ALWAYS use /cruxdev-improve, /cruxdev-create, etc. skills — NEVER do manually what a tool handles
- If tool doesn't exist for the request, that's a GAP — create it, don't work around it
- Route ALL internet access through CruxDev research tools (research_topic, etc.)

## Execution Completeness (BP160)

- **NEVER declare a plan done** unless the convergence engine returns CONVERGED status
- After each convergence_submit_result, report the `checklist_progress` to the user (completed/total, percentage)
- If `completion_blocked` is true in the response, DO NOT skip items — keep executing
- If context is running low (heuristic: > 50 tool calls in session), proactively write a handoff with remaining items
- Run `completion_audit` before declaring any plan complete to verify checked items have code
