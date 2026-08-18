# Photo Scene V1 Architecture

> Canonical architecture freeze for EmberOS Phase 10.
> Chat history is not authority. `docs/IMPLEMENTATION-ROADMAP.md` remains the product-phase authority.
> This file records the EMBEROS-PHOTO-SCENE-01A scope freeze.

Status: `10D_CLOSED_PASS` / Phase 10 `IMPLEMENTATION_COMPLETE_RELEASE_PENDING`
Date: 2026-08-18
Roadmap phase: 10 — Photo Scene V1
Implementation status: 10A CLOSED / PASS; 10B CLOSED / PASS; 10C CLOSED / PASS; 10D CLOSED / PASS
Video Studio V1: RELEASED / FROZEN at `eea988d5addd268d4d3356d336d7d076109b26ea`
PHOTO_SCENE_V1: IMPLEMENTATION_COMPLETE / RELEASE_PENDING

Do not mark Photo Scene V1 production RELEASED / FROZEN until a separate production deploy/certification ticket.

## 1. Product identity

`PHOTO_SCENE_V1 == CREATIVE_STUDIO_V1`

| Name | Use |
|---|---|
| **Photo Scene** | Canonical user-facing product name |
| **photo-scene** | Internal module / route / job prefix |
| Creative Studio | Architecture synonym for the same module family. Do not ship a second product. |
| Internal Creator Studio | Super-admin / agency tooling in `docs/VIDEO_STUDIO.md`. Out of SaaS Photo Scene V1. |
| `creatives` table | Video Studio output rows. Not Photo Scene images. |
| Creative Assets (Flux note) | Provider-env wording for future image providers. Not a separate product. |

Parallel Creative Studio product: **NO**.

Photo Scene is not Photoshop, Canva, a layer editor, Video Studio, AI Story, or Publishing.

V1 loop:

```text
Campaign
  → select or upload product image
  → extract product (transparent)
  → choose official scene
  → place product (basic, deterministic)
  → compose marketing image (logo / colors / text overlay)
  → review preview
  → retry / change scene / change placement / generate again
  → save as workspace + campaign asset
  → signed download
```

Primary entry: **Campaign** (Create Content peer beside Video Studio).  
Secondary entry: **Asset Library** (pick an existing product image, then continue inside a Campaign).  
Do not add a new global nav item in 10A.

## 2. Sprint scopes

### 10A — Creative Asset Foundation

Freeze and implement Photo Scene file identity on the existing Asset Library model: types, workspace + campaign association via `campaign_asset_refs`, metadata, lineage (`sourceAssetId`), generation history pointers, and `contentHash` for product images.

### 10B — Product Extraction

Upload or select a product image; background removal; durable transparent product asset; processing / quality / failure states; retry. Manual correction V1 = re-upload or retry, not mask painting.

### 10C — Official Scene Library

Curated global official scenes with stable `sceneId` + `sceneVersion`; categories; preview; selection; deterministic placement contract; persist placement with the generation, not as a general canvas.

### 10D — Marketing Image Generation

Frozen inputs (extraction, scene version, placement, brand snapshot, marketing-package snapshot, platform preset); deterministic composition; logo / brand colors / text overlay; save marketing image as a Creative/Campaign Asset; signed preview and download.

Contradiction resolved: 10C “Save output” means persist placement + scene selection. 10D “Save as Creative Asset” means the final marketing image. Advanced AI custom scenes remain premium/future.

## 3. Data authority

### Files: reuse `assets`

`CREATIVE_ASSET_AUTHORITY = HYBRID`

- Source product, extracted product, and generated marketing images **are** `assets` rows (workspace-scoped, `org_id` + `workspace_id`).
- Campaign binding uses `campaign_asset_refs`. Do not revive campaign-owned-only file identity.
- Do not create `creative_assets`.
- Do not use Video Studio `creatives` rows for still images.

`NEW_CREATIVE_TABLE_REQUIRED`:

- **NO** for tenant image files.
- **YES at 10C** for official scene catalog (`official_scenes` / `official_scene_versions`): assets are tenant-scoped; official scenes are global immutable platform catalog.
- **YES at 10B** for `photo_scene_generations`: frozen input capsule, multi-step recovery, and fingerprint. Existing `tasks` are Video Studio three-output jobs and must not absorb Photo Scene.

### `creative_studio_jobs`

Classification: **NEVER_LANDED** on production. Present only on excluded full-HEAD commit `cfaa895` (`packages/db/sql/creative-studio-v1.sql`). Not Photo Scene V1 authority. **Not required.** Do not migrate it in 10A–10D unless a later ticket proves the new `photo_scene_generations` contract is insufficient.

### Product source identity

Frozen input:

- `asset.id`
- `workspaceId` + `orgId`
- `contentHash` (`sha256:<64 hex>`, required)
- `storagePath` (not a public URL)
- optional `campaignId` via ref

`CONTENT_HASH_REQUIRED = YES`  
`SOURCE_MUTATION_POLICY`: confirmed product images are immutable. Replacement is a new `asset.id`. Generation must fail closed if stored `contentHash` no longer matches bytes.

### Extraction

`PRODUCT_EXTRACTION_OUTPUT = DURABLE_ASSET`  
`EXTRACTION_REUSE = YES`

Output asset type: `extracted_product`. PNG with alpha. Persist mask/bbox in metadata if the provider returns them; they are not a V1 editor surface. Quality: `ready` | `failed` | `needs_retry`.

### Official scenes

`SCENE_OWNERSHIP_MODEL = GLOBAL`  
`SCENE_VERSIONING_REQUIRED = YES`  
`SCENE_MUTABILITY_POLICY`: in-place edits create a new `sceneVersion`. Existing generations keep the frozen version id + content hash. Workspace custom scenes are deferred.

Minimum scene contract:

- `sceneId`, `sceneVersion`, `status` (`draft` | `published` | `retired`)
- `category`, `aspectRatio`, `platformSuitability[]`
- background storage identity + `contentHash`
- `safePlacementArea` (normalized box)
- `productAnchor`, `scaleRange`, `shadowPreset`
- preview storage identity

### Placement

Deterministic. Manual V1. No AI placement.

```text
slotId (default primary)
anchor
offsetX, offsetY     // normalized inside safe area
scale                // within scene scaleRange
rotationDeg          // V1: 0 unless scene allows a small range
zOrder               // product above scene background
shadowPreset         // scene-owned, not user-painted
```

`MANUAL_PLACEMENT_V1 = YES` (basic size/position only)  
`AI_PLACEMENT_V1 = NO`  
`GENERAL_CANVAS_EDITOR = NO`  
`LAYERS_PANEL = NO`

### Composition

`V1_COMPOSITION_MODE = DETERMINISTIC`

Official scene bitmap + extracted product + brand overlay. Not a generative image model. Flux is not required. Custom AI scenes are deferred.

### Marketing image frozen input

```text
workspaceId, orgId, campaignId
sourceAssetId + sourceContentHash
extractedAssetId + extractedContentHash
sceneId + sceneVersion + sceneContentHash
placement (canonical JSON)
brandSnapshot { profileId, profileVersion, logoStoragePath, logoContentHash, brandColors, companyName, brandFonts }
marketingPackageSnapshot { campaignId, taskId | null, snapshotHash }
presetId (see output presets)
overlayCopy { headline?, cta? }  // optional; from package snapshot or explicit freeze
```

`GENERATION_INPUT_FROZEN = YES`  
`GENERATION_FINGERPRINT_REQUIRED = YES`  
Reuse Video Studio hashing *ideas* (capsule + fingerprint). Do not import Video Studio renderer, director, or task UX.

### Marketing Package compatibility

No SPEC-005 package version table exists today. Package truth is campaign/task JSON (`strategy_json` / marketing pack on the latest task).

`STABLE_VERSION_ID_AVAILABLE = NO`  
10D strategy: hash a bounded snapshot at generation time (`campaignId` + optional `taskId` + canonical JSON). Do not redesign Marketing Package in Phase 10.

### Brand

Authoritative fields from `business_profiles`: `logo` (storage path, `business-branding` public logo), `brandColors`, `brandFonts`, `companyName`, `version`.

`BRAND_CONTEXT_FROZEN_PER_GENERATION = YES`

### Output presets

`CUSTOM_DIMENSIONS_V1 = NO`

| presetId | ratio | pixels |
|---|---|---|
| `story_9x16` | 9:16 | 1080×1920 |
| `feed_1x1` | 1:1 | 1080×1080 |
| `portrait_4x5` | 4:5 | 1080×1350 |

Scene catalog must declare compatible presets. Do not add a preset zoo.

## 4. Storage and security

`PUBLIC_URL_AS_IDENTITY = NO`  
`SIGNED_DELIVERY_REQUIRED = YES` for tenant artifacts  
`CROSS_WORKSPACE_ASSET_USE = DENIED`

| Artifact | Bucket | Notes |
|---|---|---|
| Original product image | `campaign-assets` PRIVATE | `{workspaceId}/library/{assetId}.ext` |
| Extracted product | `campaign-assets` PRIVATE | same |
| Generated marketing image | `campaign-assets` PRIVATE | same |
| Official scene artwork | dedicated global catalog storage, not tenant `campaign-assets` | public-read platform catalog allowed; no-anonymous-write |
| Business logo overlay | `business-branding` PUBLIC | branding only; copy identity into generation snapshot |

Do not store tenant product/extracted/generated images in `business-branding`. Do not treat signed URLs as artifact identity.

Tenant isolation: every read/write filters `org_id` + `workspace_id` except global official scenes (no tenant bytes). Generation may only reference assets in the same workspace.

## 5. Execution, recovery, review, export

`EXECUTION_MODEL = HYBRID`

- 10A: asset records only  
- 10B–10D: `photo_scene_generations` + existing worker/queue  
Do not enqueue Photo Scene on Video Studio `agent.pipeline` / `ffmpeg.render` contracts.

Recovery: persisted generation status is source of truth. Fail closed. Retry same generation identity. Client polling must not invent terminal failure.

| Action | Identity |
|---|---|
| Retry | same generation id; same frozen input |
| Regenerate | same frozen input except provider/attempt; new attempt on same generation or child with same fingerprint |
| Change Scene / Placement | new frozen input → new fingerprint → new generation |
| Generate Again | always new generation id |

`REVIEW_REQUIRED = NO` (no client-portal approval). Operator states: `queued` → `extracting` → `composing` → `ready` \| `failed`. Ready assets are usable. Discarded/failed are not Publishing-eligible.

Export V1: signed preview, signed download, save to Campaign Assets via `campaign_asset_refs`.  
`PUBLISHING_EXECUTION_INCLUDED = NO`  
`PUBLISHING_COMPATIBLE_ARTIFACT = YES` via stable `asset.id` + `contentHash` + campaign ref + presetId + frozen caption fields from package snapshot.

## 6. Providers and cost

| Capability | Provider required | Current | V1 decision | Fallback | Cost |
|---|---|---|---|---|---|
| Background removal | YES | none | provider-neutral `BackgroundRemoval` adapter | fail closed + retry | per extraction |
| Official scenes | NO | none | curated catalog | n/a | storage |
| Placement | NO | none | deterministic params | n/a | none |
| Marketing image | NO generative model | worker CPU | deterministic compose | fail closed | CPU |
| Custom AI scenes | future | Flux excluded | **defer** | n/a | high |

`FLUX_REQUIRED_FOR_V1 = NO`  
`V1_PROVIDER_DECISION_REQUIRED_NOW = NO` (interface frozen here). Before **10B implementation**, benchmark quality/cost of candidate removers (local/rembg/fal/commercial). Do not lock a vendor in 10A.  
`COST_LEDGER_REQUIRED_FOR_V1 = YES` (record usage/cost on the generation).  
`QUOTA_REQUIRED_FOR_V1 = NO`

## 7. UI

V1 surfaces: campaign entry; source pick/upload; extraction preview; official scene picker; basic placement; result preview; save/download; retry/change-scene/generate-again.

Responsive: existing EmberOS web responsive + permission/empty/error/loading states. No native app.

## 8. Sprint close gates

### 10A

MUST: Photo Scene asset types (`product_image`, `extracted_product`, `marketing_image`); workspace + campaign ref; `contentHash` on product images; lineage metadata; no new `creative_assets` / no `creative_studio_jobs`; no provider; no Video Studio edits.

SHOULD: folder/category in metadata; display name.

DEFER: official scene table (10C), generation table (10B), UI loop, providers.

DB: additive Asset Library contract only. No Phase 10C/10D tables in 10A.

Provider: NO.

Close: tests prove type/lineage/hash/campaign-ref contracts; workspace isolation; storage paths under `{workspaceId}/`; Video Studio production revision untouched.

### 10B

MUST: extract job; durable transparent asset; retry; fail closed; provider adapter; cost record.

Close: same source hash → reusable extraction; mutation of source fails closed; tenant isolation; no mask editor.

### 10C

MUST: published official scene catalog with versions; picker; placement contract; frozen sceneVersion on save.

Close: editing a scene cannot change an existing frozen generation’s scene hash; tenant cannot mutate global catalog.

### 10D

MUST: frozen capsule + fingerprint; deterministic compose; brand + package snapshots; presets; signed delivery; campaign asset save.

Close: user-visible loop Campaign → extract → official scene → place → marketing image → save/download works without AI Story, Video Studio renderer, Publishing, Flux, or AUTH-01.

## 9. Defer

AI-generated custom scenes; user scene templates; canvas/layers/mask painting; generative fill; object replacement; batch generation; bulk resize; PSD export; AI Story integration; Video Studio integration beyond ordinary Asset reuse; Publishing execution / social posting; quota; billing; provider marketplace; Flux; AUTH-01 cutover; Internal Creator Studio.

## 10. Forbidden dependencies

Photo Scene V1 must not depend on: AI Story runtime; Video Studio Renderer V1; AUTH-01 production cutover; Publishing implementation; `creative_studio_jobs`; commercial lifecycle; deploying full release HEAD onto Video Studio production.

Forbidden dependency count: **0** (architecture excludes them).

## 11. Implementation strategy

`EXTEND_EXISTING_ASSET_MODEL` for tenant files, plus two small new entities (official scenes at 10C, generations at 10B).

Smallest coherent architecture. Do not implement on frozen Video Studio production `eea988d`. Implement on a development branch that already contains Asset Library V1.

## 12. Production release readiness

EMBEROS-PHOTO-SCENE-V1-PROD-01 (2026-08-18): CONDITIONAL PASS. Direct HEAD deploy is not safe.

EMBEROS-PHOTO-SCENE-V1-PROD-02 (2026-08-18): bounded assembly BUILT / VALIDATED on `release/photo-scene-v1-bounded` from `eea988d5addd268d4d3356d336d7d076109b26ea`. Production-authorized migrate/preflight/bucket/seed/env tools exist. Photo Scene remains IMPLEMENTATION_COMPLETE / RELEASE_PENDING.

## 13. Next ticket

EMBEROS-PHOTO-SCENE-V1-PROD-03 — Production deploy + certification. Do not start Publishing, Flux, AUTH-01, or quota. Do not mark Photo Scene RELEASED / FROZEN.
