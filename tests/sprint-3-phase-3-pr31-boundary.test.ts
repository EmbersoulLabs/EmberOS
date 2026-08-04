/**
 * Sprint 3 PR 3.1 — identity / immutability / lock / boundary regressions.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PHASE1_EXECUTION_LOCKED,
  assertPhase1ExecutionLocked,
  Phase1ExecutionLockedError,
  RuntimeAuthorizedFactSchema,
  SCENE_RUNTIME_STATES,
} from "@ceo-agent/shared";
import { enqueueStoryExecution } from "../packages/queue/src/index";
import {
  runExecutionJob,
  startExecutionJob,
} from "../packages/agents/src/ai-story/story-execution-orchestrator";
import {
  RuntimeAuthorizationService,
  computeRuntimeAuthorizationIntegrityHash,
} from "../packages/agents/src/ai-story/runtime-authorization-service";

const OWNERSHIP = {
  orgId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  campaignId: "10000000-0000-4000-8000-000000000003",
  storyId: "10000000-0000-4000-8000-000000000004",
  storyVersionId: "10000000-0000-4000-8000-000000000005",
  animationPackageId: "10000000-0000-4000-8000-000000000006",
  executionPlanId: "10000000-0000-4000-8000-000000000101",
} as const;

const SCENE_A = "10000000-0000-4000-8000-000000000201";
const SCENE_B = "10000000-0000-4000-8000-000000000202";
const HASH =
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

function input() {
  return {
    ownership: OWNERSHIP,
    reviewDecisionId: "10000000-0000-4000-8000-000000000301",
    reviewHash: HASH,
    reviewDecision: "APPROVED" as const,
    assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
    assemblyHash: HASH,
    orderedSceneExecutionIds: [SCENE_A, SCENE_B],
    qcResults: [
      {
        qcResultId: "10000000-0000-4000-8000-000000000311",
        sceneExecutionId: SCENE_A,
        status: "passed" as const,
        resultHash: HASH,
      },
      {
        qcResultId: "10000000-0000-4000-8000-000000000312",
        sceneExecutionId: SCENE_B,
        status: "passed" as const,
        resultHash: HASH,
      },
    ],
    authorizedBy: "10000000-0000-4000-8000-000000000501",
    authorizedAt: "2026-08-04T12:00:00.000Z",
    derivedReadiness: "READY_FOR_EXECUTION" as const,
    existingFact: null as const,
  };
}

describe("Sprint 3 PR 3.1 boundary + identity", () => {
  it("keeps Phase 1 execution lock fail-closed after PR 3.1", async () => {
    expect(() => assertPhase1ExecutionLocked()).toThrow(Phase1ExecutionLockedError);
    await expect(Promise.resolve().then(() => startExecutionJob({} as never))).rejects.toMatchObject({
      code: PHASE1_EXECUTION_LOCKED,
    });
    await expect(Promise.resolve().then(() => runExecutionJob("job"))).rejects.toMatchObject({
      code: PHASE1_EXECUTION_LOCKED,
    });
    await expect(
      Promise.resolve().then(() => enqueueStoryExecution({} as never))
    ).rejects.toMatchObject({ code: PHASE1_EXECUTION_LOCKED });
  });

  it("authorization issuance still reports execution impossible", () => {
    const service = new RuntimeAuthorizationService();
    const result = service.authorize(input());
    expect(result.executionAllowed).toBe(false);
    expect(result.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    expect(result.automaticFallbackEnabled).toBe(false);
  });

  it("RuntimeAuthorizedFact identity is deterministic and immutable on equivalent input", () => {
    const service = new RuntimeAuthorizationService();
    const a = service.authorize(input());
    const b = service.authorize(input());
    expect(a.fact.runtimeAuthorizationId).toBe(b.fact.runtimeAuthorizationId);
    expect(a.fact.runtimeAuthorizationVersion).toBe(1);
    expect(a.fact.deterministicIntegrityHash).toBe(b.fact.deterministicIntegrityHash);
    expect(a.fact.deterministicIntegrityHash).toBe(
      computeRuntimeAuthorizationIntegrityHash(input())
    );
    expect(() =>
      RuntimeAuthorizedFactSchema.parse({
        ...a.fact,
        authorizationContractVersion: "2",
      })
    ).toThrow();
  });

  it("contracts and service sources never import forbidden runtime modules", () => {
    const contracts = readFileSync(
      resolve("packages/shared/src/ai-story-runtime-contracts.ts"),
      "utf8"
    );
    expect(contracts).toContain("RuntimeAuthorizedFact");
    expect(contracts).toContain("READY_FOR_EXECUTION remains DERIVED ONLY");
    expect(contracts).toContain("automaticFallbackEnabled");
    expect(contracts).toMatch(/CANCELLED is intentionally absent/);
    expect(contracts).not.toMatch(/"CANCELLED"/);
    expect(contracts).not.toMatch(/provider-outbox|ProviderRouter|seedance|minimax/i);
    expect(contracts).not.toMatch(/from ["']@ceo-agent\/queue["']/);
    expect(SCENE_RUNTIME_STATES).not.toContain("CANCELLED");

    const service = readFileSync(
      resolve("packages/agents/src/ai-story/runtime-authorization-service.ts"),
      "utf8"
    );
    expect(service).toContain("RuntimeAuthorizationService");
    expect(service).toContain("PHASE1_EXECUTION_LOCKED");
    expect(service).not.toMatch(/from ["']@ceo-agent\/queue["']/);
    expect(service).not.toMatch(/provider-outbox|ProviderRouter|seedance|minimax/i);
    expect(service).not.toMatch(/enqueueStoryExecution|startExecutionJob|runExecutionJob/);
    expect(service).not.toMatch(/billing|Usage|Cost|releaseLease|finalize/i);
  });

  it("PR 3.1 does not introduce Provider Runtime, Queue, Worker, or SQL migrations", () => {
    const sharedIndex = readFileSync(resolve("packages/shared/src/index.ts"), "utf8");
    expect(sharedIndex).toContain('ai-story-runtime-contracts');

    const agentsIndex = readFileSync(
      resolve("packages/agents/src/ai-story/index.ts"),
      "utf8"
    );
    expect(agentsIndex).toContain("runtime-authorization-service");

    // No new provider/SQL surface for this PR.
    expect(() =>
      readFileSync(resolve("packages/db/sql/ai-story-runtime-authorization-v1.sql"), "utf8")
    ).toThrow();
  });
});
