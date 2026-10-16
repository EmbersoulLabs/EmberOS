import { and, asc, eq, sql } from "drizzle-orm";
import {
  AiStoryEpisodeProjectedMotionPlanSchema,
  AiStorySuccessorMotionReviewSchema,
  type AiStoryEpisodeProjectedMotionPlan,
  type AiStorySuccessorMotionReview,
} from "@ceo-agent/shared";
import { buildSuccessorProjectedMotionPlan, validateSuccessorMotionReview } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import type { AiStoryScriptScope } from "./ai-story-script";

type Db = ReturnType<typeof getDb>;

export class AiStorySuccessorMotionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStorySuccessorMotionError";
  }
}

async function assertScope(db: Pick<Db, "execute">, scope: AiStoryScriptScope, mutate: boolean) {
  const rows = await db.execute<{ ok: boolean }>(sql`
    select exists(
      select 1 from ai_stories s
      join campaigns c on c.id = s.campaign_id
      join ai_story_versions v on v.story_id = s.id
      join workspace_members wm on wm.workspace_id = s.workspace_id and wm.user_id = ${scope.actorUserId}::uuid
      where s.id = ${scope.storyId}::uuid
        and s.org_id = ${scope.orgId}::uuid
        and s.workspace_id = ${scope.workspaceId}::uuid
        and s.campaign_id = ${scope.campaignId}::uuid
        and v.id = ${scope.storyVersionId}::uuid
        and (${mutate} = false or wm.role in ('admin','operator','editor','reviewer'))
    ) as ok
  `);
  if (!rows[0]?.ok) throw new AiStorySuccessorMotionError("SUCCESSOR_MOTION_SCOPE_DENIED", "Successor Motion authority scope does not resolve");
}

function parse(row: typeof schema.aiStoryMotionPlanVersions.$inferSelect) {
  return AiStoryEpisodeProjectedMotionPlanSchema.parse({
    ...row.motionPlan,
    status: row.status,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    frozenAt: row.frozenAt?.toISOString() ?? null,
  });
}

export class AiStorySuccessorMotionService {
  constructor(private readonly db: Db = getDb()) {}

  async read(scope: AiStoryScriptScope) {
    await assertScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryMotionPlanVersions)
      .where(and(eq(schema.aiStoryMotionPlanVersions.storyId, scope.storyId), eq(schema.aiStoryMotionPlanVersions.workspaceId, scope.workspaceId)))
      .orderBy(asc(schema.aiStoryMotionPlanVersions.version));
    const projected = rows.filter((row) => row.contractVersion === "ai-story-motion-plan.episode-projected.v1").map(parse);
    return {
      active: [...projected].reverse().find((plan) => plan.status === "FROZEN") ?? null,
      pending: [...projected].reverse().find((plan) => plan.status === "DRAFT" || plan.status === "VALIDATED" || plan.status === "APPROVED") ?? null,
      history: projected,
    };
  }

  async propose(scope: AiStoryScriptScope, reviewInput: AiStorySuccessorMotionReview, createdAt = new Date().toISOString()) {
    const review = AiStorySuccessorMotionReviewSchema.parse({ ...reviewInput, submittedBy: scope.actorUserId, submittedAt: createdAt });
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`motion-plan:${scope.storyId}`}))`);
      await assertScope(tx, scope, true);
      const rows = await tx.select().from(schema.aiStoryMotionPlanVersions)
        .where(and(eq(schema.aiStoryMotionPlanVersions.storyId, scope.storyId), eq(schema.aiStoryMotionPlanVersions.workspaceId, scope.workspaceId)))
        .orderBy(asc(schema.aiStoryMotionPlanVersions.version)).for("update");
      const projected = rows.filter((row) => row.contractVersion === "ai-story-motion-plan.episode-projected.v1");
      const activeRow = [...projected].reverse().find((row) => row.status === "FROZEN");
      if (!activeRow) throw new AiStorySuccessorMotionError("SUCCESSOR_MOTION_BASE_MISSING", "No active projected Motion authority exists");
      const active = parse(activeRow);
      if (review.baseMotionPlanId !== active.motionPlanId) throw new AiStorySuccessorMotionError("SUCCESSOR_MOTION_BASE_CONFLICT", "The active Motion authority changed; reload before proposing");
      const existingPending = [...projected].reverse().find((row) => ["DRAFT", "VALIDATED", "APPROVED"].includes(row.status));
      if (existingPending) {
        const pending = parse(existingPending);
        if (pending.successorReview && JSON.stringify(pending.successorReview) === JSON.stringify(review)) return pending;
        throw new AiStorySuccessorMotionError("SUCCESSOR_MOTION_PENDING_EXISTS", "A pending Successor Motion revision already exists");
      }
      let plan: AiStoryEpisodeProjectedMotionPlan;
      try {
        plan = buildSuccessorProjectedMotionPlan({ base: active, review, version: (rows.at(-1)?.version ?? 0) + 1, createdBy: scope.actorUserId, createdAt });
      } catch (error) {
        throw new AiStorySuccessorMotionError("SUCCESSOR_MOTION_REVIEW_BLOCKED", error instanceof Error ? error.message : "Successor Motion review is invalid");
      }
      await tx.insert(schema.aiStoryMotionPlanVersions).values({
        motionPlanId: plan.motionPlanId, orgId: plan.orgId, workspaceId: plan.workspaceId, campaignId: plan.campaignId,
        storyId: plan.storyId, storyVersionId: plan.storyVersionId, outlineVersionId: plan.outlineVersionId, scriptVersionId: plan.scriptVersionId,
        handoffId: plan.handoffId, directorPlanId: plan.directorPlanId, version: plan.version, contractVersion: plan.contractVersion,
        sourceDirectorFingerprint: plan.sourceDirectorFingerprint, sourceHash: plan.sourceHash, motionFingerprint: plan.motionFingerprint,
        status: "DRAFT", supersedesMotionPlanId: active.motionPlanId, motionPlan: plan, createdBy: scope.actorUserId, createdAt: new Date(createdAt),
      });
      return plan;
    });
  }

  async transition(scope: AiStoryScriptScope, motionPlanId: string, to: "VALIDATED" | "APPROVED" | "FROZEN", at = new Date().toISOString()) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`motion-plan:${scope.storyId}`}))`);
      await assertScope(tx, scope, true);
      const rows = await tx.select().from(schema.aiStoryMotionPlanVersions)
        .where(and(eq(schema.aiStoryMotionPlanVersions.motionPlanId, motionPlanId), eq(schema.aiStoryMotionPlanVersions.storyId, scope.storyId), eq(schema.aiStoryMotionPlanVersions.workspaceId, scope.workspaceId)))
        .limit(1).for("update");
      if (!rows[0]) throw new AiStorySuccessorMotionError("SUCCESSOR_MOTION_NOT_FOUND", "Successor Motion revision was not found");
      const current = parse(rows[0]);
      const expected = to === "VALIDATED" ? "DRAFT" : to === "APPROVED" ? "VALIDATED" : "APPROVED";
      if (current.status !== expected) throw new AiStorySuccessorMotionError("SUCCESSOR_MOTION_TRANSITION_CONFLICT", `Expected ${expected}, found ${current.status}`);
      if (!current.successorReview) throw new AiStorySuccessorMotionError("SUCCESSOR_MOTION_REVIEW_MISSING", "Successor Motion revision has no human review facts");
      const baseRows = await tx.select().from(schema.aiStoryMotionPlanVersions)
        .where(eq(schema.aiStoryMotionPlanVersions.motionPlanId, current.supersedesMotionPlanId!)).limit(1).for("update");
      if (!baseRows[0] || baseRows[0].status !== "FROZEN") throw new AiStorySuccessorMotionError("SUCCESSOR_MOTION_BASE_CONFLICT", "Base Motion is no longer active");
      const base = parse(baseRows[0]);
      const issues = validateSuccessorMotionReview(base, current.successorReview);
      if (issues.length) throw new AiStorySuccessorMotionError("SUCCESSOR_MOTION_REVIEW_BLOCKED", JSON.stringify(issues));
      const next = AiStoryEpisodeProjectedMotionPlanSchema.parse({
        ...current,
        status: to,
        approvedBy: to === "APPROVED" || to === "FROZEN" ? current.approvedBy ?? scope.actorUserId : current.approvedBy,
        approvedAt: to === "APPROVED" || to === "FROZEN" ? current.approvedAt ?? at : current.approvedAt,
        frozenAt: to === "FROZEN" ? at : current.frozenAt,
      });
      if (to === "FROZEN") {
        await tx.update(schema.aiStoryMotionPlanVersions).set({ status: "SUPERSEDED" }).where(and(eq(schema.aiStoryMotionPlanVersions.motionPlanId, base.motionPlanId), eq(schema.aiStoryMotionPlanVersions.status, "FROZEN")));
      }
      await tx.update(schema.aiStoryMotionPlanVersions).set({
        status: to, motionPlan: next, approvedBy: next.approvedBy,
        approvedAt: next.approvedAt ? new Date(next.approvedAt) : null,
        frozenAt: next.frozenAt ? new Date(next.frozenAt) : null,
      }).where(and(eq(schema.aiStoryMotionPlanVersions.motionPlanId, motionPlanId), eq(schema.aiStoryMotionPlanVersions.status, expected)));
      return next;
    });
  }
}
