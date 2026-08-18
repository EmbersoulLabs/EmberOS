/**
 * Sprint 3 PR 3.6 Phase 2 — Assembly Validation Layer unit tests.
 */
import { describe, expect, it } from "vitest";
import { buildAssemblyDefinitionFingerprint } from "@ceo-agent/db";
import {
  type AssemblySceneMediaMetadata,
  type AssemblySceneMembership,
  type AssemblyValidationExecutionPlan,
  type AssemblyValidationOwnershipExpectation,
  type CanonicalSceneResult,
  type StoryAssemblyDefinition,
} from "@ceo-agent/shared/server";
import {
  createInMemoryAssemblyValidationRepository,
  validateAssemblyInputs,
  computeAssemblyValidationExecutionPlanIntegrityHash,
} from "../packages/agents/src/ai-story";

const OWNERSHIP: AssemblyValidationOwnershipExpectation = {
  orgId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  campaignId: "10000000-0000-4000-8000-000000000003",
  storyId: "10000000-0000-4000-8000-000000000004",
  storyVersionId: "10000000-0000-4000-8000-000000000005",
  animationPackageId: "10000000-0000-4000-8000-000000000006",
  executionPlanId: "10000000-0000-4000-8000-000000000101",
};

const SCENE_EXEC_A = "10000000-0000-4000-8000-000000000201";
const SCENE_EXEC_B = "10000000-0000-4000-8000-000000000202";
const SCENE_RESULT_A = "10000000-0000-5000-8000-000000000301";
const SCENE_RESULT_B = "10000000-0000-5000-8000-000000000302";
const HASH_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DEF_ID = "10000000-0000-4000-8000-000000000401";

function plan(
  overrides: Partial<AssemblyValidationExecutionPlan> = {}
): AssemblyValidationExecutionPlan {
  const base = {
    executionPlanId: OWNERSHIP.executionPlanId,
    orgId: OWNERSHIP.orgId,
    workspaceId: OWNERSHIP.workspaceId,
    campaignId: OWNERSHIP.campaignId,
    storyId: OWNERSHIP.storyId,
    storyVersionId: OWNERSHIP.storyVersionId,
    animationPackageId: OWNERSHIP.animationPackageId,
    ...overrides,
  };
  return {
    ...base,
    integrityHash:
      overrides.integrityHash ??
      computeAssemblyValidationExecutionPlanIntegrityHash({
        executionPlanId: base.executionPlanId,
        orgId: base.orgId,
        workspaceId: base.workspaceId,
        campaignId: base.campaignId,
        storyId: base.storyId,
        storyVersionId: base.storyVersionId,
        animationPackageId: base.animationPackageId,
      }),
  };
}

function definition(
  orderedSceneExecutionIds: string[] = [SCENE_EXEC_A, SCENE_EXEC_B]
): StoryAssemblyDefinition {
  return {
    assemblyDefinitionId: DEF_ID,
    executionPlanId: OWNERSHIP.executionPlanId,
    orgId: OWNERSHIP.orgId,
    workspaceId: OWNERSHIP.workspaceId,
    campaignId: OWNERSHIP.campaignId,
    storyId: OWNERSHIP.storyId,
    storyVersionId: OWNERSHIP.storyVersionId,
    animationPackageId: OWNERSHIP.animationPackageId,
    sceneCount: orderedSceneExecutionIds.length,
    orderedSceneExecutionIds,
    createdBy: "10000000-0000-4000-8000-000000000501",
    createdAt: "2026-08-06T04:00:00.000Z",
    contractVersion: "1",
    deterministicFingerprint: buildAssemblyDefinitionFingerprint({
      executionPlanId: OWNERSHIP.executionPlanId,
      orderedSceneExecutionIds,
    }),
  };
}

function membership(
  sceneExecutionId: string,
  sceneId: string,
  sceneOrder: number,
  membershipId: string
): AssemblySceneMembership {
  return {
    membershipId,
    assemblyDefinitionId: DEF_ID,
    executionPlanId: OWNERSHIP.executionPlanId,
    sceneExecutionId,
    sceneId,
    sceneOrder,
    contractVersion: "1",
    deterministicFingerprint: `sha256:membership-${sceneOrder}`,
  };
}

function sceneResult(
  overrides: Partial<CanonicalSceneResult> &
    Pick<CanonicalSceneResult, "sceneResultId" | "sceneExecutionId" | "sceneId" | "sceneOrder">
): CanonicalSceneResult {
  const { mediaReference: mediaOverride, ...rest } = overrides;
  const contentHash =
    (mediaOverride && mediaOverride.contentHash) ||
    (overrides.sceneOrder === 0 ? HASH_A : HASH_B);
  return {
    sceneRuntimeId: "10000000-0000-5000-8000-000000000601",
    executionPlanId: OWNERSHIP.executionPlanId,
    ownership: OWNERSHIP,
    status: "SUCCEEDED",
    failureClassification: null,
    durationMs: 4000,
    acceptedAt: "2026-08-06T04:10:00.000Z",
    integrityHash: `sha256:result-${overrides.sceneResultId}`,
    contractVersion: "1",
    ...rest,
    mediaReference:
      mediaOverride === null
        ? null
        : {
            uri: `asset://scene/${overrides.sceneId}.mp4`,
            contentHash,
            mediaType: "video/mp4",
            ...mediaOverride,
          },
  };
}

function media(
  sceneResultId: string,
  overrides: Partial<AssemblySceneMediaMetadata> = {}
): AssemblySceneMediaMetadata {
  return {
    sceneResultId,
    contentHash: sceneResultId === SCENE_RESULT_A ? HASH_A : HASH_B,
    mediaType: "video/mp4",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    durationMs: 4000,
    metadataReadable: true,
    videoStreamCount: 1,
    ...overrides,
  };
}

function validFixture(overrides?: {
  readonly executionPlans?: AssemblyValidationExecutionPlan[];
  readonly assemblyDefinitions?: StoryAssemblyDefinition[];
  readonly memberships?: AssemblySceneMembership[];
  readonly sceneResults?: CanonicalSceneResult[];
  readonly mediaMetadata?: AssemblySceneMediaMetadata[];
}) {
  return createInMemoryAssemblyValidationRepository({
    executionPlans: overrides?.executionPlans ?? [plan()],
    assemblyDefinitions: overrides?.assemblyDefinitions ?? [definition()],
    memberships: overrides?.memberships ?? [
      membership(SCENE_EXEC_A, "scene-a", 0, "10000000-0000-4000-8000-000000000701"),
      membership(SCENE_EXEC_B, "scene-b", 1, "10000000-0000-4000-8000-000000000702"),
    ],
    sceneResults: overrides?.sceneResults ?? [
      sceneResult({
        sceneResultId: SCENE_RESULT_A,
        sceneExecutionId: SCENE_EXEC_A,
        sceneId: "scene-a",
        sceneOrder: 0,
      }),
      sceneResult({
        sceneResultId: SCENE_RESULT_B,
        sceneExecutionId: SCENE_EXEC_B,
        sceneId: "scene-b",
        sceneOrder: 1,
      }),
    ],
    mediaMetadata: overrides?.mediaMetadata ?? [
      media(SCENE_RESULT_A),
      media(SCENE_RESULT_B),
    ],
  });
}

async function validate(
  repository = validFixture(),
  ownership: AssemblyValidationOwnershipExpectation = OWNERSHIP
) {
  return validateAssemblyInputs(
    { repository },
    { executionPlanId: OWNERSHIP.executionPlanId, ownership }
  );
}

function classificationsOf(result: Awaited<ReturnType<typeof validate>>) {
  if (result.ok) return [];
  return result.issues.map((row) => row.classification);
}

describe("Sprint 3 PR 3.6 Phase 2 — assembly validation", () => {
  it("accepts a valid assembly validation graph", async () => {
    const result = await validate();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.orderedSceneResultIds).toEqual([SCENE_RESULT_A, SCENE_RESULT_B]);
      expect(result.orderedSceneContentHashes).toEqual([HASH_A, HASH_B]);
    }
  });

  it("fails closed for missing Execution Plan", async () => {
    const result = await validate(
      createInMemoryAssemblyValidationRepository({
        executionPlans: [],
        assemblyDefinitions: [definition()],
      })
    );
    expect(result.ok).toBe(false);
    expect(classificationsOf(result)).toContain("ASSEMBLY_DEFINITION_INVALID");
    expect(result.ok === false && result.issues[0]?.message).toMatch(/Execution Plan does not exist/);
  });

  it("fails closed for missing Assembly Definition", async () => {
    const result = await validate(
      createInMemoryAssemblyValidationRepository({
        executionPlans: [plan()],
        assemblyDefinitions: [],
      })
    );
    expect(result.ok).toBe(false);
    expect(classificationsOf(result)).toContain("ASSEMBLY_DEFINITION_INVALID");
  });

  it("fails closed for duplicate membership", async () => {
    const result = await validate(
      validFixture({
        memberships: [
          membership(SCENE_EXEC_A, "scene-a", 0, "10000000-0000-4000-8000-000000000701"),
          membership(SCENE_EXEC_A, "scene-a-dup", 1, "10000000-0000-4000-8000-000000000702"),
        ],
        assemblyDefinitions: [definition([SCENE_EXEC_A, SCENE_EXEC_A])],
      })
    );
    expect(result.ok).toBe(false);
    expect(classificationsOf(result)).toContain("ASSEMBLY_MEMBERSHIP_INVALID");
  });

  it("fails closed for duplicate scene order", async () => {
    const result = await validate(
      validFixture({
        memberships: [
          membership(SCENE_EXEC_A, "scene-a", 0, "10000000-0000-4000-8000-000000000701"),
          membership(SCENE_EXEC_B, "scene-b", 0, "10000000-0000-4000-8000-000000000702"),
        ],
      })
    );
    expect(result.ok).toBe(false);
    expect(classificationsOf(result)).toContain("ASSEMBLY_ORDER_INVALID");
  });

  it("fails closed for foreign Scene Result", async () => {
    const foreignResultId = "10000000-0000-5000-8000-000000000399";
    const foreignExecutionId = "10000000-0000-4000-8000-000000000299";
    const result = await validate(
      validFixture({
        sceneResults: [
          sceneResult({
            sceneResultId: SCENE_RESULT_A,
            sceneExecutionId: SCENE_EXEC_A,
            sceneId: "scene-a",
            sceneOrder: 0,
          }),
          sceneResult({
            sceneResultId: SCENE_RESULT_B,
            sceneExecutionId: SCENE_EXEC_B,
            sceneId: "scene-b",
            sceneOrder: 1,
          }),
          sceneResult({
            sceneResultId: foreignResultId,
            sceneExecutionId: foreignExecutionId,
            sceneId: "scene-foreign",
            sceneOrder: 9,
          }),
        ],
        mediaMetadata: [
          media(SCENE_RESULT_A),
          media(SCENE_RESULT_B),
          media(foreignResultId, { contentHash: HASH_B }),
        ],
      })
    );
    expect(result.ok).toBe(false);
    expect(classificationsOf(result)).toContain("SCENE_RESULT_CONFLICT");
  });

  it("fails closed for missing Scene Result", async () => {
    const result = await validate(
      validFixture({
        sceneResults: [
          sceneResult({
            sceneResultId: SCENE_RESULT_A,
            sceneExecutionId: SCENE_EXEC_A,
            sceneId: "scene-a",
            sceneOrder: 0,
          }),
        ],
        mediaMetadata: [media(SCENE_RESULT_A)],
      })
    );
    expect(result.ok).toBe(false);
    expect(classificationsOf(result)).toContain("SCENE_RESULT_MISSING");
  });

  it("fails closed for Scene Result FAILED", async () => {
    const result = await validate(
      validFixture({
        sceneResults: [
          sceneResult({
            sceneResultId: SCENE_RESULT_A,
            sceneExecutionId: SCENE_EXEC_A,
            sceneId: "scene-a",
            sceneOrder: 0,
          }),
          sceneResult({
            sceneResultId: SCENE_RESULT_B,
            sceneExecutionId: SCENE_EXEC_B,
            sceneId: "scene-b",
            sceneOrder: 1,
            status: "FAILED",
            failureClassification: "PROVIDER_FAILED",
            mediaReference: null,
            durationMs: null,
          }),
        ],
        mediaMetadata: [media(SCENE_RESULT_A)],
      })
    );
    expect(result.ok).toBe(false);
    expect(classificationsOf(result)).toContain("SCENE_RESULT_FAILED");
  });

  it("fails closed for ownership mismatch", async () => {
    const result = await validate(
      validFixture(),
      {
        ...OWNERSHIP,
        workspaceId: "10000000-0000-4000-8000-000000000099",
      }
    );
    expect(result.ok).toBe(false);
    expect(classificationsOf(result)).toContain("ASSEMBLY_DEFINITION_INVALID");
  });

  it("fails closed for invalid media metadata", async () => {
    const result = await validate(
      validFixture({
        mediaMetadata: [
          media(SCENE_RESULT_A, { metadataReadable: false }),
          media(SCENE_RESULT_B),
        ],
      })
    );
    expect(result.ok).toBe(false);
    expect(classificationsOf(result)).toContain("SCENE_MEDIA_CORRUPTED");
  });

  it("fails closed for unsupported codec", async () => {
    const result = await validate(
      validFixture({
        mediaMetadata: [
          media(SCENE_RESULT_A, { videoCodec: "vp9" }),
          media(SCENE_RESULT_B),
        ],
      })
    );
    expect(result.ok).toBe(false);
    expect(classificationsOf(result)).toContain("SCENE_MEDIA_UNSUPPORTED");
  });

  it("fails closed for unsupported container", async () => {
    const result = await validate(
      validFixture({
        mediaMetadata: [
          media(SCENE_RESULT_A, { container: "webm" }),
          media(SCENE_RESULT_B),
        ],
      })
    );
    expect(result.ok).toBe(false);
    expect(classificationsOf(result)).toContain("SCENE_MEDIA_UNSUPPORTED");
  });

  it("fails closed for invalid duration", async () => {
    const result = await validate(
      validFixture({
        sceneResults: [
          sceneResult({
            sceneResultId: SCENE_RESULT_A,
            sceneExecutionId: SCENE_EXEC_A,
            sceneId: "scene-a",
            sceneOrder: 0,
            durationMs: 4000,
          }),
          sceneResult({
            sceneResultId: SCENE_RESULT_B,
            sceneExecutionId: SCENE_EXEC_B,
            sceneId: "scene-b",
            sceneOrder: 1,
            durationMs: 4000,
          }),
        ],
        mediaMetadata: [
          media(SCENE_RESULT_A),
          media(SCENE_RESULT_B, { durationMs: 0 }),
        ],
      })
    );
    expect(result.ok).toBe(false);
    expect(classificationsOf(result)).toContain("SCENE_MEDIA_CORRUPTED");
  });

  it("is deterministic under equivalent validation replay", async () => {
    const repository = validFixture();
    const first = await validate(repository);
    const second = await validate(repository);
    expect(first).toEqual(second);
    expect(first.validationFingerprint).toBe(second.validationFingerprint);
  });
});
