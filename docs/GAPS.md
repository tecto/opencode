---
title: GAPS — opencode
last_updated: 2026-05-26
source: /cruxdev-adopt (full adoption pass)
migration_status: adopted
---

# Gaps

Authoritative gap list for opencode now that the project is fully registered with cruxdev (project_id `caa5d9eb-1ccd-4573-bd8c-e7efc07843b9`). Supersedes the earlier `.cruxdev/GAPS.md` from the scoped-only adoption attempt.

## CRITICAL

_None._ The project has README, CONTRIBUTING, SECURITY, LICENSE, per-package AGENTS.md, and active specs.

## HIGH

| # | Gap | Why it matters | Status |
|---|---|---|---|
| H1 | `packages/opencode/BUN_SHELL_MIGRATION_PLAN.md` lacks frontmatter (owner, status, last_reviewed) | Active migration plans without owners drift | Open |
| H2 | `specs/v2/*.md` lack `last_reviewed` timestamps | Hard to know if specs are current | Open |
| H3 | `STATS.md` regeneration cadence is undocumented | May silently go stale | Open |

## MEDIUM

| # | Gap | Status |
|---|---|---|
| M1 | No root `CHANGELOG.md` | Open — opencode currently uses `UPCOMING_CHANGELOG.md` (gitignored) + release notes elsewhere; consider a tracked CHANGELOG |
| M2 | `intake/` and `build_plans/` were empty until BP-001 (now has BP-001) | Partially resolved |
| M3 | Translation glossaries (`.opencode/glossary/`) have no per-language review log | Open |
| M4 | `.crux/` is partially populated (`context/`, `corrections/`, `index/`, `knowledge/` are empty) | Open — either backfill or document as intentional |

## LOW

| # | Gap | Status |
|---|---|---|
| L1 | `README.*.md` translations may drift from canonical `README.md` | Open — add translation-staleness check to CI |
| L2 | No convention documented for where future migration plans live | Open |

## Convention notes (not gaps)

- **CLAUDE.md vs AGENTS.md**: opencode predates CLAUDE.md as a convention and uses `AGENTS.md` (root + per-package). The new root `CLAUDE.md` is a thin pointer to AGENTS.md plus cruxdev-specific guidance.
- **docs/ directory**: created during this adoption pass. Only governance docs (GAPS, ARCHITECTURE stub, COMPETITORS stub) live here. User-facing docs remain under `packages/docs/`.

## Closed during this adoption pass

- C1 — `.cruxdev/` populated with classification, inventory, GAPS, adoption_state
- C2 — `install_cruxdev` run; project registered with project_id `caa5d9eb-1ccd-4573-bd8c-e7efc07843b9`
- C3 — Session registered (`49f48c0c`)
- C4 — Project classified: software-existing (primary), website + product-saas + campaign + open-source (secondary), maturity `mature`
- C5 — `build_plans/BUILD_PLAN_001` created (TUI model → project config feature)
- C6 — Root `CLAUDE.md` created with cruxdev usage guidance + AGENTS.md pointer
- C7 — `docs/GAPS.md`, `docs/ARCHITECTURE.md` stub, `docs/COMPETITORS.md` stub created
