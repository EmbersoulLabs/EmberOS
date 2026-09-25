import { z } from "zod";
import {
  AiStoryAssetAnalysisSnapshotSchema,
  AiStoryAssetBindingSchema,
  AiStoryAssetRegistryEntrySchema,
  AiStoryNoAssetConfirmationSchema,
} from "./ai-story-asset-aware-execution-planner";

export const AI_STORY_ASSET_MATCHING_CONTRACT_VERSION =
  "ai-story-asset-matching.v1" as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1);

export const AiStoryRequirementKeySchema = z.enum([
  "CHARACTER_IDENTITY",
  "PRODUCT_IDENTITY",
  "ENVIRONMENT_FIDELITY",
  "SOURCE_MOTION",
  "VISUAL_CONTINUITY",
  "BRANDING",
  "SOURCE_AUDIO",
]);

export const AiStoryRequirementsProjectionSchema = z
  .object({
    characterIdentityRequired: z.boolean().default(false),
    productIdentityRequired: z.boolean().default(false),
    environmentFidelityRequired: z.boolean().default(false),
    sourceMotionRequired: z.boolean().default(false),
    visualContinuityRequired: z.boolean().default(false),
    brandingRequired: z.boolean().default(false),
    nativeDialogueDesired: z.boolean().default(false),
    narrationDesired: z.boolean().default(false),
    postTtsDesired: z.boolean().default(false),
    silenceDesired: z.boolean().default(false),
    sourceAudioPreserveDesired: z.boolean().default(false),
    sourceAudioReplaceDesired: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    const audioSelections = [
      value.nativeDialogueDesired,
      value.narrationDesired,
      value.postTtsDesired,
      value.silenceDesired,
      value.sourceAudioPreserveDesired,
      value.sourceAudioReplaceDesired,
    ].filter(Boolean).length;
    if (audioSelections > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Story Requirement projection must resolve one audio intent",
      });
    }
  });

export const AiStoryMatchingAudioIntentSchema = z.enum([
  "NATIVE_DIALOGUE",
  "NARRATION",
  "POST_TTS",
  "SILENT",
  "SOURCE_AUDIO_PRESERVE",
  "SOURCE_AUDIO_REPLACE",
]);

export const AiStoryAssetSemanticIntentSchema = z.enum([
  "CHARACTER_IDENTITY",
  "PRODUCT_IDENTITY",
  "ENVIRONMENT",
  "BRAND",
  "OPENING_COMPOSITION",
  "SOURCE_MOTION",
  "CONTINUITY",
  "SUPPORTING",
  "SOURCE_AUDIO",
  "UNRELATED",
]);

/**
 * Typed, untrusted semantic interpretation boundary. AI may propose these
 * values; deterministic matching validates every ID, Snapshot, hash, role,
 * affordance, and Workspace before authority is accepted.
 */
export const AiStoryAssetSemanticDecisionSchema = z
  .object({
    assetId: Id,
    analysisSnapshotId: Id,
    intent: AiStoryAssetSemanticIntentSchema,
    required: z.boolean(),
    reason: Text,
    source: z.enum([
      "HUMAN_SELECTION",
      "STORY_SEMANTIC_MATCHER",
      "CANONICAL_AUTHORITY",
    ]),
  })
  .strict();

export const AiStoryCharacterDnaMatchingAuthoritySchema = z
  .object({
    reusableCharacterId: Id,
    reusableCharacterVersionId: Id,
    characterDnaFingerprint: Hash,
  })
  .strict();

export const AiStoryAssetRecommendationStatusSchema = z.enum([
  "SATISFIED",
  "ASSET_RECOMMENDATION_REQUIRED",
  "CONFIRMED_NO_ASSETS",
]);

export const AiStoryAssetMatchingResultSchema = z
  .object({
    contractVersion: z.literal(AI_STORY_ASSET_MATCHING_CONTRACT_VERSION),
    matchingResultId: Id,
    orgId: Id,
    workspaceId: Id,
    storyId: Id,
    storyVersionId: Id,
    storyVersionNumber: z.number().int().positive(),
    requirements: AiStoryRequirementsProjectionSchema,
    bindings: z.array(AiStoryAssetBindingSchema),
    satisfiedRequirements: z.array(AiStoryRequirementKeySchema),
    missingRequirements: z.array(AiStoryRequirementKeySchema),
    assetRecommendationStatus: AiStoryAssetRecommendationStatusSchema,
    recommendedUploadRoles: z.array(
      z.enum([
        "PROTAGONIST_REFERENCE_PHOTO",
        "PRODUCT_PHOTO",
        "ENVIRONMENT_REFERENCE",
        "SOURCE_VIDEO",
        "BRAND_ASSET",
        "SOURCE_AUDIO",
      ])
    ),
    audioIntent: AiStoryMatchingAudioIntentSchema,
    characterDnaAuthority:
      AiStoryCharacterDnaMatchingAuthoritySchema.nullable(),
    noAssetConfirmation: AiStoryNoAssetConfirmationSchema.nullable(),
    trace: z.array(
      z
        .object({
          step: Text,
          outcome: Text,
          assetIds: z.array(Id),
        })
        .strict()
    ),
    matcherVersion: Text,
    createdAt: z.string().datetime(),
  })
  .strict();

export type AiStoryRequirementsProjection = z.infer<
  typeof AiStoryRequirementsProjectionSchema
>;
export type AiStoryAssetSemanticDecision = z.infer<
  typeof AiStoryAssetSemanticDecisionSchema
>;
export type AiStoryAssetMatchingResult = z.infer<
  typeof AiStoryAssetMatchingResultSchema
>;

export class AiStoryAssetMatchingError extends Error {
  constructor(
    readonly code:
      | "ASSET_MATCHING_SCOPE_MISMATCH"
      | "ASSET_MATCHING_SNAPSHOT_MISMATCH"
      | "ASSET_MATCHING_DECISION_INVALID",
    message: string
  ) {
    super(message);
    this.name = "AiStoryAssetMatchingError";
  }
}

function resolveAudioIntent(
  requirements: AiStoryRequirementsProjection
): z.infer<typeof AiStoryMatchingAudioIntentSchema> {
  if (requirements.nativeDialogueDesired) return "NATIVE_DIALOGUE";
  if (requirements.narrationDesired) return "NARRATION";
  if (requirements.postTtsDesired) return "POST_TTS";
  if (requirements.sourceAudioPreserveDesired)
    return "SOURCE_AUDIO_PRESERVE";
  if (requirements.sourceAudioReplaceDesired) return "SOURCE_AUDIO_REPLACE";
  return "SILENT";
}

function requiredKeys(
  requirements: AiStoryRequirementsProjection,
  audioIntent: z.infer<typeof AiStoryMatchingAudioIntentSchema>
): z.infer<typeof AiStoryRequirementKeySchema>[] {
  return [
    ...(requirements.characterIdentityRequired
      ? (["CHARACTER_IDENTITY"] as const)
      : []),
    ...(requirements.productIdentityRequired
      ? (["PRODUCT_IDENTITY"] as const)
      : []),
    ...(requirements.environmentFidelityRequired
      ? (["ENVIRONMENT_FIDELITY"] as const)
      : []),
    ...(requirements.sourceMotionRequired
      ? (["SOURCE_MOTION"] as const)
      : []),
    ...(requirements.visualContinuityRequired
      ? (["VISUAL_CONTINUITY"] as const)
      : []),
    ...(requirements.brandingRequired ? (["BRANDING"] as const) : []),
    ...(audioIntent === "SOURCE_AUDIO_PRESERVE"
      ? (["SOURCE_AUDIO"] as const)
      : []),
  ];
}

function roleForIntent(
  intent: z.infer<typeof AiStoryAssetSemanticIntentSchema>
): z.infer<typeof AiStoryAssetBindingSchema>["role"] {
  switch (intent) {
    case "CHARACTER_IDENTITY":
      return "CHARACTER_AUTHORITY";
    case "PRODUCT_IDENTITY":
      return "PRODUCT_AUTHORITY";
    case "ENVIRONMENT":
      return "ENVIRONMENT_AUTHORITY";
    case "BRAND":
      return "BRAND_ASSET";
    case "OPENING_COMPOSITION":
      return "SOURCE_IMAGE_CANDIDATE";
    case "SOURCE_MOTION":
      return "SOURCE_VIDEO_CANDIDATE";
    case "CONTINUITY":
      return "CONTINUITY_REFERENCE";
    case "SUPPORTING":
      return "SUPPORTING_REFERENCE";
    case "SOURCE_AUDIO":
      return "SOURCE_AUDIO";
    case "UNRELATED":
      return "UNUSED";
  }
}

function requirementsForRole(
  role: z.infer<typeof AiStoryAssetBindingSchema>["role"]
): z.infer<typeof AiStoryRequirementKeySchema>[] {
  switch (role) {
    case "CHARACTER_AUTHORITY":
      return ["CHARACTER_IDENTITY", "VISUAL_CONTINUITY"];
    case "PRODUCT_AUTHORITY":
      return ["PRODUCT_IDENTITY", "VISUAL_CONTINUITY"];
    case "ENVIRONMENT_AUTHORITY":
      return ["ENVIRONMENT_FIDELITY", "VISUAL_CONTINUITY"];
    case "BRAND_ASSET":
      return ["BRANDING"];
    case "SOURCE_VIDEO_CANDIDATE":
      return ["SOURCE_MOTION", "VISUAL_CONTINUITY"];
    case "SOURCE_IMAGE_CANDIDATE":
    case "CONTINUITY_REFERENCE":
      return ["VISUAL_CONTINUITY"];
    case "SOURCE_AUDIO":
      return ["SOURCE_AUDIO"];
    default:
      return [];
  }
}

function assertRoleCompatible(input: {
  role: z.infer<typeof AiStoryAssetBindingSchema>["role"];
  snapshot: z.infer<typeof AiStoryAssetAnalysisSnapshotSchema>;
}) {
  const { role, snapshot } = input;
  const affordances = snapshot.analysis.affordances;
  const valid =
    role === "UNUSED" ||
    role === "SUPPORTING_REFERENCE" ||
    (role === "CHARACTER_AUTHORITY" && affordances.characterGrounding) ||
    (role === "PRODUCT_AUTHORITY" && affordances.productGrounding) ||
    ((role === "ENVIRONMENT_AUTHORITY" ||
      role === "BRAND_ASSET" ||
      role === "CONTINUITY_REFERENCE") &&
      affordances.visualReference) ||
    (role === "SOURCE_IMAGE_CANDIDATE" && affordances.firstFrame) ||
    (role === "SOURCE_VIDEO_CANDIDATE" && affordances.sourceMotion) ||
    (role === "SOURCE_AUDIO" && affordances.sourceAudio);
  if (!valid) {
    throw new AiStoryAssetMatchingError(
      "ASSET_MATCHING_DECISION_INVALID",
      `Semantic role ${role} exceeds immutable Asset analysis affordances`
    );
  }
}

export function matchAnalyzedAssetsToStory(input: {
  readonly matchingResultId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly storyVersionNumber: number;
  readonly requirements: z.input<typeof AiStoryRequirementsProjectionSchema>;
  readonly assets: readonly {
    readonly registry: z.infer<typeof AiStoryAssetRegistryEntrySchema>;
    readonly snapshot: z.infer<typeof AiStoryAssetAnalysisSnapshotSchema>;
  }[];
  readonly semanticDecisions: readonly AiStoryAssetSemanticDecision[];
  readonly bindingIdByAssetId: Readonly<Record<string, string>>;
  readonly characterDnaAuthority?: z.infer<
    typeof AiStoryCharacterDnaMatchingAuthoritySchema
  > | null;
  readonly noAssetConfirmation?: z.infer<
    typeof AiStoryNoAssetConfirmationSchema
  > | null;
  readonly matcherVersion: string;
  readonly createdAt: string;
}): AiStoryAssetMatchingResult {
  const requirements = AiStoryRequirementsProjectionSchema.parse(
    input.requirements
  );
  const decisions = input.semanticDecisions.map((decision) =>
    AiStoryAssetSemanticDecisionSchema.parse(decision)
  );
  const decisionByAsset = new Map(
    decisions.map((decision) => [decision.assetId, decision])
  );
  if (decisionByAsset.size !== decisions.length) {
    throw new AiStoryAssetMatchingError(
      "ASSET_MATCHING_DECISION_INVALID",
      "Each Asset may have only one Story-relative semantic decision"
    );
  }

  const bindings = input.assets.map(({ registry: rawRegistry, snapshot: rawSnapshot }) => {
    const registry = AiStoryAssetRegistryEntrySchema.parse(rawRegistry);
    const snapshot = AiStoryAssetAnalysisSnapshotSchema.parse(rawSnapshot);
    if (
      registry.orgId !== input.orgId ||
      snapshot.orgId !== input.orgId ||
      registry.workspaceId !== input.workspaceId ||
      snapshot.workspaceId !== input.workspaceId
    ) {
      throw new AiStoryAssetMatchingError(
        "ASSET_MATCHING_SCOPE_MISMATCH",
        "Asset Registry and analysis must belong to the Story Workspace"
      );
    }
    if (
      registry.contentHash !== snapshot.analyzedContentHash ||
      !snapshot.analysis.usable
    ) {
      throw new AiStoryAssetMatchingError(
        "ASSET_MATCHING_SNAPSHOT_MISMATCH",
        "Story matching requires usable analysis for the exact Asset bytes"
      );
    }
    const decision = decisionByAsset.get(registry.assetId);
    if (
      decision &&
      decision.analysisSnapshotId !== snapshot.snapshotId
    ) {
      throw new AiStoryAssetMatchingError(
        "ASSET_MATCHING_SNAPSHOT_MISMATCH",
        "Semantic decision does not pin the authoritative analysis Snapshot"
      );
    }
    const role = roleForIntent(decision?.intent ?? "UNRELATED");
    assertRoleCompatible({ role, snapshot });
    const bindingId = input.bindingIdByAssetId[registry.assetId];
    if (!bindingId) {
      throw new AiStoryAssetMatchingError(
        "ASSET_MATCHING_DECISION_INVALID",
        "Deterministic binding identity is missing"
      );
    }
    return AiStoryAssetBindingSchema.parse({
      bindingId,
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      assetId: registry.assetId,
      assetContentHash: registry.contentHash,
      analysisSnapshotId: snapshot.snapshotId,
      analysisContentHash: snapshot.analyzedContentHash,
      role,
      required: decision?.required ?? false,
      reason: decision?.reason ?? "Asset is unrelated to this Story",
      trace: [
        `analysis:${snapshot.snapshotId}`,
        `semantic-source:${decision?.source ?? "NO_MATCH"}`,
        `role:${role}`,
      ],
      status: "ACTIVE",
      createdAt: input.createdAt,
    });
  });

  const audioIntent = resolveAudioIntent(requirements);
  const required = requiredKeys(requirements, audioIntent);
  const satisfied = new Set<z.infer<typeof AiStoryRequirementKeySchema>>();
  if (input.characterDnaAuthority && requirements.characterIdentityRequired) {
    AiStoryCharacterDnaMatchingAuthoritySchema.parse(
      input.characterDnaAuthority
    );
    satisfied.add("CHARACTER_IDENTITY");
  }
  for (const binding of bindings) {
    if (binding.status !== "ACTIVE" || binding.role === "UNUSED") continue;
    for (const key of requirementsForRole(binding.role)) satisfied.add(key);
  }
  const satisfiedRequirements = required.filter((key) => satisfied.has(key));
  const missingRequirements = required.filter((key) => !satisfied.has(key));
  const recommendations = missingRequirements.map((key) => {
    switch (key) {
      case "CHARACTER_IDENTITY":
        return "PROTAGONIST_REFERENCE_PHOTO" as const;
      case "PRODUCT_IDENTITY":
        return "PRODUCT_PHOTO" as const;
      case "ENVIRONMENT_FIDELITY":
        return "ENVIRONMENT_REFERENCE" as const;
      case "SOURCE_MOTION":
      case "VISUAL_CONTINUITY":
        return "SOURCE_VIDEO" as const;
      case "BRANDING":
        return "BRAND_ASSET" as const;
      case "SOURCE_AUDIO":
        return "SOURCE_AUDIO" as const;
    }
  });
  const noAssetConfirmation =
    input.noAssetConfirmation &&
    input.noAssetConfirmation.storyId === input.storyId &&
    input.noAssetConfirmation.storyVersionId === input.storyVersionId
      ? AiStoryNoAssetConfirmationSchema.parse(input.noAssetConfirmation)
      : null;
  const usableBindings = bindings.filter(
    (binding) => binding.role !== "UNUSED"
  );
  const assetRecommendationStatus =
    missingRequirements.length === 0
      ? "SATISFIED"
      : usableBindings.length === 0 && noAssetConfirmation
        ? "CONFIRMED_NO_ASSETS"
        : "ASSET_RECOMMENDATION_REQUIRED";

  return AiStoryAssetMatchingResultSchema.parse({
    contractVersion: AI_STORY_ASSET_MATCHING_CONTRACT_VERSION,
    matchingResultId: input.matchingResultId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    storyVersionNumber: input.storyVersionNumber,
    requirements,
    bindings,
    satisfiedRequirements,
    missingRequirements,
    assetRecommendationStatus,
    recommendedUploadRoles: [...new Set(recommendations)],
    audioIntent,
    characterDnaAuthority: input.characterDnaAuthority ?? null,
    noAssetConfirmation,
    trace: [
      {
        step: "LOAD_PERSISTED_ASSET_INTELLIGENCE",
        outcome: `${input.assets.length} Snapshot-backed Asset(s)`,
        assetIds: input.assets.map(({ registry }) => registry.assetId),
      },
      {
        step: "VALIDATE_STORY_RELATIVE_ROLES",
        outcome: `${usableBindings.length} relevant binding(s)`,
        assetIds: usableBindings.map((binding) => binding.assetId),
      },
      {
        step: "RESOLVE_MISSING_REQUIREMENTS",
        outcome:
          missingRequirements.length === 0
            ? "SATISFIED"
            : missingRequirements.join(","),
        assetIds: [],
      },
      {
        step: "RESOLVE_AUDIO_INTENT",
        outcome: audioIntent,
        assetIds: [],
      },
    ],
    matcherVersion: input.matcherVersion,
    createdAt: input.createdAt,
  });
}
