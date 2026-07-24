import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CampaignWorkspaceCreateSchema,
  CampaignWorkspacePatchSchema,
  CampaignBriefAssistBodySchema,
  TargetAudienceSuggestBodySchema,
} from "@ceo-agent/shared";

function read(rel: string): string {
  return readFileSync(resolve(rel), "utf8");
}

const wizard = read("apps/web/src/app/w/[slug]/campaigns/new/page.tsx");
const workspace = read("apps/web/src/components/campaign/CampaignWorkspace.tsx");
const briefUi = read("apps/web/src/components/campaign/CampaignBriefAssistant.tsx");
const audienceUi = read("apps/web/src/components/campaign/TargetAudienceAssistant.tsx");
const createRoute = read("apps/web/src/app/api/campaigns/route.ts");
const patchRoute = read("apps/web/src/app/api/campaigns/[id]/route.ts");
const briefRoute = read("apps/web/src/app/api/campaigns/[id]/brief/assist/route.ts");
const audienceRoute = read("apps/web/src/app/api/workspaces/[id]/audience/suggest/route.ts");
const briefSkill = read("packages/agents/src/skills/campaign-brief-assist/skill.ts");
const audienceSkill = read("packages/agents/src/skills/target-audience-suggest/skill.ts");
const orchestrator = read("packages/agents/src/orchestrator.ts");
const schema = read("packages/db/src/schema/index.ts");
const en = read("packages/shared/src/i18n/locales/en.json");
const zh = read("packages/shared/src/i18n/locales/zh.json");
const ms = read("packages/shared/src/i18n/locales/ms.json");

describe("PD-044 Campaign Brief is the sole free-text Campaign Context", () => {
  it("keeps the five-step campaign wizard", () => {
    expect(wizard).toContain(
      'const STEPS = ["name", "objective", "assets", "brief", "review"] as const'
    );
  });

  it("does not render Campaign Description in wizard Objective or Review", () => {
    expect(wizard).not.toContain("campaign.workspace.description");
    expect(wizard).not.toContain("setDescription");
    expect(wizard).not.toContain("description={description}");
    expect(wizard).toContain("<TargetAudienceAssistant");
    expect(wizard).toContain("campaignBrief={campaignBrief}");
    expect(wizard).toMatch(
      /step === "review"[\s\S]*campaign\.workspace\.targetAudience/
    );
    expect(wizard).not.toMatch(
      /step === "review"[\s\S]*campaign\.workspace\.description/
    );
  });

  it("create and patch payloads do not send description", () => {
    expect(wizard).not.toContain("description: description");
    expect(wizard).toContain("campaignBrief: campaignBrief.trim()");
    expect(wizard).toContain("targetAudienceOverride: targetAudience.trim()");
  });

  it("Campaign Workspace overview shows Brief read-only and does not edit Description", () => {
    expect(workspace).not.toContain("campaign.workspace.description");
    expect(workspace).not.toContain("setDescription");
    expect(workspace).toContain("campaign.workspace.briefReadonlyHint");
    expect(workspace).toContain("campaign.workspace.briefEmpty");
    expect(workspace).toContain("<CampaignBriefAssistant");
    expect(workspace).toContain("targetAudience={audienceOverride}");
  });

  it("rejects obsolete description on create/patch schemas", () => {
    expect(
      CampaignWorkspaceCreateSchema.safeParse({
        workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        name: "Launch",
        objective: "awareness",
        description: "obsolete",
      }).success
    ).toBe(false);

    expect(
      CampaignWorkspacePatchSchema.safeParse({
        description: "obsolete",
      }).success
    ).toBe(false);

    const ok = CampaignWorkspaceCreateSchema.safeParse({
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      name: "Launch",
      objective: "awareness",
      campaignBrief: "Spring launch for urban professionals",
      targetAudienceOverride: "Urban professionals 25-40",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect("description" in ok.data).toBe(false);
      expect(ok.data.campaignBrief).toContain("Spring launch");
    }
  });

  it("API routes do not persist or update campaigns.description", () => {
    expect(createRoute).not.toContain("description: description");
    expect(createRoute).toContain("// PD-044: do not write legacy campaigns.description");
    expect(patchRoute).toContain("// PD-044: do not read/write legacy campaigns.description");
    expect(patchRoute).not.toContain("patch.description");
    expect(briefRoute).not.toContain("campaign.description");
    expect(briefRoute).toContain("platforms:");
  });

  it("Target Audience Suggest uses Campaign Brief context", () => {
    expect(audienceUi).toContain("campaignBrief");
    expect(audienceUi).not.toContain("description:");
    expect(audienceRoute).toContain("campaignBrief: parsed.data.campaignBrief");
    expect(audienceRoute).not.toContain("description:");
    expect(audienceSkill).toContain("campaignBrief");
    expect(audienceSkill).toContain("PD-044");
    expect(audienceSkill).not.toContain("Campaign Description");

    expect(
      TargetAudienceSuggestBodySchema.safeParse({
        campaignBrief: "Launch spring menu",
        objective: "awareness",
      }).success
    ).toBe(true);
    expect(
      TargetAudienceSuggestBodySchema.safeParse({
        description: "obsolete",
      }).success
    ).toBe(false);
  });

  it("Campaign Brief Assist uses Brief plus structured context without Description", () => {
    expect(briefUi).toContain("platforms?:");
    expect(briefUi).toContain("targetAudience?:");
    expect(briefUi).not.toContain("description?:");
    expect(briefSkill).toContain("platforms: input.platforms");
    expect(briefSkill).not.toContain("description:");
    expect(
      CampaignBriefAssistBodySchema.safeParse({
        action: "polish",
        text: "Short brief",
        platforms: ["instagram"],
        targetAudience: "Parents",
      }).success
    ).toBe(true);
    expect(
      CampaignBriefAssistBodySchema.safeParse({
        action: "polish",
        text: "Short brief",
        description: "obsolete",
      }).success
    ).toBe(false);
  });

  it("main generation receives Target Audience as separate context", () => {
    expect(orchestrator).toContain("targetAudience: campaign.targetAudienceOverride");
    expect(orchestrator).toContain("campaignBrief: creativeBrief.campaignBrief");
    expect(orchestrator).not.toContain("campaign.description");
  });

  it("legacy DB description column is marked deprecated and unused by active writes", () => {
    expect(schema).toContain("@deprecated PD-044");
    expect(schema).toContain('description: text("description")');
    expect(createRoute).not.toMatch(/description:\s*description/);
  });

  it("removes Campaign Description translation keys", () => {
    expect(en).not.toContain('"campaign.workspace.description"');
    expect(zh).not.toContain('"campaign.workspace.description"');
    expect(ms).not.toContain('"campaign.workspace.description"');
    expect(JSON.parse(en)["campaign.workspace.brief"]).toBeTruthy();
    expect(JSON.parse(en)["campaign.workspace.briefReadonlyHint"]).toBeTruthy();
  });
});
