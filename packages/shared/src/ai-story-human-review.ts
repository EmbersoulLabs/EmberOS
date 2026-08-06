/**
 * Sprint 3 Phase 2B PR 2B.1 — Human Review contracts.
 *
 * Review is a LOGICAL AGGREGATE owned by the Execution Plan (the only Aggregate Root).
 * Persistence is append-only facts. Never mutate previous decisions. Never create a
 * Review Aggregate Root. READY_FOR_EXECUTION is not a review state.
 *
 * This module does not authorize API, UI, RLS, Queue, Worker, Outbox, Provider,
 * Assembly Definition, or execution unlock.
 */
import { z } from "zod";
import { AI_STORY_EXECUTION_CONTRACT_VERSION } from "./ai-story-execution";

const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = NonEmptyTextSchema;

/** Logical review projection states (derived from append-only facts). */
export const LOGICAL_REVIEW_STATUSES = [
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
] as const;

export const LogicalReviewStatusSchema = z.enum(LOGICAL_REVIEW_STATUSES);
export type LogicalReviewStatus = z.infer<typeof LogicalReviewStatusSchema>;

/** Scene / Story human review decisions (facts never use PENDING). */
export const HUMAN_REVIEW_DECISIONS = ["APPROVED", "REJECTED"] as const;
export const HumanReviewDecisionSchema = z.enum(HUMAN_REVIEW_DECISIONS);
export type HumanReviewDecision = z.infer<typeof HumanReviewDecisionSchema>;

/**
 * Append-only fact that opens human review for one Execution Plan.
 * Deterministic identity is subordinate to the Execution Plan.
 */
export const ReviewOpenedFactSchema = z.object({
  factId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  orgId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  campaignId: z.string().uuid(),
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  animationPackageId: z.string().uuid(),
  openedBy: z.string().uuid(),
  openedAt: z.string().datetime(),
  contractVersion: z.literal(AI_STORY_EXECUTION_CONTRACT_VERSION),
  deterministicFingerprint: IntegrityHashSchema,
});

export type ReviewOpenedFact = z.infer<typeof ReviewOpenedFactSchema>;

/**
 * Append-only Scene Intent review decision fact.
 * Binds to Scene Execution + Instruction Snapshot + AI QC identity.
 */
export const SceneIntentReviewDecisionSchema = z.object({
  factId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  sceneId: NonEmptyTextSchema,
  sceneOrder: z.number().int().nonnegative(),
  decision: HumanReviewDecisionSchema,
  reviewedBy: z.string().uuid(),
  reviewedAt: z.string().datetime(),
  rationale: z.string().optional(),
  instructionHash: IntegrityHashSchema,
  qcResultHash: IntegrityHashSchema,
  contractVersion: z.literal(AI_STORY_EXECUTION_CONTRACT_VERSION),
  deterministicFingerprint: IntegrityHashSchema,
});

export type SceneIntentReviewDecision = z.infer<
  typeof SceneIntentReviewDecisionSchema
>;

/**
 * Append-only Story-level review decision fact.
 * Story APPROVED requires every required Scene Intent to be APPROVED.
 */
export const StoryReviewDecisionSchema = z.object({
  factId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  decision: HumanReviewDecisionSchema,
  reviewedBy: z.string().uuid(),
  reviewedAt: z.string().datetime(),
  rationale: z.string().optional(),
  requiredSceneExecutionIds: z.array(z.string().uuid()).min(1),
  approvedSceneExecutionIds: z.array(z.string().uuid()).default([]),
  contractVersion: z.literal(AI_STORY_EXECUTION_CONTRACT_VERSION),
  deterministicFingerprint: IntegrityHashSchema,
});

export type StoryReviewDecision = z.infer<typeof StoryReviewDecisionSchema>;

/**
 * Derived logical review projection for one Execution Plan.
 * Not persisted as a mutable row — reconstructed from facts.
 */
export const LogicalReviewProjectionSchema = z.object({
  executionPlanId: z.string().uuid(),
  orgId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  status: LogicalReviewStatusSchema,
  opened: ReviewOpenedFactSchema.nullable(),
  sceneDecisions: z.array(SceneIntentReviewDecisionSchema),
  latestSceneDecisionBySceneExecutionId: z.record(SceneIntentReviewDecisionSchema),
  storyDecision: StoryReviewDecisionSchema.nullable(),
  derivedAt: z.string().datetime(),
});

export type LogicalReviewProjection = z.infer<
  typeof LogicalReviewProjectionSchema
>;
