/**
 * Sprint 3 PR 3.6 Phase 3 — deterministic Assembly Job persistence.
 *
 * Accept-or-converge Assembly Jobs + append-only Assembly Job Facts.
 * No Final Story Result. No media assembly. No update()/delete().
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import {
  AssemblyFailedFactSchema,
  AssemblyJobAcceptedFactSchema,
  AssemblyJobFactSchema,
  AssemblyJobSchema,
  AssemblyProcessingStartedFactSchema,
  AssemblySucceededFactSchema,
  assemblyIntegrityHash,
  buildAssemblyJobIdentity,
  type AssemblyJob,
  type AssemblyJobFact,
  type AssemblyJobAcceptedFact,
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

export type AssemblyJobPersistenceErrorCode =
  | "ASSEMBLY_IDENTITY_CONFLICT"
  | "ASSEMBLY_OWNERSHIP_INVALID"
  | "ASSEMBLY_STATE_INVALID"
  | "ASSEMBLY_JOB_NOT_FOUND";

export class AssemblyJobPersistenceError extends Error {
  readonly status: number;

  constructor(
    readonly code: AssemblyJobPersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AssemblyJobPersistenceError";
    this.status =
      code === "ASSEMBLY_OWNERSHIP_INVALID"
        ? 403
        : code === "ASSEMBLY_JOB_NOT_FOUND"
          ? 404
          : 409;
  }
}

export type AcceptOrConvergeAssemblyJobResult = {
  readonly job: AssemblyJob;
  readonly acceptedFact: AssemblyJobAcceptedFact;
  readonly replayed: boolean;
};

export type AppendAssemblyJobFactResult = {
  readonly fact: AssemblyJobFact;
  readonly replayed: boolean;
};

export type AssemblyTerminalAcceptanceLock = {
  readonly assemblyJobId: string;
  readonly job: AssemblyJob;
  /**
   * Runs work while holding SELECT FOR UPDATE on the Assembly Job row.
   * Use for terminal fact appends under concurrency protection.
   */
  readonly run: <T>(
    work: (ctx: {
      readonly job: AssemblyJob;
      readonly appendFact: (
        fact: AssemblyJobFact
      ) => Promise<AppendAssemblyJobFactResult>;
    }) => Promise<T>
  ) => Promise<T>;
};

export interface AssemblyJobRepository {
  getByAssemblyJobId(assemblyJobId: string): Promise<AssemblyJob | null>;
  getByDeterministicFingerprint(
    deterministicFingerprint: string
  ): Promise<AssemblyJob | null>;
  /** Observational read: latest accepted Assembly Job for a plan (Phase E). */
  getLatestByExecutionPlanId(
    executionPlanId: string
  ): Promise<AssemblyJob | null>;
  acceptOrConverge(job: AssemblyJob): Promise<AcceptOrConvergeAssemblyJobResult>;
  acquireTerminalAcceptanceLock(
    assemblyJobId: string
  ): Promise<AssemblyTerminalAcceptanceLock>;
  appendAssemblyJobFact(fact: AssemblyJobFact): Promise<AppendAssemblyJobFactResult>;
  loadAssemblyFacts(assemblyJobId: string): Promise<readonly AssemblyJobFact[]>;
}

function toJob(row: typeof schema.aiStoryAssemblyJobs.$inferSelect): AssemblyJob {
  return AssemblyJobSchema.parse(row.job);
}

function toFact(row: typeof schema.aiStoryAssemblyJobFacts.$inferSelect): AssemblyJobFact {
  return AssemblyJobFactSchema.parse(row.fact);
}

function jobEquivalencePayload(job: AssemblyJob): unknown {
  return {
    assemblyJobId: job.assemblyJobId,
    executionPlanId: job.executionPlanId,
    assemblyDefinitionId: job.assemblyDefinitionId,
    runtimeAuthorizationId: job.runtimeAuthorizationId,
    ownership: job.ownership,
    orderedSceneResultIds: job.orderedSceneResultIds,
    orderedSceneContentHashes: job.orderedSceneContentHashes,
    assemblyContractVersion: job.assemblyContractVersion,
    assemblyEngineSnapshotId: job.assemblyEngineSnapshotId,
    assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
    deterministicFingerprint: job.deterministicFingerprint,
  };
}

function assertEquivalentJob(existing: AssemblyJob, requested: AssemblyJob): void {
  if (
    existing.assemblyJobId !== requested.assemblyJobId ||
    existing.deterministicFingerprint !== requested.deterministicFingerprint ||
    canonicalPersistenceHash(jobEquivalencePayload(existing)) !==
      canonicalPersistenceHash(jobEquivalencePayload(requested))
  ) {
    throw new AssemblyJobPersistenceError(
      "ASSEMBLY_IDENTITY_CONFLICT",
      "Conflicting Assembly Job identity replay rejected"
    );
  }
}

function assertJobIdentityMatchesDerived(job: AssemblyJob): void {
  const derived = buildAssemblyJobIdentity({
    executionPlanId: job.executionPlanId,
    assemblyDefinitionId: job.assemblyDefinitionId,
    orderedSceneResultIds: job.orderedSceneResultIds,
    orderedSceneContentHashes: job.orderedSceneContentHashes,
    assemblyContractVersion: job.assemblyContractVersion,
    assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
  });
  if (
    derived.assemblyJobId !== job.assemblyJobId ||
    derived.deterministicFingerprint !== job.deterministicFingerprint
  ) {
    throw new AssemblyJobPersistenceError(
      "ASSEMBLY_IDENTITY_CONFLICT",
      "Assembly Job identity does not match deterministic fingerprint derivation"
    );
  }
}

/**
 * PostgreSQL unique_violation (23505), including drizzle/postgres.js wrappers.
 * After a unique conflict the current transaction is aborted — callers must
 * converge in a fresh transaction, never via SELECT on the failed tx.
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

async function convergeExistingAcceptedJob(
  tx: Tx,
  job: AssemblyJob
): Promise<AcceptOrConvergeAssemblyJobResult> {
  await validateJobOwnership(tx, job);

  const reloaded =
    (await loadJobById(tx, job.assemblyJobId)) ??
    (await loadJobByFingerprint(tx, job.deterministicFingerprint));
  if (!reloaded) {
    throw new AssemblyJobPersistenceError(
      "ASSEMBLY_IDENTITY_CONFLICT",
      "Assembly Job uniqueness race failed closed"
    );
  }
  assertEquivalentJob(reloaded, job);
  const facts = await loadFacts(tx, reloaded.assemblyJobId);
  const existingAccepted = facts.find((fact) => fact.factKind === "ACCEPTED");
  if (!existingAccepted || existingAccepted.factKind !== "ACCEPTED") {
    throw new AssemblyJobPersistenceError(
      "ASSEMBLY_STATE_INVALID",
      "Converged Assembly Job is missing ACCEPTED fact"
    );
  }
  return {
    job: reloaded,
    acceptedFact: existingAccepted,
    replayed: true,
  };
}

function buildAcceptedFact(job: AssemblyJob): AssemblyJobAcceptedFact {
  const payload = {
    factKind: "ACCEPTED" as const,
    assemblyJobId: job.assemblyJobId,
    executionPlanId: job.executionPlanId,
    ownership: job.ownership,
    assemblyDefinitionId: job.assemblyDefinitionId,
    deterministicFingerprint: job.deterministicFingerprint,
    assemblyEngineSnapshotId: job.assemblyEngineSnapshotId,
    assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
    acceptedAt: job.acceptedAt,
    contractVersion: "1" as const,
  };
  const integrityHash = assemblyIntegrityHash({
    kind: "assembly-job-accepted-fact",
    ...payload,
  });
  return AssemblyJobAcceptedFactSchema.parse({
    ...payload,
    factId: deterministicFactUuid(integrityHash),
    integrityHash,
  });
}

function deterministicFactUuid(integrityHash: string): string {
  const hex = integrityHash.replace(/^sha256:/, "").slice(0, 32);
  const bytes = hex.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const normalized = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
}

async function loadJobById(
  db: QueryDb,
  assemblyJobId: string
): Promise<AssemblyJob | null> {
  const [row] = await db
    .select()
    .from(schema.aiStoryAssemblyJobs)
    .where(eq(schema.aiStoryAssemblyJobs.assemblyJobId, assemblyJobId))
    .limit(1);
  return row ? toJob(row) : null;
}

async function loadJobByFingerprint(
  db: QueryDb,
  deterministicFingerprint: string
): Promise<AssemblyJob | null> {
  const [row] = await db
    .select()
    .from(schema.aiStoryAssemblyJobs)
    .where(
      eq(schema.aiStoryAssemblyJobs.deterministicFingerprint, deterministicFingerprint)
    )
    .limit(1);
  return row ? toJob(row) : null;
}

async function lockAssemblyJobRow(db: QueryDb, assemblyJobId: string): Promise<AssemblyJob> {
  await db.execute(sql`
    select ${schema.aiStoryAssemblyJobs.assemblyJobId}
    from ${schema.aiStoryAssemblyJobs}
    where ${schema.aiStoryAssemblyJobs.assemblyJobId} = ${assemblyJobId}
    for update
  `);
  const job = await loadJobById(db, assemblyJobId);
  if (!job) {
    throw new AssemblyJobPersistenceError(
      "ASSEMBLY_JOB_NOT_FOUND",
      "Assembly Job not found for terminal acceptance lock"
    );
  }
  return job;
}

async function loadFacts(
  db: QueryDb,
  assemblyJobId: string
): Promise<AssemblyJobFact[]> {
  const rows = await db
    .select()
    .from(schema.aiStoryAssemblyJobFacts)
    .where(eq(schema.aiStoryAssemblyJobFacts.assemblyJobId, assemblyJobId))
    .orderBy(asc(schema.aiStoryAssemblyJobFacts.recordedAt));
  return rows.map(toFact);
}

function hasTerminalFact(facts: readonly AssemblyJobFact[]): boolean {
  return facts.some(
    (fact) => fact.factKind === "SUCCEEDED" || fact.factKind === "FAILED"
  );
}

function hasAcceptedFact(facts: readonly AssemblyJobFact[]): boolean {
  return facts.some((fact) => fact.factKind === "ACCEPTED");
}

function assertFactTransition(
  existing: readonly AssemblyJobFact[],
  next: AssemblyJobFact
): void {
  if (next.factKind === "ACCEPTED") {
    if (hasAcceptedFact(existing)) {
      throw new AssemblyJobPersistenceError(
        "ASSEMBLY_STATE_INVALID",
        "Assembly Job already has an ACCEPTED fact"
      );
    }
    return;
  }

  if (!hasAcceptedFact(existing)) {
    throw new AssemblyJobPersistenceError(
      "ASSEMBLY_STATE_INVALID",
      "Assembly Job must be ACCEPTED before appending further facts"
    );
  }

  if (next.factKind === "PROCESSING_STARTED") {
    if (hasTerminalFact(existing)) {
      throw new AssemblyJobPersistenceError(
        "ASSEMBLY_STATE_INVALID",
        "Cannot append PROCESSING_STARTED after a terminal Assembly fact"
      );
    }
    return;
  }

  if (next.factKind === "SUCCEEDED" || next.factKind === "FAILED") {
    if (hasTerminalFact(existing)) {
      throw new AssemblyJobPersistenceError(
        "ASSEMBLY_STATE_INVALID",
        "Assembly Job already has a terminal fact"
      );
    }
    return;
  }
}

function parseFact(input: AssemblyJobFact): AssemblyJobFact {
  switch (input.factKind) {
    case "ACCEPTED":
      return AssemblyJobAcceptedFactSchema.parse(input);
    case "PROCESSING_STARTED":
      return AssemblyProcessingStartedFactSchema.parse(input);
    case "SUCCEEDED":
      return AssemblySucceededFactSchema.parse(input);
    case "FAILED":
      return AssemblyFailedFactSchema.parse(input);
    default: {
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}

async function validateJobOwnership(tx: Tx, job: AssemblyJob): Promise<void> {
  try {
    const [plan] = await tx
      .select()
      .from(schema.aiStoryExecutionPlans)
      .where(eq(schema.aiStoryExecutionPlans.id, job.executionPlanId))
      .limit(1);
    if (!plan) {
      throw new AssemblyJobPersistenceError(
        "ASSEMBLY_OWNERSHIP_INVALID",
        "Execution Plan not found for Assembly Job"
      );
    }

    await assertExecutionPlanOwnershipChain(plan, tx);
    const expected = planOwnershipFromRow(plan);
    assertPlanOwnershipColumnsMatch(
      expected,
      {
        orgId: job.ownership.orgId,
        workspaceId: job.ownership.workspaceId,
        campaignId: job.ownership.campaignId,
        storyId: job.ownership.storyId,
        storyVersionId: job.ownership.storyVersionId,
        animationPackageId: job.ownership.animationPackageId,
        executionPlanId: job.executionPlanId,
      },
      "AssemblyJob"
    );

    const [definition] = await tx
      .select()
      .from(schema.aiStoryAssemblyDefinitions)
      .where(
        eq(
          schema.aiStoryAssemblyDefinitions.assemblyDefinitionId,
          job.assemblyDefinitionId
        )
      )
      .limit(1);
    if (!definition) {
      throw new AssemblyJobPersistenceError(
        "ASSEMBLY_OWNERSHIP_INVALID",
        "Assembly Definition not found for Assembly Job"
      );
    }
    if (definition.executionPlanId !== job.executionPlanId) {
      throw new AssemblyJobPersistenceError(
        "ASSEMBLY_OWNERSHIP_INVALID",
        "Assembly Definition does not belong to Execution Plan"
      );
    }
    assertPlanOwnershipColumnsMatch(
      expected,
      {
        orgId: definition.orgId,
        workspaceId: definition.workspaceId,
        campaignId: definition.campaignId,
        storyId: definition.storyId,
        storyVersionId: definition.storyVersionId,
        animationPackageId: definition.animationPackageId,
        executionPlanId: definition.executionPlanId,
      },
      "Assembly Definition for AssemblyJob"
    );
    if (
      definition.orgId !== job.ownership.orgId ||
      definition.workspaceId !== job.ownership.workspaceId
    ) {
      throw new AssemblyJobPersistenceError(
        "ASSEMBLY_OWNERSHIP_INVALID",
        "Assembly Job ownership does not match Assembly Definition workspace"
      );
    }
  } catch (error) {
    if (error instanceof AssemblyJobPersistenceError) throw error;
    if (error instanceof OwnershipIntegrityViolationError) {
      throw new AssemblyJobPersistenceError(
        "ASSEMBLY_OWNERSHIP_INVALID",
        error.message
      );
    }
    throw error;
  }
}

async function insertFactRow(tx: Tx, fact: AssemblyJobFact): Promise<void> {
  await tx.insert(schema.aiStoryAssemblyJobFacts).values({
    factId: fact.factId,
    orgId: fact.ownership.orgId,
    workspaceId: fact.ownership.workspaceId,
    campaignId: fact.ownership.campaignId,
    storyId: fact.ownership.storyId,
    storyVersionId: fact.ownership.storyVersionId,
    animationPackageId: fact.ownership.animationPackageId,
    executionPlanId: fact.executionPlanId,
    assemblyJobId: fact.assemblyJobId,
    factKind: fact.factKind,
    integrityHash: fact.integrityHash,
    contractVersion: fact.contractVersion,
    fact,
  });
}

async function appendFactInTransaction(
  tx: Tx,
  input: AssemblyJobFact
): Promise<AppendAssemblyJobFactResult> {
  const fact = parseFact(input);
  const job = await lockAssemblyJobRow(tx, fact.assemblyJobId);

  if (fact.executionPlanId !== job.executionPlanId) {
    throw new AssemblyJobPersistenceError(
      "ASSEMBLY_IDENTITY_CONFLICT",
      "Assembly fact execution plan does not match Assembly Job"
    );
  }
  try {
    assertPlanOwnershipColumnsMatch(
      {
        orgId: job.ownership.orgId,
        workspaceId: job.ownership.workspaceId,
        campaignId: job.ownership.campaignId,
        storyId: job.ownership.storyId,
        storyVersionId: job.ownership.storyVersionId,
        animationPackageId: job.ownership.animationPackageId,
        executionPlanId: job.executionPlanId,
      },
      {
        orgId: fact.ownership.orgId,
        workspaceId: fact.ownership.workspaceId,
        campaignId: fact.ownership.campaignId,
        storyId: fact.ownership.storyId,
        storyVersionId: fact.ownership.storyVersionId,
        animationPackageId: fact.ownership.animationPackageId,
        executionPlanId: fact.executionPlanId,
      },
      "AssemblyJobFact"
    );
  } catch (error) {
    if (error instanceof OwnershipIntegrityViolationError) {
      throw new AssemblyJobPersistenceError(
        "ASSEMBLY_OWNERSHIP_INVALID",
        error.message
      );
    }
    throw error;
  }

  const existing = await loadFacts(tx, fact.assemblyJobId);
  const sameId = existing.find((row) => row.factId === fact.factId);
  if (sameId) {
    if (canonicalPersistenceHash(sameId) !== canonicalPersistenceHash(fact)) {
      throw new AssemblyJobPersistenceError(
        "ASSEMBLY_IDENTITY_CONFLICT",
        "Conflicting Assembly Job fact identity"
      );
    }
    return { fact: sameId, replayed: true };
  }
  const sameHash = existing.find((row) => row.integrityHash === fact.integrityHash);
  if (sameHash) {
    return { fact: sameHash, replayed: true };
  }

  assertFactTransition(existing, fact);

  try {
    await insertFactRow(tx, fact);
    return { fact, replayed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/unique|duplicate/i.test(message)) throw error;

    const reloaded = await loadFacts(tx, fact.assemblyJobId);
    const byId = reloaded.find((row) => row.factId === fact.factId);
    if (byId) {
      if (canonicalPersistenceHash(byId) !== canonicalPersistenceHash(fact)) {
        throw new AssemblyJobPersistenceError(
          "ASSEMBLY_IDENTITY_CONFLICT",
          "Concurrent Assembly Job fact conflict"
        );
      }
      return { fact: byId, replayed: true };
    }
    const byHash = reloaded.find((row) => row.integrityHash === fact.integrityHash);
    if (byHash) return { fact: byHash, replayed: true };

    if (
      (fact.factKind === "SUCCEEDED" || fact.factKind === "FAILED") &&
      hasTerminalFact(reloaded)
    ) {
      throw new AssemblyJobPersistenceError(
        "ASSEMBLY_STATE_INVALID",
        "Concurrent terminal Assembly fact already accepted"
      );
    }
    if (fact.factKind === "ACCEPTED" && hasAcceptedFact(reloaded)) {
      const accepted = reloaded.find((row) => row.factKind === "ACCEPTED")!;
      if (canonicalPersistenceHash(accepted) !== canonicalPersistenceHash(fact)) {
        throw new AssemblyJobPersistenceError(
          "ASSEMBLY_IDENTITY_CONFLICT",
          "Concurrent ACCEPTED Assembly fact conflict"
        );
      }
      return { fact: accepted, replayed: true };
    }
    throw new AssemblyJobPersistenceError(
      "ASSEMBLY_IDENTITY_CONFLICT",
      "Concurrent Assembly Job fact uniqueness race failed closed"
    );
  }
}

export class AssemblyJobRepositoryImpl implements AssemblyJobRepository {
  constructor(private readonly db: Db = getDb()) {}

  async getByAssemblyJobId(assemblyJobId: string): Promise<AssemblyJob | null> {
    return loadJobById(this.db, assemblyJobId);
  }

  async getByDeterministicFingerprint(
    deterministicFingerprint: string
  ): Promise<AssemblyJob | null> {
    return loadJobByFingerprint(this.db, deterministicFingerprint);
  }

  async getLatestByExecutionPlanId(
    executionPlanId: string
  ): Promise<AssemblyJob | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStoryAssemblyJobs)
      .where(eq(schema.aiStoryAssemblyJobs.executionPlanId, executionPlanId))
      .orderBy(
        desc(schema.aiStoryAssemblyJobs.acceptedAt),
        desc(schema.aiStoryAssemblyJobs.assemblyJobId)
      )
      .limit(1);
    return row ? toJob(row) : null;
  }

  async acceptOrConverge(input: AssemblyJob): Promise<AcceptOrConvergeAssemblyJobResult> {
    const job = AssemblyJobSchema.parse(input);
    assertJobIdentityMatchesDerived(job);

    try {
      return await this.db.transaction(async (tx) => {
        await validateJobOwnership(tx, job);

        const existingById = await loadJobById(tx, job.assemblyJobId);
        if (existingById) {
          return convergeExistingAcceptedJob(tx, job);
        }

        const existingByFingerprint = await loadJobByFingerprint(
          tx,
          job.deterministicFingerprint
        );
        if (existingByFingerprint) {
          return convergeExistingAcceptedJob(tx, job);
        }

        const acceptedFact = buildAcceptedFact(job);
        await tx.insert(schema.aiStoryAssemblyJobs).values({
          assemblyJobId: job.assemblyJobId,
          orgId: job.ownership.orgId,
          workspaceId: job.ownership.workspaceId,
          campaignId: job.ownership.campaignId,
          storyId: job.ownership.storyId,
          storyVersionId: job.ownership.storyVersionId,
          animationPackageId: job.ownership.animationPackageId,
          executionPlanId: job.executionPlanId,
          assemblyDefinitionId: job.assemblyDefinitionId,
          runtimeAuthorizationId: job.runtimeAuthorizationId,
          orderedSceneResultIds: [...job.orderedSceneResultIds],
          orderedSceneContentHashes: [...job.orderedSceneContentHashes],
          assemblyContractVersion: job.assemblyContractVersion,
          assemblyEngineSnapshotId: job.assemblyEngineSnapshotId,
          assemblyEngineSnapshotHash: job.assemblyEngineSnapshotHash,
          deterministicFingerprint: job.deterministicFingerprint,
          acceptedAt: new Date(job.acceptedAt),
          job,
        });
        await insertFactRow(tx, acceptedFact);
        return { job, acceptedFact, replayed: false };
      });
    } catch (error) {
      // PK or fingerprint unique conflict: the insert transaction is aborted.
      // Converge only in a fresh transaction (SELECT on the failed tx cannot work).
      if (!isUniqueViolation(error)) throw error;
      return this.db.transaction(async (tx) => convergeExistingAcceptedJob(tx, job));
    }
  }

  async acquireTerminalAcceptanceLock(
    assemblyJobId: string
  ): Promise<AssemblyTerminalAcceptanceLock> {
    const job = await this.getByAssemblyJobId(assemblyJobId);
    if (!job) {
      throw new AssemblyJobPersistenceError(
        "ASSEMBLY_JOB_NOT_FOUND",
        "Assembly Job not found"
      );
    }

    return {
      assemblyJobId,
      job,
      run: async (work) =>
        this.db.transaction(async (tx) => {
          const locked = await lockAssemblyJobRow(tx, assemblyJobId);
          return work({
            job: locked,
            appendFact: (fact) => appendFactInTransaction(tx, fact),
          });
        }),
    };
  }

  async appendAssemblyJobFact(
    input: AssemblyJobFact
  ): Promise<AppendAssemblyJobFactResult> {
    return this.db.transaction(async (tx) => appendFactInTransaction(tx, input));
  }

  async loadAssemblyFacts(
    assemblyJobId: string
  ): Promise<readonly AssemblyJobFact[]> {
    return loadFacts(this.db, assemblyJobId);
  }
}

/** Convenience export used by tests asserting append-only surface. */
export function listAssemblyJobRepositoryMutators(): readonly string[] {
  return [
    "getByAssemblyJobId",
    "getByDeterministicFingerprint",
    "getLatestByExecutionPlanId",
    "acceptOrConverge",
    "acquireTerminalAcceptanceLock",
    "appendAssemblyJobFact",
    "loadAssemblyFacts",
  ];
}
