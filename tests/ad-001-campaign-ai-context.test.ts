import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  buildCampaignAIContext,
  isCampaignAIContext,
  withCampaignAIContext,
} from "@ceo-agent/shared";

function read(rel: string): string {
  return readFileSync(resolve(rel), "utf8");
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".next") continue;
      walkTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
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
  const marketingBoundary = read("packages/agents/src/marketing-pipeline.ts");
  const provider = read("packages/agents/src/campaign-context-provider.ts");
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

  it("every Campaign AI module accepts CampaignAIContext", () => {
    for (const mod of MODULES) {
      const src = read(mod.path);
      expect(src, mod.name).toContain("campaignContext: CampaignAIContext");
      expect(src, `${mod.name} Required Inputs`).toMatch(/Required:/);
      expect(src, `${mod.name} Optional Inputs`).toMatch(/Optional:/);
    }
    expect(read("packages/agents/src/score.ts")).toContain("runAutoClipScoreAgent");
  });

  it("Orchestrator-owned provider is the single buildCampaignAIContext caller in app code", () => {
    expect(provider).toContain("buildCampaignAIContext(");
    expect(provider).toContain("export function provideCampaignAIContext");

    const allowed = new Set([
      resolve("packages/shared/src/campaign-ai-context.ts"),
      resolve("packages/agents/src/campaign-context-provider.ts"),
      resolve("tests/ad-001-campaign-ai-context.test.ts"),
      resolve("tests/sprint-0004-phase-2.test.ts"),
    ]);

    const roots = ["packages/agents/src", "apps/web/src", "apps/worker/src"];
    for (const root of roots) {
      for (const file of walkTsFiles(resolve(root))) {
        const src = readFileSync(file, "utf8");
        if (!src.includes("buildCampaignAIContext(")) continue;
        expect(allowed.has(file), `unexpected buildCampaignAIContext in ${file}`).toBe(true);
      }
    }
  });

  it("Orchestrator provides CampaignAIContext to agency modules", () => {
    expect(orchestrator).toContain("provideCampaignAIContext({");
    expect(orchestrator).not.toContain("buildCampaignAIContext(");
    expect(orchestrator).toMatch(/runCeoAgent\(\{[\s\S]*?campaignContext/);
    expect(orchestrator).toMatch(/runContentTypeAgent\(\{[\s\S]*?campaignContext/);
    expect(orchestrator).toContain("runMarketingContentPipeline(");
    expect(marketingBoundary).toMatch(
      /runMarketingContentAgent\(\{[\s\S]*?campaignContext/
    );
    expect(orchestrator).toMatch(/runEditDirectorAgent\(\{[\s\S]*?campaignContext/);
    expect(orchestrator).toMatch(/runComplianceAgent\(\{[\s\S]*?campaignContext/);
    expect(orchestrator).toMatch(/runScoreAgent\(\{[\s\S]*?campaignContext/);
    expect(orchestrator).toMatch(/runCopyAgentMix\(\{[\s\S]*?campaignContext/);
  });

  it("Auto Clip uses Orchestrator provider and passes CampaignAIContext", () => {
    expect(autoClip).toContain("provideCampaignAIContext({");
    expect(autoClip).not.toContain("buildCampaignAIContext(");
    expect(autoClip).toContain("runMarketingContentPipeline(");
    expect(autoClip).toContain("runStrategyPipeline(");
    expect(autoClip).toMatch(/runVisionAgent\(\{[\s\S]*campaignContext:/);
    expect(marketingBoundary).toMatch(
      /runStrategyAgent\(\{[\s\S]*campaignContext/
    );
  });

  it("modules do not construct Campaign context", () => {
    for (const mod of MODULES) {
      const src = read(mod.path);
      expect(src, mod.name).not.toContain("buildCampaignAIContext(");
      expect(src, mod.name).not.toContain("provideCampaignAIContext(");
    }
  });

  it("prompt behaviour remains structurally unchanged (modules still call LLM helpers)", () => {
    expect(read("packages/agents/src/ceo.ts")).toContain("callJsonModel");
    expect(read("packages/agents/src/marketing-content.ts")).toContain("CONTENT_SYSTEM_PROMPT");
    expect(read("packages/agents/src/compliance.ts")).toContain(
      "You are a Compliance Agent for Singapore/SEA advertising."
    );
    expect(read("packages/agents/src/score.ts")).toContain("You are the Marketing Score Agent");
  });

  it("build/provideCampaignAIContext produces a complete core object", () => {
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

  it("Campaign Description is never referenced", () => {
    expect(contextDef).not.toContain("campaignDescription");
    expect(orchestrator).not.toContain("campaign.description");
    expect(autoClip).not.toContain("campaign.description");
    expect(provider).not.toContain("Campaign Description");
    for (const mod of MODULES) {
      expect(read(mod.path)).not.toContain("Campaign Description");
    }
  });
});
