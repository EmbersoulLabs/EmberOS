import { describe, expect, it } from "vitest";
import {
  AiStoryAuthoritativeSceneProductBindingSchema,
  AiStoryCanonicalSceneSchema,
  AiStoryLegacySceneProductBindingSchema,
  type AiStoryCanonicalScene,
} from "@ceo-agent/shared";
import {
  computeAiStorySceneFingerprint,
  computeAiStorySceneSourceHash,
  finalizeAiStoryCanonicalScene,
} from "@ceo-agent/shared/server";
import {
  AiStoryCanonicalSceneAuthorityService,
} from "../packages/db/src/queries/ai-story-scene-authority";

const id = (n: number) => `9a000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (hex: string) => `sha256:${hex.repeat(64)}`;
const productA = { productAuthorityId: id(20), sourceAssetId: id(20), sourceAssetContentHash: hash("a") };
const productB = { productAuthorityId: id(21), sourceAssetId: id(21), sourceAssetContentHash: hash("a") };

function sceneInput(requirement: "NONE" | "PREFERRED" | "REQUIRED") {
  return {
    sceneId:id(1),orgId:id(2),workspaceId:id(3),campaignId:id(4),storyId:id(5),storyVersionId:id(6),scriptVersionId:id(7),
    version:1,order:0,sourceScriptSceneIds:[id(8)],sourceScriptEntryIds:[id(9)],sceneFunction:"PRODUCT_DETAIL_REVEAL",
    sceneRole:"REVEAL",importance:"MAJOR" as const,
    locationBinding:{scope:"EPHEMERAL_ENVIRONMENT" as const,id:id(10),storyId:id(5),sceneId:id(1),displayName:"Scene location",environmentDescription:"Canonical Scene location",visualIdentityRequirement:"NONE" as const},
    locationState:{temporaryFacts:[]},castBindings:[],
    productBindings:[{...productA,visualIdentityRequirement:requirement}],
    entryState:[{dimension:"PRODUCT_STATE" as const,subjectId:id(20),value:"concealed"}],
    events:[{entryId:id(9),order:0,type:"ACTION" as const,subjectId:id(11),objectId:id(20),action:"The Product is revealed.",storyEffect:"Product evidence becomes visible",durationRange:{minSeconds:1,maxSeconds:3}}],
    exitState:[{dimension:"PRODUCT_STATE" as const,subjectId:id(20),value:"revealed"}],continuityFacts:[],timeRelation:"UNSPECIFIED" as const,discontinuity:null,
    mustKeep:[],mustAvoid:[],lineageOperation:"CREATE" as const,parentSceneVersionIds:[],createdBy:id(12),createdAt:"2026-09-11T00:00:00.000Z",
  };
}

function legacySnapshot(): AiStoryCanonicalScene {
  const current = finalizeAiStoryCanonicalScene(sceneInput("REQUIRED"));
  const legacy = {
    ...current,
    productBindings:current.productBindings.map(({ visualIdentityRequirement: _requirement, ...binding }) => binding),
  } as AiStoryCanonicalScene;
  legacy.sourceHash = computeAiStorySceneSourceHash(legacy);
  legacy.fingerprint = computeAiStorySceneFingerprint(legacy);
  return legacy;
}

describe("AI Story Scene Product visual identity requirement authority", () => {
  it.each(["NONE", "PREFERRED", "REQUIRED"] as const)("accepts an explicit %s authority value", (visualIdentityRequirement) => {
    const scene = finalizeAiStoryCanonicalScene(sceneInput(visualIdentityRequirement));
    expect(scene.productBindings[0]).toMatchObject({...productA,visualIdentityRequirement});
  });

  it("requires explicit authority for every new canonical Scene Product binding", () => {
    expect(AiStoryAuthoritativeSceneProductBindingSchema.safeParse(productA).success).toBe(false);
    expect(() => finalizeAiStoryCanonicalScene({...sceneInput("NONE"),productBindings:[productA]} as never)).toThrow();
  });

  it("rejects a legacy binding before a new Scene proposal reaches persistence", async () => {
    const service = new AiStoryCanonicalSceneAuthorityService({} as never);
    await expect(service.proposeRevisionSet({
      orgId:id(2),workspaceId:id(3),campaignId:id(4),storyId:id(5),storyVersionId:id(6),actorUserId:id(12),
    }, [legacySnapshot()])).rejects.toMatchObject({
      code:"SCENE_PRODUCT_VISUAL_IDENTITY_REQUIREMENT_REQUIRED",
    });
  });

  it("reads legacy absence without manufacturing NONE, PREFERRED, or REQUIRED", () => {
    const legacy = legacySnapshot();
    const parsed = AiStoryCanonicalSceneSchema.parse(legacy);
    expect(AiStoryLegacySceneProductBindingSchema.safeParse(parsed.productBindings[0]).success).toBe(true);
    expect(parsed.productBindings[0]).not.toHaveProperty("visualIdentityRequirement");
    expect(computeAiStorySceneSourceHash(parsed)).toBe(legacy.sourceHash);
    expect(computeAiStorySceneFingerprint(parsed)).toBe(legacy.fingerprint);
  });

  it("changes Scene sourceHash, fingerprint, and version identity when the requirement changes", () => {
    const preferred = finalizeAiStoryCanonicalScene(sceneInput("PREFERRED"));
    const required = finalizeAiStoryCanonicalScene(sceneInput("REQUIRED"));
    expect(required.productBindings[0]).toMatchObject(productA);
    expect(preferred.productBindings[0]).toMatchObject(productA);
    expect(required.sourceHash).not.toBe(preferred.sourceHash);
    expect(required.fingerprint).not.toBe(preferred.fingerprint);
    expect(required.sceneVersionId).not.toBe(preferred.sceneVersionId);
  });

  it("keeps requirements independent for multiple exact Products", () => {
    const scene = finalizeAiStoryCanonicalScene({
      ...sceneInput("REQUIRED"),
      productBindings:[
        {...productA,visualIdentityRequirement:"REQUIRED"},
        {...productB,visualIdentityRequirement:"NONE"},
      ],
    });
    expect(scene.productBindings).toEqual([
      {...productA,visualIdentityRequirement:"REQUIRED"},
      {...productB,visualIdentityRequirement:"NONE"},
    ]);
    expect(scene.productBindings[0]!.productAuthorityId).not.toBe(scene.productBindings[1]!.productAuthorityId);
  });

  it("does not infer authority from presence, evidence, material, or generation facts", () => {
    for (const unrelated of [
      {productPresent:true},
      {productEvidence:["visible"]},
      {derivativeStatus:"FOUND"},
      {productVisualIdentityRequirement:"REQUIRED"},
    ]) {
      expect(AiStoryAuthoritativeSceneProductBindingSchema.safeParse({...productA,...unrelated}).success).toBe(false);
    }
  });

  it("keeps distinct Asset identities distinct even when their content hashes match", () => {
    const a=AiStoryAuthoritativeSceneProductBindingSchema.parse({...productA,visualIdentityRequirement:"REQUIRED"});
    const b=AiStoryAuthoritativeSceneProductBindingSchema.parse({...productB,visualIdentityRequirement:"REQUIRED"});
    expect(a.sourceAssetContentHash).toBe(b.sourceAssetContentHash);
    expect(a.sourceAssetId).not.toBe(b.sourceAssetId);
    expect(a.productAuthorityId).not.toBe(b.productAuthorityId);
  });
});
