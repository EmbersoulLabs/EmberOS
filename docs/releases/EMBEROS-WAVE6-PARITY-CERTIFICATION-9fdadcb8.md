# EmberOS Wave 6 parity certification — 9fdadcb8

Status: **BLOCKED / NOT CERTIFIED**

Ticket: `EMBEROS-STAGING-MAIN-HYBRID-MIGRATION-WAVE-6-STAGING-MAIN-PRODUCTION-PARITY-CERTIFICATION-01`

Evidence date: 2026-08-27 (Asia/Singapore)

This is a release-governance evidence artifact. It does not alter the Release Candidate source tree or any product/runtime behavior.

## Authority

- Blueprint baseline: `EMBEROS-BLUEPRINT-V1.3-UI-AUTHORITY-2026-08-25`
- Code authority: `origin/main`
- Release Candidate SHA: `9fdadcb8ccb4d1b7c181cd94cfe3af0f7cabd414`
- Release Candidate tree: `53a9fd71e764574d9353f2390841bd34781fc096`
- Legacy staging branch: `0add4c65aed02433aeeb96dfb943e4e3fbc075c8`, retained only as migration evidence

## Release gates

- Main CI run: `32981137583` — PASS
- Unit, Wave 1–5 browser E2E, typecheck, Web build, and ephemeral PostgreSQL authority — PASS
- Worker build — PASS
- Hybrid migration guard — PASS
- Waves 0–5 ancestry — PASS

## Staging deployment

- Deployment ID: `dpl_5gwHKRMe8mjfF8tXZ2TigTgHnHzH`
- Deployment URL: `https://emberos-kuyxhq2yz-kahliantoo-8279s-projects.vercel.app`
- Stable Staging alias: `https://emberos-git-staging-kahliantoo-8279s-projects.vercel.app`
- Source/build/runtime revision: `9fdadcb8ccb4d1b7c181cd94cfe3af0f7cabd414`
- Health: PASS; Web, Supabase, database, and Redis configured
- Provider calls: 0

## Production deployment

- Existing Web deployment ID: `dpl_s1adrgkKrLqfxRBveg6sheqATPb2`
- Runtime/health revision: `9fdadcb8ccb4d1b7c181cd94cfe3af0f7cabd414`
- Worker deployment ID: `182d3b0c-7e74-4b40-989b-7d1f9e9f21ea`
- Production remained unchanged during Wave 6 because Staging certification did not complete.
- Provider calls: 0

## Environment contract

- Required Preview Web variables are present.
- `NEXT_PUBLIC_APP_URL` was added for Preview using the stable Staging origin.
- Production-only paid-provider variables remain an intentional environment-specific difference; no provider execution is authorized in Staging certification.
- Environment contract: PASS.

## Deployment governance

- Vercel production branch remains `main`.
- The project ignored-build rule is `[ "$VERCEL_GIT_COMMIT_REF" = "staging" ]`.
- This prevents the legacy `staging` branch from independently auto-deploying while preserving canonical main and pull-request deployments.
- Canonical flow: main → exact RC SHA → protected Staging → certification → Production promotion.

## Certification blocker

The available operator credentials do not include a read-only connection to Supabase Staging project `voofxbuzpocyjzoxrpfi`, and the approved Production E2E identity is not valid in that Staging Auth project. Vercel sensitive environment values are intentionally non-exportable. Consequently:

- exact Staging ↔ Production schema metadata parity could not be proven;
- authenticated Staging product-surface smoke could not be completed;
- equivalent-role Staging ↔ Production UI parity could not be certified.

No user was created, no password was reset, no database was changed, Preview protection was not weakened, and Production was not promoted after this blocker.

## R4 safety

- Scene 1: Attempt 1 `SUCCEEDED`, review `APPROVED`
- Scene 2: Attempt 1 `SUCCEEDED` / `REJECTED`; Attempt 2 `SUCCEEDED` / `PENDING_REVIEW`
- Scene 3: `AUTHORIZED_NOT_RELEASED`, 0 attempts
- R4 provider calls: 0
- R4 creative mutations: 0
- R4 cost change: USD 0.00

## Required bounded remediation

Provide one authorized, read-only Staging schema credential and one existing non-mutating Staging test identity, then rerun this Wave 6 certification from the same or a newer canonical `origin/main` RC. Do not create a test user or mutate Staging data as part of the certification rerun.
