import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AiStoryCanonicalSceneSchema,
  AiStoryLocationAuthorityVersionSchema,
  AiStoryLocationFactsSchema,
  AiStoryLocationPromotionSchema,
  type AiStoryCanonicalScene,
  type AiStoryLocationFacts,
  type AiStoryLocationReference,
} from "@ceo-agent/shared";
import {
  buildAiStoryLocationVersion,
  assertAiStorySceneTransition,
  computeAiStoryLocationFingerprint,
  computeAiStorySceneFingerprint,
  computeAiStorySceneSourceHash,
  validateAiStoryCanonicalScenes,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { resolveKnownCastReferences } from "./ai-story-cast";
import type { AiStoryScriptScope } from "./ai-story-script";

type Db = ReturnType<typeof getDb>;
export type AiStoryLocationScope = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId?: string;
  actorUserId: string;
};

export class AiStorySceneAuthorityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStorySceneAuthorityError";
  }
}

async function assertCampaignScope(
  db: Pick<Db, "execute">,
  scope: AiStoryLocationScope,
  mutation: boolean,
) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(
    select 1 from campaigns c
    where c.id=${scope.campaignId}::uuid and c.org_id=${scope.orgId}::uuid and c.workspace_id=${scope.workspaceId}::uuid
      and exists(select 1 from workspace_members wm where wm.workspace_id=${scope.workspaceId}::uuid and wm.user_id=${scope.actorUserId}::uuid
        and (${mutation}=false or wm.role in ('admin','operator')))
  ) as ok`);
  if (!rows[0]?.ok) throw new AiStorySceneAuthorityError("LOCATION_SCOPE_DENIED", "Location authority scope does not resolve");
}

async function assertStoryScope(
  db: Pick<Db, "execute">,
  scope: AiStoryScriptScope,
  mutation: boolean,
) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(
    select 1 from ai_stories s join campaigns c on c.id=s.campaign_id join ai_story_versions v on v.story_id=s.id
    where s.id=${scope.storyId}::uuid and s.org_id=${scope.orgId}::uuid and s.workspace_id=${scope.workspaceId}::uuid
      and s.campaign_id=${scope.campaignId}::uuid and c.org_id=${scope.orgId}::uuid and c.workspace_id=${scope.workspaceId}::uuid
      and v.id=${scope.storyVersionId}::uuid
      and exists(select 1 from workspace_members wm where wm.workspace_id=${scope.workspaceId}::uuid and wm.user_id=${scope.actorUserId}::uuid
        and (${mutation}=false or wm.role in ('admin','operator')))
  ) as ok`);
  if (!rows[0]?.ok) throw new AiStorySceneAuthorityError("SCENE_SCOPE_DENIED", "Canonical Scene authority scope does not resolve");
}

function parseLocation(row: typeof schema.aiStoryLocationVersions.$inferSelect) {
  const value = AiStoryLocationAuthorityVersionSchema.parse(row.snapshot);
  if (computeAiStoryLocationFingerprint(value) !== value.fingerprint) {
    throw new AiStorySceneAuthorityError("LOCATION_FINGERPRINT_INVALID", "Location authority fingerprint mismatch");
  }
  return value;
}

function parseScene(row: typeof schema.aiStoryCanonicalSceneVersions.$inferSelect) {
  const value = AiStoryCanonicalSceneSchema.parse({
    ...row.snapshot,
    status: row.status,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    frozenAt: row.frozenAt?.toISOString() ?? null,
  });
  if (computeAiStorySceneSourceHash(value) !== value.sourceHash || computeAiStorySceneFingerprint(value) !== value.fingerprint) {
    throw new AiStorySceneAuthorityError("SCENE_FINGERPRINT_INVALID", "Canonical Scene fingerprint mismatch");
  }
  return value;
}

async function resolveLocationAssets(db: Pick<Db, "select">, scope: AiStoryLocationScope, ids: readonly string[]) {
  if (!ids.length) return;
  const uniqueIds = [...new Set(ids)];
  const rows = await db.select({ id: schema.assets.id }).from(schema.assets)
    .innerJoin(schema.campaignAssetRefs, and(eq(schema.campaignAssetRefs.assetId, schema.assets.id), eq(schema.campaignAssetRefs.campaignId, scope.campaignId)))
    .where(and(inArray(schema.assets.id, uniqueIds), eq(schema.assets.orgId, scope.orgId), eq(schema.assets.workspaceId, scope.workspaceId), isNull(schema.assets.deletedAt)));
  if (rows.length !== uniqueIds.length) throw new AiStorySceneAuthorityError("LOCATION_ASSET_INVALID", "Every Location visual reference must resolve through existing Campaign Asset authority");
}

export class AiStoryLocationAuthorityService {
  constructor(private readonly db: Db = getDb()) {}

  async add(scope: AiStoryLocationScope, locationScope: "CAMPAIGN_LOCATION" | "STORY_LOCATION", rawFacts: AiStoryLocationFacts, locationId = randomUUID(), now = new Date().toISOString()) {
    const facts = AiStoryLocationFactsSchema.parse(rawFacts);
    if (locationScope === "STORY_LOCATION" && !scope.storyId) throw new AiStorySceneAuthorityError("LOCATION_OWNER_REQUIRED", "Story Location requires a Story owner");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`location:${scope.campaignId}:${scope.storyId ?? "campaign"}`}))`);
      await assertCampaignScope(tx, scope, true);
      await resolveLocationAssets(tx, scope, facts.visualAssetIds);
      const version = buildAiStoryLocationVersion({
        locationId, scope: locationScope, orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId,
        storyId: locationScope === "STORY_LOCATION" ? scope.storyId! : null, version: 1, facts, status: "ACTIVE",
        supersedesLocationVersionId: null, createdBy: scope.actorUserId, createdAt: now,
      });
      await tx.insert(schema.aiStoryLocations).values({
        locationId, orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, storyId: version.storyId,
        scope: locationScope, currentVersion: 1, currentLocationVersionId: version.locationVersionId, status: "ACTIVE",
        displayName: facts.displayName, createdBy: scope.actorUserId, createdAt: new Date(now), updatedAt: new Date(now), deletedAt: null,
      });
      await tx.insert(schema.aiStoryLocationVersions).values({
        locationVersionId: version.locationVersionId, locationId, orgId: scope.orgId, workspaceId: scope.workspaceId,
        campaignId: scope.campaignId, storyId: version.storyId, scope: locationScope, version: 1,
        contractVersion: version.contractVersion, fingerprint: version.fingerprint, status: "ACTIVE",
        supersedesLocationVersionId: null, snapshot: version, createdBy: scope.actorUserId, createdAt: new Date(now),
      });
      return version;
    });
  }

  async read(scope: AiStoryLocationScope, locationId: string, includeDeleted = false) {
    await assertCampaignScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryLocations).where(and(
      eq(schema.aiStoryLocations.locationId, locationId), eq(schema.aiStoryLocations.orgId, scope.orgId),
      eq(schema.aiStoryLocations.workspaceId, scope.workspaceId), eq(schema.aiStoryLocations.campaignId, scope.campaignId),
    )).limit(1);
    const aggregate = rows[0];
    if (!aggregate || (!includeDeleted && aggregate.status !== "ACTIVE") || (aggregate.scope === "STORY_LOCATION" && aggregate.storyId !== scope.storyId)) {
      throw new AiStorySceneAuthorityError("LOCATION_NOT_FOUND", "Location not found in continuity scope");
    }
    const versions = await this.db.select().from(schema.aiStoryLocationVersions).where(eq(schema.aiStoryLocationVersions.locationVersionId, aggregate.currentLocationVersionId)).limit(1);
    if (!versions[0]) throw new AiStorySceneAuthorityError("LOCATION_VERSION_NOT_FOUND", "Location version not found");
    return parseLocation(versions[0]);
  }

  async revise(scope: AiStoryLocationScope, locationId: string, rawFacts: AiStoryLocationFacts, expectedVersion: number, status: "ACTIVE" | "DELETED" = "ACTIVE", now = new Date().toISOString()) {
    const facts = AiStoryLocationFactsSchema.parse(rawFacts);
    return this.db.transaction(async (tx) => {
      await assertCampaignScope(tx, scope, true); await resolveLocationAssets(tx, scope, facts.visualAssetIds);
      const rows = await tx.select().from(schema.aiStoryLocations).where(and(eq(schema.aiStoryLocations.locationId, locationId), eq(schema.aiStoryLocations.campaignId, scope.campaignId), eq(schema.aiStoryLocations.workspaceId, scope.workspaceId))).limit(1).for("update");
      const current = rows[0];
      if (!current || current.status !== "ACTIVE" || current.currentVersion !== expectedVersion || (current.scope === "STORY_LOCATION" && current.storyId !== scope.storyId)) throw new AiStorySceneAuthorityError("LOCATION_VERSION_CONFLICT", "Location authority is missing, stale, or outside scope");
      const version = buildAiStoryLocationVersion({locationId,scope:current.scope as "CAMPAIGN_LOCATION"|"STORY_LOCATION",orgId:scope.orgId,workspaceId:scope.workspaceId,campaignId:scope.campaignId,storyId:current.storyId,version:expectedVersion+1,facts,status,supersedesLocationVersionId:current.currentLocationVersionId,createdBy:scope.actorUserId,createdAt:now});
      await tx.insert(schema.aiStoryLocationVersions).values({locationVersionId:version.locationVersionId,locationId,orgId:scope.orgId,workspaceId:scope.workspaceId,campaignId:scope.campaignId,storyId:current.storyId,scope:current.scope,version:version.version,contractVersion:version.contractVersion,fingerprint:version.fingerprint,status,supersedesLocationVersionId:current.currentLocationVersionId,snapshot:version,createdBy:scope.actorUserId,createdAt:new Date(now)});
      await tx.update(schema.aiStoryLocations).set({currentVersion:version.version,currentLocationVersionId:version.locationVersionId,status,displayName:facts.displayName,updatedAt:new Date(now),deletedAt:status==="DELETED"?new Date(now):null}).where(eq(schema.aiStoryLocations.locationId,locationId));
      return version;
    });
  }

  async promoteEphemeralToStory(scope: AiStoryLocationScope & { storyId: string }, source: Extract<AiStoryLocationReference,{scope:"EPHEMERAL_ENVIRONMENT"}>, facts: AiStoryLocationFacts, now = new Date().toISOString()) {
    if (source.storyId !== scope.storyId) throw new AiStorySceneAuthorityError("LOCATION_PROMOTION_SCOPE_INVALID", "Ephemeral Environment promotion must remain in its Story");
    const targetVersion = await this.add(scope, "STORY_LOCATION", facts, randomUUID(), now);
    const target = {scope:"STORY_LOCATION" as const,id:targetVersion.locationId,storyId:scope.storyId,authorityVersionId:targetVersion.locationVersionId,authorityFingerprint:targetVersion.fingerprint,visualIdentityRequirement:source.visualIdentityRequirement};
    const promotion = AiStoryLocationPromotionSchema.parse({promotionId:randomUUID(),orgId:scope.orgId,workspaceId:scope.workspaceId,campaignId:scope.campaignId,storyId:scope.storyId,source,target,promotedBy:scope.actorUserId,promotedAt:now});
    await this.db.insert(schema.aiStoryLocationPromotions).values({promotionId:promotion.promotionId,orgId:scope.orgId,workspaceId:scope.workspaceId,campaignId:scope.campaignId,storyId:scope.storyId,sourceScope:source.scope,sourceId:source.id,targetScope:target.scope,targetId:target.id,promotion,promotedBy:scope.actorUserId,promotedAt:new Date(now)});
    return promotion;
  }

  async promoteStoryToCampaign(scope: AiStoryLocationScope & { storyId: string }, source: Extract<AiStoryLocationReference,{scope:"STORY_LOCATION"}>, now = new Date().toISOString()) {
    const current = await this.read(scope, source.id);
    if (current.scope!=="STORY_LOCATION" || current.locationVersionId!==source.authorityVersionId || current.fingerprint!==source.authorityFingerprint) throw new AiStorySceneAuthorityError("LOCATION_PROMOTION_LINEAGE_INVALID", "Promotion source must be the exact current Story Location authority");
    const targetVersion = await this.add({...scope,storyId:undefined}, "CAMPAIGN_LOCATION", current.facts, randomUUID(), now);
    const target = {scope:"CAMPAIGN_LOCATION" as const,id:targetVersion.locationId,campaignId:scope.campaignId,authorityVersionId:targetVersion.locationVersionId,authorityFingerprint:targetVersion.fingerprint,visualIdentityRequirement:source.visualIdentityRequirement};
    const promotion = AiStoryLocationPromotionSchema.parse({promotionId:randomUUID(),orgId:scope.orgId,workspaceId:scope.workspaceId,campaignId:scope.campaignId,storyId:scope.storyId,source,target,promotedBy:scope.actorUserId,promotedAt:now});
    await this.db.insert(schema.aiStoryLocationPromotions).values({promotionId:promotion.promotionId,orgId:scope.orgId,workspaceId:scope.workspaceId,campaignId:scope.campaignId,storyId:scope.storyId,sourceScope:source.scope,sourceId:source.id,targetScope:target.scope,targetId:target.id,promotion,promotedBy:scope.actorUserId,promotedAt:new Date(now)});
    return promotion;
  }
}

async function resolveLocations(db: Pick<Db, "select">, scope: AiStoryScriptScope, refs: readonly AiStoryLocationReference[]) {
  const versionIds = refs.flatMap((ref) => ref.scope === "EPHEMERAL_ENVIRONMENT" ? [] : [ref.authorityVersionId]);
  if (!versionIds.length) return [];
  const rows = await db.select().from(schema.aiStoryLocationVersions).where(and(
    inArray(schema.aiStoryLocationVersions.locationVersionId, versionIds), eq(schema.aiStoryLocationVersions.orgId, scope.orgId),
    eq(schema.aiStoryLocationVersions.workspaceId, scope.workspaceId), eq(schema.aiStoryLocationVersions.campaignId, scope.campaignId),
  ));
  return rows.map(parseLocation);
}

export class AiStoryCanonicalSceneAuthorityService {
  constructor(private readonly db: Db = getDb()) {}

  async proposeRevisionSet(scope: AiStoryScriptScope, scenes: readonly AiStoryCanonicalScene[]) {
    const parsed = scenes.map((scene) => AiStoryCanonicalSceneSchema.parse(scene));
    if (parsed.some((scene) => scene.status !== "DRAFT" || scene.createdBy !== scope.actorUserId)) throw new AiStorySceneAuthorityError("SCENE_PROPOSAL_INVALID", "New canonical Scene revisions must be DRAFT proposals by the scoped actor");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`canonical-scenes:${scope.storyVersionId}`}))`);
      await assertStoryScope(tx, scope, true);
      const scriptRows = await tx.select().from(schema.aiStoryScriptVersions).where(and(eq(schema.aiStoryScriptVersions.scriptVersionId, parsed[0]?.scriptVersionId ?? "00000000-0000-0000-0000-000000000000"),eq(schema.aiStoryScriptVersions.storyId,scope.storyId),eq(schema.aiStoryScriptVersions.storyVersionId,scope.storyVersionId),eq(schema.aiStoryScriptVersions.status,"FROZEN"))).limit(1).for("share");
      if (!scriptRows[0]) throw new AiStorySceneAuthorityError("SCENE_SCRIPT_NOT_FROZEN", "Canonical Scenes require the exact frozen Script Version");
      const script = scriptRows[0].script;
      const locations = await resolveLocations(tx, scope, parsed.map((scene) => scene.locationBinding));
      const castRefs = parsed.flatMap((scene) => scene.castBindings);
      const knownCast = await resolveKnownCastReferences(tx, scope, castRefs);
      if (castRefs.some((ref) => !knownCast.has(`${ref.scope}:${ref.id}`))) throw new AiStorySceneAuthorityError("SCENE_CAST_BINDING_INVALID", "Scene Cast binding does not resolve in canonical scope");
      const productIds = [...new Set(parsed.flatMap((scene) => scene.productBindings.map((product) => product.sourceAssetId)))];
      if (productIds.length) {
        const assets = await tx.select({id:schema.assets.id,contentHash:schema.assets.contentHash}).from(schema.assets).where(and(inArray(schema.assets.id,productIds),eq(schema.assets.orgId,scope.orgId),eq(schema.assets.workspaceId,scope.workspaceId),isNull(schema.assets.deletedAt)));
        if (assets.length!==productIds.length || parsed.some((scene)=>scene.productBindings.some((binding)=>assets.find((asset)=>asset.id===binding.sourceAssetId)?.contentHash!==binding.sourceAssetContentHash))) throw new AiStorySceneAuthorityError("SCENE_PRODUCT_BINDING_INVALID","Scene Product binding does not resolve to exact private Asset authority");
      }
      const issues = validateAiStoryCanonicalScenes(parsed, script, locations);
      if (issues.some((issue) => issue.severity === "BLOCK")) throw new AiStorySceneAuthorityError("SCENE_VALIDATION_FAILED", JSON.stringify(issues));
      for (const scene of parsed) {
        const aggregates = await tx.select().from(schema.aiStoryCanonicalScenes).where(and(eq(schema.aiStoryCanonicalScenes.sceneId,scene.sceneId),eq(schema.aiStoryCanonicalScenes.storyId,scope.storyId))).limit(1).for("update");
        const aggregate = aggregates[0];
        if (aggregate && (scene.version!==aggregate.currentVersion+1 || !scene.parentSceneVersionIds.includes(aggregate.currentSceneVersionId))) throw new AiStorySceneAuthorityError("SCENE_VERSION_LINEAGE_INVALID","Scene revision must extend its current version exactly once");
        if (!aggregate && scene.version!==1) throw new AiStorySceneAuthorityError("SCENE_VERSION_LINEAGE_INVALID","New Scene identity must begin at version 1");
        if (aggregate) {
          await tx.update(schema.aiStoryCanonicalSceneVersions).set({status:"SUPERSEDED"}).where(eq(schema.aiStoryCanonicalSceneVersions.sceneVersionId,aggregate.currentSceneVersionId));
          await tx.update(schema.aiStoryCanonicalScenes).set({currentVersion:scene.version,currentSceneVersionId:scene.sceneVersionId,status:"DRAFT",updatedAt:new Date(scene.createdAt)}).where(eq(schema.aiStoryCanonicalScenes.sceneId,scene.sceneId));
        } else {
          await tx.insert(schema.aiStoryCanonicalScenes).values({sceneId:scene.sceneId,orgId:scene.orgId,workspaceId:scene.workspaceId,campaignId:scene.campaignId,storyId:scene.storyId,currentVersion:scene.version,currentSceneVersionId:scene.sceneVersionId,status:"DRAFT",createdBy:scene.createdBy,createdAt:new Date(scene.createdAt),updatedAt:new Date(scene.createdAt)});
        }
        await tx.insert(schema.aiStoryCanonicalSceneVersions).values({sceneVersionId:scene.sceneVersionId,sceneId:scene.sceneId,orgId:scene.orgId,workspaceId:scene.workspaceId,campaignId:scene.campaignId,storyId:scene.storyId,storyVersionId:scene.storyVersionId,scriptVersionId:scene.scriptVersionId,version:scene.version,sceneOrder:scene.order,contractVersion:scene.contractVersion,sourceHash:scene.sourceHash,fingerprint:scene.fingerprint,status:"DRAFT",snapshot:scene,createdBy:scene.createdBy,createdAt:new Date(scene.createdAt),approvedBy:null,approvedAt:null,frozenAt:null});
      }
      return parsed;
    });
  }

  async readCurrentSet(scope: AiStoryScriptScope) {
    await assertStoryScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryCanonicalSceneVersions)
      .innerJoin(schema.aiStoryCanonicalScenes, eq(schema.aiStoryCanonicalScenes.currentSceneVersionId, schema.aiStoryCanonicalSceneVersions.sceneVersionId))
      .where(and(eq(schema.aiStoryCanonicalSceneVersions.storyVersionId,scope.storyVersionId),eq(schema.aiStoryCanonicalSceneVersions.workspaceId,scope.workspaceId),eq(schema.aiStoryCanonicalSceneVersions.storyId,scope.storyId)))
      .orderBy(asc(schema.aiStoryCanonicalSceneVersions.sceneOrder));
    return rows.map((row) => parseScene(row.ai_story_canonical_scene_versions));
  }

  async transitionSet(scope: AiStoryScriptScope, to: "VALIDATED"|"APPROVED"|"FROZEN", at = new Date().toISOString()) {
    return this.db.transaction(async (tx) => {
      await assertStoryScope(tx, scope, true);
      const rows = await tx.select().from(schema.aiStoryCanonicalSceneVersions).innerJoin(schema.aiStoryCanonicalScenes,eq(schema.aiStoryCanonicalScenes.currentSceneVersionId,schema.aiStoryCanonicalSceneVersions.sceneVersionId)).where(and(eq(schema.aiStoryCanonicalSceneVersions.storyVersionId,scope.storyVersionId),eq(schema.aiStoryCanonicalSceneVersions.storyId,scope.storyId))).orderBy(asc(schema.aiStoryCanonicalSceneVersions.sceneOrder)).for("update");
      if (!rows.length) throw new AiStorySceneAuthorityError("SCENE_SET_NOT_FOUND","Canonical Scene set not found");
      const current = rows.map((row)=>parseScene(row.ai_story_canonical_scene_versions));
      current.forEach((scene)=>assertAiStorySceneTransition(scene.status,to));
      if(to==="VALIDATED"){
        const scriptRows=await tx.select().from(schema.aiStoryScriptVersions).where(eq(schema.aiStoryScriptVersions.scriptVersionId,current[0]!.scriptVersionId)).limit(1);
        const locations=await resolveLocations(tx,scope,current.map((scene)=>scene.locationBinding));
        if(!scriptRows[0]||validateAiStoryCanonicalScenes(current,scriptRows[0].script,locations).some((issue)=>issue.severity==="BLOCK")) throw new AiStorySceneAuthorityError("SCENE_VALIDATION_FAILED","Canonical Scene set failed deterministic gates");
      }
      const next=current.map((scene)=>AiStoryCanonicalSceneSchema.parse({...scene,status:to,approvedBy:to==="APPROVED"?scope.actorUserId:scene.approvedBy,approvedAt:to==="APPROVED"?at:scene.approvedAt,frozenAt:to==="FROZEN"?at:scene.frozenAt}));
      for(const scene of next){await tx.update(schema.aiStoryCanonicalSceneVersions).set({status:to,snapshot:scene,approvedBy:scene.approvedBy,approvedAt:scene.approvedAt?new Date(scene.approvedAt):null,frozenAt:scene.frozenAt?new Date(scene.frozenAt):null}).where(eq(schema.aiStoryCanonicalSceneVersions.sceneVersionId,scene.sceneVersionId));await tx.update(schema.aiStoryCanonicalScenes).set({status:to,updatedAt:new Date(at)}).where(eq(schema.aiStoryCanonicalScenes.sceneId,scene.sceneId));}
      return next;
    });
  }
}
