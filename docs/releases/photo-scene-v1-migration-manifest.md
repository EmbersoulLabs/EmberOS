# Photo Scene V1 production migration manifest

Do not apply these in PROD-02.

Allowlist only. Unknown files are refused. Do not apply `packages/db/sql/rls.sql` as a whole. Photo Scene RLS is included in the three feature files. `photo-scene-marketing-generations-v1.sql` is comment-only and is not applied.

| Order | File | Precondition | Postcondition |
|---|---|---|---|
| 1 | `packages/db/sql/photo-scene-campaign-asset-refs-v1.sql` | `campaigns` and `assets` exist. `campaign_asset_refs` ABSENT or already compatible. | Table + RLS + optional backfill from `assets.campaign_id`. |
| 2 | `packages/db/sql/photo-scene-generations-v1.sql` | Base tenant tables exist. `photo_scene_generations` ABSENT or compatible. | Table + inflight unique index including `operation` + RLS. `marketing_image` needs no extra column. |
| 3 | `packages/db/sql/photo-scene-official-scenes-v1.sql` | Campaigns/assets exist. Official scene tables ABSENT or compatible. | Catalog, versions, tenant selections + RLS. |

Apply tool: `packages/db/scripts/apply-photo-scene-v1-production.ts`  
Flags: `PHOTO_SCENE_PROD_MIGRATION_ALLOW=true`, `PHOTO_SCENE_PROD_MIGRATION_ACK=PHOTO_SCENE_V1`, `PHOTO_SCENE_PROD_SUPABASE_REF=egkgybrjmzukzmkcrpag`

Preview tools remain: `apply-photo-scene-*-v1.ts` refuse production.
