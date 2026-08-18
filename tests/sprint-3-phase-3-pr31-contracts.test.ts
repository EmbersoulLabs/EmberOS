/**
 * Sprint 3 PR 3.1 — Runtime contract unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  CanonicalSceneResultSchema,
  FinalStoryResultSchema,
  RuntimeAuthorizedFactSchema,
  RuntimeFailureClassificationSchema,
  RUNTIME_AUTHORIZATION_VERSION,
  RUNTIME_FAILURE_CLASSIFICATIONS,
  RUNTIME_PROJECTION_VERSION,
  SCENE_RUNTIME_STATES,
  SceneRuntimeContractSchema,
  SceneRuntimeProjectionSchema,
  RuntimeIdentityBundleSchema,
  assertSceneRuntimeTransition,
  deriveSceneRuntimeProjectionState,
  projectRuntimeAuthorization,
  projectSceneRuntimes,
  PHASE1_EXECUTION_LOCKED,
} from "@ceo-agent/shared";

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
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function authorizedFact() {
  return RuntimeAuthorizedFactSchema.parse({
    runtimeAuthorizationId: "10000000-0000-5000-8000-000000000401",
    executionPlanId: OWNERSHIP.executionPlanId,
    runtimeAuthorizationVersion: RUNTIME_AUTHORIZATION_VERSION,
    reviewDecisionId: "10000000-0000-4000-8000-000000000301",
    reviewHash: HASH,
    assemblyDefinitionId: "10000000-0000-4000-8000-000000000302",
    assemblyHash: HASH,
    orderedSceneExecutionIds: [SCENE_A, SCENE_B],
    qcResultIds: [
      "10000000-0000-4000-8000-000000000311",
      "10000000-0000-4000-8000-000000000312",
    ],
    ownership: OWNERSHIP,
    authorizationContractVersion: "1",
    authorizedBy: "10000000-0000-4000-8000-000000000501",
    authorizedAt: "2026-08-04T12:00:00.000Z",
    deterministicIntegrityHash: HASH,
  });
}

describe("Sprint 3 PR 3.1 runtime contracts", () => {
  it("parses RuntimeAuthorizedFact without READY_FOR_EXECUTION authority fields", () => {
    const fact = authorizedFact();
    expect(fact.authorizationContractVersion).toBe("1");
    expect(fact.runtimeAuthorizationVersion).toBe(1);
    expect(fact.runtimeAuthorizationVersion).toBe(RUNTIME_AUTHORIZATION_VERSION);
    expect(fact).not.toHaveProperty("readyForExecution");
    expect(fact).not.toHaveProperty("executionAllowed");
    expect(fact).not.toHaveProperty("projectionVersion");
  });

  it("defaults runtimeAuthorizationVersion to 1 when omitted", () => {
    const { runtimeAuthorizationVersion: _omit, ...withoutVersion } = authorizedFact();
    void _omit;
    const fact = RuntimeAuthorizedFactSchema.parse(withoutVersion);
    expect(fact.runtimeAuthorizationVersion).toBe(1);
  });

  it("exposes Scene Runtime states without CANCELLED", () => {
    expect(SCENE_RUNTIME_STATES).toEqual([
      "READY",
      "AUTHORIZED",
      "ACTIVE",
      "SUCCEEDED",
      "FAILED",
    ]);
    expect(SCENE_RUNTIME_STATES).not.toContain("CANCELLED");
  });

  it("enforces Scene Runtime transition graph", () => {
    expect(() => assertSceneRuntimeTransition("READY", "AUTHORIZED")).not.toThrow();
    expect(() => assertSceneRuntimeTransition("AUTHORIZED", "ACTIVE")).not.toThrow();
    expect(() => assertSceneRuntimeTransition("ACTIVE", "SUCCEEDED")).not.toThrow();
    expect(() => assertSceneRuntimeTransition("ACTIVE", "FAILED")).not.toThrow();
    expect(() => assertSceneRuntimeTransition("READY", "ACTIVE")).toThrow(/Invalid Scene Runtime/);
    expect(() => assertSceneRuntimeTransition("SUCCEEDED", "READY")).toThrow();
  });

  it("parses Scene Runtime / Scene Result / Final Story Result contracts", () => {
    const sceneRuntime = SceneRuntimeContractSchema.parse({
      identity: {
        sceneRuntimeId: "10000000-0000-5000-8000-000000000601",
        executionPlanId: OWNERSHIP.executionPlanId,
        sceneExecutionId: SCENE_A,
        sceneId: "scene-a",
        sceneOrder: 0,
        runtimeAuthorizationId: authorizedFact().runtimeAuthorizationId,
        contractVersion: "1",
        deterministicFingerprint: HASH,
      },
      state: "AUTHORIZED",
      ownership: OWNERSHIP,
      failure: null,
      contractVersion: "1",
    });
    expect(sceneRuntime.state).toBe("AUTHORIZED");

    const sceneResult = CanonicalSceneResultSchema.parse({
      sceneResultId: "10000000-0000-5000-8000-000000000701",
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneRuntimeId: sceneRuntime.identity.sceneRuntimeId,
      sceneExecutionId: SCENE_A,
      sceneId: "scene-a",
      sceneOrder: 0,
      ownership: OWNERSHIP,
      status: "SUCCEEDED",
      failureClassification: null,
      mediaReference: {
        uri: "asset://scene-a/video",
        contentHash: HASH,
        mediaType: "video/mp4",
      },
      durationMs: 4000,
      acceptedAt: "2026-08-04T12:10:00.000Z",
      integrityHash: HASH,
      contractVersion: "1",
    });
    expect(sceneResult).not.toHaveProperty("providerId");
    expect(sceneResult).not.toHaveProperty("providerExecutionId");
    expect(sceneResult).not.toHaveProperty("prompt");

    const storyResult = FinalStoryResultSchema.parse({
      storyResultId: "10000000-0000-5000-8000-000000000801",
      executionPlanId: OWNERSHIP.executionPlanId,
      runtimeAuthorizationId: authorizedFact().runtimeAuthorizationId,
      ownership: OWNERSHIP,
      orderedSceneResultIds: [sceneResult.sceneResultId],
      orderedSceneExecutionIds: [SCENE_A, SCENE_B],
      status: "SUCCEEDED",
      failureClassification: null,
      mediaReference: null,
      completedAt: "2026-08-04T12:20:00.000Z",
      integrityHash: HASH,
      contractVersion: "1",
    });
    expect(storyResult.orderedSceneResultIds).toHaveLength(1);
  });

  it("defines the full runtime failure classification set", () => {
    expect(RUNTIME_FAILURE_CLASSIFICATIONS).toContain("QC_BLOCKED");
    expect(RUNTIME_FAILURE_CLASSIFICATIONS).toContain("IDENTITY_CONFLICT");
    expect(RUNTIME_FAILURE_CLASSIFICATIONS).toContain("NO_ELIGIBLE_PROVIDER");
    expect(RuntimeFailureClassificationSchema.parse("PROVIDER_TIMEOUT")).toBe(
      "PROVIDER_TIMEOUT"
    );
  });

  it("parses RuntimeIdentityBundle", () => {
    const bundle = RuntimeIdentityBundleSchema.parse({
      ownership: OWNERSHIP,
      authorization: {
        runtimeAuthorizationId: authorizedFact().runtimeAuthorizationId,
        executionPlanId: OWNERSHIP.executionPlanId,
        runtimeAuthorizationVersion: 1,
        deterministicIntegrityHash: HASH,
        authorizationContractVersion: "1",
      },
      sceneRuntimes: [],
      sceneResults: [],
      storyResult: null,
    });
    expect(bundle.authorization?.executionPlanId).toBe(OWNERSHIP.executionPlanId);
    expect(bundle.authorization?.runtimeAuthorizationVersion).toBe(1);
  });

  it("derives Scene Runtime AUTHORIZED only from authorization coverage", () => {
    expect(
      deriveSceneRuntimeProjectionState({ coveredByAuthorization: false })
    ).toEqual({ state: "READY", projectionVersion: 1 });
    expect(
      deriveSceneRuntimeProjectionState({ coveredByAuthorization: true })
    ).toEqual({ state: "AUTHORIZED", projectionVersion: RUNTIME_PROJECTION_VERSION });
    expect(
      deriveSceneRuntimeProjectionState({
        coveredByAuthorization: true,
        observedState: "ACTIVE",
      })
    ).toEqual({ state: "AUTHORIZED", projectionVersion: 1 });
    expect(
      deriveSceneRuntimeProjectionState({
        coveredByAuthorization: true,
        schedulingBundleComplete: true,
        observedState: "ACTIVE",
      })
    ).toEqual({ state: "ACTIVE", projectionVersion: 1 });

    const projections = projectSceneRuntimes({
      executionPlanId: OWNERSHIP.executionPlanId,
      scenes: [
        { sceneExecutionId: SCENE_A, sceneId: "scene-a", sceneOrder: 0 },
        { sceneExecutionId: SCENE_B, sceneId: "scene-b", sceneOrder: 1 },
      ],
      authorizedFact: authorizedFact(),
      derivedAt: "2026-08-04T12:00:00.000Z",
    });
    expect(projections.every((row) => row.state === "AUTHORIZED")).toBe(true);
    expect(projections.every((row) => row.projectionVersion === 1)).toBe(true);
    expect(projections.every((row) => row.executionAllowed === false)).toBe(true);
    expect(projections.every((row) => row.executionLockCode === PHASE1_EXECUTION_LOCKED)).toBe(
      true
    );
    expect(SceneRuntimeProjectionSchema.parse(projections[0]!)).toMatchObject({
      coveredByAuthorization: true,
      projectionVersion: RUNTIME_PROJECTION_VERSION,
    });
  });

  it("authorization projection never treats derived readiness as execution authority", () => {
    const projection = projectRuntimeAuthorization({
      ownership: OWNERSHIP,
      authorizedFact: authorizedFact(),
      scenes: [
        { sceneExecutionId: SCENE_A, sceneId: "scene-a", sceneOrder: 0 },
        { sceneExecutionId: SCENE_B, sceneId: "scene-b", sceneOrder: 1 },
      ],
      derivedReadiness: "READY_FOR_EXECUTION",
      derivedAt: "2026-08-04T12:00:00.000Z",
    });
    expect(projection.projectionVersion).toBe(1);
    expect(projection.projectionVersion).toBe(RUNTIME_PROJECTION_VERSION);
    expect(projection.derivedReadiness).toBe("READY_FOR_EXECUTION");
    expect(projection.executionAuthority).toBe("RUNTIME_AUTHORIZED_FACT");
    expect(projection.executionAllowed).toBe(false);
    expect(projection.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    expect(projection.automaticFallbackEnabled).toBe(false);
    expect(projection.authorizedFact?.runtimeAuthorizationVersion).toBe(1);
  });
});
