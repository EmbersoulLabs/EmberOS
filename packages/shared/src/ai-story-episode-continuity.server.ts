import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  EPISODE_CONTINUITY_AUTHORITY_V1,
  EpisodeContinuityAuthoritySchema,
  type EpisodeCharacterContinuityState,
  type EpisodeContinuityAuthority,
  type EpisodeContinuityEndpoint,
  type EpisodeContinuityFailureCode,
  type EpisodeContinuityResultAuthority,
  type NarrativeContinuityState,
  type LocationContinuityState,
  type ObjectContinuityState,
  type VisualContinuityState,
  type AudioContinuityState,
} from "./ai-story-episode-continuity";

export class EpisodeContinuityAuthorityError extends Error {
  constructor(readonly code: EpisodeContinuityFailureCode, message: string) {
    super(message);
    this.name = "EpisodeContinuityAuthorityError";
  }
}

type Scope = {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
};

function fail(code: EpisodeContinuityFailureCode, message: string): never {
  throw new EpisodeContinuityAuthorityError(code, message);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function assertScope(authority: Scope, from: Scope, to: Scope): void {
  for (const scope of [from, to]) {
    if (scope.organizationId !== authority.organizationId) fail("CROSS_ORGANIZATION_CONTINUITY_FORBIDDEN", "Episode continuity cannot cross Organization authority");
    if (scope.workspaceId !== authority.workspaceId) fail("CROSS_WORKSPACE_CONTINUITY_FORBIDDEN", "Episode continuity cannot cross Workspace authority");
    if (scope.campaignId !== authority.campaignId) fail("CROSS_CAMPAIGN_CONTINUITY_FORBIDDEN", "Episode continuity cannot cross Campaign authority");
    if (scope.storyId !== authority.storyId) fail("CROSS_STORY_CONTINUITY_FORBIDDEN", "Episode continuity cannot cross Story authority");
  }
}

function continuityFingerprintPayload(input: Omit<EpisodeContinuityAuthority, "continuityAuthorityId" | "fingerprint" | "createdAt" | "frozenAt">): unknown {
  return {
    ...input,
    characterStates: [...input.characterStates].sort((a, b) => a.characterId.localeCompare(b.characterId)),
    objectStates: [...input.objectStates].sort((a, b) => a.objectId.localeCompare(b.objectId)),
    narrativeState: {
      ...input.narrativeState,
      completedBeatIds: sortedUnique(input.narrativeState.completedBeatIds),
      unresolvedBeatIds: sortedUnique(input.narrativeState.unresolvedBeatIds),
      unresolvedPromises: sortedUnique(input.narrativeState.unresolvedPromises),
      nextEpisodeRequiredFacts: sortedUnique(input.narrativeState.nextEpisodeRequiredFacts),
    },
  };
}

export function materializeEpisodeContinuityAuthority(input: Scope & {
  readonly fromEpisode: EpisodeContinuityEndpoint;
  readonly toEpisode: EpisodeContinuityEndpoint;
  readonly fromEpisodeScope: Scope;
  readonly toEpisodeScope: Scope;
  readonly characterStates: readonly EpisodeCharacterContinuityState[];
  readonly locationState: LocationContinuityState | null;
  readonly objectStates: readonly ObjectContinuityState[];
  readonly narrativeState: NarrativeContinuityState;
  readonly visualState: VisualContinuityState | null;
  readonly audioState: AudioContinuityState | null;
  readonly createdFromResultAuthority: EpisodeContinuityResultAuthority;
  readonly createdBy: string;
  readonly frozenAt: string;
  readonly version?: number;
}): EpisodeContinuityAuthority {
  assertScope(input, input.fromEpisodeScope, input.toEpisodeScope);
  if (input.toEpisode.episodeOrder !== input.fromEpisode.episodeOrder + 1) {
    fail("INVALID_EPISODE_ORDER", "V1 supports adjacent Episode handoff only");
  }
  if (!input.fromEpisode.storyVersionId || input.fromEpisode.storyVersionId !== input.createdFromResultAuthority.storyVersionId) {
    fail("CONTINUITY_SOURCE_NOT_CANONICAL", "Continuity must bind the exact frozen Final Story Result Story Version");
  }
  const withoutIdentity = {
    contractVersion: EPISODE_CONTINUITY_AUTHORITY_V1,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    fromEpisode: input.fromEpisode,
    toEpisode: input.toEpisode,
    version: input.version ?? 1,
    characterStates: [...input.characterStates],
    locationState: input.locationState,
    objectStates: [...input.objectStates],
    narrativeState: input.narrativeState,
    visualState: input.visualState,
    audioState: input.audioState,
    createdFromResultAuthority: input.createdFromResultAuthority,
    createdBy: input.createdBy,
    status: "FROZEN" as const,
  };
  const fingerprint = sha256CanonicalIntegrityHash(continuityFingerprintPayload(withoutIdentity));
  return EpisodeContinuityAuthoritySchema.parse({
    ...withoutIdentity,
    continuityAuthorityId: deterministicUuidFromFingerprint("ai-story-episode-continuity-authority", fingerprint),
    fingerprint,
    createdAt: input.frozenAt,
    frozenAt: input.frozenAt,
  });
}

export function assertEpisodeContinuityConsumption(input: {
  readonly authority: EpisodeContinuityAuthority;
  readonly expectedScope: Scope;
  readonly expectedFromEpisodeId: string;
  readonly expectedFromEpisodeVersion: number;
  readonly toEpisode: EpisodeContinuityEndpoint & Scope;
  readonly characterAuthorities: readonly Pick<EpisodeCharacterContinuityState, "characterId" | "characterVersionId" | "characterFingerprint" | "dnaVersionId" | "dnaFingerprint" | "voiceAuthorityRef">[];
  readonly retainedUnresolvedBeatIds: readonly string[];
  readonly selectedLocationId?: string | null;
  readonly approvedLocationChange?: boolean;
  readonly approvedOutfitChanges?: Readonly<Record<string, string>>;
  readonly currentObjectStates?: readonly Pick<ObjectContinuityState, "objectId" | "objectAuthorityVersion" | "objectAuthorityFingerprint" | "finalState" | "holderCharacterId" | "locationId">[];
  readonly approvedObjectChanges?: readonly string[];
}): void {
  const authority = EpisodeContinuityAuthoritySchema.parse(input.authority);
  assertScope(input.expectedScope, input.expectedScope, input.toEpisode);
  assertScope(authority, input.expectedScope, input.toEpisode);
  if (authority.fromEpisode.episodeId !== input.expectedFromEpisodeId || authority.fromEpisode.episodeVersion !== input.expectedFromEpisodeVersion) {
    fail("STALE_PREVIOUS_EPISODE_AUTHORITY", "Previous Episode identity/version does not match the frozen handoff");
  }
  if (authority.toEpisode.episodeId !== input.toEpisode.episodeId || authority.toEpisode.episodeOrder !== input.toEpisode.episodeOrder) {
    fail("INVALID_EPISODE_ORDER", "Continuity destination is not the expected adjacent Episode");
  }
  for (const previous of authority.characterStates) {
    const current = input.characterAuthorities.find((candidate) => candidate.characterId === previous.characterId);
    if (!current || current.characterVersionId !== previous.characterVersionId) {
      fail("STALE_CHARACTER_AUTHORITY", `Character ${previous.characterId} version does not match frozen continuity authority`);
    }
    if (current.characterFingerprint !== previous.characterFingerprint) {
      fail("CHARACTER_CONTINUITY_MISMATCH", `Character ${previous.characterId} fingerprint does not match frozen continuity authority`);
    }
    if (current.dnaVersionId !== previous.dnaVersionId || current.dnaFingerprint !== previous.dnaFingerprint) {
      fail("DNA_CONTINUITY_MISMATCH", `Character ${previous.characterId} DNA authority changed`);
    }
    if (current.voiceAuthorityRef?.voiceProfileVersion !== previous.voiceAuthorityRef?.voiceProfileVersion || current.voiceAuthorityRef?.voiceFingerprint !== previous.voiceAuthorityRef?.voiceFingerprint) {
      fail("VOICE_AUTHORITY_MISMATCH", `Character ${previous.characterId} voice authority changed`);
    }
  }
  const retained = new Set(input.retainedUnresolvedBeatIds);
  if (authority.narrativeState.unresolvedBeatIds.some((beatId) => !retained.has(beatId))) {
    fail("UNRESOLVED_BEAT_DROPPED", "The next Episode omitted a frozen unresolved narrative beat");
  }
  if (authority.locationState?.locationId && input.selectedLocationId !== undefined && input.selectedLocationId !== authority.locationState.locationId && input.approvedLocationChange !== true) {
    fail("LOCATION_CONTINUITY_MISMATCH", "Location changed without approved current-Episode creative authority");
  }
  const approvedObjectChanges = new Set(input.approvedObjectChanges ?? []);
  for (const previous of authority.objectStates) {
    const current = input.currentObjectStates?.find((candidate) => candidate.objectId === previous.objectId);
    if (!current) continue;
    if (current.objectAuthorityVersion !== previous.objectAuthorityVersion || current.objectAuthorityFingerprint !== previous.objectAuthorityFingerprint) {
      fail("OBJECT_AUTHORITY_STALE", `Object ${previous.objectId} authority changed`);
    }
    const stateChanged = current.finalState !== previous.finalState || current.holderCharacterId !== previous.holderCharacterId || current.locationId !== previous.locationId;
    if (stateChanged && !approvedObjectChanges.has(previous.objectId)) {
      fail("OBJECT_STATE_CONTINUITY_MISMATCH", `Object ${previous.objectId} state changed without approved creative authority`);
    }
  }
  for (const character of authority.characterStates) {
    const nextOutfit = input.approvedOutfitChanges?.[character.characterId];
    if (nextOutfit !== undefined && !nextOutfit.trim()) {
      fail("CHARACTER_CONTINUITY_MISMATCH", "Approved outfit transition must identify the new state");
    }
  }
}

export function buildEpisodeContinuityPlanningContext(input: {
  readonly authority: EpisodeContinuityAuthority;
  readonly approvedCurrentEpisodeChanges: Readonly<Record<string, unknown>>;
}): {
  readonly precedence: readonly ["CANONICAL_IDENTITY_AUTHORITY", "FROZEN_PREVIOUS_EPISODE_FACTS", "APPROVED_CURRENT_EPISODE_CHANGES", "PLANNER_SUGGESTIONS"];
  readonly previousEpisodeFacts: EpisodeContinuityAuthority;
  readonly approvedCurrentEpisodeChanges: Readonly<Record<string, unknown>>;
  readonly generationMode: null;
} {
  return {
    precedence: ["CANONICAL_IDENTITY_AUTHORITY", "FROZEN_PREVIOUS_EPISODE_FACTS", "APPROVED_CURRENT_EPISODE_CHANGES", "PLANNER_SUGGESTIONS"],
    previousEpisodeFacts: EpisodeContinuityAuthoritySchema.parse(input.authority),
    approvedCurrentEpisodeChanges: input.approvedCurrentEpisodeChanges,
    generationMode: null,
  };
}
