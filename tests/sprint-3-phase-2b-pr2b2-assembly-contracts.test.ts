/**
 * Sprint 3 Phase 2B PR 2B.2 — Assembly Definition contract + identity unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  AssemblyProjectionSchema,
  AssemblySceneMembershipSchema,
  StoryAssemblyDefinitionSchema,
} from "@ceo-agent/shared";
import {
  buildAssemblyDefinitionFingerprint,
  buildAssemblyMembershipFingerprint,
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "@ceo-agent/db";

const PLAN = "10000000-0000-4000-8000-000000000101";
const SCENE_A = "10000000-0000-4000-8000-000000000201";
const SCENE_B = "10000000-0000-4000-8000-000000000202";
const USER = "10000000-0000-4000-8000-000000000301";

function definition(orderedSceneExecutionIds: string[]) {
  const fingerprint = buildAssemblyDefinitionFingerprint({
    executionPlanId: PLAN,
    orderedSceneExecutionIds,
  });
  return StoryAssemblyDefinitionSchema.parse({
    assemblyDefinitionId: deterministicPersistenceUuid(
      "story-assembly-definition",
      fingerprint
    ),
    executionPlanId: PLAN,
    orgId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
    campaignId: "10000000-0000-4000-8000-000000000003",
    storyId: "10000000-0000-4000-8000-000000000004",
    storyVersionId: "10000000-0000-4000-8000-000000000005",
    animationPackageId: "10000000-0000-4000-8000-000000000006",
    sceneCount: orderedSceneExecutionIds.length,
    orderedSceneExecutionIds,
    createdBy: USER,
    createdAt: "2026-08-03T15:00:00.000Z",
    contractVersion: "1",
    deterministicFingerprint: fingerprint,
  });
}

function membership(
  assemblyDefinitionId: string,
  sceneExecutionId: string,
  sceneOrder: number
) {
  const fingerprint = buildAssemblyMembershipFingerprint({
    assemblyDefinitionId,
    executionPlanId: PLAN,
    sceneExecutionId,
    sceneOrder,
  });
  return AssemblySceneMembershipSchema.parse({
    membershipId: deterministicPersistenceUuid("assembly-scene-membership", fingerprint),
    assemblyDefinitionId,
    executionPlanId: PLAN,
    sceneExecutionId,
    sceneId: sceneExecutionId === SCENE_A ? "scene-a" : "scene-b",
    sceneOrder,
    contractVersion: "1",
    deterministicFingerprint: fingerprint,
  });
}

describe("Phase 2B PR 2B.2 assembly contracts", () => {
  it("parses StoryAssemblyDefinition / AssemblySceneMembership / AssemblyProjection", () => {
    const def = definition([SCENE_A, SCENE_B]);
    const memberships = [
      membership(def.assemblyDefinitionId, SCENE_A, 0),
      membership(def.assemblyDefinitionId, SCENE_B, 1),
    ];
    const projection = AssemblyProjectionSchema.parse({
      executionPlanId: PLAN,
      orgId: def.orgId,
      workspaceId: def.workspaceId,
      definition: def,
      memberships,
      sceneCount: 2,
      orderedSceneExecutionIds: [SCENE_A, SCENE_B],
      prerequisites: {
        hasDefinition: true,
        membershipComplete: true,
        reviewApproved: true,
        orderingDeterministic: true,
      },
      derivedAt: "2026-08-03T15:05:00.000Z",
    });
    expect(projection.definition?.assemblyDefinitionId).toBe(def.assemblyDefinitionId);
    expect(projection.prerequisites.hasDefinition).toBe(true);
    expect(projection).not.toHaveProperty("readyForExecution");
  });

  it("equivalent ordered inputs yield the same Assembly Definition ID", () => {
    const a = definition([SCENE_A, SCENE_B]);
    const b = definition([SCENE_A, SCENE_B]);
    expect(a.assemblyDefinitionId).toBe(b.assemblyDefinitionId);
    expect(a.deterministicFingerprint).toBe(b.deterministicFingerprint);
  });

  it("equivalent memberships yield the same membership IDs", () => {
    const def = definition([SCENE_A, SCENE_B]);
    const a = membership(def.assemblyDefinitionId, SCENE_A, 0);
    const b = membership(def.assemblyDefinitionId, SCENE_A, 0);
    expect(a.membershipId).toBe(b.membershipId);
  });

  it("changed ordering yields a different Assembly Definition identity", () => {
    const forward = definition([SCENE_A, SCENE_B]);
    const reversed = definition([SCENE_B, SCENE_A]);
    expect(forward.assemblyDefinitionId).not.toBe(reversed.assemblyDefinitionId);
    expect(forward.deterministicFingerprint).not.toBe(reversed.deterministicFingerprint);
    expect(canonicalPersistenceHash(forward.orderedSceneExecutionIds)).not.toBe(
      canonicalPersistenceHash(reversed.orderedSceneExecutionIds)
    );
  });

  it("projection never persists READY_FOR_EXECUTION", () => {
    const source = AssemblyProjectionSchema.shape.prerequisites;
    expect(Object.keys(source.shape)).toEqual([
      "hasDefinition",
      "membershipComplete",
      "reviewApproved",
      "orderingDeterministic",
    ]);
  });
});
