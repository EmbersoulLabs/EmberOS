import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AI_STORY_EXACT_PRODUCT_DERIVATIVE_RESOLUTION_VERSION,
  type AiStoryCanonicalScene,
} from "@ceo-agent/shared";
import {
  deriveProductBackgroundSuitabilityAuthority,
  deriveProductVisualMaterialSelectionAuthority,
  finalizeAiStoryCanonicalScene,
} from "@ceo-agent/shared/server";
import {
  CurrentSceneProductAuthorityResolutionError,
  resolveCurrentSceneProductAuthority,
} from "../apps/web/src/lib/ai-story-resolved-product-authority";

const id = (n: number) => `9b000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (hex: string) => `sha256:${hex.repeat(64)}`;
const I = {
  org:id(1),workspace:id(2),campaign:id(3),story:id(4),storyVersion:id(5),scene:id(6),script:id(7),scriptScene:id(8),entry:id(9),actor:id(10),productA:id(11),productB:id(12),environment:id(13),character:id(14),
};

function canonicalScene(
  requirement: "NONE" | "PREFERRED" | "REQUIRED" = "REQUIRED",
  sourceHash = hash("a")
) {
  return finalizeAiStoryCanonicalScene({
    sceneId:I.scene,orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:I.story,storyVersionId:I.storyVersion,scriptVersionId:I.script,
    version:1,order:0,sourceScriptSceneIds:[I.scriptScene],sourceScriptEntryIds:[I.entry],sceneFunction:"PRODUCT_DETAIL_REVEAL",sceneRole:"REVEAL",importance:"MAJOR",
    locationBinding:{scope:"EPHEMERAL_ENVIRONMENT",id:I.environment,storyId:I.story,sceneId:I.scene,displayName:"Scene location",environmentDescription:"Canonical environment",visualIdentityRequirement:"NONE"},
    locationState:{temporaryFacts:[]},castBindings:[],productBindings:[
      {productAuthorityId:I.productA,sourceAssetId:I.productA,sourceAssetContentHash:sourceHash,visualIdentityRequirement:requirement},
      {productAuthorityId:I.productB,sourceAssetId:I.productB,sourceAssetContentHash:hash("b"),visualIdentityRequirement:"NONE"},
    ],
    entryState:[
      {dimension:"PRODUCT_STATE",subjectId:I.productA,value:"sealed"},
      {dimension:"PRODUCT_STATE",subjectId:I.productB,value:"hidden"},
      {dimension:"LOCATION",subjectId:I.character,value:"counter"},
    ],
    events:[{entryId:I.entry,order:0,type:"ACTION",subjectId:I.character,objectId:I.productA,action:"The canonical Product is presented.",storyEffect:"Product state advances",durationRange:{minSeconds:1,maxSeconds:3}}],
    exitState:[
      {dimension:"PRODUCT_STATE",subjectId:I.productA,value:"revealed"},
      {dimension:"PRODUCT_STATE",subjectId:I.productA,value:"revealed"},
      {dimension:"PRODUCT_STATE",subjectId:I.productB,value:"displayed elsewhere"},
    ],
    continuityFacts:[],timeRelation:"UNSPECIFIED",discontinuity:null,mustKeep:["Scene-wide preservation"],mustAvoid:["Scene-wide prohibition"],lineageOperation:"CREATE",parentSceneVersionIds:[],createdBy:I.actor,createdAt:"2026-09-11T01:00:00.000Z",
  });
}

function source(assetId = I.productA, contentHash = hash("a")) {
  return {storyId:I.story,assetId,usageType:"product_source" as const,orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,contentHash,status:"ready"};
}

function dependencies(options: {
  storyVersionId?: string | null;
  scenes?: readonly AiStoryCanonicalScene[];
  sources?: ReturnType<typeof source>[];
  sceneError?: Error;
} = {}) {
  const readCurrentScenes = vi.fn(async (_db: never, input: {storyVersionId:string}) => {
    if (options.sceneError) throw options.sceneError;
    expect(input.storyVersionId).toBe(options.storyVersionId === undefined ? I.storyVersion : options.storyVersionId);
    return options.scenes ?? [canonicalScene()];
  });
  return {
    value: {
      loadCurrentStoryVersionId:vi.fn(async () => options.storyVersionId === undefined ? I.storyVersion : options.storyVersionId),
      readCurrentScenes,
      resolveProductSources:vi.fn(async () => options.sources ?? [source(),source(I.productB,hash("b"))]),
    },
    readCurrentScenes,
  };
}

const input = {orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:I.story,sceneId:I.scene,productAuthorityId:I.productA,actorUserId:I.actor};

async function resolve(options: Parameters<typeof dependencies>[0] = {}, overrides: Record<string, unknown> = {}) {
  const deps = dependencies(options);
  const result = await resolveCurrentSceneProductAuthority({} as never, {...input,...overrides}, deps.value as never);
  return {result,deps};
}

describe("current Scene Product runtime authority resolution", () => {
  it("resolves one exact current Product from the current Story and Scene pointers", async () => {
    const {result,deps}=await resolve();
    expect(result).toMatchObject({productAuthorityId:I.productA,sourceAssetId:I.productA,sourceAssetContentHash:hash("a"),visualIdentityRequirement:"REQUIRED"});
    expect(deps.readCurrentScenes).toHaveBeenCalledOnce();
  });

  it("fails closed when the Story current pointer is absent", async () => {
    await expect(resolve({storyVersionId:null})).rejects.toMatchObject({code:"CURRENT_STORY_VERSION_REQUIRED"});
  });

  it("uses the server current Story pointer and rejects a Scene from a historical Story version", async () => {
    const historical={...canonicalScene(),storyVersionId:id(90)};
    await expect(resolve({scenes:[historical]})).rejects.toMatchObject({code:"CURRENT_CANONICAL_SCENE_REQUIRED"});
  });

  it("propagates canonical Scene fingerprint rejection", async () => {
    const error=new Error("SCENE_FINGERPRINT_INVALID");
    await expect(resolve({sceneError:error})).rejects.toBe(error);
  });

  it("rejects a Product not bound to the current Scene", async () => {
    await expect(resolve({}, {productAuthorityId:id(99)})).rejects.toMatchObject({code:"CURRENT_SCENE_PRODUCT_BINDING_REQUIRED"});
  });

  it("rejects a legacy Product binding with unresolved visual requirement", async () => {
    const current=canonicalScene();
    const legacy={...current,productBindings:current.productBindings.map((binding,index)=>index===0?((({visualIdentityRequirement:_requirement,...rest})=>rest)(binding)):binding)} as AiStoryCanonicalScene;
    await expect(resolve({scenes:[legacy]})).rejects.toMatchObject({code:"SCENE_PRODUCT_VISUAL_IDENTITY_REQUIREMENT_UNRESOLVED"});
  });

  it("rejects Story source hash mismatch and same-hash cross-Asset substitution", async () => {
    await expect(resolve({sources:[source(I.productA,hash("c"))]})).rejects.toMatchObject({code:"CURRENT_STORY_PRODUCT_SOURCE_MISMATCH"});
    await expect(resolve({sources:[source(I.productB,hash("a"))]})).rejects.toMatchObject({code:"CURRENT_STORY_PRODUCT_SOURCE_MISMATCH"});
  });

  it.each(["NONE","PREFERRED","REQUIRED"] as const)("preserves explicit %s without inference", async (requirement) => {
    const {result}=await resolve({scenes:[canonicalScene(requirement)]});
    expect(result.visualIdentityRequirement).toBe(requirement);
  });

  it("projects only exact Product state with deterministic deduplication", async () => {
    const {result}=await resolve();
    expect(result.sceneStateFacts).toEqual(["PRODUCT_STATE: revealed","PRODUCT_STATE: sealed"]);
    expect(result.sceneStateFacts.join(" ")).not.toContain("hidden");
    expect(result.sceneStateFacts.join(" ")).not.toContain("counter");
  });

  it("does not reclassify Scene-wide evidence or preservation constraints", async () => {
    const {result}=await resolve();
    expect(result.visibleEvidenceGoals).toEqual([]);
    expect(result.mustKeep).toEqual([]);
    expect(result.mustAvoid).toEqual([]);
  });

  it("uses only exact source identity facts and ignores client semantic fields", async () => {
    const {result}=await resolve({}, {visualIdentityRequirement:"NONE",identityFacts:["invented"],filename:"red-product.png"});
    expect(result.visualIdentityRequirement).toBe("REQUIRED");
    expect(result.displayName).toBe(`Product ${I.productA}`);
    expect(result.identityFacts).toEqual([`Canonical Product source ${I.productA} with content identity ${hash("a")}`]);
  });

  it("resolves multiple Products independently without state or requirement leakage", async () => {
    const a=(await resolve()).result;
    const b=(await resolve({}, {productAuthorityId:I.productB})).result;
    expect(a.visualIdentityRequirement).toBe("REQUIRED");
    expect(b.visualIdentityRequirement).toBe("NONE");
    expect(a.sceneStateFacts).toEqual(["PRODUCT_STATE: revealed","PRODUCT_STATE: sealed"]);
    expect(b.sceneStateFacts).toEqual(["PRODUCT_STATE: displayed elsewhere","PRODUCT_STATE: hidden"]);
  });

  it("is deterministic for identical current authority", async () => {
    expect((await resolve()).result).toEqual((await resolve()).result);
  });

  it("feeds the existing Product selector without changing Product identity", async () => {
    const bytes=Buffer.from("unsupported deterministic fixture");
    const sourceHash=`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const scene=canonicalScene("NONE",sourceHash);
    const resolved=(await resolve({scenes:[scene],sources:[source(I.productA,sourceHash),source(I.productB,hash("b"))]})).result;
    const suitability=deriveProductBackgroundSuitabilityAuthority({source:{orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,productAuthorityId:I.productA,sourceAssetId:I.productA,sourceAssetContentHash:sourceHash,mimeType:"application/octet-stream"},bytes});
    const selection=deriveProductVisualMaterialSelectionAuthority({
      sceneScope:{orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:I.story,storyVersionId:I.storyVersion,sceneId:I.scene,sceneVersionId:scene.sceneVersionId},
      sceneProductBinding:scene.productBindings[0]!,resolvedProductAuthority:resolved,
      effectiveGenerationAuthority:{strategy:"TEXT_TO_VIDEO",referenceSource:"REFERENCE_FREE_T2V",effectiveReferenceIds:[],firstFrameAssetId:null,productVisualIdentityRequirement:"NONE"},
      suitability,
      derivativeResolution:{contractVersion:AI_STORY_EXACT_PRODUCT_DERIVATIVE_RESOLUTION_VERSION,status:"NOT_FOUND",productAuthorityId:I.productA,sourceAssetId:I.productA,sourceAssetContentHash:sourceHash,reason:"NO_READY_EXTRACTION"},
    });
    expect(selection.productAuthority).toEqual({productAuthorityId:I.productA,sourceAssetId:I.productA,sourceAssetContentHash:sourceHash});
    expect(selection.selection).toBe("NO_PRODUCT_VISUAL_INPUT");
  });

  it("uses a read-only production module with no mutation, preparation, queue, Provider, or effective-generation dependency", async () => {
    const sourceText=await import("node:fs/promises").then((fs)=>fs.readFile("apps/web/src/lib/ai-story-resolved-product-authority.ts","utf8"));
    for(const forbidden of [".insert(",".update(",".delete(","requestProductExtraction","retryProductExtraction","enqueuePhotoSceneExtract","resolveEffectiveSceneGenerationAuthority"]){
      expect(sourceText).not.toContain(forbidden);
    }
    expect(sourceText).toContain("schema.aiStories.currentVersionId");
    expect(sourceText).toContain("AiStoryCanonicalSceneAuthorityService");
    expect(sourceText).toContain("resolveStoryProductSources");
  });

  it("uses bounded authority error values", () => {
    expect(new CurrentSceneProductAuthorityResolutionError("TEST","message")).toMatchObject({code:"TEST",message:"message"});
  });
});
