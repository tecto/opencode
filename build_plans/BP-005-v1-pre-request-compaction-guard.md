# BP-005 — pre-request compaction guard (V1)

**UUID:** `2df7f10f`. **Type:** FIX-BP.
**Lifecycle: EXECUTED**

| | |
|---|---|
| **Status** | **PLANNED** (2026-07-31). V1 prompt loop has no pre-request context estimation; sessions hit "context exceeded" before reactive compaction can fire. |
| **Origin** | User-reported: recurring `Engine protocol predict stream returned an error: {"code":500,"message":"Context size has been exceeded."}` despite auto-compaction being enabled. Investigation found V1 prompt loop (`packages/opencode/src/session/prompt.ts`) never calls `compactIfNeeded` or equivalent before sending to the LLM — it only checks `isOverflow` **after** receiving tokens from an assistant response (line 1164), which is too late if context grows past the limit between turns. |

## Scope

Add a pre-request token estimation + compaction trigger to the V1 prompt loop, mirroring the existing V2 runner's behavior at `packages/core/src/session/runner/llm.ts:215`. This ensures sessions compact **before** sending an LLM request that would exceed context.

IS NOT fixing LM Studio probing (BP-003 covers that).
IS NOT changing compaction summary generation or tail selection logic.
IS NOT touching the V2 runner path.

## Contract / Design

### Current flow (V1 — broken)

```
loop iteration:
  msgs = load recent messages
  model = resolve model
  [1164] if isOverflow(tokens_from_last_response, model): create compaction task → continue
  build assistant message
  process via LLM stream ← NO PRE-REQUEST CHECK. If context > limit, provider rejects.
```

### Target flow (V1 — fixed)

```
loop iteration:
  msgs = load recent messages
  model = resolve model
  [NEW] if estimateContext(msgs, model) > usable(model): create compaction task → continue
  [1164] if isOverflow(tokens_from_last_response, model): create compaction task → continue
  build assistant message
  process via LLM stream ← pre-request guard fires first; only sends when under limit.
```

The V2 runner uses `SessionCompaction.compactIfNeeded` which does: estimate → compare against `context - max(output, buffer)` → trigger compaction if over threshold. We need the equivalent for V1's model shape (`Provider.Model`).

### Implementation

**File:** `packages/opencode/src/session/compaction.ts` — add a new method to the Interface and implementation:

```ts
// Add to Interface (line ~130)
readonly estimateAndCompactIfNeeded: (input: {
  messages: SessionV1.WithParts[]
  model: Provider.Model
}) => Effect.Effect<boolean> // true if compaction was triggered, false if safe
```

Implementation mirrors V2's `compactIfNeeded` logic but uses V1's `estimate()` helper and `Provider.Model`. The session context (`sessionID`, agent) and the V2 ID constructor must be injected into the implementation closure via parameters or dependency injection, as they are not in scope within `compaction.ts`:

```ts
import { ProviderTransform } from "../core/src/session/transform"

const estimateAndCompactIfNeeded = Effect.fn("SessionCompaction.estimateAndCompactIfNeeded")(function* (input: {
  messages: SessionV1.WithParts[]
  model: Provider.Model
}) {
  const config = yield* config.get()
  if (!config.compaction?.auto) return false
  const context = input.model.limit.context
  if (context === undefined || context <= 0) return false
  const output = input.model.limit.output ?? ProviderTransform.OUTPUT_TOKEN_MAX
  const estimatedTokens = yield* estimate({ messages: input.messages, model: input.model })
  const usableContext = Math.max(0, context - Math.max(output, config.compaction?.reserved ?? COMPACTION_BUFFER))
  if (estimatedTokens <= usableContext) return false
  // Trigger compaction via create → loop will pick up the task next iteration
  yield* create({
    sessionID: injectedSessionContext.sessionID,
    agent: injectedSessionContext.agent,
    model: { providerID: input.model.providerID, modelID: ModelV2.ID.make(input.model.id) },
    auto: true,
  })
  return true
})
```

**File:** `packages/opencode/src/session/prompt.ts` — insert check at line ~1141 (after model resolution, before compaction task handling):

```ts
// After: const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
// Insert BEFORE the existing isOverflow check at 1161-1168

const estimatedCompact = yield* compaction.estimateAndCompactIfNeeded({ messages: msgs, model })
if (estimatedCompact) continue  // compaction task was created; loop will handle it next iteration

if (
  lastFinished &&
  lastFinished.summary !== true &&
  (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
) {
  yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
  continue
}
```

### Why not reuse V2's `compactIfNeeded` directly?

The V2 version expects `LLMRequest` shape (system/messages/tools arrays), while V1 works with `SessionV1.WithParts[]`. The serialization paths differ. A parallel implementation using V1's existing `estimate()` helper avoids cross-wiring dependencies and keeps the fix scoped to V1 session files.

## What was built / will be built
- New method `estimateAndCompactIfNeeded` on `packages/opencode/src/session/compaction.ts` Interface + Service implementation
- Pre-request check call in `packages/opencode/src/session/prompt.ts` loop, before the LLM stream starts

## Tests (test-first)
- `test_compaction_estimate_and_compact_if_needed_returns_false_when_under_limit` — messages within usable context → false, no side effects
- `test_compaction_estimate_and_compact_if_needed_triggers_create_when_over_limit` — estimated tokens exceed limit → calls create with auto:true
- `test_compaction_estimate_and_compact_if_needed_skips_when_disabled` — config.compaction.auto=false → returns false immediately
- `test_compaction_estimate_and_compact_if_needed_skips_when_context_zero` — model.limit.context=0 → returns false
- `test_prompt_loop_runs_pre_request_check_before_llm_stream` — integration: with messages near limit, loop should create compaction task before attempting LLM call

## Plan Scope Manifest
| plan-item | paths | items |
|-----------|-------|-------|
| add-method-to-interface | `packages/opencode/src/session/compaction.ts` | `Interface.estimateAndCompactIfNeeded`, `Service.estimateAndCompactIfNeeded` |
| insert-pre-request-call | `packages/opencode/src/session/prompt.ts` | loop body ~line 1141–1160 |
| tests | `packages/opencode/test/unit/compaction.test.ts`, `packages/opencode/test/integration/prompt-loop-integration.test.ts` | compaction + prompt integration |

## Follow-on (NOT this BP)
- Fix the underlying LM Studio probe reliability issue when a model isn't loaded yet (BP-003 handles detection; this doesn't fix missing context at runtime)
- Unify V1 and V2 compaction code paths into one shared module — currently they duplicate logic with different data shapes
- Add actual tokenizer-based estimation instead of `JSON.stringify().length / 4` heuristic