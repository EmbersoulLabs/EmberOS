import { describe, expect, it } from "vitest";
import {
  assertScenePlanningGroundingScope,
  bindSceneGroundingLineage,
  buildScenePlanningGroundingContext,
  type AiStoryAssetAnalysisSnapshot,
  type AiStoryAssetMatchingResult,
} from "@ceo-agent/shared";

const ids = {
  org: "10000000-0000-4000-8000-000000000001",
  workspace: "20000000-0000-4000-8000-000000000002",
  story: "30000000-0000-4000-8000-000000000003",
  version: "40000000-0000-4000-8000-000000000004",
  result: "50000000-0000-4000-8000-000000000005",
  productAsset: "60000000-0000-4000-8000-000000000006",
  menuAsset: "60000000-0000-4000-8000-000000000007",
  productSnapshot: "70000000-0000-4000-8000-000000000008",
  menuSnapshot: "70000000-0000-4000-8000-000000000009",
  productBinding: "80000000-0000-4000-8000-000000000010",
  menuBinding: "80000000-0000-4000-8000-000000000011",
};
const hash = `sha256:${"a".repeat(64)}`;

function snapshot(input: {
  id: string;
  assetId: string;
  visibleText?: string[];
  objects: string[];
  candidates: Array<{
    name: string;
    relationship: "PRIMARY_PRODUCT" | "CATALOG_CHOICE";
    evidence: string[];
  }>;
}): AiStoryAssetAnalysisSnapshot {
  return {
    snapshotId: input.id,
    orgId: ids.org,
    workspaceId: ids.workspace,
    sourceAssetId: input.assetId,
    analyzedContentHash: hash,
    analyzerVersion: "emberos-asset-visual-semantic-analyzer.v2",
    schemaVersion: "ai-story-asset-visual-semantics.v1",
    analysis: {
      fileKind: "IMAGE",
      usable: true,
      rejectionReasons: [],
      affordances: {
        visualReference: true,
        firstFrame: true,
        sourceMotion: false,
        sourceAudio: false,
        productGrounding: true,
        characterGrounding: false,
      },
      facts: {
        visualSemantics: {
          contractVersion: "ai-story-asset-visual-semantics.v1",
          observed: {
            visibleText: input.visibleText ?? [],
            namedItems: [],
            objects: input.objects,
            people: [],
            environmentCues: [],
            brandOrLogoCues: [],
          },
          inferred: {
            categories: input.visibleText ? ["MENU_OR_CATALOG"] : ["PRODUCT"],
            productCandidates: input.candidates.map((candidate) => ({
              ...candidate,
              confidence: 0.9,
            })),
            productGroundingSupported: true,
            characterGroundingSupported: false,
          },
        },
      },
    },
    analysisFingerprint: `sha256:${"b".repeat(64)}`,
    createdAt: "2026-09-27T00:00:00.000Z",
  };
}

const productSnapshot = snapshot({
  id: ids.productSnapshot,
  assetId: ids.productAsset,
  objects: ["rice", "cucumber", "boiled egg", "peanuts", "fried anchovies", "sambal", "banana leaf", "plate"],
  candidates: [{ name: "Nasi Lemak", relationship: "PRIMARY_PRODUCT", evidence: ["rice and sambal composition"] }],
});
const menuSnapshot = snapshot({
  id: ids.menuSnapshot,
  assetId: ids.menuAsset,
  visibleText: ["Nasi Lemak", "Ayam Rendang", "Mee Goreng"],
  objects: ["menu card"],
  candidates: [
    { name: "Nasi Lemak", relationship: "CATALOG_CHOICE", evidence: ["visible menu text"] },
    { name: "Ayam Rendang", relationship: "CATALOG_CHOICE", evidence: ["visible menu text"] },
  ],
});

const matching: AiStoryAssetMatchingResult = {
  contractVersion: "ai-story-asset-matching.v1",
  matchingResultId: ids.result,
  orgId: ids.org,
  workspaceId: ids.workspace,
  storyId: ids.story,
  storyVersionId: ids.version,
  storyVersionNumber: 1,
  requirements: {
    characterIdentityRequired: false,
    productIdentityRequired: true,
    environmentFidelityRequired: false,
    sourceMotionRequired: false,
    visualContinuityRequired: false,
    brandingRequired: false,
    nativeDialogueDesired: true,
    narrationDesired: false,
    postTtsDesired: false,
    silenceDesired: false,
    sourceAudioPreserveDesired: false,
    sourceAudioReplaceDesired: false,
  },
  bindings: [
    {
      bindingId: ids.productBinding, orgId: ids.org, workspaceId: ids.workspace,
      storyId: ids.story, storyVersionId: ids.version, assetId: ids.productAsset,
      assetContentHash: hash, analysisSnapshotId: ids.productSnapshot,
      analysisContentHash: hash, role: "PRODUCT_AUTHORITY", required: true,
      reason: "Accepted primary Product", trace: ["authority"], status: "ACTIVE",
      createdAt: "2026-09-27T00:00:00.000Z",
    },
    {
      bindingId: ids.menuBinding, orgId: ids.org, workspaceId: ids.workspace,
      storyId: ids.story, storyVersionId: ids.version, assetId: ids.menuAsset,
      assetContentHash: hash, analysisSnapshotId: ids.menuSnapshot,
      analysisContentHash: hash, role: "SUPPORTING_REFERENCE", required: false,
      reason: "Accepted menu evidence", trace: ["authority"], status: "ACTIVE",
      createdAt: "2026-09-27T00:00:00.000Z",
    },
  ],
  satisfiedRequirements: ["PRODUCT_IDENTITY"],
  missingRequirements: [],
  assetRecommendationStatus: "SATISFIED",
  recommendedUploadRoles: [],
  audioIntent: "NATIVE_DIALOGUE",
  characterDnaAuthority: null,
  noAssetConfirmation: null,
  trace: [{ step: "MATCH", outcome: "SATISFIED", assetIds: [ids.productAsset, ids.menuAsset] }],
  matcherVersion: "matcher.v1",
  createdAt: "2026-09-27T00:00:00.000Z",
};

const context = buildScenePlanningGroundingContext({
  result: matching,
  snapshots: [productSnapshot, menuSnapshot],
});

describe("P0 Scene grounding lineage", () => {
  it("projects accepted bindings and exact semantic Snapshot lineage without analyzer work", () => {
    expect(context.matchingResultId).toBe(ids.result);
    expect(context.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "PRODUCT_AUTHORITY", analysisSnapshotId: ids.productSnapshot }),
      expect.objectContaining({ role: "SUPPORTING_REFERENCE", analysisSnapshotId: ids.menuSnapshot }),
    ]));
  });

  it("propagates Product authority and keeps a supporting reference in its accepted role", () => {
    const lineage = bindSceneGroundingLineage({
      context,
      sceneIds: ["scene-1"],
      proposals: [{
        sceneId: "scene-1",
        narrativeIntent: "The customer chooses the Nasi Lemak.",
        visualIntent: "Show the accepted meal composition.",
        evidence: [
          { bindingId: ids.productBinding, groundedFacts: ["Nasi Lemak", "rice", "sambal"] },
          { bindingId: ids.menuBinding, groundedFacts: ["Nasi Lemak"] },
        ],
        visualClaims: [{ subject: "Nasi Lemak", detail: "rice", evidenceLevel: "OBSERVED_APPEARANCE" }],
      }],
    }).get("scene-1")!;
    expect(lineage.evidence.find((item) => item.bindingId === ids.productBinding)?.role).toBe("PRODUCT_AUTHORITY");
    expect(lineage.evidence.find((item) => item.bindingId === ids.menuBinding)?.role).toBe("SUPPORTING_REFERENCE");
    expect(lineage.evidence[0]?.semanticSnapshotId).toBe(ids.productSnapshot);
  });

  it("allows a future menu item as existence-only evidence", () => {
    const lineage = bindSceneGroundingLineage({
      context,
      sceneIds: ["scene-1"],
      proposals: [{
        sceneId: "scene-1",
        narrativeIntent: "The customer wants Ayam Rendang tomorrow.",
        visualIntent: "Reference its exact menu name only.",
        evidence: [{ bindingId: ids.menuBinding, groundedFacts: ["Ayam Rendang"] }],
        visualClaims: [{ subject: "Ayam Rendang", detail: "Ayam Rendang", evidenceLevel: "EXISTENCE_ONLY" }],
      }],
    }).get("scene-1")!;
    expect(lineage.visualClaims[0]?.evidenceLevel).toBe("EXISTENCE_ONLY");
  });

  it("rejects detailed appearance for a menu-only future item", () => {
    expect(() => bindSceneGroundingLineage({
      context,
      sceneIds: ["scene-1"],
      proposals: [{
        sceneId: "scene-1", narrativeIntent: "Future choice", visualIntent: "Show the dish",
        evidence: [{ bindingId: ids.menuBinding, groundedFacts: ["Ayam Rendang"] }],
        visualClaims: [{ subject: "Ayam Rendang", detail: "crispy chicken", evidenceLevel: "OBSERVED_APPEARANCE" }],
      }],
    })).toThrow(/unsupported appearance/);
  });

  it("rejects an unsupported Product invention", () => {
    expect(() => bindSceneGroundingLineage({
      context,
      sceneIds: ["scene-1"],
      proposals: [{
        sceneId: "scene-1", narrativeIntent: "Invent a product", visualIntent: "Show it",
        evidence: [{ bindingId: ids.menuBinding, groundedFacts: ["Ayam Rendang"] }],
        visualClaims: [{ subject: "Burger", detail: "Burger", evidenceLevel: "EXISTENCE_ONLY" }],
      }],
    })).toThrow(/unsupported visual subject/);
  });

  it("rejects facts that do not exist in the selected immutable Snapshot", () => {
    expect(() => bindSceneGroundingLineage({
      context,
      sceneIds: ["scene-1"],
      proposals: [{
        sceneId: "scene-1", narrativeIntent: "Meal detail", visualIntent: "Show food",
        evidence: [{ bindingId: ids.productBinding, groundedFacts: ["lobster"] }],
        visualClaims: [],
      }],
    })).toThrow(/not backed/);
  });

  it("requires one grounding selection for every Scene", () => {
    expect(() => bindSceneGroundingLineage({ context, sceneIds: ["scene-1"], proposals: [] }))
      .toThrow(/cover every planned Scene/);
  });

  it("rejects stale Story Version authority", () => {
    expect(() => assertScenePlanningGroundingScope(context, {
      orgId: ids.org,
      workspaceId: ids.workspace,
      storyId: ids.story,
      storyVersionId: "40000000-0000-4000-8000-000000000099",
    })).toThrow(/stale Story Version/);
  });
});
