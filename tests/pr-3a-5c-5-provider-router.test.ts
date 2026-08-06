import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  ProviderAdapter,
  ProviderCapabilityDeclaration,
} from "../packages/agents/src/provider-adapters/contracts";
import {
  CanonicalProviderRouter,
  NoEligibleProviderError,
  PROVIDER_ROUTING_SCORE_WEIGHTS,
  ProviderAdapterRegistry,
  type ProviderRoutingPolicy,
  type ProviderRoutingRequest,
} from "../packages/agents/src/provider-router";

function declaration(
  providerId: string,
  overrides: Partial<ProviderCapabilityDeclaration> = {}
): ProviderCapabilityDeclaration {
  return {
    providerId,
    adapterVersion: "1.0.0",
    capabilityId: "json-generation",
    capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
    requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
    resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
    requiredProviderFeatures: ["STRUCTURED_OUTPUT"],
    nativeIdempotency: true,
    lookup: true,
    cancellation: true,
    callbacks: true,
    streaming: true,
    routing: {
      costClass: "LOW",
      estimatedCostUsd: 0.01,
      latencyClass: "FAST",
      qualityClass: "HIGH",
      reliabilityClass: "HIGH",
      regions: ["US", "SG"],
      modelFamilies: ["general"],
      sensitiveDataAllowed: true,
      externalProcessing: true,
      trainingOptOut: true,
      zeroRetention: true,
      maximumRetentionDays: 0,
      enterpriseControls: true,
    },
    ...overrides,
  };
}

function fakeAdapter(capability: ProviderCapabilityDeclaration) {
  const execute = vi.fn();
  const lookup = vi.fn();
  const cancel = vi.fn();
  const adapter: ProviderAdapter = {
    providerId: capability.providerId,
    adapterVersion: capability.adapterVersion,
    capabilities: () => new Set([capability]),
    execute,
    lookup,
    cancel,
  };
  return { adapter, execute, lookup, cancel };
}

function request(
  overrides: Partial<ProviderRoutingRequest> = {}
): ProviderRoutingRequest {
  return {
    routingRequestId: "routing-1",
    capabilityId: "json-generation",
    capabilityVersion: "1.0.0",
    requestSchemaVersion: "1.0.0",
    resultSchemaVersion: "1.0.0",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    correlationId: "correlation-1",
    policyVersion: "1.0.0",
    requiredFeatures: ["STRUCTURED_OUTPUT"],
    requireLookup: false,
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
    ...overrides,
  };
}

function policy(
  overrides: Partial<ProviderRoutingPolicy> = {}
): ProviderRoutingPolicy {
  return {
    policyVersion: "1.0.0",
    preferredProviders: [],
    requireTrainingOptOut: true,
    ...overrides,
  };
}

async function routeWith(
  declarations: readonly ProviderCapabilityDeclaration[],
  routingRequest = request(),
  routingPolicy = policy()
) {
  const registry = new ProviderAdapterRegistry();
  const adapters = declarations.map((item) => fakeAdapter(item));
  for (const item of adapters) registry.register(item.adapter);
  const router = new CanonicalProviderRouter(
    registry,
    () => new Date("2026-01-01T00:00:00.000Z")
  );
  return {
    decision: await router.route(routingRequest, routingPolicy),
    adapters,
    registry,
  };
}

describe("PR-3A.5C.5 Provider Router", () => {
  it("registers declarations, rejects duplicates, and returns immutable sorted snapshots", async () => {
    const registry = new ProviderAdapterRegistry();
    const beta = fakeAdapter(declaration("beta"));
    const alpha = fakeAdapter(declaration("alpha"));
    registry.register(beta.adapter);
    registry.register(alpha.adapter);

    expect(() => registry.register(alpha.adapter)).toThrow(/already registered/);
    const snapshot = await registry.snapshot();
    expect(snapshot.declarations.map((item) => item.providerId)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.declarations)).toBe(true);
    expect(registry.get("alpha", "1.0.0")).toHaveLength(1);
    expect(() => {
      (snapshot.declarations as ProviderCapabilityDeclaration[]).push(
        declaration("mutation")
      );
    }).toThrow();
  });

  it.each([
    [
      "capability ID",
      declaration("provider", { capabilityId: "vision" }),
      "CAPABILITY_ID_MISMATCH",
    ],
    [
      "capability version",
      declaration("provider", {
        capabilityVersions: [{ minInclusive: "2.0.0", maxExclusive: "3.0.0" }],
      }),
      "CAPABILITY_VERSION_MISMATCH",
    ],
    [
      "request schema",
      declaration("provider", {
        requestSchemaVersions: [{ minInclusive: "2.0.0", maxExclusive: "3.0.0" }],
      }),
      "REQUEST_SCHEMA_MISMATCH",
    ],
    [
      "result schema",
      declaration("provider", {
        resultSchemaVersions: [{ minInclusive: "2.0.0", maxExclusive: "3.0.0" }],
      }),
      "RESULT_SCHEMA_MISMATCH",
    ],
  ])("reports %s incompatibility", async (_label, candidate, code) => {
    const error = await routeWith([candidate]).catch((value) => value);
    expect(error).toBeInstanceOf(NoEligibleProviderError);
    expect(
      (error as NoEligibleProviderError).details.exclusions[0]?.reasons.map(
        (reason) => reason.code
      )
    ).toContain(code);
  });

  it.each([
    ["feature", declaration("provider", { requiredProviderFeatures: [] }), { requiredFeatures: ["STRUCTURED_OUTPUT"] }, "REQUIRED_FEATURE_MISSING"],
    ["lookup", declaration("provider", { lookup: false }), { requireLookup: true }, "LOOKUP_UNSUPPORTED"],
    ["cancellation", declaration("provider", { cancellation: false }), { requireCancellation: true }, "CANCELLATION_UNSUPPORTED"],
    ["callback", declaration("provider", { callbacks: false }), { requireCallbacks: true }, "CALLBACK_UNSUPPORTED"],
    ["streaming", declaration("provider", { streaming: false }), { requireStreaming: true }, "STREAMING_UNSUPPORTED"],
  ] as const)("reports required %s support", async (_label, candidate, patch, code) => {
    const error = await routeWith([candidate], request(patch)).catch((value) => value);
    expect(error).toBeInstanceOf(NoEligibleProviderError);
    expect(
      (error as NoEligibleProviderError).details.exclusions[0]?.reasons.map(
        (reason) => reason.code
      )
    ).toContain(code);
  });

  it("applies allowed, denied, workspace, capability, and model policies", async () => {
    const candidate = declaration("provider");
    const cases: Array<[ProviderRoutingPolicy, string]> = [
      [policy({ allowedProviders: ["other"] }), "PROVIDER_NOT_ALLOWED"],
      [policy({ deniedProviders: ["provider"] }), "PROVIDER_DENIED"],
      [
        policy({ workspaceDeniedProviders: { "workspace-1": ["provider"] } }),
        "WORKSPACE_RESTRICTION",
      ],
      [
        policy({ capabilityAllowedProviders: { "json-generation": ["other"] } }),
        "CAPABILITY_RESTRICTION",
      ],
      [policy({ allowedModelFamilies: ["vision-only"] }), "MODEL_FAMILY_RESTRICTION"],
    ];
    for (const [routingPolicy, code] of cases) {
      const error = await routeWith([candidate], request(), routingPolicy).catch(
        (value) => value
      );
      expect(
        (error as NoEligibleProviderError).details.exclusions[0]?.reasons.map(
          (reason) => reason.code
        )
      ).toContain(code);
    }
  });

  it("requires both request and policy allowed lists to approve the provider", async () => {
    const error = await routeWith(
      [declaration("provider")],
      request({ allowedProviders: ["provider"] }),
      policy({ allowedProviders: ["other"] })
    ).catch((value) => value);
    expect(
      (error as NoEligibleProviderError).details.exclusions[0]?.reasons.map(
        (reason) => reason.code
      )
    ).toContain("PROVIDER_NOT_ALLOWED");
  });

  it("applies data handling and residency only from declared metadata", async () => {
    const candidate = declaration("provider", {
      routing: {
        ...declaration("provider").routing,
        regions: ["EU"],
        sensitiveDataAllowed: false,
        externalProcessing: true,
        trainingOptOut: false,
        zeroRetention: false,
        maximumRetentionDays: 30,
        enterpriseControls: false,
      },
    });
    const error = await routeWith(
      [candidate],
      request({
        dataHandling: {
          sensitiveData: true,
          externalProcessingAllowed: false,
          providerTrainingAllowed: false,
          maximumRetentionDays: 1,
          requiredRegions: ["SG"],
          enterpriseControlsRequired: true,
          zeroRetentionRequired: true,
        },
      })
    ).catch((value) => value);
    const codes = (error as NoEligibleProviderError).details.exclusions[0]!.reasons.map(
      (reason) => reason.code
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "REGION_RESTRICTION",
        "SENSITIVE_DATA_UNSUPPORTED",
        "EXTERNAL_PROCESSING_DENIED",
        "TRAINING_OPT_OUT_REQUIRED",
        "RETENTION_LIMIT_EXCEEDED",
        "ZERO_RETENTION_REQUIRED",
        "ENTERPRISE_CONTROLS_REQUIRED",
      ])
    );
  });

  it("rejects cost, latency, quality, and reliability violations", async () => {
    const candidate = declaration("provider", {
      routing: {
        ...declaration("provider").routing,
        costClass: "HIGH",
        estimatedCostUsd: 1,
        latencyClass: "SLOW",
        qualityClass: "STANDARD",
        reliabilityClass: "STANDARD",
      },
    });
    const error = await routeWith(
      [candidate],
      request({ maximumEstimatedCostUsd: 0.1, maximumLatencyClass: "FAST", minimumQualityClass: "HIGH" }),
      policy({ maximumCostClass: "LOW", minimumReliabilityClass: "HIGH" })
    ).catch((value) => value);
    const codes = (error as NoEligibleProviderError).details.exclusions[0]!.reasons.map(
      (reason) => reason.code
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "COST_CEILING_EXCEEDED",
        "LATENCY_CEILING_EXCEEDED",
        "QUALITY_REQUIREMENT_UNMET",
        "RELIABILITY_REQUIREMENT_UNMET",
      ])
    );
  });

  it("uses explicit preference before inspectable policy score", async () => {
    const highScore = declaration("alpha", {
      routing: { ...declaration("alpha").routing, qualityClass: "PREMIUM" },
    });
    const preferred = declaration("beta", {
      routing: { ...declaration("beta").routing, qualityClass: "STANDARD" },
    });
    const { decision } = await routeWith(
      [highScore, preferred],
      request({ preferredProviders: ["beta"] })
    );

    expect(decision.selectedProviderId).toBe("beta");
    expect(decision.score.preferredProviderRank).toBe(0);
    expect(PROVIDER_ROUTING_SCORE_WEIGHTS).toEqual({
      quality: 4,
      cost: 2,
      latency: 2,
      reliability: 4,
      residency: 2,
      nativeIdempotency: 1,
      lookup: 1,
      cancellation: 1,
    });
    expect(decision.selectionReasons).toContain(
      `policy-score:${decision.score.total}`
    );
  });

  it("breaks equal-score ties lexically and prefers the latest adapter version", async () => {
    const lexical = await routeWith([declaration("beta"), declaration("alpha")]);
    expect(lexical.decision.selectedProviderId).toBe("alpha");

    const older = declaration("alpha", { adapterVersion: "1.0.0" });
    const newer = declaration("alpha", { adapterVersion: "1.1.0" });
    const version = await routeWith([older, newer]);
    expect(version.decision.selectedAdapterVersion).toBe("1.1.0");
  });

  it("produces stable snapshot and decision hashes for identical inputs", async () => {
    const first = await routeWith([declaration("alpha"), declaration("beta")]);
    const second = await routeWith([declaration("beta"), declaration("alpha")]);

    expect(first.decision.registrySnapshotHash).toBe(
      second.decision.registrySnapshotHash
    );
    expect(first.decision.decisionHash).toBe(second.decision.decisionHash);
    expect(first.decision).toEqual(second.decision);
    expect(Object.isFrozen(first.decision)).toBe(true);
  });

  it("snapshots mutable caller inputs before asynchronous routing", async () => {
    const registry = new ProviderAdapterRegistry();
    registry.register(fakeAdapter(declaration("alpha")).adapter);
    const router = new CanonicalProviderRouter(
      registry,
      () => new Date("2026-01-01T00:00:00.000Z")
    );
    const mutableRequest = request({ preferredProviders: [] });
    const mutablePolicy = policy();
    const pending = router.route(mutableRequest, mutablePolicy);
    (mutableRequest.preferredProviders as string[]).push("other");
    (mutablePolicy.preferredProviders as string[]).push("other");

    const decision = await pending;
    expect(decision.selectedProviderId).toBe("alpha");
    expect(decision.score.preferredProviderRank).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("returns complete immutable no-route diagnostics without relaxing constraints", async () => {
    const error = await routeWith(
      [declaration("alpha"), declaration("beta")],
      request({ allowedProviders: ["none"] })
    ).catch((value) => value);
    expect(error).toBeInstanceOf(NoEligibleProviderError);
    const details = (error as NoEligibleProviderError).details;
    expect(details).toMatchObject({
      routingRequestId: "routing-1",
      capabilityId: "json-generation",
      capabilityVersion: "1.0.0",
      requestSchemaVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
      policyVersion: "1.0.0",
    });
    expect(details.exclusions).toHaveLength(2);
    expect(
      details.exclusions.every((item) => item.reasons.length > 0)
    ).toBe(true);
    expect(Object.isFrozen(details)).toBe(true);
  });

  it("never executes Adapter methods while routing", async () => {
    const routed = await routeWith([declaration("alpha"), declaration("beta")]);
    for (const item of routed.adapters) {
      expect(item.execute).not.toHaveBeenCalled();
      expect(item.lookup).not.toHaveBeenCalled();
      expect(item.cancel).not.toHaveBeenCalled();
    }
  });

  it("has no SDK, persistence, Pipeline, retry, or fallback execution dependency", () => {
    const files = [
      "packages/agents/src/provider-router/contracts.ts",
      "packages/agents/src/provider-router/adapter-registry.ts",
      "packages/agents/src/provider-router/provider-router.ts",
    ].map((file) => readFileSync(resolve(file), "utf8")).join("\n");

    expect(files).not.toMatch(/from\s+["']openai["']/);
    expect(files).not.toMatch(/@ceo-agent\/db|provider-ledger|provider-outbox/);
    expect(files).not.toMatch(/pipeline-|createReview|stepProgress/);
    expect(files).not.toMatch(/\.execute\(|\.lookup\(|\.cancel\(/);
    expect(files).not.toMatch(/setTimeout|Math\.random|fallback|retry/i);
  });
});
