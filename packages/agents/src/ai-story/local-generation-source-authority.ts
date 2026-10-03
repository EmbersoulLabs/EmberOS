import {
  AI_STORY_LOCAL_GENERATION_PACKAGE_VERSION_V2,
  AI_STORY_LOCAL_GENERATION_SOURCE_AUTHORITY_VERSION,
  AiStoryLocalGenerationPackageSchema,
  type AiStoryEffectiveSceneGenerationAuthority,
  type AiStoryLocalGenerationPackage,
  type AiStoryPostQcRequirement,
  type AiStorySceneExecutionIntent,
  type AiStorySceneCompiledInstructions,
  type AiStoryCanonicalScene,
  type ProductVisualMaterialSelectionAuthority,
} from "@ceo-agent/shared";
import { sha256CanonicalIntegrityHash } from "@ceo-agent/shared/server";
import { canonicalPersistenceHash, deterministicPersistenceUuid } from "@ceo-agent/db";
import { AiStoryLocalGenerationError, localGenerationPackageFingerprint } from "./local-generation-package";
import { resolveExplicitAiStorySceneGenerationAuthority } from "@ceo-agent/shared";

export type ProviderNeutralLocalSceneFacts = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly executionPlanId: string;
  readonly runtimeAuthorizationId: string;
  readonly sceneExecutionId: string;
  readonly sceneExecutionFingerprint: string;
  readonly instructionContentHash: string;
  readonly intent: AiStorySceneExecutionIntent;
  readonly instructions: AiStorySceneCompiledInstructions;
  readonly scene: AiStoryCanonicalScene;
  readonly preGenerationQcEvaluationId: string;
  readonly preGenerationQcFingerprint: string;
  readonly preGenerationSceneVersionIds: readonly string[];
  readonly directorFingerprint: string;
  readonly motionFingerprint: string;
  readonly handoffId: string;
  readonly handoffFingerprint: string;
  readonly aspectRatio: "9:16" | "16:9" | "1:1";
  readonly productMaterial: ProductVisualMaterialSelectionAuthority | null;
  readonly selectedMaterialAsset: {
    readonly assetId: string;
    readonly contentHash: string;
    readonly mediaType: string;
    readonly storagePath: string;
  } | null;
  readonly order: number;
  readonly createdAt: string;
  readonly retryOfPackageId?: string | null;
  readonly retryNumber?: number;
};

function fail(message: string): never {
  throw new AiStoryLocalGenerationError("LOCAL_GENERATION_AUTHORITY_INVALID", message);
}

function stateText(facts: readonly { dimension: string; value: string }[]): string[] {
  return facts.map((fact) => `${fact.dimension}: ${fact.value}`);
}

function dialogueFrom(scene: AiStoryCanonicalScene) {
  return scene.events.flatMap((event) => {
    if (event.type !== "DIALOGUE" && event.type !== "VO") return [];
    const speakerId = event.type === "DIALOGUE" ? event.speakerId : event.voiceOwnerId;
    return [{
      ...(speakerId ? { speakerCharacterId: speakerId } : {}),
      speakerLabel: speakerId,
      text: event.type === "DIALOGUE" ? event.line : event.line,
      offscreen: event.type === "VO",
    }];
  });
}

export function materializeProviderNeutralLocalGenerationPackage(
  facts: ProviderNeutralLocalSceneFacts,
): AiStoryLocalGenerationPackage {
  const { scene, instructions, intent } = facts;
  if (!instructions.sceneVersionId || !instructions.sceneFingerprint || !instructions.scriptVersionId || !instructions.sceneSetFingerprint) {
    fail("Current Canonical Scene execution is missing frozen Scene/Handoff lineage");
  }
  if (!intent.identity.sceneVersionId || !intent.identity.sceneFingerprint || !intent.identity.scriptVersionId) {
    fail("Persisted Scene execution intent is missing current Canonical Scene identity");
  }
  if (canonicalPersistenceHash(instructions) !== facts.instructionContentHash) {
    fail("Persisted compiled instructions do not match the Scene execution instruction hash");
  }
  if (
    intent.identity.sceneExecutionId !== facts.sceneExecutionId ||
    intent.identity.sceneId !== scene.sceneId ||
    intent.identity.sceneVersionId !== scene.sceneVersionId ||
    intent.identity.sceneFingerprint !== scene.fingerprint ||
    instructions.sceneVersionId !== scene.sceneVersionId ||
    instructions.sceneFingerprint !== scene.fingerprint ||
    instructions.scriptVersionId !== scene.scriptVersionId ||
    scene.storyVersionId !== facts.storyVersionId ||
    scene.status !== "FROZEN"
  ) {
    fail("Frozen Scene version or fingerprint does not match persisted execution intent");
  }
  if (!facts.preGenerationSceneVersionIds.includes(scene.sceneVersionId) || facts.preGenerationQcFingerprint.length < 7) {
    fail("Pre-Generation QC does not bind the current frozen Scene version");
  }
  let generationAuthority: AiStoryEffectiveSceneGenerationAuthority;
  try {
    generationAuthority = resolveExplicitAiStorySceneGenerationAuthority(scene.generationAuthority);
    if (!instructions.generationAuthority ||
        sha256CanonicalIntegrityHash(generationAuthority) !== sha256CanonicalIntegrityHash(instructions.generationAuthority)) {
      fail("Compiled instructions generation authority does not match the frozen Scene");
    }
  } catch (error) {
    if (error instanceof AiStoryLocalGenerationError) throw error;
    fail(error instanceof Error ? error.message : "Frozen Scene generation authority is invalid");
  }
  const imageConditioned = generationAuthority.strategy !== "TEXT_TO_VIDEO";
  const selection = facts.productMaterial;
  const selected = selection?.selectedMaterial ?? null;
  if (imageConditioned) {
    if (!selection || !selected || (selection.selection !== "EXTRACTED_DERIVATIVE" && selection.selection !== "SOURCE_ASSET")) {
      fail("Image-conditioned execution requires the exact selected Product material");
    }
    if (
      selection.sceneId !== scene.sceneId ||
      selection.sceneVersionId !== scene.sceneVersionId ||
      selection.productAuthority.sourceAssetId !== generationAuthority.firstFrameAssetId
    ) {
      fail("Product material selection does not bind the exact frozen Scene Product");
    }
    if (!facts.selectedMaterialAsset || facts.selectedMaterialAsset.assetId !== selected.assetId ||
        facts.selectedMaterialAsset.contentHash !== selected.contentHash) {
      fail("Selected Product material content hash does not match the frozen Asset");
    }
  } else if (facts.selectedMaterialAsset) {
    fail("Reference-free execution cannot carry a first-frame Asset");
  }

  const persistentCast = scene.castBindings.filter((cast) => cast.scope !== "EPHEMERAL_ACTOR");
  const primaryCast = [...persistentCast].sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
  const characterAuthority = primaryCast ? {
    characterId: primaryCast.id,
    characterVersionId: primaryCast.authorityVersionId,
    dnaFingerprint: primaryCast.authorityFingerprint,
    sourcePhotoSentToVideoProvider: false as const,
  } : null;
  const narrativeBinding = scene.productBindings.length === 1 ? scene.productBindings[0] : null;
  const productAuthority = imageConditioned && selection && selected ? {
    assetId: selection.productAuthority.sourceAssetId,
    contentHash: selection.productAuthority.sourceAssetContentHash,
    confirmedVariant: selection.productAuthority.confirmedVariant ?? null,
    selectedMaterialAssetId: selected.assetId,
    selectedMaterialContentHash: selected.contentHash,
    selection: selection.selection as "SOURCE_ASSET" | "EXTRACTED_DERIVATIVE",
  } : narrativeBinding ? {
    assetId: narrativeBinding.sourceAssetId,
    contentHash: narrativeBinding.sourceAssetContentHash,
    confirmedVariant: narrativeBinding.confirmedVariant ?? null,
    selectedMaterialAssetId: null,
    selectedMaterialContentHash: null,
    selection: "NO_PRODUCT_VISUAL_INPUT" as const,
  } : null;
  const references = imageConditioned && facts.selectedMaterialAsset && selection ? [{
    assetId: facts.selectedMaterialAsset.assetId,
    contentHash: facts.selectedMaterialAsset.contentHash,
    authorityType: "FIRST_FRAME" as const,
    authorityId: selection.productAuthority.productAuthorityId,
    displayName: "selected product first frame",
    mediaType: facts.selectedMaterialAsset.mediaType,
    storagePath: facts.selectedMaterialAsset.storagePath,
  }] : [];
  const dialogue = dialogueFrom(scene);
  const generateAudio = dialogue.length > 0;
  const previous = stateText(scene.entryState);
  const expectedEnd = stateText(scene.exitState);
  const mustKeep = scene.mustKeep.length ? [...scene.mustKeep] : [instructions.purpose];
  const mustAvoid = [...scene.mustAvoid];
  const continuity = [instructions.continuityNotes, instructions.transition, ...scene.continuityFacts].filter((fact) => fact.trim().length > 0);
  const world = [
    scene.locationState.timeOfDay,
    scene.locationState.weather,
    scene.locationState.crowdState,
    ...scene.locationState.temporaryFacts,
    instructions.continuityNotes,
  ].filter((fact): fact is string => Boolean(fact && fact.trim())).join("\n").slice(0, 4000);
  const shotLines = instructions.shots.map((shot) =>
    `Shot ${shot.order + 1}: ${shot.cameraType}; ${shot.cameraMovement}; ${shot.composition}; ${shot.framing}; focus ${shot.focus}; ${shot.information}`,
  );
  const prompt = [instructions.purpose, ...shotLines, ...mustKeep.map((fact) => `Keep: ${fact}`)].join("\n");
  const workflow = generationAuthority.strategy === "TEXT_TO_VIDEO" ? "WAN_T2V" as const : "WAN_I2V" as const;
  const generationMode = generationAuthority.strategy === "TEXT_TO_VIDEO"
    ? "TEXT_TO_VIDEO" as const
    : generationAuthority.strategy === "PRODUCT_GROUNDED_VIDEO"
      ? "PRODUCT_GROUNDED_VIDEO" as const
      : "FIRST_FRAME_IMAGE_TO_VIDEO" as const;
  const qcRequirements: AiStoryPostQcRequirement[] = [
    ...mustKeep.map((fact, index) => ({
      requirementId: `must-keep:${index}`, dimension: "MUST_KEEP" as const, summary: fact,
      required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY" as const, sourceOwner: "SCENE" as const, visuallyObservable: true,
    })),
    ...mustAvoid.map((fact, index) => ({
      requirementId: `must-avoid:${index}`, dimension: "MUST_AVOID" as const, summary: fact,
      required: true, waiverPolicy: "NON_WAIVABLE_INTEGRITY" as const, sourceOwner: "SCENE" as const, visuallyObservable: true,
    })),
    ...shotLines.map((fact, index) => ({
      requirementId: `director:${index}`, dimension: "DIRECTOR_EXECUTION" as const, summary: fact,
      required: true, waiverPolicy: "WAIVABLE_BY_HUMAN" as const, sourceOwner: "DIRECTOR" as const, visuallyObservable: true,
    })),
  ];
  const sourceBody = {
    version: AI_STORY_LOCAL_GENERATION_SOURCE_AUTHORITY_VERSION,
    orgId: facts.orgId,
    workspaceId: facts.workspaceId,
    campaignId: facts.campaignId,
    storyId: facts.storyId,
    storyVersionId: facts.storyVersionId,
    executionPlanId: facts.executionPlanId,
    runtimeAuthorizationId: facts.runtimeAuthorizationId,
    sceneExecutionId: facts.sceneExecutionId,
    sceneExecutionFingerprint: facts.sceneExecutionFingerprint,
    instructionContentHash: facts.instructionContentHash,
    sceneVersionId: scene.sceneVersionId,
    sceneFingerprint: scene.fingerprint,
    generationAuthority,
    generationAuthorityFingerprint: sha256CanonicalIntegrityHash(generationAuthority),
    preGenerationQcEvaluationId: facts.preGenerationQcEvaluationId,
    preGenerationQcFingerprint: facts.preGenerationQcFingerprint,
    directorFingerprint: facts.directorFingerprint,
    motionFingerprint: facts.motionFingerprint,
    scriptVersionId: scene.scriptVersionId,
    handoffId: facts.handoffId,
    handoffFingerprint: facts.handoffFingerprint,
    characterAuthorityFingerprint: sha256CanonicalIntegrityHash(characterAuthority),
    worldAuthorityFingerprint: sha256CanonicalIntegrityHash({
      locationBinding: scene.locationBinding,
      locationState: scene.locationState,
      continuityNotes: instructions.continuityNotes,
    }),
    productMaterialFingerprint: sha256CanonicalIntegrityHash(selection ?? { selection: "NO_PRODUCT_VISUAL_INPUT" }),
    productMaterialSelection: selection,
  };
  const localSourceAuthorityFingerprint = sha256CanonicalIntegrityHash(sourceBody);
  const localSourceAuthorityId = deterministicPersistenceUuid(
    "ai-story-local-source-authority-v2",
    localSourceAuthorityFingerprint,
  );
  const retryNumber = facts.retryNumber ?? 0;
  const packageId = deterministicPersistenceUuid("ai-story-local-generation-package-v2", {
    runtimeAuthorizationId: facts.runtimeAuthorizationId,
    localSourceAuthorityId,
    retryNumber,
  });
  const instructionsText = [
    `Generation Unit ${facts.order}`,
    `Recommended local workflow: ${workflow}`,
    `Audio: ${generateAudio ? "speak the frozen dialogue" : "video-only"}`,
    `Resolution intent: 720p`,
    "",
    "PROMPT",
    prompt,
    "",
    "MUST KEEP",
    ...mustKeep.map((fact) => `- ${fact}`),
    "",
    "CONTINUITY",
    ...continuity.map((fact) => `- ${fact}`),
    "",
    "Render locally from this frozen Scene authority. Do not substitute references, generation mode, Product material, or Character identity.",
  ].join("\n");
  const unsigned = {
    version: AI_STORY_LOCAL_GENERATION_PACKAGE_VERSION_V2,
    packageId,
    executionMode: "MANUAL_LOCAL" as const,
    organizationId: facts.orgId,
    workspaceId: facts.workspaceId,
    campaignId: facts.campaignId,
    storyId: facts.storyId,
    storyVersionId: facts.storyVersionId,
    executionPlanId: facts.executionPlanId,
    runtimeAuthorizationId: facts.runtimeAuthorizationId,
    unitId: facts.sceneExecutionId,
    sceneExecutionId: facts.sceneExecutionId,
    sceneId: scene.sceneId,
    order: facts.order,
    durationSec: instructions.durationMs / 1000,
    aspectRatio: facts.aspectRatio,
    resolutionIntent: "720p" as const,
    recommendedWorkflow: workflow,
    generationMode,
    prompt,
    negativePrompt: "",
    dialogue,
    generateAudio,
    audioBlocked: !generateAudio,
    characterAuthority,
    productAuthority,
    worldDescription: world || instructions.purpose,
    mustKeep,
    mustAvoid,
    qcRequirements,
    continuityRequirements: continuity.length ? continuity : [instructions.purpose],
    previousUnitEndState: previous,
    currentUnitStartState: previous,
    expectedEndState: expectedEnd,
    references,
    sourceAuthority: { ...sourceBody, localSourceAuthorityId, localSourceAuthorityFingerprint },
    planningAuthority: {
      planningLineageSource: "FROZEN_SCRIPT_DIRECTOR" as const,
      sceneVersion: scene.version,
      scriptVersionId: scene.scriptVersionId,
      handoffId: facts.handoffId,
      handoffFingerprint: facts.handoffFingerprint,
    },
    instructions: instructionsText,
    state: "AWAITING_LOCAL_OUTPUT" as const,
    retryOfPackageId: facts.retryOfPackageId ?? null,
    retryNumber,
    createdAt: facts.createdAt,
  };
  return AiStoryLocalGenerationPackageSchema.parse({
    ...unsigned,
    packageFingerprint: localGenerationPackageFingerprint(unsigned),
  });
}
