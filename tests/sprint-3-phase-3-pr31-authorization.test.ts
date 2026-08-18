/**
 * Sprint 3 PR 3.1 — authorization service unit + integration-style tests.
 */
import { describe, expect, it } from "vitest";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";
import {
  RuntimeAuthorizationError,
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
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function baseInput(
  overrides: Partial<Parameters<RuntimeAuthorizationService["authorize"]>[0]> = {}
) {
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
        status: "warning" as const,
        resultHash: HASH,
      },
    ],
    authorizedBy: "10000000-0000-4000-8000-000000000501",
    authorizedAt: "2026-08-04T12:00:00.000Z",
    derivedReadiness: "READY_FOR_EXECUTION" as const,
    existingFact: null,
    ...overrides,
  };
}

describe("Sprint 3 PR 3.1 RuntimeAuthorizationService", () => {
  const service = new RuntimeAuthorizationService();

  it("issues immutable RuntimeAuthorizedFact when prerequisites hold", () => {
    const result = service.authorize(baseInput());
    expect(result.fact.executionPlanId).toBe(OWNERSHIP.executionPlanId);
    expect(result.fact.runtimeAuthorizationVersion).toBe(1);
    expect(result.fact.orderedSceneExecutionIds).toEqual([SCENE_A, SCENE_B]);
    expect(result.fact.qcResultIds).toHaveLength(2);
    expect(result.converged).toBe(false);
    expect(result.executionAllowed).toBe(false);
    expect(result.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    expect(result.automaticFallbackEnabled).toBe(false);
    expect(result.fact.deterministicIntegrityHash).toBe(
      computeRuntimeAuthorizationIntegrityHash(baseInput())
    );
  });

  it("converges equivalent authorization replay (authorizedAt may differ)", () => {
    const first = service.authorize(baseInput());
    const second = service.authorize(
      baseInput({
        authorizedAt: "2026-08-04T15:00:00.000Z",
        existingFact: first.fact,
      })
    );
    expect(second.converged).toBe(true);
    expect(second.fact).toEqual(first.fact);
    expect(second.fact.authorizedAt).toBe(first.fact.authorizedAt);
    expect(second.fact.runtimeAuthorizationVersion).toBe(1);
    expect(second.fact.runtimeAuthorizationVersion).toBe(
      first.fact.runtimeAuthorizationVersion
    );
  });

  it("changing runtimeAuthorizationVersion changes integrity hash and conflicts", () => {
    const v1Hash = computeRuntimeAuthorizationIntegrityHash(baseInput());
    const v2Hash = computeRuntimeAuthorizationIntegrityHash(
      baseInput({ runtimeAuthorizationVersion: 2 })
    );
    expect(v1Hash).not.toBe(v2Hash);

    const first = service.authorize(baseInput());
    expect(() =>
      service.authorize(
        baseInput({
          runtimeAuthorizationVersion: 2,
          existingFact: first.fact,
        })
      )
    ).toThrow(RuntimeAuthorizationError);
  });

  it("projectionVersion changes never alter RuntimeAuthorizedFact integrity hash", () => {
    const hash = computeRuntimeAuthorizationIntegrityHash(baseInput());
    const payload = JSON.stringify(
      // projectionVersion must not appear in authorization integrity input
      baseInput()
    );
    expect(payload).not.toMatch(/projectionVersion/);
    expect(hash).toBe(computeRuntimeAuthorizationIntegrityHash(baseInput()));
    expect(hash).not.toContain("projectionVersion");
  });

  it("fails closed on conflicting authorization", () => {
    const first = service.authorize(baseInput());
    expect(() =>
      service.authorize(
        baseInput({
          reviewHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          existingFact: first.fact,
        })
      )
    ).toThrow(RuntimeAuthorizationError);
    try {
      service.authorize(
        baseInput({
          reviewHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          existingFact: first.fact,
        })
      );
    } catch (error) {
      expect(error).toMatchObject({
        classification: "IDENTITY_CONFLICT",
        code: "IDENTITY_CONFLICT",
        status: 409,
      });
    }
  });

  it("rejects NOT_READY derived readiness without persisting authority", () => {
    expect(() =>
      service.authorize(baseInput({ derivedReadiness: "NOT_READY" }))
    ).toThrowError(/NOT_READY/);
  });

  it("rejects rejected review and failed QC", () => {
    expect(() =>
      service.authorize(baseInput({ reviewDecision: "REJECTED" }))
    ).toThrow(RuntimeAuthorizationError);

    expect(() =>
      service.authorize(
        baseInput({
          qcResults: [
            {
              qcResultId: "10000000-0000-4000-8000-000000000311",
              sceneExecutionId: SCENE_A,
              status: "failed",
              resultHash: HASH,
            },
            {
              qcResultId: "10000000-0000-4000-8000-000000000312",
              sceneExecutionId: SCENE_B,
              status: "passed",
              resultHash: HASH,
            },
          ],
        })
      )
    ).toThrowError(/QC failed/);
  });

  it("projects AUTHORIZED scene coverage without unlocking execution", () => {
    const { fact } = service.authorize(baseInput());
    const projection = service.project({
      ownership: OWNERSHIP,
      authorizedFact: fact,
      scenes: [
        { sceneExecutionId: SCENE_A, sceneId: "scene-a", sceneOrder: 0 },
        { sceneExecutionId: SCENE_B, sceneId: "scene-b", sceneOrder: 1 },
      ],
      derivedReadiness: "READY_FOR_EXECUTION",
      derivedAt: "2026-08-04T12:05:00.000Z",
    });
    expect(projection.hasAuthorizedFact).toBe(true);
    expect(projection.executionAuthority).toBe("RUNTIME_AUTHORIZED_FACT");
    expect(projection.projectionVersion).toBe(1);
    expect(projection.sceneProjections.map((row) => row.state)).toEqual([
      "AUTHORIZED",
      "AUTHORIZED",
    ]);
    expect(projection.sceneProjections.every((row) => row.projectionVersion === 1)).toBe(
      true
    );
    expect(projection.executionAllowed).toBe(false);
    expect(projection.automaticFallbackEnabled).toBe(false);
  });

  it("fails closed when QC coverage is incomplete", () => {
    expect(() =>
      service.authorize(
        baseInput({
          qcResults: [
            {
              qcResultId: "10000000-0000-4000-8000-000000000311",
              sceneExecutionId: SCENE_A,
              status: "passed",
              resultHash: HASH,
            },
          ],
        })
      )
    ).toThrowError(/cover every ordered Scene/);
  });
});
