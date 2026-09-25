import { and, eq } from "drizzle-orm";
import {
  AnimationPackagePayloadSchema,
  CharacterVoiceAuthorityRefSchema,
  type EpisodeContinuityPlanningContext,
} from "@ceo-agent/shared";
import {
  EpisodeContinuityAuthorityError,
  assertEpisodeContinuityConsumption,
  buildEpisodeContinuityPlanningContext,
  deterministicUuidFromFingerprint,
  materializeEpisodeContinuityAuthority,
  parseFinalStoryResultPersistenceRecord,
  sha256CanonicalIntegrityHash,
  type EpisodeContinuityAuthority,
  type FinalStoryResultPersistenceRecord,
} from "@ceo-agent/shared/server";
import { getDb } from "../client";
import * as schema from "../schema/index";
import { PgEpisodeContinuityAuthorityRepository } from "./ai-story-episode-continuity";
import { AiStoryProviderRuntimeRepository } from "./ai-story-provider-runtime";
import { convergeAnimationPackageApprovalFromCanonicalReview } from "./ai-story-animation-package-approval-convergence";

type Db = ReturnType<typeof getDb>;

type ScopedVersion = {
  readonly id: string;
  readonly versionNumber: number;
  readonly sourceContextSnapshot: Record<string, unknown>;
  readonly frozenAt: Date | null;
  readonly frozenBy: string | null;
};

function beatAuthorityId(storyId: string, storyVersionId: string, beatId: string): string {
  return deterministicUuidFromFingerprint(
    "ai-story-episode-continuity-beat",
    sha256CanonicalIntegrityHash({ storyId, storyVersionId, beatId })
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

type ContinuityAnimationFacts = {
  readonly characterContinuity: readonly {
    readonly canonicalAuthority?: { readonly characterId?: string } | null;
    readonly costume?: string | null;
    readonly appearance?: string | null;
    readonly pose?: string | null;
    readonly emotion?: string | null;
  }[];
  readonly completedBeatIds: readonly string[];
  readonly location: string | null;
  readonly timeOfDay: string | null;
  readonly composition: string | null;
  readonly cameraMovement: string | null;
  readonly historicalCharacterAuthority: {
    readonly characterId: string;
    readonly characterVersionId: string;
    readonly characterFingerprint: string;
    readonly outfit: string | null;
    readonly location: string | null;
    readonly action: string | null;
    readonly dialogue: string | null;
  } | null;
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Ticket C predates the full planning payload and persisted a frozen
 * ai-story-execution-materialization.v1 authority. It is accepted only as a
 * source of the exact facts it actually contains; absent planning facts stay
 * absent and are never synthesized.
 */
export function readAnimationPackageContinuityFacts(payload: unknown): ContinuityAnimationFacts {
  const full = AnimationPackagePayloadSchema.safeParse(payload);
  if (full.success) {
    return {
      characterContinuity: full.data.characterContinuity,
      completedBeatIds: full.data.storyBeats.map((beat) => beat.id),
      location: full.data.worldContinuity.location,
      timeOfDay: full.data.worldContinuity.timeline,
      composition: full.data.shotPlan.at(-1)?.composition ?? null,
      cameraMovement: full.data.shotPlan.at(-1)?.cameraMovement ?? null,
      historicalCharacterAuthority: null,
    };
  }

  const root = record(payload);
  const authority = record(root.authority);
  if (
    root.contractVersion !== "ai-story-execution-materialization.v1" ||
    authority.contractVersion !== "ai-story-execution-materialization.v1"
  ) {
    throw new EpisodeContinuityAuthorityError(
      "CONTINUITY_SOURCE_NOT_CANONICAL",
      "Animation Package has no recognized immutable continuity source payload"
    );
  }
  const characterId = optionalString(authority.characterId);
  const characterVersionId = optionalString(authority.characterVersionId);
  const characterFingerprint = optionalString(authority.characterFingerprint);
  if (!characterId || !characterVersionId || !characterFingerprint) {
    throw new EpisodeContinuityAuthorityError(
      "CONTINUITY_SOURCE_NOT_CANONICAL",
      "Historical Animation Package is missing its frozen Character authority"
    );
  }
  return {
    characterContinuity: [],
    completedBeatIds: [],
    location: optionalString(authority.location),
    timeOfDay: null,
    composition: null,
    cameraMovement: null,
    historicalCharacterAuthority: {
      characterId,
      characterVersionId,
      characterFingerprint,
      outfit: optionalString(authority.outfit),
      location: optionalString(authority.location),
      action: optionalString(authority.action),
      dialogue: optionalString(authority.dialogue),
    },
  };
}

export class PgEpisodeContinuityRuntimeIntegration {
  private readonly repository: PgEpisodeContinuityAuthorityRepository;
  private readonly providerRuntime: AiStoryProviderRuntimeRepository;

  constructor(private readonly db: Db = getDb()) {
    this.repository = new PgEpisodeContinuityAuthorityRepository(db);
    this.providerRuntime = new AiStoryProviderRuntimeRepository(db);
  }

  private async loadScopedVersion(input: {
    organizationId: string;
    workspaceId: string;
    campaignId: string;
    storyId: string;
    storyVersionId?: string;
    versionNumber?: number;
  }): Promise<ScopedVersion | null> {
    const filters = [
      eq(schema.aiStoryVersions.storyId, input.storyId),
      eq(schema.aiStories.id, input.storyId),
      eq(schema.aiStories.orgId, input.organizationId),
      eq(schema.aiStories.workspaceId, input.workspaceId),
      eq(schema.aiStories.campaignId, input.campaignId),
    ];
    if (input.storyVersionId) filters.push(eq(schema.aiStoryVersions.id, input.storyVersionId));
    if (input.versionNumber !== undefined) filters.push(eq(schema.aiStoryVersions.versionNumber, input.versionNumber));
    const [row] = await this.db
      .select({
        id: schema.aiStoryVersions.id,
        versionNumber: schema.aiStoryVersions.versionNumber,
        sourceContextSnapshot: schema.aiStoryVersions.sourceContextSnapshot,
        frozenAt: schema.aiStoryVersions.frozenAt,
        frozenBy: schema.aiStoryVersions.frozenBy,
      })
      .from(schema.aiStoryVersions)
      .innerJoin(schema.aiStories, eq(schema.aiStories.id, schema.aiStoryVersions.storyId))
      .where(and(...filters))
      .limit(1);
    return row ?? null;
  }

  async materializeAfterFinalStoryResult(input: {
    readonly result: FinalStoryResultPersistenceRecord;
    readonly toStoryVersionId?: string;
  }): Promise<{ authority: EpisodeContinuityAuthority; replayed: boolean } | null> {
    const result = parseFinalStoryResultPersistenceRecord(input.result);
    const scope = {
      organizationId: result.orgId,
      workspaceId: result.workspaceId,
      campaignId: result.campaignId,
      storyId: result.storyId,
    };
    const from = await this.loadScopedVersion({ ...scope, storyVersionId: result.storyVersionId });
    if (!from || !from.frozenAt) {
      throw new EpisodeContinuityAuthorityError(
        "CONTINUITY_SOURCE_NOT_CANONICAL",
        "Final Story Result source Story Version is missing, out of scope, or not frozen"
      );
    }
    const to = await this.loadScopedVersion({
      ...scope,
      ...(input.toStoryVersionId
        ? { storyVersionId: input.toStoryVersionId }
        : { versionNumber: from.versionNumber + 1 }),
    });
    if (!to) return null;
    if (!to.frozenAt) return null;
    if (to.versionNumber !== from.versionNumber + 1) {
      throw new EpisodeContinuityAuthorityError(
        "INVALID_EPISODE_ORDER",
        "Production continuity materialization requires the adjacent Story Version"
      );
    }

    const approval = await convergeAnimationPackageApprovalFromCanonicalReview(this.db, {
      orgId: result.orgId,
      workspaceId: result.workspaceId,
      campaignId: result.campaignId,
      storyId: result.storyId,
      storyVersionId: result.storyVersionId,
      animationPackageId: result.animationPackageId,
      executionPlanId: result.executionPlanId,
    });
    const createdBy = approval.storyDecision.reviewedBy;
    const animation = readAnimationPackageContinuityFacts(
      approval.animationPackage.payload
    );
    const dna = await this.providerRuntime.getCharacterDnaCompilationAuthority({
      orgId: result.orgId,
      workspaceId: result.workspaceId,
      campaignId: result.campaignId,
      storyId: result.storyId,
      storyVersionId: result.storyVersionId,
    });
    const characterContinuity = dna
      ? animation.characterContinuity.find(
          (item) => item.canonicalAuthority?.characterId === dna.campaignCharacterId
        )
      : null;
    const historicalCharacterAuthority = animation.historicalCharacterAuthority;
    if (
      dna &&
      historicalCharacterAuthority &&
      (historicalCharacterAuthority.characterId !== dna.reusableCharacterId ||
        historicalCharacterAuthority.characterVersionId !== dna.reusableCharacterVersionId ||
        historicalCharacterAuthority.characterFingerprint !== dna.characterDnaFingerprint)
    ) {
      throw new EpisodeContinuityAuthorityError(
        "DNA_CONTINUITY_MISMATCH",
        "Historical Animation Package Character authority conflicts with canonical DNA"
      );
    }
    const explicit = record(from.sourceContextSnapshot.episodeContinuity);
    const voiceAuthority = CharacterVoiceAuthorityRefSchema.safeParse(
      explicit.voiceAuthorityRef
    );
    const voiceAuthorityRef =
      voiceAuthority.success &&
      (!dna || voiceAuthority.data.characterId === dna.campaignCharacterId)
        ? voiceAuthority.data
        : null;
    const unresolvedBeatIds = stringArray(explicit.unresolvedBeatIds);
    const unresolvedPromises = stringArray(explicit.unresolvedPromises);
    const nextEpisodeRequiredFacts = stringArray(explicit.nextEpisodeRequiredFacts);
    const completedBeatIds = animation.completedBeatIds.map((beatId) =>
      beatAuthorityId(result.storyId, result.storyVersionId, beatId)
    );
    const authority = materializeEpisodeContinuityAuthority({
      ...scope,
      fromEpisode: {
        episodeId: from.id,
        episodeVersion: from.versionNumber,
        episodeOrder: from.versionNumber,
        storyVersionId: from.id,
      },
      toEpisode: {
        episodeId: to.id,
        episodeVersion: to.versionNumber,
        episodeOrder: to.versionNumber,
        storyVersionId: to.id,
      },
      fromEpisodeScope: scope,
      toEpisodeScope: scope,
      characterStates: dna
        ? [
            {
              characterId: dna.campaignCharacterId,
              characterVersionId: dna.campaignCharacterVersionId,
              characterFingerprint: dna.campaignCharacterFingerprint,
              reusableCharacterId: dna.reusableCharacterId,
              reusableCharacterVersionId: dna.reusableCharacterVersionId,
              dnaVersionId: dna.reusableCharacterVersionId,
              dnaFingerprint: dna.characterDnaFingerprint,
              castAuthorityRef: null,
              outfitState: dna.episodeLook.wardrobe ?? characterContinuity?.costume ?? historicalCharacterAuthority?.outfit ?? null,
              appearanceDelta: characterContinuity?.appearance ?? null,
              physicalState: characterContinuity?.pose ?? dna.episodeLook.pose,
              emotionalState: characterContinuity?.emotion ?? dna.episodeLook.expression,
              lastAction: dna.episodeLook.action ?? historicalCharacterAuthority?.action ?? null,
              lastDialogue: dna.episodeLook.dialogue ?? historicalCharacterAuthority?.dialogue ?? null,
              voiceAuthorityRef,
            },
          ]
        : [],
      locationState: {
        stateKind: "PREVIOUS_FINAL_LOCATION",
        locationId: null,
        locationVersionId: null,
        locationFingerprint: null,
        state: dna?.episodeLook.location ?? animation.location,
        timeOfDay: animation.timeOfDay,
        temporaryFacts: [],
      },
      objectStates: [],
      narrativeState: {
        finalBeatId: completedBeatIds.at(-1) ?? null,
        completedBeatIds,
        unresolvedBeatIds,
        unresolvedPromises,
        lastDialogue: dna?.episodeLook.dialogue ?? historicalCharacterAuthority?.dialogue ?? null,
        lastSpeakerId: (dna?.episodeLook.dialogue ?? historicalCharacterAuthority?.dialogue)
          ? dna?.campaignCharacterId ?? historicalCharacterAuthority?.characterId ?? null
          : null,
        lastAction: dna?.episodeLook.action ?? historicalCharacterAuthority?.action ?? null,
        nextEpisodeRequiredFacts,
      },
      visualState: {
        endingShotId: null,
        endingGenerationUnitId: null,
        endingMediaAssetId: null,
        endingFrameAssetId: null,
        compositionState: animation.composition,
        cameraState: animation.cameraMovement,
      },
      audioState: {
        lastSpeakerId: (dna?.episodeLook.dialogue ?? historicalCharacterAuthority?.dialogue)
          ? dna?.campaignCharacterId ?? historicalCharacterAuthority?.characterId ?? null
          : null,
        voiceAuthorityRefs: voiceAuthorityRef ? [voiceAuthorityRef] : [],
        dialogueLanguage: null,
        emotionalDeliveryState: characterContinuity?.emotion ?? null,
        speechStyleState: null,
      },
      createdFromResultAuthority: {
        finalStoryResultId: result.finalStoryResultId,
        finalStoryResultIntegrityHash: result.integrityHash,
        finalMediaContentHash: result.contentHash,
        storyVersionId: result.storyVersionId,
        orderedSceneResultIds: [...result.orderedSceneResultIds],
      },
      createdBy,
      frozenAt: result.projectedAt,
    });
    return this.repository.insertOrConverge(authority);
  }

  async loadForPlanning(input: {
    readonly organizationId: string;
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly storyId: string;
    readonly storyVersionId: string;
  }): Promise<EpisodeContinuityPlanningContext | null> {
    const current = await this.loadScopedVersion({ ...input });
    if (!current || !current.frozenAt) {
      throw new EpisodeContinuityAuthorityError(
        "STALE_PREVIOUS_EPISODE_AUTHORITY",
        "Current Episode Story Version is missing, out of scope, or not frozen"
      );
    }
    if (current.versionNumber === 1) return null;
    const previous = await this.loadScopedVersion({
      ...input,
      storyVersionId: undefined,
      versionNumber: current.versionNumber - 1,
    });
    if (!previous) {
      throw new EpisodeContinuityAuthorityError(
        "INVALID_EPISODE_ORDER",
        "The exact adjacent previous Episode Story Version does not exist"
      );
    }
    const [resultRow] = await this.db
      .select({ result: schema.aiStoryFinalStoryResults.result })
      .from(schema.aiStoryFinalStoryResults)
      .where(
        and(
          eq(schema.aiStoryFinalStoryResults.orgId, input.organizationId),
          eq(schema.aiStoryFinalStoryResults.workspaceId, input.workspaceId),
          eq(schema.aiStoryFinalStoryResults.campaignId, input.campaignId),
          eq(schema.aiStoryFinalStoryResults.storyId, input.storyId),
          eq(schema.aiStoryFinalStoryResults.storyVersionId, previous.id)
        )
      )
      .limit(1);
    if (!resultRow) {
      throw new EpisodeContinuityAuthorityError(
        "STALE_PREVIOUS_EPISODE_AUTHORITY",
        "Adjacent previous Episode has no canonical Final Story Result"
      );
    }
    await this.materializeAfterFinalStoryResult({
      result: parseFinalStoryResultPersistenceRecord(resultRow.result),
      toStoryVersionId: current.id,
    });
    const authority = await this.repository.loadPreviousEpisodeContinuityAuthority({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      expectedFromEpisodeId: previous.id,
      expectedFromEpisodeVersion: previous.versionNumber,
      toEpisodeId: current.id,
      toEpisodeOrder: current.versionNumber,
    });
    if (!authority) {
      throw new EpisodeContinuityAuthorityError(
        "STALE_PREVIOUS_EPISODE_AUTHORITY",
        "Exact frozen adjacent-Episode continuity authority is missing"
      );
    }
    const currentDna = await this.providerRuntime.getCharacterDnaCompilationAuthority({
      orgId: input.organizationId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      storyVersionId: current.id,
    });
    const explicitCurrentVoice = CharacterVoiceAuthorityRefSchema.safeParse(
      record(current.sourceContextSnapshot.episodeContinuity).voiceAuthorityRef
    );
    const previousVoice = authority.characterStates[0]?.voiceAuthorityRef ?? null;
    const currentVoiceAuthority = explicitCurrentVoice.success
      ? explicitCurrentVoice.data
      : previousVoice;
    const characterAuthorities = currentDna
      ? [
          {
            characterId: currentDna.campaignCharacterId,
            characterVersionId: currentDna.campaignCharacterVersionId,
            characterFingerprint: currentDna.campaignCharacterFingerprint,
            dnaVersionId: currentDna.reusableCharacterVersionId,
            dnaFingerprint: currentDna.characterDnaFingerprint,
            voiceAuthorityRef: currentVoiceAuthority,
          },
        ]
      : [];
    const approvedOutfitChanges = currentDna?.episodeLook.wardrobe
      ? { [currentDna.campaignCharacterId]: currentDna.episodeLook.wardrobe }
      : undefined;
    const approvedCurrentEpisodeChanges = {
      ...record(current.sourceContextSnapshot.episodeContinuityChanges),
      ...(currentDna
        ? {
            episodeLook: currentDna.episodeLook,
            characterDnaFingerprint: currentDna.characterDnaFingerprint,
          }
        : {}),
    };
    assertEpisodeContinuityConsumption({
      authority,
      expectedScope: input,
      expectedFromEpisodeId: previous.id,
      expectedFromEpisodeVersion: previous.versionNumber,
      toEpisode: {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        campaignId: input.campaignId,
        storyId: input.storyId,
        episodeId: current.id,
        episodeVersion: current.versionNumber,
        episodeOrder: current.versionNumber,
        storyVersionId: current.id,
      },
      characterAuthorities,
      retainedUnresolvedBeatIds: authority.narrativeState.unresolvedBeatIds,
      approvedLocationChange:
        currentDna?.episodeLook.location != null &&
        currentDna.episodeLook.location !== authority.locationState?.state,
      approvedOutfitChanges,
    });
    return buildEpisodeContinuityPlanningContext({
      authority,
      approvedCurrentEpisodeChanges,
    });
  }
}
