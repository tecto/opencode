---
title: Architecture — opencode
last_updated: 2026-05-26
source: /cruxdev-adopt scaffolded stub
migration_status: stub
---

# Architecture

> **Status**: Stub. This document was scaffolded during cruxdev adoption to satisfy the `docs/ARCHITECTURE.md` template requirement. Real architecture content lives in `specs/` and per-package `AGENTS.md`/`README.md` files. This document should either be filled in or marked as a pointer (see [Sources](#sources)).

## At a glance

opencode is a monorepo containing the **opencode** AI coding agent (`packages/opencode/`) and a constellation of related packages: desktop app, web console, VS Code SDK, Slack integration, runtime containers, and shared infrastructure.

## Sources

Authoritative architecture detail lives in:

- `specs/v2/instructions.md` — instruction/config handling
- `specs/v2/provider-model.md` — provider/model abstraction
- `specs/v2/session.md` — session model
- `specs/storage/effect-sqlite-package.md` — storage layer
- `specs/project.md` — project-level spec
- `packages/opencode/AGENTS.md`, `packages/desktop/AGENTS.md` — package conventions
- Per-package `README.md` files under `packages/*/README.md`

## Top-level layout

| Path | Purpose |
|---|---|
| `packages/opencode/` | The opencode CLI/TUI core |
| `packages/desktop/` | Desktop application |
| `packages/web/` | Marketing/landing web app |
| `packages/console/` | Console web app + API |
| `packages/app/` | Application surface |
| `packages/docs/` | Public documentation site |
| `packages/llm/`, `packages/core/`, `packages/ui/` | Shared libraries |
| `packages/sdk/js/`, `sdks/vscode/` | SDKs |
| `packages/slack/`, `packages/enterprise/` | Integrations / paid surfaces |
| `packages/containers/` | Runtime/build container images |
| `infra/`, `nix/`, `flake.nix` | Deploy + reproducible dev env |
| `specs/` | Versioned design specs |
| `build_plans/` | Cruxdev-managed build plans |

## Open architecture work

See `docs/GAPS.md` HIGH section for items needing attention.
