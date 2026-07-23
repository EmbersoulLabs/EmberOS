import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_BRIEF_ASSIST_ACTIONS,
  CampaignBriefAssistBodySchema,
  cleanOriginalFilename,
  resolveAssetDisplayLabel,
} from "@ceo-agent/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Sprint 0004 campaign UX polish", () => {
  it("cleans original filenames for PD-040 fallback names", () => {
    expect(cleanOriginalFilename("IMG_20260722.jpg")).toBe("IMG 20260722");
    expect(cleanOriginalFilename("sunflower_graduation-bouquet.PNG")).toBe(
      "Sunflower Graduation Bouquet"
    );
    expect(cleanOriginalFilename("")).toBe("Untitled asset");
  });

  it("prefers displayName over original filename for labels", () => {
    expect(
      resolveAssetDisplayLabel({
        displayName: "Sunflower Graduation Bouquet",
        originalFilename: "IMG_20260722.jpg",
      })
    ).toBe("Sunflower Graduation Bouquet");
    expect(
      resolveAssetDisplayLabel({
        displayName: null,
        originalFilename: "raw_clip_01.mp4",
      })
    ).toBe("Raw Clip 01");
  });

  it("limits Campaign Brief assist to polish/expand/shorten", () => {
    expect(CAMPAIGN_BRIEF_ASSIST_ACTIONS).toEqual(["polish", "expand", "shorten"]);
    expect(
      CampaignBriefAssistBodySchema.safeParse({
        action: "polish",
        text: "Launch spring bouquet",
      }).success
    ).toBe(true);
    expect(
      CampaignBriefAssistBodySchema.safeParse({
        action: "rewrite",
        text: "Launch spring bouquet",
      }).success
    ).toBe(false);
    expect(
      CampaignBriefAssistBodySchema.safeParse({
        action: "expand",
        text: "",
      }).success
    ).toBe(false);
  });

  it("uses the approved 5-step wizard without a Language step", () => {
    const source = readFileSync(
      resolve("apps/web/src/app/w/[slug]/campaigns/new/page.tsx"),
      "utf8"
    );
    expect(source).toContain('const STEPS = ["name", "objective", "assets", "brief", "review"]');
    expect(source).not.toMatch(/"language"/);
    expect(source).toContain('createCampaign');
    expect(source).toContain("InferredLanguageReadonly");
    expect(source).toContain("CampaignBriefAssistant");
  });
});
