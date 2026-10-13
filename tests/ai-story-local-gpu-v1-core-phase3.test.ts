import { describe, expect, it } from "vitest";
import { advanceLocalGpuRelease } from "../packages/agents/src/ai-story/local-gpu-release-cycle";
import {
  LocalGpuCloudAdapter,
  LocalGpuSubmitAmbiguousError,
  LocalGpuSubmitRejectedError,
} from "../packages/agents/src/ai-story/local-gpu-adapter";
import { loadLocalGpuConfigFromEnv } from "../packages/agents/src/ai-story/local-gpu-config";
import { carryLocalGpuAudioEvidence, planLocalGpuCompletion } from "../packages/agents/src/ai-story/local-gpu-result-finalization";
import { LOCAL_GPU_WORKER_WORKFLOW } from "@ceo-agent/shared/server";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const hash = `sha256:${"c".repeat(64)}`;
const now = new Date("2026-10-11T00:00:00.000Z");
const actor = {
  userId: id(16),
  workspaceId: id(3),
  organizationPlan: null,
  platformAdminStatus: "ACTIVE_GRANT" as const,
};

function cloud(http: ConstructorParameters<typeof LocalGpuCloudAdapter>[1]) {
  return new LocalGpuCloudAdapter(loadLocalGpuConfigFromEnv({
    LOCAL_GPU_PROVIDER_ENABLED: "true",
    LOCAL_GPU_ENVIRONMENT: "staging",
    LOCAL_GPU_SIGNING_SECRET: "phase3-test-signing-secret",
    LOCAL_GPU_BASE_URL: "https://local-gpu.embersoullabs.com",
  }), http, { now: () => now, nonce: () => "nonce-409" });
}

const pkg = {
  workspaceId: id(3),
  sceneExecutionId: id(9),
  packageId: id(1),
  storyId: id(5),
  storyVersionId: id(6),
  prompt: "A synthetic scene",
  recommendedWorkflow: LOCAL_GPU_WORKER_WORKFLOW,
  generateAudio: true,
  audioBlocked: false,
  aspectRatio: "9:16",
  references: [{
    approval: "APPROVED",
    role: "PRODUCT",
    assetUrl: "https://storage.example.test/ref.png",
    contentHash: hash,
  }],
};

describe("LOCAL_GPU V1 core phase 3", () => {
  it("treats HTTP 409 as an existing job and reconciles the original id", async () => {
    let posts = 0;
    const adapter = cloud(async (request) => {
      if (request.method === "POST") {
        posts += 1;
        return { status: 409, body: JSON.stringify({ code: "JOB_EXISTS" }) };
      }
      return { status: 200, body: JSON.stringify({ state: "GENERATING" }) };
    });
    const jobId = adapter.jobIdFor(pkg);
    await expect(adapter.submit({
      actor,
      package: pkg,
      plannedDurationMs: 6000,
      upload: { environment: "staging", method: "PUT", url: "https://storage.example.test/upload/object", assetId: id(15) },
    })).rejects.toMatchObject({ name: "LocalGpuContractError", message: "LOCAL_GPU_SUBMIT_AMBIGUOUS", reason: "conflict", jobId });
    const recovered = advanceLocalGpuRelease(
      { gate: jobId, notFoundCount: 0, uncertainCount: 0 },
      { type: "submit_ambiguous" },
    );
    expect(recovered.gate).toBe(`reconcile:0:${jobId}`);
    expect(recovered.submit).toBe(false);
    expect(posts).toBe(1);
    const status = await adapter.status(jobId, { actor, workspaceId: id(3), sceneExecutionId: id(9) });
    expect(status).toMatchObject({ found: true, jobId, state: "GENERATING" });
    expect(posts).toBe(1);
  });

  it("keeps a validation 422 terminal and does not confuse it with 409", async () => {
    const adapter = cloud(async () => ({ status: 422, body: JSON.stringify({ code: "REJECTED" }) }));
    await expect(adapter.submit({
      actor,
      package: pkg,
      plannedDurationMs: 6000,
      upload: { environment: "staging", method: "PUT", url: "https://storage.example.test/upload/object", assetId: id(15) },
    })).rejects.toBeInstanceOf(LocalGpuSubmitRejectedError);
    await expect(adapter.submit({
      actor,
      package: pkg,
      plannedDurationMs: 6000,
      upload: { environment: "staging", method: "PUT", url: "https://storage.example.test/upload/object", assetId: id(15) },
    })).rejects.not.toBeInstanceOf(LocalGpuSubmitAmbiguousError);
  });

  it("reuses one completed result and refuses to drop speech evidence", () => {
    const jobId = id(31);
    const first = planLocalGpuCompletion({ jobId, existingResultId: null, contentHash: hash });
    expect(first).toMatchObject({ action: "materialize_once", generationResultId: null, submit: false, remoteProviderFallback: 0 });
    const second = planLocalGpuCompletion({ jobId, existingResultId: id(40), contentHash: hash });
    expect(second).toMatchObject({ action: "reuse", generationResultId: id(40), submit: false });
    const prior = { hasAudio: true as const, speechContent: "HUMAN_REVIEW_REQUIRED" as const };
    expect(carryLocalGpuAudioEvidence({ hasAudio: true, prior, successor: prior })).toEqual(prior);
    expect(() => carryLocalGpuAudioEvidence({ hasAudio: true, prior, successor: null })).toThrow("LOCAL_GPU_AUDIO_EVIDENCE_DROPPED");
  });
});
