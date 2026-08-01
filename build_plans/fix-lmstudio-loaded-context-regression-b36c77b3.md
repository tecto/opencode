# BP — Fix regression: LM Studio probe should use loaded_context_length (the actual context window of the m
**UUID:** `b36c77b3`. **Type:** fix. **Lifecycle: CONVERGED**
## Header
**Goal:** Verify that the LM Studio probe correctly uses loaded_context_length for compaction calculations and apply downstream fixes where the loaded context is being overridden by max_context_length.

The root issue is that BP-003's probe (packages/opencode/src/provider/lmstudio-probe.ts:56-57) correctly picks loaded_context_length first falling back to max_context_length, but there were NO regression tests for this priority order — so when subsequent build plans touched the provider/compaction code paths, the loaded→max fallback was silently broken.

Create proper regression tests FIRST that pin: (1) probeLMStudio returns loaded_context_length as context when available, (2) applyProbeToModel keeps loaded context over max context, (3) isOverflow uses the probed loaded value not any static maximum. Then fix whatever code path is overriding the loaded context.

**Type:** fix

## Architecture Overview
The LM Studio probe (`packages/opencode/src/provider/lmstudio-probe.ts`) is responsible for determining the effective context window of a model currently loaded in the LM Studio server. The current implementation at lines 56-57 correctly implements a priority order: `loaded_context_length` (the actual context window of the loaded model) takes precedence over `max_context_length` (the theoretical maximum). However, this probe is part of a larger compaction pipeline where downstream consumers—specifically `applyProbeToModel` and `isOverflow`—must respect this probed value rather than reverting to static configuration or cached maximums. The regression occurred because no tests pinned the priority order, allowing subsequent changes to silently break the loaded→max fallback chain.

## Phases
1. **Regression Test Creation**: Add comprehensive tests for `probeLMStudio`, `applyProbeToModel`, and `isOverflow` that verify the loaded context takes precedence over max context when both are available. These tests must fail before any code changes to ensure they properly pin the expected behavior.
2. **Code Path Analysis**: Trace how the probed context value flows from `lmstudio-probe.ts` through the compaction system, identifying where `loaded_context_length` might be overridden by `max_context_length` or other static values.
3. **Fix Implementation**: Modify the identified code paths to ensure they use the probed loaded context value rather than falling back to maximums when a model is actively loaded in LM Studio.

## Phase Ordering & Dependencies
Phase 1 (Regression Tests) must complete before Phase 2 and 3, as the tests serve as both the verification mechanism and the behavioral specification. Phase 2 (Code Path Analysis) depends on understanding the test failures to identify which code paths are not respecting the probed values. Phase 3 (Fix Implementation) depends on both previous phases, as it requires knowing exactly what behavior to fix based on failing tests and where the override occurs.

## Session Execution Protocol
1. Run existing test suite to establish baseline and confirm no pre-existing failures related to LM Studio probing.
2. Add new regression tests in the appropriate test files that verify: (a) `probeLMStudio` returns `loaded_context_length` when available, (b) `applyProbeToModel` preserves loaded context over max context, (c) `isOverflow` uses probed loaded value not static maximum.
3. Run new tests to confirm they fail, validating they properly detect the regression.
4. Analyze code paths from `lmstudio-probe.ts` through compaction system to identify where loaded context is overridden.
5. Implement fixes to ensure downstream consumers use the probed loaded context value.
6. Run all tests including new regression tests to confirm fixes work and no regressions introduced.
7. Perform audit to convergence, ensuring two consecutive clean passes.

## Progress Tracker
- [ ] Verify probeLMStudio behavior matches spec (loaded_context_length precedence)
- [ ] Author tests red-first (confirm each fails, then passes)
- [ ] `tools/ci/gate.sh fast` passes
- [ ] Audit to convergence (two consecutive clean passes)

## File Inventory
| File | Action | Purpose |
|------|--------|---------|
| `packages/opencode/src/provider/lmstudio-probe.ts` | Modify/Create | Touched by this plan |
| `tools/ci/gate.sh` | Create/Modify | CI gate script for environment viability verification; must exist and be executable to validate build health |

## Risks & Mitigations
- **Risk**: Tests may pass without actually verifying the correct behavior if assertions are too weak. **Mitigation**: Ensure tests explicitly verify that `loaded_context_length` is used when available, not just that a context value is returned. Use specific test cases where loaded and max contexts differ significantly.
- **Risk**: Fixing the override may break other functionality that depends on using maximum context values. **Mitigation**: Comprehensive test coverage of all compaction-related code paths before and after changes to ensure no unintended side effects.
- **Risk**: The actual bug location may be in a different file than initially suspected if the probe itself is working correctly. **Mitigation**: Start with thorough testing of the probe function in isolation before tracing downstream usage, ensuring we understand where the value gets lost in the pipeline.

## Definition of Done
1. All 4 progress-tracker checkboxes checked.
2. All tests GREEN.
3. `tools/ci/gate.sh fast` passes.
4. Two consecutive clean audit passes.

## Plan Scope Manifest
| plan-item | paths | items |
|-----------|-------|-------|
| b36c77b3-fix-lmstudio-loaded-context-regression | `packages/opencode/src/provider/lmstudio-probe.ts` | `fix-lmstudio-loaded-context-regression` |