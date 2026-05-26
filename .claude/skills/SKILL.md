---
name: research
description: "Run 5-pass iterative deepening research on any topic to convergence. Use when the user asks to research, investigate, or deeply analyze a topic. Calls research_topic, research_status, verify_research_sources, and counter_research MCP tools."
---

# /research — 5-Pass Research to Convergence

## Arguments

$ARGUMENTS = topic to research

## Protocol

### Step 1: Start research session

Call `research_topic(topic, sub_questions)` with the topic and 5-10 sub-questions.

### Step 2: Execute 5 passes

Per RESEARCH_PATTERNS.md:
1. **Pass 1 (Broad):** 5-8 searches establishing landscape
2. **Pass 2 (Academic):** Authoritative sources with data
3. **Pass 3 (Practitioner):** Real-world case studies
4. **Pass 4 (Contrarian):** Counter-evidence, criticism
5. **Pass 5 (Primary):** Official specs, documentation

### Step 3: Verify sources

Call `verify_research_sources(finding_id, source_urls)` for key findings.

### Step 4: Adversarial verification

Call `counter_research(claim, counter_evidence, alternative_explanations)` for critical claims.

### Step 5: Check convergence

Call `research_status(session_id)`. Research converges when:
- All sub-questions have ≥3 unique sources
- Novelty < 10% over last 5 searches
- No unresolved contradictions

### Step 6: Report

Synthesize findings into a structured report with sources, confidence levels, and contradictions.
