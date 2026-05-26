# BUILD_PLAN_001: Save TUI model selection to project opencode config

## Document Alignment

- `packages/opencode/AGENTS.md` — package-level conventions; one-paragraph behavior note will be appended here in Phase 3
- `specs/v2/instructions.md` — instruction/config handling spec
- `specs/v2/provider-model.md` — provider/model abstraction
- `.cruxdev/intake-classification.md` — adoption classification (software-existing, maturity 3→4)

## Context

When opencode runs inside a project (a project-level `opencode.jsonc` / `opencode.json` or `.opencode/` directory is detected by walking up from cwd, stopping at the git worktree boundary), persist per-agent model selections made in the TUI to that project config file. When `OPENCODE_CONFIG_DIR` is set, write there (matches read precedence). When no project context exists, scaffold `.opencode/opencode.json` at the worktree root (or cwd if no worktree). The existing `OPENCODE_DISABLE_PROJECT_CONFIG` flag remains the escape hatch to keep current user-state-only behavior.

Recent commits `ec0637f4d` and `53b927b6b` added per-agent persistence + save-on-change but only to the user state dir (`Global.Path.state/model.json`). This plan extends that to project config.

## Phase 1: Design

- [x] **Default behavior**: default-on whenever project config is detected or scaffoldable; `OPENCODE_DISABLE_PROJECT_CONFIG=1` disables.
- [x] **Write target precedence** (matches read precedence verified at `packages/opencode/src/config/config.ts:603–605` using `remeda.mergeDeep`):
  1. `OPENCODE_DISABLE_PROJECT_CONFIG` set → user mode
  2. `OPENCODE_CONFIG_DIR` set → write to `${OPENCODE_CONFIG_DIR}/opencode.json` (create if missing)
  3. Innermost existing `opencode.jsonc` between cwd and worktree
  4. Innermost existing `opencode.json` between cwd and worktree
  5. Innermost existing `.opencode/` dir → use/create `.opencode/opencode.json` inside it
  6. Scaffold `.opencode/opencode.json` at worktree root (else cwd)
- [x] **Schema**: existing `agent.<name>.model` field at `packages/opencode/src/config/agent.ts:23` already supports `Schema.optional(ConfigModelID)`. No schema change.
- [x] **What persists**: only `agent.<name>.model` goes to project config. `recent` / `favorite` / `variant` stay in user state (`Global.Path.state/model.json`) — they are user preferences, not project preferences.
- [x] **Comment preservation**: `jsonc-parser`'s `modify()` + `applyEdits()` for in-place edits (already imported at `config/config.ts:13`, parse-only today).
- [x] **Atomicity**: write to `<path>.tmp`, then `rename()`. Avoids corrupting tracked files.
- [x] **Failure mode**: on project-write failure, toast a warning + fall back to writing the model into user state for that save so the selection isn't lost.
- [x] **Model string format**: `"${providerID}/${modelID}"` (confirmed at `config/config.ts:465`). `ConfigModelID` is `Schema.String` — convention not enforced by schema.
- [x] **Scaffold UX**: one-shot info toast on first scaffold naming the created path; state flag `scaffoldToastShown` prevents repeat.
- [ ] **Verify `AppFileSystem.up()` directionality** — `paths.ts:20` calls `.toReversed()` on `up()` results, implying `up()` returns closest-to-`start` first. Read once to confirm before picking the right index in `resolveModelWriteTarget()`.
- [ ] **Verify `Flag.OPENCODE_CONFIG_DIR` evaluation timing** — env var per call vs cached at startup. Resolution must be consistent with read-side consumption.
- [ ] **Verify config-sync reload after write** — if `sync.data.config` doesn't auto-refresh on file change, may need to trigger refresh after `writeAgentModels()` so the TUI sees its own write through the existing `currentModel` fallback chain at `local.tsx:209–218`.

### Files touched

| File | Change |
|---|---|
| `packages/opencode/src/config/paths.ts` | + `resolveModelWriteTarget()` |
| `packages/opencode/src/config/project-write.ts` | **new** — `writeAgentModels()` helper |
| `packages/opencode/src/cli/cmd/tui/context/local.tsx` | rewrite `save()` (lines 138–154); consume project context |
| `packages/opencode/src/cli/cmd/tui/context/project.tsx` (new, optional) | expose write target if not already in `useSDK()` |
| `packages/opencode/test/config/model-persistence.test.ts` | **new** tests |
| `packages/opencode/AGENTS.md` | one-paragraph behavior note |

No schema change. No breaking change to user state file shape.

## Phase 2: Implementation

- [ ] **Step 1 — `resolveModelWriteTarget()` in `packages/opencode/src/config/paths.ts`**

  ```ts
  export const resolveModelWriteTarget = Effect.fn("ConfigPaths.resolveModelWriteTarget")(
    function* (directory: string, worktree?: string) {
      if (Flag.OPENCODE_DISABLE_PROJECT_CONFIG) return { mode: "user" as const }
      if (Flag.OPENCODE_CONFIG_DIR) {
        return { mode: "project" as const, path: path.join(Flag.OPENCODE_CONFIG_DIR, "opencode.json"), source: "OPENCODE_CONFIG_DIR" as const }
      }
      const found = yield* files("opencode", directory, worktree)
      if (found.length) return { mode: "project" as const, path: found[found.length - 1], source: "existing_file" as const }
      const afs = yield* AppFileSystem.Service
      const dotOpencode = yield* afs.up({ targets: [".opencode"], start: directory, stop: worktree })
      if (dotOpencode.length) {
        return { mode: "project" as const, path: path.join(dotOpencode[0], "opencode.json"), source: "existing_dot_opencode" as const }
      }
      const root = worktree ?? directory
      return { mode: "project" as const, path: path.join(root, ".opencode", "opencode.json"), source: "scaffolded" as const }
    },
  )
  ```

  `source` is for tests, telemetry, and the scaffold toast.

- [ ] **Step 2 — `writeAgentModels()` helper in new `packages/opencode/src/config/project-write.ts`**

  ```ts
  import { modify, applyEdits } from "jsonc-parser"
  import * as fs from "node:fs/promises"
  import { existsSync } from "node:fs"
  import path from "node:path"

  export async function writeAgentModels(
    filePath: string,
    models: Record<string, { providerID: string; modelID: string }>,
  ) {
    const text = existsSync(filePath) ? await fs.readFile(filePath, "utf-8") : "{}"
    let edited = text
    for (const [agentName, model] of Object.entries(models)) {
      const value = `${model.providerID}/${model.modelID}`
      const edits = modify(edited, ["agent", agentName, "model"], value, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      })
      edited = applyEdits(edited, edits)
    }
    const tmp = `${filePath}.tmp`
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(tmp, edited)
    await fs.rename(tmp, filePath)
  }
  ```

- [ ] **Step 3 — Thread project context into TUI local context**

  `local.tsx` currently uses only `Global.Path.state`. Need `directory` (and optionally `worktree`) from `InstanceContext` (`packages/opencode/src/project/instance-context.ts`). First check `useSDK()` for `directory`. If absent, add `packages/opencode/src/cli/cmd/tui/context/project.tsx` that exposes the resolved write target, computed once at TUI bootstrap.

- [ ] **Step 4 — Rewrite `save()` in `local.tsx` (lines 138–154)**

  ```ts
  function save() {
    if (!modelStore.ready) { state.pending = true; return }
    state.pending = false

    const userPayload = {
      model: writeTarget.mode === "user" ? modelStore.model : {},
      recent: modelStore.recent,
      favorite: modelStore.favorite,
      variant: modelStore.variant,
    }

    try {
      writeFileSync(userStatePath, JSON.stringify(userPayload, null, 2))
    } catch (e) { console.error("save model failed (user state)", e) }

    if (writeTarget.mode === "project") {
      const isScaffolding = writeTarget.source === "scaffolded" && !existsSync(writeTarget.path)
      writeAgentModels(writeTarget.path, modelStore.model)
        .then(() => {
          if (isScaffolding && !state.scaffoldToastShown) {
            state.scaffoldToastShown = true
            toast.show({
              variant: "info",
              message: `Created ${path.relative(process.cwd(), writeTarget.path)} for project model config`,
              duration: 4000,
            })
          }
        })
        .catch((e) => {
          console.error("save model failed (project config)", e)
          toast.show({
            variant: "warning",
            message: "Couldn't write model to project config — saved to user state",
            duration: 4000,
          })
          try {
            writeFileSync(userStatePath, JSON.stringify({ ...userPayload, model: modelStore.model }, null, 2))
          } catch {}
        })
    }
  }
  ```

  `state` becomes `{ pending: false, scaffoldToastShown: false }`. All existing `save()` call sites (`local.tsx:262, 297, 320, 343, 372`) unchanged.

- [ ] **Step 5 — Verify load path requires no change**

  `local.tsx:156–167` hydrates from user state. `currentModel` memo at `local.tsx:209–218` already chains `modelStore.model[a.name]` → `a.model` (from `sync.data.config.agent.<name>.model`) → fallback. Project-config writes propagate via existing config sync. Confirm sync re-reads on file change; if not, trigger refresh after `writeAgentModels()` returns.

- [ ] **Step 6 — Write tests at `packages/opencode/test/config/model-persistence.test.ts`** (one per branch of `resolveModelWriteTarget()`):

  - `OPENCODE_DISABLE_PROJECT_CONFIG=1` → `mode: user`, no project file touched
  - `OPENCODE_CONFIG_DIR=/tmp/x` (empty dir) → writes to `/tmp/x/opencode.json`, creates dir
  - `OPENCODE_CONFIG_DIR=/tmp/x` (existing `opencode.json` with comments) → modifies in place, comments preserved
  - Cwd in project with `.opencode/opencode.jsonc` containing comments → preserves comments, updates `agent.build.model`
  - Cwd in project with bare root `opencode.json` → updates `agent.<name>.model`
  - Both root `opencode.jsonc` and nested `subdir/opencode.json`; cwd `subdir/` → writes to nested (innermost wins)
  - `.opencode/`-only project (no config file) → creates `.opencode/opencode.json`
  - Git repo with no opencode config and no `.opencode/` → scaffolds at worktree root; one-shot info toast fires
  - Non-git dir with no opencode config → scaffolds at cwd
  - Read-only project config (chmod 0o555) → warning toast, user state contains model as fallback
  - Concurrent rapid `save()` calls → final state reflects last; no `.tmp` files leftover

  Reference: `packages/opencode/test/config/tui.test.ts` for test patterns (`os.tmpdir()` setup, etc.).

## Phase 3: Integration & Polish

- [ ] Manual verification — existing-file preservation (in this repo, `.opencode/opencode.jsonc` already exists)
- [ ] Manual verification — scaffold path: fresh git repo at `/tmp/fresh-repo`, run TUI, confirm scaffold + info toast
- [ ] Manual verification — `OPENCODE_CONFIG_DIR=/tmp/oc-override` overrides project write target
- [ ] Manual verification — `OPENCODE_DISABLE_PROJECT_CONFIG=1` skips project write entirely
- [ ] `bun test packages/opencode/test/config/model-persistence.test.ts` passes
- [ ] `bun turbo typecheck` passes
- [ ] Append one-paragraph behavior note to `packages/opencode/AGENTS.md` describing project-config persistence + escape hatch
- [ ] Confirm scaffold toast does not repeat across multiple model changes in one session
- [ ] Confirm `jsonc-parser` produces clean diffs on the project's actual `.opencode/opencode.jsonc` (visual inspection)

## Convergence Criteria

- All new tests pass (`bun test packages/opencode/test/config/model-persistence.test.ts`)
- Existing tests still pass (`bun turbo typecheck`; relevant TUI/config test suites)
- All four manual verification scenarios from Phase 3 pass
- `jsonc-parser` preserves comments and formatting in this repo's `.opencode/opencode.jsonc` (no surprise whitespace diffs)
- Two consecutive clean audit passes against this plan
- The three Phase-1 "verify" items resolved with documented findings

## Test Command

```bash
bun test packages/opencode/test/config/model-persistence.test.ts
bun turbo typecheck
```

(Root `bun test` intentionally errors per `package.json:21` — always scope tests to a package.)

## Risks

1. **Diffs on tracked config files** — writing to a committed `opencode.json` shows in `git status`. Chosen default. `OPENCODE_DISABLE_PROJECT_CONFIG=1` is the escape hatch.
2. **Scaffolding in unexpected places** — running opencode in `/tmp` (or any non-project dir) creates `.opencode/opencode.json` on first model change. The info toast names the path so the user notices.
3. **`OPENCODE_CONFIG_DIR` shared across sessions** — multiple opencode instances pointing at the same env-var dir will race. Atomic write mitigates corruption; last-write-wins for content.
4. **JSONC ugly diffs** — `jsonc-parser.modify()` is generally clean; unusual layouts may produce surprising whitespace. Watch in manual verification.
5. **Atomic rename on Windows** — `fs.rename()` may fail if target exists on some Win configs. Use `fs.rm` + `rename` or `fs.copyFile` + `unlink`. Confirm cross-platform.
6. **External editor race** — user edits config while TUI saves. `writeAgentModels()` re-reads inside the helper so no in-memory cache, but a save can still clobber a concurrent external edit. Document the limitation.
7. **Sync reload latency** — if config sync debounces re-reads, the TUI may briefly show old `a.model`. Verify manually.

## Out of scope

- Persisting `recent` / `favorite` / `variant` to project config (user-scoped by design).
- Persisting session-pinned models (lives in `session.json`, separate mechanism).
- A migration command to move existing user-state model selections into project configs.
- A UI prompt on each change asking "save where?".

## Notes on prior iterations

Two earlier iterations were superseded:
- `.cruxdev/build_plans/save-model-to-project-config.md` — bypass of the cruxdev engine (deleted).
- `build_plans/BUILD_PLAN_211_*.md` — engine-allocated but mis-numbered because opencode wasn't yet registered as a cruxdev project, so `create_plan_template` fell back to a global counter. After `install_cruxdev` ran, the file was renamed to BP-001 to start opencode's own namespace cleanly.
