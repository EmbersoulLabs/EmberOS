import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AiStoryOutlineVersionSchema,
  assertAiStoryOutlineLifecycleTransition,
  validateAiStoryOutline,
  type AiStoryOutlineVersion,
} from "@ceo-agent/shared";
import { computeAiStoryOutlineSourceHash } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;
export type AiStoryOutlineScope = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  actorUserId: string;
};

export class AiStoryOutlineAuthorityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryOutlineAuthorityError";
  }
}

function parseRow(row: typeof schema.aiStoryOutlineVersions.$inferSelect) {
  return AiStoryOutlineVersionSchema.parse({
    ...row.outline,
    status: row.status,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    frozenAt: row.frozenAt?.toISOString() ?? null,
  });
}

async function assertScope(db: Pick<Db, "execute">, scope: AiStoryOutlineScope, mutation: boolean) {
  const rows = await db.execute<{ ok: boolean }>(sql`
    select exists(
      select 1 from ai_stories s
      join campaigns c on c.id=s.campaign_id
      join ai_story_versions v on v.story_id=s.id
      where s.id=${scope.storyId}::uuid
        and s.org_id=${scope.orgId}::uuid
        and s.workspace_id=${scope.workspaceId}::uuid
        and s.campaign_id=${scope.campaignId}::uuid
        and c.org_id=${scope.orgId}::uuid
        and c.workspace_id=${scope.workspaceId}::uuid
        and v.id=${scope.storyVersionId}::uuid
        and exists(
          select 1 from workspace_members wm
          where wm.workspace_id=${scope.workspaceId}::uuid
            and wm.user_id=${scope.actorUserId}::uuid
            and (${mutation} = false or wm.role in ('admin','operator','editor','reviewer'))
        )
    ) as ok
  `);
  if (!rows[0]?.ok) throw new AiStoryOutlineAuthorityError("OUTLINE_SCOPE_DENIED", "Outline authority scope does not resolve");
}

async function resolveKnownAuthorityReferences(db: Pick<Db, "select">, scope: AiStoryOutlineScope, outline: AiStoryOutlineVersion) {
  const references = [...outline.authorityReferences, ...outline.beats.flatMap((beat) => beat.authorityReferences), ...outline.requiredSceneOutcomes.flatMap((outcome) => outcome.authorityReferences)];
  const known = new Set<string>([`CAMPAIGN:${scope.campaignId}`]);
  for (const ref of references.filter((item) => item.authorityType === "CHARACTER" || item.authorityType === "WORLD")) {
    // No durable Character/World authority exists yet; preserve the stable reference without creating a parallel owner.
    known.add(`${ref.authorityType}:${ref.authorityId}`);
  }
  const assetIds = [...new Set(references.filter((item) => item.authorityType === "ASSET" || item.authorityType === "PRODUCT").map((item) => item.authorityId))];
  if (assetIds.length) {
    const assets = await db.select({ id: schema.assets.id }).from(schema.assets).where(and(
      inArray(schema.assets.id, assetIds), eq(schema.assets.orgId, scope.orgId),
      eq(schema.assets.workspaceId, scope.workspaceId), isNull(schema.assets.deletedAt),
    ));
    for (const asset of assets) {
      known.add(`ASSET:${asset.id}`);
      known.add(`PRODUCT:${asset.id}`);
    }
  }
  return known;
}

export class AiStoryOutlineAuthorityService {
  constructor(private readonly db: Db = getDb()) {}

  async propose(scope: AiStoryOutlineScope, outline: AiStoryOutlineVersion) {
    const parsed = AiStoryOutlineVersionSchema.parse(outline);
    if (parsed.status !== "DRAFT") throw new AiStoryOutlineAuthorityError("OUTLINE_PROPOSAL_NOT_DRAFT", "New Outline must be DRAFT");
    if (parsed.orgId !== scope.orgId || parsed.workspaceId !== scope.workspaceId || parsed.storyId !== scope.storyId || parsed.storyVersionId !== scope.storyVersionId || parsed.createdBy !== scope.actorUserId) {
      throw new AiStoryOutlineAuthorityError("OUTLINE_SCOPE_DENIED", "Outline identity does not match scope");
    }
    if (computeAiStoryOutlineSourceHash(parsed) !== parsed.sourceHash) {
      throw new AiStoryOutlineAuthorityError("OUTLINE_SOURCE_HASH_INVALID", "Outline source fingerprint does not match its canonical authority content");
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`outline:${scope.storyId}`}))`);
      await assertScope(tx, scope, true);
      const existing = await tx.select().from(schema.aiStoryOutlineVersions)
        .where(eq(schema.aiStoryOutlineVersions.outlineVersionId, parsed.outlineVersionId)).limit(1);
      if (existing[0]) {
        const value = parseRow(existing[0]);
        if (value.sourceHash !== parsed.sourceHash) throw new AiStoryOutlineAuthorityError("OUTLINE_IDENTITY_CONFLICT", "Outline identity conflict");
        return value;
      }
      const latestRows = await tx.select().from(schema.aiStoryOutlineVersions)
        .where(eq(schema.aiStoryOutlineVersions.storyId, scope.storyId))
        .orderBy(sql`${schema.aiStoryOutlineVersions.version} desc`).limit(1).for("update");
      const latest = latestRows[0];
      if ((!latest && (parsed.version !== 1 || parsed.supersedesOutlineVersionId !== null)) ||
          (latest && (parsed.version !== latest.version + 1 || parsed.supersedesOutlineVersionId !== latest.outlineVersionId))) {
        throw new AiStoryOutlineAuthorityError("OUTLINE_VERSION_LINEAGE_INVALID", "Outline version must extend the latest durable Outline exactly once");
      }
      if (parsed.supersedesOutlineVersionId) {
        const prior = await tx.select().from(schema.aiStoryOutlineVersions).where(and(
          eq(schema.aiStoryOutlineVersions.outlineVersionId, parsed.supersedesOutlineVersionId),
          eq(schema.aiStoryOutlineVersions.storyId, scope.storyId),
        )).for("update");
        if (prior.length !== 1 || prior[0]!.status !== "FROZEN") throw new AiStoryOutlineAuthorityError("OUTLINE_SUPERSESSION_INVALID", "Only a frozen Outline in the same Story may be superseded");
        await tx.update(schema.aiStoryOutlineVersions).set({ status: "SUPERSEDED", outline: { ...parseRow(prior[0]!), status: "SUPERSEDED" } }).where(eq(schema.aiStoryOutlineVersions.outlineVersionId, prior[0]!.outlineVersionId));
      }
      await tx.insert(schema.aiStoryOutlineVersions).values({
        outlineVersionId: parsed.outlineVersionId, orgId: parsed.orgId, workspaceId: parsed.workspaceId,
        campaignId: scope.campaignId, storyId: parsed.storyId, storyVersionId: parsed.storyVersionId,
        version: parsed.version, contractVersion: parsed.contractVersion, profileId: parsed.profile.profileId,
        profileVersion: parsed.profile.profileVersion, sourceHash: parsed.sourceHash, status: parsed.status,
        supersedesOutlineVersionId: parsed.supersedesOutlineVersionId, outline: parsed, createdBy: parsed.createdBy,
        createdAt: new Date(parsed.createdAt), approvedBy: null, approvedAt: null, frozenAt: null,
      });
      return parsed;
    });
  }

  async history(scope: AiStoryOutlineScope) {
    await assertScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryOutlineVersions).where(and(
      eq(schema.aiStoryOutlineVersions.orgId, scope.orgId), eq(schema.aiStoryOutlineVersions.workspaceId, scope.workspaceId),
      eq(schema.aiStoryOutlineVersions.storyId, scope.storyId),
    )).orderBy(asc(schema.aiStoryOutlineVersions.version));
    return rows.map(parseRow);
  }

  async validate(scope: AiStoryOutlineScope, outlineVersionId: string) {
    return this.transition(scope, outlineVersionId, "VALIDATED", null);
  }

  async approve(scope: AiStoryOutlineScope, outlineVersionId: string) {
    return this.transition(scope, outlineVersionId, "APPROVED", scope.actorUserId);
  }

  async freeze(scope: AiStoryOutlineScope, outlineVersionId: string) {
    return this.transition(scope, outlineVersionId, "FROZEN", scope.actorUserId);
  }

  private async transition(scope: AiStoryOutlineScope, outlineVersionId: string, to: "VALIDATED" | "APPROVED" | "FROZEN", actorUserId: string | null) {
    return this.db.transaction(async (tx) => {
      await assertScope(tx, scope, true);
      const rows = await tx.select().from(schema.aiStoryOutlineVersions).where(and(
        eq(schema.aiStoryOutlineVersions.outlineVersionId, outlineVersionId),
        eq(schema.aiStoryOutlineVersions.orgId, scope.orgId), eq(schema.aiStoryOutlineVersions.workspaceId, scope.workspaceId),
        eq(schema.aiStoryOutlineVersions.storyId, scope.storyId),
      )).for("update");
      if (rows.length !== 1) throw new AiStoryOutlineAuthorityError("OUTLINE_NOT_FOUND", "Outline not found in authority scope");
      const current = parseRow(rows[0]!);
      assertAiStoryOutlineLifecycleTransition(current.status, to);
      if (to === "VALIDATED") {
        const knownAuthorityReferences = await resolveKnownAuthorityReferences(tx, scope, current);
        const issues = validateAiStoryOutline(current, { knownAuthorityReferences });
        if (issues.length) throw new AiStoryOutlineAuthorityError("OUTLINE_VALIDATION_FAILED", JSON.stringify(issues));
      }
      const now = new Date();
      const next = AiStoryOutlineVersionSchema.parse({
        ...current, status: to,
        approvedBy: to === "APPROVED" ? actorUserId : current.approvedBy,
        approvedAt: to === "APPROVED" ? now.toISOString() : current.approvedAt,
        frozenAt: to === "FROZEN" ? now.toISOString() : current.frozenAt,
      });
      await tx.update(schema.aiStoryOutlineVersions).set({
        status: next.status, outline: next, approvedBy: next.approvedBy,
        approvedAt: next.approvedAt ? new Date(next.approvedAt) : null,
        frozenAt: next.frozenAt ? new Date(next.frozenAt) : null,
      }).where(eq(schema.aiStoryOutlineVersions.outlineVersionId, outlineVersionId));
      return next;
    });
  }
}
