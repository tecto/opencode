# /cruxdev-teach — Research-driven progressive teaching

Point at a project, folder, or topic. CruxDev decomposes it across 12 axes, researches to convergence, builds a knowledge base, then teaches progressively with audience adaptation.

## Arguments

$ARGUMENTS = target (project path, folder path, or topic name)

## Protocol

### Step 1: Start teaching session

```
Call teach_start(target=$ARGUMENTS)
```

The engine auto-detects whether the target is a project (has Cargo.toml/package.json), folder, or topic.

### Step 2: Analysis phase (12 axes)

The engine walks through 12 decomposition axes:
1. Architecture 2. Philosophy 3. Features 4. Workflow 5. Ethics 6. Morals
7. Psychology 8. Business Model 9. Competitive Position 10. Technical Debt
11. Security Posture 12. Developer Experience

For each axis, analyze the target and submit findings via `teach_submit(session_id, result_json)`.

### Step 3: Research phase

Use `research_topic` to research the topic and related subjects to convergence. Submit each research result.

### Step 4: Curriculum + Assessment

The engine builds a progressive curriculum (Bloom's taxonomy: Remember → Create).
It then assesses the learner's expertise level through diagnostic questions.

### Step 5: Teaching loop

Repeat until curriculum complete:
1. **TEACH** — Explain the current lesson at the learner's level
2. **VERIFY** — Ask a question to check understanding
3. **ADAPT** — If mastery < 60%, reteach. If >= 80%, advance.

### Step 6: Status

Call `teach_status(session_id)` anytime for progress.

## Rules

- **Decompose FIRST.** Never teach without understanding the full picture.
- **Research to convergence.** Surface-level teaching produces surface-level understanding.
- **Adapt to the learner.** Beginner gets analogies. Expert gets implementation details.
- **Verify understanding.** Don't assume teaching = learning.
