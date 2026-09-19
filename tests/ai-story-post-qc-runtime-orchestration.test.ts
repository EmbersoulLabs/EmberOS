import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("AI Story Post-QC runtime orchestration", () => {
  it("orders durable media acceptance before Post-QC and assembly continuation", () => {
    const source = read("packages/agents/src/ai-story/ai-story-runtime-continuation-coordinator.ts");
    const media = source.indexOf("await ingestProviderSceneMedia");
    const qc = source.indexOf("await this.deps.postGenerationQc.evaluateSceneExecution");
    const assembly = source.indexOf("const continued = await this.continueAssemblyAndFinalStoryResult");
    expect(media).toBeGreaterThan(-1);
    expect(qc).toBeGreaterThan(media);
    expect(assembly).toBeGreaterThan(qc);
    expect(source).toContain("POST_QC_RUNTIME_ORCHESTRATION_REQUIRED");
  });

  it("runs non-Provider recovery before enforcing the paid dispatch hold", () => {
    const source = read("apps/worker/src/ai-story-provider-worker-cycle.ts");
    expect(source.indexOf("recoverNext()"))
      .toBeLessThan(source.indexOf("if (isAiStoryProviderDispatchHeld())"));
  });

  it("keeps Human Review controls unavailable until safe Post-QC evidence exists", () => {
    const panel = read("apps/web/src/components/ai-story/SceneReviewWorkspacePanel.tsx");
    expect(panel).toContain("canDecide && pending && qc");
    const access = read("apps/web/src/lib/ai-story-generated-scene-review-access.ts");
    expect(access).toContain("GENERATED_SCENE_POST_QC_REQUIRED");
    expect(access).toContain("getLatestByProviderAttemptIds");
  });

  it("does not select latest compiledAt over the exact Attempt-bound compiled request", () => {
    const source = read("packages/db/src/queries/ai-story-post-generation-qc.ts");
    expect(source).toContain("POST_QC_CURRENT_RUNTIME_AUTHORITY_CORRUPT");
    expect(source).toContain("HISTORICAL_NOT_AUTO_RECOVERABLE");
    expect(source).toContain("binding.compiledRequestId");
    expect(source).not.toMatch(/orderBy\(desc\(schema\.aiStoryCompiledProviderRequests\.compiledAt\)\)/);
  });

  it("keeps recovery before the paid dispatch hold and does not submit Provider work", () => {
    const source = read("apps/worker/src/ai-story-post-generation-qc-orchestrator.ts");
    expect(source).not.toMatch(/transport\.submit|reserveBeforeSubmit|ProviderAttempt/);
    expect(source).toContain("loadRuntimeRecoveryAuthority");
    expect(source).toContain("BoundAiStoryPostGenerationQcRepository");
  });
});
