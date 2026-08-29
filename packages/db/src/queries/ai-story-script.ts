import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AiStoryOutlineVersionSchema, AiStoryScriptVersionSchema, assertAiStoryScriptLifecycleTransition,
  validateAiStoryScript, type AiStoryScriptVersion,
} from "@ceo-agent/shared";
import { computeAiStoryScriptSourceHash, validateAiStoryProductStoryProfile } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;
export type AiStoryScriptScope = { orgId: string; workspaceId: string; campaignId: string; storyId: string; storyVersionId: string; actorUserId: string };

export class AiStoryScriptAuthorityError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "AiStoryScriptAuthorityError"; }
}

function parseRow(row: typeof schema.aiStoryScriptVersions.$inferSelect) {
  return AiStoryScriptVersionSchema.parse({ ...row.script, status: row.status, approvedBy: row.approvedBy, approvedAt: row.approvedAt?.toISOString() ?? null, frozenAt: row.frozenAt?.toISOString() ?? null });
}

async function assertScope(db: Pick<Db, "execute">, scope: AiStoryScriptScope, mutation: boolean) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(
    select 1 from ai_stories s join campaigns c on c.id=s.campaign_id join ai_story_versions v on v.story_id=s.id
    where s.id=${scope.storyId}::uuid and s.org_id=${scope.orgId}::uuid and s.workspace_id=${scope.workspaceId}::uuid
      and s.campaign_id=${scope.campaignId}::uuid and c.org_id=${scope.orgId}::uuid and c.workspace_id=${scope.workspaceId}::uuid
      and v.id=${scope.storyVersionId}::uuid and exists(select 1 from workspace_members wm where wm.workspace_id=${scope.workspaceId}::uuid
        and wm.user_id=${scope.actorUserId}::uuid and (${mutation}=false or wm.role in ('admin','operator','editor','reviewer')))
  ) as ok`);
  if (!rows[0]?.ok) throw new AiStoryScriptAuthorityError("SCRIPT_SCOPE_DENIED", "Script authority scope does not resolve");
}

async function resolveKnownReferences(db: Pick<Db, "select">, scope: AiStoryScriptScope, script: AiStoryScriptVersion) {
  const known = new Set<string>();
  for (const ref of script.authorityReferences.filter((ref) => ["CHARACTER", "LOCATION", "PROP"].includes(ref.authorityType))) {
    // These are upstream stable references; no durable Character/World owner exists yet.
    known.add(`${ref.authorityType}:${ref.authorityId}`);
  }
  const ids = [...new Set(script.authorityReferences.filter((ref) => ref.authorityType === "ASSET" || ref.authorityType === "PRODUCT").map((ref) => ref.authorityId))];
  if (ids.length) {
    const rows = await db.select({ id: schema.assets.id }).from(schema.assets).where(and(inArray(schema.assets.id, ids), eq(schema.assets.orgId, scope.orgId), eq(schema.assets.workspaceId, scope.workspaceId), isNull(schema.assets.deletedAt)));
    for (const row of rows) { known.add(`ASSET:${row.id}`); known.add(`PRODUCT:${row.id}`); }
  }
  return known;
}

export class AiStoryScriptAuthorityService {
  constructor(private readonly db: Db = getDb()) {}

  async propose(scope: AiStoryScriptScope, script: AiStoryScriptVersion) {
    const parsed = AiStoryScriptVersionSchema.parse(script);
    if (parsed.status !== "DRAFT") throw new AiStoryScriptAuthorityError("SCRIPT_PROPOSAL_NOT_DRAFT", "New Script must be DRAFT");
    if (parsed.orgId !== scope.orgId || parsed.workspaceId !== scope.workspaceId || parsed.storyId !== scope.storyId || parsed.storyVersionId !== scope.storyVersionId || parsed.createdBy !== scope.actorUserId) throw new AiStoryScriptAuthorityError("SCRIPT_SCOPE_DENIED", "Script identity does not match scope");
    if (computeAiStoryScriptSourceHash(parsed) !== parsed.sourceHash) throw new AiStoryScriptAuthorityError("SCRIPT_SOURCE_HASH_INVALID", "Script source fingerprint does not match canonical content");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`script:${scope.storyId}`}))`);
      await assertScope(tx, scope, true);
      const outlines = await tx.select().from(schema.aiStoryOutlineVersions).where(and(eq(schema.aiStoryOutlineVersions.outlineVersionId, parsed.outlineVersionId), eq(schema.aiStoryOutlineVersions.storyId, scope.storyId), eq(schema.aiStoryOutlineVersions.workspaceId, scope.workspaceId))).limit(1);
      if (outlines.length !== 1 || outlines[0]!.status !== "FROZEN" || outlines[0]!.sourceHash !== parsed.outlineSourceHash) throw new AiStoryScriptAuthorityError("SCRIPT_OUTLINE_LINEAGE_INVALID", "Canonical Script requires the exact frozen Outline authority");
      const existing = await tx.select().from(schema.aiStoryScriptVersions).where(eq(schema.aiStoryScriptVersions.scriptVersionId, parsed.scriptVersionId)).limit(1);
      if (existing[0]) { const value = parseRow(existing[0]); if (value.sourceHash !== parsed.sourceHash) throw new AiStoryScriptAuthorityError("SCRIPT_IDENTITY_CONFLICT", "Script identity conflict"); return value; }
      const latestRows = await tx.select().from(schema.aiStoryScriptVersions).where(eq(schema.aiStoryScriptVersions.storyId, scope.storyId)).orderBy(sql`${schema.aiStoryScriptVersions.version} desc`).limit(1).for("update");
      const latest = latestRows[0];
      if ((!latest && (parsed.version !== 1 || parsed.supersedesScriptVersionId !== null)) || (latest && (parsed.version !== latest.version + 1 || parsed.supersedesScriptVersionId !== latest.scriptVersionId))) throw new AiStoryScriptAuthorityError("SCRIPT_VERSION_LINEAGE_INVALID", "Script version must extend the latest durable Script exactly once");
      if (parsed.supersedesScriptVersionId) {
        const prior = await tx.select().from(schema.aiStoryScriptVersions).where(and(eq(schema.aiStoryScriptVersions.scriptVersionId, parsed.supersedesScriptVersionId), eq(schema.aiStoryScriptVersions.storyId, scope.storyId))).for("update");
        if (prior.length !== 1 || prior[0]!.status !== "FROZEN") throw new AiStoryScriptAuthorityError("SCRIPT_SUPERSESSION_INVALID", "Only a frozen Script in the same Story may be superseded");
        const priorScript = parseRow(prior[0]!);
        await tx.update(schema.aiStoryScriptVersions).set({ status: "SUPERSEDED", script: { ...priorScript, status: "SUPERSEDED" } }).where(eq(schema.aiStoryScriptVersions.scriptVersionId, priorScript.scriptVersionId));
      }
      await tx.insert(schema.aiStoryScriptVersions).values({
        scriptVersionId: parsed.scriptVersionId, orgId: parsed.orgId, workspaceId: parsed.workspaceId, campaignId: scope.campaignId,
        storyId: parsed.storyId, storyVersionId: parsed.storyVersionId, outlineVersionId: parsed.outlineVersionId,
        version: parsed.version, contractVersion: parsed.contractVersion, profileId: parsed.profileId, profileVersion: parsed.profileVersion,
        outlineSourceHash: parsed.outlineSourceHash, sourceHash: parsed.sourceHash, status: parsed.status,
        supersedesScriptVersionId: parsed.supersedesScriptVersionId, script: parsed, createdBy: parsed.createdBy, createdAt: new Date(parsed.createdAt),
        approvedBy: null, approvedAt: null, frozenAt: null,
      });
      return parsed;
    });
  }

  async read(scope: AiStoryScriptScope, scriptVersionId: string) {
    await assertScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryScriptVersions).where(and(eq(schema.aiStoryScriptVersions.scriptVersionId, scriptVersionId), eq(schema.aiStoryScriptVersions.orgId, scope.orgId), eq(schema.aiStoryScriptVersions.workspaceId, scope.workspaceId), eq(schema.aiStoryScriptVersions.storyId, scope.storyId))).limit(1);
    if (!rows[0]) throw new AiStoryScriptAuthorityError("SCRIPT_NOT_FOUND", "Script not found in authority scope");
    return parseRow(rows[0]);
  }

  async history(scope: AiStoryScriptScope) {
    await assertScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryScriptVersions).where(and(eq(schema.aiStoryScriptVersions.orgId, scope.orgId), eq(schema.aiStoryScriptVersions.workspaceId, scope.workspaceId), eq(schema.aiStoryScriptVersions.storyId, scope.storyId))).orderBy(asc(schema.aiStoryScriptVersions.version));
    return rows.map(parseRow);
  }

  async validate(scope: AiStoryScriptScope, id: string) { return this.transition(scope, id, "VALIDATED", null); }
  async approve(scope: AiStoryScriptScope, id: string) { return this.transition(scope, id, "APPROVED", scope.actorUserId); }
  async freeze(scope: AiStoryScriptScope, id: string) { return this.transition(scope, id, "FROZEN", scope.actorUserId); }

  private async transition(scope: AiStoryScriptScope, id: string, to: "VALIDATED" | "APPROVED" | "FROZEN", actor: string | null) {
    return this.db.transaction(async (tx) => {
      await assertScope(tx, scope, true);
      const rows = await tx.select().from(schema.aiStoryScriptVersions).where(and(eq(schema.aiStoryScriptVersions.scriptVersionId, id), eq(schema.aiStoryScriptVersions.orgId, scope.orgId), eq(schema.aiStoryScriptVersions.workspaceId, scope.workspaceId), eq(schema.aiStoryScriptVersions.storyId, scope.storyId))).for("update");
      if (rows.length !== 1) throw new AiStoryScriptAuthorityError("SCRIPT_NOT_FOUND", "Script not found in authority scope");
      const current = parseRow(rows[0]!); assertAiStoryScriptLifecycleTransition(current.status, to);
      if (to === "VALIDATED") {
        const outlineRows = await tx.select().from(schema.aiStoryOutlineVersions).where(eq(schema.aiStoryOutlineVersions.outlineVersionId, current.outlineVersionId)).limit(1);
        if (!outlineRows[0]) throw new AiStoryScriptAuthorityError("SCRIPT_OUTLINE_LINEAGE_INVALID", "Outline authority not found");
        const outline = AiStoryOutlineVersionSchema.parse({ ...outlineRows[0].outline, status: outlineRows[0].status, approvedBy: outlineRows[0].approvedBy, approvedAt: outlineRows[0].approvedAt?.toISOString() ?? null, frozenAt: outlineRows[0].frozenAt?.toISOString() ?? null });
        const issues = validateAiStoryScript(current, outline, { knownAuthorityReferences: await resolveKnownReferences(tx, scope, current) });
        const profileIssues = validateAiStoryProductStoryProfile(outline, current);
        if (issues.some((issue) => issue.severity === "BLOCK") || profileIssues.some((issue) => issue.severity === "BLOCK")) throw new AiStoryScriptAuthorityError("SCRIPT_VALIDATION_FAILED", JSON.stringify([...issues, ...profileIssues]));
      }
      const now = new Date();
      const next = AiStoryScriptVersionSchema.parse({ ...current, status: to, approvedBy: to === "APPROVED" ? actor : current.approvedBy, approvedAt: to === "APPROVED" ? now.toISOString() : current.approvedAt, frozenAt: to === "FROZEN" ? now.toISOString() : current.frozenAt });
      await tx.update(schema.aiStoryScriptVersions).set({ status: next.status, script: next, approvedBy: next.approvedBy, approvedAt: next.approvedAt ? new Date(next.approvedAt) : null, frozenAt: next.frozenAt ? new Date(next.frozenAt) : null }).where(eq(schema.aiStoryScriptVersions.scriptVersionId, id));
      return next;
    });
  }
}
