import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AiStoryCharacterAuthorityVersionSchema,
  AiStoryCharacterMutationInputSchema,
  type AiStoryCharacterAuthorityVersion,
  type AiStoryCharacterMutationInput,
} from "@ceo-agent/shared";
import { buildAiStoryCharacterVersion, computeAiStoryCharacterFingerprint } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;
export type AiStoryCharacterScope = { orgId: string; workspaceId: string; campaignId: string; actorUserId: string };

export class AiStoryCharacterAuthorityError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "AiStoryCharacterAuthorityError"; }
}

async function assertCampaignScope(db: Pick<Db, "execute">, scope: AiStoryCharacterScope, mutation: boolean) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(
    select 1 from campaigns c where c.id=${scope.campaignId}::uuid and c.org_id=${scope.orgId}::uuid
      and c.workspace_id=${scope.workspaceId}::uuid and exists(
        select 1 from workspace_members wm where wm.workspace_id=${scope.workspaceId}::uuid
          and wm.user_id=${scope.actorUserId}::uuid
          and (${mutation}=false or wm.role in ('admin','operator'))
      )
  ) as ok`);
  if (!rows[0]?.ok) throw new AiStoryCharacterAuthorityError("CHARACTER_SCOPE_DENIED", "Character Campaign authority scope does not resolve");
}

function parseVersion(row: typeof schema.aiStoryCharacterVersions.$inferSelect) {
  return AiStoryCharacterAuthorityVersionSchema.parse(row.snapshot);
}

async function resolveVisualAssets(db: Pick<Db, "select">, scope: AiStoryCharacterScope, ids: readonly string[]) {
  if (!ids.length) return [];
  const rows = await db.select({ id: schema.assets.id, contentHash: schema.assets.contentHash })
    .from(schema.assets).innerJoin(schema.campaignAssetRefs, and(
      eq(schema.campaignAssetRefs.assetId, schema.assets.id),
      eq(schema.campaignAssetRefs.campaignId, scope.campaignId),
    )).where(and(
      inArray(schema.assets.id, [...new Set(ids)]), eq(schema.assets.orgId, scope.orgId),
      eq(schema.assets.workspaceId, scope.workspaceId), isNull(schema.assets.deletedAt),
    ));
  if (rows.length !== new Set(ids).size || rows.some((row) => !row.contentHash)) {
    throw new AiStoryCharacterAuthorityError("CHARACTER_ASSET_REFERENCE_INVALID", "Every Character visual reference must be a finalized Asset attached to the same Campaign");
  }
  return rows.map((row) => ({ assetId: row.id, contentHash: row.contentHash!, purpose: "CHARACTER_VISUAL_REFERENCE" })).sort((a, b) => a.assetId.localeCompare(b.assetId));
}

async function assertRelationships(db: Pick<Db, "select">, scope: AiStoryCharacterScope, relationships: AiStoryCharacterMutationInput["relationships"], selfId: string) {
  if (relationships.some((relationship) => relationship.relatedCharacterId === selfId)) throw new AiStoryCharacterAuthorityError("CHARACTER_RELATIONSHIP_INVALID", "Character cannot declare a relationship to itself");
  const ids = [...new Set(relationships.map((relationship) => relationship.relatedCharacterId).filter((id) => id !== selfId))];
  if (!ids.length) return;
  const rows = await db.select({ id: schema.aiStoryCharacters.characterId }).from(schema.aiStoryCharacters).where(and(
    inArray(schema.aiStoryCharacters.characterId, ids), eq(schema.aiStoryCharacters.orgId, scope.orgId),
    eq(schema.aiStoryCharacters.workspaceId, scope.workspaceId), eq(schema.aiStoryCharacters.campaignId, scope.campaignId),
    eq(schema.aiStoryCharacters.status, "ACTIVE"),
  ));
  if (rows.length !== ids.length) throw new AiStoryCharacterAuthorityError("CHARACTER_RELATIONSHIP_INVALID", "Character relationship references an unknown, deleted, or cross-Campaign Character");
}

export class AiStoryCharacterAuthorityService {
  constructor(private readonly db: Db = getDb()) {}

  async add(scope: AiStoryCharacterScope, raw: AiStoryCharacterMutationInput, characterId = randomUUID(), now = new Date().toISOString()) {
    const facts = AiStoryCharacterMutationInputSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`character-campaign:${scope.campaignId}`}))`);
      await assertCampaignScope(tx, scope, true);
      await assertRelationships(tx, scope, facts.relationships, characterId);
      const visualAssetReferences = await resolveVisualAssets(tx, scope, facts.visualAssetIds);
      const version = buildAiStoryCharacterVersion({ characterId, ...scope, version: 1, status: "ACTIVE", facts, visualAssetReferences, supersedesCharacterVersionId: null, createdBy: scope.actorUserId, createdAt: now });
      await tx.insert(schema.aiStoryCharacters).values({ characterId, orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, currentVersion: 1, currentCharacterVersionId: version.characterVersionId, status: "ACTIVE", name: version.name, createdBy: scope.actorUserId, createdAt: new Date(now), updatedAt: new Date(now), deletedAt: null });
      await tx.insert(schema.aiStoryCharacterVersions).values({ characterVersionId: version.characterVersionId, characterId, orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, version: 1, contractVersion: version.contractVersion, fingerprint: version.fingerprint, status: version.status, supersedesCharacterVersionId: null, snapshot: version, createdBy: scope.actorUserId, createdAt: new Date(now) });
      return version;
    });
  }

  async edit(scope: AiStoryCharacterScope, characterId: string, raw: AiStoryCharacterMutationInput, expectedVersion: number, now = new Date().toISOString()) {
    const facts = AiStoryCharacterMutationInputSchema.parse(raw);
    return this.mutate(scope, characterId, expectedVersion, "ACTIVE", facts, now);
  }

  async delete(scope: AiStoryCharacterScope, characterId: string, expectedVersion: number, now = new Date().toISOString()) {
    await assertCampaignScope(this.db, scope, true);
    const current = await this.read(scope, characterId, true);
    const facts = AiStoryCharacterMutationInputSchema.parse({
      name: current.name, ...current.canonicalFacts,
      visualAssetIds: current.visualAssetReferences.map((asset) => asset.assetId),
    });
    return this.mutate(scope, characterId, expectedVersion, "DELETED", facts, now);
  }

  private async mutate(scope: AiStoryCharacterScope, characterId: string, expectedVersion: number, status: "ACTIVE" | "DELETED", facts: AiStoryCharacterMutationInput, now: string) {
    return this.db.transaction(async (tx) => {
      await assertCampaignScope(tx, scope, true);
      const aggregates = await tx.select().from(schema.aiStoryCharacters).where(and(
        eq(schema.aiStoryCharacters.characterId, characterId), eq(schema.aiStoryCharacters.orgId, scope.orgId),
        eq(schema.aiStoryCharacters.workspaceId, scope.workspaceId), eq(schema.aiStoryCharacters.campaignId, scope.campaignId),
      )).limit(1).for("update");
      const aggregate = aggregates[0];
      if (!aggregate || aggregate.status !== "ACTIVE") throw new AiStoryCharacterAuthorityError("CHARACTER_NOT_ACTIVE", "Character is not active in this Campaign");
      if (aggregate.currentVersion !== expectedVersion) throw new AiStoryCharacterAuthorityError("CHARACTER_VERSION_CONFLICT", "Character was changed by another operation");
      const priorRows = await tx.select().from(schema.aiStoryCharacterVersions).where(eq(schema.aiStoryCharacterVersions.characterVersionId, aggregate.currentCharacterVersionId)).limit(1);
      if (!priorRows[0]) throw new AiStoryCharacterAuthorityError("CHARACTER_LINEAGE_INVALID", "Current Character version is missing");
      await assertRelationships(tx, scope, facts.relationships, characterId);
      const visualAssetReferences = await resolveVisualAssets(tx, scope, facts.visualAssetIds);
      const version = buildAiStoryCharacterVersion({ characterId, ...scope, version: aggregate.currentVersion + 1, status, facts, visualAssetReferences, supersedesCharacterVersionId: aggregate.currentCharacterVersionId, createdBy: scope.actorUserId, createdAt: now });
      await tx.insert(schema.aiStoryCharacterVersions).values({ characterVersionId: version.characterVersionId, characterId, orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, version: version.version, contractVersion: version.contractVersion, fingerprint: version.fingerprint, status, supersedesCharacterVersionId: aggregate.currentCharacterVersionId, snapshot: version, createdBy: scope.actorUserId, createdAt: new Date(now) });
      await tx.update(schema.aiStoryCharacters).set({ currentVersion: version.version, currentCharacterVersionId: version.characterVersionId, status, name: version.name, updatedAt: new Date(now), deletedAt: status === "DELETED" ? new Date(now) : null }).where(eq(schema.aiStoryCharacters.characterId, characterId));
      return version;
    });
  }

  async list(scope: AiStoryCharacterScope, includeDeleted = false) {
    await assertCampaignScope(this.db, scope, false);
    const aggregates = await this.db.select().from(schema.aiStoryCharacters).where(and(
      eq(schema.aiStoryCharacters.orgId, scope.orgId), eq(schema.aiStoryCharacters.workspaceId, scope.workspaceId),
      eq(schema.aiStoryCharacters.campaignId, scope.campaignId), ...(includeDeleted ? [] : [eq(schema.aiStoryCharacters.status, "ACTIVE")]),
    )).orderBy(asc(schema.aiStoryCharacters.name));
    if (!aggregates.length) return [];
    const rows = await this.db.select().from(schema.aiStoryCharacterVersions).where(inArray(schema.aiStoryCharacterVersions.characterVersionId, aggregates.map((item) => item.currentCharacterVersionId)));
    const byId = new Map(rows.map((row) => [row.characterVersionId, parseVersion(row)]));
    return aggregates.map((item) => byId.get(item.currentCharacterVersionId)!).filter(Boolean);
  }

  async read(scope: AiStoryCharacterScope, characterId: string, includeDeleted = false) {
    await assertCampaignScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryCharacters).where(and(
      eq(schema.aiStoryCharacters.characterId, characterId), eq(schema.aiStoryCharacters.orgId, scope.orgId),
      eq(schema.aiStoryCharacters.workspaceId, scope.workspaceId), eq(schema.aiStoryCharacters.campaignId, scope.campaignId),
    )).limit(1);
    if (!rows[0] || (!includeDeleted && rows[0].status !== "ACTIVE")) throw new AiStoryCharacterAuthorityError("CHARACTER_NOT_FOUND", "Character not found in Campaign authority");
    const versions = await this.db.select().from(schema.aiStoryCharacterVersions).where(eq(schema.aiStoryCharacterVersions.characterVersionId, rows[0].currentCharacterVersionId)).limit(1);
    if (!versions[0]) throw new AiStoryCharacterAuthorityError("CHARACTER_LINEAGE_INVALID", "Character version not found");
    const parsed = parseVersion(versions[0]);
    if (computeAiStoryCharacterFingerprint(parsed) !== parsed.fingerprint) throw new AiStoryCharacterAuthorityError("CHARACTER_FINGERPRINT_INVALID", "Character authority fingerprint mismatch");
    return parsed;
  }

  async history(scope: AiStoryCharacterScope, characterId: string) {
    await assertCampaignScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryCharacterVersions).where(and(
      eq(schema.aiStoryCharacterVersions.characterId, characterId), eq(schema.aiStoryCharacterVersions.orgId, scope.orgId),
      eq(schema.aiStoryCharacterVersions.workspaceId, scope.workspaceId), eq(schema.aiStoryCharacterVersions.campaignId, scope.campaignId),
    )).orderBy(asc(schema.aiStoryCharacterVersions.version));
    return rows.map(parseVersion);
  }
}
