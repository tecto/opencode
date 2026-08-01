// BP-003 tests: LM Studio context autoprobe.
// See build_plans/BP-003-lmstudio-context-autoprobe.md for the design contract.

import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { Effect, Layer } from "effect"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { isOverflow } from "@/session/overflow"
import {
  applyProbeMergeToLimit,
  applyProbeToModel,
  isLMStudioProvider,
  probeLMStudio,
} from "@/provider/lmstudio-probe"

afterEach(async () => {
  await disposeAllInstances()
})

// ─── Helpers ────────────────────────────────────────────────────────────────

interface MockServerOptions {
  status?: number
  body?: string | object | null
  delayMs?: number
  onHit?: (path: string) => void
}

async function startMockLMStudio(opts: MockServerOptions = {}): Promise<{
  server: Server
  url: string
  hits: string[]
}> {
  const hits: string[] = []
  const server = createServer((req, res) => {
    hits.push(req.url ?? "")
    opts.onHit?.(req.url ?? "")
    const respond = () => {
      if (opts.status === undefined) {
        res.writeHead(200, { "content-type": "application/json" })
        const body =
          typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? { data: [] })
        res.end(body)
      } else {
        res.writeHead(opts.status, { "content-type": "application/json" })
        const body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? {})
        res.end(body)
      }
    }
    if (opts.delayMs) setTimeout(respond, opts.delayMs)
    else respond()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("mock server did not bind")
  return { server, url: `http://127.0.0.1:${address.port}`, hits }
}

const closeServer = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()))

// ─── Detection tests ───────────────────────────────────────────────────────

describe("isLMStudioProvider", () => {
  test("test_detects_by_registry_key_lmstudio", () => {
    expect(isLMStudioProvider("lmstudio", {})).toBe(true)
  })
  test("test_detects_by_registry_key_lm_studio_hyphen", () => {
    expect(isLMStudioProvider("lm-studio", {})).toBe(true)
  })
  test("test_detects_by_registry_key_case_insensitive", () => {
    expect(isLMStudioProvider("LMStudio", {})).toBe(true)
    expect(isLMStudioProvider("LM_STUDIO", {})).toBe(true)
  })
  test("test_detects_by_name_substring", () => {
    expect(isLMStudioProvider("custom", { name: "LM Studio (local)" })).toBe(true)
    expect(isLMStudioProvider("custom", { name: "my-lmstudio-wrapper" })).toBe(true)
  })
  test("test_detects_by_baseurl_default_port", () => {
    expect(
      isLMStudioProvider("custom", { options: { baseURL: "http://127.0.0.1:1234/v1" } }),
    ).toBe(true)
    expect(
      isLMStudioProvider("custom", { options: { baseURL: "http://localhost:1234/v1" } }),
    ).toBe(true)
  })
  test("test_detects_by_baseurl_custom_port", () => {
    expect(
      isLMStudioProvider("custom", { options: { baseURL: "http://127.0.0.1:5555/v1" } }),
    ).toBe(true)
  })
  test("test_detects_by_baseurl_with_trailing_slash", () => {
    expect(
      isLMStudioProvider("custom", { options: { baseURL: "http://127.0.0.1:1234/v1/" } }),
    ).toBe(true)
  })
  test("test_rejects_remote_baseurl_even_if_v1_shape", () => {
    expect(
      isLMStudioProvider("custom", { options: { baseURL: "https://api.example.com/v1" } }),
    ).toBe(false)
  })
  test("test_rejects_non_v1_local_baseurl", () => {
    expect(
      isLMStudioProvider("custom", { options: { baseURL: "http://127.0.0.1:1234/v2" } }),
    ).toBe(false)
  })
  test("test_rejects_when_no_signals", () => {
    expect(isLMStudioProvider("openai", { name: "OpenAI" })).toBe(false)
  })
  test("test_detects_handles_undefined_name_field", () => {
    expect(
      isLMStudioProvider("custom", { options: { baseURL: "http://127.0.0.1:1234/v1" } }),
    ).toBe(true)
  })
  test("test_detects_handles_undefined_options_field", () => {
    expect(isLMStudioProvider("lmstudio", {})).toBe(true)
  })
  test("test_detects_returns_false_when_baseurl_is_non_string_value", () => {
    expect(isLMStudioProvider("custom", { name: "openai", options: { baseURL: 1234 } })).toBe(false)
    expect(isLMStudioProvider("custom", { name: "openai", options: { baseURL: {} } })).toBe(false)
    expect(isLMStudioProvider("custom", { name: "openai", options: { baseURL: true } })).toBe(false)
    expect(isLMStudioProvider("custom", { name: "openai", options: { baseURL: null } })).toBe(false)
  })
})

// ─── Probe tests ───────────────────────────────────────────────────────────

describe("probeLMStudio", () => {
  test("test_probe_returns_map_from_valid_response_prefers_loaded", async () => {
    const { server, url } = await startMockLMStudio({
      body: {
        data: [
          {
            id: "test-model",
            state: "loaded",
            loaded_context_length: 131072,
            max_context_length: 262144,
          },
        ],
      },
    })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.get("test-model")?.context).toBe(131072)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_falls_back_to_max_when_loaded_null", async () => {
    const { server, url } = await startMockLMStudio({
      body: {
        data: [
          {
            id: "a",
            state: "not-loaded",
            loaded_context_length: null,
            max_context_length: 262144,
          },
        ],
      },
    })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.get("a")?.context).toBe(262144)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_falls_back_to_max_when_loaded_context_length_absent", async () => {
    const { server, url } = await startMockLMStudio({
      body: { data: [{ id: "b", state: "not-loaded", max_context_length: 262144 }] },
    })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.get("b")?.context).toBe(262144)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_derives_output_from_context", async () => {
    const { server, url } = await startMockLMStudio({
      body: {
        data: [
          {
            id: "big",
            state: "loaded",
            loaded_context_length: 131072,
            max_context_length: 262144,
          },
        ],
      },
    })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.get("big")?.output).toBe(8192)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_derives_output_uncapped_for_small_context", async () => {
    const { server, url } = await startMockLMStudio({
      body: {
        data: [
          { id: "small", state: "loaded", loaded_context_length: 8000, max_context_length: 8000 },
        ],
      },
    })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.get("small")?.output).toBe(2000)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_returns_empty_map_on_http_500", async () => {
    const { server, url } = await startMockLMStudio({ status: 500, body: {} })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.size).toBe(0)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_returns_empty_map_on_connection_refused", async () => {
    // Bind then close, so the port is guaranteed refused.
    const { server, url } = await startMockLMStudio({})
    await closeServer(server)
    const result = await probeLMStudio(`${url}/v1`)
    expect(result.size).toBe(0)
  })

  test("test_probe_returns_empty_map_for_empty_baseurl", async () => {
    const result = await probeLMStudio("")
    expect(result.size).toBe(0)
  })

  test("test_probe_returns_empty_map_on_timeout", async () => {
    const { server, url } = await startMockLMStudio({ delayMs: 500 })
    try {
      const start = Date.now()
      const result = await probeLMStudio(`${url}/v1`, { timeoutMs: 100 })
      const elapsed = Date.now() - start
      expect(result.size).toBe(0)
      expect(elapsed).toBeLessThan(300)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_returns_empty_map_on_malformed_json", async () => {
    const { server, url } = await startMockLMStudio({ body: "not-json" })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.size).toBe(0)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_returns_empty_map_on_missing_data_field", async () => {
    const { server, url } = await startMockLMStudio({ body: { nope: true } })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.size).toBe(0)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_returns_empty_map_when_data_is_null", async () => {
    const { server, url } = await startMockLMStudio({ body: { data: null } })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.size).toBe(0)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_returns_empty_map_when_data_is_empty_array", async () => {
    const { server, url } = await startMockLMStudio({ body: { data: [] } })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.size).toBe(0)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_skips_entries_without_context_fields", async () => {
    const { server, url } = await startMockLMStudio({
      body: {
        data: [
          { id: "bad" }, // no context fields
          { id: "good", state: "loaded", loaded_context_length: 32000, max_context_length: 32000 },
        ],
      },
    })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.has("bad")).toBe(false)
      expect(result.get("good")?.context).toBe(32000)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_strips_v1_from_baseurl", async () => {
    const { server, url, hits } = await startMockLMStudio({ body: { data: [] } })
    try {
      await probeLMStudio(`${url}/v1`)
      expect(hits).toContain("/api/v0/models")
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_matches_model_id_containing_slash_or_at_suffix", async () => {
    const { server, url } = await startMockLMStudio({
      body: {
        data: [
          {
            id: "openai/gpt-oss-20b",
            state: "loaded",
            loaded_context_length: 32000,
            max_context_length: 32000,
          },
          {
            id: "ornith-1.0-35b@q4_k_m",
            state: "not-loaded",
            max_context_length: 262144,
          },
        ],
      },
    })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.get("openai/gpt-oss-20b")?.context).toBe(32000)
      expect(result.get("ornith-1.0-35b@q4_k_m")?.context).toBe(262144)
    } finally {
      await closeServer(server)
    }
  })

  test("test_probe_handles_mixed_loaded_and_not_loaded_entries_in_one_response", async () => {
    const { server, url } = await startMockLMStudio({
      body: {
        data: [
          {
            id: "a",
            state: "loaded",
            loaded_context_length: 131072,
            max_context_length: 262144,
          },
          { id: "b", state: "not-loaded", max_context_length: 32768 },
        ],
      },
    })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.get("a")?.context).toBe(131072)
      expect(result.get("b")?.context).toBe(32768)
    } finally {
      await closeServer(server)
    }
  })
})

// ─── Merge tests ───────────────────────────────────────────────────────────

describe("applyProbeToModel / applyProbeMergeToLimit", () => {
  test("test_apply_uses_probed_context_when_existing_zero", () => {
    const result = applyProbeToModel(
      { context: 0, output: 4096 },
      { context: 131072, output: 8192 },
    )
    expect(result.context).toBe(131072)
  })
  test("test_apply_preserves_existing_context_when_nonzero", () => {
    const result = applyProbeToModel(
      { context: 32000, output: 4096 },
      { context: 262144, output: 8192 },
    )
    expect(result.context).toBe(32000)
  })
  test("test_apply_uses_probed_output_when_existing_zero", () => {
    const result = applyProbeToModel(
      { context: 50000, output: 0 },
      { context: 200000, output: 6144 },
    )
    expect(result.output).toBe(6144)
  })
  test("test_apply_preserves_existing_output_when_nonzero", () => {
    const result = applyProbeToModel(
      { context: 20000, output: 2000 },
      { context: 64000, output: 4096 },
    )
    expect(result.output).toBe(2000)
  })
  test("test_apply_returns_existing_when_probed_undefined", () => {
    const result = applyProbeToModel({ context: 0, output: 0 }, undefined)
    expect(result).toEqual({ context: 0, output: 0 })
  })
  test("test_apply_uses_probed_context_and_output_when_both_existing_zero", () => {
    const result = applyProbeToModel(
      { context: 0, output: 0 },
      { context: 131072, output: 8192 },
    )
    expect(result.context).toBe(131072)
    expect(result.output).toBe(8192)
  })
  test("test_apply_merge_preserves_input_field", () => {
    const result = applyProbeMergeToLimit(
      { context: 0, input: 8000, output: 0 },
      { context: 131072, output: 8192 },
    )
    expect(result).toEqual({ context: 131072, input: 8000, output: 8192 })
  })
})

// ─── Integration tests (provider layer against a mock LM Studio) ───────────

const it = testEffect(
  Layer.mergeAll(Provider.defaultLayer, Env.defaultLayer, Plugin.defaultLayer, CrossSpawnSpawner.defaultLayer),
)

const lmstudioConfig = (
  llmUrl: string,
  overrides: {
    contextLimit?: number
    outputLimit?: number
    disabled_providers?: string[]
    enabled_providers?: string[]
  } = {},
) => {
  const providers: Record<string, unknown> = {}
  providers["lmstudio"] = {
    name: "LM Studio",
    npm: "@ai-sdk/openai-compatible",
    models: {
      "test-model": {
        id: "test-model",
        name: "Test Model",
        attachment: false,
        reasoning: false,
        temperature: false,
        tool_call: true,
        release_date: "2025-01-01",
        limit: {
          context: overrides.contextLimit ?? 0,
          output: overrides.outputLimit ?? 0,
        },
        cost: { input: 0, output: 0 },
        options: {},
      },
    },
    options: { apiKey: "lm", baseURL: llmUrl },
  }
  const cfg: Record<string, unknown> = { formatter: false, lsp: false, provider: providers }
  if (overrides.disabled_providers) cfg.disabled_providers = overrides.disabled_providers
  if (overrides.enabled_providers) cfg.enabled_providers = overrides.enabled_providers
  return cfg
}

const modelBody = (contextLen: number, count = 1) => ({
  data: Array.from({ length: count }, (_, i) => ({
    id: count === 1 ? "test-model" : `test-model-${i}`,
    state: "loaded",
    loaded_context_length: contextLen,
    max_context_length: contextLen,
  })),
})

import { provideTmpdirInstance } from "../fixture/fixture"

type ProvidersMap = Record<string, Provider.Info>

const runIntegration = (
  cfg: (url: string) => Record<string, unknown>,
  serverOpts: MockServerOptions,
  body: (deps: { providers: ProvidersMap; hits: string[] }) => void | Promise<void>,
) =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.promise(() => startMockLMStudio(serverOpts)),
      (s) => Effect.promise(() => closeServer(s.server)),
    )
    yield* provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const providers = (yield* Provider.use.list()) as ProvidersMap
          yield* Effect.promise(async () => body({ providers, hits: server.hits }))
        }),
      { config: () => cfg(server.url) },
    )
  })

describe("provider layer integration", () => {
  it.live("test_provider_layer_populates_limit_from_probe", () =>
    runIntegration(
      (url) => lmstudioConfig(`${url}/v1`),
      { body: modelBody(131072) },
      ({ providers, hits }) => {
        const p = providers[ProviderV2.ID.make("lmstudio")]
        expect(p).toBeDefined()
        expect(p!.models["test-model"].limit.context).toBe(131072)
        expect(p!.models["test-model"].limit.output).toBeGreaterThan(0)
        expect(hits.some((h) => h.includes("/api/v0/models"))).toBe(true)
      },
    ),
  )

  it.live("test_provider_layer_untouched_for_non_lmstudio", () =>
    runIntegration(
      (_url) => ({
        formatter: false,
        lsp: false,
        // Cloud OpenAI-shaped provider with a REMOTE baseURL — heuristic must
        // reject it. The mock server exists only to record whether an
        // unwanted probe fires; using its local URL here would (correctly)
        // trigger the local-`/v1` detection branch, so we intentionally
        // point at a remote host that no fetch will ever reach.
        provider: {
          openai: {
            name: "OpenAI",
            npm: "@ai-sdk/openai-compatible",
            models: {
              "test-model": {
                id: "test-model",
                name: "T",
                attachment: false,
                reasoning: false,
                temperature: false,
                tool_call: true,
                release_date: "2025-01-01",
                limit: { context: 0, output: 0 },
                cost: { input: 0, output: 0 },
                options: {},
              },
            },
            options: { apiKey: "x", baseURL: "https://api.example.invalid/v1" },
          },
        },
      }),
      { body: modelBody(131072) },
      ({ hits }) => {
        expect(hits.length).toBe(0)
      },
    ),
  )

  it.live("test_provider_layer_config_context_wins_over_probe", () =>
    runIntegration(
      (url) => lmstudioConfig(`${url}/v1`, { contextLimit: 32000 }),
      { body: modelBody(262144) },
      ({ providers }) => {
        const p = providers[ProviderV2.ID.make("lmstudio")]
        expect(p!.models["test-model"].limit.context).toBe(32000)
      },
    ),
  )

  it.live("test_provider_layer_memoizes_probe_per_provider", () =>
    runIntegration(
      (url) => {
        const cfg = lmstudioConfig(`${url}/v1`) as {
          provider: { lmstudio: { models: Record<string, unknown> } }
        }
        // Add 5 more models under the same provider — probe must only fire once.
        for (let i = 1; i <= 5; i++) {
          cfg.provider.lmstudio.models[`test-model-${i}`] = {
            id: `test-model-${i}`,
            name: `Test Model ${i}`,
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 0, output: 0 },
            cost: { input: 0, output: 0 },
            options: {},
          }
        }
        return cfg
      },
      { body: modelBody(131072, 6) },
      ({ hits }) => {
        expect(hits.filter((h) => h.includes("/api/v0/models")).length).toBe(1)
      },
    ),
  )

  it.live("test_provider_layer_skips_probe_when_provider_disabled", () =>
    runIntegration(
      (url) => lmstudioConfig(`${url}/v1`, { disabled_providers: ["lmstudio"] }),
      { body: modelBody(131072) },
      ({ hits }) => {
        expect(hits.length).toBe(0)
      },
    ),
  )
})

// ─── Regression tests (loaded_context_length priority must be pinned) ──────

describe("regression: loaded_context_length must beat max_context_length everywhere", () => {
  // These tests pin the exact contract that was broken when no regression
  // tests existed for this priority order. If any future build plan changes
  // how probes flow through the provider layer, these tests catch it.

  test("test_probe_priority_loaded_over_max_in_single_response", async () => {
    // The motivating case: a model is loaded with context < its max declared.
    // Probe must return loaded, not max. This is the regression that BP-005-era
    // changes broke (no tests existed to catch it).
    const { server, url } = await startMockLMStudio({
      body: {
        data: [
          {
            id: "ornith-1.0-35b-mtp-apex",
            state: "loaded",
            loaded_context_length: 131072,
            max_context_length: 262144, // double the loaded value — the regression trigger
          },
        ],
      },
    })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      const probed = result.get("ornith-1.0-35b-mtp-apex")
      expect(probed).toBeDefined()
      // The regression: if this ever equals 262144, the loaded→max fallback broke.
      expect(probed!.context).toBe(131072)
      expect(probed!.output).toBe(Math.min(Math.floor(131072 / 4), 8192)) // 8192
    } finally {
      await closeServer(server)
    }
  })

  test("test_applyProbe_merge_keeps_loaded_when_existing_zero", () => {
    // Simulates Site B receiving a probe where loaded < max. The merge must
    // preserve loaded_context_length, not revert to any cached maximum.
    const result = applyProbeToModel(
      { context: 0, output: 0 }, // config has no limits (the typical LM Studio user case)
      { context: 131_072, output: 8_192 }, // probe returned loaded_context_length
    )
    expect(result.context).toBe(131_072)
    expect(result.output).toBe(8_192)

    const resultMax = applyProbeToModel(
      { context: 0, output: 0 },
      { context: 262_144, output: 16_384 }, // what it would be if max were used instead
    )
    expect(resultMax.context).toBe(262_144) // would be wrong for a loaded model

    // The regression guard: when config is zero (unconfigured LM Studio user),
    // the probed value IS what gets stored. If any downstream code overwrites
    // this with max_context_length, these tests fail.
    const merged = applyProbeMergeToLimit(
      { context: 0, output: 0, input: undefined },
      { context: 131_072, output: 8_192 },
    )
    expect(merged.context).toBe(131_072)
    expect(merged.output).toBe(8_192)
  })

  test("test_isOverflow_uses_loaded_context_not_max", () => {
    // isOverflow reads model.limit.context. After probe, this must be the loaded
    // value (e.g., 131072), NOT the max (262144). If compaction fires at 262k
    // tokens for a model that only has 131k context, output gets truncated.
    const loadedModel = {
      limit: { context: 131_072, input: undefined, output: 8_192 },
    } as unknown as import("@/provider/provider").Provider.Model

    const maxModel = {
      limit: { context: 262_144, input: undefined, output: 16_384 },
    } as unknown as import("@/provider/provider").Provider.Model

    // Tokens at the loaded model's boundary (just over usable threshold).
    const tokens = {
      input: 100_000,
      output: 25_000,
      cache: { read: 0, write: 0 },
      reasoning: 0,
      total: 125_000,
    } as any

    // With loaded context (131072): usable ≈ 131072 - min(20000, 8192) = 122880.
    // Total tokens 125000 > 122880 → overflow fires. This is the CORRECT behavior
    // for a model actually loaded with 131k context.
    expect(isOverflow({ cfg: {} as any, tokens, model: loadedModel })).toBe(true)

    // With max context (262144): usable ≈ 262144 - min(20000, 16384) = 245760.
    // Total tokens 125000 < 245760 → no overflow. This would be WRONG if the model
    // is actually loaded with only 131k context — it would keep going until the
    // actual context limit is hit and output truncates.
    expect(isOverflow({ cfg: {} as any, tokens, model: maxModel })).toBe(false)

    // The regression guard: if a future change causes the probe result to be
    // replaced with max_context_length downstream, loadedModel would behave like
    // maxModel here and compaction wouldn't fire when it should.
  })

  test("test_probe_multiple_models_loaded_vs_not_loaded_priority", async () => {
    // Real-world LM Studio response: mixed loaded/not-loaded models in one payload.
    // Each model must use its own correct value, not a global fallback.
    const { server, url } = await startMockLMStudio({
      body: {
        data: [
          {
            id: "loaded-model",
            state: "loaded",
            loaded_context_length: 65_536,
            max_context_length: 131_072,
          },
          {
            id: "unloaded-model",
            state: "not-loaded",
            max_context_length: 262_144,
          },
        ],
      },
    })
    try {
      const result = await probeLMStudio(`${url}/v1`)
      expect(result.get("loaded-model")?.context).toBe(65_536) // loaded wins
      expect(result.get("unloaded-model")?.context).toBe(262_144) // max is only option
    } finally {
      await closeServer(server)
    }
  })

  test("test_applyProbe_config_nonzero_wins_over_probe_loaded", () => {
    // When user has hardcoded limit.context in opencode.json, that must win.
    // This is the config-wins merge behavior — not a regression vector but
    // worth pinning alongside the loaded-context tests for completeness.
    const result = applyProbeToModel(
      { context: 32_000, output: 4_096 }, // user hardcoded these
      { context: 131_072, output: 8_192 }, // probe says loaded is bigger
    )
    expect(result.context).toBe(32_000) // config wins
    expect(result.output).toBe(4_096)
  })
})

// ─── Existing regression test (isOverflow fires) ──────────────────────────

describe("isOverflow regression", () => {
  test("test_isoverflow_fires_when_probed_context_is_populated", () => {
    // Simulate the state a probed model has AFTER Site B populates limit.context.
    // isOverflow's signature accepts a Provider.Model shape but only reads
    // model.limit.context / model.limit.input.
    const model = {
      limit: { context: 100_000, input: undefined, output: 8192 },
    } as unknown as import("@/provider/provider").Provider.Model
    const tokens = {
      input: 90_000,
      output: 20_000,
      cache: { read: 0, write: 0 },
      reasoning: 0,
      total: 110_000,
    } as any
    expect(isOverflow({ cfg: {} as any, tokens, model })).toBe(true)
  })
})
