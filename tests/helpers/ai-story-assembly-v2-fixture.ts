import {
  AiStoryGenerationPlanSchema,
  AiStoryNarrativeEditorialPlanSchema,
  type AiStoryAssemblyV2SourceMedia,
  type AiStoryGenerationPlan,
  type AiStoryNarrativeEditorialPlan,
} from "@ceo-agent/shared";
import {
  compileAiStoryAssemblyV2Plan,
  computeAiStoryNarrativeEditorialPlanFingerprint,
  sha256CanonicalIntegrityHash,
  type CompileAiStoryAssemblyV2PlanInput,
} from "@ceo-agent/shared/server";

const id = (n: number) =>
  `b2000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (value: unknown) => sha256CanonicalIntegrityHash(value);

export type AssemblyV2FixtureSource = {
  path: string;
  hash: string;
  durationMs: number;
  width?: number;
  height?: number;
  frameRate?: number | null;
};

export type AssemblyV2FixtureEntry = {
  sourceIndex: number;
  role:
    | "ESTABLISH"
    | "ACTION"
    | "DETAIL"
    | "DISCOVERY"
    | "REACTION"
    | "CONSEQUENCE"
    | "PAYOFF"
    | "HERO"
    | "CTA";
  durationSeconds: number;
  transition?: "HARD_CUT" | "DISSOLVE" | "MATCH_CUT" | "FADE" | "CONTINUOUS_ACTION";
  sceneIndex?: number;
};

export function buildAssemblyV2Fixture(input: {
  sources: readonly AssemblyV2FixtureSource[];
  entries: readonly AssemblyV2FixtureEntry[];
  omittedSourceIndexes?: readonly number[];
  optionalSourceIndexes?: readonly number[];
  profileId?: "CORE" | "PRODUCT_STORY" | "COMMERCIAL_STORY";
  base?: number;
  frozen?: boolean;
  nativeAudioSourceIndexes?: readonly number[];
  outputWidth?: number;
  outputHeight?: number;
}) {
  const base = input.base ?? 1_000;
  const storyId = id(base + 1);
  const storyVersionId = id(base + 2);
  const scriptVersionId = id(base + 3);
  const directorPlanId = id(base + 4);
  const editorialPlanId = id(base + 5);
  const createdBy = id(base + 6);
  const sceneIndexes = [
    ...new Set(input.entries.map((entry) => entry.sceneIndex ?? 0)),
  ].sort((a, b) => a - b);
  const nativeAudio = new Set(input.nativeAudioSourceIndexes ?? []);

  const units = input.sources.map((_, index) => {
    const sceneIndex =
      input.entries.find((entry) => entry.sourceIndex === index)?.sceneIndex ?? 0;
    return {
      generationUnitId: id(base + 100 + index),
      storyId,
      storyVersionId,
      sceneId: id(base + 20 + sceneIndex),
      sceneVersionId: id(base + 30 + sceneIndex),
      directorPlanId,
      directorShotId: id(base + 200 + index),
      directorShotIds: [id(base + 200 + index)],
      order: index,
      unitType: "PROVIDER_VIDEO" as const,
      sourceAuthority: {
        lineage: [
          "FROZEN_SCRIPT",
          "FROZEN_SCENE",
          "FROZEN_DIRECTOR_PLAN",
          "EXACT_DIRECTOR_SHOT",
        ] as const,
        scriptVersionId,
        sceneFingerprint: hash({ sceneIndex }),
        directorPlanId,
        directorShotId: id(base + 200 + index),
        productAuthorityIds: [],
        productSourceAssetIds: [],
        productContentHashes: [],
        locationId: id(base + 40 + sceneIndex),
        characterIds: [id(base + 7)],
      },
      executionRequirement: {
        materialSubjectAction: true,
        characterPerformance: nativeAudio.has(index),
        physicalInteraction: false,
        complexEnvironmentalMotion: false,
        generatedWorldMotion: false,
        cameraMovementAlone: false,
        productPresenceAlone: false,
      },
      necessity: "REQUIRED_GENERATIVE_VIDEO" as const,
      necessityEvidence: [
        {
          code: "MATERIAL_ACTION",
          dimension: "MATERIAL_SUBJECT_ACTION" as const,
          present: true,
          safeEvidence: "Synthetic fixture represents authorized moving source material",
        },
      ],
      supportedActionEntryIds: [id(base + 300 + index)],
      supportedActionPhaseIds: [id(base + 400 + index)],
      supportedStateDeltaIndexes: [index],
      servedAudienceInformation: [`Fixture information ${index}`],
      inheritedContinuity: {
        locationId: id(base + 40 + sceneIndex),
        characterIds: [id(base + 7)],
        productAuthorityIds: [],
      },
      ...(nativeAudio.has(index)
        ? {
            nativeAvMode: "NATIVE_AUDIO_VIDEO" as const,
            nativeDialogueEntryIds: [id(base + 800 + index)],
          }
        : {}),
      retryOwnership: {
        retryScope: "GENERATION_UNIT" as const,
        siblingUnitsRemainValid: true as const,
        sceneRetryDoesNotRegenerateEveryShot: true as const,
      },
      fingerprint: hash({ unit: index, base }),
    };
  });

  const generationPlans: AiStoryGenerationPlan[] = sceneIndexes.map((sceneIndex) => {
    const sceneUnits = units.filter(
      (unit) => unit.sceneId === id(base + 20 + sceneIndex)
    );
    return AiStoryGenerationPlanSchema.parse({
      generationPlanId: id(base + 500 + sceneIndex),
      contractVersion: "ai-story-generation-plan.v1",
      storyId,
      storyVersionId,
      sceneId: id(base + 20 + sceneIndex),
      sceneVersionId: id(base + 30 + sceneIndex),
      directorPlanId,
      units: sceneUnits,
      fingerprint: hash({
        base,
        sceneIndex,
        units: sceneUnits.map((unit) => unit.fingerprint),
      }),
    });
  });

  const entryBySource = new Map(
    input.entries.map((entry, order) => [entry.sourceIndex, { ...entry, order }])
  );
  const omitted = new Set(input.omittedSourceIndexes ?? []);
  const optional = new Set(input.optionalSourceIndexes ?? []);
  const dispositions = units.map((unit, index) => ({
    generationUnitId: unit.generationUnitId,
    directorShotId: unit.directorShotId,
    sceneId: unit.sceneId,
    disposition: omitted.has(index)
      ? ("OMIT" as const)
      : optional.has(index)
        ? ("OPTIONAL" as const)
        : ("USE" as const),
    omissionReason: omitted.has(index) ? ("REDUNDANT" as const) : null,
    requiredNarrativeShot: false,
  }));
  const timeline = input.entries.map((entry, order) => {
    const unit = units[entry.sourceIndex]!;
    const isContinuous = entry.transition === "CONTINUOUS_ACTION";
    return {
      timelineEntryId: id(base + 600 + order),
      order,
      sceneId: unit.sceneId,
      sceneVersionId: unit.sceneVersionId,
      directorShotId: unit.directorShotId,
      generationUnitId: unit.generationUnitId,
      sourceMaterialKind: "GENERATED_VIDEO" as const,
      editorialRole: entry.role,
      sourceInIntent:
        entry.role === "ACTION"
          ? ("ACTION_ONSET" as const)
          : entry.role === "REACTION"
            ? ("REACTION_ONSET" as const)
            : ("FIRST_VALID_FRAME" as const),
      sourceOutIntent:
        entry.role === "ACTION"
          ? ("ACTION_COMPLETE" as const)
          : entry.role === "REACTION"
            ? ("REACTION_READABLE" as const)
            : entry.role === "HERO" || entry.role === "CTA" || entry.role === "PAYOFF"
              ? ("HERO_SETTLED" as const)
              : ("BEFORE_REDUNDANT_HOLD" as const),
      usesFullSourceDuration: false,
      targetDurationRange: {
        minSeconds: entry.durationSeconds,
        maxSeconds: entry.durationSeconds,
      },
      cutInReason:
        entry.role === "REACTION"
          ? ("REACTION" as const)
          : entry.role === "PAYOFF" || entry.role === "HERO"
            ? ("PAYOFF" as const)
            : ("NEW_INFORMATION" as const),
      cutOutReason:
        isContinuous
          ? ("ACTION_CONTINUES" as const)
          : entry.role === "CTA"
            ? ("CTA_RESOLUTION" as const)
            : ("ACTION_COMPLETES" as const),
      continuityRelationship: isContinuous
        ? ("CONTINUOUS_ACTION" as const)
        : order === 0
          ? ("NONE" as const)
          : ("MATCH_STATE" as const),
      pacingFunction:
        entry.role === "REACTION"
          ? "REACTION_BREATH"
          : entry.role === "PAYOFF" || entry.role === "HERO"
            ? "PAYOFF_HOLD"
            : entry.role === "CTA"
              ? "CTA_SETTLE"
              : entry.role === "ACTION"
                ? "ACCELERATE"
                : "BUILD",
      transitionIntent: entry.transition ?? "HARD_CUT",
      transitionRationale:
        entry.transition === "DISSOLVE"
          ? "Editorially authorized temporal blend"
          : isContinuous
            ? "Preserve continuous action relationship"
            : null,
      requiredNarrativeInformation: [`Fixture information ${entry.sourceIndex}`],
      mustPreserve: ["Frozen editorial order"],
      mustAvoid: ["No invented editorial authority"],
      supportedActionEntryIds: [...unit.supportedActionEntryIds],
      supportedActionPhaseIds: [...unit.supportedActionPhaseIds],
    };
  });
  const sceneBridges = sceneIndexes.slice(1).map((sceneIndex, index) => ({
    fromSceneId: id(base + 20 + sceneIndexes[index]!),
    toSceneId: id(base + 20 + sceneIndex),
    bridgeType: "MATCH_STATE" as const,
    continuityFacts: ["Carry authorized state"],
    carriedAction: null,
    carriedObjectState: null,
    carriedCharacterState: "Character state persists",
    carriedLocationState: "Authorized Scene location",
    visualBridgeIntent: "Preserve order with a hard cut",
    temporalRelation: "CONTINUOUS" as const,
    cutMotivation: "NEW_INFORMATION" as const,
  }));
  const sourceHash = hash({
    generationPlans: generationPlans.map((plan) => plan.fingerprint),
    timeline: timeline.map((entry) => entry.timelineEntryId),
  });
  const editorialWithoutFingerprint = {
    editorialPlanId,
    storyId,
    storyVersionId,
    scriptVersionId,
    directorPlanId,
    sourceGenerationPlanFingerprints: generationPlans.map((plan) => plan.fingerprint),
    version: 1,
    contractVersion: "ai-story-narrative-editorial-plan.v1" as const,
    profileId: input.profileId ?? ("PRODUCT_STORY" as const),
    nonlinearNarrativeAuthority: false as const,
    timeline,
    dispositions,
    storyPacingIntent: {
      storyPacingIntentId: id(base + 8),
      functions: [...new Set(timeline.map((entry) => entry.pacingFunction))],
      defaultTransition: "HARD_CUT" as const,
      notes: ["Assembly executes frozen editorial authority"],
    },
    sceneBridges,
    editorialReviewRequired: false,
    sourceHash,
    supersedesEditorialPlanId: null,
  };
  const editorialFingerprint = computeAiStoryNarrativeEditorialPlanFingerprint(
    editorialWithoutFingerprint
  );
  const editorialPlan: AiStoryNarrativeEditorialPlan =
    AiStoryNarrativeEditorialPlanSchema.parse({
      ...editorialWithoutFingerprint,
      editorialFingerprint,
      status: input.frozen === false ? "APPROVED" : "FROZEN",
      createdBy,
      createdAt: "2026-09-21T01:00:00.000Z",
      approvedBy: createdBy,
      approvedAt: "2026-09-21T01:01:00.000Z",
      frozenAt: input.frozen === false ? null : "2026-09-21T01:02:00.000Z",
    });

  const acceptedSourceMedia: AiStoryAssemblyV2SourceMedia[] = input.sources.map(
    (source, index) => ({
      sourceResultId: id(base + 700 + index),
      generationUnitId: units[index]!.generationUnitId,
      directorShotId: units[index]!.directorShotId,
      sourceUri: `fixture://assembly-v2/source-${index}.mp4`,
      contentHash: source.hash,
      mediaType: "video/mp4",
      acceptanceStatus: "ACCEPTED",
      durationMs: source.durationMs,
      width: source.width ?? 320,
      height: source.height ?? 180,
      frameRate: source.frameRate ?? 30,
      nativeAvMode: nativeAudio.has(index)
        ? ("NATIVE_AUDIO_VIDEO" as const)
        : ("VIDEO_ONLY" as const),
      hasAudio: nativeAudio.has(index),
      semanticTimingEvidence: [],
    })
  );
  const compileInput: CompileAiStoryAssemblyV2PlanInput = {
    editorialPlan,
    generationPlans,
    acceptedSourceMedia,
    outputProfile: {
      width: input.outputWidth ?? 320,
      height: input.outputHeight ?? 180,
      frameRate: 30,
      videoCodec: "h264",
      pixelFormat: "yuv420p",
      containerFormat: "mp4",
      audioPolicy:
        nativeAudio.size > 0
          ? "PRESERVE_NATIVE_DIALOGUE"
          : "VIDEO_ONLY",
      aspectRatioPolicy: "PRESERVE_EXACT",
    },
    optionalResolutionPolicy: "EXCLUDE_ALL",
  };
  return {
    compileInput,
    editorialPlan,
    generationPlans,
    acceptedSourceMedia,
    units,
    entryBySource,
    sourcePathByResultId: new Map(
      acceptedSourceMedia.map((source, index) => [
        source.sourceResultId,
        input.sources[index]!.path,
      ])
    ),
    compile: () => compileAiStoryAssemblyV2Plan(compileInput),
  };
}
