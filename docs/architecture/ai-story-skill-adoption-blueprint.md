# EmberOS AI Story Skill Adoption Blueprint

Status: Writer/Outline authority implemented; downstream layers remain future work

Authority: `EMBEROS-AI-STORY-SKILL-ADOPTION-BLUEPRINT-01`

Writer implementation: `EMBEROS-AI-STORY-WRITER-OUTLINE-AUTHORITY-CONTRACT-01`

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
  -> FUTURE SCRIPT
  -> FUTURE DIRECTOR
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

## Future Script boundary

Script will claim Writer Beats and define typed Scene narrative authority in a
separate ticket. This implementation does not add ACTION/DIALOGUE/VO sequences,
Scene Functions, Scene state, Script-to-Director handoff, Director Visual Roles,
Shot Purposes, Motion planning, Shot Recipes, or Provider enrichment.

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
