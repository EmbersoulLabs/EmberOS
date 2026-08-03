/**
 * Sprint 3 Phase 2B PR 2B.2 — Story Assembly Definition contracts.
 *
 * Execution Plan remains the only Aggregate Root. Assembly Definition is
 * subordinate and immutable: deterministic future execution ordering only.
 * It is NOT media assembly, NOT Story Video, and does not unlock execution.
 *
 * READY_FOR_EXECUTION is never persisted here — readiness remains derived.
 * Assembly Definition rows are immutable: no UPDATE / DELETE lifecycle.
 */
import { z } from "zod";
import { AI_STORY_EXECUTION_CONTRACT_VERSION } from "./ai-story-execution";

const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = NonEmptyTextSchema;

/**
 * Immutable Story Assembly Definition for one Execution Plan.
 * Identity is content-addressed by ordered Scene Execution membership.
 */
export const StoryAssemblyDefinitionSchema = z.object({
  assemblyDefinitionId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  orgId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  campaignId: z.string().uuid(),
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  animationPackageId: z.string().uuid(),
  sceneCount: z.number().int().positive(),
  orderedSceneExecutionIds: z.array(z.string().uuid()).min(1),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  contractVersion: z.literal(AI_STORY_EXECUTION_CONTRACT_VERSION),
  deterministicFingerprint: IntegrityHashSchema,
});

export type StoryAssemblyDefinition = z.infer<typeof StoryAssemblyDefinitionSchema>;

/**
 * Immutable ordered Scene membership under one Assembly Definition.
 */
export const AssemblySceneMembershipSchema = z.object({
  membershipId: z.string().uuid(),
  assemblyDefinitionId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  sceneId: NonEmptyTextSchema,
  sceneOrder: z.number().int().nonnegative(),
  contractVersion: z.literal(AI_STORY_EXECUTION_CONTRACT_VERSION),
  deterministicFingerprint: IntegrityHashSchema,
});

export type AssemblySceneMembership = z.infer<typeof AssemblySceneMembershipSchema>;

/**
 * Derived assembly projection. Never stores READY_FOR_EXECUTION.
 */
export const AssemblyProjectionSchema = z.object({
  executionPlanId: z.string().uuid(),
  orgId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  definition: StoryAssemblyDefinitionSchema.nullable(),
  memberships: z.array(AssemblySceneMembershipSchema),
  sceneCount: z.number().int().nonnegative(),
  orderedSceneExecutionIds: z.array(z.string().uuid()),
  prerequisites: z.object({
    hasDefinition: z.boolean(),
    membershipComplete: z.boolean(),
    reviewApproved: z.boolean(),
    orderingDeterministic: z.boolean(),
  }),
  derivedAt: z.string().datetime(),
});

export type AssemblyProjection = z.infer<typeof AssemblyProjectionSchema>;
