import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  projectEpisodeDirectorScenes,
  projectEpisodeMotionScenes,
  type EpisodeProjectedAuthoritySource,
} from "@ceo-agent/shared";
import {
  AI_STORY_PROJECTED_QC_GATE_CLASSIFICATION,
  ProjectedQcTargetSceneError,
  buildAiStoryOutlineVersion,
  buildAiStoryScriptDirectorHandoff,
  buildAiStoryScriptVersion,
  evaluateAiStoryPreGenerationQc,
  evaluateEpisodeProjectedPreGenerationQc,
  includeValidatedCampaignAuthority,
  resolveProjectedQcTargetScene,
  type ProjectedQcSceneExecutionRecord,
  type ProjectedQcTargetScene,
} from "@ceo-agent/shared/server";

const id = (n: number) => `91000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const HASH = `sha256:${"a".repeat(64)}`;
const ORG = id(1);
const WORKSPACE = id(2);
const CAMPAIGN = id(3);
const STORY = id(4);
const STORY_VERSION = id(5);
const ACTOR = id(6);
const CHARACTER = id(7);
const PRODUCT = id(8);
const PLAN = id(70);
const FUNCTIONS = ["INTRODUCE", "PRODUCT_DETAIL_REVEAL", "PRODUCT_USAGE", "PRODUCT_PAYOFF", "PACKSHOT"] as const;
const EXECUTIONS = [id(80), id(81), id(82), id(83), id(84)];

const textToVideo = {
  strategy: "TEXT_TO_VIDEO" as const,
  referenceSource: "REFERENCE_FREE_T2V" as const,
  referenceAssetIds: [] as string[],
  firstFrameAssetId: null,
  productVisualIdentityRequirement: "NONE" as const,
};
const imageToVideo = {
  strategy: "FIRST_FRAME_IMAGE_TO_VIDEO" as const,
  referenceSource: "SCENE_EXPLICIT" as const,
  referenceAssetIds: [PRODUCT],
  firstFrameAssetId: PRODUCT,
  productVisualIdentityRequirement: "REQUIRED" as const,
};

function knowledge(value: string, fromValue?: string) {
  return { dimension: "KNOWLEDGE", subjectId: CHARACTER, value, ...(fromValue ? { fromValue, reason: "The scene changes what the character knows" } : {}) };
}

function productState(value: string, fromValue: string) {
  return { dimension: "PRODUCT_STATE", subjectId: PRODUCT, value, fromValue, reason: "The accepted product changes the scene outcome" };
}

function specs() {
  return [0, 1, 2, 3, 4].map((order) => {
    const productScene = order === 1 || order === 2;
    const from = ["curious", "curious", "recognizing", "wanting", "satisfied"][order]!;
    const to = ["curious", "recognizing", "wanting", "satisfied", "remembering"][order]!;
    const physical = order === 1 ? productState("revealed", "sealed") : order === 2 ? productState("served", "revealed") : null;
    const knowledgeDelta = knowledge(to, from);
    return {
      order,
      scriptSceneId: id(10 + order),
      canonicalSceneId: id(20 + order),
      canonicalSceneVersionId: id(30 + order),
      actionId: id(40 + order),
      sceneFunction: FUNCTIONS[order]!,
      purpose: `Purpose ${order}`,
      composition: `composition ${order}`,
      information: `information ${order}`,
      cameraMovement: productScene ? "slow push-in" : "none",
      productScene,
      knowledgeDelta,
      deltas: physical ? [knowledgeDelta, physical] : [knowledgeDelta],
      entry: physical ? [knowledge(from), { dimension: "PRODUCT_STATE", subjectId: PRODUCT, value: physical.fromValue }] : [knowledge(from)],
      exit: physical ? [knowledge(to), { dimension: "PRODUCT_STATE", subjectId: PRODUCT, value: physical.value }] : [knowledge(to)],
    };
  });
}

function source(rows = specs()): EpisodeProjectedAuthoritySource {
  return {
    animationPackageId: id(90),
    scriptScenes: rows.map((row) => ({
      scriptSceneId: row.scriptSceneId,
      order: row.order,
      sceneFunction: row.sceneFunction,
      actions: [{
        entryId: row.actionId,
        action: "The character continues the story.",
        subjectId: CHARACTER,
        stateDelta: row.knowledgeDelta,
      }],
      sceneStateIn: row.entry,
      sceneStateDeltas: row.deltas,
      sceneStateOut: row.exit,
      productEvidence: [],
      productAuthorityRefs: row.productScene ? [PRODUCT] : [],
      propIds: [],
    })),
    canonicalScenes: rows.map((row) => ({
      sceneId: row.canonicalSceneId,
      sceneVersionId: row.canonicalSceneVersionId,
      fingerprint: HASH,
      order: row.order,
      sceneFunction: row.sceneFunction,
      sourceScriptSceneIds: [row.scriptSceneId],
      entryState: row.entry,
      events: [{
        entryId: row.actionId,
        type: "ACTION" as const,
        action: "The character continues the story.",
        subjectId: CHARACTER,
        objectId: null,
        stateDelta: row.knowledgeDelta,
      }],
      exitState: row.exit,
      productBindingIds: row.productScene ? [PRODUCT] : [],
      mustKeep: ["Visible subject"],
      mustAvoid: ["Invented identity"],
      generationAuthority: row.productScene ? imageToVideo : textToVideo,
    })),
    scenePlan: rows.map((row) => ({ id: `scene-00${row.order + 1}`, order: row.order, purpose: row.purpose, continuityNotes: "", durationSec: 10 })),
    shotPlan: rows.map((row) => ({
      id: `shot-${row.order}`,
      sceneId: `scene-00${row.order + 1}`,
      order: row.order,
      cameraType: "static",
      cameraMovement: row.cameraMovement,
      composition: row.composition,
      framing: "medium",
      focus: row.productScene ? "product" : "subject",
      information: row.information,
      durationSec: row.order === 4 ? 5 : 10,
    })),
  };
}

function frozen<T extends { status: string; approvedBy: string | null; approvedAt: string | null; frozenAt: string | null }>(value: T): T {
  return { ...value, status: "FROZEN", approvedBy: ACTOR, approvedAt: "2026-09-28T00:00:00.000Z", frozenAt: "2026-09-28T00:01:00.000Z" };
}

function story(rows = specs()) {
  const outline = frozen(buildAiStoryOutlineVersion({
    storyId: STORY, storyVersionId: STORY_VERSION, orgId: ORG, workspaceId: WORKSPACE, version: 1,
    profile: { profileId: "CORE", profileVersion: 1 },
    premise: "A customer meets one product", coreClaim: "The same product remains identifiable",
    storyUnits: [{ storyUnitId: id(9), order: 0, purpose: "Complete story", summary: "Five scenes", requiredBeatIds: rows.map((row) => id(60 + row.order)) }],
    beats: rows.map((row) => ({ id: id(60 + row.order), storyUnitId: id(9), order: row.order, classification: "MAJOR" as const, name: `Beat ${row.order}`, purpose: row.purpose, summary: row.information, required: true, ownershipPolicy: "EXCLUSIVE" as const, authorityReferences: [{ authorityType: "PRODUCT" as const, authorityId: PRODUCT }] })),
    hooks: [], setupPayoffs: [], requiredSceneOutcomes: [],
    authorityReferences: [{ authorityType: "CAMPAIGN" as const, authorityId: CAMPAIGN }, { authorityType: "PRODUCT" as const, authorityId: PRODUCT }],
    upstreamAuthorityId: STORY_VERSION, supersedesOutlineVersionId: null, createdBy: ACTOR, createdAt: "2026-09-28T00:00:00.000Z",
  }));
  const script = frozen(buildAiStoryScriptVersion({
    storyId: STORY, storyVersionId: STORY_VERSION, outlineVersionId: outline.outlineVersionId, orgId: ORG, workspaceId: WORKSPACE,
    version: 1, profileId: "CORE", profileVersion: 1, outlineSourceHash: outline.sourceHash,
    scenes: rows.map((row) => ({
      scriptSceneId: row.scriptSceneId, order: row.order,
      outlineBeatClaims: [{ outlineBeatId: id(60 + row.order), claim: row.information }],
      sceneFunction: row.sceneFunction, sceneFunctionRegistryVersion: 1 as const,
      sceneStateIn: row.entry.map((fact) => ({ dimension: fact.dimension as "KNOWLEDGE" | "PRODUCT_STATE", subjectId: fact.subjectId, value: fact.value })),
      sceneStateDeltas: row.deltas.map((fact) => ({ dimension: fact.dimension as "KNOWLEDGE" | "PRODUCT_STATE", subjectId: fact.subjectId, value: fact.value, fromValue: fact.fromValue ?? null, reason: fact.reason ?? "Persisted state change" })),
      sceneStateOut: row.exit.map((fact) => ({ dimension: fact.dimension as "KNOWLEDGE" | "PRODUCT_STATE", subjectId: fact.subjectId, value: fact.value })),
      entries: [{ entryId: row.actionId, order: 0, type: "ACTION" as const, subjectId: CHARACTER, action: "The character continues the story.", storyEffect: "The scene advances", durationRange: { minSeconds: 2, maxSeconds: 4 }, stateDelta: { dimension: "KNOWLEDGE" as const, subjectId: CHARACTER, value: row.knowledgeDelta.value, fromValue: row.knowledgeDelta.fromValue ?? null, reason: "The scene changes what the character knows" } }],
      characterIds: [CHARACTER], locationIds: [], propIds: [], assetIds: row.productScene ? [PRODUCT] : [], productAuthorityRefs: row.productScene ? [PRODUCT] : [],
      targetDurationRange: { minSeconds: 3, maxSeconds: 8 }, mustKeep: ["Visible subject"], mustAvoid: ["Invented identity"],
      newInformation: [row.information], newEvidence: [], newActionOutcomes: ["The scene advances"], productEvidence: [],
    })),
    authorityReferences: [{ authorityType: "CHARACTER" as const, authorityId: CHARACTER }, { authorityType: "PRODUCT" as const, authorityId: PRODUCT }, { authorityType: "ASSET" as const, authorityId: PRODUCT }],
    supersedesScriptVersionId: null, createdBy: ACTOR, createdAt: "2026-09-28T00:02:00.000Z",
  }));
  const handoff = buildAiStoryScriptDirectorHandoff({
    script,
    productAuthorityBindings: [{ productAuthorityId: PRODUCT, sourceAssetId: PRODUCT, sourceAssetContentHash: HASH, requiredRoles: ["PRESENT"] }],
    supersedesHandoffId: null, createdBy: ACTOR, createdAt: "2026-09-28T00:03:00.000Z",
  });
  const projected = source(rows);
  const sceneDirections = projectEpisodeDirectorScenes(projected);
  const sceneMotionPlans = projectEpisodeMotionScenes(projected, sceneDirections);
  const directorPlan = {
    directorPlanId: id(91), storyId: STORY, storyVersionId: STORY_VERSION, outlineVersionId: outline.outlineVersionId, scriptVersionId: script.scriptVersionId,
    handoffId: handoff.handoffId, orgId: ORG, workspaceId: WORKSPACE, campaignId: CAMPAIGN, animationPackageId: id(90), version: 1,
    contractVersion: "ai-story-director-plan.episode-projected.v1" as const, sourceHandoffFingerprint: handoff.handoffFingerprint,
    sceneDirections, sourceHash: HASH, directorFingerprint: HASH, status: "FROZEN" as const, supersedesDirectorPlanId: null,
    createdBy: ACTOR, createdAt: "2026-09-28T00:04:00.000Z", approvedBy: ACTOR, approvedAt: "2026-09-28T00:04:00.000Z", frozenAt: "2026-09-28T00:04:00.000Z",
  };
  const motionPlan = {
    motionPlanId: id(92), storyId: STORY, storyVersionId: STORY_VERSION, outlineVersionId: outline.outlineVersionId, scriptVersionId: script.scriptVersionId,
    handoffId: handoff.handoffId, directorPlanId: directorPlan.directorPlanId, orgId: ORG, workspaceId: WORKSPACE, campaignId: CAMPAIGN, animationPackageId: id(90), version: 1,
    contractVersion: "ai-story-motion-plan.episode-projected.v1" as const, sourceDirectorFingerprint: directorPlan.directorFingerprint,
    sceneMotionPlans, sourceHash: HASH, motionFingerprint: HASH, status: "FROZEN" as const, supersedesMotionPlanId: null,
    createdBy: ACTOR, createdAt: "2026-09-28T00:05:00.000Z", approvedBy: ACTOR, approvedAt: "2026-09-28T00:05:00.000Z", frozenAt: "2026-09-28T00:05:00.000Z",
  };
  return { outline, script, handoff, directorPlan, motionPlan, rows };
}

function execution(order: number, overrides: Partial<ProjectedQcSceneExecutionRecord> = {}): ProjectedQcSceneExecutionRecord {
  const row = specs()[order]!;
  return {
    sceneExecutionId: EXECUTIONS[order]!,
    sceneId: row.canonicalSceneId,
    sceneOrder: order,
    executionPlanId: PLAN,
    orgId: ORG, workspaceId: WORKSPACE, campaignId: CAMPAIGN, storyId: STORY, storyVersionId: STORY_VERSION,
    ...overrides,
  };
}

function targetFor(order: number, built = story()): ProjectedQcTargetScene {
  return resolveProjectedQcTargetScene({
    scope: { orgId: ORG, workspaceId: WORKSPACE, campaignId: CAMPAIGN, storyId: STORY, storyVersionId: STORY_VERSION },
    execution: execution(order),
    canonicalScenes: built.directorPlan.sceneDirections.map((scene) => ({ sceneId: scene.canonicalSceneId, sceneVersionId: scene.canonicalSceneVersionId, order: scene.sceneOrder, sourceScriptSceneIds: [scene.scriptSceneId] })),
    scriptScenes: built.script.scenes.map((scene) => ({ scriptSceneId: scene.scriptSceneId, order: scene.order })),
    directorScenes: built.directorPlan.sceneDirections,
    motionScenes: built.motionPlan.sceneMotionPlans,
  });
}

function evaluate(order: number, input?: ReturnType<typeof story>) {
  const built = input ?? story();
  const row = built.rows[order]!;
  return evaluateEpisodeProjectedPreGenerationQc({
    outline: built.outline,
    script: built.script,
    handoff: built.handoff,
    directorPlan: built.directorPlan,
    motionPlan: built.motionPlan,
    targetScene: targetFor(order, built),
    productAuthority: [{ productAuthorityId: PRODUCT, sourceAssetId: PRODUCT, sourceAssetContentHash: HASH }],
    providerCapability: { capabilityId: "animation-video-generation", capabilityVersion: "seedance-adapter.1.0.0", supportedExecutionModes: ["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"], supportedReferenceRoles: ["PRODUCT_REFERENCE"], supportedTimingStructures: ["SINGLE_SCENE"], estimatedAttemptCostUsd: 0.35, verified: true },
    compilationRequest: { sceneExecutionId: EXECUTIONS[order]!, requestedCapabilityId: "animation-video-generation", executionMode: row.productScene ? "FIRST_FRAME_IMAGE_TO_VIDEO" : "TEXT_TO_VIDEO", referenceRoles: row.productScene ? ["PRODUCT_REFERENCE"] : [], timingStructure: "SINGLE_SCENE", providerNeutralInputsComplete: true },
    knownAuthorityReferences: includeValidatedCampaignAuthority(new Set([`PRODUCT:${PRODUCT}`, `CHARACTER:${CHARACTER}`, `ASSET:${PRODUCT}`]), CAMPAIGN),
    campaignId: CAMPAIGN,
    currentAuthority: { outlineVersionId: built.outline.outlineVersionId, scriptVersionId: built.script.scriptVersionId, handoffId: built.handoff.handoffId, directorPlanId: built.directorPlan.directorPlanId, motionPlanId: built.motionPlan.motionPlanId },
    evaluatedBy: ACTOR,
    evaluatedAt: "2026-09-28T00:06:00.000Z",
  });
}

function gate(evaluation: ReturnType<typeof evaluate>, gateId: string) {
  return evaluation.gateResults.find((result) => result.gateId === gateId)!;
}

describe("scene-scoped projected pre-generation QC", () => {
  it("documents story, scene, and adjacent gate classification", () => {
    expect(AI_STORY_PROJECTED_QC_GATE_CLASSIFICATION.scene).toEqual(expect.arrayContaining([
      "MOTION_ACTION_COMPLETION_GATE",
      "MOTION_PHYSICAL_PLAUSIBILITY_GATE",
      "PRODUCT_GROUNDED_MOTION_SAFETY_GATE",
      "SUBJECT_MOTION_FIRST_CLASS_GATE",
      "SUBJECT_MOTION_COMPLETION_GATE",
      "PROVIDER_CAPABILITY_GATE",
      "PROVIDER_COMPILATION_READINESS_GATE",
    ]));
    expect(AI_STORY_PROJECTED_QC_GATE_CLASSIFICATION.story).toEqual(expect.arrayContaining(["UPSTREAM_ARTIFACT_INTEGRITY_GATE", "SCRIPT_STATE_CONTINUITY_GATE", "HANDOFF_INTEGRITY_GATE"]));
    expect(AI_STORY_PROJECTED_QC_GATE_CLASSIFICATION.boundary).toEqual(["MOTION_CONTINUITY_GATE", "CINEMATIC_CAMERA_GRAMMAR_GATE", "CONTINUITY_NOT_DUPLICATION_GATE"]);
  });

  it("resolves a scene execution to one canonical, script, director, and motion scene", () => {
    const target = targetFor(1);
    expect(target).toMatchObject({ sceneExecutionId: EXECUTIONS[1], sceneId: id(21), sceneOrder: 1, executionPlanId: PLAN, scriptSceneId: id(11), canonicalSceneId: id(21), canonicalSceneVersionId: id(31) });
  });

  it("fails closed when the scene execution scope or lineage does not match", () => {
    const built = story();
    const base = { scope: { orgId: ORG, workspaceId: WORKSPACE, campaignId: CAMPAIGN, storyId: STORY, storyVersionId: STORY_VERSION }, canonicalScenes: built.directorPlan.sceneDirections.map((scene) => ({ sceneId: scene.canonicalSceneId, sceneVersionId: scene.canonicalSceneVersionId, order: scene.sceneOrder, sourceScriptSceneIds: [scene.scriptSceneId] })), scriptScenes: built.script.scenes, directorScenes: built.directorPlan.sceneDirections, motionScenes: built.motionPlan.sceneMotionPlans };
    expect(() => resolveProjectedQcTargetScene({ ...base, execution: execution(0, { workspaceId: id(99) }) })).toThrow(ProjectedQcTargetSceneError);
    expect(() => resolveProjectedQcTargetScene({ ...base, execution: execution(0, { sceneId: id(99) }) })).toThrow(/exactly one Canonical Scene/);
    expect(() => resolveProjectedQcTargetScene({ ...base, execution: execution(0, { sceneOrder: 4, sceneId: id(20) }) })).toThrow(/exactly one Canonical Scene/);
    expect(() => resolveProjectedQcTargetScene({ ...base, execution: execution(0), scriptScenes: [...built.script.scenes, { ...built.script.scenes[0]!, order: 9 }] })).toThrow(/Script Scene order/);
  });

  it("keeps product-scene blockers on their own evaluations", () => {
    const built = story();
    const scene0 = evaluate(0, built);
    const scene1 = evaluate(1, built);
    const scene2 = evaluate(2, built);
    const scene3 = evaluate(3, built);
    const scene4 = evaluate(4, built);
    for (const evaluation of [scene0, scene3, scene4]) {
      expect(gate(evaluation, "MOTION_ACTION_COMPLETION_GATE").status).toBe("PASS");
      expect(gate(evaluation, "PRODUCT_GROUNDED_MOTION_SAFETY_GATE").status).toBe("PASS");
      expect(gate(evaluation, "SUBJECT_MOTION_FIRST_CLASS_GATE").status).toBe("PASS");
      expect(gate(evaluation, "SUBJECT_MOTION_COMPLETION_GATE").status).toBe("PASS");
      expect(gate(evaluation, "MOTION_PHYSICAL_PLAUSIBILITY_GATE").status).toBe("PASS");
      expect(evaluation.productGrounded).toBe(false);
    }
    for (const evaluation of [scene1, scene2]) {
      expect(gate(evaluation, "MOTION_ACTION_COMPLETION_GATE").status).toBe("BLOCK");
      expect(gate(evaluation, "PRODUCT_GROUNDED_MOTION_SAFETY_GATE").status).toBe("BLOCK");
      expect(gate(evaluation, "PRODUCT_GROUNDED_MOTION_SAFETY_GATE").safeEvidence.join(" ")).toContain("PROJECTED_PRODUCT_CAMERA_SAFETY_EVIDENCE_REQUIRED");
      expect(evaluation.productGrounded).toBe(true);
      expect(evaluation.motionRiskClass).toBe("HIGH");
    }
    expect(gate(scene1, "MOTION_ACTION_COMPLETION_GATE").safeEvidence.join(" ")).toContain(id(11));
    expect(gate(scene1, "MOTION_ACTION_COMPLETION_GATE").safeEvidence.join(" ")).not.toContain(id(12));
    expect(gate(scene0, "MOTION_ACTION_COMPLETION_GATE").safeEvidence).toEqual([]);
  });

  it("uses the target scene for metadata and leaves authored QC on its own contract", () => {
    const built = story();
    const opening = evaluate(0, built);
    const product = evaluate(1, built);
    expect(opening.sceneFunction).toBe("INTRODUCE");
    expect(opening.visualRole).toBe("Purpose 0");
    expect(opening.cameraFamily).toBe("STATIC");
    expect(opening.motionRiskClass).toBe("LOW");
    expect(product.sceneFunction).toBe("PRODUCT_DETAIL_REVEAL");
    expect(product.visualRole).toBe("Purpose 1");
    expect(product.cameraFamily).toBe("SLOW_PUSH_IN");
    expect(product.sceneFunction).not.toBe(built.directorPlan.sceneDirections[0]?.sceneFunction);
    const draft = evaluateEpisodeProjectedPreGenerationQc({
      ...{
        outline: { ...built.outline, status: "DRAFT" as const },
        script: built.script,
        handoff: built.handoff,
        directorPlan: built.directorPlan,
        motionPlan: built.motionPlan,
        productAuthority: [{ productAuthorityId: PRODUCT, sourceAssetId: PRODUCT, sourceAssetContentHash: HASH }],
        providerCapability: { capabilityId: "animation-video-generation", capabilityVersion: "seedance-adapter.1.0.0", supportedExecutionModes: ["TEXT_TO_VIDEO"], supportedReferenceRoles: ["PRODUCT_REFERENCE"], supportedTimingStructures: ["SINGLE_SCENE"], estimatedAttemptCostUsd: null, verified: true },
        knownAuthorityReferences: includeValidatedCampaignAuthority(new Set([`PRODUCT:${PRODUCT}`, `CHARACTER:${CHARACTER}`, `ASSET:${PRODUCT}`]), CAMPAIGN),
        campaignId: CAMPAIGN,
        currentAuthority: { outlineVersionId: built.outline.outlineVersionId, scriptVersionId: built.script.scriptVersionId, handoffId: built.handoff.handoffId, directorPlanId: built.directorPlan.directorPlanId, motionPlanId: built.motionPlan.motionPlanId },
        evaluatedBy: ACTOR,
        evaluatedAt: "2026-09-28T00:06:00.000Z",
      },
      targetScene: targetFor(3, built),
      compilationRequest: { sceneExecutionId: EXECUTIONS[3]!, requestedCapabilityId: "animation-video-generation", executionMode: "TEXT_TO_VIDEO", referenceRoles: [], timingStructure: "SINGLE_SCENE", providerNeutralInputsComplete: true },
    });
    const other = evaluate(4, { ...built, outline: { ...built.outline, status: "DRAFT" } });
    expect(gate(draft, "UPSTREAM_ARTIFACT_INTEGRITY_GATE").status).toBe("BLOCK");
    expect(gate(other, "UPSTREAM_ARTIFACT_INTEGRITY_GATE").status).toBe("BLOCK");
    const authored = readFileSync("packages/shared/src/ai-story-pre-generation-qc.server.ts", "utf8");
    const projected = readFileSync("packages/shared/src/ai-story-episode-projected-qc.server.ts", "utf8");
    const request = readFileSync("packages/shared/src/ai-story-pre-generation-qc.ts", "utf8");
    expect(authored).toContain("sceneDirections[0]?.sceneVisualRole");
    expect(projected).not.toContain("sceneDirections[0]");
    expect(request).not.toContain("scriptSceneId:");
    expect(evaluateAiStoryPreGenerationQc).toBeTypeOf("function");
    const service = readFileSync("packages/db/src/queries/ai-story-pre-generation-qc.ts", "utf8");
    expect(service).toContain("resolveProjectedQcTargetScene");
    expect(service).not.toContain("update(schema.aiStoryPreGenerationQcEvaluations)");
    expect(service).toContain("evaluationVersion:prior.length+1");
  });
});
