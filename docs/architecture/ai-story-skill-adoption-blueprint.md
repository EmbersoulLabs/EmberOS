# EmberOS AI Story Skill Adoption Blueprint

Status: Writer/Outline, Script, immutable Script-to-Director handoff, and Director visual authority implemented; Motion remains future work

Authority: `EMBEROS-AI-STORY-SKILL-ADOPTION-BLUEPRINT-01`

Writer implementation: `EMBEROS-AI-STORY-WRITER-OUTLINE-AUTHORITY-CONTRACT-01`

Script implementation: `EMBEROS-AI-STORY-SCRIPT-SCENE-BEAT-CONTRACT-01`

Script-to-Director handoff implementation: `EMBEROS-AI-STORY-SCRIPT-DIRECTOR-HANDOFF-CONTRACT-01`

Director implementation: `EMBEROS-AI-DIRECTOR-SCENE-FUNCTION-AND-DIFFERENTIATION-CONTRACT-01`

## Certified invariants

Every future creative layer remains upstream of and must preserve:

- human review and Scene-by-Scene staged release;
- no automatic paid retry and the existing maximum-attempt policy;
- immutable Provider Attempt and cost facts;
- Campaign Product authority, grounding conflict gates, and `FIRST_FRAME_I2V`;
- private signed media and generated Scene Result binding;
- commercial authorization and tenant/workspace isolation.

## Canonical authority flow

```text
CAMPAIGN / USER BRIEF
  -> STORY VERSION
  -> WRITER OUTLINE
  -> OUTLINE VALIDATION
  -> HUMAN APPROVAL
  -> OUTLINE FREEZE
  -> SCRIPT VERSION
  -> SCRIPT VALIDATION
  -> HUMAN APPROVAL
  -> SCRIPT FREEZE
  -> IMMUTABLE SCRIPT-TO-DIRECTOR HANDOFF
  -> DIRECTOR PLAN
  -> DIRECTOR VALIDATION / HUMAN APPROVAL / FREEZE
  -> FUTURE MOTION
  -> PROVIDER ADAPTER
```

Writer owns premise, core claim, optional Story Units, ordered major/minor Beats,
Beat ownership policy, declared Hooks, setup/payoff relationships, semantic
required Scene outcomes, profile selection, and stable authority references.
Writer does not own camera, lens, framing, blocking, shots, physical motion,
Provider syntax, dispatch, retry policy, or generated-media acceptance.

## Implemented Outline authority

`AiStoryOutlineVersion` is provider-neutral and versioned. Its lineage binds the
Story, Story Version, organization, Workspace, upstream authority identity,
contract/profile versions, superseded Outline, and a canonical SHA-256 source
fingerprint. The `CORE` profile is the only implemented profile.

Lifecycle:

```text
DRAFT -> VALIDATED -> APPROVED -> FROZEN -> SUPERSEDED
```

Validation is deterministic. Approval is human authority; AI output is never
automatically approved. Frozen content has no mutation operation. Changes create
a new version and preserve the superseded frozen version.

Implemented gates:

- Outline and authority-reference integrity;
- Beat ID uniqueness and deterministic ordering;
- Story Unit references;
- Hook binding;
- setup/payoff references and setup-before-payoff ordering;
- profile references;
- freeze mutation boundary.

Historical AI Stories remain readable through a compatibility projection with
no silent Outline materialization.

## Implemented Script authority

`AiStoryScriptVersion` is the provider-neutral authority for what happens in a
Scene. It binds the exact frozen Outline and source hash, owns stable ordered
Script Scenes, explicit exclusive/splittable Beat claims, versioned semantic
Scene Functions, typed state deltas, ordered ACTION/DIALOGUE/VO entries,
duration ranges, authority references, information/evidence/action deltas, and
must-keep/must-avoid constraints. Its lifecycle is:

```text
DRAFT -> VALIDATED -> APPROVED -> FROZEN -> SUPERSEDED
```

Deterministic gates cover Outline lineage, Beat cardinality, stable references,
visible action, dialogue/VO owners, timing feasibility, state continuity, and
duplicate story work before Director. Historical dialogue and Scene Plan data
remain compatibility-only; no Script is silently materialized for legacy or R4
Stories.

## Implemented Script-to-Director boundary

Script does not own camera, lens, framing, shot size, blocking execution,
camera movement, visual roles, shot purposes, physical motion paths, Provider
syntax, retry, or execution. `AiStoryScriptDirectorHandoff` is an immutable,
versioned projection created only from a frozen Script. It preserves exact Scene
identity/order, Beat claims, Scene Functions, state truth, ACTION, DIALOGUE, VO,
authority references, duration, information/evidence/action outcomes, and
must-keep/must-avoid constraints. Exact Script lineage, a source hash, and a
canonical content fingerprint make mutation, mismatch, and stale handoffs hard
failures. Product bindings retain the existing Product/asset identity and exact
source content hash; they do not duplicate Product authority.

Legacy Director Thinking, Scene Plan, Shot Plan, and Animation Package inputs
remain compatibility-only for historical Stories. They do not outrank a
canonical handoff or Director Plan.

## Implemented Director authority

`AiStoryDirectorPlan` is versioned, durable, provider-neutral authority for how
the immutable handoff is visually realized. It owns semantic Scene Visual Role,
Shot Purpose and size, camera intent/family, focus and progression, composition,
Product emphasis, new audience information, high-level blocking intent, and an
explicit differentiation requirement. Its lifecycle is `DRAFT -> VALIDATED ->
APPROVED -> FROZEN -> SUPERSEDED`; frozen content is immutable.

Director context is open-semantic: it is derived from frozen Script action,
state, authority references, evidence, and preservation constraints. Core has
no Product-category, Product-action, or Product-scene allowlist. Namespaced
semantic registry extensions allow new visual treatments without changing Core.
Deterministic gates reject invented Script action, unknown focus/Product
authority, unsafe identity-threatening camera treatments, stale lineage, and
materially duplicate visual realizations without a new action, evidence,
information, composition, or context delta. Camera-family reuse alone is never
duplication. Motion execution, Shot Recipes, and Provider enrichment remain
unimplemented.

## Implementation sequence

1. `EMBEROS-AI-STORY-WRITER-OUTLINE-AUTHORITY-CONTRACT-01`
2. `EMBEROS-AI-STORY-SCRIPT-SCENE-BEAT-CONTRACT-01`
3. `EMBEROS-AI-STORY-SCRIPT-DIRECTOR-HANDOFF-CONTRACT-01`
4. `EMBEROS-AI-DIRECTOR-SCENE-FUNCTION-AND-DIFFERENTIATION-CONTRACT-01`
5. `EMBEROS-AI-STORY-MOTION-ACTION-STATE-AND-PRODUCT-CAUSALITY-CONTRACT-01`
6. `EMBEROS-AI-STORY-PRE-GENERATION-DIRECTOR-QC-GATES-01`
7. `EMBEROS-AI-STORY-PRODUCT-STORY-WRITER-PROFILE-01`
8. `EMBEROS-AI-STORY-SHOT-RECIPE-REGISTRY-01`
9. `EMBEROS-AI-STORY-SEEDANCE-DIRECTOR-ADAPTER-ENRICHMENT-01`
10. `EMBEROS-AI-STORY-SHORT-DRAMA-WRITER-PROFILE-01`
