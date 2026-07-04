# BP-003 — LM Studio context autoprobe (auto-compaction for local models)

| | |
|---|---|
| **Status** | **CONVERGED — NOT STARTED** (2026-06-24, 2026-07-03 convergence). Design captured; ready for TDD execution. Plan converged through 22 audit rounds with 41 findings applied (R1–R20 fixes; R21 + R22 two consecutive independent clean passes per DEVELOPMENT_PATTERNS.md §16C). |
| **Origin** | Bryan directive (2026-06-24): fix opencode silently disabling auto-compaction for LM Studio users because it never discovers the model's loaded context length. Follows historical `BUILD_PLAN_001` (TUI model persistence, commit `96cd991a1`) and `BUILD_PLAN_002` (system prompt trim, commit `d624f4b58`); first plan authored under the new `BP-<NNN>-<slug>.md` naming from `reference/BUILD_PLAN_TEMPLATE.md`. |

## Scope

Auto-populate `model.limit.context` (and a safe `model.limit.output`) for models served by LM Studio by probing LM Studio's native `/api/v0/models` endpoint at provider-layer initialization. Result: opencode's existing auto-compaction path — which today short-circuits to no-op when `model.limit.context === 0` — triggers correctly for LM Studio users without them having to hardcode `limit.context` per model.

**IS NOT:**

- Adding new compaction/pruning knobs. `reserved` is already auto-derived at `packages/opencode/src/session/overflow.ts:14-16` (`min(COMPACTION_BUFFER=20_000, maxOutputTokens)` when `compaction.reserved` is unset). `prune` remains opt-in by design — aggressive tool-output removal has real data-loss risk and is a legitimate policy choice, not a bug.
- Refactoring `provider/provider.ts`'s model catalog shape. Fields (`limit.context`, `limit.output`) already exist at `packages/opencode/src/provider/provider.ts:1468-1472`; this fix only populates them from a new source when the config leaves them at 0.
- Universal probes for other OpenAI-compatible local endpoints (llama.cpp server, vLLM, Ollama). The detection heuristic is LM Studio-specific because the introspection endpoint is LM Studio-specific; siblings can follow in a later BP if requested.
- Live re-probing during a running session when the user swaps models inside LM Studio. Probe runs at layer init; TUI restart picks up new limits. Live re-probe is in Follow-on.
- Changing anything for cloud providers (Anthropic, OpenAI, OpenRouter). Regression test guards against this.

## Contract / Design

### Baseline — code this fix DOES NOT change but depends on

Documented per DEVELOPMENT_PATTERNS.md §3D so a future session can apply the delta without re-reading source.

**`packages/opencode/src/session/overflow.ts:8-20` (unchanged):**

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

**`packages/opencode/src/session/overflow.ts:22-34` (unchanged) — the bug surface:**

```ts
export function isOverflow(input: {...}) {
  if (input.cfg.compaction?.auto === false) return false
  if (input.model.limit.context === 0) return false   // ← the silent-disable line
  const count = input.tokens.total || ...
  return count >= usable(input)
}
```

The line stays. This BP makes `input.model.limit.context` non-zero for LM Studio so the guard passes and compaction fires.

**`packages/opencode/src/provider/provider.ts` — the two sites that both change:**

Site A — the OUTER "extend database from config" loop at line 1395 opens the provider iteration. The probe MUST run once here per LM-Studio-matching provider, hoisted BEFORE the inner model loop, so the memoization contract holds (see `test_provider_layer_memoizes_probe_per_provider`):

```ts
// extend database from config
for (const [providerID, provider] of configProviders) {
  const existing = database[providerID]
  const parsed: Info = { ... }

  // NEW: hoisted probe — one HTTP round-trip per LM-Studio provider,
  // BEFORE the inner model loop. Uses the same yield* Effect.promise
  // idiom already used at line 1379 for plugin model resolution.
  // Guards: skip probe when the provider is filtered by EITHER
  // `disabled_providers` OR a non-empty `enabled_providers` that
  // omits this ID. Reuse the existing `isProviderAllowed(id)` helper
  // at provider.ts:1361-1365 — it encodes both gates and is called
  // symmetrically at provider.ts:1564 and 1579 (both of those sites
  // brand the id first via `ProviderV2.ID.make(...)`; `providerID`
  // here is a raw `string` from `Object.entries(cfg.provider ?? {})`
  // so the same brand cast is required). Also skip when detection
  // fails. `isLMStudioProvider(key: string, ...)` takes the unbranded
  // key directly — no cast needed there.
  const baseURL =
    typeof parsed.options?.["baseURL"] === "string" && parsed.options["baseURL"] !== ""
      ? parsed.options["baseURL"]
      : ""
  const probed =
    isProviderAllowed(ProviderV2.ID.make(providerID)) && isLMStudioProvider(providerID, parsed)
      ? yield* Effect.promise(() => probeLMStudio(baseURL))
      : undefined

  for (const [modelID, model] of Object.entries(provider.models ?? {})) {
    // ... existing model-merge logic ...
```

Site B — the inner `parsedModel.limit` assignment at line 1468-1472 consumes the hoisted `probed` Map:

```ts
// BEFORE (current):
limit: {
  context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
  input: model.limit?.input ?? existingModel?.limit?.input,
  output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
},

// AFTER (with the probe merge):
limit: applyProbeMergeToLimit(
  {
    context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
    input: model.limit?.input ?? existingModel?.limit?.input,
    output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
  },
  probed?.get(String(model.id ?? modelID).toLowerCase()),
),
```

Where `applyProbeMergeToLimit(existing, probed)` is `applyProbeToModel` from the probe module, adapted to preserve the `input` field. Config-supplied limits still win — the probe only fills zeros. Providers that don't match the LM Studio heuristic pass `probed === undefined` and the merge is a no-op.

### LM Studio detection heuristic

A provider is treated as LM Studio-backed if ANY of the following hold (all string checks case-insensitive; leading/trailing whitespace handling is NOT part of the contract — a config with `"name": " lmstudio "` returns false; users who whitespace their config keys are on their own):

1. Provider registry key (the `cfg.provider` object key, i.e. `providerID` from `Object.entries(cfg.provider ?? {})` at `provider.ts:1357/1395`, e.g. `"lmstudio"`) matches `/^lm[-_ ]?studio$/i`.
2. `provider.name` contains `"lm studio"` or `"lmstudio"` (my own live config has `"name": "LM Studio (local)"` — substring match survives that).
3. `provider.options.baseURL` — first `typeof === "string" && !== ""` guarded (matching the codebase's own defensive idiom at `provider.ts:1666`, because `Info.options` is `Schema.Record(Schema.String, Schema.Any)` so `baseURL` is `any` at runtime and a malformed user config could carry a number/object/null there without TypeScript catching it), then the guarded string is matched against `^https?://(127\.0\.0\.1|localhost)(:\d+)?/v1/?$` — any local `/v1` root; default port is 1234 but users retarget so port is unconstrained. `0.0.0.0` is not accepted here because users bind LM Studio to `0.0.0.0` only for external accessibility; on the client side the config always names `127.0.0.1` or `localhost` or an explicit LAN IP (LAN IPs are out of scope — those users have knowingly customized and can hardcode `limit.context` per model). Any non-string value → false; no `.trim()`/`.match()` call is ever made against a non-string.

Non-match → return early; provider registration is byte-identical to today.

### The probe

`GET {baseOrigin}/api/v0/models` where `baseOrigin` is the `baseURL` with `/v1` stripped (LM Studio's native API sibling of the OpenAI-compat surface). Verified 2026-06-24 against the live daemon in this repo: the endpoint returns `{ data: [{ id, state, max_context_length, ... }] }`. **Field-presence detail worth pinning:** for models with `state: "loaded"`, `loaded_context_length` is present as a number; for models with `state: "not-loaded"`, the `loaded_context_length` key is typically **omitted entirely from the JSON object** — not present-and-`null`. `??` handles both cases identically, but the tests below must cover the key-absent shape explicitly (see `test_probe_falls_back_to_max_when_loaded_context_length_absent`).

- Timeout: `AbortSignal.timeout(3000)` — LM Studio is local; anything slower is broken.
- No auth headers (LM Studio's native API is unauthenticated by default).
- Response parsed leniently: `data` must be an array; each entry needs a string `id` and a numeric `loaded_context_length` OR `max_context_length`.
- Per matching model (matched by config `modelID` case-insensitive against `data[i].id`), the probe surfaces:
  - `context = data[i].loaded_context_length ?? data[i].max_context_length` (loaded wins because loaded is what the model can actually accept right now; falls back to max when the model isn't currently loaded).
  - `output = Math.min(Math.floor(context / 4), 8_192)` — LM Studio does not expose an output cap. Fraction of context caps large-context models from claiming 65k output; 8k floor is enough headroom for typical tool outputs.

On any failure (fetch throw, timeout, non-200, malformed JSON, missing fields): return an empty `Map<string, {context, output}>`, log at INFO with the specific failure reason. Zero exceptions bubble to caller — the fix is best-effort by design.

**Out-of-scope failure modes explicitly accepted (won't crash, won't corrupt):**
- A user config with `baseURL` already ending in `/api/v0/models` instead of `/v1` — the `/v1` strip is a no-op, the probe hits `.../api/v0/models/api/v0/models` and gets a 404, and the standard "non-200 → empty map" fallback fires. No test needed; degrades gracefully to the same behavior as LM Studio not running.
- An entry whose `id` is the empty string (with valid context fields) — survives into the returned Map under key `""`. Harmless because no `applyProbeToModel` call site will ever look up `""` (config `model.id` cannot be empty in schema).
- A provider matched by detection criterion 1 (registry key) or 2 (name) but with NO valid `options.baseURL` — Site A's baseURL normalization yields `""`, and `probeLMStudio("")` is invoked. The probe's fetch call rejects synchronously (relative URL with no base), the outer try/catch returns an empty Map, and the normal empty-map path fires. This is pinned by `test_probe_returns_empty_map_for_empty_baseurl` in the probe test group so the behavior isn't left implicit.

### Config-wins merge

```ts
function applyProbeToModel(
  existing: { context: number; output: number },
  probed: { context: number; output: number } | undefined,
): { context: number; output: number } {
  if (!probed) return existing
  return {
    context: existing.context > 0 ? existing.context : probed.context,
    output: existing.output > 0 ? existing.output : probed.output,
  }
}
```

`existing` is the pre-probe merged value from `model.limit?.context ?? existingModel?.limit?.context ?? 0`. If the user (or an upstream catalog entry) supplied a non-zero limit, it wins — the probe never overrides explicit config.

### Memoization

One HTTP round-trip per provider per layer construction, not per model. A provider with 6 registered models yields 1 fetch. Achieved implicitly by hoisting the probe call to Site A — the outer `for (const [providerID, provider] of configProviders)` loop already visits each `providerID` exactly once per layer construction, so `probed` is naturally computed once per provider and reused across every model iteration of the inner Site B loop. No explicit `Map<providerKey, Promise<...>>` cache structure is built (nothing in the plan's exports or tests exercises one). Cross-invocation reuse across multiple `Provider.layer` builds is intentionally NOT supported — each layer construction re-probes so a restart picks up new LM Studio state; that's the design.

## What was built / will be built

- **New: `packages/opencode/src/provider/lmstudio-probe.ts`** — pure probe module. Public exports:
  - `isLMStudioProvider(key: string, cfg: { name?: string; options?: Record<string, unknown> }): boolean` — heuristic detector. `options` typed as `Record<string, unknown>` (not `{ baseURL?: string }`) so implementation is forced to `typeof`-guard `options["baseURL"]` — matches `Info.options`'s runtime shape (`Schema.Record(Schema.String, Schema.Any)` at `provider.ts:1041`; the same shape recurs at `Model.options` at `provider.ts:1028` — repo-wide pattern) and eliminates the "TypeScript trusted us on `string` but the runtime handed us a number" hazard.
  - `probeLMStudio(baseURL: string, opts?: { timeoutMs?: number }): Promise<Map<string, { context: number; output: number }>>` — HTTP fetch; default `opts.timeoutMs = 3000`; returns `id → limits` map keyed by case-folded `id`; returns empty Map on any failure. `opts` is optional and used only by tests to inject a short timeout budget (see `test_probe_returns_empty_map_on_timeout`).
  - `applyProbeToModel(existing: { context: number; output: number }, probed?: { context: number; output: number }): { context: number; output: number }` — pure two-field config-wins merge, no `input` field. Handles `probed === undefined` (returned by `probed?.get(missingKey)` at the caller) as a no-op passthrough.
  - `applyProbeMergeToLimit(existing: { context: number; input?: number; output: number }, probed?: { context: number; output: number }): { context: number; input?: number; output: number }` — thin three-field adapter used at Site B. Passes `input` through unchanged (probe never populates it); delegates `context` and `output` to `applyProbeToModel`'s config-wins rule. Lives in the same `lmstudio-probe.ts` module so the merge policy has one source of truth.
- **Modified: `packages/opencode/src/provider/provider.ts` at line ~1468-1472** — memoized probe invocation. Detect LM Studio once per provider; probe once per provider; per-model, call `applyProbeToModel` in the `parsedModel.limit` assignment path.
- **New: `packages/opencode/test/provider/lmstudio-probe.test.ts`** — unit tests using a mock HTTP server (via `http.createServer` scoped to a random port + `provideTmpdirInstance`-style Effect scope for cleanup). Exercises every branch of the four exported functions (`isLMStudioProvider`, `probeLMStudio`, `applyProbeToModel`, `applyProbeMergeToLimit`) plus the five integration tests that spin up the provider layer against a mock LM Studio (populate, non-lmstudio no-op, config-wins, memoization, disabled-provider skip) and one regression test pinning `isOverflow` fires when the probed context is populated.

## Tests (test-first)

Named per DEVELOPMENT_PATTERNS.md §2C (test-list format: grouped by concern, one `test_<verb>_<condition>` bullet each). Every test must exist and pass before this BP is COMPLETE.

**Test-file placement:** All 43 tests below — including the 5 integration tests and the 1 regression test — live in the single file `packages/opencode/test/provider/lmstudio-probe.test.ts` listed in the Plan Scope Manifest. The regression test imports `isOverflow` directly from `@/session/overflow` (it's a plain sync export at `overflow.ts:22`, no Effect layer needed to invoke) — moving that test into `test/session/**` would create a manifest path not listed in `bp-003-lmstudio-probe`'s `paths` column and fail `bp_scope_gate.py`'s trailer-scope check. Keep it here.

**Existing test fixtures to reuse (cited inline per §1E so a future session does not rediscover them):**
- Provider layer composition: `packages/opencode/test/provider/provider.test.ts:60-68` — reference composition of `Provider.layer` with FSUtil / Env / Config / Auth / Plugin / ModelsDev / RuntimeFlags. The 5 integration tests use the same composition, extended with a mock LM Studio HTTP server.
- Provider config fixture: `packages/opencode/test/lib/test-provider.ts:9-37` — `testProviderConfig` helper for injecting a config into that layer.
- HTTP mock server pattern: `packages/opencode/test/provider/header-timeout.test.ts` — establishes the `http.createServer` + random-port + `scoped` fixture idiom the integration tests need to run without touching the real LM Studio daemon.

**`packages/opencode/test/provider/lmstudio-probe.test.ts` — detection:**

- `test_detects_by_registry_key_lmstudio` — key `"lmstudio"` → true.
- `test_detects_by_registry_key_lm_studio_hyphen` — key `"lm-studio"` → true.
- `test_detects_by_registry_key_case_insensitive` — key `"LMStudio"` → true.
- `test_detects_by_name_substring` — name `"LM Studio (local)"` (my live config's actual name) → true.
- `test_detects_by_baseurl_default_port` — `http://127.0.0.1:1234/v1` → true; also `http://localhost:1234/v1`.
- `test_detects_by_baseurl_custom_port` — `http://127.0.0.1:5555/v1` → true.
- `test_detects_by_baseurl_with_trailing_slash` — `http://127.0.0.1:1234/v1/` → true.
- `test_rejects_remote_baseurl_even_if_v1_shape` — `https://api.example.com/v1` → false.
- `test_rejects_non_v1_local_baseurl` — `http://127.0.0.1:1234/v2` → false.
- `test_rejects_when_no_signals` — key `"openai"`, name `"OpenAI"`, no baseURL → false.
- `test_detects_handles_undefined_name_field` — key non-match, `provider.name === undefined`, baseURL matches local `/v1` → true (no null-ref crash on the name check).
- `test_detects_handles_undefined_options_field` — key match `"lmstudio"`, `provider.options === undefined` → true (no null-ref crash on the options.baseURL check).
- `test_detects_returns_false_when_baseurl_is_non_string_value` — key/name have no LM Studio signals; `provider.options.baseURL` is a number (`1234`), an object (`{}`), a boolean (`true`), or `null` → all four return false. Guards against the `typeof`-guard being omitted (would throw mid-loop for every user with a malformed config, not just LM Studio users).

**`packages/opencode/test/provider/lmstudio-probe.test.ts` — probe:**

- `test_probe_returns_map_from_valid_response_prefers_loaded` — mock returns `loaded_context_length: 131072, max_context_length: 262144` → probed context is 131072.
- `test_probe_falls_back_to_max_when_loaded_null` — mock returns `state: "not-loaded", loaded_context_length: null, max_context_length: 262144` → probed context is 262144.
- `test_probe_falls_back_to_max_when_loaded_context_length_absent` — mock returns `{ id, state: "not-loaded", max_context_length: 262144 }` with **no** `loaded_context_length` key at all (matches the real LM Studio response shape for unloaded models per the 2026-06-24 live probe) → probed context is 262144.
- `test_probe_derives_output_from_context` — probed context 131072 → probed output 8192 (capped, not `131072/4 = 32768`).
- `test_probe_derives_output_uncapped_for_small_context` — probed context 8000 → probed output 2000.
- `test_probe_returns_empty_map_on_http_500` — mock returns 500 → empty map, no throw.
- `test_probe_returns_empty_map_on_connection_refused` — port unbound → empty map, no throw.
- `test_probe_returns_empty_map_for_empty_baseurl` — `probeLMStudio("")` → empty map, no throw. Reachable when the detection heuristic matches on registry key or name (criteria 1/2) but the user's config has no `options.baseURL` (or a non-string that got normalized to `""` in Site A). Pins the empty-string branch of the general "any failure → empty map" contract as an explicit test rather than an inferred behavior.
- `test_probe_returns_empty_map_on_timeout` — probe called with `opts.timeoutMs: 100`, mock delays response 500 ms → probe returns empty Map within ~150 ms of invocation, no throw. Test asserts wall-clock < 300 ms so a regression that breaks the injection is caught. (Injectable timeout per Constraints below.)
- `test_probe_returns_empty_map_on_malformed_json` — mock returns `not-json` → empty map, no throw.
- `test_probe_returns_empty_map_on_missing_data_field` — mock returns `{"nope":true}` → empty map, no throw.
- `test_probe_returns_empty_map_when_data_is_null` — mock returns `{"data": null}` (valid JSON, key present but null — distinct from missing-`data` and from malformed-JSON cases) → empty map, no throw.
- `test_probe_skips_entries_without_context_fields` — mock has one entry with `id` only → that entry is absent from the map, siblings survive.
- `test_probe_strips_v1_from_baseurl` — probe called with `http://127.0.0.1:1234/v1` hits `http://127.0.0.1:1234/api/v0/models` (asserted by mock server's request log).
- `test_probe_matches_model_id_containing_slash_or_at_suffix` — mock returns entries with real-shape IDs like `openai/gpt-oss-20b` and `ornith-1.0-35b@q4_k_m` (both observed in the 2026-06-24 live probe); returned Map keys preserve those IDs verbatim (case-folded) so `applyProbeToModel` can find them when the config's `model.id` uses the same shape.
- `test_probe_handles_mixed_loaded_and_not_loaded_entries_in_one_response` — mock returns a `data` array with BOTH shapes in one payload: one entry `{ id: "a", state: "loaded", loaded_context_length: 131072, max_context_length: 262144 }` and one entry `{ id: "b", state: "not-loaded", max_context_length: 32768 }` (no `loaded_context_length` key at all). Returned Map has `a → { context: 131072, ... }` (loaded wins) and `b → { context: 32768, ... }` (fallback fires). Pins the exact real-world shape from the 2026-06-24 live probe (25 not-loaded + 1 loaded in one response) — the literal case that motivated this BP.
- `test_probe_returns_empty_map_when_data_is_empty_array` — mock returns `{"data": []}` (LM Studio running with zero models installed/loaded — plausible real state, distinct from missing-`data` and `data: null`) → empty Map, no throw.

**`packages/opencode/test/provider/lmstudio-probe.test.ts` — merge:**

- `test_apply_uses_probed_context_when_existing_zero` — targets `applyProbeToModel({context:0, output:4096}, {context:131072, output:8192})` → `{context:131072, output:4096}`. Isolates the context-populate branch: existing.output is nonzero (4096) so the output axis is held fixed, and the only field the merge changes is `context`. Asserts `result.context === 131072`.
- `test_apply_preserves_existing_context_when_nonzero` — targets `applyProbeToModel({context:32000, output:4096}, {context:262144, output:8192})` → `{context:32000, output:4096}`. Asserts `result.context === 32000`; user-hardcoded 32000 wins over probed 262144.
- `test_apply_uses_probed_output_when_existing_zero` — targets `applyProbeToModel({context:50000, output:0}, {context:200000, output:6144})` → `{context:50000, output:6144}`. Isolates the output-populate branch: existing.context is nonzero (50000) so the context axis is held fixed, and the only field the merge changes is `output`. Asserts `result.output === 6144`. Distinct concrete numbers from `test_apply_uses_probed_context_when_existing_zero` and `test_apply_preserves_existing_context_when_nonzero` so accidental duplicate coverage of the same corner (identical inputs asserting different fields) is caught by inspection.
- `test_apply_preserves_existing_output_when_nonzero` — targets `applyProbeToModel({context:20000, output:2000}, {context:64000, output:4096})` → `{context:20000, output:2000}`. Asserts `result.output === 2000`; user-hardcoded 2000 wins over probed 4096. Distinct numeric pair from `test_apply_uses_probed_context_when_existing_zero`, `test_apply_preserves_existing_context_when_nonzero`, and `test_apply_uses_probed_output_when_existing_zero` (existing.context AND existing.output both nonzero — the fourth corner of the two-axis truth table, complementing `test_apply_preserves_existing_context_when_nonzero`'s context-preserve assertion with an output-preserve assertion at a different magnitude).
- `test_apply_returns_existing_when_probed_undefined` — targets `applyProbeToModel({context:0,output:0}, undefined)` → `{context:0,output:0}`; model not in probe result → limits untouched (this pins the `probed?.get(missing)` → `undefined` → passthrough contract at Site B).
- `test_apply_uses_probed_context_and_output_when_both_existing_zero` — targets `applyProbeToModel({context:0, output:0}, {context:131072, output:8192})` → `{context:131072, output:8192}`. Asserts BOTH `result.context === 131072` AND `result.output === 8192`. This is the motivating real-world scenario for the entire BP: a brand-new LM Studio model with no user-supplied limits (`limit.context: 0`, `limit.output: 0`) hits both populate branches simultaneously. Previously covered only transitively through `test_apply_merge_preserves_input_field` (the `applyProbeMergeToLimit` adapter) and the integration test — per §19 each pure function must be independently verified so a future refactor decoupling the adapter's internals from `applyProbeToModel` can't silently lose this corner.
- `test_apply_merge_preserves_input_field` — `applyProbeMergeToLimit({context: 0, input: 8000, output: 0}, {context: 131072, output: 8192})` returns `{context: 131072, input: 8000, output: 8192}`. Pins that `input` passes through unchanged and that a future refactor extending the probe map to include `input` cannot silently clobber a config-supplied `limit.input`.

**Integration (provider-layer):**

- `test_provider_layer_populates_limit_from_probe` — spin up mock LM Studio server, register a provider matching heuristic, register a model with `limit.context: 0` in config, build the provider layer, assert final `models[id].limit.context > 0` and `.output > 0`.
- `test_provider_layer_untouched_for_non_lmstudio` — same setup but provider key `"openai"` with a remote baseURL: no probe, no fetch attempted (mock server records zero hits), `models[id].limit.context` stays at the config value (or 0).
- `test_provider_layer_config_context_wins_over_probe` — LM Studio provider + a model with `limit.context: 32000` in config + mock server reporting `loaded_context_length: 262144` → final context is 32000.
- `test_provider_layer_memoizes_probe_per_provider` — 6 models under one LM Studio provider → mock server records exactly 1 hit on `/api/v0/models`.
- `test_provider_layer_skips_probe_when_provider_disabled` — two sub-cases pinned in one test: (a) LM Studio provider matches detection AND its ID appears in `disabled_providers` → zero probe hits; (b) LM Studio provider matches detection AND `enabled_providers` is non-empty but omits its ID → zero probe hits. Pins that Site A's guard uses the two-gate `isProviderAllowed` helper (line 1361-1365), not just the single-gate `disabled.has()` predicate. `isProviderAllowed`'s only extant call sites are `provider.ts:1564` and `provider.ts:1579`; both brand the id via `ProviderV2.ID.make(...)` before the call — the plan's Site A follows the same pattern.

**Regression:**

- `test_isoverflow_fires_when_probed_context_is_populated` — call `session/overflow.ts`'s `isOverflow` with a model whose `limit.context` was populated by the probe, token count > usable → returns true. Pins that the fix actually makes compaction trigger.

## Plan Scope Manifest

| plan-item | paths | items |
|-----------|-------|-------|
| `bp-003-lmstudio-probe` | `packages/opencode/src/provider/lmstudio-probe.ts`, `packages/opencode/src/provider/provider.ts`, `packages/opencode/test/provider/lmstudio-probe.test.ts` | `isLMStudioProvider`, `probeLMStudio`, `applyProbeToModel`, `applyProbeMergeToLimit`, provider-layer memoized-probe insertion at `packages/opencode/src/provider/provider.ts` Site A (outer configProviders loop, ~line 1395) and Site B (inner `parsedModel.limit` assignment, ~line 1468-1472) |

## Follow-on (NOT this BP)

- Live re-probing when the user swaps models inside LM Studio mid-session. Would require a session-level hook that invalidates the memoized probe promise on `sync.data.session` change or on a manual `/reload-provider` command. Not needed for the primary "auto-compaction works" outcome — TUI restart is a fine escape hatch.
- Universal probes for other local OpenAI-compatible endpoints — llama.cpp server (`/props` returns `n_ctx`), vLLM (`/v1/models` extended fields), Ollama (`/api/tags` + `/api/show`). Each has a different admin endpoint; each is its own detection heuristic + probe. Fold into a `LocalContextProbeRegistry` when a second endpoint is added.
- Auto-populate `compaction.reserved` from provider-reported output cap when providers start exposing one. Currently `overflow.ts:14-16`'s `min(20_000, maxOutputTokens)` heuristic is fine.
- Emit a TUI toast when the probe fills a limit ("LM Studio context detected: 131072 tokens") so the user knows compaction is now active. Would need `Bus` publish + a sync.tsx handler.
- Persist last-probed limits to a small on-disk cache keyed by baseURL so a cold-start against a not-yet-loaded LM Studio still gets reasonable defaults. Trade-off: cache invalidation on model swap. Deferred until the "LM Studio not running at boot" case surfaces as a real complaint.

## Constraints (from reference/DEVELOPMENT_PATTERNS.md)

- **TDD/BDD for everything** (§0D, §2A). Every test named above must exist and be RED before its production code is written. Order: write all 43 tests (RED) → write the four helper functions + the provider.ts insertion (GREEN) → refactor. Test count breakdown: 13 detection + 17 probe + 7 merge + 5 integration + 1 regression = 43.
- **Reference existing code by `file:line`** (§1E, §3D). All references above cite line numbers in `packages/opencode/src/{provider/provider.ts, session/overflow.ts}` at `dev` tip `0e2dd4ad1` (the tip when this plan was authored, 2026-06-24). This repo's history is rewritten periodically via "chore: generate" squash commits, so the hash may not be an ancestor of a future `dev` tip. The authoritative anchor is content-match against the code snippets reproduced inline above — a re-audit should re-verify the file contents at the cited line ranges (compact re-verification: `sed -n '8,34p' packages/opencode/src/session/overflow.ts` and `sed -n '1395,1475p' packages/opencode/src/provider/provider.ts`), not `git show 0e2dd4ad1:...`.
- **Test suite speed** (§2A). `test_probe_returns_empty_map_on_timeout` requires the probe module to accept an injectable timeout (default 3000 ms, overridable via a second parameter or a module-scope symbol) so the test can trigger the timeout branch with a ~100 ms budget instead of a real 3-5 second wall-clock wait per suite run. The public shape stays `probeLMStudio(baseURL)` — the injection is a `probeLMStudio(baseURL, opts?: { timeoutMs?: number })` optional overload used only by tests. This is captured in the manifest via the module path already listed.
- **Modularity / DRY** (§19). The four helpers live in one module with a clean surface: detection is one function, probing is one function, merging is two functions (a two-field pure core `applyProbeToModel` plus a thin three-field adapter `applyProbeMergeToLimit` for Site B). No coupling to the rest of `provider.ts` beyond the single insertion point.
- **Two consecutive independent clean audit passes** for convergence (§16C, §20). Once the code is green, the plan gets independent auditors per §20 before being marked COMPLETE.
- **Landing commits carry `Plan-Item: bp-003-lmstudio-probe` trailers** per BUILD_PLAN_TEMPLATE.md "Landing commits" section — every commit touching `packages/opencode/src/provider/**` or `packages/opencode/test/provider/**` for this BP names this manifest row.

## No external research required

Per `reference/RESEARCH_PROCESS_HANDOFF.md`'s 6-pass methodology: this fix does not need academic/practitioner/contrarian research. The LM Studio API surface was verified by direct probe against the live daemon at `http://127.0.0.1:1234/api/v0/models` on 2026-06-24 — response shape captured in the Contract/Design section above (`state`, `loaded_context_length`, `max_context_length` per entry). No prior research or industry-pattern lookup would add signal beyond what a direct probe already established.
