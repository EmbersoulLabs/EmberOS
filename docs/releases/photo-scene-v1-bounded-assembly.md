# Photo Scene V1 bounded production assembly

Ticket: `EMBEROS-PHOTO-SCENE-V1-PROD-02`  
Date: 2026-08-18  
Base: `eea988d5addd268d4d3356d336d7d076109b26ea`  
Branch: `release/photo-scene-v1-bounded`

This assembly is built and validated. It is **not** deployed. Photo Scene remains IMPLEMENTATION_COMPLETE / RELEASE_PENDING.

## Operator commands (do not run against production in PROD-02)

```text
pnpm exec tsx scripts/photo-scene-prod-schema-preflight.ts
pnpm --filter @ceo-agent/db sql:photo-scene-v1-production
pnpm exec tsx scripts/photo-scene-prod-official-bucket.ts
pnpm exec tsx scripts/photo-scene-prod-official-bucket.ts --apply
pnpm exec tsx scripts/seed-photo-scene-official-scenes-production.ts
pnpm exec tsx scripts/photo-scene-prod-photoroom-env-preflight.ts
```

Production mutation commands require:

- `PHOTO_SCENE_PROD_MIGRATION_ACK=PHOTO_SCENE_V1`
- exact production Supabase ref `egkgybrjmzukzmkcrpag`
- the matching allow flag (`PHOTO_SCENE_PROD_MIGRATION_ALLOW`, `PHOTO_SCENE_PROD_BUCKET_ALLOW`, or `PHOTO_SCENE_PROD_SEED_ALLOW`)

Preview apply scripts still refuse production.

## Deployment order (PROD-03)

1. Schema preflight
2. Allowlisted migrations
3. Official bucket plan/apply
4. Official scene object seed
5. Photoroom env verification (names only)
6. Worker deploy
7. Video Studio smoke
8. Web deploy
9. Photo Scene certification (1 Photoroom call)

## Status

`PHOTO_SCENE_V1_BOUNDED_ASSEMBLY` = BUILT / VALIDATED
