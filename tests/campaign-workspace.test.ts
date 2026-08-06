import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  replaceCampaignMediaReferences,
  shouldUseLegacyCampaignAssetFallback,
} from "../packages/db/src/queries/asset-library";
import {
  appendUniqueId,
  CampaignMediaAttachBodySchema,
  CAMPAIGN_OBJECTIVES,
  CampaignWorkspaceCreateSchema,
  directAssetsForStoryMode,
  MARKETING_PACKAGE_PLACEHOLDER_ITEMS,
  defaultCampaignLanguages,
  validateCampaignForGenerate,
} from "@ceo-agent/shared";

describe("campaign workspace (Sprint 0003 / SPEC-002)", () => {
  it("uses interim objective dictionary including Other", () => {
    expect(CAMPAIGN_OBJECTIVES).toEqual([
      "awareness",
      "engagement",
      "sales",
      "lead_generation",
      "other",
    ]);
  });

  it("defaults four campaign languages from UI locale", () => {
    expect(defaultCampaignLanguages("zh")).toEqual({
      outputLanguage: "zh",
      subtitleLanguage: "zh",
      ctaLanguage: "zh",
      hashtagLanguage: "zh",
    });
  });

  it("validates generate and marks AI generation enabled", () => {
    const ok = validateCampaignForGenerate({
      name: "Spring Promo",
      objective: "awareness",
      outputLanguage: "en",
      subtitleLanguage: "en",
      ctaLanguage: "en",
      hashtagLanguage: "en",
      assetCount: 1,
      storyCount: 0,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.summary.aiGeneration).toBe(true);
    }

    const bad = validateCampaignForGenerate({
      name: "",
      objective: "other",
      objectiveCustom: "",
      outputLanguage: "en",
      subtitleLanguage: "en",
      ctaLanguage: "en",
      hashtagLanguage: "en",
      assetCount: 0,
      storyCount: 0,
    });
    expect(bad.ok).toBe(false);
  });

  it("keeps SPEC-002 marketing package placeholder list", () => {
    expect(MARKETING_PACKAGE_PLACEHOLDER_ITEMS).toContain("strategy");
    expect(MARKETING_PACKAGE_PLACEHOLDER_ITEMS).toContain("marketing_score");
    expect(MARKETING_PACKAGE_PLACEHOLDER_ITEMS).not.toContain("seo");
    expect(MARKETING_PACKAGE_PLACEHOLDER_ITEMS).not.toContain("script");
  });

  it("rejects invalid languages while permitting omitted language defaults", () => {
    const base = {
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      name: "Spring Promo",
      objective: "awareness",
    };
    expect(CampaignWorkspaceCreateSchema.safeParse(base).success).toBe(true);
    expect(
      CampaignWorkspaceCreateSchema.safeParse({ ...base, outputLanguage: "invalid" }).success
    ).toBe(false);
  });

  it("preserves every uploaded selection and removes Story-mode Assets from direct refs", () => {
    const selected = appendUniqueId(
      appendUniqueId(["existing"], "video-a"),
      "video-b"
    );
    expect(selected).toEqual(["existing", "video-a", "video-b"]);
    expect(appendUniqueId(selected, "video-a")).toEqual(selected);
    expect(directAssetsForStoryMode(selected, ["video-a", "video-b"])).toEqual([
      "existing",
    ]);
  });

  it("requires ordered Story Assets when Story analysis mode is selected", () => {
    const valid = CampaignMediaAttachBodySchema.safeParse({
      mediaAnalysisMode: "story",
      storyAssetIds: [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      ],
    });
    expect(valid.success).toBe(true);
    expect(
      CampaignMediaAttachBodySchema.safeParse({
        mediaAnalysisMode: "story",
        storyAssetIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
      }).success
    ).toBe(false);
  });

  it("replaces Campaign Asset and Story references exactly, including removals", async () => {
    const deletes: unknown[] = [];
    const inserts: Array<{ table: unknown; values: unknown[] }> = [];
    const updates: unknown[] = [];
    const tx = {
      delete: (table: unknown) => ({
        where: async () => {
          deletes.push(table);
        },
      }),
      insert: (table: unknown) => ({
        values: async (values: unknown[]) => {
          inserts.push({ table, values });
        },
      }),
      update: (table: unknown) => ({
        set: (values: unknown) => ({
          where: async () => {
            updates.push({ table, values });
          },
        }),
      }),
    };
    const db = {
      transaction: async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx),
    };

    await replaceCampaignMediaReferences(
      db as never,
      "campaign-1",
      ["asset-new", "asset-new"],
      ["story-new", "story-new"]
    );

    expect(deletes).toHaveLength(2);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.values).toEqual([
      { campaignId: "campaign-1", assetId: "asset-new", sortOrder: 0 },
    ]);
    expect(inserts[1]?.values).toEqual([
      { campaignId: "campaign-1", storyId: "story-new" },
    ]);
    expect(updates).toHaveLength(1);

    deletes.length = 0;
    inserts.length = 0;
    updates.length = 0;
    await replaceCampaignMediaReferences(db as never, "campaign-1", [], []);
    expect(deletes).toHaveLength(2);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
  });

  it("does not resurrect legacy Assets after an authoritative selection is cleared", () => {
    expect(shouldUseLegacyCampaignAssetFallback(0, null)).toBe(true);
    expect(
      shouldUseLegacyCampaignAssetFallback(0, {
        mediaReferencesAuthoritative: true,
      })
    ).toBe(false);
    expect(
      shouldUseLegacyCampaignAssetFallback(1, {
        mediaReferencesAuthoritative: true,
      })
    ).toBe(false);
  });

  it("enforces Ready Story and cross-Workspace checks in Campaign APIs", () => {
    const mediaRoute = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/media/route.ts",
      "utf8"
    );
    const generateLib = readFileSync(
      "apps/web/src/lib/campaign-generate.ts",
      "utf8"
    );
    const assetQueries = readFileSync(
      "packages/db/src/queries/asset-library.ts",
      "utf8"
    );

    expect(mediaRoute).toContain("assertAssetsInWorkspace");
    expect(mediaRoute).toContain("assertStoriesInWorkspace");
    expect(mediaRoute).toContain("readyOnly: true");
    expect(mediaRoute).toContain('status: "ready"');
    expect(mediaRoute).toContain("replaceCampaignMediaReferences");
    expect(generateLib).toContain('eq(schema.stories.status, "ready")');
    expect(generateLib).toContain("startOrReuseCampaignRun");
    expect(assetQueries).toContain('eq(schema.stories.status, "ready")');
  });
});
