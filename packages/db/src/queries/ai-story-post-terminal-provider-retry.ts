import { and, count, eq, sql } from "drizzle-orm";
import {
  AI_STORY_POST_TERMINAL_PROVIDER_RETRY_CONTRACT_VERSION,
  AuthorizePostTerminalProviderRetryCommandSchema,
  PostTerminalProviderRetryAuthorizationFactSchema,
  type AuthorizePostTerminalProviderRetryCommand,
  type PostTerminalProviderRetryAuthorizationFact,
} from "@ceo-agent/shared";
import { commercialExecutionIdentityForPlan } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;

export class PostTerminalProviderRetryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409
  ) {
    super(message);
    this.name = "PostTerminalProviderRetryError";
  }
}

export class PostTerminalProviderRetryRepository {
  constructor(
    private readonly db: Db = getDb(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async authorize(
    command: AuthorizePostTerminalProviderRetryCommand
  ): Promise<PostTerminalProviderRetryAuthorizationFact> {
    const input = AuthorizePostTerminalProviderRetryCommandSchema.parse(command);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout='5s'`);
      await tx.execute(sql`
        select id from ai_story_scene_executions
        where id=${input.sceneExecutionId}::uuid
          and execution_plan_id=${input.executionPlanId}::uuid
        for update
      `);

      const [source] = await tx
        .select({
          scene: schema.aiStorySceneExecutions,
          compiled: schema.aiStoryCompiledProviderRequests,
          binding: schema.aiStoryProviderAttemptCompiledBindings,
          attempt: schema.providerAttempts,
          worker: schema.aiStoryWorkerExecutionResults,
          reservation: schema.certificationCommercialReservations,
          commercial: schema.commercialExecutionAuthorizations,
        })
        .from(schema.aiStorySceneExecutions)
        .innerJoin(
          schema.aiStoryCompiledProviderRequests,
          eq(
            schema.aiStoryCompiledProviderRequests.compiledRequestId,
            input.sourceCompiledRequestId
          )
        )
        .innerJoin(
          schema.aiStoryProviderAttemptCompiledBindings,
          and(
            eq(
              schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId,
              input.priorProviderAttemptId
            ),
            eq(
              schema.aiStoryProviderAttemptCompiledBindings.compiledRequestId,
              input.sourceCompiledRequestId
            )
          )
        )
        .innerJoin(
          schema.providerAttempts,
          eq(schema.providerAttempts.attemptId, input.priorProviderAttemptId)
        )
        .innerJoin(
          schema.aiStoryWorkerExecutionResults,
          and(
            eq(
              schema.aiStoryWorkerExecutionResults.workerExecutionResultId,
              input.priorWorkerResultId
            ),
            eq(
              schema.aiStoryWorkerExecutionResults.providerAttemptId,
              input.priorProviderAttemptId
            )
          )
        )
        .innerJoin(
          schema.certificationCommercialReservations,
          eq(
            schema.certificationCommercialReservations.executionIdentity,
            input.priorProviderAttemptId
          )
        )
        .innerJoin(
          schema.commercialExecutionAuthorizations,
          eq(
            schema.commercialExecutionAuthorizations.commercialAuthorizationId,
            input.commercialAuthorizationId
          )
        )
        .where(
          and(
            eq(schema.aiStorySceneExecutions.id, input.sceneExecutionId),
            eq(
              schema.aiStorySceneExecutions.executionPlanId,
              input.executionPlanId
            ),
            eq(schema.aiStorySceneExecutions.workspaceId, input.workspaceId)
          )
        )
        .limit(1);

      if (!source) {
        throw new PostTerminalProviderRetryError(
          "POST_TERMINAL_RETRY_SOURCE_NOT_FOUND",
          "Exact terminal retry source authority was not found",
          404
        );
      }
      const workerFact = source.worker.result;
      if (
        source.compiled.sceneExecutionId !== source.scene.id ||
        source.compiled.requestFingerprint !==
          input.sourceCompiledRequestFingerprint ||
        source.binding.requestFingerprint !==
          input.sourceCompiledRequestFingerprint ||
        source.worker.workerState !== "NOT_ACCEPTED" ||
        source.worker.acceptanceClassification !== "NOT_ACCEPTED" ||
        source.worker.canonicalProviderState !== "NOT_ACCEPTED" ||
        workerFact.failureClassification?.code !== "PROVIDER_NOT_ACCEPTED" ||
        workerFact.failureClassification?.terminal !== true ||
        source.attempt.providerRequestId !== null ||
        source.binding.providerTaskId !== null ||
        source.reservation.status !== "RELEASED" ||
        Number(source.reservation.settledCostUsd ?? "0") !== 0
      ) {
        throw new PostTerminalProviderRetryError(
          "POST_TERMINAL_RETRY_SOURCE_INELIGIBLE",
          "Retry requires an exact terminal NOT_ACCEPTED pre-result source with immutable zero-charge history"
        );
      }
      if (
        source.commercial.orgId !== source.scene.orgId ||
        source.commercial.workspaceId !== source.scene.workspaceId ||
        source.commercial.capabilityKey !== "ai_story.execute" ||
        source.commercial.executionIdentity !==
          commercialExecutionIdentityForPlan(input.executionPlanId)
      ) {
        throw new PostTerminalProviderRetryError(
          "POST_TERMINAL_RETRY_COMMERCIAL_AUTHORITY_INVALID",
          "Commercial authorization does not match the Scene retry authority"
        );
      }

      const [resultCount] = await tx
        .select({ value: count() })
        .from(schema.aiStorySceneResults)
        .where(
          eq(
            schema.aiStorySceneResults.providerAttemptId,
            input.priorProviderAttemptId
          )
        );
      if ((resultCount?.value ?? 0) !== 0) {
        throw new PostTerminalProviderRetryError(
          "POST_TERMINAL_RETRY_REVIEW_PATH_REQUIRED",
          "A Scene Result exists; generated-scene review retry is the required lifecycle"
        );
      }

      // Once the human authorization has produced its retry scheduling
      // generation, the correlation count necessarily increases. Resolve the
      // append-only source authority before deriving a new generation so an
      // identical replay converges instead of attempting generation N+1.
      const [existingAuthorizationRow] = await tx
        .select({ fact: schema.aiStoryPostTerminalProviderRetryAuthorizations.fact })
        .from(schema.aiStoryPostTerminalProviderRetryAuthorizations)
        .where(
          and(
            eq(
              schema.aiStoryPostTerminalProviderRetryAuthorizations.sceneExecutionId,
              input.sceneExecutionId
            ),
            eq(
              schema.aiStoryPostTerminalProviderRetryAuthorizations.priorProviderAttemptId,
              input.priorProviderAttemptId
            ),
            eq(
              schema.aiStoryPostTerminalProviderRetryAuthorizations.failureClassification,
              input.failureClassification
            ),
            eq(
              schema.aiStoryPostTerminalProviderRetryAuthorizations.targetCompilerContractVersion,
              input.targetCompilerContractVersion
            )
          )
        )
        .limit(1);
      if (existingAuthorizationRow) {
        const existing = PostTerminalProviderRetryAuthorizationFactSchema.parse(
          existingAuthorizationRow.fact
        );
        if (
          existing.executionPlanId !== input.executionPlanId ||
          existing.sceneExecutionId !== input.sceneExecutionId ||
          existing.workspaceId !== input.workspaceId ||
          existing.priorProviderAttemptId !== input.priorProviderAttemptId ||
          existing.priorWorkerResultId !== input.priorWorkerResultId ||
          existing.sourceCompiledRequestId !== input.sourceCompiledRequestId ||
          existing.sourceCompiledRequestFingerprint !==
            input.sourceCompiledRequestFingerprint ||
          existing.commercialAuthorizationId !==
            input.commercialAuthorizationId ||
          existing.authorizedBy !== input.actorUserId ||
          existing.humanDecision !== input.humanDecision
        ) {
          throw new PostTerminalProviderRetryError(
            "POST_TERMINAL_RETRY_AUTHORIZATION_CONFLICT",
            "A conflicting post-terminal retry authorization exists"
          );
        }
        return existing;
      }

      const [membership] = await tx
        .select({ userId: schema.workspaceMembers.userId })
        .from(schema.workspaceMembers)
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, input.workspaceId),
            eq(schema.workspaceMembers.userId, input.actorUserId)
          )
        )
        .limit(1);
      if (!membership) {
        throw new PostTerminalProviderRetryError(
          "POST_TERMINAL_RETRY_ACTOR_DENIED",
          "Human retry actor is not a member of the exact workspace",
          403
        );
      }

      const [scope] = await tx
        .select()
        .from(schema.certificationCommercialScopes)
        .where(
          and(
            eq(
              schema.certificationCommercialScopes.certificationScopeId,
              source.reservation.certificationScopeId
            ),
            eq(schema.certificationCommercialScopes.environment, "STAGING"),
            eq(schema.certificationCommercialScopes.status, "ACTIVE"),
            eq(schema.certificationCommercialScopes.orgId, source.scene.orgId),
            eq(
              schema.certificationCommercialScopes.workspaceId,
              source.scene.workspaceId
            )
          )
        )
        .limit(1);
      if (!scope) {
        throw new PostTerminalProviderRetryError(
          "POST_TERMINAL_RETRY_COMMERCIAL_SCOPE_INVALID",
          "Active exact STAGING commercial scope is required"
        );
      }
      const [reconciled] = await tx
        .select({ value: count() })
        .from(schema.certificationSubmissionSlotReconciliations)
        .where(
          eq(
            schema.certificationSubmissionSlotReconciliations.certificationScopeId,
            scope.certificationScopeId
          )
        );
      const effectiveConsumed =
        scope.consumedProviderSubmissions - Number(reconciled?.value ?? 0);
      if (
        effectiveConsumed + scope.reservedProviderSubmissions >=
          scope.maxProviderSubmissions ||
        Number(scope.spentProviderCostUsd) +
          Number(scope.reservedProviderCostUsd) >=
          Number(scope.maxProviderCostUsd)
      ) {
        throw new PostTerminalProviderRetryError(
          "POST_TERMINAL_RETRY_COMMERCIAL_LIMIT_EXHAUSTED",
          "Commercial budget or effective submission quota cannot support a future retry"
        );
      }

      const [generation] = await tx
        .select({ value: count() })
        .from(schema.aiStorySceneSchedulingCorrelations)
        .where(
          eq(
            schema.aiStorySceneSchedulingCorrelations.sceneExecutionId,
            input.sceneExecutionId
          )
        );
      const retryGeneration = Number(generation?.value ?? 0) + 1;
      const seed = {
        sceneExecutionId: input.sceneExecutionId,
        priorProviderAttemptId: input.priorProviderAttemptId,
        failureClassification: input.failureClassification,
        humanDecision: input.humanDecision,
        targetCompilerContractVersion: input.targetCompilerContractVersion,
        retryGeneration,
      };
      const authorizationId = deterministicPersistenceUuid(
        "ai-story-post-terminal-provider-retry-authorization",
        seed
      );
      const idempotencyKey = canonicalPersistenceHash({
        kind: "ai-story-post-terminal-provider-retry-idempotency.v1",
        ...seed,
      });
      const integrityHash = canonicalPersistenceHash({
        kind: "ai-story-post-terminal-provider-retry-authorization.v1",
        ...seed,
        orgId: source.scene.orgId,
        workspaceId: source.scene.workspaceId,
        sourceCompiledRequestId: input.sourceCompiledRequestId,
        sourceCompiledRequestFingerprint: input.sourceCompiledRequestFingerprint,
        priorWorkerResultId: input.priorWorkerResultId,
        priorReservationId: source.reservation.certificationReservationId,
        commercialAuthorizationId: input.commercialAuthorizationId,
        authorizedBy: input.actorUserId,
      });
      const fact = PostTerminalProviderRetryAuthorizationFactSchema.parse({
        authorizationId,
        environment: "STAGING",
        orgId: source.scene.orgId,
        workspaceId: source.scene.workspaceId,
        campaignId: source.scene.campaignId,
        storyId: source.scene.storyId,
        executionPlanId: source.scene.executionPlanId,
        sceneExecutionId: source.scene.id,
        sourceCompiledRequestId: input.sourceCompiledRequestId,
        sourceCompiledRequestFingerprint: input.sourceCompiledRequestFingerprint,
        priorProviderAttemptId: input.priorProviderAttemptId,
        priorWorkerResultId: input.priorWorkerResultId,
        priorReservationId: source.reservation.certificationReservationId,
        failureClassification: input.failureClassification,
        failureCode: "PROVIDER_NOT_ACCEPTED",
        retryReason: "CORRECTED_PROVIDER_REQUEST_CONTRACT",
        humanDecision: input.humanDecision,
        authorizedBy: input.actorUserId,
        authorizedAt: this.now().toISOString(),
        retryGeneration,
        targetCompilerContractVersion: input.targetCompilerContractVersion,
        targetMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
        commercialAuthorizationId: input.commercialAuthorizationId,
        idempotencyKey,
        integrityHash,
        contractVersion:
          AI_STORY_POST_TERMINAL_PROVIDER_RETRY_CONTRACT_VERSION,
      });

      await tx
        .insert(schema.aiStoryPostTerminalProviderRetryAuthorizations)
        .values({
          authorizationId: fact.authorizationId,
          environment: fact.environment,
          orgId: fact.orgId,
          workspaceId: fact.workspaceId,
          campaignId: fact.campaignId,
          storyId: fact.storyId,
          executionPlanId: fact.executionPlanId,
          sceneExecutionId: fact.sceneExecutionId,
          sourceCompiledRequestId: fact.sourceCompiledRequestId,
          sourceCompiledRequestFingerprint:
            fact.sourceCompiledRequestFingerprint,
          priorProviderAttemptId: fact.priorProviderAttemptId,
          priorWorkerResultId: fact.priorWorkerResultId,
          priorReservationId: fact.priorReservationId,
          failureClassification: fact.failureClassification,
          failureCode: fact.failureCode,
          retryReason: fact.retryReason,
          humanDecision: fact.humanDecision,
          authorizedBy: fact.authorizedBy,
          authorizedAt: new Date(fact.authorizedAt),
          retryGeneration: fact.retryGeneration,
          targetCompilerContractVersion: fact.targetCompilerContractVersion,
          targetMode: fact.targetMode,
          commercialAuthorizationId: fact.commercialAuthorizationId,
          idempotencyKey: fact.idempotencyKey,
          integrityHash: fact.integrityHash,
          contractVersion: fact.contractVersion,
          fact,
        })
        .onConflictDoNothing();
      const existing = await this.getByIdInTransaction(tx, authorizationId);
      if (!existing || existing.integrityHash !== integrityHash) {
        throw new PostTerminalProviderRetryError(
          "POST_TERMINAL_RETRY_AUTHORIZATION_CONFLICT",
          "A conflicting post-terminal retry authorization exists"
        );
      }
      return existing;
    });
  }

  async getById(
    authorizationId: string
  ): Promise<PostTerminalProviderRetryAuthorizationFact | null> {
    return this.getByIdInTransaction(this.db, authorizationId);
  }

  private async getByIdInTransaction(
    db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0],
    authorizationId: string
  ): Promise<PostTerminalProviderRetryAuthorizationFact | null> {
    const [row] = await db
      .select({ fact: schema.aiStoryPostTerminalProviderRetryAuthorizations.fact })
      .from(schema.aiStoryPostTerminalProviderRetryAuthorizations)
      .where(
        eq(
          schema.aiStoryPostTerminalProviderRetryAuthorizations.authorizationId,
          authorizationId
        )
      )
      .limit(1);
    return row
      ? PostTerminalProviderRetryAuthorizationFactSchema.parse(row.fact)
      : null;
  }
}
