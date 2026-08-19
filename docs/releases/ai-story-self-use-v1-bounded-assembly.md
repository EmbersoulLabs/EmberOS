# AI Story Self-Use V1 bounded production overlay assembly

Ticket: `EMBEROS-AI-STORY-EXEC-02`  
Date: 2026-08-19  
Production base: `b447f539400f2765958c1c94add708a979c86604`  
Branch: `release/ai-story-self-use-v1-bounded`  
AI Story source: `release/sprint-4-phase-b` @ `cfaa8950e682b0cd512514d52a4e7d9c5113cd60`

This assembly is built, validated, and **DEPLOYED / AWAITING REAL EPISODE CERT** on production at `b52925aa20e4c66092f8fff0ea5cf7c30620ac6e` (PROD-FIX-01 routing/source-ref overlay; worker SHA) / web CLI `70273cd`. AI Story remains NOT RELEASED.

Do not merge `release/sprint-4-phase-b`. That branch is source authority only.

## Operator commands

```text
pnpm exec tsx scripts/ai-story-prod-schema-preflight.ts
pnpm exec tsx scripts/ai-story-prod-provider-env-preflight.ts
pnpm exec tsx scripts/ai-story-prod-storage-preflight.ts
```

Apply generated Scene review SQL against production only with:

- `AI_STORY_RAILWAY_VARS_FILE` (Railway `variable list --json` tempfile; never commit)
- `AI_STORY_PROD_MIGRATION_ALLOW=true`
- `AI_STORY_PROD_MIGRATION_ACK=AI_STORY_SELF_USE_V1`

```text
pnpm exec tsx scripts/ai-story-prod-apply-generated-scene-review.ts
```

## Assembly method

1. Branch from production pin `b447f53` exactly.
2. Patch-extract AI Story runtime from `cfaa895` by allowlisted paths.
3. Reconcile barrels additively. Do not transplant Sprint 4 barrels.
4. Add production-compat shims for `assets` / `campaigns` columns that exist only on Sprint 4 HEAD.
5. Keep Video Studio Renderer V1 and Photo Scene V1 files unchanged.

## Runtime manifest (classification)

| Class | Scope |
| --- | --- |
| REQUIRED_RUNTIME | `packages/agents/src/ai-story/**`, provider adapters/router, worker AI Story cycle, queue `agent.story_execution` lock producer, shared AI Story contracts |
| REQUIRED_SCHEMA | Additive drizzle tables for AI Story, provider ledger/outbox/envelope/dispatch, platform-admin, entitlements, credits, billing-account |
| REQUIRED_MIGRATION | `packages/db/sql/ai-story-*.sql`, provider SQL, platform-admin/commercial/credits SQL. DROPs removed from execution SQL. Apply scripts fail-closed on production. |
| REQUIRED_UI | Campaign-owned `/ai-stories` pages, review/runtime/FSR panels, `AiStoryCampaignPanel` on production `CampaignDashboard` |
| REQUIRED_TEST | Existing AI Story unit/boundary tests; Creative Studio execute-route expectation removed |
| REQUIRED_DOC | `docs/AI_STORY_V1.md`, `docs/AI_STORY_EXECUTION_V1.md`, this assembly report |
| COMPAT_SHIM | `apps/web/src/lib/ai-story-production-compat.ts`; bounded `packages/shared/src/server.ts`; bounded `packages/agents/src/commercial/index.ts`; `uploadStorageFile({ upsert })` default true |
| EXCLUDED | AUTH-01 Stripe cutover, quota, Publishing, Creative Studio runtime, Flux, Video Studio renderer changes, Photo Scene implementation changes, full Sprint 4 barrels/HEAD |

## Database reconciliation

- Required AI Story tables: see `AI_STORY_REQUIRED_TABLES` in `packages/shared/src/ai-story-production-ops.ts`.
- Structural compile/runtime tables: `AI_STORY_STRUCTURAL_TABLES` (provider + commercial persistence used by current Execute).
- Leftover production `ai_stories` rows must not be dropped. Migrations are `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.
- `DESTRUCTIVE_MIGRATION_REQUIRED = NO`.
- Live production preflight was not applied in EXEC-02 (`ENVIRONMENT_NOT_RUN` unless `DATABASE_URL` is present locally). Expected gaps are later execution/review/assembly/FSR/provider tables, not destruction of the 18 leftover stories.

## Storage / delivery

- Bucket: `SUPABASE_STORAGE_BUCKET` default `campaign-assets` (private).
- Canonical identity: workspace-prefixed durable object keys (`{workspaceId}/ai-story/...`).
- Provider public URLs are not durable authority.
- Signed delivery: request-scoped via Final Story Result download/playback routes.
- Anonymous access: not expected.

## Access / cost (preserved, not solved)

- Product policy: Super Admin + Agency allowed; Free / Pro / Pro Plus denied.
- Canonical Execute product authorization is `authorizeAiStoryExecution`. Super Admin ACTIVE grant and Agency plan capability mapping receive explicit ops/non-commercial settlement (`settlementMode=none`). That mode skips billing account, subscription, and credit reserve. It does not mean provider cost is zero.
- Commercial Execute remains fail-closed when product authorization does not select ops mode.
- `AUTH01_INCLUDED = NO`. No Stripe cutover. No quota.
- EXEC-05 persists provider-attempt usage/cost on existing `provider_attempts` / `provider_attempt_usage` / `provider_attempt_costs` JSON. Reconstruction is exposed on product runtime as `providerSpend`.
- EXEC-04 persists generated-media Scene review on `ai_story_generated_scene_reviews`. Retry creates a new provider attempt of the same Scene with frozen input. Assembly consumes only the approved Scene output. Retry cap: `AI_STORY_SCENE_MAX_ATTEMPTS` (default 3).
- EXEC-06 freezes V1 QC as plan/intent AI QC + mandatory human generated-media review. Plan QC must not be represented as visual/media QC. Future media-aware QC (artifact → optional automated media QC evidence → human review → approved output) is documented, not implemented.

## Forbidden-scope audit (`b447f53`..assembly)

| Item | Result |
| --- | --- |
| AUTH-01 / Stripe webhook runtime | ABSENT (drizzle `stripeEventReceipts` is compile-only; no `stripe_event` SQL; no webhook routes) |
| Quota / Publishing / Flux / Creative Studio routes | ABSENT |
| Video Studio renderer | UNCHANGED |
| Photo Scene handlers/UI panels | UNCHANGED (AI Story card appended after Photo Scene cards) |
| STRUCTURAL_DEPENDENCY | Commercial auth, entitlements, credits, platform-admin, plan capability map |
| COMMERCIAL_CUTOVER | NOT included |

`FORBIDDEN_SCOPE_DIFF = NONE`

## Remaining self-use tickets

1. `EMBEROS-AI-STORY-SELF-USE-PROD-CERT` — one 3-Scene complete episode from the real provider execution gate.

`EMBEROS-AI-STORY-PROD-ENV-01` PASS. `EMBEROS-AI-STORY-PROD-DEPLOY-01` deployed overlay `36b5241636c6e6828cef82b8ae165e2eea71f42b` with zero paid provider calls. AI Story remains NOT RELEASED.

## Status

`AI_STORY_SELF_USE_V1_BOUNDED_ASSEMBLY` = BUILT / VALIDATED  
`AI_STORY_SELF_USE_V1` = DEPLOYED_AWAITING_REAL_EPISODE_CERT  
`DEPLOYMENT` = worker Railway `5d775841` + web Vercel `dpl_4BgYwuJ4pE8bvkCDuiU3cSx3CEyk` @ `36b5241`  
`PRODUCTION_SCHEMA_CHANGE` = additive `ai_story_generated_scene_reviews` only (already applied; no new SQL in PROD-DEPLOY-01)  
`PAID_PROVIDER_CALLS` = 0
