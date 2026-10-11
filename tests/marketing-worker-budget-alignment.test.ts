import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("worker marketing budget wiring", () => {
  const orchestrator = readFileSync("packages/agents/src/orchestrator.ts", "utf8");
  const autoClip = readFileSync("packages/agents/src/auto-clip-pipeline.ts", "utf8");
  const budget = readFileSync("packages/agents/src/marketing-budget.ts", "utf8");
  const processor = readFileSync("apps/worker/src/processors/index.ts", "utf8");
  const railway = readFileSync("railway.toml", "utf8");

  it("reserves budget before either initial marketing provider call", () => {
    const step = budget.slice(budget.indexOf("export async function runPaidMarketingStep"));
    expect(step.indexOf("beginPaidMarketingCall")).toBeLessThan(step.indexOf("await input.run()"));
    expect(step.indexOf("await input.run()")).toBeLessThan(step.indexOf("finishPaidMarketingCall"));
    const generate = budget.slice(budget.indexOf("export async function generateInitialMarketingPackage"));
    expect(generate.indexOf('agent: "marketing_content"')).toBeLessThan(generate.indexOf('agent: "marketing_translate"'));
    expect(orchestrator).toContain("generateInitialMarketingPackage");
    expect(autoClip).toContain("generateInitialMarketingPackage");
    expect(orchestrator).not.toContain('logAgent(task.orgId, task.workspaceId, taskId, "marketing_content"');
    expect(autoClip).not.toContain('logAgent(task.orgId, task.workspaceId, taskId, "marketing_content"');
  });

  it("keeps the worker job entry, story routing, and start command", () => {
    expect(processor).toContain('job.name === "agent.pipeline"');
    expect(processor).toContain("runPipeline(taskId, pipelineHooks)");
    expect(processor).toContain('job.name === "agent.story_execution"');
    expect(processor).toContain('job.name === "agent.story_planning_stage"');
    expect(processor).not.toContain("generateInitialMarketingPackage");
    expect(railway).toContain('startCommand = "pnpm --filter @ceo-agent/worker exec tsx src/index.ts"');
    expect(readFileSync("packages/agents/src/ai-story/local-gpu-adapter.ts", "utf8")).not.toContain("beginPaidMarketingCall");
    expect(readFileSync("packages/agents/src/provider-adapters/production-registry.ts", "utf8")).not.toContain("LOCAL_GPU");
  });
});
