# EmberOS Wave 1 Asset Authority

Ticket: `EMBEROS-STAGING-MAIN-HYBRID-MIGRATION-WAVE-1-ASSET-LIBRARY-AND-ASSET-STORY-01`

Blueprint baseline: `EMBEROS-BLUEPRINT-V1.3-UI-AUTHORITY-2026-08-25`

## Ownership

- Workspace Asset Library owns reusable private Asset identities and storage objects.
- Campaigns reference same-Workspace Assets through `campaign_asset_refs`; the legacy `assets.campaign_id` remains a nullable compatibility origin and no existing Asset ID is rewritten.
- Asset Stories own ordered references to Workspace Assets. They do not own duplicate binaries.
- Creative Assets is a creation/presentation surface. Photo Scene consumes and produces Workspace-authorized Assets without becoming an ownership domain.
- AI Story retains Campaign Product Asset authority and consumes the resolved Campaign reference set through its existing product-grounding contracts.

## Identity and storage

An Asset identity consists of its stable UUID, Organization and Workspace, private storage object key, canonical `sha256:` content hash, MIME, byte size, source, display metadata, lifecycle status and creator/timestamps. Signed delivery URLs are ephemeral responses only; they are neither stored nor logged.

The same binary may have distinct identities in different Workspaces. Dedupe discovery is scoped to Organization + Workspace and never reveals a foreign Asset. A repeated upload currently remains a distinct durable Asset and records a same-Workspace duplicate hint after server-side byte hashing.

## Asset Story

Asset Story supports create, read, version-checked edit, ordered Asset references, a cover drawn from the ordered set, draft/ready/archived status and guarded archival. Cross-tenant and cross-Workspace references are blocked by repository checks and database triggers.

## Compatibility and freeze boundaries

- Historical Campaign Assets retain their IDs and storage paths.
- Campaign media resolution combines reference records, Ready Asset Stories and legacy Campaign-owned rows.
- AI Story Provider, release, review, retry/recovery and product-grounding implementations are unchanged.
- Video Studio input capsules, fingerprints, hashes and private output delivery are unchanged.
- Photo Scene execution semantics are unchanged.
- Asset auto-name/intelligence is deferred; Wave 1 performs no AI Provider call.
- Create Campaign, Business Profile and Campaign Workspace migrations have not started.

## Staging evidence

The UI and lifecycle concepts were evaluated at `origin/staging@0add4c65aed02433aeeb96dfb943e4e3fbc075c8`. No Staging commit was merged or cherry-picked and no source file was copied verbatim; the capability was independently adapted to current main contracts.
