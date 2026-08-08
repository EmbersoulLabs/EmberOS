# EmberOS Unified Local Runtime

## Quick start

Prerequisites: Node 20+, pnpm, FFmpeg/FFprobe, and valid development credentials
for the configured Supabase project and Redis instance.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` starts Next.js and the BullMQ worker, then waits until every required
dependency is usable. It reports `READY` only after the strict health endpoint
passes. The normal URL is `http://127.0.0.1:3000`; set `LOCAL_RUNTIME_URL` to
use another port. Playwright uses `http://127.0.0.1:3100` through `--e2e`.

Supabase Postgres, Auth, and Storage plus Redis are configured services in the
current architecture; this repository does not contain Docker Compose or a
Supabase local stack. The unified command verifies them but does not provision
or mutate them.

## Required environment

- `DATABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REDIS_URL`
- `SUPABASE_STORAGE_BUCKET` (defaults to `campaign-assets`)
- `OPENAI_API_KEY` for AI analysis/generation

For shared/cloud Redis, keep `LOCAL_DEV=true` and `BULLMQ_PREFIX=local` so local
jobs are consumed by the local worker instead of a deployed worker.

## Services

| Service | Need | Startup | Dependencies | Health | Typical failure |
| --- | --- | --- | --- | --- | --- |
| Next.js | Required | `pnpm dev` | Supabase, DB, Redis | `/api/health/runtime` | pages unavailable or 503 |
| Worker/processors | Required for background flows | `pnpm dev` | Redis, DB, Storage, providers, FFmpeg | Redis heartbeat surfaced by `/api/health/runtime` | assets/tasks remain pending |
| Redis/BullMQ | Required | configured `REDIS_URL` | network access | `checks.redis` and `checks.queue` | enqueue 503 or pending forever |
| Supabase Postgres/Auth | Required | configured hosted project | network access | `checks.database`, `checks.supabase` | auth/API/database errors |
| Supabase Storage | Required for assets/video | configured bucket | service-role access | `checks.storage` | upload/download failures |
| OpenAI/provider APIs | Required for AI stages | external provider | provider keys | worker stage result | analysis/generation fails |
| FFmpeg/FFprobe | Required for video | installed executable | local filesystem/codecs | video E2E | probe/render jobs fail |
| Publishing provider | Optional until publishing | external credentials | approved content | provider-specific APIs | publishing action fails |

Campaigns and Marketing Packages require Web, DB, Redis, Worker and AI provider.
AI Story planning uses Web, DB and AI provider; execution additionally uses the
worker. Asset Library uploads require Storage, while analysis and Auto Rename
require Redis and Worker. Video generation also requires FFmpeg and render
processors. Publishing is optional for non-publishing vertical slices.

Image confirmation enqueues a dedicated `asset-analysis` BullMQ job. The
worker heartbeat advertises the `asset-analysis` capability, and the detailed
development/E2E health response reports `checks.assetAnalysisConsumer: "ok"`
only when that capability is present. Asset metadata uses
`assetAnalysis.status` (`pending`, `analyzing`, `completed`, or `failed`) plus
`visionAnalysis`; analysis failure preserves the upload and fallback name.

## Vercel Preview and Railway Worker pairing

Vercel deploys the Next.js Web application only. A Preview upload receives an
AI name only when a Railway Worker containing the matching `asset-analysis`
processor is running against the same `REDIS_URL`, `BULLMQ_PREFIX`, database,
Storage bucket, and provider configuration. A Preview-specific prefix requires
a Worker with that exact prefix; an omitted prefix uses the shared deployed
queue. Do not point a Preview Web deployment at a local-prefixed queue and
expect the production Railway Worker to consume it.

The Vercel deployment and Railway Worker must therefore be released as a pair
for changes that add queue producers or consumers. Vercel does not execute the
Worker process.

## Health and recovery

Open `GET /api/health/runtime`. A ready response contains `ok: true` and `ok`
for database, Redis, worker, Supabase, Storage and queue. Startup fails after
120 seconds and prints the last response instead of leaving tests pending.

The dependency-level response is intentionally available only while Next.js is
running in development mode, including the Playwright E2E runtime. A production
build returns only minimal Web-process liveness and does not contact privileged
dependencies or reveal bucket names, queue topology, or dependency errors.

Local and E2E browser sessions deliberately use the canonical host
`127.0.0.1` so Supabase SSR cookies are issued and returned under one hostname.
The current harness does not claim container, remote-host, or `localhost`
compatibility; use the documented `127.0.0.1` URLs and configure only the port.

Common recovery steps:

1. Missing environment: update `.env.local`; restart `pnpm dev`.
2. Redis/queue unreachable: verify `REDIS_URL`, DNS/VPN and TLS requirements.
3. Worker missing: inspect worker startup output and confirm the queue prefix
   matches the Web process.
4. Storage missing: verify `SUPABASE_STORAGE_BUCKET` and service-role access.
5. Video jobs fail: confirm `ffmpeg` and `ffprobe` are on PATH.
6. Vision provider timeout: `VISION_ANALYSIS_TIMEOUT_MS` defaults to 180000
   (3 minutes). A timeout aborts the provider request where supported, marks the
   task and Campaign failed, preserves uploads, and releases Campaign concurrency.
   Retry from the existing Campaign generation action; this creates a new task
   without changing the organization concurrency limit.
7. Interrupted E2E Campaigns: browser setup and video-test `afterEach` list the dedicated E2E
   workspace through authenticated application APIs and delete only Campaigns
   whose names begin with `E2E Video ` or `E2E Marketing ` and whose status is
   draft, processing, or failed. AI Story test Campaigns are intentionally outside
   this cleanup because their retention-owned execution plans restrict deletion.
   Completed/approved Campaigns and all non-E2E records are retained. Cleanup
   failures fail the test run with the affected Campaign ID.

Playwright automatically starts this same runtime and waits on the strict health
endpoint. It stops only the process tree started by its web-server harness.
