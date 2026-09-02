import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  PostTerminalProviderRetryAuthorizationFactSchema,
  type PostTerminalProviderRetryAuthorizationFact,
} from "@ceo-agent/shared";
import { PostTerminalProviderRetryService } from "../packages/agents/src/ai-story/post-terminal-provider-retry-service";

const ids = {
  authorizationId: "10000000-0000-4000-8000-000000000001",
  orgId: "10000000-0000-4000-8000-000000000002",
  workspaceId: "10000000-0000-4000-8000-000000000003",
  campaignId: "10000000-0000-4000-8000-000000000004",
  storyId: "10000000-0000-4000-8000-000000000005",
  executionPlanId: "10000000-0000-4000-8000-000000000006",
  sceneExecutionId: "10000000-0000-4000-8000-000000000007",
  compiledRequestId: "10000000-0000-4000-8000-000000000008",
  workerResultId: "10000000-0000-4000-8000-000000000009",
  reservationId: "10000000-0000-4000-8000-000000000010",
  commercialAuthorizationId: "10000000-0000-4000-8000-000000000011",
  actorUserId: "10000000-0000-4000-8000-000000000012",
};

function authority(): PostTerminalProviderRetryAuthorizationFact {
  return PostTerminalProviderRetryAuthorizationFactSchema.parse({
    authorizationId: ids.authorizationId,
    environment: "STAGING",
    orgId: ids.orgId,
    workspaceId: ids.workspaceId,
    campaignId: ids.campaignId,
    storyId: ids.storyId,
    executionPlanId: ids.executionPlanId,
    sceneExecutionId: ids.sceneExecutionId,
    sourceCompiledRequestId: ids.compiledRequestId,
    sourceCompiledRequestFingerprint: `sha256:${"1".repeat(64)}`,
    priorProviderAttemptId: "attempt-terminal-1",
    priorWorkerResultId: ids.workerResultId,
    priorReservationId: ids.reservationId,
    failureClassification:
      "STAGING_SEEDANCE_FIRST_FRAME_I2V_MIXED_REFERENCE_ROLE_WIRE_CONTRACT_MISMATCH",
    failureCode: "PROVIDER_NOT_ACCEPTED",
    retryReason: "CORRECTED_PROVIDER_REQUEST_CONTRACT",
    humanDecision: "AUTHORIZE_ONE_RETRY",
    authorizedBy: ids.actorUserId,
    authorizedAt: "2026-09-02T00:00:00.000Z",
    retryGeneration: 3,
    targetCompilerContractVersion: "seedance-first-frame-i2v-wire.v1",
    targetMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
    commercialAuthorizationId: ids.commercialAuthorizationId,
    idempotencyKey: `sha256:${"2".repeat(64)}`,
    integrityHash: `sha256:${"3".repeat(64)}`,
    contractVersion: "ai-story-post-terminal-provider-retry.v1",
  });
}

describe("AI Story post-terminal Provider retry authority", () => {
  it("requires exact human authority and schedules the same logical Scene as one locked retry generation", async () => {
    const fact = authority();
    const bundle = {
      outboxJobId: "outbox:retry-1",
      providerExecutionId: "execution:retry-1",
      envelopeId: "envelope:retry-1",
      payloadReference: "db://retry-1",
      requestHash: `sha256:${"4".repeat(64)}`,
      envelopeHash: `sha256:${"5".repeat(64)}`,
      correlation: {
        correlationId: ids.authorizationId,
        ownership: { orgId: ids.orgId, workspaceId: ids.workspaceId },
        scheduledAt: "2026-09-02T00:00:00.000Z",
      },
      routingDecision: {
        capabilityId: "animation-video-generation",
        capabilityVersion: "1.0.0",
      },
    } as never;
    const scheduleAuthorizedScene = vi.fn(async () => bundle);
    const createDispatch = vi.fn(async (dispatch) => dispatch);
    const service = new PostTerminalProviderRetryService({
      repository: {
        authorize: vi.fn(async () => fact),
        getById: vi.fn(async () => fact),
      },
      schedulingCoordinator: { scheduleAuthorizedScene },
      dispatchRepository: { createDispatch },
    });
    await service.createRetryAuthority({
      authorizationId: fact.authorizationId,
      executionPlanId: fact.executionPlanId,
      sceneExecutionId: fact.sceneExecutionId,
      workspaceId: fact.workspaceId,
      actorUserId: fact.authorizedBy,
      runtimeAuthorizationId: "10000000-0000-4000-8000-000000000013",
    });
    expect(scheduleAuthorizedScene).toHaveBeenCalledOnce();
    expect(scheduleAuthorizedScene).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneExecutionId: fact.sceneExecutionId,
        retryGeneration: 3,
        commercialAuthorizationId: fact.commercialAuthorizationId,
        postTerminalRetryAuthorization: fact,
      })
    );
    expect(createDispatch).toHaveBeenCalledOnce();
  });

  it("fails closed when human authority is missing or belongs to another actor", async () => {
    const fact = authority();
    const scheduleAuthorizedScene = vi.fn();
    const service = new PostTerminalProviderRetryService({
      repository: {
        authorize: vi.fn(),
        getById: vi.fn(async () => fact),
      },
      schedulingCoordinator: { scheduleAuthorizedScene },
      dispatchRepository: { createDispatch: vi.fn() },
    });
    await expect(
      service.createRetryAuthority({
        authorizationId: fact.authorizationId,
        executionPlanId: fact.executionPlanId,
        sceneExecutionId: fact.sceneExecutionId,
        workspaceId: fact.workspaceId,
        actorUserId: "20000000-0000-4000-8000-000000000012",
        runtimeAuthorizationId: "10000000-0000-4000-8000-000000000013",
      })
    ).rejects.toMatchObject({
      code: "POST_TERMINAL_RETRY_AUTHORIZATION_REQUIRED",
    });
    expect(scheduleAuthorizedScene).not.toHaveBeenCalled();
  });

  it("defines immutable one-successor persistence and no commercial or Provider side effects", () => {
    const migration = readFileSync(
      "packages/db/sql/ai-story-post-terminal-provider-retry-v1.sql",
      "utf8"
    );
    expect(migration).toContain(
      "ai_story_post_terminal_retry_source_contract_unique"
    );
    expect(migration).toContain(
      "ai_story_scene_scheduling_post_terminal_retry_unique"
    );
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("AUTHORIZE_ONE_RETRY");
    expect(migration).not.toMatch(/insert\s+into\s+certification_commercial_reservations/i);
    expect(migration).not.toMatch(/insert\s+into\s+provider_attempts/i);
  });

  it("keeps post-terminal retry separate from review retry and pre-dispatch supersession", () => {
    const repository = readFileSync(
      "packages/db/src/queries/ai-story-post-terminal-provider-retry.ts",
      "utf8"
    );
    expect(repository).toContain("POST_TERMINAL_RETRY_REVIEW_PATH_REQUIRED");
    expect(repository).toContain("aiStoryWorkerExecutionResults");
    expect(repository).toContain("NOT_ACCEPTED");
    expect(repository).not.toContain("SupersedeAiStoryPreDispatchBundleService");
    expect(repository).not.toContain("markAuthorizationConsumed");
    const selector = readFileSync(
      "packages/db/src/queries/provider-execution-dispatch.ts",
      "utf8"
    );
    expect(selector).toContain("previewAuthorizedPostTerminalRetryDispatch");
    expect(selector).toContain("claimAuthorizedPostTerminalRetryDispatch");
    expect(selector).toContain("source_result.worker_state='NOT_ACCEPTED'");
    const worker = readFileSync(
      "apps/worker/src/ai-story-provider-worker-cycle.ts",
      "utf8"
    );
    expect(worker).toContain("claimAuthorizedPostTerminalRetryDispatch");
    expect(worker.indexOf("claimAuthorizedPostTerminalRetryDispatch")).toBeLessThan(
      worker.indexOf("claimAuthorizedSupersessionSuccessorDispatch")
    );
  });

  it("derives the retry compilation clock from immutable human authorization", () => {
    const coordinator = readFileSync(
      "packages/agents/src/ai-story/scene-scheduling-coordinator.ts",
      "utf8"
    );
    expect(coordinator).toContain(
      "input.postTerminalRetryAuthorization?.authorizedAt ??"
    );
    expect(coordinator).toContain("acceptedRoutingDecision.decidedAt");
  });
});
