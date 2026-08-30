# EmberOS Hybrid Migration Authority and Guards

Status: Wave 0 authority policy, version 1.0.0
Blueprint baseline: `EMBEROS-BLUEPRINT-V1.3-UI-AUTHORITY-2026-08-25`

## Authority model

- `origin/main` is the only code source of truth.
- The pinned Blueprint baseline is product and UI authority.
- Staging is an environment and a selective migration source, not an independent product line.
- Production is a promoted canonical release from main.
- Certified main runtime, security, tenant, provider, accounting, Video Studio V1, and Photo Scene V1 behavior cannot be replaced by older Staging implementations.
- Broad Staging merges, resets, and undifferentiated directory copies are prohibited.

The Blueprint snapshot is reproducible through local annotated tag `EMBEROS-BLUEPRINT-V1.3-UI-AUTHORITY-2026-08-25`, snapshot commit `4a32f60553f0e5e13314997591e296dacca81727`, and tree `5dd08f730ece63beaf5352589670f85d15a8674c`. Its exact SHA-256 allowlist and exclusions are recorded in the adjacent JSON manifest. The tag is intentionally local; no Blueprint remote push occurred.

## Module authority matrix

| Module | Product/UI authority | Runtime/business authority |
|---|---|---|
| Workspace | Blueprint/Staging-approved shell and navigation | main |
| Asset Library | Blueprint plus selected Staging capability | main tenant/storage contracts |
| Create Campaign | Blueprint-approved five-step Staging UX | main APIs and campaign contracts |
| Business Profile | Blueprint/Staging UI | main data and authorization logic |
| Campaign Workspace | Hybrid | main |
| AI Story | Blueprint normal-user UI | certified main runtime only |
| Video Studio | Blueprint UI constraints | main certified V1 |
| Photo Scene | Blueprint UI constraints | main certified V1 |

## Mandatory migration intent

Beginning with Wave 1, every migration must provide a JSON intent conforming to [the migration intent schema](../../schemas/hybrid-migration-intent.schema.json). The declaration names the ticket, wave, source authority, target module, allowed source and target paths, protected domains expected or forbidden to change, required regression suites, reason, and Blueprint baseline.

Every changed file must be classified as one of `UI_PRESENTATION`, `CLIENT_STATE`, `TYPED_CLIENT_CONTRACT`, `API_CONTRACT`, `PERSISTENCE`, `CERTIFIED_RUNTIME`, `SECURITY`, or `INFRASTRUCTURE`. Unknown files fail closed.

## Protected domains

The executable manifest protects AI Story runtime/review/staged release/retry/product grounding/private media, Video Studio V1, Photo Scene V1, private media delivery, authorization, entitlements, commercial authorization, platform administration, tenant/workspace isolation, Provider attempt/cost accounting, and production region/database safety.

Protection is behavioral: a bounded correctness change may declare a protected domain, but must name its reason, ticket, and mapped regression suites. A declaration without the suites fails. The complete path and suite map lives in `config/hybrid-migration-guards.json`.

## Wave scope

1. Asset Library and Asset Story only.
2. Business Profile only.
3. Create Campaign only.
4. Campaign Workspace shell only.
5. AI Story normal-user UI cleanup only; certified runtime remains main-owned.
6. Source/environment parity and certification only.

No later-wave feature is implemented by an earlier wave.

## AI Story Skill freeze

New Writer/Outline, Script Version, Scene Function, `sceneVisualRole`, `shotPurpose`, Motion Planner, Shot Recipe, Genre Profile, and generation-strategy-router architecture is blocked until Wave 6 passes. Existing production correctness and security repairs remain possible through explicitly bounded protected-domain declarations.

## Release parity target

Wave 6 certification requires:

- `STAGING_REVISION == RELEASE_CANDIDATE_REVISION`
- `PRODUCTION_REVISION == PROMOTED_RELEASE_REVISION`
- both revisions originate from the same promoted canonical main history.

The guard is executed with:

```text
pnpm verify:hybrid-migration -- --base <base> --head <head> --intent <intent.json>
```

There is no disable flag. Any protected change must be explicit and evidence-backed.
