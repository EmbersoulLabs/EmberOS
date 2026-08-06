# EmberOS AI Story Boundary Audit

Audit date: 2026-07-31  
Repository: `EmberOS`  
Branch reviewed: `feature/sprint-3-execution-engine`  
Reviewed HEAD: `02a130f`  
Method: static, read-only inspection of production imports, routes, workers, schemas, tests, and repository documentation. No runtime service or live provider was invoked.

## Executive Verdict

Overall:  
FAIL

Ready to Freeze Sprint 3:  
NO

Top reasons:

1. AI Story execution is output-variant based, not scene based. It imports the Marketing Output Strategy, targets five outputs, and sends the complete Story/Scene/Shot manifest to Seedance once per marketing-style variant.
2. AI Story calls the Provider Adapter directly and bypasses the persistence-backed Outbox → Dispatcher → Worker → Finalizer path, so canonical finalization, usage, cost, retry, and idempotency controls do not govern these calls.
3. Persistence has no scene execution identity, scene attempt model, per-scene review link, or final Story assembly record. One failed scene cannot be retried safely because the runtime does not execute scenes independently.

The active Sprint 3 path no longer contains a Flux/image-generation call. That correction is real, but it does not repair the scene-versus-marketing-output architecture.

## Frozen Architecture Summary

- **AI Story** owns Campaign-scoped Story creation, screenwriter/director planning, Story Beats, Scenes, Shots, continuity, Animation Package, Seedance scene generation, scene review, deterministic Story assembly, and Story video export. Its execution unit is a Scene, with one or more attempts and a provider result attached to that Scene.
- **Video Studio** owns uploaded-video processing: compression, transcription, scene/highlight detection, Auto Clip, subtitles, BGM/TTS, covers, short-form creation, and video export. An exported Story video may enter Video Studio only through an explicit asset handoff.
- **Creative Studio** owns image and creative-asset production, including Flux and background/image generation. AI Story may consume its approved assets only through stable Campaign Asset IDs.
- **Marketing Pipeline** owns Marketing Outputs and PD-055's quality-first target of five (allowed three to five). This quantity is not an AI Story scene count, Seedance call count, or Story output count.

## Production Runtime Call Graph

### Production path actually wired

```text
Story editor page
  apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx
    → POST .../planning/approve
    → ai_story_animation_packages.status = ready_for_execution
    → POST .../execution/review
    → createGenerateReview()
    → POST .../execution { confirm: true }
    → startExecutionJob()
      → tasks row
      → ai_story_execution_jobs row
    → enqueueStoryExecution()
    → BullMQ agent.story_execution
    → apps/worker/src/processors/index.ts
    → runExecutionJob()
    → compileExecutionManifest()
      → one complete Story/Scene/Shot provider request
    → buildOutputVariantsFromManifest()
      → PD-055 marketing variants (target five)
    → loop once per variant
    → invokeProviderForOutput()
    → CanonicalProviderRouter
    → production registry
    → SeedanceVideoAdapter.execute() DIRECTLY
    → assets + creatives + reviews + ai_story_execution_outputs
    → execution_review
    → review decision synchronizes output status
    → POST .../execution/export
    → enqueueTaskExport()
    → existing multi-Creative task ZIP export
```

Production evidence:

- API enqueue: `apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/route.ts:62-88`.
- Queue contract: `packages/queue/src/jobs.ts:74-83`; producer: `packages/queue/src/index.ts:80-90`.
- Worker consumer: `apps/worker/src/processors/index.ts:193-198`.
- Variant loop and direct Provider call: `packages/agents/src/ai-story/story-execution-orchestrator.ts:502-560`.
- Direct Adapter execution bypass: `packages/agents/src/ai-story/story-execution-orchestrator.ts:310-433`.
- Review/export coupling to `creatives`: `apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/export/route.ts:50-104`.

### Canonical provider lifecycle present but bypassed by AI Story

```text
provider outbox
  → dispatchNextProviderExecution()
  → ExecutionDispatch
  → ProviderExecutionWorker.execute()
  → Provider Adapter
  → ProductionProviderFinalizer
  → ledger + usage + cost + outbox terminal state
```

The worker starts the provider polling loop at `apps/worker/src/processors/index.ts:579-596`, but AI Story never places its Seedance request into that path. The direct call at `story-execution-orchestrator.ts:413` is the authoritative AI Story runtime path.

### Test-only paths

- `DeterministicSeedanceTestAdapter` is enabled only under test flags: `packages/agents/src/provider-adapters/deterministic-seedance-test-adapter.ts:3-4,59-60`.
- Browser execution tests do not exercise the real Story flow; the two UI tests only load `/`, and the live Seedance check only asserts that a key exists: `e2e/ai-story-execution.spec.ts:20-46`.

### Legacy paths

- `regenerateSingleMarketingOutput` remains as a deprecated alias to `regenerateSingleExecutionOutput`: `packages/agents/src/ai-story/story-execution-orchestrator.ts:836-837`.
- `ai_story_execution_v1.sql` drops and recreates `ai_story_execution_outputs`; despite the comment that it corrects the marketing-output mistake, the recreated model remains output-index based: `packages/db/sql/ai-story-execution-v1.sql:1-3,44-69`.

### Dead or unwired code

- The canonical provider Outbox/Dispatcher/Finalizer is live in the worker but unwired to AI Story execution.
- No active Flux implementation or AI Story image-generation queue path was found. Remaining Flux mentions are documentation/test assertions stating that Flux is excluded.

## Findings Summary

| ID | Severity | Area | Finding | File / Symbol | Freeze Blocker |
|----|----------|------|---------|---------------|----------------|
| ASB-001 | BLOCKER | Execution model | AI Story generates 3–5 complete Story video variants using Marketing Output Strategy instead of scene jobs | `execution-compiler.ts`; `runExecutionJob` | YES |
| ASB-002 | BLOCKER | Provider lifecycle | AI Story directly executes Seedance Adapter and bypasses Outbox/Dispatcher/Worker/Finalizer | `invokeProviderForOutput` | YES |
| ASB-003 | BLOCKER | Database | No scene execution/attempt/review/assembly persistence; scene cannot be retried independently | `ai_story_execution_jobs`, `ai_story_execution_outputs` | YES |
| ASB-004 | HIGH | Idempotency | Random execution IDs and BullMQ whole-job retry can duplicate provider calls and outputs | `invokeProviderForOutput`; `enqueueStoryExecution` | YES |
| ASB-005 | HIGH | Export boundary | AI Story exports approved variant Creatives through Marketing/Auto Clip task ZIP, not one assembled Story video | execution export route; `processTaskExportJob` | YES |
| ASB-006 | HIGH | Cost/usage | Direct Story calls do not enter canonical ledger/finalizer; cost is fixed per adapter result and not attributable to Story Scene | Seedance Adapter; Provider ledger | YES |
| ASB-007 | HIGH | Security | AI Story tables have no RLS policies in checked-in SQL; server routes check roles, but DB defense-in-depth and direct-client isolation are absent | AI Story SQL; `rls.sql` | YES |
| ASB-008 | HIGH | Testing | Tests encode target-five Story outputs; browser E2E is smoke-only and no production provider lifecycle integration covers AI Story | Sprint 3 tests; E2E | YES |
| ASB-009 | MEDIUM | UI language | AI Story UI explicitly says “produce/review Marketing Outputs” | AI Story page | NO |
| ASB-010 | MEDIUM | Ownership | Generated Story videos are persisted as generic `creatives` with captions/hashtags, blurring AI Story and Marketing ownership | `runExecutionJob` | NO after model correction |
| ASB-011 | MEDIUM | Documentation | Sprint 3 execution document states AI Story consumes PD-055 for variants, contradicting frozen boundaries | `docs/AI_STORY_EXECUTION_V1.md` | NO after runtime correction |
| ASB-012 | MEDIUM | Referential integrity | Duplicated org/workspace/campaign/story IDs are not constrained to represent the same ownership chain | AI Story execution schema | NO |
| ASB-013 | LOW | Legacy naming | Deprecated `regenerateSingleMarketingOutput` retains the invalid product term | orchestrator alias | NO |

## Detailed Findings

### ASB-001 — Marketing output count drives AI Story execution

Severity: BLOCKER  
Area: Scene vs Output  
Files: `packages/agents/src/ai-story/execution-compiler.ts`; `packages/agents/src/ai-story/story-execution-orchestrator.ts`; `packages/shared/src/marketing-output-strategy.ts`; `packages/shared/src/ai-story-execution.ts`  
Symbols: `buildGenerateReviewEstimate`, `buildOutputVariantsFromManifest`, `runExecutionJob`, `AiStoryExecutionProgressSchema`

Production impact: A Story with any number of Scenes produces up to five unrelated complete-video variants. Scene count does not control execution units.

Evidence:

- `execution-compiler.ts:65-70` multiplies total Story duration and cost by `DEFAULT_TARGET_OUTPUTS`.
- `execution-compiler.ts:78,95` presents “Target 5 marketing videos”.
- `execution-compiler.ts:182-193,234-258` creates synthetic overall/hook/problem/product/CTA candidates from PD-055.
- `story-execution-orchestrator.ts:502-560` loops over those variants and sends the same complete manifest for every Provider call.
- `ai-story-execution.ts:47-49,63` exposes `completedOutputs`, `targetOutputs`, and `targetOutputCount` in the Story execution contract.

Expected behavior: Compile one executable unit per Scene (or an explicit provider-constrained scene segment), link every attempt/result to that Scene, and derive final Story readiness from required Scene approvals.

Current behavior: The complete Story is one provider payload and marketing-style variants determine the number of executions.

Recommended fix: Remove Marketing Output Strategy from AI Story contracts/compiler/orchestrator. Introduce a Scene-keyed execution plan derived only from Animation Package Scenes, without changing Marketing Pipeline behavior.

Required before Sprint 3 freeze: YES

### ASB-002 — AI Story bypasses the canonical provider lifecycle

Severity: BLOCKER  
Area: Provider boundary  
Files: `packages/agents/src/ai-story/story-execution-orchestrator.ts`; `apps/worker/src/processors/index.ts`; `apps/worker/src/provider-execution-dispatch-entrypoint.ts`; `apps/worker/src/provider-execution-finalizer.ts`  
Symbols: `invokeProviderForOutput`, `runExecutionJob`, `dispatchNextProviderExecution`, `ProductionProviderFinalizer.finalize`

Production impact: Seedance calls are not governed by immutable envelopes/dispatches, canonical finalization, Outbox terminal transitions, recovery, or ledger uniqueness.

Evidence: `invokeProviderForOutput` constructs an in-memory payload and random identity, resolves the production Adapter, then invokes `adapter.execute()` directly at `story-execution-orchestrator.ts:413`. The canonical provider loop is separately wired at `processors/index.ts:579-596` and is not called by AI Story.

Expected behavior: Each Scene execution enters the canonical provider request/outbox path and returns through the Worker result and Finalizer.

Current behavior: AI Story owns routing, request creation, Adapter execution, and output persistence in one service.

Recommended fix: Make AI Story submit Scene execution intents to the existing canonical production provider path and consume finalized results. Do not create another provider lifecycle.

Required before Sprint 3 freeze: YES

### ASB-003 — Persistence cannot represent scene execution and assembly

Severity: BLOCKER  
Area: Database  
Files: `packages/db/sql/ai-story-execution-v1.sql`; `packages/db/src/schema/index.ts`; `packages/shared/src/ai-story-execution.ts`  
Symbols: `aiStoryExecutionJobs`, `aiStoryExecutionOutputs`, `AiStoryExecutionOutputSchema`

Production impact: One failed Scene cannot be identified, retried, reviewed, or replaced without regenerating a whole output. Approved Scenes cannot be preserved across a partial retry. Final Story assembly cannot be reproduced from ordered approved Scene assets.

Evidence: `ai_story_execution_outputs` has `output_index` but no `scene_id`, `shot/segment identity`, `attempt_number`, `accepted_attempt_id`, or assembly membership (`ai-story-execution-v1.sql:44-69`). Scene IDs exist only inside JSON manifests (`ai-story-execution.ts:98-138`).

Expected behavior: Persist Story → Scene execution → attempt → provider result → Scene review, plus an ordered Story assembly/export reference.

Current behavior: Persist execution job → indexed animation video variant, optionally linked to generic `creative` and asset rows.

Recommended fix: Correct the data model around Scene identity and attempts; preserve immutable accepted Scene results and represent deterministic Story assembly. Migration design is outside this audit.

Required before Sprint 3 freeze: YES

### ASB-004 — Story execution is not idempotent under queue retries

Severity: HIGH  
Area: Retry and concurrency  
Files: `packages/queue/src/index.ts`; `packages/agents/src/ai-story/story-execution-orchestrator.ts`; `packages/db/sql/ai-story-execution-v1.sql`  
Symbols: `getQueue`, `enqueueStoryExecution`, `invokeProviderForOutput`, `runExecutionJob`

Production impact: BullMQ retries an `agent.story_execution` job up to three times by default. Each provider call receives new random execution/attempt/idempotency IDs, so a worker crash after provider acceptance can create duplicate Seedance generations.

Evidence: queue defaults specify `attempts: 3` (`queue/src/index.ts:54-59`); random IDs are generated for every invocation (`story-execution-orchestrator.ts:320-323`); the only output uniqueness is `(execution_job_id, output_index)`, which does not prevent a duplicate external call.

Expected behavior: Stable Scene execution identity and provider idempotency key across retries, with lookup/reconciliation before another call.

Current behavior: Retry is whole-job and identity is regenerated per call.

Recommended fix: Route through canonical persistence-backed provider execution and derive stable idempotency from Story Version + Animation Package + Scene + attempt policy.

Required before Sprint 3 freeze: YES

### ASB-005 — Export is a Marketing/Creative ZIP, not Story assembly

Severity: HIGH  
Area: Export boundary  
Files: `apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/export/route.ts`; `apps/worker/src/processors/export-handler.ts`  
Symbols: execution export `POST`, `processTaskExportJob`

Production impact: Export accepts any non-empty set of approved variant outputs and queues the existing task export. It does not verify that every required Scene is approved or assemble Scenes in Story order into one Story video.

Evidence: export gate is `approved.length > 0` at route lines 50-64; approved rows are synchronized to generic Creatives and sent to `enqueueTaskExport` at lines 67-104.

Expected behavior: Export one deterministic Story video assembled from the complete required approved Scene set.

Current behavior: Export a task pack of approved independent execution outputs.

Recommended fix: Separate Story assembly eligibility from Marketing task export. An explicit future handoff may publish the assembled Story asset elsewhere.

Required before Sprint 3 freeze: YES

### ASB-006 — Cost and usage are not canonical or scene attributable

Severity: HIGH  
Area: Cost accounting  
Files: `packages/agents/src/provider-adapters/seedance-video-adapter.ts`; `packages/agents/src/ai-story/story-execution-orchestrator.ts`; `packages/db/src/queries/provider-execution-finalizer.ts`; `packages/db/src/schema/index.ts`  
Symbols: `SeedanceVideoAdapter.execute`, `invokeProviderForOutput`, `ProviderExecutionFinalizationRepository.finalize`

Production impact: AI Story's direct calls return `{ amount: 0.35 }` and empty usage but bypass the Finalizer that persists `provider_attempt_usage` and `provider_attempt_costs`. No canonical link aggregates Provider execution → Scene → Story → Workspace billing period.

Evidence: Adapter fixed estimate at `seedance-video-adapter.ts:223-225`; direct call at orchestrator line 413; canonical attempt usage/cost tables exist at schema lines 761-780 but AI Story does not use them.

Expected behavior: Every attempt is finalized canonically and carries Story/Scene correlation; aggregation is Provider execution → Scene → Story → Workspace billing period.

Current behavior: Story job tracks only provider execution ID strings and a Story-level target count.

Recommended fix: Use canonical provider finalization and add non-provider-specific Story/Scene correlation at the execution boundary. Do not add pricing logic to AI Story.

Required before Sprint 3 freeze: YES

### ASB-007 — AI Story tables lack checked-in RLS coverage

Severity: HIGH  
Area: Security and multi-tenancy  
Files: `packages/db/sql/ai-story-v1.sql`; `packages/db/sql/ai-story-planning-v1.sql`; `packages/db/sql/ai-story-execution-v1.sql`; `packages/db/sql/rls.sql`; `tests/rls-coverage.test.ts`  
Symbols: all `ai_story_*` tables and RLS policies

Production impact: Server API routes generally call `requireWorkspaceRole`, but database-level tenant isolation for Story, Version, Animation Package, execution job, and output rows is not present in checked-in SQL. Direct Supabase access safety cannot be established.

Evidence: none of the AI Story SQL files enables RLS or creates policies; `rls.sql` covers core tables but not `ai_story_*`; the RLS coverage test list does not demonstrate AI Story coverage.

Expected behavior: Workspace/tenant isolation at every access layer, including validated asset references and execution/output ownership.

Current behavior: Application routes enforce workspace roles, while AI Story persistence relies on server-side discipline and duplicated ownership columns.

Recommended fix: Define and test RLS/equivalent isolation for every AI Story table before acceptance. Also validate the full org/workspace/campaign/story/package ownership chain in repositories.

Required before Sprint 3 freeze: YES

### ASB-008 — Tests preserve the wrong model and do not validate production wiring

Severity: HIGH  
Area: Testing  
Files: `tests/sprint-3-execution-engine.test.ts`; `tests/sprint-3-prompt-builder.test.ts`; `e2e/ai-story-execution.spec.ts`  
Symbols: PD-055 suite, Generate Review assertions, browser execution suite

Production impact: A green suite can certify the exact architecture the freeze forbids.

Evidence: execution tests assert target/min/max five/three/five (`sprint-3-execution-engine.test.ts:9-43`); prompt-builder test asserts `targetOutputCount === 5`; browser tests only visit `/` or check that a key is non-empty (`e2e/ai-story-execution.spec.ts:20-46`).

Expected behavior: Tests prove multiple Scenes, per-Scene attempts/retries, preservation of approved Scenes, partial failure, canonical provider finalization, isolation, assembly, and Story export.

Current behavior: Unit coverage validates marketing-count behavior and provider payload shape; browser coverage does not traverse the Story execution path.

Recommended fix: Replace invalid assumptions and add production-wired integration/E2E coverage after the model is corrected.

Required before Sprint 3 freeze: YES

### ASB-009 — AI Story UI uses Marketing Output language

Severity: MEDIUM  
Area: UI and language  
Files: `apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx`  
Symbols: status banner, `ExecutionPanel`

Production impact: Users are told AI Story produces Marketing Outputs, obscuring the difference between Story Scenes and Marketing deliverables.

Evidence: line 315 says “produce Marketing Outputs”; line 713 says “Review Marketing Outputs”. The panel manages generic `outputs` and “Regenerate One”.

Expected behavior: Create Story, Story Scenes, Generate/Review/Regenerate Scene, Story Preview, Export Story Video.

Current behavior: Story planning language is mostly correct, but execution/review language changes to Marketing Outputs.

Recommended fix: Align labels after runtime concepts are corrected; do not cosmetically rename the existing output-variant model and leave behavior unchanged.

Required before Sprint 3 freeze: NO independently; YES as part of ASB-001 correction

### ASB-010 — Generic Creative records hide module ownership

Severity: MEDIUM  
Area: Module ownership  
Files: `packages/agents/src/ai-story/story-execution-orchestrator.ts`; `packages/db/src/schema/index.ts`  
Symbols: `runExecutionJob`, `creatives`

Production impact: Every AI Story variant becomes a generic Marketing Creative containing captions/hashtags and is reviewed/exported by shared Marketing infrastructure. Its Story Scene identity is absent.

Evidence: orchestrator inserts `assets`, then `creatives`, `reviews`, and `ai_story_execution_outputs` per variant at lines 566-638; output contract includes caption/hashtags at `ai-story-execution.ts:170-175`.

Expected behavior: Generated Scene videos remain AI Story-owned records/assets; cross-module reuse occurs through stable exported asset identity.

Current behavior: AI Story results are adapted into the generic Creative/task model internally.

Recommended fix: Make ownership explicit and restrict shared infrastructure to neutral capabilities rather than Marketing semantics.

Required before Sprint 3 freeze: NO independently; model correction is required

### ASB-011 — Runtime documentation endorses the invalid coupling

Severity: MEDIUM  
Area: Documentation  
Files: `docs/AI_STORY_EXECUTION_V1.md`; `docs/AI_STORY_V1.md`; `README.md`; `docs/VIDEO_STUDIO.md`  
Symbols: execution invariants and module descriptions

Production impact: Future changes may preserve the wrong design because the runtime document calls it intentional.

Evidence: `AI_STORY_EXECUTION_V1.md:24` says AI Story uses `MARKETING_OUTPUT_STRATEGY` for variant selection. `AI_STORY_V1.md` correctly describes planning through Animation Package, while the Sprint 3 document changes the execution meaning. Video Studio/Auto Clip documentation is otherwise separate.

Expected behavior: PD-055 applies to Marketing Outputs/Auto Clip only; AI Story Scenes are derived from narrative planning.

Current behavior: Documentation explicitly bridges PD-055 into AI Story execution.

Recommended fix: Synchronize documentation only after the runtime correction is approved. Preserve Video Studio and Creative Studio boundaries.

Required before Sprint 3 freeze: NO independently

### ASB-012 — Ownership columns can disagree across related rows

Severity: MEDIUM  
Area: Database integrity  
Files: `packages/db/sql/ai-story-v1.sql`; `packages/db/sql/ai-story-planning-v1.sql`; `packages/db/sql/ai-story-execution-v1.sql`  
Symbols: Story, Animation Package, execution job, execution output foreign keys

Production impact: A row can reference a Story, Campaign, Workspace, org, and Animation Package that each exist but do not belong to the same hierarchy; individual FKs do not prove the chain.

Evidence: execution job/output schemas store multiple independent FKs but have no composite ownership constraint. Runtime loaders often filter by workspace, but `runExecutionJob` loads a package by package ID alone at orchestrator lines 477-485.

Expected behavior: Repository validation or composite constraints guarantee one consistent tenant/workspace/campaign/story/version/package chain.

Current behavior: Integrity depends on creation code and route-level checks.

Recommended fix: Enforce the chain in the persistence boundary and tests; exact database design is an implementation decision.

Required before Sprint 3 freeze: NO unless database access is exposed outside trusted services

### ASB-013 — Deprecated Marketing Output alias remains

Severity: LOW  
Area: Legacy naming  
Files: `packages/agents/src/ai-story/story-execution-orchestrator.ts`  
Symbols: `regenerateSingleMarketingOutput`

Production impact: No active production import was found, but the name encourages the invalid ownership model.

Evidence: deprecated alias at lines 836-837; production route imports the replacement name.

Expected behavior: AI Story regeneration is Scene based.

Current behavior: safe compatibility alias remains.

Recommended fix: Remove after consumers are verified during hardening.

Required before Sprint 3 freeze: NO

## Scene vs Output Model

### Current actual model

```text
Story Version
  → Animation Package containing Scenes and Shots in JSON
  → one compiled complete-Story provider request
  → synthetic PD-055 candidate variants (overall/hook/problem/product/CTA)
  → 3–5 Seedance calls with the same full Story request plus outputIndex
  → ai_story_execution_outputs
  → generic Creative + Review per output
  → export approved outputs as a task ZIP
```

Current concept separation:

| Concept | Separate in code? | Actual meaning |
|---------|-------------------|----------------|
| Scene | Planning-only | JSON element inside Animation Package/manifest; not executable persistence |
| Shot | Planning-only | JSON element and prompt section; no independent result |
| Provider execution | Partially | ID string per variant; no canonical Story-scene ledger relationship |
| Generated scene video | NO | No Scene-linked generated-video record exists |
| Story video | NO | No deterministic assembled Story result exists |
| Marketing output | Effectively merged | AI Story execution variants use PD-055 semantics and generic Creatives |

### Required model

```text
Frozen Story Version
  → Animation Package
  → ordered Scene execution jobs
  → one or more immutable provider attempts per Scene
  → Scene video result linked to Scene and accepted attempt
  → Scene Review
  → required approved Scene set
  → deterministic Story assembly
  → Story video result
  → Story export
```

Conclusion: the code does **not** currently treat Scene, execution output, Story video, and Marketing Output as four separate concepts. This is a critical architecture violation.

### Ambiguous concepts requiring correction

| File / Symbol | Current meaning | Why dangerous | Correct meaning |
|---------------|-----------------|---------------|-----------------|
| `aiStoryExecutionJobs.targetOutputCount` | Number of complete Story variants | Imports Marketing quantity into AI Story | Remove; required Scene count derives from Animation Package |
| `AiStoryExecutionProgress.targetOutputs` | Variant goal, default five | UI/progress can imply five Story videos | Track required/completed Scenes |
| `buildOutputVariantsFromManifest` | Builds overall/hook/problem/product/CTA Story videos | Treats Story as Marketing Output generator | No AI Story equivalent; Scene execution plan replaces it |
| `ai_story_execution_outputs.output_index` | Variant index | Cannot identify or retry a Scene | Scene identity plus attempt/result identity |
| `AiStoryExecutionOutput` | Generic complete animation video | Ambiguous between Scene result and final Story | Distinct Scene result and Story video result contracts |
| `generated_video_asset_id` | Variant asset | No ownership/assembly meaning | Scene video asset ID or final Story asset ID, explicitly typed |
| `creative_id` | Marketing Creative backing an AI Story output | Hides module ownership | Explicit optional handoff only after Story export |
| `provider_execution_ids` | Flat job-level list | Cannot attribute cost/result to Scene | Scene execution/attempt relationship |

## Module Dependency Matrix

| From | To | Allowed | Actual | Result |
|------|----|---------|--------|--------|
| AI Story | Seedance | YES, through canonical Provider lifecycle and Scene jobs | Direct Adapter call per Story variant | FAIL |
| AI Story | Flux | NO | No active import/call found | PASS |
| AI Story | Creative Studio internals | NO | No internal-service import found | PASS |
| AI Story | Campaign Assets | YES, stable IDs/approved contract | Reads asset IDs and resolves workspace assets | PARTIAL: does not verify Campaign link during execution |
| AI Story | Video Studio internals | NO | No Auto Clip/FFmpeg planning import; export reuses generic task-export infrastructure | PARTIAL |
| Video Studio | AI Story internals | NO | No import found | PASS |
| Creative Studio | AI Story internals | NO | No import found; full Creative Studio production module was not identified | PASS/UNKNOWN |
| Marketing Pipeline | AI Story internals | NO | No import found | PASS |
| AI Story | Marketing Output Strategy | NO | Direct import and production use | FAIL |
| AI Story | generic Marketing Creative/review/export | Only explicit post-export handoff | Internal persistence and export dependency | FAIL |

## Database Review

| Table | Real responsibility | Review |
|-------|---------------------|--------|
| `ai_stories` | Campaign-owned Story aggregate/status | Correct owner; status is unconstrained text and RLS absent |
| `ai_story_versions` | Versioned structured Story content/freeze metadata | Useful boundary; uniqueness `(story_id, version_number)` exists; RLS absent |
| `ai_story_asset_links` | Story-to-asset reference | Stable ID concept exists; execution resolver checks workspace asset but not Campaign reference |
| `ai_story_creative_contexts` | Planning context snapshot | Correct planning owner; ownership chain not composite-constrained |
| `ai_story_animation_packages` | Planning/Animation Package JSON | Correct high-level boundary; Scenes/Shots live only in payload JSON |
| `ai_story_execution_jobs` | Whole-Story marketing-variant execution batch | Incorrect responsibility; target count, flat provider IDs, no Scene key/idempotency constraint |
| `ai_story_execution_outputs` | Complete-video variant + generic Creative link | Ambiguous/incorrect; no Scene/attempt/assembly identity |
| `provider_executions` / `provider_attempts` | Canonical provider ledger | Correct generic infrastructure, but bypassed by AI Story |
| `provider_attempt_usage` / `provider_attempt_costs` | Canonical attempt accounting | Correct generic infrastructure, but AI Story does not persist through it |
| `assets` | Workspace/Campaign media assets | Used for generated Story variants; ownership exists but role is metadata-only |
| `creatives` / `reviews` | Marketing Creative review/export path | Incorrectly authoritative for AI Story execution review/export |

Constraint findings:

- Present: version uniqueness; output uniqueness by `(execution_job_id, output_index)`; provider attempt uniqueness by `(execution_id, attempt_number)` in the canonical ledger.
- Missing for AI Story: Scene execution identity; stable idempotency key; accepted Scene attempt; Scene result uniqueness; review uniqueness/decision link; deterministic assembly membership/order; final Story video identity; execution status checks; RLS policies.
- Cascade risk: deleting Story/Package/Job cascades execution history and outputs (`ON DELETE CASCADE`), which conflicts with preserving immutable provider/accounting history if those rows become canonical.

## Provider Review

| Provider route | Owner | Actual use | Result |
|----------------|-------|------------|--------|
| `json-generation` / OpenAI adapter | AI planning through provider-independent routing | Planning services use LLM helpers/adapters | Within AI Story planning boundary |
| `animation-video-generation` / Seedance | AI Story Scene generation | Production Adapter exists, but complete Story variants call it directly | Provider choice correct; execution boundary incorrect |
| Flux/image generation | Creative Studio only | No active implementation found in AI Story | PASS |
| Provider Outbox/Dispatcher/Worker/Finalizer | Shared production provider infrastructure | Worker loop active; AI Story does not submit to it | BLOCKER |

The registry does not expose Flux for AI Story. `future-providers.ts` explicitly states marketing-image generation is out of scope. Environment examples do not contain a Flux key. Seedance requires `SEEDANCE_API_KEY`; however `.env.example` does not document that key, so deployment readiness cannot be verified from the example configuration.

## Testing Review

### Unit

- Planning schemas and Story/Scene/Shot hierarchy have meaningful unit coverage.
- Sprint 3 execution unit tests intentionally assert PD-055 target-five behavior for AI Story and must not be accepted as architecture evidence.
- Seedance contract tests reject image-generation fields, correctly protecting the no-Flux boundary.

### Integration

- Provider reliability components have extensive isolated integration tests.
- No database-backed integration test was found that carries an AI Story Scene through canonical Outbox, Dispatch, Worker, Finalizer, Scene persistence, review, and assembly.

### Provider contract

- Seedance request/result contract tests exist.
- They validate payload compatibility, not correct per-Scene execution ownership or canonical finalization.

### Browser E2E

- `e2e/ai-story-planning.spec.ts` covers planning more materially.
- `e2e/ai-story-execution.spec.ts` is smoke-only and does not create/execute/review/export a Story.

### Real Seedance validation

- No real provider execution result is asserted. The “live” test only checks that `SEEDANCE_API_KEY` is non-empty.

### Manual Happy Path

- No repository evidence proves a manual complete Story → multi-Scene generation → Scene review → assembly → Story export run.

Missing freeze tests:

1. Arbitrary Scene count independent of PD-055.
2. One provider request/identity per Scene.
3. Retry one failed Scene without regenerating approved Scenes.
4. Partial completion and cancellation.
5. Scene rejection/regeneration and accepted attempt preservation.
6. Final readiness requires all required Scenes approved.
7. Deterministic ordered Story assembly/export.
8. AI Story never imports Marketing Output Strategy, Flux, Creative Studio internals, or Video Studio internals.
9. Cross-workspace Story/asset/package/execution/output access rejection.
10. Canonical usage/cost/finalization for every Scene attempt.

## Security Review

- API entrypoints generally authenticate and require at least `operator` membership for mutations. Example: execution start validates auth and `requireWorkspaceRole` at `execution/route.ts:25-49`.
- Read/status/export routes also scope by Campaign workspace and load the Story through Campaign-aware helpers.
- The single-output regenerate endpoint accepts Campaign/Story path parameters but the underlying query validates only execution job/output workspace, not the supplied Campaign/Story pair (`regenerate/route.ts:32-46`; orchestrator lines 741-756). A workspace operator could address another Story's output inside the same workspace through a misleading URL.
- `loadResolvedCampaignAssets` filters by workspace and deletion status but does not prove each asset is linked to the execution Campaign (`story-execution-orchestrator.ts:96-120`). The planning route validates references earlier, but execution should fail closed on the current Campaign link.
- No checked-in RLS policies cover AI Story tables. This prevents a PASS for tenant/workspace isolation.
- No evidence was found of cross-workspace access through the reviewed API routes, but database-level exposure cannot be declared safe.

## Cost Accounting Review

Current behavior:

```text
Story job
  → N marketing-style variant calls
  → Seedance Adapter returns estimated $0.35 each
  → execution job stores flat provider execution IDs
  → no canonical attempt usage/cost persistence for these calls
```

Required attribution:

```text
Provider execution attempt
  → Scene
  → Story
  → Workspace billing period
```

The canonical provider ledger already supports attempt usage and cost. The defect is not the absence of generic accounting tables; it is AI Story's bypass and lack of Scene correlation. Current cost estimation also assumes a fixed per-call value and multiplies it by five (`execution-compiler.ts:65-70`), which is wrong for scene-derived execution and cannot represent duration, resolution, retry cost, or accepted output.

## Legacy Code Review

| Item | Classification | Freeze action |
|------|----------------|---------------|
| Deprecated `regenerateSingleMarketingOutput` alias | Dead/legacy naming | Defer until model correction/hardening |
| `ai_story_execution_v1.sql` drops obsolete tables then recreates output-index model | Active production risk | Correct before freeze |
| Marketing-output strategy comments saying AI Story consumes it | Active production risk/documentation mismatch | Correct before freeze |
| Test Provider Adapter | Test-only, properly gated | Safe legacy/test support |
| Flux/image-generation references | Documentation/test assertions only | Safe; no active path found |
| Canonical Provider Finalizer not used by Story | Unwired implementation | Wire before freeze |
| Existing Auto Clip pipeline and fixed three-clip runtime | Separate Video Studio/Marketing path | Do not change in this Sprint 3 correction |

## Required Corrections Before Freeze

1. Remove PD-055/Marketing Output Strategy from AI Story runtime contracts, Generate Review estimates, compiler, execution loop, UI, and invalid tests.
2. Define the AI Story execution unit as a Scene derived from the frozen Animation Package; persist Scene identity, stable execution identity, attempts, accepted result, and review state.
3. Submit each Scene through the existing canonical Outbox → Dispatcher → Worker → Finalizer path; eliminate direct Adapter execution from AI Story.
4. Make retries/idempotency Scene-specific and preserve approved Scene results across partial failures and regeneration.
5. Add deterministic final Story assembly/readiness and export exactly the assembled Story video, not a set of Marketing Creatives.
6. Connect canonical usage/cost facts to Scene and Story correlation without provider-specific pricing logic in AI Story.
7. Add RLS/equivalent tenant isolation and ownership-chain validation for all AI Story tables and Campaign Asset references.
8. Replace wrong unit/integration/E2E assertions with production-wired multi-Scene, partial failure, review, assembly, security, and accounting coverage.

## Deferred Corrections

- Remove the deprecated Marketing Output regeneration alias after consumers are verified.
- Clean up generic “output” naming once explicit Scene and Story result contracts exist.
- Synchronize Sprint/README terminology after the corrected runtime is accepted.
- Document Seedance environment variables in deployment examples.
- Consider stronger composite ownership constraints after the minimum fail-closed repository validation is in place.
- Implement an explicit exported Story-video-to-Video-Studio asset handoff only in its approved future scope.

## Final Sprint Engineer Recommendation

Scope:  
FAIL

Architecture:  
FAIL

Database:  
FAIL

Runtime:  
FAIL

Provider:  
FAIL

Testing:  
FAIL

Security:  
FAIL

Risk:  
CRITICAL

Ready To Freeze:  
NO

Sprint 3 should not be frozen. The no-Flux correction is valid, planning boundaries are materially present, and module imports are mostly separated; however, the production execution unit, persistence model, provider lifecycle, export path, accounting path, UI vocabulary, and tests all preserve a Marketing Output abstraction inside AI Story. Corrections should remain narrowly limited to restoring the frozen Scene-based AI Story boundary and reusing the existing canonical provider lifecycle.
