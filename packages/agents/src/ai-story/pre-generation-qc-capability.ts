import type { AiStoryPreGenerationQcProviderCapability } from "@ceo-agent/shared";
import {
  buildSeedanceCapabilityDeclaration,
  SEEDANCE_ADAPTER_VERSION,
  SEEDANCE_CAPABILITY_ID,
  SEEDANCE_SELECTED_PRODUCT_GROUNDED_MODE,
  seedanceCapabilityDetails,
} from "./seedance-capability";

export type CertifiedPreGenerationQcCapabilitySnapshot = AiStoryPreGenerationQcProviderCapability;

/**
 * Projects only capability facts already certified by the current Adapter.
 * It does not add Provider syntax, reference roles, timing behavior, or runtime
 * dispatch semantics.
 */
export function buildCertifiedSeedancePreGenerationQcCapabilitySnapshot():CertifiedPreGenerationQcCapabilitySnapshot {
  const declaration=buildSeedanceCapabilityDeclaration();
  const details=seedanceCapabilityDetails();
  return {
    capabilityId:SEEDANCE_CAPABILITY_ID,
    capabilityVersion:`seedance-adapter.${SEEDANCE_ADAPTER_VERSION}`,
    supportedExecutionModes:details.firstFrameI2vSupport
      ? ["TEXT_TO_VIDEO", "IMAGE_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO", SEEDANCE_SELECTED_PRODUCT_GROUNDED_MODE]
      : ["TEXT_TO_VIDEO"],
    supportedReferenceRoles:details.referenceImageT2vSupport?["GENERIC_REFERENCE_IMAGE", "PRODUCT_REFERENCE"]:[],
    supportedTimingStructures:["SINGLE_SCENE"],
    estimatedAttemptCostUsd:declaration.routing.estimatedCostUsd??null,
    verified:details.firstFrameI2vSupport&&declaration.capabilityId===SEEDANCE_CAPABILITY_ID,
  };
}
