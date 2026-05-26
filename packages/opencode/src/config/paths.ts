export * as ConfigPaths from "./paths"

import fs from "fs"
import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { unique } from "remeda"
import * as Effect from "effect/Effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

export type ResolvedTarget =
  | { mode: "user"; refusedPath?: string; refusedReason?: string }
  | {
      mode: "project"
      path: string
      source: "OPENCODE_CONFIG" | "OPENCODE_CONFIG_DIR" | "existing_file" | "existing_dot_opencode" | "scaffolded"
    }

export const files = Effect.fn("ConfigPaths.projectFiles")(function* (
  name: string,
  directory: string,
  worktree?: string,
) {
  const afs = yield* AppFileSystem.Service
  return (yield* afs.up({
    targets: [`${name}.jsonc`, `${name}.json`],
    start: directory,
    stop: worktree,
  })).toReversed()
})

export const directories = Effect.fn("ConfigPaths.directories")(function* (directory: string, worktree?: string) {
  const afs = yield* AppFileSystem.Service
  return unique([
    Global.Path.config,
    ...(!Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? yield* afs.up({
          targets: [".opencode"],
          start: directory,
          stop: worktree,
        })
      : []),
    ...(yield* afs.up({
      targets: [".opencode"],
      start: Global.Path.home,
      stop: Global.Path.home,
    })),
    ...(Flag.OPENCODE_CONFIG_DIR ? [Flag.OPENCODE_CONFIG_DIR] : []),
  ])
})

export function fileInDirectory(dir: string, name: string) {
  return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
}

function normalizeWorktree(worktree?: string): string | null {
  if (!worktree || worktree === "" || worktree === "/") return null
  return worktree
}

// Realpath that survives non-existent targets by climbing to the deepest existing
// ancestor (so parent-directory symlinks are still followed). Matters on macOS
// where /Users/foo can symlink to /private/Users/foo — a naive path.resolve fallback
// would compare lexically-resolved strings against realpath'd worktree/home, producing
// false-negative refusals.
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
  if (!opts.envOverride) {
    const insideWorktree = opts.worktree !== null && real.startsWith(opts.worktree + path.sep)
    const insideHome = real.startsWith(opts.home + path.sep)
    if (!insideWorktree && !insideHome) {
      return { ok: false, reason: "path is outside worktree and outside $HOME" }
    }
  }
  // Writability probe — check the directory or its parent (for scaffold targets that don't exist yet).
  const dir = fs.existsSync(path.dirname(real))
    ? path.dirname(real)
    : path.dirname(path.dirname(real))
  try {
    fs.accessSync(dir, fs.constants.W_OK)
  } catch {
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
  // For all non-env-override branches (existing_file, existing_dot_opencode, scaffolded),
  // the effective safety boundary is the worktree if defined, else the current directory.
  // Without this, a project that exists outside $HOME and has worktree=='/' (non-git) gets
  // refused on existing_file/existing_dot_opencode even though scaffold mode would accept
  // the same location — see audit-r11-f2.
  const safetyBoundary = worktree ?? directory

  function tryReturn(
    p: string,
    source: Exclude<ResolvedTarget, { mode: "user" }>["source"],
    envOverride: boolean,
  ): ResolvedTarget {
    const safe = isSafeTargetPath(p, {
      home,
      worktree: envOverride ? worktree : safetyBoundary,
      envOverride,
    })
    if (!safe.ok) {
      return { mode: "user" as const, refusedPath: p, refusedReason: safe.reason }
    }
    return { mode: "project" as const, path: p, source }
  }

  if (Flag.OPENCODE_CONFIG) return tryReturn(Flag.OPENCODE_CONFIG, "OPENCODE_CONFIG", true)
  if (Flag.OPENCODE_CONFIG_DIR) {
    return tryReturn(path.join(Flag.OPENCODE_CONFIG_DIR, "opencode.json"), "OPENCODE_CONFIG_DIR", true)
  }

  const foundFiles = yield* files("opencode", directory, worktreeRaw)
  if (foundFiles.length) return tryReturn(foundFiles[foundFiles.length - 1], "existing_file", false)

  const afs = yield* AppFileSystem.Service
  const dotOpencode = yield* afs.up({ targets: [".opencode"], start: directory, stop: worktreeRaw })
  if (dotOpencode.length) {
    return tryReturn(path.join(dotOpencode[0], "opencode.json"), "existing_dot_opencode", false)
  }

  // Scaffold branch — uses tryReturn directly now that safetyBoundary handles the
  // null-worktree case consistently across all non-env-override branches.
  const scaffoldPath = path.join(safetyBoundary, ".opencode", "opencode.json")
  return tryReturn(scaffoldPath, "scaffolded", false)
})
