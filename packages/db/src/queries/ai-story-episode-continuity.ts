import { and, eq } from "drizzle-orm";
import {
  EpisodeContinuityAuthoritySchema,
  EpisodeContinuityAuthorityError,
  parseFinalStoryResultPersistenceRecord,
  type EpisodeContinuityAuthority,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;

export type EpisodeContinuityScope = {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
};

export interface EpisodeContinuityAuthorityRepository {
  insertOrConverge(authority: EpisodeContinuityAuthority): Promise<{ authority: EpisodeContinuityAuthority; replayed: boolean }>;
  loadPreviousEpisodeContinuityAuthority(input: EpisodeContinuityScope & {
    readonly expectedFromEpisodeId: string;
    readonly expectedFromEpisodeVersion: number;
    readonly toEpisodeId: string;
    readonly toEpisodeOrder: number;
  }): Promise<EpisodeContinuityAuthority | null>;
}

function parse(row: typeof schema.aiStoryEpisodeContinuityAuthorities.$inferSelect): EpisodeContinuityAuthority {
  return EpisodeContinuityAuthoritySchema.parse(row.authority);
}

export class PgEpisodeContinuityAuthorityRepository implements EpisodeContinuityAuthorityRepository {
  constructor(private readonly db: Db = getDb()) {}

  async insertOrConverge(requested: EpisodeContinuityAuthority): Promise<{ authority: EpisodeContinuityAuthority; replayed: boolean }> {
    const authority = EpisodeContinuityAuthoritySchema.parse(requested);
    const resultRows = await this.db
      .select({ result: schema.aiStoryFinalStoryResults.result })
      .from(schema.aiStoryFinalStoryResults)
      .where(eq(schema.aiStoryFinalStoryResults.finalStoryResultId, authority.createdFromResultAuthority.finalStoryResultId))
      .limit(1);
    if (!resultRows[0]) {
      throw new EpisodeContinuityAuthorityError("CONTINUITY_SOURCE_NOT_CANONICAL", "Source Final Story Result does not exist");
    }
    const result = parseFinalStoryResultPersistenceRecord(resultRows[0].result);
    if (
      result.orgId !== authority.organizationId ||
      result.workspaceId !== authority.workspaceId ||
      result.campaignId !== authority.campaignId ||
      result.storyId !== authority.storyId ||
      result.storyVersionId !== authority.fromEpisode.storyVersionId ||
      result.integrityHash !== authority.createdFromResultAuthority.finalStoryResultIntegrityHash ||
      result.contentHash !== authority.createdFromResultAuthority.finalMediaContentHash ||
      result.orderedSceneResultIds.join("|") !== authority.createdFromResultAuthority.orderedSceneResultIds.join("|")
    ) {
      throw new EpisodeContinuityAuthorityError("CONTINUITY_SOURCE_NOT_CANONICAL", "Source Final Story Result does not match the frozen Episode handoff");
    }
    const inserted = await this.db
      .insert(schema.aiStoryEpisodeContinuityAuthorities)
      .values({
        continuityAuthorityId: authority.continuityAuthorityId,
        organizationId: authority.organizationId,
        workspaceId: authority.workspaceId,
        campaignId: authority.campaignId,
        storyId: authority.storyId,
        fromEpisodeId: authority.fromEpisode.episodeId,
        fromEpisodeVersion: authority.fromEpisode.episodeVersion!,
        fromEpisodeOrder: authority.fromEpisode.episodeOrder,
        fromStoryVersionId: authority.fromEpisode.storyVersionId!,
        toEpisodeId: authority.toEpisode.episodeId,
        toEpisodeVersion: authority.toEpisode.episodeVersion,
        toEpisodeOrder: authority.toEpisode.episodeOrder,
        sourceFinalStoryResultId: authority.createdFromResultAuthority.finalStoryResultId,
        version: authority.version,
        contractVersion: authority.contractVersion,
        fingerprint: authority.fingerprint,
        authority,
        createdBy: authority.createdBy,
        createdAt: new Date(authority.createdAt),
        frozenAt: new Date(authority.frozenAt),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return { authority: parse(inserted[0]), replayed: false };

    const rows = await this.db
      .select()
      .from(schema.aiStoryEpisodeContinuityAuthorities)
      .where(and(
        eq(schema.aiStoryEpisodeContinuityAuthorities.organizationId, authority.organizationId),
        eq(schema.aiStoryEpisodeContinuityAuthorities.workspaceId, authority.workspaceId),
        eq(schema.aiStoryEpisodeContinuityAuthorities.campaignId, authority.campaignId),
        eq(schema.aiStoryEpisodeContinuityAuthorities.storyId, authority.storyId),
        eq(schema.aiStoryEpisodeContinuityAuthorities.fromEpisodeId, authority.fromEpisode.episodeId),
        eq(schema.aiStoryEpisodeContinuityAuthorities.fromEpisodeVersion, authority.fromEpisode.episodeVersion!),
        eq(schema.aiStoryEpisodeContinuityAuthorities.toEpisodeId, authority.toEpisode.episodeId),
        eq(schema.aiStoryEpisodeContinuityAuthorities.version, authority.version),
      ))
      .limit(1);
    const existing = rows[0] ? parse(rows[0]) : null;
    if (!existing || existing.fingerprint !== authority.fingerprint) {
      throw new EpisodeContinuityAuthorityError("IMMUTABLE_CONFLICT", "A different frozen continuity authority already owns this Episode handoff identity");
    }
    return { authority: existing, replayed: true };
  }

  async loadPreviousEpisodeContinuityAuthority(input: EpisodeContinuityScope & {
    readonly expectedFromEpisodeId: string;
    readonly expectedFromEpisodeVersion: number;
    readonly toEpisodeId: string;
    readonly toEpisodeOrder: number;
  }): Promise<EpisodeContinuityAuthority | null> {
    const rows = await this.db
      .select()
      .from(schema.aiStoryEpisodeContinuityAuthorities)
      .where(and(
        eq(schema.aiStoryEpisodeContinuityAuthorities.organizationId, input.organizationId),
        eq(schema.aiStoryEpisodeContinuityAuthorities.workspaceId, input.workspaceId),
        eq(schema.aiStoryEpisodeContinuityAuthorities.campaignId, input.campaignId),
        eq(schema.aiStoryEpisodeContinuityAuthorities.storyId, input.storyId),
        eq(schema.aiStoryEpisodeContinuityAuthorities.fromEpisodeId, input.expectedFromEpisodeId),
        eq(schema.aiStoryEpisodeContinuityAuthorities.fromEpisodeVersion, input.expectedFromEpisodeVersion),
        eq(schema.aiStoryEpisodeContinuityAuthorities.toEpisodeId, input.toEpisodeId),
        eq(schema.aiStoryEpisodeContinuityAuthorities.toEpisodeOrder, input.toEpisodeOrder),
      ))
      .limit(1);
    return rows[0] ? parse(rows[0]) : null;
  }
}
