import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TargetAudienceSuggestSkillOutputSchema,
  normalizeTargetAudienceSuggestOutput,
} from "@ceo-agent/shared";

function read(rel: string): string {
  return readFileSync(resolve(rel), "utf8");
}

const wizard = read("apps/web/src/app/w/[slug]/campaigns/new/page.tsx");
const briefUi = read("apps/web/src/components/campaign/CampaignBriefAssistant.tsx");
const audienceUi = read("apps/web/src/components/campaign/TargetAudienceAssistant.tsx");
const media = read("apps/web/src/components/campaign/CampaignMediaInput.tsx");
const workbench = read("apps/web/src/components/asset-library/AssetLibraryWorkbench.tsx");
const thumb = read("apps/web/src/components/campaign/AssetThumb.tsx");
const uploadLib = read("apps/web/src/lib/library-upload.ts");
const audienceRoute = read("apps/web/src/app/api/workspaces/[id]/audience/suggest/route.ts");
const skill = read("packages/agents/src/skills/target-audience-suggest/skill.ts");
const en = read("packages/shared/src/i18n/locales/en.json");
const zh = read("packages/shared/src/i18n/locales/zh.json");
const ms = read("packages/shared/src/i18n/locales/ms.json");

describe("PD-043 Campaign Context Collection", () => {
  it("keeps the five-step campaign wizard", () => {
    expect(wizard).toContain(
      'const STEPS = ["name", "objective", "assets", "brief", "review"] as const'
    );
    expect(wizard).not.toMatch(/STEPS\s*=\s*\[[^\]]*"audience"/);
  });

  it("Objective step owns Campaign Description and Target Audience", () => {
    expect(wizard).toContain('step === "objective"');
    expect(wizard).toContain('t("campaign.workspace.description")');
    expect(wizard).toContain("<TargetAudienceAssistant");
    expect(wizard).toContain("description={description}");
    expect(wizard).toContain("value={targetAudience}");
  });

  it("Campaign Brief consumes context without duplicating description/audience fields", () => {
    expect(briefUi).toContain("description?:");
    expect(briefUi).toContain("targetAudience?:");
    expect(briefUi).not.toContain('t("campaign.workspace.description")');
    expect(briefUi).not.toContain('t("campaign.workspace.targetAudience")');
    expect(briefUi).toContain('"polish"');
    expect(briefUi).toContain('"expand"');
    expect(briefUi).toContain('"shorten"');
  });

  it("Review displays Campaign Description and Target Audience read-only", () => {
    expect(wizard).toMatch(
      /step === "review"[\s\S]*campaign\.workspace\.description[\s\S]*campaign\.workspace\.targetAudience/
    );
  });

  it("persists description and targetAudienceOverride on create", () => {
    expect(wizard).toContain("description: description.trim() || undefined");
    expect(wizard).toContain("targetAudienceOverride: targetAudience.trim() || undefined");
  });

  it("exposes Target Audience Suggest skill + API", () => {
    expect(skill).toContain('id: TARGET_AUDIENCE_SUGGEST_SKILL_ID');
    expect(skill).toContain('"target-audience-suggest"');
    expect(audienceRoute).toContain('executeSkill("target-audience-suggest"');
    expect(audienceRoute).toContain("targetAudienceSuggest");
    expect(read("packages/agents/src/skills/types.ts")).toContain('"target-audience-suggest"');
    expect(read("packages/shared/src/rate-limit.ts")).toContain("targetAudienceSuggest");
  });

  it("Target Audience AI Suggest returns one proposal and only Accept writes the field", () => {
    expect(audienceUi).toContain("campaign.audienceAssist.suggest");
    expect(audienceUi).toContain("campaign.audienceAssist.accept");
    expect(audienceUi).toContain("campaign.audienceAssist.discard");
    expect(audienceUi).toContain("campaign.audienceAssist.regenerate");
    expect(audienceUi).toContain("onChange(proposal)");
    expect(audienceUi).toContain("setProposal(null)");

    const parsed = TargetAudienceSuggestSkillOutputSchema.safeParse({
      text: "Urban professionals aged 25–40 who value premium coffee.",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.text).toContain("Urban professionals");
    }
    expect(TargetAudienceSuggestSkillOutputSchema.safeParse({ text: "" }).success).toBe(false);
    expect(
      normalizeTargetAudienceSuggestOutput({
        text: "Parents shopping for weekend brunch.",
      }).text
    ).toBe("Parents shopping for weekend brunch.");

    expect(skill).toContain("exactly one concise audience proposal");
  });
});

describe("QA-001 Asset Library upload state completes", () => {
  it("transitions Uploading → Processing → Completed and returns idle", () => {
    expect(uploadLib).toContain('onPhase?.("uploading"');
    expect(uploadLib).toContain('onPhase?.("processing"');
    expect(uploadLib).toContain('onPhase?.("completed"');
    expect(workbench).toContain('setUploadPhase("idle")');
    expect(workbench).toContain('uploadPhase === "processing"');
    expect(workbench).toContain("assetLibrary.processing");
    expect(media).toContain('status: "processing"');
    expect(media).toContain("campaign.upload.processing");
  });
});

describe("QA-002 Asset rename reflected + QA-003 thumbnails", () => {
  it("shows display name and original filename after rename/upload", () => {
    expect(workbench).toContain("asset.displayName");
    expect(workbench).toContain("asset.originalFilename");
    expect(workbench).toContain("displayName !== asset.originalFilename");
    expect(uploadLib).toContain("displayName");
    expect(media).toContain("displayName");
    expect(media).toContain("originalFilename");
    expect(workbench).toContain("await reload()");
    expect(media).toContain("await refreshLibrary()");
  });

  it("renders image and video thumbnails with shared AssetThumb", () => {
    expect(thumb).toContain('kind === "image"');
    expect(thumb).toContain('kind === "video"');
    expect(thumb).toContain("<video");
    expect(workbench).toContain("<AssetThumb");
    expect(media).toContain("<AssetThumb");
  });
});

describe("QA-004 Campaign Upload and Asset Library stay synchronized", () => {
  it("shares preview component and refreshes library after campaign upload", () => {
    expect(media).toContain('from "@/components/campaign/AssetThumb"');
    expect(workbench).toContain('from "@/components/campaign/AssetThumb"');
    expect(media).toContain("await refreshLibrary()");
    expect(media).toContain("displayName");
    expect(media).toContain('status: "processing"');
    expect(media).toContain('status: "success"');
  });
});

describe("QA-005 Campaign Name placeholder", () => {
  it("uses a generic campaign name placeholder", () => {
    expect(wizard).toContain('t("campaign.namePlaceholder")');
    expect(JSON.parse(en)["campaign.namePlaceholder"]).toBe("Enter campaign name");
    expect(en).not.toContain("Spring Bouquet Launch");
    expect(zh).not.toContain("Spring Bouquet Launch");
    expect(ms).not.toContain("Spring Bouquet Launch");
    expect(JSON.parse(zh)["campaign.namePlaceholder"]).toBeTruthy();
    expect(JSON.parse(ms)["campaign.namePlaceholder"]).toBeTruthy();
  });
});
