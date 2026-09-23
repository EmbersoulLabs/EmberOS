import { z } from "zod";

export const AI_STORY_CHARACTER_DNA_CONTRACT_VERSION = "ai-story-character-dna.v1" as const;
export const AI_STORY_CHARACTER_DNA_ANALYSIS_VERSION = "ai-story-character-dna-analysis.v1" as const;
export const CHARACTER_DNA_ANALYSIS = "CHARACTER_DNA_ANALYSIS" as const;
export const CHARACTER_CONSISTENCY_MODE = "SOFT_DESCRIPTION_BASED" as const;
export const HYBRID_CHARACTER_CONSISTENCY_MODE = "DNA_PLUS_SYNTHETIC_ANCHOR" as const;
export const CHARACTER_CONSISTENCY_MODES = [
  CHARACTER_CONSISTENCY_MODE,
  HYBRID_CHARACTER_CONSISTENCY_MODE,
] as const;
export const AI_STORY_CHARACTER_IDENTITY_MODES = ["VISUAL_REFERENCE", "CHARACTER_DNA"] as const;
export const CHARACTER_VIRTUALIZER_PATH = "LEGACY / ADVANCED / INTERNAL" as const;
export const AI_STORY_CHARACTER_DNA_FROM_PHOTO = "CERTIFIED" as const;
export const PHOTO_TO_DESCRIPTION_FLOW = "CERTIFIED" as const;
export const CHARACTER_DNA_TO_EPISODE_PROMPT = "CERTIFIED" as const;
export const CHARACTER_DNA_TEXT_ONLY_VISUAL_IDENTITY = "FAIL" as const;
export const SOURCE_PHOTO_EXCLUDED_FROM_VIDEO_PROVIDER = "CERTIFIED" as const;
export const NO_BIOMETRIC_CHARACTER_DNA = true as const;
export const NO_FACE_RECOGNITION_CHARACTER_DNA = true as const;
export const NO_SENSITIVE_TRAIT_INFERENCE = true as const;

const Id = z.string().uuid();
const Text = z.string().trim().min(1);
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const DEFAULT_CHARACTER_DNA_MUST_PRESERVE = [
  "face structure",
  "eye shape",
  "nose structure",
  "hair identity",
  "body proportions",
] as const;

export const DEFAULT_CHARACTER_DNA_MUTABLE_TRAITS = [
  "outfit",
  "makeup",
  "accessories",
  "expression",
  "pose",
  "location",
] as const;

function visualFact(max = 240) {
  return Text.max(max).refine(
    (value) => !containsForbiddenCharacterDnaLanguage(value),
    "Character DNA may only describe visible appearance"
  );
}

const VisualFact = visualFact();

export const AiStoryCharacterDnaFaceSchema = z
  .object({
    shape: VisualFact,
    jawline: VisualFact,
    forehead: VisualFact,
    cheeks: VisualFact,
    chin: VisualFact,
  })
  .strict();

export const AiStoryCharacterDnaEyesSchema = z
  .object({
    shape: VisualFact,
    size: VisualFact,
    colorDescription: VisualFact,
    eyebrowShape: VisualFact,
  })
  .strict();

export const AiStoryCharacterDnaNoseSchema = z
  .object({
    bridge: VisualFact,
    width: VisualFact,
    tip: VisualFact,
  })
  .strict();

export const AiStoryCharacterDnaMouthSchema = z
  .object({
    lipShape: VisualFact,
    lipFullness: VisualFact,
  })
  .strict();

export const AiStoryCharacterDnaHairSchema = z
  .object({
    length: VisualFact,
    texture: VisualFact,
    parting: VisualFact,
    style: VisualFact,
    colorDescription: VisualFact,
  })
  .strict();

export const AiStoryCharacterDnaBodySchema = z
  .object({
    build: VisualFact,
    proportionDescription: VisualFact,
    heightImpression: VisualFact,
  })
  .strict();

export const AiStoryCharacterDnaAppearanceSchema = z
  .object({
    defaultExpression: VisualFact,
    overallImpression: VisualFact,
    presentationStyle: VisualFact,
  })
  .strict();

export const AiStoryCharacterDnaSchema = z
  .object({
    identityDescription: visualFact(4000),
    face: AiStoryCharacterDnaFaceSchema,
    eyes: AiStoryCharacterDnaEyesSchema,
    nose: AiStoryCharacterDnaNoseSchema,
    mouth: AiStoryCharacterDnaMouthSchema,
    hair: AiStoryCharacterDnaHairSchema,
    body: AiStoryCharacterDnaBodySchema,
    appearance: AiStoryCharacterDnaAppearanceSchema,
    distinctiveVisualFacts: z.array(visualFact(500)).max(32),
    mustPreserve: z.array(visualFact(500)).max(32).min(1),
    mutableTraits: z.array(visualFact(500)).max(32).min(1),
    sourceAssetId: Id,
    sourceContentHash: Hash,
    analysisVersion: z.literal(AI_STORY_CHARACTER_DNA_ANALYSIS_VERSION),
    createdAt: z.string().datetime(),
  })
  .strict();

export const AiStoryCharacterDnaAnalysisJobSchema = z
  .object({
    id: Id,
    orgId: Id,
    workspaceId: Id,
    sourceAssetId: Id,
    sourceContentHash: Hash,
    sourceSemantic: z.literal("CHARACTER_SOURCE_PORTRAIT"),
    permissionConfirmed: z.literal(true),
    status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]),
    approvalStatus: z.enum(["PENDING_HUMAN_REVIEW", "APPROVED", "DISCARDED"]),
    provider: Text.max(80),
    providerModel: Text.max(120),
    providerAttemptId: Id.nullable(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    costCategory: z.literal(CHARACTER_DNA_ANALYSIS),
    costUsd: z.string().regex(/^\d+\.\d{4}$/).nullable(),
    imageGenerationCalls: z.literal(0),
    gptImageCalls: z.literal(0),
    seedanceVideoCalls: z.literal(0),
    proposedDna: AiStoryCharacterDnaSchema.nullable(),
    characterDnaFingerprint: Hash.nullable(),
    compiledCharacterIdentityFingerprint: Hash.nullable(),
    reusableCharacterId: Id.nullable(),
    reusableCharacterVersionId: Id.nullable(),
    userSafeError: z.string().max(400).nullable(),
    createdBy: Id,
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    contractVersion: z.literal(AI_STORY_CHARACTER_DNA_CONTRACT_VERSION),
  })
  .strict();

export const AiStoryCharacterDnaCostEstimateSchema = z
  .object({
    category: z.literal(CHARACTER_DNA_ANALYSIS),
    currency: z.literal("USD"),
    estimatedExpected: z.string(),
    estimatedMin: z.string(),
    estimatedMax: z.string(),
    requiresExplicitAuthorization: z.literal(true),
    automaticRetry: z.literal(false),
  })
  .strict();

export const AiStoryCharacterDnaPublicJobSchema = z
  .object({
    id: Id,
    workspaceId: Id,
    sourceAssetId: Id,
    sourceSemantic: z.literal("CHARACTER_SOURCE_PORTRAIT"),
    status: AiStoryCharacterDnaAnalysisJobSchema.shape.status,
    approvalStatus: AiStoryCharacterDnaAnalysisJobSchema.shape.approvalStatus,
    proposedDna: AiStoryCharacterDnaSchema.nullable(),
    characterDnaFingerprint: Hash.nullable(),
    costCategory: z.literal(CHARACTER_DNA_ANALYSIS),
    costUsd: z.string().nullable(),
    imageGenerationCalls: z.literal(0),
    userSafeError: z.string().nullable(),
  })
  .strict();

export type AiStoryCharacterDna = z.infer<typeof AiStoryCharacterDnaSchema>;
export type AiStoryCharacterDnaAnalysisJob = z.infer<typeof AiStoryCharacterDnaAnalysisJobSchema>;
export type AiStoryCharacterDnaCostEstimate = z.infer<typeof AiStoryCharacterDnaCostEstimateSchema>;
export type AiStoryCharacterDnaPublicJob = z.infer<typeof AiStoryCharacterDnaPublicJobSchema>;
export type AiStoryCharacterIdentityMode = (typeof AI_STORY_CHARACTER_IDENTITY_MODES)[number];

export class AiStoryCharacterDnaError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AiStoryCharacterDnaError";
  }
}

export const FORBIDDEN_CHARACTER_DNA_TERMS = [
  "race",
  "ethnicity",
  "ethnic",
  "religion",
  "religious",
  "nationality",
  "malaysian",
  "chinese",
  "indian",
  "malay",
  "health",
  "medical",
  "disease",
  "diagnosis",
  "sexual",
  "orientation",
  "political",
  "personality",
  "criminal",
  "biometric",
  "embedding",
  "similarity score",
  "face recognition",
  "identify the person",
  "beautiful",
  "attractive",
  "pretty",
  "handsome",
  "gorgeous",
] as const;

export function containsForbiddenCharacterDnaLanguage(value: string) {
  const text = value.toLowerCase();
  return FORBIDDEN_CHARACTER_DNA_TERMS.some((term) => text.includes(term));
}

export function characterDnaAnalysisCostEstimate(): AiStoryCharacterDnaCostEstimate {
  return AiStoryCharacterDnaCostEstimateSchema.parse({
    category: CHARACTER_DNA_ANALYSIS,
    currency: "USD",
    estimatedExpected: "0.0050",
    estimatedMin: "0.0010",
    estimatedMax: "0.0100",
    requiresExplicitAuthorization: true,
    automaticRetry: false,
  });
}

export function publicCharacterDnaJob(job: AiStoryCharacterDnaAnalysisJob): AiStoryCharacterDnaPublicJob {
  return AiStoryCharacterDnaPublicJobSchema.parse({
    id: job.id,
    workspaceId: job.workspaceId,
    sourceAssetId: job.sourceAssetId,
    sourceSemantic: job.sourceSemantic,
    status: job.status,
    approvalStatus: job.approvalStatus,
    proposedDna: job.proposedDna,
    characterDnaFingerprint: job.characterDnaFingerprint,
    costCategory: job.costCategory,
    costUsd: job.costUsd,
    imageGenerationCalls: job.imageGenerationCalls,
    userSafeError: job.userSafeError,
  });
}

export function mapCharacterDnaToIdentityCore(dna: AiStoryCharacterDna) {
  return {
    identityDescription: dna.identityDescription,
    faceIdentityDescription: [
      dna.face.shape,
      dna.face.jawline,
      dna.eyes.shape,
      dna.eyes.colorDescription,
      dna.nose.bridge,
      dna.mouth.lipShape,
    ].join(", "),
    bodyIdentityDescription: [
      dna.body.build,
      dna.body.proportionDescription,
      dna.body.heightImpression,
    ].join(", "),
    distinctiveVisualFacts: [...dna.distinctiveVisualFacts],
    mustPreserve: [...dna.mustPreserve],
    mustNeverChange: [...dna.mustPreserve],
  };
}

export function defaultCharacterDnaLook() {
  return {
    wardrobe: "default commercial wardrobe",
    makeup: null as string | null,
    accessories: null as string | null,
    hairstyle: null as string | null,
    hairColor: null as string | null,
  };
}

export function defaultCharacterDnaMutableLookPolicy() {
  return {
    wardrobeAllowed: true,
    makeupAllowed: true,
    accessoriesAllowed: true,
    hairstyleAllowed: false,
    hairColorAllowed: false,
  };
}

export function isCharacterDnaIdentity(
  value: { identityMode?: string | null; characterDnaFingerprint?: string | null } | null | undefined
) {
  return value?.identityMode === "CHARACTER_DNA" || Boolean(value?.characterDnaFingerprint);
}

export function sourcePhotoSentToVideoProviderForDna() {
  return false as const;
}

export function seedanceIdentityAssetIdsForCharacter(input: {
  identityMode?: string | null;
  characterDnaFingerprint?: string | null;
  canonicalAssets: readonly {
    assetId: string;
    role: string;
  }[];
}) {
  if (isCharacterDnaIdentity(input)) {
    return input.canonicalAssets
      .filter((asset) => asset.role === "SYNTHETIC_IDENTITY_ANCHOR")
      .map((asset) => asset.assetId);
  }
  return input.canonicalAssets.map((asset) => asset.assetId);
}

export const AI_STORY_CHARACTER_DNA_COPY = Object.freeze({
  createFromPhoto: "Create Character from Photo",
  uploadPhoto: "Upload Photo",
  analyzeCharacter: "Analyze Character",
  reviewDescription: "Review Character Description",
  characterProfile: "Character Profile",
  identityRules: "Identity rules",
  locked: "Locked",
  mutablePerEpisode: "Mutable per Episode",
  saveCharacter: "Save Character",
  characterDna: "Character DNA",
  characterDnaCertified: "Character DNA ✓",
  sourcePhoto: "Source photo",
  identityLocked: "Identity locked",
  consistency: "EmberOS will keep the Character's key visual traits consistent across Episodes. Small visual differences may occur.",
  analysisFailed: "This photo could not be turned into a Character description. No Character was saved.",
  saveRequiresApprovedDna: "Save Character requires a reviewed Character DNA.",
});
