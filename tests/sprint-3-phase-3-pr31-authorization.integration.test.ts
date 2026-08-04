/**
 * Sprint 3 PR 3.1 — integration-style authorization + projection flow.
 * No DB / Outbox / Worker — contracts + service only.
 */
import { describe, expect, it } from "vitest";
import {
  PHASE1_EXECUTION_LOCKED,
  RuntimeAuthorizedFactSchema,
  projectRuntimeAuthorization,
  RUNTIME_AUTHORIZATION_VERSION,
  RUNTIME_PROJECTION_VERSION,
} from "@ceo-agent/shared";
import {
  RuntimeAuthorizationError,
  RuntimeAuthorizationService,
  buildRuntimeAuthorizationIntegrityPayload,
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

const SCENES = [
  {
    sceneExecutionId: "10000000-0000-4000-8000-000000000201",
    sceneId: "scene-a",
    sceneOrder: 0,
  },
  {
    sceneExecutionId: "10000000-0000-4000-8000-000000000202",
    sceneId: "scene-b",
    sceneOrder: 1,
  },
] as const;

const HASH =
  "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

describe("Sprint 3 PR 3.1 authorization integration", () => {
  it("end-to-end: authorize → project AUTHORIZED → still locked / no fallback", () => {
    const service = new RuntimeAuthorizationService();
    const issued = service.authorize({
      ownership: OWNERSHIP,
      reviewDecisionId: "10000000-0000-4000-8000-000000000301",
      reviewHash: HASH,
      reviewDecision: "APPROVED",
      assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
      assemblyHash: HASH,
      orderedSceneExecutionIds: SCENES.map((scene) => scene.sceneExecutionId),
      qcResults: SCENES.map((scene, index) => ({
        qcResultId: `10000000-0000-4000-8000-00000000031${index}`,
        sceneExecutionId: scene.sceneExecutionId,
        status: "passed" as const,
        resultHash: HASH,
      })),
      authorizedBy: "10000000-0000-4000-8000-000000000501",
      authorizedAt: "2026-08-04T12:00:00.000Z",
      derivedReadiness: "READY_FOR_EXECUTION",
    });

    const fact = RuntimeAuthorizedFactSchema.parse(issued.fact);
    expect(fact.runtimeAuthorizationVersion).toBe(RUNTIME_AUTHORIZATION_VERSION);
    const projection = projectRuntimeAuthorization({
      ownership: OWNERSHIP,
      authorizedFact: fact,
      scenes: SCENES,
      derivedReadiness: "READY_FOR_EXECUTION",
      derivedAt: "2026-08-04T12:01:00.000Z",
    });

    expect(projection.projectionVersion).toBe(RUNTIME_PROJECTION_VERSION);
    expect(projection.hasAuthorizedFact).toBe(true);
    expect(projection.executionAuthority).toBe("RUNTIME_AUTHORIZED_FACT");
    expect(projection.derivedReadiness).toBe("READY_FOR_EXECUTION");
    expect(projection.executionAllowed).toBe(false);
    expect(projection.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    expect(projection.automaticFallbackEnabled).toBe(false);
    expect(projection.sceneProjections.every((row) => row.state === "AUTHORIZED")).toBe(
      true
    );
    expect(
      projection.sceneProjections.every(
        (row) => row.projectionVersion === RUNTIME_PROJECTION_VERSION
      )
    ).toBe(true);

    const replay = service.authorize({
      ownership: OWNERSHIP,
      reviewDecisionId: "10000000-0000-4000-8000-000000000301",
      reviewHash: HASH,
      reviewDecision: "APPROVED",
      assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
      assemblyHash: HASH,
      orderedSceneExecutionIds: SCENES.map((scene) => scene.sceneExecutionId),
      qcResults: SCENES.map((scene, index) => ({
        qcResultId: `10000000-0000-4000-8000-00000000031${index}`,
        sceneExecutionId: scene.sceneExecutionId,
        status: "passed" as const,
        resultHash: HASH,
      })),
      authorizedBy: "10000000-0000-4000-8000-000000000501",
      authorizedAt: "2026-08-04T18:00:00.000Z",
      derivedReadiness: "READY_FOR_EXECUTION",
      existingFact: fact,
    });
    expect(replay.converged).toBe(true);
    expect(replay.fact).toEqual(fact);
    expect(replay.fact.runtimeAuthorizationVersion).toBe(1);

    const integrityPayload = buildRuntimeAuthorizationIntegrityPayload({
      ownership: OWNERSHIP,
      reviewDecisionId: "10000000-0000-4000-8000-000000000301",
      reviewHash: HASH,
      reviewDecision: "APPROVED",
      assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
      assemblyHash: HASH,
      orderedSceneExecutionIds: SCENES.map((scene) => scene.sceneExecutionId),
      qcResults: SCENES.map((scene, index) => ({
        qcResultId: `10000000-0000-4000-8000-00000000031${index}`,
        sceneExecutionId: scene.sceneExecutionId,
        status: "passed" as const,
        resultHash: HASH,
      })),
      authorizedBy: "10000000-0000-4000-8000-000000000501",
    });
    expect(integrityPayload).toHaveProperty("runtimeAuthorizationVersion", 1);
    expect(integrityPayload).not.toHaveProperty("projectionVersion");
    expect(computeRuntimeAuthorizationIntegrityHash({
      ownership: OWNERSHIP,
      reviewDecisionId: "10000000-0000-4000-8000-000000000301",
      reviewHash: HASH,
      reviewDecision: "APPROVED",
      assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
      assemblyHash: HASH,
      orderedSceneExecutionIds: SCENES.map((scene) => scene.sceneExecutionId),
      qcResults: SCENES.map((scene, index) => ({
        qcResultId: `10000000-0000-4000-8000-00000000031${index}`,
        sceneExecutionId: scene.sceneExecutionId,
        status: "passed" as const,
        resultHash: HASH,
      })),
      authorizedBy: "10000000-0000-4000-8000-000000000501",
      runtimeAuthorizationVersion: 1,
    })).not.toBe(
      computeRuntimeAuthorizationIntegrityHash({
        ownership: OWNERSHIP,
        reviewDecisionId: "10000000-0000-4000-8000-000000000301",
        reviewHash: HASH,
        reviewDecision: "APPROVED",
        assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
        assemblyHash: HASH,
        orderedSceneExecutionIds: SCENES.map((scene) => scene.sceneExecutionId),
        qcResults: SCENES.map((scene, index) => ({
          qcResultId: `10000000-0000-4000-8000-00000000031${index}`,
          sceneExecutionId: scene.sceneExecutionId,
          status: "passed" as const,
          resultHash: HASH,
        })),
        authorizedBy: "10000000-0000-4000-8000-000000000501",
        runtimeAuthorizationVersion: 2,
      })
    );

    expect(() =>
      service.authorize({
        ownership: OWNERSHIP,
        reviewDecisionId: "10000000-0000-4000-8000-000000000399",
        reviewHash: HASH,
        reviewDecision: "APPROVED",
        assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
        assemblyHash: HASH,
        orderedSceneExecutionIds: SCENES.map((scene) => scene.sceneExecutionId),
        qcResults: SCENES.map((scene, index) => ({
          qcResultId: `10000000-0000-4000-8000-00000000031${index}`,
          sceneExecutionId: scene.sceneExecutionId,
          status: "passed" as const,
          resultHash: HASH,
        })),
        authorizedBy: "10000000-0000-4000-8000-000000000501",
        authorizedAt: "2026-08-04T18:00:00.000Z",
        derivedReadiness: "READY_FOR_EXECUTION",
        existingFact: fact,
      })
    ).toThrow(RuntimeAuthorizationError);
  });
});
