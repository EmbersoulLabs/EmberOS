import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CreateCampaignContextSchema,
  campaignObjectiveText,
} from "@ceo-agent/shared";

const base = {
  idempotencyKey: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  name: "Launch",
  objective: "awareness" as const,
  publishingPlatforms: ["tiktok", "instagram"] as const,
  targetAudience: {
    summary: "Urban gift buyers",
    demographics: [], interests: ["gifting"], needs: [], locations: [],
  },
  assetReferences: ["30000000-0000-4000-8000-000000000001"],
  assetStoryReferences: [],
};

describe("Wave 3 Create Campaign contract", () => {
  it("accepts a typed Campaign context and canonicalizes platforms", () => {
    const result = CreateCampaignContextSchema.parse({
      ...base,
      publishingPlatforms: ["instagram", "tiktok", "instagram"],
    });
    expect(result.publishingPlatforms).toEqual(["tiktok", "instagram"]);
    expect(result.targetAudience.summary).toBe("Urban gift buyers");
  });

  it("requires a custom Objective and at least one Asset authority", () => {
    expect(CreateCampaignContextSchema.safeParse({ ...base, objective: "other" }).success).toBe(false);
    expect(CreateCampaignContextSchema.safeParse({ ...base, assetReferences: [] }).success).toBe(false);
    expect(campaignObjectiveText({ objective: "sales" })).toBe("Sales");
  });

  it("rejects unknown platforms, duplicate references, and malformed audience", () => {
    expect(CreateCampaignContextSchema.safeParse({ ...base, publishingPlatforms: ["youtube"] }).success).toBe(false);
    expect(CreateCampaignContextSchema.safeParse({ ...base, assetReferences: [base.assetReferences[0], base.assetReferences[0]] }).success).toBe(false);
    expect(CreateCampaignContextSchema.safeParse({ ...base, targetAudience: { summary: "" } }).success).toBe(false);
  });

  it("implements exactly five steps and omits obsolete generation controls", () => {
    const source = readFileSync("apps/web/src/components/campaign/CreateCampaignWizard.tsx", "utf8");
    expect(source).toContain('"Campaign Name", "Campaign Context", "Assets", "Campaign Brief", "Review & Create"');
    expect(source).toContain("Business Profile defaults");
    expect(source).toContain("Inferred Language");
    expect(source).not.toMatch(/AI Output Language|Subtitle Language|Voice Preset|BGM|Content Style/);
    expect(source).not.toContain("Manual Generate");
  });

  it("keeps AI assistance proposal-only with explicit acceptance", () => {
    const source = readFileSync("apps/web/src/components/campaign/CreateCampaignAssistants.tsx", "utf8");
    expect(source).toContain("Suggestion preview");
    expect(source).toContain("Brief proposal preview");
    expect(source).toContain("Accept");
    expect(source).not.toContain("onAccept(body.text)");
  });

  it("uses Workspace Asset Library upload and canonical create command", () => {
    const selector = readFileSync("apps/web/src/components/campaign/CreateCampaignAssetSelector.tsx", "utf8");
    const wizard = readFileSync("apps/web/src/components/campaign/CreateCampaignWizard.tsx", "utf8");
    expect(selector).toContain("uploadLibraryFile(workspaceId");
    expect(wizard).toContain('fetch("/api/campaigns/create"');
    expect(wizard).toContain("Idempotency-Key");
    expect(wizard).toContain("/task?taskId=");
  });
});
