import type {
  AiStoryAiQcResult,
  AiStoryExecutionPlan,
  AiStorySceneCompiledInstructions,
  AiStorySceneExecutionIntent,
} from "@ceo-agent/shared";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
  type PersistSceneExecutionCompilationInput,
} from "@ceo-agent/db";

export const PHASE_2A_IDS = {
  orgId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  campaignId: "10000000-0000-4000-8000-000000000003",
  storyId: "10000000-0000-4000-8000-000000000004",
  storyVersionId: "10000000-0000-4000-8000-000000000005",
  animationPackageId: "10000000-0000-4000-8000-000000000006",
  assetId: "10000000-0000-4000-8000-000000000007",
} as const;

export const PHASE_2A_WORKSPACE_B_IDS = {
  orgId: "20000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000002",
  campaignId: "20000000-0000-4000-8000-000000000003",
  storyId: "20000000-0000-4000-8000-000000000004",
  storyVersionId: "20000000-0000-4000-8000-000000000005",
  animationPackageId: "20000000-0000-4000-8000-000000000006",
  assetId: "20000000-0000-4000-8000-000000000007",
} as const;

export type Phase2aIdSet = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly animationPackageId: string;
  readonly assetId: string;
};

export function makePhase2aCompilation(
  overrides: {
    ids?: Phase2aIdSet;
    animationPackageId?: string;
    sceneOrder?: readonly number[];
    instructionPurpose?: string;
  } = {}
): PersistSceneExecutionCompilationInput {
  const ids = {
    ...(overrides.ids ?? PHASE_2A_IDS),
    animationPackageId:
      overrides.animationPackageId ??
      overrides.ids?.animationPackageId ??
      PHASE_2A_IDS.animationPackageId,
  };
  const orders = overrides.sceneOrder ?? [0, 1];
  const compiledAt = "2026-08-02T12:00:00.000Z";
  const sceneIds = ["scene-a", "scene-b", "scene-c"];
  const instructionsBySceneExecutionId: Record<string, AiStorySceneCompiledInstructions> = {};
  const intents: AiStorySceneExecutionIntent[] = orders.map((order, index) => {
    const sceneId = sceneIds[index]!;
    const instructions: AiStorySceneCompiledInstructions = {
      contractVersion: "1",
      capabilityId: "animation-video-generation",
      sceneId,
      sceneOrder: order,
      purpose: overrides.instructionPurpose ?? `Purpose ${sceneId}`,
      transition: "cut",
      continuityNotes: "Preserve continuity",
      beatIds: [`beat-${index}`],
      durationMs: 3000,
      shots: [{
        shotId: `shot-${index}`,
        order: 0,
        durationMs: 3000,
        cameraType: "medium",
        cameraMovement: "static",
        composition: "centered",
        framing: "subject",
        lensSuggestion: "35mm",
        focus: "subject",
        emotion: "calm",
        information: "story information",
      }],
      characterReferences: [],
      referencedAssetIds: [ids.assetId],
      worldContinuity: { location: "world" },
      productIdentityConstraints: ["preserve identity"],
    };
    const instructionHash = canonicalPersistenceHash(instructions);
    const fingerprint = canonicalPersistenceHash({ ids, sceneId, order, instructionHash });
    const sceneExecutionId = deterministicPersistenceUuid("scene-execution", fingerprint);
    instructionsBySceneExecutionId[sceneExecutionId] = instructions;
    return {
      identity: {
        contractVersion: "1",
        sceneExecutionId,
        tenantId: ids.orgId,
        workspaceId: ids.workspaceId,
        campaignId: ids.campaignId,
        storyId: ids.storyId,
        storyVersionId: ids.storyVersionId,
        animationPackageId: ids.animationPackageId,
        sceneId,
        sceneOrder: order,
        idempotencyKey: `idem:${fingerprint}`,
        deterministicFingerprint: fingerprint,
      },
      frozenStoryVersion: {
        storyId: ids.storyId,
        storyVersionId: ids.storyVersionId,
        versionNumber: 1,
        frozenAt: compiledAt,
        integrityHash: canonicalPersistenceHash({ storyVersionId: ids.storyVersionId }),
      },
      animationPackage: {
        animationPackageId: ids.animationPackageId,
        storyId: ids.storyId,
        storyVersionId: ids.storyVersionId,
        sceneCount: orders.length,
        integrityHash: canonicalPersistenceHash({ animationPackageId: ids.animationPackageId }),
      },
      shotReferences: [{
        shotId: `shot-${index}`,
        sceneId,
        order: 0,
        durationMs: 3000,
        integrityHash: canonicalPersistenceHash({ sceneId, shot: index }),
      }],
      referencedAssetIds: [ids.assetId],
      normalizedPayloadReference: {
        uri: `snapshot://${instructionHash}`,
        contentHash: instructionHash,
        mediaType: "application/json",
      },
      plannedDurationMs: 3000,
      compiledAt,
      compilationHash: canonicalPersistenceHash({ fingerprint, instructionHash }),
    };
  });
  const storyExecutionId = deterministicPersistenceUuid("execution-plan", {
    storyVersionId: ids.storyVersionId,
    animationPackageId: ids.animationPackageId,
    scenes: intents.map((intent) => ({ id: intent.identity.sceneExecutionId, order: intent.identity.sceneOrder })),
  });
  const plan: AiStoryExecutionPlan = {
    contractVersion: "1",
    storyExecutionId,
    frozenStoryVersion: intents[0]!.frozenStoryVersion,
    animationPackage: intents[0]!.animationPackage,
    sceneExecutions: intents.map((intent) => intent.identity),
    compilationHash: canonicalPersistenceHash(intents.map((intent) => intent.compilationHash)),
    compiledAt,
  };
  const validationResults: AiStoryAiQcResult[] = intents.map((intent) => ({
    status: "passed",
    intentId: intent.identity.sceneExecutionId,
    sceneId: intent.identity.sceneId,
    validatedAt: compiledAt,
    contractVersion: "1",
    errors: [],
  }));
  return { plan, intents, instructionsBySceneExecutionId, validationResults };
}
