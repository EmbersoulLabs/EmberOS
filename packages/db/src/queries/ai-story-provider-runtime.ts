import { and, desc, eq, sql } from "drizzle-orm";
import {
  AiStoryCompiledProviderRequestSchema,
  AiStoryProviderAttemptBindingSchema,
  type AiStoryCompiledProviderRequest,
  type AiStoryProviderAttemptBinding,
  SceneSchedulingBundleSchema,
  type SceneSchedulingBundle,
  isAiStoryProviderAttemptTransitionAllowed,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";

type Db = ReturnType<typeof getDb>;
type QueryDb = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export class AiStoryProviderRuntimePersistenceError extends Error {
  constructor(readonly code: "IMMUTABLE_CONFLICT" | "ATTEMPT_CONFLICT", message: string) {
    super(message);
    this.name = "AiStoryProviderRuntimePersistenceError";
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function acceptAiStoryCompiledRequest(
  db: QueryDb,
  input: AiStoryCompiledProviderRequest
): Promise<AiStoryCompiledProviderRequest> {
  const request = AiStoryCompiledProviderRequestSchema.parse(input);
  const inserted = await db.insert(schema.aiStoryCompiledProviderRequests).values({
    compiledRequestId: request.compiledRequestId,
    orgId: request.orgId,
    workspaceId: request.workspaceId,
    campaignId: request.campaignId,
    storyId: request.storyId,
    storyVersionId: request.storyVersionId,
    sceneExecutionId: request.sceneExecutionId,
    requestFingerprint: request.requestFingerprint,
    generationMode: request.generationMode,
    providerId: request.providerId,
    modelId: request.modelId,
    adapterVersion: request.adapterVersion,
    mappingVersion: request.mappingVersion,
    capabilityVersion: request.capabilityVersion,
    qcEvaluationId: request.qcEvaluationId,
    qcFingerprint: request.qcFingerprint,
    compiledRequest: request,
    compiledAt: new Date(request.compiledAt),
  }).onConflictDoNothing().returning({
    compiledRequest: schema.aiStoryCompiledProviderRequests.compiledRequest,
  });
  if (inserted[0]) {
    return AiStoryCompiledProviderRequestSchema.parse(inserted[0].compiledRequest);
  }
  const [row] = await db.select({
    request: schema.aiStoryCompiledProviderRequests.compiledRequest,
  })
    .from(schema.aiStoryCompiledProviderRequests)
    .where(eq(
      schema.aiStoryCompiledProviderRequests.compiledRequestId,
      request.compiledRequestId
    ))
    .limit(1);
  const existing = row
    ? AiStoryCompiledProviderRequestSchema.parse(row.request)
    : null;
  if (!existing || !same(existing, request)) {
    throw new AiStoryProviderRuntimePersistenceError(
      "IMMUTABLE_CONFLICT",
      "Compiled Provider request identity conflicts"
    );
  }
  return existing;
}

export class AiStoryProviderRuntimeRepository {
  constructor(private readonly db: Db = getDb()) {}

  async acceptCompiledRequest(input: AiStoryCompiledProviderRequest): Promise<AiStoryCompiledProviderRequest> {
    return acceptAiStoryCompiledRequest(this.db, input);
  }

  async getCompiledRequest(compiledRequestId: string): Promise<AiStoryCompiledProviderRequest | null> {
    const [row] = await this.db.select({ request: schema.aiStoryCompiledProviderRequests.compiledRequest })
      .from(schema.aiStoryCompiledProviderRequests)
      .where(eq(schema.aiStoryCompiledProviderRequests.compiledRequestId, compiledRequestId)).limit(1);
    return row ? AiStoryCompiledProviderRequestSchema.parse(row.request) : null;
  }

  async getCompiledRequestBySceneExecutionId(sceneExecutionId: string): Promise<AiStoryCompiledProviderRequest | null> {
    const [row] = await this.db.select({ request: schema.aiStoryCompiledProviderRequests.compiledRequest })
      .from(schema.aiStoryCompiledProviderRequests)
      .where(and(
        eq(schema.aiStoryCompiledProviderRequests.sceneExecutionId, sceneExecutionId),
        sql`not exists (
          select 1 from ai_story_pre_dispatch_bundle_supersessions supersession
          where supersession.source_compiled_request_id = ${schema.aiStoryCompiledProviderRequests.compiledRequestId}
        )`
      ))
      .orderBy(sql`${schema.aiStoryCompiledProviderRequests.compiledAt} desc`).limit(1);
    return row ? AiStoryCompiledProviderRequestSchema.parse(row.request) : null;
  }

  async convergeCompiledRequestForAcceptedBundle(input: {
    readonly bundle: SceneSchedulingBundle;
    readonly compiledProviderRequest: AiStoryCompiledProviderRequest;
  }): Promise<AiStoryCompiledProviderRequest> {
    const bundle = SceneSchedulingBundleSchema.parse(input.bundle);
    const request = AiStoryCompiledProviderRequestSchema.parse(
      input.compiledProviderRequest
    );
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select({
        orgId: schema.aiStorySceneSchedulingCorrelations.orgId,
        workspaceId: schema.aiStorySceneSchedulingCorrelations.workspaceId,
        storyId: schema.aiStorySceneSchedulingCorrelations.storyId,
        storyVersionId: schema.aiStorySceneSchedulingCorrelations.storyVersionId,
        sceneExecutionId: schema.aiStorySceneSchedulingCorrelations.sceneExecutionId,
        providerExecutionId: schema.aiStorySceneSchedulingCorrelations.providerExecutionId,
        outboxJobId: schema.aiStorySceneSchedulingCorrelations.outboxJobId,
      }).from(schema.aiStorySceneSchedulingCorrelations).where(eq(
        schema.aiStorySceneSchedulingCorrelations.correlationId,
        bundle.correlation.correlationId
      )).limit(1).for("update");
      const [outbox] = await tx.select({
        executionId: schema.providerOutboxJobs.executionId,
        completedAt: schema.providerOutboxJobs.completedAt,
        deadLetterAt: schema.providerOutboxJobs.deadLetterAt,
      }).from(schema.providerOutboxJobs).where(eq(
        schema.providerOutboxJobs.jobId,
        bundle.outboxJobId
      )).limit(1).for("update");
      if (
        !row || !outbox || outbox.completedAt || outbox.deadLetterAt ||
        row.orgId !== request.orgId ||
        row.workspaceId !== request.workspaceId ||
        row.storyId !== request.storyId ||
        row.storyVersionId !== request.storyVersionId ||
        row.sceneExecutionId !== request.sceneExecutionId ||
        row.providerExecutionId !== bundle.providerExecutionId ||
        row.outboxJobId !== bundle.outboxJobId ||
        outbox.executionId !== bundle.providerExecutionId
      ) {
        throw new AiStoryProviderRuntimePersistenceError(
          "IMMUTABLE_CONFLICT",
          "Accepted scheduling bundle cannot safely converge compiled request authority"
        );
      }
      return acceptAiStoryCompiledRequest(tx, request);
    });
  }

  async getCompilationAuthorityBySceneExecutionId(input: {
    readonly sceneExecutionId: string;
    readonly orgId: string;
    readonly workspaceId: string;
    readonly storyId: string;
    readonly storyVersionId: string;
  }): Promise<{
    readonly qcEvaluationId: string;
    readonly qcFingerprint: string;
    readonly qcCapabilityVersion: string;
    readonly directorFingerprint: string;
    readonly motionFingerprint: string;
  } | null> {
    const [row] = await this.db
      .select({
        qcEvaluationId: schema.aiStoryPreGenerationQcEvaluations.qcEvaluationId,
        qcFingerprint: schema.aiStoryPreGenerationQcEvaluations.qcFingerprint,
        qcCapabilityVersion:
          schema.aiStoryPreGenerationQcEvaluations.providerCapabilityVersion,
        dispatchDecision: schema.aiStoryPreGenerationQcEvaluations.dispatchDecision,
        directorFingerprint: schema.aiStoryDirectorPlanVersions.directorFingerprint,
        directorStatus: schema.aiStoryDirectorPlanVersions.status,
        motionFingerprint: schema.aiStoryMotionPlanVersions.motionFingerprint,
        motionStatus: schema.aiStoryMotionPlanVersions.status,
      })
      .from(schema.aiStoryPreGenerationQcEvaluations)
      .innerJoin(
        schema.aiStoryDirectorPlanVersions,
        eq(
          schema.aiStoryDirectorPlanVersions.directorPlanId,
          schema.aiStoryPreGenerationQcEvaluations.directorPlanId
        )
      )
      .innerJoin(
        schema.aiStoryMotionPlanVersions,
        eq(
          schema.aiStoryMotionPlanVersions.motionPlanId,
          schema.aiStoryPreGenerationQcEvaluations.motionPlanId
        )
      )
      .where(
        and(
          eq(
            schema.aiStoryPreGenerationQcEvaluations.sceneExecutionId,
            input.sceneExecutionId
          ),
          eq(schema.aiStoryPreGenerationQcEvaluations.orgId, input.orgId),
          eq(
            schema.aiStoryPreGenerationQcEvaluations.workspaceId,
            input.workspaceId
          ),
          eq(schema.aiStoryPreGenerationQcEvaluations.storyId, input.storyId),
          eq(
            schema.aiStoryPreGenerationQcEvaluations.storyVersionId,
            input.storyVersionId
          )
        )
      )
      .orderBy(desc(schema.aiStoryPreGenerationQcEvaluations.evaluationVersion))
      .limit(1);
    if (
      !row ||
      !["DISPATCH_ELIGIBLE", "DISPATCH_ELIGIBLE_WITH_WARNINGS"].includes(
        row.dispatchDecision
      ) ||
      row.directorStatus !== "FROZEN" ||
      row.motionStatus !== "FROZEN"
    ) {
      return null;
    }
    return {
      qcEvaluationId: row.qcEvaluationId,
      qcFingerprint: row.qcFingerprint,
      qcCapabilityVersion: row.qcCapabilityVersion,
      directorFingerprint: row.directorFingerprint,
      motionFingerprint: row.motionFingerprint,
    };
  }

  async acceptAttempt(input: AiStoryProviderAttemptBinding): Promise<{ attempt: AiStoryProviderAttemptBinding; replayed: boolean }> {
    const binding = AiStoryProviderAttemptBindingSchema.parse(input);
    await this.db.insert(schema.providerAttempts).values({
      attemptId: binding.providerAttemptId,
      executionId: binding.providerExecutionId,
      contractVersion: binding.contractVersion,
      attemptNumber: binding.attemptNumber,
      providerId: binding.providerId,
      providerVersion: binding.capabilityVersion,
      modelVersion: binding.modelId,
      requestHash: binding.requestFingerprint,
      status: "PENDING",
      warnings: [],
      providerMetadata: {
        compiledRequestId: binding.compiledRequestId,
        attemptInputFingerprint: binding.attemptInputFingerprint,
        generationMode: binding.generationMode,
        estimatedCost: binding.estimatedCost,
      },
    }).onConflictDoNothing();
    const inserted = await this.db.insert(schema.aiStoryProviderAttemptCompiledBindings).values({
      providerAttemptId: binding.providerAttemptId,
      compiledRequestId: binding.compiledRequestId,
      orgId: binding.orgId,
      workspaceId: binding.workspaceId,
      sceneExecutionId: binding.sceneExecutionId,
      idempotencyKey: binding.idempotencyKey,
      requestFingerprint: binding.requestFingerprint,
      attemptInputFingerprint: binding.attemptInputFingerprint,
      status: binding.status,
      providerTaskId: binding.providerTaskId,
      submissionClaimOwner: binding.submissionClaimOwner,
      submissionClaimedAt: binding.submissionClaimedAt ? new Date(binding.submissionClaimedAt) : undefined,
      pollCount: binding.pollCount,
      failureClass: binding.failureClass,
      binding,
      createdAt: new Date(binding.createdAt),
      updatedAt: new Date(binding.updatedAt),
    }).onConflictDoNothing().returning({ binding: schema.aiStoryProviderAttemptCompiledBindings.binding });
    if (inserted[0]) return { attempt: AiStoryProviderAttemptBindingSchema.parse(inserted[0].binding), replayed: false };
    const [row] = await this.db.select({ binding: schema.aiStoryProviderAttemptCompiledBindings.binding })
      .from(schema.aiStoryProviderAttemptCompiledBindings)
      .where(eq(schema.aiStoryProviderAttemptCompiledBindings.idempotencyKey, binding.idempotencyKey)).limit(1);
    if (!row) throw new AiStoryProviderRuntimePersistenceError("ATTEMPT_CONFLICT", "Attempt was not accepted");
    const existing = AiStoryProviderAttemptBindingSchema.parse(row.binding);
    if (existing.attemptInputFingerprint !== binding.attemptInputFingerprint) throw new AiStoryProviderRuntimePersistenceError("ATTEMPT_CONFLICT", "Idempotency key conflicts with Attempt input");
    return { attempt: existing, replayed: true };
  }

  async getAttempt(providerAttemptId: string): Promise<AiStoryProviderAttemptBinding | null> {
    const [row] = await this.db.select({ binding: schema.aiStoryProviderAttemptCompiledBindings.binding })
      .from(schema.aiStoryProviderAttemptCompiledBindings)
      .where(eq(schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId, providerAttemptId)).limit(1);
    return row ? AiStoryProviderAttemptBindingSchema.parse(row.binding) : null;
  }

  async claimSubmission(input: { providerAttemptId: string; workerId: string; claimedAt: string }): Promise<AiStoryProviderAttemptBinding | null> {
    return this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select binding from ai_story_provider_attempt_compiled_bindings
        where provider_attempt_id = ${input.providerAttemptId} and status = 'READY'
        for update skip locked
      `)) as unknown as Array<{ binding: AiStoryProviderAttemptBinding }>;
      const current = rows[0]?.binding ? AiStoryProviderAttemptBindingSchema.parse(rows[0].binding) : null;
      if (!current) return null;
      const claimed = AiStoryProviderAttemptBindingSchema.parse({
        ...current,
        status: "DISPATCHING",
        submissionClaimOwner: input.workerId,
        submissionClaimedAt: input.claimedAt,
        submitStartedAt: input.claimedAt,
        updatedAt: input.claimedAt,
      });
      await tx.update(schema.aiStoryProviderAttemptCompiledBindings).set({
        status: claimed.status,
        submissionClaimOwner: input.workerId,
        submissionClaimedAt: new Date(input.claimedAt),
        binding: claimed,
        updatedAt: new Date(input.claimedAt),
      }).where(eq(schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId, input.providerAttemptId));
      return claimed;
    });
  }

  async updateAttempt(input: AiStoryProviderAttemptBinding): Promise<AiStoryProviderAttemptBinding> {
    const next = AiStoryProviderAttemptBindingSchema.parse(input);
    const current = await this.getAttempt(next.providerAttemptId);
    if (!current || current.compiledRequestId !== next.compiledRequestId || current.requestFingerprint !== next.requestFingerprint || current.attemptInputFingerprint !== next.attemptInputFingerprint) {
      throw new AiStoryProviderRuntimePersistenceError("IMMUTABLE_CONFLICT", "Attempt immutable input cannot change");
    }
    if (!isAiStoryProviderAttemptTransitionAllowed(current.status, next.status)) {
      throw new AiStoryProviderRuntimePersistenceError("ATTEMPT_CONFLICT", `Invalid Provider Attempt transition: ${current.status} → ${next.status}`);
    }
    await this.db.update(schema.aiStoryProviderAttemptCompiledBindings).set({
      status: next.status,
      providerTaskId: next.providerTaskId,
      submissionClaimOwner: next.submissionClaimOwner,
      submissionClaimedAt: next.submissionClaimedAt ? new Date(next.submissionClaimedAt) : undefined,
      pollCount: next.pollCount,
      failureClass: next.failureClass,
      binding: next,
      updatedAt: new Date(next.updatedAt),
    }).where(eq(schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId, next.providerAttemptId));
    return next;
  }
}
