import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AI_STORY_LOCAL_PACKAGE_GENERATION_MODES,
  AI_STORY_LOCAL_REFERENCE_AUTHORITY_TYPES,
  AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION,
  EXECUTION_CAPABILITY_IDS,
  type AiStoryEffectiveSceneGenerationAuthority,
  type AiStoryPreGenerationQcEvaluation,
} from "@ceo-agent/shared";
import { computeAiStoryPreGenerationQcFingerprint } from "@ceo-agent/shared/server";
import {
  assertCurrentPreGenerationQcForRuntimeAuthorization,
  assertRuntimePreGenerationQcEvidence,
  buildManualLocalPreGenerationQcCapabilitySnapshot,
  buildManualLocalPreQcCompilationRequest,
  MANUAL_LOCAL_PRE_QC_CAPABILITY_VERSION,
  materializeGenerateReviewPreGenerationQc,
  persistRuntimeAuthorizationAfterPreQc,
  selectUniqueFrozenMotionChain,
  type DirectorChainRow,
  type HandoffChainRow,
  type MotionChainRow,
  type OutlineChainRow,
  type ScriptChainRow,
} from "../packages/agents/src/ai-story/generate-review-pre-generation-qc";

const orgId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "10000000-0000-4000-8000-000000000002";
const campaignId = "10000000-0000-4000-8000-000000000003";
const storyId = "10000000-0000-4000-8000-000000000004";
const storyVersionId = "10000000-0000-4000-8000-000000000005";
const actorUserId = "10000000-0000-4000-8000-000000000006";
const sceneVersionId = "10000000-0000-4000-8000-000000000007";
const otherSceneVersionId = "10000000-0000-4000-8000-000000000008";
const frameId = "10000000-0000-4000-8000-000000000009";
const scope = { orgId, workspaceId, campaignId, storyId, storyVersionId };
const scriptScope = { ...scope, actorUserId };

function chain(ids: {
  motionPlanId: string;
  directorPlanId: string;
  handoffId: string;
  scriptVersionId: string;
  outlineVersionId: string;
  version: number;
  motionStatus?: string;
  directorStatus?: string;
  handoffStatus?: string;
  scriptStatus?: string;
  outlineStatus?: string;
}) {
  const motion: MotionChainRow = {
    ...scope,
    motionPlanId: ids.motionPlanId,
    directorPlanId: ids.directorPlanId,
    handoffId: ids.handoffId,
    scriptVersionId: ids.scriptVersionId,
    outlineVersionId: ids.outlineVersionId,
    status: ids.motionStatus ?? "FROZEN",
    version: ids.version,
  };
  const director: DirectorChainRow = {
    ...scope,
    directorPlanId: ids.directorPlanId,
    handoffId: ids.handoffId,
    scriptVersionId: ids.scriptVersionId,
    outlineVersionId: ids.outlineVersionId,
    status: ids.directorStatus ?? "FROZEN",
  };
  const handoff: HandoffChainRow = {
    ...scope,
    handoffId: ids.handoffId,
    scriptVersionId: ids.scriptVersionId,
    outlineVersionId: ids.outlineVersionId,
    authorityStatus: ids.handoffStatus ?? "CURRENT",
    frozenAt: new Date("2026-10-03T00:00:00.000Z"),
  };
  const script: ScriptChainRow = {
    ...scope,
    scriptVersionId: ids.scriptVersionId,
    outlineVersionId: ids.outlineVersionId,
    status: ids.scriptStatus ?? "FROZEN",
  };
  const outline: OutlineChainRow = {
    ...scope,
    outlineVersionId: ids.outlineVersionId,
    status: ids.outlineStatus ?? "FROZEN",
  };
  return { motion, director, handoff, script, outline };
}

const current = chain({
  motionPlanId: "20000000-0000-4000-8000-000000000001",
  directorPlanId: "20000000-0000-4000-8000-000000000002",
  handoffId: "20000000-0000-4000-8000-000000000003",
  scriptVersionId: "20000000-0000-4000-8000-000000000004",
  outlineVersionId: "20000000-0000-4000-8000-000000000005",
  version: 1,
});

function authority(
  value: AiStoryEffectiveSceneGenerationAuthority
): AiStoryEffectiveSceneGenerationAuthority {
  return value;
}

function evaluation(
  overrides: Partial<AiStoryPreGenerationQcEvaluation> = {},
  tamper = false
): AiStoryPreGenerationQcEvaluation {
  const base = {
    orgId,
    workspaceId,
    storyId,
    storyVersionId,
    outlineVersionId: current.outline.outlineVersionId,
    scriptVersionId: current.script.scriptVersionId,
    handoffId: current.handoff.handoffId,
    directorPlanId: current.director.directorPlanId,
    motionPlanId: current.motion.motionPlanId,
    sceneExecutionId: "30000000-0000-4000-8000-000000000001",
    sceneVersionIds: [sceneVersionId],
    gateSetVersion: AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION,
    providerCapabilityId: EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO,
    providerCapabilityVersion: MANUAL_LOCAL_PRE_QC_CAPABILITY_VERSION,
    productAuthorityIds: [],
    gateResults: [],
    dispatchDecision: "DISPATCH_ELIGIBLE" as const,
    qcEvaluationId: "30000000-0000-4000-8000-000000000099",
  };
  const merged = { ...base, ...overrides };
  const qcFingerprint = tamper
    ? `sha256:${"ab".repeat(32)}`
    : computeAiStoryPreGenerationQcFingerprint(merged);
  return { ...merged, qcFingerprint } as AiStoryPreGenerationQcEvaluation;
}

function errorCode(run: () => void): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "";
  }
  return "";
}

describe("Generate Review Pre-Generation QC materialization", () => {
  it("builds a provider-neutral manual-local capability from the local package contract", () => {
    const snapshot = buildManualLocalPreGenerationQcCapabilitySnapshot();
    expect(snapshot.capabilityId).toBe("animation-video-generation");
    expect(snapshot.capabilityVersion).toBe("manual-local-package.v2");
    expect(snapshot.supportedExecutionModes).toEqual([...AI_STORY_LOCAL_PACKAGE_GENERATION_MODES]);
    expect(snapshot.supportedExecutionModes).toEqual([
      "TEXT_TO_VIDEO",
      "FIRST_FRAME_IMAGE_TO_VIDEO",
      "PRODUCT_GROUNDED_VIDEO",
    ]);
    expect(snapshot.supportedReferenceRoles).toEqual([...AI_STORY_LOCAL_REFERENCE_AUTHORITY_TYPES]);
    expect(snapshot.supportedTimingStructures).toEqual(["SINGLE_SCENE"]);
    expect(snapshot.estimatedAttemptCostUsd).toBeNull();
    expect(snapshot.verified).toBe(true);
    expect(snapshot).not.toHaveProperty("providerId");
  });

  it("derives the compilation request from frozen generation authority", () => {
    const sceneExecutionId = "30000000-0000-4000-8000-000000000001";
    const text = buildManualLocalPreQcCompilationRequest({
      sceneExecutionId,
      generationAuthority: authority({
        strategy: "TEXT_TO_VIDEO",
        referenceSource: "REFERENCE_FREE_T2V",
        effectiveReferenceIds: [],
        firstFrameAssetId: null,
        productVisualIdentityRequirement: "NONE",
      }),
    });
    expect(text).toEqual({
      sceneExecutionId,
      requestedCapabilityId: "animation-video-generation",
      executionMode: "TEXT_TO_VIDEO",
      referenceRoles: [],
      timingStructure: "SINGLE_SCENE",
      providerNeutralInputsComplete: true,
    });

    const grounded = buildManualLocalPreQcCompilationRequest({
      sceneExecutionId,
      generationAuthority: authority({
        strategy: "PRODUCT_GROUNDED_VIDEO",
        referenceSource: "SCENE_EXPLICIT",
        effectiveReferenceIds: [frameId],
        firstFrameAssetId: frameId,
        productVisualIdentityRequirement: "REQUIRED",
      }),
    });
    expect(grounded.executionMode).toBe("PRODUCT_GROUNDED_VIDEO");
    expect(grounded.referenceRoles).toEqual(["FIRST_FRAME", "PRODUCT"]);
    expect(grounded.providerNeutralInputsComplete).toBe(true);

    const firstFrame = buildManualLocalPreQcCompilationRequest({
      sceneExecutionId,
      generationAuthority: authority({
        strategy: "FIRST_FRAME_IMAGE_TO_VIDEO",
        referenceSource: "SCENE_EXPLICIT",
        effectiveReferenceIds: [frameId],
        firstFrameAssetId: frameId,
        productVisualIdentityRequirement: "REQUIRED",
      }),
    });
    expect(firstFrame.executionMode).toBe("FIRST_FRAME_IMAGE_TO_VIDEO");

    const incomplete = buildManualLocalPreQcCompilationRequest({
      sceneExecutionId,
      generationAuthority: authority({
        strategy: "FIRST_FRAME_IMAGE_TO_VIDEO",
        referenceSource: "SCENE_EXPLICIT",
        effectiveReferenceIds: [],
        firstFrameAssetId: null,
        productVisualIdentityRequirement: "REQUIRED",
      }),
    });
    expect(incomplete.executionMode).toBe("FIRST_FRAME_IMAGE_TO_VIDEO");
    expect(incomplete.providerNeutralInputsComplete).toBe(false);

    expect(errorCode(() => buildManualLocalPreQcCompilationRequest({
      sceneExecutionId,
      generationAuthority: authority({
        strategy: "PRODUCT_GROUNDED_VIDEO",
        referenceSource: "STORY_INHERITED",
        effectiveReferenceIds: [],
        firstFrameAssetId: null,
        productVisualIdentityRequirement: "REQUIRED",
      }),
    }))).toBe("PRE_QC_GENERATION_AUTHORITY_ABSENT");
  });

  it("persists one Pre-QC evaluation per persisted Scene Execution through evaluate()", async () => {
    const first = "30000000-0000-4000-8000-000000000011";
    const second = "30000000-0000-4000-8000-000000000012";
    const calls: Array<{ motionPlanId: string; compilationRequest: { sceneExecutionId: string } }> = [];
    const summary = await materializeGenerateReviewPreGenerationQc({
      db: {} as never,
      scope: scriptScope,
      resolveMotion: async () => ({ motionPlanId: current.motion.motionPlanId }),
      scenes: [
        {
          sceneExecutionId: first,
          generationAuthority: authority({
            strategy: "TEXT_TO_VIDEO",
            referenceSource: "REFERENCE_FREE_T2V",
            effectiveReferenceIds: [],
            firstFrameAssetId: null,
            productVisualIdentityRequirement: "NONE",
          }),
        },
        {
          sceneExecutionId: second,
          generationAuthority: authority({
            strategy: "FIRST_FRAME_IMAGE_TO_VIDEO",
            referenceSource: "SCENE_EXPLICIT",
            effectiveReferenceIds: [frameId],
            firstFrameAssetId: frameId,
            productVisualIdentityRequirement: "REQUIRED",
          }),
        },
      ],
      qc: {
        async evaluate(_scope, request) {
          calls.push({
            motionPlanId: request.motionPlanId,
            compilationRequest: request.compilationRequest,
          });
          const fingerprint = `sha256:${calls.length === 1 ? "11" : "22"}${"ab".repeat(31)}`;
          return {
            qcEvaluationId: calls.length === 1
              ? "30000000-0000-4000-8000-000000000021"
              : "30000000-0000-4000-8000-000000000022",
            qcFingerprint: fingerprint,
            dispatchDecision: "DISPATCH_ELIGIBLE",
          } as AiStoryPreGenerationQcEvaluation;
        },
      },
    });
    expect(calls.map((call) => call.compilationRequest.sceneExecutionId)).toEqual([first, second]);
    expect(calls.every((call) => call.motionPlanId === current.motion.motionPlanId)).toBe(true);
    expect(summary.PRE_QC_SCENE_COUNT).toBe(2);
    expect(summary.scenes.map((scene) => scene.sceneExecutionId)).toEqual([first, second]);
    expect(summary.PRE_QC_BLOCKED_COUNT).toBe(0);
  });

  it("fails closed when current Motion authority is missing or ambiguous", () => {
    expect(errorCode(() => selectUniqueFrozenMotionChain({
      motions: [],
      directors: [],
      handoffs: [],
      scripts: [],
      outlines: [],
      scope,
    }))).toBe("PRE_QC_MOTION_AUTHORITY_ABSENT");

    const newerInvalid = chain({
      motionPlanId: "20000000-0000-4000-8000-000000000011",
      directorPlanId: "20000000-0000-4000-8000-000000000012",
      handoffId: "20000000-0000-4000-8000-000000000013",
      scriptVersionId: "20000000-0000-4000-8000-000000000014",
      outlineVersionId: "20000000-0000-4000-8000-000000000015",
      version: 9,
      directorStatus: "DRAFT",
    });
    expect(selectUniqueFrozenMotionChain({
      motions: [newerInvalid.motion, current.motion],
      directors: [newerInvalid.director, current.director],
      handoffs: [newerInvalid.handoff, current.handoff],
      scripts: [newerInvalid.script, current.script],
      outlines: [newerInvalid.outline, current.outline],
      scope,
    }).motionPlanId).toBe(current.motion.motionPlanId);

    const other = chain({
      motionPlanId: "20000000-0000-4000-8000-000000000021",
      directorPlanId: "20000000-0000-4000-8000-000000000022",
      handoffId: "20000000-0000-4000-8000-000000000023",
      scriptVersionId: "20000000-0000-4000-8000-000000000024",
      outlineVersionId: "20000000-0000-4000-8000-000000000025",
      version: 2,
    });
    expect(errorCode(() => selectUniqueFrozenMotionChain({
      motions: [current.motion, other.motion],
      directors: [current.director, other.director],
      handoffs: [current.handoff, other.handoff],
      scripts: [current.script, other.script],
      outlines: [current.outline, other.outline],
      scope,
    }))).toBe("PRE_QC_MOTION_AUTHORITY_AMBIGUOUS");
  });

  it("fails closed for stale scenes, tampered fingerprints, blocked or missing Pre-QC", async () => {
    const sceneExecutionId = "30000000-0000-4000-8000-000000000001";
    const currentEvidence = evaluation({ sceneExecutionId });
    expect(errorCode(() => assertRuntimePreGenerationQcEvidence({
      evaluation: currentEvidence,
      sceneExecutionId,
      storyVersionId,
      motionPlanId: current.motion.motionPlanId,
      currentSceneVersionIds: [otherSceneVersionId],
    }))).toBe("PRE_QC_STALE_SCENE");
    expect(errorCode(() => assertRuntimePreGenerationQcEvidence({
      evaluation: evaluation({ sceneExecutionId }, true),
      sceneExecutionId,
      storyVersionId,
      motionPlanId: current.motion.motionPlanId,
      currentSceneVersionIds: [sceneVersionId],
    }))).toBe("PRE_QC_FINGERPRINT_INVALID");
    expect(errorCode(() => assertRuntimePreGenerationQcEvidence({
      evaluation: evaluation({ sceneExecutionId, dispatchDecision: "DISPATCH_BLOCKED" }),
      sceneExecutionId,
      storyVersionId,
      motionPlanId: current.motion.motionPlanId,
      currentSceneVersionIds: [sceneVersionId],
    }))).toBe("PRE_QC_DISPATCH_BLOCKED");

    const assertCurrent = vi.fn();
    await expect(assertCurrentPreGenerationQcForRuntimeAuthorization({
      scope: scriptScope,
      orderedSceneExecutionIds: [sceneExecutionId],
      resolveMotion: async () => ({ motionPlanId: current.motion.motionPlanId }),
      loadSceneVersionIds: async () => [sceneVersionId],
      qc: {
        async history() { return []; },
        assertCurrent,
      },
    })).rejects.toMatchObject({ code: "PRE_QC_LINEAGE_ABSENT" });
    expect(assertCurrent).not.toHaveBeenCalled();

    const accept = vi.fn(async () => "persisted");
    await expect(persistRuntimeAuthorizationAfterPreQc(async () => {
      throw new Error("PRE_QC_LINEAGE_ABSENT");
    }, accept)).rejects.toThrow(/PRE_QC_LINEAGE_ABSENT/);
    await expect(persistRuntimeAuthorizationAfterPreQc(async () => {
      assertRuntimePreGenerationQcEvidence({
        evaluation: evaluation({ sceneExecutionId, dispatchDecision: "DISPATCH_BLOCKED" }),
        sceneExecutionId,
        storyVersionId,
        motionPlanId: current.motion.motionPlanId,
        currentSceneVersionIds: [sceneVersionId],
      });
    }, accept)).rejects.toMatchObject({ code: "PRE_QC_DISPATCH_BLOCKED" });
    expect(accept).not.toHaveBeenCalled();
  });

  it("keeps Scene Intent QC independent and does not create provider work", () => {
    const review = readFileSync(
      resolve("packages/agents/src/ai-story/story-execution-orchestrator.ts"),
      "utf8"
    );
    const start = review.indexOf("export async function createGenerateReview");
    const end = review.indexOf("export async function startExecutionJob");
    const body = review.slice(start, end);
    expect(body.indexOf("validateAllSceneExecutionIntents")).toBeLessThan(
      body.indexOf("persistFromGenerateReview")
    );
    expect(body.indexOf("persistFromGenerateReview")).toBeLessThan(
      body.indexOf("materializeGenerateReviewPreGenerationQc")
    );
    expect(body).toContain("skipped_qc_failed");
    expect(body).toContain("executionAllowed: false");
    expect(body.toLowerCase()).not.toContain("seedance");
    expect(body).not.toContain("provider_outbox");
    expect(body).not.toContain("ProviderAttempt");

    const materializer = readFileSync(
      resolve("packages/agents/src/ai-story/generate-review-pre-generation-qc.ts"),
      "utf8"
    );
    expect(materializer).toContain(".evaluate(");
    expect(materializer).not.toContain(".insert(");
    expect(materializer.toLowerCase()).not.toContain("seedance");
    expect(materializer).not.toContain("provider_outbox");
    expect(materializer).not.toContain("ProviderAttempt");
    expect(materializer).not.toContain("ProviderRouter");

    const qcService = readFileSync(
      resolve("packages/db/src/queries/ai-story-pre-generation-qc.ts"),
      "utf8"
    );
    expect(qcService).toContain(
      "eq(schema.aiStorySceneExecutions.id,input.compilationRequest.sceneExecutionId)"
    );

    const localService = readFileSync(
      resolve("packages/agents/src/ai-story/local-generation-service.ts"),
      "utf8"
    );
    expect(localService).toContain("preGenerationQcEvaluationId");
    expect(localService).toContain("preGenerationQcFingerprint");
    expect(localService).not.toContain("sceneIntentValidation");

    const execute = readFileSync(
      resolve("packages/agents/src/ai-story/authorize-and-execute-execution-plan.ts"),
      "utf8"
    );
    const gate = execute.indexOf("persistRuntimeAuthorizationAfterPreQc");
    const acceptFact = execute.indexOf("acceptOrReturnCanonicalSnapshotInTransaction");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(acceptFact);
    expect(execute).toContain("assertCurrentPreGenerationQcForRuntimeAuthorization");
    expect(execute).toContain('input.executionMode !== "MANUAL_LOCAL"');
  });
});
