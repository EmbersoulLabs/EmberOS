import { eq, sql } from "drizzle-orm";
import {
  AiStoryCompiledProviderRequestSchema,
  AiStoryProviderAttemptBindingSchema,
  type AiStoryCompiledProviderRequest,
  type AiStoryProviderAttemptBinding,
  isAiStoryProviderAttemptTransitionAllowed,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";

type Db = ReturnType<typeof getDb>;

export class AiStoryProviderRuntimePersistenceError extends Error {
  constructor(readonly code: "IMMUTABLE_CONFLICT" | "ATTEMPT_CONFLICT", message: string) {
    super(message);
    this.name = "AiStoryProviderRuntimePersistenceError";
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class AiStoryProviderRuntimeRepository {
  constructor(private readonly db: Db = getDb()) {}

  async acceptCompiledRequest(input: AiStoryCompiledProviderRequest): Promise<AiStoryCompiledProviderRequest> {
    const request = AiStoryCompiledProviderRequestSchema.parse(input);
    const inserted = await this.db.insert(schema.aiStoryCompiledProviderRequests).values({
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
    }).onConflictDoNothing().returning({ compiledRequest: schema.aiStoryCompiledProviderRequests.compiledRequest });
    if (inserted[0]) return AiStoryCompiledProviderRequestSchema.parse(inserted[0].compiledRequest);
    const existing = await this.getCompiledRequest(request.compiledRequestId);
    if (!existing || !same(existing, request)) throw new AiStoryProviderRuntimePersistenceError("IMMUTABLE_CONFLICT", "Compiled Provider request identity conflicts");
    return existing;
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
      .where(eq(schema.aiStoryCompiledProviderRequests.sceneExecutionId, sceneExecutionId))
      .orderBy(sql`${schema.aiStoryCompiledProviderRequests.compiledAt} desc`).limit(1);
    return row ? AiStoryCompiledProviderRequestSchema.parse(row.request) : null;
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
