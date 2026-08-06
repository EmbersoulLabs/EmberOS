/**
 * Sprint 3 Phase 2B PR 2B.2 — Assembly reload integrity (JSONB snapshot vs relational authority).
 */
import { describe, expect, it } from "vitest";
import {
  AssemblySceneMembershipSchema,
  StoryAssemblyDefinitionSchema,
} from "@ceo-agent/shared";
import {
  AssemblyIntegrityViolationError,
  assertAssemblyReloadIntegrity,
  buildAssemblyDefinitionFingerprint,
  buildAssemblyMembershipFingerprint,
  deterministicPersistenceUuid,
  reconstructDefinitionFromRows,
  reconstructMembershipFromRow,
} from "@ceo-agent/db";

const PLAN = "10000000-0000-4000-8000-000000000101";
const SCENE_A = "10000000-0000-4000-8000-000000000201";
const SCENE_B = "10000000-0000-4000-8000-000000000202";
const SCENE_C = "10000000-0000-4000-8000-000000000203";
const USER = "10000000-0000-4000-8000-000000000301";
const ORG = "10000000-0000-4000-8000-000000000001";
const WS = "10000000-0000-4000-8000-000000000002";
const CAMPAIGN = "10000000-0000-4000-8000-000000000003";
const STORY = "10000000-0000-4000-8000-000000000004";
const VERSION = "10000000-0000-4000-8000-000000000005";
const PACKAGE = "10000000-0000-4000-8000-000000000006";

function makeMembership(
  sceneExecutionId: string,
  sceneOrder: number,
  assemblyDefinitionId: string
) {
  const fingerprint = buildAssemblyMembershipFingerprint({
    assemblyDefinitionId,
    executionPlanId: PLAN,
    sceneExecutionId,
    sceneOrder,
  });
  const membership = AssemblySceneMembershipSchema.parse({
    membershipId: deterministicPersistenceUuid("assembly-scene-membership", fingerprint),
    assemblyDefinitionId,
    executionPlanId: PLAN,
    sceneExecutionId,
    sceneId:
      sceneExecutionId === SCENE_A
        ? "scene-a"
        : sceneExecutionId === SCENE_B
          ? "scene-b"
          : "scene-c",
    sceneOrder,
    contractVersion: "1",
    deterministicFingerprint: fingerprint,
  });
  return {
    membershipId: membership.membershipId,
    orgId: ORG,
    workspaceId: WS,
    campaignId: CAMPAIGN,
    storyId: STORY,
    storyVersionId: VERSION,
    animationPackageId: PACKAGE,
    executionPlanId: PLAN,
    assemblyDefinitionId,
    sceneExecutionId: membership.sceneExecutionId,
    sceneId: membership.sceneId,
    sceneOrder: membership.sceneOrder,
    contractVersion: membership.contractVersion,
    deterministicFingerprint: membership.deterministicFingerprint,
    membership,
    acceptedAt: new Date("2026-08-03T16:00:00.000Z"),
  };
}

function makeDefinitionRow(orderedSceneExecutionIds: string[]) {
  const fingerprint = buildAssemblyDefinitionFingerprint({
    executionPlanId: PLAN,
    orderedSceneExecutionIds,
  });
  const assemblyDefinitionId = deterministicPersistenceUuid(
    "story-assembly-definition",
    fingerprint
  );
  const remapped = orderedSceneExecutionIds.map((id, index) =>
    makeMembership(id, index, assemblyDefinitionId)
  );
  const definition = StoryAssemblyDefinitionSchema.parse({
    assemblyDefinitionId,
    executionPlanId: PLAN,
    orgId: ORG,
    workspaceId: WS,
    campaignId: CAMPAIGN,
    storyId: STORY,
    storyVersionId: VERSION,
    animationPackageId: PACKAGE,
    sceneCount: orderedSceneExecutionIds.length,
    orderedSceneExecutionIds,
    createdBy: USER,
    createdAt: "2026-08-03T16:00:00.000Z",
    contractVersion: "1",
    deterministicFingerprint: fingerprint,
  });
  return {
    row: {
      assemblyDefinitionId,
      orgId: ORG,
      workspaceId: WS,
      campaignId: CAMPAIGN,
      storyId: STORY,
      storyVersionId: VERSION,
      animationPackageId: PACKAGE,
      executionPlanId: PLAN,
      sceneCount: orderedSceneExecutionIds.length,
      createdBy: USER,
      createdAt: new Date("2026-08-03T16:00:00.000Z"),
      contractVersion: "1",
      deterministicFingerprint: fingerprint,
      definition,
      acceptedAt: new Date("2026-08-03T16:00:00.000Z"),
    },
    memberships: remapped,
  };
}

describe("Phase 2B PR 2B.2 assembly reload integrity", () => {
  it("matching JSONB snapshot against relational rows PASSes", () => {
    const { row, memberships } = makeDefinitionRow([SCENE_A, SCENE_B]);
    const verified = assertAssemblyReloadIntegrity(row, memberships);
    expect(verified.definition.orderedSceneExecutionIds).toEqual([SCENE_A, SCENE_B]);
    expect(verified.memberships.map((m) => m.sceneExecutionId)).toEqual([SCENE_A, SCENE_B]);
    expect(verified.definition.assemblyDefinitionId).toBe(row.assemblyDefinitionId);
  });

  it("reconstructs membership and definition from relational columns only", () => {
    const { row, memberships } = makeDefinitionRow([SCENE_A, SCENE_B]);
    const reconstructedMembership = reconstructMembershipFromRow(memberships[0]!);
    expect(reconstructedMembership.sceneExecutionId).toBe(memberships[0]!.sceneExecutionId);
    expect(reconstructedMembership.sceneOrder).toBe(0);

    const reconstructed = reconstructDefinitionFromRows(
      row,
      memberships.map(reconstructMembershipFromRow)
    );
    expect(reconstructed.orderedSceneExecutionIds).toEqual([SCENE_A, SCENE_B]);
    expect(reconstructed.sceneCount).toBe(2);
  });

  it("different JSONB ordering fails closed with ASSEMBLY_INTEGRITY_VIOLATION", () => {
    const { row, memberships } = makeDefinitionRow([SCENE_A, SCENE_B]);
    row.definition = {
      ...row.definition,
      orderedSceneExecutionIds: [SCENE_B, SCENE_A],
    };
    expect(() => assertAssemblyReloadIntegrity(row, memberships)).toThrow(
      AssemblyIntegrityViolationError
    );
    try {
      assertAssemblyReloadIntegrity(row, memberships);
    } catch (error) {
      expect(error).toMatchObject({ code: "ASSEMBLY_INTEGRITY_VIOLATION", status: 409 });
    }
  });

  it("missing membership row fails closed with ASSEMBLY_INTEGRITY_VIOLATION", () => {
    const { row, memberships } = makeDefinitionRow([SCENE_A, SCENE_B]);
    expect(() => assertAssemblyReloadIntegrity(row, [memberships[0]!])).toThrow(
      AssemblyIntegrityViolationError
    );
  });

  it("extra membership row fails closed with ASSEMBLY_INTEGRITY_VIOLATION", () => {
    const { row, memberships } = makeDefinitionRow([SCENE_A, SCENE_B]);
    const extra = makeMembership(SCENE_C, 2, row.assemblyDefinitionId);
    expect(() => assertAssemblyReloadIntegrity(row, [...memberships, extra])).toThrow(
      AssemblyIntegrityViolationError
    );
  });

  it("fingerprint mismatch fails closed with ASSEMBLY_INTEGRITY_VIOLATION", () => {
    const { row, memberships } = makeDefinitionRow([SCENE_A, SCENE_B]);
    row.definition = {
      ...row.definition,
      deterministicFingerprint:
        "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    };
    expect(() => assertAssemblyReloadIntegrity(row, memberships)).toThrow(
      AssemblyIntegrityViolationError
    );
  });

  it("projection order derives from relational membership rows, not JSONB", () => {
    const { row, memberships } = makeDefinitionRow([SCENE_A, SCENE_B]);
    row.definition = {
      ...row.definition,
      orderedSceneExecutionIds: [SCENE_B, SCENE_A],
    };
    const relational = memberships.map(reconstructMembershipFromRow);
    const definition = reconstructDefinitionFromRows(row, relational);
    expect(definition.orderedSceneExecutionIds).toEqual([SCENE_A, SCENE_B]);
    expect(row.definition.orderedSceneExecutionIds).toEqual([SCENE_B, SCENE_A]);
  });
});
