import { z } from "zod";

export const EPISODE_CONTINUITY_AUTHORITY_V1 =
  "ai-story-episode-continuity-authority.v1" as const;

export const EPISODE_CONTINUITY_PRECEDENCE = Object.freeze([
  "CANONICAL_IDENTITY_AUTHORITY",
  "FROZEN_PREVIOUS_EPISODE_FACTS",
  "APPROVED_CURRENT_EPISODE_CHANGES",
  "PLANNER_SUGGESTIONS",
] as const);

export const EPISODE_CONTINUITY_FAILURE_CODES = [
  "CROSS_ORGANIZATION_CONTINUITY_FORBIDDEN",
  "CROSS_WORKSPACE_CONTINUITY_FORBIDDEN",
  "CROSS_CAMPAIGN_CONTINUITY_FORBIDDEN",
  "CROSS_STORY_CONTINUITY_FORBIDDEN",
  "STALE_PREVIOUS_EPISODE_AUTHORITY",
  "CHARACTER_CONTINUITY_MISMATCH",
  "STALE_CHARACTER_AUTHORITY",
  "DNA_CONTINUITY_MISMATCH",
  "LOCATION_CONTINUITY_MISMATCH",
  "OBJECT_STATE_CONTINUITY_MISMATCH",
  "OBJECT_AUTHORITY_STALE",
  "VOICE_AUTHORITY_MISMATCH",
  "UNRESOLVED_BEAT_DROPPED",
  "INVALID_EPISODE_ORDER",
  "CONTINUITY_SOURCE_NOT_CANONICAL",
  "IMMUTABLE_CONFLICT",
] as const;

export type EpisodeContinuityFailureCode =
  (typeof EPISODE_CONTINUITY_FAILURE_CODES)[number];

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(4000);
const Instant = z.string().datetime();

export const CharacterVoiceAuthorityRefSchema = z
  .object({
    characterId: Id,
    voiceProfileVersion: z.number().int().positive(),
    voiceFingerprint: Hash.nullable(),
    language: Text.max(100).nullable(),
    localeOrAccent: Text.max(200).nullable(),
    speechStyle: Text.max(500).nullable(),
  })
  .strict();

export const EpisodeCharacterContinuityStateSchema = z
  .object({
    characterId: Id,
    characterVersionId: Id,
    characterFingerprint: Hash,
    reusableCharacterId: Id.nullable(),
    reusableCharacterVersionId: Id.nullable(),
    dnaVersionId: Id.nullable(),
    dnaFingerprint: Hash.nullable(),
    castAuthorityRef: Id.nullable(),
    outfitState: Text.nullable(),
    appearanceDelta: Text.nullable(),
    physicalState: Text.nullable(),
    emotionalState: Text.nullable(),
    lastAction: Text.nullable(),
    lastDialogue: Text.nullable(),
    voiceAuthorityRef: CharacterVoiceAuthorityRefSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.voiceAuthorityRef?.characterId !== undefined && value.voiceAuthorityRef.characterId !== value.characterId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["voiceAuthorityRef", "characterId"],
        message: "Voice authority must belong to the same Character",
      });
    }
    if ((value.dnaVersionId === null) !== (value.dnaFingerprint === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dnaVersionId"],
        message: "Character DNA version and fingerprint must be pinned together",
      });
    }
  });

export const NarrativeContinuityStateSchema = z
  .object({
    finalBeatId: Id.nullable(),
    completedBeatIds: z.array(Id),
    unresolvedBeatIds: z.array(Id),
    unresolvedPromises: z.array(Text),
    lastDialogue: Text.nullable(),
    lastSpeakerId: Id.nullable(),
    lastAction: Text.nullable(),
    nextEpisodeRequiredFacts: z.array(Text),
  })
  .strict();

export const LocationContinuityStateSchema = z
  .object({
    stateKind: z.literal("PREVIOUS_FINAL_LOCATION"),
    locationId: Id.nullable(),
    locationVersionId: Id.nullable(),
    locationFingerprint: Hash.nullable(),
    state: Text.nullable(),
    timeOfDay: Text.nullable(),
    temporaryFacts: z.array(Text),
  })
  .strict();

export const ObjectContinuityStateSchema = z
  .object({
    objectId: Id,
    objectAuthorityVersion: z.number().int().positive().nullable(),
    objectAuthorityFingerprint: Hash.nullable(),
    finalState: Text,
    holderCharacterId: Id.nullable(),
    locationId: Id.nullable(),
  })
  .strict();

export const VisualContinuityStateSchema = z
  .object({
    endingShotId: Id.nullable(),
    endingGenerationUnitId: Id.nullable(),
    endingMediaAssetId: Id.nullable(),
    endingFrameAssetId: Id.nullable(),
    compositionState: Text.nullable(),
    cameraState: Text.nullable(),
  })
  .strict();

export const AudioContinuityStateSchema = z
  .object({
    lastSpeakerId: Id.nullable(),
    voiceAuthorityRefs: z.array(CharacterVoiceAuthorityRefSchema),
    dialogueLanguage: Text.max(100).nullable(),
    emotionalDeliveryState: Text.nullable(),
    speechStyleState: Text.nullable(),
  })
  .strict();

export const EpisodeContinuityEndpointSchema = z
  .object({
    episodeId: Id,
    episodeVersion: z.number().int().positive().nullable(),
    episodeOrder: z.number().int().positive(),
    storyVersionId: Id.nullable(),
  })
  .strict();

export const EpisodeContinuityResultAuthoritySchema = z
  .object({
    finalStoryResultId: Id,
    finalStoryResultIntegrityHash: Hash,
    finalMediaContentHash: Hash,
    storyVersionId: Id,
    orderedSceneResultIds: z.array(Id).min(1),
  })
  .strict();

export const EpisodeContinuityAuthoritySchema = z
  .object({
    continuityAuthorityId: Id,
    contractVersion: z.literal(EPISODE_CONTINUITY_AUTHORITY_V1),
    organizationId: Id,
    workspaceId: Id,
    campaignId: Id,
    storyId: Id,
    fromEpisode: EpisodeContinuityEndpointSchema,
    toEpisode: EpisodeContinuityEndpointSchema,
    version: z.number().int().positive(),
    fingerprint: Hash,
    characterStates: z.array(EpisodeCharacterContinuityStateSchema),
    locationState: LocationContinuityStateSchema.nullable(),
    objectStates: z.array(ObjectContinuityStateSchema),
    narrativeState: NarrativeContinuityStateSchema,
    visualState: VisualContinuityStateSchema.nullable(),
    audioState: AudioContinuityStateSchema.nullable(),
    createdFromResultAuthority: EpisodeContinuityResultAuthoritySchema,
    createdBy: Id,
    createdAt: Instant,
    frozenAt: Instant,
    status: z.literal("FROZEN"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.fromEpisode.episodeOrder + 1 !== value.toEpisode.episodeOrder) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["toEpisode", "episodeOrder"], message: "INVALID_EPISODE_ORDER" });
    }
    if (value.fromEpisode.storyVersionId !== value.createdFromResultAuthority.storyVersionId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["createdFromResultAuthority", "storyVersionId"], message: "STALE_PREVIOUS_EPISODE_AUTHORITY" });
    }
  });

export const EpisodeContinuityPlanningContextSchema = z
  .object({
    precedence: z.tuple([
      z.literal("CANONICAL_IDENTITY_AUTHORITY"),
      z.literal("FROZEN_PREVIOUS_EPISODE_FACTS"),
      z.literal("APPROVED_CURRENT_EPISODE_CHANGES"),
      z.literal("PLANNER_SUGGESTIONS"),
    ]),
    previousEpisodeFacts: EpisodeContinuityAuthoritySchema,
    approvedCurrentEpisodeChanges: z.record(z.unknown()),
    generationMode: z.null(),
  })
  .strict();

export type CharacterVoiceAuthorityRef = z.infer<typeof CharacterVoiceAuthorityRefSchema>;
export type EpisodeCharacterContinuityState = z.infer<typeof EpisodeCharacterContinuityStateSchema>;
export type NarrativeContinuityState = z.infer<typeof NarrativeContinuityStateSchema>;
export type LocationContinuityState = z.infer<typeof LocationContinuityStateSchema>;
export type ObjectContinuityState = z.infer<typeof ObjectContinuityStateSchema>;
export type VisualContinuityState = z.infer<typeof VisualContinuityStateSchema>;
export type AudioContinuityState = z.infer<typeof AudioContinuityStateSchema>;
export type EpisodeContinuityEndpoint = z.infer<typeof EpisodeContinuityEndpointSchema>;
export type EpisodeContinuityResultAuthority = z.infer<typeof EpisodeContinuityResultAuthoritySchema>;
export type EpisodeContinuityAuthority = z.infer<typeof EpisodeContinuityAuthoritySchema>;
export type EpisodeContinuityPlanningContext = z.infer<
  typeof EpisodeContinuityPlanningContextSchema
>;

/** Continuity is historical input only. It never selects a generation mode. */
export const EPISODE_CONTINUITY_SELECTS_GENERATION_MODE = false as const;
