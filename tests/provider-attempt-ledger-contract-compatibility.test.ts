import { describe, expect, it } from "vitest";
import {
  ProviderWorkerResultFinalizerBridge,
  buildBridgeProviderAttempt,
  mapWorkerResultToCanonicalProviderResult,
} from "../packages/agents/src/ai-story/provider-worker-result-finalizer-bridge";
import {
  ProviderLedgerConflictError,
  decodeProviderAttemptLedgerRow,
} from "../packages/db/src/queries/provider-ledger";
import {
  ProviderExecutionFinalizationError,
  providerAttemptUsesCurrentAiStoryTerminalEvidence,
} from "../packages/db/src/queries/provider-execution-finalizer";
import {
  InMemoryBridgeOutbox,
  buildPr35ProjectionBundle,
  buildTerminalSuccessWorkerResult,
} from "./helpers/ai-story-pr35-finalizer";
import type { ProviderAttempt, SceneProjectionValidatedBundle } from "@ceo-agent/shared";

function row(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: "attempt-1",
    executionId: "execution-1",
    contractVersion: "1",
    attemptNumber: 1,
    providerId: "seedance",
    providerVersion: "1.0.0",
    modelVersion: "dreamina-seedance-2-0-260128",
    providerRequestId: null,
    requestHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    responseHash: null,
    status: "CREATED",
    startedAt: new Date("2026-09-02T00:00:00.000Z"),
    completedAt: null,
    failure: null,
    warnings: [],
    providerMetadata: {},
    createdAt: new Date("2026-09-02T00:00:00.000Z"),
    ...overrides,
  } as never;
}

describe("Provider Attempt ledger contract compatibility", () => {
  it("retains strict legacy v1 decoding", () => {
    expect(decodeProviderAttemptLedgerRow(row())).toMatchObject({
      contractVersion: "1",
      status: "CREATED",
    });
  });

  it("decodes runtime v1 PENDING as created pre-adapter authority", () => {
    expect(
      decodeProviderAttemptLedgerRow(
        row({ contractVersion: "ai-story-provider-runtime.v1", status: "PENDING" })
      )
    ).toMatchObject({ contractVersion: "1", status: "CREATED" });
  });

  it("fails closed for unknown contract versions", () => {
    expect(() =>
      decodeProviderAttemptLedgerRow(row({ contractVersion: "unknown.v9" }))
    ).toThrowError(ProviderLedgerConflictError);
  });

  it("fails closed for unknown runtime persisted statuses", () => {
    expect(() =>
      decodeProviderAttemptLedgerRow(
        row({ contractVersion: "ai-story-provider-runtime.v1", status: "MAGIC" })
      )
    ).toThrow();
  });

  it("retains legacy finalization semantics", () => {
    expect(
      providerAttemptUsesCurrentAiStoryTerminalEvidence({
        contractVersion: "1",
        status: "SUCCEEDED",
      })
    ).toBe(false);
    expect(() =>
      providerAttemptUsesCurrentAiStoryTerminalEvidence({
        contractVersion: "1",
        status: "PENDING",
      })
    ).toThrowError(ProviderExecutionFinalizationError);
  });

  it("requires full terminal evidence for current runtime PENDING Attempts", () => {
    expect(
      providerAttemptUsesCurrentAiStoryTerminalEvidence({
        contractVersion: "ai-story-provider-runtime.v1",
        status: "PENDING",
      })
    ).toBe(true);
    expect(() =>
      providerAttemptUsesCurrentAiStoryTerminalEvidence({
        contractVersion: "ai-story-provider-runtime.v1",
        status: "SUCCEEDED",
      })
    ).toThrowError(ProviderExecutionFinalizationError);
  });

  it("fails finalization closed for unknown Attempt contract versions", () => {
    expect(() =>
      providerAttemptUsesCurrentAiStoryTerminalEvidence({
        contractVersion: "ai-story-provider-runtime.v9",
        status: "PENDING",
      })
    ).toThrowError(ProviderExecutionFinalizationError);
  });

  it("retains the persisted Attempt number across a post-terminal retry generation", async () => {
    const base = await buildPr35ProjectionBundle();
    const bundle = {
      ...base,
      correlation: { ...base.correlation, retryGeneration: 3 },
    } as SceneProjectionValidatedBundle;
    const worker = buildTerminalSuccessWorkerResult(bundle);
    const canonical = mapWorkerResultToCanonicalProviderResult({ workerResult: worker, bundle });
    const persisted = {
      ...buildBridgeProviderAttempt({ workerResult: worker, canonicalResult: canonical }),
      attemptNumber: 1,
      status: "CREATED",
      responseHash: undefined,
      completedAt: undefined,
    } as ProviderAttempt;
    let appended: ProviderAttempt | undefined;
    const bridge = new ProviderWorkerResultFinalizerBridge({
      ledger: {
        async listAttempts() { return [persisted]; },
        async appendAttempt(input) { appended = input.attempt; return input.attempt; },
      },
      outbox: new InMemoryBridgeOutbox(),
    });

    await bridge.prepareFinalizerInput({ bundle, workerResult: worker });

    expect(appended?.attemptNumber).toBe(1);
  });
});
