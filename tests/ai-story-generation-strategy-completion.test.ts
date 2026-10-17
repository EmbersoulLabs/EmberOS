import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { sha256CanonicalIntegrityHash } from "../packages/shared/src/canonical-integrity";
import type { AiStoryExecutionCapabilityAuthority, ScenePlanItem } from "../packages/shared/src/ai-story";
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

  it("exposes normal user-facing successor recovery without provider calls", async () => {
    const route = await readFile("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/strategy-successor/route.ts", "utf8");
    expect(route).toContain("createGenerationStrategySuccessor");
    expect(route).toContain("humanApprovalRequired: true");
    expect(route).not.toMatch(/OpenAI|callJsonModel|\/v1\/jobs/);
  });
});
