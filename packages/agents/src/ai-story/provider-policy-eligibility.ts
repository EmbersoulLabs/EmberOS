import { sha256CanonicalIntegrityHash } from "@ceo-agent/shared/server";
import type { ProviderReadySceneInputAuthority } from "./scene-input-preparation";

export const AI_STORY_PROVIDER_POLICY_ELIGIBILITY_CONTRACT_VERSION =
  "ai-story-provider-policy-eligibility.v1" as const;

export const AI_STORY_PROVIDER_POLICY_ELIGIBILITY_RESULTS = [
  "ELIGIBLE",
  "REQUIRES_AUTHORIZED_HUMAN_ASSET_ROUTE",
  "PROVIDER_MODE_UNSUPPORTED",
  "PROVIDER_ACCOUNT_CAPABILITY_REQUIRED",
  "UNKNOWN_REQUIRES_PREFLIGHT",
] as const;

export type ProviderPolicyEligibilityResult =
  (typeof AI_STORY_PROVIDER_POLICY_ELIGIBILITY_RESULTS)[number];

export type ProviderPolicySceneContent =
  | "PRODUCT_ONLY"
  | "PET_ONLY"
  | "HUMAN_PRESENT"
  | "PHOTOREALISTIC_HUMAN"
  | "UNKNOWN";

export type ProviderHumanAssetRouteAvailability =
  | "AVAILABLE"
  | "REQUIRES_ENABLEMENT"
  | "NOT_APPLICABLE"
  | "UNKNOWN";

export type ProviderAccountCapabilityState = "YES" | "NO" | "UNPROVEN";

export type ProviderPolicyExecutionStrategy =
  | "SEEDANCE_FIRST_FRAME_I2V"
  | "AUTHORIZED_HUMAN_ASSET_ROUTE"
  | "ALTERNATIVE_CERTIFIED_PROVIDER_OR_MODE"
  | "FAIL_CLOSED_HUMAN_ACTION_REQUIRED";

export type ProviderPolicyEligibilityAuthority = {
  readonly contractVersion: typeof AI_STORY_PROVIDER_POLICY_ELIGIBILITY_CONTRACT_VERSION;
  readonly providerId: "seedance";
  readonly modelId: "dreamina-seedance-2-0-260128";
  readonly mode: "TEXT_TO_VIDEO" | "FIRST_FRAME_IMAGE_TO_VIDEO";
  readonly providerReadySceneInputFingerprint: string;
  readonly narrativeWorldStateIdentity: string;
  readonly sceneContent: ProviderPolicySceneContent;
  readonly assetProvenance:
    | "AI_GENERATED"
    | "USER_PROVIDED"
    | "LICENSED"
    | "AUTHORIZED_HUMAN_MATERIAL"
    | "UNKNOWN";
  readonly deliveryRoute:
    | "RAW_SIGNED_HTTPS"
    | "BYTEPLUS_LAS_MATERIAL_LIBRARY"
    | "NONE";
  readonly providerModeSupported: boolean;
  readonly officialHumanAssetRoute: ProviderHumanAssetRouteAvailability;
  readonly portraitCapabilityEnabled: ProviderAccountCapabilityState;
  readonly assetManagementEnabled: ProviderAccountCapabilityState;
  readonly humanAuthorizationSatisfied: boolean;
  readonly sceneReady: boolean;
  readonly narrativeQc: "PASS" | "FAIL";
  readonly eligibility: ProviderPolicyEligibilityResult;
  readonly reason:
    | "POLICY_ELIGIBLE"
    | "HUMAN_PORTRAIT_PRIVACY_PRECHECK"
    | "AUTHORIZED_HUMAN_ASSET_REQUIREMENTS_UNSATISFIED"
    | "PROVIDER_CAPABILITY_UNPROVEN"
    | "PROVIDER_MODE_UNSUPPORTED"
    | "CONTENT_CLASSIFICATION_UNKNOWN"
    | "SCENE_NOT_READY";
  readonly selectedStrategy: ProviderPolicyExecutionStrategy;
  readonly providerExecutable: boolean;
  readonly fingerprint: string;
};

export type ProviderPolicyEligibilityInput = Omit<
  ProviderPolicyEligibilityAuthority,
  "contractVersion" | "eligibility" | "reason" | "selectedStrategy" | "providerExecutable" | "fingerprint"
>;

function isHumanScene(content: ProviderPolicySceneContent): boolean {
  return content === "HUMAN_PRESENT" || content === "PHOTOREALISTIC_HUMAN";
}

/**
 * Resolves policy eligibility without making a Provider request. AI-generated
 * human imagery is intentionally not presumed exempt from portrait controls.
 */
export function resolveProviderPolicyEligibility(
  input: ProviderPolicyEligibilityInput
): ProviderPolicyEligibilityAuthority {
  let eligibility: ProviderPolicyEligibilityResult;
  let reason: ProviderPolicyEligibilityAuthority["reason"];
  let selectedStrategy: ProviderPolicyExecutionStrategy;

  if (!input.sceneReady || input.narrativeQc !== "PASS") {
    eligibility = "UNKNOWN_REQUIRES_PREFLIGHT";
    reason = "SCENE_NOT_READY";
    selectedStrategy = "FAIL_CLOSED_HUMAN_ACTION_REQUIRED";
  } else if (!input.providerModeSupported) {
    eligibility = "PROVIDER_MODE_UNSUPPORTED";
    reason = "PROVIDER_MODE_UNSUPPORTED";
    selectedStrategy = "ALTERNATIVE_CERTIFIED_PROVIDER_OR_MODE";
  } else if (input.sceneContent === "UNKNOWN") {
    eligibility = "UNKNOWN_REQUIRES_PREFLIGHT";
    reason = "CONTENT_CLASSIFICATION_UNKNOWN";
    selectedStrategy = "FAIL_CLOSED_HUMAN_ACTION_REQUIRED";
  } else if (isHumanScene(input.sceneContent)) {
    const authorizedMaterial =
      input.deliveryRoute === "BYTEPLUS_LAS_MATERIAL_LIBRARY"
      && input.assetProvenance === "AUTHORIZED_HUMAN_MATERIAL"
      && input.officialHumanAssetRoute === "AVAILABLE"
      && input.portraitCapabilityEnabled === "YES"
      && input.assetManagementEnabled === "YES"
      && input.humanAuthorizationSatisfied;
    if (authorizedMaterial) {
      eligibility = "ELIGIBLE";
      reason = "POLICY_ELIGIBLE";
      selectedStrategy = "AUTHORIZED_HUMAN_ASSET_ROUTE";
    } else if (input.deliveryRoute === "RAW_SIGNED_HTTPS") {
      eligibility = "REQUIRES_AUTHORIZED_HUMAN_ASSET_ROUTE";
      reason = "HUMAN_PORTRAIT_PRIVACY_PRECHECK";
      selectedStrategy = input.officialHumanAssetRoute === "NOT_APPLICABLE"
        ? "ALTERNATIVE_CERTIFIED_PROVIDER_OR_MODE"
        : "FAIL_CLOSED_HUMAN_ACTION_REQUIRED";
    } else if (
      input.officialHumanAssetRoute === "REQUIRES_ENABLEMENT"
      || input.portraitCapabilityEnabled !== "YES"
      || input.assetManagementEnabled !== "YES"
    ) {
      eligibility = "PROVIDER_ACCOUNT_CAPABILITY_REQUIRED";
      reason = "PROVIDER_CAPABILITY_UNPROVEN";
      selectedStrategy = "FAIL_CLOSED_HUMAN_ACTION_REQUIRED";
    } else {
      eligibility = "REQUIRES_AUTHORIZED_HUMAN_ASSET_ROUTE";
      reason = "AUTHORIZED_HUMAN_ASSET_REQUIREMENTS_UNSATISFIED";
      selectedStrategy = "FAIL_CLOSED_HUMAN_ACTION_REQUIRED";
    }
  } else {
    eligibility = "ELIGIBLE";
    reason = "POLICY_ELIGIBLE";
    selectedStrategy = "SEEDANCE_FIRST_FRAME_I2V";
  }

  const withoutFingerprint = {
    contractVersion: AI_STORY_PROVIDER_POLICY_ELIGIBILITY_CONTRACT_VERSION,
    ...input,
    eligibility,
    reason,
    selectedStrategy,
    providerExecutable: eligibility === "ELIGIBLE",
  };
  return {
    ...withoutFingerprint,
    fingerprint: sha256CanonicalIntegrityHash({
      kind: AI_STORY_PROVIDER_POLICY_ELIGIBILITY_CONTRACT_VERSION,
      authority: withoutFingerprint,
    }),
  };
}

export type ProviderExecutableSceneInputAuthority = {
  readonly providerReadySceneInput: ProviderReadySceneInputAuthority;
  readonly providerPolicyEligibility: ProviderPolicyEligibilityAuthority;
};

/** The only policy gate from visually ready input to Provider execution. */
export function promoteProviderExecutableSceneInput(input: {
  readonly providerReadySceneInput: ProviderReadySceneInputAuthority;
  readonly providerPolicyEligibility: ProviderPolicyEligibilityAuthority;
}): ProviderExecutableSceneInputAuthority {
  const eligibility = input.providerPolicyEligibility;
  if (
    eligibility.providerReadySceneInputFingerprint !== input.providerReadySceneInput.fingerprint
    || eligibility.providerId !== "seedance"
    || eligibility.modelId !== "dreamina-seedance-2-0-260128"
    || eligibility.mode !== input.providerReadySceneInput.providerMode
    || eligibility.eligibility !== "ELIGIBLE"
    || !eligibility.providerExecutable
  ) {
    throw new Error("PROVIDER_POLICY_ELIGIBILITY_REQUIRED");
  }
  return input;
}

export const SEEDANCE_PRIVACY_REJECTION_CODE =
  "InputImageSensitiveContentDetected.PrivacyInformation" as const;

export function classifyProviderPolicyRejection(input: {
  readonly nativeCode?: string | null;
  readonly nativeType?: string | null;
}): {
  readonly classification: "HUMAN_PORTRAIT_AUTHORIZATION_REQUIRED" | "UNCLASSIFIED_PROVIDER_REJECTION";
  readonly retryable: false;
  readonly creativeFailure: false;
  readonly providerPolicyRoutingRequired: boolean;
} {
  const privacy = input.nativeCode === SEEDANCE_PRIVACY_REJECTION_CODE;
  return {
    classification: privacy
      ? "HUMAN_PORTRAIT_AUTHORIZATION_REQUIRED"
      : "UNCLASSIFIED_PROVIDER_REJECTION",
    retryable: false,
    creativeFailure: false,
    providerPolicyRoutingRequired: privacy,
  };
}
