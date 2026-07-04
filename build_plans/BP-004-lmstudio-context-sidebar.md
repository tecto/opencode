# BP-004 — LM Studio context sidebar enrichment (context-window size + compaction-trigger indicator)

| | |
|---|---|
| **Status** | **CONVERGED — PARTIALLY BUILT** (2026-07-04). Plan converged through 3 audit rounds with 5 findings applied (R1); R2 + R3 two consecutive independent clean passes per DEVELOPMENT_PATTERNS.md §16C. Production code shipped as a live spike at `~/.opencode/bin/opencode` (`0.0.0-dev-202607042037`) and visually verified against `ornith-1.0-35b-mtp-apex` on LM Studio; the sidebar renders `6,668 / 131K tokens` and `5% used · compacts @ 94%` as designed. What remains for execution: extract the pure helpers to a sibling `context-utils.ts` for testability, write the 16 named tests below, land a proper commit with `Plan-Item:` trailer. |
| **Origin** | Bryan directive (2026-07-04) after live-testing the spike change to `packages/tui/src/feature-plugins/sidebar/context.tsx`: "use that as the basis for the next build plan … do it right with the discipline of a full build plan." Follows BP-003 (LM Studio context autoprobe) which populated the underlying `model.limit.context` field this sidebar now surfaces. |

## Scope

Enrich the Context sidebar so that (a) users can see the absolute context window size of the currently-active model in a K/M-formatted display (`131K`, `1.2M`) and (b) users can see, at a glance, the percentage-usage threshold at which opencode's auto-compaction will trigger. Both additions are conditional — they only render when the underlying data is populated (specifically: `model.limit.context > 0`), so pre-BP-003 configs or providers without known context limits fall back gracefully to the original single-line "N% used" display.

**IS NOT:**

- Making the "compacts @ N%" indicator account for a user-supplied `cfg.compaction?.reserved` override. The sidebar renders client-side and doesn't currently have the resolved config in scope; wiring that through would create fresh coupling for a rare case (users who explicitly set `reserved` are already advanced enough to compute the trigger by hand). The default path is what LM Studio users — the primary audience for this fix — hit.
- Redesigning the sidebar layout, changing colors, or introducing collapse/expand behavior. The additions are terse: one enrichment appended to each of two existing text lines, no new lines when data is absent.
- Adding config knobs. The two additions are always-on for models with a known context limit; there's no `sidebar_show_compaction_trigger: false` opt-out because the information density is already low.
- Server-side compaction changes. The trigger threshold displayed here is computed client-side to mirror `session/overflow.ts:14-19`; the actual overflow decision remains authoritative on the server.
- Populating `model.limit.context` for LM Studio-served models. That is BP-003's responsibility. BP-004 assumes BP-003 has landed (or the user has hardcoded `limit.context` in their opencode config).
- Making the trigger threshold reactive to plugin `experimental.session.compacting` hooks that might modify the compaction prompt/context. Those hooks don't change the trigger point, only the summarization behavior.

## Contract / Design

### Baseline — the currently-live spike code (per DEVELOPMENT_PATTERNS.md §3D)

Reproduced inline so a future session can apply the refactor delta without re-reading. This is the state at `packages/tui/src/feature-plugins/sidebar/context.tsx` after the spike swap on 2026-07-04 (96 lines total). Key surface — the `formatK` helper and the state memo:

```ts
// packages/tui/src/feature-plugins/sidebar/context.tsx (current spike)

const COMPACTION_BUFFER = 20_000

function formatK(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

const state = createMemo(() => {
  const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
  const providerID = last?.providerID ?? session()?.model?.providerID
  const modelID = last?.modelID ?? session()?.model?.id
  const model =
    providerID && modelID
      ? props.api.state.provider.find((item) => item.id === providerID)?.models[modelID]
      : undefined
  const contextLimit = model?.limit.context ?? 0
  const outputLimit = model?.limit.output ?? 0
  const reserved = outputLimit > 0 ? Math.min(COMPACTION_BUFFER, outputLimit) : COMPACTION_BUFFER
  const compactAt = contextLimit > 0 ? Math.round(((contextLimit - reserved) / contextLimit) * 100) : null

  if (!last) return { tokens: 0, percent: null, contextLimit, compactAt }
  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  return {
    tokens,
    percent: contextLimit > 0 ? Math.round((tokens / contextLimit) * 100) : null,
    contextLimit,
    compactAt,
  }
})
```

Render sites (the two text lines that gained the new information):

```tsx
<text fg={theme().textMuted}>
  {state().tokens.toLocaleString()}
  {state().contextLimit > 0 ? ` / ${formatK(state().contextLimit)}` : ""} tokens
</text>
<text fg={theme().textMuted}>
  {state().percent ?? 0}% used
  {state().compactAt !== null ? ` · compacts @ ${state().compactAt}%` : ""}
</text>
```

### Server-side authority the sidebar mirrors

The sidebar's `compactAt` computation mirrors `packages/opencode/src/session/overflow.ts:8-20` (unchanged; reproduced verbatim, closing brace of `usable()` at line 20 included per the closing-brace-inclusive convention):

```ts
const COMPACTION_BUFFER = 20_000

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const context = input.model.limit.context
  if (context === 0) return 0

  const reserved =
    input.cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}
```

The sidebar's approximation:

1. Uses `COMPACTION_BUFFER = 20_000` verbatim (the same numeric constant).
2. Approximates `ProviderTransform.maxOutputTokens(model)` as `model.limit.output` — for LM Studio-served models this equals what BP-003 populated (`min(loaded_context_length/4, 8192)`).
3. Ignores `cfg.compaction?.reserved` (the user-override branch). Rationale: the sidebar's plugin API surface (`TuiPluginApi`) does not currently expose the resolved config's compaction settings; the default path is the case this indicator was added for. Users who set a custom `reserved` see a slightly-off percentage — acceptable trade-off, documented inline.
4. Ignores the `model.limit.input` branch (the server uses `limit.input - reserved` when `limit.input` is set; LM Studio-served models do not populate `limit.input`, so this branch never fires for the primary audience).

### Refactor — extract for testability (the work this BP does)

The current spike inlines `formatK` and the state-computation logic inside the `View` component. Solid.js reactive primitives (`createMemo`, prop access) make the memo hard to unit-test in isolation. Per §19 (Modularity / DRY) and §2A (TDD first), refactor:

**New: `packages/tui/src/feature-plugins/sidebar/context-utils.ts`** — pure module exporting:

- `formatK(n: number): string` — the K/M formatter, verbatim from the current spike.
- `COMPACTION_BUFFER: 20_000` — the constant, exported so tests can reference it.
- `computeContextState(input: ContextStateInput): ContextState` — extracted pure state-computation logic. Takes a plain input record (no Solid.js reactive primitives) and returns the same `{ tokens, percent, contextLimit, compactAt }` shape the current memo produces.

Where `ContextStateInput` is:

```ts
export interface ContextStateInput {
  readonly lastAssistant?: {
    readonly providerID: string
    readonly modelID: string
    readonly tokens: {
      readonly input: number
      readonly output: number
      readonly reasoning: number
      readonly cache: { readonly read: number; readonly write: number }
    }
  }
  readonly sessionModel?: { readonly providerID: string; readonly id: string }
  readonly providers: ReadonlyArray<{
    readonly id: string
    readonly models: Readonly<
      Record<string, { readonly limit?: { readonly context?: number; readonly output?: number } }>
    >
  }>
}

export interface ContextState {
  readonly tokens: number
  readonly percent: number | null
  readonly contextLimit: number
  readonly compactAt: number | null
}
```

The `View` component's memo then collapses to:

```ts
const state = createMemo(() => {
  const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
  return computeContextState({
    lastAssistant: last
      ? { providerID: last.providerID, modelID: last.modelID, tokens: last.tokens }
      : undefined,
    sessionModel: session()?.model,
    providers: props.api.state.provider,
  })
})
```

**Baseline reference — existing test harness this BP reuses:**

- `packages/tui/test/feature-plugins/diff-viewer-file-tree-utils.test.ts` establishes the sibling pattern for testing extracted pure utilities from feature-plugins: `import { describe, expect, test } from "bun:test"` plus direct imports from `"../../src/feature-plugins/..."`. No Solid.js runtime, no fixture layer needed. Same pattern is used by BP-004's test file.
- `packages/tui/bunfig.toml` scopes the tui test runner. An established suite of `.test.ts(x)` files is already present under `packages/tui/test/` (recount live before landing rather than caching a number — the previous draft's "22 files" cache went stale as the suite grew).

## What was built / will be built

- **Live spike (already deployed):** `packages/tui/src/feature-plugins/sidebar/context.tsx` — inline `formatK` helper, `COMPACTION_BUFFER` constant, expanded `state` memo returning `{ tokens, percent, contextLimit, compactAt }`, and the two conditional-append text renders. Uncommitted. **This BP relands it as a proper commit AFTER the extraction below.**
- **New: `packages/tui/src/feature-plugins/sidebar/context-utils.ts`** — extracted `formatK`, `COMPACTION_BUFFER`, `computeContextState` per the signatures above. Pure module, no Solid.js dependency.
- **Modified: `packages/tui/src/feature-plugins/sidebar/context.tsx`** — imports the three exports from `./context-utils`, replaces the inline helper + memo body with a one-liner delegation to `computeContextState`. Net line count decreases; render sites unchanged.
- **New: `packages/tui/test/feature-plugins/sidebar/context-utils.test.ts`** — the 16 named tests (6 detection/formatK + 10 state computation) below, following the pattern established by `diff-viewer-file-tree-utils.test.ts`.

## Tests (test-first)

Named per DEVELOPMENT_PATTERNS.md §2C. Every test must exist and pass before this BP is COMPLETE.

**Test-file placement:** All 16 tests live in the single file `packages/tui/test/feature-plugins/sidebar/context-utils.test.ts` (created by this BP, matching the sibling utilities pattern at `test/feature-plugins/diff-viewer-file-tree-utils.test.ts`). All imports are direct — no Solid.js reactive primitives, no plugin API mock, no fixture layer required.

**`formatK` — number formatting:**

- `test_formatk_returns_dash_for_zero_or_negative` — `formatK(0)` → `"—"`, `formatK(-1)` → `"—"`.
- `test_formatk_returns_dash_for_non_finite` — `formatK(NaN)` → `"—"`, `formatK(Infinity)` → `"—"`.
- `test_formatk_preserves_small_numbers_below_thousand` — `formatK(999)` → `"999"`, `formatK(1)` → `"1"`.
- `test_formatk_rounds_thousands_to_k_suffix` — `formatK(1000)` → `"1K"`, `formatK(131072)` → `"131K"` (the motivating real-world value from BP-003's live probe of `ornith-1.0-35b-mtp-apex`), `formatK(65536)` → `"66K"` (motivating value from `gemma-4-26b-a4b-it-heretic`).
- `test_formatk_uses_m_suffix_for_millions_with_one_decimal` — `formatK(1_000_000)` → `"1M"` (trailing `.0` stripped), `formatK(1_200_000)` → `"1.2M"`, `formatK(2_000_000)` → `"2M"`.
- `test_formatk_transition_boundaries` — `formatK(999_999)` → `"1000K"` (below 1M threshold; rounds up from the K-branch), `formatK(1_000_000)` → `"1M"` (transitions to the M-branch).

**`computeContextState` — state computation:**

- `test_state_returns_zero_when_no_assistant_and_no_session_model` — no `lastAssistant`, no `sessionModel` → `{ tokens: 0, percent: null, contextLimit: 0, compactAt: null }` (the true first-launch state).
- `test_state_uses_session_model_context_when_no_assistant_yet` — no `lastAssistant`, `sessionModel: {providerID:"lmstudio",id:"ornith-1.0-35b-mtp-apex"}`, providers array contains that model with `limit.context: 131072, limit.output: 8192` → returns `{ tokens: 0, percent: null, contextLimit: 131072, compactAt: 94 }`. Pins that even before any assistant reply, the sidebar can show the context window size and compaction trigger.
- `test_state_prefers_last_assistant_provider_model_over_session_model` — `lastAssistant` and `sessionModel` point at *different* provider+model combinations → the `contextLimit` returned comes from the `lastAssistant`'s model, not the session's current model (matches the render intent: the % reflects the model that produced the token count).
- `test_state_computes_percent_from_summed_tokens` — `lastAssistant.tokens: {input:5000, output:1000, reasoning:500, cache:{read:100, write:68}}`, contextLimit 131072 → tokens 6668, percent `Math.round(6668/131072*100) = 5` — the exact live-verified numbers from the 2026-07-04 spike verification (`6,668 / 131K tokens · 5% used · compacts @ 94%`).
- `test_state_computes_compact_at_94_for_lmstudio_ornith_shape` — contextLimit 131072, outputLimit 8192 → reserved `min(20_000, 8192) = 8192`, compactAt `round((131072-8192)/131072*100) = 94`. The primary motivating case for this BP.
- `test_state_caps_reserved_at_compaction_buffer_when_output_limit_exceeds_it` — contextLimit 131072, outputLimit 32768 (strictly above the 20_000 buffer, so the cap actually bites) → reserved `min(20_000, 32_768) = 20_000` (NOT 32768), compactAt `round((131072-20000)/131072*100) = 85`. Falsifies an implementation that would use `outputLimit` uncapped; a boundary-exact value (e.g. `outputLimit: 20000`) would pass under an uncapped implementation too and wouldn't pin the cap.
- `test_state_falls_back_to_full_buffer_when_output_limit_zero` — outputLimit 0 → reserved defaults to `COMPACTION_BUFFER = 20_000` (does NOT collapse to zero), compactAt computed with the full buffer. Guards against a regression that would show `compacts @ 100%` when a provider fails to advertise an output cap.
- `test_state_returns_null_indicators_when_context_limit_zero` — model exists in providers array but `limit.context: 0` (pre-BP-003 LM Studio, or any misconfigured provider) → `contextLimit: 0, percent: null, compactAt: null`. Pins that the render's conditional-append correctly hides both new pieces.
- `test_state_returns_null_indicators_when_model_missing_from_providers_array` — providers list is empty or doesn't contain the referenced model → same as above (`contextLimit: 0, percent: null, compactAt: null`). Guards against a state-hydration race where the message arrives before the provider list.
- `test_state_returns_zero_context_when_model_limit_undefined` — providers array contains the referenced model but its `limit` field is undefined (plausible during partial state hydration, or with providers that expose only a subset of the `Model` shape) → `contextLimit: 0, percent: null, compactAt: null`, no throw. Pins that the implementation uses `model?.limit?.context ?? 0` and `model?.limit?.output ?? 0` (double optional-chain), not the single-chain `model?.limit.context ?? 0` the current live spike uses. The extraction refactor MUST tighten this — the runtime shape allows `limit` to be missing even when TypeScript's declared shape says otherwise, since `providers` flows from the SDK where downstream consumers can carry sparse metadata.

## Progress Tracker

Per DEVELOPMENT_PATTERNS.md §1F execution ordering. Each checkbox is one atomic step and gets checked in the plan file as it lands.

- [x] 1.1 Create `packages/tui/src/feature-plugins/sidebar/context-utils.ts` with four exports (`COMPACTION_BUFFER`, `formatK`, `computeContextState`, `ContextStateInput`, `ContextState`), all function bodies throw `"BP-004 STUB"`.
- [x] 2.1 Create `packages/tui/test/feature-plugins/sidebar/context-utils.test.ts` with all 16 named tests, importing from `../../../src/feature-plugins/sidebar/context-utils`.
- [x] 2.2 Verify RED — `bun test test/feature-plugins/sidebar/context-utils.test.ts` from `packages/tui` shows 16 failures with `BP-004 STUB` errors.
- [x] 3.1 Replace `formatK`'s stub body with the extraction from the spike code (identical logic).
- [x] 3.2 Replace `computeContextState`'s stub body with the extraction from the spike memo (identical logic, using double optional-chain on `limit?.context ?? 0` and `limit?.output ?? 0`).
- [x] 3.3 Verify GREEN — all 16 tests pass.
- [x] 4.1 Modify `packages/tui/src/feature-plugins/sidebar/context.tsx` to import `formatK` and `computeContextState` from `./context-utils`, drop the inline copies of both, and collapse the `state` memo body to a one-line delegation.
- [x] 4.2 Functional equivalence pinned by 16-test suite covering every branch (specifically `test_state_computes_percent_from_summed_tokens` and `test_state_computes_compact_at_94_for_lmstudio_ornith_shape`, which replay the exact `6,668 / 131K tokens · 5% used · compacts @ 94%` numbers observed on the spike). Binary rebuilt + swapped + launched in a fresh tmux; sidebar's fallback path (0 tokens / 0% used / $0.00 spent when model unresolved) renders identically to the pre-refactor version.
- [x] 5.1 `bun turbo typecheck` — 29/29 packages green.
- [x] 5.2 `bun test test/feature-plugins/sidebar/context-utils.test.ts` — 16 pass, 0 fail, 32 expect() calls.
- [x] 5.3 Commit with `Plan-Item: bp-004-lmstudio-context-sidebar` trailer.
- [ ] 6.1 Code audit pass 1 — fix all issues.
- [ ] 6.2 Code audit pass 2 — two consecutive independent clean passes per §16C.

## Plan Scope Manifest

| plan-item | paths | items |
|-----------|-------|-------|
| `bp-004-lmstudio-context-sidebar` | `packages/tui/src/feature-plugins/sidebar/context.tsx`, `packages/tui/src/feature-plugins/sidebar/context-utils.ts`, `packages/tui/test/feature-plugins/sidebar/context-utils.test.ts` | `formatK`, `COMPACTION_BUFFER`, `computeContextState`, `ContextStateInput`, `ContextState`, `View` component's state-memo body |

## Follow-on (NOT this BP)

- Make the `compacts @ N%` indicator honor a user's `cfg.compaction?.reserved` override. Requires plumbing the resolved config (or at least the compaction sub-tree) through `TuiPluginApi.state` — a fresh coupling worth deferring until a user actually reports the discrepancy.
- Colorize the `N% used` figure by proximity to `compactAt` (e.g. yellow at 75% of trigger, red at trigger). Would need theme-color extraction and possibly a threshold config knob.
- Show the `reserved` value explicitly (e.g. `128K available · 8K reserved`) rather than the derived percentage. Higher information density but potentially confusing without a legend.
- Extend the same K/M-formatted display to the footer chip that today renders `6.7K (5%)` on the bottom bar — same math applies but different render location. Would be a straightforward sibling BP once this one lands.
- Add an SDK-level `Model` type export for `{ limit: { context: number; output: number } }` so `ContextStateInput.providers` doesn't need its own structural definition. Currently inlined because the SDK's `Provider` v2 type shape includes many fields the sidebar doesn't need.
- Persist the last-seen `contextLimit` to state so the sidebar remains informative during the LM Studio probe's `~200ms` window at layer-init (currently reads `0` for that window). Small optimization; deferred until measured as annoying.

## Constraints (from reference/DEVELOPMENT_PATTERNS.md)

- **TDD/BDD for everything** (§0D, §2A). Every test named above must exist and be RED before the extraction refactor is applied. Order: (1) create `context-utils.ts` with the same three exports the tests call, but bodies that throw `"BP-004 STUB"`; (2) write all 16 tests (RED); (3) fill in the extracted bodies, replaying the exact logic from the current spike (GREEN); (4) delete the inline copies from `context.tsx` and replace with the import + one-line delegation. **The spike code currently deployed at `~/.opencode/bin/opencode` is NOT part of the RED-GREEN cycle** — it's an out-of-band verification artifact whose logic this BP recreates test-first.
- **Reference existing code by `file:line`** (§1E, §3D). All references above cite line numbers at `dev` tip `237567066` (the tip when BP-003 landed and the spike sits on top of). Content-match remains authoritative — the sibling test file pattern reference points at `packages/tui/test/feature-plugins/diff-viewer-file-tree-utils.test.ts` unchanged since 2026-06-15.
- **Modularity / DRY** (§19). Two small pure helpers plus one state-computation function, all in a single sibling `context-utils.ts`. `View` collapses from ~50 lines of memo body to ~8 lines of delegation. No coupling to Solid.js reactive primitives inside the testable surface.
- **Two consecutive independent clean audit passes** for convergence (§16C). BP-004 is a small compact-format plan — expect 2-4 audit rounds before convergence (versus BP-003's 22, which was invoked to establish the discipline).
- **Landing commit carries `Plan-Item: bp-004-lmstudio-context-sidebar` trailer** per BUILD_PLAN_TEMPLATE.md "Landing commits" section — every commit touching `packages/tui/src/feature-plugins/sidebar/**` or `packages/tui/test/feature-plugins/sidebar/**` for this BP names this manifest row.
- **Related BP:** BP-003 (LM Studio context autoprobe) is a prerequisite in practice — this sidebar's `contextLimit > 0` conditional only fires for LM Studio-served models after BP-003 lands. However BP-004 is not blocked by BP-003 mechanically: for non-LM-Studio providers with hardcoded `limit.context`, the sidebar enrichment works immediately.

## No external research required

Per `reference/RESEARCH_PROCESS_HANDOFF.md`'s 6-pass methodology: this fix is a UI-layer enrichment mirroring an existing server-side formula. The formula (`context - min(20_000, output)`) was captured directly from `packages/opencode/src/session/overflow.ts:14-19` at `dev` tip `237567066`; the trigger percentage was verified against the spike's live render on `ornith-1.0-35b-mtp-apex` (`131072` context → `94%` trigger, observed on 2026-07-04). No academic or practitioner research would add signal beyond what direct code inspection and live verification already established.
