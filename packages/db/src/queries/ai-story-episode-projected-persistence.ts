import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { AiStoryScriptDirectorHandoffSchema } from "@ceo-agent/shared";
import {
  AiStoryEpisodeProjectedDirectorPlanSchema,
  AiStoryEpisodeProjectedMotionPlanSchema,
  EpisodeProjectedAuthorityError,
  type AiStoryEpisodeProjectedDirectorPlan,
  type AiStoryEpisodeProjectedMotionPlan,
  type EpisodeProjectedAuthoritySource,
} from "@ceo-agent/shared";
import { buildEpisodeProjectedDirectorPlan, buildEpisodeProjectedMotionPlan } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { aiStoryActorScopePredicate } from "./ai-story-actor-scope";
import type { AiStoryScriptScope } from "./ai-story-script";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function assertScope(db: Pick<Db, "execute">, scope: AiStoryScriptScope) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(select 1 from ai_stories s join campaigns c on c.id=s.campaign_id join ai_story_versions v on v.story_id=s.id where s.id=${scope.storyId}::uuid and s.org_id=${scope.orgId}::uuid and s.workspace_id=${scope.workspaceId}::uuid and s.campaign_id=${scope.campaignId}::uuid and c.org_id=${scope.orgId}::uuid and c.workspace_id=${scope.workspaceId}::uuid and v.id=${scope.storyVersionId}::uuid and ${aiStoryActorScopePredicate(scope,true)}) as ok`);
  if (!rows[0]?.ok) throw new EpisodeProjectedAuthorityError("EPISODE_DISPATCH_SOURCE_MISSING", "Projected authority scope does not resolve");
}

/**
 * A FROZEN projected plan can only be succeeded when every FROZEN plan for the
 * Story Version is bound to an Animation Package that a human-authorized
 * successor revision has already SUPERSEDED, and the requested source package is
 * itself still current. Otherwise the frozen authority stands.
 */
export async function resolveSupersededFrozenPlanId(
  tx: Pick<Tx, "select">,
  scope: AiStoryScriptScope,
  frozen: readonly { planId: string; version: number; animationPackageId: unknown }[],
  sourceAnimationPackageId: string,
  kind: "Director" | "Motion",
): Promise<string> {
  const packageIds = [...new Set(frozen.map((row) => String(row.animationPackageId ?? "")))];
  const rows = await tx.select({ id: schema.aiStoryAnimationPackages.id, status: schema.aiStoryAnimationPackages.status })
    .from(schema.aiStoryAnimationPackages)
    .where(and(
      eq(schema.aiStoryAnimationPackages.workspaceId, scope.workspaceId),
      eq(schema.aiStoryAnimationPackages.storyId, scope.storyId),
      eq(schema.aiStoryAnimationPackages.storyVersionId, scope.storyVersionId),
      inArray(schema.aiStoryAnimationPackages.id, [...packageIds.filter(Boolean), sourceAnimationPackageId]),
    ));
  const statusById = new Map(rows.map((row) => [row.id, row.status]));
  const sourceStatus = statusById.get(sourceAnimationPackageId);
  const frozenBindingsSuperseded = packageIds.every((id) => !!id && id !== sourceAnimationPackageId && statusById.get(id) === "superseded");
  if (!sourceStatus || sourceStatus === "superseded" || !frozenBindingsSuperseded) {
    throw new EpisodeProjectedAuthorityError("EPISODE_PROJECTED_AUTHORITY_CONFLICT", `Frozen ${kind} authority does not match the Episode projection`);
  }
  return [...frozen].sort((a, b) => b.version - a.version)[0]!.planId;
}

function withLifecycle<T extends { status: string; approvedBy: string | null; approvedAt: string | null; frozenAt: string | null }>(
  plan: T,
  status: "VALIDATED" | "APPROVED" | "FROZEN",
  actorUserId: string,
  at: string,
): T {
  return {
    ...plan,
    status,
    approvedBy: status === "APPROVED" || status === "FROZEN" ? actorUserId : plan.approvedBy,
    approvedAt: status === "APPROVED" || status === "FROZEN" ? plan.approvedAt ?? at : plan.approvedAt,
    frozenAt: status === "FROZEN" ? at : plan.frozenAt,
  };
}

export async function persistEpisodeProjectedDirector(
  db: Db,
  scope: AiStoryScriptScope,
  source: EpisodeProjectedAuthoritySource,
  createdAt = new Date().toISOString(),
  targetStatus: "VALIDATED" | "FROZEN" = "FROZEN",
): Promise<AiStoryEpisodeProjectedDirectorPlan> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`director-plan:${scope.storyId}`}))`);
    await assertScope(tx, scope);
    const handoffRows = await tx.select().from(schema.aiStoryScriptDirectorHandoffs).where(and(
      eq(schema.aiStoryScriptDirectorHandoffs.storyId, scope.storyId),
      eq(schema.aiStoryScriptDirectorHandoffs.workspaceId, scope.workspaceId),
      eq(schema.aiStoryScriptDirectorHandoffs.storyVersionId, scope.storyVersionId),
      eq(schema.aiStoryScriptDirectorHandoffs.authorityStatus, "CURRENT"),
    )).limit(1).for("share");
    if (!handoffRows[0]) throw new EpisodeProjectedAuthorityError("EPISODE_DISPATCH_SOURCE_MISSING", "Projected Director requires the current Handoff");
    const handoff = AiStoryScriptDirectorHandoffSchema.parse(handoffRows[0].handoff);
    if (handoff.storyVersionId !== scope.storyVersionId || handoff.scriptVersionId !== handoffRows[0].scriptVersionId) {
      throw new EpisodeProjectedAuthorityError("EPISODE_PROJECTED_AUTHORITY_CONFLICT", "Current Handoff is not pinned to the requested Story Version");
    }
    const existing = await tx.select().from(schema.aiStoryDirectorPlanVersions).where(eq(schema.aiStoryDirectorPlanVersions.storyId, scope.storyId)).orderBy(asc(schema.aiStoryDirectorPlanVersions.version)).for("update");
    const buildDraft = (supersedesDirectorPlanId: string | null) => buildEpisodeProjectedDirectorPlan({
      lineage: {
        orgId: scope.orgId,
        workspaceId: scope.workspaceId,
        campaignId: scope.campaignId,
        storyId: scope.storyId,
        storyVersionId: scope.storyVersionId,
        outlineVersionId: handoff.outlineVersionId,
        scriptVersionId: handoff.scriptVersionId,
        handoffId: handoff.handoffId,
        sourceHandoffFingerprint: handoff.handoffFingerprint,
        animationPackageId: source.animationPackageId,
      },
      source,
      version: (existing.at(-1)?.version ?? 0) + 1,
      supersedesDirectorPlanId,
      createdBy: scope.actorUserId,
      createdAt,
    });
    const draft = buildDraft(null);
    const same = existing.find((row) => row.sourceHash === draft.sourceHash);
    if (same) return advanceDirector(tx, scope, AiStoryEpisodeProjectedDirectorPlanSchema.parse({ ...same.directorPlan, status: same.status, approvedBy: same.approvedBy, approvedAt: same.approvedAt?.toISOString() ?? null, frozenAt: same.frozenAt?.toISOString() ?? null }), createdAt, targetStatus);
    const frozen = existing.filter((row) => row.storyVersionId === scope.storyVersionId && row.status === "FROZEN");
    const supersedesDirectorPlanId = frozen.length === 0 ? null : await resolveSupersededFrozenPlanId(
      tx,
      scope,
      frozen.map((row) => ({ planId: row.directorPlanId, version: row.version, animationPackageId: (row.directorPlan as { animationPackageId?: unknown }).animationPackageId })),
      source.animationPackageId,
      "Director",
    );
    const plan = buildDraft(supersedesDirectorPlanId);
    await tx.insert(schema.aiStoryDirectorPlanVersions).values({
      directorPlanId: plan.directorPlanId, orgId: plan.orgId, workspaceId: plan.workspaceId, campaignId: plan.campaignId,
      storyId: plan.storyId, storyVersionId: plan.storyVersionId, outlineVersionId: plan.outlineVersionId, scriptVersionId: plan.scriptVersionId,
      handoffId: plan.handoffId, version: plan.version, contractVersion: plan.contractVersion, sourceHandoffFingerprint: plan.sourceHandoffFingerprint,
      sourceHash: plan.sourceHash, directorFingerprint: plan.directorFingerprint, status: "DRAFT", supersedesDirectorPlanId: plan.supersedesDirectorPlanId,
      directorPlan: plan, createdBy: plan.createdBy, createdAt: new Date(plan.createdAt),
    });
    return advanceDirector(tx, scope, plan, createdAt, targetStatus);
  });
}

function lifecycleRank(status: string) {
  return ["DRAFT", "VALIDATED", "APPROVED", "FROZEN"].indexOf(status);
}

async function advanceDirector(tx: Tx, scope: AiStoryScriptScope, plan: AiStoryEpisodeProjectedDirectorPlan, at: string, targetStatus: "VALIDATED" | "FROZEN") {
  let current = plan;
  for (const status of ["VALIDATED", "APPROVED", "FROZEN"] as const) {
    if (current.status === "FROZEN") return current;
    if (lifecycleRank(current.status) >= lifecycleRank(status)) continue;
    if (lifecycleRank(status) > lifecycleRank(targetStatus)) break;
    const next = AiStoryEpisodeProjectedDirectorPlanSchema.parse(withLifecycle(current, status, scope.actorUserId, at));
    if (status === "FROZEN" && next.supersedesDirectorPlanId) {
      await tx.update(schema.aiStoryDirectorPlanVersions).set({ status: "SUPERSEDED" }).where(and(
        eq(schema.aiStoryDirectorPlanVersions.directorPlanId, next.supersedesDirectorPlanId),
        eq(schema.aiStoryDirectorPlanVersions.workspaceId, scope.workspaceId),
        eq(schema.aiStoryDirectorPlanVersions.storyVersionId, scope.storyVersionId),
        eq(schema.aiStoryDirectorPlanVersions.status, "FROZEN"),
      ));
    }
    await tx.update(schema.aiStoryDirectorPlanVersions).set({
      status,
      directorPlan: next,
      approvedBy: next.approvedBy,
      approvedAt: next.approvedAt ? new Date(next.approvedAt) : null,
      frozenAt: next.frozenAt ? new Date(next.frozenAt) : null,
    }).where(eq(schema.aiStoryDirectorPlanVersions.directorPlanId, next.directorPlanId));
    current = next;
  }
  return current;
}

export async function persistEpisodeProjectedMotion(
  db: Db,
  scope: AiStoryScriptScope,
  source: EpisodeProjectedAuthoritySource,
  directorPlanId: string,
  createdAt = new Date().toISOString(),
  targetStatus: "VALIDATED" | "FROZEN" = "FROZEN",
): Promise<AiStoryEpisodeProjectedMotionPlan> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`motion-plan:${scope.storyId}`}))`);
    await assertScope(tx, scope);
    const directors = await tx.select().from(schema.aiStoryDirectorPlanVersions).where(and(
      eq(schema.aiStoryDirectorPlanVersions.directorPlanId, directorPlanId),
      eq(schema.aiStoryDirectorPlanVersions.workspaceId, scope.workspaceId),
      eq(schema.aiStoryDirectorPlanVersions.storyVersionId, scope.storyVersionId),
      sql`${schema.aiStoryDirectorPlanVersions.status} in ('VALIDATED', 'FROZEN')`,
    )).limit(1).for("share");
    if (!directors[0]) throw new EpisodeProjectedAuthorityError("EPISODE_DISPATCH_SOURCE_MISSING", "Projected Motion requires the frozen projected Director");
    const director = AiStoryEpisodeProjectedDirectorPlanSchema.parse({ ...directors[0].directorPlan, status: directors[0].status, approvedBy: directors[0].approvedBy, approvedAt: directors[0].approvedAt?.toISOString() ?? null, frozenAt: directors[0].frozenAt?.toISOString() ?? null });
    const existing = await tx.select().from(schema.aiStoryMotionPlanVersions).where(eq(schema.aiStoryMotionPlanVersions.storyId, scope.storyId)).orderBy(asc(schema.aiStoryMotionPlanVersions.version)).for("update");
    const buildDraft = (supersedesMotionPlanId: string | null) => buildEpisodeProjectedMotionPlan({ directorPlan: director, source, version: (existing.at(-1)?.version ?? 0) + 1, supersedesMotionPlanId, createdBy: scope.actorUserId, createdAt });
    const same = existing.find((row) => row.sourceHash === buildDraft(null).sourceHash);
    if (same) return advanceMotion(tx, scope, AiStoryEpisodeProjectedMotionPlanSchema.parse({ ...same.motionPlan, status: same.status, approvedBy: same.approvedBy, approvedAt: same.approvedAt?.toISOString() ?? null, frozenAt: same.frozenAt?.toISOString() ?? null }), createdAt, targetStatus);
    const frozen = existing.filter((row) => row.storyVersionId === scope.storyVersionId && row.status === "FROZEN");
    const supersedesMotionPlanId = frozen.length === 0 ? null : await resolveSupersededFrozenPlanId(
      tx,
      scope,
      frozen.map((row) => ({ planId: row.motionPlanId, version: row.version, animationPackageId: (row.motionPlan as { animationPackageId?: unknown }).animationPackageId })),
      source.animationPackageId,
      "Motion",
    );
    const draft = buildDraft(supersedesMotionPlanId);
    await tx.insert(schema.aiStoryMotionPlanVersions).values({
      motionPlanId: draft.motionPlanId, orgId: draft.orgId, workspaceId: draft.workspaceId, campaignId: draft.campaignId,
      storyId: draft.storyId, storyVersionId: draft.storyVersionId, outlineVersionId: draft.outlineVersionId, scriptVersionId: draft.scriptVersionId,
      handoffId: draft.handoffId, directorPlanId: draft.directorPlanId, version: draft.version, contractVersion: draft.contractVersion,
      sourceDirectorFingerprint: draft.sourceDirectorFingerprint, sourceHash: draft.sourceHash, motionFingerprint: draft.motionFingerprint,
      status: "DRAFT", supersedesMotionPlanId: draft.supersedesMotionPlanId, motionPlan: draft, createdBy: draft.createdBy, createdAt: new Date(draft.createdAt),
    });
    return advanceMotion(tx, scope, draft, createdAt, targetStatus);
  });
}

async function advanceMotion(tx: Tx, scope: AiStoryScriptScope, plan: AiStoryEpisodeProjectedMotionPlan, at: string, targetStatus: "VALIDATED" | "FROZEN") {
  let current = plan;
  for (const status of ["VALIDATED", "APPROVED", "FROZEN"] as const) {
    if (current.status === "FROZEN") return current;
    if (lifecycleRank(current.status) >= lifecycleRank(status)) continue;
    if (lifecycleRank(status) > lifecycleRank(targetStatus)) break;
    const next = AiStoryEpisodeProjectedMotionPlanSchema.parse(withLifecycle(current, status, scope.actorUserId, at));
    if (status === "FROZEN" && next.supersedesMotionPlanId) {
      await tx.update(schema.aiStoryMotionPlanVersions).set({ status: "SUPERSEDED" }).where(and(
        eq(schema.aiStoryMotionPlanVersions.motionPlanId, next.supersedesMotionPlanId),
        eq(schema.aiStoryMotionPlanVersions.workspaceId, scope.workspaceId),
        eq(schema.aiStoryMotionPlanVersions.storyVersionId, scope.storyVersionId),
        eq(schema.aiStoryMotionPlanVersions.status, "FROZEN"),
      ));
    }
    await tx.update(schema.aiStoryMotionPlanVersions).set({
      status,
      motionPlan: next,
      approvedBy: next.approvedBy,
      approvedAt: next.approvedAt ? new Date(next.approvedAt) : null,
      frozenAt: next.frozenAt ? new Date(next.frozenAt) : null,
    }).where(eq(schema.aiStoryMotionPlanVersions.motionPlanId, next.motionPlanId));
    current = next;
  }
  return current;
}
