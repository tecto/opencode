# BUILD_PLAN_002: Trim global AGENTS.md + skills XML to halve first-message system prompt

**Status**: CONVERGED (2026-05-26, convergence_id `87433de0`) — 10 audit rounds across Planning, PatternAssessment ×2, PatternOrchestration ×2, PlanAuditing ×2, DocAlignment ×2, Viability ×2. ~30 findings applied. Final two Viability passes clean from distinct agents.

## Document Alignment

- `packages/opencode/src/session/system.ts:50-77` — environment + skills assembly site (where the prompt is emitted)
- `packages/opencode/src/session/instruction.ts:14-67, 154-168` — AGENTS.md / CLAUDE.md discovery and per-file `Instructions from: <path>` prefix
- `packages/opencode/src/skill/index.ts` (`fmt` function) — skill XML emission (verbose `<location>` field is current redundancy)
- `packages/opencode/src/session/llm/request.ts:54-64` — final system-array assembly before model send
- `~/.config/opencode/AGENTS.md` — user-global instruction file (target of major edits — this single file is 47% of every first-message system prompt)
- `AGENTS.md` (this repo's root) — project instruction file (already lean — minor tightening only)
- `packages/opencode/test/session/instruction.test.ts:215-216` — hard-coded assertion targets that Step 5 must update in lockstep (added per audit da-r0 f1 — load-bearing for the BP)
- `build_plans/BUILD_PLAN_001_*.md` — prior BP, sets the numbered-plan convention this BP follows
- `packages/opencode/AGENTS.md` — BP-001 behavior section; this BP will reference it for the doc note

## Context

The first-message system prompt budget in this repo (Anthropic build agent) is **~4,549 tokens**. Prior work in commit `501d5f368` already crushed the per-provider prompts to 134 tokens each. The remaining 4,415 tokens are structural:

| Component | Tokens | % | Notes |
|---|---|---|---|
| provider prompt | 134 | 3% | already minimized |
| env block | 105 | 2% | dynamic, already lean |
| **global AGENTS.md** | **2,149** | **47%** | the single biggest line item |
| project AGENTS.md | 1,046 | 23% | lean, high bite-per-token |
| skills block | 1,085 | 24% | verbose XML, 17 skills × ~64 tokens |

This plan targets the global AGENTS.md (sections 2 and 3 are dead weight for non-Crux projects) and the skills block (`<location>` field is pure machine noise — the model never uses file:// URLs, only the skill loader does).

**Estimated savings: ~2,200-2,500 tokens per first message, ~50% reduction.**

## Phase 1: Design

- [x] **Diagnosis** (`~/.config/opencode/AGENTS.md`, 9,753 chars / 2,149 cl100k tokens; section ranges are approximate, off by ~1 line from heading positions per audit da-r0 f2):
  - Section 1 "Behavioral Guidelines" (heading at line 1, ~lines 1-58, ~500 tokens) — generic LLM hygiene; 4 bullets carry real bite, the rest restates baseline model behavior
  - Section 2 "CruxDev Pipeline Routing" (heading at line 62, ~lines 62-81, ~350 tokens) — cruxdev-project-specific; duplicates content already injected by cruxdev's own MCP server boot message; doesn't belong in a *global* AGENTS.md loaded by every opencode session
  - Section 3 "Crux Agent Framework" (heading at line 83, ~lines 83-256, ~1,300 tokens — 60% of the file) — scripts-first framework for a *specific* Crux-managed project type (`.opencode/scripts/` filesystem layout, bash script template with risk levels, build-py/build-ex modes, `log_interaction` MCP). None of these apply to opencode itself or to any non-Crux project.
  - Compressed replacement (the 4-bullet block in Step 2) measures ~123 cl100k tokens. Net savings on this file: ~2,026 tokens. All token counts are cl100k estimates (Anthropic's tokenizer is in the same ballpark, ±15%). Final convergence criterion is the **delta** measured by the Step 6 harness, not these approximations.

- [x] **Diagnosis** (`/Users/user/Documents/github/opencode/AGENTS.md`, 4,441 chars / 1,046 tokens):
  - High-density, almost entirely useful. Conventional commits format, no-`try`/`catch`, no `any`, Bun APIs, no-`else` early-returns, no-mocks, no-root-tests, Drizzle snake_case — every rule prevents a class of mistake visible in this codebase. Compression opportunity is small (~100 tokens via tightening the destructuring/variable good-bad pairs).

- [x] **Diagnosis** (skills XML in `Skill.fmt(list, {verbose: true})` at `skill/index.ts:326-351`):
  - Each of 17 skills emits a 5-line block with `<location>file:///full/abs/path</location>`. The model has no use for absolute file:// URLs — only the skill loader resolves them. The line measures ~24 cl100k tokens per skill → ~408 tokens of pure noise (originally undercounted as ~120; measured live).
  - The 2-line preamble (`"Skills provide specialized instructions..." + "Use the skill tool..."`) is also redundant with the skill tool's own description. Note: this preamble lives at `session/system.ts:71-72`, **not** in `fmt()`. The two changes hit two different files.
  - The second `Skill.fmt` caller at `tool/registry.ts:303` uses `verbose: false` and is not in the system prompt path — unaffected by this BP.

- [x] **Decision: do not switch to non-verbose skill format in this BP.** The comment at `system.ts:74-75` notes verbose was chosen for ingestion quality. Trimming the `<location>` field captures most of the savings without changing the format. A future BP could A/B verbose vs. non-verbose if more cuts are needed.

- [x] **Decision: do not delete the global AGENTS.md outright.** Keep the 4 highest-bite Behavioral Guidelines bullets in a ~80-token compressed block. This preserves the constraints that demonstrably prevent mistakes (surgical changes, don't refactor unbroken code, define success criteria, ask when uncertain) while removing the verbose restatements.

- [x] **Decision: move cruxdev routing into per-project AGENTS.md only.** This repo's `AGENTS.md` and `CLAUDE.md` already cover cruxdev usage in their own sections. Other Crux-managed projects can carry their own routing rules in their own AGENTS.md. The global file shouldn't tax opencode sessions in non-Crux projects with rules they can't act on.

- [x] **Decision: do not modify project AGENTS.md beyond minor tightening.** Compression yield is ~100-150 tokens against an already high-bite file. Lowest-priority target.

- [x] **Decision: preserve global-vs-project provenance in the instruction prefix.** Auditor f3-R0 caught that bare `# AGENTS.md` collides between the global file and the project file (both share the basename). Use scope labels instead: `# ~/.config/opencode/AGENTS.md` for any file matched against the `globalFiles` list at `instruction.ts:63-66`, `# AGENTS.md (project)` for the project-level match, and `# ${path.basename(item)} (project)` for any other project-tree match. This preserves disambiguation while still cutting most of the absolute-path bytes.

- [x] **Plugin-transform and structured-output content are out of scope.** `experimental.chat.system.transform` (`llm/request.ts:67-71`) and `STRUCTURED_OUTPUT_SYSTEM_PROMPT` (`prompt.ts:1427`) can mutate the system array but are conditional / plugin-driven. If the user's measured baseline differs across machines, the gap is likely a plugin transform. Not addressed here; flagged for the Step 6 harness to log `system.length` at the boundary.

- [x] **Backup strategy:** copy `~/.config/opencode/AGENTS.md` to *two* locations: `~/.config/opencode/AGENTS.md.pre-bp002.bak` (the local rollback target) **and** `.cruxdev/bp002-backup/global_AGENTS.md.pre-bp002.bak` (co-located with the BP audit trail). *Both backups are local-disk-only* — audit r1 f4 correctly pointed out that `.cruxdev/` is gitignored (`.gitignore:45`), so neither backup is git-traceable across machines. The fix in this BP is co-location, not git-traceability. If cross-machine recovery matters, embed the pre-edit content inline in this BP file (left out here because the file is 9,753 chars and would inflate the plan substantially; the user already has the canonical version on their dev machine). Both backup creations are conditional: skip if the global file doesn't exist (some users won't have one).

- [x] **Decision:** A/B equivalence will be human-eyeballed across 3 representative tasks in Phase 3 (refactor / debug / non-cruxdev startup). Backups remain in place for one-`cp` rollback if real-use behavior degrades over the following week of normal use. (Audit po-r0 f6 closed this Phase-1 placeholder.)

### Files touched

| File | Change |
|---|---|
| `~/.config/opencode/AGENTS.md` | rewrite to ~123-token compressed Behavioral Guidelines (4 bullets); remove CruxDev + Crux sections |
| `~/.config/opencode/AGENTS.md.pre-bp002.bak` | **new** — defensive backup of pre-edit state (skipped if global file doesn't exist) |
| `.cruxdev/bp002-backup/global_AGENTS.md.pre-bp002.bak` | **new** — second backup co-located with BP-002 audit trail (skipped if global file doesn't exist) |
| `packages/opencode/src/skill/index.ts` (`fmt`) | drop `<location>` line from verbose skill XML (preamble drop is *not* here — see system.ts row) |
| `packages/opencode/src/session/system.ts:67-77` | drop the 2-line preamble before `Skill.fmt(...)`; keep `Skill.fmt(list, { verbose: true })` call signature intact |
| `packages/opencode/src/session/instruction.ts:154-168, 213` | scope-aware prefix at `system()` (`:165`) **and** `resolve()` (`:213`); extract `labelFor` helper to module scope so both first-message and mid-session-attached instructions use the same labels (audit pl-r0 f3) |
| `packages/opencode/test/session/instruction.test.ts:215-216` | update both hard-coded `Instructions from: ${...}` assertions to match the new scope-aware labels (audit pl-r0 f1 — guaranteed test breakage otherwise) |
| `packages/opencode/AGENTS.md` | one-line behavior note appended pointing at this BP |
| (no new script) | Measurement uses a transient 5-line debug patch at `packages/opencode/src/session/llm/request.ts:64` (audit pl-r1 f1 pivot). The patch is reverted before commit; Step 14 grep-gate enforces. |

No source changes outside `packages/opencode/src/{session,skill}`. No schema changes. No new HTTP endpoints. Implementation surface is small.

## Phase 2: Implementation

- [x] **Step 1 — Backup global AGENTS.md (guarded).**

  ```bash
  if [ -f ~/.config/opencode/AGENTS.md ]; then
    cp ~/.config/opencode/AGENTS.md ~/.config/opencode/AGENTS.md.pre-bp002.bak
    mkdir -p .cruxdev/bp002-backup
    cp ~/.config/opencode/AGENTS.md .cruxdev/bp002-backup/global_AGENTS.md.pre-bp002.bak
  else
    echo "no global AGENTS.md present — skipping backup"
  fi
  ```

  If the file exists, verify both backups: `diff ~/.config/opencode/AGENTS.md ~/.config/opencode/AGENTS.md.pre-bp002.bak` and `diff ~/.config/opencode/AGENTS.md .cruxdev/bp002-backup/global_AGENTS.md.pre-bp002.bak` both return empty.

- [x] **Step 2 — Rewrite global AGENTS.md.**

  Replace entire file contents with the compressed version below. Preserves the 4 highest-bite behavioral rules and drops the two project-specific frameworks entirely.

  ```markdown
  # Behavioral Guidelines

  - **Surgical edits only.** Touch only what the task requires. Don't refactor adjacent code or comments. Match existing style.
  - **Simplicity first.** Minimum code that solves the problem. No unrequested abstractions, configurability, or error handling for impossible cases.
  - **Verify, don't assume.** Define success criteria before coding. For multi-step tasks state a brief verifiable plan, then loop until each step's check passes.
  - **Ask when uncertain.** If a request has multiple interpretations or hidden tradeoffs, surface them — don't pick silently.
  ```

  Total: ~123 cl100k tokens for the compressed block. Down from the file's 2,149 — net savings on this file is ~2,026 tokens.

- [x] **Step 3 — Tighten skill XML emission in `packages/opencode/src/skill/index.ts`.**

  Current `fmt(list, { verbose: true })` emits per-skill:

  ```
    <skill>
      <name>NAME</name>
      <description>DESCRIPTION</description>
      <location>file:///FULL/ABSOLUTE/PATH</location>
    </skill>
  ```

  Drop the `<location>` line entirely. The model has no use for it — only the skill loader (which has the `list` in memory already) resolves locations. Measured ~24 cl100k tokens/skill × 17 skills ≈ ~408 tokens (audit-bp002-pa-r0 corrected an earlier ~120-token undercount).

  Resulting per-skill block:

  ```
    <skill>
      <name>NAME</name>
      <description>DESCRIPTION</description>
    </skill>
  ```

- [x] **Step 4 — Drop redundant skills preamble in `packages/opencode/src/session/system.ts:71-76`.**

  Current emission:

  ```ts
  return [
    "Skills provide specialized instructions and workflows for specific tasks.",
    "Use the skill tool to load a skill when a task matches its description.",
    Skill.fmt(list, { verbose: true }),
  ].join("\n")
  ```

  The first two lines duplicate the skill tool's own description (which the model receives with the tool definition). Drop them; return `Skill.fmt(list, { verbose: true })` alone (the call signature is unchanged — both args still required). Saves ~50 tokens.

- [x] **Step 5 — Tighten instruction prefix in `packages/opencode/src/session/instruction.ts` while preserving global-vs-project AND inter-project disambiguation.**

  Current at `:165`:

  ```ts
  ...Array.from(paths).flatMap((item, i) => (files[i] ? [`Instructions from: ${item}\n${files[i]}`] : [])),
  ```

  Two collision risks (both from audit-bp002-pa, r0 f3 and r1 f1):
  1. Global vs. project AGENTS.md share the basename `AGENTS.md`.
  2. **In a monorepo, `systemPaths()` adds ALL findUp matches** (`instruction.ts:128` uses `matches.forEach(...)` — verified by audit r1 reading `core/filesystem.ts:127-139` `findUp` returns the full upward chain). Working from `packages/opencode/`, both `packages/opencode/AGENTS.md` AND the root `AGENTS.md` load — would collide on `# AGENTS.md (project)` if we used bare basename.

  Use scope-aware labels with **resolved-path comparison** for the global check (so XDG/OPENCODE_CONFIG_DIR/symlinks don't slip through) and a **worktree-relative path** for project files (so per-package AGENTS.md disambiguates from root AGENTS.md):

  ```ts
  const resolvedGlobalFiles = globalFiles.map((f) => path.resolve(f))
  const labelFor = (item: string, worktree: string) => {
    const real = path.resolve(item)
    if (resolvedGlobalFiles.includes(real)) {
      return `# ${real.replace(global.home, "~")}`
    }
    const rel = path.relative(worktree, real)
    // path.relative returns "" when item === worktree; basename fallback handles that edge case
    return `# ${rel || path.basename(real)} (project)`
  }
  ...Array.from(paths).flatMap((item, i) => {
    if (!files[i]) return []
    return [`${labelFor(item, ctx.worktree)}\n${files[i]}`]
  }),
  ```

  Worktree-relative requires `ctx` from `InstanceState.context`. The `system()` Effect at `:154` doesn't currently fetch it; add `const ctx = yield* InstanceState.context` near the top (cheap, already in scope of every other helper in this file).

  **Non-git worktree edge case** (audit pl-r0 f4): `project.ts:237` sets `worktree === "/"` for projects with `id === 'global'` and no VCS. `path.relative('/', '/Users/x/AGENTS.md')` yields `Users/x/AGENTS.md` — still leaks the absolute path. Guard `labelFor` with: if `worktree === '/' || worktree === ''`, treat as global-style and substitute `global.home → '~'` instead of computing `path.relative`.

  **Reuse in `resolve()`** (audit pl-r0 f3): extract `labelFor` to module scope (above `system()`) and reuse at `:213` so mid-session-attached instructions emit the same labels as first-message ones — no stylistic split between session-start and runtime attachment.

  **`resolve()` needs `ctx.worktree` explicitly** (audit pl-r1 f2): the existing local at `:213` is `root = path.resolve(yield* InstanceState.directory)` (= `ctx.directory`, not `ctx.worktree`). When calling `labelFor`, fetch `const ctx = yield* InstanceState.context` near the top of `resolve()` and pass `ctx.worktree` — passing `root` would silently use directory-as-worktree and produce label drift between first-message and runtime-attachment paths.

  Labels become:
  - Global: `# ~/.config/opencode/AGENTS.md`
  - Root project: `# AGENTS.md (project)`
  - Per-package: `# packages/opencode/AGENTS.md (project)` — distinguishable from root
  - Non-git fallback: `# ~/<rel-from-home>/AGENTS.md (project)` (no '/'-rooted leakage)

  **Test update** (audit pl-r0 f1, blocker; pl-r1 f3 expected-string note): `packages/opencode/test/session/instruction.test.ts:215-216` currently asserts the literal `Instructions from: ${path.join(...)}\n...` prefix. The test fixture (`provideInstance(projectTmp)`) creates a non-git tmp dir, which sets `worktree === "/"` per `project.ts:237`. Under that worktree, `labelFor`'s "/" guard fires for both files and BOTH go through the `global.home → "~"` substitution. Expected new assertions (substitute `globalTmp` / `projectTmp` paths after the home substitution):

  ```ts
  expect(rules[0]).toBe(`# ${path.relative(global.home, globalTmp).replace(/^/, "~/")}/AGENTS.md\n# Global Instructions`)
  expect(rules[1]).toBe(`# ${path.relative(global.home, projectTmp).replace(/^/, "~/")}/AGENTS.md\n# Project Instructions`)
  ```

  If labelFor outputs differ (e.g. test fixture uses an absolute home-substituted path directly), update to match — the principle is "match labelFor's actual output for the fixture's worktree-and-home values." A `console.log(rules)` insert during the first test run will show the literal value to assert against. Step 8 (`bun test`) gates this; if the assertions are wrong, the test fails fast and the executor iterates.

  Preserves provenance the model occasionally references ("per global rules" vs "per project rules" vs "per package rules") while dropping the absolute-path noise. Saves ~25-40 tokens per loaded file × 2-3 files ≈ ~50-120 tokens.

<!-- Step 6 (measurement harness) and Step 7 (doc note) moved to Phase 3 per audit po-r0 f1 + f2 — they are verification tooling and post-measurement documentation, not behavior changes. -->

(Phase 2 ends with Step 5. Measurement harness and the AGENTS.md note live in Phase 3 because they depend on the measured outcome rather than producing one.)

## Phase 3: Integration & Polish

Numbering continues monotonically from Phase 2's Step 5. Order is fail-fast: typecheck/tests before manual TUI work, harness-dependent verification immediately after the harness run.

- [x] **Step 6 — Measurement via transient debug instrumentation.** **Required** (audit po-r0 f4 — convergence criterion #1 depends on it).

  Audit pl-r1 f1 ruled out two earlier approaches: composing 8+ Effect layers in a standalone script (too complex), and reading `~/.local/share/opencode/log/` (only error-path requests log the system body). The actually-feasible approach is a **transient debug log** at the system-prompt assembly site, captured during one real opencode session and reverted before commit.

  1. Apply this temporary patch at `packages/opencode/src/session/llm/request.ts` immediately after `system[0]` is finalized (around `:64`):

     ```ts
     // BP-002 TEMP — REVERT BEFORE COMMIT
     if (process.env.OPENCODE_DEBUG_SYSTEM === "1") {
       const fs = await import("node:fs/promises")
       await fs.writeFile(
         `/tmp/bp002-system-${Date.now()}.json`,
         JSON.stringify({ system, len: system.map((s) => s.length) }, null, 2),
       )
     }
     // END BP-002 TEMP
     ```

  2. Run a real opencode session: `OPENCODE_DEBUG_SYSTEM=1 opencode` → start TUI from inside `packages/opencode/`, type one message, exit.

  3. Read the dumped file `/tmp/bp002-system-<ts>.json`. Sum character lengths; divide by 3.8 for an Anthropic-tokenizer approximation. For cl100k precision, pipe through `python3 -c "import tiktoken; enc = tiktoken.get_encoding('cl100k_base'); import sys, json; d = json.load(sys.stdin); print(sum(len(enc.encode(s)) for s in d['system']))"` if available.

  4. Record both numbers (char/3.8 estimate AND cl100k if measurable) in the BP-002 audit trail.

  5. **Revert the temporary patch** at request.ts:64 before Step 14's commit. Add a sanity check to Step 14: `! grep -q 'BP-002 TEMP' packages/opencode/src/session/llm/request.ts` before `git add`.

  This approach trades a 5-line transient patch + revert for the simplicity of measuring against the actual production code path. Auto-captures plugin-injected content (audit pa-r0 f5 — the patched site is downstream of all transforms).
- [x] **Step 7 — `bun turbo typecheck` passes.** Fail-fast: any type error in Steps 2-5 surfaces here before we waste manual time.
- [x] **Step 8 — `bun test packages/opencode/test/` passes.** No regressions in the prompt assembly path.
- [x] **Step 9 — Run the harness from Step 6; record the new token total.** Convergence criterion: delta ≥ 1,500 tokens from the 4,549-token baseline.
- [x] **Step 10 — Verify Step 5's scope-aware labels** (audit po-r0 f3): start opencode TUI in `packages/opencode/`; inspect the first-message system prompt via Step 9's harness output and confirm three distinct label forms appear — `# ~/.config/opencode/AGENTS.md`, `# AGENTS.md (project)`, AND `# packages/opencode/AGENTS.md (project)`. If only two appear (collision), Step 5 has regressed. (Scheduled immediately after the harness run because it consumes harness output.)
- [x] **Step 11 — Manual A/B verifications** (acknowledged weak signal per Risk 7; backups are ready for one-`cp` rollback):
  - Refactor task ("split this function and remove unused imports"): confirm the surgical-edits-only constraint still lands
  - Debug task ("this test fails, why"): confirm goal-driven execution + ask-when-uncertain behavior is unchanged
  - Non-cruxdev directory (`cd /tmp/scratch && opencode`): confirm no Crux routing rules surface in the system prompt
  - `/skills` listing: confirm all skills appear with correct names and descriptions (Step 3 only dropped `<location>`, not the skill)
- [x] **Step 12 — Diff backups.**
  - `diff ~/.config/opencode/AGENTS.md ~/.config/opencode/AGENTS.md.pre-bp002.bak` shows only the intended rewrite
  - `.cruxdev/bp002-backup/global_AGENTS.md.pre-bp002.bak` exists and matches `~/.config/opencode/AGENTS.md.pre-bp002.bak` (or both absent if Step 1's guard skipped them; audit po-r0 f5)
- [x] **Step 13 — Append behavior note to `packages/opencode/AGENTS.md`** using the *measured* delta from Step 9. **Substitution responsibility** (audit po-r1 f1): replace `{{measured}}` with the harness-reported new total, and `{{delta}}` with `4549 - {{measured}}`. Template:

  > **System prompt budget (BP-002).** The first-message system prompt was reduced from ~4,549 to ~{{measured}} tokens (delta ≈ {{delta}}) by trimming the global `~/.config/opencode/AGENTS.md` (kept 4 high-bite behavioral rules; removed Crux-framework + cruxdev-routing sections), dropping the verbose-XML `<location>` field from skill emission, dropping the redundant skills preamble, and shortening the `Instructions from:` prefix to a scope-aware label (`# ~/<rel-path>` for global, `# <worktree-relative-path> (project)` for project files). See `build_plans/BUILD_PLAN_002_*.md` for the audit trail. Project AGENTS.md content is unchanged; project-specific rules still apply.
- [ ] **Step 14 — Commit** (audit po-r0 f7): explicitly stage the following six files; do NOT use `git add -A`:
  ```bash
  # Sanity check: confirm the transient debug instrumentation from Step 6 was reverted.
  ! grep -q 'BP-002 TEMP' packages/opencode/src/session/llm/request.ts \
    || { echo "ERROR: Step 6 debug patch still in request.ts — revert before commit"; exit 1; }

  git add packages/opencode/src/skill/index.ts \
          packages/opencode/src/session/system.ts \
          packages/opencode/src/session/instruction.ts \
          packages/opencode/test/session/instruction.test.ts \
          packages/opencode/AGENTS.md \
          build_plans/BUILD_PLAN_002_TRIM_GLOBAL_AGENTS_AND_SKILLS_XML.md
  ```
  Explicitly NOT staged: `~/.config/opencode/AGENTS.md` (outside the repo), `.cruxdev/bp002-backup/` (gitignored — both backups are local-disk-only by design), and `packages/opencode/src/session/llm/request.ts` (the Step 6 debug patch must be reverted, not committed). The test file is included because Step 5 changes assertions it hard-codes (audit pl-r0 f1). The measurement harness file was removed from the staged list because the Step 6 pivot to transient instrumentation means no new script gets created — measurement happens via the temporary patch + revert.

## Convergence Criteria

- First-message system prompt budget drops by **delta ≥ 1,500 tokens** measured in cl100k from the 4,549-token baseline (target delta ≈ 2,200; resulting prompt size ≤ ~3,050). Anthropic's tokenizer disagrees with cl100k by ±15%, so the real-world Anthropic-tokenizer delta could be 1,275–1,725 if the measured cl100k delta is exactly 1,500 — the convergence criterion is the *cl100k* measurement, not the Anthropic estimate (audit pl-r0 f5, f6).
- Manual A/B comparison shows no behavioral regression on the 3 verification tasks above
- `bun turbo typecheck` clean
- All `packages/opencode/test/` pass
- Backup of pre-edit global AGENTS.md exists at the documented path
- Two consecutive clean audit passes from distinct agents on this plan

## Test Command

```bash
bun test packages/opencode/test/
bun turbo typecheck
```

(Root `bun test` intentionally errors per `package.json:21` — always scope tests to a package.)

## Risks

1. **Removed Crux Agent Framework content could break workflows in other Crux-managed projects.** Mitigation: backup at `~/.config/opencode/AGENTS.md.pre-bp002.bak` is preserved; the framework content can be copied into per-project AGENTS.md files in any project that needs it. The global file should not be a dumping ground for project-specific rules.
2. **Skill `<location>` removal could break the skill loader if anything actually parses the system prompt for locations.** Mitigation: the skill loader resolves from the in-memory `list` (which has `skill.location` as a struct field), not from the emitted XML. Verified by reading `Skill.fmt` — `<location>` is emit-only, not parsed back. Tested by Phase 3 manual verification of the `/skills` listing.
3. **`Instructions from: <path>` → `# <basename>` could lose provenance info models occasionally reference.** Mitigation: basename preserves the meaningful part (which file). Absolute path was rarely useful for the model and was largely a debugging artifact.
4. **The 4 retained Behavioral Guidelines may be insufficient to prevent some mistakes that the verbose version caught.** Mitigation: keep the backup; if behavioral regressions show up in real use, the original is one `cp` away. Phase 3 manual verification covers the most common regression surfaces.
5. **Skill preamble removal could degrade the model's understanding of when to invoke the skill tool.** Mitigation: the skill tool's own description (sent with the tool definition) already explains skill semantics. The two preamble lines are redundant. If a regression appears, restoring the preamble is one-line.
6. **A/B verification is manual, not automated.** A future BP could add programmatic equivalence testing, but this BP keeps scope focused on the size reduction.
7. **3-task A/B is weak signal.** Auditor f8-R0 noted that 3 representative tasks won't catch behavioral regressions like "the model becomes less cautious about hidden tradeoffs," which would surface only over many sessions. Mitigation: phrase the convergence criterion as "no obvious regression in spot-check tasks; the backups remain in place for rollback if real-use behavior degrades over the following week of normal use." Roll back is one `cp` of the `.bak` file back into place.
8. **Plugin-injected system content out of measurement scope.** `experimental.chat.system.transform` plugins (if any installed) can add to the system array after this BP's edits. If a measured baseline differs across machines, log `system.length` at `llm/request.ts:64-65` to identify plugin-driven content. This BP does not modify plugin behavior.
9. **~~Basename collision risk~~** *(audit r1 f1 superseded this risk)*: `systemPaths()` actually loads **all** project AGENTS.md found walking up from cwd (`instruction.ts:128` calls `matches.forEach(paths.add(...))`, and `core/filesystem.ts:127-139` `findUp` returns the full upward chain). In this monorepo, a session from `packages/opencode/` loads both `packages/opencode/AGENTS.md` *and* root `AGENTS.md`. The original "basename (project)" label would have collided. **Step 5's revised implementation uses `path.relative(ctx.worktree, item)` for project files**, so they emit as `# packages/opencode/AGENTS.md (project)` vs `# AGENTS.md (project)` — disambiguated.
10. **`worktree === "/"` non-git edge case** (audit pl-r0 f4): `project.ts:237` returns `"/"` as the worktree for global non-VCS projects. Naive `path.relative("/", "/Users/x/AGENTS.md")` yields `Users/x/AGENTS.md` — still leaks the abs path. Step 5's `labelFor` guards this case by treating `"/"` / `""` worktrees as global-style and applying the `global.home → '~'` substitution instead.
11. **Mid-session attachment vs first-message label drift** (audit pl-r0 f3): `instruction.ts:213` (the `resolve()` path used for runtime attachment of nearby AGENTS.md when reading source files) currently uses the old `Instructions from:` prefix. Step 5 extracts `labelFor` to module scope and reuses it at `:213` so first-message and mid-session attachments emit identical label styles.
12. **Hard-coded test assertions** (audit pl-r0 f1, blocker): `packages/opencode/test/session/instruction.test.ts:215-216` will break the moment Step 5 lands. Step 5 explicitly includes the test-file update; Step 14 git-add includes the test file. Step 8 (`bun test`) is the fail-fast gate.
13. **Tokenizer uncertainty in convergence criterion** (audit pl-r0 f5, f6): convergence floor is measured in cl100k (~±15% disagreement with Anthropic's tokenizer). Documented as the official measurement basis; real-world Anthropic delta may differ.
14. **Step 6 measurement depends on transient instrumentation patch being reverted** (audit pl-r1 f1, f4): the harness writes a 5-line debug log to `request.ts:64` that MUST be removed before commit. Step 14 includes a sanity grep (`! grep -q 'BP-002 TEMP' ...`) to catch a missed revert. If the executor commits the patch by accident, every opencode run leaks a `/tmp/bp002-system-*.json` file. Mitigation: explicit revert sub-step in Step 6, sanity check in Step 14, and the 'BP-002 TEMP' marker comment is grep-friendly.

## Out of scope

- Provider prompt changes (already minimized in commit 501d5f368).
- Tool definitions (sent as `tools` parameter, not in the system array — separate optimization surface, likely 2-5K tokens of opportunity but different audit).
- Per-package AGENTS.md (loaded only when working in that package; not part of root sessions).
- A/B testing infrastructure (out of scope for this BP; defer to a future "system prompt regression tests" plan).
- Variant cycling and other TUI behaviors (untouched).
- Migration of removed Crux content into a separate project repo (the user can do this manually with the backup if desired).
