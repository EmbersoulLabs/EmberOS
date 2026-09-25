import { describe, expect, it, vi } from "vitest";
import {
  BusinessProfileRequiredError,
  loadCanonicalBusinessContext,
} from "@ceo-agent/db";

const workspaceId = "3ab245ba-b7be-463b-9f57-98cd3bfa38ed";
const profileId = "7beaa13f-e737-42b8-86f7-b17943c7560d";
const orgId = "52519c8c-4011-478f-bf09-34e087e4bbdd";

function tapaoJomProfile(): Record<string, unknown> {
  return {
    id: profileId,
    orgId,
    workspaceId,
    companyName: "Tapao Jom! by AWH Food Enterprise",
    industryId: null,
    industryDisplayName: "Food & Beverage",
    industryCustomValue: "Food & Beverage",
    services: [
      "Malay kuih",
      "donuts",
      "egg tarts",
      "ready-to-go food",
      "corporate meals",
      "office catering",
      "bulk orders",
      "recurring corporate accounts",
    ],
    businessDescription: "Corporate B2B catering, office meals, and meeting refreshments.",
    targetAudience: "Corporate offices and recurring B2B accounts",
    country: "Malaysia",
    stateProvince: "Johor",
    brandKeywords: ["corporate catering", "bulk orders", "recurring accounts"],
    brandPersonality: ["warm"],
    brandStyle: [], brandValues: [], brandColors: [], brandFonts: [], brandImages: [],
    supportedLanguages: [], defaultPublishingPlatforms: [], businessHours: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: null, updatedBy: null, deletedAt: null, version: 1,
  };
}

describe("canonical Marketing business context", () => {
  it("projects the Tapao Jom canonical profile without consulting legacy workspace JSON", async () => {
    const lookup = vi.fn(async () => tapaoJomProfile());
    const { brandProfile } = await loadCanonicalBusinessContext(workspaceId, lookup);

    expect(lookup).toHaveBeenCalledWith(workspaceId);
    expect(brandProfile).toMatchObject({
      businessName: "Tapao Jom! by AWH Food Enterprise",
      industry: "Food & Beverage",
      country: "Malaysia",
      region: "Johor",
      targetAudience: "Corporate offices and recurring B2B accounts",
    });
    expect(brandProfile.description).toMatch(/Corporate B2B/i);
    expect(brandProfile.services).toEqual(expect.arrayContaining([
      "corporate meals", "bulk orders", "recurring corporate accounts",
    ]));
  });

  it("fails closed before a provider boundary when no canonical profile exists", async () => {
    const provider = vi.fn();
    const execute = async () => {
      await loadCanonicalBusinessContext(workspaceId, async () => null);
      await provider();
    };

    await expect(execute()).rejects.toBeInstanceOf(BusinessProfileRequiredError);
    expect(provider).not.toHaveBeenCalled();
  });

  it("preserves the same canonical workspace-to-profile normalization used by AI Story", async () => {
    const result = await loadCanonicalBusinessContext(workspaceId, async () => tapaoJomProfile());
    expect(result.profile.workspaceId).toBe(workspaceId);
    expect(result.brandProfile.businessName).toBe(result.profile.companyName);
    expect(result.brandProfile.services).toEqual(result.profile.services);
  });
});
