import type { AiStoryLocalGenerationPackage } from "@ceo-agent/shared";
import {
  LocalGpuContractError,
  assertLocalGpuDispatchWorkflow,
  assertLocalGpuSubmitAllowed,
  buildLocalGpuDesktopSubmit,
  buildLocalGpuDesktopSubmitV2,
  localGpuCanonicalCreativeJob,
  localGpuCreativeBindingDigest,
  localGpuUploadBindingDigest,
  mapLocalGpuAudioPolicy,
  serializeLocalGpuH3Prompt,
  type LocalGpuAudioPolicy,
  type LocalGpuDesktopSubmitBody,
  type LocalGpuEnvironment,
  type LocalGpuUploadDestination,
  type LocalGpuV2FirstFrameAuthorityType,
  type LocalGpuV2FirstFrameLineage,
} from "@ceo-agent/shared/server";

/**
 * Desktop POST /v1/jobs as recorded in the certified worker fixture:
 * workflow MINIMAX_H3_R2V, 1–2 references, roles CHARACTER | PRODUCT | STYLE | OTHER.
 * The attested body has no firstFrame, dialogue list, or voiceDna field.
 * The Desktop repository was not available on this machine, so this mapper
 * does not invent those fields.
 */
export const LOCAL_GPU_DESKTOP_ATTESTED_WORKFLOW = "MINIMAX_H3_R2V" as const;

export type LocalGpuAudioExpectation =
  | "PRESERVE_SOURCE_AUDIO"
  | "NATIVE_CHARACTER_DIALOGUE"
  | "NO_DIALOGUE_WITH_AMBIENT_AUDIO"
  | "SILENT_OUTPUT"
  | "TTS_SPEECH"
  | "FINAL_AUDIO_MIX";

export type LocalGpuResolvedAsset = {
  assetId: string;
  contentHash: string;
  workspaceId: string;
  assetUrl: string;
};

export type LocalGpuNativeDialogueV3Transport = {
  body: Record<string, unknown> & {
    contractVersion: 3;
    environment: LocalGpuEnvironment;
    jobId: string;
    sceneExecutionId: string;
    workspaceId: string;
    workflow: "MINIMAX_H3_NATIVE_DIALOGUE";
    upload: LocalGpuUploadDestination;
  };
  creativeBinding: string;
  uploadBinding: string;
};

export type LocalGpuPackageTransport = {
  dispatch: false;
  submit: false;
  automaticGenerationRetry: 0;
  remoteProviderFallback: 0;
  audioExpectation: LocalGpuAudioExpectation;
  audioPolicy: LocalGpuAudioPolicy;
  desktop: LocalGpuDesktopSubmitBody;
  /** Text carried inside the single Desktop prompt. The worker contract does not enforce these as fields. */
  promptOnlyRequirements: readonly string[];
  deterministicPromptEnforcement: false;
};

type PackageReference = {
  assetId: string;
  contentHash: string;
  kind: string;
  authorityId: string | null;
};

function fail(code: string): never {
  throw new LocalGpuContractError(code);
}

function referencesOf(pkg: AiStoryLocalGenerationPackage): PackageReference[] {
  if (pkg.version === "local-generation-package.v3") {
    return pkg.references.map((reference) => ({
      assetId: reference.assetId,
      contentHash: reference.contentHash,
      kind: reference.role,
      authorityId: reference.authorityId,
    }));
  }
  return pkg.references.map((reference) => ({
    assetId: reference.assetId,
    contentHash: reference.contentHash,
    kind: reference.authorityType,
    authorityId: reference.authorityId,
  }));
}

function visualStart(pkg: AiStoryLocalGenerationPackage): { sourceType: string; assetId?: string; contentHash?: string } {
  if (pkg.version === "local-generation-package.v3") return pkg.visualStartAuthority;
  return { sourceType: "NONE" };
}

function productVisual(pkg: AiStoryLocalGenerationPackage): {
  image: { assetId: string; contentHash: string } | null;
  variant: string | null;
} {
  const product = pkg.productAuthority;
  if (!product) return { image: null, variant: null };
  if ("selection" in product && product.selection === "NO_PRODUCT_VISUAL_INPUT") {
    return { image: null, variant: product.confirmedVariant };
  }
  if ("selectedMaterialAssetId" in product && product.selectedMaterialAssetId && product.selectedMaterialContentHash) {
    return {
      image: { assetId: product.selectedMaterialAssetId, contentHash: product.selectedMaterialContentHash },
      variant: product.confirmedVariant,
    };
  }
  return { image: { assetId: product.assetId, contentHash: product.contentHash }, variant: product.confirmedVariant };
}

function expectationFor(pkg: AiStoryLocalGenerationPackage, requested?: LocalGpuAudioExpectation | null): LocalGpuAudioExpectation {
  const derived: LocalGpuAudioExpectation = pkg.generateAudio && !pkg.audioBlocked
    ? "NO_DIALOGUE_WITH_AMBIENT_AUDIO"
    : "SILENT_OUTPUT";
  if (requested && requested !== derived) fail("LOCAL_GPU_AUDIO_POLICY_INVALID");
  return requested ?? derived;
}

function flatten(value: string): string {
  return value.replace(/[\r\n]+/g, " | ").replace(/\s+/g, " ").trim();
}

export function serializeCanonicalPackageForH3(pkg: AiStoryLocalGenerationPackage): string {
  const requirements = pkg.qcRequirements ?? [];
  const actionProgression = requirements
    .filter((item) => item.dimension === "ACTION_COMPLETION" || item.dimension === "MOTION_EXECUTION")
    .map((item) => item.summary);
  const objectInteractions = requirements
    .filter((item) => item.dimension === "REQUIRED_EVIDENCE")
    .map((item) => item.summary);
  const cameraGuidance = requirements
    .filter((item) => item.dimension === "DIRECTOR_EXECUTION" || item.dimension === "CINEMATIC_PROGRESSION")
    .map((item) => item.summary);
  return serializeLocalGpuH3Prompt({
    prompt: flatten(pkg.prompt),
    facts: {
      sceneContext: [pkg.worldDescription],
      characterIdentity: pkg.characterAuthority ? ["Preserve the authorized Character identity from the CHARACTER reference throughout the clip."] : [],
      productIdentity: pkg.productAuthority
        ? ["Preserve the authorized Product identity from the PRODUCT reference throughout the clip.", pkg.productAuthority.confirmedVariant ?? ""]
        : [],
      actionProgression,
      objectInteractions,
      cameraGuidance,
      startState: pkg.currentUnitStartState,
      endState: pkg.expectedEndState,
      continuity: pkg.continuityRequirements,
      mustKeep: pkg.mustKeep,
      mustAvoid: pkg.mustAvoid,
    },
  });
}

/** Contract V3 projection for approved visible dialogue. No dialogue text or reference is inferred. */
export function mapCanonicalPackageToLocalGpuNativeDialogueV3(input: {
  package: AiStoryLocalGenerationPackage;
  assets: readonly LocalGpuResolvedAsset[];
  environment: LocalGpuEnvironment;
  jobId: string;
  upload: LocalGpuUploadDestination;
  seed: number;
  megapixels?: number;
}): LocalGpuNativeDialogueV3Transport {
  const pkg = input.package;
  if (pkg.recommendedWorkflow !== "MINIMAX_H3_NATIVE_DIALOGUE" || pkg.dialogue.length === 0) {
    fail("LOCAL_GPU_NATIVE_DIALOGUE_AUTHORITY_REQUIRED");
  }
  if (!pkg.generateAudio || pkg.audioBlocked) fail("LOCAL_GPU_AUDIO_POLICY_INVALID");
  if (!pkg.characterAuthority) fail("LOCAL_GPU_CHARACTER_AUTHORITY_REQUIRED");
  if (pkg.dialogue.some((line) => line.offscreen || line.speakerCharacterId !== pkg.characterAuthority?.characterId)) {
    fail("LOCAL_GPU_NATIVE_DIALOGUE_SPEAKER_MISMATCH");
  }
  const references = referencesOf(pkg);
  const roleFor = (reference: PackageReference) => ["CHARACTER", "CHARACTER_IDENTITY"].includes(reference.kind)
    ? "CHARACTER" as const
    : ["PRODUCT", "PRODUCT_IDENTITY"].includes(reference.kind)
      ? "PRODUCT" as const
      : "SCENE" as const;
  const selected = references.filter((reference) => ["CHARACTER", "CHARACTER_IDENTITY", "PRODUCT", "PRODUCT_IDENTITY", "LOCATION", "LOCATION_CONTEXT", "SCENE"].includes(reference.kind));
  if (selected.length < 1 || selected.length > 3 || selected.length !== references.length) {
    fail(selected.length > 3 ? "LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS" : "LOCAL_GPU_REFERENCES_REQUIRED");
  }
  const desktopReferences = selected.map((reference) => {
    const asset = resolveAsset(input.assets, pkg.workspaceId, reference.assetId, reference.contentHash);
    const role = roleFor(reference);
    return { approval: "APPROVED" as const, role, assetUrl: asset.assetUrl, contentHash: asset.contentHash };
  }).sort((left, right) => ["CHARACTER", "PRODUCT", "SCENE"].indexOf(left.role) - ["CHARACTER", "PRODUCT", "SCENE"].indexOf(right.role));
  const characterReferences = desktopReferences.filter((reference) => reference.role === "CHARACTER")
    .map(({ role: _role, ...reference }) => reference);
  if (characterReferences.length === 0) fail("LOCAL_GPU_CHARACTER_REFERENCE_REQUIRED");
  const productReferences = desktopReferences.filter((reference) => reference.role === "PRODUCT")
    .map(({ role: _role, ...reference }) => reference);
  const sceneReferences = desktopReferences.filter((reference) => reference.role === "SCENE")
    .map(({ role: _role, ...reference }) => reference);
  const dialogue = pkg.dialogue.map((line) => ({
    speakerId: line.speakerCharacterId!,
    text: line.text,
    language: line.locale ?? "und",
  }));
  const creative = {
    characters: [{
      subjectId: pkg.characterAuthority.characterId,
      dnaVersion: pkg.characterAuthority.characterVersionId,
      dnaFingerprint: pkg.characterAuthority.dnaFingerprint,
      references: characterReferences,
    }],
    ...(pkg.productAuthority && productReferences.length > 0 ? { products: [{
      subjectId: "assetId" in pkg.productAuthority ? pkg.productAuthority.assetId : pkg.productAuthority.selectedMaterialAssetId,
      variantId: pkg.productAuthority.confirmedVariant ?? "approved-variant",
      references: productReferences,
    }] } : {}),
    ...(sceneReferences.length > 0 ? { scene: {
      subjectId: pkg.sceneExecutionId,
      references: sceneReferences,
    } } : {}),
    dialogue,
  };
  const body = {
    contractVersion: 3 as const,
    assetMode: "WITH_ASSET" as const,
    environment: input.environment,
    jobId: input.jobId,
    sceneExecutionId: pkg.sceneExecutionId,
    workspaceId: pkg.workspaceId,
    workflow: "MINIMAX_H3_NATIVE_DIALOGUE" as const,
    prompt: serializeCanonicalPackageForH3(pkg),
    durationSec: pkg.durationSec,
    durationSource: "RECOMMENDED_DURATION_AUTHORITY" as const,
    audioPolicy: "NATIVE" as const,
    aspectRatio: pkg.aspectRatio,
    megapixels: input.megapixels ?? 0.5,
    voiceInstructions: null,
    seed: input.seed,
    references: desktopReferences,
    firstFrame: null,
    audioReferences: null,
    videoReferences: null,
    dialogue,
    director: null,
    lastFrame: null,
    creative,
    upload: input.upload,
  };
  const canonical = localGpuCanonicalCreativeJob(body);
  return {
    body,
    creativeBinding: localGpuCreativeBindingDigest(canonical),
    uploadBinding: localGpuUploadBindingDigest(input.upload),
  };
}

function promptFor(pkg: AiStoryLocalGenerationPackage, variant: string | null): { prompt: string; promptOnlyRequirements: string[] } {
  const promptOnlyRequirements: string[] = [];
  const extras: string[] = [];
  const add = (label: string, lines: readonly string[]) => {
    const missing = lines.map((line) => line.trim()).filter((line) => line.length > 0 && !pkg.prompt.includes(line));
    if (missing.length === 0) return;
    promptOnlyRequirements.push(label);
    extras.push(`${label}: ${missing.join(" | ")}`);
  };
  add("MUST KEEP", pkg.mustKeep);
  add("MUST AVOID", pkg.mustAvoid);
  add("CONTINUITY", pkg.continuityRequirements);
  add("DIRECTOR AND MOTION", pkg.qcRequirements
    .filter((item) => item.dimension === "DIRECTOR_EXECUTION" || item.dimension === "MOTION_EXECUTION")
    .map((item) => item.summary));
  if (variant) add("PRODUCT VARIANT", [variant]);
  if (pkg.resolutionIntent) add("RESOLUTION INTENT", [pkg.resolutionIntent]);
  const prompt = flatten([pkg.prompt, ...extras].filter(Boolean).join(" | "));
  if (!prompt) fail("LOCAL_GPU_PROMPT_REQUIRED");
  return { prompt, promptOnlyRequirements };
}

function resolveAsset(
  assets: readonly LocalGpuResolvedAsset[],
  workspaceId: string,
  assetId: string,
  contentHash: string,
): LocalGpuResolvedAsset {
  // One stored asset may legitimately serve several roles (e.g. VISUAL_START and
  // PRODUCT_IDENTITY). Only conflicting resolutions of the same id are ambiguous.
  const matches = assets.filter((asset, index) => asset.assetId === assetId
    && assets.findIndex((other) => other.assetId === assetId
      && other.contentHash === asset.contentHash
      && other.workspaceId === asset.workspaceId) === index);
  if (matches.length !== 1) fail(matches.length === 0 ? "LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED" : "LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
  const asset = matches[0]!;
  if (asset.workspaceId !== workspaceId) fail("LOCAL_GPU_REFERENCE_WORKSPACE_MISMATCH");
  if (asset.contentHash !== contentHash) fail("LOCAL_GPU_REFERENCE_CONTENT_HASH_REQUIRED");
  return asset;
}

function oneReference(
  references: readonly PackageReference[],
  kinds: readonly string[],
  authorityId: string | null,
  missingCode: string,
): PackageReference {
  const matches = references.filter((reference) =>
    kinds.includes(reference.kind) && (authorityId === null || reference.authorityId === authorityId)
  );
  if (matches.length !== 1) fail(matches.length > 1 ? "LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS" : missingCode);
  return matches[0]!;
}

export function mapCanonicalPackageToLocalGpuDesktop(input: {
  package: AiStoryLocalGenerationPackage;
  assets: readonly LocalGpuResolvedAsset[];
  environment: LocalGpuEnvironment;
  jobId: string;
  upload: LocalGpuUploadDestination;
  audioExpectation?: LocalGpuAudioExpectation | null;
  pinnedVoiceDna?: { voiceDnaId: string } | null;
}): LocalGpuPackageTransport {
  const pkg = input.package;
  if (!pkg.sourceAuthority.preGenerationQcEvaluationId || !pkg.runtimeAuthorizationId) {
    fail("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
  }
  if (pkg.dialogue.length > 0 || pkg.recommendedWorkflow === "MINIMAX_H3_NATIVE_DIALOGUE") {
    fail("LOCAL_GPU_DISPATCH_DISABLED");
  }
  if (input.pinnedVoiceDna) fail("LOCAL_GPU_VOICE_DNA_UNSUPPORTED");
  assertLocalGpuDispatchWorkflow(pkg.recommendedWorkflow);
  const references = referencesOf(pkg);
  if (references.some((reference) => reference.kind === "LOCATION" || reference.kind === "LOCATION_CONTEXT")) {
    fail("LOCAL_GPU_LOCATION_REFERENCE_UNSUPPORTED");
  }
  const start = visualStart(pkg);
  if (
    start.sourceType === "INITIAL_MATERIAL"
    || start.sourceType === "PREDECESSOR_CONTINUITY"
    || references.some((reference) => reference.kind === "FIRST_FRAME" || reference.kind === "VISUAL_START")
  ) {
    fail("LOCAL_GPU_FRAME_TRANSPORT_UNSUPPORTED");
  }
  const selected: { role: "CHARACTER" | "PRODUCT"; reference: PackageReference }[] = [];
  if (pkg.characterAuthority) {
    selected.push({
      role: "CHARACTER",
      reference: oneReference(
        references,
        ["CHARACTER", "CHARACTER_IDENTITY"],
        pkg.characterAuthority.characterId,
        "LOCAL_GPU_CHARACTER_REFERENCE_REQUIRED",
      ),
    });
  }
  const product = productVisual(pkg);
  if (product.image) {
    const reference = oneReference(references, ["PRODUCT", "PRODUCT_IDENTITY"], null, "LOCAL_GPU_PRODUCT_REFERENCE_REQUIRED");
    if (reference.assetId !== product.image.assetId || reference.contentHash !== product.image.contentHash) {
      fail("LOCAL_GPU_REFERENCE_CONTENT_HASH_REQUIRED");
    }
    selected.push({ role: "PRODUCT", reference });
  }
  if (references.some((reference) => !selected.some((item) => item.reference === reference))) {
    fail("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
  }
  if (selected.length === 0 || selected.length > 2) fail(selected.length > 2 ? "LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS" : "LOCAL_GPU_REFERENCES_REQUIRED");
  const desktopReferences = selected.map((item) => {
    const asset = resolveAsset(input.assets, pkg.workspaceId, item.reference.assetId, item.reference.contentHash);
    return {
      approval: "APPROVED" as const,
      role: item.role,
      assetUrl: asset.assetUrl,
      contentHash: asset.contentHash,
    };
  });
  const audioExpectation = expectationFor(pkg, input.audioExpectation);
  const audioPolicy = mapLocalGpuAudioPolicy({
    generateAudio: pkg.generateAudio,
    audioBlocked: pkg.audioBlocked,
    expectationKind: audioExpectation,
  });
  const { prompt, promptOnlyRequirements } = promptFor(pkg, product.variant);
  const desktop = buildLocalGpuDesktopSubmit({
    environment: input.environment,
    jobId: input.jobId,
    sceneExecutionId: pkg.sceneExecutionId,
    workspaceId: pkg.workspaceId,
    workflow: pkg.recommendedWorkflow,
    prompt,
    plannedDurationMs: pkg.durationSec * 1000,
    references: desktopReferences,
    audioPolicy,
    upload: input.upload,
    aspectRatio: pkg.aspectRatio,
  }).body;
  return {
    dispatch: false,
    submit: false,
    automaticGenerationRetry: 0,
    remoteProviderFallback: 0,
    audioExpectation,
    audioPolicy,
    desktop,
    promptOnlyRequirements,
    deterministicPromptEnforcement: false,
  };
}

export function authorizeLocalGpuSequentialRelease(input: {
  package: AiStoryLocalGenerationPackage;
  expectedPackageFingerprint: string;
  existingGate: string | null;
  predecessor: null | {
    order: number;
    packageId: string;
    packageFingerprint: string;
    executionPlanId: string;
    workspaceId: string;
    storyVersionId: string;
    approved: boolean;
    failed: boolean;
    frameAssetId: string | null;
    frameContentHash: string | null;
    resultSourceKind: "LOCAL_GPU_WORKER" | "MANUAL_LOCAL";
  };
}): {
  eligible: true;
  dispatch: false;
  submit: false;
  executionMode: "LOCAL_GPU";
  automaticGenerationRetry: 0;
  remoteProviderFallback: 0;
  sceneOrder: number;
  successorOfPackageId: string | null;
} {
  const pkg = input.package;
  assertLocalGpuSubmitAllowed(input.existingGate);
  if (pkg.packageFingerprint !== input.expectedPackageFingerprint) fail("SEQUENTIAL_LOCAL_PREDECESSOR_SCOPE_MISMATCH");
  const predecessor = input.predecessor;
  if ((pkg.order === 1) !== (predecessor === null)) fail("SEQUENTIAL_LOCAL_PREDECESSOR_REQUIRED");
  if (predecessor) {
    if (predecessor.failed || !predecessor.approved) fail("SEQUENTIAL_LOCAL_PREDECESSOR_APPROVAL_REQUIRED");
    if (
      predecessor.order + 1 !== pkg.order
      || predecessor.executionPlanId !== pkg.executionPlanId
      || predecessor.workspaceId !== pkg.workspaceId
      || predecessor.storyVersionId !== pkg.storyVersionId
    ) {
      fail("SEQUENTIAL_LOCAL_PREDECESSOR_SCOPE_MISMATCH");
    }
    if (pkg.version === "local-generation-package.v3") {
      const start = pkg.visualStartAuthority;
      const semantic = pkg.predecessorAuthority?.semantic;
      if (!semantic || start.sourceType !== "PREDECESSOR_CONTINUITY") fail("SEQUENTIAL_LOCAL_CONTINUITY_FRAME_MISMATCH");
      if (
        semantic.predecessorPackageId !== predecessor.packageId
        || semantic.continuityFrameAssetId !== predecessor.frameAssetId
        || semantic.continuityFrameContentHash !== predecessor.frameContentHash
        || start.assetId !== predecessor.frameAssetId
        || start.contentHash !== predecessor.frameContentHash
      ) {
        fail("SEQUENTIAL_LOCAL_CONTINUITY_FRAME_MISMATCH");
      }
    } else {
      const frames = referencesOf(pkg).filter((reference) => reference.kind === "FIRST_FRAME");
      if (
        frames.length !== 1
        || frames[0]?.assetId !== predecessor.frameAssetId
        || frames[0]?.contentHash !== predecessor.frameContentHash
      ) {
        fail("SEQUENTIAL_LOCAL_CONTINUITY_FRAME_MISMATCH");
      }
    }
  }
  return {
    eligible: true,
    dispatch: false,
    submit: false,
    executionMode: "LOCAL_GPU",
    automaticGenerationRetry: 0,
    remoteProviderFallback: 0,
    sceneOrder: pkg.order,
    successorOfPackageId: predecessor?.packageId ?? null,
  };
}

function modelReferences(pkg: AiStoryLocalGenerationPackage): PackageReference[] {
  return referencesOf(pkg).filter((reference) => reference.kind !== "FIRST_FRAME" && reference.kind !== "VISUAL_START");
}

/** Persisted predecessor lineage for a continuity frame; any other start must match an approved reference. */
function firstFrameLineage(pkg: AiStoryLocalGenerationPackage): LocalGpuV2FirstFrameLineage | null {
  if (pkg.version !== "local-generation-package.v3") return null;
  const semantic = pkg.predecessorAuthority?.semantic;
  if (pkg.visualStartAuthority.sourceType !== "PREDECESSOR_CONTINUITY" || !semantic) return null;
  return {
    sourceType: "PREDECESSOR_CONTINUITY",
    sourceSceneId: semantic.predecessorSceneExecutionId,
    predecessorGenerationResultId: semantic.predecessorGenerationResultId,
    storyVersion: pkg.storyVersionId,
    executionPlanId: pkg.executionPlanId,
  };
}

export function mapCanonicalPackageToLocalGpuContractV2(input: {
  package: AiStoryLocalGenerationPackage;
  assets: readonly LocalGpuResolvedAsset[];
  environment: LocalGpuEnvironment;
  jobId: string;
  upload: LocalGpuUploadDestination;
  pinnedVoiceDna?: { voiceDnaId: string } | null;
  structuredCamera?: boolean;
  structuredMotion?: boolean;
  textOnly?: boolean;
  firstFrameAuthorities?: readonly LocalGpuV2FirstFrameAuthorityType[];
}): ReturnType<typeof buildLocalGpuDesktopSubmitV2> {
  const pkg = input.package;
  const references = referencesOf(pkg);
  if (references.some((reference) => reference.kind === "LOCATION" || reference.kind === "LOCATION_CONTEXT")) {
    fail("LOCAL_GPU_LOCATION_REFERENCE_UNSUPPORTED");
  }
  const start = visualStart(pkg);
  const frameReference = references.find((reference) => reference.kind === "FIRST_FRAME" || reference.kind === "VISUAL_START") ?? null;
  const authorityFrame = start.sourceType === "INITIAL_MATERIAL" || start.sourceType === "PREDECESSOR_CONTINUITY"
    ? { assetId: start.assetId ?? "", contentHash: start.contentHash ?? "" }
    : frameReference
      ? { assetId: frameReference.assetId, contentHash: frameReference.contentHash }
      : null;
  if (authorityFrame && frameReference && (frameReference.assetId !== authorityFrame.assetId || frameReference.contentHash !== authorityFrame.contentHash)) {
    fail("LOCAL_GPU_CONTINUITY_FRAME_MISMATCH");
  }
  const selected: { role: "CHARACTER" | "PRODUCT"; reference: PackageReference; variantId: string | null }[] = [];
  const ordered = modelReferences(pkg);
  if (pkg.characterAuthority) {
    selected.push({
      role: "CHARACTER",
      reference: oneReference(ordered, ["CHARACTER", "CHARACTER_IDENTITY"], pkg.characterAuthority.characterId, "LOCAL_GPU_CHARACTER_REFERENCE_REQUIRED"),
      variantId: null,
    });
  }
  const product = productVisual(pkg);
  if (product.image) {
    const reference = oneReference(ordered, ["PRODUCT", "PRODUCT_IDENTITY"], null, "LOCAL_GPU_PRODUCT_REFERENCE_REQUIRED");
    if (reference.assetId !== product.image.assetId || reference.contentHash !== product.image.contentHash) {
      fail("LOCAL_GPU_REFERENCE_CONTENT_HASH_REQUIRED");
    }
    selected.push({ role: "PRODUCT", reference, variantId: product.variant });
  }
  const selectedRefs = new Set(selected.map((item) => item.reference));
  if (ordered.some((reference) => !selectedRefs.has(reference))) fail("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
  const desktopReferences = selected
    .slice()
    .sort((left, right) => ordered.indexOf(left.reference) - ordered.indexOf(right.reference))
    .map((item) => {
      const asset = resolveAsset(input.assets, pkg.workspaceId, item.reference.assetId, item.reference.contentHash);
      return {
        approval: "APPROVED" as const,
        role: item.role,
        subjectId: item.role === "CHARACTER" ? pkg.characterAuthority!.characterId : product.image?.assetId ?? "",
        variantId: item.variantId,
        assetUrl: asset.assetUrl,
        contentHash: asset.contentHash,
      };
    });
  const frameAsset = authorityFrame
    ? resolveAsset(input.assets, pkg.workspaceId, authorityFrame.assetId, authorityFrame.contentHash)
    : null;
  const productOnlyScene = !pkg.characterAuthority && Boolean(product.image) && pkg.dialogue.length === 0;
  const audioPolicy = pkg.generateAudio && !pkg.audioBlocked
    ? "NO_DIALOGUE_WITH_AMBIENT_AUDIO" as const
    : !pkg.generateAudio && pkg.audioBlocked
      ? "SILENT_OUTPUT" as const
      : fail("LOCAL_GPU_AUDIO_POLICY_INVALID");
  return buildLocalGpuDesktopSubmitV2({
    environment: input.environment,
    jobId: input.jobId,
    sceneExecutionId: pkg.sceneExecutionId,
    workspaceId: pkg.workspaceId,
    workflow: pkg.recommendedWorkflow,
    prompt: serializeCanonicalPackageForH3(pkg),
    plannedDurationMs: pkg.durationSec * 1000,
    upload: input.upload,
    audioPolicy,
    productOnlyScene,
    creative: {
      characters: pkg.characterAuthority ? [{
        subjectId: pkg.characterAuthority.characterId,
        dnaFingerprint: pkg.characterAuthority.dnaFingerprint,
      }] : [],
      products: product.image ? [{
        subjectId: desktopReferences.find((reference) => reference.role === "PRODUCT")?.subjectId ?? "",
        variantId: product.variant,
      }] : [],
      scene: { sceneExecutionId: pkg.sceneExecutionId },
    },
    references: desktopReferences,
    continuityRequired: authorityFrame !== null,
    firstFrame: frameAsset && authorityFrame ? {
      sourceAssetId: authorityFrame.assetId,
      contentHash: frameAsset.contentHash,
      assetUrl: frameAsset.assetUrl,
      authoritySourceAssetId: authorityFrame.assetId,
      authorityContentHash: authorityFrame.contentHash,
      lineage: firstFrameLineage(pkg),
    } : null,
    firstFrameAuthorities: input.firstFrameAuthorities,
    dialogueLineCount: pkg.dialogue.length,
    pinnedVoiceDna: Boolean(input.pinnedVoiceDna),
    structuredCamera: input.structuredCamera,
    structuredMotion: input.structuredMotion,
    textOnly: input.textOnly,
  });
}
