# BP — Fix regression: LM Studio probe should use loaded_context_length (the actual context window of the m
**UUID:** `49c85862`. **Type:** fix. **Lifecycle: PLANNED**
## Header
**Goal:** Fix regression: LM Studio probe should use loaded_context_length (the actual context window of the model currently loaded in LM Studio) for compaction calculations, but instead it's using max_context_length (the model's maximum declared context). The sidebar shows the max context window size instead of the loaded context. Investigate whether applyProbeMergeToLimit or provider.ts Site B is overriding/ignoring the probed limits, and ensure loaded_context_length takes priority over max_context_length in all code paths including compaction calculations.

**Type:** fix

## Architecture Overview
The regression stems from an inconsistency between `max_context_length` (the model's declared capability) and `loaded_context_length` (the actual context window currently loaded in LM Studio). The current implementation defaults to the static maximum, causing the sidebar to display incorrect capacity and compaction algorithms to miscalculate token budgets. This fix requires a unified priority resolution where `loaded_context_length` supersedes `max_context_length` across all provider layers, from the protocol definitions down to the UI rendering logic in `packages/opencode`.

## Phases
1.  **Audit & Identify Override Points**: Review `applyProbeMergeToLimit` and Site B logic in `packages/llm/src/provider.ts` and `packages/core/src/provider.ts` to determine if they are discarding probed limits in favor of static model metadata.
2.  **Protocol & Schema Updates**: Update `packages/protocol/src/groups/provider.ts` and `packages/schema/src/provider.ts` to explicitly define the precedence rules for context length fields, ensuring `loaded_context_length` is treated as the source of truth when present.
3.  **Core Logic Refactoring**: Modify compaction calculation paths in `packages/core/src/config/provider.ts` and related config files to prioritize `loaded_context_length`. This includes verifying that `packages/stats/core/src/domain/provider.ts` correctly reports the loaded value for telemetry.
4.  **Server & Handler Alignment**: Ensure `packages/server/src/handlers/provider.ts` and `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts` propagate the correct context length to the client without fallback to `max_context_length`.
5.  **UI Rendering Fix**: Update `packages/opencode/src/provider/provider.ts` and `packages/console/app/src/routes/zen/util/provider/provider.ts` to display `loaded_context_length` in the sidebar, ensuring visual parity with the actual compaction limits.

## Phase Ordering & Dependencies
| Phase | Depends On | Blocks |
| :--- | :--- | :--- |
| 1. Audit | None | All subsequent phases; requires understanding of current override logic. |
| 2. Protocol/Schema | Phase 1 decisions on field precedence | Phases 3-5; ensures type safety for the new priority rules. |
| 3. Core Logic | Phase 2 schema updates | Phase 4; compaction math must be correct before server propagation. |
| 4. Server/Handlers | Phase 3 logic changes | Phase 5; client receives data only after server is updated. |
| 5. UI Rendering | Phase 4 API responses | None; final visual verification of the fix. |

## Session Execution Protocol
Execute phases sequentially to maintain consistency between schema definitions and implementation logic. Begin with a read-only audit of `applyProbeMergeToLimit` in `packages/llm/src/provider.ts` to document exactly where `max_context_length` is being selected over the probed value. Once override points are identified, implement changes in Phase 2 (Schema) first to prevent type errors during the core logic refactoring in Phase 3. Use `git bisect` or targeted logging in `packages/opencode/src/provider/provider.ts` if the regression persists after initial changes, specifically checking if Site B is re-applying static limits post-probe.

## Progress Tracker
- [ ] Implement `packages/llm/src/provider.ts`
- [ ] Implement `packages/core/src/provider.ts`
- [ ] Implement `packages/core/src/v1/config/provider.ts`
- [ ] Implement `packages/core/src/config/provider.ts`
- [ ] Implement `packages/core/src/config/plugin/provider.ts`
- [ ] Implement `packages/core/src/plugin/provider.ts`
- [ ] Implement `packages/server/src/handlers/provider.ts`
- [ ] Implement `packages/protocol/src/groups/provider.ts`
- [ ] Implement `packages/schema/src/provider.ts`
- [ ] Implement `packages/stats/core/src/domain/provider.ts`
- [ ] Implement `packages/opencode/test/fake/provider.ts`
- [ ] Implement `packages/opencode/src/provider/provider.ts`
- [ ] Implement `packages/opencode/src/server/routes/instance/httpapi/groups/provider.ts`
- [ ] Implement `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`
- [ ] Implement `packages/console/core/src/provider.ts`
- [ ] Implement `packages/console/app/src/routes/zen/util/provider/provider.ts`
- [ ] Author tests red-first (confirm each fails, then passes)
- [ ] `tools/ci/gate.sh fast` passes
- [ ] Audit to convergence (two consecutive clean passes)

## File Inventory
| File | Action | Purpose |
|------|--------|---------|
| `packages/llm/src/provider.ts` | Modify/Create | Touched by this plan |
| `packages/core/src/provider.ts` | Modify/Create | Touched by this plan |
| `packages/core/src/v1/config/provider.ts` | Modify/Create | Touched by this plan |
| `packages/core/src/config/provider.ts` | Modify/Create | Touched by this plan |
| `packages/core/src/config/plugin/provider.ts` | Modify/Create | Touched by this plan |
| `packages/core/src/plugin/provider.ts` | Modify/Create | Touched by this plan |
| `packages/server/src/handlers/provider.ts` | Modify/Create | Touched by this plan |
| `packages/protocol/src/groups/provider.ts` | Modify/Create | Touched by this plan |
| `packages/schema/src/provider.ts` | Modify/Create | Touched by this plan |
| `packages/stats/core/src/domain/provider.ts` | Modify/Create | Touched by this plan |
| `packages/opencode/test/fake/provider.ts` | Modify/Create | Touched by this plan |
| `packages/opencode/src/provider/provider.ts` | Modify/Create | Touched by this plan |
| `packages/opencode/src/server/routes/instance/httpapi/groups/provider.ts` | Modify/Create | Touched by this plan |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts` | Modify/Create | Touched by this plan |
| `packages/console/core/src/provider.ts` | Modify/Create | Touched by this plan |
| `packages/console/app/src/routes/zen/util/provider/provider.ts` | Modify/Create | Touched by this plan |

## Risks & Mitigations
-   **Risk**: `loaded_context_length` may be undefined for models not currently loaded in LM Studio, causing UI crashes or NaN values in compaction calculations.
    -   **Mitigation**: Implement a safe fallback to `max_context_length` only when `loaded_context_length` is explicitly null/undefined, ensuring the sidebar always shows a valid number while prioritizing the loaded value.
-   **Risk**: Compaction algorithms may break if `loaded_context_length` is significantly smaller than `max_context_length`, leading to premature truncation.
    -   **Mitigation**: Validate that compaction thresholds in `packages/core/src/config/provider.ts` are dynamically adjusted based on the loaded length, not hardcoded against the maximum.
-   **Risk**: Site B (`applyProbeMergeToLimit`) may silently ignore the new priority rules if it assumes static metadata is authoritative.
    -   **Mitigation**: Add explicit unit tests in `packages/opencode/test/fake/provider.ts` that verify `loaded_context_length` overrides `max_context_length` even when Site B logic is invoked.

## Definition of Done
1. All 19 progress-tracker checkboxes checked.
2. All tests GREEN.
3. `tools/ci/gate.sh fast` passes.
4. Two consecutive clean audit passes.

## Plan Scope Manifest
| plan-item | paths | items |
|-----------|-------|-------|
| 49c85862-fix-lmstudio-loaded-context-regression | `packages/llm/src/provider.ts`, `packages/core/src/provider.ts`, `packages/core/src/v1/config/provider.ts`, `packages/core/src/config/provider.ts`, `packages/core/src/config/plugin/provider.ts`, `packages/core/src/plugin/provider.ts`, `packages/server/src/handlers/provider.ts`, `packages/protocol/src/groups/provider.ts`, `packages/schema/src/provider.ts`, `packages/stats/core/src/domain/provider.ts`, `packages/opencode/test/fake/provider.ts`, `packages/opencode/src/provider/provider.ts`, `packages/opencode/src/server/routes/instance/httpapi/groups/provider.ts`, `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`, `packages/console/core/src/provider.ts`, `packages/console/app/src/routes/zen/util/provider/provider.ts` | `fix-lmstudio-loaded-context-regression` |