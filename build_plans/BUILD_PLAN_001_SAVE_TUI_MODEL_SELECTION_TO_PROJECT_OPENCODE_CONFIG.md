# BUILD_PLAN_001: Save TUI model selection to project opencode config

## Document Alignment

**Reused helpers and patterns** (plan calls into these unchanged):
- `packages/opencode/src/config/config.ts:349` (`patchJsonc`), `:829` (`updateGlobal`), `:825` (`invalidate`), `:597-606` (read precedence)
- `packages/opencode/src/cli/cmd/tui/context/project.tsx:36-47, 70-82` — **existing** `ProjectProvider`; `instance.path()` and `instance.directory()` are **methods** (not properties), and `data.instance.path.{worktree,directory}` is the raw store
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx:381` (project.sync invocation), `:392`/`:439` (one-shot config snapshot — motivates the explicit re-fetch in Step 5), `:487` (`set: setStore` export consumed by `save()`)
- `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts:20` — the `markInstanceForDisposal` invocation pattern in the existing `update` handler is the load-bearing template the new `updateProject` handler mirrors (audit f1-R2)
- `packages/opencode/src/server/routes/instance/httpapi/lifecycle.ts` — `markInstanceForDisposal` source; invoked by the existing `update` handler and the new `updateProject` handler. Risk 12 calls out an idempotency spot-check on this function.
- `packages/core/src/flag/flag.ts:17` (`OPENCODE_CONFIG` constant), `:49-51` (`OPENCODE_DISABLE_PROJECT_CONFIG` getter), `:55-57` (`OPENCODE_CONFIG_DIR` getter) — env vars feeding the resolver
- `packages/opencode/test/config/tui.test.ts` — `TestInstance` + `withCleanState` + `withEnv` fixtures reused by the new `model-persistence.test.ts` suite

**Files modified by this plan** (anchored to working-tree state):
- `packages/opencode/src/cli/cmd/tui/context/local.tsx:19-25` (`parseModel`), `:106-391` (model iife), `:134-136` (state), `:138-154` (`save()` — assumes the uncommitted edits in the working tree have been committed first), `:156-167` (model hydration from user state), `:248-322` (`set/cycle/cycleFavorite` — augmented to populate `dirtyAgents`) — the file this plan rewrites
- `packages/opencode/src/config/paths.ts:10-21` (`files()`) — Step 1 adds `resolveModelWriteTarget` + helpers here
- `packages/opencode/src/server/routes/instance/httpapi/groups/config.ts:15-46` (existing endpoint group) — Step 3 adds `modelWriteTarget` GET + `updateProject` POST
- `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts:9-34` (existing handlers) — Step 3 adds two handlers alongside `get`/`update`/`providers`
- `packages/opencode/src/cli/cmd/tui/plugin/internal.ts:24-38` (`internalTuiPlugins()`) — Step 6 registers the new `SidebarProjectConfig` here; without this registration the indicator silently never renders

**Schemas the plan depends on** (load-bearing for the "no schema change" claim):
- `packages/opencode/src/config/agent.ts:23` — `agent.<name>.model: Schema.optional(ConfigModelID)` already exists
- `packages/opencode/src/config/model-id.ts:3` — `ConfigModelID = Schema.String` (convention-only format `${providerID}/${modelID}`)

**Write targets** (plan modifies these in Phase 3):
- `packages/opencode/AGENTS.md` — one-paragraph behavior note appended (Phase 3). Note: the existing content of this file is dominated by Drizzle / module-shape / `bun dev` conventions unrelated to this plan; we are adding to it, not following its existing conventions.
- `packages/docs` env-var/configuration page — documents `OPENCODE_DISABLE_PROJECT_CONFIG` / `OPENCODE_CONFIG` / `OPENCODE_CONFIG_DIR` write-side semantics (or appended to `AGENTS.md` env-var section if no docs page exists)

**Adoption context** (informational):
- `.cruxdev/intake-classification.md` — adoption classification (software-existing, maturity 3→4)

**Removed from alignment** (per audit f1/f2-R7 — these were aspirational, not actually load-bearing):
- ~~`specs/v2/instructions.md`~~ — about porting opencode services into core/plugins (v2 service-shape conventions), not config handling. This plan follows v1-style `Config.Service` pattern, not v2.
- ~~`specs/v2/provider-model.md`~~ — describes `ProviderV2.Info` / `ModelV2.Info` catalog types; not the on-disk `agent.<name>.model: string` shape this plan persists.

## Context

When opencode runs inside a project (a project-level `opencode.jsonc` / `opencode.json` or `.opencode/` directory detected by walking up from cwd, stopping at the git worktree boundary), persist per-agent model selections made in the TUI to that project config file. Project-config writes round-trip through the existing config-loader so the TUI sees them on next load.

Recent commits `ec0637f4d` and `53b927b6b` added per-agent persistence + save-on-change but only to the user state dir (`Global.Path.state/model.json`). This plan extends that to project config.

**Prerequisite**: this plan assumes the uncommitted edits to `packages/opencode/src/cli/cmd/tui/context/local.tsx` (which import `writeFileSync` and switch `save()` to a synchronous try/catch — see working tree at lines `10`, `138-154`) have been committed first. Line numbers in this plan refer to that working-tree state.

## Phase 1: Design

- [x] **Default behavior**: default-on whenever project config is detected or scaffoldable; `OPENCODE_DISABLE_PROJECT_CONFIG=1` disables. Mirrors the existing read-side gate at `config.ts:602`.
- [x] **Write target precedence** (mirrors read precedence at `config.ts:597-606` and `paths.ts:10-21`):
  1. `Flag.OPENCODE_DISABLE_PROJECT_CONFIG` (getter at `core/src/flag/flag.ts:49-51`) truthy → `{ mode: "user" }` (no project write)
  2. `Flag.OPENCODE_CONFIG` (constant at `flag.ts:17`) set → write to that exact path (create dir if missing, subject to path-safety check). Matches `config.ts:597-600` read behavior.
  3. `Flag.OPENCODE_CONFIG_DIR` (getter at `flag.ts:55-57`) set → write to `${OPENCODE_CONFIG_DIR}/opencode.json`. Matches `config.ts:614-621`.
  4. Innermost discovered project config from `ConfigPaths.files("opencode", directory, worktree)` (`paths.ts:10-21`). Selecting `found[found.length-1]` correctly picks the innermost `.jsonc` over the innermost `.json` because `up()` (`filesystem.ts:141-155`) iterates targets in order `[".jsonc", ".json"]` per dir, and `.toReversed()` puts innermost last with `.jsonc` last-of-pair. Verified by tracing — see Step 7 test 7b.
  5. Innermost discovered `.opencode/` dir (via `afs.up({ targets: [".opencode"], ... })`) → use/create `.opencode/opencode.json` inside it.
  6. **Scaffold** `.opencode/opencode.json` at the effective worktree root; if no effective worktree, scaffold under `directory` (cwd). Refuse to scaffold if path-safety check fails.
- [x] **Worktree normalization** (audit f1): `InstanceContext.worktree` is the literal string `"/"` for non-git projects (`project/project.ts:237`, `instance-context.ts:22`), not `undefined`. The `normalizeWorktree(w)` helper returns `null` for `""`, `"/"`, or undefined. Scaffold root uses the normalized value; otherwise scaffold at `directory` (cwd) — never at filesystem root.
- [x] **Path-safety check** (audit f11, audit f10-R1): before any first project write, validate the resolved target directory:
  - Resolve via `fs.realpathSync` (follows symlinks). Falls back to `path.resolve` if dir does not yet exist (scaffold case).
  - Reject if resolved path equals `/`, or is under `/proc`, `/dev`, `/sys`, or has fewer than 2 segments.
  - Reject if outside both the resolved worktree AND `$HOME`, unless `OPENCODE_CONFIG` / `OPENCODE_CONFIG_DIR` was explicitly set (explicit env override).
  - Probe writability via `fs.access(dir, fs.constants.W_OK)` (or its parent dir if scaffolding into a missing dir).
  - On rejection: return `{ mode: "user", refusedPath, refusedReason }`; TUI shows one-shot startup warning toast and falls back to user-only mode for the session.
- [x] **Schema**: existing `agent.<name>.model` field at `config/agent.ts:23` is `Schema.optional(ConfigModelID)`. `ConfigModelID` at `config/model-id.ts:3` is `Schema.String`. No schema change.
- [x] **What persists**: only `agent.<name>.model` goes to project config. `recent` / `favorite` / `variant` stay in user state (`Global.Path.state/model.json`) — they are user preferences, not project preferences.
- [x] **Dirty-agent tracking** (audit f2): `modelStore.model` is hydrated from user state at TUI startup and carries the user's prior per-agent selections across projects (`local.tsx:156-167`). Without filtering, the first save in a fresh project would leak those into the team's project config. Maintain `dirtyAgents: Set<string>` populated inside `set()`, `cycle()`, `cycleFavorite()` (`local.tsx:248-322`) — only entries in `dirtyAgents` are passed to the project writer. User state continues to receive the full `modelStore.model` so cross-project memory is preserved locally.
- [x] **Reuse existing JSONC + invalidate machinery** (audit f9): `patchJsonc` at `config.ts:349-361` accepts `(input: string, patch: unknown, path: string[] = [])` — the third arg is a recursion path, NOT formatting options (formatting is baked at lines 351-356). `Config.updateGlobal` at `config.ts:829-852` shows the canonical pattern: `(config: Info)` partial → merge into existing → emit JSON or JSONC patch → `writeFileString` → `invalidate()`. We add a sibling **`Config.updateProject(config: Info, targetPath: string)`** with the same shape (partial Info merge + JSONC patch + invalidate).
- [x] **`Config.updateProject` signature** (audit f1-R1): matches `updateGlobal`'s real signature — `(config: Info)` takes a partial Info to merge. The new helper extends to `(config: Info, targetPath: string)` so the caller chooses the destination. Returns `{ info, changed }` like `updateGlobal`. Caller's responsibility to construct the partial Info (e.g., `{ agent: { build: { model: "anthropic/claude-3-5-sonnet" } } }`).
- [x] **Atomic write with cross-FS / Windows fallback** (audit f6): tmp filename is unique per write — `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`. After `fs.writeFileString(tmp, ...)`, attempt `fs.rename(tmp, filePath)`; on **any** PlatformError reason (covering EXDEV / EPERM / EEXIST without depending on errno extraction), fall back to `fs.copyFile(tmp, filePath)` + `fs.remove(tmp)`. PlatformError exposes `.reason._tag` (`"SystemError"`, `"NotFound"`, etc.) — we catch all and retry once via copy+remove. This is owned by `Config.updateProject`; callers don't see it.
- [x] **Error tags** (audit f3-R1): there is no `FsError` tag. `AppFileSystem.Interface` (`packages/core/src/filesystem.ts:24-39`) extends the upstream `FileSystem.FileSystem`; its methods fail with `PlatformError | FileSystemError` (alias `AppFileSystem.Error` at `filesystem.ts:17`). Detection uses `e.reason._tag === "NotFound" | "PermissionDenied" | "SystemError" | "BadArgument"` (per existing examples at `config.ts:503`, `storage.ts:77`, `read.ts:217`). The atomic-write fallback path catches via `Effect.catch` (no tag filter needed since both branches are filesystem errors).
- [x] **Failure mode** (audit f7, audit f11-R1): on project-write failure, surface a persistent status indicator (consumed by the TUI status bar — see Phase 3) that stays until the next successful project write, plus a one-shot warning toast on each failure. User state IS still written (preserves cross-project memory), but **the failed agent stays in `dirtyAgents`** — the next save() retry attempts the project write again. This resolves the audit f11-R1 self-contradiction: user state is the local memory, project state is the team contract; a write failure means the team contract didn't update, so we retry rather than silently desyncing.
- [x] **Model string format** (audit f12): canonical parser is `parseModel()` at `local.tsx:19-25` — `split('/')`, then `rest.join('/')`. This round-trips a modelID containing additional `/` characters (e.g., `anthropic/claude-3-5-sonnet/v2`). Writer must serialize as `${providerID}/${modelID}` with no escaping. `ConfigModelID` is `Schema.String` so format is convention-only — add a round-trip test (Step 7 test 17).
- [x] **Consumption of project context in TUI**: use the existing `useProject()` context (`tui/context/project.tsx:9-109`, mounted at `app.tsx:230`). The store has `instance.path` (raw shape `{home, state, config, worktree, directory}`). The wrapper exposes `instance.path()` and `instance.directory()` as **methods** (lines 76-82). To stay consistent with existing call sites (`directory.ts:10` uses `project.instance.path()`; `dialog-workspace-create.tsx:131` uses `project.instance.directory()`), this plan **extends the wrapper API** with `instance.modelWriteTarget()` returning the cached resolution. Internal store extends to `instance.modelWriteTarget: ResolvedTarget | undefined`.
- [x] **Effect runtime ownership** (audit f4): `resolveModelWriteTarget` is an Effect requiring `AppFileSystem.Service`. TUI's `save()` has no Effect runtime; do the work via a server endpoint that runs the Effect in the server's existing runtime and returns a JSON-serializable payload. SDK call (audit f4-R1): the access pattern is `sdk.client.config.X(...)` (verified at `sync.tsx:385,392`), not `sdk.config.X`.
- [x] **Server endpoints** (audit f5-R1): two endpoints are added.
  - `GET /config/model_write_target` — handler at `server/routes/instance/httpapi/handlers/config.ts`, registered alongside existing `get`/`update`/`providers` at line `:32`. Group entry at `server/routes/instance/httpapi/groups/config.ts:14-46` adds an `HttpApiEndpoint.get("modelWriteTarget", "/config/model_write_target", { query: WorkspaceRoutingQuery, success: ModelWriteTargetResponse })` with explicit Success Schema (defined in `groups/config.ts`).
  - `POST /config/update_project` — adds `HttpApiEndpoint.post("updateProject", "/config/update_project", { query: WorkspaceRoutingQuery, payload: UpdateProjectRequest, success: described(Schema.Boolean, "Updated"), error: HttpApiError.BadRequest })`. Payload shape is JSON-only: `{ targetPath: string, models: Record<agentName, { providerID: string; modelID: string }> }`. The handler translates `models` into a partial `Info` (`{ agent: { [name]: { model: \`${providerID}/${modelID}\` } } }`) and calls `Config.updateProject(info, targetPath)`.
  - SDK call sites: `sdk.client.config.modelWriteTarget(...)` and `sdk.client.config.updateProject(...)`.
- [x] **Read-after-write** (audit f7-R1): `sync.data.config` is a one-shot snapshot from `sdk.client.config.get(...)` at bootstrap (`sync.tsx:392`, `:439`). There is **no auto-refresh on server invalidate**. Chosen approach: **explicit re-fetch after a successful project write**. The TUI calls `sdk.client.config.get({ workspace })` after a successful `updateProject` and writes the result via `sync.set("config", reconcile(...))`. Rationale: simplest, no new event types, no protocol churn, and the read-after-write contract is local to the save() path. (Alternative considered: server-emitted `config.changed` event — rejected for now as overkill for a single feature; can be added later if other writers appear.)
- [x] **Flag evaluation timing** (audit f8-R1, audit f4-R2): `Flag.OPENCODE_CONFIG_DIR` and `OPENCODE_DISABLE_PROJECT_CONFIG` are **getters** (`flag.ts:49-57`). `OPENCODE_CONFIG` is a constant (`flag.ts:17`, evaluated at module load). The server-side `resolveModelWriteTarget` Effect reads these on every call — cheap, and ensures changes made via `process.env` mid-test are honored at the server level. The **TUI caches** the resolved result for the process lifetime (in `ProjectProvider.sync()`, called once at bootstrap from `sync.tsx:381`). **Behavioral consequence**: changing `OPENCODE_CONFIG*` env vars after launching opencode requires restarting the TUI for the new value to be honored — this is documented as a limitation. For tests that mutate env vars at runtime, exercise `resolveModelWriteTarget()` directly rather than through the TUI cache (see Step 6 tests 4, 11, 12).
- [x] **Scaffold UX**: one-shot info toast on first scaffold naming the created path; module-scoped `state.scaffoldToastShown` prevents repeat within the same TUI process. Reset on process restart (a teammate cloning the repo wants to see the toast on their first run).

### Files touched

| File | Change |
|---|---|
| `packages/opencode/src/config/paths.ts` | `+ resolveModelWriteTarget(directory, worktree?)` Effect (uses `AppFileSystem.Service`); `+ normalizeWorktree`; `+ isSafeTargetPath` |
| `packages/opencode/src/config/config.ts` | `+ Config.updateProject(config: Info, targetPath: string)` mirroring `updateGlobal`; `+ writeAtomic` internal helper |
| `packages/opencode/src/server/routes/instance/httpapi/groups/config.ts` | `+ ModelWriteTargetResponse` schema, `+ UpdateProjectRequest` schema, `+ modelWriteTarget` GET endpoint, `+ updateProject` POST endpoint |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts` | `+ modelWriteTarget` handler, `+ updateProject` handler |
| `packages/opencode/src/cli/cmd/tui/context/project.tsx` | extend `sync()` to also fetch `modelWriteTarget`; extend wrapper API with `instance.modelWriteTarget()` |
| `packages/opencode/src/cli/cmd/tui/context/local.tsx` | rewrite `save()`; add `dirtyAgents: Set<string>` updated in `set/cycle/cycleFavorite`; thread persistent status indicator state; trigger explicit config re-fetch after successful write |
| `packages/opencode/test/config/model-persistence.test.ts` | **new** tests (20 cases — see Step 7) |
| `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/project-config.tsx` | **new** sidebar status indicator component (Step 6) |
| `packages/opencode/AGENTS.md` | one-paragraph behavior note |

No schema change. No breaking change to user state file shape.

## Phase 2: Implementation

- [ ] **Step 1 — `resolveModelWriteTarget()` + helpers in `packages/opencode/src/config/paths.ts`**

  Real signature: `Effect.fn` produces `(...args) => Effect.Effect<A, E, R>`. The TS form is `const NAME = Effect.fn("...")(function* (...) { ... })`. Pseudocode follows that exact form.

  ```ts
  import fs from "fs"
  import os from "os"
  import path from "path"
  import { Effect } from "effect"
  import { Flag } from "@opencode-ai/core/flag/flag"
  import { AppFileSystem } from "@opencode-ai/core/filesystem"
  import { Global } from "@opencode-ai/core/global"

  export type ResolvedTarget =
    | { mode: "user"; refusedPath?: string; refusedReason?: string }
    | { mode: "project"; path: string; source: "OPENCODE_CONFIG" | "OPENCODE_CONFIG_DIR" | "existing_file" | "existing_dot_opencode" | "scaffolded" }

  function normalizeWorktree(worktree?: string): string | null {
    if (!worktree || worktree === "" || worktree === "/") return null
    return worktree
  }

  // Realpath that survives non-existent targets by climbing to the deepest existing
  // ancestor (so parent-directory symlinks are still followed). This matters on macOS
  // where /Users/foo can be a symlink to /private/Users/foo — a naive path.resolve()
  // fallback would compare lexically-resolved strings against realpath'd worktree/home,
  // producing false-negative refusals. (Audit f7-R2.)
  function safeRealpath(p: string): string {
    let cur = path.resolve(p)
    const tail: string[] = []
    while (!fs.existsSync(cur) && path.dirname(cur) !== cur) {
      tail.unshift(path.basename(cur))
      cur = path.dirname(cur)
    }
    try {
      return path.join(fs.realpathSync(cur), ...tail)
    } catch {
      return path.resolve(p)
    }
  }

  function isSafeTargetPath(
    targetPath: string,
    opts: { home: string; worktree: string | null; envOverride: boolean },
  ): { ok: true } | { ok: false; reason: string } {
    const real = safeRealpath(targetPath)
    const segments = real.split(path.sep).filter(Boolean)
    if (segments.length < 2) return { ok: false, reason: "path is filesystem root or near-root" }
    for (const banned of ["/proc", "/dev", "/sys"]) {
      if (real === banned || real.startsWith(banned + path.sep)) {
        return { ok: false, reason: `path under ${banned}` }
      }
    }
    if (opts.envOverride) return { ok: true }
    const insideWorktree = opts.worktree !== null && real.startsWith(opts.worktree + path.sep)
    const insideHome = real.startsWith(opts.home + path.sep)
    if (!insideWorktree && !insideHome) {
      return { ok: false, reason: "path is outside worktree and outside $HOME" }
    }
    // Writability probe: check the directory (or its parent for scaffold targets that don't exist yet).
    const dir = fs.existsSync(path.dirname(real)) ? path.dirname(real) : path.dirname(path.dirname(real))
    try {
      fs.accessSync(dir, fs.constants.W_OK)
    } catch (e: any) {
      return { ok: false, reason: `not writable: ${dir}` }
    }
    return { ok: true }
  }

  export const resolveModelWriteTarget = Effect.fn("ConfigPaths.resolveModelWriteTarget")(function* (
    directory: string,
    worktreeRaw?: string,
  ) {
    if (Flag.OPENCODE_DISABLE_PROJECT_CONFIG) return { mode: "user" } as ResolvedTarget
    const worktree = normalizeWorktree(worktreeRaw)
    const home = Global.Path.home

    function tryReturn(p: string, source: ResolvedTarget extends { source: infer S } ? S : never, envOverride: boolean): ResolvedTarget {
      const safe = isSafeTargetPath(p, { home, worktree, envOverride })
      if (!safe.ok) return { mode: "user", refusedPath: p, refusedReason: safe.reason }
      return { mode: "project", path: p, source }
    }

    if (Flag.OPENCODE_CONFIG) return tryReturn(Flag.OPENCODE_CONFIG, "OPENCODE_CONFIG", true)
    if (Flag.OPENCODE_CONFIG_DIR) {
      return tryReturn(path.join(Flag.OPENCODE_CONFIG_DIR, "opencode.json"), "OPENCODE_CONFIG_DIR", true)
    }

    const afs = yield* AppFileSystem.Service

    const foundFiles = yield* files("opencode", directory, worktreeRaw)
    if (foundFiles.length) return tryReturn(foundFiles[foundFiles.length - 1], "existing_file", false)

    const dotOpencode = yield* afs.up({ targets: [".opencode"], start: directory, stop: worktreeRaw })
    if (dotOpencode.length) return tryReturn(path.join(dotOpencode[0], "opencode.json"), "existing_dot_opencode", false)

    const root = worktree ?? directory
    return tryReturn(path.join(root, ".opencode", "opencode.json"), "scaffolded", false)
  })
  ```

  Notes:
  - `worktreeRaw` is forwarded to `files()` and `afs.up()` since those tolerate `"/"` as the stop bound (the walk terminates at root naturally). Only the scaffold path uses the normalized form.
  - Return type includes `{ mode: "user", refusedPath?, refusedReason? }` so the TUI can render a startup toast on safety rejection.

- [ ] **Step 2 — `Config.updateProject()` in `packages/opencode/src/config/config.ts`**

  Mirrors `updateGlobal` (lines 829-852). Add to the public `Interface` (line 324-333) and to the `Service.of` factory (line 854-863).

  ```ts
  // Add to Interface:
  readonly updateProject: (config: Info, targetPath: string) => Effect.Effect<{ info: Info; changed: boolean }>

  // Internal helper, defined inside layer. Mirrors updateGlobal's pattern of piping every
  // fs operation with .pipe(Effect.orDie) so the Effect signature stays error: never
  // (matching the declared Interface). Audit f2-R2.
  const writeAtomic = Effect.fn("Config.writeAtomic")(function* (filePath: string, contents: string) {
    const tmp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(Effect.orDie)
    yield* fs.writeFileString(tmp, contents).pipe(Effect.orDie)
    yield* fs.rename(tmp, filePath).pipe(
      // PlatformError covers EXDEV / EPERM / EEXIST cross-FS / Windows / target-exists cases.
      // Fall back to copy + remove regardless of specific reason._tag — both branches are filesystem errors,
      // and any rename failure is recoverable via copy. Orphaned tmp on copy failure is acceptable
      // (process restart cleans up by being a different pid+uuid).
      Effect.catch(() =>
        fs.copyFile(tmp, filePath).pipe(
          Effect.tap(() => fs.remove(tmp).pipe(Effect.ignore)),
          Effect.orDie,
        ),
      ),
    )
  })

  const updateProject = Effect.fn("Config.updateProject")(function* (config: Info, targetPath: string) {
    const before = (yield* readConfigFile(targetPath)) ?? "{}"
    const patch = writable(config) // strips plugin_origins; see config.ts:363-366

    let next: Info
    let changed: boolean
    if (!targetPath.endsWith(".jsonc")) {
      const existing = ConfigParse.schema(Info, ConfigParse.jsonc(before, targetPath), targetPath)
      const merged = mergeDeep(writable(existing), patch)
      const serialized = JSON.stringify(merged, null, 2)
      changed = serialized !== before
      if (changed) yield* writeAtomic(targetPath, serialized)
      next = merged
    } else {
      const updated = patchJsonc(before, patch) // patchJsonc(input, patch, path: string[] = [])
      next = ConfigParse.schema(Info, ConfigParse.jsonc(updated, targetPath), targetPath)
      changed = updated !== before
      if (changed) yield* writeAtomic(targetPath, updated)
    }

    if (changed) yield* invalidate()
    return { info: next, changed }
  })
  ```

  Notes:
  - `patchJsonc(before, patch)` — third arg defaulted to `[]` per its real signature at `config.ts:349`. We do NOT pass formatting options (those are baked into the function).
  - `readConfigFile` is the existing helper at `config.ts:391` (returns string | undefined via `readFileStringSafe`).
  - `invalidate()` is the existing helper at `config.ts:825-827`. It **only** clears `cachedGlobal` (`config.ts:478`) — it does NOT rebuild the `InstanceState` ScopedCache at `config.ts:792` that holds the merged config returned by `Config.get()`. To make read-after-write work end-to-end (audit f1-R2), the **HTTP handler** for `updateProject` calls `yield* markInstanceForDisposal(yield* InstanceState.context)` after `Config.updateProject` returns — matching the pattern in the existing `update` handler at `handlers/config.ts:20`. This forces the next request to rebuild instance state, so the subsequent `sdk.client.config.get(...)` from the TUI sees the new merged config. (Calling `invalidate()` inside `Config.updateProject` is still useful for clearing the global cache layer, but the InstanceState disposal is the load-bearing call.)
  - Caller surface (used by the server handler): `Config.updateProject({ agent: { [name]: { model: \`${providerID}/${modelID}\` } } }, targetPath)`.
  - Batching: for N dirty agents the server handler merges all into one partial Info before a single `updateProject` call. One read, one write per save() invocation.

- [ ] **Step 3 — Server endpoint group + handler additions**

  In `packages/opencode/src/server/routes/instance/httpapi/groups/config.ts`, add (alongside existing `get`/`update`/`providers` at lines `:15-46`):

  ```ts
  import { Schema } from "effect"

  const ProviderModel = Schema.Struct({
    providerID: Schema.String,
    modelID: Schema.String,
  })

  const ModelWriteTargetResponse = Schema.Union([
    Schema.Struct({
      mode: Schema.Literal("user"),
      refusedPath: Schema.optional(Schema.String),
      refusedReason: Schema.optional(Schema.String),
    }),
    Schema.Struct({
      mode: Schema.Literal("project"),
      path: Schema.String,
      source: Schema.Literals(["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "existing_file", "existing_dot_opencode", "scaffolded"]),
    }),
  ]).annotate({ identifier: "ModelWriteTarget" })

  const UpdateProjectRequest = Schema.Struct({
    targetPath: Schema.String,
    models: Schema.Record(Schema.String, ProviderModel),
  }).annotate({ identifier: "UpdateProjectRequest" })

  // ... add these two endpoints alongside existing ones:
  HttpApiEndpoint.get("modelWriteTarget", `${root}/model_write_target`, {
    query: WorkspaceRoutingQuery,
    success: described(ModelWriteTargetResponse, "Resolved project-config write target"),
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "config.modelWriteTarget",
      summary: "Resolve model write target",
      description: "Compute where TUI model selections should be persisted (project config, scaffold, or user-only mode).",
    }),
  ),
  HttpApiEndpoint.post("updateProject", `${root}/update_project`, {
    query: WorkspaceRoutingQuery,
    payload: UpdateProjectRequest,
    success: described(Schema.Boolean, "Project config updated"),
    error: HttpApiError.BadRequest,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "config.updateProject",
      summary: "Update project config models",
      description: "Persist the given per-agent model selections to the specified project config file.",
    }),
  ),
  ```

  In `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts`, add:

  ```ts
  import { ConfigPaths } from "@/config/paths"
  import * as InstanceState from "@/effect/instance-state"

  const modelWriteTarget = Effect.fn("ConfigHttpApi.modelWriteTarget")(function* () {
    const ctx = yield* InstanceState.context
    return yield* ConfigPaths.resolveModelWriteTarget(ctx.directory, ctx.worktree)
  })

  const updateProject = Effect.fn("ConfigHttpApi.updateProject")(function* (ctx) {
    const { targetPath, models } = ctx.payload
    const agent: Record<string, { model: string }> = {}
    for (const [name, m] of Object.entries(models)) {
      agent[name] = { model: `${m.providerID}/${m.modelID}` }
    }
    yield* configSvc.updateProject({ agent } as Config.Info, targetPath)
    // Force InstanceState rebuild on next request — audit f1-R2. Matches the
    // existing `update` handler pattern at handlers/config.ts:20.
    yield* markInstanceForDisposal(yield* InstanceState.context)
    return true
  })

  return handlers
    .handle("get", get)
    .handle("update", update)
    .handle("providers", providers)
    .handle("modelWriteTarget", modelWriteTarget)
    .handle("updateProject", updateProject)
  ```

  **Server restart required** (audit f5-R5): HttpApi groups are constructed at module-load time in `groups/config.ts`, so adding new endpoint entries requires a **hard restart** of any running `bun run dev` / `opencode serve` process — hot-reload may not re-register the new group. Forgetting this restart manifests as 404s on the new endpoints during manual verification (Phase 3); SDK regen (Step 3.5) still works because `script/build.ts` reads the schema via a fresh module load.

- [ ] **Step 3.5 — Regenerate SDK client** (audit f1-R3): SDK regen is the load-bearing dependency between server-side endpoints (Step 3) and TUI consumers (Steps 4-5). Run `cd packages/sdk/js && bun run build`. This re-runs `packages/sdk/js/script/build.ts`, which dumps the OpenAPI schema and regenerates `packages/sdk/js/src/v2/gen/sdk.gen.ts`. **Before proceeding to Step 4**, verify both new entries exist:
  ```bash
  grep -E 'modelWriteTarget|updateProject' packages/sdk/js/src/v2/gen/sdk.gen.ts
  ```
  Expected: two matches each (a typed signature + a runtime export). If missing, the SDK build silently skipped them — re-check `groups/config.ts` for syntax errors and re-run.

- [ ] **Step 4 — Extend `ProjectProvider` in `packages/opencode/src/cli/cmd/tui/context/project.tsx`**

  Add `modelWriteTarget: undefined as ResolvedTarget | undefined` to the store (`instance` slice, line 22-34). In `sync()` (line 36-47), fetch it in parallel with `path` and `project.current`:

  ```ts
  async function sync() {
    const workspace = store.workspace.current
    const [path, project, modelWriteTarget] = await Promise.all([
      sdk.client.path.get({ workspace }),
      sdk.client.project.current({ workspace }),
      sdk.client.config.modelWriteTarget({ workspace }).catch(() => undefined),
    ])

    batch(() => {
      setStore("instance", "path", reconcile(path.data || defaultPath))
      setStore("project", "id", project.data?.id)
      setStore("instance", "modelWriteTarget", modelWriteTarget?.data)
    })
  }
  ```

  Extend the returned wrapper API (line 75-82):

  ```ts
  instance: {
    path() { return store.instance.path },
    directory() { return store.instance.path.directory },
    modelWriteTarget() { return store.instance.modelWriteTarget },
  },
  ```

  **Toast ownership pinned to ProjectProvider** (audit f3-R3): inside `ProjectProvider`, immediately after `sync()` populates `store.instance.modelWriteTarget`, fire a one-shot warning toast when `modelWriteTarget?.mode === "user" && modelWriteTarget.refusedReason` is truthy. Toast message names `refusedPath` and `refusedReason`. Owned by ProjectProvider (not LocalProvider) because the cached value lives in its store. Use a module-scope `safetyToastShown: boolean` to guarantee one-shot semantics. **Test 20** (Step 7) asserts the toast fires exactly once with `variant: "warning"` and a message containing the refused path.

  **New imports in `project.tsx`** (audit f2-R5):
  ```ts
  import { useToast } from "../ui/toast"
  import type { ResolvedTarget } from "@/config/paths"
  ```
  Acquire `const toast = useToast()` at the top of the `init()` body. `ToastProvider` is mounted above `ProjectProvider` in `app.tsx:211`, so this is safe; if a future change reorders providers, this call would break — flag for code review.

- [ ] **Step 5 — Rewrite `save()` in `local.tsx`**

  Current `save()` at lines 138-154 only writes user state. Replace with the version below. Module-scope additions go alongside the existing `state` object at line 134-136.

  ```ts
  // Inside the `model` iife (around line 106-391):
  const project = useProject()  // requires importing useProject from "@tui/context/project"
  // sync is already declared at local.tsx:30 inside init() and accessible here by closure;
  // do NOT re-declare (audit f6-R2).

  const dirtyAgents = new Set<string>()
  const state = {
    pending: false,
    scaffoldToastShown: false,
    projectWriteFailing: false,
  }

  // Inside set() (line 299), cycle() (line 248), cycleFavorite() (line 264), wherever
  // `setModelStore("model", a.name, ...)` is called, append:
  //     dirtyAgents.add(a.name)
  // (do this before the existing save() call)

  function save() {
    if (!modelStore.ready) {
      state.pending = true
      return
    }
    state.pending = false

    // 1. User state: always write the FULL modelStore.model. Preserves cross-project memory locally.
    try {
      writeFileSync(filePath, JSON.stringify({
        model: modelStore.model,
        recent: modelStore.recent,
        favorite: modelStore.favorite,
        variant: modelStore.variant,
      }, null, 2))
    } catch (e) {
      console.error("save model failed (user state)", e)
    }

    // 2. Project write: only dirty agents, only when target resolved and project mode.
    const writeTarget = project.instance.modelWriteTarget()
    if (!writeTarget || writeTarget.mode !== "project") return
    if (!project.instance.directory()) {
      state.pending = true
      return
    }
    if (dirtyAgents.size === 0) return

    const models: Record<string, { providerID: string; modelID: string }> = {}
    for (const name of dirtyAgents) {
      const m = modelStore.model[name]
      if (m) models[name] = { providerID: m.providerID, modelID: m.modelID }
    }
    if (Object.keys(models).length === 0) return

    const snapshot = new Set(dirtyAgents)  // capture before async resolution
    const targetPath = writeTarget.path
    const isScaffolding = writeTarget.source === "scaffolded"

    sdk.client.config
      .updateProject({ targetPath, models })
      .then(async () => {
        snapshot.forEach((n) => dirtyAgents.delete(n))
        if (state.projectWriteFailing) state.projectWriteFailing = false
        if (isScaffolding && !state.scaffoldToastShown) {
          state.scaffoldToastShown = true
          toast.show({
            variant: "info",
            message: `Created ${path.relative(project.instance.directory(), targetPath)} for project model config`,
            duration: 4000,
          })
        }
        // Explicit re-fetch so sync.data.config reflects the write (audit f7-R1).
        const refreshed = await sdk.client.config.get({ workspace: project.workspace.current() }).catch(() => undefined)
        if (refreshed?.data) sync.set("config", reconcile(refreshed.data))
      })
      .catch((e) => {
        console.error("save model failed (project config)", e)
        // dirtyAgents NOT cleared — next save() retries the same set.
        state.projectWriteFailing = true
        toast.show({
          variant: "warning",
          message: `Project config write failed — will retry on next change. ${e?.message ?? ""}`,
          duration: 4000,
        })
      })
  }
  ```

  Notes:
  - `sync.set` is exposed from `sync.tsx:487`. `reconcile` is from `solid-js/store`.
  - On `mode: "user"` (e.g., env disable or safety-check rejection), Steps 1 (user-state write) still runs; project write is skipped.
  - **Public getter** (audit f2-R3): extend the `model` API surface returned by `LocalProvider` with `projectWriteFailing(): boolean` that returns `state.projectWriteFailing`. This is the single read path the status-bar component (Step 6) consumes.

- [ ] **Step 6 — TUI status-bar indicator** (audit f2-R3, promoted from Phase 3)

  Add a new sidebar component at `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/project-config.tsx` modeled on `mcp.tsx` / `lsp.tsx`. It reads `useLocal().model.projectWriteFailing()` (the getter added in Step 5) and renders a colored dot + label when truthy. When `false`, it renders nothing. Cross-import of `useLocal` from a sidebar plugin matches the precedent in `feature-plugins/system/session-v2.tsx`. Theme tokens follow the same convention as the existing indicators.

  **Registration** (audit f1-R5): add to `packages/opencode/src/cli/cmd/tui/plugin/internal.ts`:
  ```ts
  import SidebarProjectConfig from "../feature-plugins/sidebar/project-config"
  // In internalTuiPlugins() return array, append between SidebarLsp and SidebarTodo:
  SidebarProjectConfig,
  ```
  Without this registration the component is never instantiated and the indicator will silently never render.

- [ ] **Step 7 — Tests at `packages/opencode/test/config/model-persistence.test.ts`**

  Follow the patterns in `packages/opencode/test/config/tui.test.ts` (TestInstance fixture, `withCleanState`, `withEnv`). All tests scope env-var mutations to `withEnv` so they don't bleed between cases.

  Resolution tests:
  1. `OPENCODE_DISABLE_PROJECT_CONFIG=1` → `{ mode: "user" }`; no file created
  2. `OPENCODE_CONFIG=/tmp/x/my.jsonc` (file missing) → writes to that exact file, parent dir created
  3. `OPENCODE_CONFIG=/tmp/x/my.jsonc` (file exists with comments) → comments preserved end-to-end
  4. `OPENCODE_CONFIG_DIR=/tmp/x` (empty dir) → writes to `/tmp/x/opencode.json`
  5. Cwd in project with `.opencode/opencode.jsonc` containing comments → comments preserved; `agent.build.model` updated
  6. Cwd in project with bare root `opencode.json` → `agent.<name>.model` updated
  7a. Both root `opencode.jsonc` and nested `subdir/opencode.json`; cwd `subdir/` → writes to nested (innermost)
  7b. **Same-dir `.json` AND `.jsonc` both present** (audit f9-R1 regression) → writer picks `.jsonc`. Read-side (`config.ts:603-605`) merges both with `.jsonc` last (winning), so writing to `.jsonc` matches read precedence.
  8. `.opencode/`-only project (no config file) → creates `.opencode/opencode.json`
  9. Git repo with no opencode config and no `.opencode/` → scaffolds at worktree root; one-shot info toast fires
  10. Non-git dir with `worktree === "/"` and no opencode config → scaffolds at `directory` (cwd), **not** at `/.opencode/opencode.json` (audit f1 regression test)

  Safety / failure tests:
  11. `OPENCODE_CONFIG_DIR=/proc/foo` → `{ mode: "user", refusedReason: "path under /proc" }`; no write attempted
  12. Scaffold above `$HOME` (without env override) → rejected with reason `"path is outside worktree and outside $HOME"`
  13. Read-only target dir (chmod 0o555) → `isSafeTargetPath` returns `{ ok: false, reason: "not writable: ..." }`; status indicator set; user state still contains full `modelStore.model`; project file untouched
  14. Mocked `fs.rename` throws → `writeAtomic` falls back to `copyFile + remove`, file ends up at target with correct contents. **Fixture pattern** (audit f3-R5, corrected per audit r6-f1): use an **Effect Layer override**. The production rename path goes through `AppFileSystem.Service.rename` → `@effect/platform-node`'s `NodeFileSystem.layer` (via `fs/promises`), NOT Node's synchronous `fs.renameSync` — a monkey-patch on `fs.renameSync` would silently no-op against the production code. Pattern:
  ```ts
  const failingRenameLayer = Layer.effect(
    AppFileSystem.Service,
    Effect.gen(function* () {
      const real = yield* AppFileSystem.Service
      return { ...real, rename: () => Effect.fail(new SystemError({ /* ... */ })) }
    }),
  )
  // Provide to test Effect: Effect.gen(...).pipe(Effect.provide(failingRenameLayer))
  ```
  Assert the test resolves (because writeAtomic's `Effect.catch` falls back to copyFile + remove) and the on-disk file matches the expected JSON.

  Behavioral tests:
  15. **Dirty-agent isolation** (audit f2 regression): hydrate `modelStore.model` with `{plan: A, build: B}` from user state; call `model.set(C)` for `build` only; assert resulting project config contains ONLY `agent.build.model = C`; `agent.plan` is absent (or unchanged if pre-existing)
  16. **Read-after-write** (audit f8 + f7-R1, restructured per audit f4-R5): the repo has no SolidJS context test harness, so this is split:
      - **16a (handler-level test)**: call the `POST /config/update_project` endpoint directly via `testEffect`; then immediately call `Config.get()` and assert `agent.<name>.model` reflects the new value. Validates `Config.updateProject` → `markInstanceForDisposal` chain.
      - **16b (SDK client unit test)**: mock the handler response; call `sdk.client.config.updateProject(...)`; assert the explicit re-fetch flow (`sdk.client.config.get` call + `sync.set("config", reconcile(...))`) happens exactly once with the expected payload.
      - **16c (manual verification, Phase 3)**: end-to-end through the actual TUI is verified manually since no Solid context fixture exists.
  17. **ModelID with extra slash** (audit f12): `model.set({ providerID: "anthropic", modelID: "claude-3-5-sonnet/v2" })` → on-disk file contains `"agent.foo.model": "anthropic/claude-3-5-sonnet/v2"`; re-load via `parseModel()` returns the same parts (`split('/')` + `rest.join('/')`)
  18. **Scaffold toast non-repeat**: scaffold once, change model 5 more times; assert info toast fired exactly once across the session
  19. **Concurrent rapid `save()` calls**: trigger 10 saves in 50ms; assert no leftover `.tmp` files in target dir; final on-disk contents reflect the last `set()`
  20. **Safety-rejection toast** (audit f2-R4, covers the toast-ownership pin in Step 4): stub `resolveModelWriteTarget` to return `{ mode: "user", refusedPath: "/proc/foo", refusedReason: "path under /proc" }`; mount `ProjectProvider`; assert `toast.show` called exactly once with `variant: "warning"` and a message containing `/proc/foo`. Re-mount and assert it does NOT fire again (module-scope `safetyToastShown` one-shot).

  Reference: `packages/opencode/test/config/tui.test.ts` for the `testEffect` + `TestInstance` setup, env-var scoping, and `withCleanState`.

## Phase 3: Integration & Polish

- [ ] **Restart any running `opencode serve` / `bun run dev` instances** before manual verification (audit f5-R5). HttpApi endpoints register at module load; hot-reload does not pick up new endpoints.
- [ ] Manual verification — existing-file preservation: in this repo, `.opencode/opencode.jsonc` exists; change a model in TUI; confirm `agent.<active>.model` updated and surrounding comments intact
- [ ] Manual verification — scaffold path: fresh git repo at `/tmp/fresh-repo`, run TUI, confirm scaffold at `/tmp/fresh-repo/.opencode/opencode.json` + info toast
- [ ] Manual verification — non-git dir: `cd /tmp/no-git-dir && opencode`, change model, confirm scaffold at `/tmp/no-git-dir/.opencode/opencode.json` (NOT `/.opencode/opencode.json`)
- [ ] Manual verification — `OPENCODE_CONFIG=/tmp/oc.jsonc` overrides project write target
- [ ] Manual verification — `OPENCODE_CONFIG_DIR=/tmp/oc-dir` overrides project write target
- [ ] Manual verification — `OPENCODE_DISABLE_PROJECT_CONFIG=1` skips project write entirely
- [ ] Manual verification — `OPENCODE_CONFIG_DIR=/proc/test` triggers safety-check warning toast at startup; project write suppressed
- [ ] Manual verification — induce project-write failure (chmod target read-only mid-session); assert persistent status indicator appears, toast on each failed save, indicator clears when permissions are restored and next save succeeds
- [ ] `bun test packages/opencode/test/config/model-persistence.test.ts` passes (all 20 cases)
- [ ] `bun turbo typecheck` passes
- [ ] Append the following paragraph to `packages/opencode/AGENTS.md` (audit f6-R5):
  > TUI model selections (`agent.<name>.model`) are persisted to project config (`.opencode/opencode.json`, walking up from cwd to git worktree). Only agents the user explicitly changes in the TUI session are written — `dirtyAgents: Set<string>` filtering prevents leaking the user's prior cross-project selections into a team config. The write target is auto-resolved via `Flag.OPENCODE_CONFIG` > `Flag.OPENCODE_CONFIG_DIR` > innermost existing project file > `.opencode/` dir > scaffold at worktree root, with a path-safety check refusing `/`, `/proc`, `/dev`, `/sys`, and paths above `$HOME` without an env override. Set `OPENCODE_DISABLE_PROJECT_CONFIG=1` to disable; `recent`/`favorite`/`variant` remain user-local. Write failures surface a persistent status indicator and retry the same `dirtyAgents` on the next change. `OPENCODE_CONFIG*` env var changes require a TUI restart to take effect at the cache layer.
- [ ] Document `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR` (write-side semantics + cache-staleness limitation requiring TUI restart) in the appropriate `packages/docs` env-var/configuration page (audit f9-R5). If no such page exists yet, append to `packages/opencode/AGENTS.md` env-var section alongside the paragraph above.
- [ ] Confirm `jsonc-parser` produces clean diffs on the project's actual `.opencode/opencode.jsonc` (visual inspection — `patchJsonc` reuses the same machinery as `updateGlobal`, so any layout that works for `updateGlobal` works here)

## Convergence Criteria

- All 20 new tests pass (`bun test packages/opencode/test/config/model-persistence.test.ts`)
- Existing tests still pass (`bun turbo typecheck`; relevant TUI/config suites)
- All eight manual verification scenarios pass
- `jsonc-parser` preserves comments and formatting in this repo's `.opencode/opencode.jsonc` (no surprise whitespace diffs vs `git diff`)
- Two consecutive clean audit passes from distinct agents against this plan
- All Phase-1 design items show `[x]`; all "verify" items resolved with documented findings or test coverage
- **SDK client regenerated** via `cd packages/sdk/js && bun run build`; `sdk.client.config.modelWriteTarget` and `sdk.client.config.updateProject` exist in `packages/sdk/js/src/v2/gen/sdk.gen.ts` (audit f3-R2)

## Test Command

```bash
bun test packages/opencode/test/config/model-persistence.test.ts
bun turbo typecheck
```

(Root `bun test` intentionally errors per `package.json:21` — always scope tests to a package.)

## Risks

1. **Diffs on tracked config files** — writing to a committed `opencode.json` shows in `git status`. Intentional default. `OPENCODE_DISABLE_PROJECT_CONFIG=1` is the escape hatch; `dirtyAgents` filtering ensures only the user's intentional changes appear in the diff.
2. **Scaffolding in unexpected places** — guarded by `isSafeTargetPath`. Scaffolds refuse `/`, `/proc`, `/dev`, `/sys`, or above `$HOME` without an env override. Info toast names the path so the user notices.
3. **Multi-TUI safety properties** (audit f7-R5, expanded): (a) each TUI sends only its own `dirtyAgents`, and `Config.updateProject` re-reads → deep-merges → writes, so concurrent edits to **different agents** by different TUIs merge correctly without clobbering. (b) Concurrent edits to the **same agent** within the read-merge-write window are last-writer-wins on that agent slot. (c) Atomic tmp+rename with unique tmp filenames per writer prevents partial-file corruption. (d) No file-level locking — a high-frequency external editor (IDE) writing the same file concurrently can still race; see Risk 6.
4. **JSONC diffs** — `patchJsonc` is the same helper as `updateGlobal`; behavior matches existing JSONC writes in the codebase.
5. **Cross-FS and Windows rename** — `writeAtomic` catches any rename failure and falls back to `copyFile` + `remove`. Test 14 exercises this path.
6. **External editor race** — user edits config in IDE while TUI saves. `Config.updateProject` re-reads the file inside the helper (no in-memory stale read), but a save can still clobber a concurrent external edit. Documented limitation; future work: file-watcher-based conflict detection.
7. **Read-after-write latency** — solved by explicit `sdk.client.config.get` re-fetch after successful `updateProject`. Test 16 covers this end-to-end.
8. **Server endpoint surface growth** — two new routes (`GET /config/model_write_target`, `POST /config/update_project`). The mutator can be reused by future "write to project config" features.
9. **Project context not loaded yet on first save** — `save()` requeues via `state.pending` until `project.instance.directory()` is populated by `ProjectProvider.sync()`. Same pattern as the existing `state.pending` flag.
10. **`dirtyAgents` not persisted across TUI crashes** (audit f5-R2) — `dirtyAgents` is a module-scope `Set` in `local.tsx`. If a project write fails and the TUI crashes or exits before the user makes another model change, the dirty set is lost; user state retains the new model but project config silently lags until the user re-touches that agent. Acceptable for v1 (the user can re-select to retry). Future hardening: persist `dirtyAgents` alongside `model/recent/favorite/variant` in user state, or on startup seed `dirtyAgents` with the diff between `modelStore.model` and `sync.data.config.agent.<name>.model`.
11. **TUI cache of `modelWriteTarget` is one-shot** (audit f4-R2) — `ProjectProvider.sync()` fetches the resolved target once at bootstrap. Changing `OPENCODE_CONFIG` / `OPENCODE_CONFIG_DIR` mid-session does NOT update the TUI's cached value; an opencode restart is required for the new env var to take effect at the TUI layer. The server-side `resolveModelWriteTarget` is re-evaluated per call, so direct API users see fresh values. Documented limitation.
12. **`markInstanceForDisposal` under rapid-fire saves** (audit f8-R5) — every successful `updateProject` HTTP call invokes `markInstanceForDisposal`. Rapid model cycling (`cycle()` at `local.tsx:248` can fire per-keystroke) can produce 5+ disposals within 100ms. Verify `markInstanceForDisposal` at `server/routes/instance/httpapi/lifecycle.ts` is idempotent and concurrent-safe; if not, add server-side debouncing of `updateProject` (coalesce within ~100ms) or convert disposal to a single-flight pattern. Spot-check during Phase 2 implementation; if not idempotent, this becomes a HIGH risk that must be addressed.

## Out of scope

- Persisting `recent` / `favorite` / `variant` to project config (user-scoped by design).
- Persisting session-pinned models (lives in `session.json`, separate mechanism).
- A migration command to move existing user-state model selections into project configs.
- A UI prompt on each change asking "save where?".
- File-watcher-based conflict detection for concurrent external edits.
- Server-emitted `config.changed` event for cross-client invalidation (deferred until a second writer appears).

## Notes on prior iterations

Two earlier files were superseded: `.cruxdev/build_plans/save-model-to-project-config.md` (engine bypass — deleted), and `build_plans/BUILD_PLAN_211_*.md` (allocated against a global counter before opencode was registered as a cruxdev project; renamed to BP-001 to start the opencode namespace cleanly).
