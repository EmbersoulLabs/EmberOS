import { describe, expect, it } from "vitest";
import {
  CANONICAL_PRODUCT_REFERENCE_ROLE,
  type CanonicalScenePayloadForAdapter,
} from "../packages/agents/src/ai-story/canonical-scene-payload-resolver";
import { certifyExactProductVisualGrounding } from "../packages/agents/src/ai-story/exact-product-visual-grounding";
import type { SeedanceModelArkCreateRequest } from "../packages/agents/src/ai-story/seedance-request-mapping";

const PRODUCT_ASSET_ID = "c0e04afc-01fc-4578-8697-ec76fb6d0a82";

function payload(): CanonicalScenePayloadForAdapter {
  return {
    kind: "animation-video-generation",
    prompt: "Show the same arrangement from another angle.",
    durationMs: 10_000,
    aspectRatio: "9:16",
    identityConstraints: ["Preserve product shape exactly"],
    shotMap: [],
    assetReferences: [
      {
        assetId: PRODUCT_ASSET_ID,
        role: CANONICAL_PRODUCT_REFERENCE_ROLE,
        continuityScope: "STORY",
      },
    ],
    productIdentityCapsule: {
      productAssetId: PRODUCT_ASSET_ID,
      productReferencePresent: true,
      continuityFromSceneId: "0209531f-1385-55b5-bf52-a4439c2ceb1e",
      referenceRoles: [CANONICAL_PRODUCT_REFERENCE_ROLE],
      identityFingerprint: "sha256:test-only",
    },
  };
}

function attempt2Request(): SeedanceModelArkCreateRequest {
  return {
    model: "dreamina-seedance-2-0-260128",
    content: [
      {
        type: "text",
        text: "Show the same arrangement from another angle. Constraints: Preserve product shape exactly",
      },
      {
        type: "image_url",
        image_url: { url: "https://storage.invalid/signed/product.png" },
        role: "reference_image",
      },
    ],
    duration: 10,
    ratio: "9:16",
    resolution: "480p",
    generate_audio: false,
    watermark: false,
  };
}

describe("AI Story exact product visual grounding certification", () => {
  it("certifies the current R3 request as asset-referenced T2V and unsafe", () => {
    const certification = certifyExactProductVisualGrounding({
      payload: payload(),
      providerRequest: attempt2Request(),
      authorityComparison: "CONFLICT",
      previousSceneVisualReferencePresent: false,
      exactProductLockContractPresent: false,
      providerCanEnforceExactProductContinuity: false,
    });

    expect(certification).toMatchObject({
      productAssetId: PRODUCT_ASSET_ID,
      productReferencePresent: true,
      providerReferenceCount: 1,
      providerMode: "ASSET_REFERENCED_T2V",
      previousSceneVisualReferencePresent: false,
      explicitReferenceBindingPresent: false,
      exactProductLockContractPresent: false,
      providerCanEnforceExactProductContinuity: false,
      authorityComparison: "CONFLICT",
      safeToAuthorize: false,
    });
    expect(certification.blockers).toEqual([
      "APPROVED_PREVIOUS_SCENE_VISUAL_REFERENCE_MISSING",
      "PROMPT_REFERENCE_ASSOCIATION_AMBIGUOUS",
      "CAMPAIGN_ASSET_AND_APPROVED_SCENE_CONFLICT",
      "EXACT_PRODUCT_LOCK_CONTRACT_MISSING",
      "PROVIDER_EXACT_CONTINUITY_NOT_ENFORCEABLE",
    ]);
    expect(certification).not.toHaveProperty("signedUrl");
  });

  it("does not mistake first-frame conditioning for an exact lock", () => {
    const request: SeedanceModelArkCreateRequest = {
      ...attempt2Request(),
      content: [
        {
          type: "text",
          text: "Use Image 1 as the product and Image 2 as the approved previous Scene frame.",
        },
        attempt2Request().content[1]!,
        {
          type: "image_url",
          image_url: { url: "https://storage.invalid/signed/scene-1-frame.png" },
          role: "first_frame",
        },
      ],
    };
    const certification = certifyExactProductVisualGrounding({
      payload: payload(),
      providerRequest: request,
      authorityComparison: "CONFLICT",
      previousSceneVisualReferencePresent: true,
      exactProductLockContractPresent: false,
      providerCanEnforceExactProductContinuity: false,
    });

    expect(certification.providerMode).toBe("FIRST_FRAME_I2V");
    expect(certification.explicitReferenceBindingPresent).toBe(true);
    expect(certification.safeToAuthorize).toBe(false);
    expect(certification.blockers).toContain(
      "CAMPAIGN_ASSET_AND_APPROVED_SCENE_CONFLICT"
    );
    expect(certification.blockers).toContain(
      "PROVIDER_EXACT_CONTINUITY_NOT_ENFORCEABLE"
    );
  });
});
