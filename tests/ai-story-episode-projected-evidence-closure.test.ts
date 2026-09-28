import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateEpisodeProjectedCameraExecution,
  projectEpisodeDirectorScenes,
  projectEpisodeMotionScenes,
  projectedProductCameraSafetyProven,
  proveEpisodeProjectedPhysicalCompletion,
  validateAiStoryOutline,
  type EpisodeProjectedAuthoritySource,
} from "@ceo-agent/shared";
import { buildAiStoryOutlineVersion, includeValidatedCampaignAuthority } from "@ceo-agent/shared/server";

const CAMPAIGN = "9ac283f9-aa42-44a8-9b67-54843497b066";
const OTHER_CAMPAIGN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORY = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const WORKSPACE = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
const UNIT = "66666666-6666-4666-8666-666666666666";
const BEAT = "77777777-7777-4777-8777-777777777777";
const SUBJECT = "88888888-8888-4888-8888-888888888888";
const ACTION = "99999999-9999-4999-8999-999999999999";

function completion(input: {
  dimension?: string;
  fromValue?: string | null;
  toValue?: string;
  entryValue?: string;
  exitValue?: string;
  actionDelta?: boolean;
  eventDelta?: boolean;
  extraDelta?: { dimension: string; fromValue: string; value: string } | null;
}) {
  const dimension = input.dimension ?? "PRODUCT_STATE";
  const fromValue = input.fromValue === undefined ? "sealed" : input.fromValue;
  const toValue = input.toValue ?? "revealed";
  const delta = fromValue == null ? { dimension, subjectId: SUBJECT, value: toValue } : { dimension, subjectId: SUBJECT, value: toValue, fromValue };
  const extra = input.extraDelta ? { dimension: input.extraDelta.dimension, subjectId: SUBJECT, value: input.extraDelta.value, fromValue: input.extraDelta.fromValue } : null;
  return proveEpisodeProjectedPhysicalCompletion({
    actions: [{
      entryId: ACTION,
      semanticAction: "The character reveals the accepted product.",
      stateDelta: input.actionDelta === false ? null : delta,
    }],
    sceneStateDeltas: extra ? [delta, extra] : [delta],
    entryState: [{ dimension, subjectId: SUBJECT, value: input.entryValue ?? "sealed" }],
    exitState: [{ dimension, subjectId: SUBJECT, value: input.exitValue ?? "revealed" }],
    events: [{
      entryId: ACTION,
      action: "The character reveals the accepted product.",
      stateDelta: input.eventDelta === false ? null : delta,
    }],
  });
}

describe("projected QC evidence closure", () => {
  it("adds only the validated Campaign scope to the known authority set", () => {
    const known = includeValidatedCampaignAuthority(new Set(["PRODUCT:70235a91-8f48-4f2d-a7fe-65cd2cc973f8"]), CAMPAIGN);
    expect(known.has(`CAMPAIGN:${CAMPAIGN}`)).toBe(true);
    expect(known.has(`CAMPAIGN:${OTHER_CAMPAIGN}`)).toBe(false);
    const outline = buildAiStoryOutlineVersion({
      storyId: STORY, storyVersionId: VERSION, orgId: ORG, workspaceId: WORKSPACE, version: 1,
      profile: { profileId: "CORE", profileVersion: 1 },
      premise: "A product is revealed", coreClaim: "The same product remains identifiable",
      storyUnits: [{ storyUnitId: UNIT, order: 0, purpose: "Reveal", summary: "Reveal the product", requiredBeatIds: [BEAT] }],
      beats: [{ id: BEAT, storyUnitId: UNIT, order: 0, classification: "MAJOR", name: "Reveal", purpose: "Show the product", summary: "The product is revealed", required: true, ownershipPolicy: "EXCLUSIVE", authorityReferences: [{ authorityType: "CAMPAIGN", authorityId: CAMPAIGN }] }],
      hooks: [], setupPayoffs: [], requiredSceneOutcomes: [],
      authorityReferences: [{ authorityType: "CAMPAIGN", authorityId: CAMPAIGN }],
      upstreamAuthorityId: VERSION, supersedesOutlineVersionId: null, createdBy: USER, createdAt: "2026-09-28T00:00:00.000Z",
    });
    expect(validateAiStoryOutline(outline, { knownAuthorityReferences: known }).some((issue) => issue.gate === "AUTHORITY_REFERENCE_GATE")).toBe(false);
    expect(validateAiStoryOutline(outline, { knownAuthorityReferences: includeValidatedCampaignAuthority(new Set(), OTHER_CAMPAIGN) }).some((issue) => issue.message === `Unknown authority reference CAMPAIGN:${CAMPAIGN}`)).toBe(true);
  });

  it("proves physical completion only when script, entry, exit, and event lineage agree", () => {
    expect(completion({})).toEqual({ state: "KNOWN", value: { dimension: "PRODUCT_STATE", fromValue: "sealed", toValue: "revealed" } });
    expect(completion({ entryValue: "open" })).toEqual({ state: "NOT_ASSERTED" });
    expect(completion({ exitValue: "served" })).toEqual({ state: "NOT_ASSERTED" });
    expect(completion({ fromValue: null }).state).toBe("NOT_ASSERTED");
    expect(completion({ dimension: "KNOWLEDGE", fromValue: "unaware", toValue: "curious", entryValue: "unaware", exitValue: "curious" })).toEqual({ state: "NOT_APPLICABLE", reason: "No persisted physical state change requires a completion path" });
    expect(completion({ extraDelta: { dimension: "LOCATION", fromValue: "counter", value: "table" } })).toEqual({ state: "NOT_ASSERTED" });
    expect(completion({ actionDelta: false })).toEqual({ state: "NOT_ASSERTED" });
    expect(completion({ eventDelta: false })).toEqual({ state: "NOT_ASSERTED" });
  });

  it("certifies bounded persisted shot evidence without fabricating camera state", () => {
    expect(evaluateEpisodeProjectedCameraExecution([{ cameraType: "static", cameraMovement: "none" }])).toEqual({ outcome: "BOUNDED_CAMERA_EXECUTION_PROVEN", families: ["STATIC"] });
    expect(evaluateEpisodeProjectedCameraExecution([{ cameraType: "static", cameraMovement: "slow push-in" }])).toEqual({ outcome: "BOUNDED_CAMERA_EXECUTION_PROVEN", families: ["SLOW_PUSH_IN"] });
    expect(evaluateEpisodeProjectedCameraExecution([{ cameraType: "static", cameraMovement: "orbit" }]).outcome).toBe("CAMERA_EXECUTION_NOT_PROVEN");
    expect(evaluateEpisodeProjectedCameraExecution([{ cameraType: "static", cameraMovement: "dramatic crane" }]).outcome).toBe("CAMERA_EXECUTION_NOT_PROVEN");
    const source = projectedSource();
    const director = projectEpisodeDirectorScenes(source);
    const motion = projectEpisodeMotionScenes(source, director);
    expect(motion[0]?.cameraStateBoundary).toEqual({ state: "NOT_ASSERTED" });
    expect(JSON.stringify(motion)).not.toContain("startCameraState");
    expect(JSON.stringify(motion)).not.toContain("endCameraState");
    expect(projectedProductCameraSafetyProven(director[1]!.shots[0]!)).toBe(false);
    expect(director[1]?.shots[0]?.perspectiveChange).toEqual({ state: "NOT_ASSERTED" });
    expect(projectedProductCameraSafetyProven({
      perspectiveChange: { state: "KNOWN" },
      revealsUnseenProductSurface: { state: "KNOWN" },
      productIdentityTransformation: { state: "KNOWN" },
    })).toBe(true);
  });

  it("keeps blocked QC rows immutable and versions the next evaluation", () => {
    const service = readFileSync("packages/db/src/queries/ai-story-pre-generation-qc.ts", "utf8");
    const sql = readFileSync("packages/db/sql/ai-story-pre-generation-qc-v1.sql", "utf8");
    expect(service).toContain("includeValidatedCampaignAuthority");
    expect(service).not.toContain("update(schema.aiStoryPreGenerationQcEvaluations)");
    expect(service).toContain("evaluationVersion:prior.length+1");
    expect(sql).toContain("Pre-Generation QC evidence is immutable");
  });
});

function projectedSource(): EpisodeProjectedAuthoritySource {
  return {
    animationPackageId: STORY,
    scriptScenes: [{
      scriptSceneId: BEAT, order: 0, sceneFunction: "INTRODUCE",
      actions: [{ entryId: ACTION, action: "The character continues the story.", subjectId: SUBJECT }],
      sceneStateIn: [{ dimension: "KNOWLEDGE", subjectId: SUBJECT, value: "before" }],
      sceneStateDeltas: [{ dimension: "KNOWLEDGE", subjectId: SUBJECT, value: "after", fromValue: "before" }],
      sceneStateOut: [{ dimension: "KNOWLEDGE", subjectId: SUBJECT, value: "after" }],
      productEvidence: [], productAuthorityRefs: [], propIds: [],
    }, {
      scriptSceneId: UNIT, order: 1, sceneFunction: "REVEAL",
      actions: [{ entryId: USER, action: "The character reveals the accepted product.", subjectId: SUBJECT }],
      sceneStateIn: [{ dimension: "KNOWLEDGE", subjectId: SUBJECT, value: "after" }],
      sceneStateDeltas: [{ dimension: "KNOWLEDGE", subjectId: SUBJECT, value: "shown", fromValue: "after" }],
      sceneStateOut: [{ dimension: "KNOWLEDGE", subjectId: SUBJECT, value: "shown" }],
      productEvidence: [], productAuthorityRefs: [], propIds: [],
    }],
    canonicalScenes: [{
      sceneId: STORY, sceneVersionId: VERSION, fingerprint: `sha256:${"a".repeat(64)}`, order: 0, sceneFunction: "INTRODUCE",
      sourceScriptSceneIds: [BEAT], entryState: [{ dimension: "KNOWLEDGE", subjectId: SUBJECT, value: "before" }],
      events: [{ entryId: ACTION, type: "ACTION", action: "The character continues the story.", subjectId: SUBJECT, objectId: null, stateDelta: null }],
      exitState: [{ dimension: "KNOWLEDGE", subjectId: SUBJECT, value: "after" }], productBindingIds: [], mustKeep: [], mustAvoid: [],
      generationAuthority: { strategy: "TEXT_TO_VIDEO", referenceSource: "REFERENCE_FREE_T2V", referenceAssetIds: [], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" },
    }, {
      sceneId: WORKSPACE, sceneVersionId: ORG, fingerprint: `sha256:${"b".repeat(64)}`, order: 1, sceneFunction: "REVEAL",
      sourceScriptSceneIds: [UNIT], entryState: [{ dimension: "KNOWLEDGE", subjectId: SUBJECT, value: "after" }],
      events: [{ entryId: USER, type: "ACTION", action: "The character reveals the accepted product.", subjectId: SUBJECT, objectId: null, stateDelta: null }],
      exitState: [{ dimension: "KNOWLEDGE", subjectId: SUBJECT, value: "shown" }], productBindingIds: [SUBJECT], mustKeep: [], mustAvoid: [],
      generationAuthority: { strategy: "FIRST_FRAME_IMAGE_TO_VIDEO", referenceSource: "SCENE_EXPLICIT", referenceAssetIds: [SUBJECT], firstFrameAssetId: SUBJECT, productVisualIdentityRequirement: "REQUIRED" },
    }],
    scenePlan: [
      { id: "scene-001", order: 0, purpose: "Introduce", continuityNotes: "", durationSec: 10 },
      { id: "scene-002", order: 1, purpose: "Reveal", continuityNotes: "", durationSec: 10 },
    ],
    shotPlan: [
      { id: "shot-1", sceneId: "scene-001", order: 0, cameraType: "static", cameraMovement: "none", composition: "wide", framing: "medium", focus: "subject", information: "The customer arrives.", durationSec: 10 },
      { id: "shot-2", sceneId: "scene-002", order: 0, cameraType: "static", cameraMovement: "slow push-in", composition: "close", framing: "close", focus: "product", information: "The product is revealed.", durationSec: 10 },
    ],
  };
}
