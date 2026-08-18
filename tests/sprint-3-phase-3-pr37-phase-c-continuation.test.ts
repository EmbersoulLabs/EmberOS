/**
 * Sprint 3 PR 3.7 Phase C — continuation coordinator unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  buildDeterministicAssemblyJob,
  buildProductionAssemblyEngineSnapshotHash,
  deriveSceneCompleteReadiness,
} from "../packages/agents/src/ai-story/ai-story-runtime-continuation-coordinator";
import type {
  AssemblySceneMembership,
  CanonicalSceneResult,
  StoryAssemblyDefinition,
} from "@ceo-agent/shared/server";

const OWNERSHIP = {
  orgId: "c7000000-0000-4000-8000-000000000001",
  workspaceId: "c7000000-0000-4000-8000-000000000002",
  campaignId: "c7000000-0000-4000-8000-000000000003",
  storyId: "c7000000-0000-4000-8000-000000000004",
  storyVersionId: "c7000000-0000-4000-8000-000000000005",
  animationPackageId: "c7000000-0000-4000-8000-000000000006",
  executionPlanId: "c7000000-0000-4000-8000-000000000101",
} as const;

const DEF_ID = "c7000000-0000-4000-8000-000000000401";
const SCENE_EXEC_A = "c7000000-0000-4000-8000-000000000201";
const SCENE_EXEC_B = "c7000000-0000-4000-8000-000000000202";
const SCENE_RESULT_A = "c7000000-0000-5000-8000-000000000301";
const SCENE_RESULT_B = "c7000000-0000-5000-8000-000000000302";
const AUTH_ID = "c7000000-0000-5000-8000-000000000401";
const HASH_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function definition(): StoryAssemblyDefinition {
  return {
    assemblyDefinitionId: DEF_ID,
    executionPlanId: OWNERSHIP.executionPlanId,
    orgId: OWNERSHIP.orgId,
    workspaceId: OWNERSHIP.workspaceId,
    campaignId: OWNERSHIP.campaignId,
    storyId: OWNERSHIP.storyId,
    storyVersionId: OWNERSHIP.storyVersionId,
    animationPackageId: OWNERSHIP.animationPackageId,
    sceneCount: 2,
    orderedSceneExecutionIds: [SCENE_EXEC_A, SCENE_EXEC_B],
    createdBy: AUTH_ID,
    createdAt: "2026-08-08T04:00:00.000Z",
    contractVersion: "1",
    deterministicFingerprint: HASH_A,
  };
}

function memberships(): AssemblySceneMembership[] {
  return [
    {
      membershipId: "c7000000-0000-4000-8000-000000000501",
      assemblyDefinitionId: DEF_ID,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXEC_A,
      sceneId: "scene-a",
      sceneOrder: 0,
      contractVersion: "1",
      deterministicFingerprint: HASH_A,
    },
    {
      membershipId: "c7000000-0000-4000-8000-000000000502",
      assemblyDefinitionId: DEF_ID,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXEC_B,
      sceneId: "scene-b",
      sceneOrder: 1,
      contractVersion: "1",
      deterministicFingerprint: HASH_B,
    },
  ];
}

function successResult(
  sceneExecutionId: string,
  sceneResultId: string,
  sceneOrder: number,
  contentHash: string
): CanonicalSceneResult {
  return {
    sceneResultId,
    executionPlanId: OWNERSHIP.executionPlanId,
    sceneRuntimeId: "c7000000-0000-5000-8000-000000000601",
    sceneExecutionId,
    sceneId: sceneOrder === 0 ? "scene-a" : "scene-b",
    sceneOrder,
    ownership: OWNERSHIP,
    status: "SUCCEEDED",
    failureClassification: null,
    mediaReference: {
      uri: `${OWNERSHIP.workspaceId}/scene-${sceneOrder}.mp4`,
      contentHash,
      mediaType: "video/mp4",
    },
    durationMs: 2500,
    acceptedAt: "2026-08-08T06:00:00.000Z",
    integrityHash: contentHash,
    contractVersion: "1",
  };
}

describe("Sprint 3 PR 3.7 Phase C continuation helpers", () => {
  it("derives scene-complete only from Assembly Definition + persisted Scene Results", () => {
    const ready = deriveSceneCompleteReadiness({
      definition: definition(),
      memberships: memberships(),
      sceneResults: [
        successResult(SCENE_EXEC_A, SCENE_RESULT_A, 0, HASH_A),
        successResult(SCENE_EXEC_B, SCENE_RESULT_B, 1, HASH_B),
      ],
    });
    expect(ready.ready).toBe(true);
    expect(ready.orderedSceneResultIds).toEqual([SCENE_RESULT_A, SCENE_RESULT_B]);
    expect(ready.orderedSceneContentHashes).toEqual([HASH_A, HASH_B]);
  });

  it("fails closed when a required Scene Result is missing or failed", () => {
    const missing = deriveSceneCompleteReadiness({
      definition: definition(),
      memberships: memberships(),
      sceneResults: [successResult(SCENE_EXEC_A, SCENE_RESULT_A, 0, HASH_A)],
    });
    expect(missing.ready).toBe(false);

    const failed = deriveSceneCompleteReadiness({
      definition: definition(),
      memberships: memberships(),
      sceneResults: [
        successResult(SCENE_EXEC_A, SCENE_RESULT_A, 0, HASH_A),
        {
          ...successResult(SCENE_EXEC_B, SCENE_RESULT_B, 1, HASH_B),
          status: "FAILED",
          mediaReference: null,
        },
      ],
    });
    expect(failed.ready).toBe(false);
  });

  it("builds deterministic Assembly Jobs with frozen engine snapshot", () => {
    const first = buildDeterministicAssemblyJob({
      ownership: OWNERSHIP,
      assemblyDefinitionId: DEF_ID,
      runtimeAuthorizationId: AUTH_ID,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [HASH_A, HASH_B],
      acceptedAt: "2026-08-08T07:00:00.000Z",
    });
    const second = buildDeterministicAssemblyJob({
      ownership: OWNERSHIP,
      assemblyDefinitionId: DEF_ID,
      runtimeAuthorizationId: AUTH_ID,
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B],
      orderedSceneContentHashes: [HASH_A, HASH_B],
      acceptedAt: "2026-08-08T08:00:00.000Z",
    });
    expect(first.assemblyJobId).toBe(second.assemblyJobId);
    expect(first.deterministicFingerprint).toBe(second.deterministicFingerprint);
    expect(first.assemblyEngineSnapshotHash).toBe(
      buildProductionAssemblyEngineSnapshotHash()
    );
  });
});
