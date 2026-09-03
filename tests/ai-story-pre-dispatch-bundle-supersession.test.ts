import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AiStoryPreDispatchBundleSupersessionError,
  assertPreDispatchSupersessionEligibility,
} from "../packages/db/src/queries/ai-story-pre-dispatch-bundle-supersession";
import { SupersedeAiStoryPreDispatchBundleService } from "../packages/agents/src/ai-story/pre-dispatch-bundle-supersession";

const eligible = {
  providerExecutionStatus: "PENDING",
  outboxStatus: "PENDING",
  providerAttemptCount: 0,
  providerAttemptBindingCount: 0,
  workerResultCount: 0,
  sceneResultCount: 0,
  commercialReservationCount: 0,
};

describe("AI Story append-only pre-dispatch bundle supersession", () => {
  it("permits only a zero-paid-side-effect pre-dispatch state", () => {
    expect(() => assertPreDispatchSupersessionEligibility(eligible)).not.toThrow();
    for (const invalid of [
      { providerAttemptCount: 1 },
      { providerAttemptBindingCount: 1 },
      { workerResultCount: 1 },
      { sceneResultCount: 1 },
      { commercialReservationCount: 1 },
      { acceptedAttemptId: "attempt-1" },
      { acceptedResult: { resultReference: "media" } },
      { outboxCompletedAt: new Date() },
      { outboxDeadLetterAt: new Date() },
      { dispatchStatus: "CANCELLED" },
      { providerExecutionStatus: "SUCCEEDED" },
      { outboxStatus: "COMPLETED" },
    ]) {
      expect(() => assertPreDispatchSupersessionEligibility({ ...eligible, ...invalid }))
        .toThrow(AiStoryPreDispatchBundleSupersessionError);
    }
  });

  it("exposes one command boundary and delegates one atomic repository operation", async () => {
    const result = { supersessionId: crypto.randomUUID() };
    const supersede = vi.fn().mockResolvedValue(result);
    const service = new SupersedeAiStoryPreDispatchBundleService({ supersede });
    const command = { idempotencyKey: "same-source-contract" } as never;
    await expect(service.execute(command)).resolves.toBe(result);
    expect(supersede).toHaveBeenCalledOnce();
    expect(supersede).toHaveBeenCalledWith(command);
  });

  it("persists append-only source-to-successor authority with single-successor constraints", () => {
    const migration = readFileSync(
      "packages/db/sql/ai-story-pre-dispatch-bundle-supersession-v1.sql",
      "utf8"
    );
    expect(migration).toContain("source_compiled_request_id");
    expect(migration).toContain("successor_compiled_request_id");
    expect(migration).toContain("source_dispatch_unique");
    expect(migration).toContain("successor_dispatch_unique");
    expect(migration).toContain("REVIEW_RETRY_CREATIVE_INSTRUCTION_PRECEDENCE_DEFECT");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
  });

  it("scopes paid/result eligibility to the candidate bundle rather than prior Scene history", () => {
    const repository = readFileSync(
      "packages/db/src/queries/ai-story-pre-dispatch-bundle-supersession.ts",
      "utf8"
    );
    expect(repository).toContain("result_attempt.execution_id=correlation.provider_execution_id");
    expect(repository).not.toContain("correlation.scene_execution_id::text,\n                   compiled.compiled_request_id::text");
  });

  it("excludes superseded jobs from every Worker selection and recovery path", () => {
    const dispatch = readFileSync("packages/db/src/queries/provider-execution-dispatch.ts", "utf8");
    const outbox = readFileSync("packages/db/src/queries/provider-outbox.ts", "utf8");
    const recovery = readFileSync("packages/db/src/queries/ai-story-pre-dispatch-recovery.ts", "utf8");
    expect(dispatch.match(/ai_story_pre_dispatch_bundle_supersessions/g)?.length).toBeGreaterThanOrEqual(4);
    expect(outbox).toContain("ai_story_pre_dispatch_bundle_supersessions");
    expect(recovery.match(/ai_story_pre_dispatch_bundle_supersessions/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("creates successor rows and supersession authority in one transaction", () => {
    const repository = readFileSync(
      "packages/db/src/queries/ai-story-pre-dispatch-bundle-supersession.ts",
      "utf8"
    );
    expect(repository).toContain("return this.db.transaction");
    expect(repository.indexOf("await acceptAiStoryCompiledRequest"))
      .toBeLessThan(repository.indexOf("insert into ai_story_pre_dispatch_bundle_supersessions"));
    expect(repository).toContain("pg_advisory_xact_lock");
    expect(repository).toContain("test failure after");
    expect(repository).not.toContain("insert into provider_attempts");
    expect(repository).not.toContain("insert into certification_commercial_reservations");
  });
});
