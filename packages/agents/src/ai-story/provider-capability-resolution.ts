import { z } from "zod";
import {
  AiStoryModeResolutionSnapshotSchema,
  type AiStoryModeResolutionSnapshot,
} from "@ceo-agent/shared";
import {
  AI_STORY_SEEDANCE_CAPABILITY_CONTRACT_VERSION,
  AI_STORY_SEEDANCE_MAPPING_VERSION,
  AI_STORY_SEEDANCE_NATIVE_AV_MAPPING_VERSION,
} from "@ceo-agent/shared";
import {
  SEEDANCE_ADAPTER_VERSION,
  SEEDANCE_MAX_REFERENCE_IMAGES,
  SEEDANCE_NATIVE_AUDIO_SUPPORTED_DURATIONS_SEC,
  SEEDANCE_PROVIDER_ID,
  SEEDANCE_SUPPORTED_ASPECT_RATIOS,
  SEEDANCE_SUPPORTED_DURATIONS_SEC,
  SEEDANCE_SUPPORTED_RESOLUTIONS,
  seedanceSupportsFirstFrameI2v,
  seedanceSupportsNativeAudio,
} from "./seedance-capability";

export const AI_STORY_PROVIDER_CAPABILITY_REGISTRY_VERSION =
  "ai-story-provider-capability-registry.v1" as const;
export const AI_STORY_PROVIDER_RESOLUTION_VERSION =
  "ai-story-provider-resolution.v1" as const;
export const AI_STORY_PROVIDER_COMPILE_INTENT_VERSION =
  "ai-story-provider-compile-intent.v1" as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1);

const GenerationModeSchema = z.enum([
  "TEXT_TO_VIDEO",
  "IMAGE_TO_VIDEO",
  "VIDEO_TO_VIDEO",
]);

const VisualCapabilitySchema = z.enum([
  "NEED_TEXT_GENERATION",
  "NEED_SOURCE_IMAGE",
  "NEED_SOURCE_VIDEO",
  "NEED_CHARACTER_IDENTITY",
  "NEED_PRODUCT_FIDELITY",
  "NEED_ENVIRONMENT_FIDELITY",
  "NEED_VISUAL_CONTINUITY",
  "NEED_MOTION_CONTINUATION",
]);

const AudioCapabilitySchema = z.enum([
  "NEED_NATIVE_DIALOGUE",
  "NEED_NARRATION",
  "NEED_POST_TTS",
  "NEED_SOURCE_AUDIO_PRESERVE",
  "NEED_SOURCE_AUDIO_REPLACE",
  "NEED_SILENT_OUTPUT",
]);

const AuthorityCapabilitySchema = z.enum([
  "NEED_CHARACTER_DNA",
  "NEED_PRODUCT_AUTHORITY",
  "NEED_EXACT_SOURCE_FRAME",
  "NEED_SOURCE_VIDEO_AUTHORITY",
]);

export const AiStoryProviderExecutionSettingsSchema = z
  .object({
    durationSec: z.number().int().positive(),
    aspectRatio: Text,
    resolution: Text,
    watermark: z.boolean().default(false),
  })
  .strict();

export const AiStoryProviderCapabilityDeclarationSchema = z
  .object({
    registryVersion: z.literal(
      AI_STORY_PROVIDER_CAPABILITY_REGISTRY_VERSION
    ),
    providerId: Text,
    implementationId: Text,
    adapterVersion: Text,
    modelId: Text,
    capabilityVersion: Text,
    certifiedGenerationModes: z.array(GenerationModeSchema),
    visualCapabilities: z.array(VisualCapabilitySchema),
    audioCapabilities: z.array(AudioCapabilitySchema),
    authorityCapabilities: z.array(AuthorityCapabilitySchema),
    transportCapabilities: z
      .object({
        sourceImage: z.boolean(),
        sourceVideo: z.boolean(),
        firstFrameAuthority: z.boolean(),
        imageReferenceConsumption: z.boolean(),
        characterDnaTextConsumption: z.boolean(),
        sourceVideoTransformation: z.boolean(),
        continuitySupport: z.boolean(),
      })
      .strict(),
    outputConstraints: z
      .object({
        supportedDurationsSec: z.array(z.number().int().positive()),
        nativeAudioSupportedDurationsSec: z.array(
          z.number().int().positive()
        ),
        supportedAspectRatios: z.array(Text),
        supportedResolutions: z.array(Text),
        maxReferenceImages: z.number().int().nonnegative(),
      })
      .strict(),
    certificationEvidence: z.array(Text).min(1),
  })
  .strict();

export type AiStoryProviderCapabilityDeclaration = z.infer<
  typeof AiStoryProviderCapabilityDeclarationSchema
>;

export const AiStoryProviderRegistryEntrySchema = z
  .object({
    declaration: AiStoryProviderCapabilityDeclarationSchema,
    availability: z
      .object({
        status: z.enum(["CONFIGURED", "UNAVAILABLE"]),
        checkedWithoutProviderCall: z.literal(true),
        reasons: z.array(Text),
      })
      .strict(),
  })
  .strict();

export type AiStoryProviderRegistryEntry = z.infer<
  typeof AiStoryProviderRegistryEntrySchema
>;

export function buildCertifiedSeedanceProviderEntry(input: {
  readonly configured: boolean;
  readonly unavailableReasons?: readonly string[];
  readonly modelId?: string;
}): AiStoryProviderRegistryEntry {
  const modelId =
    input.modelId?.trim() || "dreamina-seedance-2-0-260128";
  const nativeAudio = seedanceSupportsNativeAudio(modelId);
  const firstFrame = seedanceSupportsFirstFrameI2v(modelId);
  return AiStoryProviderRegistryEntrySchema.parse({
    declaration: {
      registryVersion: AI_STORY_PROVIDER_CAPABILITY_REGISTRY_VERSION,
      providerId: SEEDANCE_PROVIDER_ID,
      implementationId:
        "seedance:modelark:canonical-runtime.v1",
      adapterVersion: SEEDANCE_ADAPTER_VERSION,
      modelId,
      capabilityVersion:
        AI_STORY_SEEDANCE_CAPABILITY_CONTRACT_VERSION,
      certifiedGenerationModes: [
        "TEXT_TO_VIDEO",
        ...(firstFrame ? (["IMAGE_TO_VIDEO"] as const) : []),
      ],
      visualCapabilities: [
        "NEED_TEXT_GENERATION",
        ...(firstFrame ? (["NEED_SOURCE_IMAGE"] as const) : []),
        "NEED_CHARACTER_IDENTITY",
        "NEED_PRODUCT_FIDELITY",
        "NEED_ENVIRONMENT_FIDELITY",
        "NEED_VISUAL_CONTINUITY",
      ],
      audioCapabilities: [
        ...(nativeAudio ? (["NEED_NATIVE_DIALOGUE"] as const) : []),
        "NEED_NARRATION",
        "NEED_POST_TTS",
        "NEED_SILENT_OUTPUT",
      ],
      authorityCapabilities: [
        "NEED_CHARACTER_DNA",
        "NEED_PRODUCT_AUTHORITY",
        ...(firstFrame
          ? (["NEED_EXACT_SOURCE_FRAME"] as const)
          : []),
      ],
      transportCapabilities: {
        sourceImage: firstFrame,
        sourceVideo: false,
        firstFrameAuthority: firstFrame,
        imageReferenceConsumption: true,
        characterDnaTextConsumption: true,
        sourceVideoTransformation: false,
        continuitySupport: true,
      },
      outputConstraints: {
        supportedDurationsSec: [...SEEDANCE_SUPPORTED_DURATIONS_SEC],
        nativeAudioSupportedDurationsSec: nativeAudio
          ? [...SEEDANCE_NATIVE_AUDIO_SUPPORTED_DURATIONS_SEC]
          : [],
        supportedAspectRatios: [...SEEDANCE_SUPPORTED_ASPECT_RATIOS],
        supportedResolutions: [...SEEDANCE_SUPPORTED_RESOLUTIONS],
        maxReferenceImages: SEEDANCE_MAX_REFERENCE_IMAGES,
      },
      certificationEvidence: [
        "seedance-director-adapter: TEXT_TO_VIDEO and FIRST_FRAME_IMAGE_TO_VIDEO",
        "seedance-request-mapping: ModelArk generate_audio and first_frame mapping",
        nativeAudio
          ? "compiled-provider-request.v2-native-av: AUDIO enabled and native dialogue authority required"
          : "Configured model is not certified for native dialogue",
        "No EmberOS-certified Seedance VIDEO_TO_VIDEO transport exists",
      ],
    },
    availability: {
      status: input.configured ? "CONFIGURED" : "UNAVAILABLE",
      checkedWithoutProviderCall: true,
      reasons: input.configured
        ? []
        : input.unavailableReasons?.length
          ? [...input.unavailableReasons]
          : ["Seedance Adapter configuration is unavailable"],
    },
  });
}

const RejectionSchema = z
  .object({
    implementationId: Text,
    providerId: Text,
    code: z.enum([
      "MODE_UNSUPPORTED",
      "VISUAL_CAPABILITY_UNSUPPORTED",
      "AUDIO_CAPABILITY_UNSUPPORTED",
      "AUTHORITY_CAPABILITY_UNSUPPORTED",
      "OUTPUT_CONSTRAINT_UNSUPPORTED",
      "PROVIDER_UNAVAILABLE",
    ]),
    reasons: z.array(Text).min(1),
    unresolvedCapabilities: z.array(Text),
  })
  .strict();

export const AiStoryProviderResolutionSchema = z
  .object({
    contractVersion: z.literal(AI_STORY_PROVIDER_RESOLUTION_VERSION),
    providerResolutionId: Id,
    plannerSnapshotId: Id,
    storyId: Id,
    storyVersionId: Id,
    workspaceId: Id,
    status: z.enum([
      "SELECTED",
      "MULTIPLE_COMPATIBLE_PROVIDERS",
      "NO_COMPATIBLE_PROVIDER",
      "PROVIDER_UNAVAILABLE",
    ]),
    resolvedGenerationMode: GenerationModeSchema,
    candidateImplementationIds: z.array(Text),
    selectedImplementationId: Text.nullable(),
    selectedProviderId: Text.nullable(),
    rejectedCandidates: z.array(RejectionSchema),
    unresolvedCapabilities: z.array(Text),
    recommendedNextActions: z.array(Text),
    selectionPolicy: z.literal("SINGLE_COMPATIBLE_ONLY"),
    resolutionTrace: z.array(Text).min(1),
    executionSettings: AiStoryProviderExecutionSettingsSchema,
    resolvedAt: z.string().datetime(),
  })
  .strict();

export type AiStoryProviderResolution = z.infer<
  typeof AiStoryProviderResolutionSchema
>;

function unsupported<T extends string>(
  required: readonly T[],
  supported: readonly T[]
): T[] {
  const supportedSet = new Set<T>(supported);
  return required.filter((capability) => !supportedSet.has(capability));
}

export function resolveAiStoryProvider(input: {
  readonly providerResolutionId: string;
  readonly plannerSnapshot: AiStoryModeResolutionSnapshot;
  readonly registry: readonly AiStoryProviderRegistryEntry[];
  readonly executionSettings: z.input<
    typeof AiStoryProviderExecutionSettingsSchema
  >;
  readonly resolvedAt: string;
}): AiStoryProviderResolution {
  const planner = AiStoryModeResolutionSnapshotSchema.parse(
    input.plannerSnapshot
  );
  if (
    planner.resolutionStatus !== "RESOLVED" ||
    !planner.resolvedGenerationMode
  ) {
    throw new ProviderCapabilityResolutionError(
      "PLANNER_MODE_UNRESOLVED",
      "Provider resolution requires a resolved immutable Phase 4 mode"
    );
  }
  const settings = AiStoryProviderExecutionSettingsSchema.parse(
    input.executionSettings
  );
  const registry = input.registry.map((entry) =>
    AiStoryProviderRegistryEntrySchema.parse(entry)
  );
  const duplicateImplementations =
    new Set(registry.map((entry) => entry.declaration.implementationId))
      .size !== registry.length;
  if (duplicateImplementations) {
    throw new ProviderCapabilityResolutionError(
      "REGISTRY_INVALID",
      "Provider implementation IDs must be unique"
    );
  }

  const compatible: AiStoryProviderRegistryEntry[] = [];
  const unavailable: AiStoryProviderRegistryEntry[] = [];
  const rejected: z.infer<typeof RejectionSchema>[] = [];

  for (const entry of registry) {
    const declaration = entry.declaration;
    const reasons: string[] = [];
    const unresolved: string[] = [];
    let code: z.infer<typeof RejectionSchema>["code"] | null = null;

    if (
      !declaration.certifiedGenerationModes.includes(
        planner.resolvedGenerationMode
      )
    ) {
      code = "MODE_UNSUPPORTED";
      reasons.push(
        `${planner.resolvedGenerationMode} is not certified by this EmberOS implementation`
      );
      unresolved.push(planner.resolvedGenerationMode);
    }
    const missingVisual = unsupported(
      planner.capabilityRequirements.visual,
      declaration.visualCapabilities
    );
    const missingAudio = unsupported(
      planner.capabilityRequirements.audio,
      declaration.audioCapabilities
    );
    const missingAuthority = unsupported(
      planner.capabilityRequirements.authority,
      declaration.authorityCapabilities
    );
    if (missingVisual.length > 0) {
      code ??= "VISUAL_CAPABILITY_UNSUPPORTED";
      reasons.push(`Missing visual capabilities: ${missingVisual.join(", ")}`);
      unresolved.push(...missingVisual);
    }
    if (missingAudio.length > 0) {
      code ??= "AUDIO_CAPABILITY_UNSUPPORTED";
      reasons.push(`Missing audio capabilities: ${missingAudio.join(", ")}`);
      unresolved.push(...missingAudio);
    }
    if (missingAuthority.length > 0) {
      code ??= "AUTHORITY_CAPABILITY_UNSUPPORTED";
      reasons.push(
        `Missing authority capabilities: ${missingAuthority.join(", ")}`
      );
      unresolved.push(...missingAuthority);
    }
    const allowedDurations =
      planner.capabilityRequirements.audio.includes("NEED_NATIVE_DIALOGUE")
        ? declaration.outputConstraints.nativeAudioSupportedDurationsSec
        : declaration.outputConstraints.supportedDurationsSec;
    const outputRejections = [
      ...(!allowedDurations.includes(settings.durationSec)
        ? [`duration:${settings.durationSec}`]
        : []),
      ...(!declaration.outputConstraints.supportedAspectRatios.includes(
        settings.aspectRatio
      )
        ? [`aspectRatio:${settings.aspectRatio}`]
        : []),
      ...(!declaration.outputConstraints.supportedResolutions.includes(
        settings.resolution
      )
        ? [`resolution:${settings.resolution}`]
        : []),
    ];
    if (outputRejections.length > 0) {
      code ??= "OUTPUT_CONSTRAINT_UNSUPPORTED";
      reasons.push(
        `Unsupported execution settings: ${outputRejections.join(", ")}`
      );
      unresolved.push(...outputRejections);
    }

    if (code) {
      rejected.push({
        implementationId: declaration.implementationId,
        providerId: declaration.providerId,
        code,
        reasons,
        unresolvedCapabilities: [...new Set(unresolved)],
      });
    } else if (entry.availability.status === "UNAVAILABLE") {
      unavailable.push(entry);
      rejected.push({
        implementationId: declaration.implementationId,
        providerId: declaration.providerId,
        code: "PROVIDER_UNAVAILABLE",
        reasons: entry.availability.reasons,
        unresolvedCapabilities: [],
      });
    } else {
      compatible.push(entry);
    }
  }

  const status =
    compatible.length === 1
      ? "SELECTED"
      : compatible.length > 1
        ? "MULTIPLE_COMPATIBLE_PROVIDERS"
        : unavailable.length > 0 && rejected.length === unavailable.length
          ? "PROVIDER_UNAVAILABLE"
          : "NO_COMPATIBLE_PROVIDER";
  const selected = compatible.length === 1 ? compatible[0]! : null;
  const unresolvedCapabilities = [
    ...new Set(
      rejected.flatMap((candidate) => candidate.unresolvedCapabilities)
    ),
  ];

  return AiStoryProviderResolutionSchema.parse({
    contractVersion: AI_STORY_PROVIDER_RESOLUTION_VERSION,
    providerResolutionId: input.providerResolutionId,
    plannerSnapshotId: planner.plannerSnapshotId,
    storyId: planner.storyId,
    storyVersionId: planner.storyVersionId,
    workspaceId: planner.workspaceId,
    status,
    resolvedGenerationMode: planner.resolvedGenerationMode,
    candidateImplementationIds: compatible.map(
      (entry) => entry.declaration.implementationId
    ),
    selectedImplementationId: selected?.declaration.implementationId ?? null,
    selectedProviderId: selected?.declaration.providerId ?? null,
    rejectedCandidates: rejected,
    unresolvedCapabilities,
    recommendedNextActions:
      status === "NO_COMPATIBLE_PROVIDER"
        ? [
            "Configure an EmberOS-certified implementation for the unresolved execution contract",
          ]
        : status === "PROVIDER_UNAVAILABLE"
          ? ["Configure credentials and enable a compatible Provider Adapter"]
          : status === "MULTIPLE_COMPATIBLE_PROVIDERS"
            ? ["Apply an explicit configured Provider selection policy"]
            : [],
    selectionPolicy: "SINGLE_COMPATIBLE_ONLY",
    resolutionTrace: [
      `Phase 4 mode preserved: ${planner.resolvedGenerationMode}`,
      `${compatible.length} configured compatible implementation(s)`,
      `${rejected.length} rejected implementation(s)`,
      status,
    ],
    executionSettings: settings,
    resolvedAt: input.resolvedAt,
  });
}

export const AiStoryProviderSourceAuthoritySchema = z
  .object({
    orgId: Id,
    workspaceId: Id,
    bindingId: Id,
    assetId: Id,
    analysisSnapshotId: Id,
    contentHash: Hash,
    mediaType: Text,
    authorizedForProviderTransport: z.literal(true),
  })
  .strict();

export const AiStoryNativeDialogueCompileAuthoritySchema = z
  .object({
    dialogueAuthorityId: Id,
    storyId: Id,
    storyVersionId: Id,
    exactText: Text,
  })
  .strict();

const CompileSourceMappingSchema = z
  .object({
    bindingId: Id,
    assetId: Id,
    analysisSnapshotId: Id,
    contentHash: Hash,
    mediaType: Text,
    wireRole: z.enum(["first_frame", "source_video"]),
  })
  .strict();

export const AiStoryProviderCompileIntentSchema = z
  .object({
    contractVersion: z.literal(
      AI_STORY_PROVIDER_COMPILE_INTENT_VERSION
    ),
    compileIntentId: Id,
    dryRun: z.literal(true),
    providerCallCount: z.literal(0),
    providerResolutionId: Id,
    plannerSnapshotId: Id,
    orgId: Id,
    workspaceId: Id,
    storyId: Id,
    storyVersionId: Id,
    providerId: z.literal("seedance"),
    implementationId: z.literal(
      "seedance:modelark:canonical-runtime.v1"
    ),
    modelId: z.literal("dreamina-seedance-2-0-260128"),
    generationMode: GenerationModeSchema,
    providerGenerationMode: z.enum([
      "TEXT_TO_VIDEO",
      "FIRST_FRAME_IMAGE_TO_VIDEO",
    ]),
    requiredCapabilities: z
      .object({
        visual: z.array(VisualCapabilitySchema),
        audio: z.array(AudioCapabilitySchema),
        authority: z.array(AuthorityCapabilitySchema),
      })
      .strict(),
    blockedCapabilities: z.array(Text),
    generateAudio: z.boolean(),
    audioBehavior: z.enum([
      "NATIVE_DIALOGUE",
      "SILENT",
      "POST_TTS",
      "NARRATION_POST_PROCESS",
    ]),
    nativeDialogueAuthority:
      AiStoryNativeDialogueCompileAuthoritySchema.nullable(),
    sourceMappings: z.array(CompileSourceMappingSchema),
    referenceMappings: z.array(CompileSourceMappingSchema),
    supportingAuthorityBindingIds: z.array(Id),
    characterDnaAuthority: z
      .object({
        reusableCharacterId: Id,
        reusableCharacterVersionId: Id,
        characterDnaFingerprint: Hash,
      })
      .strict()
      .nullable(),
    sourcePhotoSentToVideoProvider: z.literal(false),
    syntheticAnchorSentToProvider: z.literal(false),
    requestFacts: z
      .object({
        model: z.literal("dreamina-seedance-2-0-260128"),
        duration: z.number().int().positive(),
        ratio: Text,
        resolution: Text,
        generateAudio: z.boolean(),
        watermark: z.boolean(),
        mappingVersion: Text,
      })
      .strict(),
    compiledAt: z.string().datetime(),
  })
  .strict();

export type AiStoryProviderCompileIntent = z.infer<
  typeof AiStoryProviderCompileIntentSchema
>;

export class ProviderCapabilityResolutionError extends Error {
  constructor(
    readonly code:
      | "PLANNER_MODE_UNRESOLVED"
      | "REGISTRY_INVALID"
      | "PROVIDER_NOT_SELECTED"
      | "COMPILE_AUTHORITY_INVALID"
      | "COMPILE_AUDIO_CONTRACT_INVALID",
    message: string
  ) {
    super(message);
    this.name = "ProviderCapabilityResolutionError";
  }
}

export function assertProviderCompileIntentConsistency(
  intent: AiStoryProviderCompileIntent
): void {
  const nativeDialogue =
    intent.requiredCapabilities.audio.includes("NEED_NATIVE_DIALOGUE");
  const silent =
    intent.requiredCapabilities.audio.includes("NEED_SILENT_OUTPUT");
  const audioBlocked = intent.blockedCapabilities.includes("AUDIO");
  if (intent.generateAudio && audioBlocked) {
    throw new ProviderCapabilityResolutionError(
      "COMPILE_AUDIO_CONTRACT_INVALID",
      "generateAudio=true cannot coexist with AUDIO blocked"
    );
  }
  if (
    nativeDialogue &&
    (!intent.generateAudio ||
      audioBlocked ||
      !intent.nativeDialogueAuthority)
  ) {
    throw new ProviderCapabilityResolutionError(
      "COMPILE_AUDIO_CONTRACT_INVALID",
      "Native dialogue requires generateAudio=true, AUDIO enabled, and exact dialogue authority"
    );
  }
  if (silent && intent.generateAudio) {
    throw new ProviderCapabilityResolutionError(
      "COMPILE_AUDIO_CONTRACT_INVALID",
      "Silent output cannot enable Provider-generated audio"
    );
  }
}

export function compileSeedanceProviderIntentDryRun(input: {
  readonly compileIntentId: string;
  readonly plannerSnapshot: AiStoryModeResolutionSnapshot;
  readonly providerResolution: AiStoryProviderResolution;
  readonly registryEntry: AiStoryProviderRegistryEntry;
  readonly sourceAuthorities?: readonly z.input<
    typeof AiStoryProviderSourceAuthoritySchema
  >[];
  readonly nativeDialogueAuthority?: z.input<
    typeof AiStoryNativeDialogueCompileAuthoritySchema
  > | null;
  readonly compiledAt: string;
}): AiStoryProviderCompileIntent {
  const planner = AiStoryModeResolutionSnapshotSchema.parse(
    input.plannerSnapshot
  );
  const resolution = AiStoryProviderResolutionSchema.parse(
    input.providerResolution
  );
  const registry = AiStoryProviderRegistryEntrySchema.parse(
    input.registryEntry
  );
  if (
    resolution.status !== "SELECTED" ||
    resolution.selectedProviderId !== "seedance" ||
    resolution.selectedImplementationId !==
      registry.declaration.implementationId ||
    resolution.plannerSnapshotId !== planner.plannerSnapshotId ||
    resolution.resolvedGenerationMode !== planner.resolvedGenerationMode
  ) {
    throw new ProviderCapabilityResolutionError(
      "PROVIDER_NOT_SELECTED",
      "Compile dry-run requires the exact selected Provider and Phase 4 snapshot"
    );
  }

  const sourceAuthorities = (input.sourceAuthorities ?? []).map((authority) =>
    AiStoryProviderSourceAuthoritySchema.parse(authority)
  );
  const bindingById = new Map(
    planner.bindingAuthorities.map((binding) => [
      binding.bindingId,
      binding,
    ])
  );
  for (const source of sourceAuthorities) {
    const binding = bindingById.get(source.bindingId);
    if (
      source.orgId !== planner.orgId ||
      source.workspaceId !== planner.workspaceId ||
      !binding ||
      source.assetId !== binding.assetId ||
      source.analysisSnapshotId !== binding.analysisSnapshotId ||
      source.contentHash !== binding.contentHash
    ) {
      throw new ProviderCapabilityResolutionError(
        "COMPILE_AUTHORITY_INVALID",
        "Provider source transport cannot substitute Asset, Snapshot, hash, or Workspace authority"
      );
    }
  }

  const selectedSources = planner.selectedBindingIds.map((bindingId) => {
    const source = sourceAuthorities.find(
      (candidate) => candidate.bindingId === bindingId
    );
    if (!source) {
      throw new ProviderCapabilityResolutionError(
        "COMPILE_AUTHORITY_INVALID",
        `Selected source binding ${bindingId} lacks authorized transport authority`
      );
    }
    return source;
  });
  const mode = planner.resolvedGenerationMode!;
  if (mode === "VIDEO_TO_VIDEO") {
    throw new ProviderCapabilityResolutionError(
      "PROVIDER_NOT_SELECTED",
      "Seedance EmberOS implementation is not certified for VIDEO_TO_VIDEO"
    );
  }
  if (
    mode === "IMAGE_TO_VIDEO" &&
    (selectedSources.length !== 1 ||
      !selectedSources[0]!.mediaType.toLowerCase().startsWith("image/"))
  ) {
    throw new ProviderCapabilityResolutionError(
      "COMPILE_AUTHORITY_INVALID",
      "IMAGE_TO_VIDEO requires exactly one authorized image source"
    );
  }
  if (mode === "TEXT_TO_VIDEO" && selectedSources.length > 0) {
    throw new ProviderCapabilityResolutionError(
      "COMPILE_AUTHORITY_INVALID",
      "TEXT_TO_VIDEO cannot transport mode-forcing source media"
    );
  }

  const audio = planner.capabilityRequirements.audio;
  const nativeDialogue = audio.includes("NEED_NATIVE_DIALOGUE");
  const silent = audio.includes("NEED_SILENT_OUTPUT");
  const postTts = audio.includes("NEED_POST_TTS");
  const narration = audio.includes("NEED_NARRATION");
  const dialogueAuthority = input.nativeDialogueAuthority
    ? AiStoryNativeDialogueCompileAuthoritySchema.parse(
        input.nativeDialogueAuthority
      )
    : null;
  if (
    dialogueAuthority &&
    (dialogueAuthority.storyId !== planner.storyId ||
      dialogueAuthority.storyVersionId !== planner.storyVersionId)
  ) {
    throw new ProviderCapabilityResolutionError(
      "COMPILE_AUTHORITY_INVALID",
      "Native dialogue authority is outside the planned Story Version"
    );
  }
  const generateAudio = nativeDialogue;
  const blockedCapabilities = [
    ...(!generateAudio ? ["AUDIO"] : []),
    "FIRST_LAST_FRAME",
    "MULTI_SHOT",
    "CHAINING",
    "VIDEO_EXTENSION",
    "4K",
    "CANCELLATION",
  ];
  const sourceMappings = selectedSources.map((source) => ({
    bindingId: source.bindingId,
    assetId: source.assetId,
    analysisSnapshotId: source.analysisSnapshotId,
    contentHash: source.contentHash,
    mediaType: source.mediaType,
    wireRole: "first_frame" as const,
  }));
  const providerGenerationMode =
    mode === "IMAGE_TO_VIDEO"
      ? "FIRST_FRAME_IMAGE_TO_VIDEO"
      : "TEXT_TO_VIDEO";
  const mappingVersion = nativeDialogue
    ? AI_STORY_SEEDANCE_NATIVE_AV_MAPPING_VERSION
    : AI_STORY_SEEDANCE_MAPPING_VERSION;
  const intent = AiStoryProviderCompileIntentSchema.parse({
    contractVersion: AI_STORY_PROVIDER_COMPILE_INTENT_VERSION,
    compileIntentId: input.compileIntentId,
    dryRun: true,
    providerCallCount: 0,
    providerResolutionId: resolution.providerResolutionId,
    plannerSnapshotId: planner.plannerSnapshotId,
    orgId: planner.orgId,
    workspaceId: planner.workspaceId,
    storyId: planner.storyId,
    storyVersionId: planner.storyVersionId,
    providerId: "seedance",
    implementationId: "seedance:modelark:canonical-runtime.v1",
    modelId: "dreamina-seedance-2-0-260128",
    generationMode: mode,
    providerGenerationMode,
    requiredCapabilities: planner.capabilityRequirements,
    blockedCapabilities,
    generateAudio,
    audioBehavior: nativeDialogue
      ? "NATIVE_DIALOGUE"
      : postTts
        ? "POST_TTS"
        : narration
          ? "NARRATION_POST_PROCESS"
          : silent
            ? "SILENT"
            : "SILENT",
    nativeDialogueAuthority: dialogueAuthority,
    sourceMappings,
    referenceMappings: sourceMappings,
    supportingAuthorityBindingIds: planner.bindingAuthorities
      .filter(
        (binding) => !planner.selectedBindingIds.includes(binding.bindingId)
      )
      .map((binding) => binding.bindingId),
    characterDnaAuthority: planner.characterDnaAuthority,
    sourcePhotoSentToVideoProvider: false,
    syntheticAnchorSentToProvider: false,
    requestFacts: {
      model: "dreamina-seedance-2-0-260128",
      duration: resolution.executionSettings.durationSec,
      ratio: resolution.executionSettings.aspectRatio,
      resolution: resolution.executionSettings.resolution,
      generateAudio,
      watermark: resolution.executionSettings.watermark,
      mappingVersion,
    },
    compiledAt: input.compiledAt,
  });
  assertProviderCompileIntentConsistency(intent);
  return intent;
}
