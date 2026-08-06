import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter } from "../packages/agents/src/provider-adapters/contracts";
import {
  CanonicalProviderRouter,
  ProviderAdapterRegistry,
  type ProviderRoutingPolicy,
  type ProviderRoutingRequest,
} from "../packages/agents/src/provider-router";

function adapter(providerId: string): ProviderAdapter {
  return {
    providerId,
    adapterVersion: "1.0.0",
    capabilities: () =>
      new Set([
        {
          providerId,
          adapterVersion: "1.0.0",
          capabilityId: "json-generation",
          capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
          requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
          resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
          requiredProviderFeatures: ["STRUCTURED_OUTPUT"],
          nativeIdempotency: true,
          lookup: false,
          cancellation: false,
          callbacks: false,
          streaming: false,
          routing: {
            costClass: "LOW",
            latencyClass: "FAST",
            qualityClass: "HIGH",
            reliabilityClass: "HIGH",
            regions: [],
            modelFamilies: ["model-a"],
            sensitiveDataAllowed: false,
            externalProcessing: true,
            trainingOptOut: true,
            zeroRetention: true,
            enterpriseControls: true,
          },
        },
      ]),
    execute: vi.fn(),
  };
}

describe("PR-3A.5C.8 Provider Reliability regression", () => {
  it("routes identical snapshots deterministically without executing an Adapter", async () => {
    const registry = new ProviderAdapterRegistry();
    const beta = adapter("provider-b");
    const alpha = adapter("provider-a");
    registry.register(beta);
    registry.register(alpha);
    const router = new CanonicalProviderRouter(
      registry,
      () => new Date("2026-01-01T00:00:00.000Z")
    );
    const request: ProviderRoutingRequest = {
      routingRequestId: "regression-route",
      capabilityId: "json-generation",
      capabilityVersion: "1.0.0",
      requestSchemaVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
      tenantId: "tenant",
      workspaceId: "workspace",
      correlationId: "correlation",
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
    };
    const policy: ProviderRoutingPolicy = {
      policyVersion: "1.0.0",
      preferredProviders: [],
      requireTrainingOptOut: true,
    };

    const first = await router.route(request, policy);
    const second = await router.route(request, policy);
    expect(first.selectedProviderId).toBe("provider-a");
    expect(first.decisionHash).toBe(second.decisionHash);
    expect(alpha.execute).not.toHaveBeenCalled();
    expect(beta.execute).not.toHaveBeenCalled();
  });

  it("keeps infrastructure responsibilities isolated at source boundaries", () => {
    const root = resolve(__dirname, "..");
    const resume = readFileSync(
      resolve(root, "apps/worker/src/provider-resume-coordinator.ts"),
      "utf8"
    );
    const reconciler = readFileSync(
      resolve(root, "apps/worker/src/provider-reconciler.ts"),
      "utf8"
    );
    const router = readFileSync(
      resolve(root, "packages/agents/src/provider-router/provider-router.ts"),
      "utf8"
    );
    const adapter = readFileSync(
      resolve(root, "packages/agents/src/provider-adapters/openai-json-adapter.ts"),
      "utf8"
    );
    const worker = readFileSync(
      resolve(root, "apps/worker/src/provider-dispatch-worker.ts"),
      "utf8"
    );
    const finalizer = readFileSync(
      resolve(root, "apps/worker/src/provider-execution-finalizer.ts"),
      "utf8"
    );

    expect(resume).not.toMatch(/resumePipeline|continueWorkflow|\.execute\(/);
    expect(reconciler).not.toMatch(/\.(insert|update|delete)\(|resumePipeline/);
    expect(router).not.toMatch(/\.execute\(|\.lookup\(|\.cancel\(/);
    expect(adapter).not.toMatch(/CanonicalProviderRouter|ProviderOutboxRepository/);
    expect(worker).not.toMatch(/ExecutionFinalizer|\.finalize\(/);
    expect(finalizer).not.toMatch(/ResumeCoordinator|resumePipeline/);
  });
});
