import { z } from "zod";
import {
  characterAuthorityBinding,
  validateCharacterAuthorityBindings,
  type AiStoryCharacterAuthorityVersion,
} from "./ai-story-character";
import {
  AiStoryCharacterDnaSchema,
  CHARACTER_CONSISTENCY_MODES,
  CHARACTER_CONSISTENCY_MODE,
  HYBRID_CHARACTER_CONSISTENCY_MODE,
  isCharacterDnaIdentity,
} from "./ai-story-character-dna";

export const AI_STORY_REUSABLE_CHARACTER_CONTRACT_VERSION =
  "ai-story-reusable-character.v1" as const;
export const WORKSPACE_CHARACTER_LIBRARY = "REUSABLE_IDENTITY_ROOT" as const;
export const CAMPAIGN_CHARACTER_AUTHORITY = "EXECUTION_PROJECTION" as const;
export const CANONICAL_IDENTITY_ROOT = "USER_APPROVED_OR_CANONICAL_SOURCE" as const;
export const CHARACTER_VOICE_CONTINUITY = "NOT_YET_CERTIFIED" as const;
export const VOICE_CONTINUITY_STATUS = "NOT_CERTIFIED" as const;
export const CROSS_EPISODE_VISUAL_IDENTITY_MATCH =
  "PENDING_REAL_PROVIDER_AND_HUMAN_REVIEW" as const;
export const NO_BIOMETRIC_REAL_PERSON_IDENTIFICATION = true as const;
export const PROVIDER_MEMORY_IS_NOT_IDENTITY_AUTHORITY = true as const;
export const LEGACY_CAMPAIGN_LOCAL_CHARACTER_COMPATIBILITY = true as const;
export const AI_STORY_REUSABLE_CHARACTER_LIBRARY = "CERTIFIED" as const;
export const REUSABLE_CHARACTER_WORKSPACE_SCOPE = "CERTIFIED" as const;
export const REUSABLE_CHARACTER_CAMPAIGN_PROJECTION = "CERTIFIED" as const;
export const EPISODE_CHARACTER_BINDING = "CERTIFIED" as const;
export const CROSS_EPISODE_CHARACTER_VERSION_PINNING = "CERTIFIED" as const;
export const CHARACTER_IDENTITY_CORE_LOCK = "CERTIFIED" as const;
export const CHARACTER_EPISODE_LOOK = "CERTIFIED" as const;
export const CANONICAL_IDENTITY_ROOT_STATUS = "CERTIFIED" as const;
export const CHARACTER_CONTINUITY_ANCHOR = "CERTIFIED" as const;
export const CHARACTER_ANCHOR_DRIFT_PROTECTION = "CERTIFIED" as const;
export const REUSABLE_CHARACTER_REFERENCE_PROPAGATION = "CERTIFIED" as const;
export const REUSABLE_CHARACTER_REFERENCE_GATE_STATUS = "CERTIFIED" as const;
export const REFERENCE_BUDGET_PROTECTION = "CERTIFIED" as const;
export const CROSS_EPISODE_TECHNICAL_IDENTITY_LINEAGE = "CERTIFIED" as const;
export const SEEDANCE_CERTIFIED_MAX_REFERENCE_IMAGES = 4 as const;

export const AI_STORY_REUSABLE_CHARACTER_STATUSES = [
  "ACTIVE",
  "ARCHIVED",
  "DELETED",
] as const;
export const AI_STORY_CHARACTER_SOURCE_KINDS = [
  "CAMPAIGN_LOCAL_CHARACTER",
  "REUSABLE_CHARACTER_PROJECTION",
] as const;
export const AI_STORY_REUSABLE_CHARACTER_ASSET_ROLES = [
  "IDENTITY_MASTER",
  "FRONT_PORTRAIT",
  "THREE_QUARTER",
  "PROFILE",
  "FULL_BODY",
  "EXPRESSION_REFERENCE",
  "STYLE_REFERENCE",
  "CHARACTER_SOURCE_PORTRAIT",
  "SYNTHETIC_IDENTITY_ANCHOR",
] as const;
export const AI_STORY_CHARACTER_CONTINUITY_ANCHOR_STATUSES = [
  "PROPOSED",
  "APPROVED",
  "REJECTED",
] as const;
export const AI_STORY_VISUAL_IDENTITY_MATCH_STATUSES = [
  "PENDING_HUMAN_REVIEW",
  "PASS",
  "FAIL",
] as const;
export const AI_STORY_REUSABLE_CHARACTER_GROUNDING_PATHS = [
  "IDENTITY_GROUNDED_KEYFRAME",
  "PROVIDER_REFERENCE_IMAGE",
] as const;

const Id = z.string().uuid();
const Text = z.string().trim().min(1);
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const AiStoryCharacterIdentityCoreSchema = z
  .object({
    identityDescription: Text.max(4000),
    faceIdentityDescription: Text.max(4000),
    bodyIdentityDescription: Text.max(4000),
    distinctiveVisualFacts: z.array(Text.max(500)).max(32),
    mustPreserve: z.array(Text.max(500)).max(32),
    mustNeverChange: z.array(Text.max(500)).max(32),
  })
  .strict();

export const AiStoryCharacterDefaultLookSchema = z
  .object({
    wardrobe: Text.max(2000),
    makeup: Text.max(2000).nullable(),
    accessories: Text.max(2000).nullable(),
    hairstyle: Text.max(2000).nullable(),
    hairColor: Text.max(200).nullable(),
  })
  .strict();

export const AiStoryCharacterMutableLookPolicySchema = z
  .object({
    wardrobeAllowed: z.boolean(),
    makeupAllowed: z.boolean(),
    accessoriesAllowed: z.boolean(),
    hairstyleAllowed: z.boolean(),
    hairColorAllowed: z.boolean(),
  })
  .strict();

export const AiStoryCharacterEpisodeLookSchema = z
  .object({
    wardrobe: Text.max(2000).nullable(),
    makeup: Text.max(2000).nullable(),
    accessories: Text.max(2000).nullable(),
    hairstyle: Text.max(2000).nullable(),
    hairColor: Text.max(200).nullable(),
    expression: Text.max(2000).nullable(),
    pose: Text.max(2000).nullable(),
    location: Text.max(2000).nullable(),
    action: Text.max(2000).nullable(),
    product: Text.max(2000).nullable(),
    dialogue: Text.max(2000).nullable(),
  })
  .strict();

export const AiStoryReusableCharacterCanonicalAssetSchema = z
  .object({
    assetId: Id,
    contentHash: Hash,
    role: z.enum(AI_STORY_REUSABLE_CHARACTER_ASSET_ROLES),
    source: z.enum(["USER_APPROVED", "PROMOTED_CAMPAIGN_CHARACTER"]),
  })
  .strict();

export const AiStoryReusableCharacterVersionSchema = z
  .object({
    reusableCharacterId: Id,
    reusableCharacterVersionId: Id,
    orgId: Id,
    workspaceId: Id,
    name: Text.max(200),
    identityCore: AiStoryCharacterIdentityCoreSchema,
    defaultLook: AiStoryCharacterDefaultLookSchema,
    mutableLookPolicy: AiStoryCharacterMutableLookPolicySchema,
    canonicalAssets: z.array(AiStoryReusableCharacterCanonicalAssetSchema),
    identityMode: z.enum(["VISUAL_REFERENCE", "CHARACTER_DNA"]).default("VISUAL_REFERENCE"),
    characterDna: AiStoryCharacterDnaSchema.optional(),
    characterDnaFingerprint: Hash.optional(),
    compiledCharacterIdentityFingerprint: Hash.optional(),
    characterConsistencyMode: z.enum(CHARACTER_CONSISTENCY_MODES).optional(),
    status: z.enum(AI_STORY_REUSABLE_CHARACTER_STATUSES),
    version: z.number().int().positive(),
    contractVersion: z.literal(AI_STORY_REUSABLE_CHARACTER_CONTRACT_VERSION),
    fingerprint: Hash,
    identityFingerprint: Hash,
    supersedesReusableCharacterVersionId: Id.nullable(),
    createdBy: Id,
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.identityMode === "CHARACTER_DNA") {
      const consistencyMode =
        value.characterConsistencyMode ?? CHARACTER_CONSISTENCY_MODE;
      if (!value.characterDna || !value.characterDnaFingerprint) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CHARACTER_DNA identity requires approved Character DNA",
        });
      }
      if (
        consistencyMode === HYBRID_CHARACTER_CONSISTENCY_MODE &&
        !value.compiledCharacterIdentityFingerprint
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Hybrid Character DNA requires a compiled identity fingerprint",
        });
      }
      const sourcePortraits = value.canonicalAssets.filter(
        (asset) => asset.role === "CHARACTER_SOURCE_PORTRAIT"
      );
      const syntheticAnchors = value.canonicalAssets.filter(
        (asset) => asset.role === "SYNTHETIC_IDENTITY_ANCHOR"
      );
      if (sourcePortraits.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CHARACTER_DNA identity requires exactly one source portrait provenance asset",
        });
      }
      if (value.canonicalAssets.some((asset) => asset.role === "IDENTITY_MASTER")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CHARACTER_DNA identity cannot use IDENTITY_MASTER",
        });
      }
      if (consistencyMode === HYBRID_CHARACTER_CONSISTENCY_MODE) {
        if (syntheticAnchors.length !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "DNA_PLUS_SYNTHETIC_ANCHOR requires exactly one synthetic identity anchor",
          });
        }
        if (sourcePortraits[0]?.assetId === syntheticAnchors[0]?.assetId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Source portrait cannot be used as the synthetic identity anchor",
          });
        }
      } else if (
        consistencyMode !== CHARACTER_CONSISTENCY_MODE ||
        syntheticAnchors.length !== 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Text-only CHARACTER_DNA identity requires SOFT_DESCRIPTION_BASED consistency",
        });
      }
      return;
    }
    if (!value.canonicalAssets.some((asset) => asset.role === "IDENTITY_MASTER")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reusable Character requires one IDENTITY_MASTER canonical asset",
      });
    }
  });

export const AiStoryReusableCharacterCampaignProjectionSchema = z
  .object({
    projectionId: Id,
    reusableCharacterId: Id,
    reusableCharacterVersionId: Id,
    reusableCharacterFingerprint: Hash,
    campaignId: Id,
    campaignCharacterId: Id,
    campaignCharacterVersionId: Id,
    campaignCharacterFingerprint: Hash,
    projectionFingerprint: Hash,
    createdAt: z.string().datetime(),
  })
  .strict();

export const AiStoryEpisodeCharacterBindingSchema = z
  .object({
    episodeCharacterBindingId: Id,
    storyId: Id,
    episodeId: Id,
    reusableCharacterId: Id,
    reusableCharacterVersionId: Id,
    campaignCharacterId: Id,
    campaignCharacterVersionId: Id,
    campaignCharacterFingerprint: Hash.optional(),
    identityFingerprint: Hash,
    episodeLook: AiStoryCharacterEpisodeLookSchema,
    canonicalAssetIds: z.array(Id),
    characterDnaFingerprint: Hash.optional(),
    compiledCharacterIdentityFingerprint: Hash.optional(),
    characterDnaVersionId: Id.optional(),
    sourcePhotoSentToVideoProvider: z.boolean().optional(),
    characterConsistencyMode: z.enum(CHARACTER_CONSISTENCY_MODES).optional(),
    syntheticIdentityAnchorAssetId: Id.optional(),
    continuityAnchorIds: z.array(Id),
    bindingFingerprint: Hash,
    createdBy: Id,
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.characterDnaFingerprint) {
      if (value.sourcePhotoSentToVideoProvider !== false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Character DNA Episode bindings must not send the source photo to the video Provider",
        });
      }
      const mode = value.characterConsistencyMode ?? CHARACTER_CONSISTENCY_MODE;
      if (mode === HYBRID_CHARACTER_CONSISTENCY_MODE) {
        if (
          !value.syntheticIdentityAnchorAssetId ||
          !value.compiledCharacterIdentityFingerprint ||
          !value.campaignCharacterFingerprint ||
          value.canonicalAssetIds.length !== 1 ||
          value.canonicalAssetIds[0] !== value.syntheticIdentityAnchorAssetId
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Hybrid Character DNA binding must pin only the synthetic identity anchor",
          });
        }
      } else if (value.syntheticIdentityAnchorAssetId || value.canonicalAssetIds.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Text-only Character DNA binding cannot emit Provider identity assets",
        });
      }
      return;
    }
    if (value.canonicalAssetIds.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Visual-reference Episode binding requires canonical identity assets",
      });
    }
  });

export const AiStoryCharacterContinuityAnchorSchema = z
  .object({
    anchorId: Id,
    reusableCharacterId: Id,
    reusableCharacterVersionId: Id,
    sourceEpisodeId: Id,
    sourceGenerationUnitId: Id,
    sourceResultId: Id,
    assetId: Id,
    contentHash: Hash,
    frameTimestampMs: z.number().int().nonnegative().nullable(),
    status: z.enum(AI_STORY_CHARACTER_CONTINUITY_ANCHOR_STATUSES),
    source: z.literal("ACCEPTED_GENERATED_RESULT"),
    approvedBy: Id.nullable(),
    approvedAt: z.string().datetime().nullable(),
  })
  .strict();

export const AiStoryReusableCharacterLineageSchema = z
  .object({
    reusableCharacterId: Id,
    reusableCharacterVersionId: Id,
    campaignCharacterId: Id,
    campaignCharacterVersionId: Id,
    identityFingerprint: Hash,
    name: Text.max(200),
    primaryIdentityAssetId: Id,
    primaryIdentityContentHash: Hash,
    continuityAnchorId: Id.nullable(),
    continuityAnchorContentHash: Hash.nullable(),
    episodeLook: AiStoryCharacterEpisodeLookSchema,
    groundingPath: z.enum(AI_STORY_REUSABLE_CHARACTER_GROUNDING_PATHS),
    grounding: z.enum(["PASS", "FAIL"]),
  })
  .strict();

export const AiStoryReusableCharacterCardSchema = z
  .object({
    reusableCharacterId: Id,
    name: Text.max(200),
    portraitAssetId: Id.nullable(),
    episodeCount: z.number().int().nonnegative(),
    status: z.enum(AI_STORY_REUSABLE_CHARACTER_STATUSES),
    identityMode: z.enum(["VISUAL_REFERENCE", "CHARACTER_DNA"]).optional(),
    characterDnaCertified: z.boolean().optional(),
    portraitLabel: z.enum(["Source photo", "Identity Master"]).optional(),
    characterConsistencyMode: z.enum(CHARACTER_CONSISTENCY_MODES).optional(),
  })
  .strict();

export const AiStoryCharacterIdentityReviewSchema = z
  .object({
    generationUnitId: Id,
    reusableCharacterId: Id,
    technicalIdentityLineage: z.enum(["PASS", "FAIL"]),
    visualIdentityMatch: z.enum(AI_STORY_VISUAL_IDENTITY_MATCH_STATUSES),
    canonicalAssetId: Id,
    generatedAssetId: Id.nullable(),
  })
  .strict();

export type AiStoryCharacterIdentityCore = z.infer<typeof AiStoryCharacterIdentityCoreSchema>;
export type AiStoryCharacterDefaultLook = z.infer<typeof AiStoryCharacterDefaultLookSchema>;
export type AiStoryCharacterMutableLookPolicy = z.infer<typeof AiStoryCharacterMutableLookPolicySchema>;
export type AiStoryCharacterEpisodeLook = z.infer<typeof AiStoryCharacterEpisodeLookSchema>;
export type AiStoryReusableCharacterCanonicalAsset = z.infer<
  typeof AiStoryReusableCharacterCanonicalAssetSchema
>;
export type AiStoryReusableCharacterVersion = z.infer<typeof AiStoryReusableCharacterVersionSchema>;
export type AiStoryReusableCharacterCampaignProjection = z.infer<
  typeof AiStoryReusableCharacterCampaignProjectionSchema
>;
export type AiStoryEpisodeCharacterBinding = z.infer<typeof AiStoryEpisodeCharacterBindingSchema>;
export type AiStoryCharacterContinuityAnchor = z.infer<typeof AiStoryCharacterContinuityAnchorSchema>;
export type AiStoryReusableCharacterLineage = z.infer<typeof AiStoryReusableCharacterLineageSchema>;
export type AiStoryReusableCharacterCard = z.infer<typeof AiStoryReusableCharacterCardSchema>;
export type AiStoryCharacterIdentityReview = z.infer<typeof AiStoryCharacterIdentityReviewSchema>;

export const AI_STORY_REUSABLE_CHARACTER_GATES = [
  "REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE",
  "CHARACTER_VERSION_PINNING_GATE",
  "CHARACTER_ANCHOR_DRIFT_GATE",
  "REUSABLE_CHARACTER_REFERENCE_GATE",
  "REFERENCE_BUDGET_GATE",
  "CROSS_EPISODE_CHARACTER_IDENTITY_GATE",
  "CHARACTER_LOCKED_TRAIT_GATE",
  "CANONICAL_IDENTITY_ROOT_GATE",
] as const;
export type AiStoryReusableCharacterGate = (typeof AI_STORY_REUSABLE_CHARACTER_GATES)[number];
export type AiStoryReusableCharacterIssue = {
  gate: AiStoryReusableCharacterGate;
  severity: "BLOCK";
  message: string;
};

export class AiStoryReusableCharacterError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AiStoryReusableCharacterError";
  }
}

const LOOK_POLICY_FIELDS = [
  "wardrobe",
  "makeup",
  "accessories",
  "hairstyle",
  "hairColor",
] as const;

export function emptyEpisodeLook(): AiStoryCharacterEpisodeLook {
  return {
    wardrobe: null,
    makeup: null,
    accessories: null,
    hairstyle: null,
    hairColor: null,
    expression: null,
    pose: null,
    location: null,
    action: null,
    product: null,
    dialogue: null,
  };
}

export function publicReusableCharacterCard(
  version: Pick<AiStoryReusableCharacterVersion, "reusableCharacterId" | "name" | "canonicalAssets" | "status"> & {
    identityMode?: AiStoryReusableCharacterVersion["identityMode"];
    characterDnaFingerprint?: string;
    characterConsistencyMode?: AiStoryReusableCharacterVersion["characterConsistencyMode"];
  },
  episodeCount: number
): AiStoryReusableCharacterCard {
  const dna = isCharacterDnaIdentity(version);
  const portrait = dna
    ? version.canonicalAssets.find((asset) => asset.role === "CHARACTER_SOURCE_PORTRAIT") ??
      version.canonicalAssets[0]
    : version.canonicalAssets.find((asset) => asset.role === "IDENTITY_MASTER") ??
      version.canonicalAssets[0];
  return AiStoryReusableCharacterCardSchema.parse({
    reusableCharacterId: version.reusableCharacterId,
    name: version.name,
    portraitAssetId: portrait?.assetId ?? null,
    episodeCount,
    status: version.status,
    identityMode: version.identityMode ?? "VISUAL_REFERENCE",
    characterDnaCertified: dna,
    portraitLabel: dna ? "Source photo" : "Identity Master",
    ...(dna
      ? {
          characterConsistencyMode:
            version.characterConsistencyMode ?? CHARACTER_CONSISTENCY_MODE,
        }
      : {}),
  });
}

export function applyEpisodeLookPolicy(input: {
  policy: AiStoryCharacterMutableLookPolicy;
  look: AiStoryCharacterEpisodeLook;
  identityCore: AiStoryCharacterIdentityCore;
}): AiStoryReusableCharacterIssue[] {
  const issues: AiStoryReusableCharacterIssue[] = [];
  const block = (message: string) =>
    issues.push({ gate: "CHARACTER_LOCKED_TRAIT_GATE", severity: "BLOCK", message });
  for (const field of LOOK_POLICY_FIELDS) {
    const allowed = input.policy[`${field}Allowed`];
    const value = input.look[field];
    if (value && !allowed) {
      block(`Episode Look cannot override locked Character trait ${field}`);
    }
  }
  const forbidden = [
    ...input.identityCore.mustNeverChange,
    input.identityCore.faceIdentityDescription,
  ]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const lookText = Object.values(input.look)
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (forbidden.some((fact) => fact.length > 12 && lookText.includes(fact))) {
    block("Episode Look cannot rewrite locked face or identity-defining facts");
  }
  return issues;
}

export function validateReusableCharacterWorkspaceScope(input: {
  workspaceId: string;
  versions: readonly Pick<AiStoryReusableCharacterVersion, "reusableCharacterId" | "workspaceId">[];
}): AiStoryReusableCharacterIssue[] {
  return input.versions
    .filter((version) => version.workspaceId !== input.workspaceId)
    .map((version) => ({
      gate: "REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE" as const,
      severity: "BLOCK" as const,
      message: `Reusable Character ${version.reusableCharacterId} belongs to another Workspace`,
    }));
}

export function validateCharacterVersionPinning(input: {
  binding: Pick<AiStoryEpisodeCharacterBinding, "reusableCharacterId" | "reusableCharacterVersionId">;
  currentLibraryVersionId: string;
  resolvedVersionId: string;
}): AiStoryReusableCharacterIssue[] {
  if (input.resolvedVersionId !== input.binding.reusableCharacterVersionId) {
    return [
      {
        gate: "CHARACTER_VERSION_PINNING_GATE",
        severity: "BLOCK",
        message: `Episode remains pinned to Character version ${input.binding.reusableCharacterVersionId}`,
      },
    ];
  }
  return [];
}

export function validateCanonicalIdentityRoot(input: {
  canonicalAssets: readonly AiStoryReusableCharacterCanonicalAsset[];
  plannedAssetIds: readonly string[];
  identityMode?: AiStoryReusableCharacterVersion["identityMode"];
}): AiStoryReusableCharacterIssue[] {
  if (input.identityMode === "CHARACTER_DNA") return [];
  const master = input.canonicalAssets.find((asset) => asset.role === "IDENTITY_MASTER");
  if (!master) {
    return [
      {
        gate: "CANONICAL_IDENTITY_ROOT_GATE",
        severity: "BLOCK",
        message: "Canonical IDENTITY_MASTER is required",
      },
    ];
  }
  if (!input.plannedAssetIds.includes(master.assetId)) {
    return [
      {
        gate: "CANONICAL_IDENTITY_ROOT_GATE",
        severity: "BLOCK",
        message: "Generation plan omitted the canonical identity root",
      },
    ];
  }
  return [];
}

export function validateCharacterAnchorDrift(input: {
  canonicalAssets: readonly AiStoryReusableCharacterCanonicalAsset[];
  continuityAnchors: readonly Pick<AiStoryCharacterContinuityAnchor, "assetId" | "status">[];
  plannedAssetIds: readonly string[];
  identityMode?: AiStoryReusableCharacterVersion["identityMode"];
}): AiStoryReusableCharacterIssue[] {
  if (input.identityMode === "CHARACTER_DNA") return [];
  const master = input.canonicalAssets.find((asset) => asset.role === "IDENTITY_MASTER");
  const approvedAnchors = new Set(
    input.continuityAnchors.filter((anchor) => anchor.status === "APPROVED").map((anchor) => anchor.assetId)
  );
  const planned = new Set(input.plannedAssetIds);
  const hasCanonical = Boolean(master && planned.has(master.assetId));
  const hasOnlyAnchors =
    [...planned].length > 0 &&
    [...planned].every((assetId) => approvedAnchors.has(assetId)) &&
    !hasCanonical;
  if (hasOnlyAnchors || !hasCanonical) {
    return [
      {
        gate: "CHARACTER_ANCHOR_DRIFT_GATE",
        severity: "BLOCK",
        message: "Continuity anchors cannot replace canonical identity authority",
      },
    ];
  }
  return [];
}

export function validateReusableCharacterReference(input: {
  visibleRecurringCharacter: boolean;
  identityLockRequired: boolean;
  generationMode: "REFERENCE_FREE_T2V" | "FIRST_FRAME_IMAGE_TO_VIDEO" | "REFERENCE_TO_VIDEO";
  hasIdentityGroundedKeyframe: boolean;
  hasExactIdentityReferenceImage: boolean;
  identityMode?: AiStoryReusableCharacterVersion["identityMode"];
}): AiStoryReusableCharacterIssue[] {
  if (!input.visibleRecurringCharacter || !input.identityLockRequired) return [];
  if (input.identityMode === "CHARACTER_DNA" && input.generationMode === "REFERENCE_FREE_T2V") return [];
  const grounded =
    (input.generationMode === "FIRST_FRAME_IMAGE_TO_VIDEO" && input.hasIdentityGroundedKeyframe) ||
    (input.generationMode === "REFERENCE_TO_VIDEO" && input.hasExactIdentityReferenceImage);
  if (input.generationMode === "REFERENCE_FREE_T2V" || !grounded) {
    return [
      {
        gate: "REUSABLE_CHARACTER_REFERENCE_GATE",
        severity: "BLOCK",
        message: "Visible recurring Character cannot use reference-free generation without identity evidence",
      },
    ];
  }
  return [];
}

export type AiStoryReusableCharacterReferenceNeed = {
  kind: "CHARACTER_IDENTITY_MASTER" | "PRODUCT" | "LOCATION" | "CONTINUITY_ANCHOR" | "SECONDARY_CHARACTER";
  assetId: string;
  contentHash: string;
  mandatory: boolean;
  characterId?: string;
};

export function planReusableCharacterReferenceBudget(input: {
  maxReferenceImages?: number;
  needs: readonly AiStoryReusableCharacterReferenceNeed[];
}):
  | { ok: true; selected: AiStoryReusableCharacterReferenceNeed[]; droppedOptional: AiStoryReusableCharacterReferenceNeed[] }
  | { ok: false; issues: AiStoryReusableCharacterIssue[]; selected: AiStoryReusableCharacterReferenceNeed[] } {
  const max = input.maxReferenceImages ?? SEEDANCE_CERTIFIED_MAX_REFERENCE_IMAGES;
  const priority: AiStoryReusableCharacterReferenceNeed["kind"][] = [
    "CHARACTER_IDENTITY_MASTER",
    "PRODUCT",
    "LOCATION",
    "CONTINUITY_ANCHOR",
    "SECONDARY_CHARACTER",
  ];
  const ordered = [...input.needs].sort(
    (a, b) => Number(b.mandatory) - Number(a.mandatory) || priority.indexOf(a.kind) - priority.indexOf(b.kind)
  );
  const selected: AiStoryReusableCharacterReferenceNeed[] = [];
  const droppedOptional: AiStoryReusableCharacterReferenceNeed[] = [];
  for (const need of ordered) {
    if (selected.length < max) selected.push(need);
    else if (!need.mandatory) droppedOptional.push(need);
    else {
      return {
        ok: false,
        selected,
        issues: [
          {
            gate: "REFERENCE_BUDGET_GATE",
            severity: "BLOCK",
            message:
              "Mandatory Character/Product/Location identity references exceed Provider capacity; use identity-grounded keyframe preparation",
          },
        ],
      };
    }
  }
  if (
    input.needs.some((need) => need.kind === "CHARACTER_IDENTITY_MASTER" && need.mandatory) &&
    !selected.some((need) => need.kind === "CHARACTER_IDENTITY_MASTER" && need.mandatory)
  ) {
    return {
      ok: false,
      selected,
      issues: [
        {
          gate: "REFERENCE_BUDGET_GATE",
          severity: "BLOCK",
          message: "Character IDENTITY_MASTER cannot be dropped to fit the Provider reference budget",
        },
      ],
    };
  }
  return { ok: true, selected, droppedOptional };
}

export function evaluateCrossEpisodeTechnicalIdentity(input: {
  left: Pick<
    AiStoryEpisodeCharacterBinding,
    "reusableCharacterId" | "reusableCharacterVersionId" | "identityFingerprint" | "canonicalAssetIds"
  >;
  right: Pick<
    AiStoryEpisodeCharacterBinding,
    "reusableCharacterId" | "reusableCharacterVersionId" | "identityFingerprint" | "canonicalAssetIds"
  >;
}): { technicalIdentityLineage: "PASS" | "FAIL"; visualIdentityMatch: "PENDING_HUMAN_REVIEW"; issues: AiStoryReusableCharacterIssue[] } {
  const sameRoot = input.left.reusableCharacterId === input.right.reusableCharacterId;
  const sameVersion = input.left.reusableCharacterVersionId === input.right.reusableCharacterVersionId;
  const sameFingerprint = input.left.identityFingerprint === input.right.identityFingerprint;
  const sameAssets =
    [...input.left.canonicalAssetIds].sort().join() === [...input.right.canonicalAssetIds].sort().join();
  const pass = sameRoot && sameVersion && sameFingerprint && sameAssets;
  return {
    technicalIdentityLineage: pass ? "PASS" : "FAIL",
    visualIdentityMatch: "PENDING_HUMAN_REVIEW",
    issues: pass
      ? []
      : [
          {
            gate: "CROSS_EPISODE_CHARACTER_IDENTITY_GATE",
            severity: "BLOCK",
            message: "Cross-Episode technical Character lineage does not match",
          },
        ],
  };
}

export function reviewVisualIdentity(input: {
  generationUnitId: string;
  reusableCharacterId: string;
  technicalIdentityLineage: "PASS" | "FAIL";
  canonicalAssetId: string;
  generatedAssetId: string | null;
  decision?: "PASS" | "FAIL";
}): AiStoryCharacterIdentityReview {
  return AiStoryCharacterIdentityReviewSchema.parse({
    generationUnitId: input.generationUnitId,
    reusableCharacterId: input.reusableCharacterId,
    technicalIdentityLineage: input.technicalIdentityLineage,
    visualIdentityMatch: input.decision ?? "PENDING_HUMAN_REVIEW",
    canonicalAssetId: input.canonicalAssetId,
    generatedAssetId: input.generatedAssetId,
  });
}

export function rejectIdentityDriftUnit(input: {
  generationUnitId: string;
  siblingGenerationUnitIds: readonly string[];
}): {
  notAcceptedUnitId: string;
  reason: "CHARACTER_IDENTITY_DRIFT";
  retryScope: "GENERATION_UNIT";
  preservedSiblingUnitIds: string[];
} {
  return {
    notAcceptedUnitId: input.generationUnitId,
    reason: "CHARACTER_IDENTITY_DRIFT",
    retryScope: "GENERATION_UNIT",
    preservedSiblingUnitIds: input.siblingGenerationUnitIds.filter((id) => id !== input.generationUnitId),
  };
}

export function campaignProjectionPreservesExistingScope(input: {
  campaignAId: string;
  campaignBId: string;
  projectionA: AiStoryCharacterAuthorityVersion;
  projectionB: AiStoryCharacterAuthorityVersion;
}): AiStoryReusableCharacterIssue[] {
  const aIssues = validateCharacterAuthorityBindings({
    campaignId: input.campaignBId,
    bindings: [characterAuthorityBinding(input.projectionA)],
    versions: [input.projectionA],
  }).filter((issue) => issue.gate === "CHARACTER_CAMPAIGN_SCOPE_GATE");
  const bIssues = validateCharacterAuthorityBindings({
    campaignId: input.campaignAId,
    bindings: [characterAuthorityBinding(input.projectionB)],
    versions: [input.projectionB],
  }).filter((issue) => issue.gate === "CHARACTER_CAMPAIGN_SCOPE_GATE");
  return [
    ...aIssues.map((issue) => ({
      gate: "REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE" as const,
      severity: "BLOCK" as const,
      message: issue.message,
    })),
    ...bIssues.map((issue) => ({
      gate: "REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE" as const,
      severity: "BLOCK" as const,
      message: issue.message,
    })),
  ];
}

export function evaluateReusableCharacterGenerationAuthority(input: {
  workspaceId: string;
  visibleRecurringCharacter: boolean;
  identityLockRequired: boolean;
  generationMode: "REFERENCE_FREE_T2V" | "FIRST_FRAME_IMAGE_TO_VIDEO" | "REFERENCE_TO_VIDEO";
  hasIdentityGroundedKeyframe: boolean;
  hasExactIdentityReferenceImage: boolean;
  reusable: Pick<AiStoryReusableCharacterVersion, "reusableCharacterId" | "workspaceId" | "canonicalAssets" | "identityMode">;
  binding: Pick<
    AiStoryEpisodeCharacterBinding,
    "reusableCharacterId" | "reusableCharacterVersionId" | "identityFingerprint" | "canonicalAssetIds"
  >;
  resolvedVersionId: string;
  currentLibraryVersionId: string;
  plannedAssetIds: readonly string[];
  continuityAnchors: readonly Pick<AiStoryCharacterContinuityAnchor, "assetId" | "status">[];
  referenceNeeds: readonly AiStoryReusableCharacterReferenceNeed[];
  maxReferenceImages?: number;
}): { issues: AiStoryReusableCharacterIssue[]; grounding: "PASS" | "FAIL" } {
  const budget = planReusableCharacterReferenceBudget({
    maxReferenceImages: input.maxReferenceImages,
    needs: input.referenceNeeds,
  });
  const issues = [
    ...validateReusableCharacterWorkspaceScope({
      workspaceId: input.workspaceId,
      versions: [input.reusable],
    }),
    ...validateCharacterVersionPinning({
      binding: input.binding,
      currentLibraryVersionId: input.currentLibraryVersionId,
      resolvedVersionId: input.resolvedVersionId,
    }),
    ...validateCanonicalIdentityRoot({
      canonicalAssets: input.reusable.canonicalAssets,
      plannedAssetIds: input.plannedAssetIds,
      identityMode: input.reusable.identityMode,
    }),
    ...validateCharacterAnchorDrift({
      canonicalAssets: input.reusable.canonicalAssets,
      continuityAnchors: input.continuityAnchors,
      plannedAssetIds: input.plannedAssetIds,
      identityMode: input.reusable.identityMode,
    }),
    ...validateReusableCharacterReference({
      ...input,
      identityMode: input.reusable.identityMode,
    }),
    ...(budget.ok ? [] : budget.issues),
  ];
  return { issues, grounding: issues.length ? "FAIL" : "PASS" };
}

export function reusableCharacterSelectable(status: (typeof AI_STORY_REUSABLE_CHARACTER_STATUSES)[number]) {
  return status === "ACTIVE";
}

export const AI_STORY_REUSABLE_CHARACTER_COPY = Object.freeze({
  characters: "Characters",
  useInEpisode: "Use in Episode",
  editCharacter: "Edit Character",
  createNewCharacter: "Create new Character",
  identityLocked: "Identity locked",
  characterDnaCertified: "Character DNA ✓",
  sourcePhoto: "Source photo",
  consistencySoft: "EmberOS will keep the Character's key visual traits consistent across Episodes. Small visual differences may occur.",
  saveAsReusable: "Save as reusable Character",
  sameCharacter: "Same Character",
  identityDrift: "Identity drift",
  usedInEpisodes: (count: number) => `Used in ${count} Episode${count === 1 ? "" : "s"}`,
});
