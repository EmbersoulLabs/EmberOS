# Scene Intent Storage (Phase 2A Persistence Foundation)

## Decision

`ai_story_scene_executions.intent` (**intent_json**) is **retained**.

Instruction Snapshots remain the **single canonical source for compiled instruction content**
(`purpose`, shots, continuity, constraints, referenced assets, etc.).

`intent_json` is retained only for Scene Execution Intent fields that cannot be reconstructed
losslessly from:

- Execution Plan (`ai_story_execution_plans.plan` + plan columns)
- Scene metadata columns on `ai_story_scene_executions`
- Instruction Snapshot (`ai_story_scene_instruction_snapshots.instructions`)

## 1. Why intent_json exists

Phase 0/1 define `AiStorySceneExecutionIntent` as the frozen, provider-neutral Scene execution
unit. Persistence must be able to reload that contract without re-running the Scene Execution
Compiler and without inventing hash conventions that can drift from the compiler.

Instruction Snapshots intentionally store **compiled instruction bodies**, not the Intent’s
identity/reference envelope. Several Intent fields are deterministic integrity seals computed
at compile time from Animation Package inputs that are **not preserved bit-for-bit** in the
snapshot shape.

## 2. Fields that cannot be reconstructed

| Field | Reconstructable from Snapshot | Reason |
|------|-------------------------------|--------|
| `identity.*` | N/A (Scene metadata + Plan) | Loaded from Scene columns / `plan.sceneExecutions`. Not duplicated as instruction content. |
| `frozenStoryVersion` | N/A (Plan) | Loaded from `plan.frozenStoryVersion`. |
| `animationPackage` | N/A (Plan) | Loaded from `plan.animationPackage`. |
| `referencedAssetIds` | Yes | Same list on snapshot. |
| `plannedDurationMs` | Yes | Equals snapshot `durationMs`. |
| `compiledAt` | N/A (Plan) | Loaded from `plan.compiledAt`. |
| `compilationHash` | Partial (Scene column) | Stored on Scene `compilation_hash`; not derived from snapshot alone. |
| `normalizedPayloadReference.contentHash` | Yes | Equals Scene `instruction_hash` / snapshot `content_hash`. |
| `normalizedPayloadReference.uri` | Convention only | Compiler uses `memory://ai-story/scene-instructions/{sceneExecutionId}`. Reconstructing would hard-code URI policy into the repository and risk drift from the compiler. |
| `normalizedPayloadReference.mediaType` | Convention only | Compiler uses `application/json`. Same convention-drift risk. |
| `shotReferences[].shotId` | Yes | Present on snapshot `shots[].shotId`. |
| `shotReferences[].sceneId` | Yes | Present on snapshot `sceneId`. |
| `shotReferences[].order` | Yes | Present on snapshot `shots[].order`. |
| `shotReferences[].durationMs` | Yes | Present on snapshot `shots[].durationMs`. |
| `shotReferences[].integrityHash` | **No** | Compiler seals shots with `integrityHash({ shotId, sceneId, order, durationSec, cameraType, cameraMovement, composition, framing, focus, emotion, information })`. Snapshot stores `durationMs` (via `Math.round(durationSec * 1000)`), not `durationSec`. Reversing ms→sec is lossy for non-integer second durations and would fork hash authority from the compiler. |

## 3. Why those fields are intentionally duplicated

Only the Intent envelope fields that cannot be reconstructed are stored in `intent_json`:

- **`shotReferences[].integrityHash`** — compile-time seal over Animation Package shot inputs
  (`durationSec` + camera/emotion fields). Required to reconstitute the Intent contract and
  to keep Scene `compilationHash` verifiable against the original sealed shot list.
- **`normalizedPayloadReference.uri` / `mediaType`** — compiler-owned reference metadata.
  Storing the Intent avoids embedding URI/media-type policy in the Persistence Foundation.

Instruction **content** is not considered authoritative on `intent_json`. Snapshots own
instruction bytes; Intent only carries references and seals.

## 4. Which representation is authoritative

| Concern | Authoritative store |
|--------|---------------------|
| Compiled instruction body | Instruction Snapshot (`content_hash` → `instructions`) |
| Story-level Execution Plan | `ai_story_execution_plans` (`plan` + deterministic fingerprint) |
| Scene identity / order / status | `ai_story_scene_executions` columns |
| Scene Intent envelope (shot seals + payload reference metadata) | `ai_story_scene_executions.intent` |
| AI QC validation facts | `ai_story_scene_intent_validation_results` |

On read, repositories must treat snapshot instruction JSON as the instruction authority and
must not “repair” snapshot content from `intent_json`.

On write, persistence fail-closes when
`canonicalPersistenceHash(snapshot) !== intent.normalizedPayloadReference.contentHash`.

## 5. How future drift is prevented

1. **Fail-closed hash check** — Intent content hash must equal the persisted snapshot hash.
2. **Snapshots are immutable** — content-addressed primary key; collisions with different bytes
   raise `EXECUTION_PLAN_IDENTITY_CONFLICT`.
3. **No dual instruction editors** — Persistence Foundation does not rewrite instruction bodies
   from Intent fields.
4. **Documentation gate** — any proposal to drop `intent_json` must prove lossless reconstruction
   of every row in the table above, including shot `integrityHash` inputs, without changing
   Phase 0/1 contracts.
5. **Uniqueness is compile-identity based** — plans are keyed by deterministic fingerprint, not
   by Story Version alone, so Intent seals stay bound to one compile identity.

## Boundary

This document covers Phase 2A Persistence Foundation storage only. It does not authorize
execution runtime, provider requests, attempts, results, or Generate Review auto-persist (PR2).
