import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  AiStoryAiQcResultSchema,
  AiStoryExecutionPlanSchema,
  AiStorySceneCompiledInstructionsSchema,
  AiStorySceneExecutionIntentSchema,
  type AiStoryAiQcResult,
  type AiStoryExecutionPlan,
  type AiStorySceneCompiledInstructions,
  type AiStorySceneExecutionIntent,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type QueryDb = Db | Tx;

export class ExecutionPlanIdentityConflictError extends Error {
  readonly code = "EXECUTION_PLAN_IDENTITY_CONFLICT";
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "ExecutionPlanIdentityConflictError";
  }
}

export class ExecutionPlanOwnershipError extends Error {
  readonly code = "EXECUTION_PLAN_OWNERSHIP_INVALID";
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "ExecutionPlanOwnershipError";
  }
}

export type PersistSceneExecutionCompilationInput = {
  readonly plan: AiStoryExecutionPlan;
  readonly intents: readonly AiStorySceneExecutionIntent[];
  readonly instructionsBySceneExecutionId: Readonly<
    Record<string, AiStorySceneCompiledInstructions>
  >;
  readonly validationResults: readonly AiStoryAiQcResult[];
};

export type PersistedSceneExecutionCompilation = {
  readonly plan: AiStoryExecutionPlan;
  readonly intents: readonly AiStorySceneExecutionIntent[];
  readonly instructionsBySceneExecutionId: Readonly<
    Record<string, AiStorySceneCompiledInstructions>
  >;
  readonly validationResults: readonly AiStoryAiQcResult[];
  readonly acceptedAt: string;
};

/** Canonical Persistence Foundation repository surface (no execution APIs). */
export interface AiStorySceneExecutionPersistenceStore {
  persistCompilation(
    input: PersistSceneExecutionCompilationInput
  ): Promise<PersistedSceneExecutionCompilation>;
  getByExecutionPlanId(id: string): Promise<PersistedSceneExecutionCompilation | null>;
  getByDeterministicFingerprint(
    fingerprint: string
  ): Promise<PersistedSceneExecutionCompilation | null>;
  listByStoryVersionId(
    storyVersionId: string,
    workspaceId?: string
  ): Promise<readonly PersistedSceneExecutionCompilation[]>;
  getInstructionSnapshot(contentHash: string): Promise<AiStorySceneCompiledInstructions | null>;
  getValidationResults(sceneExecutionId: string): Promise<readonly AiStoryAiQcResult[]>;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortValue(child)])
    );
  }
  return value;
}

export function canonicalPersistenceHash(value: unknown): string {
  const canonical = JSON.stringify(sortValue(value));
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/**
 * Canonical uniqueness key for one deterministic Execution Plan.
 * Includes workspace so identical compiles in different workspaces never collide.
 */
export function executionPlanDeterministicFingerprint(plan: AiStoryExecutionPlan): string {
  const workspaceId = plan.sceneExecutions[0]?.workspaceId;
  if (!workspaceId) {
    throw new ExecutionPlanIdentityConflictError("Execution Plan is missing workspace identity");
  }
  return canonicalPersistenceHash({
    workspaceId,
    storyVersionId: plan.frozenStoryVersion.storyVersionId,
    animationPackageId: plan.animationPackage.animationPackageId,
    compilationHash: plan.compilationHash,
    sceneExecutions: plan.sceneExecutions,
  });
}

export function deterministicPersistenceUuid(kind: string, value: unknown): string {
  const hex = canonicalPersistenceHash({ kind, value })
    .replace(/^sha256:/, "")
    .slice(0, 32);
  const bytes = hex.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const normalized = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function assertEquivalentExecutionPlan(
  existing: AiStoryExecutionPlan,
  requested: AiStoryExecutionPlan
): void {
  if (
    existing.storyExecutionId !== requested.storyExecutionId ||
    existing.compilationHash !== requested.compilationHash ||
    existing.animationPackage.animationPackageId !==
      requested.animationPackage.animationPackageId ||
    canonicalPersistenceHash(existing.sceneExecutions) !==
      canonicalPersistenceHash(requested.sceneExecutions) ||
    executionPlanDeterministicFingerprint(existing) !==
      executionPlanDeterministicFingerprint(requested)
  ) {
    throw new ExecutionPlanIdentityConflictError(
      "A different immutable compile is already accepted for this deterministic identity"
    );
  }
}

export function validateSceneExecutionPersistenceInput(
  input: PersistSceneExecutionCompilationInput
) {
  const plan = AiStoryExecutionPlanSchema.parse(input.plan);
  const intents = input.intents.map((intent) =>
    AiStorySceneExecutionIntentSchema.parse(intent)
  );
  const instructions = Object.fromEntries(
    Object.entries(input.instructionsBySceneExecutionId).map(([id, value]) => [
      id,
      AiStorySceneCompiledInstructionsSchema.parse(value),
    ])
  );
  const validations = input.validationResults.map((result) =>
    AiStoryAiQcResultSchema.parse(result)
  );

  if (intents.length !== plan.sceneExecutions.length) {
    throw new ExecutionPlanIdentityConflictError("Plan and Scene Intent counts differ");
  }
  plan.sceneExecutions.forEach((identity, index) => {
    const intent = intents[index];
    if (
      !intent ||
      intent.identity.sceneExecutionId !== identity.sceneExecutionId ||
      intent.identity.sceneOrder !== identity.sceneOrder
    ) {
      throw new ExecutionPlanIdentityConflictError(
        "Scene Intent ordering conflicts with the plan"
      );
    }
    const snapshot = instructions[identity.sceneExecutionId];
    if (!snapshot) {
      throw new ExecutionPlanIdentityConflictError("A Scene instruction snapshot is missing");
    }
    if (canonicalPersistenceHash(snapshot) !== intent.normalizedPayloadReference.contentHash) {
      throw new ExecutionPlanIdentityConflictError(
        "Scene instruction hash conflicts with the Intent"
      );
    }
  });
  for (const result of validations) {
    const intent = intents.find(
      (candidate) => candidate.identity.sceneExecutionId === result.intentId
    );
    if (!intent || intent.identity.sceneId !== result.sceneId) {
      throw new ExecutionPlanIdentityConflictError("QC result does not belong to this plan");
    }
  }
  return { plan, intents, instructions, validations };
}

function extractAnimationPackageSceneIds(payload: unknown): Set<string> {
  if (!payload || typeof payload !== "object") return new Set();
  const scenePlan = (payload as { scenePlan?: unknown }).scenePlan;
  if (!Array.isArray(scenePlan)) return new Set();
  return new Set(
    scenePlan
      .map((scene) =>
        scene && typeof scene === "object" && typeof (scene as { id?: unknown }).id === "string"
          ? (scene as { id: string }).id
          : null
      )
      .filter((id): id is string => Boolean(id))
  );
}

export class AiStorySceneExecutionPersistenceRepository
  implements AiStorySceneExecutionPersistenceStore
{
  constructor(private readonly db: Db = getDb()) {}

  async persistCompilation(
    input: PersistSceneExecutionCompilationInput
  ): Promise<PersistedSceneExecutionCompilation> {
    const normalized = validateSceneExecutionPersistenceInput(input);
    const fingerprint = executionPlanDeterministicFingerprint(normalized.plan);
    return this.db.transaction(async (tx) => {
      await this.assertOwnership(normalized, tx);
      const existing = await this.readByFingerprint(fingerprint, tx);
      if (existing) {
        assertEquivalentExecutionPlan(existing.plan, normalized.plan);
        return existing;
      }

      const first = normalized.intents[0]!.identity;

      for (const intent of normalized.intents) {
        const instructions = normalized.instructions[intent.identity.sceneExecutionId]!;
        const instructionHash = intent.normalizedPayloadReference.contentHash;
        const snapshotId = deterministicPersistenceUuid("instruction-snapshot", instructionHash);
        const inserted = await tx
          .insert(schema.aiStorySceneInstructionSnapshots)
          .values({
            contentHash: instructionHash,
            snapshotId,
            orgId: first.tenantId,
            workspaceId: first.workspaceId,
            contractVersion: instructions.contractVersion,
            instructions,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted[0]) {
          const [accepted] = await tx
            .select()
            .from(schema.aiStorySceneInstructionSnapshots)
            .where(eq(schema.aiStorySceneInstructionSnapshots.contentHash, instructionHash))
            .limit(1);
          if (!accepted || canonicalPersistenceHash(accepted.instructions) !== instructionHash) {
            throw new ExecutionPlanIdentityConflictError("Instruction snapshot hash collision");
          }
        }
      }

      let insertedPlans: Array<typeof schema.aiStoryExecutionPlans.$inferSelect> = [];
      try {
        insertedPlans = await tx
          .insert(schema.aiStoryExecutionPlans)
          .values({
            id: normalized.plan.storyExecutionId,
            orgId: first.tenantId,
            workspaceId: first.workspaceId,
            campaignId: first.campaignId,
            storyId: first.storyId,
            storyVersionId: first.storyVersionId,
            animationPackageId: first.animationPackageId,
            status: "PLANNED",
            contractVersion: normalized.plan.contractVersion,
            compilationHash: normalized.plan.compilationHash,
            deterministicFingerprint: fingerprint,
            plan: normalized.plan,
            compiledAt: new Date(normalized.plan.compiledAt),
          })
          .onConflictDoNothing()
          .returning();
      } catch {
        throw new ExecutionPlanIdentityConflictError(
          "Execution Plan identity conflict under concurrent or divergent persistence"
        );
      }
      if (!insertedPlans[0]) {
        const acceptedByFingerprint = await this.readByFingerprint(fingerprint, tx);
        if (acceptedByFingerprint) {
          assertEquivalentExecutionPlan(acceptedByFingerprint.plan, normalized.plan);
          return acceptedByFingerprint;
        }
        const [acceptedById] = await tx
          .select()
          .from(schema.aiStoryExecutionPlans)
          .where(eq(schema.aiStoryExecutionPlans.id, normalized.plan.storyExecutionId))
          .limit(1);
        if (acceptedById) {
          throw new ExecutionPlanIdentityConflictError(
            "Execution Plan ID is already bound to a different deterministic compile"
          );
        }
        throw new ExecutionPlanIdentityConflictError("Execution Plan identity conflict");
      }

      for (const intent of normalized.intents) {
        const id = intent.identity;
        await tx.insert(schema.aiStorySceneExecutions).values({
          id: id.sceneExecutionId,
          executionPlanId: normalized.plan.storyExecutionId,
          orgId: id.tenantId,
          workspaceId: id.workspaceId,
          campaignId: id.campaignId,
          storyId: id.storyId,
          storyVersionId: id.storyVersionId,
          animationPackageId: id.animationPackageId,
          sceneId: id.sceneId,
          sceneOrder: id.sceneOrder,
          status: "PLANNED",
          idempotencyKey: id.idempotencyKey,
          deterministicFingerprint: id.deterministicFingerprint,
          compilationHash: intent.compilationHash,
          instructionHash: intent.normalizedPayloadReference.contentHash,
          intent,
        });
      }

      for (const result of normalized.validations) {
        const intent = normalized.intents.find(
          (candidate) => candidate.identity.sceneExecutionId === result.intentId
        )!;
        const intentHash = canonicalPersistenceHash(intent);
        const resultHash = canonicalPersistenceHash({
          status: result.status,
          intentId: result.intentId,
          sceneId: result.sceneId,
          contractVersion: result.contractVersion,
          errors: result.errors,
        });
        const validationId = deterministicPersistenceUuid("scene-intent-validation", {
          intentHash,
          resultHash,
        });
        const insertedValidations = await tx
          .insert(schema.aiStorySceneIntentValidationResults)
          .values({
            id: validationId,
            orgId: first.tenantId,
            workspaceId: first.workspaceId,
            executionPlanId: normalized.plan.storyExecutionId,
            sceneExecutionId: result.intentId,
            intentHash,
            resultHash,
            contractVersion: result.contractVersion,
            status: result.status,
            result,
            validatedAt: new Date(result.validatedAt),
          })
          .onConflictDoNothing()
          .returning();
        if (!insertedValidations[0]) {
          const [acceptedValidation] = await tx
            .select()
            .from(schema.aiStorySceneIntentValidationResults)
            .where(eq(schema.aiStorySceneIntentValidationResults.id, validationId))
            .limit(1);
          const acceptedHash = acceptedValidation
            ? canonicalPersistenceHash({
                status: acceptedValidation.result.status,
                intentId: acceptedValidation.result.intentId,
                sceneId: acceptedValidation.result.sceneId,
                contractVersion: acceptedValidation.result.contractVersion,
                errors: acceptedValidation.result.errors,
              })
            : null;
          if (!acceptedValidation || acceptedHash !== resultHash) {
            throw new ExecutionPlanIdentityConflictError("Validation result identity conflict");
          }
        }
      }

      const accepted = await this.readByFingerprint(fingerprint, tx);
      if (!accepted) throw new Error("Atomic persistence did not produce an Execution Plan");
      return accepted;
    });
  }

  async getByExecutionPlanId(
    id: string,
    db: QueryDb = this.db
  ): Promise<PersistedSceneExecutionCompilation | null> {
    const [row] = await db
      .select()
      .from(schema.aiStoryExecutionPlans)
      .where(eq(schema.aiStoryExecutionPlans.id, id))
      .limit(1);
    return row ? this.hydratePlan(row, db) : null;
  }

  /** Compact read used by review projections that only require frozen Scene identities. */
  async listIntentsByExecutionPlanId(
    executionPlanId: string,
    db: QueryDb = this.db
  ): Promise<readonly AiStorySceneExecutionIntent[]> {
    const rows = await db
      .select({ intent: schema.aiStorySceneExecutions.intent })
      .from(schema.aiStorySceneExecutions)
      .where(eq(schema.aiStorySceneExecutions.executionPlanId, executionPlanId))
      .orderBy(asc(schema.aiStorySceneExecutions.sceneOrder));
    return deepFreeze(
      rows.map((row) => AiStorySceneExecutionIntentSchema.parse(row.intent))
    );
  }

  async getByDeterministicFingerprint(
    fingerprint: string
  ): Promise<PersistedSceneExecutionCompilation | null> {
    return this.readByFingerprint(fingerprint, this.db);
  }

  async listByStoryVersionId(
    storyVersionId: string,
    workspaceId?: string
  ): Promise<readonly PersistedSceneExecutionCompilation[]> {
    const rows = await this.db
      .select()
      .from(schema.aiStoryExecutionPlans)
      .where(
        workspaceId
          ? and(
              eq(schema.aiStoryExecutionPlans.storyVersionId, storyVersionId),
              eq(schema.aiStoryExecutionPlans.workspaceId, workspaceId)
            )
          : eq(schema.aiStoryExecutionPlans.storyVersionId, storyVersionId)
      )
      .orderBy(asc(schema.aiStoryExecutionPlans.createdAt));
    const hydrated = [];
    for (const row of rows) {
      hydrated.push(await this.hydratePlan(row, this.db));
    }
    return deepFreeze(hydrated);
  }

  async getInstructionSnapshot(
    contentHash: string
  ): Promise<AiStorySceneCompiledInstructions | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStorySceneInstructionSnapshots)
      .where(eq(schema.aiStorySceneInstructionSnapshots.contentHash, contentHash))
      .limit(1);
    return row
      ? deepFreeze(AiStorySceneCompiledInstructionsSchema.parse(row.instructions))
      : null;
  }

  async getValidationResults(sceneExecutionId: string): Promise<readonly AiStoryAiQcResult[]> {
    const rows = await this.db
      .select()
      .from(schema.aiStorySceneIntentValidationResults)
      .where(eq(schema.aiStorySceneIntentValidationResults.sceneExecutionId, sceneExecutionId))
      .orderBy(
        asc(schema.aiStorySceneIntentValidationResults.acceptedAt),
        asc(schema.aiStorySceneIntentValidationResults.id)
      );
    return deepFreeze(rows.map((row) => AiStoryAiQcResultSchema.parse(row.result)));
  }

  private async readByFingerprint(
    fingerprint: string,
    db: QueryDb
  ): Promise<PersistedSceneExecutionCompilation | null> {
    const [planRow] = await db
      .select()
      .from(schema.aiStoryExecutionPlans)
      .where(eq(schema.aiStoryExecutionPlans.deterministicFingerprint, fingerprint))
      .limit(1);
    return planRow ? this.hydratePlan(planRow, db) : null;
  }

  private async hydratePlan(
    planRow: typeof schema.aiStoryExecutionPlans.$inferSelect,
    db: QueryDb
  ): Promise<PersistedSceneExecutionCompilation> {
    const sceneRows = await db
      .select()
      .from(schema.aiStorySceneExecutions)
      .where(eq(schema.aiStorySceneExecutions.executionPlanId, planRow.id))
      .orderBy(asc(schema.aiStorySceneExecutions.sceneOrder));
    const validationRows = await db
      .select()
      .from(schema.aiStorySceneIntentValidationResults)
      .where(eq(schema.aiStorySceneIntentValidationResults.executionPlanId, planRow.id))
      .orderBy(
        asc(schema.aiStorySceneIntentValidationResults.acceptedAt),
        asc(schema.aiStorySceneIntentValidationResults.id)
      );
    const snapshotRows = sceneRows.length
      ? await db
          .select()
          .from(schema.aiStorySceneInstructionSnapshots)
          .where(
            inArray(
              schema.aiStorySceneInstructionSnapshots.contentHash,
              sceneRows.map((row) => row.instructionHash)
            )
          )
      : [];
    return deepFreeze({
      plan: AiStoryExecutionPlanSchema.parse(planRow.plan),
      intents: sceneRows.map((row) => AiStorySceneExecutionIntentSchema.parse(row.intent)),
      instructionsBySceneExecutionId: Object.fromEntries(
        sceneRows.map((scene) => {
          const snapshot = snapshotRows.find(
            (candidate) => candidate.contentHash === scene.instructionHash
          );
          if (!snapshot) {
            throw new Error("Instruction snapshot is missing for persisted Scene Intent");
          }
          return [scene.id, AiStorySceneCompiledInstructionsSchema.parse(snapshot.instructions)];
        })
      ),
      validationResults: validationRows.map((row) =>
        AiStoryAiQcResultSchema.parse(row.result)
      ),
      acceptedAt: planRow.createdAt.toISOString(),
    });
  }

  private async assertOwnership(
    normalized: ReturnType<typeof validateSceneExecutionPersistenceInput>,
    db: QueryDb
  ): Promise<void> {
    const first = normalized.intents[0]!.identity;
    if (
      normalized.intents.some((intent) => {
        const id = intent.identity;
        return (
          id.tenantId !== first.tenantId ||
          id.workspaceId !== first.workspaceId ||
          id.campaignId !== first.campaignId ||
          id.storyId !== first.storyId ||
          id.storyVersionId !== first.storyVersionId ||
          id.animationPackageId !== first.animationPackageId
        );
      })
    ) {
      throw new ExecutionPlanOwnershipError("Scene ownership identities do not match");
    }

    const [organization] = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, first.tenantId))
      .limit(1);
    const [workspace] = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(
        and(
          eq(schema.workspaces.id, first.workspaceId),
          eq(schema.workspaces.orgId, first.tenantId)
        )
      )
      .limit(1);
    const [campaign] = await db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.id, first.campaignId),
          eq(schema.campaigns.workspaceId, first.workspaceId),
          eq(schema.campaigns.orgId, first.tenantId)
        )
      )
      .limit(1);
    const [story] = await db
      .select({ id: schema.aiStories.id })
      .from(schema.aiStories)
      .where(
        and(
          eq(schema.aiStories.id, first.storyId),
          eq(schema.aiStories.campaignId, first.campaignId),
          eq(schema.aiStories.workspaceId, first.workspaceId),
          eq(schema.aiStories.orgId, first.tenantId)
        )
      )
      .limit(1);
    const [version] = await db
      .select({
        id: schema.aiStoryVersions.id,
        frozenAt: schema.aiStoryVersions.frozenAt,
      })
      .from(schema.aiStoryVersions)
      .where(
        and(
          eq(schema.aiStoryVersions.id, first.storyVersionId),
          eq(schema.aiStoryVersions.storyId, first.storyId)
        )
      )
      .limit(1);
    const [animationPackage] = await db
      .select({
        id: schema.aiStoryAnimationPackages.id,
        payload: schema.aiStoryAnimationPackages.payload,
      })
      .from(schema.aiStoryAnimationPackages)
      .where(
        and(
          eq(schema.aiStoryAnimationPackages.id, first.animationPackageId),
          eq(schema.aiStoryAnimationPackages.storyId, first.storyId),
          eq(schema.aiStoryAnimationPackages.storyVersionId, first.storyVersionId),
          eq(schema.aiStoryAnimationPackages.campaignId, first.campaignId),
          eq(schema.aiStoryAnimationPackages.workspaceId, first.workspaceId),
          eq(schema.aiStoryAnimationPackages.orgId, first.tenantId)
        )
      )
      .limit(1);

    if (!organization || !workspace || !campaign || !story || !version?.frozenAt || !animationPackage) {
      throw new ExecutionPlanOwnershipError(
        "Organization, Workspace, Campaign, Story, frozen Story Version, or Animation Package ownership is invalid"
      );
    }

    const packageSceneIds = extractAnimationPackageSceneIds(animationPackage.payload);
    for (const intent of normalized.intents) {
      if (!packageSceneIds.has(intent.identity.sceneId)) {
        throw new ExecutionPlanOwnershipError(
          "A Scene does not belong to the Animation Package scene plan"
        );
      }
    }

    const assetIds = [...new Set(normalized.intents.flatMap((intent) => intent.referencedAssetIds))];
    if (!assetIds.length) return;
    const ownedAssets = await db
      .select({
        id: schema.assets.id,
        orgId: schema.assets.orgId,
        workspaceId: schema.assets.workspaceId,
        campaignId: schema.assets.campaignId,
      })
      .from(schema.assets)
      .where(inArray(schema.assets.id, assetIds));
    const campaignLinks = await db
      .select({ assetId: schema.campaignAssetRefs.assetId })
      .from(schema.campaignAssetRefs)
      .where(
        and(
          eq(schema.campaignAssetRefs.campaignId, first.campaignId),
          inArray(schema.campaignAssetRefs.assetId, assetIds)
        )
      );
    const linked = new Set(campaignLinks.map((row) => row.assetId));
    for (const assetId of assetIds) {
      const asset = ownedAssets.find((row) => row.id === assetId);
      if (
        !asset ||
        asset.orgId !== first.tenantId ||
        asset.workspaceId !== first.workspaceId ||
        !linked.has(assetId)
      ) {
        throw new ExecutionPlanOwnershipError("A referenced Campaign Asset is unauthorized");
      }
    }
  }
}
