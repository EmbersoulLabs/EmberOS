import { createHash, randomUUID } from "node:crypto";
import { sha256CanonicalIntegrityHash } from "@ceo-agent/shared/server";
import type { NarrativeWorldState, ResolvedActiveSceneIntent } from "./active-intent-world-state";
import {
  AI_STORY_PREPARED_SCENE_FRAME_CONTRACT_VERSION,
  AI_STORY_PROVIDER_READY_SCENE_INPUT_CONTRACT_VERSION,
  isSceneInputPreparationIntegrityValid,
  type ProviderReadySceneInputAuthority,
  type SceneInputPreparationAuthority,
} from "./scene-input-preparation";

export const AI_STORY_SCENE_KEYFRAME_BRIEF_VERSION = "ai-story-scene-keyframe-brief.v1" as const;
export const AI_STORY_SCENE_KEYFRAME_EXECUTION_VERSION = "ai-story-scene-keyframe-execution.v1" as const;

export const SCENE_KEYFRAME_QC_DIMENSIONS = [
  "IDENTITY_PRESERVATION",
  "CURRENT_LOCATION",
  "CHARACTER_PRESENCE",
  "CHARACTER_EXCLUSION",
  "PRODUCT_POSSESSION",
  "ACTION_START_STATE",
  "HISTORICAL_ENVIRONMENT_EXCLUSION",
  "SCENE_INTENT_ALIGNMENT",
  "COMPOSITION_SUITABILITY",
  "PROVIDER_MODE_SUITABILITY",
] as const;

export type SceneKeyframeQcDimension = (typeof SCENE_KEYFRAME_QC_DIMENSIONS)[number];
export type SceneKeyframeQcVerdict = "PASS" | "FAIL" | "UNKNOWN";
export type SceneKeyframeQcResult =
  | "PASS"
  | "REGENERATE_REQUIRED"
  | "HUMAN_CONFIRMATION_REQUIRED"
  | "REJECT";

export type SceneKeyframeScope = Readonly<{
  tenantId: string;
  workspaceId: string;
  storyId: string;
  sceneId: string;
  sceneVersionId: string;
}>;

export type SceneKeyframeReference = Readonly<{
  assetId: string;
  contentHash: string;
  mimeType: string;
  role: "RAW_SUBJECT" | "PRODUCT_IDENTITY" | "CHARACTER_IDENTITY" | "PET_IDENTITY";
  subjectId: string;
  authorityId: string;
  authorityClassification: "ACTIVE" | "CONTINUITY_REFERENCE";
  tenantId: string;
  workspaceId: string;
  storyId: string;
}>;

export type SceneKeyframeBrief = Readonly<{
  contractVersion: typeof AI_STORY_SCENE_KEYFRAME_BRIEF_VERSION;
  SCENE_IDENTITY: SceneKeyframeScope;
  LATEST_ACTIVE_INTENT: Readonly<{
    authorityId: string;
    narrativePurpose: string;
    actions: readonly string[];
  }>;
  CURRENT_LOCATION: Readonly<{ id: string; label: string }>;
  CHARACTERS_REQUIRED: readonly string[];
  CHARACTERS_EXCLUDED: readonly string[];
  PRODUCT_OR_OBJECT_IDENTITY: readonly Readonly<{
    objectId: string;
    observableIdentityFacts: readonly string[];
  }>[];
  PRODUCT_POSSESSION: readonly Readonly<{ objectId: string; holder: string }>[];
  REQUIRED_ACTION_START_STATE: readonly string[];
  ENVIRONMENT_TO_CREATE: readonly string[];
  HISTORICAL_ENVIRONMENTS_TO_EXCLUDE: readonly string[];
  VISUAL_CONTINUITY_TO_PRESERVE: readonly string[];
  COMPOSITION_REQUIREMENTS: readonly string[];
  TARGET_VIDEO_PROVIDER_MODE: SceneInputPreparationAuthority["provider"];
  SOURCE_ASSET_REFERENCES: readonly SceneKeyframeReference[];
  activeIntentIdentity: string;
  narrativeWorldStateIdentity: string;
  preparationAuthorityId: string;
  preparationFingerprint: string;
  fingerprint: string;
}>;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function canonicalPossessions(values: readonly { objectId: string; holder: string }[]) {
  return [...values]
    .map((value) => ({ objectId: value.objectId.trim(), holder: value.holder.trim() }))
    .sort((a, b) => a.objectId.localeCompare(b.objectId) || a.holder.localeCompare(b.holder));
}

function assertCanonicalHash(value: string, code: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error(code);
}

function activeIntentIdentity(intent: ResolvedActiveSceneIntent): string {
  return sha256CanonicalIntegrityHash({ kind: intent.contractVersion, intent });
}

function activeIntentAuthorityId(intent: ResolvedActiveSceneIntent): string {
  const active = intent.sources.filter((source) => source.classification === "ACTIVE");
  const owners = new Set(Object.values(intent.fieldAuthority));
  const matching = active.filter((source) => owners.has(source.authorityId));
  if (matching.length === 0) throw new Error("SCENE_KEYFRAME_ACTIVE_INTENT_AUTHORITY_MISSING");
  return matching
    .map((source) => source.authorityId)
    .sort((a, b) => a.localeCompare(b))
    .join("+");
}

function assertScope(scope: SceneKeyframeScope, preparation: SceneInputPreparationAuthority): void {
  if (!scope.tenantId || !scope.workspaceId || !scope.storyId) throw new Error("SCENE_KEYFRAME_SCOPE_REQUIRED");
  if (scope.sceneId !== preparation.sceneId || scope.sceneVersionId !== preparation.sceneVersionId) {
    throw new Error("SCENE_KEYFRAME_SCENE_AUTHORITY_MISMATCH");
  }
}

function assertReferences(input: {
  scope: SceneKeyframeScope;
  preparation: SceneInputPreparationAuthority;
  references: readonly SceneKeyframeReference[];
}): void {
  if (!input.references.some((reference) =>
    reference.assetId === input.preparation.sourceRawAssetId
    && reference.contentHash === input.preparation.sourceRawAssetContentHash
    && reference.role === "RAW_SUBJECT"
  )) throw new Error("SCENE_KEYFRAME_RAW_SOURCE_REFERENCE_REQUIRED");
  for (const reference of input.references) {
    assertCanonicalHash(reference.contentHash, "SCENE_KEYFRAME_REFERENCE_HASH_INVALID");
    if (
      reference.tenantId !== input.scope.tenantId
      || reference.workspaceId !== input.scope.workspaceId
      || reference.storyId !== input.scope.storyId
    ) throw new Error("SCENE_KEYFRAME_CROSS_WORKSPACE_REFERENCE_DENIED");
  }
  const canonicalCharacterSubjects = new Set(
    input.references
      .filter((reference) => reference.role === "CHARACTER_IDENTITY" || reference.role === "PET_IDENTITY")
      .map((reference) => reference.subjectId)
  );
  for (const subject of canonicalCharacterSubjects) {
    if (!input.preparation.targetCharactersPresent.includes(subject)) {
      throw new Error("SCENE_KEYFRAME_STALE_CHARACTER_IDENTITY_REFERENCE");
    }
  }
}

/** Deterministic compiler: timestamps and execution ids are deliberately excluded. */
export function compileSceneKeyframeBrief(input: {
  scope: SceneKeyframeScope;
  preparation: SceneInputPreparationAuthority;
  activeIntent: ResolvedActiveSceneIntent;
  worldState: NarrativeWorldState;
  sourceAssetReferences: readonly SceneKeyframeReference[];
  charactersExcluded?: readonly string[];
  compositionRequirements?: readonly string[];
}): SceneKeyframeBrief {
  if (!isSceneInputPreparationIntegrityValid(input.preparation)) throw new Error("SCENE_INPUT_PREPARATION_INTEGRITY_INVALID");
  if (input.preparation.decision !== "SCENE_PREPARATION_REQUIRED") {
    throw new Error("SCENE_KEYFRAME_PREPARATION_DECISION_REQUIRED");
  }
  assertScope(input.scope, input.preparation);
  assertReferences({ scope: input.scope, preparation: input.preparation, references: input.sourceAssetReferences });
  const authorityId = activeIntentAuthorityId(input.activeIntent);
  if (
    !authorityId.split("+").includes(input.preparation.activeIntentAuthorityId)
    || input.worldState.sceneId !== input.scope.sceneId
    || input.worldState.currentLocation.id !== input.preparation.targetLocation.id
    || JSON.stringify(uniqueSorted(input.worldState.charactersPresent)) !== JSON.stringify(uniqueSorted(input.preparation.targetCharactersPresent))
    || JSON.stringify(canonicalPossessions(input.worldState.possessions)) !== JSON.stringify(canonicalPossessions(input.preparation.targetPossessions))
  ) throw new Error("SCENE_KEYFRAME_CURRENT_AUTHORITY_CONFLICT");

  const requiredCharacters = uniqueSorted(input.worldState.charactersPresent);
  const excludedCharacters = uniqueSorted(input.charactersExcluded ?? []);
  if (excludedCharacters.some((character) => requiredCharacters.includes(character))) {
    throw new Error("SCENE_KEYFRAME_CHARACTER_REQUIREMENT_CONFLICT");
  }
  const historical = uniqueSorted([
    ...input.worldState.historicalLocations.map((location) => location.label),
    ...input.preparation.environmentFactsNotToInherit,
    ...input.activeIntent.mustNotInherit,
  ]);
  const identityFacts = uniqueSorted(input.preparation.identityFactsToPreserve);
  const possessions = canonicalPossessions(input.worldState.possessions);
  const objectIdentity = possessions.map((possession) => ({
    objectId: possession.objectId,
    observableIdentityFacts: identityFacts,
  }));
  const references = [...input.sourceAssetReferences].sort((a, b) =>
    a.role.localeCompare(b.role) || a.subjectId.localeCompare(b.subjectId) || a.assetId.localeCompare(b.assetId)
  );
  const withoutFingerprint = {
    contractVersion: AI_STORY_SCENE_KEYFRAME_BRIEF_VERSION,
    SCENE_IDENTITY: input.scope,
    LATEST_ACTIVE_INTENT: {
      authorityId: input.preparation.activeIntentAuthorityId,
      narrativePurpose: input.activeIntent.narrativePurpose,
      actions: uniqueSorted(input.activeIntent.actions),
    },
    CURRENT_LOCATION: input.worldState.currentLocation,
    CHARACTERS_REQUIRED: requiredCharacters,
    CHARACTERS_EXCLUDED: excludedCharacters,
    PRODUCT_OR_OBJECT_IDENTITY: objectIdentity,
    PRODUCT_POSSESSION: possessions,
    REQUIRED_ACTION_START_STATE: uniqueSorted(input.activeIntent.actions),
    ENVIRONMENT_TO_CREATE: uniqueSorted([input.worldState.currentLocation.label]),
    HISTORICAL_ENVIRONMENTS_TO_EXCLUDE: historical,
    VISUAL_CONTINUITY_TO_PRESERVE: uniqueSorted([...identityFacts, ...input.activeIntent.continuityRequirements]),
    COMPOSITION_REQUIREMENTS: uniqueSorted([
      "Compose a plausible first frame for the intended motion, not completed motion",
      "Keep every possessed object visually with its current holder",
      "Treat the active narrative environment as primary",
      ...(input.compositionRequirements ?? []),
    ]),
    TARGET_VIDEO_PROVIDER_MODE: input.preparation.provider,
    SOURCE_ASSET_REFERENCES: references,
    activeIntentIdentity: activeIntentIdentity(input.activeIntent),
    narrativeWorldStateIdentity: input.preparation.narrativeWorldStateIdentity,
    preparationAuthorityId: input.preparation.preparationAuthorityId,
    preparationFingerprint: input.preparation.fingerprint,
  } as const;
  return {
    ...withoutFingerprint,
    fingerprint: sha256CanonicalIntegrityHash({ kind: AI_STORY_SCENE_KEYFRAME_BRIEF_VERSION, brief: withoutFingerprint }),
  };
}

export function isSceneKeyframeBriefIntegrityValid(brief: SceneKeyframeBrief): boolean {
  const { fingerprint: _fingerprint, ...withoutFingerprint } = brief;
  return sha256CanonicalIntegrityHash({ kind: AI_STORY_SCENE_KEYFRAME_BRIEF_VERSION, brief: withoutFingerprint }) === brief.fingerprint;
}

export function sceneKeyframePrompt(brief: SceneKeyframeBrief): string {
  if (!isSceneKeyframeBriefIntegrityValid(brief)) throw new Error("SCENE_KEYFRAME_BRIEF_INTEGRITY_INVALID");
  const lines = [
    "Create a cinematic narrative scene keyframe suitable as the first frame of a video shot.",
    `Current location to create: ${brief.CURRENT_LOCATION.label}.`,
    `Required characters: ${brief.CHARACTERS_REQUIRED.join(", ") || "none"}.`,
    `Excluded characters: ${brief.CHARACTERS_EXCLUDED.join(", ") || "none"}.`,
    `Current possession: ${brief.PRODUCT_POSSESSION.map((fact) => `${fact.holder} visibly possesses ${fact.objectId}`).join("; ") || "none"}.`,
    `Action start state: ${brief.REQUIRED_ACTION_START_STATE.join("; ")}.`,
    `Preserve observable identity: ${brief.VISUAL_CONTINUITY_TO_PRESERVE.join("; ")}.`,
    `Composition: ${brief.COMPOSITION_REQUIREMENTS.join("; ")}.`,
    `Exclude as active environment or composition: ${brief.HISTORICAL_ENVIRONMENTS_TO_EXCLUDE.join("; ") || "none"}.`,
    "The supplied references establish identity only; their historical backgrounds and poses are not execution authority.",
  ];
  return lines.join("\n");
}

export type SceneKeyframeGenerationInput = Readonly<{
  brief: SceneKeyframeBrief;
  prompt: string;
  references: readonly Readonly<{
    reference: SceneKeyframeReference;
    bytes: Buffer;
  }>[];
  idempotencyKey: string;
}>;

export type SceneKeyframeGenerationOutput = Readonly<{
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  providerRequestId: string;
  revisedPrompt?: string;
}>;

export interface SceneKeyframeGenerationAdapter {
  readonly providerId: string;
  readonly modelId: string;
  readonly adapterVersion: string;
  readonly externalPaidCall: boolean;
  readonly referenceConditioned: true;
  readonly narrativeCharacterComposition: true;
  readonly possessionComposition: true;
  readonly actionStartStateComposition: true;
  generate(input: SceneKeyframeGenerationInput): Promise<SceneKeyframeGenerationOutput>;
}

export type SceneKeyframeQcEvidence = Readonly<Record<SceneKeyframeQcDimension, Readonly<{
  verdict: SceneKeyframeQcVerdict;
  note: string;
}>>>;

export interface SceneKeyframeQcAdapter {
  readonly evaluatorId: string;
  readonly evaluatorVersion: string;
  readonly externalPaidCall: boolean;
  evaluate(input: Readonly<{
    brief: SceneKeyframeBrief;
    generated: SceneKeyframeGenerationOutput;
    references: SceneKeyframeGenerationInput["references"];
  }>): Promise<SceneKeyframeQcEvidence>;
}

export type SceneKeyframeQcReport = Readonly<{
  dimensions: readonly Readonly<{
    dimension: SceneKeyframeQcDimension;
    verdict: SceneKeyframeQcVerdict;
    note: string;
  }>[];
  result: SceneKeyframeQcResult;
  fingerprint: string;
}>;

export function createSceneKeyframeQcReport(evidence: SceneKeyframeQcEvidence): SceneKeyframeQcReport {
  const dimensions = SCENE_KEYFRAME_QC_DIMENSIONS.map((dimension) => ({ dimension, ...evidence[dimension] }));
  const failed = dimensions.filter((item) => item.verdict === "FAIL").map((item) => item.dimension);
  const unknown = dimensions.some((item) => item.verdict === "UNKNOWN");
  const result: SceneKeyframeQcResult = failed.some((dimension) =>
    dimension === "IDENTITY_PRESERVATION" || dimension === "CHARACTER_EXCLUSION"
  ) ? "REJECT"
    : failed.length > 0 ? "REGENERATE_REQUIRED"
      : unknown ? "HUMAN_CONFIRMATION_REQUIRED"
        : "PASS";
  const body = { dimensions, result };
  return { ...body, fingerprint: sha256CanonicalIntegrityHash({ kind: "ai-story-scene-keyframe-qc.v1", report: body }) };
}

export type PreparedSceneKeyframeAsset = Readonly<{
  contractVersion: typeof AI_STORY_PREPARED_SCENE_FRAME_CONTRACT_VERSION;
  executionContractVersion: typeof AI_STORY_SCENE_KEYFRAME_EXECUTION_VERSION;
  assetId: string;
  contentHash: string;
  mimeType: SceneKeyframeGenerationOutput["mimeType"];
  storagePath: string;
  scope: SceneKeyframeScope;
  sourceRawAssetId: string;
  sourceRawAssetContentHash: string;
  activeIntentIdentity: string;
  narrativeWorldStateIdentity: string;
  preparationAuthorityId: string;
  preparationFingerprint: string;
  keyframeBriefFingerprint: string;
  generationIdentity: Readonly<{
    providerId: string;
    modelId: string;
    adapterVersion: string;
    providerRequestId: string;
  }>;
  qc: SceneKeyframeQcReport;
  providerReady: boolean;
  supersessionState: "ACTIVE" | "SUPERSEDED";
  supersedesAssetId: string | null;
  executionIdentity: string;
  createdAt: string;
  fingerprint: string;
}>;

export interface SceneKeyframeExecutionRepository {
  findByExecutionIdentity(executionIdentity: string, scope: SceneKeyframeScope): Promise<PreparedSceneKeyframeAsset | null>;
  findActiveForScene(scope: SceneKeyframeScope): Promise<PreparedSceneKeyframeAsset | null>;
  commitPreparedAsset(input: Readonly<{
    asset: PreparedSceneKeyframeAsset;
    bytes: Buffer;
    expectedActiveAssetId: string | null;
  }>): Promise<PreparedSceneKeyframeAsset>;
}

export type SceneKeyframeExecutionResult =
  | Readonly<{ status: "READY"; asset: PreparedSceneKeyframeAsset; providerInput: ProviderReadySceneInputAuthority; reused: boolean }>
  | Readonly<{ status: "NEEDS_REVIEW"; asset: PreparedSceneKeyframeAsset; reused: boolean }>
  | Readonly<{ status: "FAILED_CLOSED"; code: string }>
  | Readonly<{
      status: "AUTHORIZATION_REQUIRED";
      code: "LIVE_KEYFRAME_IMAGE_GENERATION_AUTHORIZATION_REQUIRED";
      provider: string;
      model: string;
      estimatedCallCount: number;
      exactScene: SceneKeyframeScope;
    }>;

function executionIdentity(brief: SceneKeyframeBrief, generator: SceneKeyframeGenerationAdapter, qc: SceneKeyframeQcAdapter): string {
  return sha256CanonicalIntegrityHash({
    kind: AI_STORY_SCENE_KEYFRAME_EXECUTION_VERSION,
    source: brief.SOURCE_ASSET_REFERENCES.map((reference) => ({ assetId: reference.assetId, contentHash: reference.contentHash })),
    scene: brief.SCENE_IDENTITY,
    activeIntentIdentity: brief.activeIntentIdentity,
    narrativeWorldStateIdentity: brief.narrativeWorldStateIdentity,
    preparationFingerprint: brief.preparationFingerprint,
    briefFingerprint: brief.fingerprint,
    generator: { providerId: generator.providerId, modelId: generator.modelId, adapterVersion: generator.adapterVersion },
    qc: { evaluatorId: qc.evaluatorId, evaluatorVersion: qc.evaluatorVersion },
  });
}

function outputHash(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function imageBytesMatchMime(bytes: Buffer, mimeType: SceneKeyframeGenerationOutput["mimeType"]): boolean {
  if (mimeType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function assetFingerprint(asset: Omit<PreparedSceneKeyframeAsset, "fingerprint">): string {
  return sha256CanonicalIntegrityHash({ kind: AI_STORY_PREPARED_SCENE_FRAME_CONTRACT_VERSION, asset });
}

export function isPreparedSceneKeyframeIntegrityValid(asset: PreparedSceneKeyframeAsset): boolean {
  const { fingerprint: _fingerprint, ...body } = asset;
  return assetFingerprint(body) === asset.fingerprint;
}

export function promotePreparedSceneKeyframe(input: {
  asset: PreparedSceneKeyframeAsset;
  currentActiveAsset: PreparedSceneKeyframeAsset;
  currentPreparation: SceneInputPreparationAuthority;
}): ProviderReadySceneInputAuthority {
  if (
    !isPreparedSceneKeyframeIntegrityValid(input.asset)
    || input.asset.assetId !== input.currentActiveAsset.assetId
    || input.asset.supersessionState !== "ACTIVE"
    || !input.asset.providerReady
    || input.asset.qc.result !== "PASS"
    || input.asset.preparationAuthorityId !== input.currentPreparation.preparationAuthorityId
    || input.asset.preparationFingerprint !== input.currentPreparation.fingerprint
    || !isSceneInputPreparationIntegrityValid(input.currentPreparation)
  ) throw new Error("SCENE_KEYFRAME_PROVIDER_READY_PROMOTION_DENIED");
  const body = {
    contractVersion: AI_STORY_PROVIDER_READY_SCENE_INPUT_CONTRACT_VERSION,
    preparationAuthorityId: input.asset.preparationAuthorityId,
    preparationFingerprint: input.asset.preparationFingerprint,
    sourceKind: "PREPARED_DERIVATIVE" as const,
    assetId: input.asset.assetId,
    contentHash: input.asset.contentHash,
    providerMode: input.currentPreparation.provider.mode,
  };
  return { ...body, fingerprint: sha256CanonicalIntegrityHash({ kind: AI_STORY_PROVIDER_READY_SCENE_INPUT_CONTRACT_VERSION, authority: body }) };
}

function extension(mimeType: SceneKeyframeGenerationOutput["mimeType"]): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

/**
 * Executes exactly one generation and one QC evaluation. It never regenerates,
 * never calls a video Provider, and never falls back to the incompatible raw asset.
 */
export async function executeSceneKeyframePreparation(input: {
  brief: SceneKeyframeBrief;
  preparation: SceneInputPreparationAuthority;
  generator: SceneKeyframeGenerationAdapter;
  qcEvaluator: SceneKeyframeQcAdapter;
  repository: SceneKeyframeExecutionRepository;
  readReferenceBytes: (reference: SceneKeyframeReference) => Promise<Buffer>;
  paidExecutionAuthorization?: Readonly<{ authorized: true; authorizationId: string }>;
  now?: () => string;
  newAssetId?: () => string;
}): Promise<SceneKeyframeExecutionResult> {
  if (!isSceneKeyframeBriefIntegrityValid(input.brief)) return { status: "FAILED_CLOSED", code: "SCENE_KEYFRAME_BRIEF_INTEGRITY_INVALID" };
  if (
    !isSceneInputPreparationIntegrityValid(input.preparation)
    || input.preparation.decision !== "SCENE_PREPARATION_REQUIRED"
    || input.brief.preparationAuthorityId !== input.preparation.preparationAuthorityId
    || input.brief.preparationFingerprint !== input.preparation.fingerprint
  ) return { status: "FAILED_CLOSED", code: "SCENE_KEYFRAME_PREPARATION_AUTHORITY_INVALID" };
  if (!input.generator.referenceConditioned || !input.generator.narrativeCharacterComposition
    || !input.generator.possessionComposition || !input.generator.actionStartStateComposition) {
    return { status: "FAILED_CLOSED", code: "NARRATIVE_SCENE_KEYFRAME_GENERATOR_CAPABILITY_REQUIRED" };
  }
  const identity = executionIdentity(input.brief, input.generator, input.qcEvaluator);
  const prior = await input.repository.findByExecutionIdentity(identity, input.brief.SCENE_IDENTITY);
  if (prior) {
    if (prior.supersessionState !== "ACTIVE") return { status: "FAILED_CLOSED", code: "SCENE_KEYFRAME_IDEMPOTENT_OUTPUT_SUPERSEDED" };
    if (prior.providerReady) {
      const providerInput = promotePreparedSceneKeyframe({ asset: prior, currentActiveAsset: prior, currentPreparation: input.preparation });
      return { status: "READY", asset: prior, providerInput, reused: true };
    }
    return { status: "NEEDS_REVIEW", asset: prior, reused: true };
  }
  if ((input.generator.externalPaidCall || input.qcEvaluator.externalPaidCall) && !input.paidExecutionAuthorization?.authorized) {
    return {
      status: "AUTHORIZATION_REQUIRED",
      code: "LIVE_KEYFRAME_IMAGE_GENERATION_AUTHORIZATION_REQUIRED",
      provider: input.generator.providerId,
      model: input.generator.modelId,
      estimatedCallCount: 1 + Number(input.qcEvaluator.externalPaidCall),
      exactScene: input.brief.SCENE_IDENTITY,
    };
  }
  try {
    const references = await Promise.all(input.brief.SOURCE_ASSET_REFERENCES.map(async (reference) => {
      const bytes = await input.readReferenceBytes(reference);
      if (bytes.length === 0) throw new Error("SCENE_KEYFRAME_REFERENCE_BYTES_EMPTY");
      if (outputHash(bytes) !== reference.contentHash) throw new Error("SCENE_KEYFRAME_REFERENCE_CONTENT_HASH_MISMATCH");
      return { reference, bytes };
    }));
    const generated = await input.generator.generate({
      brief: input.brief,
      prompt: sceneKeyframePrompt(input.brief),
      references,
      idempotencyKey: identity,
    });
    if (generated.bytes.length === 0) throw new Error("SCENE_KEYFRAME_GENERATOR_OUTPUT_EMPTY");
    if (!imageBytesMatchMime(generated.bytes, generated.mimeType)) throw new Error("SCENE_KEYFRAME_GENERATOR_OUTPUT_INVALID");
    const report = createSceneKeyframeQcReport(await input.qcEvaluator.evaluate({ brief: input.brief, generated, references }));
    const active = await input.repository.findActiveForScene(input.brief.SCENE_IDENTITY);
    const assetId = input.newAssetId?.() ?? randomUUID();
    if (assetId === input.preparation.sourceRawAssetId) throw new Error("PREPARED_SCENE_FRAME_OUTPUT_INVALID");
    const contentHash = outputHash(generated.bytes);
    const body: Omit<PreparedSceneKeyframeAsset, "fingerprint"> = {
      contractVersion: AI_STORY_PREPARED_SCENE_FRAME_CONTRACT_VERSION,
      executionContractVersion: AI_STORY_SCENE_KEYFRAME_EXECUTION_VERSION,
      assetId,
      contentHash,
      mimeType: generated.mimeType,
      storagePath: `${input.brief.SCENE_IDENTITY.workspaceId}/ai-story/${input.brief.SCENE_IDENTITY.storyId}/scenes/${input.brief.SCENE_IDENTITY.sceneId}/prepared/${assetId}.${extension(generated.mimeType)}`,
      scope: input.brief.SCENE_IDENTITY,
      sourceRawAssetId: input.preparation.sourceRawAssetId,
      sourceRawAssetContentHash: input.preparation.sourceRawAssetContentHash,
      activeIntentIdentity: input.brief.activeIntentIdentity,
      narrativeWorldStateIdentity: input.brief.narrativeWorldStateIdentity,
      preparationAuthorityId: input.preparation.preparationAuthorityId,
      preparationFingerprint: input.preparation.fingerprint,
      keyframeBriefFingerprint: input.brief.fingerprint,
      generationIdentity: {
        providerId: input.generator.providerId,
        modelId: input.generator.modelId,
        adapterVersion: input.generator.adapterVersion,
        providerRequestId: generated.providerRequestId,
      },
      qc: report,
      providerReady: report.result === "PASS",
      supersessionState: "ACTIVE",
      supersedesAssetId: active?.assetId ?? null,
      executionIdentity: identity,
      createdAt: input.now?.() ?? new Date().toISOString(),
    };
    const asset = await input.repository.commitPreparedAsset({
      asset: { ...body, fingerprint: assetFingerprint(body) },
      bytes: generated.bytes,
      expectedActiveAssetId: active?.assetId ?? null,
    });
    if (!isPreparedSceneKeyframeIntegrityValid(asset)) throw new Error("PREPARED_SCENE_KEYFRAME_PERSISTENCE_INTEGRITY_INVALID");
    if (!asset.providerReady) return { status: "NEEDS_REVIEW", asset, reused: false };
    const providerInput = promotePreparedSceneKeyframe({ asset, currentActiveAsset: asset, currentPreparation: input.preparation });
    return { status: "READY", asset, providerInput, reused: false };
  } catch (error) {
    return { status: "FAILED_CLOSED", code: error instanceof Error ? error.message : "SCENE_KEYFRAME_PREPARATION_FAILED" };
  }
}

export function sceneKeyframeUserState(result: SceneKeyframeExecutionResult): "SCENE_VISUAL_READY" | "NEEDS_YOUR_REVIEW" | "PREPARING_SCENE" {
  if (result.status === "READY") return "SCENE_VISUAL_READY";
  if (result.status === "NEEDS_REVIEW" || result.status === "FAILED_CLOSED") return "NEEDS_YOUR_REVIEW";
  return "PREPARING_SCENE";
}
