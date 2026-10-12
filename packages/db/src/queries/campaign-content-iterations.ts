import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  CampaignContentIterationStateSchema,
  CampaignCreativeArtifactTypeSchema,
  CampaignWorkflowFactPayloadSchema,
  CampaignWorkflowFactTypeSchema,
  canTransitionCampaignContentIteration,
  type CampaignContentIterationState,
  type CampaignCreativeArtifactType,
  type CampaignWorkflowFactType,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";

type Db = ReturnType<typeof getDb>;
type Scope = { orgId: string; workspaceId: string; campaignId: string; actorUserId: string };
type CommandResult = {
  iteration: typeof schema.campaignContentIterations.$inferSelect;
  fact: typeof schema.campaignWorkflowFacts.$inferSelect;
  reused: boolean;
};

const MUTATION_ROLES = new Set(["admin", "operator", "editor"]);

export class CampaignContentIterationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CampaignContentIterationError";
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

async function assertScope(db: Pick<Db, "execute">, scope: Scope, mutation: boolean) {
  const rows = await db.execute<{ role: string }>(sql`
    select wm.role
    from campaigns c
    join workspaces w on w.id=c.workspace_id and w.org_id=c.org_id
    join workspace_members wm on wm.workspace_id=c.workspace_id and wm.org_id=c.org_id
    where c.id=${scope.campaignId}::uuid and c.org_id=${scope.orgId}::uuid
      and c.workspace_id=${scope.workspaceId}::uuid and wm.user_id=${scope.actorUserId}::uuid
    limit 1
  `);
  const role = rows[0]?.role;
  if (!role) throw new CampaignContentIterationError("CAMPAIGN_SCOPE_DENIED", "Campaign does not resolve inside the actor Workspace");
  if (mutation && !MUTATION_ROLES.has(role)) {
    throw new CampaignContentIterationError("CAMPAIGN_ITERATION_ROLE_DENIED", "Workspace role cannot mutate Campaign iterations");
  }
}

function assertIdempotentFact(existing: typeof schema.campaignWorkflowFacts.$inferSelect | undefined, expectedFingerprint: string) {
  if (!existing) return;
  if (existing.commandFingerprint !== expectedFingerprint) {
    throw new CampaignContentIterationError("CAMPAIGN_ITERATION_IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different command");
  }
}

export class CampaignContentIterationService {
  constructor(private readonly db: Db = getDb()) {}

  async create(scope: Scope, input: { idempotencyKey: string; payload?: Record<string, unknown> }): Promise<CommandResult> {
    const payload = CampaignWorkflowFactPayloadSchema.parse(input.payload ?? {});
    const commandFingerprint = fingerprint({ kind: "create", scope: { orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId }, payload });
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`campaign-iterations:${scope.campaignId}`}))`);
      await assertScope(tx, scope, true);
      const [existing] = await tx.select().from(schema.campaignContentIterations).where(and(
        eq(schema.campaignContentIterations.workspaceId, scope.workspaceId),
        eq(schema.campaignContentIterations.campaignId, scope.campaignId),
        eq(schema.campaignContentIterations.creationIdempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (existing) {
        if (existing.creationFingerprint !== commandFingerprint) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_IDEMPOTENCY_CONFLICT", "Creation key was already used with different input");
        const [fact] = await tx.select().from(schema.campaignWorkflowFacts).where(and(
          eq(schema.campaignWorkflowFacts.iterationId, existing.id),
          eq(schema.campaignWorkflowFacts.idempotencyKey, input.idempotencyKey),
        )).limit(1);
        if (!fact) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_HISTORY_INCOMPLETE", "Creation fact is missing");
        return { iteration: existing, fact, reused: true };
      }
      const sequenceRows = await tx.execute<{ next_sequence: number }>(sql`
        select coalesce(max(sequence_number),0)+1 as next_sequence
        from campaign_content_iterations where campaign_id=${scope.campaignId}::uuid
      `);
      const [iteration] = await tx.insert(schema.campaignContentIterations).values({
        orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId,
        sequenceNumber: Number(sequenceRows[0]?.next_sequence ?? 1), state: "PLANNING", version: 1,
        creationIdempotencyKey: input.idempotencyKey, creationFingerprint: commandFingerprint,
        createdBy: scope.actorUserId,
      }).returning();
      if (!iteration) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_CREATE_FAILED", "Iteration insert returned no row");
      const [fact] = await tx.insert(schema.campaignWorkflowFacts).values({
        orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId,
        iterationId: iteration.id, factType: "ITERATION_CREATED", sequenceNumber: 1,
        fromState: null, toState: "PLANNING", iterationVersion: 1, payload,
        idempotencyKey: input.idempotencyKey, commandFingerprint, actorUserId: scope.actorUserId,
      }).returning();
      if (!fact) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_CREATE_FAILED", "Creation fact insert returned no row");
      return { iteration, fact, reused: false };
    });
  }

  async transition(scope: Scope, iterationId: string, input: { expectedVersion: number; toState: CampaignContentIterationState; idempotencyKey: string; payload?: Record<string, unknown> }): Promise<CommandResult> {
    const toState = CampaignContentIterationStateSchema.parse(input.toState);
    return this.append(scope, iterationId, {
      expectedVersion: input.expectedVersion, factType: "STATE_TRANSITIONED", idempotencyKey: input.idempotencyKey,
      payload: input.payload, toState,
    });
  }

  async appendFact(scope: Scope, iterationId: string, input: { expectedVersion: number; factType: CampaignWorkflowFactType; idempotencyKey: string; payload?: Record<string, unknown> }): Promise<CommandResult> {
    const factType = CampaignWorkflowFactTypeSchema.parse(input.factType);
    if (factType === "ITERATION_CREATED" || factType === "STATE_TRANSITIONED" || factType === "ARTIFACT_ATTACHED") {
      throw new CampaignContentIterationError("CAMPAIGN_ITERATION_FACT_RESERVED", "Lifecycle facts must use their dedicated command");
    }
    return this.append(scope, iterationId, { ...input, factType });
  }

  async attachArtifact(scope: Scope, iterationId: string, input: { expectedVersion: number; artifactType: CampaignCreativeArtifactType; artifactId: string; idempotencyKey: string }): Promise<CommandResult> {
    const artifactType = CampaignCreativeArtifactTypeSchema.parse(input.artifactType);
    await assertScope(this.db, scope, true);
    const identity = (table: { id: typeof schema.tasks.id; orgId: typeof schema.tasks.orgId; workspaceId: typeof schema.tasks.workspaceId; campaignId: typeof schema.tasks.campaignId }) =>
      and(eq(table.id, input.artifactId), eq(table.orgId, scope.orgId), eq(table.workspaceId, scope.workspaceId), eq(table.campaignId, scope.campaignId));
    const rows = artifactType === "VIDEO_TASK"
      ? await this.db.select({ id: schema.tasks.id }).from(schema.tasks).where(identity(schema.tasks)).limit(1)
      : artifactType === "PHOTO_SCENE_GENERATION"
        ? await this.db.select({ id: schema.photoSceneGenerations.id }).from(schema.photoSceneGenerations).where(and(
            eq(schema.photoSceneGenerations.id, input.artifactId), eq(schema.photoSceneGenerations.orgId, scope.orgId),
            eq(schema.photoSceneGenerations.workspaceId, scope.workspaceId), eq(schema.photoSceneGenerations.campaignId, scope.campaignId),
          )).limit(1)
        : await this.db.select({ id: schema.aiStories.id }).from(schema.aiStories).where(and(
            eq(schema.aiStories.id, input.artifactId), eq(schema.aiStories.orgId, scope.orgId),
            eq(schema.aiStories.workspaceId, scope.workspaceId), eq(schema.aiStories.campaignId, scope.campaignId),
          )).limit(1);
    if (!rows[0]) throw new CampaignContentIterationError("CAMPAIGN_ARTIFACT_SCOPE_DENIED", "Creative artifact does not resolve inside the Campaign scope");
    return this.append(scope, iterationId, {
      expectedVersion: input.expectedVersion, factType: "ARTIFACT_ATTACHED", idempotencyKey: input.idempotencyKey,
      payload: { artifactType, artifactId: input.artifactId },
    });
  }

  private async append(scope: Scope, iterationId: string, input: { expectedVersion: number; factType: CampaignWorkflowFactType; idempotencyKey: string; payload?: Record<string, unknown>; toState?: CampaignContentIterationState }): Promise<CommandResult> {
    const payload = CampaignWorkflowFactPayloadSchema.parse(input.payload ?? {});
    const commandFingerprint = fingerprint({ kind: input.factType, expectedVersion: input.expectedVersion, toState: input.toState ?? null, payload });
    return this.db.transaction(async (tx) => {
      await assertScope(tx, scope, true);
      const [iteration] = await tx.select().from(schema.campaignContentIterations).where(and(
        eq(schema.campaignContentIterations.id, iterationId), eq(schema.campaignContentIterations.orgId, scope.orgId),
        eq(schema.campaignContentIterations.workspaceId, scope.workspaceId), eq(schema.campaignContentIterations.campaignId, scope.campaignId),
      )).for("update").limit(1);
      if (!iteration) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_NOT_FOUND", "Iteration does not resolve inside the Campaign scope");
      const [existingFact] = await tx.select().from(schema.campaignWorkflowFacts).where(and(
        eq(schema.campaignWorkflowFacts.iterationId, iterationId), eq(schema.campaignWorkflowFacts.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      assertIdempotentFact(existingFact, commandFingerprint);
      if (existingFact) return { iteration, fact: existingFact, reused: true };
      if (iteration.version !== input.expectedVersion) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_VERSION_CONFLICT", "Iteration was changed by another command");
      const fromState = CampaignContentIterationStateSchema.parse(iteration.state);
      const nextState = input.toState ?? fromState;
      if (input.toState && !canTransitionCampaignContentIteration(fromState, nextState)) {
        throw new CampaignContentIterationError("CAMPAIGN_ITERATION_TRANSITION_INVALID", `Cannot transition ${fromState} to ${nextState}`);
      }
      const nextVersion = iteration.version + 1;
      const [updated] = await tx.update(schema.campaignContentIterations).set({ state: nextState, version: nextVersion, updatedAt: new Date() }).where(and(
        eq(schema.campaignContentIterations.id, iterationId), eq(schema.campaignContentIterations.version, input.expectedVersion),
      )).returning();
      if (!updated) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_VERSION_CONFLICT", "Iteration update lost a concurrent race");
      const [fact] = await tx.insert(schema.campaignWorkflowFacts).values({
        orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, iterationId,
        factType: input.factType, sequenceNumber: nextVersion, fromState,
        toState: input.toState ?? null, iterationVersion: nextVersion, payload,
        idempotencyKey: input.idempotencyKey, commandFingerprint, actorUserId: scope.actorUserId,
      }).returning();
      if (!fact) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_UPDATE_FAILED", "Workflow fact insert returned no row");
      return { iteration: updated, fact, reused: false };
    });
  }

  async history(scope: Scope, iterationId: string) {
    await assertScope(this.db, scope, false);
    const [iteration] = await this.db.select().from(schema.campaignContentIterations).where(and(
      eq(schema.campaignContentIterations.id, iterationId), eq(schema.campaignContentIterations.orgId, scope.orgId),
      eq(schema.campaignContentIterations.workspaceId, scope.workspaceId), eq(schema.campaignContentIterations.campaignId, scope.campaignId),
    )).limit(1);
    if (!iteration) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_NOT_FOUND", "Iteration does not resolve inside the Campaign scope");
    const facts = await this.db.select().from(schema.campaignWorkflowFacts).where(eq(schema.campaignWorkflowFacts.iterationId, iterationId)).orderBy(asc(schema.campaignWorkflowFacts.sequenceNumber));
    return { iteration, facts };
  }
}
