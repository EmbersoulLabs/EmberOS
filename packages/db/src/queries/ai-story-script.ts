import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AiStoryOutlineVersionSchema, AiStoryScriptVersionSchema, assertAiStoryScriptLifecycleTransition,
  validateAiStoryScript, type AiStoryScriptVersion,
} from "@ceo-agent/shared";
import { computeAiStoryOutlineSourceHash, computeAiStoryScriptSourceHash, validateAiStoryProductStoryProfile } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { resolveKnownCastReferences } from "./ai-story-cast";
import { resolveCurrentFrozenOutlineForStoryVersion } from "./ai-story-outline";

type Db = ReturnType<typeof getDb>;
export type AiStoryScriptScope = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  actorUserId: string;
  /** Runtime producers set this so every lifecycle mutation rechecks current frozen Story authority. */
  requireCurrentFrozenStoryVersion?: boolean;
};

export class AiStoryScriptAuthorityError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "AiStoryScriptAuthorityError"; }
}

function parseRow(row: typeof schema.aiStoryScriptVersions.$inferSelect) {
  return AiStoryScriptVersionSchema.parse({ ...row.script, status: row.status, approvedBy: row.approvedBy, approvedAt: row.approvedAt?.toISOString() ?? null, frozenAt: row.frozenAt?.toISOString() ?? null });
}

export type CurrentFrozenScriptScope = Omit<AiStoryScriptScope, "actorUserId" | "requireCurrentFrozenStoryVersion">;

export type CurrentFrozenScriptDependencies = {
  resolveCurrentOutline: (db: Db, scope: CurrentFrozenScriptScope) => Promise<import("@ceo-agent/shared").AiStoryOutlineVersion | null>;
  loadFrozenRows: (db: Db, scope: CurrentFrozenScriptScope) => Promise<(typeof schema.aiStoryScriptVersions.$inferSelect)[]>;
};

async function loadFrozenRows(db: Db, scope: CurrentFrozenScriptScope) {
  return db.select().from(schema.aiStoryScriptVersions).where(and(
    eq(schema.aiStoryScriptVersions.orgId, scope.orgId),
    eq(schema.aiStoryScriptVersions.workspaceId, scope.workspaceId),
    eq(schema.aiStoryScriptVersions.campaignId, scope.campaignId),
    eq(schema.aiStoryScriptVersions.storyId, scope.storyId),
    eq(schema.aiStoryScriptVersions.storyVersionId, scope.storyVersionId),
    eq(schema.aiStoryScriptVersions.status, "FROZEN"),
  ));
}

const currentFrozenScriptDependencies: CurrentFrozenScriptDependencies = {
  resolveCurrentOutline: (db, scope) => resolveCurrentFrozenOutlineForStoryVersion(db, scope),
  loadFrozenRows,
};

/** SELECT-only exact current-FROZEN Script resolution. No ordering selects authority. */
export async function resolveCurrentFrozenScriptForStoryVersion(
  db: Db,
  scope: CurrentFrozenScriptScope,
  dependencies: CurrentFrozenScriptDependencies = currentFrozenScriptDependencies,
) {
  const outline = await dependencies.resolveCurrentOutline(db, scope);
  if (!outline) throw new AiStoryScriptAuthorityError("CURRENT_FROZEN_OUTLINE_REQUIRED", "Script resolution requires the exact current frozen Outline");
  const rows = await dependencies.loadFrozenRows(db, scope);
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new AiStoryScriptAuthorityError("CURRENT_FROZEN_SCRIPT_AMBIGUOUS", "More than one FROZEN Script claims authority for the current Story Version");
  const row = rows[0]!;
  if (row.script.status !== row.status || row.sourceHash !== row.script.sourceHash) {
    throw new AiStoryScriptAuthorityError("SCRIPT_ROW_PAYLOAD_MISMATCH", "Script row and payload authority disagree");
  }
  const script = parseRow(row);
  if (
    script.status !== "FROZEN" || script.orgId !== scope.orgId || script.workspaceId !== scope.workspaceId ||
    script.storyId !== scope.storyId || script.storyVersionId !== scope.storyVersionId ||
    script.outlineVersionId !== outline.outlineVersionId || script.outlineSourceHash !== outline.sourceHash ||
    script.profileId !== outline.profile.profileId || script.profileVersion !== outline.profile.profileVersion ||
    !script.approvedBy || !script.approvedAt || !script.frozenAt
  ) {
    throw new AiStoryScriptAuthorityError("CURRENT_FROZEN_SCRIPT_INVALID", "FROZEN Script identity, lifecycle, or Outline lineage is invalid");
  }
  if (computeAiStoryScriptSourceHash(script) !== script.sourceHash) {
    throw new AiStoryScriptAuthorityError("SCRIPT_SOURCE_HASH_INVALID", "Script source fingerprint is invalid");
  }
  return script;
}

async function assertScope(db: Pick<Db, "execute">, scope: AiStoryScriptScope, mutation: boolean) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(
    select 1 from ai_stories s join campaigns c on c.id=s.campaign_id join ai_story_versions v on v.story_id=s.id
    where s.id=${scope.storyId}::uuid and s.org_id=${scope.orgId}::uuid and s.workspace_id=${scope.workspaceId}::uuid
      and s.campaign_id=${scope.campaignId}::uuid and c.org_id=${scope.orgId}::uuid and c.workspace_id=${scope.workspaceId}::uuid
      and v.id=${scope.storyVersionId}::uuid
      and (${!scope.requireCurrentFrozenStoryVersion}=true or (s.current_version_id=v.id and v.frozen_at is not null))
      and exists(select 1 from workspace_members wm where wm.workspace_id=${scope.workspaceId}::uuid
        and wm.user_id=${scope.actorUserId}::uuid and (${mutation}=false or wm.role in ('admin','operator','editor','reviewer')))
  ) as ok`);
  if (!rows[0]?.ok) throw new AiStoryScriptAuthorityError("SCRIPT_SCOPE_DENIED", "Script authority scope does not resolve");
}

async function resolveKnownReferences(db: Pick<Db, "select">, scope: AiStoryScriptScope, script: AiStoryScriptVersion) {
  const known = new Set<string>();
  const castKnown = await resolveKnownCastReferences(db, scope, script.scenes.flatMap((scene) => scene.castReferences ?? []));
  for (const key of castKnown) known.add(key);
  const characterRefs = script.authorityReferences.filter((ref) => ref.authorityType === "CHARACTER");
  const characterVersionIds = characterRefs.flatMap((ref) => ref.authorityVersionId ? [ref.authorityVersionId] : []);
  if (characterVersionIds.length) {
    const rows = await db.select().from(schema.aiStoryCharacterVersions).where(and(
      inArray(schema.aiStoryCharacterVersions.characterVersionId, characterVersionIds),
      eq(schema.aiStoryCharacterVersions.orgId, scope.orgId), eq(schema.aiStoryCharacterVersions.workspaceId, scope.workspaceId),
      eq(schema.aiStoryCharacterVersions.campaignId, scope.campaignId),
    ));
    for (const row of rows) {
      const ref = characterRefs.find((item) => item.authorityId === row.characterId && item.authorityVersionId === row.characterVersionId);
      if (ref?.authorityFingerprint === row.fingerprint) known.add(`CHARACTER:${ref.authorityId}`);
    }
  }
  const locationRefs = script.authorityReferences.filter((ref) => ref.authorityType === "LOCATION");
  const locationVersionIds = locationRefs.flatMap((ref) => ref.authorityVersionId ? [ref.authorityVersionId] : []);
  if (locationVersionIds.length) {
    const rows = await db.select().from(schema.aiStoryLocationVersions).where(and(
      inArray(schema.aiStoryLocationVersions.locationVersionId, locationVersionIds),
      eq(schema.aiStoryLocationVersions.orgId, scope.orgId),
      eq(schema.aiStoryLocationVersions.workspaceId, scope.workspaceId),
      eq(schema.aiStoryLocationVersions.campaignId, scope.campaignId),
    ));
    for (const row of rows) {
      const ref = locationRefs.find((item) => item.authorityId === row.locationId && item.authorityVersionId === row.locationVersionId);
      if (ref?.authorityFingerprint === row.fingerprint && (row.scope === "CAMPAIGN_LOCATION" || row.storyId === scope.storyId)) {
        known.add(`LOCATION:${ref.authorityId}`);
      }
    }
  }
  for (const ref of script.authorityReferences.filter((ref) => ref.authorityType === "PROP")) {
    known.add(`PROP:${ref.authorityId}`);
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
      const outlines = await tx.select().from(schema.aiStoryOutlineVersions).where(and(
        eq(schema.aiStoryOutlineVersions.outlineVersionId, parsed.outlineVersionId),
        eq(schema.aiStoryOutlineVersions.orgId, scope.orgId), eq(schema.aiStoryOutlineVersions.workspaceId, scope.workspaceId),
        eq(schema.aiStoryOutlineVersions.campaignId, scope.campaignId), eq(schema.aiStoryOutlineVersions.storyId, scope.storyId),
        eq(schema.aiStoryOutlineVersions.storyVersionId, scope.storyVersionId),
      )).limit(1);
      if (outlines.length !== 1 || outlines[0]!.status !== "FROZEN" || outlines[0]!.sourceHash !== parsed.outlineSourceHash) throw new AiStoryScriptAuthorityError("SCRIPT_OUTLINE_LINEAGE_INVALID", "Canonical Script requires the exact frozen Outline authority");
      const frozenOutline = AiStoryOutlineVersionSchema.parse({ ...outlines[0]!.outline, status: outlines[0]!.status, approvedBy: outlines[0]!.approvedBy, approvedAt: outlines[0]!.approvedAt?.toISOString() ?? null, frozenAt: outlines[0]!.frozenAt?.toISOString() ?? null });
      if (computeAiStoryOutlineSourceHash(frozenOutline) !== frozenOutline.sourceHash) throw new AiStoryScriptAuthorityError("SCRIPT_OUTLINE_LINEAGE_INVALID", "Frozen Outline source fingerprint is invalid");
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
      if (computeAiStoryScriptSourceHash(current) !== current.sourceHash) throw new AiStoryScriptAuthorityError("SCRIPT_SOURCE_HASH_INVALID", "Script source fingerprint does not match canonical content");
      const outlineRows = await tx.select().from(schema.aiStoryOutlineVersions).where(and(
        eq(schema.aiStoryOutlineVersions.outlineVersionId, current.outlineVersionId),
        eq(schema.aiStoryOutlineVersions.orgId, scope.orgId), eq(schema.aiStoryOutlineVersions.workspaceId, scope.workspaceId),
        eq(schema.aiStoryOutlineVersions.campaignId, scope.campaignId), eq(schema.aiStoryOutlineVersions.storyId, scope.storyId),
        eq(schema.aiStoryOutlineVersions.storyVersionId, scope.storyVersionId), eq(schema.aiStoryOutlineVersions.status, "FROZEN"),
      )).limit(1);
      if (!outlineRows[0] || outlineRows[0].sourceHash !== current.outlineSourceHash) throw new AiStoryScriptAuthorityError("SCRIPT_OUTLINE_LINEAGE_INVALID", "Canonical Script requires the exact frozen Outline authority");
      const outline = AiStoryOutlineVersionSchema.parse({ ...outlineRows[0].outline, status: outlineRows[0].status, approvedBy: outlineRows[0].approvedBy, approvedAt: outlineRows[0].approvedAt?.toISOString() ?? null, frozenAt: outlineRows[0].frozenAt?.toISOString() ?? null });
      if (computeAiStoryOutlineSourceHash(outline) !== outline.sourceHash) throw new AiStoryScriptAuthorityError("SCRIPT_OUTLINE_LINEAGE_INVALID", "Frozen Outline source fingerprint is invalid");
      if (to === "VALIDATED") {
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
