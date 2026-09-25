import type { EpisodeContinuityAuthorityRepository } from "@ceo-agent/db";
import {
  EpisodeContinuityAuthorityError,
  assertEpisodeContinuityConsumption,
  buildEpisodeContinuityPlanningContext,
  type EpisodeCharacterContinuityState,
  type EpisodeContinuityEndpoint,
} from "@ceo-agent/shared/server";

export class EpisodeContinuityPlanningService {
  constructor(private readonly repository: EpisodeContinuityAuthorityRepository) {}

  /** Exact-lineage loader. No latest/similar Character/Asset lookup is permitted. */
  async loadPreviousEpisodeContinuityAuthority(input: {
    readonly organizationId: string;
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly storyId: string;
    readonly expectedFromEpisodeId: string;
    readonly expectedFromEpisodeVersion: number;
    readonly toEpisode: EpisodeContinuityEndpoint;
    readonly characterAuthorities: readonly Pick<EpisodeCharacterContinuityState, "characterId" | "characterVersionId" | "characterFingerprint" | "dnaVersionId" | "dnaFingerprint" | "voiceAuthorityRef">[];
    readonly retainedUnresolvedBeatIds: readonly string[];
    readonly selectedLocationId?: string | null;
    readonly approvedLocationChange?: boolean;
    readonly approvedOutfitChanges?: Readonly<Record<string, string>>;
    readonly currentObjectStates?: Parameters<typeof assertEpisodeContinuityConsumption>[0]["currentObjectStates"];
    readonly approvedObjectChanges?: readonly string[];
    readonly approvedCurrentEpisodeChanges: Readonly<Record<string, unknown>>;
  }) {
    const authority = await this.repository.loadPreviousEpisodeContinuityAuthority({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      expectedFromEpisodeId: input.expectedFromEpisodeId,
      expectedFromEpisodeVersion: input.expectedFromEpisodeVersion,
      toEpisodeId: input.toEpisode.episodeId,
      toEpisodeOrder: input.toEpisode.episodeOrder,
    });
    if (!authority) {
      throw new EpisodeContinuityAuthorityError(
        "STALE_PREVIOUS_EPISODE_AUTHORITY",
        "No exact frozen previous-Episode continuity authority exists"
      );
    }
    assertEpisodeContinuityConsumption({
      authority,
      expectedScope: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        campaignId: input.campaignId,
        storyId: input.storyId,
      },
      expectedFromEpisodeId: input.expectedFromEpisodeId,
      expectedFromEpisodeVersion: input.expectedFromEpisodeVersion,
      toEpisode: {
        ...input.toEpisode,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        campaignId: input.campaignId,
        storyId: input.storyId,
      },
      characterAuthorities: input.characterAuthorities,
      retainedUnresolvedBeatIds: input.retainedUnresolvedBeatIds,
      selectedLocationId: input.selectedLocationId,
      approvedLocationChange: input.approvedLocationChange,
      approvedOutfitChanges: input.approvedOutfitChanges,
      currentObjectStates: input.currentObjectStates,
      approvedObjectChanges: input.approvedObjectChanges,
    });
    return buildEpisodeContinuityPlanningContext({
      authority,
      approvedCurrentEpisodeChanges: input.approvedCurrentEpisodeChanges,
    });
  }
}
