import { describe, expect, it } from "vitest";
import {
  classifyProviderPolicyRejection,
  promoteProviderExecutableSceneInput,
  resolveProviderPolicyEligibility,
  type ProviderPolicyEligibilityInput,
} from "../packages/agents/src/ai-story/provider-policy-eligibility";
import type { ProviderReadySceneInputAuthority } from "../packages/agents/src/ai-story/scene-input-preparation";

const READY: ProviderReadySceneInputAuthority = {
  contractVersion: "ai-story-provider-ready-scene-input.v1",
  preparationAuthorityId: "scene-2-preparation",
  preparationFingerprint: `sha256:${"a".repeat(64)}`,
  sourceKind: "PREPARED_DERIVATIVE",
  assetId: "fb7a5783-99b2-58dd-bb79-f0dac81681a4",
  contentHash: "sha256:99ae66fa4faaab1076d8a83e49c6aece3f739051f2db98f9ea3a76bcccb3fffa",
  providerMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
  fingerprint: `sha256:${"b".repeat(64)}`,
};

function input(overrides: Partial<ProviderPolicyEligibilityInput> = {}): ProviderPolicyEligibilityInput {
  return {
    providerId: "seedance",
    modelId: "dreamina-seedance-2-0-260128",
    mode: "FIRST_FRAME_IMAGE_TO_VIDEO",
    providerReadySceneInputFingerprint: READY.fingerprint,
    narrativeWorldStateIdentity: `sha256:${"c".repeat(64)}`,
    sceneContent: "PRODUCT_ONLY",
    assetProvenance: "AI_GENERATED",
    deliveryRoute: "RAW_SIGNED_HTTPS",
    providerModeSupported: true,
    officialHumanAssetRoute: "REQUIRES_ENABLEMENT",
    portraitCapabilityEnabled: "UNPROVEN",
    assetManagementEnabled: "UNPROVEN",
    humanAuthorizationSatisfied: false,
    sceneReady: true,
    narrativeQc: "PASS",
    ...overrides,
  };
}

describe("AI Story V1 Provider-policy eligibility", () => {
  it("maps the proven privacy rejection to a non-retryable policy routing requirement", () => {
    expect(classifyProviderPolicyRejection({
      nativeCode: "InputImageSensitiveContentDetected.PrivacyInformation",
      nativeType: "BadRequest",
    })).toEqual({
      classification: "HUMAN_PORTRAIT_AUTHORIZATION_REQUIRED",
      retryable: false,
      creativeFailure: false,
      providerPolicyRoutingRequired: true,
    });
  });

  it.each(["HUMAN_PRESENT", "PHOTOREALISTIC_HUMAN"] as const)(
    "blocks visual-QC PASS %s content on the raw signed-URL route",
    (sceneContent) => {
      const result = resolveProviderPolicyEligibility(input({ sceneContent }));
      expect(result.sceneReady).toBe(true);
      expect(result.narrativeQc).toBe("PASS");
      expect(result.eligibility).toBe("REQUIRES_AUTHORIZED_HUMAN_ASSET_ROUTE");
      expect(result.reason).toBe("HUMAN_PORTRAIT_PRIVACY_PRECHECK");
      expect(result.providerExecutable).toBe(false);
      expect(() => promoteProviderExecutableSceneInput({
        providerReadySceneInput: READY,
        providerPolicyEligibility: result,
      })).toThrow("PROVIDER_POLICY_ELIGIBILITY_REQUIRED");
    }
  );

  it.each([
    ["florist", "HUMAN_PRESENT", false],
    ["café", "PHOTOREALISTIC_HUMAN", false],
    ["pet", "PET_ONLY", true],
    ["product", "PRODUCT_ONLY", true],
  ] as const)("routes %s scenes without industry-specific rules", (_industry, sceneContent, executable) => {
    expect(resolveProviderPolicyEligibility(input({ sceneContent })).providerExecutable).toBe(executable);
  });

  it("allows a genuinely enabled and authorized LAS human-material route", () => {
    const result = resolveProviderPolicyEligibility(input({
      sceneContent: "PHOTOREALISTIC_HUMAN",
      assetProvenance: "AUTHORIZED_HUMAN_MATERIAL",
      deliveryRoute: "BYTEPLUS_LAS_MATERIAL_LIBRARY",
      officialHumanAssetRoute: "AVAILABLE",
      portraitCapabilityEnabled: "YES",
      assetManagementEnabled: "YES",
      humanAuthorizationSatisfied: true,
    }));
    expect(result.eligibility).toBe("ELIGIBLE");
    expect(result.selectedStrategy).toBe("AUTHORIZED_HUMAN_ASSET_ROUTE");
    expect(promoteProviderExecutableSceneInput({
      providerReadySceneInput: READY,
      providerPolicyEligibility: result,
    }).providerReadySceneInput.assetId).toBe(READY.assetId);
  });

  it("fails closed when the human route or account capability is unavailable or unknown", () => {
    for (const route of ["REQUIRES_ENABLEMENT", "UNKNOWN"] as const) {
      const result = resolveProviderPolicyEligibility(input({
        sceneContent: "HUMAN_PRESENT",
        deliveryRoute: "BYTEPLUS_LAS_MATERIAL_LIBRARY",
        officialHumanAssetRoute: route,
      }));
      expect(result.eligibility).toBe("PROVIDER_ACCOUNT_CAPABILITY_REQUIRED");
      expect(result.providerExecutable).toBe(false);
    }
  });

  it("never silently falls back from an unauthorized human material route to raw URL", () => {
    const result = resolveProviderPolicyEligibility(input({
      sceneContent: "HUMAN_PRESENT",
      assetProvenance: "AI_GENERATED",
      deliveryRoute: "BYTEPLUS_LAS_MATERIAL_LIBRARY",
      officialHumanAssetRoute: "AVAILABLE",
      portraitCapabilityEnabled: "YES",
      assetManagementEnabled: "YES",
      humanAuthorizationSatisfied: false,
    }));
    expect(result.providerExecutable).toBe(false);
    expect(result.selectedStrategy).toBe("FAIL_CLOSED_HUMAN_ACTION_REQUIRED");
    expect(result.deliveryRoute).toBe("BYTEPLUS_LAS_MATERIAL_LIBRARY");
  });

  it("blocks unsupported modes and unknown content before Provider execution", () => {
    expect(resolveProviderPolicyEligibility(input({ providerModeSupported: false })).eligibility)
      .toBe("PROVIDER_MODE_UNSUPPORTED");
    expect(resolveProviderPolicyEligibility(input({ sceneContent: "UNKNOWN" })).eligibility)
      .toBe("UNKNOWN_REQUIRES_PREFLIGHT");
  });
});
