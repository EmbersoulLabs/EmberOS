import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AiStoryScriptSceneSchema,
  ShotPlanItemSchema,
  bindCommercialProductActionStateDelta,
  bindProductShotCameraSafety,
  evaluateCommercialProductActionCausality,
  projectEpisodeDirectorScenes,
  provePersistedProductCameraSafety,
  resolveProductCameraSafety,
  type EpisodeProjectedAuthoritySource,
} from "@ceo-agent/shared";
import { integrityHash } from "../packages/agents/src/ai-story/scene-execution-compiler";

const SCENE = "11f18b40-ffd0-5bf3-91e3-868eb269242f";
const BEAT = "77777777-7777-4777-8777-777777777777";
const CHARACTER = "f27c169e-4292-4617-9f6f-2272ba88f914";
const PRODUCT = "70235a91-8f48-4f2d-a7fe-65cd2cc973f8";
const ACTION = "ab97bcd8-0675-5616-8dc4-a6c0b250080f";
const STORY = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const WORKSPACE = "44444444-4444-4444-8444-444444444444";

function scene(extra?: { secondAction?: boolean; extraDelta?: boolean; productSubject?: string }) {
  const productSubject = extra?.productSubject ?? PRODUCT;
  return AiStoryScriptSceneSchema.parse({
    scriptSceneId: SCENE,
    order: 1,
    outlineBeatClaims: [{ outlineBeatId: BEAT, claim: "The product is revealed" }],
    sceneFunction: "REVEAL",
    sceneFunctionRegistryVersion: 1,
    sceneStateIn: [
      { dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "curious" },
      { dimension: "PRODUCT_STATE", subjectId: productSubject, value: "sealed" },
    ],
    sceneStateDeltas: [
      { dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "recognizing", fromValue: "curious", reason: "The character notices the product" },
      { dimension: "PRODUCT_STATE", subjectId: productSubject, value: "revealed", fromValue: "sealed", reason: "The action reveals the product" },
      ...(extra?.extraDelta ? [{ dimension: "LOCATION" as const, subjectId: productSubject, value: "table", fromValue: "counter", reason: "The product also moves" }] : []),
    ],
    sceneStateOut: [
      { dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "recognizing" },
      { dimension: "PRODUCT_STATE", subjectId: productSubject, value: "revealed" },
    ],
    entries: [
      {
        entryId: ACTION,
        order: 0,
        durationRange: { minSeconds: 1, maxSeconds: 8 },
        type: "ACTION" as const,
        subjectId: CHARACTER,
        action: "The character opens the sealed product.",
        storyEffect: "The product becomes revealed",
        stateDelta: { dimension: "KNOWLEDGE" as const, subjectId: CHARACTER, value: "recognizing", fromValue: "curious", reason: "The character notices the product" },
      },
      ...(extra?.secondAction ? [{
        entryId: BEAT,
        order: 1,
        durationRange: { minSeconds: 1, maxSeconds: 2 },
        type: "ACTION" as const,
        subjectId: CHARACTER,
        action: "The character also turns the product.",
        storyEffect: "A second action competes",
      }] : []),
    ],
    characterIds: [CHARACTER],
    locationIds: [],
    propIds: [],
    assetIds: [],
    productAuthorityRefs: [PRODUCT],
    targetDurationRange: { minSeconds: 8, maxSeconds: 10 },
    mustKeep: ["Product identity"],
    mustAvoid: ["Morphing"],
    newInformation: ["The product is revealed"],
    newEvidence: [],
    newActionOutcomes: ["The product is revealed"],
    productEvidence: ["The sealed product is revealed"],
  });
}

describe("product dispatch authority repair", () => {
  it("keeps historical shots readable and binds only policy-proven product camera safety", () => {
    const historical = ShotPlanItemSchema.parse({
      id: "shot-1", sceneId: "scene-001", cameraType: "static", cameraMovement: "none",
      composition: "wide", framing: "medium", durationSec: 10, focus: "subject", emotion: "calm", information: "Arrival", order: 0,
    });
    expect(historical.cameraSafety).toBeUndefined();
    const productScene = { id: "scene-002", generationAuthority: { productVisualIdentityRequirement: "REQUIRED" as const } };
    const plain = { id: "scene-001", generationAuthority: { productVisualIdentityRequirement: "NONE" as const } };
    expect(() => bindProductShotCameraSafety({
      scenePlan: [productScene],
      shotPlan: [{ id: "shot-2", sceneId: "scene-002", cameraType: "static", cameraMovement: "orbit" }],
    })).toThrow("PRODUCT_CAMERA_SAFETY_POLICY_INSUFFICIENT");
    expect(resolveProductCameraSafety("pan")).toBeNull();
    expect(resolveProductCameraSafety("handheld")).toBeNull();
    const bound = bindProductShotCameraSafety({
      scenePlan: [plain, productScene],
      shotPlan: [
        { id: "shot-1", sceneId: "scene-001", cameraType: "static", cameraMovement: "none" },
        { id: "shot-2", sceneId: "scene-002", cameraType: "static", cameraMovement: "slow push-in" },
      ],
    });
    expect(bound[0]?.cameraSafety).toBeUndefined();
    expect(bound[1]?.cameraSafety).toMatchObject({
      perspectiveChange: "MINIMAL",
      revealsUnseenProductSurface: false,
      productIdentityTransformation: false,
      policyId: "product-grounded-video-identity-safe-camera.v1",
      policyVersion: 1,
      evidenceSource: "PRODUCT_GROUNDED_VIDEO_IDENTITY_SAFE_CAMERA_RESTRICTION",
      cameraFamily: "SLOW_PUSH_IN",
    });
    const tampered = { ...bound[1]!, cameraSafety: { ...bound[1]!.cameraSafety!, perspectiveChange: "LARGE" as const } };
    expect(provePersistedProductCameraSafety(tampered)).toBeNull();
    expect(integrityHash(bound[1]?.cameraSafety)).not.toBe(integrityHash(tampered.cameraSafety));
  });

  it("preserves scene knowledge while binding the product state change to the single action", () => {
    const repaired = bindCommercialProductActionStateDelta(scene());
    expect(repaired.sceneStateDeltas.map((delta) => delta.dimension)).toEqual(["KNOWLEDGE", "PRODUCT_STATE"]);
    expect(repaired.entries[0]).toMatchObject({
      action: "The character opens the sealed product.",
      stateDelta: { dimension: "PRODUCT_STATE", subjectId: PRODUCT, fromValue: "sealed", value: "revealed" },
    });
    expect(evaluateCommercialProductActionCausality({ scenes: [repaired] })).toEqual([]);
    expect(evaluateCommercialProductActionCausality({ scenes: [scene()] }).map((issue) => issue.gate)).toEqual(["COMMERCIAL_PRODUCT_ACTION_CAUSALITY_REQUIRED"]);
    const wrong = bindCommercialProductActionStateDelta(scene());
    const action = wrong.entries[0];
    if (action?.type !== "ACTION" || !action.stateDelta) throw new Error("repaired action missing");
    wrong.entries[0] = { ...action, stateDelta: { ...action.stateDelta, fromValue: "open" } };
    expect(evaluateCommercialProductActionCausality({ scenes: [wrong] })).toHaveLength(1);
    expect(() => bindCommercialProductActionStateDelta(scene({ extraDelta: true }))).toThrow("ACTION_STATE_DELTA_CARDINALITY_BLOCKER");
    expect(() => bindCommercialProductActionStateDelta(scene({ secondAction: true }))).toThrow("ACTION_STATE_DELTA_CARDINALITY_BLOCKER");
    const composer = readFileSync("packages/shared/src/ai-story-canonical-scene-composer.server.ts", "utf8");
    expect(composer).toContain("events: structuredClone(scriptScene.entries)");
    const producer = readFileSync("apps/web/src/lib/ai-story-canonical-script-producer.ts", "utf8");
    expect(producer).toContain("evaluateCommercialProductActionCausality(script)");
    const planner = readFileSync("packages/agents/src/ai-story/story-planning-service.ts", "utf8");
    expect(planner.indexOf("bindProductShotCameraSafety")).toBeLessThan(planner.indexOf("bindShotPlanAuthorityLineage({"));
  });

  it("projects product camera safety only from a policy-matching shot record", () => {
    const source = projectedSource();
    const blocked = projectEpisodeDirectorScenes(source);
    expect(blocked[1]?.shots[0]?.perspectiveChange).toEqual({ state: "NOT_ASSERTED" });
    const safety = resolveProductCameraSafety("slow push-in");
    const proven = projectEpisodeDirectorScenes({
      ...source,
      shotPlan: source.shotPlan.map((shot) => shot.id === "shot-2" ? { ...shot, cameraSafety: safety! } : shot),
    });
    expect(proven[1]?.shots[0]?.perspectiveChange).toEqual({ state: "KNOWN", value: "MINIMAL" });
    expect(proven[1]?.shots[0]?.revealsUnseenProductSurface).toEqual({ state: "KNOWN", value: false });
    expect(proven[1]?.shots[0]?.productIdentityTransformation).toEqual({ state: "KNOWN", value: false });
    expect(proven[0]?.shots[0]?.perspectiveChange).toEqual({ state: "NOT_ASSERTED" });
  });
});

function projectedSource(): EpisodeProjectedAuthoritySource {
  return {
    animationPackageId: STORY,
    scriptScenes: [{
      scriptSceneId: BEAT, order: 0, sceneFunction: "INTRODUCE",
      actions: [{ entryId: ACTION, action: "The character continues the story.", subjectId: CHARACTER }],
      sceneStateIn: [{ dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "before" }],
      sceneStateDeltas: [{ dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "after", fromValue: "before" }],
      sceneStateOut: [{ dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "after" }],
      productEvidence: [], productAuthorityRefs: [], propIds: [],
    }, {
      scriptSceneId: SCENE, order: 1, sceneFunction: "REVEAL",
      actions: [{ entryId: ACTION, action: "The character reveals the accepted product.", subjectId: CHARACTER }],
      sceneStateIn: [{ dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "after" }],
      sceneStateDeltas: [{ dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "shown", fromValue: "after" }],
      sceneStateOut: [{ dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "shown" }],
      productEvidence: [], productAuthorityRefs: [], propIds: [],
    }],
    canonicalScenes: [{
      sceneId: STORY, sceneVersionId: VERSION, fingerprint: `sha256:${"a".repeat(64)}`, order: 0, sceneFunction: "INTRODUCE",
      sourceScriptSceneIds: [BEAT], entryState: [{ dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "before" }],
      events: [{ entryId: ACTION, type: "ACTION", action: "The character continues the story.", subjectId: CHARACTER, objectId: null, stateDelta: null }],
      exitState: [{ dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "after" }], productBindingIds: [], mustKeep: [], mustAvoid: [],
      generationAuthority: { strategy: "TEXT_TO_VIDEO", referenceSource: "REFERENCE_FREE_T2V", referenceAssetIds: [], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" },
    }, {
      sceneId: WORKSPACE, sceneVersionId: ORG, fingerprint: `sha256:${"b".repeat(64)}`, order: 1, sceneFunction: "REVEAL",
      sourceScriptSceneIds: [SCENE], entryState: [{ dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "after" }],
      events: [{ entryId: ACTION, type: "ACTION", action: "The character reveals the accepted product.", subjectId: CHARACTER, objectId: null, stateDelta: null }],
      exitState: [{ dimension: "KNOWLEDGE", subjectId: CHARACTER, value: "shown" }], productBindingIds: [PRODUCT], mustKeep: [], mustAvoid: [],
      generationAuthority: { strategy: "FIRST_FRAME_IMAGE_TO_VIDEO", referenceSource: "SCENE_EXPLICIT", referenceAssetIds: [PRODUCT], firstFrameAssetId: PRODUCT, productVisualIdentityRequirement: "REQUIRED" },
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
