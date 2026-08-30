import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AiStoryScriptDirectorHandoffSchema,
  AiStoryScriptVersionSchema,
  validateAiStoryScriptDirectorHandoff,
  type AiStoryScriptDirectorHandoff,
} from "@ceo-agent/shared";
import {
  buildAiStoryScriptDirectorHandoff,
  computeAiStoryScriptDirectorHandoffFingerprint,
  computeAiStoryScriptDirectorHandoffSourceHash,
  deriveProductBindingRoles,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import type { AiStoryScriptScope } from "./ai-story-script";

type Db = ReturnType<typeof getDb>;
export type AiStoryScriptDirectorHandoffRecord = { handoff: AiStoryScriptDirectorHandoff; authorityStatus: "CURRENT" | "SUPERSEDED" };

export class AiStoryScriptDirectorHandoffAuthorityError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "AiStoryScriptDirectorHandoffAuthorityError"; }
}

function parseScript(row: typeof schema.aiStoryScriptVersions.$inferSelect) {
  return AiStoryScriptVersionSchema.parse({ ...row.script, status: row.status, approvedBy: row.approvedBy, approvedAt: row.approvedAt?.toISOString() ?? null, frozenAt: row.frozenAt?.toISOString() ?? null });
}

function parseHandoff(row: typeof schema.aiStoryScriptDirectorHandoffs.$inferSelect): AiStoryScriptDirectorHandoffRecord {
  return { handoff: AiStoryScriptDirectorHandoffSchema.parse(row.handoff), authorityStatus: row.authorityStatus as "CURRENT" | "SUPERSEDED" };
}

async function assertScope(db: Pick<Db, "execute">, scope: AiStoryScriptScope, mutation: boolean) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(
    select 1 from ai_stories s join campaigns c on c.id=s.campaign_id join ai_story_versions v on v.story_id=s.id
    where s.id=${scope.storyId}::uuid and s.org_id=${scope.orgId}::uuid and s.workspace_id=${scope.workspaceId}::uuid
      and s.campaign_id=${scope.campaignId}::uuid and c.org_id=${scope.orgId}::uuid and c.workspace_id=${scope.workspaceId}::uuid
      and v.id=${scope.storyVersionId}::uuid and exists(select 1 from workspace_members wm where wm.workspace_id=${scope.workspaceId}::uuid
        and wm.user_id=${scope.actorUserId}::uuid and (${mutation}=false or wm.role in ('admin','operator','editor','reviewer')))
  ) as ok`);
  if (!rows[0]?.ok) throw new AiStoryScriptDirectorHandoffAuthorityError("HANDOFF_SCOPE_DENIED", "Director handoff authority scope does not resolve");
}

export class AiStoryScriptDirectorHandoffAuthorityService {
  constructor(private readonly db: Db = getDb()) {}

  async createFromFrozenScript(scope: AiStoryScriptScope, scriptVersionId: string, createdAt = new Date().toISOString()) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`script-director-handoff:${scope.storyId}`}))`);
      await assertScope(tx, scope, true);
      const scriptRows = await tx.select().from(schema.aiStoryScriptVersions).where(and(
        eq(schema.aiStoryScriptVersions.scriptVersionId, scriptVersionId), eq(schema.aiStoryScriptVersions.orgId, scope.orgId),
        eq(schema.aiStoryScriptVersions.workspaceId, scope.workspaceId), eq(schema.aiStoryScriptVersions.storyId, scope.storyId),
        eq(schema.aiStoryScriptVersions.storyVersionId, scope.storyVersionId),
      )).limit(1).for("update");
      if (!scriptRows[0]) throw new AiStoryScriptDirectorHandoffAuthorityError("HANDOFF_SCRIPT_NOT_FOUND", "Script is not available in handoff authority scope");
      const script = parseScript(scriptRows[0]);
      if (script.status !== "FROZEN") throw new AiStoryScriptDirectorHandoffAuthorityError("HANDOFF_SCRIPT_NOT_FROZEN", "Canonical Director handoff requires a frozen Script");

      const duplicate = await tx.select().from(schema.aiStoryScriptDirectorHandoffs).where(eq(schema.aiStoryScriptDirectorHandoffs.scriptVersionId, scriptVersionId)).limit(1);
      if (duplicate[0]) return parseHandoff(duplicate[0]);

      const productIds = [...new Set(script.scenes.flatMap((scene) => scene.productAuthorityRefs))];
      const productAssets = productIds.length ? await tx.select({ id: schema.assets.id, contentHash: schema.assets.contentHash }).from(schema.assets).where(and(
        inArray(schema.assets.id, productIds), eq(schema.assets.orgId, scope.orgId), eq(schema.assets.workspaceId, scope.workspaceId), isNull(schema.assets.deletedAt),
      )).for("share") : [];
      if (productAssets.length !== productIds.length || productAssets.some((asset) => !asset.contentHash || !/^sha256:[0-9a-f]{64}$/.test(asset.contentHash))) throw new AiStoryScriptDirectorHandoffAuthorityError("HANDOFF_PRODUCT_AUTHORITY_INVALID", "Every Product authority must resolve to an exact source asset content hash");

      const currentRows = await tx.select().from(schema.aiStoryScriptDirectorHandoffs).where(and(eq(schema.aiStoryScriptDirectorHandoffs.storyId, scope.storyId), eq(schema.aiStoryScriptDirectorHandoffs.authorityStatus, "CURRENT"))).orderBy(asc(schema.aiStoryScriptDirectorHandoffs.version)).for("update");
      const prior = currentRows.at(-1);
      if (prior && script.supersedesScriptVersionId !== prior.scriptVersionId) throw new AiStoryScriptDirectorHandoffAuthorityError("HANDOFF_LINEAGE_INVALID", "New handoff must extend the currently authoritative Script handoff");
      const handoff = buildAiStoryScriptDirectorHandoff({
        script,
        productAuthorityBindings: productAssets.map((asset) => ({ productAuthorityId: asset.id, sourceAssetId: asset.id, sourceAssetContentHash: asset.contentHash!, requiredRoles: deriveProductBindingRoles(script, asset.id) })),
        supersedesHandoffId: prior?.handoffId ?? null,
        createdBy: scope.actorUserId,
        createdAt,
      });
      const sourceHash = computeAiStoryScriptDirectorHandoffSourceHash(handoff);
      const fingerprint = computeAiStoryScriptDirectorHandoffFingerprint(handoff);
      const issues = validateAiStoryScriptDirectorHandoff(handoff, script, { expectedSourceHash: sourceHash, expectedFingerprint: fingerprint, currentScriptVersionId: script.scriptVersionId });
      if (issues.length) throw new AiStoryScriptDirectorHandoffAuthorityError("HANDOFF_VALIDATION_FAILED", JSON.stringify(issues));
      if (prior) await tx.update(schema.aiStoryScriptDirectorHandoffs).set({ authorityStatus: "SUPERSEDED" }).where(eq(schema.aiStoryScriptDirectorHandoffs.handoffId, prior.handoffId));
      await tx.insert(schema.aiStoryScriptDirectorHandoffs).values({
        handoffId: handoff.handoffId, orgId: handoff.orgId, workspaceId: handoff.workspaceId, campaignId: scope.campaignId,
        storyId: handoff.storyId, storyVersionId: handoff.storyVersionId, outlineVersionId: handoff.outlineVersionId,
        scriptVersionId: handoff.scriptVersionId, version: handoff.version, contractVersion: handoff.contractVersion,
        scriptSourceHash: handoff.scriptSourceHash, sourceHash: handoff.sourceHash, handoffFingerprint: handoff.handoffFingerprint,
        authorityStatus: "CURRENT", supersedesHandoffId: handoff.supersedesHandoffId, handoff,
        createdBy: handoff.createdBy, createdAt: new Date(handoff.createdAt), frozenAt: new Date(handoff.frozenAt),
      });
      return { handoff, authorityStatus: "CURRENT" as const };
    });
  }

  async read(scope: AiStoryScriptScope, handoffId: string) {
    await assertScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryScriptDirectorHandoffs).where(and(
      eq(schema.aiStoryScriptDirectorHandoffs.handoffId, handoffId), eq(schema.aiStoryScriptDirectorHandoffs.orgId, scope.orgId),
      eq(schema.aiStoryScriptDirectorHandoffs.workspaceId, scope.workspaceId), eq(schema.aiStoryScriptDirectorHandoffs.storyId, scope.storyId),
    )).limit(1);
    if (!rows[0]) throw new AiStoryScriptDirectorHandoffAuthorityError("HANDOFF_NOT_FOUND", "Director handoff not found in authority scope");
    return parseHandoff(rows[0]);
  }

  async history(scope: AiStoryScriptScope) {
    await assertScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryScriptDirectorHandoffs).where(and(
      eq(schema.aiStoryScriptDirectorHandoffs.orgId, scope.orgId), eq(schema.aiStoryScriptDirectorHandoffs.workspaceId, scope.workspaceId), eq(schema.aiStoryScriptDirectorHandoffs.storyId, scope.storyId),
    )).orderBy(asc(schema.aiStoryScriptDirectorHandoffs.version));
    return rows.map(parseHandoff);
  }

  async validate(scope: AiStoryScriptScope, handoffId: string) {
    const record = await this.read(scope, handoffId);
    const scriptRows = await this.db.select().from(schema.aiStoryScriptVersions).where(eq(schema.aiStoryScriptVersions.scriptVersionId, record.handoff.scriptVersionId)).limit(1);
    if (!scriptRows[0]) throw new AiStoryScriptDirectorHandoffAuthorityError("HANDOFF_SCRIPT_NOT_FOUND", "Bound Script authority is missing");
    const latestRows = await this.db.select({ scriptVersionId: schema.aiStoryScriptVersions.scriptVersionId }).from(schema.aiStoryScriptVersions).where(and(eq(schema.aiStoryScriptVersions.storyId, scope.storyId), eq(schema.aiStoryScriptVersions.status, "FROZEN"))).orderBy(sql`${schema.aiStoryScriptVersions.version} desc`).limit(1);
    const script = parseScript(scriptRows[0]);
    const issues = validateAiStoryScriptDirectorHandoff(record.handoff, script, {
      expectedSourceHash: computeAiStoryScriptDirectorHandoffSourceHash(record.handoff),
      expectedFingerprint: computeAiStoryScriptDirectorHandoffFingerprint(record.handoff),
      currentScriptVersionId: latestRows[0]?.scriptVersionId,
    });
    if (record.authorityStatus !== "CURRENT") issues.push({ gate: "STALE_HANDOFF_GATE", severity: "BLOCK", message: "Handoff authority is superseded" });
    return issues;
  }
}
