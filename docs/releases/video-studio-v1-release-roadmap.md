# Video Studio V1 Release Roadmap

> This document is the canonical Video Studio V1 release roadmap and status authority. Chat history and ad-hoc review reports are supporting evidence, not the current release-state authority.
>
> Code and Git history remain the implementation authority. If this roadmap conflicts with committed repository evidence, repository evidence wins and this roadmap must be corrected.

Last updated: 2026-08-16

Authority branch: `release/sprint-4-phase-b`

Committed baseline: `b07fbea` (`VS-RC-OBS-01` operational evidence)

Release status: `RELEASE_CANDIDATE_IN_PROGRESS`

`VIDEO_STUDIO_V1_RELEASED = NO`

`VIDEO_STUDIO_V1_RELEASE_DECISION = CONDITIONAL_RELEASE_READY`

`RENDERER_V1 = FROZEN`

`AUTH-01 production cutover = NOT DEPLOYED` (`SEPARATE_COMMERCIAL_ROLLOUT_GATE`)

## 1. Release Objective

Ship a tenant-safe, recoverable, truthful and operationally certifiable Video Studio V1 that turns authorized long-form campaign video into three short-form marketing outputs. Renderer capability expansion is excluded.

## 2. Release Definition

`VIDEO_STUDIO_V1_RELEASED` means repository and production evidence certify this complete loop:

`authorized user → campaign/video entry → frozen source identity → Video Understanding → deterministic source rhythm → AI Editing Director or authorized deterministic fallback → strict EditingPlanV1 validation → three-output composition → deterministic render → tenant-safe preview → bounded partial-failure recovery → applicable review/approval → authorized download/export → terminal task state → operational evidence → production-runtime certification`

Required release properties:

- Tenant, workspace, source, approved-text and artifact authority fail closed.
- Three outputs are persisted and independently renderable; partial failure has bounded recovery.
- AI-directed versus deterministic fallback execution is accurately persisted and presented.
- Preview and export delivery use authorized, renewable credentials without regenerating artifacts.
- Terminal success or failure is observable; no task remains permanently active without a recovery path.
- The deployed worker passes FFmpeg, ffprobe, libass/font, storage/provider and representative real-output certification.

V2 editing sophistication is not part of this definition.

## 3. Authority Baseline

| Authority | Repository evidence | State |
|---|---|---|
| MS-016 | `de7509132b2a3fa442be8a07f94d6a3ef0f0d176` is an ancestor | PASS |
| P1 | `d2c4ba6` | FROZEN |
| P2 | `8442751` | FROZEN |
| P3A | `c479b64` | FROZEN |
| P3B-1 | `728df8674bc32027aae9eb25068e5b73466d9fe5` | FROZEN |
| P3B-2 | `3194d2a749c0d3882cab05f9c95fc38761620041` | FROZEN |
| Release channel | `RELEASE_CHANNEL.md` identifies this worktree/branch and MS-017, with no current repository RC declaration | RC roadmap established here; release channel synchronization is future closeout governance work |
| Current implementation | OBS-01 `b07fbea`; UX-01 `65b5417` + E1 `b291ce4`; AUTH-01 CLOSE-R2 PASS; PROD-CERT close `55613ad`; RELEASE_GATE CONDITIONAL_RELEASE_READY | Release-branch product/security/runtime gates PASS. Current production is bounded slices, not full V1. AUTH-01 remains not deployed |

Material discrepancy: committed governance says `Current RC: none`; this roadmap establishes Video Studio release-candidate work but does not rewrite that committed release-channel declaration. It must be synchronized only through an authorized closeout/governance task.

## 4. Frozen Architecture

| Slice | Status | Responsibility | Frozen boundary | Reopening condition |
|---|---|---|---|---|
| P1 — EditingPlan V1 | FROZEN | Strict plan contract, normalization, authority validation, fingerprint and compiler | No new creative vocabulary or identity changes | A certified defect prevents a V1 release requirement |
| P2 — Editing Director | FROZEN | Existing bounded AI call, one repair attempt, fail-closed authority and deterministic fallback | No additional AI call or unbounded retry | A certified defect breaks authority, repair or fallback |
| P3A — Renderer Variation | FROZEN | Bounded motion, transitions, overlays, audio, branding and deterministic FFmpeg execution | No new renderer primitive/effect family | A production certification proves an existing V1 capability cannot render |
| P3B-1 — Source Rhythm | FROZEN | Deterministic, source-bound rhythm evidence supplied to the Director | Evidence must not become a creative template | Identity, determinism or evidence-authority defect |
| P3B-2 — Phrase Emphasis | FROZEN | Approved HOOK/CTA/LABEL phrase selection and renderer-owned ASS styling | No transcript/VOICEOVER emphasis or kinetic typography | Text-authority, Unicode or ASS execution defect |
| Renderer V1 Feature Freeze | FROZEN | Complete bounded V1 renderer vocabulary | Beat sync, tracking, speed ramps, kinetic typography, advanced grading, added transitions, SFX, B-roll and manual NLE remain excluded | Only an actual renderer defect preventing a release requirement; desirability is insufficient |

## 5. Current Release State

| Area | Evidence | Classification | Status |
|---|---|---|---|
| VS-RC-FIX-01 tenant-safe artifact delivery | Commit `273b33d`; CLOSE-R2 PASS; 20 focused tests and 138 affected regression tests passed; all four typechecks and production web build passed | COMPLETE | CLOSED |
| `FIX01_SIGNED_URL_REFRESH_UNBOUNDED` | Commit `273b33d` bounds all three preview surfaces to one automatic authorized refresh and a terminal preview error | RESOLVED | CLOSED |
| VS-RC-FIX-02 pipeline retry terminal convergence | Commit `9d4c134`; CLOSE-R2 PASS; 18 focused tests and 142 affected regression tests passed; all four typechecks and production web build passed | COMPLETE | CLOSED |
| `FIX02_STALE_FAILURE_CAMPAIGN_REGRESSION` | Commit `9d4c134` couples campaign failure propagation to successful conditional task-failure transition ownership in one transaction | RESOLVED | CLOSED |
| VS-RC-FIX-03 execution-mode truthfulness | Commit `e113aaa`; CLOSE-R1 PASS; 10 focused and 224 affected regression tests passed; all four typechecks and production web build passed | COMPLETE | CLOSED |
| `FIX03_AI_EXECUTION_MODE_TRUTHFULNESS` | Effective eligibility and actual invocation evidence now drive runtime mode; queued generate APIs no longer predict invocation | RESOLVED | CLOSED |
| VS-RC-AUTH-01 entitlement freeze | CLOSE-R2 PASS; 23 focused and 184 affected regression tests passed; all four typechecks, production web build and scoped diff check passed; DB integration was not run because `DATABASE_URL` was unavailable | COMPLETE | CLOSED |
| `AUTH01_INACTIVE_SUBSCRIPTION_CAPABILITY_LEAK` | PLAN capabilities require canonical subscription status `ACTIVE` or `TRIALING`; inactive and unknown states fail closed while explicit non-PLAN grants remain authoritative | RESOLVED | CLOSED |
| `AUTH01_GENERATION_ENTITLEMENT` | Both generation routes enforce `video_generation.execute` after workspace authorization and before execution/enqueue | RESOLVED | CLOSED |
| `AUTH01_EXPORT_AUTHORITY` | Video Studio rendition/export authorization uses effective capabilities rather than `EXPORT_PAYWALL` or raw `organizations.plan` | RESOLVED | CLOSED |
| VS-RC-UX-01 result/recovery UX | CLOSE-R2 PASS; implementation `65b5417` + E1 `b291ce4`; 19 focused and 89 affected VS-RC regression tests passed; web typecheck and production build passed | REQUIRED_V1 | CLOSED / PASS |
| VS-RC-OBS-01 operational evidence | CLOSE-R1 PASS; implementation `b07fbea`; structured ops events with correlation IDs; export_request failure write-back; 12 focused and 119 affected regression tests passed; all four typechecks and production web build passed | REQUIRED_V1 | CLOSED / PASS |
| VS-RC-TEST-01 product-loop gate | CLOSE-R1 PASS; harness `b5c4455` + live E1 `da14dbe`; permanent `pnpm test:video-studio:product-loop`; real DB/Redis/worker/browser loop; private local `campaign-assets`; three persisted/presented outputs; refresh/revisit; same-Creative recovery; Generate Again; preview delivery; export success/failure; inactive historical; isolation; OBS evidence | REQUIRED_V1 | CLOSED / PASS |
| Private artifact bucket | Production `campaign-assets` privatized and verified on VS-RC-PRIVATE-VIDEO-ARTIFACT-BUCKET-02; anonymous direct GET denied; authorized application delivery remains signed-only (`/object/sign/`, TTL 600s); historical public-form identity canonicalizes without DB rewrite; worker private read/write PASS; `business-branding` remains public-read / no-anonymous-write | LAUNCH_BLOCKER (environment) | CLOSED / PASS |
| VS-RC-STORAGE-01 public branding / private campaign-assets split | Implementation `75f2171`; production slice `dbab380` on `main`; `business-branding` created and verified; AUTH-01 not deployed | PREREQUISITE | DEPLOYED / VERIFIED / CLOSED |
| VS-RC-FIX01-PROD-01 production signing | Bounded production slice `c7657a6` on `main` / `emberos-iota`; Railway worker `a32f2efa`; historical public-form identity canonicalizes then signs; worker writes canonical storage identity; AUTH-01 not deployed; successor BUCKET-02 privatized `campaign-assets` | PREREQUISITE | DEPLOYED / VERIFIED / PASS |
| OPS-RAILWAY-ACCESS / OPS-EDIT-V1-PROD-ENV-01 production worker runtime | Live Railway production worker deployment `a32f2efa` at SHA `c7657a61`; FFmpeg/ffprobe 5.1.9; DB/Redis/BullMQ/private `campaign-assets` probe PASS; AUTH-01 not deployed | LAUNCH_BLOCKER (environment) | CLOSED / PASS |
| VS-EDIT-V1-PROD-CERT-R1 real-output certification | Task `f73dc0f1-83d9-457c-91d6-b1073e23e528`; pipeline+3/3 preview+final renders PASS; private canonical storage PASS; signed delivery PASS; review/final render PASS; representative resources PASS (4.1/8 vCPU, 1.57/8 GB); 720p export blocker corrected by E1 `2af30d0` and E1D web slice `ceb9451`; same failed task re-exported PASS; worker unchanged `c7657a61` / `a32f2efa`; AUTH-01 not deployed | LAUNCH_BLOCKER (environment) | CLOSED / PASS |
| VIDEO_STUDIO_V1_RELEASE_GATE | 2026-08-16 review of closed RC-A through RC-D evidence; no product/security/runtime blocker found; current production is not the full V1 revision; full HEAD is unsafe; AUTH-01 cutover is a separate commercial gate | REQUIRED_V1 | CLOSED / CONDITIONAL_RELEASE_READY |

## 6. Phase Roadmap

| Phase | Objective | Entry conditions | Included tasks | Excluded scope | Exit conditions and evidence | Status |
|---|---|---|---|---|---|---|
| RC-A — Security & Lifecycle | Eliminate artifact-authority and non-converging lifecycle blockers | Frozen renderer baseline and task-scoped authority established | FIX-01/E1 closed at `273b33d`; FIX-02/E1 closed at `9d4c134` | Renderer, entitlement, billing, broad storage redesign | Security tests prove tenant-safe delivery; missing artifacts converge; retries reach terminal state; independent closeouts and commits recorded | COMPLETE |
| RC-B — Product Contract | Make execution truth, access policy and recovery understandable and authoritative | RC-A complete | FIX-03 closed at `e113aaa`; AUTH-01 CLOSE-R2 PASS; UX-01 closed at `65b5417` + E1 `b291ce4` | AI Story entitlement, renderer features, commercial redesign | Execution mode/fallback truth is exposed; Video Studio entitlement decision is frozen and tested; three-output/partial-failure UX is operable | COMPLETE |
| RC-C — Release Operations & Regression | Establish minimum evidence and repository release regression | RC-B complete | OBS-01 closed at `b07fbea`; TEST-01 closed; private-bucket deployment gate remaining | Optional admin redesign, full cost platform | Task evidence is reconstructable; product-loop gate passes; private bucket requirement is explicit and verified for release environment | COMPLETE |
| RC-D — Production Certification | Certify the deployed production-equivalent runtime and real outputs | RC-C complete; Railway access and fixtures available | OPS-RAILWAY-ACCESS and OPS-EDIT-V1-PROD-ENV-01 closed; VS-EDIT-V1-PROD-CERT-R1 CLOSED / PASS | Code fixes, renderer expansion, customer data | Worker revision and media stack pass; representative real-output path certified | COMPLETE |
| RC-E — V1 Release Gate | Decide GO/NO-GO against the release definition | RC-A through RC-D complete | VIDEO_STUDIO_V1_RELEASE_GATE CLOSED / CONDITIONAL_RELEASE_READY | New feature development; full HEAD deploy; AUTH-01 cutover | Product/security/runtime gates PASS; no unresolved launch blocker; bounded V1 assembly remains before `VIDEO_STUDIO_V1_RELEASED` | COMPLETE |

## 7. Active Phase

**Post-RC-E bounded release assembly**

RC-E is complete with `CONDITIONAL_RELEASE_READY`. Video Studio V1 is not released. Do not deploy full release HEAD. Do not deploy AUTH-01 cutover. Do not mark `VIDEO_STUDIO_V1_RELEASED`.

## 8. Active Task

**`VIDEO_STUDIO_V1_BOUNDED_RELEASE_ASSEMBLY` — assemble and deploy the Video Studio V1 release slice**

Status: `BUILT / VALIDATED` / `PENDING PRODUCTION DEPLOYMENT`

Assembly-B (2026-08-16): branch `release/video-studio-v1-bounded` built from `ceb9451` by patch extraction. Required identity/hash, FIX-02, UX-01, OBS-01, and FIX-03 web pending projection are assembled and statically/integration validated. AUTH-01/AI Story/Creative Studio/renderer transplant remain excluded. Production deploy is not authorized.

`VIDEO_STUDIO_V1_RELEASE_GATE` is CLOSED / CONDITIONAL_RELEASE_READY. `VIDEO_STUDIO_V1_RELEASED` remains NO.

## 9. Launch Blockers

| Blocker | Owning phase | Closure evidence |
|---|---|---|
| `PRIVATE_VIDEO_ARTIFACT_BUCKET_UNVERIFIED` | RC-C/RC-D | CLOSED / PASS — production `campaign-assets` is private; unsigned direct GET denied; signed-only application delivery verified |
| `RAILWAY_CERTIFICATION_WORKER_ACCESS_UNAVAILABLE` | RC-D | CLOSED / PASS — live Railway production worker access, revision match, media stack, DB/Redis, and private storage probe certified |
| `VIDEO_STUDIO_PRODUCTION_CERTIFICATION_INCOMPLETE` | RC-D | CLOSED / PASS — representative pipeline/3-output/render/private/signed PASS; same-task 720p export re-cert PASS; worker healthy |
| `PROD_CERT_720P_EXPORT_BLOCKED_AFTER_FINAL_RENDER` | RC-D | RESOLVED / CLOSED — same task `f73dc0f1-83d9-457c-91d6-b1073e23e528` with 3× `final_ready` accepted 720p export on web slice `ceb9451`; unchanged worker consumed; canonical private pack; anonymous GET denied; signed delivery PASS |

## 10. Required V1

| Task | Owning phase | Required outcome |
|---|---|---|
| VS-RC-UX-01 | RC-B | CLOSED / PASS — fixed three-output result contract, persisted recovery projection, same-Creative convergence, poll exhaustion cannot create failure, refresh/revisit recovery, Generate Again = new generation |
| VS-RC-OBS-01 | RC-C | CLOSED / PASS — structured ops events with stable correlation IDs; bounded failure classification; durable export_request failure write-back; retry-mode distinction without new schema or observability platform |
| VS-RC-TEST-01 | RC-C | CLOSED / PASS — permanent non-skippable `pnpm test:video-studio:product-loop`; real DB/Redis/worker/browser execution; private local campaign-assets; three persisted/presented outputs; refresh/revisit recovery; same-Creative recovery; Generate Again new task; preview delivery recovery; export success/failure; inactive historical; workspace isolation; OBS evidence |
| OPS-EDIT-V1-PROD-ENV-01 | RC-D | CLOSED / PASS — deployed worker media/runtime probe certified on Railway production `a32f2efa` / `c7657a61` |
| VIDEO_STUDIO_V1_RELEASE_GATE | RC-E | CLOSED / CONDITIONAL_RELEASE_READY — all mandatory product/security/runtime gates PASS; no unresolved launch blocker; current production is not full V1; `VIDEO_STUDIO_V1_RELEASED` remains NO |
| VIDEO_STUDIO_V1_BOUNDED_RELEASE_ASSEMBLY | Post-RC-E | BUILT / VALIDATED / PENDING PRODUCTION DEPLOYMENT — branch `release/video-studio-v1-bounded` from `ceb9451`; patch-extract identity/UX/OBS/FIX-02/FIX-03 web projection; certified production renderer preserved; AUTH-01/AI Story/Creative Studio excluded |

## 11. Product Decisions

### Confirmed product decisions

| Decision | Evidence |
|---|---|
| Video Studio is the campaign execution layer for long-form source to short-form marketing outputs, separate from AI Story, Creative Studio and manual NLE | `docs/VIDEO_STUDIO.md`; production Campaign/Auto Clip routes |
| V1 produces three outputs | `AUTO_CLIP.CLIP_COUNT` in `packages/shared/src/render.ts`; composition/export gates |
| AI Director is feature-flagged, source/rhythm eligible, bounded to two attempts, and may fall back deterministically | P2/P3B production orchestration and tests |
| Renderer V1 is frozen after P3B-2 | Frozen commit lineage and this release boundary |
| Signed delivery credentials are not artifact identity | FIX-01/E1 closeout commit `273b33d` |
| Director execution truth is derived from runtime evidence | FIX-03 commit `e113aaa`: eligibility requires `AI_EDITING_DIRECTOR_ENABLED`, canonical frozen selected-source identity and nonempty SourceRhythm evidence bound to that exact identity; queued APIs return `aiInvoked = null` and `aiExecutionStatus = PENDING_RUNTIME_EVIDENCE`; runtime modes are `AI_DIRECTED`, `AI_DIRECTED_CHECKPOINT_REPLAY`, `DETERMINISTIC_FALLBACK`, and `LEGACY_DETERMINISTIC`; no additional AI call |
| Video Studio entitlement authority | AUTH-01 CLOSE-R2 PASS: workspace authority precedes centralized capability enforcement; only `ACTIVE`/`TRIALING` subscriptions project PLAN capabilities; inactive states fail closed; Super Admin remains a product override without tenant bypass; AI Story policy is unchanged; quota is deferred |
| Video Studio result and recovery UX | UX-01 CLOSE-R2 PASS: fixed three-output presentation; recovery is projected from persisted rendition state; same-Creative retry retains task/identity; poll exhaustion cannot declare terminal failure; refresh/revisit reconstruct recovery; Generate Again is a new generation; FIX-01 delivery authority and AUTH-01 preserved; historical discovery remains an acceptable defer |
| Video Studio operational evidence | OBS-01 CLOSE-R1 PASS: structured ops events with stable correlation IDs; bounded failure classification; durable `tasks.stepProgress.export_request` failure write-back; pipeline/render/export/retry-render evidence; logs supplement persisted task/Creative authority; no new table or observability platform; consolidated support/admin narrative remains V1.1 |

### Open product decisions

| Decision | Current code behavior | Required resolution |
|---|---|---|
| User-visible fallback disclosure | FIX-03 persists truthful runtime mode/reason; UX-01 recovery presentation does not freeze execution-mode copy | Remaining product-copy decision; execution truth is unchanged and is not a recovery-contract blocker |

## 12. Environment Certification

| Requirement | State | Repository evidence / next proof |
|---|---|---|
| Railway access | PASS | Live CLI access to project `comfortable-serenity` production environment; worker service `@ceo-agent/worker`; deployment `a32f2efa` |
| Production worker model | CERTIFIED | Railway Docker worker; `infra/docker/Dockerfile.worker`, `railway.toml`; start `pnpm --filter @ceo-agent/worker exec tsx src/index.ts`; Node v20.20.2 |
| FFmpeg | CERTIFIED | Debian Bookworm `ffmpeg version 5.1.9-0+deb12u1`; `FFMPEG_PATH=/usr/bin/ffmpeg`; libass/libx264 enabled |
| ffprobe | CERTIFIED | `ffprobe version 5.1.9-0+deb12u1` at `/usr/bin/ffprobe` |
| libass/fonts | CERTIFIED | ffmpeg `--enable-libass`; bundled `NotoSansCJKsc-Regular.otf`; system `fonts-noto-cjk` present |
| Private Supabase bucket | CERTIFIED | `campaign-assets.public=false`; worker service-role read of existing export pack PASS; anonymous public GET denied |
| Provider/storage credentials | PRESENT | Production worker has `DATABASE_URL`, `REDIS_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `SUPABASE_STORAGE_BUCKET=campaign-assets`; `BULLMQ_PREFIX` intentionally absent (shared production namespace) |
| Production fixtures | DEFERRED / NOT REQUIRED FOR V1 REPRESENTATIVE CERT | Six-source and 10/30/60-minute fixtures were not required to close representative `VS-EDIT-V1-PROD-CERT-R1` |
| PROD-CERT | CLOSED / PASS | Representative production run completed through signed delivery and same-task 720p export; `PROD_CERT_720P_EXPORT_BLOCKED_AFTER_FINAL_RENDER` resolved |
| Video Studio identity schema | PENDING PRODUCTION APPLY | Production `tasks` lacks `generation_input_capsule` / `generation_input_fingerprint`; production `assets` lacks `content_hash`. Required SQL: `campaign-video-generation-identity-v1.sql`, `source-asset-content-hash-v1.sql`. Do not apply AI Story/Creative Studio migrations as part of Video Studio V1 |
| Current production vs intended V1 | BOUNDED SLICES ONLY | Web `ceb9451` = production `c7657a61` + export-readiness helper; worker `c7657a61` / `a32f2efa`. Release HEAD `55613ad` is not deployed. OBS-01, UX-01, FIX-02, FIX-03, AUTH-01, and generation identity are absent from the live slice |

Environment blockers are not renderer defects.

## 13. Accepted Debt / V1.1 / V2

### ACCEPTED_DEBT — POST_LAUNCH (9)

| Debt | Why it does not block V1 | Reopening trigger |
|---|---|---|
| `TOOLING-DEBT-LINT-01` | Known tooling debt; release behavior is covered through scoped verification | It prevents reliable release validation |
| Provider-adapter collection failure | Pre-existing unrelated collection issue outside Video Studio runtime | It affects the Video Studio gate or production path |
| ffprobe discovery unification | PATH is operationally acceptable when certified | Production probe cannot resolve ffprobe consistently |
| Bundled BGM runtime-path cleanup | Authorized remote resolution can satisfy V1 if production-certified | Neither bundled nor authorized remote BGM works |
| Railway worker health endpoint | Operational convenience; runtime can be certified directly | Lack of health evidence prevents safe operation |
| Emoji font coverage | Best-effort typography; required Chinese/Latin/Malay coverage is the V1 gate | Required V1 language glyphs fail |
| `TEST01_RENDER_CALLBACK_WITHOUT_ATTEMPT` | Fail-closed `RenderPersistenceConflictError` rejected a post-approval final-rendition progress callback before the attempt record was visible; BullMQ retry recovered the same Creative/job; preview, 720p export, and TEST-01 MUST assertions remained intact | A Creative remains stuck after retries exhaust on this error, or a rejected callback overwrites a valid artifact |
| Production vision templated fallback | PROD-CERT representative testsrc source triggered vision fallback; not a security, persistence, or three-output defect | Customer-source understanding fails as a release requirement |
| Production marketing content fallback | PROD-CERT representative run used marketing-content fallback; execution remained recoverable and truthful under FIX-03 | Fallback becomes silent or blocks the representative product loop |

### V1.1 (6)

| Item | Why deferred | Reopening trigger |
|---|---|---|
| Dedicated top-level Video Studio navigation | Campaign entry already provides the product path | Discoverability materially prevents use |
| User-selectable output count | V1 contract is a fixed three-output package | Product/commercial decision changes |
| Per-output shared Director cost allocation | Task-level cost can support release evidence | Output-level pricing/accounting becomes authoritative |
| Render/storage/network cost attribution | Can be measured externally for certification | Required for billing or safe cost controls |
| Consolidated support/admin task narrative | Minimum release evidence can use existing task/checkpoint/log records | Support cannot reconstruct failures safely |
| Diagnosis-specific failure copy | Generic bounded recovery is sufficient if actionable | Generic copy prevents recovery for a common failure |

### V2 (9)

Beat/downbeat synchronization; temporal tracking; speed ramps; kinetic typography; advanced grading; additional transitions; SFX/audio accents; generative/autonomous B-roll; manual NLE behavior. Each requires an analysis, plan, renderer or architectural extension and cannot interrupt V1.

## 14. Completed Work

| Work | Commit | State |
|---|---|---|
| Frozen source/task identity prerequisites | `84280c6`, `8e2613d` | COMPLETE |
| P1 EditingPlan V1 | `d2c4ba6` | COMPLETE/FROZEN |
| P2 AI Editing Director | `8442751` | COMPLETE/FROZEN |
| P3A Renderer Variation | `c479b64` | COMPLETE/FROZEN |
| P3B-1 Source Rhythm | `728df8674bc32027aae9eb25068e5b73466d9fe5` | COMPLETE/FROZEN |
| P3B-2 Phrase Emphasis | `3194d2a749c0d3882cab05f9c95fc38761620041` | COMPLETE/FROZEN |
| VS-RC-FIX-01 Tenant-Safe Artifact Delivery | `273b33d` | CLOSED; CLOSE-R2 PASS; 20 focused and 138 affected regression tests passed; typechecks/build PASS |
| VS-RC-FIX-01E1 Bounded Signed-URL Refresh | `273b33d` | CLOSED; one automatic refresh per canonical artifact identity; terminal convergence PASS |
| VS-RC-FIX-02 Pipeline Retry Terminal Convergence | `9d4c134` | CLOSED; CLOSE-R2 PASS; 18 focused and 142 affected regression tests passed; typechecks/build PASS |
| VS-RC-FIX-02E1 Stale Failure Campaign Regression | `9d4c134` | CLOSED; campaign failure requires acquired conditional task-failure transition; transactional race protection PASS |
| VS-RC-FIX-03 AI Execution-Mode Truthfulness | `e113aaa` | CLOSED; CLOSE-R1 PASS; 10 focused and 224 affected regression tests passed; typechecks/build PASS; additional AI calls 0 |
| VS-RC-AUTH-01 Video Studio Entitlement Authority | Current closeout commit | CLOSED; CLOSE-R2 PASS; inactive subscription leak, generation entitlement and export authority resolved; 23 focused and 184 affected tests passed; typechecks/build/diff PASS; DB integration `ENVIRONMENT_NOT_RUN` because `DATABASE_URL` was unavailable; quota DEFERRED; AI Story unchanged |
| VS-RC-UX-01 Video Studio Result and Recovery UX | `65b5417`, E1 `b291ce4` | CLOSED / PASS; CLOSE-R2 PASS; fixed three-output result contract; persisted recovery projection; same-Creative convergence; poll exhaustion cannot create failure; refresh/revisit recovery; Generate Again = new generation; task/campaign binding; FIX-01 delivery authority preserved; AUTH-01 preserved; Renderer V1 frozen; historical discovery acceptable defer; 19 focused and 89 affected VS-RC regression tests passed; web typecheck/build PASS; DB integration `ENVIRONMENT_NOT_RUN`; Browser/E2E `ENVIRONMENT_NOT_RUN` |
| VS-RC-OBS-01 Video Studio Operational Evidence | `b07fbea` | CLOSED / PASS; CLOSE-R1 PASS; structured ops events with correlation IDs; bounded redaction; export_request failure write-back; retry-mode distinction; no new schema/platform; 12 focused and 119 affected tests passed; typechecks/build PASS; DB integration `ENVIRONMENT_NOT_RUN` |
| VS-RC-TEST-01 Video Studio Product-Loop Gate | harness `b5c4455`, live E1 `da14dbe` | CLOSED / PASS; CLOSE-R1 PASS; permanent non-skippable `pnpm test:video-studio:product-loop`; real DB/Redis/worker/browser execution; private local `campaign-assets`; three persisted/presented outputs; refresh/revisit; same-Creative recovery; Generate Again; preview delivery; export success/failure; inactive historical; isolation; OBS evidence; observed render-callback conflict classified as non-blocking accepted debt |
| VS-RC-STORAGE-01 Public Branding Bucket Split | implementation `75f2171`; production `dbab380` | DEPLOYED / VERIFIED / CLOSED; dedicated `business-branding` public-read / no-anonymous-write; Business Profile logos no longer write `campaign-assets`; `campaign-assets` remains public; AUTH-01 not deployed; `PRIVATE_VIDEO_ARTIFACT_BUCKET_UNVERIFIED` remains open |
| VS-RC-FIX01-PROD-01 Production Artifact Signing | production `c7657a6`; worker `a32f2efa` | DEPLOYED / VERIFIED / PASS; application delivery is signed (`/object/sign/`, TTL 600s); historical public URLs canonicalize without DB rewrite; worker persists canonical storage identity; AUTH-01 not deployed |
| VS-RC-PRIVATE-VIDEO-ARTIFACT-BUCKET-02 Production Privacy Cutover | production `c7657a6`; worker `a32f2efa` | CLOSED / PASS; `campaign-assets` private; anonymous direct GET denied for source/library/preview/export/cover/export-pack; authorized signed delivery PASS; worker private read/write PASS; `business-branding` remains public-read / no-anonymous-write; no DB rewrite; AUTH-01 not deployed |
| OPS-RAILWAY-ACCESS / OPS-EDIT-V1-PROD-ENV-01 Production Worker Runtime | production web/worker `c7657a61`; Railway worker `a32f2efa` | CLOSED / PASS; live Railway production access; FFmpeg/ffprobe 5.1.9; queue consumers registered; production DB/Redis; private `campaign-assets` read; canonical storage identity; AUTH-01 not deployed; Renderer V1 frozen |
| VS-EDIT-V1-PROD-CERT-R1 Production Real-Output Certification | task `f73dc0f1-83d9-457c-91d6-b1073e23e528`; E1 `2af30d0`; E1D web `ceb9451`; worker `c7657a61` / `a32f2efa` | CLOSED / PASS; production pipeline completed; 3/3 output renders completed; private storage confirmed; signed delivery confirmed; review/final render completed; final_ready export blocker corrected; same failed task successfully re-exported; 720p export persisted and delivered; representative runtime resources passed; worker remained healthy; AUTH-01 not deployed; Renderer V1 frozen |
| VIDEO_STUDIO_V1_RELEASE_GATE Final Release Readiness Review | review of closed RC-A through RC-D plus live production schema probe | CLOSED / CONDITIONAL_RELEASE_READY; no unresolved launch blocker; full HEAD deploy unsafe; AUTH-01 cutover not required before V1 product launch; bounded assembly remains; `VIDEO_STUDIO_V1_RELEASED` remains NO |

Production `campaign-assets` is private and signed-only. Renderer V1 remains frozen.

## 15. Release Gates

| Gate | Required result | Current state |
|---|---|---|
| RC-A Security & Lifecycle | No artifact-authority or terminal-convergence blocker | PASS |
| RC-B Product Contract | Truthful mode, frozen entitlement, operable recovery | PASS |
| RC-C Repository Regression | Release evidence and product-loop/security gate pass | PASS |
| RC-D Production Certification | Environment probe pass and real-output certification pass | PASS |
| RC-E Final Release | All blockers closed and REQUIRED_V1 dispositioned | PASS / CONDITIONAL_RELEASE_READY |

## 16. Change-Control Rules

1. A newly discovered issue does not automatically become a V1 task or blocker.
2. It must first be evidenced, classified, assigned exactly one release category, and assessed against the current phase exit gate.
3. Only a confirmed `LAUNCH_BLOCKER` may interrupt the active task or phase.
4. `REQUIRED_V1` work is scheduled into its owning phase.
5. `ACCEPTED_DEBT`, `V1.1` and `V2` findings do not interrupt the current release sequence.
6. Remaining task lifecycle is: `IMPLEMENT → INDEPENDENT REVIEW → bounded correction if blocker exists → CLOSEOUT → COMMIT → ROADMAP UPDATE → NEXT TASK`.
7. After closeout, update task status, result, commit, resolved blockers, accepted debt, active phase and the single next action. A task is not administratively complete until this roadmap records its closeout.
8. Production fixes require separate authorization. Documentation status never substitutes for committed behavior or runtime evidence.

## 17. Decision Log

| Date | Decision | Evidence/status |
|---|---|---|
| 2026-08-15 | Establish this file as the single Video Studio V1 release roadmap | Documentation-only task; uncommitted |
| 2026-08-15 | Keep Renderer V1 frozen | P1–P3B-2 commit lineage; reopen only for a certified release-blocking renderer defect |
| 2026-08-15 | Set RC-A as the sole active phase | FIX-01 and FIX-02 evidence |
| 2026-08-15 | Set FIX-01E1 as the sole active task | Confirmed unbounded media-error refresh behavior |
| 2026-08-15 | Close FIX-01 and FIX-01E1; advance RC-A to FIX-02 | CLOSE-R2 PASS; commit `273b33d`; signed refresh blocker resolved; private bucket verification remains environment-gated |
| 2026-08-15 | Close FIX-02 and FIX-02E1; complete RC-A and advance to RC-B/FIX-03 | CLOSE-R2 PASS; commit `9d4c134`; retry terminal-convergence and stale campaign-regression blockers resolved |
| 2026-08-16 | Close FIX-03 and advance RC-B to AUTH-01 | CLOSE-R1 PASS; commit `e113aaa`; execution-mode truthfulness resolved with no additional AI calls; Renderer V1 remains frozen |
| 2026-08-16 | Close AUTH-01 and advance RC-B to UX-01 | CLOSE-R2 PASS; centralized Video Studio generation/rendition capability authority; PLAN projection restricted to `ACTIVE`/`TRIALING`; DB integration not run because `DATABASE_URL` was unavailable; quota deferred; AI Story unchanged; Renderer V1 frozen |
| 2026-08-16 | Close UX-01 and complete RC-B; advance to RC-C/OBS-01 | CLOSE-R2 PASS; implementation `65b5417` + E1 `b291ce4`; persisted recovery projection; same-Creative convergence; poll exhaustion cannot create failure; refresh/revisit recovery; Generate Again = new generation; FIX-01/AUTH-01 preserved; Renderer V1 frozen; historical discovery acceptable defer; DB integration `ENVIRONMENT_NOT_RUN`; Browser/E2E `ENVIRONMENT_NOT_RUN` |
| 2026-08-16 | Complete OBS-01B operational evidence implementation; pending OBS-01C close review | Structured Video Studio ops events with correlation IDs; export_request failure write-back; no new table/platform; Renderer V1 frozen |
| 2026-08-16 | Close OBS-01 and advance RC-C to TEST-01 | CLOSE-R1 PASS; implementation `b07fbea`; structured ops events; durable export failure write-back; AUTH-01/UX-01/Renderer V1 preserved; quota deferred; AI Story unchanged; DB integration `ENVIRONMENT_NOT_RUN` |
| 2026-08-16 | Implement TEST-01B product-loop harness; do not close TEST-01 | Permanent `pnpm test:video-studio:product-loop` fail-closed gate; live MUST execution remains environment-blocked; pending TEST-01C close review after unblocked execution |
| 2026-08-16 | Execute TEST-01B-E1 live environment unblock; do not close TEST-01 | Live `pnpm test:video-studio:product-loop` PASS; local `campaign-assets` private; isolated `BULLMQ_PREFIX`; entitled TEST-01 persona; pending VS-RC-TEST-01C close review |
| 2026-08-16 | Close TEST-01; keep RC-C active for deployed private-bucket verification | CLOSE-R1 PASS; permanent product-loop gate executed; observed `RenderPersistenceConflictError` classified as non-blocking accepted debt `TEST01_RENDER_CALLBACK_WITHOUT_ATTEMPT`; Renderer V1 frozen; quota deferred; AI Story unchanged |
| 2026-08-16 | VS-RC-STORAGE-01 implementation complete; pending deployment/verification | Dedicated `business-branding` public bucket authority; Business Profile logo upload no longer writes `campaign-assets`; existing `brandProfile.logoUrl` storage paths remain campaign-assets watermarks; production `campaign-assets` not privatized; `PRIVATE_VIDEO_ARTIFACT_BUCKET_UNVERIFIED` remains open |
| 2026-08-16 | Close VS-RC-STORAGE-01 implementation readiness (STORAGE-01C) | CLOSE-R1 PASS; commit `75f2171` reviewed; branding/video bucket split sound; bounded slice deployable without full HEAD; production not changed; next is STORAGE-01D; `PRIVATE_VIDEO_ARTIFACT_BUCKET_UNVERIFIED` remains open |
| 2026-08-16 | Deploy and verify VS-RC-STORAGE-01D public branding bucket | Production `business-branding` created public-read / no-anonymous-write; bounded web/worker slice `dbab380` on `main`/`emberos-iota`; logo upload uses `business-branding`; `campaign-assets` unchanged/public; AUTH-01/FIX-01 not deployed; next is VS-RC-FIX01-PROD-01; `PRIVATE_VIDEO_ARTIFACT_BUCKET_UNVERIFIED` remains open |
| 2026-08-16 | Deploy and verify VS-RC-FIX01-PROD-01 production signing | Bounded FIX-01 web/worker slice `c7657a6` on `main`/`emberos-iota`; Railway worker `a32f2efa`; authorized historical/preview/cover/export-pack delivery signs; unauthenticated and cross-workspace signing denied; new worker persistence is canonical storage identity; `campaign-assets` remains public; AUTH-01 not deployed; next is VS-RC-PRIVATE-VIDEO-ARTIFACT-BUCKET-02; `PRIVATE_VIDEO_ARTIFACT_BUCKET_UNVERIFIED` remains open |
| 2026-08-16 | Close VS-RC-PRIVATE-VIDEO-ARTIFACT-BUCKET-02 production privacy cutover | Production `campaign-assets.public` true→false; anonymous direct GET denied; authorized signed-only delivery PASS including historical public-form identity; worker private read/write PASS; `business-branding` remains public; no DB rewrite; AUTH-01 not deployed; `PRIVATE_VIDEO_ARTIFACT_BUCKET_UNVERIFIED` CLOSED / PASS; next is OPS-RAILWAY-ACCESS / OPS-EDIT-V1-PROD-ENV-01 |
| 2026-08-16 | Close OPS-RAILWAY-ACCESS / OPS-EDIT-V1-PROD-ENV-01 production worker runtime | Live Railway production worker `a32f2efa` matches `c7657a61`; FFmpeg/ffprobe 5.1.9 with libass; DB/Redis/BullMQ consumers PASS; private `campaign-assets` service-role read PASS; worker persists canonical storage identity; AUTH-01 not deployed; Renderer V1 frozen; quota deferred; AI Story unchanged; next is VS-EDIT-V1-PROD-CERT-R1 |
| 2026-08-16 | Execute VS-EDIT-V1-PROD-CERT-R1; do not close | Production web/worker `c7657a61`; ops E2E workspace; task `f73dc0f1-83d9-457c-91d6-b1073e23e528`; 45s H.264/AAC source; pipeline+3 preview+3 final renders PASS; private canonical persistence PASS; anonymous GET denied; signed delivery PASS; review/approval PASS; 720p export 409 after `final_ready`; new blocker `PROD_CERT_720P_EXPORT_BLOCKED_AFTER_FINAL_RENDER`; AUTH-01 not deployed; Renderer V1 frozen |
| 2026-08-16 | Implement VS-EDIT-V1-PROD-CERT-E1 export readiness; do not close PROD-CERT | `PROD_CERT_720P_EXPORT_BLOCKED_AFTER_FINAL_RENDER` → implementation fixed → pending bounded production deployment and re-certification; VS-EDIT-V1-PROD-CERT-R1 remains BLOCKED; AUTH-01 not deployed; Renderer V1 frozen |
| 2026-08-16 | Deploy VS-EDIT-V1-PROD-CERT-E1D bounded export-readiness web slice; do not close PROD-CERT | Web slice `ceb9451` on `emberos-iota`; worker unchanged `c7657a61` / `a32f2efa`; same task `f73dc0f1-83d9-457c-91d6-b1073e23e528` 3× `final_ready` 720p export 202→enqueue→consume→success; canonical private pack; anonymous GET denied; signed delivery PASS; AUTH-01 not deployed; `PROD_CERT_720P_EXPORT_BLOCKED_AFTER_FINAL_RENDER` RESOLVED; pending VS-EDIT-V1-PROD-CERT-R2 |
| 2026-08-16 | Close VS-EDIT-V1-PROD-CERT-R1 after R2 final close review | CLOSED / PASS; combined R1+E1+E1D evidence certifies representative production real-output path; AUTH-01 not deployed; Renderer V1 frozen; quota deferred; AI Story unchanged; next is VIDEO_STUDIO_V1_RELEASE_GATE |
| 2026-08-16 | Close VIDEO_STUDIO_V1_RELEASE_GATE as CONDITIONAL_RELEASE_READY | Product/security/runtime gates PASS; production real-output PASS; no unresolved launch blocker; current production is bounded slices (`ceb9451` web / `c7657a61` worker), not full V1; full HEAD deploy is unsafe; AUTH-01 remains a separate commercial rollout; required identity migrations are unapplied; `VIDEO_STUDIO_V1_RELEASED` remains NO; next is VIDEO_STUDIO_V1_BOUNDED_RELEASE_ASSEMBLY |
| 2026-08-16 | Complete VIDEO_STUDIO_V1_BOUNDED_RELEASE_ASSEMBLY-A scope review | SCOPE_REVIEW_PASS; base `ceb9451`; patch-extract mixed commits; do not cherry-pick HEAD; keep certified production auto-clip; AUTH-01/AI Story/Creative Studio excluded; next is ASSEMBLY-B implementation |
| 2026-08-16 | Complete VIDEO_STUDIO_V1_BOUNDED_RELEASE_ASSEMBLY-B implementation | BUILT / VALIDATED / PENDING PRODUCTION DEPLOYMENT; branch `release/video-studio-v1-bounded` from `ceb9451`; AUTH-01/AI Story/Creative Studio excluded; product-loop `BLOCKED_ENVIRONMENT`; next is ASSEMBLY-C production preflight/deploy |

## 18. Release Gate Review (2026-08-16)

Decision: `CONDITIONAL_RELEASE_READY`. This is not `VIDEO_STUDIO_V1_RELEASED`.

| Gate | Classification |
|---|---|
| Durable generation identity | CLOSED_PASS on full release branch (`8e2613d`); absent from current production slice and production schema |
| Fixed three-output contract | CLOSED_PASS — `AUTO_CLIP.CLIP_COUNT = 3`; PROD-CERT persisted/presented 3 |
| FIX-01 artifact delivery | CLOSED_PASS |
| FIX-02 retry/render terminality | CLOSED_PASS on release branch; not in current production SHA |
| FIX-03 Director/render truth | CLOSED_PASS on release branch; not in current production SHA |
| AUTH-01 entitlement authority | CLOSED_PASS on release branch; `AUTH01_PRODUCTION_CUTOVER = NO`; `SEPARATE_COMMERCIAL_ROLLOUT_GATE` |
| UX-01 result/recovery | CLOSED_PASS on release branch; not in current production SHA |
| OBS-01 operational evidence | CLOSED_PASS on release branch; `OBS01_PRODUCTION_RUNTIME_PRESENT = NO` |
| TEST-01 product-loop | CLOSED_PASS — permanent `pnpm test:video-studio:product-loop` |
| STORAGE-01 branding separation | CLOSED_PASS / DEPLOYED |
| Private campaign-assets | CLOSED_PASS / DEPLOYED |
| Production worker runtime | CLOSED_PASS |
| Production real-output | CLOSED_PASS |
| Quota | DEFERRED |
| AI Story | NOT_APPLICABLE / OUT OF VIDEO_STUDIO_V1_RELEASE_SCOPE |
| Renderer expansion | DEFERRED / FROZEN |

Current production is not the intended V1 revision. `c7657a61` does not contain FIX-02, FIX-03, AUTH-01, UX-01, OBS-01, TEST-01, or generation identity. Web `ceb9451` adds only the export-readiness helper. Full release HEAD (`55613ad`, 797 files vs `c7657a61`) includes AUTH-01, AI Story, Creative Studio, and commercial code and is not a safe production deploy.

Required Video Studio DB migrations pending on production: `campaign-video-generation-identity-v1.sql`, `source-asset-content-hash-v1.sql`. Production already contains unrelated AI Story / commercial tables; those are not Video Studio V1 release requirements and must not be treated as a reason to deploy full HEAD.

Release-channel file still declares `Current RC: none`. Synchronization remains a closeout governance step, not a product blocker.

## 19. Next Action

**NEXT ACTION: VIDEO_STUDIO_V1_BOUNDED_RELEASE_ASSEMBLY-C — production migration/deployment preflight and deploy. Do not mark V1 released. Do not deploy AUTH-01. Do not deploy AI Story or Creative Studio.**
