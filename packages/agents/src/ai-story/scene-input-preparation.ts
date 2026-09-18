import { sha256CanonicalIntegrityHash } from "@ceo-agent/shared/server";
import type { ResolvedActiveSceneIntent, NarrativeWorldState } from "./active-intent-world-state";

export const AI_STORY_SCENE_INPUT_PREPARATION_CONTRACT_VERSION = "ai-story-scene-input-preparation.v1" as const;
export const AI_STORY_PREPARED_SCENE_FRAME_CONTRACT_VERSION = "ai-story-prepared-scene-frame.v1" as const;
export const AI_STORY_PROVIDER_READY_SCENE_INPUT_CONTRACT_VERSION = "ai-story-provider-ready-scene-input.v1" as const;

export const AI_STORY_SCENE_INPUT_DECISIONS = [
  "DIRECT_USE",
  "SCENE_PREPARATION_REQUIRED",
  "UNUSABLE_FOR_SCENE",
] as const;

export type SceneInputDecision = (typeof AI_STORY_SCENE_INPUT_DECISIONS)[number];
export type SceneInputCompatibility = "COMPATIBLE" | "CONFLICTING" | "UNKNOWN" | "NOT_APPLICABLE";
export type SceneInputPreparationReason =
  | "RAW_ENVIRONMENT_CONFLICTS_WITH_ACTIVE_SCENE"
  | "RAW_ENVIRONMENT_UNKNOWN_FOR_ANCHORED_MODE"
  | "RAW_ACTION_CONFLICTS_WITH_ACTIVE_SCENE"
  | "RAW_COMPOSITION_CONFLICTS_WITH_ACTIVE_SCENE"
  | "REQUIRED_CHARACTER_PRESENCE_MISSING"
  | "PRODUCT_POSSESSION_START_STATE_CONFLICT"
  | "SUBJECT_IDENTITY_INSUFFICIENT"
  | "SUBJECT_IDENTITY_CONFLICT"
  | "UNSUPPORTED_RAW_ASSET"
  | "PROVIDER_MODE_DOES_NOT_ACCEPT_SCENE_FRAME";

export type RawBusinessAssetSceneAnalysis = {
  readonly assetId: string;
  readonly workspaceId: string;
  readonly contentHash: string;
  readonly mimeType: string;
  readonly identityCompatibility: "VERIFIED" | "INSUFFICIENT" | "CONFLICTING";
  readonly identityFacts: readonly string[];
  readonly environment: {
    readonly classification: "LOCATION_BOUND" | "NEUTRAL" | "UNKNOWN";
    readonly locationId: string | null;
    readonly label: string | null;
    readonly facts: readonly string[];
  };
  readonly compositionCompatibility: Exclude<SceneInputCompatibility, "NOT_APPLICABLE">;
  readonly actionCompatibility: Exclude<SceneInputCompatibility, "NOT_APPLICABLE">;
  readonly charactersPresent: readonly string[];
  readonly possessions: readonly { readonly objectId: string; readonly holder: string }[];
};

export type SceneInputProviderCapability = {
  readonly providerId: "seedance";
  readonly modelId: "dreamina-seedance-2-0-260128";
  readonly mode: "TEXT_TO_VIDEO" | "FIRST_FRAME_IMAGE_TO_VIDEO";
  readonly acceptsSceneFrame: boolean;
  readonly stronglyAnchorsToSceneFrame: boolean;
  readonly capabilityContractVersion: string;
};

export const SEEDANCE_FIRST_FRAME_SCENE_INPUT_CAPABILITY: SceneInputProviderCapability = Object.freeze({
  providerId: "seedance",
  modelId: "dreamina-seedance-2-0-260128",
  mode: "FIRST_FRAME_IMAGE_TO_VIDEO",
  acceptsSceneFrame: true,
  stronglyAnchorsToSceneFrame: true,
  capabilityContractVersion: "seedance-modelark-2026-08-29.v1",
});

export const SEEDANCE_TEXT_TO_VIDEO_SCENE_INPUT_CAPABILITY: SceneInputProviderCapability = Object.freeze({
  ...SEEDANCE_FIRST_FRAME_SCENE_INPUT_CAPABILITY,
  mode: "TEXT_TO_VIDEO",
  acceptsSceneFrame: false,
  stronglyAnchorsToSceneFrame: false,
});

export type SceneInputPreparationAuthority = {
  readonly contractVersion: typeof AI_STORY_SCENE_INPUT_PREPARATION_CONTRACT_VERSION;
  readonly preparationAuthorityId: string;
  readonly version: number;
  readonly sceneId: string;
  readonly sceneVersionId: string;
  readonly retryAuthorityId: string | null;
  readonly activeIntentAuthorityId: string;
  readonly narrativeWorldStateIdentity: string;
  readonly sourceRawAssetId: string;
  readonly sourceRawAssetContentHash: string;
  readonly identityFactsToPreserve: readonly string[];
  readonly environmentFactsNotToInherit: readonly string[];
  readonly targetLocation: { readonly id: string; readonly label: string };
  readonly targetCharactersPresent: readonly string[];
  readonly targetPossessions: readonly { readonly objectId: string; readonly holder: string }[];
  readonly targetActions: readonly string[];
  readonly incomingTransition: NarrativeWorldState["incomingTransition"];
  readonly compatibility: {
    readonly rawLocation: SceneInputCompatibility;
    readonly subjectIdentity: SceneInputCompatibility;
    readonly composition: SceneInputCompatibility;
    readonly sceneAction: SceneInputCompatibility;
    readonly characterPresence: SceneInputCompatibility;
    readonly productPossession: SceneInputCompatibility;
    readonly providerMode: SceneInputCompatibility;
  };
  readonly decision: SceneInputDecision;
  readonly reasons: readonly SceneInputPreparationReason[];
  readonly provider: SceneInputProviderCapability;
  readonly supersedesPreparationAuthorityId: string | null;
  readonly createdAt: string;
  readonly fingerprint: string;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function canonicalHash(value: unknown): string {
  return sha256CanonicalIntegrityHash(value);
}

function preparationFingerprint(
  authority: Omit<SceneInputPreparationAuthority, "fingerprint">
): string {
  return canonicalHash({ kind: AI_STORY_SCENE_INPUT_PREPARATION_CONTRACT_VERSION, authority });
}

export function isSceneInputPreparationIntegrityValid(authority: SceneInputPreparationAuthority): boolean {
  const { fingerprint: _fingerprint, ...withoutFingerprint } = authority;
  return preparationFingerprint(withoutFingerprint) === authority.fingerprint;
}

export function narrativeWorldStateIdentity(worldState: NarrativeWorldState): string {
  return canonicalHash({ kind: worldState.contractVersion, worldState });
}

function isCanonicalImageAsset(asset: RawBusinessAssetSceneAnalysis): boolean {
  return /^image\/(?:jpeg|jpg|png|webp)$/i.test(asset.mimeType)
    && /^sha256:[0-9a-f]{64}$/.test(asset.contentHash);
}

function possessionCompatible(
  required: readonly { readonly objectId: string; readonly holder: string }[],
  observed: readonly { readonly objectId: string; readonly holder: string }[]
): boolean {
  const observedByObject = new Map(observed.map((fact) => [fact.objectId, fact.holder]));
  return required.every((fact) => observedByObject.get(fact.objectId) === fact.holder);
}

export function createSceneInputPreparationAuthority(input: {
  readonly preparationAuthorityId: string;
  readonly version: number;
  readonly sceneId: string;
  readonly sceneVersionId: string;
  readonly retryAuthorityId?: string | null;
  readonly activeIntentAuthorityId: string;
  readonly activeIntent: ResolvedActiveSceneIntent;
  readonly worldState: NarrativeWorldState;
  readonly rawAsset: RawBusinessAssetSceneAnalysis;
  readonly provider: SceneInputProviderCapability;
  readonly supersedesPreparationAuthorityId?: string | null;
  readonly createdAt: string;
}): SceneInputPreparationAuthority {
  const intentCharacters = [...new Set(input.activeIntent.charactersPresent)].sort();
  const worldCharacters = [...new Set(input.worldState.charactersPresent)].sort();
  const intentPossessions = [...input.activeIntent.possessions].sort((left, right) => left.objectId.localeCompare(right.objectId));
  const worldPossessions = [...input.worldState.possessions].sort((left, right) => left.objectId.localeCompare(right.objectId));
  if (
    input.worldState.sceneId !== input.sceneId
    || input.activeIntent.location.id !== input.worldState.currentLocation.id
    || JSON.stringify(intentCharacters) !== JSON.stringify(worldCharacters)
    || JSON.stringify(intentPossessions) !== JSON.stringify(worldPossessions)
    || !input.activeIntent.sources.some((source) =>
      source.authorityId === input.activeIntentAuthorityId && source.classification === "ACTIVE"
    )
  ) {
    throw new Error("SCENE_INPUT_PREPARATION_ACTIVE_AUTHORITY_CONFLICT");
  }
  const reasons: SceneInputPreparationReason[] = [];
  const rawAssetSupported = isCanonicalImageAsset(input.rawAsset);
  if (!rawAssetSupported) reasons.push("UNSUPPORTED_RAW_ASSET");

  const identity: SceneInputCompatibility = input.rawAsset.identityCompatibility === "VERIFIED"
    ? "COMPATIBLE"
    : input.rawAsset.identityCompatibility === "INSUFFICIENT"
      ? "UNKNOWN"
      : "CONFLICTING";
  if (input.rawAsset.identityCompatibility === "INSUFFICIENT") reasons.push("SUBJECT_IDENTITY_INSUFFICIENT");
  if (input.rawAsset.identityCompatibility === "CONFLICTING") reasons.push("SUBJECT_IDENTITY_CONFLICT");

  const rawLocation: SceneInputCompatibility = input.rawAsset.environment.classification === "NEUTRAL"
    ? "COMPATIBLE"
    : input.rawAsset.environment.classification === "UNKNOWN"
      ? "UNKNOWN"
      : input.rawAsset.environment.locationId === input.worldState.currentLocation.id
        ? "COMPATIBLE"
        : "CONFLICTING";
  if (rawLocation === "CONFLICTING") reasons.push("RAW_ENVIRONMENT_CONFLICTS_WITH_ACTIVE_SCENE");
  if (rawLocation === "UNKNOWN" && input.provider.stronglyAnchorsToSceneFrame) reasons.push("RAW_ENVIRONMENT_UNKNOWN_FOR_ANCHORED_MODE");

  const sceneAction = input.rawAsset.actionCompatibility;
  if (sceneAction !== "COMPATIBLE") reasons.push("RAW_ACTION_CONFLICTS_WITH_ACTIVE_SCENE");
  const composition = input.rawAsset.compositionCompatibility;
  if (composition !== "COMPATIBLE") reasons.push("RAW_COMPOSITION_CONFLICTS_WITH_ACTIVE_SCENE");

  const observedCharacters = new Set(input.rawAsset.charactersPresent);
  const characterPresence: SceneInputCompatibility = input.activeIntent.charactersPresent.every((id) => observedCharacters.has(id))
    ? "COMPATIBLE"
    : "CONFLICTING";
  if (characterPresence === "CONFLICTING") reasons.push("REQUIRED_CHARACTER_PRESENCE_MISSING");

  const productPossession: SceneInputCompatibility = possessionCompatible(
    input.activeIntent.possessions,
    input.rawAsset.possessions
  ) ? "COMPATIBLE" : "CONFLICTING";
  if (productPossession === "CONFLICTING") reasons.push("PRODUCT_POSSESSION_START_STATE_CONFLICT");

  const providerMode: SceneInputCompatibility = input.provider.acceptsSceneFrame ? "COMPATIBLE" : "NOT_APPLICABLE";
  if (!input.provider.acceptsSceneFrame) reasons.push("PROVIDER_MODE_DOES_NOT_ACCEPT_SCENE_FRAME");

  const unusable = !rawAssetSupported || identity !== "COMPATIBLE" || !input.provider.acceptsSceneFrame;
  const decision: SceneInputDecision = unusable
    ? "UNUSABLE_FOR_SCENE"
    : reasons.length > 0
      ? "SCENE_PREPARATION_REQUIRED"
      : "DIRECT_USE";
  const withoutFingerprint: Omit<SceneInputPreparationAuthority, "fingerprint"> = {
    contractVersion: AI_STORY_SCENE_INPUT_PREPARATION_CONTRACT_VERSION,
    preparationAuthorityId: input.preparationAuthorityId,
    version: input.version,
    sceneId: input.sceneId,
    sceneVersionId: input.sceneVersionId,
    retryAuthorityId: input.retryAuthorityId ?? null,
    activeIntentAuthorityId: input.activeIntentAuthorityId,
    narrativeWorldStateIdentity: narrativeWorldStateIdentity(input.worldState),
    sourceRawAssetId: input.rawAsset.assetId,
    sourceRawAssetContentHash: input.rawAsset.contentHash,
    identityFactsToPreserve: unique(input.rawAsset.identityFacts),
    environmentFactsNotToInherit: rawLocation === "COMPATIBLE" ? [] : unique(input.rawAsset.environment.facts),
    targetLocation: input.worldState.currentLocation,
    targetCharactersPresent: unique(input.worldState.charactersPresent),
    targetPossessions: input.worldState.possessions,
    targetActions: unique(input.activeIntent.actions),
    incomingTransition: input.worldState.incomingTransition,
    compatibility: {
      rawLocation,
      subjectIdentity: identity,
      composition,
      sceneAction,
      characterPresence,
      productPossession,
      providerMode,
    },
    decision,
    reasons: [...new Set(reasons)],
    provider: input.provider,
    supersedesPreparationAuthorityId: input.supersedesPreparationAuthorityId ?? null,
    createdAt: input.createdAt,
  };
  return { ...withoutFingerprint, fingerprint: preparationFingerprint(withoutFingerprint) };
}

export function selectActiveSceneInputPreparation(input: {
  readonly authorities: readonly SceneInputPreparationAuthority[];
  readonly sceneId: string;
  readonly sceneVersionId: string;
  readonly activeIntentAuthorityId: string;
  readonly narrativeWorldStateIdentity: string;
}): {
  readonly active: SceneInputPreparationAuthority;
  readonly historical: readonly SceneInputPreparationAuthority[];
} {
  const valid = input.authorities.filter(isSceneInputPreparationIntegrityValid);
  const matching = valid
    .filter((authority) =>
      authority.sceneId === input.sceneId
      && authority.sceneVersionId === input.sceneVersionId
      && authority.activeIntentAuthorityId === input.activeIntentAuthorityId
      && authority.narrativeWorldStateIdentity === input.narrativeWorldStateIdentity
    )
    .sort((left, right) => right.version - left.version || left.preparationAuthorityId.localeCompare(right.preparationAuthorityId));
  const active = matching[0];
  if (!active) throw new Error("CURRENT_SCENE_INPUT_PREPARATION_AUTHORITY_MISSING");
  if (matching[1]?.version === active.version) throw new Error("CURRENT_SCENE_INPUT_PREPARATION_AUTHORITY_CONFLICT");
  return { active, historical: valid.filter((authority) => authority.preparationAuthorityId !== active.preparationAuthorityId) };
}

export function isSceneInputPreparationExecutable(input: {
  readonly authority: SceneInputPreparationAuthority;
  readonly currentAuthority: SceneInputPreparationAuthority;
}): boolean {
  return input.authority.preparationAuthorityId === input.currentAuthority.preparationAuthorityId
    && isSceneInputPreparationIntegrityValid(input.authority)
    && (input.authority.decision === "DIRECT_USE" || input.authority.decision === "SCENE_PREPARATION_REQUIRED");
}

export const AI_STORY_PREPARED_SCENE_FRAME_QC_GATES = [
  "SUBJECT_IDENTITY",
  "CURRENT_LOCATION",
  "REQUIRED_CHARACTER_PRESENCE",
  "PRODUCT_POSSESSION",
  "REQUIRED_ACTION_START_STATE",
  "HISTORICAL_ENVIRONMENT_ABSENT",
] as const;

export type PreparedSceneFrameAuthority = {
  readonly contractVersion: typeof AI_STORY_PREPARED_SCENE_FRAME_CONTRACT_VERSION;
  readonly preparationAuthorityId: string;
  readonly preparationFingerprint: string;
  readonly outputAssetId: string;
  readonly outputContentHash: string;
  readonly sourceRawAssetId: string;
  readonly qc: readonly { readonly gate: (typeof AI_STORY_PREPARED_SCENE_FRAME_QC_GATES)[number]; readonly result: "PASS" | "FAIL" }[];
  readonly providerReady: boolean;
  readonly fingerprint: string;
};

export function certifyPreparedSceneFrame(input: {
  readonly preparation: SceneInputPreparationAuthority;
  readonly outputAssetId: string;
  readonly outputContentHash: string;
  readonly evidence: {
    readonly subjectIdentity: boolean;
    readonly currentLocation: boolean;
    readonly requiredCharacterPresence: boolean;
    readonly productPossession: boolean;
    readonly requiredActionStartState: boolean;
    readonly historicalEnvironmentAbsent: boolean;
  };
}): PreparedSceneFrameAuthority {
  if (!isSceneInputPreparationIntegrityValid(input.preparation)) throw new Error("SCENE_INPUT_PREPARATION_INTEGRITY_INVALID");
  if (input.preparation.decision !== "SCENE_PREPARATION_REQUIRED") throw new Error("SCENE_INPUT_PREPARATION_NOT_REQUIRED");
  if (input.outputAssetId === input.preparation.sourceRawAssetId || !/^sha256:[0-9a-f]{64}$/.test(input.outputContentHash)) {
    throw new Error("PREPARED_SCENE_FRAME_OUTPUT_INVALID");
  }
  const qc = AI_STORY_PREPARED_SCENE_FRAME_QC_GATES.map((gate) => {
    const key = ({
      SUBJECT_IDENTITY: "subjectIdentity",
      CURRENT_LOCATION: "currentLocation",
      REQUIRED_CHARACTER_PRESENCE: "requiredCharacterPresence",
      PRODUCT_POSSESSION: "productPossession",
      REQUIRED_ACTION_START_STATE: "requiredActionStartState",
      HISTORICAL_ENVIRONMENT_ABSENT: "historicalEnvironmentAbsent",
    } as const)[gate];
    return { gate, result: input.evidence[key] ? "PASS" as const : "FAIL" as const };
  });
  const withoutFingerprint = {
    contractVersion: AI_STORY_PREPARED_SCENE_FRAME_CONTRACT_VERSION,
    preparationAuthorityId: input.preparation.preparationAuthorityId,
    preparationFingerprint: input.preparation.fingerprint,
    outputAssetId: input.outputAssetId,
    outputContentHash: input.outputContentHash,
    sourceRawAssetId: input.preparation.sourceRawAssetId,
    qc,
    providerReady: qc.every((gate) => gate.result === "PASS"),
  };
  return { ...withoutFingerprint, fingerprint: canonicalHash({ kind: AI_STORY_PREPARED_SCENE_FRAME_CONTRACT_VERSION, authority: withoutFingerprint }) };
}

export function isPreparedSceneFrameIntegrityValid(authority: PreparedSceneFrameAuthority): boolean {
  const { fingerprint: _fingerprint, ...withoutFingerprint } = authority;
  return canonicalHash({ kind: AI_STORY_PREPARED_SCENE_FRAME_CONTRACT_VERSION, authority: withoutFingerprint }) === authority.fingerprint;
}

export type ProviderReadySceneInputAuthority = {
  readonly contractVersion: typeof AI_STORY_PROVIDER_READY_SCENE_INPUT_CONTRACT_VERSION;
  readonly preparationAuthorityId: string;
  readonly preparationFingerprint: string;
  readonly sourceKind: "RAW_DIRECT" | "PREPARED_DERIVATIVE";
  readonly assetId: string;
  readonly contentHash: string;
  readonly providerMode: SceneInputProviderCapability["mode"];
  readonly fingerprint: string;
};

/**
 * The only conversion from business asset/preparation evidence to an input
 * that may be emitted on the Provider wire. A preparation-required decision
 * can never fall back to the raw source.
 */
export function resolveProviderReadySceneInput(input: {
  readonly preparation: SceneInputPreparationAuthority;
  readonly preparedFrame?: PreparedSceneFrameAuthority | null;
}): ProviderReadySceneInputAuthority {
  if (!isSceneInputPreparationIntegrityValid(input.preparation)) throw new Error("SCENE_INPUT_PREPARATION_INTEGRITY_INVALID");
  if (input.preparation.decision === "UNUSABLE_FOR_SCENE") throw new Error("SCENE_INPUT_UNUSABLE_FOR_PROVIDER");
  let sourceKind: ProviderReadySceneInputAuthority["sourceKind"];
  let assetId: string;
  let contentHash: string;
  if (input.preparation.decision === "DIRECT_USE") {
    sourceKind = "RAW_DIRECT";
    assetId = input.preparation.sourceRawAssetId;
    contentHash = input.preparation.sourceRawAssetContentHash;
  } else {
    const prepared = input.preparedFrame;
    if (
      !prepared
      || !prepared.providerReady
      || prepared.preparationAuthorityId !== input.preparation.preparationAuthorityId
      || prepared.preparationFingerprint !== input.preparation.fingerprint
      || !isPreparedSceneFrameIntegrityValid(prepared)
    ) throw new Error("PROVIDER_READY_SCENE_INPUT_REQUIRED");
    sourceKind = "PREPARED_DERIVATIVE";
    assetId = prepared.outputAssetId;
    contentHash = prepared.outputContentHash;
  }
  const withoutFingerprint = {
    contractVersion: AI_STORY_PROVIDER_READY_SCENE_INPUT_CONTRACT_VERSION,
    preparationAuthorityId: input.preparation.preparationAuthorityId,
    preparationFingerprint: input.preparation.fingerprint,
    sourceKind,
    assetId,
    contentHash,
    providerMode: input.preparation.provider.mode,
  };
  return { ...withoutFingerprint, fingerprint: canonicalHash({ kind: AI_STORY_PROVIDER_READY_SCENE_INPUT_CONTRACT_VERSION, authority: withoutFingerprint }) };
}

export function sceneInputPreparationUserState(decision: SceneInputDecision): "SCENE_VISUAL_READY" | "PREPARING_SCENE" | "SCENE_INPUT_UNAVAILABLE" {
  if (decision === "DIRECT_USE") return "SCENE_VISUAL_READY";
  if (decision === "SCENE_PREPARATION_REQUIRED") return "PREPARING_SCENE";
  return "SCENE_INPUT_UNAVAILABLE";
}

export const AI_STORY_EXISTING_SCENE_PREPARATION_CAPABILITY = Object.freeze({
  backgroundRemoval: "PHOTO_SCENE_PRODUCT_EXTRACTION",
  deterministicComposition: "PHOTO_SCENE_OFFICIAL_SCENE_COMPOSITION",
  reusableComponents: true,
  supportsNarrativeCharacterActionKeyframes: false,
  reusableAsCompleteScenePreparation: false,
  missingCapability: "SCENE_KEYFRAME_PREPARATION_EXECUTION_CAPABILITY_REQUIRED",
} as const);
