/**
 * Sprint 3 Phase 2B PR 2B.2 — Execution Plan Assembly Definition repository.
 *
 * Immutable Story Assembly Definition subordinate to the Execution Plan
 * Aggregate Root. Persists deterministic future execution ordering only.
 * Never unlocks execution. Never creates Queue / Worker / Outbox / Provider /
 * Story Video / media work.
 */
import { asc, eq } from "drizzle-orm";
import {
  AI_STORY_EXECUTION_CONTRACT_VERSION,
  AssemblyProjectionSchema,
  AssemblySceneMembershipSchema,
  ReviewOpenedFactSchema,
  SceneIntentReviewDecisionSchema,
  StoryAssemblyDefinitionSchema,
  StoryReviewDecisionSchema,
  type AssemblyProjection,
  type AssemblySceneMembership,
  type StoryAssemblyDefinition,
  type WorkspaceRole,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "./ai-story-scene-execution-persistence";
import {
  assertExecutionPlanOwnershipChain,
  assertPlanOwnershipColumnsMatch,
  assertSceneMatchesPlan,
  planOwnershipFromRow,
} from "./ai-story-ownership";
import { deriveLogicalReviewStatus } from "./ai-story-execution-plan-review";
import { getWorkspaceMembership, ROLE_HIERARCHY } from "./tenant";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type QueryDb = Db | Tx;

const CREATOR_MIN_ROLE: WorkspaceRole = "operator";

export class AssemblyIdentityConflictError extends Error {
  readonly code = "ASSEMBLY_IDENTITY_CONFLICT";
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "AssemblyIdentityConflictError";
  }
}

export class AssemblyOwnershipError extends Error {
  readonly code = "ASSEMBLY_OWNERSHIP_INVALID";
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "AssemblyOwnershipError";
  }
}

export class AssemblyValidationError extends Error {
  readonly code = "ASSEMBLY_VALIDATION_FAILED";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "AssemblyValidationError";
  }
}

export class AssemblyStateError extends Error {
  readonly code = "ASSEMBLY_STATE_INVALID";
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "AssemblyStateError";
  }
}

export class AssemblyIntegrityViolationError extends Error {
  readonly code = "ASSEMBLY_INTEGRITY_VIOLATION";
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "AssemblyIntegrityViolationError";
  }
}

export type CreateAssemblyDefinitionInput = {
  readonly executionPlanId: string;
  readonly createdBy: string;
  readonly createdAt?: string;
  /** Optional explicit order; must match plan Scene Executions exactly when provided. */
  readonly orderedSceneExecutionIds?: readonly string[];
};

export type CreateAssemblyDefinitionResult = {
  readonly definition: StoryAssemblyDefinition;
  readonly memberships: readonly AssemblySceneMembership[];
  readonly replayed: boolean;
};

export interface ExecutionPlanAssemblyStore {
  createOrReturnAssembly(
    input: CreateAssemblyDefinitionInput
  ): Promise<CreateAssemblyDefinitionResult>;
  getAssemblyDefinition(
    executionPlanId: string
  ): Promise<StoryAssemblyDefinition | null>;
  listMemberships(assemblyDefinitionId: string): Promise<AssemblySceneMembership[]>;
  getProjection(executionPlanId: string): Promise<AssemblyProjection | null>;
}

export function buildAssemblyDefinitionFingerprint(input: {
  readonly executionPlanId: string;
  readonly orderedSceneExecutionIds: readonly string[];
}): string {
  return canonicalPersistenceHash({
    kind: "story-assembly-definition",
    executionPlanId: input.executionPlanId,
    orderedSceneExecutionIds: input.orderedSceneExecutionIds,
  });
}

export function buildAssemblyMembershipFingerprint(input: {
  readonly assemblyDefinitionId: string;
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly sceneOrder: number;
}): string {
  return canonicalPersistenceHash({
    kind: "assembly-scene-membership",
    ...input,
  });
}

function assertEquivalentDefinition(
  existing: StoryAssemblyDefinition,
  requested: StoryAssemblyDefinition
): void {
  if (
    existing.assemblyDefinitionId !== requested.assemblyDefinitionId ||
    existing.deterministicFingerprint !== requested.deterministicFingerprint ||
    canonicalPersistenceHash({
      ...existing,
      createdAt: undefined,
      createdBy: undefined,
    }) !==
      canonicalPersistenceHash({
        ...requested,
        createdAt: undefined,
        createdBy: undefined,
      })
  ) {
    throw new AssemblyIdentityConflictError(
      "A different Story Assembly Definition is already accepted for this Execution Plan"
    );
  }
}

function assertEquivalentMembership(
  existing: AssemblySceneMembership,
  requested: AssemblySceneMembership
): void {
  if (
    existing.membershipId !== requested.membershipId ||
    existing.deterministicFingerprint !== requested.deterministicFingerprint ||
    canonicalPersistenceHash(existing) !== canonicalPersistenceHash(requested)
  ) {
    throw new AssemblyIdentityConflictError(
      "A different Assembly Scene membership is already accepted for this identity"
    );
  }
}

type AssemblyDefinitionRow = typeof schema.aiStoryAssemblyDefinitions.$inferSelect;
type AssemblyMembershipRow = typeof schema.aiStoryAssemblySceneMemberships.$inferSelect;

/**
 * Reconstruct immutable membership from relational columns only.
 * JSONB is never used as ordering or identity authority.
 */
export function reconstructMembershipFromRow(
  row: AssemblyMembershipRow
): AssemblySceneMembership {
  return AssemblySceneMembershipSchema.parse({
    membershipId: row.membershipId,
    assemblyDefinitionId: row.assemblyDefinitionId,
    executionPlanId: row.executionPlanId,
    sceneExecutionId: row.sceneExecutionId,
    sceneId: row.sceneId,
    sceneOrder: row.sceneOrder,
    contractVersion: row.contractVersion,
    deterministicFingerprint: row.deterministicFingerprint,
  });
}

/**
 * Reconstruct immutable definition from definition row columns + relational membership order.
 */
export function reconstructDefinitionFromRows(
  definitionRow: AssemblyDefinitionRow,
  memberships: readonly AssemblySceneMembership[]
): StoryAssemblyDefinition {
  const orderedSceneExecutionIds = memberships.map(
    (membership) => membership.sceneExecutionId
  );
  return StoryAssemblyDefinitionSchema.parse({
    assemblyDefinitionId: definitionRow.assemblyDefinitionId,
    executionPlanId: definitionRow.executionPlanId,
    orgId: definitionRow.orgId,
    workspaceId: definitionRow.workspaceId,
    campaignId: definitionRow.campaignId,
    storyId: definitionRow.storyId,
    storyVersionId: definitionRow.storyVersionId,
    animationPackageId: definitionRow.animationPackageId,
    sceneCount: memberships.length,
    orderedSceneExecutionIds,
    createdBy: definitionRow.createdBy,
    createdAt: definitionRow.createdAt.toISOString(),
    contractVersion: definitionRow.contractVersion,
    deterministicFingerprint: definitionRow.deterministicFingerprint,
  });
}

/**
 * Membership rows are canonical. JSONB is snapshot-only integrity payload.
 * Any mismatch fails closed with ASSEMBLY_INTEGRITY_VIOLATION.
 */
export function assertAssemblyReloadIntegrity(
  definitionRow: AssemblyDefinitionRow,
  membershipRows: readonly AssemblyMembershipRow[]
): {
  readonly definition: StoryAssemblyDefinition;
  readonly memberships: AssemblySceneMembership[];
} {
  const memberships = membershipRows.map(reconstructMembershipFromRow);

  for (let index = 0; index < memberships.length; index += 1) {
    const membership = memberships[index]!;
    const row = membershipRows[index]!;
    if (membership.sceneOrder !== index) {
      throw new AssemblyIntegrityViolationError(
        "Assembly membership sceneOrder is not contiguous from relational rows"
      );
    }

    const expectedMembershipFingerprint = buildAssemblyMembershipFingerprint({
      assemblyDefinitionId: membership.assemblyDefinitionId,
      executionPlanId: membership.executionPlanId,
      sceneExecutionId: membership.sceneExecutionId,
      sceneOrder: membership.sceneOrder,
    });
    if (membership.deterministicFingerprint !== expectedMembershipFingerprint) {
      throw new AssemblyIntegrityViolationError(
        "Assembly membership fingerprint does not match relational identity"
      );
    }
    if (
      membership.membershipId !==
      deterministicPersistenceUuid(
        "assembly-scene-membership",
        expectedMembershipFingerprint
      )
    ) {
      throw new AssemblyIntegrityViolationError(
        "Assembly membership ID does not match relational identity"
      );
    }

    let snapshot: AssemblySceneMembership;
    try {
      snapshot = AssemblySceneMembershipSchema.parse(row.membership);
    } catch {
      throw new AssemblyIntegrityViolationError(
        "Assembly membership JSONB snapshot is invalid"
      );
    }
    if (canonicalPersistenceHash(membership) !== canonicalPersistenceHash(snapshot)) {
      throw new AssemblyIntegrityViolationError(
        "Assembly membership JSONB snapshot does not match relational membership row"
      );
    }
  }

  const definition = reconstructDefinitionFromRows(definitionRow, memberships);
  const expectedDefinitionFingerprint = buildAssemblyDefinitionFingerprint({
    executionPlanId: definition.executionPlanId,
    orderedSceneExecutionIds: definition.orderedSceneExecutionIds,
  });
  if (definition.deterministicFingerprint !== expectedDefinitionFingerprint) {
    throw new AssemblyIntegrityViolationError(
      "Assembly definition fingerprint does not match relational membership order"
    );
  }
  if (
    definition.assemblyDefinitionId !==
    deterministicPersistenceUuid("story-assembly-definition", expectedDefinitionFingerprint)
  ) {
    throw new AssemblyIntegrityViolationError(
      "Assembly definition ID does not match relational identity"
    );
  }
  if (definitionRow.sceneCount !== memberships.length) {
    throw new AssemblyIntegrityViolationError(
      "Assembly definition scene_count does not match relational membership count"
    );
  }

  let definitionSnapshot: StoryAssemblyDefinition;
  try {
    definitionSnapshot = StoryAssemblyDefinitionSchema.parse(definitionRow.definition);
  } catch {
    throw new AssemblyIntegrityViolationError(
      "Assembly definition JSONB snapshot is invalid"
    );
  }

  if (
    definitionSnapshot.orderedSceneExecutionIds.length !== memberships.length ||
    definitionSnapshot.sceneCount !== memberships.length
  ) {
    throw new AssemblyIntegrityViolationError(
      "Assembly definition JSONB membership count does not match relational membership rows"
    );
  }
  if (
    canonicalPersistenceHash(definitionSnapshot.orderedSceneExecutionIds) !==
    canonicalPersistenceHash(definition.orderedSceneExecutionIds)
  ) {
    throw new AssemblyIntegrityViolationError(
      "Assembly definition JSONB ordered Scene IDs do not match relational membership rows"
    );
  }
  if (
    definitionSnapshot.deterministicFingerprint !== definition.deterministicFingerprint ||
    definitionSnapshot.assemblyDefinitionId !== definition.assemblyDefinitionId
  ) {
    throw new AssemblyIntegrityViolationError(
      "Assembly definition JSONB fingerprint does not match relational identity"
    );
  }
  if (
    definition.orgId !== definitionSnapshot.orgId ||
    definition.workspaceId !== definitionSnapshot.workspaceId ||
    definition.campaignId !== definitionSnapshot.campaignId ||
    definition.storyId !== definitionSnapshot.storyId ||
    definition.storyVersionId !== definitionSnapshot.storyVersionId ||
    definition.animationPackageId !== definitionSnapshot.animationPackageId ||
    definition.executionPlanId !== definitionSnapshot.executionPlanId ||
    definition.contractVersion !== definitionSnapshot.contractVersion
  ) {
    throw new AssemblyIntegrityViolationError(
      "Assembly definition JSONB snapshot does not match relational definition row"
    );
  }

  return { definition, memberships };
}

export class ExecutionPlanAssemblyRepository implements ExecutionPlanAssemblyStore {
  constructor(private readonly db: Db = getDb()) {}

  async createOrReturnAssembly(
    input: CreateAssemblyDefinitionInput
  ): Promise<CreateAssemblyDefinitionResult> {
    return this.db.transaction(async (tx) => {
      const plan = await this.requirePlan(input.executionPlanId, tx);
      await assertExecutionPlanOwnershipChain(plan, tx);
      await this.assertCreatorAuthorized(plan.workspaceId, input.createdBy);

      const sceneRows = await tx
        .select()
        .from(schema.aiStorySceneExecutions)
        .where(eq(schema.aiStorySceneExecutions.executionPlanId, plan.id))
        .orderBy(asc(schema.aiStorySceneExecutions.sceneOrder));

      if (sceneRows.length === 0) {
        throw new AssemblyValidationError(
          "Execution Plan has no Scene Executions to assemble"
        );
      }

      this.assertOwnershipChain(plan, sceneRows);
      const orderedSceneExecutionIds = this.resolveOrderedSceneExecutionIds(
        input.orderedSceneExecutionIds,
        sceneRows
      );
      const sceneById = new Map(sceneRows.map((row) => [row.id, row]));

      if (!(await this.isReviewApproved(plan.id, tx))) {
        throw new AssemblyStateError(
          "Story Assembly Definition requires an APPROVED logical Review for this Execution Plan"
        );
      }

      const fingerprint = buildAssemblyDefinitionFingerprint({
        executionPlanId: plan.id,
        orderedSceneExecutionIds,
      });
      const assemblyDefinitionId = deterministicPersistenceUuid(
        "story-assembly-definition",
        fingerprint
      );
      const createdAt = input.createdAt ?? new Date().toISOString();
      const definition = StoryAssemblyDefinitionSchema.parse({
        assemblyDefinitionId,
        executionPlanId: plan.id,
        orgId: plan.orgId,
        workspaceId: plan.workspaceId,
        campaignId: plan.campaignId,
        storyId: plan.storyId,
        storyVersionId: plan.storyVersionId,
        animationPackageId: plan.animationPackageId,
        sceneCount: orderedSceneExecutionIds.length,
        orderedSceneExecutionIds: [...orderedSceneExecutionIds],
        createdBy: input.createdBy,
        createdAt,
        contractVersion: AI_STORY_EXECUTION_CONTRACT_VERSION,
        deterministicFingerprint: fingerprint,
      });

      const [existing] = await tx
        .select()
        .from(schema.aiStoryAssemblyDefinitions)
        .where(eq(schema.aiStoryAssemblyDefinitions.executionPlanId, plan.id))
        .limit(1);

      if (existing) {
        if (existing.deterministicFingerprint !== fingerprint) {
          throw new AssemblyIdentityConflictError(
            "Changed Assembly ordering conflicts with the accepted Assembly Definition identity"
          );
        }
        const verified = await this.loadVerifiedAssemblyByDefinitionRow(existing, tx);
        assertEquivalentDefinition(verified.definition, {
          ...definition,
          createdBy: verified.definition.createdBy,
          createdAt: verified.definition.createdAt,
        });
        return {
          definition: verified.definition,
          memberships: verified.memberships,
          replayed: true,
        };
      }

      const memberships = orderedSceneExecutionIds.map((sceneExecutionId, index) => {
        const scene = sceneById.get(sceneExecutionId)!;
        const membershipFingerprint = buildAssemblyMembershipFingerprint({
          assemblyDefinitionId,
          executionPlanId: plan.id,
          sceneExecutionId: scene.id,
          sceneOrder: index,
        });
        return AssemblySceneMembershipSchema.parse({
          membershipId: deterministicPersistenceUuid(
            "assembly-scene-membership",
            membershipFingerprint
          ),
          assemblyDefinitionId,
          executionPlanId: plan.id,
          sceneExecutionId: scene.id,
          sceneId: scene.sceneId,
          sceneOrder: index,
          contractVersion: AI_STORY_EXECUTION_CONTRACT_VERSION,
          deterministicFingerprint: membershipFingerprint,
        });
      });

      const insertedDefinition = await tx
        .insert(schema.aiStoryAssemblyDefinitions)
        .values({
          assemblyDefinitionId: definition.assemblyDefinitionId,
          orgId: definition.orgId,
          workspaceId: definition.workspaceId,
          campaignId: definition.campaignId,
          storyId: definition.storyId,
          storyVersionId: definition.storyVersionId,
          animationPackageId: definition.animationPackageId,
          executionPlanId: definition.executionPlanId,
          sceneCount: definition.sceneCount,
          createdBy: definition.createdBy,
          createdAt: new Date(definition.createdAt),
          contractVersion: definition.contractVersion,
          deterministicFingerprint: definition.deterministicFingerprint,
          definition,
        })
        .onConflictDoNothing()
        .returning();

      if (!insertedDefinition[0]) {
        const [acceptedRow] = await tx
          .select()
          .from(schema.aiStoryAssemblyDefinitions)
          .where(eq(schema.aiStoryAssemblyDefinitions.executionPlanId, plan.id))
          .limit(1);
        if (!acceptedRow) {
          throw new AssemblyIdentityConflictError(
            "Story Assembly Definition identity conflict"
          );
        }
        if (acceptedRow.deterministicFingerprint !== fingerprint) {
          throw new AssemblyIdentityConflictError(
            "Changed Assembly ordering conflicts with the accepted Assembly Definition identity"
          );
        }
        const verified = await this.loadVerifiedAssemblyByDefinitionRow(acceptedRow, tx);
        assertEquivalentDefinition(verified.definition, {
          ...definition,
          createdBy: verified.definition.createdBy,
          createdAt: verified.definition.createdAt,
        });
        return {
          definition: verified.definition,
          memberships: verified.memberships,
          replayed: true,
        };
      }

      for (const membership of memberships) {
        const insertedMembership = await tx
          .insert(schema.aiStoryAssemblySceneMemberships)
          .values({
            membershipId: membership.membershipId,
            orgId: plan.orgId,
            workspaceId: plan.workspaceId,
            campaignId: plan.campaignId,
            storyId: plan.storyId,
            storyVersionId: plan.storyVersionId,
            animationPackageId: plan.animationPackageId,
            executionPlanId: plan.id,
            assemblyDefinitionId: membership.assemblyDefinitionId,
            sceneExecutionId: membership.sceneExecutionId,
            sceneId: membership.sceneId,
            sceneOrder: membership.sceneOrder,
            contractVersion: membership.contractVersion,
            deterministicFingerprint: membership.deterministicFingerprint,
            membership,
          })
          .onConflictDoNothing()
          .returning();

        if (!insertedMembership[0]) {
          const [acceptedMembershipRow] = await tx
            .select()
            .from(schema.aiStoryAssemblySceneMemberships)
            .where(
              eq(
                schema.aiStoryAssemblySceneMemberships.deterministicFingerprint,
                membership.deterministicFingerprint
              )
            )
            .limit(1);
          if (!acceptedMembershipRow) {
            throw new AssemblyIdentityConflictError(
              "Assembly Scene membership identity conflict"
            );
          }
          const acceptedMembership = reconstructMembershipFromRow(acceptedMembershipRow);
          assertEquivalentMembership(acceptedMembership, membership);
          const snapshot = AssemblySceneMembershipSchema.parse(
            acceptedMembershipRow.membership
          );
          if (
            canonicalPersistenceHash(acceptedMembership) !==
            canonicalPersistenceHash(snapshot)
          ) {
            throw new AssemblyIntegrityViolationError(
              "Assembly membership JSONB snapshot does not match relational membership row"
            );
          }
        }
      }

      const verified = await this.loadVerifiedAssemblyByDefinitionRow(
        insertedDefinition[0],
        tx
      );
      return {
        definition: verified.definition,
        memberships: verified.memberships,
        replayed: false,
      };
    });
  }

  async getAssemblyDefinition(
    executionPlanId: string
  ): Promise<StoryAssemblyDefinition | null> {
    const verified = await this.loadVerifiedAssemblyByPlanId(executionPlanId, this.db);
    return verified?.definition ?? null;
  }

  async listMemberships(assemblyDefinitionId: string): Promise<AssemblySceneMembership[]> {
    const [definitionRow] = await this.db
      .select()
      .from(schema.aiStoryAssemblyDefinitions)
      .where(
        eq(schema.aiStoryAssemblyDefinitions.assemblyDefinitionId, assemblyDefinitionId)
      )
      .limit(1);
    if (!definitionRow) {
      throw new AssemblyStateError("Assembly Definition not found");
    }
    const verified = await this.loadVerifiedAssemblyByDefinitionRow(definitionRow, this.db);
    return [...verified.memberships];
  }

  async getProjection(executionPlanId: string): Promise<AssemblyProjection | null> {
    const plan = await this.requirePlanOrNull(executionPlanId, this.db);
    if (!plan) return null;

    const verified = await this.loadVerifiedAssemblyByPlanId(executionPlanId, this.db);
    const definition = verified?.definition ?? null;
    const memberships = verified?.memberships ?? [];

    const sceneRows = await this.db
      .select({ id: schema.aiStorySceneExecutions.id })
      .from(schema.aiStorySceneExecutions)
      .where(eq(schema.aiStorySceneExecutions.executionPlanId, executionPlanId))
      .orderBy(asc(schema.aiStorySceneExecutions.sceneOrder));
    const requiredIds = sceneRows.map((row) => row.id);

    const reviewApproved = await this.isReviewApproved(executionPlanId, this.db);
    // Projection ordering and counts are derived only from relational membership rows.
    const orderedSceneExecutionIds = memberships.map(
      (membership) => membership.sceneExecutionId
    );
    const membershipSceneIds = new Set(orderedSceneExecutionIds);
    const membershipComplete =
      Boolean(definition) &&
      memberships.length === requiredIds.length &&
      requiredIds.every((id) => membershipSceneIds.has(id)) &&
      memberships.every((membership, index) => membership.sceneOrder === index);
    const orderingDeterministic =
      memberships.length > 0 &&
      memberships.every((membership, index) => membership.sceneOrder === index) &&
      new Set(memberships.map((membership) => membership.sceneOrder)).size ===
        memberships.length &&
      new Set(orderedSceneExecutionIds).size === memberships.length;

    return AssemblyProjectionSchema.parse({
      executionPlanId,
      orgId: plan.orgId,
      workspaceId: plan.workspaceId,
      definition,
      memberships,
      sceneCount: memberships.length,
      orderedSceneExecutionIds,
      prerequisites: {
        hasDefinition: Boolean(definition),
        membershipComplete,
        reviewApproved,
        orderingDeterministic,
      },
      derivedAt: new Date().toISOString(),
    });
  }

  private resolveOrderedSceneExecutionIds(
    requested: readonly string[] | undefined,
    sceneRows: Array<typeof schema.aiStorySceneExecutions.$inferSelect>
  ): string[] {
    const canonical = sceneRows.map((row) => row.id);
    const planSceneOrders = sceneRows.map((row) => row.sceneOrder);
    if (new Set(planSceneOrders).size !== planSceneOrders.length) {
      throw new AssemblyValidationError(
        "Execution Plan Scene Executions contain duplicate sceneOrder values"
      );
    }

    if (!requested) return canonical;

    if (requested.length !== canonical.length) {
      if (requested.length < canonical.length) {
        throw new AssemblyValidationError(
          "Assembly is missing required Scene Executions from the Execution Plan"
        );
      }
      throw new AssemblyValidationError(
        "Assembly includes Scene Executions that do not belong to the Execution Plan"
      );
    }

    const seen = new Set<string>();
    for (const sceneExecutionId of requested) {
      if (seen.has(sceneExecutionId)) {
        throw new AssemblyValidationError(
          "Assembly Scene membership cannot include duplicate Scene Executions"
        );
      }
      seen.add(sceneExecutionId);
      if (!sceneRows.some((row) => row.id === sceneExecutionId)) {
        throw new AssemblyValidationError(
          "Assembly includes a foreign Scene Execution outside this Execution Plan"
        );
      }
    }

    for (const id of canonical) {
      if (!seen.has(id)) {
        throw new AssemblyValidationError(
          "Assembly is missing required Scene Executions from the Execution Plan"
        );
      }
    }

    return [...requested];
  }

  private assertOwnershipChain(
    plan: typeof schema.aiStoryExecutionPlans.$inferSelect,
    sceneRows: Array<typeof schema.aiStorySceneExecutions.$inferSelect>
  ): void {
    for (const scene of sceneRows) {
      assertSceneMatchesPlan(plan, scene);
    }
  }

  private async assertCreatorAuthorized(workspaceId: string, userId: string) {
    const member = await getWorkspaceMembership(workspaceId, userId);
    if (!member) {
      throw new AssemblyOwnershipError(
        "Creator is not a member of this workspace"
      );
    }
    if (
      ROLE_HIERARCHY[member.role as WorkspaceRole] < ROLE_HIERARCHY[CREATOR_MIN_ROLE]
    ) {
      throw new AssemblyOwnershipError(
        "Creator lacks required workspace role"
      );
    }
  }

  private async requirePlanOrNull(executionPlanId: string, db: QueryDb) {
    const [plan] = await db
      .select()
      .from(schema.aiStoryExecutionPlans)
      .where(eq(schema.aiStoryExecutionPlans.id, executionPlanId))
      .limit(1);
    return plan ?? null;
  }

  private async requirePlan(executionPlanId: string, db: QueryDb) {
    const plan = await this.requirePlanOrNull(executionPlanId, db);
    if (!plan) {
      throw new AssemblyStateError("Execution Plan not found");
    }
    return plan;
  }

  private async loadVerifiedAssemblyByPlanId(executionPlanId: string, db: QueryDb) {
    const [definitionRow] = await db
      .select()
      .from(schema.aiStoryAssemblyDefinitions)
      .where(eq(schema.aiStoryAssemblyDefinitions.executionPlanId, executionPlanId))
      .limit(1);
    if (!definitionRow) return null;
    return this.loadVerifiedAssemblyByDefinitionRow(definitionRow, db);
  }

  private async loadVerifiedAssemblyByDefinitionRow(
    definitionRow: AssemblyDefinitionRow,
    db: QueryDb
  ) {
    const [plan] = await db
      .select()
      .from(schema.aiStoryExecutionPlans)
      .where(eq(schema.aiStoryExecutionPlans.id, definitionRow.executionPlanId))
      .limit(1);
    if (!plan) {
      throw new AssemblyStateError("Execution Plan not found for Assembly Definition");
    }
    await assertExecutionPlanOwnershipChain(plan, db);
    const expected = planOwnershipFromRow(plan);
    assertPlanOwnershipColumnsMatch(expected, {
      orgId: definitionRow.orgId,
      workspaceId: definitionRow.workspaceId,
      campaignId: definitionRow.campaignId,
      storyId: definitionRow.storyId,
      storyVersionId: definitionRow.storyVersionId,
      animationPackageId: definitionRow.animationPackageId,
      executionPlanId: definitionRow.executionPlanId,
    }, "Assembly Definition");

    const membershipRows = await db
      .select()
      .from(schema.aiStoryAssemblySceneMemberships)
      .where(
        eq(
          schema.aiStoryAssemblySceneMemberships.assemblyDefinitionId,
          definitionRow.assemblyDefinitionId
        )
      )
      .orderBy(asc(schema.aiStoryAssemblySceneMemberships.sceneOrder));

    for (const row of membershipRows) {
      assertPlanOwnershipColumnsMatch(expected, {
        orgId: row.orgId,
        workspaceId: row.workspaceId,
        campaignId: row.campaignId,
        storyId: row.storyId,
        storyVersionId: row.storyVersionId,
        animationPackageId: row.animationPackageId,
        executionPlanId: row.executionPlanId,
      }, "Assembly Scene membership");
    }

    return assertAssemblyReloadIntegrity(definitionRow, membershipRows);
  }

  private async isReviewApproved(
    executionPlanId: string,
    db: QueryDb
  ): Promise<boolean> {
    const [openedRow] = await db
      .select()
      .from(schema.aiStoryReviewOpenedFacts)
      .where(eq(schema.aiStoryReviewOpenedFacts.executionPlanId, executionPlanId))
      .limit(1);
    const sceneRows = await db
      .select()
      .from(schema.aiStorySceneIntentReviewFacts)
      .where(eq(schema.aiStorySceneIntentReviewFacts.executionPlanId, executionPlanId))
      .orderBy(asc(schema.aiStorySceneIntentReviewFacts.acceptedAt));
    const storyRows = await db
      .select()
      .from(schema.aiStoryStoryReviewFacts)
      .where(eq(schema.aiStoryStoryReviewFacts.executionPlanId, executionPlanId))
      .orderBy(asc(schema.aiStoryStoryReviewFacts.acceptedAt));
    const requiredSceneRows = await db
      .select({ id: schema.aiStorySceneExecutions.id })
      .from(schema.aiStorySceneExecutions)
      .where(eq(schema.aiStorySceneExecutions.executionPlanId, executionPlanId))
      .orderBy(asc(schema.aiStorySceneExecutions.sceneOrder));

    const opened = openedRow ? ReviewOpenedFactSchema.parse(openedRow.fact) : null;
    const sceneDecisions = sceneRows.map((row) =>
      SceneIntentReviewDecisionSchema.parse(row.fact)
    );
    const storyDecision = storyRows[storyRows.length - 1]
      ? StoryReviewDecisionSchema.parse(storyRows[storyRows.length - 1]!.fact)
      : null;

    return (
      deriveLogicalReviewStatus({
        opened,
        sceneDecisions,
        storyDecision,
        requiredSceneExecutionIds: requiredSceneRows.map((row) => row.id),
      }) === "APPROVED"
    );
  }
}
