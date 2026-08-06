/**
 * Sprint 3 Phase 2B PR 2B.4 — Review & Assembly API safe read-model contracts.
 *
 * Non-authoritative projections for HTTP responses. Canonical truth remains
 * append-only facts + Execution Plan Aggregate Root. Never unlocks execution.
 */
import { z } from "zod";
import { PHASE1_EXECUTION_LOCKED } from "./ai-story-phase1-execution-lock";
import { HumanReviewDecisionSchema, LogicalReviewStatusSchema } from "./ai-story-human-review";
import { AiStoryAiQcStatusSchema } from "./ai-story-execution";

export const EXECUTION_PLAN_READINESS = ["READY_FOR_EXECUTION", "NOT_READY"] as const;
export const ExecutionPlanReadinessSchema = z.enum(EXECUTION_PLAN_READINESS);
export type ExecutionPlanReadiness = z.infer<typeof ExecutionPlanReadinessSchema>;

export const ASSEMBLY_DEFINITION_STATUS = ["PERSISTED", "NOT_CREATED"] as const;
export const AssemblyDefinitionStatusSchema = z.enum(ASSEMBLY_DEFINITION_STATUS);
export type AssemblyDefinitionStatus = z.infer<typeof AssemblyDefinitionStatusSchema>;

/** Safe QC summary — never includes raw instruction/snapshot bodies. */
export const SafeSceneQcSummarySchema = z.object({
  status: AiStoryAiQcStatusSchema,
  resultHash: z.string().min(1),
  validatedAt: z.string().datetime(),
  findingCount: z.number().int().nonnegative(),
  blockingFindingCount: z.number().int().nonnegative(),
  findings: z.array(
    z.object({
      code: z.string().min(1),
      message: z.string().min(1),
      severity: z.enum(["blocking", "warning"]),
    })
  ),
});

export type SafeSceneQcSummary = z.infer<typeof SafeSceneQcSummarySchema>;

export const SafeSceneReviewSummarySchema = z.object({
  sceneExecutionId: z.string().uuid(),
  sceneId: z.string().min(1),
  sceneOrder: z.number().int().nonnegative(),
  instructionHash: z.string().min(1),
  decision: HumanReviewDecisionSchema.nullable(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  comment: z.string().optional(),
  qc: SafeSceneQcSummarySchema.nullable(),
});

export type SafeSceneReviewSummary = z.infer<typeof SafeSceneReviewSummarySchema>;

export const SafeStoryDecisionSummarySchema = z.object({
  decision: HumanReviewDecisionSchema,
  reviewedBy: z.string().uuid(),
  reviewedAt: z.string().datetime(),
  comment: z.string().optional(),
});

export type SafeStoryDecisionSummary = z.infer<typeof SafeStoryDecisionSummarySchema>;

export const SafeAssemblyMembershipSummarySchema = z.object({
  membershipId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  sceneId: z.string().min(1),
  sceneOrder: z.number().int().nonnegative(),
});

export type SafeAssemblyMembershipSummary = z.infer<
  typeof SafeAssemblyMembershipSummarySchema
>;

export const ExecutionPlanReviewAssemblyReadModelSchema = z.object({
  executionPlan: z.object({
    id: z.string().uuid(),
    status: z.literal("PERSISTED"),
    orgId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    campaignId: z.string().uuid(),
    storyId: z.string().uuid(),
    storyVersionId: z.string().uuid(),
    animationPackageId: z.string().uuid(),
    readiness: ExecutionPlanReadinessSchema,
  }),
  review: z.object({
    status: LogicalReviewStatusSchema,
    openedAt: z.string().datetime().nullable(),
    openedBy: z.string().uuid().nullable(),
    scenes: z.array(SafeSceneReviewSummarySchema),
    storyDecision: SafeStoryDecisionSummarySchema.nullable(),
  }),
  assemblyDefinition: z.object({
    status: AssemblyDefinitionStatusSchema,
    id: z.string().uuid().nullable(),
    sceneCount: z.number().int().nonnegative(),
    integrityHash: z.string().nullable(),
    memberships: z.array(SafeAssemblyMembershipSummarySchema),
    prerequisites: z.object({
      hasDefinition: z.boolean(),
      membershipComplete: z.boolean(),
      reviewApproved: z.boolean(),
      orderingDeterministic: z.boolean(),
    }),
  }),
  executionReadiness: ExecutionPlanReadinessSchema,
  executionAllowed: z.literal(false),
  executionLockCode: z.literal(PHASE1_EXECUTION_LOCKED),
});

export type ExecutionPlanReviewAssemblyReadModel = z.infer<
  typeof ExecutionPlanReviewAssemblyReadModelSchema
>;

export const ReviewHistoryEventKindSchema = z.enum([
  "REVIEW_OPENED",
  "SCENE_DECISION",
  "STORY_DECISION",
  "STATUS_DERIVED",
]);

export const ReviewHistoryEventSchema = z.object({
  kind: ReviewHistoryEventKindSchema,
  at: z.string().datetime(),
  actorId: z.string().uuid().nullable(),
  sceneExecutionId: z.string().uuid().optional(),
  sceneId: z.string().optional(),
  decision: HumanReviewDecisionSchema.optional(),
  comment: z.string().optional(),
  derivedStatus: LogicalReviewStatusSchema.optional(),
  factId: z.string().uuid().optional(),
});

export type ReviewHistoryEvent = z.infer<typeof ReviewHistoryEventSchema>;

export const ReviewHistoryReadModelSchema = z.object({
  executionPlanId: z.string().uuid(),
  events: z.array(ReviewHistoryEventSchema),
  executionAllowed: z.literal(false),
  executionLockCode: z.literal(PHASE1_EXECUTION_LOCKED),
});

export type ReviewHistoryReadModel = z.infer<typeof ReviewHistoryReadModelSchema>;

/** Request body for Scene / Story review decisions (reviewerId never accepted). */
export const ReviewDecisionRequestSchema = z
  .object({
    decision: HumanReviewDecisionSchema,
    comment: z.string().optional(),
    rationale: z.string().optional(),
  })
  .strict();

export type ReviewDecisionRequest = z.infer<typeof ReviewDecisionRequestSchema>;

export const AssemblyDefinitionCreateRequestSchema = z
  .object({
    orderedSceneExecutionIds: z.array(z.string().uuid()).min(1).optional(),
  })
  .strict();

export type AssemblyDefinitionCreateRequest = z.infer<
  typeof AssemblyDefinitionCreateRequestSchema
>;
