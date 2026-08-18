/**
 * Sprint 3 PR 3.5 (remediated) — projection contract freezes.
 */
import { describe, expect, it } from "vitest";
import {
  SCENE_PROJECTION_CONTRACT_VERSION,
  SCENE_PROJECTION_VERSION,
  ProjectedSceneResultSchema,
  buildProviderCostReference,
  buildProviderUsageReference,
  buildProviderFinalizationReference,
} from "@ceo-agent/shared";
import { projectSceneResultFromAcceptedFinalization } from "../packages/agents/src/ai-story/scene-result-projector";
import {
  buildPr35ProjectionBundle,
  buildTerminalSuccessWorkerResult,
} from "./helpers/ai-story-pr35-finalizer";

describe("Sprint 3 PR 3.5 remediated projection contracts", () => {
  it("freezes projection contract versions", () => {
    expect(SCENE_PROJECTION_CONTRACT_VERSION).toBe("1");
    expect(SCENE_PROJECTION_VERSION).toBe(1);
  });

  it("stores Provider references instead of duplicated usage/cost amounts", async () => {
    const bundle = await buildPr35ProjectionBundle();
    const worker = buildTerminalSuccessWorkerResult(bundle);
    const projected = projectSceneResultFromAcceptedFinalization({
      workerResult: worker,
      bundle,
      finalization: {
        executionId: worker.providerExecutionId,
        attemptId: worker.providerAttemptId,
        jobId: worker.outboxJobId,
        workerId: "test-worker",
        completedAt: "2026-08-05T13:00:01.000Z",
        resultReference: "https://cdn.example.com/scene-a.mp4",
        responseHash: worker.deterministicIntegrityHash,
        providerId: worker.providerId,
        adapterVersion: worker.adapterVersion,
        completionMetadata: {},
        terminalKind: "SUCCEEDED",
      },
    });

    const parsed = ProjectedSceneResultSchema.parse(projected.sceneResult);
    expect(parsed.providerUsageReference).toBe(
      buildProviderUsageReference(worker.providerAttemptId)
    );
    expect(parsed.providerCostReference).toBe(
      buildProviderCostReference(worker.providerAttemptId)
    );
    expect(parsed.providerFinalizationReference).toBe(
      buildProviderFinalizationReference({
        executionId: worker.providerExecutionId,
        attemptId: worker.providerAttemptId,
        jobId: worker.outboxJobId,
        completedAt: "2026-08-05T13:00:01.000Z",
        resultReference: "https://cdn.example.com/scene-a.mp4",
      })
    );
    expect(parsed).not.toHaveProperty("facts");
    expect(JSON.stringify(parsed)).not.toMatch(/"amount":0\.32/);
    expect(parsed.status).toBe("SUCCEEDED");
  });
});
