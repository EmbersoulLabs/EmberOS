import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_ASSET_USAGE_TYPES,
  AiStoryAssetSelectionSchema,
  AiStoryCreateBodySchema,
  planAiStoryAssetLinkUsage,
} from "@ceo-agent/shared";
import { resolveEffectiveSceneGenerationAuthority } from "../packages/agents/src/ai-story/scene-execution-compiler";
import {
  AiStoryProductSourceAuthorityError,
  verifyExplicitStoryProductSources,
  type AiStoryProductSourceAssetCandidate,
} from "../apps/web/src/lib/ai-story-product-sources";

const id = (n: number) =>
  `92000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (letter: string) => `sha256:${letter.repeat(64)}`;

const scope = {
  storyId: id(1),
  orgId: id(2),
  workspaceId: id(3),
  campaignId: id(4),
};

function asset(
  assetId: string,
  overrides: Partial<AiStoryProductSourceAssetCandidate> = {}
): AiStoryProductSourceAssetCandidate {
  return {
    id: assetId,
    orgId: scope.orgId,
    workspaceId: scope.workspaceId,
    status: "ready",
    deletedAt: null,
    contentHash: hash("a"),
    ...overrides,
  };
}

function verify(options: {
  assetIds?: string[];
  productAssetIds?: string[];
  assets?: AiStoryProductSourceAssetCandidate[];
  campaignAssetIds?: Set<string>;
} = {}) {
  const assetIds = options.assetIds ?? [id(10), id(11)];
  const productAssetIds = options.productAssetIds ?? [id(10)];
  return verifyExplicitStoryProductSources({
    ...scope,
    assetIds,
    productAssetIds,
    assets: options.assets ?? productAssetIds.map((assetId) => asset(assetId)),
    campaignAssetIds: options.campaignAssetIds ?? new Set(productAssetIds),
  });
}

describe("AI Story explicit Story Product source authority", () => {
  it("supports only reference and explicit product_source usage", () => {
    expect(AI_STORY_ASSET_USAGE_TYPES).toEqual(["reference", "product_source"]);
  });

  it("persists one deterministic semantic row per selected Asset", () => {
    const result = planAiStoryAssetLinkUsage({
      assetIds: [id(11), id(10)],
      productAssetIds: [id(10)],
    });
    expect(result).toEqual([
      { assetId: id(10), usageType: "product_source" },
      { assetId: id(11), usageType: "reference" },
    ]);
    expect(new Set(result.map((row) => row.assetId)).size).toBe(result.length);
    expect(planAiStoryAssetLinkUsage({ assetIds: [id(11), id(10)], productAssetIds: [id(10)] })).toEqual(result);
  });

  it("requires every explicit Product to be selected for the Story", () => {
    expect(
      AiStoryAssetSelectionSchema.safeParse({ assetIds: [id(10)], productAssetIds: [id(11)] }).success
    ).toBe(false);
    expect(
      AiStoryCreateBodySchema.safeParse({
        title: "Story",
        originalIdea: "Show the product",
        assetIds: [id(10)],
        productAssetIds: [id(11)],
      }).success
    ).toBe(false);
  });

  it("rejects duplicate selection IDs and defaults legacy Product designation to empty", () => {
    expect(AiStoryAssetSelectionSchema.safeParse({ assetIds: [id(10), id(10)] }).success).toBe(false);
    const legacy = AiStoryCreateBodySchema.parse({
      title: "Legacy Story",
      originalIdea: "Keep generic references generic",
      assetIds: [id(10)],
    });
    expect(legacy.productAssetIds).toEqual([]);
    expect(planAiStoryAssetLinkUsage(legacy)).toEqual([
      { assetId: id(10), usageType: "reference" },
    ]);
  });

  it("resolves exact persisted Product facts without labels or metadata", () => {
    const result = verify();
    expect(result).toEqual([
      {
        ...scope,
        assetId: id(10),
        usageType: "product_source",
        contentHash: hash("a"),
        status: "ready",
      },
    ]);
    expect(result[0]).not.toHaveProperty("displayName");
    expect(result[0]).not.toHaveProperty("metadata");
  });

  it("fails closed for cross-org, cross-workspace, cross-Campaign, deleted, or unready Product Assets", () => {
    expect(() => verify({ assets: [asset(id(10), { orgId: id(98) })] })).toThrowError(
      AiStoryProductSourceAuthorityError
    );
    expect(() => verify({ assets: [asset(id(10), { workspaceId: id(99) })] })).toThrowError(
      AiStoryProductSourceAuthorityError
    );
    expect(() => verify({ campaignAssetIds: new Set() })).toThrow(/Campaign/);
    expect(() => verify({ assets: [asset(id(10), { deletedAt: new Date() })] })).toThrow(/deleted/);
    expect(() => verify({ assets: [asset(id(10), { status: "uploading" })] })).toThrow(/not ready/);
  });

  it("requires an existing canonical lowercase sha256 content identity", () => {
    for (const contentHash of [null, "", `sha256:${"A".repeat(64)}`, `sha256:${"a".repeat(63)}`]) {
      expect(() => verify({ assets: [asset(id(10), { contentHash })] })).toThrow(
        /canonical content identity/
      );
    }
  });

  it("uses exact IDs, so equal display labels cannot designate another Asset", () => {
    const rows = planAiStoryAssetLinkUsage({
      assetIds: [id(10), id(11)],
      productAssetIds: [id(11)],
    });
    expect(rows.find((row) => row.assetId === id(10))?.usageType).toBe("reference");
    expect(rows.find((row) => row.assetId === id(11))?.usageType).toBe("product_source");
  });

  it("keeps Product designation empty by default and removes it when Story selection is removed", () => {
    const ui = readFileSync(
      "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/new/page.tsx",
      "utf8"
    );
    expect(ui).toContain("const [productAssetIds, setProductAssetIds] = useState<string[]>([])");
    expect(ui).toContain("setProductAssetIds([])");
    expect(ui).toContain("prev.filter((id) => id !== asset.id)");
    expect(ui).toContain("productAssetIds,");
    expect(ui).toContain("This is a Product");
  });

  it("does not classify by Product-like labels, filenames, or Photo Scene metadata", () => {
    const service = readFileSync("apps/web/src/lib/ai-story-product-sources.ts", "utf8");
    expect(service).not.toMatch(/displayName|originalFilename|storagePath/);
    expect(service).not.toMatch(/readPhotoSceneMetadata|photoScene\.role/);
    expect(planAiStoryAssetLinkUsage({ assetIds: [id(10)], productAssetIds: [] })[0]).toEqual({
      assetId: id(10),
      usageType: "reference",
    });
  });

  it("does not invoke preparation or Provider paths", () => {
    const service = readFileSync("apps/web/src/lib/ai-story-product-sources.ts", "utf8");
    const route = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/route.ts",
      "utf8"
    );
    for (const source of [service, route]) {
      expect(source).not.toMatch(/removeBackground|PhotoRoom|extracted_product|Seedance|dispatch/i);
    }
  });

  it("leaves explicit human narrative T2V reference-free", () => {
    const resolved = resolveEffectiveSceneGenerationAuthority(
      {
        id: "scene-human",
        beatIds: ["beat-human"],
        purpose: "Human narrative with a Product fact",
        durationSec: 6,
        transition: "cut",
        continuityNotes: "Product does not require visual conditioning",
        order: 0,
        generationAuthority: {
          strategy: "TEXT_TO_VIDEO",
          referenceSource: "REFERENCE_FREE_T2V",
          effectiveReferenceIds: [],
          firstFrameAssetId: null,
          productVisualIdentityRequirement: "NONE",
        },
      },
      [id(10)]
    );
    expect(resolved.effectiveReferenceIds).toEqual([]);
    expect(resolved.firstFrameAssetId).toBeNull();
  });
});
