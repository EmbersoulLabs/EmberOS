/**
 * EMBEROS-AI-STORY-EXEC-05 — provider attempt usage/cost persistence.
 * Deterministic only. No Seedance / MiniMax / paid provider calls.
 */
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_CREDIT_CHARGE_AUTHORITY_KIND,
  PROVIDER_COST_AUTHORITY_KIND,
  classifyPersistedProviderCost,
  configuredEstimateForProvider,
  mapWorkerCostMetadataToProviderCost,
  mapWorkerUsageFactsToProviderUsage,
  nextProviderAttemptNumber,
  providerRequestIdIsAttemptIdentity,
  reconstructAiStoryProviderSpend,
  redactProviderCostEvidenceRecord,
  safeProviderRequestId,
  toAiStoryProviderAttemptCostEvidence,
  type AiStoryProviderAttemptCostRecord,
} from "@ceo-agent/shared";

const STORY = "10000000-0000-4000-8000-000000000005";
const SCENE_A = "10000000-0000-4000-8000-000000000201";
const SCENE_B = "10000000-0000-4000-8000-000000000202";
const PLAN = "10000000-0000-4000-8000-000000000101";
const EXEC_A = "exec-a";
const EXEC_B = "exec-b";

function record(
  patch: Partial<AiStoryProviderAttemptCostRecord> &
    Pick<AiStoryProviderAttemptCostRecord, "attemptId" | "attemptNumber" | "sceneExecutionId">
): AiStoryProviderAttemptCostRecord {
  return {
    storyId: STORY,
    executionPlanId: PLAN,
    providerExecutionId: EXEC_A,
    providerId: "seedance",
    modelVersion: "seedance-1-0",
    status: "SUCCEEDED",
    createdAt: "2026-08-19T00:00:00.000Z",
    startedAt: "2026-08-19T00:00:00.000Z",
    completedAt: "2026-08-19T00:00:10.000Z",
    ...patch,
  };
}

describe("EXEC-05 provider attempt cost mapping", () => {
  it("CASE A: successful attempt cost is persisted from configured estimate", () => {
    const cost = mapWorkerCostMetadataToProviderCost(
      configuredEstimateForProvider("seedance")
    );
    expect(cost).toMatchObject({
      amount: 0.35,
      currency: "USD",
      estimated: true,
      costSource: "CONFIGURED_ESTIMATE",
    });
    const evidence = toAiStoryProviderAttemptCostEvidence(
      record({
        attemptId: "attempt-success",
        attemptNumber: 1,
        sceneExecutionId: SCENE_A,
        cost,
        usage: mapWorkerUsageFactsToProviderUsage({
          durationMs: 5000,
          requestedDurationSeconds: 5,
          requestedResolution: "1080p",
        }),
      })
    );
    expect(evidence.outcome).toBe("success");
    expect(evidence.amount).toBe(0.35);
    expect(evidence.costSource).toBe("CONFIGURED_ESTIMATE");
    expect(evidence.requestedDurationSeconds).toBe(5);
    expect(evidence.requestedResolution).toBe("1080p");
  });

  it("CASE B: failed attempt with known cost preserves amount", () => {
    const cost = mapWorkerCostMetadataToProviderCost({
      amount: 0.4,
      currency: "USD",
      estimated: true,
      costSource: "CONFIGURED_ESTIMATE",
    });
    const evidence = toAiStoryProviderAttemptCostEvidence(
      record({
        attemptId: "attempt-failed-known",
        attemptNumber: 1,
        sceneExecutionId: SCENE_A,
        status: "TERMINAL_FAILURE",
        failureCode: "PROVIDER_FAILED",
        cost,
      })
    );
    expect(evidence.outcome).toBe("failure");
    expect(evidence.amount).toBe(0.4);
    expect(evidence.costSource).toBe("CONFIGURED_ESTIMATE");
    expect(evidence.failureClass).toBe("PROVIDER_FAILED");
  });

  it("CASE C: failed attempt with unknown cost is UNKNOWN, not 0", () => {
    const cost = mapWorkerCostMetadataToProviderCost(undefined);
    expect(cost.amount).toBeNull();
    expect(cost.costSource).toBe("UNKNOWN");
    expect(cost.amount).not.toBe(0);
    const evidence = toAiStoryProviderAttemptCostEvidence(
      record({
        attemptId: "attempt-failed-unknown",
        attemptNumber: 1,
        sceneExecutionId: SCENE_A,
        status: "TERMINAL_FAILURE",
        failureCode: "PROVIDER_FAILED",
        cost,
      })
    );
    expect(evidence.amount).toBeNull();
    expect(evidence.costSource).toBe("UNKNOWN");
  });
});

describe("EXEC-05 retry and reconstruction", () => {
  it("CASE D: retry keeps old attempt and adds a new attemptId/number", () => {
    const first = record({
      attemptId: "attempt-1",
      attemptNumber: 1,
      sceneExecutionId: SCENE_A,
      cost: {
        amount: 0.35,
        currency: "USD",
        estimated: true,
        costSource: "CONFIGURED_ESTIMATE",
      },
    });
    const secondNumber = nextProviderAttemptNumber(
      [{ attemptId: first.attemptId, attemptNumber: first.attemptNumber }],
      "attempt-2"
    );
    expect(secondNumber).toBe(2);
    const second = record({
      attemptId: "attempt-2",
      attemptNumber: secondNumber,
      sceneExecutionId: SCENE_A,
      providerExecutionId: EXEC_B,
      cost: {
        amount: 0.35,
        currency: "USD",
        estimated: true,
        costSource: "CONFIGURED_ESTIMATE",
      },
    });
    const reconstructed = reconstructAiStoryProviderSpend([first, second]);
    expect(reconstructed.attempts.map((row) => row.attemptId)).toEqual([
      "attempt-1",
      "attempt-2",
    ]);
    expect(reconstructed.attempts[0]?.amount).toBe(0.35);
    expect(reconstructed.projection.storyKnownAmount).toBe(0.7);
  });

  it("CASE E/F: Scene cost sums attempts; Story cost sums scenes", () => {
    const reconstructed = reconstructAiStoryProviderSpend([
      record({
        attemptId: "a1",
        attemptNumber: 1,
        sceneExecutionId: SCENE_A,
        cost: {
          amount: 0.35,
          currency: "USD",
          estimated: true,
          costSource: "CONFIGURED_ESTIMATE",
        },
      }),
      record({
        attemptId: "a2",
        attemptNumber: 2,
        sceneExecutionId: SCENE_A,
        cost: {
          amount: 0.35,
          currency: "USD",
          estimated: true,
          costSource: "CONFIGURED_ESTIMATE",
        },
      }),
      record({
        attemptId: "b1",
        attemptNumber: 1,
        sceneExecutionId: SCENE_B,
        providerExecutionId: EXEC_B,
        cost: {
          amount: 0.4,
          currency: "USD",
          estimated: true,
          costSource: "CONFIGURED_ESTIMATE",
        },
      }),
    ]);
    const sceneA = reconstructed.projection.scenes.find(
      (row) => row.sceneExecutionId === SCENE_A
    );
    const sceneB = reconstructed.projection.scenes.find(
      (row) => row.sceneExecutionId === SCENE_B
    );
    expect(sceneA?.knownAmount).toBe(0.7);
    expect(sceneB?.knownAmount).toBe(0.4);
    expect(reconstructed.projection.storyKnownAmount).toBe(1.1);
  });
});

describe("EXEC-05 ops/commercial separation", () => {
  it("CASE G/H: ops/non-commercial settlement still tracks provider cost", () => {
    const settlementMode = "none" as const;
    const cost = mapWorkerCostMetadataToProviderCost(
      configuredEstimateForProvider("minimax")
    );
    expect(settlementMode).toBe("none");
    expect(cost.amount).toBe(0.4);
    expect(cost.costSource).toBe("CONFIGURED_ESTIMATE");
    expect(cost.amount).not.toBe(0);
  });

  it("CASE I: provider cost remains separate from customer credit charge", () => {
    const evidence = toAiStoryProviderAttemptCostEvidence(
      record({
        attemptId: "commercial-separate",
        attemptNumber: 1,
        sceneExecutionId: SCENE_A,
        cost: {
          amount: 0.35,
          currency: "USD",
          estimated: true,
          costSource: "CONFIGURED_ESTIMATE",
        },
      })
    );
    expect(evidence.authorityKind).toBe(PROVIDER_COST_AUTHORITY_KIND);
    expect(evidence.authorityKind).not.toBe(CUSTOMER_CREDIT_CHARGE_AUTHORITY_KIND);
    expect(PROVIDER_COST_AUTHORITY_KIND).not.toBe(CUSTOMER_CREDIT_CHARGE_AUTHORITY_KIND);
  });
});

describe("EXEC-05 identity, redaction, legacy", () => {
  it("CASE J: provider request id is not attempt identity", () => {
    expect(providerRequestIdIsAttemptIdentity()).toBe(false);
    const evidence = toAiStoryProviderAttemptCostEvidence(
      record({
        attemptId: "attempt-identity",
        attemptNumber: 1,
        sceneExecutionId: SCENE_A,
        providerRequestId: "req-123",
        cost: {
          amount: 0.35,
          currency: "USD",
          estimated: true,
          costSource: "CONFIGURED_ESTIMATE",
        },
      })
    );
    expect(evidence.attemptId).toBe("attempt-identity");
    expect(evidence.providerRequestId).toBe("req-123");
    expect(evidence.attemptId).not.toBe(evidence.providerRequestId);
  });

  it("CASE K: secrets are absent from persisted cost evidence", () => {
    expect(safeProviderRequestId("https://cdn.example/file?token=secret")).toBeNull();
    expect(safeProviderRequestId("Bearer abc")).toBeNull();
    const redacted = redactProviderCostEvidenceRecord({
      attemptId: "attempt-redact",
      apiKey: "sk-live",
      authorization: "Bearer abc",
      signedUrl: "https://x?sig=1",
      rawPayload: { prompt: "secret" },
      amount: 0.35,
    });
    expect(redacted.apiKey).toBeUndefined();
    expect(redacted.authorization).toBeUndefined();
    expect(redacted.signedUrl).toBeUndefined();
    expect(redacted.rawPayload).toBeUndefined();
    expect(redacted.amount).toBe(0.35);
  });

  it("CASE L: historical missing/unlabeled cost is LEGACY_UNKNOWN, not fabricated 0", () => {
    const missing = classifyPersistedProviderCost(null);
    expect(missing.costSource).toBe("LEGACY_UNKNOWN");
    expect(missing.amount).toBeNull();
    const unlabeled = classifyPersistedProviderCost({
      amount: 0.35,
      currency: "USD",
      estimated: true,
    });
    expect(unlabeled.costSource).toBe("LEGACY_UNKNOWN");
    const reconstructed = reconstructAiStoryProviderSpend([
      record({
        attemptId: "legacy-missing",
        attemptNumber: 1,
        sceneExecutionId: SCENE_A,
        cost: null,
      }),
    ]);
    expect(reconstructed.projection.storyKnownAmount).toBeNull();
    expect(reconstructed.projection.unknownAttemptCount).toBe(1);
    expect(reconstructed.attempts[0]?.amount).not.toBe(0);
    expect(reconstructed.attempts[0]?.costSource).toBe("LEGACY_UNKNOWN");
  });
});

describe("EXEC-05 canonical mapping does not invent zero", () => {
  it("omits amount rather than fabricating 0 when metadata has no amount", () => {
    const mapped = mapWorkerCostMetadataToProviderCost({
      currency: "USD",
      estimated: true,
    });
    expect(mapped.amount).toBeNull();
    expect(mapped.costSource).toBe("UNKNOWN");
  });
});
