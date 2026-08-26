# EmberOS Wave 3 Create Campaign Contract

Authority: `EMBEROS-BLUEPRINT-V1.3-UI-AUTHORITY-2026-08-25`

Wave 3 replaces the legacy stacked Create Campaign form with one five-step flow:

1. Campaign Name
2. Objective, Publishing Platforms, and Target Audience
3. Workspace Assets and Asset Stories
4. optional Campaign Brief
5. Review and Create

## Authority boundaries

- The Blueprint owns the presentation and step sequence.
- `CreateCampaignContextSchema` owns request validation and canonical identifiers.
- Business Profile owns initial Default Publishing Platforms. Per-Campaign edits do not update the Profile.
- Workspace Asset Library owns uploaded binaries. Campaigns retain references only.
- Main's Campaign run service owns task identity, source fingerprinting, commercial/runtime checks, and queue handoff.
- AI suggestions are proposals. Only an explicit human Accept changes Wizard state.
- Output/subtitle language, Voice, BGM, Content Style, and other downstream generation controls are absent from Create Campaign. Inferred language is read-only.

## Create and replay

The final command uses a Workspace-scoped UUID idempotency key. The repository acquires a transaction advisory lock, creates or reuses one Campaign, validates same-Workspace Asset and Asset Story references, and freezes the reference set. It then invokes main's existing idempotent Campaign run service. An ambiguous client response is safely replayable with the same key.

Incomplete step navigation is retained only in browser session storage. It does not create a server-side Campaign draft.

## Preserved contracts

Wave 3 does not change AI Story execution/review/recovery/product grounding, Video Studio V1, Photo Scene V1, private signed-media delivery, commercial authorization, provider attempt/cost accounting, or tenant/workspace authorization semantics. Campaign Workspace migration remains Wave 4 scope.
