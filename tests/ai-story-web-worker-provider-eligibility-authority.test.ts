import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ProviderExecutorAuthoritySchema,
  type ProviderExecutorCapabilityAuthority,
} from "@ceo-agent/shared";
import {
  resolveCanonicalExecuteRoutingPolicy,
  resolveCanonicalVideoProviderEligibility,
} from "../packages/agents/src/ai-story/provider-execution-eligibility";
import { createCanonicalExecuteProviderRouter } from "../packages/agents/src/ai-story/canonical-execute-router";
import { buildSeedanceCapabilityDeclaration } from "../packages/agents/src/ai-story/seedance-capability";
import { buildProviderExecutorAuthority } from "../apps/worker/src/provider-executor-authority-heartbeat";

const ROOT = process.cwd();
const MODEL = "dreamina-seedance-2-0-260128";

function webWithoutProviderCredential(): Record<string, string | undefined> {
  return {
    AI_DEFAULT_VIDEO_PROVIDER: "seedance",
    AI_PROVIDER_SEEDANCE_ENABLED: undefined,
    AI_PROVIDER_SEEDANCE_API_KEY: undefined,
  };
}

function seedanceAuthority(
  overrides: Partial<ProviderExecutorCapabilityAuthority> = {}
): ProviderExecutorCapabilityAuthority {
  return {
    providerId: "seedance",
    adapterVersion: "1.0.0",
    productEnabled: true,
    executorRegistered: true,
    executorReady: true,
    capabilityIds: ["animation-video-generation"],
    supportedModels: [MODEL],
    ...overrides,
  };
}

describe("canonical Web-to-Worker Provider eligibility authority", () => {
  it("routes Seedance from a ready Worker without a Web Provider credential", async () => {
    const input = {
      env: webWithoutProviderCredential(),
      executorAuthorities: [seedanceAuthority()],
      requestedModel: MODEL,
    };
    const policy = resolveCanonicalExecuteRoutingPolicy(input);
    const eligibility = resolveCanonicalVideoProviderEligibility(input);
    expect(policy.allowedProviders).toEqual(["seedance"]);
    expect(eligibility.find((row) => row.providerId === "seedance")).toMatchObject({
      enabled: true,
      executable: true,
      capabilityCompatible: true,
      modelSupported: true,
      executorKind: "REMOTE_CANONICAL_WORKER_EXECUTOR",
    });

    const router = createCanonicalExecuteProviderRouter(input);
    const decision = await router.route(
      {
        routingRequestId: "10000000-0000-4000-8000-000000000901",
        capabilityId: "animation-video-generation",
        capabilityVersion: "1.0.0",
        requestSchemaVersion: "1.0.0",
        resultSchemaVersion: "1.0.0",
        tenantId: "10000000-0000-4000-8000-000000000001",
        workspaceId: "10000000-0000-4000-8000-000000000002",
        correlationId: "10000000-0000-4000-8000-000000000903",
        policyVersion: "1.0.0",
        requiredFeatures: ["LOOKUP"],
        requireLookup: true,
        requireCancellation: false,
        requireCallbacks: false,
        requireStreaming: false,
        dataHandling: {
          sensitiveData: false,
          externalProcessingAllowed: true,
          providerTrainingAllowed: false,
          enterpriseControlsRequired: false,
          zeroRetentionRequired: false,
        },
      },
      policy
    );
    expect(decision.selectedProviderId).toBe("seedance");
  });

  it("fails closed when Worker registration is absent", () => {
    expect(
      resolveCanonicalExecuteRoutingPolicy({
        env: webWithoutProviderCredential(),
        executorAuthorities: [],
      }).allowedProviders
    ).toEqual([]);
  });

  it("fails closed when the Worker is not ready", () => {
    expect(
      resolveCanonicalExecuteRoutingPolicy({
        env: webWithoutProviderCredential(),
        executorAuthorities: [seedanceAuthority({ executorReady: false })],
      }).allowedProviders
    ).toEqual([]);
  });

  it("fails closed for an unsupported model", () => {
    expect(
      resolveCanonicalExecuteRoutingPolicy({
        env: webWithoutProviderCredential(),
        executorAuthorities: [seedanceAuthority()],
        requestedModel: "unsupported-model",
      }).allowedProviders
    ).toEqual([]);
  });

  it("preserves local-executor compatibility", () => {
    const env = {
      AI_DEFAULT_VIDEO_PROVIDER: "seedance",
      AI_PROVIDER_SEEDANCE_ENABLED: "true",
      AI_PROVIDER_SEEDANCE_API_KEY: "test-only-not-used",
      AI_PROVIDER_SEEDANCE_BASE_URL: "https://example.invalid",
      AI_PROVIDER_SEEDANCE_DEFAULT_MODEL: MODEL,
    };
    expect(resolveCanonicalExecuteRoutingPolicy({ env }).allowedProviders).toEqual([
      "seedance",
    ]);
  });
});

describe("Worker authority projection secret boundary", () => {
  it("publishes registered capability facts without credential material", () => {
    const fakeCredential = "test-worker-secret-never-output";
    const authority = buildProviderExecutorAuthority(
      {
        RAILWAY_ENVIRONMENT_NAME: "staging",
        RAILWAY_DEPLOYMENT_ID: "worker-deployment-test",
        AI_PROVIDER_SEEDANCE_ENABLED: "true",
        AI_PROVIDER_SEEDANCE_API_KEY: fakeCredential,
        AI_PROVIDER_SEEDANCE_BASE_URL: "https://example.invalid",
        AI_PROVIDER_SEEDANCE_DEFAULT_MODEL: MODEL,
        AI_PROVIDER_MINIMAX_ENABLED: "false",
      } as NodeJS.ProcessEnv,
      new Date("2026-09-01T00:00:00.000Z"),
      [buildSeedanceCapabilityDeclaration({ defaultModel: MODEL })]
    );
    expect(ProviderExecutorAuthoritySchema.parse(authority)).toEqual(authority);
    expect(authority.capabilities).toEqual([seedanceAuthority()]);
    expect(JSON.stringify(authority)).not.toContain(fakeCredential);
    expect(JSON.stringify(authority)).not.toContain("apiKey");
  });

  it("wires every product-reachable release route through Worker authority", () => {
    const routePaths = [
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts",
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/release-next-scene/route.ts",
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/release-remaining-scenes/route.ts",
    ];
    for (const routePath of routePaths) {
      const source = readFileSync(join(ROOT, routePath), "utf8");
      expect(source).toContain("resolveCanonicalWebExecuteProviderAuthority");
      expect(source).toContain("providerRouting.routingPolicy");
      expect(source).toContain("providerRouting.router");
    }
  });

  it("keeps entitlement and commercial authorization upstream of scheduling", () => {
    const source = readFileSync(
      join(
        ROOT,
        "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts"
      ),
      "utf8"
    );
    expect(source.indexOf("authorizeAiStoryExecution")).toBeLessThan(
      source.indexOf("resolveCanonicalWebExecuteProviderAuthority")
    );
    expect(source).toContain("executionAuthorization");
    expect(source).toContain("authorizeAndExecuteExecutionPlan");
  });
});
