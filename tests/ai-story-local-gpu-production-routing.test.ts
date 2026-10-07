import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LocalGpuCanonicalAdapter,
  createExplicitLocalGpuProviderRouter,
  localGpuActorFromResolution,
  localGpuQueuedAction,
  resolveCanonicalExecuteRoutingPolicy,
  resolveExplicitLocalGpuProviderAuthority,
} from "@ceo-agent/agents";
import { createProductionAiStoryAdapterRegistry } from "../apps/worker/src/ai-story-canonical-adapter-registry";
import type { LocalGpuCloudAdapter } from "../packages/agents/src/ai-story/local-gpu-adapter";

const actor = (status: "ACTIVE_GRANT" | "BOOTSTRAP_ELIGIBLE" | "DENIED", plan: string | null = null) =>
  localGpuActorFromResolution({
    userId: "00000016-0000-4000-8000-000000000000",
    workspaceId: "00000003-0000-4000-8000-000000000000",
    organizationPlan: plan,
    resolution: { status },
  });

const providerEnv = {
  AI_PROVIDER_SEEDANCE_ENABLED: "true",
  AI_PROVIDER_SEEDANCE_API_KEY: "seedance-test-key",
  AI_PROVIDER_SEEDANCE_BASE_URL: "https://seedance.example",
  AI_PROVIDER_SEEDANCE_DEFAULT_MODEL: "dreamina-seedance-2-0-260128",
  AI_PROVIDER_MINIMAX_ENABLED: "true",
  AI_PROVIDER_MINIMAX_API_KEY: "minimax-test-key",
  AI_PROVIDER_MINIMAX_BASE_URL: "https://minimax.example",
  AI_PROVIDER_MINIMAX_DEFAULT_MODEL: "MiniMax-Hailuo-02",
  AI_DEFAULT_VIDEO_PROVIDER: "seedance",
  LOCAL_GPU_PROVIDER_ENABLED: "true",
  LOCAL_GPU_ENVIRONMENT: "production",
  LOCAL_GPU_SIGNING_SECRET: "local-gpu-routing-test-secret",
  LOCAL_GPU_BASE_URL: "https://local-gpu.embersoullabs.com",
};

function routingRequest() {
  return {
    routingRequestId: "00000070-0000-4000-8000-000000000000",
    capabilityId: "animation-video-generation",
    capabilityVersion: "1.0.0",
    requestSchemaVersion: "1.0.0",
    resultSchemaVersion: "1.0.0",
    tenantId: "00000002-0000-4000-8000-000000000000",
    workspaceId: "00000003-0000-4000-8000-000000000000",
    correlationId: "00000071-0000-4000-8000-000000000000",
    policyVersion: "1.0.0",
    requiredFeatures: ["LOOKUP" as const],
    requireLookup: true,
    requireCancellation: false,
    requireCallbacks: false,
    requireStreaming: false,
    preferredProviders: ["LOCAL_GPU"],
    dataHandling: {
      sensitiveData: false,
      externalProcessingAllowed: true,
      providerTrainingAllowed: false,
      enterpriseControlsRequired: false,
      zeroRetentionRequired: false,
    },
  };
}

describe("LOCAL_GPU production routing", () => {
  it("allows an explicit superadmin LOCAL_GPU selection when the provider is enabled", async () => {
    const decision = resolveExplicitLocalGpuProviderAuthority({
      requestedProvider: "LOCAL_GPU",
      actor: actor("ACTIVE_GRANT"),
      providerEnabled: true,
    });
    expect(decision).toMatchObject({
      kind: "LOCAL_GPU",
      providerId: "LOCAL_GPU",
      workflow: "MINIMAX_H3_R2V",
      automaticGenerationRetry: 0,
      remoteProviderFallback: 0,
      autoApproved: false,
    });
    const localGpu = createExplicitLocalGpuProviderRouter();
    const route = await localGpu.router.route(routingRequest(), localGpu.routingPolicy);
    expect(route.selectedProviderId).toBe("LOCAL_GPU");
    expect(localGpu.routingPolicy.deniedProviders).toEqual(["seedance", "minimax"]);
  });

  it("denies agency, non-superadmin, and a disabled provider without falling back", () => {
    expect(() => resolveExplicitLocalGpuProviderAuthority({
      requestedProvider: "LOCAL_GPU",
      actor: actor("DENIED", "agency"),
      providerEnabled: true,
    })).toThrow("LOCAL_GPU_ACCESS_DENIED");
    expect(() => resolveExplicitLocalGpuProviderAuthority({
      requestedProvider: "LOCAL_GPU",
      actor: actor("DENIED"),
      providerEnabled: true,
    })).toThrow("LOCAL_GPU_ACCESS_DENIED");
    expect(() => resolveExplicitLocalGpuProviderAuthority({
      requestedProvider: "LOCAL_GPU",
      actor: actor("BOOTSTRAP_ELIGIBLE"),
      providerEnabled: true,
    })).toThrow("LOCAL_GPU_ACCESS_DENIED");
    expect(() => resolveExplicitLocalGpuProviderAuthority({
      requestedProvider: "LOCAL_GPU",
      actor: actor("ACTIVE_GRANT"),
      providerEnabled: false,
    })).toThrow("LOCAL_GPU_PROVIDER_DISABLED");
  });

  it("leaves Seedance and MiniMax resolution unchanged when LOCAL_GPU is not explicit", () => {
    expect(resolveExplicitLocalGpuProviderAuthority({
      requestedProvider: "seedance",
      actor: actor("ACTIVE_GRANT"),
      providerEnabled: true,
    })).toEqual({ kind: "EXISTING" });
    expect(resolveExplicitLocalGpuProviderAuthority({
      requestedProvider: "minimax",
      actor: actor("ACTIVE_GRANT"),
      providerEnabled: true,
    })).toEqual({ kind: "EXISTING" });
    const seedance = resolveCanonicalExecuteRoutingPolicy({
      env: providerEnv,
      preferredProviders: ["seedance"],
    });
    const minimax = resolveCanonicalExecuteRoutingPolicy({
      env: { ...providerEnv, AI_DEFAULT_VIDEO_PROVIDER: "minimax" },
      preferredProviders: ["minimax"],
    });
    expect(seedance.preferredProviders[0]).toBe("seedance");
    expect(seedance.allowedProviders).not.toContain("LOCAL_GPU");
    expect(minimax.preferredProviders[0]).toBe("minimax");
    expect(minimax.allowedProviders).not.toContain("LOCAL_GPU");
  });

  it("registers LOCAL_GPU beside Seedance and MiniMax and does not retry or fall back after failure", async () => {
    const registry = createProductionAiStoryAdapterRegistry({
      env: providerEnv,
      seedancePayloadResolver: {} as never,
      minimaxPayloadResolver: {} as never,
      assetAccessResolver: {} as never,
      providerCreateResponseDiagnostics: { record() { return Promise.resolve(); } } as never,
    });
    const adapter = registry.resolve("LOCAL_GPU", "1.0.0");
    expect(adapter).toBeInstanceOf(LocalGpuCanonicalAdapter);
    expect(registry.has("seedance", "1.0.0")).toBe(true);
    expect(registry.has("minimax", "1.0.0")).toBe(true);
    expect(readFileSync(join(__dirname, "../packages/agents/src/provider-adapters/production-registry.ts"), "utf8")).not.toContain("LOCAL_GPU");

    let submits = 0;
    const cloud = {
      async submit() {
        submits += 1;
        return {
          providerId: "LOCAL_GPU",
          jobId: "job-1",
          workflow: "MINIMAX_H3_R2V",
          state: "QUEUED",
          plannedDurationMs: 5000,
          automaticGenerationRetry: 0,
          remoteProviderFallback: 0,
        };
      },
      async status() {
        return { jobId: "job-1", state: "FAILED", disposition: { automaticGenerationRetry: 0, remoteProviderFallback: null } };
      },
    } as unknown as LocalGpuCloudAdapter;
    const bound = new LocalGpuCanonicalAdapter({
      cloud,
      loadSubmit: async () => ({}) as never,
    });
    const submitted = await bound.submit({} as never);
    const failed = await bound.lookup({
      providerRequestId: "job-1",
      envelope: {
        tenantId: "00000002-0000-4000-8000-000000000000",
        workspaceId: "00000003-0000-4000-8000-000000000000",
        executionContext: { trace: { actorUserId: "00000016-0000-4000-8000-000000000000" } },
      },
    } as never);
    expect(submitted.operationalMetadata).toMatchObject({
      workflow: "MINIMAX_H3_R2V",
      automaticGenerationRetry: 0,
      remoteProviderFallback: 0,
    });
    expect(failed.canonicalProviderState).toBe("FAILED");
    expect(failed.failureClassification?.retryable).toBe(false);
    expect(submits).toBe(1);
    expect(bound.classifyError({ error: new Error("LOCAL_GPU failed"), phase: "lookup" }).retryable).toBe(false);
  });

  it("keeps Manual Local as the default Execute mode", () => {
    const source = readFileSync(
      join(__dirname, "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts"),
      "utf8",
    );
    expect(source).toContain('executionMode: "MANUAL_LOCAL"');
    expect(source).toContain('explicitProvider === "LOCAL_GPU"');
    expect(source).toContain("bindExplicitLocalGpuRelease");
    expect(source).not.toContain('executionMode: "REMOTE_PROVIDER"');
  });

  it("does not resubmit or fall back after LOCAL_GPU failure", () => {
    expect(localGpuQueuedAction(null)).toBe("submit");
    expect(localGpuQueuedAction("job-1")).toBe("poll");
    expect(localGpuQueuedAction("job-1", "FAILED")).toBe("stop");
    expect(localGpuQueuedAction("job-1", "CANCELLED")).toBe("stop");
    expect(localGpuQueuedAction("failed:job-1", "FAILED")).toBe("stop");
    expect(localGpuQueuedAction("job-1", "COMPLETED")).toBe("finalize");
    expect(localGpuQueuedAction("completed:job-1", "COMPLETED")).toBe("stop");
    expect(localGpuQueuedAction("result:job-1")).toBe("stop");
  });
});
