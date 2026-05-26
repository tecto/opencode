# /cruxdev-create — Research-driven document creation from scratch

> **STOP if the artifact is a CruxDev build plan — use `/cruxdev-plan` instead.**
> `/cruxdev-plan` calls `create_plan_template(goal, project_dir)` which atomically
> allocates a BP number and pins the output path to `<project_dir>/build_plans/`.
> This skill (`create_start` / research loop / audit loop / deliver) is for
> everything else: legal, business, technical, policy, content, operational, HR.
> Composing `BUILD_PLAN_NNN_<slug>.md` paths by hand from this skill is the
> BP262-anchored trap — don't.

Create any document type (legal, business, technical, policy, content, operational, HR) through research-driven, adversarially-converged creation. Research FIRST, then draft, then audit to convergence.

## Arguments

$ARGUMENTS = description of what to create (e.g., "mutual NDA with 50/50 revenue split", "API specification for auth", "job description for senior Rust engineer")

Options (parsed from arguments):
- `--type <type>`: Override type detection (legal, business, technical, policy, content, operational, hr)
- `--quick`: 30 min, 5 research topics
- `--deep`: 2+ hours, 20+ research topics
- `--output <path>`: Where to save (default: docs/<slug>.md)
- `--requirements "<text>"`: Additional constraints
- Default: standard (1 hour, 10-15 research topics)

## Protocol

### Step 1: Start creation session

```
Call create_start(description=$ARGUMENTS, document_type=<if --type>, output_path=<if --output>, research_depth=<depth>, requirements=<if --requirements>)
```

The engine classifies the document type, loads type-specific research templates, and returns the first task (classification confirmation).

### Step 2: Creation loop

Repeat until done:

1. Read the task from the response
2. Execute the task:
   - **"classify"**: Confirm or override the document type classification. Submit `{"document_type": "legal"}` to override, or submit empty to accept.
   - **"research_planning"**: Review research topics. Submit `{"new_topics": ["topic1", "topic2"]}` to add topics, or `{"new_topics": []}` for clean pass. Two clean passes = move to research execution.
   - **"research_execute"**: Research the given topic using `research_topic` MCP tool. Submit `{"findings_file": "path/to/findings.md"}` when done.
   - **"draft"**: Create the document using all research findings. Read findings from the research_dir. Include mandatory disclaimers per type. Save to the draft_path.
   - **"audit"**: Adversarial audit of the draft. Find every gap, weakness, and missing element per the quality criteria and auditor priming. Submit `{"findings": [...]}` or `{"findings": []}`.
   - **"deliver"**: Copy converged draft to final location. Add disclaimers.
   - **"done"**: Creation complete.
   - **"escalated"**: Too many audit rounds. Report why.
3. Call `create_submit_result(session_id, result_json)` — returns next task inline

### Step 3: Report

When done, report:
- Document type and location
- Research topics covered
- Audit rounds and findings fixed
- Mandatory disclaimers included
- Final status

## Rules

- **Research FIRST.** Never draft without research. A legal agreement without research is dangerous.
- **Type-specific everything.** Legal gets different research/auditing than technical specs.
- **Mandatory disclaimers.** Legal = "not legal advice." Business = "not financial advice." Non-optional.
- **Two consecutive clean audit passes = converged.**
- **Do NOT decide when to stop.** The engine decides.
