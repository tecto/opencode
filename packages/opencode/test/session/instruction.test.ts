import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, FileSystem, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instruction, computeHomePrefixes, labelFor } from "../../src/session/instruction"
import type { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Global } from "@opencode-ai/core/global"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { provideInstance, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"

const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer))

const configLayer = TestConfig.layer()

const instructionLayer = (
  global: Partial<Global.Interface>,
  flags: Partial<RuntimeFlags.Info> = {},
  configOverrides?: Partial<import("@/config/config").Config.Interface>,
) =>
  Instruction.layer.pipe(
    Layer.provide(configOverrides ? TestConfig.layer(configOverrides) : configLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Global.layerWith(global)),
    Layer.provide(RuntimeFlags.layer(flags)),
  )

const provideInstruction =
  (
    global: Partial<Global.Interface>,
    flags?: Partial<RuntimeFlags.Info>,
    configOverrides?: Partial<import("@/config/config").Config.Interface>,
  ) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(Effect.provide(instructionLayer(global, flags, configOverrides)))

const write = (filepath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.dirname(filepath), { recursive: true })
    yield* fs.writeFileString(filepath, content)
  })

const writeFiles = (dir: string, files: Record<string, string>) =>
  Effect.all(
    Object.entries(files).map(([file, content]) => write(path.join(dir, file), content)),
    { discard: true },
  )

const withFiles = <A, E, R>(files: Record<string, string>, self: (dir: string) => Effect.Effect<A, E, R>) =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      yield* writeFiles(dir, files)
      return yield* self(dir).pipe(provideInstruction({ home: dir, config: dir }))
    }),
  )

const tmpWithFiles = (files: Record<string, string>) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    yield* writeFiles(dir, files)
    return dir
  })

function loaded(filepath: string): MessageV2.WithParts[] {
  const sessionID = SessionID.make("session-loaded-1")
  const messageID = MessageID.make("msg_message-loaded-1")

  return [
    {
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 0 },
        agent: "build",
        model: {
          providerID: ProviderID.make("anthropic"),
          modelID: ModelID.make("claude-sonnet-4-20250514"),
        },
      },
      parts: [
        {
          id: PartID.make("prt_part-loaded-1"),
          messageID,
          sessionID,
          type: "tool",
          callID: "call-loaded-1",
          tool: "read",
          state: {
            status: "completed",
            input: {},
            output: "done",
            title: "Read",
            metadata: { loaded: [filepath] },
            time: { start: 0, end: 1 },
          },
        },
      ],
    },
  ]
}

describe("Instruction.resolve", () => {
  it.live("returns empty when AGENTS.md is at project root (already in systemPaths)", () =>
    withFiles({ "AGENTS.md": "# Root Instructions", "src/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "AGENTS.md"))).toBe(true)

        const results = yield* svc.resolve([], path.join(dir, "src", "file.ts"), MessageID.make("msg_message-test-1"))
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("returns AGENTS.md from subdirectory (not in systemPaths)", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "subdir", "AGENTS.md"))).toBe(false)

        const results = yield* svc.resolve(
          [],
          path.join(dir, "subdir", "nested", "file.ts"),
          MessageID.make("msg_message-test-2"),
        )
        expect(results.length).toBe(1)
        expect(results[0].filepath).toBe(path.join(dir, "subdir", "AGENTS.md"))
      }),
    ),
  )

  it.live("doesn't reload AGENTS.md when reading it directly", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "AGENTS.md")
        const system = yield* svc.systemPaths()
        expect(system.has(filepath)).toBe(false)

        const results = yield* svc.resolve([], filepath, MessageID.make("msg_message-test-3"))
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("does not reattach the same nearby instructions twice for one message", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-1")

        const first = yield* svc.resolve([], filepath, id)
        const second = yield* svc.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(first[0].filepath).toBe(path.join(dir, "subdir", "AGENTS.md"))
        expect(second).toEqual([])
      }),
    ),
  )

  it.live("clear allows nearby instructions to be attached again for the same message", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-2")

        const first = yield* svc.resolve([], filepath, id)
        yield* svc.clear(id)
        const second = yield* svc.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(second).toHaveLength(1)
        expect(second[0].filepath).toBe(path.join(dir, "subdir", "AGENTS.md"))
      }),
    ),
  )

  it.live("skips instructions already reported by prior read metadata", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const agents = path.join(dir, "subdir", "AGENTS.md")
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-3")

        const results = yield* svc.resolve(loaded(agents), filepath, id)
        expect(results).toEqual([])
      }),
    ),
  )

  test.todo("fetches remote instructions from config URLs via HttpClient", () => {})
})

describe("Instruction.system", () => {
  it.live("loads both project and global AGENTS.md when both exist", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpWithFiles({ "AGENTS.md": "# Project Instructions" })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(projectTmp, "AGENTS.md"))).toBe(true)
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(true)

        const rules = yield* svc.system()
        expect(rules).toHaveLength(2)
        // BP-002: scope-aware label. Global file (home === globalTmp) tildeifies to `~/AGENTS.md`.
        // Project file lives outside the fake home; non-git tmp dirs produce worktree="/" so the
        // labelFor non-worktree branch fires and returns the absolute path unchanged.
        expect(rules[0]).toBe(`# ~/AGENTS.md\n# Global Instructions`)
        expect(rules[1]).toBe(`# ${path.join(projectTmp, "AGENTS.md")}\n# Project Instructions`)
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )

  it.live("labels config.instructions outside the worktree without `(project)` (BP-002 F-002 regression)", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpdirScoped()
      const externalDir = yield* tmpWithFiles({ "team-rules.md": "# Team Rules" })
      const externalFile = path.join(externalDir, "team-rules.md")

      yield* provideTmpdirInstance(
        (root) =>
          Effect.gen(function* () {
            // Fixture invariant: externalDir and root must be non-nested siblings under
            // os.tmpdir(). Fail loudly if a future fixture change breaks that.
            expect(externalFile.startsWith(root + path.sep)).toBe(false)
            const svc = yield* Instruction.Service
            const rules = yield* svc.system()
            const externalRule = rules.find((r) => r.includes("# Team Rules"))
            expect(externalRule).toBeDefined()
            expect(externalRule!).toBe(`# ${externalFile}\n# Team Rules`)
            expect(externalRule!.includes("(project)")).toBe(false)
          }).pipe(
            provideInstruction({ home: globalTmp, config: globalTmp }, undefined, {
              get: () => Effect.succeed({ instructions: [externalFile] }),
            }),
          ),
        { git: true },
      )
    }),
  )

  it.live("skips project and global CLAUDE.md when Claude Code prompt is disabled", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ ".claude/CLAUDE.md": "# Global Claude" })
      const projectTmp = yield* tmpWithFiles({ "CLAUDE.md": "# Project Claude" })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(globalTmp, ".claude", "CLAUDE.md"))).toBe(false)
        expect(paths.has(path.join(projectTmp, "CLAUDE.md"))).toBe(false)
        expect(yield* svc.system()).toEqual([])
      }).pipe(
        provideInstance(projectTmp),
        provideInstruction({ home: globalTmp, config: globalTmp }, { disableClaudeCodePrompt: true }),
      )
    }),
  )
})

describe("Instruction.labelFor (BP-002)", () => {
  const home = "/fake/home/user"
  const worktree = "/fake/projects/myrepo"
  const globalAgents = "/fake/home/user/.config/opencode/AGENTS.md"
  const ctx = {
    worktree,
    homePrefixes: [home + path.sep],
    resolvedGlobalFiles: [globalAgents],
  }

  test("URL passes through unchanged with no `(project)` tag", () => {
    expect(labelFor("https://example.com/rules.md", ctx)).toBe("# https://example.com/rules.md")
    expect(labelFor("http://example.com/rules.md", ctx)).toBe("# http://example.com/rules.md")
    expect(labelFor("https://example.com/rules.md", ctx).includes("(project)")).toBe(false)
  })

  test("global config file tildeifies relative to $HOME", () => {
    expect(labelFor(globalAgents, ctx)).toBe("# ~/.config/opencode/AGENTS.md")
  })

  test("inside-worktree file gets `(project)` suffix with worktree-relative path", () => {
    const item = "/fake/projects/myrepo/packages/x/AGENTS.md"
    expect(labelFor(item, ctx)).toBe("# packages/x/AGENTS.md (project)")
    expect(labelFor("/fake/projects/myrepo/AGENTS.md", ctx)).toBe("# AGENTS.md (project)")
  })

  test("outside-worktree path is tildeified or kept absolute, never tagged `(project)` (F-002)", () => {
    expect(labelFor("/opt/team-rules.md", ctx)).toBe("# /opt/team-rules.md")
    expect(labelFor("/opt/team-rules.md", ctx).includes("(project)")).toBe(false)
    expect(labelFor("/fake/home/user/dotfiles/AGENTS.md", ctx)).toBe("# ~/dotfiles/AGENTS.md")
  })

  test("worktree === '/' or empty falls back to tildeify-or-absolute", () => {
    const rootCtx = { ...ctx, worktree: "/" }
    expect(labelFor("/fake/home/user/notes.md", rootCtx)).toBe("# ~/notes.md")
    expect(labelFor("/var/log/foo.md", rootCtx)).toBe("# /var/log/foo.md")
    const emptyCtx = { ...ctx, worktree: "" }
    expect(labelFor("/fake/home/user/notes.md", emptyCtx)).toBe("# ~/notes.md")
    const undefinedCtx = { ...ctx, worktree: undefined }
    expect(labelFor("/var/log/foo.md", undefinedCtx)).toBe("# /var/log/foo.md")
  })

  test("prefix containment uses path.sep so `/Users/use` does not match `/Users/user/...`", () => {
    const tightCtx = { worktree: "/Users/use", homePrefixes: [], resolvedGlobalFiles: [] }
    expect(labelFor("/Users/user/file.md", tightCtx)).toBe("# /Users/user/file.md")
  })

  test("worktree-root file falls back to basename when path.relative yields empty", () => {
    expect(labelFor(worktree, ctx)).toBe("# myrepo (project)")
  })
})

describe("Instruction.computeHomePrefixes (BP-002)", () => {
  test("returns home + sep for an existing home directory", () => {
    const prefixes = computeHomePrefixes(process.env.HOME ?? "/tmp")
    expect(prefixes.length).toBeGreaterThanOrEqual(1)
    expect(prefixes.every((p) => p.endsWith(path.sep))).toBe(true)
  })

  test("filters empty and single-char homes to avoid over-tildeifying", () => {
    expect(computeHomePrefixes("")).toEqual([])
    expect(computeHomePrefixes("/")).toEqual([])
  })

  test("falls back to raw home when realpath fails (non-existent path)", () => {
    const fake = "/nonexistent/home/" + Math.random().toString(36).slice(2)
    expect(computeHomePrefixes(fake)).toEqual([fake + path.sep])
  })
})

describe("Instruction.systemPaths global config", () => {
  it.live("uses Global.Service config AGENTS.md", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(true)
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )
})
