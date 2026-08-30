/**
 * EMBEROS-AI-STORY-PROD-FIX-01 — provider routing authority + source-ref preflight.
 * Zero paid provider HTTP. Adapter stubs / registry resolution only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CanonicalExecuteRequestSchema,
  CANONICAL_EXECUTE_FORBIDDEN_BODY_KEYS,
  BoundedTimeoutError,
  withBoundedTimeout,
} from "@ceo-agent/shared";
import { CanonicalAdapterRegistry } from "../packages/agents/src/ai-story/canonical-provider-adapter";
import { createCanonicalExecuteProviderRouter } from "../packages/agents/src/ai-story/canonical-execute-router";
import {
  isProviderRoutable,
  resetCanonicalProviderEligibilityCache,
  resolveCanonicalExecuteRoutingPolicy,
  resolveCanonicalVideoProviderEligibility,
  routableCanonicalVideoProviderIds,
} from "../packages/agents/src/ai-story/provider-execution-eligibility";
import { NoEligibleProviderError } from "../packages/agents/src/provider-router";
import {
  MINIMAX_ADAPTER_VERSION,
  MINIMAX_PROVIDER_ID,
} from "../packages/agents/src/ai-story/minimax-capability";
import {
  SEEDANCE_ADAPTER_VERSION,
  SEEDANCE_PROVIDER_ID,
} from "../packages/agents/src/ai-story/seedance-capability";
import { CampaignAssetRefError } from "../packages/db/src/queries/campaign-asset-refs";

const ROOT = process.cwd();

function productionLikeEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    AI_PROVIDER_ROUTING_MODE: "fixed",
    AI_DEFAULT_TEXT_PROVIDER: "openai",
    AI_DEFAULT_VIDEO_PROVIDER: "seedance",
    AI_DEFAULT_UPSCALE_PROVIDER: "fal",
    AI_PROVIDER_OPENAI_ENABLED: "false",
    AI_PROVIDER_SEEDANCE_ENABLED: "true",
    AI_PROVIDER_SEEDANCE_API_KEY: "test-seedance-not-used",
    AI_PROVIDER_SEEDANCE_BASE_URL: "https://ark.example.invalid",
    AI_PROVIDER_SEEDANCE_DEFAULT_MODEL: "dreamina-seedance-2-0-260128",
    AI_PROVIDER_MINIMAX_ENABLED: "false",
    AI_PROVIDER_FAL_ENABLED: "false",
    ...overrides,
  };
}

function bothEnabledEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return productionLikeEnv({
    AI_PROVIDER_MINIMAX_ENABLED: "true",
    AI_PROVIDER_MINIMAX_API_KEY: "test-minimax-not-used",
    AI_PROVIDER_MINIMAX_BASE_URL: "https://api.minimax.example.invalid",
    AI_PROVIDER_MINIMAX_DEFAULT_MODEL: "MiniMax-H3",
    ...overrides,
  });
}

function bothDisabledEnv(): Record<string, string | undefined> {
  return productionLikeEnv({
    AI_PROVIDER_SEEDANCE_ENABLED: "false",
    AI_PROVIDER_SEEDANCE_API_KEY: undefined,
    AI_PROVIDER_SEEDANCE_BASE_URL: undefined,
    AI_PROVIDER_SEEDANCE_DEFAULT_MODEL: undefined,
    AI_PROVIDER_MINIMAX_ENABLED: "false",
  });
}

function sceneRoutingRequest(preferredProviders?: readonly string[]) {
  return {
    routingRequestId: "10000000-0000-4000-8000-000000000901",
    capabilityId: "animation-video-generation",
    capabilityVersion: "1.0.0",
    requestSchemaVersion: "1.0.0",
    resultSchemaVersion: "1.0.0",
    tenantId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
    correlationId: "10000000-0000-4000-8000-000000000903",
    policyVersion: "1.0.0",
    requiredFeatures: ["LOOKUP"] as const,
    requireLookup: true,
    requireCancellation: false,
    requireCallbacks: false,
    requireStreaming: false,
    ...(preferredProviders ? { preferredProviders: [...preferredProviders] } : {}),
    dataHandling: {
      sensitiveData: false,
      externalProcessingAllowed: true,
      providerTrainingAllowed: false,
      enterpriseControlsRequired: false,
      zeroRetentionRequired: false,
    },
  };
}

afterEach(() => {
  resetCanonicalProviderEligibilityCache();
  vi.unstubAllGlobals();
});

describe("PROD-FIX-01 provider execution eligibility", () => {
  it("CASE A: Seedance enabled / MiniMax disabled → Seedance routable only", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const env = productionLikeEnv();
    const eligibility = resolveCanonicalVideoProviderEligibility({ env });
    const seedance = eligibility.find((row) => row.providerId === "seedance")!;
    const minimax = eligibility.find((row) => row.providerId === "minimax")!;
    expect(isProviderRoutable(seedance)).toBe(true);
    expect(isProviderRoutable(minimax)).toBe(false);
    expect(minimax.enabled).toBe(false);
    expect(minimax.executable).toBe(false);

    const policy = resolveCanonicalExecuteRoutingPolicy({ env });
    expect(policy.preferredProviders).toEqual(["seedance"]);
    expect(policy.allowedProviders).toEqual(["seedance"]);
    expect(policy.deniedProviders).toContain("minimax");

    const router = createCanonicalExecuteProviderRouter({ env });
    const decision = await router.route(sceneRoutingRequest(), policy);
    expect(decision.selectedProviderId).toBe("seedance");
    expect(decision.excludedCandidates.some((row) => row.providerId === "minimax")).toBe(
      false
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("CASE B: MiniMax implementation present but adapter unavailable → Seedance", async () => {
    const env = bothEnabledEnv();
    const eligibility = resolveCanonicalVideoProviderEligibility({
      env,
      registeredProviderIds: ["seedance"],
    });
    expect(eligibility.find((row) => row.providerId === "minimax")!.executable).toBe(false);
    expect(routableCanonicalVideoProviderIds({ env, registeredProviderIds: ["seedance"] })).toEqual(
      ["seedance"]
    );
    const policy = resolveCanonicalExecuteRoutingPolicy({
      env,
      registeredProviderIds: ["seedance"],
    });
    const router = createCanonicalExecuteProviderRouter({
      env,
      registeredProviderIds: ["seedance"],
    });
    const decision = await router.route(sceneRoutingRequest(), policy);
    expect(decision.selectedProviderId).toBe("seedance");
  });

  it("CASE C: no executable providers → NO_EXECUTABLE_PROVIDER, no binding", async () => {
    const env = bothDisabledEnv();
    const eligibility = resolveCanonicalVideoProviderEligibility({ env });
    expect(eligibility.every((row) => !isProviderRoutable(row))).toBe(true);
    const policy = resolveCanonicalExecuteRoutingPolicy({ env });
    expect(policy.allowedProviders).toEqual([]);
    const router = createCanonicalExecuteProviderRouter({ env });
    await expect(router.route(sceneRoutingRequest(), policy)).rejects.toBeInstanceOf(
      NoEligibleProviderError
    );
  });

  it("CASE D: both enabled → configured default Seedance is preferred, not localeCompare", async () => {
    const env = bothEnabledEnv();
    const policy = resolveCanonicalExecuteRoutingPolicy({ env });
    expect(policy.preferredProviders).toEqual(["seedance"]);
    expect(policy.allowedProviders).toEqual(["seedance", "minimax"]);
    const router = createCanonicalExecuteProviderRouter({ env });
    const decision = await router.route(sceneRoutingRequest(), policy);
    expect(decision.selectedProviderId).toBe("seedance");
    expect(decision.score.preferredProviderRank).toBe(0);
  });

  it("CASE E: forged preferredProviders=minimax while disabled is ignored", async () => {
    const env = productionLikeEnv();
    const policy = resolveCanonicalExecuteRoutingPolicy({
      env,
      preferredProviders: ["minimax"],
    });
    expect(policy.preferredProviders).toEqual(["seedance"]);
    expect(policy.allowedProviders).not.toContain("minimax");
    expect(CanonicalExecuteRequestSchema.safeParse({ preferredProviders: ["minimax"] }).success).toBe(
      false
    );
    expect(CANONICAL_EXECUTE_FORBIDDEN_BODY_KEYS).toContain("preferredProviders");
    const router = createCanonicalExecuteProviderRouter({ env });
    const request = {
      ...sceneRoutingRequest(),
      preferredProviders: ["minimax"],
    };
    const decision = await router.route(request, policy);
    expect(decision.selectedProviderId).toBe("seedance");
  });

  it("CASE F: historical MiniMax routing identity is not rewritten by eligibility policy", () => {
    const source = readFileSync(
      join(ROOT, "packages/agents/src/ai-story/scene-scheduling-coordinator.ts"),
      "utf8"
    );
    const existingIdx = source.indexOf("getRoutingDecisionBySceneExecutionId");
    const failClosedIdx = source.indexOf("NO_EXECUTABLE_PROVIDER");
    expect(existingIdx).toBeGreaterThan(0);
    expect(failClosedIdx).toBeGreaterThan(existingIdx);
    expect(source).toContain("existingRoutingDecision");
    expect(source).toContain("!existingRoutingDecision && policy.allowedProviders?.length === 0");
  });
});

describe("PROD-FIX-01 production-like zero-network routing preflight", () => {
  it("selects seedance across execute router, policy, and worker stub registry", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const env = productionLikeEnv();
    const policy = resolveCanonicalExecuteRoutingPolicy({ env });
    const router = createCanonicalExecuteProviderRouter({ env });
    const decision = await router.route(sceneRoutingRequest(), policy);
    expect(decision.selectedProviderId).toBe(SEEDANCE_PROVIDER_ID);

    const workerRegistry = new CanonicalAdapterRegistry();
    for (const providerId of routableCanonicalVideoProviderIds({ env })) {
      const version =
        providerId === "seedance" ? SEEDANCE_ADAPTER_VERSION : MINIMAX_ADAPTER_VERSION;
      workerRegistry.register(providerId, version, () => {
        throw new Error("stub adapter must not execute in preflight");
      });
    }
    expect(workerRegistry.has(SEEDANCE_PROVIDER_ID, SEEDANCE_ADAPTER_VERSION)).toBe(true);
    expect(workerRegistry.has(MINIMAX_PROVIDER_ID, MINIMAX_ADAPTER_VERSION)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not register MiniMax merely because the adapter implementation exists", () => {
    const env = productionLikeEnv();
    const executeRouterSource = readFileSync(
      join(ROOT, "packages/agents/src/ai-story/canonical-execute-router.ts"),
      "utf8"
    );
    expect(executeRouterSource).toContain("routableCanonicalVideoProviderIds");
    expect(executeRouterSource).not.toMatch(
      /registry\.register\(\s*routingOnlyAdapter\(\s*MINIMAX_PROVIDER_ID/
    );
    const workerSource = readFileSync(
      join(ROOT, "apps/worker/src/ai-story-canonical-adapter-registry.ts"),
      "utf8"
    );
    expect(workerSource).toContain("config.providers.minimax.enabled");
    expect(workerSource).toContain('isAiProviderReady(config, "minimax")');
    expect(routableCanonicalVideoProviderIds({ env })).toEqual(["seedance"]);
  });
});

describe("PROD-FIX-01 campaign asset refs + review fail-closed", () => {
  it("CASE G: campaign-scoped upload persists campaign_asset_refs", () => {
    const upload = readFileSync(
      join(ROOT, "apps/web/src/app/api/campaigns/[id]/assets/upload-url/route.ts"),
      "utf8"
    );
    const confirm = readFileSync(
      join(ROOT, "apps/web/src/app/api/campaigns/[id]/assets/[assetId]/confirm/route.ts"),
      "utf8"
    );
    expect(upload).toContain("persistSameWorkspaceCampaignAssetRef");
    expect(confirm).toContain("persistSameWorkspaceCampaignAssetRef");
    expect(upload).toContain("db.transaction");
  });

  it("CASE H: cross-workspace campaign ref is denied", () => {
    const error = new CampaignAssetRefError(
      "CAMPAIGN_ASSET_REF_DENIED",
      "Cross-workspace campaign asset refs are denied",
      403
    );
    expect(error.code).toBe("CAMPAIGN_ASSET_REF_DENIED");
    expect(error.status).toBe(403);
    const helper = readFileSync(
      join(ROOT, "packages/db/src/queries/campaign-asset-refs.ts"),
      "utf8"
    );
    expect(helper).toContain("Cross-workspace campaign asset refs are denied");
    expect(helper).toContain("asset.workspaceId !== input.workspaceId");
  });

  it("CASE I/J: review timeout is bounded; missing campaign binding fails QC closed", async () => {
    const createReview = readFileSync(
      join(ROOT, "packages/agents/src/ai-story/story-execution-orchestrator.ts"),
      "utf8"
    );
    const generateReviewRoute = readFileSync(
      join(
        ROOT,
        "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/review/route.ts"
      ),
      "utf8"
    );
    expect(createReview).toContain("campaignAssetRefs");
    expect(createReview).toContain("linkedAssetIds");
    expect(generateReviewRoute).toContain("withBoundedTimeout");
    expect(readFileSync(join(ROOT, "packages/agents/src/ai-story/ai-qc-validator.ts"), "utf8")).toContain(
      "asset.campaignId !== ctx.campaignId"
    );
    await expect(
      withBoundedTimeout(new Promise(() => undefined), 20, "Review hung")
    ).rejects.toBeInstanceOf(BoundedTimeoutError);
    await expect(withBoundedTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });
});
