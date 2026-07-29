import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateCampaignForGenerate } from "@ceo-agent/shared";

const generateRoute = readFileSync(
  resolve("apps/web/src/app/api/campaigns/[id]/generate/route.ts"),
  "utf8"
);
const runRoute = readFileSync(
  resolve("apps/web/src/app/api/campaigns/[id]/run/route.ts"),
  "utf8"
);
const campaignGenerate = readFileSync(
  resolve("apps/web/src/lib/campaign-generate.ts"),
  "utf8"
);
const workspace = readFileSync(
  resolve("apps/web/src/components/campaign/CampaignWorkspace.tsx"),
  "utf8"
);
const packageView = readFileSync(
  resolve("apps/web/src/components/campaign/CampaignMarketingPackageView.tsx"),
  "utf8"
);
const taskView = readFileSync(
  resolve("apps/web/src/app/w/[slug]/campaigns/[id]/task/TaskProgressContent.tsx"),
  "utf8"
);
const wizard = readFileSync(
  resolve("apps/web/src/app/w/[slug]/campaigns/new/page.tsx"),
  "utf8"
);
const runCeo = readFileSync(resolve("apps/web/src/components/RunCeoButton.tsx"), "utf8");

describe("Marketing vertical slice (Sprint 1)", () => {
  it("validateCampaignForGenerate marks AI generation enabled", () => {
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
    if (ok.ok) expect(ok.summary.aiGeneration).toBe(true);
  });

  it("authoritative Generate enqueues production pipeline", () => {
    expect(generateRoute).toContain("executeCampaignGenerate");
    expect(generateRoute).toContain("aiInvoked: true");
    expect(generateRoute).not.toContain("aiInvoked: false");
    expect(campaignGenerate).toContain("startOrReuseCampaignRun");
    expect(campaignGenerate).toContain('generateStatus: "processing"');
    expect(campaignGenerate).toContain("aiGeneration: true");
  });

  it("/run delegates to the same Generate implementation", () => {
    expect(runRoute).toContain("executeCampaignGenerate");
    expect(runRoute).toContain("Compatibility alias");
    expect(runRoute).not.toContain("startOrReuseCampaignRun(");
  });

  it("Campaign Workspace Generate redirects to task progress", () => {
    expect(workspace).toMatch(/\/api\/campaigns\/\$\{campaignId\}\/generate/);
    expect(workspace).toMatch(/\/task\?taskId=\$\{taskId\}/);
    expect(workspace).toContain("CampaignMarketingPackageView");
    expect(workspace).not.toContain("MARKETING_PACKAGE_PLACEHOLDER_ITEMS");
    expect(workspace).not.toContain("placeholderOnly");
  });

  it("Marketing Package tab reads persisted production output", () => {
    expect(packageView).toContain("MarketingPackagePanel");
    expect(packageView).toContain("content_generate");
    expect(packageView).toContain("strategy_plan");
    expect(packageView).toContain("marketing_score");
    expect(packageView).not.toContain("placeholder");
  });

  it("Create wizard and RunCeoButton use authoritative Generate", () => {
    expect(wizard).toMatch(/\/api\/campaigns\/\$\{id\}\/generate/);
    expect(wizard).not.toMatch(/\/api\/campaigns\/\$\{id\}\/run/);
    expect(runCeo).toMatch(/\/api\/campaigns\/\$\{campaignId\}\/generate/);
    expect(runCeo).not.toMatch(/\/api\/campaigns\/\$\{campaignId\}\/run/);
  });

  it("Review and export consume production task outputs", () => {
    expect(taskView).toContain("MarketingPackagePanel");
    expect(taskView).toContain("exportAllClips");
    expect(taskView).toContain("/api/tasks/");
    expect(taskView).toContain("content_generate");
    expect(taskView).toContain("pending_internal_review");
  });
});
