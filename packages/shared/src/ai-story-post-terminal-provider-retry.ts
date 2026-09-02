import { z } from "zod";

export const AI_STORY_POST_TERMINAL_PROVIDER_RETRY_CONTRACT_VERSION =
  "ai-story-post-terminal-provider-retry.v1" as const;

export const POST_TERMINAL_RETRY_FAILURE_CLASSIFICATIONS = [
  "STAGING_SEEDANCE_FIRST_FRAME_I2V_MIXED_REFERENCE_ROLE_WIRE_CONTRACT_MISMATCH",
] as const;

export const PostTerminalRetryFailureClassificationSchema = z.enum(
  POST_TERMINAL_RETRY_FAILURE_CLASSIFICATIONS
);

export const PostTerminalProviderRetryAuthorizationFactSchema = z
  .object({
    authorizationId: z.string().uuid(),
    environment: z.literal("STAGING"),
    orgId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    campaignId: z.string().uuid(),
    storyId: z.string().uuid(),
    executionPlanId: z.string().uuid(),
    sceneExecutionId: z.string().uuid(),
    sourceCompiledRequestId: z.string().uuid(),
    sourceCompiledRequestFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    priorProviderAttemptId: z.string().trim().min(1),
    priorWorkerResultId: z.string().uuid(),
    priorReservationId: z.string().uuid(),
    failureClassification: PostTerminalRetryFailureClassificationSchema,
    failureCode: z.literal("PROVIDER_NOT_ACCEPTED"),
    retryReason: z.literal("CORRECTED_PROVIDER_REQUEST_CONTRACT"),
    humanDecision: z.literal("AUTHORIZE_ONE_RETRY"),
    authorizedBy: z.string().uuid(),
    authorizedAt: z.string().datetime(),
    retryGeneration: z.number().int().min(2),
    targetCompilerContractVersion: z.literal(
      "seedance-first-frame-i2v-wire.v1"
    ),
    targetMode: z.literal("FIRST_FRAME_IMAGE_TO_VIDEO"),
    commercialAuthorizationId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(1),
    integrityHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    contractVersion: z.literal(
      AI_STORY_POST_TERMINAL_PROVIDER_RETRY_CONTRACT_VERSION
    ),
  })
  .strict();

export type PostTerminalProviderRetryAuthorizationFact = z.infer<
  typeof PostTerminalProviderRetryAuthorizationFactSchema
>;

export const AuthorizePostTerminalProviderRetryCommandSchema = z
  .object({
    executionPlanId: z.string().uuid(),
    sceneExecutionId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    priorProviderAttemptId: z.string().trim().min(1),
    priorWorkerResultId: z.string().uuid(),
    sourceCompiledRequestId: z.string().uuid(),
    sourceCompiledRequestFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    commercialAuthorizationId: z.string().uuid(),
    actorUserId: z.string().uuid(),
    humanDecision: z.literal("AUTHORIZE_ONE_RETRY"),
    failureClassification: PostTerminalRetryFailureClassificationSchema,
    targetCompilerContractVersion: z.literal(
      "seedance-first-frame-i2v-wire.v1"
    ),
  })
  .strict();

export type AuthorizePostTerminalProviderRetryCommand = z.infer<
  typeof AuthorizePostTerminalProviderRetryCommandSchema
>;
