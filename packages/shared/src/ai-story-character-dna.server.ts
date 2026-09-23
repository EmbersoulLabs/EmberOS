import { createHash, randomUUID } from "node:crypto";
import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AI_STORY_CHARACTER_DNA_ANALYSIS_VERSION,
  AI_STORY_CHARACTER_DNA_CONTRACT_VERSION,
  AI_STORY_CHARACTER_DNA_COPY,
  AiStoryCharacterDnaError,
  AiStoryCharacterDnaSchema,
  CHARACTER_CONSISTENCY_MODE,
  CHARACTER_DNA_ANALYSIS,
  containsForbiddenCharacterDnaLanguage,
  DEFAULT_CHARACTER_DNA_MUST_PRESERVE,
  DEFAULT_CHARACTER_DNA_MUTABLE_TRAITS,
  mapCharacterDnaToIdentityCore,
  sourcePhotoSentToVideoProviderForDna,
  type AiStoryCharacterDna,
  type AiStoryCharacterDnaAnalysisJob,
} from "./ai-story-character-dna";
import type { AiStoryCharacterEpisodeLook } from "./ai-story-reusable-character";

const SENSITIVE_KEYS = [
  "race",
  "ethnicity",
  "religion",
  "nationality",
  "health",
  "medicalCondition",
  "sexualOrientation",
  "politicalIdentity",
  "personality",
  "criminalStatus",
  "biometricEmbedding",
  "faceEmbedding",
  "similarityScore",
  "faceRecognition",
  "identityMatch",
];

export function computeCharacterDnaFingerprint(dna: Pick<
  AiStoryCharacterDna,
  | "identityDescription"
  | "face"
  | "eyes"
  | "nose"
  | "mouth"
  | "hair"
  | "body"
  | "appearance"
  | "distinctiveVisualFacts"
  | "mustPreserve"
  | "mutableTraits"
  | "sourceAssetId"
  | "sourceContentHash"
  | "analysisVersion"
>) {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_CHARACTER_DNA_CONTRACT_VERSION,
    analysisVersion: dna.analysisVersion,
    identityDescription: dna.identityDescription,
    face: dna.face,
    eyes: dna.eyes,
    nose: dna.nose,
    mouth: dna.mouth,
    hair: dna.hair,
    body: dna.body,
    appearance: dna.appearance,
    distinctiveVisualFacts: dna.distinctiveVisualFacts,
    mustPreserve: dna.mustPreserve,
    mutableTraits: dna.mutableTraits,
    sourceAssetId: dna.sourceAssetId,
    sourceContentHash: dna.sourceContentHash,
  });
}

export function compileCharacterDnaIdentityBlock(dna: AiStoryCharacterDna) {
  const lines = [
    "CHARACTER IDENTITY — LOCKED",
    "",
    `Identity: ${dna.identityDescription}`,
    `Face: ${dna.face.shape}, ${dna.face.jawline}, ${dna.face.forehead}, ${dna.face.cheeks}, ${dna.face.chin}`,
    `Eyes: ${dna.eyes.shape}, ${dna.eyes.size}, ${dna.eyes.colorDescription}, ${dna.eyes.eyebrowShape}`,
    `Nose: ${dna.nose.bridge}, ${dna.nose.width}, ${dna.nose.tip}`,
    `Mouth: ${dna.mouth.lipShape}, ${dna.mouth.lipFullness}`,
    `Hair: ${dna.hair.length}, ${dna.hair.texture}, ${dna.hair.parting}, ${dna.hair.style}, ${dna.hair.colorDescription}`,
    `Body: ${dna.body.build}, ${dna.body.proportionDescription}, ${dna.body.heightImpression}`,
    `Appearance: ${dna.appearance.defaultExpression}, ${dna.appearance.overallImpression}, ${dna.appearance.presentationStyle}`,
    `Distinctive traits: ${dna.distinctiveVisualFacts.join("; ") || "none listed"}`,
    `Consistency requirement: Preserve the same facial structure, hairstyle identity, body proportions, and overall visual appearance throughout this Episode.`,
    `Consistency mode: ${CHARACTER_CONSISTENCY_MODE}`,
  ];
  return lines.join("\n");
}

export function computeCompiledCharacterIdentityFingerprint(dna: AiStoryCharacterDna) {
  return sha256CanonicalIntegrityHash({
    kind: "ai-story-compiled-character-identity.v1",
    block: compileCharacterDnaIdentityBlock(dna),
  });
}

export function compileCharacterDnaEpisodePrompt(input: {
  dna: AiStoryCharacterDna;
  episodeLook?: Partial<AiStoryCharacterEpisodeLook> | null;
}) {
  const look = input.episodeLook ?? {};
  const lookLines = [
    "EPISODE LOOK — MUTABLE",
    `wardrobe: ${look.wardrobe ?? "unspecified"}`,
    `makeup: ${look.makeup ?? "unspecified"}`,
    `accessories: ${look.accessories ?? "unspecified"}`,
    `expression: ${look.expression ?? "unspecified"}`,
    `pose: ${look.pose ?? "unspecified"}`,
    `location: ${look.location ?? "unspecified"}`,
    `action: ${look.action ?? "unspecified"}`,
  ];
  return `${compileCharacterDnaIdentityBlock(input.dna)}\n\n${lookLines.join("\n")}`;
}

export function applyCharacterDnaToSeedanceRequest<T extends {
  compiledPrompt: string;
  referenceMappings?: Array<{ assetId: string }>;
}>(input: {
  request: T;
  dna: AiStoryCharacterDna;
  episodeLook?: Partial<AiStoryCharacterEpisodeLook> | null;
}): T & {
  compiledPrompt: string;
  compiledCharacterIdentityFingerprint: string;
  characterDnaFingerprint: string;
  sourcePhotoSentToVideoProvider: false;
  referenceMappings: Array<{ assetId: string }>;
} {
  const identityBlock = compileCharacterDnaIdentityBlock(input.dna);
  const episodeBlock = compileCharacterDnaEpisodePrompt({
    dna: input.dna,
    episodeLook: input.episodeLook,
  });
  const compiledPrompt = input.request.compiledPrompt.includes("CHARACTER IDENTITY — LOCKED")
    ? input.request.compiledPrompt
    : `${episodeBlock}\n\n${input.request.compiledPrompt}`;
  return {
    ...input.request,
    compiledPrompt,
    compiledCharacterIdentityFingerprint: computeCompiledCharacterIdentityFingerprint(input.dna),
    characterDnaFingerprint: computeCharacterDnaFingerprint(input.dna),
    sourcePhotoSentToVideoProvider: sourcePhotoSentToVideoProviderForDna(),
    referenceMappings: (input.request.referenceMappings ?? []).filter(
      (reference) => reference.assetId !== input.dna.sourceAssetId
    ),
  };
}

export function rejectSensitiveCharacterDnaPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  for (const key of SENSITIVE_KEYS) {
    if (key in record) {
      throw new AiStoryCharacterDnaError(
        "SENSITIVE_TRAIT_INFERENCE_BLOCKED",
        AI_STORY_CHARACTER_DNA_COPY.analysisFailed
      );
    }
  }
}

export function sanitizeCharacterDnaAnalysisOutput(input: {
  payload: unknown;
  sourceAssetId: string;
  sourceContentHash: string;
  createdAt: string;
}): AiStoryCharacterDna {
  rejectSensitiveCharacterDnaPayload(input.payload);
  if (!input.payload || typeof input.payload !== "object") {
    throw new AiStoryCharacterDnaError("CHARACTER_DNA_ANALYSIS_INVALID", AI_STORY_CHARACTER_DNA_COPY.analysisFailed);
  }
  const raw = input.payload as Record<string, unknown>;
  const parsed = AiStoryCharacterDnaSchema.safeParse({
    ...raw,
    mustPreserve:
      Array.isArray(raw.mustPreserve) && raw.mustPreserve.length
        ? raw.mustPreserve
        : [...DEFAULT_CHARACTER_DNA_MUST_PRESERVE],
    mutableTraits:
      Array.isArray(raw.mutableTraits) && raw.mutableTraits.length
        ? raw.mutableTraits
        : [...DEFAULT_CHARACTER_DNA_MUTABLE_TRAITS],
    sourceAssetId: input.sourceAssetId,
    sourceContentHash: input.sourceContentHash,
    analysisVersion: AI_STORY_CHARACTER_DNA_ANALYSIS_VERSION,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : input.createdAt,
  });
  if (!parsed.success) {
    throw new AiStoryCharacterDnaError("CHARACTER_DNA_ANALYSIS_INVALID", AI_STORY_CHARACTER_DNA_COPY.analysisFailed);
  }
  const strings = collectDnaStrings(parsed.data);
  if (strings.some(containsForbiddenCharacterDnaLanguage)) {
    throw new AiStoryCharacterDnaError("SENSITIVE_TRAIT_INFERENCE_BLOCKED", AI_STORY_CHARACTER_DNA_COPY.analysisFailed);
  }
  return parsed.data;
}

function collectDnaStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectDnaStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectDnaStrings);
  return [];
}

export function buildAiStoryCharacterDnaAnalysisJob(input: {
  orgId: string;
  workspaceId: string;
  sourceAssetId: string;
  sourceContentHash: string;
  permissionConfirmed: true;
  createdBy: string;
  createdAt: string;
}): AiStoryCharacterDnaAnalysisJob {
  return {
    id: deterministicUuidFromFingerprint(
      "ai-story-character-dna-analysis-job",
      `${input.workspaceId}:${input.sourceAssetId}:${input.createdAt}`
    ),
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    sourceAssetId: input.sourceAssetId,
    sourceContentHash: input.sourceContentHash,
    sourceSemantic: "CHARACTER_SOURCE_PORTRAIT",
    permissionConfirmed: true,
    status: "QUEUED",
    approvalStatus: "PENDING_HUMAN_REVIEW",
    provider: "pending",
    providerModel: "pending",
    providerAttemptId: null,
    inputTokens: null,
    outputTokens: null,
    costCategory: CHARACTER_DNA_ANALYSIS,
    costUsd: null,
    imageGenerationCalls: 0,
    gptImageCalls: 0,
    seedanceVideoCalls: 0,
    proposedDna: null,
    characterDnaFingerprint: null,
    compiledCharacterIdentityFingerprint: null,
    reusableCharacterId: null,
    reusableCharacterVersionId: null,
    userSafeError: null,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    completedAt: null,
    contractVersion: AI_STORY_CHARACTER_DNA_CONTRACT_VERSION,
  };
}

export function applyCharacterDnaAnalysisSuccess(
  job: AiStoryCharacterDnaAnalysisJob,
  input: {
    dna: AiStoryCharacterDna;
    provider: string;
    providerModel: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: string;
    completedAt: string;
  }
): AiStoryCharacterDnaAnalysisJob {
  return {
    ...job,
    status: "SUCCEEDED",
    approvalStatus: "PENDING_HUMAN_REVIEW",
    provider: input.provider,
    providerModel: input.providerModel,
    providerAttemptId: randomUUID(),
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costUsd: input.costUsd,
    proposedDna: input.dna,
    characterDnaFingerprint: computeCharacterDnaFingerprint(input.dna),
    compiledCharacterIdentityFingerprint: computeCompiledCharacterIdentityFingerprint(input.dna),
    completedAt: input.completedAt,
    userSafeError: null,
  };
}

export function applyCharacterDnaAnalysisFailure(
  job: AiStoryCharacterDnaAnalysisJob,
  completedAt: string
): AiStoryCharacterDnaAnalysisJob {
  return {
    ...job,
    status: "FAILED",
    approvalStatus: "DISCARDED",
    completedAt,
    proposedDna: null,
    characterDnaFingerprint: null,
    compiledCharacterIdentityFingerprint: null,
    userSafeError: AI_STORY_CHARACTER_DNA_COPY.analysisFailed,
  };
}

export function approveCharacterDna(
  job: AiStoryCharacterDnaAnalysisJob,
  approvedDna: AiStoryCharacterDna
): { job: AiStoryCharacterDnaAnalysisJob; dna: AiStoryCharacterDna } {
  if (job.status !== "SUCCEEDED" || !job.proposedDna) {
    throw new AiStoryCharacterDnaError("CHARACTER_DNA_NOT_READY", AI_STORY_CHARACTER_DNA_COPY.saveRequiresApprovedDna);
  }
  const dna = sanitizeCharacterDnaAnalysisOutput({
    payload: approvedDna,
    sourceAssetId: job.sourceAssetId,
    sourceContentHash: job.sourceContentHash,
    createdAt: approvedDna.createdAt,
  });
  if (dna.sourceAssetId !== job.sourceAssetId || dna.sourceContentHash !== job.sourceContentHash) {
    throw new AiStoryCharacterDnaError("CHARACTER_DNA_SOURCE_MISMATCH", AI_STORY_CHARACTER_DNA_COPY.saveRequiresApprovedDna);
  }
  return {
    dna,
    job: {
      ...job,
      approvalStatus: "APPROVED",
      proposedDna: dna,
      characterDnaFingerprint: computeCharacterDnaFingerprint(dna),
      compiledCharacterIdentityFingerprint: computeCompiledCharacterIdentityFingerprint(dna),
    },
  };
}

export function mockCharacterDnaFixture(input: {
  sourceAssetId: string;
  sourceContentHash: string;
  createdAt?: string;
}): AiStoryCharacterDna {
  return AiStoryCharacterDnaSchema.parse({
    identityDescription: "Oval-faced adult with shoulder-length dark straight hair and a calm friendly expression.",
    face: {
      shape: "oval face",
      jawline: "soft jawline",
      forehead: "medium forehead",
      cheeks: "soft cheeks",
      chin: "rounded chin",
    },
    eyes: {
      shape: "almond-shaped eyes",
      size: "medium eyes",
      colorDescription: "dark brown eyes",
      eyebrowShape: "naturally arched brows",
    },
    nose: {
      bridge: "straight bridge",
      width: "medium width",
      tip: "rounded tip",
    },
    mouth: {
      lipShape: "soft lip shape",
      lipFullness: "medium lips",
    },
    hair: {
      length: "shoulder-length hair",
      texture: "straight hair",
      parting: "center-adjacent parting",
      style: "loose straight style",
      colorDescription: "dark hair",
    },
    body: {
      build: "petite natural build",
      proportionDescription: "petite natural proportions",
      heightImpression: "average-to-petite height impression",
    },
    appearance: {
      defaultExpression: "calm friendly expression",
      overallImpression: "clean commercial presenter look",
      presentationStyle: "natural on-camera presentation",
    },
    distinctiveVisualFacts: ["small beauty mark near the left eye"],
    mustPreserve: [...DEFAULT_CHARACTER_DNA_MUST_PRESERVE],
    mutableTraits: [...DEFAULT_CHARACTER_DNA_MUTABLE_TRAITS],
    sourceAssetId: input.sourceAssetId,
    sourceContentHash: input.sourceContentHash,
    analysisVersion: AI_STORY_CHARACTER_DNA_ANALYSIS_VERSION,
    createdAt: input.createdAt ?? "2026-09-23T00:00:00.000Z",
  });
}

export function characterDnaBytesHash(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export { mapCharacterDnaToIdentityCore };
