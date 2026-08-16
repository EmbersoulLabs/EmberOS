# Video Studio V1 bounded assembly — migration deployment manifest

Do not run these against production from Assembly-B.

Authorized production apply order remains:

1. DB
2. web
3. worker

## Migrations

1. `packages/db/sql/source-asset-content-hash-v1.sql`
   - Add-only nullable `assets.content_hash`
   - Format check `sha256:[a-f0-9]{64}` or NULL
   - No backfill

2. `packages/db/sql/campaign-video-generation-identity-v1.sql`
   - Add-only nullable `tasks.generation_input_capsule`
   - Add-only nullable `tasks.generation_input_fingerprint`
   - Pair check: both NULL or both NOT NULL
   - Fingerprint format check `sha256:[a-f0-9]{64}` or NULL
   - No uniqueness constraint
   - No backfill

Expected behavior: legacy rows remain valid with NULL identity/hash. New web writes populate both identity columns. Old workers ignore extra columns. New workers fail closed on NULL identity.

Apply scripts refuse production project `egkgybrjmzukzmkcrpag` and only allow preview `voofxbuzpocyjzoxrpfi`.
