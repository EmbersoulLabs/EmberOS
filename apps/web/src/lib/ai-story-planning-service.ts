/**
 * Campaign-owned AI Story planning persistence helpers.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
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

export type ApprovedAnimationPackageRevisionInput = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly expectedStoryVersionId: string;
  readonly expectedAnimationPackageId: string;
  readonly actorUserId: string;
  readonly correlationId: string;
  readonly reason: string;
  readonly payload: AnimationPackagePayload;
  readonly now?: Date;
};

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertRetainedItems<T extends { readonly id: string }>(
  label: string,
  previous: readonly T[],
  next: readonly T[]
): void {
  if (next.length !== previous.length + 1) {
    throw new Error(`Approved Animation Package revision must append exactly one ${label}`);
  }
  for (const item of previous) {
    const retained = next.find((candidate) => candidate.id === item.id);
    if (!retained || !sameJson(retained, item)) {
      throw new Error(`Approved Animation Package revision changed retained ${label} ${item.id}`);
    }
  }
}

/**
 * Validate a bounded revision of an already-approved Animation Package.
 * Existing Scene and Story reference authority is immutable; exactly one
 * explicit reference-free T2V Scene may be appended.
 */
export function validateApprovedAnimationPackageRevision(
  previousRaw: unknown,
  nextRaw: unknown
): AnimationPackagePayload {
  const previous = AnimationPackagePayloadSchema.parse(previousRaw);
  const next = AnimationPackagePayloadSchema.parse(nextRaw);
  if (!sameJson(previous.story.assetReferences, next.story.assetReferences)) {
    throw new Error("Approved Animation Package revision cannot change Story asset references");
  }
  for (const [label, before, after] of [
    ["Story", previous.story, next.story],
    ["Characters", previous.characters, next.characters],
    ["Creative Context", previous.creativeContext, next.creativeContext],
    ["Director Thinking", previous.directorThinking, next.directorThinking],
    ["Character Continuity", previous.characterContinuity, next.characterContinuity],
    ["World Continuity", previous.worldContinuity, next.worldContinuity],
  ] as const) {
    if (!sameJson(before, after)) {
      throw new Error(`Approved Animation Package revision changed retained ${label}`);
    }
  }
  assertRetainedItems("Story Beat", previous.storyBeats, next.storyBeats);
  assertRetainedItems("Scene", previous.scenePlan, next.scenePlan);
  assertRetainedItems("Shot", previous.shotPlan, next.shotPlan);
  const previousSceneIds = new Set(previous.scenePlan.map((scene) => scene.id));
  const additions = next.scenePlan.filter((scene) => !previousSceneIds.has(scene.id));
  const added = additions[0];
  if (additions.length !== 1 || !added) {
    throw new Error("Approved Animation Package revision requires one new Scene identity");
  }
  if (
    added.generationAuthority?.strategy !== "TEXT_TO_VIDEO" ||
    added.generationAuthority.referenceSource !== "REFERENCE_FREE_T2V" ||
    added.generationAuthority.referenceAssetIds.length !== 0 ||
    added.generationAuthority.firstFrameAssetId !== null ||
    added.generationAuthority.productVisualIdentityRequirement !== "NONE"
  ) {
    throw new Error("New certification Scene must be explicitly reference-free TEXT_TO_VIDEO");
  }
  const addedBeatIds = new Set(
    next.storyBeats
      .filter((beat) => !previous.storyBeats.some((prior) => prior.id === beat.id))
      .map((beat) => beat.id)
  );
  const addedShots = next.shotPlan.filter(
    (shot) => !previous.shotPlan.some((prior) => prior.id === shot.id)
  );
  if (
    added.beatIds.length !== 1 ||
    !addedBeatIds.has(added.beatIds[0] ?? "") ||
    addedShots.length !== 1 ||
    addedShots[0]?.sceneId !== added.id
  ) {
    throw new Error("New certification Scene must own exactly one new Story Beat and Shot");
  }
  return next;
}

/**
 * Atomically evolve a frozen Story + approved Animation Package without
 * rewriting historical authority or changing the Story lifecycle state.
 */
export async function createApprovedAnimationPackageRevision(
  db: Db,
  input: ApprovedAnimationPackageRevisionInput
) {
  const requestedPayload = AnimationPackagePayloadSchema.parse(input.payload);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ai-story-package-revision:${input.storyId}`}))`
    );
    const [story] = await tx
      .select()
      .from(schema.aiStories)
      .where(eq(schema.aiStories.id, input.storyId))
      .limit(1)
      .for("update");
    if (
      !story ||
      story.orgId !== input.orgId ||
      story.workspaceId !== input.workspaceId ||
      story.campaignId !== input.campaignId
    ) {
      throw new Error("Story revision scope is not authorized");
    }
    if (!["ready_for_execution", "generate_review"].includes(story.status)) {
      throw new Error("Story must have approved execution authority before package revision");
    }
    const [membership] = await tx
      .select({ role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, input.workspaceId),
          eq(schema.workspaceMembers.userId, input.actorUserId)
        )
      )
      .limit(1);
    if (!membership || !["admin", "operator", "editor", "reviewer"].includes(membership.role)) {
      throw new Error("Story revision actor lacks planning mutation authority");
    }
    const versions = await tx
      .select()
      .from(schema.aiStoryVersions)
      .where(eq(schema.aiStoryVersions.storyId, input.storyId))
      .orderBy(desc(schema.aiStoryVersions.versionNumber));
    const existingRevision = versions.find(
      (version) => version.sourceContextSnapshot?.correlationId === input.correlationId
    );
    if (existingRevision) {
      const [existingPackage] = await tx
        .select()
        .from(schema.aiStoryAnimationPackages)
        .where(
          and(
            eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
            eq(schema.aiStoryAnimationPackages.storyVersionId, existingRevision.id)
          )
        )
        .limit(1);
      if (!existingPackage || existingPackage.status !== "ready_for_execution") {
        throw new Error("Existing correlated Story revision is incomplete");
      }
      if (story.currentVersionId !== existingRevision.id) {
        throw new Error("Existing correlated Story revision is no longer current");
      }
      const existingPayload = AnimationPackagePayloadSchema.parse(existingPackage.payload);
      if (
        !sameJson(existingPayload.story.assetReferences, requestedPayload.story.assetReferences) ||
        !sameJson(existingPayload.storyBeats, requestedPayload.storyBeats) ||
        !sameJson(existingPayload.scenePlan, requestedPayload.scenePlan) ||
        !sameJson(existingPayload.shotPlan, requestedPayload.shotPlan)
      ) {
        throw new Error("Existing correlated Story revision does not match requested authority");
      }
      return { version: existingRevision, animationPackage: existingPackage, idempotent: true };
    }
    if (story.currentVersionId !== input.expectedStoryVersionId) {
      throw new Error("Story current version changed before package revision");
    }
    const previousVersion = versions.find(
      (version) => version.id === input.expectedStoryVersionId
    );
    if (!previousVersion?.frozenAt) {
      throw new Error("Previous Story version must be frozen");
    }
    const [previousPackage] = await tx
      .select()
      .from(schema.aiStoryAnimationPackages)
      .where(
        and(
          eq(schema.aiStoryAnimationPackages.id, input.expectedAnimationPackageId),
          eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
          eq(schema.aiStoryAnimationPackages.storyVersionId, input.expectedStoryVersionId),
          eq(schema.aiStoryAnimationPackages.status, "ready_for_execution")
        )
      )
      .limit(1)
      .for("share");
    if (!previousPackage) {
      throw new Error("Previous approved Animation Package is not current");
    }
    const payload = validateApprovedAnimationPackageRevision(
      previousPackage.payload,
      requestedPayload
    );
    const consistencyReport = validatePlanningConsistency(payload);
    if (!consistencyReport.consistent) {
      throw new Error(
        `Animation Package revision is inconsistent: ${consistencyReport.issues.join("; ")}`
      );
    }
    const versionId = randomUUID();
    const animationPackageId = randomUUID();
    const versionNumber = Math.max(...versions.map((version) => version.versionNumber)) + 1;
    const [version] = await tx
      .insert(schema.aiStoryVersions)
      .values({
        id: versionId,
        storyId: input.storyId,
        versionNumber,
        structuredContent: previousVersion.structuredContent,
        sourceContextSnapshot: {
          ...previousVersion.sourceContextSnapshot,
          action: "approved_animation_package_revision",
          correlationId: input.correlationId,
          reason: input.reason,
          supersedesStoryVersionId: previousVersion.id,
          supersedesAnimationPackageId: previousPackage.id,
        },
        aiMetadata: {
          externalAiCalls: 0,
          generatedBy: "CANONICAL_APPROVED_PACKAGE_REVISION",
        },
        userEdited: true,
        createdBy: input.actorUserId,
        createdAt: now,
        frozenAt: now,
        frozenBy: input.actorUserId,
      })
      .returning();
    if (!version) throw new Error("Failed to persist revised frozen Story version");
    const approvedPayload: AnimationPackagePayload = {
      ...payload,
      narrativeIntegration: consistencyReport,
      status: "ready_for_execution",
    };
    const [animationPackage] = await tx
      .insert(schema.aiStoryAnimationPackages)
      .values({
        id: animationPackageId,
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        campaignId: input.campaignId,
        storyId: input.storyId,
        storyVersionId: version.id,
        status: "ready_for_execution",
        payload: approvedPayload,
        consistencyReport,
        createdAt: now,
        updatedAt: now,
        approvedAt: now,
        approvedBy: input.actorUserId,
      })
      .returning();
    if (!animationPackage) throw new Error("Failed to persist revised Animation Package");
    const [updatedStory] = await tx
      .update(schema.aiStories)
      .set({ currentVersionId: version.id, updatedAt: now })
      .where(
        and(
          eq(schema.aiStories.id, input.storyId),
          eq(schema.aiStories.currentVersionId, input.expectedStoryVersionId)
        )
      )
      .returning({ id: schema.aiStories.id });
    if (!updatedStory) throw new Error("Story current version changed during package revision");
    return { version, animationPackage, idempotent: false };
  });
}
