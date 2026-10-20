import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { sha256CanonicalIntegrityHash } from "../packages/shared/src/canonical-integrity";
import { AuthoritativeAnimationPackagePayloadSchema, type AiStoryExecutionCapabilityAuthority, type AiStoryCanonicalScene, type ScenePlanItem } from "../packages/shared/src/ai-story";
import { buildAiStoryAnimationPackageCanonicalSceneAuthorityV1 } from "../packages/shared/src/ai-story-animation-package-canonical-scene-binding.server";
import type { AiStoryCharacterAuthorityVersion } from "../packages/shared/src/ai-story-character";
import type { AiStoryScriptVersion } from "../packages/shared/src/ai-story-script";
import {
  AiStoryExecutionCapabilityError,
  assertFreshExecutionCapabilityAuthority,
} from "../apps/web/src/lib/ai-story-execution-capability";
import { recoverScenePlanGenerationAuthorities, resolveGenerationStrategySemanticAncestor } from "../apps/web/src/lib/ai-story-planning-service";
import { animationPackageFixture } from "./helpers/ai-story-animation-package";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = (authority: ScenePlanItem["generationAuthority"]): ScenePlanItem => ({
  id: id(1), beatIds: [id(2)], purpose: "Show the approved subject", durationSec: 6,
  transition: "", continuityNotes: "one shot", order: 0, generationAuthority: authority,
});
const capabilities = {
  contractVersion: 2,
  workflows: [{ id: "MINIMAX_H3_R2V" }],
  contracts: {
    v2: { workflows: [{ id: "MINIMAX_H3_R2V" }] },
    v3: { workflows: [{ id: "MINIMAX_H3_T2V", execution: "enabled", textToVideo: true, placeholderImage: false, missingModels: [], e2eCertified: true }] },
  },
};
function authority(scene: ScenePlanItem, expiresAt = "2026-10-17T01:10:00.000Z"): AiStoryExecutionCapabilityAuthority {
  return {
    contractVersion: "ai-story-execution-capability-authority.v1",
    executionEnvironment: "LOCAL_GPU",
    environment: "production",
    verifiedPlatformAdminAssignmentId: id(9),
    capabilityFingerprint: sha256CanonicalIntegrityHash(capabilities),
    fetchedAt: "2026-10-17T01:00:00.000Z",
    expiresAt,
    capabilities,
    scenes: [{ sceneId: scene.id, strategy: scene.generationAuthority!, workflow: scene.generationAuthority?.referenceSource === "REFERENCE_FREE_T2V" ? "MINIMAX_H3_T2V" : "MINIMAX_H3_R2V", status: "SUPPORTED" }],
  };
}

describe("system-wide capability-aware Planning", () => {
  it("accepts certified T2V and R2V evidence and rejects stale evidence", () => {
    const t2v = base({ strategy: "TEXT_TO_VIDEO", referenceSource: "REFERENCE_FREE_T2V", referenceAssetIds: [], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" });
    expect(() => assertFreshExecutionCapabilityAuthority(authority(t2v), [t2v], new Date("2026-10-17T01:01:00.000Z"))).not.toThrow();
    const r2v = base({ strategy: "PRODUCT_GROUNDED_VIDEO", referenceSource: "SCENE_EXPLICIT", referenceAssetIds: [id(3)], firstFrameAssetId: id(3), productVisualIdentityRequirement: "REQUIRED" });
    expect(() => assertFreshExecutionCapabilityAuthority(authority(r2v), [r2v], new Date("2026-10-17T01:01:00.000Z"))).not.toThrow();
    expect(() => assertFreshExecutionCapabilityAuthority(authority(t2v, "2026-10-17T01:00:30.000Z"), [t2v], new Date("2026-10-17T01:01:00.000Z"))).toThrowError(AiStoryExecutionCapabilityError);
    const uncertified = structuredClone(capabilities);
    uncertified.contracts.v3.workflows[0]!.e2eCertified = false;
    const denied = { ...authority(t2v), capabilities: uncertified, capabilityFingerprint: sha256CanonicalIntegrityHash(uncertified) };
    expect(() => assertFreshExecutionCapabilityAuthority(denied, [t2v], new Date("2026-10-17T01:01:00.000Z"))).toThrow(/not certified/);
  });

  it("blocks multiple identity-conditioned people until Desktop explicitly certifies the reference count", () => {
    const multi = {
      ...base({ strategy: "PRODUCT_GROUNDED_VIDEO", referenceSource: "SCENE_EXPLICIT", referenceAssetIds: [id(3)], firstFrameAssetId: id(3), productVisualIdentityRequirement: "REQUIRED" }),
      castDirection: {
        mode: "MULTI_CHARACTER" as const,
        participants: [id(40), id(41)].map((characterId, index) => ({
          cast: { scope: "CAMPAIGN_CHARACTER" as const, id: characterId, campaignId: id(42), authorityVersionId: id(50 + index), authorityFingerprint: `sha256:${"a".repeat(64)}`, visualIdentityRequirement: "REQUIRED" as const },
          presence: "ON_SCREEN" as const,
          visualRole: index === 0 ? "PRIMARY_VISUAL" as const : "SUPPORTING_VISUAL" as const,
        })),
        genericExtras: [{ description: "Unidentified customers", count: 3, facesReadable: false }],
      },
    };
    expect(() => assertFreshExecutionCapabilityAuthority(authority(multi), [multi], new Date("2026-10-17T01:01:00.000Z"))).toThrow(/requires 2 on-screen Character identities/);
    const certified = structuredClone(capabilities);
    (certified.workflows[0] as typeof certified.workflows[0] & { maxCharacterReferences: number }).maxCharacterReferences = 2;
    (certified.contracts.v2.workflows[0] as typeof certified.contracts.v2.workflows[0] & { maxCharacterReferences: number }).maxCharacterReferences = 2;
    const accepted = { ...authority(multi), capabilities: certified, capabilityFingerprint: sha256CanonicalIntegrityHash(certified) };
    expect(() => assertFreshExecutionCapabilityAuthority(accepted, [multi], new Date("2026-10-17T01:01:00.000Z"))).not.toThrow();
  });

  it("binds explicit environment selection before approval and performs no dispatch", async () => {
    const route = await readFile("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/approve/route.ts", "utf8");
    expect(route).toContain('body?.executionEnvironment !== "LOCAL_GPU"');
    expect(route.indexOf("fetchLocalGpuPlanningCapabilityAuthority")).toBeLessThan(route.indexOf("approveAnimationPackage(db"));
    expect(route).not.toContain("/v1/jobs");
  });
});

describe("deterministic generation-strategy successor", () => {
  const HASH = `sha256:${"a".repeat(64)}`;
  const frozen = (input: {
    productIds?: string[];
    characterIds?: string[];
    characterAssets?: string[];
  }) => {
    const characterIds = input.characterIds ?? [];
    const authorityReferences: AiStoryScriptVersion["authorityReferences"] = [
      ...(input.productIds ?? []).map((authorityId) => ({ authorityType: "PRODUCT" as const, authorityId })),
      ...characterIds.map((authorityId, index) => ({
        authorityType: "CHARACTER" as const,
        authorityId,
        authorityVersionId: id(200 + index),
        authorityFingerprint: HASH,
      })),
    ];
    const frozenScript = {
      scenes: [{ order: 0, productAuthorityRefs: input.productIds ?? [], characterIds }],
      authorityReferences,
    } as AiStoryScriptVersion;
    const characterVersions: AiStoryCharacterAuthorityVersion[] = characterIds.map((characterId, index) => ({
      characterId,
      characterVersionId: id(200 + index),
      orgId: id(210), workspaceId: id(211), campaignId: id(212), version: 1,
      contractVersion: "ai-story-character.v1", name: `Character ${index}`,
      canonicalFacts: { identity: "Authorized identity", appearance: "Authorized appearance", personality: "Calm", emotionalArc: "Stable", relationships: [] },
      visualAssetReferences: (input.characterAssets ?? []).map((assetId) => ({ assetId, contentHash: HASH, purpose: "CHARACTER_VISUAL_REFERENCE" })),
      status: "ACTIVE", fingerprint: HASH, supersedesCharacterVersionId: null,
      createdBy: id(213), createdAt: "2026-10-17T00:00:00.000Z",
    }));
    return {
      frozenScript,
      productSources: (input.productIds ?? []).map((assetId) => ({
        storyId: id(220), assetId, usageType: "product_source" as const,
        orgId: id(210), workspaceId: id(211), campaignId: id(212), contentHash: HASH,
        status: "ready", confirmedVariant: "Pink",
      })),
      characterVersions,
    };
  };

  it("repairs Product authority while preserving zero-asset Scene strategy", () => {
    const product = {
      ...base({ strategy: "TEXT_TO_VIDEO", referenceSource: "REFERENCE_FREE_T2V", referenceAssetIds: [], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" }),
      groundingLineage: {
        contractVersion: "ai-story-scene-grounding-lineage.v1" as const,
        storyId: id(4), storyVersionId: id(5), matchingResultId: id(6), narrativeIntent: "product ad", visualIntent: "show product",
        evidence: [{ bindingId: id(7), assetId: id(3), role: "PRODUCT_AUTHORITY" as const, semanticSnapshotId: id(8), groundedFacts: ["pink fan"] }], visualClaims: [],
      },
    };
    const zero = { ...base({ strategy: "TEXT_TO_VIDEO", referenceSource: "REFERENCE_FREE_T2V", referenceAssetIds: [], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" }), id: id(10), order: 1 };
    const recovered = recoverScenePlanGenerationAuthorities([product, zero]);
    expect(recovered[0]?.generationAuthority).toMatchObject({ strategy: "PRODUCT_GROUNDED_VIDEO", firstFrameAssetId: id(3), referenceAssetIds: [id(3)] });
    expect(recovered[1]?.generationAuthority).toEqual(zero.generationAuthority);
    expect(recovered[0]?.purpose).toBe(product.purpose);
  });

  it("projects Product-only frozen Script authority even when historical grounding is missing", () => {
    const scene = base({ strategy: "TEXT_TO_VIDEO", referenceSource: "REFERENCE_FREE_T2V", referenceAssetIds: [], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" });
    const result = recoverScenePlanGenerationAuthorities([scene], frozen({ productIds: [id(3)] }));
    expect(result[0]?.generationAuthority).toEqual({
      strategy: "PRODUCT_GROUNDED_VIDEO", referenceSource: "SCENE_EXPLICIT",
      referenceAssetIds: [id(3)], firstFrameAssetId: id(3), productVisualIdentityRequirement: "REQUIRED",
    });
  });

  it("supports Character-only and combined Product + Character authority with stable Product-first ordering", () => {
    const scene = base({ strategy: "TEXT_TO_VIDEO", referenceSource: "REFERENCE_FREE_T2V", referenceAssetIds: [], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" });
    const characterOnly = recoverScenePlanGenerationAuthorities([scene], frozen({ characterIds: [id(20)], characterAssets: [id(21)] }));
    expect(characterOnly[0]?.generationAuthority).toMatchObject({ referenceSource: "CHARACTER_SYNTHETIC_ANCHOR", referenceAssetIds: [id(21)] });
    const combined = recoverScenePlanGenerationAuthorities([scene], frozen({ productIds: [id(3)], characterIds: [id(20)], characterAssets: [id(21)] }));
    expect(combined[0]?.generationAuthority).toMatchObject({
      strategy: "PRODUCT_GROUNDED_VIDEO", referenceAssetIds: [id(3), id(21)], firstFrameAssetId: id(3),
    });
  });

  it("keeps genuine reference-free authority and fails closed on ambiguous Product or Character material", () => {
    const scene = base({ strategy: "TEXT_TO_VIDEO", referenceSource: "REFERENCE_FREE_T2V", referenceAssetIds: [], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" });
    expect(recoverScenePlanGenerationAuthorities([scene], frozen({}))[0]?.generationAuthority).toEqual(scene.generationAuthority);
    expect(() => recoverScenePlanGenerationAuthorities([scene], frozen({ productIds: [id(3), id(4)] }))).toThrowError(expect.objectContaining({ code: "GENERATION_STRATEGY_SUCCESSOR_ASSET_SELECTION_REQUIRED" }));
    expect(() => recoverScenePlanGenerationAuthorities([scene], frozen({ characterIds: [id(20)], characterAssets: [id(21), id(22)] }))).toThrowError(expect.objectContaining({ code: "GENERATION_STRATEGY_SUCCESSOR_ASSET_SELECTION_REQUIRED" }));
  });

  it("exposes normal user-facing successor recovery without provider calls", async () => {
    const route = await readFile("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/strategy-successor/route.ts", "utf8");
    expect(route).toContain("createGenerationStrategySuccessor");
    expect(route).toContain("humanApprovalRequired: true");
    expect(route).not.toMatch(/OpenAI|callJsonModel|\/v1\/jobs/);
  });

  it("binds persisted product camera safety while creating an append-only successor", async () => {
    const service = await readFile("apps/web/src/lib/ai-story-planning-service.ts", "utf8");
    expect(service).toContain("bindProductShotCameraSafety({ scenePlan, shotPlan: source.shotPlan })");
    expect(service).toContain("sameJson(recoveredShotPlan, source.shotPlan)");
    expect(service).toContain("shotPlan: recoveredShotPlan");
    expect(service).toContain("recoveredShotPlan.map((shot)");
  });

  it("resolves the original Script semantic Scene Plan across successor-of-successor lineage", async () => {
    const legacy = animationPackageFixture("review");
    const referenceFree = { strategy: "TEXT_TO_VIDEO" as const, referenceSource: "REFERENCE_FREE_T2V" as const, referenceAssetIds: [], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" as const };
    const productGrounded = { strategy: "PRODUCT_GROUNDED_VIDEO" as const, referenceSource: "SCENE_EXPLICIT" as const, referenceAssetIds: [id(300)], firstFrameAssetId: id(300), productVisualIdentityRequirement: "REQUIRED" as const };
    const canonical = (generationAuthority: typeof referenceFree | typeof productGrounded): AiStoryCanonicalScene => ({
      sceneId: id(301), sceneVersionId: id(302), storyId: id(303), storyVersionId: id(304), scriptVersionId: id(305),
      order: 0, fingerprint: HASH, sourceScriptSceneIds: [id(306)], status: "FROZEN", generationAuthority,
    } as AiStoryCanonicalScene);
    const pkg = (generationAuthority: typeof referenceFree | typeof productGrounded, recovery?: { parentId: string; marker: string }) => {
      const scenePlan = legacy.scenePlan.map((scene) => ({ ...scene, generationAuthority }));
      return AuthoritativeAnimationPackagePayloadSchema.parse({
        ...legacy,
        scenePlan,
        canonicalSceneAuthority: buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({ storyId: id(303), storyVersionId: id(304), scenePlan, canonicalScenes: [canonical(generationAuthority)] }),
        ...(recovery ? { strategyRecovery: { contractVersion: "ai-story-generation-strategy-successor.v1", supersedesAnimationPackageId: recovery.parentId, sourceStrategyFingerprint: `sha256:${recovery.marker.repeat(64)}`, externalAiCalls: 0 } } : {}),
      });
    };
    const original = { id: id(310), payload: pkg(referenceFree) };
    const first = { id: id(311), payload: pkg(productGrounded, { parentId: original.id, marker: "b" }) };
    const second = { id: id(312), payload: pkg(productGrounded, { parentId: first.id, marker: "c" }) };
    const rows = new Map([original, first].map((row) => [row.id, row]));
    await expect(resolveGenerationStrategySemanticAncestor(second, async (parentId) => rows.get(parentId) ?? null))
      .resolves.toEqual(original.payload.scenePlan);

    const changed = structuredClone(original);
    changed.payload.scenePlan[0]!.purpose = "Changed approved intent";
    rows.set(original.id, changed);
    await expect(resolveGenerationStrategySemanticAncestor(second, async (parentId) => rows.get(parentId) ?? null))
      .rejects.toMatchObject({ code: "GENERATION_STRATEGY_SUCCESSOR_CREATIVE_LINEAGE_CHANGED" });
  });
});
