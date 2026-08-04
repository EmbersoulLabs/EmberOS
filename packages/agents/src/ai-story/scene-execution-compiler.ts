/**
 * Sprint 3 Phase 1 — Scene Execution Compiler.
 *
 * Approved Animation Package → N deterministic Scene Execution Intents.
 * Does not rewrite prompts, invoke providers, or mutate the Animation Package.
 */
import { createHash } from "node:crypto";
import {
  AI_STORY_EXECUTION_CONTRACT_VERSION,
  AnimationPackagePayloadSchema,
  AiStoryExecutionPlanSchema,
  AiStorySceneCompiledInstructionsSchema,
  AiStorySceneExecutionIntentSchema,
  EXECUTION_CAPABILITY_IDS,
  PRODUCT_IDENTITY_CONSTRAINTS,
  type AiStoryExecutionPlan,
  type AiStoryExecutionReviewEstimate,
  type AiStoryFrozenVersionReference,
  type AiStorySceneCompiledInstructions,
  type AiStorySceneExecutionIntent,
  type AnimationPackagePayload,
} from "@ceo-agent/shared";
import { collectReferencedAssetIds } from "./execution-compiler";

export type SceneCompilerContext = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  storyVersionNumber: number;
  storyVersionFrozenAt: string;
  animationPackageId: string;
  animationPackageStatus: string;
  /** Fixed clock for deterministic compiledAt when re-compiling in tests. */
  compiledAt?: string;
};

export type SceneExecutionCompileOutput = {
  storyExecutionPlan: AiStoryExecutionPlan;
  intents: AiStorySceneExecutionIntent[];
  instructionsBySceneExecutionId: Record<string, AiStorySceneCompiledInstructions>;
  estimate: AiStoryExecutionReviewEstimate;
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function integrityHash(value: unknown): string {
  return `sha256:${sha256Hex(stableJson(value))}`;
}

/** Canonical JSON for deterministic hashing (sorted object keys). */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortValue(v);
    return out;
  }
  return value;
}

/** Deterministic UUID (version-5 style) from a sha256 integrity hash. */
export function uuidFromIntegrityHash(hash: string): string {
  const hex = hash.replace(/^sha256:/, "").toLowerCase().padEnd(32, "0").slice(0, 32);
  const bytes = hex.match(/.{2}/g)!.map((b) => parseInt(b, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function durationSecToMs(sec: number): number {
  const ms = Math.round(sec * 1000);
  return ms > 0 ? ms : 1;
}

/**
 * Compile one Scene Execution Intent per Animation Package scene.
 * Same inputs → identical ordering, identities, and hashes.
 */
export function compileSceneExecutionIntents(
  animationPackageInput: AnimationPackagePayload,
  ctx: SceneCompilerContext
): SceneExecutionCompileOutput {
  const pkg = AnimationPackagePayloadSchema.parse(animationPackageInput);
  const compiledAt = ctx.compiledAt ?? new Date().toISOString();
  // Canonical collectReferencedAssetIds lives in execution-compiler; sort for Scene Intent determinism.
  const referencedAssetIds = [...collectReferencedAssetIds(pkg)].sort((a, b) =>
    a.localeCompare(b)
  );

  const scenesSorted = [...pkg.scenePlan].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const shotsSorted = [...pkg.shotPlan].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const storyVersionHash = integrityHash({
    storyId: ctx.storyId,
    storyVersionId: ctx.storyVersionId,
    versionNumber: ctx.storyVersionNumber,
    frozenAt: ctx.storyVersionFrozenAt,
  });

  const frozenStoryVersion: AiStoryFrozenVersionReference = {
    storyId: ctx.storyId,
    storyVersionId: ctx.storyVersionId,
    versionNumber: ctx.storyVersionNumber,
    frozenAt: ctx.storyVersionFrozenAt,
    integrityHash: storyVersionHash,
  };

  const packageHash = integrityHash({
    animationPackageId: ctx.animationPackageId,
    storyId: ctx.storyId,
    storyVersionId: ctx.storyVersionId,
    scenePlan: scenesSorted.map((s) => ({ id: s.id, order: s.order, durationSec: s.durationSec })),
    shotPlan: shotsSorted.map((s) => ({
      id: s.id,
      sceneId: s.sceneId,
      order: s.order,
      durationSec: s.durationSec,
    })),
  });

  const animationPackageRef = {
    animationPackageId: ctx.animationPackageId,
    storyId: ctx.storyId,
    storyVersionId: ctx.storyVersionId,
    sceneCount: scenesSorted.length,
    integrityHash: packageHash,
  };

  const characterReferences = [...pkg.characterContinuity]
    .map((c) => ({
      characterId: c.characterId,
      name: c.name,
      integrityHash: integrityHash({
        characterId: c.characterId,
        name: c.name,
        appearance: c.appearance,
        identity: c.identity,
      }),
    }))
    .sort((a, b) =>
      (a.characterId ?? "").localeCompare(b.characterId ?? "")
    );

  const intents: AiStorySceneExecutionIntent[] = [];
  const instructionsBySceneExecutionId: Record<string, AiStorySceneCompiledInstructions> = {};

  for (const scene of scenesSorted) {
    const sceneShots = shotsSorted.filter((s) => s.sceneId === scene.id);
    const shotReferences = sceneShots.map((shot) => ({
      shotId: shot.id,
      sceneId: shot.sceneId,
      order: shot.order,
      durationMs: durationSecToMs(shot.durationSec),
      integrityHash: integrityHash({
        shotId: shot.id,
        sceneId: shot.sceneId,
        order: shot.order,
        durationSec: shot.durationSec,
        cameraType: shot.cameraType,
        cameraMovement: shot.cameraMovement,
        composition: shot.composition,
        framing: shot.framing,
        focus: shot.focus,
        emotion: shot.emotion,
        information: shot.information,
      }),
    }));

    const plannedDurationMs =
      durationSecToMs(scene.durationSec) ||
      shotReferences.reduce((sum, s) => sum + s.durationMs, 0) ||
      1;

    const instructions = AiStorySceneCompiledInstructionsSchema.parse({
      contractVersion: AI_STORY_EXECUTION_CONTRACT_VERSION,
      capabilityId: EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO,
      sceneId: scene.id,
      sceneOrder: scene.order,
      purpose: scene.purpose,
      transition: scene.transition ?? "",
      continuityNotes: scene.continuityNotes ?? "",
      beatIds: scene.beatIds ?? [],
      durationMs: plannedDurationMs,
      shots: sceneShots.map((shot) => ({
        shotId: shot.id,
        order: shot.order,
        durationMs: durationSecToMs(shot.durationSec),
        cameraType: shot.cameraType,
        cameraMovement: shot.cameraMovement,
        composition: shot.composition,
        framing: shot.framing,
        lensSuggestion: shot.lensSuggestion ?? "",
        focus: shot.focus,
        emotion: shot.emotion,
        information: shot.information,
      })),
      characterReferences,
      referencedAssetIds,
      worldContinuity: pkg.worldContinuity as unknown as Record<string, unknown>,
      productIdentityConstraints: [...PRODUCT_IDENTITY_CONSTRAINTS],
    });

    const instructionHash = integrityHash(instructions);
    const fingerprint = integrityHash({
      contractVersion: AI_STORY_EXECUTION_CONTRACT_VERSION,
      tenantId: ctx.orgId,
      workspaceId: ctx.workspaceId,
      campaignId: ctx.campaignId,
      storyId: ctx.storyId,
      storyVersionId: ctx.storyVersionId,
      animationPackageId: ctx.animationPackageId,
      sceneId: scene.id,
      sceneOrder: scene.order,
      packageHash,
      instructionHash,
    });

    const sceneExecutionId = uuidFromIntegrityHash(
      integrityHash({ kind: "sceneExecutionId", fingerprint })
    );
    const storyScopedKey = `ai-story-scene:${ctx.storyVersionId}:${ctx.animationPackageId}:${scene.id}:${scene.order}`;
    const idempotencyKey = `idem:${sha256Hex(storyScopedKey).slice(0, 32)}`;

    const intent = AiStorySceneExecutionIntentSchema.parse({
      identity: {
        contractVersion: AI_STORY_EXECUTION_CONTRACT_VERSION,
        sceneExecutionId,
        tenantId: ctx.orgId,
        workspaceId: ctx.workspaceId,
        campaignId: ctx.campaignId,
        storyId: ctx.storyId,
        storyVersionId: ctx.storyVersionId,
        animationPackageId: ctx.animationPackageId,
        sceneId: scene.id,
        sceneOrder: scene.order,
        idempotencyKey,
        deterministicFingerprint: fingerprint,
      },
      frozenStoryVersion,
      animationPackage: animationPackageRef,
      shotReferences,
      referencedAssetIds,
      normalizedPayloadReference: {
        uri: `memory://ai-story/scene-instructions/${sceneExecutionId}`,
        contentHash: instructionHash,
        mediaType: "application/json",
      },
      plannedDurationMs,
      compiledAt,
      compilationHash: integrityHash({
        fingerprint,
        instructionHash,
        shotReferences,
      }),
    });

    intents.push(intent);
    instructionsBySceneExecutionId[sceneExecutionId] = instructions;
  }

  const storyExecutionId = uuidFromIntegrityHash(
    integrityHash({
      kind: "storyExecutionId",
      storyVersionId: ctx.storyVersionId,
      animationPackageId: ctx.animationPackageId,
      sceneExecutionIds: intents.map((i) => i.identity.sceneExecutionId),
    })
  );

  const storyExecutionPlan = AiStoryExecutionPlanSchema.parse({
    contractVersion: AI_STORY_EXECUTION_CONTRACT_VERSION,
    storyExecutionId,
    frozenStoryVersion,
    animationPackage: animationPackageRef,
    sceneExecutions: intents.map((i) => i.identity),
    compilationHash: integrityHash({
      storyExecutionId,
      sceneExecutionIds: intents.map((i) => i.identity.sceneExecutionId),
      compilationHashes: intents.map((i) => i.compilationHash),
    }),
    compiledAt,
  });

  const totalDurationSec = intents.reduce((sum, i) => sum + i.plannedDurationMs / 1000, 0);
  const estimatedCostUsd = Number((0.35 * intents.length).toFixed(4));

  const estimate: AiStoryExecutionReviewEstimate = {
    storySummary: pkg.story.summary,
    aiSummary: [
      `Director: ${pkg.directorThinking.coreMessage}`,
      `${intents.length} Scene execution unit(s)`,
      `${shotsSorted.length} Shot(s) across ordered Scenes`,
      `${referencedAssetIds.length} Campaign Asset reference(s)`,
      "Phase 1: Generate Review + AI QC only — no provider execution",
    ].join(" · "),
    requiredSceneCount: intents.length,
    estimatedProviderExecutions: intents.length,
    estimatedCredits: Math.ceil(estimatedCostUsd * 100),
    estimatedCostUsd,
    estimatedDurationSec: totalDurationSec,
    preferredCapabilityId: EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO,
    risks: [
      ...(pkg.narrativeIntegration.consistent
        ? []
        : ["Narrative integration reported consistency issues."]),
      ...(referencedAssetIds.length === 0
        ? ["No Campaign Asset references — AI QC will block execution."]
        : []),
      ...(ctx.animationPackageStatus !== "ready_for_execution"
        ? [`Animation Package status is ${ctx.animationPackageStatus}.`]
        : []),
      "Provider execution is locked until later Sprint 3 phases are approved.",
    ],
    referencedAssetIds,
  };

  return {
    storyExecutionPlan,
    intents,
    instructionsBySceneExecutionId,
    estimate,
  };
}
