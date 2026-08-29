# EmberOS AI Story Skill Adoption Blueprint

Status: Writer/Outline, Script, immutable Script-to-Director handoff, Director visual authority, Motion authority, unified Pre-Generation QC, Product Story Writer profile, semantic Shot Recipe Registry, Campaign Character authority, Story/Scene Cast scope authority, and canonical Scene/Location continuity authority implemented

Authority: `EMBEROS-AI-STORY-SKILL-ADOPTION-BLUEPRINT-01`

Writer implementation: `EMBEROS-AI-STORY-WRITER-OUTLINE-AUTHORITY-CONTRACT-01`

Script implementation: `EMBEROS-AI-STORY-SCRIPT-SCENE-BEAT-CONTRACT-01`

Script-to-Director handoff implementation: `EMBEROS-AI-STORY-SCRIPT-DIRECTOR-HANDOFF-CONTRACT-01`

Director implementation: `EMBEROS-AI-DIRECTOR-SCENE-FUNCTION-AND-DIFFERENTIATION-CONTRACT-01`

Motion implementation: `EMBEROS-AI-STORY-MOTION-ACTION-STATE-AND-PRODUCT-CAUSALITY-CONTRACT-01`

Pre-Generation QC implementation: `EMBEROS-AI-STORY-PRE-GENERATION-DIRECTOR-QC-GATES-01`

Product Story profile implementation: `EMBEROS-AI-STORY-PRODUCT-STORY-WRITER-PROFILE-01`

Shot Recipe Registry implementation: `EMBEROS-AI-STORY-SHOT-RECIPE-REGISTRY-01`

Character authority implementation: `EMBEROS-AI-STORY-CHARACTER-AUTHORITY-AND-CONTINUITY-CONTRACT-01`

Cast scope implementation: `EMBEROS-AI-STORY-SUPPORTING-CAST-AND-EPHEMERAL-ACTOR-SCOPE-01`

Scene and Location authority implementation: `EMBEROS-AI-STORY-SCENE-AUTHORITY-AND-CONTINUITY-CONTRACT-01`

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
  -> OPTIONAL SEMANTIC SHOT RECIPE SELECTION
  -> DIRECTOR VALIDATION / HUMAN APPROVAL / FREEZE
  -> MOTION PLAN
  -> MOTION VALIDATION / HUMAN APPROVAL / FREEZE
  -> PRE-GENERATION QC
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
fingerprint. `CORE` remains the generic baseline and `PRODUCT_STORY` is the
first additive, versioned Writer profile.

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
duplication. Provider enrichment remains unimplemented.

## Implemented Motion authority

`AiStoryMotionPlan` is versioned, durable, provider-neutral authority for how
Script-authorized physical actions and frozen Director intent execute over time.
It binds the exact Script, immutable handoff, and frozen Director fingerprints,
then owns execution-relevant Start State, an ordered open-semantic Action Path,
observable End State, completion assertions, object interaction, conditional
contact/force response, object persistence, blocking execution, camera-motion
execution, focus progression, environmental motion, configurable complexity
budgets, and physical constraints. Its lifecycle is `DRAFT -> VALIDATED ->
APPROVED -> FROZEN -> SUPERSEDED`; frozen content is immutable and approval is
never automatic.

Motion Core contains no Product-category, Product-interaction, or action
allowlist. Unknown actions and Products remain valid when their semantic phases,
causal state transitions, persistence, completion facts, and constraints are
coherent. Deterministic pre-Provider gates reject missing terminal state,
invented Script action, Director binding drift, absent required contact or
force response, Product causality breaks, silent object disappearance,
exclusive-state conflicts, excessive configured complexity, continuity resets,
stale lineage, and fingerprint mismatch. Normal handling, carrying, using, or
wearing a Product is not rejected merely because the Product moves. Provider
syntax, capability mapping, and dispatch remain unimplemented.

## Implemented Pre-Generation QC authority

`AiStoryPreGenerationQcEvaluation` is an immutable, versioned, provider-neutral
decision and evidence artifact. It consumes exact frozen Writer-to-Motion
lineage, canonical Product authority, a certified Provider capability snapshot,
and a provider-neutral Scene execution request. It evaluates the ordered
structural gates before any paid dispatch and produces only
`DISPATCH_ELIGIBLE`, `DISPATCH_ELIGIBLE_WITH_WARNINGS`, or
`DISPATCH_BLOCKED`; it never rewrites creative input, dispatches a Provider,
creates a Provider Attempt, owns billing, or authorizes retry.

Hard gates remain deterministic and contractual. Camera-family repetition,
unknown Product categories, unfamiliar but coherent actions, ordinary Product
movement, and human/Product context do not become hard failures by vocabulary
or category. Subjective quality assistance remains `AI_QC` or
`HUMAN_PREVIEW`. Each failure retains its earliest canonical repair owner,
safe evidence, evaluated artifact identities, gate and policy versions, and a
canonical fingerprint. Superseded upstream authority makes historical QC stale
for dispatch without rewriting its evidence. The additive durable table uses
tenant/workspace RLS and immutable update/delete enforcement.

## Implemented Product Story Writer profile

`PRODUCT_STORY` v1 extends Core without replacing it. Frozen Outline authority
binds the Campaign objective, exact Product authority, semantic progression
goals, claim/evidence relationships, user creative intent, CTA/packshot policy,
and the immutable profile-policy fingerprint. Script Scenes preserve explicit
open-semantic Product contributions through the immutable Director handoff.

The profile requires meaningful information progression and blocks repeated
hero-only display without new information, evidence, action, context, state, or
consequence. It does not prescribe a Scene count, Scene order, Product category,
camera treatment, environment, action vocabulary, CTA, or packshot globally.
Current Campaign objectives determine only bounded requirements; subjective
evidence diversity remains a warning. Unsupported Product claims require repair
at Product/Writer authority rather than invention downstream.

Unified Pre-Generation QC consumes the profile validator and maps deterministic
failures to the existing earliest-owner gates. It does not duplicate QC logic,
silently repair the Story, or change Provider compilation/runtime behavior.
Seedance Director enrichment and the Short Drama profile remain unimplemented.

## Implemented semantic Shot Recipe Registry

The v1 registry contains a bounded Core set: `DETAIL_REVEAL`,
`RELATIONSHIP_COVERAGE`, `USAGE_DEMONSTRATION`, `CONTEXT_SCALE`,
`REACTION_PAYOFF`, and `HERO_REVEAL`. Each immutable version describes semantic
purpose, compatible Director roles/purposes, flexible Shot Size and Camera
Family recommendations, focus/composition/high-level blocking patterns, Motion
complexity, required evidence, constraints, profile compatibility, lifecycle,
and a canonical fingerprint. Recipes contain no Provider prompts or
Product-category policy.

Selection is optional and remains Director authority. An unmatched valid Scene
may use no Recipe. Where selected, the Director Plan binds exact Recipe ID,
version, fingerprint, and Shot IDs; Motion must preserve that identity without
substitution. Pre-Generation QC evaluates the ordered Recipe sub-gates for
existence, version, fingerprint, Director compatibility, canonical evidence,
Motion compatibility, and constraints. Recipe identity alone never determines
duplication, while repeated visual dimensions with a real information delta may
warn. `ACTIVE`, `DEPRECATED`, and `RETIRED` lifecycle states preserve historical
readability and deny new retired selection. Seedance translation remains future
Provider Adapter work.

## Implemented Campaign Character authority

`AiStoryCharacterAuthorityVersion` reconciles Character identity into one
Campaign-owned, provider-neutral domain. A mutable Campaign aggregate points to
immutable versions whose canonical fingerprint covers display name, identity,
appearance, personality, emotional-arc context, stable Character relationships,
optional generic Asset references, status, and lineage. Active Characters are
reusable by multiple Stories in the same Campaign; cross-Campaign references
are denied. Soft deletion preserves exact historical snapshots and prevents
new binding to deleted authority.

Outline and Script references bind the exact Character ID, authority-version
ID, and fingerprint. The immutable handoff preserves those facts; Director and
Motion remain downstream consumers and cannot redefine identity or appearance.
Pre-Generation QC resolves Campaign scope, version, fingerprint, dialogue and
Action participants, relationships, continuity, and optional Asset references.
Character Core remains separate from Story/Scene state, so pose, expression,
location, possession, physical condition, and authorized emotional or
relationship evolution remain Story state rather than silent Core mutation.

The normal-user AI Story Character panel supports Add, Edit, and soft Delete on
desktop and mobile. Visual references are optional pointers into existing Asset
authority; there is no Character binary store, Workspace Character Library, or
cross-Campaign catalog. Legacy Creative Context remains readable as a
compatibility surface. AI Screenwriter output is proposal-only until explicitly
accepted through Campaign Character authority. Character presence does not
force I2V. Seedance Character mapping and Provider reference-limit policy remain
not implemented.

## Implemented Supporting Cast and Ephemeral Actor scope

`AiStoryCastReference` is the typed, provider-neutral identity boundary for
`CAMPAIGN_CHARACTER`, `STORY_SUPPORTING_CHARACTER`, and `EPHEMERAL_ACTOR`.
Scope follows required continuity horizon—not role labels, genre, appearance,
or frequency. Existing Campaign Character authority remains unchanged.

Story Supporting Characters are bounded Story-owned durable aggregates with
stable IDs, immutable versions/fingerprints, Story-local appearance and
continuity facts, typed relationships, and optional references to existing
Asset authority. They may recur after absent Scenes without duplicate identity.
Ephemeral Actors are embedded Scene/execution facts with Scene-local IDs; no
global Actor table or global UI is introduced.

Outline, Script entries, immutable handoff, Director, Motion, and Pre-Generation
QC preserve typed Cast scope and identity. Dialogue, VO, Action, relationships,
Story ownership, Scene ownership, versions, fingerprints, continuity, and
visual references are deterministic gates. Explicit Ephemeral-to-Supporting and
Supporting-to-Campaign promotion preserves lineage; there is no automatic
promotion or demotion and historical references are not rewritten.

`visualIdentityRequirement` is explicit as `NONE`, `PREFERRED`, or `REQUIRED`
for every scope and does not itself select T2V or I2V. Seedance Cast mapping,
Provider reference ordering, and Provider reference-budget allocation remain
not implemented.

## Implemented canonical Scene and Location authority

`AiStoryCanonicalScene` is the durable, provider-neutral boundary between the
frozen Script and downstream visual execution. Its stable `sceneId` is
independent of order; immutable Scene versions bind the exact Story Version,
Script Version, source Script Scene/entries, semantic role and importance,
typed Cast and Product references, typed Location binding, Entry State,
Script-derived events, Exit State, time relation, continuity constraints, and
split/merge/reorder lineage. Script remains sole authority for Scene Function,
Beat claims, ACTION, DIALOGUE, VO, state delta, and required outcome.

Location scope follows continuity horizon through `CAMPAIGN_LOCATION`,
`STORY_LOCATION`, or embedded `EPHEMERAL_ENVIRONMENT`. Campaign and Story
Locations use stable durable IDs, immutable versions/fingerprints, bounded core
continuity facts, and optional references to existing Asset authority.
Ephemeral environments remain Scene-local facts and create no global table.
Names, genres, Scene importance, and examples do not select scope. Explicit
promotion may extend continuity horizon without rewriting prior Scene history;
there is no automatic promotion or demotion.

The atomic Scene-set validator preserves exact Script event coverage, stable
ordering, Location/Cast/Product ownership, Entry-to-Exit continuity, declared
discontinuities, purposeful transitions, and deterministic fingerprints.
Unified Pre-Generation QC binds current frozen Scene-version identities and
denies stale or invalid Scene authority before dispatch. Legacy Scene Plan and
runtime `sceneExecutionId` remain compatibility/execution identities and do not
outrank canonical Scene authority. Location scope and Scene role do not choose
T2V/I2V. Seedance Scene/Location mapping, chaining, and reference budgeting
remain not implemented.

## Implementation sequence

1. `EMBEROS-AI-STORY-WRITER-OUTLINE-AUTHORITY-CONTRACT-01`
2. `EMBEROS-AI-STORY-SCRIPT-SCENE-BEAT-CONTRACT-01`
3. `EMBEROS-AI-STORY-SCRIPT-DIRECTOR-HANDOFF-CONTRACT-01`
4. `EMBEROS-AI-DIRECTOR-SCENE-FUNCTION-AND-DIFFERENTIATION-CONTRACT-01`
5. `EMBEROS-AI-STORY-MOTION-ACTION-STATE-AND-PRODUCT-CAUSALITY-CONTRACT-01`
6. `EMBEROS-AI-STORY-PRE-GENERATION-DIRECTOR-QC-GATES-01`
7. `EMBEROS-AI-STORY-PRODUCT-STORY-WRITER-PROFILE-01`
8. `EMBEROS-AI-STORY-SHOT-RECIPE-REGISTRY-01`
9. `EMBEROS-AI-STORY-CHARACTER-AUTHORITY-AND-CONTINUITY-CONTRACT-01`
10. `EMBEROS-AI-STORY-SUPPORTING-CAST-AND-EPHEMERAL-ACTOR-SCOPE-01`
11. `EMBEROS-AI-STORY-SCENE-AUTHORITY-AND-CONTINUITY-CONTRACT-01`
12. `EMBEROS-AI-STORY-SEEDANCE-DIRECTOR-ADAPTER-ENRICHMENT-01`
13. `EMBEROS-AI-STORY-SHORT-DRAMA-WRITER-PROFILE-01`
