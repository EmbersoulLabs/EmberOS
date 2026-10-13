import { describe, expect, it } from "vitest";
import {
  CampaignCreativeHandoffSchema,
  campaignCreativeDestinationPath,
  campaignCreativeDestinationReference,
} from "@ceo-agent/shared";

const campaignId = "11111111-1111-4111-8111-111111111111";
const iterationId = "22222222-2222-4222-8222-222222222222";
const planId = "33333333-3333-4333-8333-333333333333";
const handoffId = "44444444-4444-4444-8444-444444444444";

describe("Campaign Creative Module handoff contract", () => {
  it.each([
    ["VIDEO_STUDIO", `campaign:${campaignId}:video-studio`, `/w/acme/campaigns/${campaignId}#module-video-studio`],
    ["PHOTO_SCENE", `campaign:${campaignId}:photo-scene`, `/w/acme/campaigns/${campaignId}#photo-scene`],
    ["AI_STORY", `campaign:${campaignId}:ai-story:new`, `/w/acme/campaigns/${campaignId}/ai-stories/episodes/new`],
  ] as const)("routes %s only to its existing workflow", (module, reference, path) => {
    expect(campaignCreativeDestinationReference(module, campaignId)).toBe(reference);
    expect(campaignCreativeDestinationPath(module, "acme", campaignId)).toBe(path);
    expect(path).not.toContain("generate");
  });

  it("requires exact lineage, module, asset mode, and Business Profile snapshot reference", () => {
    expect(CampaignCreativeHandoffSchema.parse({
      id: handoffId,
      campaignId,
      iterationId,
      approvedPlanId: planId,
      selectedModule: "AI_STORY",
      assetMode: "ZERO_ASSET",
      assetIds: [],
      businessProfileSnapshotRef: `marketing-plan:${planId}:business-profile:v1`,
      destinationReference: `campaign:${campaignId}:ai-story:new`,
    })).toMatchObject({ approvedPlanId: planId, selectedModule: "AI_STORY" });
  });
});
