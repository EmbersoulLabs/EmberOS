/**
 * Campaign-owned AI Story planning persistence helpers.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  AnimationPackagePayloadSchema,
  CreativeContextSchema,
  validatePlanningConsistency,
  type AnimationPackagePayload,
  type CreativeContext,
  type NarrativeIntegrationReport,
} from "@ceo-agent/shared";

type Db = ReturnType<typeof getDb>;

export async function loadLatestCreativeContextForStory(
  db: Db,
  input: { campaignId: string; storyId: string; workspaceId: string }
) {
  const [context] = await db
    .select()
    .from(schema.aiStoryCreativeContexts)
    .where(
      and(
        eq(schema.aiStoryCreativeContexts.campaignId, input.campaignId),
        eq(schema.aiStoryCreativeContexts.storyId, input.storyId),
        eq(schema.aiStoryCreativeContexts.workspaceId, input.workspaceId)
      )
    )
    .orderBy(desc(schema.aiStoryCreativeContexts.createdAt))
    .limit(1);
  return context ?? null;
}

export async function saveCreativeContext(
  db: Db,
  input: {
    orgId: string;
    workspaceId: string;
    campaignId: string;
    storyId: string;
    storyVersionId: string;
    payload: CreativeContext;
  }
) {
  const payload = CreativeContextSchema.parse(input.payload);
  const [context] = await db
    .insert(schema.aiStoryCreativeContexts)
    .values({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      payload,
    })
    .returning();
  if (!context) throw new Error("Failed to save AI Story creative context");
  return context;
}

export async function getLatestAnimationPackageForStory(
  db: Db,
  input: { campaignId: string; storyId: string; workspaceId: string }
) {
  const [animationPackage] = await db
    .select()
    .from(schema.aiStoryAnimationPackages)
    .where(
      and(
        eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId)
      )
    )
    .orderBy(desc(schema.aiStoryAnimationPackages.createdAt))
    .limit(1);
  return animationPackage ?? null;
}

export async function saveAnimationPackage(
  db: Db,
  input: {
    orgId: string;
    workspaceId: string;
    campaignId: string;
    storyId: string;
    storyVersionId: string;
    payload: AnimationPackagePayload;
  }
) {
  const parsed = AnimationPackagePayloadSchema.parse(input.payload);
  const consistencyReport: NarrativeIntegrationReport = validatePlanningConsistency(parsed);
  const payload: AnimationPackagePayload = {
    ...parsed,
    narrativeIntegration: consistencyReport,
    status: "review",
  };
  const [animationPackage] = await db
    .insert(schema.aiStoryAnimationPackages)
    .values({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      status: payload.status,
      payload,
      consistencyReport,
    })
    .returning();
  if (!animationPackage) throw new Error("Failed to save AI Story animation package");
  return animationPackage;
}

export async function approveAnimationPackage(
  db: Db,
  input: {
    packageId: string;
    campaignId: string;
    storyId: string;
    workspaceId: string;
    approvedBy: string;
  }
) {
  const existing = await getLatestAnimationPackageForStory(db, input);
  if (!existing || existing.id !== input.packageId) {
    throw new Error("Animation Package not found");
  }
  const payload = AnimationPackagePayloadSchema.parse(existing.payload);
  const approvedPayload: AnimationPackagePayload = {
    ...payload,
    status: "ready_for_execution",
  };
  const [updated] = await db
    .update(schema.aiStoryAnimationPackages)
    .set({
      status: "ready_for_execution",
      payload: approvedPayload,
      approvedAt: new Date(),
      approvedBy: input.approvedBy,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.aiStoryAnimationPackages.id, input.packageId),
        eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId)
      )
    )
    .returning();
  if (!updated) throw new Error("Failed to approve Animation Package");
  return updated;
}
