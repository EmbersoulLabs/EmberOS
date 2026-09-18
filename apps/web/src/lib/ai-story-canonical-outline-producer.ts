import { and, eq, isNull } from "drizzle-orm";
import {
  AiStoryCharacterAuthorityService,
  AiStoryOutlineAuthorityService,
  resolveAiStoryOutlineProfileAuthority,
  type AiStoryOutlineScope,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  AiStoryStructuredDraftSchema,
  CAMPAIGN_OBJECTIVE_IDS,
  type AiStoryOutlineProfileReference,
  type AiStoryOutlineVersion,
  type CampaignObjectiveId,
  type StoryBeat,
} from "@ceo-agent/shared";
import { composeAiStoryCanonicalOutlineV1 } from "@ceo-agent/shared/server";
import { resolveStoryProductSources } from "@/lib/ai-story-product-sources";

type Db = ReturnType<typeof getDb>;

export class AiStoryCanonicalOutlineProducerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryCanonicalOutlineProducerError";
  }
}

type CurrentOutlineUpstream = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  originalIdea: string;
  structuredContent: unknown;
  frozenAt: Date | null;
  campaignObjective: CampaignObjectiveId;
  customObjective: string | null;
};

export type EnsureCurrentFrozenCanonicalOutlineInput = {
  db: Db;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  actorUserId: string;
  proposedStoryBeats: StoryBeat[];
};

export type CanonicalOutlineProducerDependencies = {
  loadCurrentUpstream: (db: Db, input: EnsureCurrentFrozenCanonicalOutlineInput) => Promise<CurrentOutlineUpstream>;
  resolveProfile: (db: Db, upstream: CurrentOutlineUpstream) => Promise<AiStoryOutlineProfileReference>;
  resolveProductAuthorityIds: (db: Db, upstream: CurrentOutlineUpstream) => Promise<string[]>;
  resolveCharacterAuthorities: (db: Db, upstream: CurrentOutlineUpstream, actorUserId: string) => Promise<Array<{
    characterId: string;
    characterVersionId: string;
    characterFingerprint: string;
  }>>;
  history: (db: Db, scope: AiStoryOutlineScope) => Promise<AiStoryOutlineVersion[]>;
  propose: (db: Db, scope: AiStoryOutlineScope, outline: AiStoryOutlineVersion) => Promise<AiStoryOutlineVersion>;
  validate: (db: Db, scope: AiStoryOutlineScope, outlineVersionId: string) => Promise<AiStoryOutlineVersion>;
  approve: (db: Db, scope: AiStoryOutlineScope, outlineVersionId: string) => Promise<AiStoryOutlineVersion>;
  freeze: (db: Db, scope: AiStoryOutlineScope, outlineVersionId: string) => Promise<AiStoryOutlineVersion>;
  now: () => string;
};

async function loadCurrentUpstream(db: Db, input: EnsureCurrentFrozenCanonicalOutlineInput): Promise<CurrentOutlineUpstream> {
  const rows = await db.select({
    orgId: schema.aiStories.orgId,
    workspaceId: schema.aiStories.workspaceId,
    campaignId: schema.aiStories.campaignId,
    storyId: schema.aiStories.id,
    storyVersionId: schema.aiStoryVersions.id,
    originalIdea: schema.aiStories.originalIdea,
    structuredContent: schema.aiStoryVersions.structuredContent,
    frozenAt: schema.aiStoryVersions.frozenAt,
    campaignObjective: schema.campaigns.objective,
    customObjective: schema.campaigns.objectiveCustom,
  }).from(schema.aiStories)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.aiStories.campaignId))
    .innerJoin(schema.aiStoryVersions, eq(schema.aiStoryVersions.id, schema.aiStories.currentVersionId))
    .where(and(
      eq(schema.aiStories.id, input.storyId),
      eq(schema.aiStories.campaignId, input.campaignId),
      eq(schema.aiStories.currentVersionId, input.storyVersionId),
      eq(schema.aiStoryVersions.id, input.storyVersionId),
      eq(schema.aiStoryVersions.storyId, input.storyId),
      eq(schema.campaigns.orgId, schema.aiStories.orgId),
      eq(schema.campaigns.workspaceId, schema.aiStories.workspaceId),
      isNull(schema.aiStories.archivedAt),
    )).limit(1);
  const row = rows[0];
  if (!row) throw new AiStoryCanonicalOutlineProducerError("CURRENT_STORY_VERSION_REQUIRED", "Exact current Story Version authority was not found");
  if (!row.frozenAt) throw new AiStoryCanonicalOutlineProducerError("FROZEN_STORY_VERSION_REQUIRED", "Current Story Version must be frozen");
  if (!row.campaignObjective || !(CAMPAIGN_OBJECTIVE_IDS as readonly string[]).includes(row.campaignObjective)) {
    throw new AiStoryCanonicalOutlineProducerError("PRODUCT_STORY_CAMPAIGN_OBJECTIVE_AUTHORITY_MISSING", "Campaign objective authority is absent or invalid");
  }
  return { ...row, campaignObjective: row.campaignObjective as CampaignObjectiveId };
}

const defaultDependencies: CanonicalOutlineProducerDependencies = {
  loadCurrentUpstream,
  resolveProfile: (db, upstream) => resolveAiStoryOutlineProfileAuthority(db, upstream),
  resolveProductAuthorityIds: async (db, upstream) => (await resolveStoryProductSources(db, upstream)).map((item) => item.assetId),
  resolveCharacterAuthorities: async (db, upstream, actorUserId) => {
    const values = await new AiStoryCharacterAuthorityService(db).list({
      orgId: upstream.orgId,
      workspaceId: upstream.workspaceId,
      campaignId: upstream.campaignId,
      actorUserId,
    });
    return values.map((value) => ({
      characterId: value.characterId,
      characterVersionId: value.characterVersionId,
      characterFingerprint: value.fingerprint,
    }));
  },
  history: (db, scope) => new AiStoryOutlineAuthorityService(db).history(scope),
  propose: (db, scope, outline) => new AiStoryOutlineAuthorityService(db).propose(scope, outline),
  validate: (db, scope, id) => new AiStoryOutlineAuthorityService(db).validate(scope, id),
  approve: (db, scope, id) => new AiStoryOutlineAuthorityService(db).approve(scope, id),
  freeze: (db, scope, id) => new AiStoryOutlineAuthorityService(db).freeze(scope, id),
  now: () => new Date().toISOString(),
};

function incomplete(status: AiStoryOutlineVersion["status"]) {
  return status === "DRAFT" || status === "VALIDATED" || status === "APPROVED";
}

async function advanceToFrozen(
  input: EnsureCurrentFrozenCanonicalOutlineInput,
  scope: AiStoryOutlineScope,
  sourceHash: string,
  initial: AiStoryOutlineVersion,
  deps: CanonicalOutlineProducerDependencies,
) {
  let current = initial;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (current.status === "FROZEN") return current;
    if (current.status === "SUPERSEDED") {
      throw new AiStoryCanonicalOutlineProducerError("CANONICAL_OUTLINE_DESIRED_AUTHORITY_SUPERSEDED", "Desired Outline authority was superseded");
    }
    try {
      current = current.status === "DRAFT"
        ? await deps.validate(input.db, scope, current.outlineVersionId)
        : current.status === "VALIDATED"
          ? await deps.approve(input.db, scope, current.outlineVersionId)
          : await deps.freeze(input.db, scope, current.outlineVersionId);
    } catch (error) {
      const refreshed = (await deps.history(input.db, scope)).find((item) => item.sourceHash === sourceHash);
      if (!refreshed || refreshed.status === current.status) throw error;
      current = refreshed;
    }
  }
  throw new AiStoryCanonicalOutlineProducerError("CANONICAL_OUTLINE_LIFECYCLE_DID_NOT_CONVERGE", "Outline lifecycle did not converge to FROZEN");
}

/** Ensures one exact current FROZEN Outline from persisted, server-resolved authority. */
export async function ensureCurrentFrozenCanonicalOutline(
  input: EnsureCurrentFrozenCanonicalOutlineInput,
  deps: CanonicalOutlineProducerDependencies = defaultDependencies,
): Promise<AiStoryOutlineVersion> {
  const upstream = await deps.loadCurrentUpstream(input.db, input);
  const [profile, productAuthorityIds, characterAuthorities] = await Promise.all([
    deps.resolveProfile(input.db, upstream),
    deps.resolveProductAuthorityIds(input.db, upstream),
    deps.resolveCharacterAuthorities(input.db, upstream, input.actorUserId),
  ]);
  if (profile.profileId !== "PRODUCT_STORY") {
    throw new AiStoryCanonicalOutlineProducerError("CANONICAL_OUTLINE_PROFILE_UNSUPPORTED", "V1 producer requires PRODUCT_STORY authority");
  }
  const storyDraft = AiStoryStructuredDraftSchema.parse(upstream.structuredContent);
  const scope: AiStoryOutlineScope = {
    orgId: upstream.orgId,
    workspaceId: upstream.workspaceId,
    campaignId: upstream.campaignId,
    storyId: upstream.storyId,
    storyVersionId: upstream.storyVersionId,
    actorUserId: input.actorUserId,
    requireCurrentFrozenStoryVersion: true,
  };
  const history = await deps.history(input.db, scope);
  const latest = history.at(-1);
  const desired = composeAiStoryCanonicalOutlineV1({
    storyId: upstream.storyId,
    storyVersionId: upstream.storyVersionId,
    orgId: upstream.orgId,
    workspaceId: upstream.workspaceId,
    campaignId: upstream.campaignId,
    version: latest?.status === "FROZEN" ? latest.version + 1 : latest?.version ?? 1,
    profile,
    storyDraft,
    proposedStoryBeats: input.proposedStoryBeats,
    campaignObjective: upstream.campaignObjective,
    customObjective: upstream.customObjective,
    productAuthorityIds,
    characterAuthorities,
    originalIdea: upstream.originalIdea,
    supersedesOutlineVersionId: latest?.status === "FROZEN" ? latest.outlineVersionId : null,
    createdBy: input.actorUserId,
    createdAt: deps.now(),
  });
  const existing = history.find((item) => item.sourceHash === desired.sourceHash);
  if (existing) return advanceToFrozen(input, scope, desired.sourceHash, existing, deps);
  if (latest && incomplete(latest.status)) {
    throw new AiStoryCanonicalOutlineProducerError(
      "CANONICAL_OUTLINE_INCOMPLETE_LINEAGE_CONFLICT",
      "A different-source Outline has an incomplete durable lifecycle",
    );
  }
  const proposed = await deps.propose(input.db, scope, desired);
  return advanceToFrozen(input, scope, desired.sourceHash, proposed, deps);
}
