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
import { sha256CanonicalIntegrityHash } from "@ceo-agent/shared/server";
import { canonicalPersistenceHash } from "@ceo-agent/db";
import { AiStoryLocalGenerationService } from "../packages/agents/src/ai-story/local-generation-service";
import { materializeLocalRetryPackage } from "../packages/agents/src/ai-story/generation-result-service";
import {
  materializeProviderNeutralLocalGenerationPackage,
  type ProviderNeutralLocalSceneFacts,
} from "../packages/agents/src/ai-story/local-generation-source-authority";

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

function facts(mode: "I2V" | "T2V", sceneExecutionId = id("101")): ProviderNeutralLocalSceneFacts {
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
    characterReferences: [],
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
    events: [], entryState: [{ dimension: "LOCATION", subjectId: id("601"), value: "at the counter" }],
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
        async insertOrConverge(input) {
          return { packages: input.packages, replayed: false };
        },
      } as never,
    });
    const result = await service.prepare({
      orgId: id("93"), workspaceId: id("3af"), campaignId: id("4d3"), storyId: id("ba6"), storyVersionId: id("7df"),
      executionPlanId: id("801"), runtimeAuthorizationId: id("901"), orderedSceneExecutionIds: ordered,
      actorUserId: id("1"), createdAt,
    });
    expect(result.unitIds).toEqual(ordered);
    expect(result.packageIds).toHaveLength(2);
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
