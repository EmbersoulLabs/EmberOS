import { describe, expect, it } from "vitest";
import { revalidatePlanningProductMaterialAuthority } from "../apps/web/src/lib/ai-story-product-material-runtime";
import {
  AiStoryProductSourceAuthorityError,
  confirmedVariantBySourceAsset,
} from "../apps/web/src/lib/ai-story-product-sources";

const id = (n: number) => `97000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

describe("planning product material authority contract", () => {
  it("keeps character-only and reference-free scenes out of product material selection", async () => {
    const input = {
      orgId: id(1),
      workspaceId: id(2),
      campaignId: id(3),
      storyId: id(4),
      storyVersionId: id(5),
      actorUserId: id(6),
      canonicalScenes: [
        {
          sceneId: id(7),
          sceneVersionId: id(8),
          generationAuthority: {
            strategy: "TEXT_TO_VIDEO" as const,
            referenceSource: "CHARACTER_SYNTHETIC_ANCHOR" as const,
            referenceAssetIds: [id(9)],
            firstFrameAssetId: null,
            productVisualIdentityRequirement: "NONE" as const,
          },
        },
        {
          sceneId: id(10),
          sceneVersionId: id(11),
          generationAuthority: {
            strategy: "TEXT_TO_VIDEO" as const,
            referenceSource: "REFERENCE_FREE_T2V" as const,
            referenceAssetIds: [],
            firstFrameAssetId: null,
            productVisualIdentityRequirement: "NONE" as const,
          },
        },
      ],
    };
    const first = await revalidatePlanningProductMaterialAuthority(input);
    const second = await revalidatePlanningProductMaterialAuthority(input);
    expect(first.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("fails closed when one source Asset has conflicting confirmed variants", () => {
    expect(() => confirmedVariantBySourceAsset([
      { assetId: id(1), confirmedVariant: "north-facing" },
      { assetId: id(1), confirmedVariant: "south-facing" },
    ])).toThrowError(AiStoryProductSourceAuthorityError);
    try {
      confirmedVariantBySourceAsset([
        { assetId: id(1), confirmedVariant: "north-facing" },
        { assetId: id(1), confirmedVariant: null },
      ]);
    } catch (error) {
      expect(error).toMatchObject({ code: "PRODUCT_SOURCE_VARIANT_AMBIGUOUS" });
    }
    expect(confirmedVariantBySourceAsset([
      { assetId: id(1), confirmedVariant: "north-facing" },
      { assetId: id(1), confirmedVariant: "north-facing" },
    ]).get(id(1))).toBe("north-facing");
  });
});
