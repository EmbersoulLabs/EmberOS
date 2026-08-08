/**
 * Sprint 3 PR 3.7 Phase A — Final Story Result persistence contract freezes.
 */
import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_FINAL_RESULT_CONTRACT_VERSION,
  FinalStoryResultSchema,
  PR31_FINAL_STORY_RESULT_SCHEMA_AUTHORITATIVE_FOR_PERSISTENCE,
  assertDurableWorkspaceMediaReference,
  buildFinalStoryResultIdentity,
  buildFinalStoryResultPersistenceRecord,
  buildPersistedFinalStoryResultIdentity,
  parseFinalStoryResultPersistenceRecord,
} from "@ceo-agent/shared/server";

const OWNERSHIP = {
  orgId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  campaignId: "10000000-0000-4000-8000-000000000003",
  storyId: "10000000-0000-4000-8000-000000000004",
  storyVersionId: "10000000-0000-4000-8000-000000000005",
  animationPackageId: "10000000-0000-4000-8000-000000000006",
  executionPlanId: "10000000-0000-4000-8000-000000000010",
} as const;

const JOB_ID = "10000000-0000-4000-8000-000000000020";
const JOB_IDENTITY =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ENGINE_HASH =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CONTENT_HASH =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

describe("Sprint 3 PR 3.7 Phase A Final Story Result contracts", () => {
  it("marks PR 3.1 FinalStoryResultSchema as non-authoritative for persistence", () => {
    expect(PR31_FINAL_STORY_RESULT_SCHEMA_AUTHORITATIVE_FOR_PERSISTENCE).toBe(false);
    const legacy = FinalStoryResultSchema.parse({
      storyResultId: "10000000-0000-4000-8000-000000000099",
      executionPlanId: OWNERSHIP.executionPlanId,
      runtimeAuthorizationId: "10000000-0000-4000-8000-000000000098",
      ownership: OWNERSHIP,
      orderedSceneResultIds: ["10000000-0000-4000-8000-000000000031"],
      orderedSceneExecutionIds: ["10000000-0000-4000-8000-000000000032"],
      status: "FAILED",
      failureClassification: "PROVIDER_FAILED",
      mediaReference: null,
      completedAt: "2026-08-08T00:00:00.000Z",
      integrityHash:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      contractVersion: "1",
    });
    expect(legacy.status).toBe("FAILED");
  });

  it("builds success-only persistence records without FAILED/provider/export fields", () => {
    const record = buildFinalStoryResultPersistenceRecord({
      ownership: OWNERSHIP,
      assemblyDefinitionId: "10000000-0000-4000-8000-000000000021",
      assemblyJobId: JOB_ID,
      assemblyJobIdentity: JOB_IDENTITY,
      assemblyArtifactId: "10000000-0000-4000-8000-000000000022",
      orderedSceneResultIds: [
        "10000000-0000-4000-8000-000000000031",
        "10000000-0000-4000-8000-000000000032",
      ],
      outputMediaReference: `${OWNERSHIP.workspaceId}/assembly/${JOB_ID}/out.mp4`,
      contentHash: CONTENT_HASH,
      totalDurationMs: 4000,
      width: 1280,
      height: 720,
      frameRate: 30,
      assemblyEngineSnapshotHash: ENGINE_HASH,
      acceptedAt: "2026-08-08T10:00:00.000Z",
      projectedAt: "2026-08-08T10:00:01.000Z",
    });
    expect(record.mediaType).toBe("video/mp4");
    expect(record.finalStoryResultContractVersion).toBe(
      ASSEMBLY_FINAL_RESULT_CONTRACT_VERSION
    );
    expect(record).not.toHaveProperty("status");
    expect(record).not.toHaveProperty("exportState");
    expect(record).not.toHaveProperty("publishState");
    expect(record).not.toHaveProperty("providerId");
  });

  it("rejects forbidden persistence fields", () => {
    const record = buildFinalStoryResultPersistenceRecord({
      ownership: OWNERSHIP,
      assemblyDefinitionId: "10000000-0000-4000-8000-000000000021",
      assemblyJobId: JOB_ID,
      assemblyJobIdentity: JOB_IDENTITY,
      assemblyArtifactId: "10000000-0000-4000-8000-000000000022",
      orderedSceneResultIds: ["10000000-0000-4000-8000-000000000031"],
      outputMediaReference: `${OWNERSHIP.workspaceId}/assembly/${JOB_ID}/out.mp4`,
      contentHash: CONTENT_HASH,
      totalDurationMs: 4000,
      width: 1280,
      height: 720,
      frameRate: 30,
      assemblyEngineSnapshotHash: ENGINE_HASH,
      acceptedAt: "2026-08-08T10:00:00.000Z",
      projectedAt: "2026-08-08T10:00:01.000Z",
    });
    expect(() =>
      parseFinalStoryResultPersistenceRecord({ ...record, status: "FAILED" })
    ).toThrow(/forbidden field 'status'/);
    expect(() =>
      parseFinalStoryResultPersistenceRecord({ ...record, exportState: "ready" })
    ).toThrow(/forbidden field 'exportState'/);
    expect(() =>
      parseFinalStoryResultPersistenceRecord({ ...record, providerId: "seedance" })
    ).toThrow(/forbidden field 'providerId'/);
  });

  it("derives finalStoryResultId from frozen PR 3.6 identity algorithm", () => {
    const persisted = buildPersistedFinalStoryResultIdentity({
      assemblyJobId: JOB_ID,
      assemblyJobIdentity: JOB_IDENTITY,
      finalMediaContentHash: CONTENT_HASH,
      assemblyEngineSnapshotHash: ENGINE_HASH,
    });
    const legacy = buildFinalStoryResultIdentity({
      assemblyJobId: JOB_ID,
      finalMediaContentHash: CONTENT_HASH,
      finalResultContractVersion: "1",
      assemblyEngineSnapshotHash: ENGINE_HASH,
    });
    expect(persisted.finalStoryResultId).toBe(legacy.storyResultId);
    expect(persisted.integrityBindingHash).toBe(legacy.integrityHash);
  });

  it("keeps identity stable and excludes timestamps from integrity", () => {
    const a = buildFinalStoryResultPersistenceRecord({
      ownership: OWNERSHIP,
      assemblyDefinitionId: "10000000-0000-4000-8000-000000000021",
      assemblyJobId: JOB_ID,
      assemblyJobIdentity: JOB_IDENTITY,
      assemblyArtifactId: "10000000-0000-4000-8000-000000000022",
      orderedSceneResultIds: ["10000000-0000-4000-8000-000000000031"],
      outputMediaReference: `${OWNERSHIP.workspaceId}/assembly/${JOB_ID}/out.mp4`,
      contentHash: CONTENT_HASH,
      totalDurationMs: 4000,
      width: 1280,
      height: 720,
      frameRate: 30,
      assemblyEngineSnapshotHash: ENGINE_HASH,
      acceptedAt: "2026-08-08T10:00:00.000Z",
      projectedAt: "2026-08-08T10:00:01.000Z",
    });
    const b = buildFinalStoryResultPersistenceRecord({
      ownership: OWNERSHIP,
      assemblyDefinitionId: "10000000-0000-4000-8000-000000000021",
      assemblyJobId: JOB_ID,
      assemblyJobIdentity: JOB_IDENTITY,
      assemblyArtifactId: "10000000-0000-4000-8000-000000000022",
      orderedSceneResultIds: ["10000000-0000-4000-8000-000000000031"],
      outputMediaReference: `${OWNERSHIP.workspaceId}/assembly/${JOB_ID}/out.mp4`,
      contentHash: CONTENT_HASH,
      totalDurationMs: 4000,
      width: 1280,
      height: 720,
      frameRate: 30,
      assemblyEngineSnapshotHash: ENGINE_HASH,
      acceptedAt: "2026-08-08T11:00:00.000Z",
      projectedAt: "2026-08-08T11:00:01.000Z",
    });
    expect(a.finalStoryResultId).toBe(b.finalStoryResultId);
    expect(a.integrityHash).toBe(b.integrityHash);
  });

  it("rejects signed URLs and temp paths for media references", () => {
    expect(() =>
      assertDurableWorkspaceMediaReference(
        OWNERSHIP.workspaceId,
        `${OWNERSHIP.workspaceId}/assembly/out.mp4?token=abc`
      )
    ).toThrow(/signed URL|http/);
    expect(() =>
      assertDurableWorkspaceMediaReference(
        OWNERSHIP.workspaceId,
        `https://cdn.example/out.mp4`
      )
    ).toThrow(/workspace-scoped/);
    expect(() =>
      assertDurableWorkspaceMediaReference(
        OWNERSHIP.workspaceId,
        `${OWNERSHIP.workspaceId}/tmp/out.mp4`
      )
    ).toThrow(/temporary|absolute/);
    expect(() =>
      assertDurableWorkspaceMediaReference(
        OWNERSHIP.workspaceId,
        `other-workspace/assembly/out.mp4`
      )
    ).toThrow(/workspace-scoped/);
  });
});
