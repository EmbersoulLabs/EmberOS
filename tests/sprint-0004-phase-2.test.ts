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
const marketingPipeline = read("packages/agents/src/marketing-pipeline.ts");
const schema = read("packages/db/src/schema/index.ts");
const workspaceSql = read("packages/db/sql/campaign-workspace-v1.sql");
const dropSql = read("packages/db/sql/campaign-description-pd044.sql");
const campaignWorkspaceTs = read("packages/shared/src/campaign-workspace.ts");
const briefAssistTs = read("packages/shared/src/campaign-brief-assist.ts");
const audienceSuggestTs = read("packages/shared/src/types/target-audience-suggest-ai.ts");
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
    expect(wizard).toContain("<TargetAudienceAssistant");
    expect(wizard).toContain("campaignBrief={campaignBrief}");
    expect(wizard).toMatch(
      /step === "review"[\s\S]*campaign\.workspace\.targetAudience/
    );
    expect(wizard).not.toMatch(
      /step === "review"[\s\S]*campaign\.workspace\.description/
    );
  });

  it("create and patch payloads use campaignBrief only as free-text", () => {
    expect(wizard).toContain("campaignBrief: campaignBrief.trim()");
    expect(wizard).toContain("targetAudienceOverride: targetAudience.trim()");
    expect(wizard).not.toContain("description: description");
  });

  it("Campaign Workspace overview shows Brief read-only", () => {
    expect(workspace).not.toContain("campaign.workspace.description");
    expect(workspace).not.toContain("setDescription");
    expect(workspace).toContain("campaign.workspace.briefReadonlyHint");
    expect(workspace).toContain("campaign.workspace.briefEmpty");
    expect(workspace).toContain("<CampaignBriefAssistant");
    expect(workspace).toContain("targetAudience={audienceOverride}");
  });

  it("create and PATCH contracts have no Campaign Description field", () => {
    expect(campaignWorkspaceTs).not.toContain("RejectedCampaignDescriptionSchema");
    expect(campaignWorkspaceTs).not.toContain("z.never");
    expect("description" in CampaignWorkspaceCreateSchema.shape).toBe(false);
    expect("description" in CampaignWorkspacePatchSchema.shape).toBe(false);
    expect("campaignBrief" in CampaignWorkspaceCreateSchema.shape).toBe(true);
    expect("campaignBrief" in CampaignWorkspacePatchSchema.shape).toBe(true);

    const created = CampaignWorkspaceCreateSchema.safeParse({
      workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      name: "Launch",
      objective: "awareness",
      campaignBrief: "Spring launch for urban professionals",
      targetAudienceOverride: "Urban professionals 25-40",
      description: "should be stripped as unknown key",
    });
    expect(created.success).toBe(true);
    if (created.success) {
      expect("description" in created.data).toBe(false);
      expect(created.data.campaignBrief).toContain("Spring launch");
    }

    const patched = CampaignWorkspacePatchSchema.safeParse({
      campaignBrief: "Updated brief",
      description: "should be stripped as unknown key",
    });
    expect(patched.success).toBe(true);
    if (patched.success) {
      expect("description" in patched.data).toBe(false);
      expect(patched.data.campaignBrief).toBe("Updated brief");
    }
  });

  it("API routes persist campaignBrief and never reference campaigns.description", () => {
    expect(createRoute).toContain("campaignBrief:");
    expect(createRoute).not.toMatch(/description:\s*description/);
    expect(createRoute).not.toContain("campaigns.description");
    expect(patchRoute).toContain("campaignBrief:");
    expect(patchRoute).not.toContain("patch.description");
    expect(patchRoute).not.toContain("campaigns.description");
    expect(briefRoute).not.toContain("campaign.description");
    expect(briefRoute).toContain("platforms:");
  });

  it("Brief Assist and Audience Suggest contracts have no Campaign Description field", () => {
    expect(briefAssistTs).not.toContain("description:");
    expect(briefAssistTs).not.toContain("z.never");
    expect(audienceSuggestTs).not.toContain("description:");
    expect(audienceSuggestTs).not.toContain("z.never");
    expect("description" in CampaignBriefAssistBodySchema.shape).toBe(false);
    expect("description" in TargetAudienceSuggestBodySchema.shape).toBe(false);

    expect(audienceUi).toContain("campaignBrief");
    expect(audienceRoute).toContain("campaignBrief: parsed.data.campaignBrief");
    expect(audienceSkill).toContain("campaignBrief");
    expect(briefUi).toContain("platforms?:");
    expect(briefUi).toContain("targetAudience?:");
    expect(briefSkill).toContain("publishingPlatforms:");
    expect(briefSkill).toContain("businessProfile:");
    expect(briefSkill).toContain("workspaceLanguage:");

    expect(
      TargetAudienceSuggestBodySchema.safeParse({
        campaignBrief: "Launch spring menu",
        objective: "awareness",
      }).success
    ).toBe(true);
    expect(
      CampaignBriefAssistBodySchema.safeParse({
        action: "polish",
        text: "Short brief",
        platforms: ["instagram"],
        targetAudience: "Parents",
      }).success
    ).toBe(true);
  });

  it("main generation receives Target Audience as separate context", () => {
    expect(orchestrator).toContain("provideCampaignAIContext");
    expect(orchestrator).toContain("campaignContext:");
    expect(orchestrator).toContain("targetAudience: campaign.targetAudienceOverride");
    expect(orchestrator).toContain("campaignBrief: creativeBrief.campaignBrief");
    expect(orchestrator).not.toContain("campaign.description");
  });

  it("Campaign AI modules receive the same CampaignAIContext", () => {
    const vision = read("packages/agents/src/vision.ts");
    const strategy = read("packages/agents/src/strategy.ts");
    const autoClip = read("packages/agents/src/auto-clip-pipeline.ts");
    const videoUnderstanding = read(
      "packages/agents/src/video-understanding-pipeline.ts"
    );
    const contextDef = read("packages/shared/src/campaign-ai-context.ts");
    const briefSkillSrc = read("packages/agents/src/skills/campaign-brief-assist/skill.ts");
    const provider = read("packages/agents/src/campaign-context-provider.ts");

    expect(contextDef).toContain("export interface CampaignAIContext");
    expect(contextDef).toContain("businessProfile:");
    expect(contextDef).toContain("campaignObjective:");
    expect(contextDef).toContain("publishingPlatforms:");
    expect(contextDef).toContain("targetAudience:");
    expect(contextDef).toContain("campaignBrief:");
    expect(contextDef).toContain("workspaceLanguage:");

    expect(vision).toContain("campaignContext: CampaignAIContext");
    expect(strategy).toContain("campaignContext: CampaignAIContext");
    expect(provider).toContain("provideCampaignAIContext");
    expect(orchestrator).toContain("provideCampaignAIContext({");
    expect(autoClip).toContain("provideCampaignAIContext({");
    expect(orchestrator).toContain("campaignContext: visionContext");
    expect(autoClip).toMatch(
      /runVideoUnderstandingPipeline\(\{[\s\S]*campaignContext/
    );
    expect(videoUnderstanding).toContain(
      "campaignContext: input.campaignContext"
    );
    expect(orchestrator).toContain("runStrategyPipeline(");
    expect(autoClip).toContain("runStrategyPipeline(");
    expect(marketingPipeline).toContain(
      "export function runStrategyPipeline(merged: MergedCampaignContext)"
    );
    expect(marketingPipeline).toContain(
      "export function runMarketingContentPipeline(merged: MergedCampaignContext)"
    );
    expect(briefRoute).toContain("provideCampaignAIContext");
    expect(briefSkillSrc).toContain("publishingPlatforms:");
    expect(briefSkillSrc).toContain("businessProfile:");
    expect(briefSkillSrc).toContain("workspaceLanguage:");
  });

  it("database schema and creation SQL have no campaigns.description", () => {
    expect(schema).not.toContain('description: text("description")');
    expect(schema).not.toContain("@deprecated PD-044");
    expect(schema).toContain('campaignBrief: text("campaign_brief")');
    expect(workspaceSql).not.toContain("ADD COLUMN IF NOT EXISTS description");
    expect(workspaceSql).not.toContain("campaigns.description");
  });

  it("migration preserves legacy description only when Campaign Brief is empty", () => {
    expect(dropSql).toContain("DROP COLUMN IF EXISTS description");
    expect(dropSql).toContain("SET campaign_brief = description");
    expect(dropSql).toContain(
      "(campaign_brief IS NULL OR btrim(campaign_brief) = '')"
    );
    expect(dropSql).toContain("btrim(description) <> ''");
    expect(dropSql).toMatch(/preserve|keep campaign_brief|already has content/i);
  });

  it("unrelated description fields remain unchanged", () => {
    expect(schema).toContain('businessDescription: text("business_description")');
    expect(en).toContain('"campaign.brief.description"');
    expect(en).toContain('"marketing.field.description"');
  });

  it("removes Campaign Description translation keys", () => {
    expect(en).not.toContain('"campaign.workspace.description"');
    expect(zh).not.toContain('"campaign.workspace.description"');
    expect(ms).not.toContain('"campaign.workspace.description"');
    expect(JSON.parse(en)["campaign.workspace.brief"]).toBeTruthy();
    expect(JSON.parse(en)["campaign.workspace.briefReadonlyHint"]).toBeTruthy();
  });
});
