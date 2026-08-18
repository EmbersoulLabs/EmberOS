/**
 * Campaign-owned AI Story planning persistence helpers.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  AnimationPackagePayloadSchema,
  CreativeContextSchema,
  StoryPlanningDraftSchema,
  isStoryPlanningDraft,
  validatePlanningConsistency,
  type AnimationPackagePayload,
  type CreativeContext,
  type NarrativeIntegrationReport,
  type StoryPlanningDraft,
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

export async function savePlanningDraft(
  db: Db,
  input: {
    orgId: string;
    workspaceId: string;
    campaignId: string;
    storyId: string;
    storyVersionId: string;
    payload: StoryPlanningDraft;
  }
) {
  const payload = StoryPlanningDraftSchema.parse(input.payload);
  const [animationPackage] = await db
    .insert(schema.aiStoryAnimationPackages)
    .values({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      status: "generating",
      payload,
      consistencyReport: { consistent: false, issues: ["Planning draft incomplete"], links: [] },
    })
    .returning();
  if (!animationPackage) throw new Error("Failed to save AI Story planning draft");
  return animationPackage;
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

export function readPlanningDraftFromPackage(
  animationPackage: { payload: unknown; status: string } | null
): StoryPlanningDraft | null {
  if (!animationPackage) return null;
  if (isStoryPlanningDraft(animationPackage.payload)) {
    return StoryPlanningDraftSchema.parse(animationPackage.payload);
  }
  return null;
}

export function readCompleteAnimationPackage(
  animationPackage: { payload: unknown; status: string } | null
): AnimationPackagePayload | null {
  if (!animationPackage) return null;
  if (isStoryPlanningDraft(animationPackage.payload)) return null;
  const parsed = AnimationPackagePayloadSchema.safeParse(animationPackage.payload);
  return parsed.success ? parsed.data : null;
}

export async function getLatestCompleteAnimationPackageForStory(
  db: Db,
  input: { campaignId: string; storyId: string; workspaceId: string }
) {
  const rows = await db
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
    .limit(20);
  for (const row of rows) {
    if (isStoryPlanningDraft(row.payload)) continue;
    const parsed = AnimationPackagePayloadSchema.safeParse(row.payload);
    if (parsed.success) return row;
  }
  return null;
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
  const [existing] = await db
    .select()
    .from(schema.aiStoryAnimationPackages)
    .where(
      and(
        eq(schema.aiStoryAnimationPackages.id, input.packageId),
        eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId)
      )
    )
    .limit(1);
  if (!existing) {
    throw new Error("Animation Package not found");
  }
  if (isStoryPlanningDraft(existing.payload)) {
    throw new Error("Planning draft is incomplete — assemble Animation Package first");
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
