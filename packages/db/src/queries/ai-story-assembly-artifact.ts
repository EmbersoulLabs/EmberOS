/**
 * Sprint 3 PR 3.6 — Assembly Runtime artifact persistence (metadata only).
 * Append/converge by execution identity. No update/delete. No Final Story Result.
 */
import { eq } from "drizzle-orm";
import {
  AssemblyArtifactSchema,
  type AssemblyArtifact,
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

export type AssemblyArtifactPersistenceErrorCode =
  | "ASSEMBLY_ARTIFACT_IDENTITY_CONFLICT"
  | "ASSEMBLY_ARTIFACT_OWNERSHIP_INVALID"
  | "ASSEMBLY_ARTIFACT_NOT_FOUND";

export class AssemblyArtifactPersistenceError extends Error {
  readonly status: number;

  constructor(
    readonly code: AssemblyArtifactPersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AssemblyArtifactPersistenceError";
    this.status =
      code === "ASSEMBLY_ARTIFACT_OWNERSHIP_INVALID"
        ? 403
        : code === "ASSEMBLY_ARTIFACT_NOT_FOUND"
          ? 404
          : 409;
  }
}

export type PersistAssemblyArtifactResult = {
  readonly artifact: AssemblyArtifact;
  readonly replayed: boolean;
};

export interface AssemblyArtifactRepository {
  getByArtifactId(artifactId: string): Promise<AssemblyArtifact | null>;
  getByAssemblyJobId(assemblyJobId: string): Promise<AssemblyArtifact | null>;
  getByExecutionIdentity(executionIdentity: string): Promise<AssemblyArtifact | null>;
  getByContentHash(contentHash: string): Promise<AssemblyArtifact | null>;
  persistOrConverge(
    artifact: AssemblyArtifact,
    executionIdentity: string
  ): Promise<PersistAssemblyArtifactResult>;
}

function toArtifact(
  row: typeof schema.aiStoryAssemblyArtifacts.$inferSelect
): AssemblyArtifact {
  return AssemblyArtifactSchema.parse(row.artifact);
}

function equivalencePayload(artifact: AssemblyArtifact): unknown {
  return {
    artifactId: artifact.artifactId,
    assemblyJobId: artifact.assemblyJobId,
    executionPlanId: artifact.executionPlanId,
    ownership: artifact.ownership,
    artifactReference: artifact.artifactReference,
    contentHash: artifact.contentHash,
    mediaType: artifact.mediaType,
    durationMs: artifact.durationMs,
    width: artifact.width,
    height: artifact.height,
    frameRate: artifact.frameRate,
    byteSize: artifact.byteSize,
    assemblyEngineVersion: artifact.assemblyEngineVersion,
    normalizationPolicyVersion: artifact.normalizationPolicyVersion,
    assemblyRuntimeContractVersion: artifact.assemblyRuntimeContractVersion,
    integrityHash: artifact.integrityHash,
  };
}

async function validateArtifactOwnership(
  db: QueryDb,
  artifact: AssemblyArtifact
): Promise<void> {
  const [plan] = await db
    .select()
    .from(schema.aiStoryExecutionPlans)
    .where(eq(schema.aiStoryExecutionPlans.id, artifact.executionPlanId))
    .limit(1);
  if (!plan) {
    throw new AssemblyArtifactPersistenceError(
      "ASSEMBLY_ARTIFACT_OWNERSHIP_INVALID",
      "Execution Plan not found for Assembly artifact"
    );
  }
  await assertExecutionPlanOwnershipChain(plan, db);
  const expected = planOwnershipFromRow(plan);
  try {
    assertPlanOwnershipColumnsMatch(
      expected,
      {
        orgId: artifact.ownership.orgId,
        workspaceId: artifact.ownership.workspaceId,
        campaignId: artifact.ownership.campaignId,
        storyId: artifact.ownership.storyId,
        storyVersionId: artifact.ownership.storyVersionId,
        animationPackageId: artifact.ownership.animationPackageId,
        executionPlanId: artifact.executionPlanId,
      },
      "AssemblyArtifact"
    );
  } catch (error) {
    if (error instanceof OwnershipIntegrityViolationError) {
      throw new AssemblyArtifactPersistenceError(
        "ASSEMBLY_ARTIFACT_OWNERSHIP_INVALID",
        error.message
      );
    }
    throw error;
  }

  const [job] = await db
    .select()
    .from(schema.aiStoryAssemblyJobs)
    .where(eq(schema.aiStoryAssemblyJobs.assemblyJobId, artifact.assemblyJobId))
    .limit(1);
  if (!job) {
    throw new AssemblyArtifactPersistenceError(
      "ASSEMBLY_ARTIFACT_OWNERSHIP_INVALID",
      "Assembly Job not found for Assembly artifact"
    );
  }
  if (job.executionPlanId !== artifact.executionPlanId) {
    throw new AssemblyArtifactPersistenceError(
      "ASSEMBLY_ARTIFACT_OWNERSHIP_INVALID",
      "Assembly artifact Execution Plan does not match Assembly Job"
    );
  }
  if (
    job.orgId !== artifact.ownership.orgId ||
    job.workspaceId !== artifact.ownership.workspaceId
  ) {
    throw new AssemblyArtifactPersistenceError(
      "ASSEMBLY_ARTIFACT_OWNERSHIP_INVALID",
      "Assembly artifact ownership does not match Assembly Job"
    );
  }
}

function assertEquivalentArtifact(
  existing: AssemblyArtifact,
  requested: AssemblyArtifact
): void {
  if (
    existing.artifactId !== requested.artifactId ||
    existing.integrityHash !== requested.integrityHash ||
    canonicalPersistenceHash(equivalencePayload(existing)) !==
      canonicalPersistenceHash(equivalencePayload(requested))
  ) {
    throw new AssemblyArtifactPersistenceError(
      "ASSEMBLY_ARTIFACT_IDENTITY_CONFLICT",
      "Conflicting Assembly artifact identity"
    );
  }
}

export class AssemblyArtifactRepositoryImpl implements AssemblyArtifactRepository {
  constructor(private readonly db: Db = getDb()) {}

  async getByArtifactId(artifactId: string): Promise<AssemblyArtifact | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStoryAssemblyArtifacts)
      .where(eq(schema.aiStoryAssemblyArtifacts.artifactId, artifactId))
      .limit(1);
    return row ? toArtifact(row) : null;
  }

  async getByAssemblyJobId(assemblyJobId: string): Promise<AssemblyArtifact | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStoryAssemblyArtifacts)
      .where(eq(schema.aiStoryAssemblyArtifacts.assemblyJobId, assemblyJobId))
      .limit(1);
    return row ? toArtifact(row) : null;
  }

  async getByExecutionIdentity(
    executionIdentity: string
  ): Promise<AssemblyArtifact | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStoryAssemblyArtifacts)
      .where(eq(schema.aiStoryAssemblyArtifacts.executionIdentity, executionIdentity))
      .limit(1);
    return row ? toArtifact(row) : null;
  }

  async getByContentHash(contentHash: string): Promise<AssemblyArtifact | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStoryAssemblyArtifacts)
      .where(eq(schema.aiStoryAssemblyArtifacts.contentHash, contentHash))
      .limit(1);
    return row ? toArtifact(row) : null;
  }

  async persistOrConverge(
    input: AssemblyArtifact,
    executionIdentity: string
  ): Promise<PersistAssemblyArtifactResult> {
    const artifact = AssemblyArtifactSchema.parse(input);

    return this.db.transaction(async (tx) => {
      await validateArtifactOwnership(tx, artifact);

      const [byId] = await tx
        .select()
        .from(schema.aiStoryAssemblyArtifacts)
        .where(eq(schema.aiStoryAssemblyArtifacts.artifactId, artifact.artifactId))
        .limit(1);
      if (byId) {
        const existing = toArtifact(byId);
        assertEquivalentArtifact(existing, artifact);
        return { artifact: existing, replayed: true };
      }

      const [byIdentity] = await tx
        .select()
        .from(schema.aiStoryAssemblyArtifacts)
        .where(eq(schema.aiStoryAssemblyArtifacts.executionIdentity, executionIdentity))
        .limit(1);
      if (byIdentity) {
        const existing = toArtifact(byIdentity);
        assertEquivalentArtifact(existing, artifact);
        return { artifact: existing, replayed: true };
      }

      const [byJob] = await tx
        .select()
        .from(schema.aiStoryAssemblyArtifacts)
        .where(eq(schema.aiStoryAssemblyArtifacts.assemblyJobId, artifact.assemblyJobId))
        .limit(1);
      if (byJob) {
        const existing = toArtifact(byJob);
        assertEquivalentArtifact(existing, artifact);
        return { artifact: existing, replayed: true };
      }

      try {
        await tx.insert(schema.aiStoryAssemblyArtifacts).values({
          artifactId: artifact.artifactId,
          orgId: artifact.ownership.orgId,
          workspaceId: artifact.ownership.workspaceId,
          campaignId: artifact.ownership.campaignId,
          storyId: artifact.ownership.storyId,
          storyVersionId: artifact.ownership.storyVersionId,
          animationPackageId: artifact.ownership.animationPackageId,
          executionPlanId: artifact.executionPlanId,
          assemblyJobId: artifact.assemblyJobId,
          executionIdentity,
          artifactReference: artifact.artifactReference,
          contentHash: artifact.contentHash,
          mediaType: artifact.mediaType,
          durationMs: artifact.durationMs,
          width: artifact.width,
          height: artifact.height,
          frameRate: artifact.frameRate,
          byteSize: artifact.byteSize,
          assemblyEngineVersion: artifact.assemblyEngineVersion,
          normalizationPolicyVersion: artifact.normalizationPolicyVersion,
          assemblyRuntimeContractVersion: artifact.assemblyRuntimeContractVersion,
          integrityHash: artifact.integrityHash,
          artifact,
          createdAt: new Date(artifact.createdAt),
        });
        return { artifact, replayed: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/unique|duplicate/i.test(message)) throw error;

        const [reloaded] = await tx
          .select()
          .from(schema.aiStoryAssemblyArtifacts)
          .where(eq(schema.aiStoryAssemblyArtifacts.artifactId, artifact.artifactId))
          .limit(1);
        if (!reloaded) {
          const [byJobReload] = await tx
            .select()
            .from(schema.aiStoryAssemblyArtifacts)
            .where(
              eq(schema.aiStoryAssemblyArtifacts.assemblyJobId, artifact.assemblyJobId)
            )
            .limit(1);
          if (!byJobReload) {
            throw new AssemblyArtifactPersistenceError(
              "ASSEMBLY_ARTIFACT_IDENTITY_CONFLICT",
              "Assembly artifact uniqueness race failed closed"
            );
          }
          const existing = toArtifact(byJobReload);
          assertEquivalentArtifact(existing, artifact);
          return { artifact: existing, replayed: true };
        }
        const existing = toArtifact(reloaded);
        assertEquivalentArtifact(existing, artifact);
        return { artifact: existing, replayed: true };
      }
    });
  }
}

/** In-memory artifact store for unit/ffmpeg fixtures (no DB). */
export function createInMemoryAssemblyArtifactRepository(): AssemblyArtifactRepository {
  const byId = new Map<string, AssemblyArtifact>();
  const byJob = new Map<string, AssemblyArtifact>();
  const byIdentity = new Map<string, { artifact: AssemblyArtifact; identity: string }>();
  const byHash = new Map<string, AssemblyArtifact>();

  return {
    async getByArtifactId(artifactId) {
      return byId.get(artifactId) ?? null;
    },
    async getByAssemblyJobId(assemblyJobId) {
      return byJob.get(assemblyJobId) ?? null;
    },
    async getByExecutionIdentity(executionIdentity) {
      return byIdentity.get(executionIdentity)?.artifact ?? null;
    },
    async getByContentHash(contentHash) {
      return byHash.get(contentHash) ?? null;
    },
    async persistOrConverge(input, executionIdentity) {
      const artifact = AssemblyArtifactSchema.parse(input);
      const existing =
        byId.get(artifact.artifactId) ??
        byJob.get(artifact.assemblyJobId) ??
        byIdentity.get(executionIdentity)?.artifact ??
        null;
      if (existing) {
        assertEquivalentArtifact(existing, artifact);
        return { artifact: existing, replayed: true };
      }
      byId.set(artifact.artifactId, artifact);
      byJob.set(artifact.assemblyJobId, artifact);
      byIdentity.set(executionIdentity, { artifact, identity: executionIdentity });
      byHash.set(artifact.contentHash, artifact);
      return { artifact, replayed: false };
    },
  };
}

export function listAssemblyArtifactRepositoryMutators(): readonly string[] {
  return [
    "getByArtifactId",
    "getByAssemblyJobId",
    "getByExecutionIdentity",
    "getByContentHash",
    "persistOrConverge",
  ];
}
