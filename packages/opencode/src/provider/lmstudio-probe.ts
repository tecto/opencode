// BP-003: LM Studio context autoprobe. See build_plans/BP-003-lmstudio-context-autoprobe.md.

export interface ProbedLimits {
  readonly context: number
  readonly output: number
}

export interface ExistingLimits {
  readonly context: number
  readonly output: number
}

export interface ExistingLimitsWithInput {
  readonly context: number
  readonly input?: number
  readonly output: number
}

export interface DetectionConfig {
  readonly name?: string
  readonly options?: Record<string, unknown>
}

const REGISTRY_KEY_REGEX = /^lm[-_ ]?studio$/i
const LOCAL_BASEURL_REGEX = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/v1\/?$/i
const DEFAULT_TIMEOUT_MS = 3000
const OUTPUT_CAP = 8192

function containsLMStudio(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes("lm studio") || lower.includes("lmstudio")
}

/**
 * Detects whether a provider config is LM Studio-backed. Matches on ANY of:
 *   1. registry key regex `/^lm[-_ ]?studio$/i`
 *   2. `name` contains "lm studio" or "lmstudio" (case-insensitive substring)
 *   3. `options.baseURL` (string, non-empty) matches local `/v1` regex
 */
export function isLMStudioProvider(key: string, cfg: DetectionConfig): boolean {
  if (REGISTRY_KEY_REGEX.test(key)) return true
  if (cfg.name && containsLMStudio(cfg.name)) return true
  const baseURL = cfg.options?.["baseURL"]
  if (typeof baseURL === "string" && baseURL !== "" && LOCAL_BASEURL_REGEX.test(baseURL)) return true
  return false
}

interface RawEntry {
  id?: unknown
  state?: unknown
  loaded_context_length?: unknown
  max_context_length?: unknown
}

function pickContext(entry: RawEntry): number | undefined {
  const loaded = entry.loaded_context_length
  if (typeof loaded === "number" && loaded > 0) return loaded
  const max = entry.max_context_length
  if (typeof max === "number" && max > 0) return max
  return undefined
}

/**
 * Fetches LM Studio's `/api/v0/models` and returns `id → limits` map.
 * `opts.timeoutMs` defaults to 3000; injectable for tests.
 * Returns empty Map on any failure (fetch throw, timeout, non-200, malformed JSON).
 */
export async function probeLMStudio(
  baseURL: string,
  opts?: { timeoutMs?: number },
): Promise<Map<string, ProbedLimits>> {
  const out = new Map<string, ProbedLimits>()
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    if (!baseURL) return out
    const origin = baseURL.replace(/\/v1\/?$/, "")
    const url = `${origin}/api/v0/models`
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return out
    const body = (await res.json()) as { data?: unknown }
    if (!body || !Array.isArray(body.data)) return out
    for (const raw of body.data) {
      const entry = raw as RawEntry
      const id = typeof entry.id === "string" ? entry.id : undefined
      if (id === undefined) continue
      const context = pickContext(entry)
      if (context === undefined) continue
      const output = Math.min(Math.floor(context / 4), OUTPUT_CAP)
      out.set(id.toLowerCase(), { context, output })
    }
    return out
  } catch {
    return out
  }
}

/** Two-field config-wins merge. Returns `existing` unchanged when `probed` is undefined. */
export function applyProbeToModel(
  existing: ExistingLimits,
  probed: ProbedLimits | undefined,
): ExistingLimits {
  if (!probed) return existing
  return {
    context: existing.context > 0 ? existing.context : probed.context,
    output: existing.output > 0 ? existing.output : probed.output,
  }
}

/**
 * Three-field adapter for Site B. Passes `input` through unchanged; delegates
 * `context`/`output` to `applyProbeToModel`'s config-wins rule.
 */
export function applyProbeMergeToLimit(
  existing: ExistingLimitsWithInput,
  probed: ProbedLimits | undefined,
): ExistingLimitsWithInput {
  const merged = applyProbeToModel({ context: existing.context, output: existing.output }, probed)
  return { context: merged.context, input: existing.input, output: merged.output }
}
