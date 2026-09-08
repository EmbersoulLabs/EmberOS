# Creative Image / Creative Studio / AI Story Ownership V1

> Canonical architecture freeze for the certified V1 image-ownership boundary.
> Chat history is not authority. This document records the implementation certified by
> `EMBEROS-CREATIVE-IMAGE-AND-AI-STORY-OWNERSHIP-FINAL-CERTIFICATION-01`.

Status: `FROZEN_FOR_V1` / `CERTIFIED_PASS`

Date: 2026-09-08

Certified staging revision: `bc5298e2df45e10fd344a0c9b752f730f370cee4`

Certified implementation lineage: PR #105, PR #106, PR #107, PR #108, PR #109

## 1. Ownership principle

The V1 boundary is:

- **AI Story owns what narrative image is required.**
- **Shared Creative Image Execution owns how generative image Provider execution occurs.**
- **Creative Studio / Photo Scene owns its product workflow.**

No duplicate generative image Provider execution authority is permitted.

## 2. Product identity

`PHOTO_SCENE_V1 == CREATIVE_STUDIO_V1`

Photo Scene is the canonical user-facing Creative Studio V1 product. Creative Studio is
an architecture synonym for the same module family. A parallel Creative Studio product
is forbidden.

Shared Creative Image Execution is an **internal capability**. It is not:

- a SaaS product;
- a second Creative Studio;
- Creative Studio V2;
- an AI Background Generator; or
- a replacement for Photo Scene.

## 3. Creative Studio / Photo Scene ownership

Creative Studio / Photo Scene V1 owns:

- product-source selection and upload workflow;
- background removal and product extraction;
- the official Scene library;
- deterministic product placement;
- deterministic marketing-image composition;
- Campaign asset finalization and binding; and
- product-workflow retry and recovery.

Current V1 generative image Provider ownership: **NONE**.

PhotoRoom background removal is intentional product-specific extraction. It produces a
transparent product asset and is not generic reference-conditioned image generation.
It does not duplicate Shared Creative Image Execution.

Photo Scene does not own AI Story narrative intent, Narrative World State, Narrative
Keyframe Briefs, Story continuity, Narrative QC, or Seedance Provider Policy.

## 4. Shared Creative Image Execution ownership

Canonical namespace: `packages/agents/src/creative-image/`

Shared Creative Image Execution owns:

- `CreativeImageGenerationInput`;
- `CreativeImageGenerationOutput`;
- `CreativeImageGenerationAdapter`;
- `CreativeImageExecutionAuthorization`;
- `CreativeImageExecutionService`;
- `OpenAiCreativeImageGenerationAdapter`;
- generation-side OpenAI SDK construction;
- the `gpt-image-2` generation model configuration;
- the canonical `images.edit` invocation;
- generic Provider execution and result normalization; and
- bounded generic Provider errors and sanitized evidence.

Canonical OpenAI generative image implementation count: **1**.

The shared capability does not own Narrative World State, Story Scene semantics, Human
Review decisions, Story retry semantics, Seedance eligibility, Creative Studio product
workflow, UI, or navigation.

## 5. AI Story ownership

AI Story owns:

- Latest Authority Wins;
- Active Scene Intent;
- Narrative World State;
- Scene Input Preparation and compatibility;
- the Narrative Keyframe Brief;
- narrative prompt compilation;
- narrative keyframe capability certification;
- narrative visual QC and the `gpt-4o` QC evaluator;
- prepared keyframe persistence and promotion;
- supersession;
- Provider Policy Eligibility; and
- Story-to-video execution authority.

AI Story generative image Provider ownership: **NONE**. Direct `images.edit` calls and
AI Story-owned generation Provider adapters, SDK factories, or model configuration are
forbidden.

Narrative QC remains an AI Story domain responsibility. OpenAI use by
`OpenAiSceneKeyframeQcAdapter` is narrative visual judgement, not generative image
execution, and is not duplicate Provider ownership.

## 6. Canonical keyframe call graph

```text
Active Intent / World State
  → Scene Input Preparation
  → Narrative Keyframe Brief
  → Scene keyframe execution identity
  → repository reuse
  → persisted keyframe paid authorization verification
  → AI Story → Creative Image request translation
  → Creative Image authorization projection
  → CreativeImageExecutionService
  → Creative Image Provider adapter
  → provider-neutral result
  → AI Story Narrative QC
  → prepared asset persistence
  → Provider Policy Eligibility
  → video execution eligibility
```

Repository reuse must remain before paid image execution. The canonical AI Story
runtime must not invoke a generation adapter directly.

## 7. Authorization boundary

`ai-story-keyframe-paid-authorization.v1` is AI Story-owned domain authority. It
authorizes exactly one paid keyframe **image-generation** call for the frozen scope.

- `maximumImageProviderCalls`: `1`
- `authorizedBy`: persisted authenticated actor
- `authorizedAt`: persisted authority timestamp
- scope: org, workspace, Story, Scene, Scene Version, preparation, brief, Provider, and
  model bindings
- Narrative QC: separately authorized and outside the image-generation allowance

Shared Creative Image Execution receives the projected generic authorization. It does
not create AI Story domain authority and does not own commercial pricing, charging,
entitlement, or budget authority.

## 8. Asset authority

Canonical image asset authority remains:

- `assets`;
- `campaign_asset_refs`;
- `ai_story_asset_links`;
- `contentHash`;
- `storagePath`; and
- lineage metadata.

Do not create parallel image asset models such as `creative_assets`, `ai_story_images`,
or `ai_background_assets`.

`ai_story_keyframe_paid_authorizations` persists execution authority. It is not image
storage or a parallel asset model.

## 9. Provider Policy boundary

`SCENE_READY != PROVIDER_EXECUTABLE`

Provider Policy Eligibility remains AI Story-owned. Successful Shared Creative Image
generation must never bypass downstream video Provider policy.

Current Scene 2 is certification evidence, not a generic architecture identifier:

- Scene-ready: **YES**
- Visual/Narrative QC: **PASS**
- Seedance raw signed-URL eligible: **NO**
- Provider executable: **NO**
- Reason: `HUMAN_PORTRAIT_PRIVACY_PRECHECK`

Scene-specific IDs are deliberately excluded from the generic ownership rule.

## 10. Cross-industry rule

The boundary is industry-neutral and applies to florist, café, restaurant, e-commerce
product, pet, service-business, and other Scene domains:

- AI Story decides narrative requirements;
- Shared Creative Image Execution performs generic generative image execution;
- Creative Studio owns its independent image-product workflow; and
- Provider Policy decides downstream video eligibility.

No industry-specific Provider ownership is permitted.

## 11. Future Creative Studio rule

If Creative Studio later adds AI custom backgrounds, generative Scene composition,
generative fill, reference-conditioned image generation, OpenAI image generation,
Flux, Gemini image generation, or another generative image Provider, it **must** consume
Shared Creative Image Execution and **must not** create a parallel Provider stack.

Creative Studio continues to own the product workflow. Provider execution remains
shared. Current deterministic Photo Scene composition and product-specific background
removal may remain local to Photo Scene.

## 12. Durability limitation

`CreativeImageExecutionService` process-local state does not certify durable
cross-process exactly-once execution. Repository reuse protects already-committed
keyframes.

Known crash window:

```text
Provider succeeds
  → process crashes before prepared asset commit
```

Classification: `KNOWN NON-REGRESSION DURABILITY LIMITATION`.

This limitation does not reopen the ownership architecture. A future durable execution
ledger requires separate evidence, architecture authority, and implementation
authorization.

## 13. Change control

This ownership architecture is **FROZEN FOR V1**.

Do not reopen it for ordinary fixes, Provider enablement, or Provider/model additions.
A future change requires contradictory evidence or an explicit architecture-change
ticket. Provider/model additions alone do not justify moving generative Provider
ownership back into AI Story or Creative Studio.
