# CLAUDE.md

This file gives Claude Code (and other AI coding agents) the context needed to work productively in this repository.

## Project conventions

opencode predates CLAUDE.md as a convention. The authoritative project guidance lives in **`AGENTS.md`** (root) and per-package `AGENTS.md` files (e.g. `packages/opencode/AGENTS.md`, `packages/desktop/AGENTS.md`). Read those first. This file only adds rules that AGENTS.md doesn't cover.

## cruxdev usage

This project is adopted by cruxdev (project_id `caa5d9eb-1ccd-4573-bd8c-e7efc07843b9`). When the user invokes a `/cruxdev-*` skill, **use the cruxdev MCP tools** — do not replace them with direct file writes, even if an in-context investigation would be faster.

- The MCP engine allocates IDs (e.g. `bp_number`), enforces naming/location conventions (e.g. `build_plans/BUILD_PLAN_<NNN>_<SLUG>.md`), validates structure (`validate_plan_structure`), and tracks session state. Bypassing produces output that looks correct but is operationally wrong — untracked, mis-named, mis-placed.
- For build plans specifically: call `mcp__cruxdev__create_plan_template(goal, project_dir)` → it returns `{template, output_path, bp_number}` and writes a template stub. Fill that stub in place, then call `mcp__cruxdev__validate_plan_structure(plan_file)` before reporting done.
- For numbering: opencode plans live in `build_plans/` with engine-allocated numbers starting at 001. `mcp__cruxdev__cruxdev_bp_next` scans the filesystem to find the next free number — prefer it over manual `ls`/glob patterns.
- Scope choices about filesystem footprint (e.g. "keep cruxdev artifacts under `.cruxdev/`") only affect *where* engine-managed artifacts land. They do **not** authorize bypassing the engine itself.
- The MCP server's session-start instruction ("Route through `crux_assemble()` first; do not improvise") is authoritative.

## Code style and engineering rules

See `AGENTS.md` and per-package `AGENTS.md` for the authoritative conventions. Highlights:

- Bun is the package manager (`bun@1.3.14` pinned in `package.json`). Use `bun`, not `npm`/`yarn`/`pnpm`.
- Root `bun test` intentionally errors — always scope tests to a package: `bun test packages/opencode/test/...`
- Typecheck via `bun turbo typecheck` from the repo root.
- Lint via `oxlint`.
- Pre-commit hooks via `husky` (`.husky/`).
- Patches are committed under `patches/` and applied via Bun's patch mechanism.
- The TUI lives under `packages/opencode/src/cli/cmd/tui/` (Solid + OpenTUI).
- Project config schema: see `packages/opencode/src/config/`. Per-agent model config field already exists at `agent.<name>.model`.

## Where things live

| Concern | Location |
|---|---|
| Build plans | `build_plans/BUILD_PLAN_<NNN>_<SLUG>.md` |
| Specs | `specs/v2/`, `specs/storage/` |
| User docs | `packages/docs/` |
| Governance docs | `docs/` (GAPS, ARCHITECTURE, COMPETITORS) |
| Project conventions | `AGENTS.md` (root + per-package) |
| Cruxdev adoption state | `.cruxdev/` (intake, GAPS draft superseded by `docs/GAPS.md`, adoption_state.json) |
| Per-package skill/agent config | `.opencode/` |
| User-level Claude commands/skills | `.claude/commands/`, `.claude/skills/` |
