# EmberOS Development Workflow

Use [README.md](./README.md) as the single current-state and architecture entry point. This document defines how changes are developed and released; it does not certify a live environment. Product history and older phase plans are reference material only.

## 1. Start from evidence

1. Fetch `origin/main` and record its SHA.
2. Read repository instructions, target contracts, recent merged PRs, migrations, and tests.
3. Inspect open PRs for overlapping or superseded work.
4. Use an isolated branch or worktree and preserve unrelated local changes.
5. Separate these claims: source implemented, CI verified, deployed, runtime healthy, and end-to-end certified.

README, roadmap entries, successful builds, and route reachability are not substitutes for runtime evidence.

## 2. Change boundaries

- Prefer a small vertical change through existing Web, Worker, domain, database, and contract boundaries.
- Do not create duplicate planners, prompt writers, provider routers, billing paths, or approval systems.
- Preserve workspace/organization bindings, immutable fingerprints, approvals, idempotency, cost ceilings, and audit lineage.
- Keep unsupported provider, audio, continuity, and workflow capabilities fail-closed.
- Never convert an `UNKNOWN` paid-provider outcome into an automatic retry.
- Keep Production mutations, paid calls, GPU jobs, merges, and deployments outside ordinary development unless explicitly authorized.

## 3. Database and tenant safety

The Drizzle schema and additive SQL contracts are both authoritative inputs. Current main contains substantially more tables than the original core-table documentation.

Before a schema or access change:

1. Classify the table as tenant-owned, organization-owned, global read-only, or server-only.
2. Bind tenant rows to `workspace_id` and verify `org_id` consistency where present.
3. Define grants and RLS together. RLS does not replace privileges, and service-role/server database connections bypass user RLS.
4. Test allowed and denied SELECT, INSERT, UPDATE, and DELETE for two workspaces.
5. Test indirect access through joins, signed tokens, storage paths, background jobs, and deletion helpers.
6. Add a forward migration; never rewrite an applied migration.

Run database tests only against a disposable target:

```bash
pnpm test:integration
```

The runner requires `EMBEROS_TEST_DB_ENVIRONMENT=test` and rejects known shared targets. Do not weaken this guard. `db:push`, `db:migrate`, `db:rls`, and feature `sql:*` commands mutate the selected `DATABASE_URL`; they are not routine setup commands.

## 4. Local development

Prerequisites and environment-variable names are maintained in [README.md](./README.md).

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev:sync
pnpm dev
```

When Worker-backed flows are required, start the Worker separately:

```bash
pnpm worker:dev
```

Use an isolated `BULLMQ_PREFIX` when development points at shared Redis. Verify FFmpeg/ffprobe before media tests. Do not point local E2E at Production queues or customer records.

## 5. Validation ladder

Choose the smallest sufficient layer, then expand according to risk:

```bash
pnpm test
pnpm typecheck
pnpm --filter @ceo-agent/worker typecheck
pnpm --filter @ceo-agent/web build
pnpm verify
```

Additional gates:

- `pnpm test:auth-browser` for authentication/browser security changes.
- `pnpm test:integration` for database behavior on disposable PostgreSQL.
- Focused LOCAL_GPU V2/V3 contract tests for transport or H3 mapping; use fake/injected ComfyUI and do not generate media.
- `pnpm smoke:prod -- --url <authorized-url>` only when the target is known and the smoke is read-only.

GitHub CI runs unit/contract tests, browser coverage, typechecks, Worker compile, Web build, an ephemeral PostgreSQL authority suite, and a local health smoke. The optional Production E2E job is manual and is not a required PR check.

## 6. Pull requests

- Keep commits reviewable and use a Draft PR while evidence is incomplete.
- Describe source SHA, changed contracts, migrations, rollout order, rollback, tests, and unverified claims.
- Database expansion must deploy before application code that depends on it.
- Security fixes should be isolated from documentation and feature work.
- Do not merge solely because CI is green; verify approval, release authority, migration order, and target environment.

## 7. Deployment topology and release order

Current repository-backed topology:

- Vercel runs the Next.js Web/API deployment.
- Railway builds `infra/docker/Dockerfile.worker` and runs the BullMQ/FFmpeg background Worker through `railway.toml`.
- Supabase provides PostgreSQL, Auth, and Storage.
- Redis-compatible infrastructure backs BullMQ.
- LOCAL_GPU is a separate Desktop Worker/ComfyUI boundary using signed V2/V3 contracts; it is not the Railway Worker.
- No Cloudflare application Worker deployment is configured in current main. Cloudflare may appear in networking comments or upstream infrastructure, which is not an EmberOS runtime deployment claim.

Safe release order:

1. Additive database migration and policy/grant verification.
2. Backward-compatible Worker release.
3. Backward-compatible Web/API release.
4. Read-only version and health verification.
5. Bounded smoke or separately authorized E2E.

Record deployed revisions from the platform; do not infer them from a merged PR. Preserve the last healthy revision and migration rollback/forward-recovery plan.

## 8. E2E evidence classes

| Evidence | What it proves | What it does not prove |
| --- | --- | --- |
| Unit/contract fixture | Serialization, validation, authorization logic | Live infrastructure or model quality |
| Ephemeral PostgreSQL integration | Schema/policy behavior on disposable Postgres | Production catalog state |
| Preview/Staging E2E | That isolated environment at a named revision | Production readiness |
| Production smoke | Bounded read-only reachability/health | Full Worker processing or paid/GPU quality |
| LOCAL_GPU fake-Comfy E2E | Signed transport, node mapping, upload/result logic | Real GPU execution |
| Controlled real-GPU E2E | One named artifact through the authorized path | General model quality or unlimited readiness |
| Historical Golden/Manual E2E | The recorded revision and environment | Current-main or current-runtime health |

Never rerun a paid or GPU operation merely because historical evidence is inconvenient. Reuse valid evidence and propose the minimum missing check.

## 9. Troubleshooting

| Symptom | Inspect first |
| --- | --- |
| Web healthy, jobs not moving | Queue depth, Railway deployment/logs, Worker heartbeat, Redis prefix, contract compatibility |
| Authenticated data missing | Session, workspace membership, RLS policy, grants, server/service-role path |
| Cross-workspace concern | Direct/indirect CRUD, nullable tenant keys, joins, signed token scope, storage prefix |
| LOCAL_GPU unavailable | Desktop `/health`, signature clock, V2/V3 version, ComfyUI health; do not restart without authority |
| Provider blocked | Runtime enablement, authorization, approval freshness, Pre-QC, capability, idempotency, budget |
| Migration conflict | Applied history, predecessor schema, migration intent, forward repair; never edit an applied file |

## 10. Operational prohibitions

- Never test destructive tenant isolation on customer data.
- Never disable RLS or broaden grants to make a test pass.
- Never expose service-role keys to the browser.
- Never silently fall back to a paid provider or less capable workflow.
- Never treat a skipped optional E2E as a pass.
- Never claim Production, Worker, Desktop, or E2E health without named runtime evidence and a revision.
