import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AI Story supersession successor Worker claim authority", () => {
  const repository = readFileSync(
    "packages/db/src/queries/provider-execution-dispatch.ts",
    "utf8"
  );
  const worker = readFileSync(
    "apps/worker/src/ai-story-provider-worker-cycle.ts",
    "utf8"
  );
  const previewScript = readFileSync(
    "apps/worker/scripts/preview-ai-story-pre-dispatch-recovery.ts",
    "utf8"
  );

  it("models the active successor as a first-class existing-Dispatch lifecycle", () => {
    expect(repository).toContain("ACTIVE_SUPERSESSION_SUCCESSOR");
    expect(repository).toContain("previewAuthorizedSupersessionSuccessorDispatch");
    expect(repository).toContain("claimAuthorizedSupersessionSuccessorDispatch");
    expect(repository).toContain("supersession.successor_dispatch_id");
    expect(repository).not.toContain("ai-story-pre-dispatch-recovery:${supersession");
  });

  it("keeps the preview non-consuming and validates immutable integrity", () => {
    const preview = repository.slice(
      repository.indexOf("async previewAuthorizedSupersessionSuccessorDispatch"),
      repository.indexOf("async selectEligibleJob")
    );
    expect(preview).not.toContain("for update");
    expect(preview).not.toContain("update provider_outbox_jobs");
    expect(preview).toContain("toSupersessionSuccessorCandidate");
    expect(repository).toContain("assertSupersessionSuccessorIntegrity(row)");
    expect(repository).toContain("canonicalPersistenceHash(authorityBody)");
  });

  it("excludes superseded sources and all paid-side-effect states", () => {
    expect(repository).toContain("later.source_dispatch_id = supersession.successor_dispatch_id");
    expect(repository).toContain("provider_attempts attempt");
    expect(repository).toContain("certification_commercial_reservations reservation");
    expect(repository).toContain("execution.accepted_attempt_id is null");
    expect(repository).toContain("execution.accepted_result is null");
    expect(repository).toContain("ai_story_worker_execution_results result");
    expect(repository).toContain("ai_story_scene_results result");
  });

  it("enforces no-dispatch before successor, recovery, or ordinary claim", () => {
    const hold = worker.indexOf("if (isAiStoryProviderDispatchHeld())");
    const successor = worker.indexOf(".claimAuthorizedSupersessionSuccessorDispatch");
    const recovery = worker.indexOf(".claimAuthorizedRecoveryDispatch");
    const ordinary = worker.indexOf("dispatchNextProviderExecution", hold);
    expect(hold).toBeGreaterThan(-1);
    expect(successor).toBeGreaterThan(hold);
    expect(recovery).toBeGreaterThan(successor);
    expect(ordinary).toBeGreaterThan(recovery);
  });

  it("uses the existing outbox lease and never creates a replacement Dispatch", () => {
    const claim = repository.slice(
      repository.indexOf("async claimAuthorizedSupersessionSuccessorDispatch"),
      repository.indexOf("async createDispatch")
    );
    expect(claim).toContain("for update of job skip locked");
    expect(claim).toContain("set status = 'CLAIMED'");
    expect(claim).not.toContain("insert into provider_execution_dispatches");
    expect(claim).not.toContain("admin_runtime_recovery_receipts");
  });

  it("exposes a non-consuming live certification preview", () => {
    expect(previewScript).toContain("previewAuthorizedSupersessionSuccessorDispatch");
    expect(previewScript).toContain("lifecycleClass");
    expect(previewScript).toContain("candidateCount");
    expect(previewScript).toContain("claimed: false");
  });
});
