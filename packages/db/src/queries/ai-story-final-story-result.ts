/**
 * Sprint 3 PR 3.7 Phase A — Final Story Result persistence.
 *
 * Success-only accept-or-converge. No update()/delete(). No projector/Execute.
 * Unique-violation races converge in a fresh transaction (PR 3.6 lesson).
 */
import { eq } from "drizzle-orm";
import {
  FinalStoryResultPersistenceRecordSchema,
  assertDurableWorkspaceMediaReference,
  buildPersistedFinalStoryResultIdentity,
  parseFinalStoryResultPersistenceRecord,
  type FinalStoryResultPersistenceRecord,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import {
  OwnershipIntegrityViolationError,
  assertExecutionPlanOwnershipChain,
  assertPlanOwnershipColumnsMatch,
  planOwnershipFromRow,
  type QueryDb,
} from "./ai-story-ownership";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type FinalStoryResultPersistenceErrorCode =
  | "FINAL_STORY_RESULT_IDENTITY_CONFLICT"
  | "FINAL_STORY_RESULT_OWNERSHIP_INVALID"
  | "FINAL_STORY_RESULT_NOT_FOUND";

export class FinalStoryResultPersistenceError extends Error {
  readonly status: number;

  constructor(
    readonly code: FinalStoryResultPersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "FinalStoryResultPersistenceError";
    this.status =
      code === "FINAL_STORY_RESULT_OWNERSHIP_INVALID"
        ? 403
        : code === "FINAL_STORY_RESULT_NOT_FOUND"
          ? 404
          : 409;
  }
}

export type AcceptOrConvergeFinalStoryResultResult = {
  readonly result: FinalStoryResultPersistenceRecord;
  readonly replayed: boolean;
};

export interface FinalStoryResultRepository {
  getByFinalStoryResultId(
    finalStoryResultId: string
  ): Promise<FinalStoryResultPersistenceRecord | null>;
  getByExecutionPlanId(
    executionPlanId: string
  ): Promise<FinalStoryResultPersistenceRecord | null>;
  getByAssemblyJobId(
    assemblyJobId: string
  ): Promise<FinalStoryResultPersistenceRecord | null>;
  acceptOrConverge(
    record: FinalStoryResultPersistenceRecord
  ): Promise<AcceptOrConvergeFinalStoryResultResult>;
}

function toRecord(
  row: typeof schema.aiStoryFinalStoryResults.$inferSelect
): FinalStoryResultPersistenceRecord {
  return parseFinalStoryResultPersistenceRecord(row.result);
}

function equivalencePayload(record: FinalStoryResultPersistenceRecord): unknown {
  return {
    finalStoryResultId: record.finalStoryResultId,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    campaignId: record.campaignId,
    storyId: record.storyId,
    storyVersionId: record.storyVersionId,
    animationPackageId: record.animationPackageId,
    executionPlanId: record.executionPlanId,
    assemblyDefinitionId: record.assemblyDefinitionId,
    assemblyJobId: record.assemblyJobId,
    assemblyArtifactId: record.assemblyArtifactId,
    assemblyJobIdentity: record.assemblyJobIdentity,
    orderedSceneResultIds: record.orderedSceneResultIds,
    outputMediaReference: record.outputMediaReference,
    contentHash: record.contentHash,
    mediaType: record.mediaType,
    totalDurationMs: record.totalDurationMs,
    width: record.width,
    height: record.height,
    frameRate: record.frameRate,
    assemblyRuntimeContractVersion: record.assemblyRuntimeContractVersion,
    assemblyEngineVersion: record.assemblyEngineVersion,
    normalizationPolicyVersion: record.normalizationPolicyVersion,
    finalStoryResultContractVersion: record.finalStoryResultContractVersion,
    assemblyEngineSnapshotHash: record.assemblyEngineSnapshotHash,
    projectionVersion: record.projectionVersion,
    integrityHash: record.integrityHash,
    ownership: record.ownership,
  };
}

function assertEquivalentRecord(
  existing: FinalStoryResultPersistenceRecord,
  requested: FinalStoryResultPersistenceRecord
): void {
  if (
    existing.finalStoryResultId !== requested.finalStoryResultId ||
    existing.integrityHash !== requested.integrityHash ||
    canonicalPersistenceHash(equivalencePayload(existing)) !==
      canonicalPersistenceHash(equivalencePayload(requested))
  ) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_IDENTITY_CONFLICT",
      "Conflicting Final Story Result identity replay rejected"
    );
  }
}

/**
 * PostgreSQL unique_violation (23505). After conflict the current transaction
 * is aborted — converge only in a fresh transaction.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      const code = (current as { code?: unknown }).code;
      if (code === "23505" || code === 23505) return true;
      const message = (current as { message?: unknown }).message;
      if (typeof message === "string" && /unique|duplicate/i.test(message)) {
        return true;
      }
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }
  return false;
}

async function loadById(
  db: QueryDb,
  finalStoryResultId: string
): Promise<FinalStoryResultPersistenceRecord | null> {
  const [row] = await db
    .select()
    .from(schema.aiStoryFinalStoryResults)
    .where(eq(schema.aiStoryFinalStoryResults.finalStoryResultId, finalStoryResultId))
    .limit(1);
  return row ? toRecord(row) : null;
}

async function loadByAssemblyJobId(
  db: QueryDb,
  assemblyJobId: string
): Promise<FinalStoryResultPersistenceRecord | null> {
  const [row] = await db
    .select()
    .from(schema.aiStoryFinalStoryResults)
    .where(eq(schema.aiStoryFinalStoryResults.assemblyJobId, assemblyJobId))
    .limit(1);
  return row ? toRecord(row) : null;
}

async function loadByJobIdentity(
  db: QueryDb,
  assemblyJobIdentity: string
): Promise<FinalStoryResultPersistenceRecord | null> {
  const [row] = await db
    .select()
    .from(schema.aiStoryFinalStoryResults)
    .where(eq(schema.aiStoryFinalStoryResults.assemblyJobIdentity, assemblyJobIdentity))
    .limit(1);
  return row ? toRecord(row) : null;
}

async function loadByExecutionPlanId(
  db: QueryDb,
  executionPlanId: string
): Promise<FinalStoryResultPersistenceRecord | null> {
  const [row] = await db
    .select()
    .from(schema.aiStoryFinalStoryResults)
    .where(eq(schema.aiStoryFinalStoryResults.executionPlanId, executionPlanId))
    .limit(1);
  return row ? toRecord(row) : null;
}

async function validateOwnership(
  db: QueryDb,
  record: FinalStoryResultPersistenceRecord
): Promise<void> {
  try {
    assertDurableWorkspaceMediaReference(
      record.workspaceId,
      record.outputMediaReference
    );
  } catch (error) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      error instanceof Error ? error.message : String(error)
    );
  }

  const [plan] = await db
    .select()
    .from(schema.aiStoryExecutionPlans)
    .where(eq(schema.aiStoryExecutionPlans.id, record.executionPlanId))
    .limit(1);
  if (!plan) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Execution Plan not found for Final Story Result"
    );
  }

  await assertExecutionPlanOwnershipChain(plan, db);
  const expected = planOwnershipFromRow(plan);
  try {
    assertPlanOwnershipColumnsMatch(
      expected,
      {
        orgId: record.orgId,
        workspaceId: record.workspaceId,
        campaignId: record.campaignId,
        storyId: record.storyId,
        storyVersionId: record.storyVersionId,
        animationPackageId: record.animationPackageId,
        executionPlanId: record.executionPlanId,
      },
      "FinalStoryResult"
    );
  } catch (error) {
    if (error instanceof OwnershipIntegrityViolationError) {
      throw new FinalStoryResultPersistenceError(
        "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
        error.message
      );
    }
    throw error;
  }

  const [definition] = await db
    .select()
    .from(schema.aiStoryAssemblyDefinitions)
    .where(
      eq(
        schema.aiStoryAssemblyDefinitions.assemblyDefinitionId,
        record.assemblyDefinitionId
      )
    )
    .limit(1);
  if (!definition) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly Definition not found for Final Story Result"
    );
  }
  if (definition.executionPlanId !== record.executionPlanId) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly Definition does not match Execution Plan"
    );
  }
  if (
    definition.orgId !== record.orgId ||
    definition.workspaceId !== record.workspaceId ||
    definition.campaignId !== record.campaignId ||
    definition.storyId !== record.storyId
  ) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly Definition ownership does not match Final Story Result"
    );
  }

  const [job] = await db
    .select()
    .from(schema.aiStoryAssemblyJobs)
    .where(eq(schema.aiStoryAssemblyJobs.assemblyJobId, record.assemblyJobId))
    .limit(1);
  if (!job) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly Job not found for Final Story Result"
    );
  }
  if (job.executionPlanId !== record.executionPlanId) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly Job Execution Plan does not match Final Story Result"
    );
  }
  if (job.assemblyDefinitionId !== record.assemblyDefinitionId) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly Job definition does not match Final Story Result"
    );
  }
  if (job.deterministicFingerprint !== record.assemblyJobIdentity) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly Job identity does not match Final Story Result"
    );
  }
  if (
    job.orgId !== record.orgId ||
    job.workspaceId !== record.workspaceId ||
    job.campaignId !== record.campaignId ||
    job.storyId !== record.storyId
  ) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly Job ownership does not match Final Story Result"
    );
  }

  const derived = buildPersistedFinalStoryResultIdentity({
    assemblyJobId: record.assemblyJobId,
    assemblyJobIdentity: record.assemblyJobIdentity,
    finalMediaContentHash: record.contentHash,
    assemblyEngineSnapshotHash: record.assemblyEngineSnapshotHash,
    finalStoryResultContractVersion: record.finalStoryResultContractVersion,
  });
  if (derived.finalStoryResultId !== record.finalStoryResultId) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_IDENTITY_CONFLICT",
      "finalStoryResultId does not match frozen PR 3.6 identity derivation"
    );
  }
  if (job.assemblyEngineSnapshotHash !== record.assemblyEngineSnapshotHash) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly engine snapshot hash does not match Assembly Job"
    );
  }

  const [artifact] = await db
    .select()
    .from(schema.aiStoryAssemblyArtifacts)
    .where(eq(schema.aiStoryAssemblyArtifacts.artifactId, record.assemblyArtifactId))
    .limit(1);
  if (!artifact) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly Artifact not found for Final Story Result"
    );
  }
  if (artifact.assemblyJobId !== record.assemblyJobId) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly Artifact does not match Assembly Job"
    );
  }
  if (artifact.executionPlanId !== record.executionPlanId) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly Artifact Execution Plan does not match Final Story Result"
    );
  }
  if (artifact.contentHash !== record.contentHash) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Final Story Result content hash does not match Assembly Artifact"
    );
  }
  if (artifact.artifactReference !== record.outputMediaReference) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Final Story Result media reference does not match Assembly Artifact"
    );
  }
  if (
    artifact.orgId !== record.orgId ||
    artifact.workspaceId !== record.workspaceId
  ) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_OWNERSHIP_INVALID",
      "Assembly Artifact ownership does not match Final Story Result"
    );
  }
}

async function convergeExisting(
  tx: Tx,
  record: FinalStoryResultPersistenceRecord
): Promise<AcceptOrConvergeFinalStoryResultResult> {
  await validateOwnership(tx, record);

  const existing =
    (await loadById(tx, record.finalStoryResultId)) ??
    (await loadByAssemblyJobId(tx, record.assemblyJobId)) ??
    (await loadByJobIdentity(tx, record.assemblyJobIdentity));
  if (!existing) {
    throw new FinalStoryResultPersistenceError(
      "FINAL_STORY_RESULT_IDENTITY_CONFLICT",
      "Final Story Result uniqueness race failed closed"
    );
  }
  assertEquivalentRecord(existing, record);
  return { result: existing, replayed: true };
}

export class FinalStoryResultRepositoryImpl implements FinalStoryResultRepository {
  constructor(private readonly db: Db = getDb()) {}

  async getByFinalStoryResultId(
    finalStoryResultId: string
  ): Promise<FinalStoryResultPersistenceRecord | null> {
    return loadById(this.db, finalStoryResultId);
  }

  async getByExecutionPlanId(
    executionPlanId: string
  ): Promise<FinalStoryResultPersistenceRecord | null> {
    return loadByExecutionPlanId(this.db, executionPlanId);
  }

  async getByAssemblyJobId(
    assemblyJobId: string
  ): Promise<FinalStoryResultPersistenceRecord | null> {
    return loadByAssemblyJobId(this.db, assemblyJobId);
  }

  async acceptOrConverge(
    input: FinalStoryResultPersistenceRecord
  ): Promise<AcceptOrConvergeFinalStoryResultResult> {
    const record = FinalStoryResultPersistenceRecordSchema.parse(
      parseFinalStoryResultPersistenceRecord(input)
    );

    try {
      return await this.db.transaction(async (tx) => {
        await validateOwnership(tx, record);

        const existingById = await loadById(tx, record.finalStoryResultId);
        if (existingById) {
          assertEquivalentRecord(existingById, record);
          return { result: existingById, replayed: true };
        }

        const existingByJob = await loadByAssemblyJobId(tx, record.assemblyJobId);
        if (existingByJob) {
          assertEquivalentRecord(existingByJob, record);
          return { result: existingByJob, replayed: true };
        }

        const existingByIdentity = await loadByJobIdentity(
          tx,
          record.assemblyJobIdentity
        );
        if (existingByIdentity) {
          assertEquivalentRecord(existingByIdentity, record);
          return { result: existingByIdentity, replayed: true };
        }

        await tx.insert(schema.aiStoryFinalStoryResults).values({
          finalStoryResultId: record.finalStoryResultId,
          orgId: record.orgId,
          workspaceId: record.workspaceId,
          campaignId: record.campaignId,
          storyId: record.storyId,
          storyVersionId: record.storyVersionId,
          animationPackageId: record.animationPackageId,
          executionPlanId: record.executionPlanId,
          assemblyDefinitionId: record.assemblyDefinitionId,
          assemblyJobId: record.assemblyJobId,
          assemblyArtifactId: record.assemblyArtifactId,
          assemblyJobIdentity: record.assemblyJobIdentity,
          orderedSceneResultIds: [...record.orderedSceneResultIds],
          outputMediaReference: record.outputMediaReference,
          contentHash: record.contentHash,
          mediaType: record.mediaType,
          totalDurationMs: record.totalDurationMs,
          width: record.width,
          height: record.height,
          frameRate: record.frameRate,
          assemblyRuntimeContractVersion: record.assemblyRuntimeContractVersion,
          assemblyEngineVersion: record.assemblyEngineVersion,
          normalizationPolicyVersion: record.normalizationPolicyVersion,
          finalStoryResultContractVersion: record.finalStoryResultContractVersion,
          assemblyEngineSnapshotHash: record.assemblyEngineSnapshotHash,
          acceptedAt: new Date(record.acceptedAt),
          projectedAt: new Date(record.projectedAt),
          projectionVersion: record.projectionVersion,
          integrityHash: record.integrityHash,
          result: record,
        });
        return { result: record, replayed: false };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.db.transaction(async (tx) => convergeExisting(tx, record));
    }
  }
}

export function listFinalStoryResultRepositoryMutators(): readonly string[] {
  return [
    "getByFinalStoryResultId",
    "getByExecutionPlanId",
    "getByAssemblyJobId",
    "acceptOrConverge",
  ];
}
