import { eq, sql } from "drizzle-orm";
import {
  RuntimeAuthorizedFactSchema,
  type RuntimeAuthorizedFact,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import {
  assertExecutionPlanOwnershipChain,
  assertPlanOwnershipColumnsMatch,
  planOwnershipFromRow,
  type QueryDb,
} from "./ai-story-ownership";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type RuntimeAuthorizationPersistenceErrorCode =
  | "RUNTIME_AUTHORIZATION_CONFLICT"
  | "IDENTITY_CONFLICT"
  | "OWNERSHIP_INTEGRITY_VIOLATION";

export class RuntimeAuthorizationPersistenceError extends Error {
  readonly status: number;

  constructor(
    readonly code: RuntimeAuthorizationPersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "RuntimeAuthorizationPersistenceError";
    this.status = code === "OWNERSHIP_INTEGRITY_VIOLATION" ? 403 : 409;
  }
}

export type RuntimeAuthorizationPersistenceTimings = {
  authorizedFactLookupMs: number;
  authorizedFactWriteMs: number;
};

function addTiming(
  timings: RuntimeAuthorizationPersistenceTimings | undefined,
  field: keyof RuntimeAuthorizationPersistenceTimings,
  startedAt: number
): void {
  if (timings) timings[field] += performance.now() - startedAt;
}

function toFact(
  row: typeof schema.aiStoryRuntimeAuthorizedFacts.$inferSelect
): RuntimeAuthorizedFact {
  return RuntimeAuthorizedFactSchema.parse(row.fact);
}

function factHashInput(fact: RuntimeAuthorizedFact): RuntimeAuthorizedFact {
  const { executionAuthorization: _ignored, ...core } = fact;
  return RuntimeAuthorizedFactSchema.parse({
    ...core,
    orderedSceneExecutionIds: [...core.orderedSceneExecutionIds],
    qcResultIds: [...core.qcResultIds],
  });
}

function assertEquivalentFact(
  existing: RuntimeAuthorizedFact,
  requested: RuntimeAuthorizedFact
): void {
  const requestedWithAcceptedTime = {
    ...requested,
    authorizedAt: existing.authorizedAt,
  };
  if (
    existing.runtimeAuthorizationId !== requested.runtimeAuthorizationId ||
    existing.deterministicIntegrityHash !== requested.deterministicIntegrityHash ||
    canonicalPersistenceHash(factHashInput(existing)) !==
      canonicalPersistenceHash(factHashInput(requestedWithAcceptedTime))
  ) {
    throw new RuntimeAuthorizationPersistenceError(
      "IDENTITY_CONFLICT",
      "Equivalent RuntimeAuthorizedFact hash conflicts with persisted identity"
    );
  }
}

async function lockExecutionPlan(executionPlanId: string, db: QueryDb) {
  await db.execute(sql`
    select ${schema.aiStoryExecutionPlans.id}
    from ${schema.aiStoryExecutionPlans}
    where ${schema.aiStoryExecutionPlans.id} = ${executionPlanId}
    for update
  `);
  const [plan] = await db
    .select()
    .from(schema.aiStoryExecutionPlans)
    .where(eq(schema.aiStoryExecutionPlans.id, executionPlanId))
    .limit(1);
  if (!plan) {
    throw new RuntimeAuthorizationPersistenceError(
      "OWNERSHIP_INTEGRITY_VIOLATION",
      "Execution Plan not found for RuntimeAuthorizedFact"
    );
  }
  return plan;
}

export async function acceptRuntimeAuthorizationFactInTransaction(
  tx: Tx,
  input: RuntimeAuthorizedFact,
  options: {
    readonly lockPlan?: boolean;
    readonly timings?: RuntimeAuthorizationPersistenceTimings;
  } = {}
): Promise<{ fact: RuntimeAuthorizedFact; converged: boolean }> {
  const fact = RuntimeAuthorizedFactSchema.parse(input);
  const plan = options.lockPlan === false
    ? (
        await tx
          .select()
          .from(schema.aiStoryExecutionPlans)
          .where(eq(schema.aiStoryExecutionPlans.id, fact.executionPlanId))
          .limit(1)
      )[0]
    : await lockExecutionPlan(fact.executionPlanId, tx);

  if (!plan) {
    throw new RuntimeAuthorizationPersistenceError(
      "OWNERSHIP_INTEGRITY_VIOLATION",
      "Execution Plan not found for RuntimeAuthorizedFact"
    );
  }

  await assertExecutionPlanOwnershipChain(plan, tx);
  const expected = planOwnershipFromRow(plan);
  assertPlanOwnershipColumnsMatch(
    expected,
    {
      orgId: fact.ownership.orgId,
      workspaceId: fact.ownership.workspaceId,
      campaignId: fact.ownership.campaignId,
      storyId: fact.ownership.storyId,
      storyVersionId: fact.ownership.storyVersionId,
      animationPackageId: fact.ownership.animationPackageId,
      executionPlanId: fact.executionPlanId,
    },
    "RuntimeAuthorizedFact"
  );

  const existingForPlanStartedAt = performance.now();
  const [existingForPlan] = await tx
    .select()
    .from(schema.aiStoryRuntimeAuthorizedFacts)
    .where(eq(schema.aiStoryRuntimeAuthorizedFacts.executionPlanId, fact.executionPlanId))
    .limit(1);
  addTiming(options.timings, "authorizedFactLookupMs", existingForPlanStartedAt);

  if (existingForPlan) {
    const existing = toFact(existingForPlan);
    if (existing.deterministicIntegrityHash !== fact.deterministicIntegrityHash) {
      throw new RuntimeAuthorizationPersistenceError(
        "RUNTIME_AUTHORIZATION_CONFLICT",
        "A different RuntimeAuthorizedFact is already accepted for this Execution Plan"
      );
    }
    assertEquivalentFact(existing, fact);
    return { fact: existing, converged: true };
  }

  const writeStartedAt = performance.now();
  const inserted = await tx
    .insert(schema.aiStoryRuntimeAuthorizedFacts)
    .values({
      runtimeAuthorizationId: fact.runtimeAuthorizationId,
      orgId: fact.ownership.orgId,
      workspaceId: fact.ownership.workspaceId,
      campaignId: fact.ownership.campaignId,
      storyId: fact.ownership.storyId,
      storyVersionId: fact.ownership.storyVersionId,
      animationPackageId: fact.ownership.animationPackageId,
      executionPlanId: fact.executionPlanId,
      runtimeAuthorizationVersion: fact.runtimeAuthorizationVersion,
      reviewDecisionId: fact.reviewDecisionId,
      reviewHash: fact.reviewHash,
      assemblyDefinitionId: fact.assemblyDefinitionId,
      assemblyHash: fact.assemblyHash,
      orderedSceneExecutionIds: [...fact.orderedSceneExecutionIds],
      qcResultIds: [...fact.qcResultIds],
      authorizedBy: fact.authorizedBy,
      authorizedAt: new Date(fact.authorizedAt),
      authorizationContractVersion: fact.authorizationContractVersion,
      deterministicIntegrityHash: fact.deterministicIntegrityHash,
      fact,
    })
    .onConflictDoNothing()
    .returning();
  addTiming(options.timings, "authorizedFactWriteMs", writeStartedAt);

  if (inserted[0]) {
    return { fact: toFact(inserted[0]), converged: false };
  }

  const acceptedByPlanStartedAt = performance.now();
  const [acceptedByPlan] = await tx
    .select()
    .from(schema.aiStoryRuntimeAuthorizedFacts)
    .where(eq(schema.aiStoryRuntimeAuthorizedFacts.executionPlanId, fact.executionPlanId))
    .limit(1);
  addTiming(options.timings, "authorizedFactLookupMs", acceptedByPlanStartedAt);
  if (acceptedByPlan) {
    const existing = toFact(acceptedByPlan);
    if (existing.deterministicIntegrityHash !== fact.deterministicIntegrityHash) {
      throw new RuntimeAuthorizationPersistenceError(
        "RUNTIME_AUTHORIZATION_CONFLICT",
        "Concurrent RuntimeAuthorizedFact conflicts with this Execution Plan"
      );
    }
    assertEquivalentFact(existing, fact);
    return { fact: existing, converged: true };
  }

  const acceptedByHashStartedAt = performance.now();
  const [acceptedByHash] = await tx
    .select()
    .from(schema.aiStoryRuntimeAuthorizedFacts)
    .where(
      eq(
        schema.aiStoryRuntimeAuthorizedFacts.deterministicIntegrityHash,
        fact.deterministicIntegrityHash
      )
    )
    .limit(1);
  addTiming(options.timings, "authorizedFactLookupMs", acceptedByHashStartedAt);
  if (acceptedByHash) {
    const existing = toFact(acceptedByHash);
    if (existing.executionPlanId !== fact.executionPlanId) {
      throw new RuntimeAuthorizationPersistenceError(
        "IDENTITY_CONFLICT",
        "RuntimeAuthorizedFact hash is already bound to a different Execution Plan"
      );
    }
    assertEquivalentFact(existing, fact);
    return { fact: existing, converged: true };
  }

  throw new RuntimeAuthorizationPersistenceError(
    "IDENTITY_CONFLICT",
    "RuntimeAuthorizedFact identity conflict"
  );
}

export class RuntimeAuthorizationPersistenceRepository {
  constructor(private readonly db: Db = getDb()) {}

  async acceptOrReturn(
    fact: RuntimeAuthorizedFact
  ): Promise<{ fact: RuntimeAuthorizedFact; converged: boolean }> {
    return this.db.transaction((tx) =>
      acceptRuntimeAuthorizationFactInTransaction(tx, fact)
    );
  }

  async acceptOrReturnInTransaction(
    fact: RuntimeAuthorizedFact,
    tx: Tx,
    timings?: RuntimeAuthorizationPersistenceTimings
  ): Promise<{ fact: RuntimeAuthorizedFact; converged: boolean }> {
    return acceptRuntimeAuthorizationFactInTransaction(tx, fact, { timings });
  }

  async getByExecutionPlanId(
    executionPlanId: string
  ): Promise<RuntimeAuthorizedFact | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStoryRuntimeAuthorizedFacts)
      .where(eq(schema.aiStoryRuntimeAuthorizedFacts.executionPlanId, executionPlanId))
      .limit(1);
    return row ? toFact(row) : null;
  }

  async getById(runtimeAuthorizationId: string): Promise<RuntimeAuthorizedFact | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStoryRuntimeAuthorizedFacts)
      .where(
        eq(
          schema.aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId,
          runtimeAuthorizationId
        )
      )
      .limit(1);
    return row ? toFact(row) : null;
  }
}
