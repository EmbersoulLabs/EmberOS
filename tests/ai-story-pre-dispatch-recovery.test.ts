import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PreDispatchRecoveryService } from "../packages/agents/src/ai-story/pre-dispatch-recovery";
import {
  PreDispatchRecoveryRepositoryError,
  assertRecoverablePreDispatchState,
  normalizeTimestampToIso,
} from "../packages/db/src/queries/ai-story-pre-dispatch-recovery";

const input = {
  executionPlanId: "a98ac267-71a5-51aa-a276-de3c4b36b387",
  sceneExecutionId: "20dd4ca9-4920-5fa2-8487-4981bf16976f",
  orgId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  actorUserId: "33333333-3333-4333-8333-333333333333",
  idempotencyKey: "recovery-key",
  reason: "human authorized",
};

describe("AI Story pre-dispatch recovery service", () => {
  const recoverable = {
    releaseState: "RELEASED",
    providerExecutionStatus: "PENDING",
    outboxStatus: "PENDING",
    workerState: "NOT_ACCEPTED",
    providerRequestId: null,
    providerAttemptCount: 0,
    resultCount: 0,
    generatedReviewCount: 0,
  };

  it("defines a fail-closed recoverable-state matrix", () => {
    expect(() => assertRecoverablePreDispatchState(recoverable)).not.toThrow();
    for (const invalid of [
      { providerAttemptCount: 1 },
      { resultCount: 1 },
      { generatedReviewCount: 1 },
      { releaseState: "AUTHORIZED_NOT_RELEASED" },
      { providerExecutionStatus: "COMPLETED" },
      { outboxStatus: "COMPLETED" },
      { workerState: "SUCCEEDED" },
      { providerRequestId: "provider-request" },
    ]) {
      expect(() => assertRecoverablePreDispatchState({ ...recoverable, ...invalid }))
        .toThrow("recoverable-state contract");
    }
  });

  it("revalidates grounding before invoking the atomic recovery port", async () => {
    const recover = vi.fn().mockResolvedValue({ status: "RECOVERY_AUTHORIZED" });
    const certifyGrounding = vi.fn().mockResolvedValue({
      visualAuthorityCertified: true,
      productAuthorityResolved: true,
      providerMode: "FIRST_FRAME_I2V",
      firstFramePresent: true,
      directorSafe: true,
      preDispatchGate: "PASS",
    });
    const service = new PreDispatchRecoveryService({
      repository: { recover },
      certifyGrounding,
    });

    await expect(service.recover(input)).resolves.toEqual({
      status: "RECOVERY_AUTHORIZED",
    });
    expect(certifyGrounding.mock.invocationCallOrder[0]).toBeLessThan(
      recover.mock.invocationCallOrder[0]!
    );
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("fails closed without rearming when certification is incomplete", async () => {
    const recover = vi.fn();
    const service = new PreDispatchRecoveryService({
      repository: { recover },
      certifyGrounding: vi.fn().mockResolvedValue({
        visualAuthorityCertified: false,
        productAuthorityResolved: true,
        providerMode: "FIRST_FRAME_I2V",
        firstFramePresent: true,
        directorSafe: true,
        preDispatchGate: "PASS",
      } as never),
    });
    await expect(service.recover(input)).rejects.toThrow(
      "Pre-dispatch grounding revalidation failed closed"
    );
    expect(recover).not.toHaveBeenCalled();
  });

  it("exposes only an authenticated operator route and never reuses release semantics", () => {
    const route = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/scenes/[sceneExecutionId]/recover-pre-dispatch/route.ts",
      "utf8"
    );
    expect(route).toContain("requireAuth()");
    expect(route).toContain('minRole: "operator"');
    expect(route).toContain("authorizeAiStoryExecution");
    expect(route).not.toContain("releaseNextEligibleScene");
    expect(route).not.toContain("release-next-scene");
  });

  it("gives the Worker a dedicated existing-dispatch claim path", () => {
    const worker = readFileSync(
      "apps/worker/src/ai-story-provider-worker-cycle.ts",
      "utf8"
    );
    expect(worker).toContain("claimAuthorizedRecoveryDispatch");
    expect(worker).toContain("dispatchNextProviderExecution");
  });

  it("normalizes Date and production postgres-js timestamp hydration", () => {
    expect(normalizeTimestampToIso(new Date("2026-08-25T03:00:00.123Z"))).toBe(
      "2026-08-25T03:00:00.123Z"
    );
    expect(normalizeTimestampToIso("2026-08-25 03:00:00.123+00")).toBe(
      "2026-08-25T03:00:00.123Z"
    );
    expect(normalizeTimestampToIso("2026-08-25 11:00:00.123+08")).toBe(
      "2026-08-25T03:00:00.123Z"
    );
    expect(normalizeTimestampToIso("2026-08-25T03:00:00.123Z")).toBe(
      "2026-08-25T03:00:00.123Z"
    );
  });

  it.each([null, undefined, "", "not-a-timestamp", "2026-08-25 03:00:00.123", {}])(
    "fails closed for invalid or timezone-ambiguous timestamp input %#",
    (value) => {
      try {
        normalizeTimestampToIso(value);
        throw new Error("expected timestamp normalization to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(PreDispatchRecoveryRepositoryError);
        expect((error as PreDispatchRecoveryRepositoryError).code).toBe(
          "RECOVERY_INVALID_TIMESTAMP"
        );
      }
    }
  );
});
