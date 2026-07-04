// BP-004: pure helpers for the Context sidebar. Extracted from context.tsx for
// unit-testability (no Solid.js reactive primitives here). See
// build_plans/BP-004-lmstudio-context-sidebar.md for the contract.

// Mirrors the server-side compaction buffer in
// packages/opencode/src/session/overflow.ts. If the model advertises a smaller
// output cap, the server (and this module) use that instead.
export const COMPACTION_BUFFER = 20_000

/**
 * Format a token count for a compact sidebar:
 *   131_072 -> "131K"
 *   2_000_000 -> "2M"
 *   1_200_000 -> "1.2M"
 * Non-finite, zero, or negative inputs return "—".
 */
export function formatK(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

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

/**
 * Compute the sidebar's state derived from either the last assistant message
 * (when the session has replied at least once) or the session's current model
 * selection (fresh session). Pure — no reactive dependencies.
 *
 * The `compactAt` value mirrors `session/overflow.ts:14-19`'s reserved-formula
 * default path: `reserved = min(COMPACTION_BUFFER, model.limit.output)`, then
 * `compactAt = round((context - reserved) / context * 100)`. The `cfg.reserved`
 * override branch is intentionally ignored — see BP-004 Contract/Design.
 */
export function computeContextState(input: ContextStateInput): ContextState {
  // Resolve the model from either the last assistant message (post-first-turn)
  // or, on a fresh session with no reply yet, from the current session's model.
  // lastAssistant wins via `??` short-circuit when both are present.
  const providerID = input.lastAssistant?.providerID ?? input.sessionModel?.providerID
  const modelID = input.lastAssistant?.modelID ?? input.sessionModel?.id
  const model =
    providerID && modelID
      ? input.providers.find((item) => item.id === providerID)?.models[modelID]
      : undefined
  // Double optional-chain guards a runtime-shape gap (models registered with
  // sparse metadata may lack `limit` entirely, even when TypeScript's declared
  // shape says otherwise — pinned by `test_state_returns_zero_context_when_model_limit_undefined`).
  const contextLimit = model?.limit?.context ?? 0
  const outputLimit = model?.limit?.output ?? 0
  // Same reserved formula as session/overflow.ts:14-16.
  const reserved = outputLimit > 0 ? Math.min(COMPACTION_BUFFER, outputLimit) : COMPACTION_BUFFER
  const compactAt = contextLimit > 0 ? Math.round(((contextLimit - reserved) / contextLimit) * 100) : null

  if (!input.lastAssistant) {
    return { tokens: 0, percent: null, contextLimit, compactAt }
  }
  const t = input.lastAssistant.tokens
  const tokens = t.input + t.output + t.reasoning + t.cache.read + t.cache.write
  return {
    tokens,
    percent: contextLimit > 0 ? Math.round((tokens / contextLimit) * 100) : null,
    contextLimit,
    compactAt,
  }
}
