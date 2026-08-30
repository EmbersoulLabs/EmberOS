import { z } from "zod";

export const PRE_PROVIDER_RECOVERY_MODE =
  "HUMAN_RETRY_FROM_PRE_PROVIDER_FAILURE" as const;

export const PreDispatchRecoveryPreviewSchema = z.object({
  recoveryMode: z.literal(PRE_PROVIDER_RECOVERY_MODE),
  executionPlanId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  providerExecutionId: z.string().min(1),
  outboxJobId: z.string().min(1),
  dispatchId: z.string().min(1),
  failureState: z.literal("PRE_DISPATCH_BLOCKED"),
  existingProviderAttemptCount: z.literal(0),
  existingResultCount: z.literal(0),
  existingGeneratedReviewCount: z.literal(0),
  secondReleaseRequired: z.literal(false),
  duplicateOutboxRequired: z.literal(false),
  duplicateDispatchRequired: z.literal(false),
  providerCallExecuted: z.literal(false),
}).strict();

export type PreDispatchRecoveryPreview = z.infer<
  typeof PreDispatchRecoveryPreviewSchema
>;

export type PreDispatchGroundingCertification = {
  readonly visualAuthorityCertified: true;
  readonly productAuthorityResolved: true;
  readonly providerMode: "FIRST_FRAME_I2V";
  readonly firstFramePresent: true;
  readonly directorSafe: true;
  readonly preDispatchGate: "PASS";
};

export type PreDispatchRecoveryCommandPort<TResult> = {
  recover(input: {
    readonly executionPlanId: string;
    readonly sceneExecutionId: string;
    readonly orgId: string;
    readonly workspaceId: string;
    readonly actorUserId: string;
    readonly idempotencyKey: string;
    readonly reason: string;
  }): Promise<TResult>;
};

/**
 * Executable application service. Grounding is revalidated immediately before
 * the atomic repository command; browsers cannot supply certification facts.
 */
export class PreDispatchRecoveryService<TResult> {
  constructor(
    private readonly dependencies: {
      readonly repository: PreDispatchRecoveryCommandPort<TResult>;
      readonly certifyGrounding: (input: {
        readonly executionPlanId: string;
        readonly sceneExecutionId: string;
        readonly orgId: string;
        readonly workspaceId: string;
      }) => Promise<PreDispatchGroundingCertification>;
    }
  ) {}

  async recover(input: {
    readonly executionPlanId: string;
    readonly sceneExecutionId: string;
    readonly orgId: string;
    readonly workspaceId: string;
    readonly actorUserId: string;
    readonly idempotencyKey: string;
    readonly reason: string;
  }): Promise<TResult> {
    const certification = await this.dependencies.certifyGrounding(input);
    if (
      !certification.visualAuthorityCertified ||
      !certification.productAuthorityResolved ||
      certification.providerMode !== "FIRST_FRAME_I2V" ||
      !certification.firstFramePresent ||
      !certification.directorSafe ||
      certification.preDispatchGate !== "PASS"
    ) {
      throw new Error("Pre-dispatch grounding revalidation failed closed");
    }
    return this.dependencies.repository.recover(input);
  }
}

/**
 * Read-only recovery classification. It never rearms queue state or creates a
 * provider attempt; a later explicitly authorized command owns that mutation.
 */
export function buildPreDispatchRecoveryPreview(input: {
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly providerExecutionId: string;
  readonly outboxJobId: string;
  readonly dispatchId: string;
  readonly workerState: string;
  readonly providerRequestId: string | null;
  readonly providerAttemptCount: number;
  readonly resultCount: number;
  readonly generatedReviewCount: number;
}): PreDispatchRecoveryPreview {
  if (
    input.workerState !== "NOT_ACCEPTED" ||
    input.providerRequestId !== null ||
    input.providerAttemptCount !== 0 ||
    input.resultCount !== 0 ||
    input.generatedReviewCount !== 0
  ) {
    throw new Error("Scene is not an eligible pre-provider blocked dispatch");
  }
  return PreDispatchRecoveryPreviewSchema.parse({
    recoveryMode: PRE_PROVIDER_RECOVERY_MODE,
    executionPlanId: input.executionPlanId,
    sceneExecutionId: input.sceneExecutionId,
    providerExecutionId: input.providerExecutionId,
    outboxJobId: input.outboxJobId,
    dispatchId: input.dispatchId,
    failureState: "PRE_DISPATCH_BLOCKED",
    existingProviderAttemptCount: 0,
    existingResultCount: 0,
    existingGeneratedReviewCount: 0,
    secondReleaseRequired: false,
    duplicateOutboxRequired: false,
    duplicateDispatchRequired: false,
    providerCallExecuted: false,
  });
}
