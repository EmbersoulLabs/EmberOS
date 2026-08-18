# Photo Scene V1 production infrastructure manifest

No secrets.

## DB

Production Supabase project: `egkgybrjmzukzmkcrpag`

Migrations:

1. `photo-scene-campaign-asset-refs-v1.sql`
2. `photo-scene-generations-v1.sql`
3. `photo-scene-official-scenes-v1.sql`

Preflight: `scripts/photo-scene-prod-schema-preflight.ts`

## Storage

| Bucket | Visibility | Role |
|---|---|---|
| `campaign-assets` | PRIVATE | Tenant sources, extracted products, marketing images (`{workspaceId}/library/...`) |
| `business-branding` | PUBLIC_READ | Brand logos only |
| `photo-scene-official` | PUBLIC_READ | Official scene background.png + preview.png |

Official bucket tool: `scripts/photo-scene-prod-official-bucket.ts` (plan default; `--apply` requires allow flags)

Anonymous write/update/delete: DENIED  
Service-role write: ALLOWED

## Redis

Existing production Redis / BullMQ prefix used by Video Studio. New queue name: `photo-scene`.

## Worker queue

- Queue: `photo-scene`
- Jobs: `photo_scene.extract`, `photo_scene.compose`
- Deploy worker before web

## Provider

- `PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER=photoroom`
- `PHOTOROOM_API_KEY` present
- `PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER=false`
- Verification: `scripts/photo-scene-prod-photoroom-env-preflight.ts` (never prints the key)

## Scene seed

`scripts/seed-photo-scene-official-scenes-production.ts`

Fixtures: floral-table, studio-white, marble-counter, draft-hidden  
Paid API calls: 0  
Uploads background.png + preview.png and verifies SHA-256 readback.
