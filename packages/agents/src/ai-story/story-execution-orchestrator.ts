/**
 * AI Story Execution Orchestrator — Animation Package → Marketing Outputs.
 * Uses capability-driven provider routing; UI never selects vendors.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  AnimationPackagePayloadSchema,
  AiStoryExecutionProgressSchema,
  EXECUTION_CAPABILITY_IDS,
  MARKETING_OUTPUT_STRATEGY,
  assertAiStoryExecutionTransition,
  assertAiStoryTransition,
  type AiStoryExecutionStatus,
  type AiStoryStatus,
  type AnimationPackagePayload,
  type GenerateReviewEstimate,
  type MarketingOutputMediaKind,
  type PromptBuilderPackage,
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
import { buildGenerateReviewEstimate, buildPromptPackage } from "./prompt-builder";
import type {
  CanonicalProviderRequest,
  CanonicalProviderResult,
} from "@ceo-agent/shared";
import { requestHash } from "@ceo-agent/shared";

type Db = ReturnType<typeof getDb>;

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
      ...(patch.lastError ? { errorMessage: patch.lastError } : {}),
    })
    .where(eq(schema.aiStoryExecutionJobs.id, jobId))
    .returning();
  return updated;
}

export async function createGenerateReview(input: {
  db: Db;
  campaignId: string;
  storyId: string;
  workspaceId: string;
  mediaKind?: MarketingOutputMediaKind;
}): Promise<{ estimate: GenerateReviewEstimate; animationPackageId: string }> {
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
  const payload = AnimationPackagePayloadSchema.parse(pkgRow.payload);
  const mediaKind = input.mediaKind ?? "video";
  return {
    estimate: buildGenerateReviewEstimate({ animationPackage: payload, mediaKind }),
    animationPackageId: pkgRow.id,
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
  mediaKind?: MarketingOutputMediaKind;
  estimate: GenerateReviewEstimate;
  storyStatus: AiStoryStatus;
}): Promise<{ jobId: string; taskId: string }> {
  if (
    ![
      "ready_for_execution",
      "generate_review",
      "execution_failed",
      "execution_review",
    ].includes(input.storyStatus)
  ) {
    throw new Error("Story must be ready for execution before starting");
  }

  const mediaKind = input.mediaKind ?? input.estimate.mediaKind;
  const capabilityId =
    mediaKind === "image"
      ? EXECUTION_CAPABILITY_IDS.MARKETING_IMAGE
      : EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO;

  const [task] = await input.db
    .insert(schema.tasks)
    .values({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      status: "queued",
      currentStep: "ai_story_execution",
      stepProgress: { source: "ai_story_execution" },
    })
    .returning();
  if (!task) throw new Error("Failed to create execution task");

  const [job] = await input.db
    .insert(schema.aiStoryExecutionJobs)
    .values({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      animationPackageId: input.animationPackageId,
      taskId: task.id,
      status: "queued",
      mediaKind,
      capabilityId,
      targetOutputCount: input.estimate.targetOutputCount,
      generateReview: input.estimate,
      progress: progressFor("queued", {
        targetOutputs: input.estimate.targetOutputCount,
        message: "Queued for execution",
      }),
      createdBy: input.createdBy,
    })
    .returning();
  if (!job) throw new Error("Failed to create execution job");

  const fromStatus = input.storyStatus;
  if (fromStatus === "ready_for_execution") {
    assertAiStoryTransition(fromStatus, "generate_review");
    await input.db
      .update(schema.aiStories)
      .set({ status: "generate_review", updatedAt: new Date() })
      .where(eq(schema.aiStories.id, input.storyId));
    assertAiStoryTransition("generate_review", "executing");
  } else if (fromStatus === "generate_review") {
    assertAiStoryTransition("generate_review", "executing");
  } else if (fromStatus === "execution_review") {
    assertAiStoryTransition("execution_review", "executing");
  } else {
    assertAiStoryTransition("execution_failed", "executing");
  }
  await input.db
    .update(schema.aiStories)
    .set({ status: "executing", updatedAt: new Date() })
    .where(eq(schema.aiStories.id, input.storyId));

  return { jobId: job.id, taskId: task.id };
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
    requiredFeatures:
      input.capabilityId === EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO ? ["LOOKUP"] : [],
    requireLookup: input.capabilityId === EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO,
    requireCancellation: false,
    requireCallbacks: false,
    requireStreaming: false,
    preferredProviders:
      input.capabilityId === EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO
        ? ["seedance"]
        : ["flux"],
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
      schemaId:
        input.capabilityId === EXECUTION_CAPABILITY_IDS.MARKETING_IMAGE
          ? "MarketingImageResult"
          : "AnimationVideoResult",
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
      executionLookupRequired:
        input.capabilityId === EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO,
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

export async function runExecutionJob(jobId: string): Promise<void> {
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
      message: "Building prompts from Animation Package",
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

    const promptPackage: PromptBuilderPackage = buildPromptPackage({
      storyId: job.storyId,
      animationPackageId: job.animationPackageId,
      animationPackage,
      mediaKind: job.mediaKind as MarketingOutputMediaKind,
    });

    await db
      .update(schema.aiStoryExecutionJobs)
      .set({
        promptPackage,
        selectedOutputCount: promptPackage.outputBriefs.length,
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
      message: "Dispatching provider executions",
      targetOutputs: promptPackage.outputBriefs.length,
    });

    const payloadResolver = new MemoryPayloadResolver();
    const registry = createProductionProviderRegistry(payloadResolver);
    const router = new CanonicalProviderRouter(registry);

    const providerExecutionIds: string[] = [];
    let completed = 0;

    for (const brief of promptPackage.outputBriefs) {
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

      const primaryPrompt = brief.shotPrompts.map((s) => s.prompt).join("\n\n");
      const { providerId, result } = await invokeProviderForOutput({
        capabilityId: job.capabilityId,
        workspaceId: job.workspaceId,
        orgId: job.orgId,
        correlationId: jobId,
        payloadResolver,
        registry,
        router,
        payload:
          job.mediaKind === "image"
            ? {
                prompt: primaryPrompt,
                negativePrompt: brief.shotPrompts[0]?.negativePrompt,
                outputIndex: brief.outputIndex,
              }
            : {
                prompt: primaryPrompt,
                negativePrompt: brief.shotPrompts[0]?.negativePrompt,
                durationSec: brief.shotPrompts.reduce((s, p) => s + p.durationSec, 0),
                outputIndex: brief.outputIndex,
              },
      });
      providerExecutionIds.push(result.executionId);
      completed += 1;

      const normalized = result.normalizedOutput as {
        videoUrl?: string;
        imageUrl?: string;
      };
      const storagePath =
        job.mediaKind === "image" ? normalized.imageUrl : normalized.videoUrl;

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
              id: `caption-${brief.outputIndex}`,
              platform: "instagram",
              caption: brief.caption,
              hashtags: brief.hashtags,
            },
          ],
          videoUrl: job.mediaKind === "video" ? storagePath ?? null : null,
          coverUrl: job.mediaKind === "image" ? storagePath ?? null : null,
          renderStatus: storagePath ? "preview_ready" : "none",
          editPlan: {
            source: "ai_story_execution",
            executionJobId: jobId,
            outputIndex: brief.outputIndex,
            prompt: primaryPrompt,
            providerId,
            mediaKind: job.mediaKind,
            metadata: brief.metadata,
          },
        })
        .returning();

      await db.insert(schema.aiStoryMarketingOutputs).values({
        orgId: job.orgId,
        workspaceId: job.workspaceId,
        campaignId: job.campaignId,
        storyId: job.storyId,
        executionJobId: jobId,
        creativeId: creative?.id,
        mediaKind: job.mediaKind,
        status: "pending_review",
        title: brief.title,
        outputIndex: brief.outputIndex,
        storagePath: storagePath ?? null,
        thumbnailPath: job.mediaKind === "image" ? storagePath ?? null : null,
        caption: brief.caption,
        hashtags: brief.hashtags,
        prompt: primaryPrompt,
        metadata: brief.metadata,
        providerId,
        providerExecutionId: result.executionId,
        qualityScore: String(brief.qualityScore),
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
            percent: Math.min(
              90,
              20 + Math.round((completed / promptPackage.outputBriefs.length) * 70)
            ),
            message: `Collected output ${completed}/${promptPackage.outputBriefs.length}`,
            completedOutputs: completed,
            targetOutputs: promptPackage.outputBriefs.length,
            providerAttempts: providerExecutionIds.length,
          }),
          updatedAt: new Date(),
        })
        .where(eq(schema.aiStoryExecutionJobs.id, jobId));
    }

    await setExecutionStatus(db, jobId, "running", "collecting_assets", {
      percent: 95,
      message: "Finalizing marketing outputs",
      completedOutputs: completed,
      targetOutputs: promptPackage.outputBriefs.length,
      providerAttempts: providerExecutionIds.length,
    });

    await setExecutionStatus(db, jobId, "collecting_assets", "completed", {
      percent: 100,
      message: "Execution completed",
      completedOutputs: completed,
      targetOutputs: promptPackage.outputBriefs.length,
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

export async function regenerateSingleMarketingOutput(input: {
  db: Db;
  executionJobId: string;
  outputId: string;
  workspaceId: string;
}): Promise<void> {
  const [output] = await input.db
    .select()
    .from(schema.aiStoryMarketingOutputs)
    .where(
      and(
        eq(schema.aiStoryMarketingOutputs.id, input.outputId),
        eq(schema.aiStoryMarketingOutputs.executionJobId, input.executionJobId),
        eq(schema.aiStoryMarketingOutputs.workspaceId, input.workspaceId)
      )
    )
    .limit(1);
  if (!output) throw new Error("Marketing output not found");

  const [job] = await input.db
    .select()
    .from(schema.aiStoryExecutionJobs)
    .where(eq(schema.aiStoryExecutionJobs.id, input.executionJobId))
    .limit(1);
  if (!job?.promptPackage) throw new Error("Execution prompt package missing");
  const promptPackage = job.promptPackage as PromptBuilderPackage;
  const brief = promptPackage.outputBriefs.find((b) => b.outputIndex === output.outputIndex);
  if (!brief) throw new Error("Output brief not found — cannot regenerate");

  const payloadResolver = new MemoryPayloadResolver();
  const registry = createProductionProviderRegistry(payloadResolver);
  const router = new CanonicalProviderRouter(registry);
  const primaryPrompt = brief.shotPrompts.map((s) => s.prompt).join("\n\n");
  const { providerId, result } = await invokeProviderForOutput({
    capabilityId: job.capabilityId,
    workspaceId: job.workspaceId,
    orgId: job.orgId,
    correlationId: `${job.id}-regen-${output.id}`,
    payloadResolver,
    registry,
    router,
    payload:
      job.mediaKind === "image"
        ? { prompt: primaryPrompt, outputIndex: brief.outputIndex }
        : {
            prompt: primaryPrompt,
            durationSec: brief.shotPrompts.reduce((s, p) => s + p.durationSec, 0),
            outputIndex: brief.outputIndex,
          },
  });
  const normalized = result.normalizedOutput as { videoUrl?: string; imageUrl?: string };
  const storagePath =
    job.mediaKind === "image" ? normalized.imageUrl : normalized.videoUrl;

  await input.db
    .update(schema.aiStoryMarketingOutputs)
    .set({
      status: "pending_review",
      storagePath: storagePath ?? null,
      thumbnailPath: job.mediaKind === "image" ? storagePath ?? null : null,
      providerId,
      providerExecutionId: result.executionId,
      prompt: primaryPrompt,
      updatedAt: new Date(),
    })
    .where(eq(schema.aiStoryMarketingOutputs.id, output.id));

  if (output.creativeId) {
    await input.db
      .update(schema.creatives)
      .set({
        status: "pending_review",
        videoUrl: job.mediaKind === "video" ? storagePath ?? null : null,
        coverUrl: job.mediaKind === "image" ? storagePath ?? null : null,
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
