import { describe, expect, it } from "vitest";
import {
  mapCompiledInstructionsToCanonicalScenePayload,
} from "../packages/agents/src/ai-story/canonical-scene-payload-resolver";
import {
  buildProductGroundingContract,
  evaluateProductGroundingPreDispatch,
  PRIMARY_PRODUCT_REFERENCE_ROLE,
  PRODUCT_GROUNDED_VIDEO_MODE,
  PRODUCT_LOCK_PROMPT,
} from "../packages/agents/src/ai-story/product-grounding-contract";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";

const R3_PRODUCT_ASSET_ID = "c0e04afc-01fc-4578-8697-ec76fb6d0a82";
const R3_SCENE_1_ID = "0209531f-1385-55b5-bf52-a4439c2ceb1e";

function serverCertification(assetId = R3_PRODUCT_ASSET_ID) {
  return {
    contractVersion: "1" as const,
    certificationSource: "SERVER_AUTHORITY" as const,
    status: "CERTIFIED" as const,
    productAssetId: assetId,
    orgId: "10000000-0000-4000-8000-000000000002",
    workspaceId: "10000000-0000-4000-8000-000000000003",
    campaignId: "10000000-0000-4000-8000-000000000004",
    executionPlanId: "10000000-0000-4000-8000-000000000101",
    sceneExecutionId: "10000000-0000-4000-8000-000000000201",
    assetExists: true as const,
    ownershipBound: true as const,
    campaignProductBinding: true as const,
    providerAccessibleFirstFrame: true as const,
    authorityConflictAbsent: true as const,
    previousSceneVisualAuthorityUsed: false as const,
  };
}

describe("AI Story canonical product authority and fail-closed grounding", () => {
  it("detects the certified R3 authority conflict and blocks Attempt 3", () => {
    const compilation = makePhase2aCompilation();
    const scene2 = compilation.intents[1]!;
    const instructions = {
      ...compilation.instructionsBySceneExecutionId[
        scene2.identity.sceneExecutionId
      ]!,
      referencedAssetIds: [R3_PRODUCT_ASSET_ID],
      shots: compilation.instructionsBySceneExecutionId[
        scene2.identity.sceneExecutionId
      ]!.shots.map((shot) => ({
        ...shot,
        cameraType: "Medium shot",
        cameraMovement: "Pan",
      })),
    };
    const payload = mapCompiledInstructionsToCanonicalScenePayload({
      instructions,
      intent: { ...scene2, referencedAssetIds: [R3_PRODUCT_ASSET_ID] },
      continuityFromSceneId: R3_SCENE_1_ID,
      productAuthorityAssessment: {
        status: "CONFLICT",
        conflictDimensions: [
          "PRODUCT_CLASS",
          "MAJOR_ARRANGEMENT_STRUCTURE",
          "CONTAINER_OR_WRAPPING",
          "MAJOR_COLOR_COMPOSITION",
          "HERO_OBJECT_IDENTITY",
        ],
      },
      productGroundedProviderMode: "FIRST_FRAME_I2V",
      productGroundedProviderModeCertified: true,
    });

    expect(payload.generationMode).toBe(PRODUCT_GROUNDED_VIDEO_MODE);
    expect(payload.assetReferences).toEqual([
      {
        assetId: R3_PRODUCT_ASSET_ID,
        role: PRIMARY_PRODUCT_REFERENCE_ROLE,
        continuityScope: "STORY",
      },
    ]);
    expect(payload.productGrounding).toMatchObject({
      primaryAuthority: {
        kind: "CAMPAIGN_PRODUCT_ASSET",
        assetId: R3_PRODUCT_ASSET_ID,
      },
      secondaryAuthority: {
        kind: "APPROVED_PREVIOUS_SCENE_MEDIA",
        sceneId: R3_SCENE_1_ID,
        mayOverrideProductIdentity: false,
      },
      authorityStatus: "CONFLICT",
      providerMode: "FIRST_FRAME_I2V",
      providerModeCertified: true,
      directorCameraPolicy: {
        compatible: false,
        cameraMoves: ["Medium shot: Pan"],
      },
    });
    expect(payload.prompt).toContain(
      "Image 1 = the canonical Campaign Product Asset"
    );
    expect(payload.prompt).toContain(PRODUCT_LOCK_PROMPT);

    const gate = evaluateProductGroundingPreDispatch({
      grounding: payload.productGrounding!,
      visualAuthorityCertification: payload.visualAuthorityCertification,
      prompt: payload.prompt,
      assetReferences: payload.assetReferences,
    });
    expect(gate.status).toBe("BLOCKED_PRE_DISPATCH");
    expect(gate.blockers).toContain("PRODUCT_VISUAL_AUTHORITY_CONFLICT");
    expect(gate.blockers).not.toContain("PRODUCT_GROUNDED_PROVIDER_MODE_UNCERTIFIED");
    expect(gate.blockers).not.toContain("GENERIC_REFERENCE_T2V_INSUFFICIENT");
    expect(gate.blockers).toContain(
      "DIRECTOR_CAMERA_INCOMPATIBLE_WITH_PRODUCT_LOCK"
    );
  });

  it("blocks Director shots that require invented product geometry", () => {
    const compilation = makePhase2aCompilation();
    const scene = compilation.intents[0]!;
    const base = compilation.instructionsBySceneExecutionId[
      scene.identity.sceneExecutionId
    ]!;
    const payload = mapCompiledInstructionsToCanonicalScenePayload({
      intent: scene,
      instructions: {
        ...base,
        shots: base.shots.map((shot) => ({
          ...shot,
          cameraMovement: "360-degree orbit with an unseen backside reveal",
        })),
      },
      productAuthorityAssessment: { status: "RESOLVED" },
      visualAuthorityCertification: serverCertification(
        scene.referencedAssetIds[0]
      ),
      productGroundedProviderMode: "FIRST_FRAME_I2V",
      productGroundedProviderModeCertified: true,
    });

    const gate = evaluateProductGroundingPreDispatch({
      grounding: payload.productGrounding!,
      visualAuthorityCertification: payload.visualAuthorityCertification,
      prompt: payload.prompt,
      assetReferences: payload.assetReferences,
    });
    expect(payload.productGrounding?.directorCameraPolicy.compatible).toBe(false);
    expect(gate.status).toBe("BLOCKED_PRE_DISPATCH");
    expect(gate.blockers).toContain(
      "DIRECTOR_CAMERA_INCOMPATIBLE_WITH_PRODUCT_LOCK"
    );
  });

  it("certifies a clean three-Scene R4 contract without Provider work", () => {
    const compilation = makePhase2aCompilation({ sceneOrder: [0, 1, 2] });
    const payloads = compilation.intents.map((intent, index) =>
      mapCompiledInstructionsToCanonicalScenePayload({
        intent,
        instructions:
          compilation.instructionsBySceneExecutionId[
            intent.identity.sceneExecutionId
          ]!,
        ...(index > 0
          ? { continuityFromSceneId: compilation.intents[index - 1]!.identity.sceneId }
          : {}),
        productAuthorityAssessment: { status: "RESOLVED" },
        visualAuthorityCertification: serverCertification(
          intent.referencedAssetIds[0]
        ),
        productGroundedProviderMode: "FIRST_FRAME_I2V",
        productGroundedProviderModeCertified: true,
      })
    );

    for (const payload of payloads) {
      expect(
        evaluateProductGroundingPreDispatch({
          grounding: payload.productGrounding!,
          visualAuthorityCertification: payload.visualAuthorityCertification,
          prompt: payload.prompt,
          assetReferences: payload.assetReferences,
        })
      ).toEqual({ status: "ALLOWED", blockers: [] });
    }
    expect(payloads.map((payload) => payload.generationMode)).toEqual([
      PRODUCT_GROUNDED_VIDEO_MODE,
      PRODUCT_GROUNDED_VIDEO_MODE,
      PRODUCT_GROUNDED_VIDEO_MODE,
    ]);
  });

  it("never promotes previous Scene media into primary product authority", () => {
    const compilation = makePhase2aCompilation();
    const scene = compilation.intents[1]!;
    const payload = mapCompiledInstructionsToCanonicalScenePayload({
      intent: scene,
      instructions:
        compilation.instructionsBySceneExecutionId[
          scene.identity.sceneExecutionId
        ]!,
      continuityFromSceneId: R3_SCENE_1_ID,
      productAuthorityAssessment: { status: "RESOLVED" },
      visualAuthorityCertification: serverCertification(
        scene.referencedAssetIds[0]
      ),
      productGroundedProviderMode: "FIRST_FRAME_I2V",
      productGroundedProviderModeCertified: true,
    });

    expect(payload.productGrounding?.primaryAuthority.kind).toBe(
      "CAMPAIGN_PRODUCT_ASSET"
    );
    expect(payload.productGrounding?.secondaryAuthority).toBeUndefined();
    expect(
      payload.visualAuthorityCertification?.previousSceneVisualAuthorityUsed
    ).toBe(false);
  });

  it("requires an explicit allowed operator decision to resolve a known conflict", () => {
    const compilation = makePhase2aCompilation();
    const scene = compilation.intents[0]!;
    const instructions =
      compilation.instructionsBySceneExecutionId[
        scene.identity.sceneExecutionId
      ]!;

    expect(() =>
      buildProductGroundingContract({
        productAssetId: scene.referencedAssetIds[0]!,
        instructions,
        authorityAssessment: {
          status: "RESOLVED",
          conflictDimensions: ["MAJOR_ARRANGEMENT_STRUCTURE"],
        },
      })
    ).toThrow(/explicit operator decision/i);

    expect(
      buildProductGroundingContract({
        productAssetId: scene.referencedAssetIds[0]!,
        instructions,
        authorityAssessment: {
          status: "RESOLVED",
          conflictDimensions: ["MAJOR_ARRANGEMENT_STRUCTURE"],
          operatorResolutionDecision:
            "KEEP_CAMPAIGN_PRODUCT_ASSET_AS_CANONICAL",
        },
      }).operatorResolutionDecision
    ).toBe("KEEP_CAMPAIGN_PRODUCT_ASSET_AS_CANONICAL");
  });
});
