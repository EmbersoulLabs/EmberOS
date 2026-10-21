import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AiStoryLocalGenerationPackageSchema,
  ProductVisualMaterialSelectionAuthoritySchema,
  resolveExplicitAiStorySceneGenerationAuthority,
  type AiStoryCanonicalScene,
  type AiStorySceneCompiledInstructions,
  type AiStorySceneExecutionIntent,
} from "@ceo-agent/shared";
import {
  computeAiStoryLocalGenerationPackageV3Fingerprint,
  deterministicAiStoryLocalGenerationPackageV3Id,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import { canonicalPersistenceHash } from "@ceo-agent/db";
import { AiStoryLocalGenerationError } from "../packages/agents/src/ai-story/local-generation-package";
import { AiStoryLocalGenerationService } from "../packages/agents/src/ai-story/local-generation-service";
import { materializeLocalRetryPackage } from "../packages/agents/src/ai-story/generation-result-service";
import {
  buildLocalGenerationOperatorInstructions,
  materializeProviderNeutralLocalGenerationPackage,
  type BoundVisualReference,
  type ProviderNeutralLocalSceneFacts,
} from "../packages/agents/src/ai-story/local-generation-source-authority";
import {
  materializeReleasedPackageIntegrityRetry,
  materializeSequentialLocalPackageV3,
} from "../packages/agents/src/ai-story/sequential-local-generation";
import { mapCanonicalPackageToLocalGpuDesktop } from "../packages/agents/src/ai-story/local-gpu-package-transport";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const id = (suffix: string) => `50000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const hash = (seed: string) => `sha256:${createHash("sha256").update(seed).digest("hex")}`;
const createdAt = "2026-10-03T00:00:00.000Z";

function selection(sceneId: string, sceneVersionId: string) {
  const sourceId = id("70235a91");
  const body = {
    contractVersion: "ai-story-product-visual-material-selection.v1" as const,
    orgId: id("93"), workspaceId: id("3af"), campaignId: id("4d3"),
    storyId: id("ba6"), storyVersionId: id("7df"), sceneId, sceneVersionId,
    productAuthority: {
      productAuthorityId: sourceId, sourceAssetId: sourceId, sourceAssetContentHash: hash("d"),
    },
    visualRequirement: {
      sceneRequirement: "REQUIRED" as const, effectiveGenerationRequirement: "REQUIRED" as const,
      strategy: "FIRST_FRAME_IMAGE_TO_VIDEO" as const, referenceSource: "SCENE_EXPLICIT" as const,
    },
    suitability: { authorityFingerprint: hash("d"), outcome: "OPAQUE_NOT_ISOLATED" as const },
    derivativeResolution: { contractVersion: "ai-story-exact-product-derivative-resolution.v1" as const, status: "FOUND" as const },
    preparationCapability: { status: "NOT_CERTIFIED" as const },
    selection: "EXTRACTED_DERIVATIVE" as const,
    selectedMaterial: {
      kind: "EXTRACTED_DERIVATIVE" as const, assetId: id("088"), contentHash: hash("e"),
      generationId: id("089"), generationFingerprint: hash("f"),
    },
    reason: "EXACT_DERIVATIVE_CERTIFIED" as const,
  };
  return ProductVisualMaterialSelectionAuthoritySchema.parse({
    ...body,
    fingerprint: sha256CanonicalIntegrityHash({ kind: body.contractVersion, authority: body }),
  });
}

export function providerNeutralLocalFactsFixture(mode: "I2V" | "T2V", sceneExecutionId = id("101")): ProviderNeutralLocalSceneFacts {
  const sceneId = mode === "I2V" ? id("201") : id("202");
  const sceneVersionId = mode === "I2V" ? id("301") : id("302");
  const sceneFingerprint = hash(mode === "I2V" ? "scene-i2v" : "scene-t2v");
  const sceneGenerationAuthority = mode === "I2V"
    ? {
        strategy: "FIRST_FRAME_IMAGE_TO_VIDEO" as const,
        referenceSource: "SCENE_EXPLICIT" as const,
        referenceAssetIds: [id("70235a91")],
        firstFrameAssetId: id("70235a91"),
        productVisualIdentityRequirement: "REQUIRED" as const,
      }
    : {
        strategy: "TEXT_TO_VIDEO" as const,
        referenceSource: "REFERENCE_FREE_T2V" as const,
        referenceAssetIds: [],
        firstFrameAssetId: null,
        productVisualIdentityRequirement: "NONE" as const,
      };
  const generationAuthority = resolveExplicitAiStorySceneGenerationAuthority(sceneGenerationAuthority);
  const instructions = {
    contractVersion: "1" as const,
    capabilityId: "animation-video-generation" as const,
    sceneId,
    sceneVersionId,
    sceneFingerprint,
    scriptVersionId: id("401"),
    sceneSetFingerprint: hash("set"),
    sceneOrder: mode === "I2V" ? 0 : 1,
    purpose: mode === "I2V" ? "Show the exact product" : "Continue the story without a product frame",
    transition: "next",
    continuityNotes: "same counter",
    beatIds: [],
    durationMs: 5000,
    shots: [{
      shotId: "shot-1", order: 0, durationMs: 5000, cameraType: "close", cameraMovement: "still",
      composition: "center", framing: "tight", lensSuggestion: "", focus: "product", emotion: "curious",
      information: "the product is visible",
    }],
    characterReferences: [{ characterId: id("601"), name: "Yuki", integrityHash: hash("yuki") }],
    referencedAssetIds: [],
    generationAuthority,
    groundingLineage: [],
    worldContinuity: {},
    productIdentityConstraints: ["keep the authorized product"],
  } as AiStorySceneCompiledInstructions;
  const intent = {
    identity: {
      contractVersion: "1" as const,
      sceneExecutionId,
      tenantId: id("93"),
      workspaceId: id("3af"),
      campaignId: id("4d3"),
      storyId: id("ba6"),
      storyVersionId: id("7df"),
      animationPackageId: id("501"),
      sceneId,
      sceneVersionId,
      sceneFingerprint,
      scriptVersionId: id("401"),
      sceneOrder: instructions.sceneOrder,
      idempotencyKey: sceneExecutionId,
      deterministicFingerprint: hash("execution"),
    },
    frozenStoryVersion: {
      storyId: id("ba6"), storyVersionId: id("7df"), versionNumber: 1,
      frozenAt: createdAt, integrityHash: hash("story"),
    },
    animationPackage: {
      animationPackageId: id("501"), storyId: id("ba6"), storyVersionId: id("7df"),
      sceneCount: 2, integrityHash: hash("package"), scriptVersionId: id("401"), sceneSetFingerprint: hash("set"),
    },
    shotReferences: [{ shotId: "shot-1", sceneId, order: 0, durationMs: 5000, integrityHash: hash("shot") }],
    referencedAssetIds: [],
    generationAuthority,
    normalizedPayloadReference: { uri: "instruction", contentHash: canonicalPersistenceHash(instructions), mediaType: "application/json" },
    plannedDurationMs: 5000,
    compiledAt: createdAt,
    compilationHash: hash("compilation"),
  } as AiStorySceneExecutionIntent;
  const scene = {
    sceneId, sceneVersionId, fingerprint: sceneFingerprint, scriptVersionId: id("401"),
    storyVersionId: id("7df"), status: "FROZEN", version: 1, generationAuthority: sceneGenerationAuthority,
    castBindings: [],
    productBindings: mode === "I2V" ? [{
      productAuthorityId: id("70235a91"), sourceAssetId: id("70235a91"), sourceAssetContentHash: hash("d"),
      visualIdentityRequirement: "REQUIRED",
    }] : [],
    events: [{
      type: "DIALOGUE", speakerId: id("601"), language: "en-SG",
      line: "Look at this beautiful fruit pavlova, handcrafted with care and perfect for any occasion!",
    }], entryState: [{ dimension: "LOCATION", subjectId: id("601"), value: "at the counter" }],
    exitState: [{ dimension: "LOCATION", subjectId: id("601"), value: "still at the counter" }],
    mustKeep: ["exact product identity"], mustAvoid: ["substitute another product"], continuityFacts: ["same counter"],
    locationBinding: { scope: "EPHEMERAL_ENVIRONMENT", id: id("701"), storyId: id("ba6"), sceneId, displayName: "counter", environmentDescription: "counter", visualIdentityRequirement: "NONE" },
    locationState: { temporaryFacts: ["quiet"] },
  } as unknown as AiStoryCanonicalScene;
  const material = mode === "I2V" ? selection(sceneId, sceneVersionId) : null;
  return {
    orgId: id("93"), workspaceId: id("3af"), campaignId: id("4d3"), storyId: id("ba6"), storyVersionId: id("7df"),
    executionPlanId: id("801"), runtimeAuthorizationId: id("901"), sceneExecutionId,
    sceneExecutionFingerprint: hash("execution"),
    instructionContentHash: canonicalPersistenceHash(instructions),
    intent, instructions, scene,
    preGenerationQcEvaluationId: id("911"), preGenerationQcFingerprint: hash("qc"),
    preGenerationSceneVersionIds: [sceneVersionId],
    directorFingerprint: hash("director"), motionFingerprint: hash("motion"),
    handoffId: id("921"), handoffFingerprint: hash("handoff"),
    aspectRatio: "9:16",
    productMaterial: material,
    selectedMaterialAsset: material ? {
      assetId: id("088"), contentHash: hash("e"), mediaType: "image/png", storagePath: `${id("3af")}/library/${id("088")}.png`,
    } : null,
    order: mode === "I2V" ? 1 : 2,
    createdAt,
  };
}

const facts = providerNeutralLocalFactsFixture;

describe("provider-neutral local generation authority", () => {
  it("builds an I2V package from frozen execution authority and the exact derivative", () => {
    const item = materializeProviderNeutralLocalGenerationPackage(facts("I2V"));
    expect(item.version).toBe("local-generation-package.v2");
    expect(item.executionMode).toBe("MANUAL_LOCAL");
    expect(item.references).toEqual([expect.objectContaining({
      assetId: id("088"), contentHash: hash("e"), authorityType: "FIRST_FRAME", authorityId: id("70235a91"),
    })]);
    expect(item.productAuthority).toMatchObject({
      assetId: id("70235a91"), contentHash: hash("d"), selectedMaterialAssetId: id("088"), selection: "EXTRACTED_DERIVATIVE",
    });
    expect(JSON.stringify(item)).not.toMatch(/seedance|compiledRequestId|providerResolution|providerAttempt/i);
    expect(item.sourceAuthority.version).toBe("ai-story-local-generation-source-authority.v2");
  });

  it("keeps reference-free T2V free of a first frame", () => {
    const item = materializeProviderNeutralLocalGenerationPackage(facts("T2V"));
    expect(item.generationMode).toBe("TEXT_TO_VIDEO");
    expect(item.references.some((reference) => reference.authorityType === "FIRST_FRAME")).toBe(false);
    expect(item.productAuthority).toBeNull();
  });

  it("fails closed on a selected material hash mismatch", () => {
    const input = facts("I2V");
    expect(() => materializeProviderNeutralLocalGenerationPackage({
      ...input,
      selectedMaterialAsset: { ...input.selectedMaterialAsset!, contentHash: hash("f") },
    })).toThrow(/content hash/);
  });

  it("fails closed on a stale Scene fingerprint", () => {
    const input = facts("I2V");
    expect(() => materializeProviderNeutralLocalGenerationPackage({
      ...input,
      scene: { ...input.scene, fingerprint: hash("stale") },
    })).toThrow(/fingerprint/);
  });

  it("fails closed on stale Pre-QC", () => {
    expect(() => materializeProviderNeutralLocalGenerationPackage({
      ...facts("I2V"),
      preGenerationSceneVersionIds: [id("999")],
    })).toThrow(/Pre-Generation QC/);
  });

  it("converges the same frozen inputs and orders one package per Scene", () => {
    const first = materializeProviderNeutralLocalGenerationPackage(facts("I2V", id("101")));
    const replay = materializeProviderNeutralLocalGenerationPackage(facts("I2V", id("101")));
    const second = materializeProviderNeutralLocalGenerationPackage(facts("T2V", id("102")));
    expect(replay.packageFingerprint).toBe(first.packageFingerprint);
    expect(replay.packageId).toBe(first.packageId);
    expect(second.order).toBe(2);
    expect(second.packageId).not.toBe(first.packageId);
    expect(AiStoryLocalGenerationPackageSchema.parse(first).version).toBe("local-generation-package.v2");
  });

  it("prepares ordered units without a provider-bound scheduling authority", async () => {
    const ordered = [id("101"), id("102")];
    const prepared = [
      { ...facts("I2V", ordered[0]!), order: 1 },
      { ...facts("T2V", ordered[1]!), order: 2 },
    ];
    const service = new AiStoryLocalGenerationService({
      loadFacts: async () => prepared,
      packages: {
        async initializeSequential(input) {
          return { packages: [input.package], replayed: false };
        },
      } as never,
    });
    const result = await service.prepare({
      orgId: id("93"), workspaceId: id("3af"), campaignId: id("4d3"), storyId: id("ba6"), storyVersionId: id("7df"),
      executionPlanId: id("801"), runtimeAuthorizationId: id("901"), orderedSceneExecutionIds: ordered,
      actorUserId: id("1"), createdAt,
    });
    expect(result.unitIds).toEqual([ordered[0]]);
    expect(result.packageIds).toHaveLength(1);
    await expect(service.prepare({
      orgId: id("93"), workspaceId: id("3af"), campaignId: id("4d3"), storyId: id("ba6"), storyVersionId: id("7df"),
      executionPlanId: id("801"), runtimeAuthorizationId: id("901"), orderedSceneExecutionIds: [...ordered].reverse(),
      actorUserId: id("1"), createdAt,
    })).rejects.toThrow(/Assembly order/);
  });

  it("keeps historical V1 packages readable and remote scheduling on its own authority", () => {
    const service = read("packages/agents/src/ai-story/local-generation-service.ts");
    const remote = read("packages/agents/src/ai-story/authorize-and-execute-execution-plan.ts");
    const retry = read("packages/agents/src/ai-story/generation-result-service.ts");
    expect(service).not.toContain("getAuthorizedSchedulingAuthority");
    expect(service).not.toContain("providerResolution");
    expect(remote).toContain("validateAiStoryAuthorizedSchedulingAuthority");
    expect(remote.indexOf('executionMode === "MANUAL_LOCAL"')).toBeLessThan(remote.indexOf("scheduling.scheduleAuthorizedScene"));
    expect(retry).toContain("LOCAL REGENERATION REQUIRED");
    expect(retry).not.toContain("seedanceAutoFallback: true");
    expect(AiStoryLocalGenerationPackageSchema.safeParse({
      version: "local-generation-package.v1",
      generateAudio: true,
      audioBlocked: true,
    }).success).toBe(false);
    expect(materializeLocalRetryPackage).toBeTypeOf("function");
  });

  const exactLine = "Look at this beautiful fruit pavlova, handcrafted with care and perfect for any occasion!";

  it("writes self-contained native-dialogue instructions without a model or provider", () => {
    const item = materializeProviderNeutralLocalGenerationPackage(facts("I2V"));
    const instructions = item.instructions;
    expect(item.recommendedWorkflow).toBe("MINIMAX_H3_NATIVE_DIALOGUE");
    expect(item.generateAudio).toBe(true);
    expect(item.audioBlocked).toBe(false);
    expect(item.dialogue[0]).toMatchObject({
      speakerLabel: "Yuki",
      text: exactLine,
      offscreen: false,
      locale: "en-SG",
    });
    expect(instructions.split(exactLine).length - 1).toBe(1);
    expect(instructions).toContain('Yuki says exactly, on screen:\n"' + exactLine + '"');
    expect(instructions).toContain("LANGUAGE\nen-SG");
    expect(instructions).toContain("Generate dialogue, mouth movement, facial expression, body performance and scene audio together as one synchronized audiovisual result.");
    expect(instructions).toContain("Do not use detached TTS.");
    expect(instructions).toContain("Do not burn subtitles into the generated video.");
    expect(instructions).toContain("Use the supplied authorized first-frame reference: selected product first frame.");
    expect(instructions).toContain("Do not substitute another Product.");
    expect(instructions).toContain("Do not substitute another Character.");
    expect(instructions).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    expect(instructions).not.toMatch(/paraphras|in other words|subtitle track/i);
  });

  it("does not invent speech for a Unit with no frozen dialogue", () => {
    const silent = buildLocalGenerationOperatorInstructions({
      recommendedWorkflow: "UNRESOLVED",
      durationSec: 5,
      aspectRatio: "9:16",
      resolutionIntent: "720p",
      generationMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
      references: [],
      hasCharacterAuthority: false,
      hasProductAuthority: false,
      sceneSummary: "A quiet counter",
      shotLines: ["Shot 1: still"],
      dialogue: [],
      generateAudio: false,
      mustKeep: [],
      mustAvoid: [],
      continuity: [],
      expectedEndState: [],
    });
    expect(silent).toContain("Do not invent speech, narration, or subtitles.");
    expect(silent).not.toContain(exactLine);
    expect(silent).not.toContain("says exactly");
    expect(silent).not.toContain("Do not use detached TTS.");
    const input = facts("I2V");
    const packageWithoutDialogue = materializeProviderNeutralLocalGenerationPackage({
      ...input,
      scene: { ...input.scene, events: [] },
    });
    expect(packageWithoutDialogue.recommendedWorkflow).toBe("MINIMAX_H3_R2V");
    expect(packageWithoutDialogue.dialogue).toEqual([]);
    expect(packageWithoutDialogue.generateAudio).toBe(false);
    expect(packageWithoutDialogue.audioBlocked).toBe(true);
  });

  it("selects certified T2V only for a frozen reference-free Scene without visible dialogue", () => {
    const input = facts("T2V");
    const item = materializeProviderNeutralLocalGenerationPackage({
      ...input,
      scene: { ...input.scene, events: [] },
    });
    expect(item.recommendedWorkflow).toBe("MINIMAX_H3_T2V");
    expect(item.generationMode).toBe("TEXT_TO_VIDEO");
    expect(item.references).toEqual([]);
    expect(item.productAuthority).toBeNull();
  });

  it("keeps historical V2 packages without dialogue locale readable and new writes deterministic", () => {
    const first = materializeProviderNeutralLocalGenerationPackage(facts("I2V"));
    const replay = materializeProviderNeutralLocalGenerationPackage(facts("I2V"));
    expect(replay.packageFingerprint).toBe(first.packageFingerprint);
    const historical = {
      ...first,
      dialogue: first.dialogue.map(({ locale: _locale, ...line }) => line),
    };
    const parsed = AiStoryLocalGenerationPackageSchema.parse(historical);
    expect(parsed.version).toBe("local-generation-package.v2");
    expect(parsed.dialogue[0]?.locale).toBeUndefined();
    expect(first.dialogue[0]?.locale).toBe("en-SG");
  });

  it("does not call an LLM or provider and does not fall back to WAN or Seedance", () => {
    const source = read("packages/agents/src/ai-story/local-generation-source-authority.ts");
    expect(source).toContain("MINIMAX_H3_NATIVE_DIALOGUE");
    expect(source).toContain("LOCAL_WORKFLOW_CERTIFICATION_REQUIRED");
    expect(source).not.toContain("WAN_I2V");
    expect(source).not.toContain("WAN_T2V");
    expect(source).not.toContain("en-SG");
    expect(source).not.toMatch(/callVision|openai|ProviderRouter|seedanceAutoFallback|runwayAutoFallback/i);
    const textToVideo = materializeProviderNeutralLocalGenerationPackage(facts("T2V"));
    expect(textToVideo.recommendedWorkflow).toBe("MINIMAX_H3_NATIVE_DIALOGUE");
    expect(textToVideo.generationMode).toBe("TEXT_TO_VIDEO");
    expect(textToVideo.instructions).toContain("FIRST FRAME\nNone.");
  });

  it("binds character, product, and multi-character references without dropping or reordering them", () => {
    const characterA = id("611");
    const characterB = id("612");
    const assetA = id("811");
    const assetB = id("812");
    const productFrame = id("088");
    const anchor = (assetId: string, authorityId: string, name: string): BoundVisualReference => ({
      assetId,
      contentHash: hash(name),
      mediaType: "image/png",
      storagePath: `${id("3af")}/library/${assetId}.png`,
      authorityType: "CHARACTER",
      authorityId,
      displayName: name,
    });
    const withCharacters = (count: 1 | 2, extra: BoundVisualReference[] = []) => {
      const input = facts("T2V");
      const ids = count === 1 ? [assetA] : [assetA, assetB];
      const sceneAuthority = {
        strategy: "TEXT_TO_VIDEO" as const,
        referenceSource: "CHARACTER_SYNTHETIC_ANCHOR" as const,
        referenceAssetIds: ids,
        firstFrameAssetId: null,
        productVisualIdentityRequirement: "NONE" as const,
      };
      const generationAuthority = resolveExplicitAiStorySceneGenerationAuthority(sceneAuthority);
      const instructions = {
        ...input.instructions,
        durationMs: 10000,
        shots: [{ ...input.instructions.shots[0]!, durationMs: 10000 }],
        generationAuthority,
        referencedAssetIds: ids,
      };
      const scene = {
        ...input.scene,
        generationAuthority: sceneAuthority,
        castBindings: [
          { scope: "CAMPAIGN_CHARACTER", id: characterA, campaignId: id("4d3"), authorityVersionId: id("711"), authorityFingerprint: hash("cast-a"), visualIdentityRequirement: "REQUIRED" },
          ...(count === 2 ? [{ scope: "CAMPAIGN_CHARACTER", id: characterB, campaignId: id("4d3"), authorityVersionId: id("712"), authorityFingerprint: hash("cast-b"), visualIdentityRequirement: "REQUIRED" }] : []),
        ],
        events: [
          { type: "ACTION", order: 0, durationRange: { minSeconds: 5, maxSeconds: 5 }, subjectId: characterA, action: "sets the table" },
          { type: "DIALOGUE", order: 1, durationRange: { minSeconds: 5, maxSeconds: 5 }, speakerId: characterA, language: "zh-MY", line: "来，尝尝。", speakerCastReference: { scope: "CAMPAIGN_CHARACTER", id: characterA } },
        ],
      } as ProviderNeutralLocalSceneFacts["scene"];
      return {
        ...input,
        instructionContentHash: canonicalPersistenceHash(instructions),
        instructions,
        scene,
        boundVisualReferences: [anchor(assetA, characterA, "fei"), ...(count === 2 ? [anchor(assetB, characterB, "daughter")] : []), ...extra],
        order: 1,
      } satisfies ProviderNeutralLocalSceneFacts;
    };

    const one = materializeProviderNeutralLocalGenerationPackage(withCharacters(1));
    expect(one.durationSec).toBe(10);
    expect(one.references.map((reference) => reference.assetId)).toEqual([assetA]);
    expect(one.references[0]).toMatchObject({ authorityType: "CHARACTER", authorityId: characterA, contentHash: hash("fei") });
    expect(one.characterAuthority?.characterId).toBe(characterA);
    expect(one.dialogue[0]?.locale).toBe("zh-MY");
    expect(one.recommendedWorkflow).toBe("MINIMAX_H3_NATIVE_DIALOGUE");

    const two = materializeProviderNeutralLocalGenerationPackage({
      ...withCharacters(2),
      scene: { ...withCharacters(2).scene, events: [{ type: "ACTION", order: 0, durationRange: { minSeconds: 10, maxSeconds: 10 }, subjectId: characterA, action: "serves" }] } as ProviderNeutralLocalSceneFacts["scene"],
    });
    expect(two.references.map((reference) => reference.assetId)).toEqual([assetA, assetB]);
    expect(two.recommendedWorkflow).toBe("MINIMAX_H3_R2V");
    expect(two.generationMode).toBe("TEXT_TO_VIDEO");
    expect(two.durationSec).toBe(10);
    const v3 = materializeSequentialLocalPackageV3({
      basePackage: two,
      release: { releaseRevision: 0, releasedBy: id("1"), releasedAt: createdAt },
      predecessor: null,
    });
    expect(v3.references.map((reference) => reference.assetId)).toEqual([assetA, assetB]);
    expect(v3.references.map((reference) => reference.role)).toEqual(["CHARACTER_IDENTITY", "CHARACTER_IDENTITY"]);
    expect(v3.durationSec).toBe(10);
    const historicalDraft = { ...v3, references: [] as typeof v3.references };
    const historicalFingerprint = computeAiStoryLocalGenerationPackageV3Fingerprint(historicalDraft);
    const historical = {
      ...historicalDraft,
      packageFingerprint: historicalFingerprint,
      packageId: deterministicAiStoryLocalGenerationPackageV3Id(historicalFingerprint),
    };
    const recovered = materializeReleasedPackageIntegrityRetry({
      current: historical,
      rebuilt: v3,
      createdAt: "2026-10-21T08:00:00.000Z",
    });
    expect(recovered.changed).toBe(true);
    expect(recovered.package.retryOfPackageId).toBe(historical.packageId);
    expect(recovered.package.retryNumber).toBe(historical.retryNumber + 1);
    expect(recovered.package.packageId).not.toBe(historical.packageId);
    expect(recovered.package.references.map((reference) => reference.assetId)).toEqual([assetA, assetB]);
    expect(recovered.package.durationSec).toBe(10);
    expect(recovered.package.releaseAuthority.semanticFingerprint).toBe(historical.releaseAuthority.semanticFingerprint);
    expect(materializeReleasedPackageIntegrityRetry({
      current: v3,
      rebuilt: v3,
      createdAt: "2026-10-21T08:00:00.000Z",
    }).changed).toBe(false);

    const desktop = mapCanonicalPackageToLocalGpuDesktop({
      package: v3,
      assets: [
        { assetId: assetA, contentHash: hash("fei"), workspaceId: id("3af"), assetUrl: "https://assets.example.test/fei.png" },
        { assetId: assetB, contentHash: hash("daughter"), workspaceId: id("3af"), assetUrl: "https://assets.example.test/daughter.png" },
      ],
      environment: "staging",
      jobId: id("90"),
      upload: { environment: "staging", method: "PUT", url: "https://uploads.example.test/scene.mp4" },
    });
    expect(desktop.desktop.references.map((reference) => reference.contentHash)).toEqual([hash("fei"), hash("daughter")]);
    expect(desktop.desktop.durationSec).toBe(10);
    expect(desktop.submit).toBe(false);

    const overflowIds = [assetA, assetB, productFrame, id("813")];
    const overflow = withCharacters(2);
    const overflowAuthority = {
      strategy: "TEXT_TO_VIDEO" as const,
      referenceSource: "CHARACTER_SYNTHETIC_ANCHOR" as const,
      referenceAssetIds: overflowIds,
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE" as const,
    };
    const overflowEffective = resolveExplicitAiStorySceneGenerationAuthority(overflowAuthority);
    const overflowInstructions = { ...overflow.instructions, generationAuthority: overflowEffective, referencedAssetIds: overflowIds };
    expect(() => materializeProviderNeutralLocalGenerationPackage({
      ...overflow,
      scene: { ...overflow.scene, generationAuthority: overflowAuthority },
      instructions: overflowInstructions,
      instructionContentHash: canonicalPersistenceHash(overflowInstructions),
      boundVisualReferences: overflowIds.map((assetId, index) => ({
        assetId,
        contentHash: hash(`overflow-${index}`),
        mediaType: "image/png",
        storagePath: `${id("3af")}/library/${assetId}.png`,
        authorityType: "CHARACTER" as const,
        authorityId: characterA,
        displayName: `reference ${index + 1}`,
      })),
    })).toThrow(/Desktop runtime capacity/);
    expect(() => materializeProviderNeutralLocalGenerationPackage({
      ...withCharacters(1),
      boundVisualReferences: [],
    })).toThrow(/missing from the canonical package/);
    const drifted = withCharacters(1);
    expect(() => materializeProviderNeutralLocalGenerationPackage({
      ...drifted,
      instructions: { ...drifted.instructions, durationMs: 5000, shots: [{ ...drifted.instructions.shots[0]!, durationMs: 5000 }] },
      instructionContentHash: canonicalPersistenceHash({ ...drifted.instructions, durationMs: 5000, shots: [{ ...drifted.instructions.shots[0]!, durationMs: 5000 }] }),
    })).toThrow(/frozen duration was left unchanged/i);
  });

  it("widens package storage for V2 without rewriting V1 rows", () => {
    const sql = read("packages/db/sql/ai-story-local-generation-package-contract-v2.sql");
    const v1 = read("packages/agents/src/ai-story/local-generation-package.ts");
    expect(sql).toContain("'local-generation-package.v1'");
    expect(sql).toContain("'local-generation-package.v2'");
    expect(sql).toContain("LOCAL_GENERATION_PACKAGE_CONTRACT_V2_ALREADY_APPLIED");
    expect(sql).not.toMatch(/UPDATE\s+ai_story_local_generation_packages|DELETE\s+FROM\s+ai_story_local_generation_packages/i);
    expect(v1).toContain("schedulingAuthorityId");
    expect(v1).toContain("compiledRequestId");
    expect(read("packages/agents/src/ai-story/local-generation-source-authority.ts")).not.toContain("schedulingAuthorityId");
  });
});
