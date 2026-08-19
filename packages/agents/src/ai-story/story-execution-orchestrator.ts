/**
 * AI Story Execution Orchestrator — Animation Package → execution video outputs.
 * Uses capability-driven provider routing; UI never selects vendors.
 * Animation-video only (Seedance); Campaign Assets are resolved, never generated.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  AnimationPackagePayloadSchema,
  AiStoryExecutionProgressSchema,
  AiStoryGenerateReviewResultSchema,
  EXECUTION_CAPABILITY_IDS,
  MARKETING_OUTPUT_STRATEGY,
  PHASE1_EXECUTION_LOCKED,
  assertPhase1ExecutionLocked,
  assertAiStoryExecutionTransition,
  assertAiStoryTransition,
  requestHash,
  type AiStoryExecutionStatus,
  type AiStoryGenerateReviewResult,
  type AiStoryStatus,
  type AnimationPackagePayload,
  type CanonicalProviderRequest,
  type CanonicalProviderResult,
  type ExecutionManifest,
  type GenerateReviewEstimate,
} from "@ceo-agent/shared";
import {
  CanonicalProviderRouter,
  type ProviderRoutingPolicy,
  type ProviderRoutingRequest,
} from "../provider-router";
import {
  MemoryPayloadResolver,
  createProductionProviderRegistry,
} from "../provider-adapters/production-registry";
import {
  MissingCampaignAssetsError,
  assertCampaignAssetsResolved,
  buildGenerateReviewEstimate,
  buildOutputVariantsFromManifest,
  collectReferencedAssetIds,
  compileExecutionManifest,
  type ResolvedCampaignAsset,
} from "./execution-compiler";
import { compileSceneExecutionIntents } from "./scene-execution-compiler";
import {
  aggregateQcStatus,
  validateAllSceneExecutionIntents,
  type AiQcAssetFact,
} from "./ai-qc-validator";
import { SceneExecutionPersistenceService } from "./scene-execution-persistence-service";

type Db = ReturnType<typeof getDb>;

export { MissingCampaignAssetsError };
export { assertPhase1ExecutionLocked };

function progressFor(
  phase: AiStoryExecutionStatus,
  patch: Partial<{
    percent: number;
    message: string;
    completedOutputs: number;
    targetOutputs: number;
    providerAttempts: number;
    lastError: string;
  }> = {}
) {
  return AiStoryExecutionProgressSchema.parse({
    phase,
    percent: patch.percent ?? 0,
    message: patch.message ?? "",
    completedOutputs: patch.completedOutputs ?? 0,
    targetOutputs: patch.targetOutputs ?? MARKETING_OUTPUT_STRATEGY.DEFAULT_TARGET_OUTPUTS,
    providerAttempts: patch.providerAttempts ?? 0,
    lastError: patch.lastError,
  });
}

async function setExecutionStatus(
  db: Db,
  jobId: string,
  from: AiStoryExecutionStatus,
  to: AiStoryExecutionStatus,
  patch: Parameters<typeof progressFor>[1] = {}
) {
  assertAiStoryExecutionTransition(from, to);
  const [updated] = await db
    .update(schema.aiStoryExecutionJobs)
    .set({
      status: to,
      progress: progressFor(to, patch),
      updatedAt: new Date(),
      ...(to === "preparing" || to === "running" ? { startedAt: new Date() } : {}),
      ...(to === "completed" || to === "failed" || to === "cancelled"
        ? { completedAt: new Date() }
        : {}),
    })
    .where(eq(schema.aiStoryExecutionJobs.id, jobId))
    .returning();
  return updated;
}

async function loadResolvedCampaignAssets(
  db: Db,
  workspaceId: string,
  assetIds: readonly string[]
): Promise<ResolvedCampaignAsset[]> {
  if (assetIds.length === 0) return [];
  const rows = await db
    .select({
      assetId: schema.assets.id,
      storagePath: schema.assets.storagePath,
      metadata: schema.assets.metadata,
    })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.workspaceId, workspaceId),
        inArray(schema.assets.id, [...assetIds])
      )
    );
  return rows.map((row) => ({
    assetId: row.assetId,
    storagePath: row.storagePath,
    displayName:
      (typeof row.metadata?.originalFilename === "string" && row.metadata.originalFilename) ||
      row.storagePath.split("/").pop() ||
      row.assetId,
  }));
}

export async function createGenerateReview(input: {
  db: Db;
  campaignId: string;
  storyId: string;
  workspaceId: string;
  orgId?: string;
}): Promise<
  AiStoryGenerateReviewResult & {
    animationPackageId: string;
    /** @deprecated Legacy Marketing estimate — kept for transitional callers only. */
    estimateLegacy?: GenerateReviewEstimate;
  }
> {
  const [pkgRow] = await input.db
    .select()
    .from(schema.aiStoryAnimationPackages)
    .where(
      and(
        eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId),
        eq(schema.aiStoryAnimationPackages.status, "ready_for_execution")
      )
    )
    .orderBy(desc(schema.aiStoryAnimationPackages.createdAt))
    .limit(1);
  if (!pkgRow) {
    throw new Error("Approved Animation Package (ready_for_execution) not found");
  }

  const [versionRow] = await input.db
    .select()
    .from(schema.aiStoryVersions)
    .where(eq(schema.aiStoryVersions.id, pkgRow.storyVersionId))
    .limit(1);
  if (!versionRow) {
    throw new Error("Story Version for Animation Package not found");
  }

  const payload = AnimationPackagePayloadSchema.parse(pkgRow.payload);
  const referencedAssetIds = collectReferencedAssetIds(payload);

  const resolvedAssets =
    referencedAssetIds.length > 0
      ? await loadResolvedCampaignAssets(input.db, input.workspaceId, referencedAssetIds)
      : [];

  const assetRows =
    referencedAssetIds.length > 0
      ? await input.db
          .select({
            assetId: schema.assets.id,
            workspaceId: schema.assets.workspaceId,
            campaignId: schema.assets.campaignId,
          })
          .from(schema.assets)
          .where(
            and(
              eq(schema.assets.workspaceId, input.workspaceId),
              inArray(schema.assets.id, referencedAssetIds)
            )
          )
      : [];

  const campaignLinks =
    referencedAssetIds.length > 0
      ? await input.db
          .select({ assetId: schema.campaignAssetRefs.assetId })
          .from(schema.campaignAssetRefs)
          .where(
            and(
              eq(schema.campaignAssetRefs.campaignId, input.campaignId),
              inArray(schema.campaignAssetRefs.assetId, referencedAssetIds)
            )
          )
      : [];
  const linkedAssetIds = new Set(campaignLinks.map((row) => row.assetId));

  const assetsById = new Map<string, AiQcAssetFact>(
    assetRows.map((row) => [
      row.assetId,
      {
        assetId: row.assetId,
        workspaceId: row.workspaceId,
        campaignId: linkedAssetIds.has(row.assetId) ? input.campaignId : null,
      },
    ])
  );

  const frozenAt =
    versionRow.frozenAt?.toISOString() ??
    versionRow.createdAt.toISOString();

  const compiled = compileSceneExecutionIntents(payload, {
    orgId: input.orgId ?? pkgRow.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: pkgRow.storyVersionId,
    storyVersionNumber: versionRow.versionNumber,
    storyVersionFrozenAt: frozenAt,
    animationPackageId: pkgRow.id,
    animationPackageStatus: pkgRow.status,
  });

  const qcResults = validateAllSceneExecutionIntents(
    compiled.intents,
    compiled.instructionsBySceneExecutionId,
    {
      storyVersionFrozenAt: versionRow.frozenAt?.toISOString() ?? null,
      animationPackageStatus: pkgRow.status,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      assetsById,
    }
  );

  const overallQcStatus = aggregateQcStatus(qcResults);
  // Phase 1 / 2A: QC may pass, but provider execution remains locked until later phases.
  const persistence = await new SceneExecutionPersistenceService().persistFromGenerateReview({
    overallQcStatus,
    plan: compiled.storyExecutionPlan,
    intents: compiled.intents,
    instructionsBySceneExecutionId: compiled.instructionsBySceneExecutionId,
    validationResults: qcResults,
  });

  const result = AiStoryGenerateReviewResultSchema.parse({
    estimate: {
      ...compiled.estimate,
      risks: [
        ...compiled.estimate.risks,
        ...(overallQcStatus === "failed"
          ? ["AI QC reported blocking findings — execution cannot proceed."]
          : []),
        ...(resolvedAssets.length < referencedAssetIds.length
          ? ["Some Campaign Asset references could not be resolved in this workspace."]
          : []),
      ],
    },
    storyExecutionPlan: compiled.storyExecutionPlan,
    sceneIntents: compiled.intents,
    qcResults,
    overallQcStatus,
    executionAllowed: false,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
    persistenceStatus: persistence.persistenceStatus,
    storyExecutionId: persistence.storyExecutionId,
    sceneExecutionIds: [...persistence.sceneExecutionIds],
    compilationHash: persistence.compilationHash,
    validationSummary: persistence.validationSummary,
    phase: "phase_1_qc_only",
  });

  return {
    ...result,
    animationPackageId: pkgRow.id,
    estimateLegacy: buildGenerateReviewEstimate({
      animationPackage: payload,
      referencedAssetIds,
    }),
  };
}

export async function startExecutionJob(input: {
  db: Db;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  animationPackageId: string;
  createdBy: string;
  estimate: GenerateReviewEstimate;
  storyStatus: AiStoryStatus;
}): Promise<{ jobId: string; taskId: string }> {
  void input;
  assertPhase1ExecutionLocked();
  return undefined as never;
}

export async function cancelExecutionJob(db: Db, jobId: string, workspaceId: string) {
  const [job] = await db
    .select()
    .from(schema.aiStoryExecutionJobs)
    .where(
      and(
        eq(schema.aiStoryExecutionJobs.id, jobId),
        eq(schema.aiStoryExecutionJobs.workspaceId, workspaceId)
      )
    )
    .limit(1);
  if (!job) throw new Error("Execution job not found");
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return job;
  }
  assertAiStoryExecutionTransition(job.status as AiStoryExecutionStatus, "cancelled");
  const [updated] = await db
    .update(schema.aiStoryExecutionJobs)
    .set({
      status: "cancelled",
      cancelRequestedAt: new Date(),
      completedAt: new Date(),
      progress: progressFor("cancelled", {
        message: "Cancelled by operator",
        targetOutputs: job.targetOutputCount,
      }),
      updatedAt: new Date(),
    })
    .where(eq(schema.aiStoryExecutionJobs.id, jobId))
    .returning();
  return updated;
}

export async function retryExecutionJob(db: Db, jobId: string, workspaceId: string) {
  assertPhase1ExecutionLocked();

  const [job] = await db
    .select()
    .from(schema.aiStoryExecutionJobs)
    .where(
      and(
        eq(schema.aiStoryExecutionJobs.id, jobId),
        eq(schema.aiStoryExecutionJobs.workspaceId, workspaceId)
      )
    )
    .limit(1);
  if (!job) throw new Error("Execution job not found");
  if (job.status !== "failed") {
    throw new Error("Only failed execution jobs can be retried");
  }
  assertAiStoryExecutionTransition("failed", "queued");
  const [updated] = await db
    .update(schema.aiStoryExecutionJobs)
    .set({
      status: "queued",
      retryCount: job.retryCount + 1,
      errorMessage: null,
      cancelRequestedAt: null,
      completedAt: null,
      progress: progressFor("queued", {
        message: "Re-queued after failure",
        targetOutputs: job.targetOutputCount,
      }),
      updatedAt: new Date(),
    })
    .where(eq(schema.aiStoryExecutionJobs.id, jobId))
    .returning();
  await db
    .update(schema.aiStories)
    .set({ status: "executing", updatedAt: new Date() })
    .where(eq(schema.aiStories.id, job.storyId));
  return updated;
}

async function invokeProviderForOutput(input: {
  capabilityId: string;
  workspaceId: string;
  orgId: string;
  correlationId: string;
  payload: Record<string, unknown>;
  payloadResolver: MemoryPayloadResolver;
  registry: ReturnType<typeof createProductionProviderRegistry>;
  router: CanonicalProviderRouter;
}): Promise<{ providerId: string; result: CanonicalProviderResult }> {
  assertPhase1ExecutionLocked();

  const executionId = randomUUID();
  const attemptId = randomUUID();
  const idempotencyKey = `story-exec-${executionId}`;
  const payloadUri = `memory://payload/${executionId}`;
  input.payloadResolver.put(payloadUri, input.payload);
  const contentHash = await requestHash(input.payload);

  const routingRequest: ProviderRoutingRequest = {
    routingRequestId: randomUUID(),
    capabilityId: input.capabilityId,
    capabilityVersion: "1.0.0",
    requestSchemaVersion: "1.0.0",
    resultSchemaVersion: "1.0.0",
    tenantId: input.orgId,
    workspaceId: input.workspaceId,
    correlationId: input.correlationId,
    policyVersion: "1.0.0",
    requiredFeatures: ["LOOKUP"],
    requireLookup: true,
    requireCancellation: false,
    requireCallbacks: false,
    requireStreaming: false,
    preferredProviders: ["seedance"],
    dataHandling: {
      sensitiveData: false,
      externalProcessingAllowed: true,
      providerTrainingAllowed: false,
      enterpriseControlsRequired: false,
      zeroRetentionRequired: false,
    },
  };
  const policy: ProviderRoutingPolicy = {
    policyVersion: "1.0.0",
    preferredProviders: routingRequest.preferredProviders ?? [],
    requireTrainingOptOut: true,
  };
  const decision = await input.router.route(routingRequest, policy);
  const adapter = input.registry.resolve(
    decision.selectedProviderId,
    decision.selectedAdapterVersion
  );
  if (!adapter) {
    throw new Error(`No adapter for ${decision.selectedProviderId}`);
  }

  const pipelineRunId = input.correlationId;
  const fingerprint = await requestHash({
    executionId,
    capabilityId: input.capabilityId,
    payloadUri,
  });

  const canonicalRequest = {
    contractVersion: "1",
    executionIdentity: {
      executionId,
      tenantId: input.orgId,
      workspaceId: input.workspaceId,
      pipelineRunId,
      capabilityId: input.capabilityId,
      capabilityVersion: "1.0.0",
      idempotencyKey,
      deterministicFingerprint: fingerprint,
    },
    requestSchemaVersion: "1.0.0",
    resultSchemaVersion: "1.0.0",
    normalizedPayloadReference: {
      uri: payloadUri,
      contentHash,
      mediaType: "application/json",
    },
    outputSchema: {
      schemaId: "AnimationVideoResult",
      schemaVersion: "1.0.0",
    },
    contextVersions: { AnimationPackage: "1.0.0" },
    correlation: {
      correlationId: input.correlationId,
      pipelineRunId,
    },
    timeoutPolicy: { timeoutMs: 600_000, reconciliationDelayMs: 5_000 },
    retryPolicy: {
      maxAttempts: 3,
      initialDelayMs: 500,
      maximumDelayMs: 8_000,
      backoffMultiplier: 2,
    },
    providerConstraints: {
      allowedProviderIds: [decision.selectedProviderId],
      executionLookupRequired: true,
    },
  } as CanonicalProviderRequest;

  const result = await adapter.execute(canonicalRequest, {
    executionId,
    providerAttemptId: attemptId,
    correlationId: input.correlationId,
    tenantId: input.orgId,
    workspaceId: input.workspaceId,
    timeoutDeadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    idempotencyKey,
    capability: {
      capabilityId: input.capabilityId,
      capabilityVersion: "1.0.0",
      requestSchemaVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
    },
    dataHandling: {
      sensitiveData: false,
      retentionAllowed: true,
    },
    trace: { source: "ai_story_execution" },
  });
  return { providerId: decision.selectedProviderId, result };
}

function providerPayloadFromManifest(
  manifest: ExecutionManifest,
  outputIndex: number
): Record<string, unknown> {
  const req = manifest.compiledProviderRequest;
  return {
    prompt: req.prompt,
    negativePrompt: req.negativePrompt,
    durationSec: req.durationSec,
    aspectRatio: req.aspectRatio,
    assetReferences: req.assetReferences,
    identityConstraints: manifest.identityConstraints,
    shotMap: req.shotMap,
    outputIndex,
  };
}

export async function runExecutionJob(jobId: string): Promise<void> {
  void jobId;
  assertPhase1ExecutionLocked();

  const db = getDb();
  const [job] = await db
    .select()
    .from(schema.aiStoryExecutionJobs)
    .where(eq(schema.aiStoryExecutionJobs.id, jobId))
    .limit(1);
  if (!job) throw new Error("Execution job not found");
  if (job.cancelRequestedAt || job.status === "cancelled") return;
  if (!["queued", "failed"].includes(job.status) && job.status !== "preparing") {
    if (job.status === "queued") {
      /* continue */
    } else if (job.status !== "preparing") {
      return;
    }
  }

  try {
    await setExecutionStatus(db, jobId, job.status as AiStoryExecutionStatus, "preparing", {
      percent: 5,
      message: "Compiling execution manifest from Animation Package",
      targetOutputs: job.targetOutputCount,
    });

    const [pkgRow] = await db
      .select()
      .from(schema.aiStoryAnimationPackages)
      .where(eq(schema.aiStoryAnimationPackages.id, job.animationPackageId))
      .limit(1);
    if (!pkgRow) throw new Error("Animation Package missing");
    const animationPackage = AnimationPackagePayloadSchema.parse(
      pkgRow.payload
    ) as AnimationPackagePayload;

    const referencedAssetIds = collectReferencedAssetIds(animationPackage);
    const resolvedAssets = await loadResolvedCampaignAssets(
      db,
      job.workspaceId,
      referencedAssetIds
    );
    assertCampaignAssetsResolved(referencedAssetIds, resolvedAssets);

    const executionManifest = compileExecutionManifest({
      storyId: job.storyId,
      animationPackageId: job.animationPackageId,
      animationPackage,
      resolvedAssets,
    });

    const variants = buildOutputVariantsFromManifest(
      executionManifest,
      animationPackage.story.title || "AI Story"
    );

    await db
      .update(schema.aiStoryExecutionJobs)
      .set({
        executionManifest,
        selectedOutputCount: variants.length,
        updatedAt: new Date(),
      })
      .where(eq(schema.aiStoryExecutionJobs.id, jobId));

    if (job.cancelRequestedAt) {
      await setExecutionStatus(db, jobId, "preparing", "cancelled", {
        message: "Cancelled during prepare",
      });
      return;
    }

    await setExecutionStatus(db, jobId, "preparing", "running", {
      percent: 20,
      message: "Dispatching animation-video provider executions",
      targetOutputs: variants.length,
    });

    const payloadResolver = new MemoryPayloadResolver();
    const registry = createProductionProviderRegistry(payloadResolver);
    const router = new CanonicalProviderRouter(registry);

    const providerExecutionIds: string[] = [];
    let completed = 0;

    for (const variant of variants) {
      const [fresh] = await db
        .select()
        .from(schema.aiStoryExecutionJobs)
        .where(eq(schema.aiStoryExecutionJobs.id, jobId))
        .limit(1);
      if (fresh?.cancelRequestedAt) {
        await setExecutionStatus(db, jobId, "running", "cancelled", {
          message: "Cancelled during provider execution",
          completedOutputs: completed,
        });
        return;
      }

      const { providerId, result } = await invokeProviderForOutput({
        capabilityId: job.capabilityId || EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO,
        workspaceId: job.workspaceId,
        orgId: job.orgId,
        correlationId: jobId,
        payloadResolver,
        registry,
        router,
        payload: providerPayloadFromManifest(executionManifest, variant.outputIndex),
      });
      providerExecutionIds.push(result.executionId);
      completed += 1;

      const normalized = result.normalizedOutput as { videoUrl?: string };
      const storagePath = normalized.videoUrl ?? null;

      const [videoAsset] = storagePath
        ? await db
            .insert(schema.assets)
            .values({
              orgId: job.orgId,
              workspaceId: job.workspaceId,
              campaignId: job.campaignId,
              type: "video",
              storagePath,
              mimeType: "video/mp4",
              metadata: {
                source: "ai_story_execution",
                originalFilename: variant.title,
                executionJobId: job.id,
                outputIndex: variant.outputIndex,
                providerId,
              },
            })
            .returning()
        : [undefined];

      const [creative] = await db
        .insert(schema.creatives)
        .values({
          orgId: job.orgId,
          workspaceId: job.workspaceId,
          campaignId: job.campaignId,
          taskId: job.taskId,
          status: "pending_review",
          copyVariants: [
            {
              id: `caption-${variant.outputIndex}`,
              platform: "instagram",
              caption: variant.caption,
              hashtags: variant.hashtags,
            },
          ],
          videoUrl: storagePath,
          coverUrl: null,
          renderStatus: storagePath ? "preview_ready" : "none",
          editPlan: {
            source: "ai_story_execution",
            executionJobId: jobId,
            outputIndex: variant.outputIndex,
            providerId,
            capabilityId: EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO,
          },
        })
        .returning();

      await db.insert(schema.aiStoryExecutionOutputs).values({
        orgId: job.orgId,
        workspaceId: job.workspaceId,
        campaignId: job.campaignId,
        storyId: job.storyId,
        executionJobId: jobId,
        animationPackageId: job.animationPackageId,
        creativeId: creative?.id,
        outputType: "animation_video",
        status: "pending_review",
        title: variant.title,
        outputIndex: variant.outputIndex,
        storagePath,
        generatedVideoAssetId: videoAsset?.id ?? null,
        referencedAssetIds: [...executionManifest.referencedAssetIds],
        executionManifest,
        caption: variant.caption,
        hashtags: variant.hashtags,
        providerId,
        providerExecutionId: result.executionId,
        qualityScore: String(variant.qualityScore),
      });

      if (creative) {
        await db.insert(schema.reviews).values({
          orgId: job.orgId,
          workspaceId: job.workspaceId,
          creativeId: creative.id,
          reviewerType: "internal",
          decision: "pending",
        });
      }

      await db
        .update(schema.aiStoryExecutionJobs)
        .set({
          providerExecutionIds,
          progress: progressFor("running", {
            percent: Math.min(90, 20 + Math.round((completed / variants.length) * 70)),
            message: `Collected output ${completed}/${variants.length}`,
            completedOutputs: completed,
            targetOutputs: variants.length,
            providerAttempts: providerExecutionIds.length,
          }),
          updatedAt: new Date(),
        })
        .where(eq(schema.aiStoryExecutionJobs.id, jobId));
    }

    await setExecutionStatus(db, jobId, "running", "collecting_assets", {
      percent: 95,
      message: "Finalizing execution video outputs",
      completedOutputs: completed,
      targetOutputs: variants.length,
      providerAttempts: providerExecutionIds.length,
    });

    await setExecutionStatus(db, jobId, "collecting_assets", "completed", {
      percent: 100,
      message: "Execution completed",
      completedOutputs: completed,
      targetOutputs: variants.length,
      providerAttempts: providerExecutionIds.length,
    });

    await db
      .update(schema.aiStories)
      .set({ status: "execution_review", updatedAt: new Date() })
      .where(eq(schema.aiStories.id, job.storyId));

    if (job.taskId) {
      await db
        .update(schema.tasks)
        .set({
          status: "completed",
          completedAt: new Date(),
          currentStep: "ai_story_execution_complete",
        })
        .where(eq(schema.tasks.id, job.taskId));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execution failed";
    const [current] = await db
      .select()
      .from(schema.aiStoryExecutionJobs)
      .where(eq(schema.aiStoryExecutionJobs.id, jobId))
      .limit(1);
    const from = (current?.status ?? "running") as AiStoryExecutionStatus;
    try {
      assertAiStoryExecutionTransition(from, "failed");
      await db
        .update(schema.aiStoryExecutionJobs)
        .set({
          status: "failed",
          errorMessage: message,
          completedAt: new Date(),
          progress: progressFor("failed", {
            message,
            lastError: message,
            targetOutputs: current?.targetOutputCount,
          }),
          updatedAt: new Date(),
        })
        .where(eq(schema.aiStoryExecutionJobs.id, jobId));
    } catch {
      /* already terminal */
    }
    await db
      .update(schema.aiStories)
      .set({ status: "execution_failed", updatedAt: new Date() })
      .where(eq(schema.aiStories.id, job.storyId));
    throw error;
  }
}

export async function regenerateSingleExecutionOutput(input: {
  db: Db;
  executionJobId: string;
  outputId: string;
  workspaceId: string;
}): Promise<void> {
  void input;
  assertPhase1ExecutionLocked();

  const [output] = await input.db
    .select()
    .from(schema.aiStoryExecutionOutputs)
    .where(
      and(
        eq(schema.aiStoryExecutionOutputs.id, input.outputId),
        eq(schema.aiStoryExecutionOutputs.executionJobId, input.executionJobId),
        eq(schema.aiStoryExecutionOutputs.workspaceId, input.workspaceId)
      )
    )
    .limit(1);
  if (!output) throw new Error("Execution output not found");

  const [job] = await input.db
    .select()
    .from(schema.aiStoryExecutionJobs)
    .where(eq(schema.aiStoryExecutionJobs.id, input.executionJobId))
    .limit(1);
  if (!job?.executionManifest) throw new Error("Execution manifest missing");
  const executionManifest = job.executionManifest as ExecutionManifest;

  const payloadResolver = new MemoryPayloadResolver();
  const registry = createProductionProviderRegistry(payloadResolver);
  const router = new CanonicalProviderRouter(registry);
  const { providerId, result } = await invokeProviderForOutput({
    capabilityId: job.capabilityId || EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO,
    workspaceId: job.workspaceId,
    orgId: job.orgId,
    correlationId: `${job.id}-regen-${output.id}`,
    payloadResolver,
    registry,
    router,
    payload: providerPayloadFromManifest(executionManifest, output.outputIndex),
  });
  const normalized = result.normalizedOutput as { videoUrl?: string };
  const storagePath = normalized.videoUrl ?? null;

  let generatedVideoAssetId = output.generatedVideoAssetId;
  if (storagePath) {
    const [videoAsset] = await input.db
      .insert(schema.assets)
      .values({
        orgId: job.orgId,
        workspaceId: job.workspaceId,
        campaignId: job.campaignId,
        type: "video",
        storagePath,
        mimeType: "video/mp4",
        metadata: {
          source: "ai_story_execution_regen",
          originalFilename: output.title,
          executionJobId: job.id,
          outputIndex: output.outputIndex,
          providerId,
        },
      })
      .returning();
    generatedVideoAssetId = videoAsset?.id ?? generatedVideoAssetId;
  }

  await input.db
    .update(schema.aiStoryExecutionOutputs)
    .set({
      status: "pending_review",
      storagePath,
      generatedVideoAssetId,
      providerId,
      providerExecutionId: result.executionId,
      failureMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.aiStoryExecutionOutputs.id, output.id));

  if (output.creativeId) {
    await input.db
      .update(schema.creatives)
      .set({
        status: "pending_review",
        videoUrl: storagePath,
        coverUrl: null,
        renderStatus: storagePath ? "preview_ready" : "none",
        updatedAt: new Date(),
      })
      .where(eq(schema.creatives.id, output.creativeId));

    await input.db.insert(schema.reviews).values({
      orgId: job.orgId,
      workspaceId: job.workspaceId,
      creativeId: output.creativeId,
      reviewerType: "internal",
      decision: "pending",
    });
  }
}

/** @deprecated Use regenerateSingleExecutionOutput */
export const regenerateSingleMarketingOutput = regenerateSingleExecutionOutput;
