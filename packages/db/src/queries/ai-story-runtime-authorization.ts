import { eq, sql } from "drizzle-orm";
import {
  AssemblySceneMembershipSchema,
  ReviewOpenedFactSchema,
  RuntimeAuthorizedFactSchema,
  SceneIntentReviewDecisionSchema,
  StoryAssemblyDefinitionSchema,
  StoryReviewDecisionSchema,
  type AssemblySceneMembership,
  type RuntimeAuthorizedFact,
  type StoryAssemblyDefinition,
  type StoryReviewDecision,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import {
  assertExecutionPlanOwnershipChain,
  assertExecutionPlanOwnershipChainInSingleQuery,
  assertPlanOwnershipColumnsMatch,
  planOwnershipFromRow,
  type QueryDb,
} from "./ai-story-ownership";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";
import {
  deriveLogicalReviewStatus,
} from "./ai-story-execution-plan-review";
import {
  buildAssemblyDefinitionFingerprint,
  buildAssemblyMembershipFingerprint,
} from "./ai-story-execution-plan-assembly";

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
  executionPlanLoadMs: number;
  workspaceAuthorityCheckMs: number;
  planReviewLoadMs: number;
  sceneIntentValidationLoadMs: number;
  assemblyLoadMs: number;
  runtimeAuthorizationInputBuildMs: number;
  existingRuntimeFactLookupMs: number;
  authorizedFactLookupMs: number;
  authorizedFactWriteMs: number;
  runtimeFactPostInsertReadMs: number;
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

type RuntimeAuthorizationPlanAuthority = {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly animationPackageId: string;
};

async function lockRuntimeAuthorizationPlanAuthority(
  executionPlanId: string,
  tx: Tx
): Promise<RuntimeAuthorizationPlanAuthority> {
  const [plan] = await tx.execute<RuntimeAuthorizationPlanAuthority>(sql`
    select
      p.id,
      p.org_id as "orgId",
      p.workspace_id as "workspaceId",
      p.campaign_id as "campaignId",
      p.story_id as "storyId",
      p.story_version_id as "storyVersionId",
      p.animation_package_id as "animationPackageId"
    from ${schema.aiStoryExecutionPlans} p
    where p.id = ${executionPlanId}::uuid
    for update
  `);
  if (!plan) {
    throw new RuntimeAuthorizationPersistenceError(
      "OWNERSHIP_INTEGRITY_VIOLATION",
      "Execution Plan not found for RuntimeAuthorizedFact"
    );
  }
  return plan;
}

type RuntimeAuthorizationQcSnapshot = {
  readonly qcResultId: string;
  readonly sceneExecutionId: string;
  readonly status: string;
  readonly resultHash: string;
};

const canonicalSnapshotAuthority = Symbol("canonical-runtime-authorization-snapshot");

export type CanonicalRuntimeAuthorizationSnapshot = {
  readonly executionPlanId: string;
  readonly ownership: ReturnType<typeof planOwnershipFromRow>;
  readonly reviewStatus: "UNDER_REVIEW" | "APPROVED" | "REJECTED";
  readonly storyDecision: StoryReviewDecision | null;
  readonly assemblyDefinition: StoryAssemblyDefinition | null;
  readonly assemblyMemberships: readonly AssemblySceneMembership[];
  readonly orderedSceneExecutionIds: readonly string[];
  readonly membershipComplete: boolean;
  readonly orderingDeterministic: boolean;
  readonly qcResults: readonly RuntimeAuthorizationQcSnapshot[];
  readonly existingFact: RuntimeAuthorizedFact | null;
  readonly transactionAuthority: Tx;
  readonly authority: typeof canonicalSnapshotAuthority;
};

type ReviewSnapshotRow = {
  opened_fact: unknown | null;
  scene_decision_facts: unknown;
  story_decision_facts: unknown;
  scenes: unknown;
  ownership_valid: boolean;
};

type AssemblySnapshotRow = {
  definition: unknown | null;
  memberships: unknown;
  ownership_valid: boolean;
};

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Load the complete immutable pre-fact authority with one transaction owner
 * and one query per authority family. This is deliberately narrower than the
 * rich UI projections: RuntimeAuthorization needs identities, decisions,
 * ordering and QC facts, not hydrated instruction bodies or repeated tenant
 * traversals.
 */
export async function loadCanonicalRuntimeAuthorizationSnapshotInTransaction(
  tx: Tx,
  executionPlanId: string,
  timings?: RuntimeAuthorizationPersistenceTimings
): Promise<CanonicalRuntimeAuthorizationSnapshot> {
  const planStartedAt = performance.now();
  const plan = await lockRuntimeAuthorizationPlanAuthority(executionPlanId, tx);
  addTiming(timings, "executionPlanLoadMs", planStartedAt);

  const ownershipStartedAt = performance.now();
  await assertExecutionPlanOwnershipChainInSingleQuery(plan, tx);
  addTiming(timings, "workspaceAuthorityCheckMs", ownershipStartedAt);
  const expected = {
    orgId: plan.orgId,
    workspaceId: plan.workspaceId,
    campaignId: plan.campaignId,
    storyId: plan.storyId,
    storyVersionId: plan.storyVersionId,
    animationPackageId: plan.animationPackageId,
    executionPlanId: plan.id,
  };

  const reviewStartedAt = performance.now();
  const [reviewRow] = await tx.execute<ReviewSnapshotRow>(sql`
    select
      (select r.fact
         from ${schema.aiStoryReviewOpenedFacts} r
        where r.execution_plan_id = ${executionPlanId}::uuid
        limit 1) as opened_fact,
      coalesce((select jsonb_agg(r.fact order by r.accepted_at)
         from ${schema.aiStorySceneIntentReviewFacts} r
        where r.execution_plan_id = ${executionPlanId}::uuid), '[]'::jsonb) as scene_decision_facts,
      coalesce((select jsonb_agg(r.fact order by r.accepted_at)
         from ${schema.aiStoryStoryReviewFacts} r
        where r.execution_plan_id = ${executionPlanId}::uuid), '[]'::jsonb) as story_decision_facts,
      coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id,
          'sceneOrder', s.scene_order
        ) order by s.scene_order)
         from ${schema.aiStorySceneExecutions} s
        where s.execution_plan_id = ${executionPlanId}::uuid), '[]'::jsonb) as scenes,
      not exists (
        select 1 from ${schema.aiStorySceneExecutions} s
        where s.execution_plan_id = ${executionPlanId}::uuid and (
          s.org_id is distinct from ${plan.orgId}::uuid or
          s.workspace_id is distinct from ${plan.workspaceId}::uuid or
          s.campaign_id is distinct from ${plan.campaignId}::uuid or
          s.story_id is distinct from ${plan.storyId}::uuid or
          s.story_version_id is distinct from ${plan.storyVersionId}::uuid or
          s.animation_package_id is distinct from ${plan.animationPackageId}::uuid
        )
      ) and not exists (
        select 1 from ${schema.aiStoryReviewOpenedFacts} r
        where r.execution_plan_id = ${executionPlanId}::uuid and (
          r.org_id is distinct from ${plan.orgId}::uuid or
          r.workspace_id is distinct from ${plan.workspaceId}::uuid or
          r.campaign_id is distinct from ${plan.campaignId}::uuid or
          r.story_id is distinct from ${plan.storyId}::uuid or
          r.story_version_id is distinct from ${plan.storyVersionId}::uuid or
          r.animation_package_id is distinct from ${plan.animationPackageId}::uuid
        )
      ) and not exists (
        select 1 from ${schema.aiStorySceneIntentReviewFacts} r
        where r.execution_plan_id = ${executionPlanId}::uuid and (
          r.org_id is distinct from ${plan.orgId}::uuid or
          r.workspace_id is distinct from ${plan.workspaceId}::uuid or
          r.campaign_id is distinct from ${plan.campaignId}::uuid or
          r.story_id is distinct from ${plan.storyId}::uuid or
          r.story_version_id is distinct from ${plan.storyVersionId}::uuid or
          r.animation_package_id is distinct from ${plan.animationPackageId}::uuid
        )
      ) and not exists (
        select 1 from ${schema.aiStoryStoryReviewFacts} r
        where r.execution_plan_id = ${executionPlanId}::uuid and (
          r.org_id is distinct from ${plan.orgId}::uuid or
          r.workspace_id is distinct from ${plan.workspaceId}::uuid or
          r.campaign_id is distinct from ${plan.campaignId}::uuid or
          r.story_id is distinct from ${plan.storyId}::uuid or
          r.story_version_id is distinct from ${plan.storyVersionId}::uuid or
          r.animation_package_id is distinct from ${plan.animationPackageId}::uuid
        )
      ) as ownership_valid
  `);
  addTiming(timings, "planReviewLoadMs", reviewStartedAt);
  if (!reviewRow?.ownership_valid) {
    throw new RuntimeAuthorizationPersistenceError(
      "OWNERSHIP_INTEGRITY_VIOLATION",
      "Review or Scene authority ownership drifts from the Execution Plan"
    );
  }
  const opened = reviewRow.opened_fact
    ? ReviewOpenedFactSchema.parse(reviewRow.opened_fact)
    : null;
  const sceneDecisions = asUnknownArray(reviewRow.scene_decision_facts).map((fact) =>
    SceneIntentReviewDecisionSchema.parse(fact)
  );
  const storyDecisions = asUnknownArray(reviewRow.story_decision_facts).map((fact) =>
    StoryReviewDecisionSchema.parse(fact)
  );
  const scenes = asUnknownArray(reviewRow.scenes).map((value) => {
    if (!value || typeof value !== "object") {
      throw new RuntimeAuthorizationPersistenceError(
        "OWNERSHIP_INTEGRITY_VIOLATION",
        "Scene authority snapshot is invalid"
      );
    }
    const row = value as { id?: unknown; sceneOrder?: unknown };
    if (typeof row.id !== "string" || typeof row.sceneOrder !== "number") {
      throw new RuntimeAuthorizationPersistenceError(
        "OWNERSHIP_INTEGRITY_VIOLATION",
        "Scene authority snapshot is incomplete"
      );
    }
    return { id: row.id, sceneOrder: row.sceneOrder };
  });
  const orderedSceneExecutionIds = scenes.map((scene) => scene.id);
  const storyDecision = storyDecisions.at(-1) ?? null;
  const reviewStatus = deriveLogicalReviewStatus({
    opened,
    sceneDecisions,
    storyDecision,
    requiredSceneExecutionIds: orderedSceneExecutionIds,
  });

  const assemblyStartedAt = performance.now();
  const [assemblyRow] = await tx.execute<AssemblySnapshotRow>(sql`
    select
      (select a.definition
         from ${schema.aiStoryAssemblyDefinitions} a
        where a.execution_plan_id = ${executionPlanId}::uuid
        limit 1) as definition,
      coalesce((select jsonb_agg(m.membership order by m.scene_order)
         from ${schema.aiStoryAssemblySceneMemberships} m
        where m.execution_plan_id = ${executionPlanId}::uuid), '[]'::jsonb) as memberships,
      not exists (
        select 1 from ${schema.aiStoryAssemblyDefinitions} a
        where a.execution_plan_id = ${executionPlanId}::uuid and (
          a.org_id is distinct from ${plan.orgId}::uuid or
          a.workspace_id is distinct from ${plan.workspaceId}::uuid or
          a.campaign_id is distinct from ${plan.campaignId}::uuid or
          a.story_id is distinct from ${plan.storyId}::uuid or
          a.story_version_id is distinct from ${plan.storyVersionId}::uuid or
          a.animation_package_id is distinct from ${plan.animationPackageId}::uuid
        )
      ) and not exists (
        select 1 from ${schema.aiStoryAssemblySceneMemberships} m
        where m.execution_plan_id = ${executionPlanId}::uuid and (
          m.org_id is distinct from ${plan.orgId}::uuid or
          m.workspace_id is distinct from ${plan.workspaceId}::uuid or
          m.campaign_id is distinct from ${plan.campaignId}::uuid or
          m.story_id is distinct from ${plan.storyId}::uuid or
          m.story_version_id is distinct from ${plan.storyVersionId}::uuid or
          m.animation_package_id is distinct from ${plan.animationPackageId}::uuid
        )
      ) as ownership_valid
  `);
  addTiming(timings, "assemblyLoadMs", assemblyStartedAt);
  if (!assemblyRow?.ownership_valid) {
    throw new RuntimeAuthorizationPersistenceError(
      "OWNERSHIP_INTEGRITY_VIOLATION",
      "Assembly authority ownership drifts from the Execution Plan"
    );
  }
  const assemblyDefinition = assemblyRow.definition
    ? StoryAssemblyDefinitionSchema.parse(assemblyRow.definition)
    : null;
  const assemblyMemberships = asUnknownArray(assemblyRow.memberships).map((membership) =>
    AssemblySceneMembershipSchema.parse(membership)
  );
  if (assemblyDefinition) {
    const expectedDefinitionFingerprint = buildAssemblyDefinitionFingerprint({
      executionPlanId,
      orderedSceneExecutionIds: assemblyDefinition.orderedSceneExecutionIds,
    });
    if (
      assemblyDefinition.executionPlanId !== executionPlanId ||
      assemblyDefinition.deterministicFingerprint !== expectedDefinitionFingerprint
    ) {
      throw new RuntimeAuthorizationPersistenceError(
        "IDENTITY_CONFLICT",
        "Assembly Definition identity conflicts with the Execution Plan"
      );
    }
  }
  for (const [index, membership] of assemblyMemberships.entries()) {
    if (
      membership.assemblyDefinitionId !== assemblyDefinition?.assemblyDefinitionId ||
      membership.executionPlanId !== executionPlanId ||
      membership.sceneOrder !== index ||
      membership.sceneExecutionId !== orderedSceneExecutionIds[index] ||
      membership.deterministicFingerprint !== buildAssemblyMembershipFingerprint({
        assemblyDefinitionId: membership.assemblyDefinitionId,
        executionPlanId,
        sceneExecutionId: membership.sceneExecutionId,
        sceneOrder: membership.sceneOrder,
      })
    ) {
      throw new RuntimeAuthorizationPersistenceError(
        "IDENTITY_CONFLICT",
        "Assembly membership identity or ordering is invalid"
      );
    }
  }
  const membershipComplete = Boolean(assemblyDefinition) &&
    assemblyMemberships.length === orderedSceneExecutionIds.length &&
    assemblyDefinition!.orderedSceneExecutionIds.every(
      (sceneExecutionId, index) => sceneExecutionId === orderedSceneExecutionIds[index]
    );
  const orderingDeterministic = membershipComplete &&
    new Set(orderedSceneExecutionIds).size === orderedSceneExecutionIds.length;

  const validationStartedAt = performance.now();
  const validationRows = await tx
    .select({
      id: schema.aiStorySceneIntentValidationResults.id,
      sceneExecutionId: schema.aiStorySceneIntentValidationResults.sceneExecutionId,
      status: schema.aiStorySceneIntentValidationResults.status,
      resultHash: schema.aiStorySceneIntentValidationResults.resultHash,
    })
    .from(schema.aiStorySceneIntentValidationResults)
    .where(eq(schema.aiStorySceneIntentValidationResults.executionPlanId, executionPlanId))
    .orderBy(
      schema.aiStorySceneIntentValidationResults.acceptedAt,
      schema.aiStorySceneIntentValidationResults.id
    );
  addTiming(timings, "sceneIntentValidationLoadMs", validationStartedAt);
  const latestQcByScene = new Map<string, RuntimeAuthorizationQcSnapshot>();
  for (const row of validationRows) {
    latestQcByScene.set(row.sceneExecutionId, {
      qcResultId: row.id,
      sceneExecutionId: row.sceneExecutionId,
      status: row.status,
      resultHash: row.resultHash,
    });
  }
  const qcResults = orderedSceneExecutionIds.map((sceneExecutionId) => {
    const qc = latestQcByScene.get(sceneExecutionId);
    if (!qc) {
      throw new RuntimeAuthorizationPersistenceError(
        "IDENTITY_CONFLICT",
        `Missing QC validation for sceneExecutionId ${sceneExecutionId}`
      );
    }
    return qc;
  });

  const existingStartedAt = performance.now();
  const [existingRow] = await tx
    .select()
    .from(schema.aiStoryRuntimeAuthorizedFacts)
    .where(eq(schema.aiStoryRuntimeAuthorizedFacts.executionPlanId, executionPlanId))
    .limit(1);
  addTiming(timings, "existingRuntimeFactLookupMs", existingStartedAt);

  return {
    executionPlanId,
    ownership: expected,
    reviewStatus,
    storyDecision,
    assemblyDefinition,
    assemblyMemberships,
    orderedSceneExecutionIds,
    membershipComplete,
    orderingDeterministic,
    qcResults,
    existingFact: existingRow ? toFact(existingRow) : null,
    transactionAuthority: tx,
    authority: canonicalSnapshotAuthority,
  };
}

export async function acceptRuntimeAuthorizationFactFromCanonicalSnapshot(
  tx: Tx,
  snapshot: CanonicalRuntimeAuthorizationSnapshot,
  input: RuntimeAuthorizedFact,
  timings?: RuntimeAuthorizationPersistenceTimings
): Promise<{ fact: RuntimeAuthorizedFact; converged: boolean }> {
  if (
    snapshot.authority !== canonicalSnapshotAuthority ||
    snapshot.transactionAuthority !== tx
  ) {
    throw new RuntimeAuthorizationPersistenceError(
      "OWNERSHIP_INTEGRITY_VIOLATION",
      "Canonical RuntimeAuthorization snapshot belongs to a different transaction authority"
    );
  }
  const fact = RuntimeAuthorizedFactSchema.parse(input);
  assertPlanOwnershipColumnsMatch(snapshot.ownership, {
    orgId: fact.ownership.orgId,
    workspaceId: fact.ownership.workspaceId,
    campaignId: fact.ownership.campaignId,
    storyId: fact.ownership.storyId,
    storyVersionId: fact.ownership.storyVersionId,
    animationPackageId: fact.ownership.animationPackageId,
    executionPlanId: fact.executionPlanId,
  }, "RuntimeAuthorizedFact");

  if (snapshot.existingFact) {
    if (
      snapshot.existingFact.deterministicIntegrityHash !==
      fact.deterministicIntegrityHash
    ) {
      throw new RuntimeAuthorizationPersistenceError(
        "RUNTIME_AUTHORIZATION_CONFLICT",
        "A different RuntimeAuthorizedFact is already accepted for this Execution Plan"
      );
    }
    assertEquivalentFact(snapshot.existingFact, fact);
    return { fact: snapshot.existingFact, converged: true };
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
  addTiming(timings, "authorizedFactWriteMs", writeStartedAt);
  if (inserted[0]) {
    return { fact: toFact(inserted[0]), converged: false };
  }

  const postInsertStartedAt = performance.now();
  const [accepted] = await tx
    .select()
    .from(schema.aiStoryRuntimeAuthorizedFacts)
    .where(eq(schema.aiStoryRuntimeAuthorizedFacts.executionPlanId, fact.executionPlanId))
    .limit(1);
  addTiming(timings, "runtimeFactPostInsertReadMs", postInsertStartedAt);
  if (!accepted) {
    throw new RuntimeAuthorizationPersistenceError(
      "IDENTITY_CONFLICT",
      "RuntimeAuthorizedFact identity conflict"
    );
  }
  const existing = toFact(accepted);
  if (existing.deterministicIntegrityHash !== fact.deterministicIntegrityHash) {
    throw new RuntimeAuthorizationPersistenceError(
      "RUNTIME_AUTHORIZATION_CONFLICT",
      "Concurrent RuntimeAuthorizedFact conflicts with this Execution Plan"
    );
  }
  assertEquivalentFact(existing, fact);
  return { fact: existing, converged: true };
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

  async loadCanonicalSnapshotInTransaction(
    executionPlanId: string,
    tx: Tx,
    timings?: RuntimeAuthorizationPersistenceTimings
  ): Promise<CanonicalRuntimeAuthorizationSnapshot> {
    return loadCanonicalRuntimeAuthorizationSnapshotInTransaction(
      tx,
      executionPlanId,
      timings
    );
  }

  async acceptOrReturnCanonicalSnapshotInTransaction(
    fact: RuntimeAuthorizedFact,
    snapshot: CanonicalRuntimeAuthorizationSnapshot,
    tx: Tx,
    timings?: RuntimeAuthorizationPersistenceTimings
  ): Promise<{ fact: RuntimeAuthorizedFact; converged: boolean }> {
    return acceptRuntimeAuthorizationFactFromCanonicalSnapshot(
      tx,
      snapshot,
      fact,
      timings
    );
  }

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
