import { describe, expect, test } from "bun:test"
import {
  COMPACTION_BUFFER,
  computeContextState,
  formatK,
  type ContextStateInput,
} from "../../../src/feature-plugins/sidebar/context-utils"

// BP-004 tests. See build_plans/BP-004-lmstudio-context-sidebar.md.

// ─── formatK ────────────────────────────────────────────────────────────────

describe("formatK", () => {
  test("test_formatk_returns_dash_for_zero_or_negative", () => {
    expect(formatK(0)).toBe("—")
    expect(formatK(-1)).toBe("—")
  })

  test("test_formatk_returns_dash_for_non_finite", () => {
    expect(formatK(NaN)).toBe("—")
    expect(formatK(Infinity)).toBe("—")
  })

  test("test_formatk_preserves_small_numbers_below_thousand", () => {
    expect(formatK(999)).toBe("999")
    expect(formatK(1)).toBe("1")
  })

  test("test_formatk_rounds_thousands_to_k_suffix", () => {
    expect(formatK(1_000)).toBe("1K")
    expect(formatK(131_072)).toBe("131K")
    expect(formatK(65_536)).toBe("66K")
  })

  test("test_formatk_uses_m_suffix_for_millions_with_one_decimal", () => {
    expect(formatK(1_000_000)).toBe("1M")
    expect(formatK(1_200_000)).toBe("1.2M")
    expect(formatK(2_000_000)).toBe("2M")
  })

  test("test_formatk_transition_boundaries", () => {
    expect(formatK(999_999)).toBe("1000K")
    expect(formatK(1_000_000)).toBe("1M")
  })
})

// ─── computeContextState ────────────────────────────────────────────────────

const ornithProviders: ContextStateInput["providers"] = [
  {
    id: "lmstudio",
    models: {
      "ornith-1.0-35b-mtp-apex": { limit: { context: 131_072, output: 8_192 } },
    },
  },
]

const buildAssistant = (
  overrides: Partial<NonNullable<ContextStateInput["lastAssistant"]>["tokens"]> = {},
): NonNullable<ContextStateInput["lastAssistant"]> => ({
  providerID: "lmstudio",
  modelID: "ornith-1.0-35b-mtp-apex",
  tokens: {
    input: 5000,
    output: 1000,
    reasoning: 500,
    cache: { read: 100, write: 68 },
    ...overrides,
  },
})

describe("computeContextState", () => {
  test("test_state_returns_zero_when_no_assistant_and_no_session_model", () => {
    const result = computeContextState({ providers: [] })
    expect(result).toEqual({
      tokens: 0,
      percent: null,
      contextLimit: 0,
      compactAt: null,
    })
  })

  test("test_state_uses_session_model_context_when_no_assistant_yet", () => {
    const result = computeContextState({
      sessionModel: { providerID: "lmstudio", id: "ornith-1.0-35b-mtp-apex" },
      providers: ornithProviders,
    })
    expect(result).toEqual({
      tokens: 0,
      percent: null,
      contextLimit: 131_072,
      compactAt: 94,
    })
  })

  test("test_state_prefers_last_assistant_provider_model_over_session_model", () => {
    // lastAssistant → lmstudio/ornith (131K); session → different provider/model
    // (should be ignored since lastAssistant took priority).
    const result = computeContextState({
      lastAssistant: buildAssistant(),
      sessionModel: { providerID: "openai", id: "gpt-4" },
      providers: [
        ...ornithProviders,
        { id: "openai", models: { "gpt-4": { limit: { context: 8_192, output: 4_096 } } } },
      ],
    })
    // The contextLimit MUST come from lmstudio/ornith (131_072), not openai/gpt-4 (8_192).
    expect(result.contextLimit).toBe(131_072)
  })

  test("test_state_computes_percent_from_summed_tokens", () => {
    const result = computeContextState({
      lastAssistant: buildAssistant(), // input:5000 + output:1000 + reasoning:500 + cache.read:100 + cache.write:68 = 6668
      providers: ornithProviders,
    })
    expect(result.tokens).toBe(6668)
    expect(result.percent).toBe(5) // round(6668/131072*100) = round(5.087) = 5
  })

  test("test_state_computes_compact_at_94_for_lmstudio_ornith_shape", () => {
    const result = computeContextState({
      lastAssistant: buildAssistant(),
      providers: ornithProviders,
    })
    expect(result.compactAt).toBe(94) // round((131072-8192)/131072*100) = round(93.75) = 94
  })

  test("test_state_caps_reserved_at_compaction_buffer_when_output_limit_exceeds_it", () => {
    const result = computeContextState({
      lastAssistant: buildAssistant(),
      providers: [
        {
          id: "lmstudio",
          models: {
            "ornith-1.0-35b-mtp-apex": { limit: { context: 131_072, output: 32_768 } },
          },
        },
      ],
    })
    // reserved = min(20_000, 32_768) = 20_000
    // compactAt = round((131072-20000)/131072*100) = round(84.73) = 85
    expect(result.compactAt).toBe(85)
  })

  test("test_state_falls_back_to_full_buffer_when_output_limit_zero", () => {
    const result = computeContextState({
      lastAssistant: buildAssistant(),
      providers: [
        {
          id: "lmstudio",
          models: {
            "ornith-1.0-35b-mtp-apex": { limit: { context: 131_072, output: 0 } },
          },
        },
      ],
    })
    // outputLimit=0 → reserved = COMPACTION_BUFFER (20_000), NOT 0.
    // compactAt = round((131072-20000)/131072*100) = 85 (NOT 100).
    expect(result.compactAt).toBe(85)
    expect(COMPACTION_BUFFER).toBe(20_000) // sanity-pin the constant while we're here
  })

  test("test_state_returns_null_indicators_when_context_limit_zero", () => {
    const result = computeContextState({
      lastAssistant: buildAssistant(),
      providers: [
        {
          id: "lmstudio",
          models: {
            "ornith-1.0-35b-mtp-apex": { limit: { context: 0, output: 0 } },
          },
        },
      ],
    })
    expect(result.contextLimit).toBe(0)
    expect(result.percent).toBeNull()
    expect(result.compactAt).toBeNull()
  })

  test("test_state_returns_null_indicators_when_model_missing_from_providers_array", () => {
    const result = computeContextState({
      lastAssistant: buildAssistant(),
      providers: [], // no model registered
    })
    expect(result.contextLimit).toBe(0)
    expect(result.percent).toBeNull()
    expect(result.compactAt).toBeNull()
  })

  test("test_state_returns_zero_context_when_model_limit_undefined", () => {
    // Provider entry exists AND model exists, but the model's `limit` field is undefined.
    // A single-chain implementation (`model?.limit.context ?? 0`) throws here; a
    // double-chain implementation (`model?.limit?.context ?? 0`) degrades gracefully.
    const result = computeContextState({
      lastAssistant: buildAssistant(),
      providers: [
        {
          id: "lmstudio",
          models: {
            "ornith-1.0-35b-mtp-apex": {}, // no `limit` field at all
          },
        },
      ],
    })
    expect(result.contextLimit).toBe(0)
    expect(result.percent).toBeNull()
    expect(result.compactAt).toBeNull()
  })
})
