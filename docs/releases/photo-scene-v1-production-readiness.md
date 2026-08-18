# Photo Scene V1 Production Release Readiness

Ticket: `EMBEROS-PHOTO-SCENE-V1-PROD-01`  
Date: 2026-08-18  
Authority: `docs/IMPLEMENTATION-ROADMAP.md`  
Architecture: `docs/architecture/photo-scene-v1.md`

This file is a deployment-scope review from PROD-01. PROD-02 built the bounded assembly and operator tools; it did not deploy.

## Decision

`PHOTO_SCENE_V1` remains **IMPLEMENTATION_COMPLETE / RELEASE_PENDING**.

`PHOTO_SCENE_RELEASE_STRATEGY` = **BOUNDED_RELEASE_ASSEMBLY_REQUIRED**

`ASSEMBLY_BASE_REVISION` = `eea988d5addd268d4d3356d336d7d076109b26ea`

`CURRENT_HEAD_DEPLOY_SAFE` = **NO**

`Result` = **CONDITIONAL PASS**

Next ticket: **EMBEROS-PHOTO-SCENE-V1-PROD-02 — Build bounded production release assembly**

Do not mark Photo Scene RELEASED / FROZEN. Do not deploy AUTH-01, Publishing, AI Story, Flux, quota/billing, or full HEAD.

## 1. Source authority

Working authority at review:

- Worktree: `worktrees/video-studio-v1-bounded`
- Branch: `release/video-studio-v1-bounded`
- HEAD: `bb33be458730347706d9191adff0a805c2f5af43`

All Photo Scene implementation commits are ancestors of HEAD:

| Ticket | SHA | Reachable |
|---|---|---|
| 10A | `e32256f1caa2c5eb5a94ade69b06aaf42e8168b1` | YES |
| 10B implementation | `717c37cc34b0f548d8c3e8bdb5f8c1c1f185ffc7` | YES |
| 10B provider evidence | `c72c343fe7222e42232e96eed70c961f85d275ce` | YES |
| 10B runtime close | `98f6ee417fadbb5acac1cd6031bab139cc54d9e8` | YES |
| 10C | `bf4fcb4e5085828e96b67ea5ecc4ab06eaac144c` | YES |
| 10D | `bb33be458730347706d9191adff0a805c2f5af43` | YES |
| Video Studio production pin | `eea988d5addd268d4d3356d336d7d076109b26ea` | YES |

`PHOTO_SCENE_V1_SOURCE_AUTHORITY` = **PASS**

## 2. Production baseline

Last certified production authority (`RELEASE_CHANNEL.md`, Video Studio bounded close):

| Surface | Last certified identity |
|---|---|
| Production web | `emberos-iota.vercel.app` @ `eea988d5addd268d4d3356d336d7d076109b26ea` |
| Production worker | Railway `@ceo-agent/worker` @ `eea988d5addd268d4d3356d336d7d076109b26ea` |
| Production DB | Supabase project `egkgybrjmzukzmkcrpag` (named as production / forbidden in Photo Scene apply/seed scripts) |
| Production storage | Private `campaign-assets`; public `business-branding` (VS STORAGE / FIX-01 / Assembly-C) |

This ticket did **not** independently re-read live Vercel or Railway deployment SHAs. Treat `eea988d` as last certified production revision, not as a live CLI confirmation.

`PRODUCTION_DB_IDENTIFIED` = **YES** (project ref known; live schema not dumped this ticket)  
`PRODUCTION_STORAGE_IDENTIFIED` = **YES** (VS buckets known; `photo-scene-official` not on that certified state)

## 3. Semantic delta (`eea988d` → `bb33be4`)

`eea988d..HEAD` is twelve commits: four Video Studio/roadmap docs after freeze, then Photo Scene 10A–10D. No `apps/worker/src/ffmpeg`, orchestrator, or `/api/campaigns/[id]/run` diffs.

Classification of relevant change:

- **PHOTO_SCENE_REQUIRED** — campaign Photo Scene UI/routes, extract/compose workers, Photoroom adapter, PNG compositor, shared contracts, three SQL files, official-scene seed, queue `PHOTO_SCENE`, additive Drizzle tables, `STORAGE_PATHS.library`, `hashSourceAssetBytes`.
- **ALREADY_PRODUCTION** — Video Studio generation/render/export/private signing path. Photo Scene uses a new library-prefix signer (`apps/web/src/lib/asset-signed-delivery.ts`), not a Renderer change.
- **AUTH01_EXCLUDED / AI_STORY_EXCLUDED / PUBLISHING_EXCLUDED / VIDEO_STUDIO_UNRELATED / DEFERRED** — none of those products appear in this delta. Flux / OpenAI image / quota / `creative_studio_jobs` are absent.

Do **not** apply whole `packages/db/sql/rls.sql` on production. Photo Scene RLS is already inside the three feature SQL files. Wholesale `rls.sql` would DROP/recreate unrelated policies.

`FORBIDDEN_PRODUCTION_SCOPE_COUNT` in a bounded assembly from `eea988d` + Photo Scene = **0**.

## 4–5. Required migrations (do not execute)

Ordered production list:

1. `packages/db/sql/photo-scene-campaign-asset-refs-v1.sql`
2. `packages/db/sql/photo-scene-generations-v1.sql`
3. `packages/db/sql/photo-scene-official-scenes-v1.sql`

Not a migration: `packages/db/sql/photo-scene-marketing-generations-v1.sql` (comment-only; `operation` is already `text`).  
Not a migration: `packages/db/sql/rls.sql` as a whole.

Existing apply scripts refuse any database except preview `voofxbuzpocyjzoxrpfi` and refuse production `egkgybrjmzukzmkcrpag`. They cannot be used as-is on production.

| Migration | Purpose | Additive | Backward compatible | Data backfill | Locking | Web needs | Worker needs |
|---|---|---|---|---|---|---|---|
| `photo-scene-campaign-asset-refs-v1.sql` | New `campaign_asset_refs` + RLS; backfill from `assets.campaign_id` | YES | YES | YES | MEDIUM on large `assets` | YES (Photo Scene) | YES (Photo Scene) |
| `photo-scene-generations-v1.sql` | New `photo_scene_generations` (includes `marketing_image` operation) + RLS + inflight unique index | YES | YES | NO | LOW | YES | YES |
| `photo-scene-official-scenes-v1.sql` | Official catalog + versions + tenant selections + RLS | YES | YES | NO | LOW | YES | YES (compose reads catalog/storage) |

Video Studio does not require these tables. Additive schema can remain if web/worker roll back.

## 6. Production schema compatibility

`PRODUCTION_SCHEMA_COMPATIBLE` = **UNKNOWN** until deploy preflight.

Expected from Video Studio Assembly-C (not re-queried live):

- Base tables: `organizations`, `workspaces`, `campaigns`, `assets`
- Asset hash / generation identity columns from `source-asset-content-hash-v1.sql` and `campaign-video-generation-identity-v1.sql`
- Photo Scene tables **absent**

Required preflight queries (run during deploy ticket, not this ticket):

```sql
SELECT current_database();

SELECT to_regclass('public.organizations') AS organizations,
       to_regclass('public.workspaces') AS workspaces,
       to_regclass('public.campaigns') AS campaigns,
       to_regclass('public.assets') AS assets;

SELECT to_regclass('public.campaign_asset_refs') AS campaign_asset_refs,
       to_regclass('public.photo_scene_generations') AS photo_scene_generations,
       to_regclass('public.photo_scene_official_scenes') AS photo_scene_official_scenes,
       to_regclass('public.photo_scene_official_scene_versions') AS photo_scene_official_scene_versions,
       to_regclass('public.photo_scene_scene_selections') AS photo_scene_scene_selections;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assets'
  AND column_name IN ('content_hash', 'storage_path', 'workspace_id', 'org_id', 'campaign_id');

SELECT relrowsecurity
FROM pg_class
WHERE relname = 'assets';
```

Refuse if `DATABASE_URL` is preview `voofxbuzpocyjzoxrpfi`. Confirm production ref `egkgybrjmzukzmkcrpag` before applying.

Storage preflight: list buckets `campaign-assets`, `business-branding`, `photo-scene-official`. Confirm `campaign-assets` remains private.

## 7. Storage

| Bucket | Intended use | Visibility |
|---|---|---|
| `campaign-assets` | Tenant sources / extracted products / marketing images under `{workspaceId}/library/{assetId}.ext` | PRIVATE / signed |
| `business-branding` | Brand logos only | PUBLIC_READ (already production) |
| `photo-scene-official` | Global official scene background + preview objects | PUBLIC_READ picker URLs |

`OFFICIAL_SCENE_BUCKET_REQUIRED` = **YES**  
`OFFICIAL_SCENE_BUCKET` = `photo-scene-official` (`DEFAULT_OFFICIAL_SCENE_BUCKET` / `PHOTO_SCENE_OFFICIAL_BUCKET`)  
`INTENDED_VISIBILITY` = **PUBLIC_READ**  
`ANONYMOUS_WRITE` = **DENIED**  
`SERVICE_ROLE_WRITE` = **ALLOWED**

Do not create the bucket in this ticket.

## 8. Official scene seed

`PRODUCTION_SCENE_SEED_REQUIRED` = **YES**  
`SCENE_SEED_SOURCE` = `scripts/seed-photo-scene-official-scenes.ts`  
`SEED_IDEMPOTENT` = **YES** for DB identities (`ON CONFLICT` on scene id / scene+version)  
`SEED_PAID_API_CALLS` = **0** (deterministic local PNGs)

Current seed **refuses production DB** and **inserts identities only** (no object upload). Composition/preview will fail without uploaded background/preview PNGs. Production assembly must add a production-authorized seed that uploads those objects.

## 9. Photoroom production configuration

Required worker env (do not print values):

- `PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER=photoroom`
- `PHOTOROOM_API_KEY`
- `PHOTO_SCENE_PHOTOROOM_COST_USD`
- `PHOTO_SCENE_PROVIDER_TIMEOUT_MS`
- `PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER=false`

`PHOTOROOM_PRODUCTION_CONFIG` = **UNKNOWN** (production worker env not inspected this ticket). Treat as a **deployment prerequisite**.  
`DETERMINISTIC_PROVIDER_PRODUCTION_ALLOWED` = **NO** (`NODE_ENV=production` cannot select the deterministic adapter).

## 10. Queue / runtime

- Queue name: `photo-scene` (`QUEUE_NAMES.PHOTO_SCENE`)
- Jobs: `photo_scene.extract`, `photo_scene.compose`
- Worker: dedicated BullMQ Worker in `apps/worker/src/processors/index.ts`
- Requires: production Postgres, Redis/BullMQ (same prefix as production VS), private `campaign-assets`, official-bucket read, Photoroom for new extractions only

Video Studio agent/render/probe/export workers stay registered. Photo Scene does not call ffmpeg.

## 11. Web runtime files (Photo Scene only)

- `apps/web/src/components/campaign/CampaignDashboard.tsx` (mount only)
- `apps/web/src/components/photo-scene/PhotoSceneExtractionPanel.tsx`
- `apps/web/src/components/photo-scene/PhotoSceneOfficialLibraryPanel.tsx`
- `apps/web/src/components/photo-scene/PhotoSceneMarketingImagePanel.tsx`
- `apps/web/src/app/api/campaigns/[id]/photo-scene/extractions/route.ts`
- `apps/web/src/app/api/campaigns/[id]/photo-scene/scene-selection/route.ts`
- `apps/web/src/app/api/campaigns/[id]/photo-scene/marketing-images/route.ts`
- `apps/web/src/app/api/photo-scene/official-scenes/route.ts`
- `apps/web/src/app/api/photo-scene/official-scenes/[sceneId]/versions/[version]/route.ts`
- `apps/web/src/app/api/photo-scene/generations/[generationId]/route.ts`
- `apps/web/src/app/api/photo-scene/generations/[generationId]/retry/route.ts`
- `apps/web/src/lib/photo-scene-extraction.ts`
- `apps/web/src/lib/photo-scene-official-scenes.ts`
- `apps/web/src/lib/photo-scene-marketing.ts`
- `apps/web/src/lib/asset-signed-delivery.ts`

Do not include unrelated full HEAD UI.

## 12. Worker runtime files

- `apps/worker/src/processors/photo-scene-extract-handler.ts`
- `apps/worker/src/processors/photo-scene-compose-handler.ts`
- `apps/worker/src/processors/index.ts` (`QUEUE_NAMES.PHOTO_SCENE` Worker)
- `apps/worker/src/source-asset-content-hash.ts` (`hashSourceAssetBytes` additive; existing `hashSourceAssetFile` unchanged)

Existing production storage download/upload helpers remain required. No ffmpeg/renderer files.

## 13. Shared / DB / queue dependencies

- `packages/shared/src/photo-scene-asset.ts`
- `packages/shared/src/photo-scene-extraction.ts`
- `packages/shared/src/photo-scene-extraction.server.ts`
- `packages/shared/src/photo-scene-official-scene.ts`
- `packages/shared/src/photo-scene-marketing.ts`
- `packages/shared/src/photo-scene-marketing.server.ts`
- `packages/shared/src/photo-scene-ops.ts`
- `packages/shared/src/constants.ts` (`STORAGE_PATHS.library`)
- `packages/shared/src/index.ts`
- `packages/queue/src/jobs.ts` (`PHOTO_SCENE`, extract/compose schemas)
- `packages/queue/src/index.ts` (`photoSceneQueue`)
- `packages/db/src/schema/index.ts` (additive tables/relations)
- `packages/db/src/queries/photo-scene-generations.ts`
- `packages/db/src/queries/photo-scene-official-scenes.ts`
- `packages/db/src/index.ts`
- `packages/agents/src/photo-scene/background-removal.ts`
- `packages/agents/src/photo-scene/providers/photoroom.ts`
- `packages/agents/src/photo-scene/providers/photoroom-config.ts`
- `packages/agents/src/photo-scene/execute-product-extraction.ts`
- `packages/agents/src/photo-scene/execute-marketing-composition.ts`
- `packages/agents/src/photo-scene/compose-marketing-image.ts`
- `packages/agents/src/photo-scene/png.ts`
- `packages/agents/src/index.ts` (barrel export; compose handlers should keep subpath imports so composition does not load Photoroom)

No Video Studio renderer dependency.

## 14. Forbidden scope

Target assembly from `eea988d` + Photo Scene files above must exclude:

- AUTH-01 cutover / commercial entitlement projection
- AI Story
- Publishing
- Flux / OpenAI image generation
- Video Studio Renderer changes
- quota / billing
- Creative Studio second product / `creative_studio_jobs`
- full HEAD unrelated code
- wholesale `packages/db/sql/rls.sql`

`FORBIDDEN_PRODUCTION_SCOPE_COUNT` = **0** in that target assembly.

## 15–16. Deploy safety and assembly

`CURRENT_HEAD_DEPLOY_SAFE` = **NO** because:

1. This branch is the long-lived Video Studio + Photo Scene development line, not a pinned production assembly.
2. Apply/seed scripts refuse production and seed does not upload official objects.
3. Photoroom production env is unverified.
4. Official bucket does not exist on the certified production storage state.
5. Live production SHAs were not re-verified this ticket.
6. Photo Scene tests passing does not make the branch a safe production HEAD.

`PHOTO_SCENE_RELEASE_STRATEGY` = **BOUNDED_RELEASE_ASSEMBLY_REQUIRED**  
`ASSEMBLY_BASE_REVISION` = `eea988d5addd268d4d3356d336d7d076109b26ea`

Today’s `eea988d..bb33be4` delta is already a clean Photo Scene overlay. Assembly still pins that overlay rather than tracking this branch later.

## 17. AUTH-01

`AUTH01_REQUIRED_FOR_PHOTO_SCENE_V1` = **NO**  
`AUTH01_PRODUCTION_CUTOVER` = **NOT_PART_OF_THIS_RELEASE**

Photo Scene uses current workspace authorization (`requireAuth` + `requireWorkspaceRole`).

## 18. Video Studio protection

`VIDEO_STUDIO_RUNTIME_CHANGE_REQUIRED` = **NO**  
`VIDEO_STUDIO_REGRESSION_REQUIRED_AFTER_DEPLOY` = **YES**

Preserve generation, render, private storage, signed delivery, review, and export.

## 19–20. Deployment order and compatibility

`NEW_WEB_WITH_OLD_WORKER_SAFE` = **NO** — new web enqueues `photo_scene.extract` / `photo_scene.compose`; production worker at `eea988d` has no `photo-scene` consumer. Video Studio queues are unchanged, but Photo Scene generations would remain queued.

`NEW_WORKER_WITH_OLD_WEB_SAFE` = **YES** — extra consumer idles if web never enqueues; Video Studio workers are unchanged except the additive Photo Scene Worker.

Required order:

1. Production schema preflight (queries above; confirm production DB ref)
2. Apply migration 1 `photo-scene-campaign-asset-refs-v1.sql`
3. Apply migration 2 `photo-scene-generations-v1.sql`
4. Apply migration 3 `photo-scene-official-scenes-v1.sql`
5. Create `photo-scene-official` bucket + PUBLIC_READ / no-anonymous-write / service-role-write
6. Production-authorized official-scene seed **with object uploads** (0 paid APIs)
7. Set Photoroom worker env; `PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER=false`
8. Deploy worker (bounded assembly)
9. Worker idle / Video Studio smoke (new web not required yet)
10. Deploy web (bounded assembly)
11. Photo Scene runtime smoke
12. Video Studio regression
13. Production certification (A–Q)
14. Separate close ticket may mark RELEASED / FROZEN only after certification PASS

## 21. Rollback

| Failure | Action |
|---|---|
| Migration applied + web failed | Keep additive tables. Do not drop. Roll web to `eea988d` if web was deployed. |
| Web deployed + worker failed | Roll web and worker to `eea988d`. Photo Scene UI/jobs must not remain without a consumer. |
| Scene bucket/seed failure | Do not proceed to Photo Scene web traffic. Bucket/objects can be completed; schema stays. |
| Provider env failure | Extraction fails closed. Do not enable deterministic provider in production. Fix env; retry one extraction. |

`WEB_ROLLBACK_SAFE` = **YES** (to `eea988d`)  
`WORKER_ROLLBACK_SAFE` = **YES** (to `eea988d`)  
`SCHEMA_ROLLBACK_REQUIRED` = **NO**

## 22. Mandatory production certification

Do not rerun the 8-fixture Photoroom quality benchmark (`c72c343`).

A. source product  
B. Photoroom extraction  
C. `extracted_product` durable asset  
D. official scene selection  
E. frozen placement  
F. `marketing_image` generation  
G. deterministic compose  
H. campaign asset binding  
I. private storage  
J. signed preview  
K. signed download  
L. refresh/revisit  
M. retry  
N. Generate Again  
O. tenant isolation  
P. ops evidence  
Q. zero Photoroom recall during 10D composition  

Plus Video Studio regression: generate / render / private signed delivery / review / export.

## 23. Paid API budget

`MINIMUM_PHOTOROOM_CALLS_FOR_PROD_CERT` = **1**

One real production extraction, then reuse that `extracted_product` for 10D. Composition must show `PHOTOROOM_CALLS = 0`.

## 24. Release prerequisites (before RELEASED / FROZEN)

- Implementation complete (10A–10D CLOSED / PASS) — already true
- Bounded assembly built and pinned
- Production-authorized migrate/seed-with-upload exist
- Migrations applied
- `photo-scene-official` configured
- Official scenes seeded with objects
- Photoroom production env set; deterministic provider denied
- Web + worker deployed to the assembly revision
- Full live product loop PASS (A–Q)
- Private security PASS
- Tenant isolation PASS
- Video Studio regression PASS

## 25. Release channel

`RELEASE_CHANNEL_UPDATE_REQUIRED` = **YES**

Record Photo Scene as IMPLEMENTATION_COMPLETE / RELEASE_PENDING and that a bounded assembly is required. Do **not** mark Photo Scene RELEASED.

## 26. Next ticket

**EMBEROS-PHOTO-SCENE-V1-PROD-02 — Build bounded production release assembly**

Not deploy + certification until assembly + production-authorized migrate/seed/env exist.

## 27. Status

`PHOTO_SCENE_V1` = **IMPLEMENTATION_COMPLETE / RELEASE_PENDING**
