# /cruxdev-improve — Research-driven improvement of any artifact

Improve any artifact (build plan, pattern doc, report, code, etc.) through research-driven, adversarially-converged improvement. Research FIRST, then improve, then audit.

## Arguments

$ARGUMENTS = the target artifact (e.g., BP120, docs/FORM_PATTERNS.md, src/engine/improve.py)

Options (parsed from arguments):
- `--quick`: 30 min, 5 research topics
- `--deep`: 6 hours, 30 research topics
- `--resume <session_id>`: Resume an existing improvement session
- `--skip-research`: Skip research phase, go straight to building
- Default: standard (2 hours, 15 research topics)

## Protocol

### Step 1: Start improvement session

```
Call improve_start(target=$ARGUMENTS, depth="standard")
```

Parse depth from arguments if provided. The engine detects the artifact type automatically.

### Step 2: Improvement loop

Repeat until done:

1. Read the task from the response
2. Execute the task based on type:
   - **"research_plan"**: Read the target artifact. Generate a comprehensive list of research topics that would help improve it. Submit as: `{"topics": [{"name": "...", "relevance": "...", "search_queries": ["..."], "expected_improvement": "..."}]}`
   - **"research_plan_audit"**: Review the current topic list. Find missing topics. Submit as: `{"new_topics": [...]}` or `{"new_topics": []}` if complete.
   - **"research_topic"**: Use the `research_topic` MCP tool to research this topic. Run the full research loop (web searches, verify sources, counter research). Save findings to the specified path. Submit as: `{"topic_index": N, "findings_path": "path/to/findings.md"}`
   - **"build_improvement"**: Read the original artifact AND all research findings. Create an improved version. For each improvement, cite which research finding drove it. Submit as: `{}` when done.
   - **"audit_improvement"**: Adversarially audit the improved version. Find every missed improvement, gap, and problem. Submit as: `{"findings": [...]}` or `{"findings": []}` if clean.
   - **"deliver"**: Show the diff between original and improved. Ask the user for approval. Submit as: `{"approved": true}` or `{"approved": false}`.
   - **"done"**: Improvement complete. Report results.
   - **"escalated"**: Engine stopped. Report why.
3. Call `improve_submit_result(session_id, result_json)` with the appropriate result
4. The response contains the next task — go to step 2

### Step 3: Report

When done, report:
- Research topics investigated
- Improvements applied (with citations)
- Audit rounds completed
- Total findings resolved
- Final status

## Rules

- **Research FIRST.** Do not skip the research phase unless --skip-research is specified. Improvement without research is just LLM pattern completion.
- **Cite research.** Every improvement must trace to a research finding. This prevents hallucination-as-improvement.
- **Do NOT decide when to stop.** The engine decides convergence. Keep looping.
- **Independent auditors.** For audit_improvement tasks, spawn a separate agent — do not audit your own work.
- **Two consecutive clean audit passes = converged.** The engine handles this.
