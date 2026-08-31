import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AiStoryCastPromotionSchema,
  AiStoryEphemeralActorCastReferenceSchema,
  AiStorySupportingCharacterMutationInputSchema,
  AiStorySupportingCharacterVersionSchema,
  type AiStoryCastReference,
  type AiStoryCharacterMutationInput,
  type AiStoryEphemeralActorCastReference,
  type AiStorySupportingCharacterMutationInput,
  type AiStorySupportingCharacterVersion,
} from "@ceo-agent/shared";
import { buildAiStorySupportingCharacterVersion, computeAiStorySupportingCharacterFingerprint } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { AiStoryCharacterAuthorityService } from "./ai-story-character";

type Db = ReturnType<typeof getDb>;
export type AiStoryCastScope = { orgId: string; workspaceId: string; campaignId: string; storyId: string; actorUserId: string };

export class AiStoryCastAuthorityError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "AiStoryCastAuthorityError"; }
}

async function assertStoryScope(db: Pick<Db, "execute">, scope: AiStoryCastScope, mutation: boolean) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(
    select 1 from ai_stories s join campaigns c on c.id=s.campaign_id
    where s.id=${scope.storyId}::uuid and s.org_id=${scope.orgId}::uuid and s.workspace_id=${scope.workspaceId}::uuid
      and s.campaign_id=${scope.campaignId}::uuid and c.org_id=${scope.orgId}::uuid and c.workspace_id=${scope.workspaceId}::uuid
      and exists(select 1 from workspace_members wm where wm.workspace_id=${scope.workspaceId}::uuid and wm.user_id=${scope.actorUserId}::uuid
        and (${mutation}=false or wm.role in ('admin','operator')))
  ) as ok`);
  if (!rows[0]?.ok) throw new AiStoryCastAuthorityError("CAST_SCOPE_DENIED", "Story Cast authority scope does not resolve");
}

function parseVersion(row: typeof schema.aiStorySupportingCharacterVersions.$inferSelect) { return AiStorySupportingCharacterVersionSchema.parse(row.snapshot); }

async function resolveVisualAssets(db: Pick<Db, "select">, scope: AiStoryCastScope, ids: readonly string[]) {
  if (!ids.length) return [];
  const uniqueIds = [...new Set(ids)];
  const rows = await db.select({ id: schema.assets.id, contentHash: schema.assets.contentHash }).from(schema.assets)
    .innerJoin(schema.campaignAssetRefs, and(eq(schema.campaignAssetRefs.assetId, schema.assets.id), eq(schema.campaignAssetRefs.campaignId, scope.campaignId)))
    .where(and(inArray(schema.assets.id, uniqueIds), eq(schema.assets.orgId, scope.orgId), eq(schema.assets.workspaceId, scope.workspaceId), isNull(schema.assets.deletedAt)));
  if (rows.length !== uniqueIds.length || rows.some((row) => !row.contentHash)) throw new AiStoryCastAuthorityError("CAST_VISUAL_REFERENCE_INVALID", "Every Supporting Character visual reference must be a finalized Asset attached to the same Campaign");
  return rows.map((row) => ({ assetId: row.id, contentHash: row.contentHash!, purpose: "SUPPORTING_CHARACTER_VISUAL_REFERENCE" })).sort((a, b) => a.assetId.localeCompare(b.assetId));
}

async function assertRelationships(db: Pick<Db, "select">, scope: AiStoryCastScope, facts: AiStorySupportingCharacterMutationInput, selfId: string) {
  for (const relationship of facts.relationships) {
    const target = relationship.relatedCast;
    if (target.id === selfId && target.scope === "STORY_SUPPORTING_CHARACTER") throw new AiStoryCastAuthorityError("CAST_RELATIONSHIP_INVALID", "Supporting Character cannot relate to itself");
    if (target.scope === "EPHEMERAL_ACTOR") throw new AiStoryCastAuthorityError("CAST_RELATIONSHIP_INVALID", "Story-persistent relationship cannot bind a Scene-local Ephemeral Actor");
    if (target.scope === "CAMPAIGN_CHARACTER") {
      const rows = await db.select({ id: schema.aiStoryCharacters.characterId }).from(schema.aiStoryCharacters)
        .innerJoin(schema.aiStoryCharacterVersions, eq(schema.aiStoryCharacterVersions.characterVersionId, schema.aiStoryCharacters.currentCharacterVersionId))
        .where(and(eq(schema.aiStoryCharacters.characterId, target.id), eq(schema.aiStoryCharacters.campaignId, scope.campaignId), eq(schema.aiStoryCharacters.workspaceId, scope.workspaceId), eq(schema.aiStoryCharacters.status, "ACTIVE"), eq(schema.aiStoryCharacterVersions.characterVersionId, target.authorityVersionId), eq(schema.aiStoryCharacterVersions.fingerprint, target.authorityFingerprint))).limit(1);
      if (!rows[0] || target.campaignId !== scope.campaignId) throw new AiStoryCastAuthorityError("CAST_RELATIONSHIP_INVALID", "Campaign relationship target does not resolve in this Campaign");
    } else {
      const rows = await db.select({ id: schema.aiStorySupportingCharacters.supportingCharacterId }).from(schema.aiStorySupportingCharacters)
        .innerJoin(schema.aiStorySupportingCharacterVersions, eq(schema.aiStorySupportingCharacterVersions.supportingCharacterVersionId, schema.aiStorySupportingCharacters.currentSupportingCharacterVersionId))
        .where(and(eq(schema.aiStorySupportingCharacters.supportingCharacterId, target.id), eq(schema.aiStorySupportingCharacters.storyId, scope.storyId), eq(schema.aiStorySupportingCharacters.status, "ACTIVE"), eq(schema.aiStorySupportingCharacterVersions.supportingCharacterVersionId, target.authorityVersionId), eq(schema.aiStorySupportingCharacterVersions.fingerprint, target.authorityFingerprint))).limit(1);
      if (!rows[0] || target.storyId !== scope.storyId) throw new AiStoryCastAuthorityError("CAST_RELATIONSHIP_INVALID", "Supporting relationship target does not resolve in this Story");
    }
  }
}

export function supportingCharacterCastReference(version: AiStorySupportingCharacterVersion, visualIdentityRequirement: "NONE" | "PREFERRED" | "REQUIRED" = "NONE"): AiStoryCastReference {
  return { scope: "STORY_SUPPORTING_CHARACTER", id: version.supportingCharacterId, storyId: version.storyId, authorityVersionId: version.supportingCharacterVersionId, authorityFingerprint: version.fingerprint, visualIdentityRequirement };
}

export async function resolveKnownCastReferences(db: Pick<Db, "select">, scope: AiStoryCastScope, references: readonly AiStoryCastReference[]) {
  const known = new Set<string>();
  for (const reference of references) {
    if (reference.scope === "EPHEMERAL_ACTOR") {
      if (reference.storyId === scope.storyId) known.add(`${reference.scope}:${reference.id}`);
      continue;
    }
    if (reference.scope === "CAMPAIGN_CHARACTER") {
      const rows = await db.select({ id: schema.aiStoryCharacters.characterId }).from(schema.aiStoryCharacters)
        .innerJoin(schema.aiStoryCharacterVersions, eq(schema.aiStoryCharacterVersions.characterVersionId, schema.aiStoryCharacters.currentCharacterVersionId))
        .where(and(eq(schema.aiStoryCharacters.characterId, reference.id), eq(schema.aiStoryCharacters.campaignId, scope.campaignId), eq(schema.aiStoryCharacters.workspaceId, scope.workspaceId), eq(schema.aiStoryCharacters.status, "ACTIVE"), eq(schema.aiStoryCharacterVersions.characterVersionId, reference.authorityVersionId), eq(schema.aiStoryCharacterVersions.fingerprint, reference.authorityFingerprint))).limit(1);
      if (rows[0] && reference.campaignId === scope.campaignId) known.add(`${reference.scope}:${reference.id}`);
      continue;
    }
    const rows = await db.select({ id: schema.aiStorySupportingCharacters.supportingCharacterId }).from(schema.aiStorySupportingCharacters)
      .innerJoin(schema.aiStorySupportingCharacterVersions, eq(schema.aiStorySupportingCharacterVersions.supportingCharacterVersionId, schema.aiStorySupportingCharacters.currentSupportingCharacterVersionId))
      .where(and(eq(schema.aiStorySupportingCharacters.supportingCharacterId, reference.id), eq(schema.aiStorySupportingCharacters.storyId, scope.storyId), eq(schema.aiStorySupportingCharacters.workspaceId, scope.workspaceId), eq(schema.aiStorySupportingCharacters.status, "ACTIVE"), eq(schema.aiStorySupportingCharacterVersions.supportingCharacterVersionId, reference.authorityVersionId), eq(schema.aiStorySupportingCharacterVersions.fingerprint, reference.authorityFingerprint))).limit(1);
    if (rows[0] && reference.storyId === scope.storyId) known.add(`${reference.scope}:${reference.id}`);
  }
  return known;
}

export class AiStorySupportingCastAuthorityService {
  constructor(private readonly db: Db = getDb()) {}

  private async listCurrentVersions(scope: AiStoryCastScope, includeDeleted: boolean) {
    const rows = await this.db.select({ snapshot: schema.aiStorySupportingCharacterVersions.snapshot })
      .from(schema.aiStorySupportingCharacters)
      .innerJoin(
        schema.aiStorySupportingCharacterVersions,
        eq(
          schema.aiStorySupportingCharacterVersions.supportingCharacterVersionId,
          schema.aiStorySupportingCharacters.currentSupportingCharacterVersionId
        )
      )
      .where(and(
        eq(schema.aiStorySupportingCharacters.orgId, scope.orgId),
        eq(schema.aiStorySupportingCharacters.workspaceId, scope.workspaceId),
        eq(schema.aiStorySupportingCharacters.campaignId, scope.campaignId),
        eq(schema.aiStorySupportingCharacters.storyId, scope.storyId),
        ...(includeDeleted ? [] : [eq(schema.aiStorySupportingCharacters.status, "ACTIVE")]),
      ))
      .orderBy(asc(schema.aiStorySupportingCharacters.displayName));
    return rows.map((row) => AiStorySupportingCharacterVersionSchema.parse(row.snapshot));
  }

  async add(scope: AiStoryCastScope, raw: AiStorySupportingCharacterMutationInput, supportingCharacterId = randomUUID(), now = new Date().toISOString()) {
    const facts = AiStorySupportingCharacterMutationInputSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`supporting-cast:${scope.storyId}`}))`);
      await assertStoryScope(tx, scope, true); await assertRelationships(tx, scope, facts, supportingCharacterId);
      const visualAssetReferences = await resolveVisualAssets(tx, scope, facts.visualAssetIds);
      const version = buildAiStorySupportingCharacterVersion({ supportingCharacterId, ...scope, version: 1, status: "ACTIVE", facts, visualAssetReferences, supersedesSupportingCharacterVersionId: null, createdBy: scope.actorUserId, createdAt: now });
      await tx.insert(schema.aiStorySupportingCharacters).values({ supportingCharacterId, orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, storyId: scope.storyId, currentVersion: 1, currentSupportingCharacterVersionId: version.supportingCharacterVersionId, status: "ACTIVE", displayName: version.displayName, createdBy: scope.actorUserId, createdAt: new Date(now), updatedAt: new Date(now), deletedAt: null });
      await tx.insert(schema.aiStorySupportingCharacterVersions).values({ supportingCharacterVersionId: version.supportingCharacterVersionId, supportingCharacterId, orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, storyId: scope.storyId, version: 1, contractVersion: version.contractVersion, fingerprint: version.fingerprint, status: version.status, supersedesSupportingCharacterVersionId: null, snapshot: version, createdBy: scope.actorUserId, createdAt: new Date(now) });
      return version;
    });
  }

  async edit(scope: AiStoryCastScope, id: string, raw: AiStorySupportingCharacterMutationInput, expectedVersion: number, now = new Date().toISOString()) { return this.mutate(scope, id, AiStorySupportingCharacterMutationInputSchema.parse(raw), expectedVersion, "ACTIVE", now); }
  async delete(scope: AiStoryCastScope, id: string, expectedVersion: number, now = new Date().toISOString()) {
    const current = await this.read(scope, id, true);
    return this.mutate(scope, id, { displayName: current.displayName, identity: current.identity, ...(current.storyRole ? { storyRole: current.storyRole } : {}), appearance: current.appearance, relationships: current.relationships, continuityFacts: current.continuityFacts, visualAssetIds: current.visualAssetReferences.map((asset) => asset.assetId) }, expectedVersion, "DELETED", now);
  }

  private async mutate(scope: AiStoryCastScope, id: string, facts: AiStorySupportingCharacterMutationInput, expectedVersion: number, status: "ACTIVE" | "DELETED", now: string) {
    return this.db.transaction(async (tx) => {
      await assertStoryScope(tx, scope, true);
      const rows = await tx.select().from(schema.aiStorySupportingCharacters).where(and(eq(schema.aiStorySupportingCharacters.supportingCharacterId, id), eq(schema.aiStorySupportingCharacters.orgId, scope.orgId), eq(schema.aiStorySupportingCharacters.workspaceId, scope.workspaceId), eq(schema.aiStorySupportingCharacters.campaignId, scope.campaignId), eq(schema.aiStorySupportingCharacters.storyId, scope.storyId))).limit(1).for("update");
      const aggregate = rows[0]; if (!aggregate || aggregate.status !== "ACTIVE") throw new AiStoryCastAuthorityError("SUPPORTING_CHARACTER_NOT_ACTIVE", "Supporting Character is not active in this Story");
      if (aggregate.currentVersion !== expectedVersion) throw new AiStoryCastAuthorityError("SUPPORTING_CHARACTER_VERSION_CONFLICT", "Supporting Character was changed by another operation");
      await assertRelationships(tx, scope, facts, id);
      const visualAssetReferences = await resolveVisualAssets(tx, scope, facts.visualAssetIds);
      const version = buildAiStorySupportingCharacterVersion({ supportingCharacterId: id, ...scope, version: aggregate.currentVersion + 1, status, facts, visualAssetReferences, supersedesSupportingCharacterVersionId: aggregate.currentSupportingCharacterVersionId, createdBy: scope.actorUserId, createdAt: now });
      await tx.insert(schema.aiStorySupportingCharacterVersions).values({ supportingCharacterVersionId: version.supportingCharacterVersionId, supportingCharacterId: id, orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, storyId: scope.storyId, version: version.version, contractVersion: version.contractVersion, fingerprint: version.fingerprint, status, supersedesSupportingCharacterVersionId: aggregate.currentSupportingCharacterVersionId, snapshot: version, createdBy: scope.actorUserId, createdAt: new Date(now) });
      await tx.update(schema.aiStorySupportingCharacters).set({ currentVersion: version.version, currentSupportingCharacterVersionId: version.supportingCharacterVersionId, status, displayName: version.displayName, updatedAt: new Date(now), deletedAt: status === "DELETED" ? new Date(now) : null }).where(eq(schema.aiStorySupportingCharacters.supportingCharacterId, id));
      return version;
    });
  }

  async list(scope: AiStoryCastScope, includeDeleted = false) {
    await assertStoryScope(this.db, scope, false);
    return this.listCurrentVersions(scope, includeDeleted);
  }

  /**
   * Read projection for an API orchestration that already completed canonical
   * Story/workspace/tenant authorization in the same request.
   */
  async listForVerifiedScope(scope: AiStoryCastScope, includeDeleted = false) {
    return this.listCurrentVersions(scope, includeDeleted);
  }

  async read(scope: AiStoryCastScope, id: string, includeDeleted = false) {
    await assertStoryScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStorySupportingCharacters).where(and(eq(schema.aiStorySupportingCharacters.supportingCharacterId, id), eq(schema.aiStorySupportingCharacters.orgId, scope.orgId), eq(schema.aiStorySupportingCharacters.workspaceId, scope.workspaceId), eq(schema.aiStorySupportingCharacters.campaignId, scope.campaignId), eq(schema.aiStorySupportingCharacters.storyId, scope.storyId))).limit(1);
    if (!rows[0] || (!includeDeleted && rows[0].status !== "ACTIVE")) throw new AiStoryCastAuthorityError("SUPPORTING_CHARACTER_NOT_FOUND", "Supporting Character not found in Story authority");
    const versions = await this.db.select().from(schema.aiStorySupportingCharacterVersions).where(eq(schema.aiStorySupportingCharacterVersions.supportingCharacterVersionId, rows[0].currentSupportingCharacterVersionId)).limit(1);
    if (!versions[0]) throw new AiStoryCastAuthorityError("SUPPORTING_CHARACTER_LINEAGE_INVALID", "Supporting Character version not found");
    const parsed = parseVersion(versions[0]); if (computeAiStorySupportingCharacterFingerprint(parsed) !== parsed.fingerprint) throw new AiStoryCastAuthorityError("SUPPORTING_CHARACTER_FINGERPRINT_INVALID", "Supporting Character fingerprint mismatch"); return parsed;
  }

  async history(scope: AiStoryCastScope, id: string) { await assertStoryScope(this.db, scope, false); const rows = await this.db.select().from(schema.aiStorySupportingCharacterVersions).where(and(eq(schema.aiStorySupportingCharacterVersions.supportingCharacterId, id), eq(schema.aiStorySupportingCharacterVersions.storyId, scope.storyId), eq(schema.aiStorySupportingCharacterVersions.workspaceId, scope.workspaceId))).orderBy(asc(schema.aiStorySupportingCharacterVersions.version)); return rows.map(parseVersion); }

  async promoteSupportingToCampaign(scope: AiStoryCastScope, id: string, campaignFacts: AiStoryCharacterMutationInput, now = new Date().toISOString()) {
    await assertStoryScope(this.db, scope, true); const source = await this.read(scope, id);
    if (campaignFacts.name !== source.displayName || campaignFacts.identity !== source.identity || campaignFacts.appearance !== source.appearance) throw new AiStoryCastAuthorityError("CAST_PROMOTION_IDENTITY_MISMATCH", "Promotion must preserve supporting identity, display name, and appearance");
    const target = await new AiStoryCharacterAuthorityService(this.db).add({ orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, actorUserId: scope.actorUserId }, campaignFacts, randomUUID(), now);
    const promotion = AiStoryCastPromotionSchema.parse({ promotionId: randomUUID(), orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, storyId: scope.storyId, source: supportingCharacterCastReference(source), target: { scope: "CAMPAIGN_CHARACTER", id: target.characterId, campaignId: scope.campaignId, authorityVersionId: target.characterVersionId, authorityFingerprint: target.fingerprint, visualIdentityRequirement: "NONE" }, promotedBy: scope.actorUserId, promotedAt: now });
    await this.db.insert(schema.aiStoryCastPromotions).values({ promotionId: promotion.promotionId, orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, storyId: scope.storyId, sourceScope: promotion.source.scope, sourceId: promotion.source.id, targetScope: promotion.target.scope, targetId: promotion.target.id, promotion, promotedBy: scope.actorUserId, promotedAt: new Date(now) }); return promotion;
  }

  async promoteEphemeralToSupporting(scope: AiStoryCastScope, rawActor: AiStoryEphemeralActorCastReference, facts: AiStorySupportingCharacterMutationInput, now = new Date().toISOString()) {
    await assertStoryScope(this.db, scope, true); const actor = AiStoryEphemeralActorCastReferenceSchema.parse(rawActor);
    if (actor.storyId !== scope.storyId || facts.displayName !== actor.displayName || facts.appearance !== actor.appearance) throw new AiStoryCastAuthorityError("CAST_PROMOTION_IDENTITY_MISMATCH", "Ephemeral promotion must preserve Story, display name, and appearance");
    const target = await this.add(scope, facts, randomUUID(), now); const targetRef = supportingCharacterCastReference(target, actor.visualIdentityRequirement);
    const promotion = AiStoryCastPromotionSchema.parse({ promotionId: randomUUID(), orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, storyId: scope.storyId, source: actor, target: targetRef, promotedBy: scope.actorUserId, promotedAt: now });
    await this.db.insert(schema.aiStoryCastPromotions).values({ promotionId: promotion.promotionId, orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, storyId: scope.storyId, sourceScope: promotion.source.scope, sourceId: promotion.source.id, targetScope: promotion.target.scope, targetId: promotion.target.id, promotion, promotedBy: scope.actorUserId, promotedAt: new Date(now) }); return promotion;
  }
}
