/**
 * Sprint 3 PR 3.2 — Scene Scheduling contract unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  PHASE1_EXECUTION_LOCKED,
  PersistedSceneRoutingDecisionSchema,
  RUNTIME_AUTHORIZATION_VERSION,
  RUNTIME_PROJECTION_VERSION,
  RuntimeAuthorizedFactSchema,
  SCENE_RUNTIME_STATES,
  SCENE_SCHEDULING_CONTRACT_VERSION,
  SCENE_ROUTING_DECISION_CONTRACT_VERSION,
  SceneSchedulingBundleSchema,
  deriveSceneRuntimeProjectionState,
  isSceneSchedulingBundleComplete,
  projectSceneRuntimes,
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

function routingDecision() {
  return PersistedSceneRoutingDecisionSchema.parse({
    routingDecisionId: "10000000-0000-5000-8000-000000000501",
    executionPlanId: OWNERSHIP.executionPlanId,
    sceneExecutionId: SCENE_A,
    runtimeAuthorizationId: authorizedFact().runtimeAuthorizationId,
    capabilityId: "animation-video-generation",
    capabilityVersion: "1.0.0",
    selectedProviderId: "seedance",
    selectedAdapterVersion: "1.0.0",
    registrySnapshotHash: HASH,
    capabilitySnapshot: { capabilityId: "animation-video-generation" },
    policySnapshot: { automaticFallbackEnabled: false },
    candidateSummary: [
      {
        providerId: "seedance",
        adapterVersion: "1.0.0",
        selected: true,
        scoreTotal: 1,
        exclusionCodes: [],
      },
    ],
    decidedAt: "2026-08-04T12:05:00.000Z",
    deterministicIntegrityHash: HASH,
    automaticFallbackEnabled: false,
    contractVersion: SCENE_ROUTING_DECISION_CONTRACT_VERSION,
    ownership: OWNERSHIP,
  });
}

function schedulingBundle() {
  return SceneSchedulingBundleSchema.parse({
    correlation: {
      correlationId: "10000000-0000-5000-8000-000000000601",
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_A,
      runtimeAuthorizationId: authorizedFact().runtimeAuthorizationId,
      routingDecisionId: routingDecision().routingDecisionId,
      providerExecutionId: "execution:scene-a",
      envelopeId: "envelope:scene-a",
      outboxJobId: "outbox:scene-a",
      requestHash: HASH,
      envelopeHash: HASH,
      routingDecisionHash: HASH,
      authorizationHash: HASH,
      schedulingIdentityHash: HASH,
      ownership: OWNERSHIP,
      contractVersion: SCENE_SCHEDULING_CONTRACT_VERSION,
      scheduledAt: "2026-08-04T12:06:00.000Z",
      scheduledBy: "10000000-0000-4000-8000-000000000501",
    },
    routingDecision: routingDecision(),
    runtimeAuthorization: authorizedFact(),
    providerExecutionId: "execution:scene-a",
    envelopeId: "envelope:scene-a",
    outboxJobId: "outbox:scene-a",
    payloadReference: "payload://scene-a",
    requestHash: HASH,
    envelopeHash: HASH,
    replayed: false,
    executionAllowed: false,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
    automaticFallbackEnabled: false,
    authorizationContractVersion: "1",
    schedulingContractVersion: SCENE_SCHEDULING_CONTRACT_VERSION,
  });
}

describe("Sprint 3 PR 3.2 scene scheduling contracts", () => {
  it("parses PersistedSceneRoutingDecision with automaticFallbackEnabled=false", () => {
    const decision = routingDecision();
    expect(decision.automaticFallbackEnabled).toBe(false);
    expect(decision.capabilityId).toBe("animation-video-generation");
    expect(() =>
      PersistedSceneRoutingDecisionSchema.parse({
        ...decision,
        automaticFallbackEnabled: true,
      })
    ).toThrow();
  });

  it("requires SceneSchedulingBundle executionAllowed false and PHASE1_EXECUTION_LOCKED", () => {
    const bundle = schedulingBundle();
    expect(bundle.executionAllowed).toBe(false);
    expect(bundle.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    expect(bundle.automaticFallbackEnabled).toBe(false);

    expect(() =>
      SceneSchedulingBundleSchema.parse({
        ...bundle,
        executionAllowed: true,
      })
    ).toThrow();
    expect(() =>
      SceneSchedulingBundleSchema.parse({
        ...bundle,
        executionLockCode: "UNLOCKED",
      })
    ).toThrow();
  });

  it("isSceneSchedulingBundleComplete requires all six flags", () => {
    const complete = {
      hasRuntimeAuthorization: true,
      hasRoutingDecision: true,
      hasProviderExecution: true,
      hasEnvelope: true,
      hasOutboxJob: true,
      hasCorrelation: true,
    };
    expect(isSceneSchedulingBundleComplete(complete)).toBe(true);

    for (const key of Object.keys(complete) as (keyof typeof complete)[]) {
      expect(
        isSceneSchedulingBundleComplete({ ...complete, [key]: false })
      ).toBe(false);
    }
  });

  it("deriveSceneRuntimeProjectionState: AUTHORIZED when covered; ACTIVE only when schedulingBundleComplete; never CANCELLED", () => {
    expect(SCENE_RUNTIME_STATES).not.toContain("CANCELLED");

    expect(
      deriveSceneRuntimeProjectionState({ coveredByAuthorization: true })
    ).toEqual({ state: "AUTHORIZED", projectionVersion: RUNTIME_PROJECTION_VERSION });

    expect(
      deriveSceneRuntimeProjectionState({
        coveredByAuthorization: true,
        observedState: "ACTIVE",
      })
    ).toEqual({ state: "AUTHORIZED", projectionVersion: RUNTIME_PROJECTION_VERSION });

    expect(
      deriveSceneRuntimeProjectionState({
        coveredByAuthorization: true,
        schedulingBundleComplete: true,
      })
    ).toEqual({ state: "ACTIVE", projectionVersion: RUNTIME_PROJECTION_VERSION });

    expect(
      deriveSceneRuntimeProjectionState({
        coveredByAuthorization: false,
        schedulingBundleComplete: false,
      })
    ).toEqual({ state: "READY", projectionVersion: RUNTIME_PROJECTION_VERSION });
  });

  it("projectSceneRuntimes with schedulingBundleComplete → ACTIVE", () => {
    const projections = projectSceneRuntimes({
      executionPlanId: OWNERSHIP.executionPlanId,
      scenes: [
        {
          sceneExecutionId: SCENE_A,
          sceneId: "scene-a",
          sceneOrder: 0,
          schedulingBundleComplete: true,
        },
        {
          sceneExecutionId: SCENE_B,
          sceneId: "scene-b",
          sceneOrder: 1,
          schedulingBundleComplete: false,
        },
      ],
      authorizedFact: authorizedFact(),
      derivedAt: "2026-08-04T12:00:00.000Z",
    });

    expect(projections[0]!.state).toBe("ACTIVE");
    expect(projections[1]!.state).toBe("AUTHORIZED");
    expect(projections.every((row) => row.executionAllowed === false)).toBe(true);
    expect(
      projections.every((row) => row.executionLockCode === PHASE1_EXECUTION_LOCKED)
    ).toBe(true);
    expect(projections.every((row) => row.state !== ("CANCELLED" as never))).toBe(
      true
    );
  });
});
