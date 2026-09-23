import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  AiStoryReusableCharacterError,
  applyEpisodeLookPolicy,
  reusableCharacterSelectable,
  type AiStoryCharacterContinuityAnchor,
  type AiStoryCharacterEpisodeLook,
  type AiStoryReusableCharacterVersion,
  AiStoryCharacterContinuityAnchorSchema,
  AiStoryEpisodeCharacterBindingSchema,
  AiStoryReusableCharacterCampaignProjectionSchema,
  AiStoryReusableCharacterVersionSchema,
} from "@ceo-agent/shared";
import {
  buildAiStoryReusableCharacterVersion,
  buildCampaignProjectionFromReusableCharacter,
  buildEpisodeCharacterBinding,
  computeReusableCharacterIdentityFingerprint,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { persistSameWorkspaceCampaignAssetRef } from "./campaign-asset-refs";
import { AiStoryCharacterAuthorityService } from "./ai-story-character";

export { AiStoryReusableCharacterError };

type Db = ReturnType<typeof getDb>;

export function isApprovedPrivateSyntheticIdentityAnchorAsset(input: {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string | null;
  readonly type: string;
  readonly mimeType: string | null;
  readonly storagePath: string;
  readonly status: string;
  readonly contentHash: string | null;
  readonly metadata: unknown;
  readonly deletedAt: Date | null;
  readonly expectedOrgId: string;
  readonly expectedWorkspaceId: string;
}): boolean {
  const metadata = (input.metadata ?? {}) as Record<string, unknown>;
  return (
    !input.deletedAt &&
    input.orgId === input.expectedOrgId &&
    input.workspaceId === input.expectedWorkspaceId &&
    input.campaignId === null &&
    input.type === "image" &&
    Boolean(input.contentHash) &&
    input.mimeType?.toLowerCase().startsWith("image/") === true &&
    input.status === "ready" &&
    input.storagePath.startsWith(`${input.expectedWorkspaceId}/`) &&
    !/^https?:\/\//i.test(input.storagePath) &&
    metadata.characterAssetSemantic === "SYNTHETIC_IDENTITY_ANCHOR" &&
    metadata.humanApproved === true
  );
}
export type AiStoryReusableCharacterScope = { orgId: string; workspaceId: string; actorUserId: string };
export type ReusableCharacterInput = {
  name: string;
  identityCore: AiStoryReusableCharacterVersion["identityCore"];
  defaultLook: AiStoryReusableCharacterVersion["defaultLook"];
  mutableLookPolicy: AiStoryReusableCharacterVersion["mutableLookPolicy"];
  canonicalAssets: Array<{ assetId: string; role: AiStoryReusableCharacterVersion["canonicalAssets"][number]["role"]; source?: "USER_APPROVED" | "PROMOTED_CAMPAIGN_CHARACTER" }>;
  identityMode?: AiStoryReusableCharacterVersion["identityMode"];
  characterDna?: AiStoryReusableCharacterVersion["characterDna"];
  characterDnaFingerprint?: string;
};

async function assertWorkspaceScope(db: Pick<Db, "execute">, scope: AiStoryReusableCharacterScope, mutation: boolean) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(
    select 1 from workspaces w where w.id=${scope.workspaceId}::uuid and w.org_id=${scope.orgId}::uuid
      and exists(
        select 1 from workspace_members wm where wm.workspace_id=${scope.workspaceId}::uuid
          and wm.user_id=${scope.actorUserId}::uuid
          and (${mutation}=false or wm.role in ('admin','operator'))
      )
  ) as ok`);
  if (!rows[0]?.ok) throw new AiStoryReusableCharacterError("REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE", "Reusable Character Workspace authority does not resolve");
}

async function resolveCanonicalAssets(
  db: Pick<Db, "select">,
  scope: AiStoryReusableCharacterScope,
  assets: ReusableCharacterInput["canonicalAssets"],
  identityMode: AiStoryReusableCharacterVersion["identityMode"] = "VISUAL_REFERENCE"
) {
  if (identityMode !== "CHARACTER_DNA") {
    if (!assets.length) throw new AiStoryReusableCharacterError("CANONICAL_IDENTITY_ROOT_GATE", "Reusable Character requires canonical identity assets");
    if (!assets.some((asset) => asset.role === "IDENTITY_MASTER")) {
      throw new AiStoryReusableCharacterError("CANONICAL_IDENTITY_ROOT_GATE", "Reusable Character requires one IDENTITY_MASTER");
    }
  } else if (assets.some((asset) => asset.role === "IDENTITY_MASTER")) {
    throw new AiStoryReusableCharacterError("SOURCE_PORTRAIT_NOT_IDENTITY_MASTER", "Character DNA source portrait cannot become IDENTITY_MASTER");
  }
  const resolved = [];
  for (const asset of assets) {
    const rows = await db.select({
      id: schema.assets.id,
      contentHash: schema.assets.contentHash,
      type: schema.assets.type,
      mimeType: schema.assets.mimeType,
      storagePath: schema.assets.storagePath,
      campaignId: schema.assets.campaignId,
      status: schema.assets.status,
      metadata: schema.assets.metadata,
      deletedAt: schema.assets.deletedAt,
      orgId: schema.assets.orgId,
      workspaceId: schema.assets.workspaceId,
    }).from(schema.assets).where(eq(schema.assets.id, asset.assetId)).limit(1);
    const row = rows[0];
    if (!row || row.deletedAt) throw new AiStoryReusableCharacterError("CHARACTER_ASSET_MISSING", "Canonical Character asset is missing");
    if (row.orgId !== scope.orgId || row.workspaceId !== scope.workspaceId) {
      throw new AiStoryReusableCharacterError("REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE", "Cross-workspace Character asset is blocked");
    }
    if (row.type !== "image" || !row.contentHash) {
      throw new AiStoryReusableCharacterError("CHARACTER_ASSET_REFERENCE_INVALID", "Canonical Character asset must be a finalized image");
    }
    if (
      asset.role === "CHARACTER_SOURCE_PORTRAIT" &&
      ((row.metadata ?? {}) as Record<string, unknown>).characterAssetSemantic !==
        "CHARACTER_SOURCE_PORTRAIT"
    ) {
      throw new AiStoryReusableCharacterError(
        "SOURCE_PORTRAIT_NOT_FINAL",
        "Character DNA provenance must use a CHARACTER_SOURCE_PORTRAIT asset"
      );
    }
    if (asset.role === "SYNTHETIC_IDENTITY_ANCHOR") {
      if (!isApprovedPrivateSyntheticIdentityAnchorAsset({
        ...row,
        expectedOrgId: scope.orgId,
        expectedWorkspaceId: scope.workspaceId,
      })) {
        throw new AiStoryReusableCharacterError(
          "SYNTHETIC_IDENTITY_ANCHOR_INVALID",
          "Synthetic identity anchor must be an approved private Workspace Asset Library image"
        );
      }
    }
    resolved.push({
      assetId: row.id,
      contentHash: row.contentHash,
      role: asset.role,
      source: asset.source ?? "USER_APPROVED" as const,
    });
  }
  return resolved;
}

export class AiStoryReusableCharacterService {
  constructor(private readonly db: Db = getDb()) {}

  private parseVersion(row: typeof schema.aiStoryReusableCharacterVersions.$inferSelect) {
    const parsed = AiStoryReusableCharacterVersionSchema.parse(row.snapshot);
    if (computeReusableCharacterIdentityFingerprint(parsed) !== parsed.identityFingerprint) {
      throw new AiStoryReusableCharacterError("CHARACTER_FINGERPRINT_INVALID", "Reusable Character identity fingerprint mismatch");
    }
    return parsed;
  }

  async create(scope: AiStoryReusableCharacterScope, input: ReusableCharacterInput, reusableCharacterId = randomUUID(), now = new Date().toISOString()) {
    return this.db.transaction(async (tx) => {
      await assertWorkspaceScope(tx, scope, true);
      const canonicalAssets = await resolveCanonicalAssets(tx, scope, input.canonicalAssets, input.identityMode);
      const version = buildAiStoryReusableCharacterVersion({
        reusableCharacterId, orgId: scope.orgId, workspaceId: scope.workspaceId, name: input.name,
        identityCore: input.identityCore, defaultLook: input.defaultLook, mutableLookPolicy: input.mutableLookPolicy,
        canonicalAssets, status: "ACTIVE", version: 1, supersedesReusableCharacterVersionId: null,
        createdBy: scope.actorUserId, createdAt: now,
        identityMode: input.identityMode,
        characterDna: input.characterDna,
        characterDnaFingerprint: input.characterDnaFingerprint,
      });
      await tx.insert(schema.aiStoryReusableCharacters).values({
        reusableCharacterId, orgId: scope.orgId, workspaceId: scope.workspaceId, currentVersion: 1,
        currentReusableCharacterVersionId: version.reusableCharacterVersionId, status: "ACTIVE", name: version.name,
        createdBy: scope.actorUserId, createdAt: new Date(now), updatedAt: new Date(now), archivedAt: null, deletedAt: null,
      });
      await tx.insert(schema.aiStoryReusableCharacterVersions).values({
        reusableCharacterVersionId: version.reusableCharacterVersionId, reusableCharacterId, orgId: scope.orgId,
        workspaceId: scope.workspaceId, version: 1, contractVersion: version.contractVersion, fingerprint: version.fingerprint,
        identityFingerprint: version.identityFingerprint, status: "ACTIVE", supersedesReusableCharacterVersionId: null,
        snapshot: version, createdBy: scope.actorUserId, createdAt: new Date(now),
      });
      return version;
    });
  }

  async edit(scope: AiStoryReusableCharacterScope, reusableCharacterId: string, input: ReusableCharacterInput, expectedVersion: number, now = new Date().toISOString()) {
    return this.mutate(scope, reusableCharacterId, expectedVersion, "ACTIVE", input, now);
  }

  async archive(scope: AiStoryReusableCharacterScope, reusableCharacterId: string, expectedVersion: number, now = new Date().toISOString()) {
    const current = await this.readCurrent(scope, reusableCharacterId, true);
    return this.mutate(scope, reusableCharacterId, expectedVersion, "ARCHIVED", {
      name: current.name, identityCore: current.identityCore, defaultLook: current.defaultLook,
      mutableLookPolicy: current.mutableLookPolicy,
      canonicalAssets: current.canonicalAssets.map((asset) => ({ assetId: asset.assetId, role: asset.role, source: asset.source })),
      identityMode: current.identityMode,
      characterDna: current.characterDna,
      characterDnaFingerprint: current.characterDnaFingerprint,
    }, now);
  }

  private async mutate(
    scope: AiStoryReusableCharacterScope,
    reusableCharacterId: string,
    expectedVersion: number,
    status: AiStoryReusableCharacterVersion["status"],
    input: ReusableCharacterInput,
    now: string
  ) {
    return this.db.transaction(async (tx) => {
      await assertWorkspaceScope(tx, scope, true);
      const aggregates = await tx.select().from(schema.aiStoryReusableCharacters).where(and(
        eq(schema.aiStoryReusableCharacters.reusableCharacterId, reusableCharacterId),
        eq(schema.aiStoryReusableCharacters.orgId, scope.orgId),
        eq(schema.aiStoryReusableCharacters.workspaceId, scope.workspaceId),
      )).limit(1).for("update");
      const aggregate = aggregates[0];
      if (!aggregate || aggregate.status === "DELETED") throw new AiStoryReusableCharacterError("CHARACTER_NOT_ACTIVE", "Reusable Character is not active");
      if (aggregate.currentVersion !== expectedVersion) throw new AiStoryReusableCharacterError("CHARACTER_VERSION_CONFLICT", "Reusable Character was changed by another operation");
      const canonicalAssets = await resolveCanonicalAssets(tx, scope, input.canonicalAssets, input.identityMode);
      const version = buildAiStoryReusableCharacterVersion({
        reusableCharacterId, orgId: scope.orgId, workspaceId: scope.workspaceId, name: input.name,
        identityCore: input.identityCore, defaultLook: input.defaultLook, mutableLookPolicy: input.mutableLookPolicy,
        canonicalAssets, status, version: aggregate.currentVersion + 1,
        supersedesReusableCharacterVersionId: aggregate.currentReusableCharacterVersionId,
        createdBy: scope.actorUserId, createdAt: now,
        identityMode: input.identityMode,
        characterDna: input.characterDna,
        characterDnaFingerprint: input.characterDnaFingerprint,
      });
      await tx.insert(schema.aiStoryReusableCharacterVersions).values({
        reusableCharacterVersionId: version.reusableCharacterVersionId, reusableCharacterId, orgId: scope.orgId,
        workspaceId: scope.workspaceId, version: version.version, contractVersion: version.contractVersion,
        fingerprint: version.fingerprint, identityFingerprint: version.identityFingerprint, status,
        supersedesReusableCharacterVersionId: aggregate.currentReusableCharacterVersionId, snapshot: version,
        createdBy: scope.actorUserId, createdAt: new Date(now),
      });
      await tx.update(schema.aiStoryReusableCharacters).set({
        currentVersion: version.version, currentReusableCharacterVersionId: version.reusableCharacterVersionId,
        status, name: version.name, updatedAt: new Date(now),
        archivedAt: status === "ARCHIVED" ? new Date(now) : aggregate.archivedAt,
        deletedAt: status === "DELETED" ? new Date(now) : aggregate.deletedAt,
      }).where(eq(schema.aiStoryReusableCharacters.reusableCharacterId, reusableCharacterId));
      return version;
    });
  }

  async list(scope: AiStoryReusableCharacterScope, includeArchived = false) {
    await assertWorkspaceScope(this.db, scope, false);
    const rows = await this.db.select({ snapshot: schema.aiStoryReusableCharacterVersions.snapshot, status: schema.aiStoryReusableCharacters.status })
      .from(schema.aiStoryReusableCharacters)
      .innerJoin(schema.aiStoryReusableCharacterVersions, eq(
        schema.aiStoryReusableCharacterVersions.reusableCharacterVersionId,
        schema.aiStoryReusableCharacters.currentReusableCharacterVersionId
      ))
      .where(and(
        eq(schema.aiStoryReusableCharacters.orgId, scope.orgId),
        eq(schema.aiStoryReusableCharacters.workspaceId, scope.workspaceId),
        ...(includeArchived ? [] : [eq(schema.aiStoryReusableCharacters.status, "ACTIVE")]),
      ))
      .orderBy(asc(schema.aiStoryReusableCharacters.name));
    return rows.map((row) => AiStoryReusableCharacterVersionSchema.parse(row.snapshot));
  }

  async readCurrent(scope: AiStoryReusableCharacterScope, reusableCharacterId: string, includeArchived = false) {
    await assertWorkspaceScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryReusableCharacters).where(and(
      eq(schema.aiStoryReusableCharacters.reusableCharacterId, reusableCharacterId),
      eq(schema.aiStoryReusableCharacters.orgId, scope.orgId),
      eq(schema.aiStoryReusableCharacters.workspaceId, scope.workspaceId),
    )).limit(1);
    if (!rows[0] || (!includeArchived && rows[0].status !== "ACTIVE")) {
      throw new AiStoryReusableCharacterError("CHARACTER_NOT_FOUND", "Reusable Character not found in this Workspace");
    }
    return this.readVersion(scope, rows[0].currentReusableCharacterVersionId);
  }

  async readVersion(scope: AiStoryReusableCharacterScope, reusableCharacterVersionId: string) {
    await assertWorkspaceScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryReusableCharacterVersions).where(and(
      eq(schema.aiStoryReusableCharacterVersions.reusableCharacterVersionId, reusableCharacterVersionId),
      eq(schema.aiStoryReusableCharacterVersions.orgId, scope.orgId),
      eq(schema.aiStoryReusableCharacterVersions.workspaceId, scope.workspaceId),
    )).limit(1);
    if (!rows[0]) throw new AiStoryReusableCharacterError("CHARACTER_VERSION_PINNING_GATE", "Pinned reusable Character version was not found");
    return this.parseVersion(rows[0]);
  }

  async history(scope: AiStoryReusableCharacterScope, reusableCharacterId: string) {
    await assertWorkspaceScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryReusableCharacterVersions).where(and(
      eq(schema.aiStoryReusableCharacterVersions.reusableCharacterId, reusableCharacterId),
      eq(schema.aiStoryReusableCharacterVersions.workspaceId, scope.workspaceId),
    )).orderBy(asc(schema.aiStoryReusableCharacterVersions.version));
    return rows.map((row) => this.parseVersion(row));
  }

  async projectToCampaign(scope: AiStoryReusableCharacterScope, input: {
    reusableCharacterVersionId: string;
    campaignId: string;
    now?: string;
  }) {
    const now = input.now ?? new Date().toISOString();
    return this.db.transaction(async (tx) => {
      await assertWorkspaceScope(tx, scope, true);
      const campaigns = await tx.select().from(schema.campaigns).where(and(
        eq(schema.campaigns.id, input.campaignId),
        eq(schema.campaigns.orgId, scope.orgId),
        eq(schema.campaigns.workspaceId, scope.workspaceId),
      )).limit(1);
      if (!campaigns[0]) throw new AiStoryReusableCharacterError("CHARACTER_CAMPAIGN_SCOPE_GATE", "Campaign is not in this Workspace");
      const reusable = await this.readVersion(scope, input.reusableCharacterVersionId);
      const existing = await tx.select().from(schema.aiStoryReusableCharacterCampaignProjections).where(and(
        eq(schema.aiStoryReusableCharacterCampaignProjections.reusableCharacterVersionId, reusable.reusableCharacterVersionId),
        eq(schema.aiStoryReusableCharacterCampaignProjections.campaignId, input.campaignId),
      )).limit(1);
      if (existing[0]) return AiStoryReusableCharacterCampaignProjectionSchema.parse(existing[0].snapshot);
      for (const asset of reusable.canonicalAssets) {
        await persistSameWorkspaceCampaignAssetRef(tx, {
          campaignId: input.campaignId, assetId: asset.assetId, workspaceId: scope.workspaceId, orgId: scope.orgId,
        });
      }
      const prior = await tx.select().from(schema.aiStoryReusableCharacterCampaignProjections).where(and(
        eq(schema.aiStoryReusableCharacterCampaignProjections.reusableCharacterId, reusable.reusableCharacterId),
        eq(schema.aiStoryReusableCharacterCampaignProjections.campaignId, input.campaignId),
      )).orderBy(desc(schema.aiStoryReusableCharacterCampaignProjections.createdAt)).limit(1);
      const campaignCharacterId = prior[0]?.campaignCharacterId ?? randomUUID();
      let campaignVersionNumber = 1;
      if (prior[0]) {
        const aggregates = await tx.select().from(schema.aiStoryCharacters).where(eq(schema.aiStoryCharacters.characterId, campaignCharacterId)).limit(1).for("update");
        campaignVersionNumber = (aggregates[0]?.currentVersion ?? 0) + 1;
      }
      const built = buildCampaignProjectionFromReusableCharacter({
        reusable, campaignId: input.campaignId, campaignCharacterId,
        campaignCharacterVersionNumber: campaignVersionNumber,
        supersedesCharacterVersionId: prior[0]?.campaignCharacterVersionId ?? null,
        createdBy: scope.actorUserId, createdAt: now,
      });
      const campaignCharacter = built.campaignCharacter;
      if (!prior[0]) {
        await tx.insert(schema.aiStoryCharacters).values({
          characterId: campaignCharacter.characterId, orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: input.campaignId,
          currentVersion: 1, currentCharacterVersionId: campaignCharacter.characterVersionId, status: "ACTIVE",
          name: campaignCharacter.name, createdBy: scope.actorUserId, createdAt: new Date(now), updatedAt: new Date(now), deletedAt: null,
        });
      }
      await tx.insert(schema.aiStoryCharacterVersions).values({
        characterVersionId: campaignCharacter.characterVersionId, characterId: campaignCharacter.characterId, orgId: scope.orgId,
        workspaceId: scope.workspaceId, campaignId: input.campaignId, version: campaignCharacter.version,
        contractVersion: campaignCharacter.contractVersion, fingerprint: campaignCharacter.fingerprint, status: "ACTIVE",
        supersedesCharacterVersionId: prior[0]?.campaignCharacterVersionId ?? null, snapshot: campaignCharacter,
        createdBy: scope.actorUserId, createdAt: new Date(now),
      });
      if (prior[0]) {
        await tx.update(schema.aiStoryCharacters).set({
          currentVersion: campaignCharacter.version, currentCharacterVersionId: campaignCharacter.characterVersionId,
          name: campaignCharacter.name, updatedAt: new Date(now),
        }).where(eq(schema.aiStoryCharacters.characterId, campaignCharacterId));
      }
      const projection = built.projection;
      await tx.insert(schema.aiStoryReusableCharacterCampaignProjections).values({
        projectionId: projection.projectionId, orgId: scope.orgId, workspaceId: scope.workspaceId,
        reusableCharacterId: reusable.reusableCharacterId, reusableCharacterVersionId: reusable.reusableCharacterVersionId,
        reusableCharacterFingerprint: reusable.fingerprint, campaignId: input.campaignId,
        campaignCharacterId: projection.campaignCharacterId, campaignCharacterVersionId: projection.campaignCharacterVersionId,
        campaignCharacterFingerprint: projection.campaignCharacterFingerprint, projectionFingerprint: projection.projectionFingerprint,
        snapshot: projection, createdAt: new Date(now),
      });
      return projection;
    });
  }

  async bindEpisode(scope: AiStoryReusableCharacterScope, input: {
    storyId: string;
    reusableCharacterVersionId?: string;
    reusableCharacterId?: string;
    campaignId: string;
    episodeLook?: AiStoryCharacterEpisodeLook;
    continuityAnchorIds?: string[];
    now?: string;
  }) {
    const now = input.now ?? new Date().toISOString();
    await assertWorkspaceScope(this.db, scope, true);
    const stories = await this.db.select().from(schema.aiStories).where(and(
      eq(schema.aiStories.id, input.storyId),
      eq(schema.aiStories.workspaceId, scope.workspaceId),
      eq(schema.aiStories.campaignId, input.campaignId),
    )).limit(1);
    if (!stories[0]) throw new AiStoryReusableCharacterError("CHARACTER_CAMPAIGN_SCOPE_GATE", "Episode is not in this Campaign");
    const reusable = input.reusableCharacterVersionId
      ? await this.readVersion(scope, input.reusableCharacterVersionId)
      : await this.readCurrent(scope, input.reusableCharacterId!, true);
    if (!reusableCharacterSelectable(reusable.status)) {
      throw new AiStoryReusableCharacterError("CHARACTER_NOT_ACTIVE", "Archived reusable Character cannot be selected for new Episodes");
    }
    const lookIssues = applyEpisodeLookPolicy({
      policy: reusable.mutableLookPolicy,
      look: input.episodeLook ?? {
        wardrobe: null, makeup: null, accessories: null, hairstyle: null, hairColor: null,
        expression: null, pose: null, location: null, action: null, product: null, dialogue: null,
      },
      identityCore: reusable.identityCore,
    });
    if (lookIssues.length) throw new AiStoryReusableCharacterError(lookIssues[0]!.gate, lookIssues[0]!.message);
    const projection = await this.projectToCampaign(scope, { reusableCharacterVersionId: reusable.reusableCharacterVersionId, campaignId: input.campaignId, now });
    const binding = buildEpisodeCharacterBinding({
      storyId: input.storyId, reusable, projection, episodeLook: input.episodeLook,
      continuityAnchorIds: input.continuityAnchorIds, createdBy: scope.actorUserId, createdAt: now,
    });
    const existingBinding = await this.db.select().from(schema.aiStoryEpisodeCharacterBindings).where(and(
      eq(schema.aiStoryEpisodeCharacterBindings.storyId, input.storyId),
      eq(schema.aiStoryEpisodeCharacterBindings.reusableCharacterId, binding.reusableCharacterId),
      eq(schema.aiStoryEpisodeCharacterBindings.bindingFingerprint, binding.bindingFingerprint),
      eq(schema.aiStoryEpisodeCharacterBindings.workspaceId, scope.workspaceId),
    )).limit(1);
    if (existingBinding[0]) {
      return { reusable, projection, binding: AiStoryEpisodeCharacterBindingSchema.parse(existingBinding[0].snapshot) };
    }
    await this.db.insert(schema.aiStoryEpisodeCharacterBindings).values({
      episodeCharacterBindingId: binding.episodeCharacterBindingId, orgId: scope.orgId, workspaceId: scope.workspaceId,
      storyId: input.storyId, episodeId: binding.episodeId, reusableCharacterId: binding.reusableCharacterId,
      reusableCharacterVersionId: binding.reusableCharacterVersionId, campaignCharacterId: binding.campaignCharacterId,
      campaignCharacterVersionId: binding.campaignCharacterVersionId, identityFingerprint: binding.identityFingerprint,
      bindingFingerprint: binding.bindingFingerprint, snapshot: binding, createdBy: scope.actorUserId, createdAt: new Date(now),
    });
    return { reusable, projection, binding };
  }

  async currentEpisodeBinding(scope: AiStoryReusableCharacterScope, storyId: string, reusableCharacterId: string) {
    await assertWorkspaceScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryEpisodeCharacterBindings).where(and(
      eq(schema.aiStoryEpisodeCharacterBindings.storyId, storyId),
      eq(schema.aiStoryEpisodeCharacterBindings.reusableCharacterId, reusableCharacterId),
      eq(schema.aiStoryEpisodeCharacterBindings.workspaceId, scope.workspaceId),
    )).orderBy(desc(schema.aiStoryEpisodeCharacterBindings.createdAt)).limit(1);
    return rows[0] ? AiStoryEpisodeCharacterBindingSchema.parse(rows[0].snapshot) : null;
  }

  async listEpisodeBindings(scope: AiStoryReusableCharacterScope, storyId: string) {
    await assertWorkspaceScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryEpisodeCharacterBindings).where(and(
      eq(schema.aiStoryEpisodeCharacterBindings.storyId, storyId),
      eq(schema.aiStoryEpisodeCharacterBindings.workspaceId, scope.workspaceId),
    )).orderBy(desc(schema.aiStoryEpisodeCharacterBindings.createdAt));
    return rows.map((row) => AiStoryEpisodeCharacterBindingSchema.parse(row.snapshot));
  }

  async promoteFromCampaignCharacter(scope: AiStoryReusableCharacterScope, input: {
    campaignId: string;
    campaignCharacterId: string;
    now?: string;
  }) {
    const campaignCharacter = await new AiStoryCharacterAuthorityService(this.db).read({
      orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: input.campaignId, actorUserId: scope.actorUserId,
    }, input.campaignCharacterId);
    if (!campaignCharacter.visualAssetReferences.length) {
      throw new AiStoryReusableCharacterError("CANONICAL_IDENTITY_ROOT_GATE", "Promotion requires an approved Character visual identity asset");
    }
    return this.create(scope, {
      name: campaignCharacter.name,
      identityCore: {
        identityDescription: campaignCharacter.canonicalFacts.identity,
        faceIdentityDescription: campaignCharacter.canonicalFacts.appearance,
        bodyIdentityDescription: campaignCharacter.canonicalFacts.appearance,
        distinctiveVisualFacts: [],
        mustPreserve: ["face identity", "body proportions"],
        mustNeverChange: ["canonical face identity"],
      },
      defaultLook: {
        wardrobe: campaignCharacter.canonicalFacts.appearance,
        makeup: null,
        accessories: null,
        hairstyle: null,
        hairColor: null,
      },
      mutableLookPolicy: {
        wardrobeAllowed: true, makeupAllowed: true, accessoriesAllowed: true, hairstyleAllowed: true, hairColorAllowed: false,
      },
      canonicalAssets: campaignCharacter.visualAssetReferences.map((asset, index) => ({
        assetId: asset.assetId,
        role: index === 0 ? "IDENTITY_MASTER" as const : "FRONT_PORTRAIT" as const,
        source: "PROMOTED_CAMPAIGN_CHARACTER" as const,
      })),
    }, undefined, input.now);
  }

  async approveContinuityAnchor(scope: AiStoryReusableCharacterScope, input: {
    reusableCharacterVersionId: string;
    sourceEpisodeId: string;
    sourceGenerationUnitId: string;
    sourceResultId: string;
    assetId: string;
    frameTimestampMs?: number | null;
    now?: string;
  }): Promise<AiStoryCharacterContinuityAnchor> {
    const now = input.now ?? new Date().toISOString();
    await assertWorkspaceScope(this.db, scope, true);
    const reusable = await this.readVersion(scope, input.reusableCharacterVersionId);
    const assets = await this.db.select().from(schema.assets).where(eq(schema.assets.id, input.assetId)).limit(1);
    const asset = assets[0];
    if (!asset || asset.deletedAt) throw new AiStoryReusableCharacterError("CHARACTER_ASSET_MISSING", "Continuity anchor asset is missing");
    if (asset.workspaceId !== scope.workspaceId || asset.orgId !== scope.orgId) {
      throw new AiStoryReusableCharacterError("REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE", "Cross-workspace continuity anchor is blocked");
    }
    if (!asset.contentHash) throw new AiStoryReusableCharacterError("CHARACTER_ASSET_REFERENCE_INVALID", "Continuity anchor content hash is missing");
    const anchor = AiStoryCharacterContinuityAnchorSchema.parse({
      anchorId: randomUUID(),
      reusableCharacterId: reusable.reusableCharacterId,
      reusableCharacterVersionId: reusable.reusableCharacterVersionId,
      sourceEpisodeId: input.sourceEpisodeId,
      sourceGenerationUnitId: input.sourceGenerationUnitId,
      sourceResultId: input.sourceResultId,
      assetId: asset.id,
      contentHash: asset.contentHash,
      frameTimestampMs: input.frameTimestampMs ?? null,
      status: "APPROVED",
      source: "ACCEPTED_GENERATED_RESULT",
      approvedBy: scope.actorUserId,
      approvedAt: now,
    });
    await this.db.insert(schema.aiStoryCharacterContinuityAnchors).values({
      anchorId: anchor.anchorId, orgId: scope.orgId, workspaceId: scope.workspaceId,
      reusableCharacterId: anchor.reusableCharacterId, reusableCharacterVersionId: anchor.reusableCharacterVersionId,
      sourceEpisodeId: anchor.sourceEpisodeId, sourceGenerationUnitId: anchor.sourceGenerationUnitId,
      sourceResultId: anchor.sourceResultId, assetId: anchor.assetId, contentHash: anchor.contentHash,
      frameTimestampMs: anchor.frameTimestampMs, status: anchor.status, source: anchor.source, snapshot: anchor,
      approvedBy: scope.actorUserId, approvedAt: new Date(now), createdAt: new Date(now),
    });
    return anchor;
  }
}
