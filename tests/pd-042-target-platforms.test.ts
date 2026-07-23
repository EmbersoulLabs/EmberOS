import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BusinessProfileUpdateSchema,
  CampaignWorkspaceCreateSchema,
  PUBLISHING_PLATFORM_IDS,
  formatPublishingPlatforms,
  inferCampaignLanguages,
  sanitizePublishingPlatforms,
} from "@ceo-agent/shared";

const wizardSource = readFileSync(
  resolve("apps/web/src/app/w/[slug]/campaigns/new/page.tsx"),
  "utf8"
);
const workspaceSource = readFileSync(
  resolve("apps/web/src/components/campaign/CampaignWorkspace.tsx"),
  "utf8"
);
const bpEditorSource = readFileSync(
  resolve("apps/web/src/components/business-profile/BusinessProfileEditor.tsx"),
  "utf8"
);
const bpSchemaSql = readFileSync(
  resolve("packages/db/sql/business_profile.sql"),
  "utf8"
);
const bpPd042Sql = readFileSync(
  resolve("packages/db/sql/business_profile_pd042.sql"),
  "utf8"
);

describe("PD-042 — Target Platform Source", () => {
  it("defines the approved publishing platform dictionary", () => {
    expect(PUBLISHING_PLATFORM_IDS).toEqual([
      "tiktok",
      "instagram",
      "facebook",
      "linkedin",
      "xiaohongshu",
      "googleBusiness",
    ]);
    expect(sanitizePublishingPlatforms(["tiktok", "nope", "tiktok", "instagram"])).toEqual([
      "tiktok",
      "instagram",
    ]);
    expect(formatPublishingPlatforms(["tiktok", "facebook"])).toBe("TikTok, Facebook");
  });

  it("accepts defaultPublishingPlatforms on Business Profile updates", () => {
    const parsed = BusinessProfileUpdateSchema.safeParse({
      version: 1,
      defaultPublishingPlatforms: ["tiktok", "xiaohongshu"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.defaultPublishingPlatforms).toEqual(["tiktok", "xiaohongshu"]);
    }

    const bad = BusinessProfileUpdateSchema.safeParse({
      version: 1,
      defaultPublishingPlatforms: ["myspace"],
    });
    expect(bad.success).toBe(false);
  });

  it("persists campaign platforms through create schema", () => {
    const parsed = CampaignWorkspaceCreateSchema.safeParse({
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      name: "Launch",
      objective: "awareness",
      platforms: ["instagram", "linkedin"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.platforms).toEqual(["instagram", "linkedin"]);
    }
  });

  it("infers languages from UI locale and platform rules", () => {
    expect(inferCampaignLanguages("en", [])).toEqual({
      outputLanguage: "en",
      subtitleLanguage: "en",
      ctaLanguage: "en",
      hashtagLanguage: "en",
    });
    expect(inferCampaignLanguages("en", ["xiaohongshu"])).toEqual({
      outputLanguage: "zh",
      subtitleLanguage: "zh",
      ctaLanguage: "zh",
      hashtagLanguage: "zh",
    });
    // Mixed platforms without a shared rule keep UI locale.
    expect(inferCampaignLanguages("en", ["tiktok", "xiaohongshu"]).outputLanguage).toBe("en");
  });

  it("keeps five-step wizard with Objective platforms and no Platform step", () => {
    expect(wizardSource).toContain(
      'const STEPS = ["name", "objective", "assets", "brief", "review"]'
    );
    expect(wizardSource).toContain("PublishingPlatformMultiSelect");
    expect(wizardSource).toContain("defaultPublishingPlatforms");
    expect(wizardSource).toContain("platforms");
    expect(wizardSource).not.toMatch(/STEPS = \[[^\]]*platform/i);
    expect(wizardSource.match(/STEPS = \[[^\]]+\]/)?.[0].split(",").length).toBe(5);
  });

  it("does not write Business Profile when editing campaign platforms", () => {
    expect(wizardSource).toMatch(/platforms/);
    expect(wizardSource).not.toMatch(
      /business-profile[\s\S]{0,200}method:\s*"PATCH"/
    );
    expect(wizardSource).toContain("sanitizePublishingPlatforms");
  });

  it("shows Target Platforms read-only on Campaign Workspace", () => {
    expect(workspaceSource).toContain("targetPlatforms");
    expect(workspaceSource).toContain("formatPublishingPlatforms");
    expect(workspaceSource).toContain("targetPlatformsReadonlyHint");
  });

  it("exposes Default Publishing Platforms on Business Profile editor", () => {
    expect(bpEditorSource).toContain("defaultPublishingPlatforms");
    expect(bpEditorSource).toContain("PublishingPlatformMultiSelect");
    expect(bpEditorSource).toContain("publishingPlatforms");
  });

  it("includes default_publishing_platforms in Business Profile SQL", () => {
    expect(bpSchemaSql).toContain("default_publishing_platforms");
    expect(bpPd042Sql).toContain("default_publishing_platforms");
  });
});
