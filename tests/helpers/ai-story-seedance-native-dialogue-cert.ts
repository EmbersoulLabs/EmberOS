import {
  AiStoryGenerationUnitSchema,
  AiStoryScriptVersionSchema,
  SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT,
  type AiStoryCompiledProviderRequest,
} from "@ceo-agent/shared";
import {
  compileAiStoryCharacterDialoguePerformanceAuthority,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import {
  buildSeedanceNativeAudioCapability,
  compileImmutableSeedanceNativeAvRequest,
  compileImmutableSeedanceRequestFromSceneCompilation,
} from "../../packages/agents/src/ai-story";
import { makePhase2aCompilation } from "./ai-story-phase-2a";

const id = (n: number) =>
  `ce000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

export const SEEDANCE_NATIVE_DIALOGUE_CERT_DURATION_SEC = 8 as const;
export const SEEDANCE_NATIVE_DIALOGUE_CERT_RATIO = "9:16" as const;
export const SEEDANCE_NATIVE_DIALOGUE_CERT_RESOLUTION = "480p" as const;
export const SEEDANCE_NATIVE_DIALOGUE_CERT_MAX_SPEND_USD = "2.00" as const;

export const SEEDANCE_NATIVE_DIALOGUE_PERFORMANCE_PROMPT = [
  "A generic adult Malaysian Chinese person, not a celebrity and not a real identifiable person,",
  "stands in a simple realistic indoor kitchen, casually noticing something on the counter.",
  "Medium-close framing: face, mouth, and upper-body performance are clearly visible.",
  "Avoid extreme close-up lips-only framing. Avoid distant full-body framing.",
  "The character is spontaneously reacting to something they just noticed.",
  "CHARACTER_DIALOGUE = PERFORMANCE. CHARACTER_DIALOGUE is not READING.",
  "Require spontaneous conversational delivery, natural Malaysian Chinese cadence,",
  "slight natural hesitation, sentence-level emphasis, facial reaction before and during speech,",
  "subtle eye movement, natural breathing, small head and body movement, synchronized mouth movement.",
  "No announcer voice. No advertisement readout. No static talking-head stiffness. No exaggerated acting.",
].join(" ");

export function estimateSeedanceNativeDialogueCertCostUsd(
  durationSeconds: number
): string {
  const estimatedTokens =
    (durationSeconds * 480 * 854 * 24) / 1024;
  const estimatedUsd = (estimatedTokens * 7) / 1_000_000;
  return (Math.ceil(estimatedUsd * 100) / 100).toFixed(2);
}

export function compileSeedanceNativeDialogueCertificationRequest(): {
  readonly baseRequest: AiStoryCompiledProviderRequest;
  readonly request: AiStoryCompiledProviderRequest;
  readonly dialogueAuthorityId: string;
  readonly characterAuthorityId: string;
  readonly generationUnitId: string;
  readonly exactText: string;
} {
  const compilation = makePhase2aCompilation({
    sceneOrder: [0],
    referenceFreeT2vOrders: [0],
    instructionPurpose: SEEDANCE_NATIVE_DIALOGUE_PERFORMANCE_PROMPT,
  });
  const sourceIntent = compilation.intents[0]!;
  const sourceInstructions =
    compilation.instructionsBySceneExecutionId[
      sourceIntent.identity.sceneExecutionId
    ]!;
  const baseRequest = compileImmutableSeedanceRequestFromSceneCompilation({
    intent: {
      ...sourceIntent,
      plannedDurationMs: SEEDANCE_NATIVE_DIALOGUE_CERT_DURATION_SEC * 1000,
      referencedAssetIds: [],
      generationAuthority: {
        strategy: "TEXT_TO_VIDEO",
        referenceSource: "REFERENCE_FREE_T2V",
        effectiveReferenceIds: [],
        firstFrameAssetId: null,
        productVisualIdentityRequirement: "NONE",
      },
    },
    instructions: {
      ...sourceInstructions,
      referencedAssetIds: [],
      durationMs: SEEDANCE_NATIVE_DIALOGUE_CERT_DURATION_SEC * 1000,
      purpose: SEEDANCE_NATIVE_DIALOGUE_PERFORMANCE_PROMPT,
      productIdentityConstraints: [],
      shots: sourceInstructions.shots.map((shot) => ({
        ...shot,
        durationMs: SEEDANCE_NATIVE_DIALOGUE_CERT_DURATION_SEC * 1000,
        cameraType: "medium-close",
        cameraMovement: "subtle natural head and body movement",
        composition:
          "medium-close visible face, mouth, and upper body; not lips-only; not distant full-body",
        framing: "upper-body performance",
        emotion: "spontaneous pleasant surprise",
        information:
          "Visible character notices something and speaks the exact frozen Script line natively",
      })),
      generationAuthority: {
        strategy: "TEXT_TO_VIDEO",
        referenceSource: "REFERENCE_FREE_T2V",
        effectiveReferenceIds: [],
        firstFrameAssetId: null,
        productVisualIdentityRequirement: "NONE",
      },
    },
    authority: {
      qcEvaluationId: id(1),
      qcFingerprint: sha256CanonicalIntegrityHash("native-dialogue-cert-qc"),
      qcCapabilityVersion: "seedance-native-dialogue-cert.v1",
      directorFingerprint: sha256CanonicalIntegrityHash(
        "native-dialogue-cert-director"
      ),
      motionFingerprint: sha256CanonicalIntegrityHash(
        "native-dialogue-cert-motion"
      ),
    },
    adapterVersion: "seedance-canonical-runtime.v1",
    compiledAt: "2026-09-21T12:00:00.000Z",
    resolution: SEEDANCE_NATIVE_DIALOGUE_CERT_RESOLUTION,
    referenceAssets: [],
  });
  const scriptVersionId = id(2);
  const sceneId = id(3);
  const characterId = id(4);
  const locationId = id(5);
  const entryId = id(6);
  const directorPlanId = id(7);
  const directorShotId = id(8);
  const generationUnitId = id(9);
  const unit = AiStoryGenerationUnitSchema.parse({
    generationUnitId,
    storyId: baseRequest.storyId,
    storyVersionId: baseRequest.storyVersionId,
    sceneId,
    sceneVersionId: id(10),
    directorPlanId,
    directorShotId,
    directorShotIds: [directorShotId],
    order: 0,
    unitType: "PROVIDER_VIDEO",
    sourceAuthority: {
      lineage: [
        "FROZEN_SCRIPT",
        "FROZEN_SCENE",
        "FROZEN_DIRECTOR_PLAN",
        "EXACT_DIRECTOR_SHOT",
      ],
      scriptVersionId,
      sceneFingerprint: sha256CanonicalIntegrityHash("native-dialogue-cert-scene"),
      directorPlanId,
      directorShotId,
      productAuthorityIds: [],
      productSourceAssetIds: [],
      productContentHashes: [],
      locationId,
      characterIds: [characterId],
    },
    executionRequirement: {
      materialSubjectAction: true,
      characterPerformance: true,
      physicalInteraction: false,
      complexEnvironmentalMotion: false,
      generatedWorldMotion: true,
      cameraMovementAlone: false,
      productPresenceAlone: false,
    },
    necessity: "REQUIRED_GENERATIVE_VIDEO",
    necessityEvidence: [
      {
        code: "VISIBLE_CHARACTER_DIALOGUE",
        dimension: "CHARACTER_PERFORMANCE",
        present: true,
        safeEvidence:
          "Visible on-screen speaker performs frozen native dialogue",
      },
    ],
    supportedActionEntryIds: [id(11)],
    supportedActionPhaseIds: [],
    supportedStateDeltaIndexes: [],
    servedAudienceInformation: ["Character reaction"],
    inheritedContinuity: {
      locationId,
      characterIds: [characterId],
      productAuthorityIds: [],
    },
    nativeAvMode: "NATIVE_AUDIO_VIDEO",
    nativeDialogueEntryIds: [entryId],
    retryOwnership: {
      retryScope: "GENERATION_UNIT",
      siblingUnitsRemainValid: true,
      sceneRetryDoesNotRegenerateEveryShot: true,
    },
    fingerprint: sha256CanonicalIntegrityHash("native-dialogue-cert-unit"),
  });
  const scriptWithoutHash = {
    scriptVersionId,
    storyId: baseRequest.storyId,
    storyVersionId: baseRequest.storyVersionId,
    outlineVersionId: id(12),
    orgId: baseRequest.orgId,
    workspaceId: baseRequest.workspaceId,
    version: 1,
    contractVersion: "ai-story-script.v1" as const,
    profileId: "COMMERCIAL_STORY" as const,
    profileVersion: 1 as const,
    outlineSourceHash: sha256CanonicalIntegrityHash("native-dialogue-cert-outline"),
    scenes: [
      {
        scriptSceneId: sceneId,
        order: 0,
        outlineBeatClaims: [{ outlineBeatId: id(13), claim: "Discovery" }],
        sceneFunction: "INTRODUCE" as const,
        sceneFunctionRegistryVersion: 1 as const,
        sceneStateIn: [],
        sceneStateDeltas: [],
        sceneStateOut: [],
        entries: [
          {
            entryId: id(11),
            order: 0,
            durationRange: { minSeconds: 1, maxSeconds: 2 },
            type: "ACTION" as const,
            subjectId: characterId,
            action: "The host notices something on the kitchen counter.",
            storyEffect: "Motivates the spoken reaction.",
          },
          {
            entryId,
            order: 1,
            durationRange: { minSeconds: 2, maxSeconds: 5 },
            type: "DIALOGUE" as const,
            speakerId: characterId,
            line: SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT,
            deliveryOrSubtext: "MALAYSIAN_CHINESE_CONVERSATIONAL",
            language: "zh-MY",
          },
        ],
        characterIds: [characterId],
        locationIds: [locationId],
        propIds: [],
        assetIds: [],
        productAuthorityRefs: [],
        targetDurationRange: { minSeconds: 5, maxSeconds: 8 },
        mustKeep: ["Exact dialogue"],
        mustAvoid: ["Detached narration", "Invented dialect particles"],
        newInformation: ["The noticed object looks appealing"],
        newEvidence: [],
        newActionOutcomes: ["Host reacts"],
        productEvidence: [],
      },
    ],
    authorityReferences: [
      { authorityType: "CHARACTER" as const, authorityId: characterId },
      { authorityType: "LOCATION" as const, authorityId: locationId },
    ],
    status: "FROZEN" as const,
    supersedesScriptVersionId: null,
    createdBy: id(14),
    createdAt: "2026-09-21T09:00:00.000Z",
    approvedBy: id(14),
    approvedAt: "2026-09-21T09:01:00.000Z",
    frozenAt: "2026-09-21T09:02:00.000Z",
  };
  const script = AiStoryScriptVersionSchema.parse({
    ...scriptWithoutHash,
    sourceHash: sha256CanonicalIntegrityHash(scriptWithoutHash),
  });
  const authority = compileAiStoryCharacterDialoguePerformanceAuthority({
    script,
    generationUnit: unit,
    scriptSceneId: sceneId,
    dialogueEntryId: entryId,
    primaryLocale: "zh-MY",
    secondaryLocales: ["en-MY"],
    codeSwitchPolicy: {
      mode: "SCRIPT_AUTHORIZED",
      allowedLocales: ["zh-MY", "en-MY"],
    },
    deliveryStyle: "MANDARIN_MY_CONVERSATIONAL",
    performanceIntent:
      "MALAYSIAN_CHINESE_CONVERSATIONAL. CHARACTER_DIALOGUE = PERFORMANCE, not READING. Spontaneous conversational delivery with natural Malaysian Chinese cadence, slight hesitation, sentence-level emphasis, facial reaction before and during speech, subtle eye movement, natural breathing, small head/body movement, and synchronized mouth movement. No announcer voice, advertisement readout, static talking-head stiffness, or exaggerated acting.",
    emotionIntent: "Pleasantly surprised after noticing something",
    speechIntensity: "NATURAL",
    paceIntent: "NATURAL",
    mustPreserve: [
      SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT,
      "Exact frozen Script text and meaning",
    ],
    mustAvoid: [
      "lah",
      "lor",
      "leh",
      "ah",
      "wah",
      "Detached TTS",
      "Translation",
      "Invented dialect particles",
    ],
  });
  const request = compileImmutableSeedanceNativeAvRequest({
    baseRequest,
    dialogueAuthority: authority,
    capability: buildSeedanceNativeAudioCapability(),
    detachedTtsBindings: [],
  });
  return {
    baseRequest,
    request,
    dialogueAuthorityId: authority.dialogueAuthorityId,
    characterAuthorityId: authority.characterId,
    generationUnitId: unit.generationUnitId,
    exactText: authority.exactText,
  };
}
