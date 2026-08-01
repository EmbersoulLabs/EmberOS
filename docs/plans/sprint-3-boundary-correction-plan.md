# Sprint 3 Boundary Correction Plan

Plan date: 2026-08-01

Source audit: `docs/reviews/ai-story-boundary-audit.md`

Repository baseline: `feature/sprint-3-execution-engine` at audited commit `02a130f`

Scope: Sprint 3 AI Story boundary correction only

## Executive Summary

Sprint 3 is not ready to freeze because its planning model is Scene-based while its production execution model is Marketing Output-based. The correction must reconnect those two halves without changing the frozen product boundaries or rebuilding shared infrastructure.

The narrow correction is:

```text
Frozen Story Version
→ Animation Package
→ ordered Scene execution records
→ canonical Provider Outbox
→ Dispatcher
→ Worker
→ Seedance Adapter
→ Finalizer
→ Scene attempt/result + usage/cost
→ Scene Review
→ complete approved Scene set
→ deterministic Story assembly
→ Story Video
→ Story export
```

This plan deliberately preserves:

- Existing AI Story screenwriter/director planning and Animation Package structure.
- Existing Video Studio and Auto Clip behavior.
- Existing Creative Studio/Flux boundary.
- Existing Marketing Pipeline and PD-055 behavior inside Marketing only.
- Existing canonical Provider Router, Adapter, Outbox, Dispatcher, Worker, Finalizer, Ledger, usage, and cost components.

The implementation should replace the incorrect AI Story execution slice, not create a second provider system or broaden Sprint 3.

Ready to Implement: **YES**. The frozen boundaries and audit evidence are sufficient; no new Founder decision is required.

Ready to Freeze: **NO**. All freeze blockers in this plan must first pass acceptance.

## Audit Findings Summary

| Finding | Severity | Correction disposition | Phase | Migration | Defer | Freeze blocker |
|---------|----------|------------------------|-------|-----------|-------|----------------|
| ASB-001 | BLOCKER | Replace Marketing variants with Scene execution plan | 1 | YES | NO | YES |
| ASB-002 | BLOCKER | Submit Scene requests through canonical Provider lifecycle | 3 | NO* | NO | YES |
| ASB-003 | BLOCKER | Persist Scene execution, attempts/results, review, and assembly | 2A and 2B | YES | NO | YES |
| ASB-004 | HIGH | Stable Scene identity and idempotent retry/reconciliation | 3–4 | YES | NO | YES |
| ASB-005 | HIGH | Assemble and export one Story Video from approved Scenes | 5 | YES | NO | YES |
| ASB-006 | HIGH | Correlate canonical usage/cost to Scene and Story | 3 | YES | NO | YES |
| ASB-007 | HIGH | Add RLS/equivalent isolation and ownership validation | 2B and 6 | YES | NO | YES |
| ASB-008 | HIGH | Replace invalid tests and add production-wired coverage | 7 | NO | NO | YES |
| ASB-009 | MEDIUM | Replace Marketing Output UI language with Scene/Story language | 5 | NO | NO** | YES as part of ASB-001 |
| ASB-010 | MEDIUM | Stop treating generic Creative records as canonical Story results | 2B and 5 | YES | NO** | YES as part of ASB-003/005 |
| ASB-011 | MEDIUM | Synchronize runtime documentation after behavior is corrected | 8 | NO | YES until code acceptance | NO independently |
| ASB-012 | MEDIUM | Fail closed on the complete ownership chain | 2B and 6 | POSSIBLE | YES for composite DB constraints | NO if repository validation is complete |
| ASB-013 | LOW | Remove deprecated Marketing Output alias after consumer audit | Deferred | NO | YES | NO |

\* ASB-002 can reuse existing provider schema; it still depends on the Scene-correlation database work in Phase 2A.

\** The finding is not independently blocking, but leaving it in the corrected path would preserve the invalid boundary and therefore it is included before freeze.

## Root Cause Analysis

### Systemic causes

1. **Execution reused the nearest output abstraction.** Sprint 3 planning correctly produced Scenes and Shots, but execution reused `MARKETING_OUTPUT_STRATEGY`, generic `creatives`, reviews, and task export instead of defining Scene as the execution unit.
2. **Provider reliability work and AI Story execution evolved in parallel.** AI Story resolved the production Adapter directly instead of entering the already available Outbox/Dispatcher/Worker/Finalizer path.
3. **Persistence followed the incorrect runtime loop.** Tables record `target_output_count` and `output_index`, so the database cannot express Scene attempts, accepted Scene results, or deterministic Story assembly.
4. **Tests validated implementation rather than frozen product boundaries.** Unit tests intentionally assert target-five Story outputs; browser E2E does not traverse the real production path.
5. **Security was applied at routes but not completed at the database boundary.** Workspace role checks exist, but AI Story tables lack checked-in RLS and several internal queries do not validate the full ownership chain.

### Finding-by-finding impact analysis

#### ASB-001 — Marketing Output Strategy drives AI Story execution

1. Root Cause: PD-055's shared Marketing Output configuration was imported into AI Story to choose Provider call count and build variants.
2. Affected modules: AI Story execution contracts, execution compiler, Generate Review, orchestrator, UI, tests; Marketing configuration is referenced but should not be changed.
3. Files likely to change: `packages/shared/src/ai-story-execution.ts`; `packages/agents/src/ai-story/execution-compiler.ts`; `packages/agents/src/ai-story/story-execution-orchestrator.ts`; AI Story execution routes/page; Sprint 3 tests. `packages/shared/src/marketing-output-strategy.ts` should only lose AI Story references/comments, not Marketing behavior.
4. Database impact: Replace target/selected output count semantics with required/completed/approved Scene semantics.
5. Runtime impact: Provider work is enumerated from Animation Package Scenes, not synthetic overall/hook/problem/product/CTA variants.
6. Provider impact: Provider receives one Scene-scoped request with only that Scene's ordered Shots and continuity context.
7. API impact: Generate Review reports Scene count, estimated Scene executions, total duration/cost estimate, and risks; no Marketing output target.
8. UI impact: Progress and review use Scene terminology and Scene ordering.
9. Testing impact: Remove target-five AI Story assertions; add arbitrary Scene count and PD-055 independence tests.
10. Migration required? YES.
11. Can this be deferred? NO.
12. Must block Sprint 3 Freeze? YES.

#### ASB-002 — AI Story bypasses canonical Provider execution

1. Root Cause: `invokeProviderForOutput` constructs an in-memory canonical request then calls `adapter.execute()` directly.
2. Affected modules: AI Story orchestration, Provider request/envelope creation, Outbox producer, Dispatcher, Worker result handoff, Finalizer result consumption.
3. Files likely to change: `packages/agents/src/ai-story/story-execution-orchestrator.ts`; `packages/agents/src/ai-story/execution-compiler.ts`; canonical request/outbox repository entrypoints under `packages/db/src/queries`; queue/worker integration only where a Scene completion callback/consumer is needed. Existing Dispatcher/Worker/Finalizer implementations should be reused, not redesigned.
4. Database impact: Store canonical provider execution ID on the Scene execution correlation record; existing Provider ledger tables remain authoritative.
5. Runtime impact: AI Story schedules work and observes finalized results; it no longer routes or executes Providers itself.
6. Provider impact: Seedance continues behind `animation-video-generation`; only canonical Worker invokes the Adapter.
7. API impact: Execution start becomes asynchronous Scene scheduling; status reads persisted Scene progress.
8. UI impact: No provider implementation detail is exposed; progress may update per Scene.
9. Testing impact: Integration test must prove the exact Outbox → Dispatcher → Worker → Finalizer chain for an AI Story Scene.
10. Migration required? NO for provider infrastructure; YES through Phase 2A Scene correlation.
11. Can this be deferred? NO.
12. Must block Sprint 3 Freeze? YES.

#### ASB-003 — Persistence cannot represent Scene execution or Story assembly

1. Root Cause: `ai_story_execution_outputs` models indexed complete-video variants rather than Scene results.
2. Affected modules: database schema/repositories, shared contracts, orchestrator, review, status, regeneration, export.
3. Files likely to change: `packages/db/src/schema/index.ts`; a new additive Sprint 3 correction SQL migration and apply script; `packages/shared/src/ai-story-execution.ts`; AI Story repository/service files; execution/status/review/regenerate/export routes.
4. Database impact: Add explicit Scene execution identity, ordered Scene reference, provider execution correlation, immutable attempts/accepted result, Scene review state, and Story assembly/result records. Retain historical wrong rows only through a deliberate migration policy; do not silently reinterpret them.
5. Runtime impact: Partial completion and per-Scene status become possible.
6. Provider impact: Each finalized result maps to exactly one Scene execution.
7. API impact: Status returns Scenes and attempts/results rather than generic outputs; regeneration targets a Scene.
8. UI impact: Scene review list and final Story readiness replace output cards.
9. Testing impact: Persistence, uniqueness, immutability, partial completion, accepted-result preservation, and assembly-order tests.
10. Migration required? YES.
11. Can this be deferred? NO.
12. Must block Sprint 3 Freeze? YES.

#### ASB-004 — Retry and idempotency are whole-job and unstable

1. Root Cause: Provider identities use `randomUUID()` per call while BullMQ retries the whole Story job.
2. Affected modules: Scene execution repository, Outbox producer, retry/regeneration API, worker orchestration, reconciliation.
3. Files likely to change: `story-execution-orchestrator.ts`; `packages/queue/src/index.ts` only if Story queue responsibility is narrowed; Scene repositories; retry/regenerate routes; relevant provider reliability integration points.
4. Database impact: Unique stable Scene execution identity; unique canonical provider execution per Scene generation request; accepted attempt/result reference.
5. Runtime impact: A worker retry reloads existing state and resumes/schedules only missing/recoverable Scenes. User regeneration creates a new Scene generation request without mutating the accepted prior result.
6. Provider impact: Stable idempotency key reaches canonical provider request; reconciliation precedes duplicate execution.
7. API impact: Retry endpoint targets failed/recoverable Scene execution; regenerate endpoint targets a reviewed Scene and creates a new attempt/request according to existing lifecycle rules.
8. UI impact: Retry/regenerate actions are Scene-specific and preserve other approved Scenes.
9. Testing impact: crash-after-provider-acceptance, concurrent duplicate start, replay, single-Scene retry, and approved-Scene preservation tests.
10. Migration required? YES.
11. Can this be deferred? NO.
12. Must block Sprint 3 Freeze? YES.

#### ASB-005 — Export uses Marketing task ZIP instead of Story assembly

1. Root Cause: Sprint 3 reused `creatives` and `enqueueTaskExport()` rather than creating a Story-owned assembly boundary.
2. Affected modules: AI Story readiness, scene review, Story assembly, export API/worker, assets/storage.
3. Files likely to change: AI Story export route; AI Story execution service/repository; worker composition/FFmpeg utility integration; queue contracts if a Story assembly job is required; shared Story result contracts. Existing Video Studio export behavior must remain untouched.
4. Database impact: Persist assembly identity/version, ordered accepted Scene result membership, assembly status, final Story video asset/reference, and export state.
5. Runtime impact: Assembly starts only when all required Scenes are approved and uses their canonical order. Export returns the assembled Story Video.
6. Provider impact: None; assembly is not a Provider generation call.
7. API impact: Separate assemble/readiness/export Story endpoints or revised existing Story endpoints; no generic task ZIP gate based on one approved output.
8. UI impact: Story Preview and Export Story Video become available only after assembly readiness.
9. Testing impact: deterministic ordering, missing/rejected Scene blocking, idempotent assembly, retry-safe export, and file-result validation.
10. Migration required? YES.
11. Can this be deferred? NO.
12. Must block Sprint 3 Freeze? YES.

#### ASB-006 — Usage and cost are not canonical or Scene attributable

1. Root Cause: Direct Adapter calls bypass Finalizer and only store a flat list of execution IDs; the Adapter returns a fixed estimate.
2. Affected modules: canonical Provider finalization integration, Scene execution correlation, status/read models, billing aggregation readers.
3. Files likely to change: AI Story orchestration/repository; provider request metadata/correlation construction; possibly read-only aggregation helpers. `provider-execution-finalizer.ts` and provider ledger repositories should change only if a generic correlation field already approved by contracts is missing.
4. Database impact: Correlate canonical provider execution ID to Scene execution; reuse `provider_attempt_usage` and `provider_attempt_costs` as canonical facts.
5. Runtime impact: AI Story reads finalized usage/cost; it does not calculate provider-specific prices.
6. Provider impact: Seedance Adapter continues normalizing usage/cost; hardcoded estimate must not become Story billing authority.
7. API impact: Generate Review may expose approved estimates; execution status may expose aggregate totals derived from canonical records.
8. UI impact: Scene/Story cost display, if already in scope, reads aggregates and never assumes five calls.
9. Testing impact: one cost/usage record per attempt; retries aggregate separately; accepted result traceability; Story/workspace roll-up tests.
10. Migration required? YES for Scene correlation; NO for existing ledger tables.
11. Can this be deferred? NO.
12. Must block Sprint 3 Freeze? YES.

#### ASB-007 — AI Story database isolation is incomplete

1. Root Cause: route-level workspace authorization was implemented without matching AI Story RLS/equivalent policies and full-chain repository assertions.
2. Affected modules: all AI Story persistence, Campaign Asset resolution, API authorization, RLS tests.
3. Files likely to change: new correction migration; `packages/db/sql/rls.sql` or the repository's canonical RLS migration path; AI Story repositories/services; regenerate/status/review/export routes; `tests/rls-coverage.test.ts`; isolation integration tests.
4. Database impact: Enable isolation policies for every AI Story table and new Scene/assembly tables.
5. Runtime impact: Fail closed on mismatched org/workspace/campaign/story/version/package/Scene IDs and Campaign Asset links.
6. Provider impact: No provider request is created until ownership validation passes.
7. API impact: All path IDs must match the same authorized aggregate; return not-found/forbidden consistently.
8. UI impact: None beyond correct error handling.
9. Testing impact: cross-workspace, cross-campaign, cross-story, foreign asset, foreign execution/result, review, and export denial tests.
10. Migration required? YES.
11. Can this be deferred? NO.
12. Must block Sprint 3 Freeze? YES.

#### ASB-008 — Test suite certifies the wrong execution model

1. Root Cause: tests were derived from the output-variant implementation and browser tests are smoke checks.
2. Affected modules: unit, database integration, provider contract, worker integration, authorization, browser E2E, real-provider validation.
3. Files likely to change: `tests/sprint-3-execution-engine.test.ts`; `tests/sprint-3-prompt-builder.test.ts`; `tests/sprint-3-seedance-contract.test.ts`; new/updated AI Story database and provider integration suites; `e2e/ai-story-execution.spec.ts`.
4. Database impact: Test fixtures/factories must create Scene execution and assembly records through production repositories.
5. Runtime impact: Production call path becomes testable end to end.
6. Provider impact: Deterministic Adapter remains test-only; one controlled real Seedance acceptance validates the live contract.
7. API impact: Contract tests cover Scene-specific start/status/retry/review/assemble/export.
8. UI impact: Browser E2E exercises actual Scene cards/status/actions and Story export.
9. Testing impact: This finding is itself the testing workstream; invalid target-five assertions are removed only when replacement behavior exists.
10. Migration required? NO.
11. Can this be deferred? NO.
12. Must block Sprint 3 Freeze? YES.

#### ASB-009 — UI uses Marketing Output terminology

1. Root Cause: UI mirrors generic output/Creative runtime concepts.
2. Affected modules: AI Story editor execution panel and localized strings if present.
3. Files likely to change: `apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx`; related components/locales created or used by the correction.
4. Database impact: None.
5. Runtime impact: None independently.
6. Provider impact: None.
7. API impact: UI consumes Scene-oriented responses.
8. UI impact: Use Create/Plan Story, Story Scenes, Generate/Review/Regenerate Scene, Story Preview, Export Story Video. Do not expose Provider selection.
9. Testing impact: Component and browser assertions prevent Marketing/Auto Clip/Creative Studio language inside AI Story.
10. Migration required? NO.
11. Can this be deferred? NO for corrected production UI; cosmetic cleanup outside this path may defer.
12. Must block Sprint 3 Freeze? YES as part of ASB-001.

#### ASB-010 — Generic Creatives are authoritative AI Story results

1. Root Cause: shared Marketing review/export persistence was reused for Story videos.
2. Affected modules: AI Story result persistence, review, assets, export; generic Marketing Creative modules must remain unchanged.
3. Files likely to change: `story-execution-orchestrator.ts`; AI Story review/export routes; schema/repository files; `apps/web/src/app/api/reviews/[id]/decide/route.ts` if it currently synchronizes Story output status.
4. Database impact: Scene result and Story video records become AI Story authoritative. Generic Creative links are removed from the canonical path or become an explicit post-export handoff only.
5. Runtime impact: Scene review no longer depends on generic Creative status.
6. Provider impact: None beyond Scene result persistence.
7. API impact: AI Story-specific review endpoints own Scene decisions.
8. UI impact: AI Story reviews Scenes and Story preview, not Marketing Creatives.
9. Testing impact: Assert no Creative creation during Scene generation; explicit handoff, if any, remains outside Sprint 3.
10. Migration required? YES.
11. Can this be deferred? NO for authoritative ownership; removal of harmless legacy rows can defer.
12. Must block Sprint 3 Freeze? YES through ASB-003/005.

#### ASB-011 — Documentation endorses the wrong coupling

1. Root Cause: runtime documentation was synchronized to the flawed Sprint 3 implementation.
2. Affected modules: runtime docs, README references, Sprint status documentation.
3. Files likely to change: `docs/AI_STORY_EXECUTION_V1.md`; relevant parts of `docs/AI_STORY_V1.md` and `README.md`. Video Studio/Marketing docs change only if they falsely claim AI Story ownership.
4. Database impact: None.
5. Runtime impact: None.
6. Provider impact: Document canonical Scene provider path only.
7. API impact: Document corrected Scene endpoints/contracts after implementation.
8. UI impact: Document corrected terminology after UI acceptance.
9. Testing impact: Documentation-reference/search guard may prevent reintroduction of forbidden coupling.
10. Migration required? NO.
11. Can this be deferred? YES until runtime/test acceptance; not beyond freeze.
12. Must block Sprint 3 Freeze? NO independently, but final synchronization is on the checklist.

#### ASB-012 — Ownership columns can disagree

1. Root Cause: independent foreign keys exist without composite ownership enforcement; some internal loads use only one ID.
2. Affected modules: AI Story repositories, Scene orchestration, asset resolution, all mutation/read endpoints.
3. Files likely to change: AI Story repository/service queries; execution runner; regenerate/status/review/export routes; isolation tests. Composite constraints may affect the correction migration if selected.
4. Database impact: Minimum requirement is fail-closed repository validation. Composite constraints/indexes are optional if they are not required to achieve equivalent integrity safely.
5. Runtime impact: No package, Scene, output, asset, or assembly proceeds when hierarchy identities conflict.
6. Provider impact: No request dispatch for mismatched ownership.
7. API impact: Every path ID is verified against the loaded Campaign/Story aggregate.
8. UI impact: None beyond safe errors.
9. Testing impact: Mismatched but individually valid IDs must fail.
10. Migration required? POSSIBLE, not mandatory if repository validation plus RLS provides equivalent safety.
11. Can this be deferred? YES for stronger composite constraints; NO for fail-closed validation.
12. Must block Sprint 3 Freeze? NO independently if fail-closed validation and isolation tests pass.

#### ASB-013 — Deprecated Marketing Output alias remains

1. Root Cause: compatibility rename retained old terminology.
2. Affected modules: AI Story exports and possible test imports.
3. Files likely to change: `packages/agents/src/ai-story/story-execution-orchestrator.ts`; package barrel exports/tests if referenced.
4. Database impact: None.
5. Runtime impact: None because production uses the replacement symbol.
6. Provider impact: None.
7. API impact: None.
8. UI impact: None.
9. Testing impact: Consumer search before removal.
10. Migration required? NO.
11. Can this be deferred? YES.
12. Must block Sprint 3 Freeze? NO.

## Correction Phases

### Mandatory Phase Review Policy

Every phase, including Phase 0, Phase 2A, and Phase 2B, must end with this mandatory sequence:

```text
Implementation
↓
Review
↓
Approval
↓
Next Phase
```

Implementation must not continue into the next phase without explicit approval of the current phase's acceptance criteria and evidence. A failed or incomplete review returns work to the same phase; it does not authorize partial progression. Parallel preparation described in the dependency graph may continue only when it does not depend on unapproved outputs and does not activate the next production path.

### Phase 0 — Frozen Implementation Contracts

Purpose:

- Establish only the frozen implementation contracts for Scene execution, Scene result, Scene review, and Story assembly using the already frozen concepts.
- Define the permitted identities, ownership boundaries, immutability rules, and state vocabulary that later phases must implement.

Affected modules:

- Shared AI Story execution contracts.

Affected files:

- `packages/shared/src/ai-story-execution.ts`
- `packages/shared/src/index.ts`

Dependencies:

- Audit report and frozen boundaries only.

Risk: LOW

Potential regressions:

- Contract ambiguity could propagate into later persistence and runtime phases.

Rollback complexity:

- LOW; no persistence or production caller changes are included.

Production impact:

- None. Phase 0 does not perform inventory, repository design, migration planning, or runtime wiring.

Acceptance Criteria:

- Scene is explicitly the execution unit.
- Scene count derives from `AnimationPackage.scenePlan` only.
- Marketing Output Strategy is absent from AI Story execution contracts.
- Story Version, Animation Package, Scene execution, Scene attempt/result, Scene review, Story assembly, and Story Video have distinct contract meanings.
- Story Version immutability from execution start is explicit.
- No Video Studio, Creative Studio, Marketing, or Provider-specific responsibility is moved into AI Story.

Phase Review Gate:

- Implementation → Review → Approval → Next Phase.
- Phase 1 must not begin until the frozen implementation contracts receive explicit approval.

### Phase 1 — Scene Execution Compiler and Generate Review

Purpose:

- Compile one deterministic provider-neutral execution intent per Scene.
- Preserve ordered Shots, continuity context, Story/Version/Package identity, and Campaign Asset references.
- Make Generate Review estimate the actual Scene plan rather than five Marketing outputs.

Affected modules:

- AI Story execution compiler.
- Generate Review.
- Seedance payload preparation boundary, without invoking Seedance.

Affected files:

- `packages/agents/src/ai-story/execution-compiler.ts`
- `packages/shared/src/ai-story-execution.ts`
- `packages/agents/src/ai-story/prompt-builder.ts`
- `packages/agents/src/ai-story/story-execution-orchestrator.ts`
- Generate Review API route and tests

Dependencies:

- Phase 0 contracts.

Risk: HIGH

Potential regressions:

- Loss of continuity context when splitting complete Story prompts into Scene payloads.
- Incorrect Shot ordering or duration totals.
- Campaign Assets leaking across Scenes or workspaces.

Rollback complexity:

- MEDIUM; compiler can be reverted before persistence cutover.

Production impact:

- Generate Review response changes; execution remains disabled until Phases 2A, 2B, and 3 are approved.

Acceptance Criteria:

- N Animation Package Scenes produce exactly N ordered Scene execution intents, independent of PD-055.
- Repeated compilation of the same frozen Story Version and Animation Package produces identical Scene ordering and stable Scene identities.
- Every intent contains only the target Scene's Shots plus required continuity/context.
- Asset IDs are stable references and are validated as belonging to the authorized Campaign/workspace.
- No Flux, image-generation, Auto Clip, Marketing Output, or generic Creative behavior exists in the compiler.
- Estimates derive from Scene duration/provider-normalized estimation inputs, never a fixed five-call assumption.

Phase Review Gate:

- Implementation → Review → Approval → Next Phase.
- Phase 2A must not begin until deterministic Scene compilation and Generate Review behavior receive explicit approval.

### Phase 2A — Database, Repository, and Identity

Purpose:

- Inventory the currently applied Sprint 3 schema/data and production consumers before designing the additive correction migration.
- Introduce the minimum database and repository model for Scene execution identity, immutable attempts/results, and canonical Provider correlation.
- Preserve recoverable legacy data without treating incorrect output rows as canonical Scenes.

Affected modules:

- Database schema/migrations.
- AI Story repositories.
- Shared persistence contracts.

Affected files:

- `packages/db/src/schema/index.ts`
- A new additive Sprint 3 boundary-correction SQL migration and apply script
- New or updated AI Story repository/query files under `packages/db/src/queries`
- `packages/shared/src/ai-story-execution.ts`
- Database fixtures/integration helpers

Dependencies:

- Phase 0 contracts.
- Phase 1 Scene intent identity.

Risk: CRITICAL

Potential regressions:

- Data loss if an old destructive migration is edited/reapplied.
- Incorrect cascade behavior erasing provider/accounting history.
- Duplicate Scene attempts under concurrent scheduling.
- Incorrect identity relationships between Story Version, Animation Package, Scene, and canonical Provider execution.

Rollback complexity:

- HIGH. Use an additive migration, retain legacy tables/columns until corrected production acceptance, and define a reversible cutover flag only if the repository already supports such flags.

Production impact:

- New tables/columns and repositories; no corrected provider dispatch until Phase 3.

Acceptance Criteria:

- Story Version becomes immutable once execution begins.
- Story Version/Animation Package/Scene identity is immutable for an execution plan.
- Scene execution has stable deterministic identity and status constraints.
- Attempts/results are append-only; one accepted result is identifiable without overwriting history.
- Appropriate uniqueness/idempotency constraints prevent duplicate canonical Scene executions/results.
- Cascade behavior cannot delete canonical Provider ledger/cost facts.
- Existing incorrect output rows are not silently relabeled as Scenes.

Phase Review Gate:

- Implementation → Review → Approval → Next Phase.
- Phase 2B must not begin until database identity, repository invariants, additive migration safety, and rollback evidence receive explicit approval.

### Phase 2B — Scene Review, Story Assembly Persistence, RLS, and Ownership Validation

Purpose:

- Add the minimum persistence for attributable Scene review decisions and deterministic Story assembly.
- Establish RLS/equivalent isolation and fail-closed ownership validation before corrected runtime dispatch.
- Complete the migration treatment for legacy incorrect Sprint 3 rows based on the inventory from Phase 2A.

Affected modules:

- Scene review repositories.
- Story assembly persistence.
- Database RLS.
- Ownership-chain and Campaign Asset validation.

Affected files:

- `packages/db/src/schema/index.ts`
- The new additive Sprint 3 boundary-correction SQL migration and apply script from Phase 2A
- `packages/db/sql/rls.sql` or the canonical RLS migration equivalent
- New or updated AI Story repository/query files under `packages/db/src/queries`
- AI Story service/repository ownership checks
- Database fixtures/integration helpers

Dependencies:

- Approved Phase 2A database identity and repository model.

Risk: HIGH

Potential regressions:

- RLS blocking legitimate service operations or allowing cross-tenant access.
- Review decisions referencing a result from the wrong Scene or Story.
- Assembly membership accepting stale, rejected, or foreign Scene results.
- Legacy incorrect rows becoming authoritative through an unsafe migration mapping.

Rollback complexity:

- MEDIUM to HIGH. Policies and new persistence remain additive; legacy rows/tables stay non-authoritative until final acceptance.

Production impact:

- New review/assembly records and access policies; no corrected provider dispatch until Phase 3.

Acceptance Criteria:

- Scene review decisions are attributable and preserve rejected/previous results.
- Story assembly references an ordered complete set of accepted Scene results and one final Story video result.
- All AI Story and new Scene/review/assembly tables have RLS/equivalent workspace/tenant isolation.
- Repository operations fail closed on mismatched org/workspace/campaign/story/version/package/Scene/result identities.
- Campaign Asset references are verified against the current Campaign and workspace.
- Legacy incorrect output rows remain preserved but non-authoritative unless a deterministic mapping is proven.

Phase Review Gate:

- Implementation → Review → Approval → Next Phase.
- Phase 3 must not begin until review/assembly persistence, RLS, and ownership validation receive explicit approval.

### Phase 3 — Canonical Provider Lifecycle Integration

Purpose:

- Replace direct Adapter execution with the existing canonical Outbox → Dispatcher → Worker → Finalizer path.
- Correlate each canonical execution with exactly one Story Scene.

Affected modules:

- AI Story scheduling/orchestration.
- Provider request/envelope/outbox creation.
- Existing Dispatcher, Worker, Finalizer, Ledger, usage, and cost readers.
- Scene completion projection.

Affected files:

- `packages/agents/src/ai-story/story-execution-orchestrator.ts`
- `packages/agents/src/ai-story/execution-compiler.ts`
- relevant provider outbox/envelope query entrypoints under `packages/db/src/queries`
- `apps/worker/src/provider-execution-dispatch-entrypoint.ts`
- `apps/worker/src/provider-dispatch-worker.ts`
- `apps/worker/src/provider-execution-finalizer.ts`
- Scene result projection/consumer added at the narrow integration boundary

Dependencies:

- Phase 1 Scene intents.
- Approved Phase 2A Scene identity/persistence.
- Approved Phase 2B review/assembly persistence, RLS, and ownership validation.

Risk: CRITICAL

Potential regressions:

- Duplicate provider calls during cutover.
- Result finalized in canonical ledger but not projected to Scene state.
- Correlation mismatch between Scene and provider execution.
- Existing non-Story provider flows affected by over-broad changes.

Rollback complexity:

- HIGH. Keep changes additive and scoped by capability/correlation metadata; do not modify generic lifecycle semantics unless a proven generic contract gap exists.

Production impact:

- AI Story execution authority changes from direct Adapter call to canonical persisted execution.

Acceptance Criteria:

- No production AI Story code resolves and executes a Provider Adapter directly.
- One Scene intent creates one canonical execution envelope/outbox job with stable identity.
- Dispatcher and Worker validate persisted identities and invoke Seedance only through the canonical path.
- Finalizer atomically accepts terminal result, usage, cost, and Outbox state.
- Finalized result projects idempotently to its Scene execution/result without changing ledger authority.
- Replays/concurrent scheduling converge; conflicting identities fail closed.
- Provider execution correlation includes Story, Story Version, Animation Package, and Scene IDs without putting mutable business objects in canonical execution contracts.
- No Flux Provider is eligible for the AI Story animation capability.

### Mandatory Runtime Acceptance Gate — STOP Before Phase 4

Implementation must **STOP** after Phase 3 until this exact production path passes:

```text
One Scene
↓
Outbox
↓
Dispatcher
↓
Worker
↓
Seedance
↓
Finalizer
↓
Usage Ledger
↓
Cost Ledger
↓
Scene Result Projection
↓
PASS
```

Gate evidence must prove one real Scene identity remains consistent across every stage, the terminal result is finalized exactly once, usage and cost are persisted canonically, and Scene Result Projection is idempotent. Mock-only or direct-Adapter execution does not satisfy this gate.

Phase Review Gate:

- Implementation → Review → Approval → Next Phase.
- Phase 4 is prohibited until the Runtime Acceptance Gate receives explicit approval.

### Phase 4 — Scene Lifecycle, Retry, Regeneration, and Review

Purpose:

- Complete partial execution behavior around the canonical Scene model.
- Preserve approved Scenes while retrying/regenerating only the selected Scene.

Affected modules:

- Scene scheduler/status projector.
- Retry/recovery/reconciliation integration.
- Scene review API and Story readiness calculation.

Affected files:

- AI Story execution service/repository
- execution status route
- `[jobId]/retry` and `[jobId]/regenerate` routes, reshaped around Scene identity
- review route(s), including removal of generic Creative authority
- shared state transition contracts
- worker/queue integration only where Scene scheduling requires it

Dependencies:

- Phase 2A Scene persistence.
- Phase 2B review/assembly persistence and ownership validation.
- Phase 3 canonical provider integration.

Risk: HIGH

Potential regressions:

- Accepted Scene result overwritten by regeneration.
- Whole Story accidentally retried after one Scene failure.
- Story marked ready with missing/rejected Scenes.
- User cancellation races with finalization.

Rollback complexity:

- MEDIUM to HIGH depending on in-flight Scene executions.

Production impact:

- User-visible Scene statuses and targeted controls become authoritative.

Acceptance Criteria:

- Multiple Scenes may be queued/running/completed independently.
- Failed/recoverable Scene retry uses stable canonical identity/reconciliation and does not rerun approved Scenes.
- Regeneration preserves prior attempts/results and creates a new reviewable result for that Scene.
- Rejection affects only the selected Scene and blocks final Story readiness.
- Cancellation has a persisted terminal/recoverable outcome consistent with Provider state.
- Story assembly readiness is true only when every required Scene has an accepted approved result.
- The API validates Campaign, Story, package, Scene, execution, result, and workspace identities as one chain.

Phase Review Gate:

- Implementation → Review → Approval → Next Phase.
- Phase 5 must not begin until partial completion, Scene retry/regeneration, review, and readiness behavior receive explicit approval.

### Phase 5 — Story Assembly, Export, API, and UI Boundary

Purpose:

- Produce one deterministic Story video from ordered approved Scene videos.
- Remove generic Marketing Creative/task export as the authoritative AI Story result path.
- Make UI terminology and actions reflect Scene execution and Story export.

Sprint 3 Story Assembly scope is strictly limited to:

```text
Ordered approved Scene videos
↓
Deterministic concatenation
↓
Single Story Video
```

Sprint 3 Story Assembly must not add AI editing, transition effects, subtitle styling, cinematic composition, audio remix, or any Video Studio feature. Those responsibilities remain exclusively in Video Studio.

Affected modules:

- Story assembly worker/service.
- Storage/asset result handling.
- AI Story export API.
- AI Story editor execution/review UI.

Affected files:

- AI Story export/status/review routes
- AI Story Story page and any extracted Scene components
- queue contract/worker processor only if an asynchronous Story assembly job is needed
- existing neutral FFmpeg composition utilities where reusable without Video Studio dependency
- AI Story result repositories/contracts
- generic review synchronization code that currently updates Story outputs

Dependencies:

- Phase 4 accepted Scene lifecycle.
- Phase 2B assembly persistence.

Risk: HIGH

Potential regressions:

- Wrong Scene order or media concatenation failure.
- Exporting a stale assembly after Scene regeneration.
- Accidental changes to Video Studio/Auto Clip exports.
- Duplicate final Story assets on replay.

Rollback complexity:

- MEDIUM; assembly outputs are derivable from immutable accepted Scene results.

Production impact:

- Correct final user deliverable and corrected UI/API behavior.

Acceptance Criteria:

- Assembly fingerprint is deterministic from Story Version, ordered Scene IDs, and accepted Scene result identities.
- Missing, failed, pending, or rejected required Scenes block assembly/export.
- Repeated assembly converges to one canonical Story video result.
- Export returns the assembled Story video, not N variant videos or a Marketing ZIP.
- AI Story generation does not create generic Marketing Creatives/captions/hashtags.
- UI uses Scene and Story terminology and clearly remains separate from Video Studio and Creative Studio.
- No “Generate Marketing Outputs”, fixed-five, Auto Clip, Flux, or image-generation language appears in AI Story production UI.
- Assembly performs deterministic concatenation only; no AI editing, transition effects, subtitle styling, cinematic composition, audio remix, or Video Studio behavior is present.

Phase Review Gate:

- Implementation → Review → Approval → Next Phase.
- Final security acceptance and full verification must not proceed on an unapproved Story assembly/export path.

### Phase 6 — Security and Ownership Acceptance

Purpose:

- Verify fail-closed multi-tenant behavior after all corrected persistence and APIs exist.

Affected modules:

- Database RLS.
- API authorization.
- Campaign Asset validation.
- Scene/result/review/export ownership checks.

Affected files:

- RLS migration/policies
- AI Story repositories/services/routes
- `tests/rls-coverage.test.ts`
- workspace/tenant isolation integration suites

Dependencies:

- Phase 2B policies and records.
- Phases 3–5 production access paths.

Can run independently:

- RLS policy design/tests are implemented in Phase 2B; Phase 6 performs end-to-end acceptance after production paths exist.
- Final end-to-end authorization acceptance waits for Phase 5.

Risk: HIGH

Potential regressions:

- Service worker denied by policy.
- Authorized operator unable to act.
- Cross-workspace object reference accepted through a partially scoped query.

Rollback complexity:

- HIGH for unsafe policy rollback; security must fail closed.

Production impact:

- Access behavior may become stricter; correct 403/404 handling is required.

Acceptance Criteria:

- One workspace cannot read or mutate another workspace's Story, package, Scene execution, attempt/result, review, assembly, export, or Campaign Asset.
- Same-workspace but wrong-Campaign/wrong-Story path IDs fail closed.
- Worker/service access is explicit and least-privileged.
- All relevant tables are included in RLS coverage tests.
- No provider request is scheduled using an unauthorized or unlinked Campaign Asset.

Phase Review Gate:

- Implementation → Review → Approval → Next Phase.
- Phase 7 full verification must not begin until security and ownership acceptance receive explicit approval.

### Phase 7 — Verification and Freeze Test Suite

Purpose:

- Replace tests that preserve the invalid model and prove the corrected production path.

Affected modules:

- Unit, integration, contract, worker, database, security, browser E2E, real Seedance acceptance, manual happy path.

Affected files:

- `tests/sprint-3-execution-engine.test.ts`
- `tests/sprint-3-prompt-builder.test.ts`
- `tests/sprint-3-seedance-contract.test.ts`
- new/updated AI Story boundary and production-path integration tests
- `e2e/ai-story-execution.spec.ts`
- test factories/helpers

Dependencies:

- Unit/contract tests may track each preceding phase.
- Full integration/E2E requires Phases 1–6.

Risk: MEDIUM

Potential regressions:

- Test-only adapters accidentally imported by production.
- Browser test passes without traversing real APIs/worker.
- Live Provider test creates cost without cleanup/traceability.

Rollback complexity:

- LOW; tests are non-production, but failures must block freeze.

Production impact:

- None except controlled real-provider validation.

Acceptance Criteria:

- Unit tests prove Scene derivation, Shot ordering, transitions, assembly fingerprint, and PD-055 independence.
- Database tests prove uniqueness, immutability, ownership, RLS, partial completion, and accepted-result preservation.
- Integration test proves Scene → Outbox → Dispatch → Worker → Finalizer → usage/cost → Scene result.
- Retry/recovery tests prove no duplicate Provider call and no regeneration of approved Scenes.
- Browser E2E creates a multi-Scene Story, confirms Generate Review, observes Scene completion, reviews/regenerates a Scene, assembles, and exports the Story video.
- Real Seedance validation asserts an actual finalized video result and canonical cost/usage trace for one controlled Scene.
- Negative tests prove no Flux, Marketing Output Strategy, Creative Studio internals, or Video Studio internals in AI Story execution.
- `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, relevant Playwright suite, and `git diff --check` pass.

Phase Review Gate:

- Implementation → Review → Approval → Next Phase.
- Phase 8 documentation synchronization must not begin until the complete freeze test suite receives explicit approval.

### Phase 8 — Documentation Synchronization and Freeze Evidence

Purpose:

- Align runtime documentation with accepted production behavior and capture freeze evidence.

Affected modules:

- AI Story runtime docs, README/Sprint notes, API/schema documentation where present.

Affected files:

- `docs/AI_STORY_EXECUTION_V1.md`
- relevant sections of `docs/AI_STORY_V1.md`
- relevant sections of `README.md`
- Sprint 3 acceptance documentation already used by the repository

Dependencies:

- Phases 1–7 accepted.

Risk: LOW

Potential regressions:

- Documentation describing intended rather than verified behavior.
- Accidental edits to frozen Blueprint decisions or unrelated module docs.

Rollback complexity:

- LOW.

Production impact:

- None.

Acceptance Criteria:

- AI Story documentation describes Scene execution and one Story video export.
- PD-055 is referenced only by Marketing/Auto Clip contexts, not AI Story.
- Video Studio and Creative Studio ownership remain unchanged.
- Production call graph, schema, API, UI, and tests match the documentation.
- Audit blockers are closed with file/test evidence and no unresolved HIGH/BLOCKER item remains.

Phase Review Gate:

- Implementation → Review → Approval → Next Phase.
- Sprint 3 freeze must not be declared until Phase 8 documentation and freeze evidence receive explicit approval.

## Dependency Graph

```text
Phase 0 — Frozen implementation contracts
  ↓
Phase 1 — Scene compiler and Generate Review
  ↓
Phase 2A — Database, repository, and identity
  ↓
Phase 2B — Scene review, assembly persistence, RLS, ownership
  ↓
Phase 3 — Canonical Provider lifecycle integration
  ↓
MANDATORY RUNTIME ACCEPTANCE GATE
One Scene → Outbox → Dispatcher → Worker → Seedance → Finalizer
→ Usage Ledger → Cost Ledger → Scene Result Projection → PASS
  ↓
Phase 4 — Scene retry, regeneration, review, readiness
  ↓
Phase 5 — Story assembly, export, API, UI
  ↓
Phase 7 — Full verification and freeze tests
  ↓
Phase 8 — Documentation and freeze evidence

Phase 2B ─────→ Phase 6 — Security/ownership acceptance ─────→ Phase 7
Phase 1 ─────→ unit/contract tests (continuous) ───────→ Phase 7
```

Hard dependencies:

- Phase 1 cannot safely finalize identifiers before Phase 0 contracts are agreed in code.
- Phase 2A must precede Phase 2B because review, assembly, RLS, and ownership require approved Scene identities and repositories.
- Phase 2B must precede production Provider dispatch because finalized results need an isolated, ownership-validated canonical Scene target.
- Phase 3 and its mandatory Runtime Acceptance Gate must pass before retry/review implementation begins.
- Phase 4 must precede assembly because assembly eligibility depends on accepted reviewed Scene results.
- Phase 5 must precede browser happy-path acceptance.
- Phase 7 must pass before documentation may claim Sprint 3 is complete.

Independent/parallel work:

- Security acceptance fixture preparation can proceed alongside Phase 3 after Phase 2B is approved; implementation may not bypass the phase approval policy.
- UI component structure and neutral Scene labels can be prepared alongside Phase 4, but must not ship against the old output API.
- Unit tests for each phase should be written with that phase rather than postponed entirely to Phase 7.
- Documentation diffs may be drafted after Phase 5 but merged only after verification.

## Freeze Blockers

The following are true Sprint 3 blockers and must not be deferred:

1. Any AI Story production import/use of `MARKETING_OUTPUT_STRATEGY`, `targetOutputCount`, or synthetic Marketing variants.
2. Any direct AI Story call to `ProviderAdapter.execute()`.
3. Missing persisted Scene identity, stable canonical execution identity, immutable attempt/result history, accepted result, or Scene review state.
4. Whole-Story retry that can duplicate Provider calls or regenerate approved Scenes.
5. Missing/ambiguous mapping from Provider finalization and usage/cost to Scene and Story.
6. Final readiness/export based on “at least one approved output” rather than the complete required approved Scene set.
7. Export of generic Marketing Creatives instead of one deterministic assembled Story video.
8. Missing RLS/equivalent isolation for AI Story/Scene/assembly records or any verified cross-tenant/cross-workspace access path.
9. Campaign Asset execution lookup that does not fail closed on Campaign/workspace ownership.
10. Tests that continue to assert five AI Story outputs or cannot prove production-wired Scene execution.
11. No browser multi-Scene happy path and no controlled real Seedance finalized-result validation.

## Deferred Work

These items are valid but do not block Sprint 3 once the checklist passes:

- Remove `regenerateSingleMarketingOutput` after a consumer search confirms no remaining use.
- Delete or archive legacy incorrect Sprint 3 rows/tables after retention and rollback needs are resolved. They must remain non-authoritative immediately.
- Stronger composite foreign-key constraints beyond the minimum fail-closed repository validation and RLS coverage.
- Broader generic “output” naming cleanup outside the corrected AI Story path.
- Provider observability dashboards beyond the existing canonical usage/cost records.
- Additional Seedance providers or provider-specific optimization.
- Explicit handoff of an exported Story video into Video Studio.
- Creative Studio/Flux implementation work.
- Marketing Pipeline/PD-055 runtime changes.
- Advanced Story editing, professional composition, or new assembly features beyond deterministic concatenation of approved Scenes.
- Deployment documentation cleanup beyond the minimum Seedance configuration/validation evidence.

## Sprint 3 Freeze Checklist

### Boundary

- [ ] AI Story remains Campaign-owned and separate from Video Studio, Creative Studio, and Marketing Pipeline.
- [ ] AI Story production code contains no Flux/image-generation path.
- [ ] AI Story production code does not import Video Studio or Creative Studio internals.
- [ ] PD-055 and Marketing Output Strategy are absent from AI Story execution, UI, API, schema semantics, and tests.
- [ ] Scene count is derived only from the frozen Animation Package.

### Scene execution model

- [ ] Story Version becomes immutable once execution begins.
- [ ] Animation Package compilation is deterministic.
- [ ] Repeated compilation of the same Story Version produces identical Scene ordering.
- [ ] Story, Scene, Shot, Provider execution, generated Scene video, assembled Story video, and Marketing Output are distinct contracts and persistence concepts.
- [ ] Every required Animation Package Scene has an ordered Scene execution record.
- [ ] Every Scene Provider request contains the correct ordered Shots and required continuity context.
- [ ] Multiple Scenes and multiple Shots per Scene are supported without a fixed 3–5 limit.
- [ ] Partial completion, failed, cancelled, rejected, and regeneration states are represented.

### Canonical Provider lifecycle

- [ ] Runtime follows Outbox → Dispatcher → immutable Dispatch → Worker → Adapter → immutable result → Finalizer.
- [ ] Finalizer atomically records ledger terminal state, usage, cost, and Outbox terminal state.
- [ ] AI Story never directly invokes a Provider Adapter.
- [ ] Only Seedance is eligible for AI Story animation-video generation; approved LLM routing remains limited to planning.
- [ ] Stable Scene execution identity/idempotency survives queue retries and worker crashes.
- [ ] Concurrent/replayed scheduling converges without duplicate Provider calls or duplicate Scene results.

### Review, retry, and assembly

- [ ] One failed Scene can be retried independently.
- [ ] Approved Scenes are preserved during retries/regeneration of another Scene.
- [ ] Rejected Scene results remain historical and do not become assembly inputs.
- [ ] Final Story readiness requires every required Scene to have an approved accepted result.
- [ ] Assembly order is deterministic and traceable to Story Version/Animation Package/Scene results.
- [ ] Repeated assembly/export is idempotent.
- [ ] Export produces one Story Video result, not Marketing outputs or a generic Creative ZIP.
- [ ] Story Assembly is limited to ordered approved Scene videos → deterministic concatenation → one Story Video.
- [ ] Story Assembly contains no AI editing, transition effects, subtitle styling, cinematic composition, audio remix, or Video Studio feature.

### Security

- [ ] All AI Story, Scene execution/result/review, and assembly tables have RLS/equivalent tenant/workspace isolation.
- [ ] All routes/repositories validate one consistent org/workspace/campaign/story/version/package/Scene chain.
- [ ] Campaign Assets are verified as authorized and linked to the current Campaign before dispatch.
- [ ] Cross-workspace and mismatched same-workspace identifiers fail closed.

### Usage and cost

- [ ] Every Scene attempt has a canonical Provider ledger record.
- [ ] Provider usage/cost is persisted once per attempt through Finalizer.
- [ ] Retry cost remains distinct and can aggregate Provider execution → Scene → Story → Workspace billing period.
- [ ] AI Story contains no provider-specific pricing branch or fixed-five cost calculation.

### API and UI

- [ ] API start/status/retry/regenerate/review/assemble/export contracts are Scene/Story based.
- [ ] UI displays Scene progress and Scene review/regeneration controls.
- [ ] UI exposes Story Preview and Export Story Video only when ready.
- [ ] AI Story UI contains no Marketing Output, Auto Clip, Creative Studio, image-generation, or fixed-five wording.

### Verification

- [ ] Unit tests cover Scene compilation, ordering, lifecycle, idempotency, and assembly.
- [ ] Database integration tests cover persistence, uniqueness, immutability, RLS, and ownership.
- [ ] Production-path integration test covers Outbox → Dispatcher → Worker → Finalizer → Scene result → usage/cost.
- [ ] Retry/recovery tests prove one-Scene retry and approved-Scene preservation.
- [ ] Browser E2E completes a real multi-Scene happy path through Story export.
- [ ] Controlled real Seedance validation verifies a finalized Scene video and accounting trace.
- [ ] Test-only Provider helpers are not imported by production code.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm test:integration` passes.
- [ ] Relevant Playwright AI Story suite passes.
- [ ] `git diff --check` passes.

### Documentation and acceptance

- [ ] Runtime documentation matches verified Scene-based behavior.
- [ ] No documentation claims AI Story generates 3–5 Marketing videos.
- [ ] No BLOCKER or HIGH audit finding remains open.
- [ ] A final boundary re-audit traces actual production imports and wiring.
- [ ] Every phase completed Implementation → Review → Approval before the next phase began.
- [ ] The mandatory Phase 3 Runtime Acceptance Gate passed before Phase 4 began.

## Final Recommendation

Implement the correction in the dependency order above, using vertical acceptance checkpoints after Phases 3, 4, and 5:

1. **Provider checkpoint:** one Scene completes through the canonical lifecycle with ledger, usage, and cost.
2. **Lifecycle checkpoint:** a multi-Scene Story partially fails, retries one Scene, preserves approved Scenes, and reaches complete review readiness.
3. **Product checkpoint:** approved Scenes assemble deterministically into one exportable Story Video through the real browser path.

Do not begin by changing UI labels or deleting legacy code. First establish the Scene contract and persistence, then switch Provider authority, then complete review/assembly, and finally synchronize UI/tests/docs. This order minimizes the period in which code and data disagree and avoids expanding work into Video Studio, Creative Studio, Marketing, or future Provider features.

Ready to Implement:
YES

Ready to Freeze:
NO
