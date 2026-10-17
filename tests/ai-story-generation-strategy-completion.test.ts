import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { sha256CanonicalIntegrityHash } from "../packages/shared/src/canonical-integrity";
import type { AiStoryExecutionCapabilityAuthority, ScenePlanItem } from "../packages/shared/src/ai-story";
import type { AiStoryCharacterAuthorityVersion } from "../packages/shared/src/ai-story-character";
import type { AiStoryScriptVersion } from "../packages/shared/src/ai-story-script";
import {
  AiStoryExecutionCapabilityError,
  assertFreshExecutionCapabilityAuthority,
} from "../apps/web/src/lib/ai-story-execution-capability";
import { recoverScenePlanGenerationAuthorities } from "../apps/web/src/lib/ai-story-planning-service";

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
});
