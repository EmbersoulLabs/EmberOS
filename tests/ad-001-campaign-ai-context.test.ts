import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCampaignAIContext,
  isCampaignAIContext,
  withCampaignAIContext,
} from "@ceo-agent/shared";

function read(rel: string): string {
  return readFileSync(resolve(rel), "utf8");
}

const MODULES = [
  { name: "CEO Planning", path: "packages/agents/src/ceo.ts" },
  { name: "Content Type", path: "packages/agents/src/content-type.ts" },
  { name: "Marketing Content", path: "packages/agents/src/marketing-content.ts" },
  { name: "Edit Director", path: "packages/agents/src/edit.ts" },
  { name: "Compliance", path: "packages/agents/src/compliance.ts" },
  { name: "Marketing Score", path: "packages/agents/src/score.ts" },
  { name: "Copy Regeneration", path: "packages/agents/src/copy.ts" },
  { name: "Vision", path: "packages/agents/src/vision.ts" },
  { name: "Strategy", path: "packages/agents/src/strategy.ts" },
] as const;

describe("AD-001 Campaign AI Context Contract", () => {
  const orchestrator = read("packages/agents/src/orchestrator.ts");
  const autoClip = read("packages/agents/src/auto-clip-pipeline.ts");
  const contextDef = read("packages/shared/src/campaign-ai-context.ts");

  it("defines canonical CampaignAIContext core and optional fields", () => {
    expect(contextDef).toContain("export interface CampaignAIContext");
    for (const field of [
      "businessProfile",
      "campaignObjective",
      "publishingPlatforms",
      "targetAudience",
      "campaignBrief",
      "workspaceLanguage",
      "assets?",
      "vision?",
      "transcript?",
      "strategy?",
      "generatedOutputs?",
      "workflowMetadata?",
    ]) {
      expect(contextDef).toContain(field);
    }
  });

  it("every Campaign AI module requires campaignContext", () => {
    for (const mod of MODULES) {
      const src = read(mod.path);
      expect(src, mod.name).toContain("campaignContext: CampaignAIContext");
    }
    expect(read("packages/agents/src/score.ts")).toContain(
      "campaignContext: CampaignAIContext"
    );
    expect(read("packages/agents/src/score.ts")).toContain("runAutoClipScoreAgent");
  });

  it("Orchestrator is the provider of CampaignAIContext for the agency pipeline", () => {
    expect(orchestrator).toContain("buildCampaignAIContext({");
    expect(orchestrator).toContain("campaignContext: pipelineContext");
    expect(orchestrator).toContain("campaignContext: visionContext");
    expect(orchestrator).toContain("campaignContext: strategyContext");
    expect(orchestrator).toMatch(/runCeoAgent\(\{[\s\S]*?campaignContext/);
    expect(orchestrator).toMatch(/runContentTypeAgent\(\{[\s\S]*?campaignContext/);
    expect(orchestrator).toMatch(/runMarketingContentAgent\(\{[\s\S]*?campaignContext/);
    expect(orchestrator).toMatch(/runEditDirectorAgent\(\{[\s\S]*?campaignContext/);
    expect(orchestrator).toMatch(/runComplianceAgent\(\{[\s\S]*?campaignContext/);
    expect(orchestrator).toMatch(/runScoreAgent\(\{[\s\S]*?campaignContext/);
    expect(orchestrator).toMatch(/runCopyAgentMix\(\{[\s\S]*?campaignContext/);
  });

  it("Auto Clip pipeline provides CampaignAIContext to marketing and score modules", () => {
    expect(autoClip).toContain("buildCampaignAIContext({");
    expect(autoClip).toMatch(/runMarketingContentAgent\(\{[\s\S]*campaignContext:/);
    expect(autoClip).toMatch(/runAutoClipScoreAgent\(\{[\s\S]*campaignContext:/);
    expect(autoClip).toMatch(/runVisionAgent\(\{[\s\S]*campaignContext:/);
    expect(autoClip).toMatch(/runStrategyAgent\(\{[\s\S]*campaignContext:/);
  });

  it("modules do not call buildCampaignAIContext themselves", () => {
    for (const mod of MODULES) {
      const src = read(mod.path);
      expect(src, `${mod.name} must not build context`).not.toContain(
        "buildCampaignAIContext("
      );
    }
  });

  it("buildCampaignAIContext produces a complete core object", () => {
    const ctx = buildCampaignAIContext({
      campaignObjective: "awareness",
      publishingPlatforms: ["instagram"],
      targetAudience: "Parents 25-40",
      campaignBrief: "Spring launch",
      workspaceLanguage: "en",
    });
    expect(isCampaignAIContext(ctx)).toBe(true);
    expect(ctx.campaignBrief).toBe("Spring launch");
    expect(ctx.targetAudience).toBe("Parents 25-40");
    expect(ctx.publishingPlatforms).toEqual(["instagram"]);
    expect(ctx.strategy).toBeNull();
    expect(ctx.generatedOutputs).toBeNull();

    const enriched = withCampaignAIContext(ctx, {
      strategy: {
        industry: "general",
        businessType: "Local",
        product: "X",
        marketingGoal: "awareness",
        marketingAngle: "angle",
        brandPersonality: [],
        tone: "friendly",
        videoStyle: "showcase",
        audience: { painPoints: [], interests: [] },
        customerJourney: "Awareness",
        platformPriority: ["instagram"],
        ctaStrategy: "DM",
        keywords: [],
        hashtags: { industry: [], local: [], trending: [], seo: [] },
        confidence: 0.8,
      },
    });
    expect(enriched.campaignBrief).toBe("Spring launch");
    expect(enriched.strategy?.product).toBe("X");
  });

  it("does not reintroduce Campaign Description", () => {
    expect(contextDef).not.toContain("campaignDescription");
    expect(orchestrator).not.toContain("campaign.description");
    expect(autoClip).not.toContain("campaign.description");
  });
});
