import { describe, expect, it } from "vitest";
import { buildCertifiedSeedancePreGenerationQcCapabilitySnapshot, SEEDANCE_ADAPTER_VERSION, SEEDANCE_CAPABILITY_ID, SEEDANCE_SELECTED_PRODUCT_GROUNDED_MODE } from "@ceo-agent/agents";

describe("Pre-Generation QC current Provider capability truth",()=>{
  it("projects only the already-certified Seedance capability declaration",()=>{expect(buildCertifiedSeedancePreGenerationQcCapabilitySnapshot()).toEqual({capabilityId:SEEDANCE_CAPABILITY_ID,capabilityVersion:`seedance-adapter.${SEEDANCE_ADAPTER_VERSION}`,supportedExecutionModes:[SEEDANCE_SELECTED_PRODUCT_GROUNDED_MODE],supportedReferenceRoles:["PRODUCT_REFERENCE"],supportedTimingStructures:["SINGLE_SCENE"],estimatedAttemptCostUsd:0.35,verified:true});});
});
