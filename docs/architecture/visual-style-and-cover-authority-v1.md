# Visual Style and Cover Authority V1

## Ownership map

| Concern | Existing owner | V1 integration |
| --- | --- | --- |
| AI Story identity/version | `ai_stories` and immutable `ai_story_versions` | `VisualAuthorityStoryBinding` binds both authorities to one Story Version without changing story persistence. |
| Character continuity | AI Story creative context and character continuity | Remains a separate identity constraint with highest precedence. |
| Product identity | Scene execution `productIdentityConstraints` | Remains a separate identity constraint and overrides style preferences. |
| Brand identity | Workspace/business brand profile and Asset references | Remains a separate identity constraint and overrides style preferences. |
| Workspace media | Workspace-owned `assets`, campaign/story reference tables | Visual lineage stores Asset IDs only; it does not create or duplicate media. |
| Photo Scene | Roadmap only; no runtime authority exists on this branch | `photo_scene` lineage reuses a workspace Asset ID and `{workspaceId}/` storage path. No future Photo Scene architecture is copied forward. |
| Rendering | Shared render profiles and execution contracts | Authorities describe provider-neutral semantics only; they do not invoke providers or renderers. |
| AI Story UI | Story review page | Adds a read-only preset and cover-composition preview bound to the loaded Story Version. |

## Authority boundary

`VisualStyleAuthority` owns art direction, palette behavior, lighting, texture,
contrast, rhythm, and negative space. `CoverCompositionAuthority` specializes
that style for aspect ratio, focal placement, text zone, hierarchy, safe area,
and legibility.

Character, Product, and Brand authority are not fields inside style contracts.
`resolveVisualDirection` emits identity constraints in the fixed precedence
order Character → Product → Brand → Visual Style. A strict schema rejects
identity-shaped additions to style preferences.

Both authority contracts use canonical, synchronous SHA-256 semantic
fingerprints. Authority IDs are excluded from semantic fingerprints; workspace,
preset/version, rules, linked style fingerprint, and lineage are included.
Returned registry entries and constructed snapshots are deeply frozen.

## Readiness

`validateVisualAuthorityReadiness` rejects workspace mismatches, non-prefixed
storage paths, pending/rejected sources, absent workspace Assets, fingerprint
tampering, style/cover disagreement, and Story/Version binding mismatch. It is a
pure validation boundary and does not query storage, enqueue work, or call a
provider.

## Vendored design knowledge

Minimal rule summaries and provenance are in
`third_party/design-rules/PROVENANCE.md`. They are documentation snapshots only:
no upstream code, dependencies, executable behavior, or runtime architecture is
vendored.
