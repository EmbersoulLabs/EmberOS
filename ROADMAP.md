# EmberOS Delivery Roadmap

This roadmap describes the current release boundary. For architecture, setup, and live-status evidence, start with [README.md](./README.md). Historical milestone documents remain under `docs/`; they are not proof that a capability is deployed or enabled.

Status meanings:

- **Deployed**: the named revision has successful deployment metadata and a bounded smoke or health result.
- **Verified**: deterministic tests or recorded certification evidence exist for the stated boundary.
- **Partial**: implementation exists, but a release, runtime, or end-to-end gate remains.
- **Blocked**: a required safety or capability prerequisite is missing.
- **Planned**: no completed implementation is claimed.

## Current release state

| Area | Status | Evidence and boundary |
| --- | --- | --- |
| Web/API | Deployed | Vercel Production deployment and `/api/health` report revision `9e937efa67aa3b0edb41d4ab9f5b8337b7f4f4c1`. A web health response is not Worker or provider certification. |
| Background Worker | Deployed, health partially verified | Railway Production deployment metadata reports the same revision. Job processing health still requires Railway logs/heartbeat evidence; the Web health endpoint only reports queue depth. |
| Video Studio V1 | Verified, frozen | Bounded render/review/export implementation and regression coverage exist. Do not expand its scope through unrelated work. |
| Photo Scene V1 | Verified, frozen | Product extraction, official scene selection, composition, signed delivery, retry, and campaign binding are implemented. |
| Campaign Marketing and Social Content | Partial | Versioned plans, handoffs, reviews, drafts, AI budget claims, and isolation tests exist. Open migration/model work must remain behind its database-first rollout order. |
| AI Story planning and authority | Verified in code/tests | Canonical revisions, Scene/Director/Motion plans, Character/Product authority, Pre-QC, scheduling, Post-QC, review, assembly, and commercial controls exist. Runtime enablement is authority- and environment-specific. |
| AI Story commercial production | Partial / release-gated | Self-use and bounded certification evidence exist, but public commercial readiness and a fresh actual-advertisement production run are not established by source or CI alone. |
| LOCAL_GPU V2/V3 | Verified offline; runtime partial | Signed R2V/T2V contracts, H3 prompt mapping, reference hashes, upload bindings, and fail-closed capabilities are tested. Desktop H3 source is at `3b04b5fe6874cba21fa34805cbd2705f13e869eb`; its default branch remains the older baseline and local ports were not listening during the 2026-10-16 audit. |
| Tenant isolation | Partial | Current Drizzle schema declares 153 tables and SQL contracts enable RLS on 109 distinct tables. Focused static/unit isolation tests pass, but Production catalog grants/policies were not read back and the legacy `usage_records` table has no RLS contract in current source. |

## Release-critical work

1. Review and resolve the `usage_records` exposure ambiguity in a separate security PR: establish its intended access model, add an additive RLS/GRANT contract if client roles can reach it, and test SELECT/INSERT/UPDATE/DELETE denial across workspaces.
2. Add a catalog-based F3 suite on disposable PostgreSQL that enumerates every application table and validates RLS, grants, policies, nullable tenant keys, and cross-workspace CRUD. Keep server-only and global tables on an explicit allowlist.
3. Bring the Desktop H3 branch through review/default-branch integration and perform a no-generation health/capability check before any single authorized real-GPU certification.

## Product backlog

### In progress or gated

- Production-grade AI Story commercial cutover, including current release evidence and human review readiness.
- OpenAI model-policy migration in Draft PR #218; no live quality claim exists.
- Successor Motion authority validation in PR #224.
- Documentation reconciliation in the current Draft PR.

### Blocked until separately authorized

- Exact acoustic voice cloning or voice consistency. Descriptive Voice DNA is not an acoustic guarantee.
- Unsupported continuity, audio, first-frame, or workflow requirements. These must fail closed.
- Paid-provider or real-GPU quality certification without an explicit bounded authorization.
- Any Production data mutation used only to prove isolation.

### Planned

- Direct social-platform OAuth publishing, scheduling, and analytics feedback loops.
- Broader SaaS billing/plan activation.
- General-purpose long-form/timeline editing beyond the frozen Video Studio boundary.
- Broader automated media-aware QC while retaining mandatory human review.

## Historical milestones

The original W1–W16 plan delivered the monorepo foundation, authentication, workspace/campaign flows, agents, BullMQ Worker, FFmpeg pipeline, review, portal, exports, CI, and deployment manifests. It is retained in Git history and earlier planning documents. It must not be used as current deployment or E2E evidence.

## Verification commands

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm --filter @ceo-agent/worker typecheck
pnpm --filter @ceo-agent/web build
```

`pnpm test:integration` mutates its selected database and therefore requires a disposable PostgreSQL target plus the repository's explicit test-identity guards. The optional Production E2E workflow is manual, may create records or incur cost, and is not a normal release check.
