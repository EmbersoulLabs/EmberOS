import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
  AiStoryOutlineVersionSchema,
  AiStoryScriptSemanticProposalV1Schema,
  AiStoryScriptVersionSchema,
  assertExplicitAiStorySceneGenerationMode,
  type AiStoryScriptVersion,
} from "@ceo-agent/shared";
import {
  AiStoryCanonicalSceneComposerError,
  buildAiStoryScriptVersion,
  composeAiStoryCanonicalCommercialOutlineV1,
  composeAiStoryCanonicalOutlineV1,
  composeAiStoryCanonicalSceneSetV1,
  promoteAiStoryScriptSemanticProposalV1,
} from "@ceo-agent/shared/server";

const id = (n: number) => `8c000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const I = {
  org: id(1), workspace: id(2), campaign: id(3), story: id(4), storyVersion: id(5),
  actor: id(6), product: id(7), otherProduct: id(8), character: id(9), characterVersion: id(10),
  matching: id(11), binding: id(12), snapshot: id(13),
};
const PROFILE = { profileId: "COMMERCIAL_STORY" as const, profileVersion: 1 as const, policyFingerprint: AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT };
const STORY = {
  title: "Night Watch", summary: "A watch continues after a light is found", objective: "Can the watch continue",
  targetAudience: "Crews", tone: "Steady", estimatedDuration: "12s",
  story: { opening: "The watch starts dark", development: "A light is found", ending: "The watch continues" },
  keyMessages: ["The light keeps the watch going"], cta: "", assetReferences: [] as string[], warnings: [] as string[],
};
const BEATS = [
  { id: "beat-open", order: 0, name: "Dark", purpose: "Start the watch", summary: "The watch begins." },
  { id: "beat-light", order: 1, name: "Light", purpose: "Find the light", summary: "The light appears." },
  { id: "beat-continue", order: 2, name: "Continue", purpose: "Finish the watch", summary: "The watch continues." },
];
const T2V = { strategy: "TEXT_TO_VIDEO" as const, referenceSource: "REFERENCE_FREE_T2V" as const, referenceAssetIds: [] as string[], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" as const };
const explicit = (assetId: string, strategy: "FIRST_FRAME_IMAGE_TO_VIDEO" | "PRODUCT_GROUNDED_VIDEO" = "FIRST_FRAME_IMAGE_TO_VIDEO") => ({
  strategy, referenceSource: "SCENE_EXPLICIT" as const, referenceAssetIds: [assetId], firstFrameAssetId: assetId, productVisualIdentityRequirement: "REQUIRED" as const,
});
const grounding = (assetId: string, role: "PRODUCT_AUTHORITY" | "SUPPORTING_REFERENCE" = "PRODUCT_AUTHORITY") => ({
  contractVersion: "ai-story-scene-grounding-lineage.v1" as const,
  storyId: I.story, storyVersionId: I.storyVersion, matchingResultId: I.matching,
  narrativeIntent: "Open the watch", visualIntent: "Show the exact light",
  evidence: [{ bindingId: I.binding, assetId, role, semanticSnapshotId: I.snapshot, groundedFacts: ["Visible object"] }],
  visualClaims: [] as [],
});
const PLAN = [
  { id: "scene-plan-0", beatIds: [BEATS[0]!.id], purpose: "Open the dark watch", durationSec: 4, transition: "", continuityNotes: "", order: 0, generationAuthority: explicit(I.product), groundingLineage: grounding(I.product) },
  { id: "scene-plan-1", beatIds: [BEATS[1]!.id], purpose: "Raise the light", durationSec: 4, transition: "", continuityNotes: "", order: 1, generationAuthority: explicit(I.product), groundingLineage: grounding(I.product) },
  { id: "scene-plan-2", beatIds: [BEATS[2]!.id], purpose: "Continue the watch", durationSec: 4, transition: "", continuityNotes: "", order: 2, generationAuthority: T2V },
];
const CHARACTER = { characterId: I.character, characterVersionId: I.characterVersion, characterFingerprint: hash("c"), name: "Keeper", canonicalFacts: { identity: "Watch keeper", appearance: "Dark coat", personality: "Steady", emotionalArc: "Uncertainty to confidence", relationships: [] } };
const WORLD = { location: "Harbor", lighting: "Low", environment: "A working harbor at night", objects: ["Light"], timeline: "One night", worldRules: ["Weather stays calm"] };
const SOURCE_HASH = hash("f");

function outline() {
  const draft = composeAiStoryCanonicalCommercialOutlineV1({
    storyId: I.story, storyVersionId: I.storyVersion, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign,
    version: 1, profile: PROFILE, storyDraft: STORY, proposedStoryBeats: BEATS, campaignObjective: "awareness",
    customObjective: null, productAuthorityIds: [I.product],
    characterAuthorities: [{ characterId: I.character, characterVersionId: I.characterVersion, characterFingerprint: CHARACTER.characterFingerprint }],
    originalIdea: "Keep one watch supplied with one light.", supersedesOutlineVersionId: null,
    createdBy: I.actor, createdAt: "2026-10-02T00:00:00.000Z",
  });
  return AiStoryOutlineVersionSchema.parse({ ...draft, status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-10-02T00:01:00.000Z", frozenAt: "2026-10-02T00:02:00.000Z" });
}

function script(): AiStoryScriptVersion {
  const frozenOutline = outline();
  const dark = { dimension: "KNOWLEDGE" as const, subjectId: I.character, value: "watch is dark" };
  const found = { dimension: "KNOWLEDGE" as const, subjectId: I.character, value: "light found" };
  const committed = { dimension: "COMMITMENT" as const, subjectId: I.character, value: "watch continues" };
  const semantic = AiStoryScriptSemanticProposalV1Schema.parse({
    contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
    scenes: [
      { scenePlanItemId: PLAN[0]!.id, sceneFunction: "INTRODUCE", sceneFunctionRegistryVersion: 1, narrativeFunction: "HOOK", storyConsequence: "The audience meets a watch that cannot see", sceneStateIn: [dark], sceneStateDeltas: [], sceneStateOut: [dark], entries: [{ type: "ACTION", subjectId: I.character, action: "The keeper looks across the dark harbor.", storyEffect: "The watch starts without light." }], newInformation: ["The watch has started in the dark."], newActionOutcomes: ["The watch is underway."] },
      { scenePlanItemId: PLAN[1]!.id, sceneFunction: "REVEAL", sceneFunctionRegistryVersion: 1, narrativeFunction: "PRODUCT_INTERVENTION", storyConsequence: "Finding the light changes the watch", causalPreconditions: ["The watch has started in the dark"], commercialContribution: { commercialRole: "PRODUCT", narrativeFunction: "PRODUCT_INTERVENTION", participationKind: "REVEAL", commercialAuthorityIds: [I.product], preState: "watch is dark", postState: "light found", storyConsequence: "The light gives the watch a way to continue" }, sceneStateIn: [dark], sceneStateDeltas: [{ ...found, fromValue: "watch is dark", reason: "The light is found" }], sceneStateOut: [found], entries: [{ type: "ACTION", subjectId: I.character, objectId: I.product, action: "The keeper raises the light.", storyEffect: "The harbor becomes visible." }], newInformation: ["The light is what the watch needed."], newActionOutcomes: ["The watch can see."] },
      { scenePlanItemId: PLAN[2]!.id, sceneFunction: "PAYOFF", sceneFunctionRegistryVersion: 1, narrativeFunction: "RESOLVE", storyConsequence: "The watch finishes", causalPreconditions: ["The light has been found"], sceneStateIn: [found], sceneStateDeltas: [{ ...committed, fromValue: null, reason: "The lit harbor lets the watch continue" }], sceneStateOut: [found, committed], entries: [{ type: "ACTION", subjectId: I.character, action: "The keeper keeps watch.", storyEffect: "The watch finishes." }], newInformation: ["The watch continues."], newActionOutcomes: ["The harbor stays lit."] },
    ],
  });
  const material = promoteAiStoryScriptSemanticProposalV1({
    storyId: I.story, storyVersionId: I.storyVersion, frozenOutline, storyBeatProposals: BEATS,
    scenePlan: PLAN, characterAuthorities: [CHARACTER], semanticProposal: semantic,
  });
  const draft = buildAiStoryScriptVersion({
    storyId: I.story, storyVersionId: I.storyVersion, outlineVersionId: frozenOutline.outlineVersionId,
    orgId: I.org, workspaceId: I.workspace, version: 1, profileId: "COMMERCIAL_STORY", profileVersion: 1,
    outlineSourceHash: frozenOutline.sourceHash, semanticInputFingerprint: hash("a"),
    scenes: material.scenes, authorityReferences: material.authorityReferences,
    supersedesScriptVersionId: null, createdBy: I.actor, createdAt: "2026-10-02T00:10:00.000Z",
  });
  return AiStoryScriptVersionSchema.parse({ ...draft, status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-10-02T00:11:00.000Z", frozenAt: "2026-10-02T00:12:00.000Z" });
}

function compose(overrides: { scenePlan?: typeof PLAN; productSources?: { assetId: string; contentHash: string; confirmedVariant?: string }[]; frozenScript?: AiStoryScriptVersion } = {}) {
  return composeAiStoryCanonicalSceneSetV1({
    orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion,
    actorUserId: I.actor, frozenOutline: outline(), frozenScript: overrides.frozenScript ?? script(),
    scenePlan: overrides.scenePlan ?? PLAN, worldContinuity: WORLD, characterAuthorities: [CHARACTER],
    productSources: overrides.productSources ?? [{ assetId: I.product, contentHash: SOURCE_HASH, confirmedVariant: "north-facing" }],
    createdAt: "2026-10-02T00:20:00.000Z",
  });
}

describe("canonical scene first-frame material authority", () => {
  it("binds a commercial opening hook from grounded first-frame material when the script has no product participation", () => {
    const frozenScript = script();
    expect(frozenScript.scenes[0]!.narrativeFunction).toBe("HOOK");
    expect(frozenScript.scenes[0]!.productAuthorityRefs).toEqual([]);
    expect(frozenScript.scenes[0]!.commercialContribution).toBeUndefined();
    const scenes = compose({ frozenScript });
    expect(scenes[0]!.productBindings).toEqual([{
      productAuthorityId: I.product,
      sourceAssetId: I.product,
      sourceAssetContentHash: SOURCE_HASH,
      confirmedVariant: "north-facing",
      visualIdentityRequirement: "REQUIRED",
    }]);
    expect(frozenScript.scenes[0]!.productAuthorityRefs).toEqual([]);
    expect(frozenScript.scenes[0]!.commercialContribution).toBeUndefined();
    expect(scenes[0]).not.toHaveProperty("commercialContribution");
    expect(scenes[0]!.events).toEqual(frozenScript.scenes[0]!.entries);
    const groundedVideo = compose({
      frozenScript,
      scenePlan: PLAN.map((scene, index) => index === 0 ? { ...scene, generationAuthority: explicit(I.product, "PRODUCT_GROUNDED_VIDEO") } : scene),
    });
    expect(groundedVideo[0]!.productBindings).toEqual(scenes[0]!.productBindings);
  });

  it("deduplicates a script product ref that is the same first-frame product", () => {
    const frozenScript = script();
    expect(frozenScript.scenes[1]!.productAuthorityRefs).toEqual([I.product]);
    const scenes = compose({ frozenScript });
    expect(scenes[1]!.productBindings).toHaveLength(1);
    expect(scenes[1]!.productBindings[0]).toMatchObject({
      productAuthorityId: I.product, sourceAssetId: I.product, visualIdentityRequirement: "REQUIRED",
    });
  });

  it("fails closed when script product authority differs from the grounded first frame", () => {
    const frozenScript = script();
    frozenScript.scenes[1]!.productAuthorityRefs = [I.otherProduct];
    expect(() => compose({
      frozenScript,
      productSources: [
        { assetId: I.product, contentHash: SOURCE_HASH },
        { assetId: I.otherProduct, contentHash: hash("other") },
      ],
    })).toThrowError(expect.objectContaining({ code: "CANONICAL_SCENE_GENERATION_MODE_MATERIAL_MISMATCH" }));
  });

  it("fails closed when the first frame is absent from grounding or grounded only as a supporting reference", () => {
    const withoutGrounding = PLAN.map((scene, index) => index === 0 ? { ...scene, groundingLineage: undefined } : scene);
    expect(() => compose({ scenePlan: withoutGrounding })).toThrowError(expect.objectContaining({ code: "CANONICAL_SCENE_FIRST_FRAME_GROUNDING_AUTHORITY_INVALID" }));
    const supporting = PLAN.map((scene, index) => index === 0 ? { ...scene, groundingLineage: grounding(I.product, "SUPPORTING_REFERENCE") } : scene);
    expect(() => compose({ scenePlan: supporting })).toThrowError(expect.objectContaining({ code: "CANONICAL_SCENE_FIRST_FRAME_GROUNDING_AUTHORITY_INVALID" }));
  });

  it("fails closed when the grounded first-frame product source is missing", () => {
    expect(() => compose({ productSources: [{ assetId: I.otherProduct, contentHash: hash("other") }] })).toThrowError(
      expect.objectContaining({ code: "CANONICAL_SCENE_PRODUCT_AUTHORITY_UNRESOLVED" }),
    );
  });

  it("preserves the exact source hash and confirmed variant on the visual binding", () => {
    const binding = compose()[0]!.productBindings[0]!;
    expect(binding.sourceAssetContentHash).toBe(SOURCE_HASH);
    expect(binding.confirmedVariant).toBe("north-facing");
    const plain = compose({ productSources: [{ assetId: I.product, contentHash: SOURCE_HASH }] })[0]!.productBindings[0]!;
    expect(plain).not.toHaveProperty("confirmedVariant");
  });

  it("does not invent a product binding for a reference-free scene", () => {
    const scenes = compose();
    expect(scenes[2]!.generationAuthority?.referenceSource).toBe("REFERENCE_FREE_T2V");
    expect(scenes[2]!.productBindings).toEqual([]);
    expect(scenes.filter((scene) => scene.productBindings.length > 0).map((scene) => scene.order)).toEqual([0, 1]);
  });

  it("keeps the material mismatch gate closed for an empty explicit binding list", () => {
    expect(() => assertExplicitAiStorySceneGenerationMode({
      generationAuthority: explicit(I.product),
      productBindings: [],
    })).toThrow(expect.objectContaining({ code: "CANONICAL_SCENE_GENERATION_MODE_MATERIAL_MISMATCH" }));
  });

  it("keeps narrative product requirement for reference-free product story scenes", () => {
    const productProfile = { profileId: "PRODUCT_STORY" as const, profileVersion: 1 as const, policyFingerprint: AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT };
    const beats = [
      { id: "proposal-a", order: 0, name: "Introduce", purpose: "Introduce Product", summary: "Product appears." },
      { id: "proposal-b", order: 1, name: "Detail", purpose: "Reveal detail", summary: "Detail appears." },
    ];
    const plan = beats.map((beat, order) => ({
      id: `scene-plan-${order}`, beatIds: [beat.id], purpose: beat.purpose, durationSec: 4, transition: "", continuityNotes: "", order, generationAuthority: T2V,
    }));
    const draftOutline = composeAiStoryCanonicalOutlineV1({
      storyId: I.story, storyVersionId: I.storyVersion, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign,
      version: 1, profile: productProfile, storyDraft: { ...STORY, estimatedDuration: "8s" }, proposedStoryBeats: beats,
      campaignObjective: "awareness", customObjective: null, productAuthorityIds: [I.product],
      characterAuthorities: [{ characterId: I.character, characterVersionId: I.characterVersion, characterFingerprint: CHARACTER.characterFingerprint }],
      originalIdea: "Show one product.", supersedesOutlineVersionId: null, createdBy: I.actor, createdAt: "2026-10-02T00:00:00.000Z",
    });
    const frozenOutline = AiStoryOutlineVersionSchema.parse({ ...draftOutline, status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-10-02T00:01:00.000Z", frozenAt: "2026-10-02T00:02:00.000Z" });
    const material = promoteAiStoryScriptSemanticProposalV1({
      storyId: I.story, storyVersionId: I.storyVersion, frozenOutline, storyBeatProposals: beats, scenePlan: plan, characterAuthorities: [CHARACTER],
      semanticProposal: { contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION, scenes: [
        { scenePlanItemId: plan[0]!.id, sceneFunction: "PRODUCT_INTRODUCTION", sceneFunctionRegistryVersion: 1, sceneStateIn: [], sceneStateDeltas: [], sceneStateOut: [], entries: [{ type: "ACTION", subjectId: I.character, objectId: I.product, action: "Character presents Product.", storyEffect: "Product introduced." }], newInformation: ["Product present."], newActionOutcomes: ["Introduction complete."] },
        { scenePlanItemId: plan[1]!.id, sceneFunction: "PRODUCT_DETAIL_REVEAL", sceneFunctionRegistryVersion: 1, sceneStateIn: [], sceneStateDeltas: [], sceneStateOut: [], entries: [{ type: "ACTION", subjectId: I.product, action: "Product detail remains visible.", storyEffect: "Detail revealed." }], newInformation: ["Detail visible."], newActionOutcomes: ["Detail understood."] },
      ] },
    });
    const draft = buildAiStoryScriptVersion({
      storyId: I.story, storyVersionId: I.storyVersion, outlineVersionId: frozenOutline.outlineVersionId, orgId: I.org, workspaceId: I.workspace,
      version: 1, profileId: "PRODUCT_STORY", profileVersion: 1, outlineSourceHash: frozenOutline.sourceHash, semanticInputFingerprint: hash("b"),
      scenes: material.scenes, authorityReferences: material.authorityReferences, supersedesScriptVersionId: null, createdBy: I.actor, createdAt: "2026-10-02T00:10:00.000Z",
    });
    const frozenScript = AiStoryScriptVersionSchema.parse({ ...draft, status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-10-02T00:11:00.000Z", frozenAt: "2026-10-02T00:12:00.000Z" });
    frozenScript.scenes[1]!.productStoryContributions = [{ semanticFunction: "PRODUCT_CONTEXT", contributionTypes: ["NEW_PRODUCT_CONTEXT"], productAuthorityIds: [I.product], claimIds: [], summary: "Context only" }];
    const scenes = composeAiStoryCanonicalSceneSetV1({
      orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion,
      actorUserId: I.actor, frozenOutline, frozenScript, scenePlan: plan, worldContinuity: WORLD, characterAuthorities: [CHARACTER],
      productSources: [{ assetId: I.product, contentHash: hash("b") }], createdAt: "2026-10-02T00:20:00.000Z",
    });
    expect(scenes[0]!.productBindings[0]!.visualIdentityRequirement).toBe("REQUIRED");
    expect(scenes[1]!.productBindings[0]!.visualIdentityRequirement).toBe("PREFERRED");
    expect(scenes.every((scene) => scene.generationAuthority?.referenceSource === "REFERENCE_FREE_T2V")).toBe(true);
  });

  it("does not hardcode a story, character, product name, or failed asset", () => {
    const composer = readFileSync("packages/shared/src/ai-story-canonical-scene-composer.server.ts", "utf8");
    for (const token of ["Yuki", "Mini Fan", "Nasi Lemak", "70235a91-8f48-4f2d-a7fe-65cd2cc973f8"]) {
      expect(composer).not.toContain(token);
    }
    expect(AiStoryCanonicalSceneComposerError).toBeTypeOf("function");
  });
});
