# Photo Scene V1 — Background removal provider certification

Status: `COMBINED_10B_EVIDENCE_SUFFICIENT`
Date: 2026-08-18
Tickets: EMBEROS-PHOTO-SCENE-10B-PROVIDER-LIVE (`c72c343`) + EMBEROS-PHOTO-SCENE-10B-RUNTIME-ZERO-PAID-API
Selected V1 provider: **Photoroom Remove Background API** (`photoroom`)
Live adapter execution: **PASS** (8/8) — reused; no new Photoroom calls
Durable generation/worker close: **PASS** (authorized preview Postgres + Redis + in-process `photo_scene.extract` worker; deterministic adapter only)

This file records the quality rubric **before** live scores. Thresholds were not moved after seeing results.

## Quality rubric

Scale: 1–5 per dimension. Fixture pass requires mean ≥ 3.5 and no dimension at 1.

| Dimension | 1 | 5 |
|---|---|---|
| SUBJECT_COMPLETENESS | subject truncated | full product retained |
| EDGE_QUALITY | jagged/halo | clean product edge |
| BACKGROUND_REMOVAL | background remains | background gone |
| ALPHA_ARTIFACTS | fringing/holes | clean alpha |
| DETAIL_PRESERVATION | logos/texture destroyed | labels/texture kept |
| FALSE_REMOVAL | product holes | no interior deletion |
| FALSE_RETENTION | leftover background | no leftover patches |

`PASS_THRESHOLD`: mean **3.5 / 5** across fixtures, and every fixture must pass PNG+alpha validation.

## Certification fixtures

Count: **8** (synthetic, non-customer)

1. simple solid-background product
2. white/light-background product
3. dark-background product
4. flowers / leaves / thin stems
5. glass / translucent object
6. irregular edge object
7. low-contrast foreground/background
8. high-resolution phone photo stand-in  

## Live adapter results (2026-08-18)

Provider: `photoroom`
MIME: `image/png`
Cost: **USD 0.02** configured (`PHOTO_SCENE_PHOTOROOM_COST_USD`)
Success rate: **8/8**
Median latency: **875ms**
P95 latency: **1109ms**

All eight outputs: PNG signature PASS, IHDR PASS, RGBA alpha PASS, dimensions 1–8192, size ≤25MB.

Alpha occupancy (fully transparent / opaque / partial):

| Fixture | alpha0 | alpha255 | partial |
|---|---|---|---|
| simple-solid | 0.70 | 0.29 | 0.012 |
| white-bg | 0.70 | 0.29 | 0.009 |
| dark-bg | 0.70 | 0.29 | 0.011 |
| flower-stem | 0.89 | 0.10 | 0.008 |
| glass | 0.82 | 0.18 | 0.008 |
| irregular-edge | 0.72 | 0.27 | 0.009 |
| low-contrast | 0.70 | 0.29 | 0.009 |
| phone-photo | 0.70 | 0.30 | 0.005 |

Quality scores (1–5). Worst dimension is EDGE_QUALITY **4** on curved/thin fixtures. No dimension scored 1.

| Fixture | mean |
|---|---|
| simple-solid | 5.00 |
| white-bg | 5.00 |
| dark-bg | 5.00 |
| flower-stem | 4.86 |
| glass | 4.86 |
| irregular-edge | 4.86 |
| low-contrast | 5.00 |
| phone-photo | 5.00 |

**Quality mean: 4.95 / 5 — PASS**

In-process extraction engine with the live adapter:

- READY extracted_product, canonical `{workspaceId}/library/{assetId}.png`, server contentHash, lineage, costUsd `0.02`
- second same-source request: **0** additional provider calls
- mutated bytes: new hash + new fingerprint
- invalid input: `PROVIDER_REJECTED`, user-safe bounded error, no READY output
- retry identity preserved
- ops events include providerKey `photoroom` with redaction PASS

Bounded `campaign-assets` object probe (test tenant, then deleted): anonymous GET **400**, signed URL issued, public URL not persisted as identity.

Not claimed by the live adapter ticket: `photo_scene_generations` row, `campaign_asset_refs`, live unique-index concurrency, worker queue, UI refresh/revisit.

## Durable runtime certification (2026-08-18)

- Ticket: EMBEROS-PHOTO-SCENE-10B-RUNTIME-ZERO-PAID-API
- Command: `pnpm exec tsx scripts/certify-photo-scene-runtime-zero-paid.ts`
- `ACTIVE_CERT_PROVIDER`: **deterministic**
- `PHOTOROOM_NETWORK_CALL_COUNT`: **0**
- `CERT_RUNTIME_EXTERNAL_COST`: **USD 0**
- `NEW_PHOTOROOM_CALLS_ALLOWED`: **NO**

The cert process loads authorized preview `DATABASE_URL` / `REDIS_URL`, unsets `PHOTOROOM_API_KEY`, sets `PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER=deterministic` and `PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER=true` in-process only, and uses a unique `BULLMQ_PREFIX`. Production defaults and the local Photoroom key file are unchanged.

Proven against real Postgres + Redis/BullMQ + worker processor:

- `photo_scene_generations` persistence (capsule, fingerprint, sourceContentHash)
- queue enqueue + worker consume
- extracted_product PNG with alpha, contentHash, lineage, `campaign_asset_refs`
- private storage; anonymous GET denied; signed preview; public URL not persisted
- same-source reuse; source mutation creates a new generation
- concurrent identical requests converge on one inflight generation
- controlled failure fail-closed, then retry of the same generation id
- refresh/revisit from persisted authority
- workspace RLS / isolation
- ops events identify `deterministic`, not `photoroom`

This run is not live-provider persistence evidence. Combined 10B close uses live quality from `c72c343` plus this durable runtime.

## Provider matrix (official docs, 2026-08-17)

| PROVIDER | QUALITY | LATENCY | COST | ALPHA_QUALITY | API_COMPLEXITY | VENDOR_RISK | V1_SUITABILITY |
|---|---|---|---|---|---|---|---|
| Photoroom `/v1/segment` | Product-native; does not alter product pixels | median 350ms (vendor status); live cert median 875ms | **$0.02 / image** Basic | PNG `rgba` default | multipart bytes in / PNG out | Moderate; specialized vendor | **Selected** |
| remove.bg | Strong hair/fine-edge; `type=product` | typically 1–3s | ~$0.16–$1.00 / credit | PNG up to 10MP | simple POST | Moderate; expensive | Strong alternate, not selected on cost |
| fal Pixelcut | E-commerce cutouts | fast | **$0.016 / image** | rgba PNG | requires `image_url` / data URI | Platform lock-in | Viable if Photoroom unavailable |
| fal rembg / BiRefNet | Mixed; portraits often stronger than packshots | compute-seconds | very low | PNG | queue + URL | Model churn | Not V1 primary |
| local rembg | Variable | hardware-bound | infra | PNG | high ops | Low vendor, high ops | Not V1 |

Automatic multi-provider fallback: **NO**. Retry the same configured Photoroom adapter.

## Env (names only)

- `PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER` (`photoroom` \| `deterministic` \| `none`)
- `PHOTOROOM_API_KEY`
- `PHOTO_SCENE_PHOTOROOM_COST_USD` (default `0.02`)
- `PHOTO_SCENE_PROVIDER_TIMEOUT_MS` (default `30000`)
- `PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER` (CI/local only)

No `NEXT_PUBLIC_` provider secrets.
