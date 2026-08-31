/**
 * Sprint 3 Phase 1 — Scene Execution Compiler + AI QC unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  AnimationPackagePayloadSchema,
  CreativeContextSchema,
  DirectorThinkingSchema,
  type AnimationPackagePayload,
} from "@ceo-agent/shared";
import {
  compileSceneExecutionIntents,
  integrityHash,
} from "../packages/agents/src/ai-story/scene-execution-compiler";
import {
  aggregateQcStatus,
  qcAllowsExecution,
  validateAllSceneExecutionIntents,
  validateSceneExecutionIntent,
} from "../packages/agents/src/ai-story/ai-qc-validator";
import { mapCompiledInstructionsToCanonicalScenePayload } from "../packages/agents/src/ai-story/canonical-scene-payload-resolver";

const ASSET_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ASSET_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ORG = "11111111-1111-1111-1111-111111111111";
const WS = "22222222-2222-2222-2222-222222222222";
const CAMP = "33333333-3333-3333-3333-333333333333";
const STORY = "44444444-4444-4444-4444-444444444444";
const VER = "55555555-5555-5555-5555-555555555555";
const PKG = "66666666-6666-6666-6666-666666666666";

function samplePackage(assetIds: string[] = [ASSET_A]): AnimationPackagePayload {
  const story = {
    title: "Launch",
    summary: "A shopper discovers the brand.",
    objective: "Awareness",
    targetAudience: "Busy gift buyers",
    tone: "Warm",
    estimatedDuration: "30s",
    story: {
      opening: "The hero needs a gift.",
      development: "The brand solves the problem.",
      ending: "The hero shares the gift.",
    },
    keyMessages: ["Simple gifting"],
    cta: "Shop now",
    assetReferences: assetIds,
    warnings: [],
  };
  const creativeContext = CreativeContextSchema.parse({
    storyContext: {
      title: story.title,
      summary: story.summary,
      objective: story.objective,
      targetAudience: story.targetAudience,
      tone: story.tone,
      estimatedDuration: story.estimatedDuration,
      keyMessages: story.keyMessages,
      cta: story.cta,
    },
    characterContext: {
      characters: [
        {
          id: "hero",
          name: "Hero",
          role: "Customer",
          description: "Needs a meaningful gift.",
          motivation: "Make someone feel remembered.",
          visualNotes: "Smart casual.",
        },
      ],
      relationships: [],
    },
    worldContext: {
      locations: ["Apartment"],
      visualStyle: "Clean",
      lighting: "Soft",
      environment: "Urban home",
      objects: ["gift box"],
      timeline: "Morning",
      worldRules: ["Keep brand colors visible"],
    },
    narrativeContext: {
      arc: "Need to relief",
      pacing: "Quick",
      emotionalJourney: "Concern to delight",
      themes: ["thoughtfulness"],
      dialogue: [],
    },
    directorContext: {},
  });
  const directorThinking = DirectorThinkingSchema.parse({
    coreMessage: "Thoughtful gifting can be simple.",
    hero: "Hero",
    conflict: "No time to find a gift.",
    turningPoint: "Hero discovers the product.",
    climax: "Gift reveal lands emotionally.",
    takeaway: "Shop now for simple gifting.",
  });
  return AnimationPackagePayloadSchema.parse({
    story,
    characters: creativeContext.characterContext.characters,
    creativeContext: { ...creativeContext, directorContext: directorThinking },
    directorThinking,
    storyBeats: [
      {
        id: "beat-001",
        name: "Opening",
        purpose: "Introduce need",
        order: 0,
        summary: "Hero realizes a gift is needed.",
      },
      {
        id: "beat-002",
        name: "Discovery",
        purpose: "Show product",
        order: 1,
        summary: "Hero finds the product.",
      },
    ],
    scenePlan: [
      {
        id: "scene-001",
        beatIds: ["beat-001"],
        purpose: "Need",
        durationSec: 6,
        transition: "Cut",
        continuityNotes: "Warm light",
        order: 0,
      },
      {
        id: "scene-002",
        beatIds: ["beat-002"],
        purpose: "Discovery",
        durationSec: 8,
        transition: "Dissolve",
        continuityNotes: "Same apartment",
        order: 1,
      },
    ],
    shotPlan: [
      {
        id: "shot-001",
        sceneId: "scene-001",
        cameraType: "Close-up",
        cameraMovement: "Slow push",
        composition: "Product foreground",
        framing: "Vertical",
        lensSuggestion: "35mm",
        durationSec: 3,
        focus: "Gift box",
        emotion: "Concern",
        information: "Need established",
        order: 0,
      },
      {
        id: "shot-002",
        sceneId: "scene-001",
        cameraType: "Medium",
        cameraMovement: "Static",
        composition: "Hero center",
        framing: "Vertical",
        lensSuggestion: "50mm",
        durationSec: 3,
        focus: "Hero face",
        emotion: "Relief beginning",
        information: "Hero reacts",
        order: 1,
      },
      {
        id: "shot-003",
        sceneId: "scene-002",
        cameraType: "Close-up",
        cameraMovement: "Orbit",
        composition: "Product hero",
        framing: "Vertical",
        lensSuggestion: "35mm",
        durationSec: 8,
        focus: "Product label",
        emotion: "Delight",
        information: "Product solves need",
        order: 0,
      },
    ],
    characterContinuity: [
      {
        characterId: "hero",
        name: "Hero",
        appearance: "Smart casual",
        emotion: "Concern then delight",
        costume: "Neutral shirt",
        accessories: "Phone",
        age: "Adult",
        pose: "Leaning toward product",
        identity: "Customer hero",
      },
    ],
    worldContinuity: {
      location: "Apartment",
      lighting: "Soft morning light",
      environment: "Urban home",
      objects: ["gift box"],
      timeline: "One morning",
      worldRules: ["Keep brand colors visible"],
    },
    narrative: creativeContext.narrativeContext,
    narrativeIntegration: { consistent: true, issues: [], links: [] },
    status: "ready_for_execution",
  });
}

const baseCtx = {
  orgId: ORG,
  workspaceId: WS,
  campaignId: CAMP,
  storyId: STORY,
  storyVersionId: VER,
  storyVersionNumber: 1,
  storyVersionFrozenAt: "2026-08-01T00:00:00.000Z",
  animationPackageId: PKG,
  animationPackageStatus: "ready_for_execution",
  compiledAt: "2026-08-02T00:00:00.000Z",
};

describe("Phase 1 Scene Execution Compiler", () => {
  it("produces N intents for N scenes with stable identities", () => {
    const pkg = samplePackage();
    const a = compileSceneExecutionIntents(pkg, baseCtx);
    const b = compileSceneExecutionIntents(pkg, baseCtx);

    expect(a.intents).toHaveLength(2);
    expect(a.estimate.requiredSceneCount).toBe(2);
    expect(a.estimate.estimatedProviderExecutions).toBe(2);
    expect((a.estimate as { targetOutputCount?: number }).targetOutputCount).toBeUndefined();

    expect(a.intents.map((i) => i.identity.sceneId)).toEqual(["scene-001", "scene-002"]);
    expect(a.intents[0]!.shotReferences).toHaveLength(2);
    expect(a.intents[1]!.shotReferences).toHaveLength(1);

    expect(a.intents[0]!.identity.sceneExecutionId).toBe(
      b.intents[0]!.identity.sceneExecutionId
    );
    expect(a.intents[0]!.identity.deterministicFingerprint).toBe(
      b.intents[0]!.identity.deterministicFingerprint
    );
    expect(a.storyExecutionPlan.compilationHash).toBe(b.storyExecutionPlan.compilationHash);
  });

  it("preserves character and asset references without invoking providers", () => {
    const compiled = compileSceneExecutionIntents(samplePackage(), baseCtx);
    for (const intent of compiled.intents) {
      const instructions =
        compiled.instructionsBySceneExecutionId[intent.identity.sceneExecutionId]!;
      expect(instructions.characterReferences[0]?.characterId).toBe("hero");
      expect(instructions.referencedAssetIds).toEqual([ASSET_A]);
      expect(instructions.capabilityId).toBe("animation-video-generation");
      expect(intent.normalizedPayloadReference.contentHash).toBe(
        integrityHash(instructions)
      );
    }
  });

  it("compiles mixed explicit T2V, inherited I2V, and explicit-reference I2V per Scene", () => {
    const pkg = samplePackage();
    const mutable = pkg as any;
    mutable.scenePlan[0].generationAuthority = {
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      referenceAssetIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    };
    mutable.storyBeats.push({
      id: "beat-003",
      name: "Closing",
      purpose: "Close with a distinct visual authority",
      order: 2,
      summary: "The gift is shared.",
    });
    mutable.scenePlan.push({
      id: "scene-003",
      beatIds: ["beat-003"],
      purpose: "Closing",
      durationSec: 5,
      transition: "Cut",
      continuityNotes: "Same morning",
      order: 2,
      generationAuthority: {
        strategy: "FIRST_FRAME_IMAGE_TO_VIDEO",
        referenceSource: "SCENE_EXPLICIT",
        referenceAssetIds: [ASSET_B],
        firstFrameAssetId: ASSET_B,
        productVisualIdentityRequirement: "REQUIRED",
      },
    });
    mutable.shotPlan.push({
      id: "shot-004",
      sceneId: "scene-003",
      cameraType: "Medium",
      cameraMovement: "Static",
      composition: "Gift exchange",
      framing: "Vertical",
      lensSuggestion: "50mm",
      durationSec: 5,
      focus: "Gift recipient",
      emotion: "Delight",
      information: "Gift is shared",
      order: 0,
    });

    const parsed = AnimationPackagePayloadSchema.parse(pkg);
    const first = compileSceneExecutionIntents(parsed, baseCtx);
    const second = compileSceneExecutionIntents(parsed, baseCtx);
    expect(first.intents.map((intent) => intent.referencedAssetIds)).toEqual([
      [],
      [ASSET_A],
      [ASSET_B],
    ]);
    expect(first.intents[0]!.generationAuthority).toMatchObject({
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      effectiveReferenceIds: [],
    });
    expect(first.intents[1]!.generationAuthority).toBeUndefined();
    expect(first.intents[2]!.generationAuthority).toMatchObject({
      strategy: "FIRST_FRAME_IMAGE_TO_VIDEO",
      referenceSource: "SCENE_EXPLICIT",
      effectiveReferenceIds: [ASSET_B],
      firstFrameAssetId: ASSET_B,
    });
    expect(first.intents.map((intent) => intent.identity.deterministicFingerprint)).toEqual(
      second.intents.map((intent) => intent.identity.deterministicFingerprint)
    );

    const payloads = first.intents.map((intent) =>
      mapCompiledInstructionsToCanonicalScenePayload({
        intent,
        instructions:
          first.instructionsBySceneExecutionId[intent.identity.sceneExecutionId]!,
      })
    );
    expect(payloads.map((payload) => payload.generationMode)).toEqual([
      "CREATIVE_T2V",
      "PRODUCT_GROUNDED_VIDEO",
      "PRODUCT_GROUNDED_VIDEO",
    ]);
    expect(payloads.map((payload) => payload.assetReferences.map((ref) => ref.assetId))).toEqual([
      [],
      [ASSET_A],
      [ASSET_B],
    ]);
    expect(payloads[1]!.assetReferences[0]!.continuityScope).toBe("STORY");
    expect(payloads[2]!.assetReferences[0]!.continuityScope).toBe("SCENE");
  });

  it("keeps legacy inheritance and requires explicit authority for reference-free T2V", () => {
    const legacy = compileSceneExecutionIntents(samplePackage(), baseCtx);
    expect(legacy.intents.every((intent) => intent.generationAuthority === undefined)).toBe(true);
    expect(legacy.intents.every((intent) => intent.referencedAssetIds[0] === ASSET_A)).toBe(true);

    const invalid = compileSceneExecutionIntents(samplePackage([]), baseCtx);
    const intent = invalid.intents[0]!;
    const instructions = invalid.instructionsBySceneExecutionId[intent.identity.sceneExecutionId]!;
    const qc = validateSceneExecutionIntent(intent, {
      storyVersionFrozenAt: baseCtx.storyVersionFrozenAt,
      animationPackageStatus: "ready_for_execution",
      workspaceId: WS,
      campaignId: CAMP,
      assetsById: new Map(),
      instructions,
      validatedAt: "2026-08-02T01:00:00.000Z",
    });
    expect(qc.errors.some((error) => error.code === "PRODUCT_IDENTITY_REFERENCE_MISSING")).toBe(true);
    expect(() =>
      mapCompiledInstructionsToCanonicalScenePayload({ intent, instructions })
    ).toThrow(/explicit TEXT_TO_VIDEO/);
  });
});

describe("Phase 1 AI QC Layer", () => {
  it("accepts explicit reference-free T2V without weakening other QC rules", () => {
    const pkg = samplePackage();
    (pkg.scenePlan[0] as any).generationAuthority = {
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      referenceAssetIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    };
    const compiled = compileSceneExecutionIntents(pkg, baseCtx);
    const intent = compiled.intents[0]!;
    const result = validateSceneExecutionIntent(intent, {
      storyVersionFrozenAt: baseCtx.storyVersionFrozenAt,
      animationPackageStatus: "ready_for_execution",
      workspaceId: WS,
      campaignId: CAMP,
      assetsById: new Map(),
      instructions:
        compiled.instructionsBySceneExecutionId[intent.identity.sceneExecutionId]!,
      validatedAt: "2026-08-02T01:00:00.000Z",
    });
    expect(result.errors.some((error) => error.code === "PRODUCT_IDENTITY_REFERENCE_MISSING")).toBe(false);
    expect(result.status).not.toBe("failed");
  });

  it("rejects an explicit T2V authority that conflicts with required product identity", () => {
    const pkg = samplePackage();
    (pkg.scenePlan[0] as any).generationAuthority = {
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      referenceAssetIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "REQUIRED",
    };
    const compiled = compileSceneExecutionIntents(pkg, baseCtx);
    const intent = compiled.intents[0]!;
    const result = validateSceneExecutionIntent(intent, {
      storyVersionFrozenAt: baseCtx.storyVersionFrozenAt,
      animationPackageStatus: "ready_for_execution",
      workspaceId: WS,
      campaignId: CAMP,
      assetsById: new Map(),
      instructions:
        compiled.instructionsBySceneExecutionId[intent.identity.sceneExecutionId]!,
      validatedAt: "2026-08-02T01:00:00.000Z",
    });
    expect(result.errors.some((error) => error.code === "T2V_PRODUCT_IDENTITY_AUTHORITY_CONFLICT")).toBe(true);
  });
  it("passes a valid intent with resolved assets (warnings allowed)", () => {
    const compiled = compileSceneExecutionIntents(samplePackage(), baseCtx);
    const assetsById = new Map([
      [
        ASSET_A,
        { assetId: ASSET_A, workspaceId: WS, campaignId: CAMP },
      ],
    ]);
    const results = validateAllSceneExecutionIntents(
      compiled.intents,
      compiled.instructionsBySceneExecutionId,
      {
        storyVersionFrozenAt: baseCtx.storyVersionFrozenAt,
        animationPackageStatus: "ready_for_execution",
        workspaceId: WS,
        campaignId: CAMP,
        assetsById,
        validatedAt: "2026-08-02T01:00:00.000Z",
      }
    );
    expect(aggregateQcStatus(results)).not.toBe("failed");
    expect(qcAllowsExecution(results)).toBe(true);

    const again = validateSceneExecutionIntent(compiled.intents[0]!, {
      storyVersionFrozenAt: baseCtx.storyVersionFrozenAt,
      animationPackageStatus: "ready_for_execution",
      workspaceId: WS,
      campaignId: CAMP,
      assetsById,
      instructions:
        compiled.instructionsBySceneExecutionId[
          compiled.intents[0]!.identity.sceneExecutionId
        ]!,
      validatedAt: "2026-08-02T01:00:00.000Z",
    });
    expect(again.status).toBe(results[0]!.status);
    expect(again.errors).toEqual(results[0]!.errors);
  });

  it("blocks when Campaign Asset refs are missing even if the workspace asset exists", () => {
    const compiled = compileSceneExecutionIntents(samplePackage(), baseCtx);
    const results = validateAllSceneExecutionIntents(
      compiled.intents,
      compiled.instructionsBySceneExecutionId,
      {
        storyVersionFrozenAt: baseCtx.storyVersionFrozenAt,
        animationPackageStatus: "ready_for_execution",
        workspaceId: WS,
        campaignId: CAMP,
        assetsById: new Map([
          [ASSET_A, { assetId: ASSET_A, workspaceId: WS, campaignId: null }],
        ]),
        validatedAt: "2026-08-02T01:00:00.000Z",
      }
    );
    expect(aggregateQcStatus(results)).toBe("failed");
    expect(
      results[0]!.errors.some((e) => e.code === "ASSET_CAMPAIGN_UNAUTHORIZED")
    ).toBe(true);
  });

  it("blocks when Campaign Assets are missing", () => {
    const compiled = compileSceneExecutionIntents(samplePackage(), baseCtx);
    const results = validateAllSceneExecutionIntents(
      compiled.intents,
      compiled.instructionsBySceneExecutionId,
      {
        storyVersionFrozenAt: baseCtx.storyVersionFrozenAt,
        animationPackageStatus: "ready_for_execution",
        workspaceId: WS,
        campaignId: CAMP,
        assetsById: new Map(),
        validatedAt: "2026-08-02T01:00:00.000Z",
      }
    );
    expect(aggregateQcStatus(results)).toBe("failed");
    expect(qcAllowsExecution(results)).toBe(false);
    expect(
      results[0]!.errors.some((e) => e.code === "MISSING_CAMPAIGN_ASSET")
    ).toBe(true);
  });

  it("never mutates the Scene Execution Intent", () => {
    const compiled = compileSceneExecutionIntents(samplePackage(), baseCtx);
    const intent = compiled.intents[0]!;
    const before = JSON.stringify(intent);
    validateSceneExecutionIntent(intent, {
      storyVersionFrozenAt: null,
      animationPackageStatus: "ready_for_execution",
      workspaceId: WS,
      campaignId: CAMP,
      assetsById: new Map([
        [ASSET_A, { assetId: ASSET_A, workspaceId: WS, campaignId: CAMP }],
      ]),
      instructions:
        compiled.instructionsBySceneExecutionId[intent.identity.sceneExecutionId]!,
      validatedAt: "2026-08-02T01:00:00.000Z",
    });
    expect(JSON.stringify(intent)).toBe(before);
  });

  it("rejects unapproved Animation Package status", () => {
    const compiled = compileSceneExecutionIntents(samplePackage(), baseCtx);
    const result = validateSceneExecutionIntent(compiled.intents[0]!, {
      storyVersionFrozenAt: baseCtx.storyVersionFrozenAt,
      animationPackageStatus: "draft",
      workspaceId: WS,
      campaignId: CAMP,
      assetsById: new Map([
        [ASSET_A, { assetId: ASSET_A, workspaceId: WS, campaignId: CAMP }],
      ]),
      instructions:
        compiled.instructionsBySceneExecutionId[
          compiled.intents[0]!.identity.sceneExecutionId
        ]!,
      validatedAt: "2026-08-02T01:00:00.000Z",
    });
    expect(result.status).toBe("failed");
    expect(result.errors.some((e) => e.code === "ANIMATION_PACKAGE_NOT_APPROVED")).toBe(
      true
    );
  });
});
