import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SceneSchedulingError, resolveCurrentEpisodeCompilationAuthority } from "@ceo-agent/agents";
import {
  AiStoryDirectorShotSchema,
  AiStoryMotionActionExecutionSchema,
  EpisodeDispatchProjectionError,
  EpisodeProjectedAuthorityError,
  assertEpisodeProjectionReuse,
  collectProjectedEvidenceStates,
  projectEpisodeDirectorScenes,
  projectEpisodeMotionScenes,
  type EpisodeProjectedAuthoritySource,
} from "@ceo-agent/shared";
import { ensureCurrentEpisodeDispatchAuthorityProjection } from "../packages/db/src/queries/ai-story-episode-dispatch-authority";

const SCRIPT_A = "11111111-1111-4111-8111-111111111111";
const SCRIPT_B = "11111111-1111-4111-8111-111111111112";
const CANON_A = "22222222-2222-4222-8222-222222222222";
const CANON_B = "22222222-2222-4222-8222-222222222223";
const VERSION_A = "33333333-3333-4333-8333-333333333333";
const VERSION_B = "33333333-3333-4333-8333-333333333334";
const PRODUCT = "44444444-4444-4444-8444-444444444444";
const ACTION_A = "55555555-5555-4555-8555-555555555555";
const ACTION_B = "55555555-5555-4555-8555-555555555556";
const SUBJECT = "66666666-6666-4666-8666-666666666666";
const PACKAGE = "88888888-8888-4888-8888-888888888888";
const HASH = `sha256:${"a".repeat(64)}`;

const generation = {
  strategy: "TEXT_TO_VIDEO" as const,
  referenceSource: "REFERENCE_FREE_T2V" as const,
  referenceAssetIds: [],
  firstFrameAssetId: null,
  productVisualIdentityRequirement: "NONE" as const,
};

function scene(input: {
  scriptSceneId: string;
  order: number;
  sceneFunction: string;
  sceneId: string;
  sceneVersionId: string;
  planId: string;
  actionId: string;
  information: string;
  composition: string;
  dimension?: string;
}) {
  return {
    script: {
      scriptSceneId: input.scriptSceneId,
      order: input.order,
      sceneFunction: input.sceneFunction,
      actions: [{ entryId: input.actionId, action: "The character continues the story.", subjectId: SUBJECT }],
      sceneStateIn: [{ dimension: input.dimension ?? "KNOWLEDGE", subjectId: SUBJECT, value: "before" }],
      sceneStateDeltas: [{ dimension: input.dimension ?? "KNOWLEDGE", subjectId: SUBJECT, value: "after", fromValue: "before", reason: "The scene changes what the character knows" }],
      sceneStateOut: [{ dimension: input.dimension ?? "KNOWLEDGE", subjectId: SUBJECT, value: "after" }],
      productEvidence: [],
      productAuthorityRefs: [],
      propIds: [],
    },
    canonical: {
      sceneId: input.sceneId,
      sceneVersionId: input.sceneVersionId,
      fingerprint: HASH,
      order: input.order,
      sceneFunction: input.sceneFunction,
      sourceScriptSceneIds: [input.scriptSceneId],
      entryState: [{ dimension: input.dimension ?? "KNOWLEDGE", subjectId: SUBJECT, value: "before" }],
      events: [{ entryId: input.actionId, type: "ACTION" as const, action: "The character continues the story.", subjectId: SUBJECT, objectId: null, stateDelta: null }],
      exitState: [{ dimension: input.dimension ?? "KNOWLEDGE", subjectId: SUBJECT, value: "after" }],
      productBindingIds: [],
      mustKeep: [],
      mustAvoid: [],
      generationAuthority: generation,
    },
    plan: { id: input.planId, order: input.order, purpose: `Purpose ${input.order}`, continuityNotes: "", durationSec: 10 },
    shot: {
      id: `${input.planId}-shot`,
      sceneId: input.planId,
      order: input.order,
      cameraType: "static",
      cameraMovement: input.order === 0 ? "none" : "slow push-in",
      composition: input.composition,
      framing: "medium shot",
      focus: "on customer",
      information: input.information,
      durationSec: 10,
    },
  };
}

const first = scene({ scriptSceneId: SCRIPT_A, order: 0, sceneFunction: "INTRODUCE", sceneId: CANON_A, sceneVersionId: VERSION_A, planId: "scene-001", actionId: ACTION_A, information: "The customer explores the menu.", composition: "customer looking at the menu" });
const second = scene({ scriptSceneId: SCRIPT_B, order: 1, sceneFunction: "REVEAL", sceneId: CANON_B, sceneVersionId: VERSION_B, planId: "scene-002", actionId: ACTION_B, information: "The customer selects the dish.", composition: "close-up of the dish" });

const source: EpisodeProjectedAuthoritySource = {
  animationPackageId: PACKAGE,
  scriptScenes: [first.script, second.script],
  canonicalScenes: [first.canonical, second.canonical],
  scenePlan: [first.plan, second.plan],
  shotPlan: [first.shot, second.shot],
};

describe("episode projected director and motion authority", () => {
  it("keeps authored V1 shot and action contracts strict", () => {
    const shot = {
      directorShotId: PRODUCT, order: 0, shotPurpose: "SHOW_EVIDENCE", shotPurposeRegistryVersion: 1, shotSize: "MACRO",
      cameraIntent: "hold", cameraFamily: "LOCKED", focusTarget: { kind: "PRODUCT", authorityRefs: [PRODUCT], semanticLabel: "Product" },
      focusProgression: [{ kind: "PRODUCT", authorityRefs: [PRODUCT], semanticLabel: "Product" }], compositionIntent: "PRODUCT_DOMINANT",
      productEmphasis: null, newAudienceInformation: ["evidence"], blockingIntents: [], revealsUnseenProductSurface: false, productIdentityTransformation: false,
    };
    expect(AiStoryDirectorShotSchema.safeParse(shot).success).toBe(false);
    expect(AiStoryDirectorShotSchema.safeParse({ ...shot, perspectiveChange: "MINIMAL" }).success).toBe(true);
    expect(AiStoryMotionActionExecutionSchema.safeParse({
      actionExecutionId: PRODUCT, scriptActionEntryId: ACTION_A, semanticAction: "move", dominance: "DOMINANT",
      startState: [{ entityId: PRODUCT, property: "PRODUCT_STATE", value: "intact", exclusive: true }],
      endState: [{ entityId: PRODUCT, property: "PRODUCT_STATE", value: "intact", exclusive: true }],
      completionAssertions: [{ entityId: PRODUCT, property: "PRODUCT_STATE", expectedValue: "intact" }],
      objectInteractions: [], forceResponses: [],
    }).success).toBe(false);
  });

  it("projects only persisted episode facts and tags unknown safety as NOT_ASSERTED", () => {
    const director = projectEpisodeDirectorScenes(source);
    const motion = projectEpisodeMotionScenes(source, director);
    expect(director[0]?.sceneFunction).toBe("INTRODUCE");
    expect(director[0]?.shots[0]?.cameraMovement).toBe("none");
    expect(director[0]?.shots[0]?.perspectiveChange).toEqual({ state: "NOT_ASSERTED" });
    expect(director[0]?.shots[0]?.revealsUnseenProductSurface).toEqual({ state: "NOT_ASSERTED" });
    expect(director[0]?.shots[0]?.productIdentityTransformation).toEqual({ state: "NOT_ASSERTED" });
    expect(JSON.stringify(director[0]?.shots[0])).not.toContain("false");
    expect(JSON.stringify(director[0]?.shots[0])).not.toContain("MINIMAL");
    expect(director[0]?.differentiation).toEqual({ state: "NOT_APPLICABLE", reason: "Opening Scene has no prior comparison baseline" });
    expect(director[1]?.differentiation).toMatchObject({ state: "KNOWN", value: { comparedToScriptSceneId: SCRIPT_A } });
    expect(motion[0]?.sceneStateDeltas[0]?.dimension).toBe("KNOWLEDGE");
    expect(JSON.stringify(motion)).not.toContain("CUSTOM");
    expect(motion[0]).not.toHaveProperty("actionPath");
    expect(motion[0]).not.toHaveProperty("motionBudget");
    expect(motion[0]?.shots[0]).not.toHaveProperty("startCameraState");
    expect(motion[0]?.shots[0]).not.toHaveProperty("endCameraState");
    expect(motion[0]?.cameraStateBoundary).toEqual({ state: "NOT_ASSERTED" });
    expect(motion[0]?.physicalCompletion.state).toBe("NOT_APPLICABLE");
    const evidence = collectProjectedEvidenceStates(director[0]);
    expect(evidence.notAsserted.length).toBeGreaterThan(0);
    expect(evidence.notApplicable).toContain("differentiation");
  });

  it("fails closed when canonical scene function contradicts the script", () => {
    expect(() => projectEpisodeDirectorScenes({
      ...source,
      canonicalScenes: [{ ...source.canonicalScenes[0]!, sceneFunction: "PAYOFF" }, source.canonicalScenes[1]!],
    })).toThrow(EpisodeProjectedAuthorityError);
  });

  it("reuses an identical projection fingerprint and rejects a source conflict", () => {
    expect(projectEpisodeDirectorScenes(source)).toEqual(projectEpisodeDirectorScenes(source));
    expect(assertEpisodeProjectionReuse({ currentSemanticHash: null, projectedSemanticHash: HASH })).toBe("CREATE");
    expect(assertEpisodeProjectionReuse({ currentSemanticHash: HASH, projectedSemanticHash: HASH })).toBe("REUSE");
    expect(() => assertEpisodeProjectionReuse({ currentSemanticHash: `sha256:${"b".repeat(64)}`, projectedSemanticHash: HASH })).toThrow(EpisodeDispatchProjectionError);
  });

  it("projects through handoff then director then motion without a model", async () => {
    const orchestrator = readFileSync("packages/db/src/queries/ai-story-episode-dispatch-authority.ts", "utf8");
    const projector = readFileSync("packages/shared/src/ai-story-episode-projected-authority.ts", "utf8");
    expect(projector).not.toMatch(/generateDirectorThinking|openai|llm/i);
    expect(orchestrator).toContain("createFromFrozenScript");
    expect(orchestrator).toContain("projectFromEpisodeAuthority");
    expect(orchestrator).not.toContain("propose(");
    const calls: string[] = [];
    const result = await ensureCurrentEpisodeDispatchAuthorityProjection({
      orgId: PRODUCT, workspaceId: PRODUCT, campaignId: PRODUCT, storyId: PRODUCT, storyVersionId: PRODUCT, actorUserId: PRODUCT,
    }, {} as never, {
      load: async () => ({ scriptVersionId: SCRIPT_A, source }),
      createHandoff: async (_scope, scriptVersionId) => {
        calls.push(scriptVersionId);
        return { handoffId: "77777777-7777-4777-8777-777777777777" };
      },
      projectDirector: async () => ({ directorPlanId: CANON_A, directorFingerprint: HASH, status: "FROZEN" }),
      projectMotion: async () => ({ motionPlanId: CANON_B, motionFingerprint: HASH, status: "FROZEN" }),
    });
    expect(calls).toEqual([SCRIPT_A]);
    expect(result).toMatchObject({ directorPlanId: CANON_A, motionPlanId: CANON_B, directorStatus: "FROZEN", motionStatus: "FROZEN" });
  });

  it("requires persisted QC for current episode execution and keeps historical hash fallback distinct", () => {
    const persisted = { qcEvaluationId: "persisted" };
    const historical = { qcEvaluationId: "historical" };
    expect(resolveCurrentEpisodeCompilationAuthority({ sceneVersionId: VERSION_A, persistedAuthority: persisted, historicalInstructionAuthority: historical })).toEqual({ authority: persisted, source: "PERSISTED_QC" });
    expect(resolveCurrentEpisodeCompilationAuthority({ sceneVersionId: null, persistedAuthority: null, historicalInstructionAuthority: historical })).toEqual({ authority: historical, source: "HISTORICAL_INSTRUCTION_HASH" });
    expect(() => resolveCurrentEpisodeCompilationAuthority({ sceneVersionId: VERSION_A, persistedAuthority: null, historicalInstructionAuthority: historical })).toThrow(SceneSchedulingError);
    expect(readFileSync("packages/agents/src/ai-story/scene-scheduling-coordinator.ts", "utf8")).not.toContain("persistedCompilationAuthority ??");
  });
});
