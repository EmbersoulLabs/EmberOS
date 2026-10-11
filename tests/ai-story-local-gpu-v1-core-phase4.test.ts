import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AI_STORY_CERTIFIED_LOCAL_WORKFLOWS } from "@ceo-agent/shared/server";
import { resolveExplicitLocalGpuProviderAuthority } from "../packages/agents/src/ai-story/local-gpu-access";
import {
  localGpuAssemblyHandoff,
  resolveLocalGpuReviewState,
  selectLocalGpuReviewResult,
} from "../packages/agents/src/ai-story/local-gpu-review-handoff";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const audio = { hasAudio: true as const, speechContent: "HUMAN_REVIEW_REQUIRED" as const };

describe("LOCAL_GPU V1 core phase 4", () => {
  it("keeps a pending audible review from becoming another generation", () => {
    const pending = resolveLocalGpuReviewState({
      decision: null,
      aggregateStatus: "POST_QC_REQUIRES_HUMAN_CONFIRMATION",
      audio,
    });
    expect(pending).toMatchObject({ runtime: "PENDING_REVIEW", regenerate: false, dispatch: false, remoteProviderFallback: 0 });
    expect(localGpuAssemblyHandoff({
      decision: null,
      aggregateStatus: "POST_QC_REQUIRES_HUMAN_CONFIRMATION",
      audio,
    }).assemblyEligible).toBe(false);
    const approved = localGpuAssemblyHandoff({
      decision: "APPROVED",
      aggregateStatus: "POST_QC_PASS",
      audio,
    });
    expect(approved).toEqual({ assemblyEligible: true, dispatch: false, remoteProviderFallback: 0 });
    expect(resolveLocalGpuReviewState({
      decision: "APPROVED",
      aggregateStatus: "POST_QC_PASS",
      audio,
    }).regenerate).toBe(false);
  });

  it("selects one worker result and leaves execution closed", () => {
    const row = {
      sourceKind: "LOCAL_GPU_WORKER",
      workspaceId: id(3),
      localPackageId: id(1),
      generationResultId: id(40),
    };
    expect(selectLocalGpuReviewResult([
      row,
      { ...row, sourceKind: "MANUAL_LOCAL", generationResultId: id(41), localPackageId: id(1) },
    ], { workspaceId: id(3), packageId: id(1) })?.generationResultId).toBe(id(40));
    expect(() => selectLocalGpuReviewResult([row, { ...row, generationResultId: id(42) }], {
      workspaceId: id(3),
      packageId: id(1),
    })).toThrow("LOCAL_GPU_DUPLICATE_RESULT");
    expect(() => resolveExplicitLocalGpuProviderAuthority({ requestedProvider: "LOCAL_GPU" })).toThrow("LOCAL_GPU_PROVIDER_DISABLED");
    expect([...AI_STORY_CERTIFIED_LOCAL_WORKFLOWS]).toEqual(["MINIMAX_H3_NATIVE_DIALOGUE"]);
    const processors = readFileSync(join(root, "apps/worker/src/processors/index.ts"), "utf8");
    const execute = readFileSync(join(root, "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts"), "utf8");
    expect(processors).not.toContain("local-gpu");
    expect(execute).not.toContain("LOCAL_GPU");
    const route = readFileSync(join(root, "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/result/route.ts"), "utf8");
    expect(route).toContain("findSoleLocalGpuWorkerResult");
    expect(route).not.toContain("submit(");
  });
});
