import { describe, expect, it } from "vitest";
import { LocalGpuCloudAdapter } from "../packages/agents/src/ai-story/local-gpu-adapter";
import { loadLocalGpuConfigFromEnv } from "../packages/agents/src/ai-story/local-gpu-config";
import { runWorkerLocalGpuDispatchCycle } from "../apps/worker/src/ai-story-local-gpu-worker-dispatch";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const scope = { workspaceId: id(3), storyId: id(5), sceneExecutionId: id(40) };
const now = new Date("2026-10-11T00:00:00.000Z");
const actor = { userId: id(16), workspaceId: scope.workspaceId, organizationPlan: null, platformAdminStatus: "ACTIVE_GRANT" as const };
const capabilities = {
  contractVersion: 3,
  acceptedContracts: [1, 2, 3],
  contracts: {
    v3: {
      workflows: {
        MINIMAX_H3_T2V: {
          execution: "enabled",
          textToVideo: true,
          placeholderImage: false,
          missingModels: [],
          e2eCertified: false,
        },
      },
    },
  },
};
const request = {
  storyId: scope.storyId,
  storyVersionId: id(6),
  prompt: "A quiet product story with room tone.",
  plannedDurationMs: 6000,
  aspectRatio: "9:16" as const,
  seed: 11,
  megapixels: 0.5,
  audioPolicy: "NO_DIALOGUE_WITH_AMBIENT_AUDIO" as const,
  upload: { environment: "staging" as const, method: "PUT", url: "https://uploads.example.test/scene.mp4" },
  assetRecommendationStatus: "CONFIRMED_NO_ASSETS" as const,
  confirmationStoryId: scope.storyId,
  confirmationStoryVersionId: id(6),
  confirmationWorkspaceId: scope.workspaceId,
  planningFrozen: true,
  preGenerationQcEvaluationId: id(80),
  runtimeAuthorizationId: id(70),
  director: { camera: "slow push in", motion: "hold the ending" },
};
const stagingEnv = {
  LOCAL_GPU_PROVIDER_ENABLED: "true",
  LOCAL_GPU_SINGLE_RUN_AUTHORIZED: "true",
  LOCAL_GPU_ENVIRONMENT: "staging",
  LOCAL_GPU_SCOPE_WORKSPACE_ID: scope.workspaceId,
  LOCAL_GPU_SCOPE_STORY_ID: scope.storyId,
  LOCAL_GPU_SCOPE_SCENE_EXECUTION_ID: scope.sceneExecutionId,
};

describe("worker LOCAL_GPU dispatch composition", () => {
  it("posts once for the scoped scene, then finalizes from status without a second POST", async () => {
    const posts: string[] = [];
    const gets: string[] = [];
    const claimed: string[] = [];
    const unrelated = id(41);
    const adapter = new LocalGpuCloudAdapter(loadLocalGpuConfigFromEnv({
      LOCAL_GPU_PROVIDER_ENABLED: "true",
      LOCAL_GPU_ENVIRONMENT: "staging",
      LOCAL_GPU_SIGNING_SECRET: "contract-v3-test-secret",
      LOCAL_GPU_BASE_URL: "https://local-gpu.example.test",
    }), async (attempt) => {
      if (attempt.method === "POST") posts.push(attempt.url);
      else gets.push(attempt.url);
      if (attempt.url.endsWith("/result")) {
        return { status: 200, body: JSON.stringify({ result: { state: "COMPLETED", contentHash: `sha256:${"b".repeat(64)}` } }) };
      }
      if (attempt.method === "GET") return { status: 200, body: JSON.stringify({ job: { state: "COMPLETED" } }) };
      return { status: 200, body: JSON.stringify({ state: "QUEUED" }) };
    }, { now: () => now, nonce: () => "nonce-v3" });
    const jobId = adapter.jobIdFor({ workspaceId: scope.workspaceId, sceneExecutionId: scope.sceneExecutionId, packageId: id(30) });
    let existingGate: string | null = null;
    const deps = {
      load: async (requested: typeof scope) => {
        expect(requested).toEqual(scope);
        return {
          ...scope,
          packageId: id(30),
          runtimeAuthorizationId: id(70),
          existingGate,
          route: {
            assetMode: "WITHOUT_ASSET" as const,
            assetRecommendationStatus: "CONFIRMED_NO_ASSETS" as const,
            referenceCount: 0,
            preQc: "DISPATCH_ELIGIBLE" as const,
            runtimeAuthorizationId: id(70),
            capabilities,
            generateAudio: true,
            audioBlocked: false,
            qcExpectation: "NO_DIALOGUE_WITH_AMBIENT_AUDIO" as const,
          },
        };
      },
      claim: (claim: { sceneExecutionId: string; jobId: string }) => {
        expect(claim.sceneExecutionId).toBe(scope.sceneExecutionId);
        expect(claim.sceneExecutionId).not.toBe(unrelated);
        claimed.push(claim.sceneExecutionId);
        return true;
      },
      adapter,
      actor,
      request,
      capabilities,
      existingResultId: null,
    };
    const first = await runWorkerLocalGpuDispatchCycle(stagingEnv, deps);
    expect(first).toMatchObject({ posts: 1, gets: 0, submit: false, code: "accepted" });
    expect(posts).toHaveLength(1);
    expect(claimed).toEqual([scope.sceneExecutionId]);
    existingGate = jobId;
    const second = await runWorkerLocalGpuDispatchCycle(stagingEnv, deps);
    expect(second).toMatchObject({ posts: 0, gets: 2, submit: false, code: "materialize_once" });
    expect(posts).toHaveLength(1);
    expect(gets).toHaveLength(2);
    expect(claimed).toHaveLength(1);
  });

  it("does not load or post when dispatch is disabled or production is named", async () => {
    let loads = 0;
    const deps = {
      load: async () => {
        loads += 1;
        return null;
      },
      claim: () => true,
      adapter: {} as never,
      actor,
      request,
      capabilities,
      existingResultId: null,
    };
    expect(await runWorkerLocalGpuDispatchCycle({}, deps)).toMatchObject({ code: "DISABLED", posts: 0, submit: false });
    expect(await runWorkerLocalGpuDispatchCycle({
      ...stagingEnv,
      LOCAL_GPU_ENVIRONMENT: "production",
    }, deps)).toMatchObject({ code: "LOCAL_GPU_PRODUCTION_DENIED", posts: 0, submit: false });
    expect(loads).toBe(0);
  });
});
