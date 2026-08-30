import {
  AI_STORY_SCENE_EXECUTION_PACKAGE_CONTRACT_VERSION,
  AI_STORY_SEEDANCE_MAPPING_VERSION,
  AI_STORY_SEEDANCE_REFERENCE_BUDGET,
  AI_STORY_SEEDANCE_TRANSLATION_MATRIX,
  AI_STORY_SEMANTIC_PLAN_CONTRACT_VERSION,
  AiStorySceneExecutionPackageSchema,
  AiStorySeedanceSemanticPlanSchema,
  type AiStoryExecutionVisualReference,
  type AiStorySceneExecutionPackage,
  type AiStorySeedanceSemanticPlan,
} from "@ceo-agent/shared";
import {
  computeAiStoryLocationFingerprint,
  computeAiStorySceneFingerprint,
  computeAiStoryShotRecipeFingerprint,
  validateAiStoryPreGenerationQcFingerprint,
} from "@ceo-agent/shared/server";
import { integrityHash } from "./scene-execution-compiler";

export const SEEDANCE_CERTIFIED_CAMERA_PROMPT_SEMANTICS = Object.freeze({
  LOCKED: "locked camera",
  SLOW_PUSH_IN: "slow, bounded push in",
  SLOW_PULL_BACK: "slow, bounded pull back",
  MINOR_LATERAL_DOLLY: "minor bounded lateral dolly",
  PAN: "bounded pan",
  TRACKING: "bounded tracking movement",
} as const);

export type SeedanceAdapterDegradation = {
  readonly code: "PREFERRED_REFERENCE_OMITTED" | "OPTIONAL_REFERENCE_OMITTED" | "OPTIONAL_CAMERA_OMITTED";
  readonly authorityId?: string;
  readonly safeEvidence: string;
};

export type SeedanceDirectorCompilation = {
  readonly semanticPlan: AiStorySeedanceSemanticPlan;
  readonly prompt: string;
  readonly selectedReferences: readonly AiStoryExecutionVisualReference[];
  readonly degradations: readonly SeedanceAdapterDegradation[];
  readonly requestFacts: {
    readonly model: "dreamina-seedance-2-0-260128";
    readonly generationMode: "TEXT_TO_VIDEO" | "FIRST_FRAME_IMAGE_TO_VIDEO";
    readonly duration: 4 | 5 | 6 | 8 | 10 | 12;
    readonly ratio: "9:16" | "16:9" | "1:1";
    readonly resolution: "480p" | "720p" | "1080p";
    readonly generateAudio: false;
    readonly watermark: boolean;
  };
};

export class SeedanceDirectorAdapterError extends Error {
  readonly code: string;
  readonly repairOwner: "SCENE" | "CAST" | "LOCATION" | "PRODUCT_AUTHORITY" | "DIRECTOR" | "MOTION" | "PRE_GENERATION_QC" | "PROVIDER_ADAPTER";

  constructor(code: string, message: string, repairOwner: SeedanceDirectorAdapterError["repairOwner"] = "PROVIDER_ADAPTER") {
    super(message);
    this.name = "SeedanceDirectorAdapterError";
    this.code = code;
    this.repairOwner = repairOwner;
  }
}

export function seedanceSceneExecutionPackageFingerprint(input: Omit<AiStorySceneExecutionPackage, "packageFingerprint">): string {
  return integrityHash({ kind: AI_STORY_SCENE_EXECUTION_PACKAGE_CONTRACT_VERSION, ...input });
}

const sectionOrder = [
  "SCENE_CONTEXT", "CAST_AUTHORITY", "LOCATION_AUTHORITY", "PRODUCT_AUTHORITY", "ENTRY_STATE", "SCENE_PURPOSE",
  "SCRIPT_ACTION", "ACTION_PROGRESSION", "REQUIRED_EXIT_STATE", "DIRECTOR_VISUAL_TREATMENT", "SHOT_RECIPE_SEMANTICS",
  "CAMERA", "FOCUS", "COMPOSITION", "BLOCKING", "ENVIRONMENTAL_MOTION", "REQUIRED_EVIDENCE", "MUST_KEEP", "MUST_AVOID",
] as const;

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function fact(entityId: string, property: string, value: string): string {
  return `${entityId} — ${property}: ${value}`;
}

function assertExactBindings(pkg: AiStorySceneExecutionPackage): void {
  const scene = pkg.scene;
  if (scene.status !== "FROZEN") throw new SeedanceDirectorAdapterError("SCENE_NOT_FROZEN", "Provider compilation requires a frozen canonical Scene", "SCENE");
  if (computeAiStorySceneFingerprint(scene) !== scene.fingerprint) throw new SeedanceDirectorAdapterError("SCENE_FINGERPRINT_MISMATCH", "Canonical Scene fingerprint is invalid", "SCENE");
  if (scene.orgId !== pkg.orgId || scene.workspaceId !== pkg.workspaceId || scene.campaignId !== pkg.campaignId || scene.storyId !== pkg.storyId || scene.storyVersionId !== pkg.storyVersionId || scene.scriptVersionId !== pkg.scriptVersionId) {
    throw new SeedanceDirectorAdapterError("SCENE_LINEAGE_MISMATCH", "Scene lineage does not match the execution package", "SCENE");
  }
  const binding = pkg.directorDirection.canonicalSceneBinding;
  if (!binding || binding.sceneId !== scene.sceneId || binding.sceneVersionId !== scene.sceneVersionId || binding.sceneFingerprint !== scene.fingerprint) {
    throw new SeedanceDirectorAdapterError("DIRECTOR_SCENE_BINDING_MISMATCH", "Director does not bind the exact canonical Scene", "DIRECTOR");
  }
  const motionBinding = pkg.motionScenePlan.canonicalSceneBinding;
  if (!motionBinding || JSON.stringify(motionBinding) !== JSON.stringify(binding)) {
    throw new SeedanceDirectorAdapterError("MOTION_SCENE_BINDING_MISMATCH", "Motion does not preserve the exact Director Scene binding", "MOTION");
  }
  const qc = pkg.qcEvaluation;
  if (!validateAiStoryPreGenerationQcFingerprint(qc)) throw new SeedanceDirectorAdapterError("QC_FINGERPRINT_MISMATCH", "Pre-Generation QC fingerprint is invalid", "PRE_GENERATION_QC");
  if (qc.dispatchDecision === "DISPATCH_BLOCKED" || qc.preDispatchBlocked || !["DISPATCH_ELIGIBLE", "DISPATCH_ELIGIBLE_WITH_WARNINGS"].includes(qc.dispatchDecision)) {
    throw new SeedanceDirectorAdapterError("QC_DISPATCH_BLOCKED", "Pre-Generation QC does not authorize Provider compilation", "PRE_GENERATION_QC");
  }
  if (qc.storyId !== pkg.storyId || qc.storyVersionId !== pkg.storyVersionId || qc.scriptVersionId !== pkg.scriptVersionId || qc.handoffId !== pkg.handoffId || qc.directorPlanId !== pkg.directorPlanId || qc.motionPlanId !== pkg.motionPlanId || qc.qcFingerprint !== pkg.qcEvaluation.qcFingerprint || !(qc.sceneVersionIds ?? []).includes(scene.sceneVersionId)) {
    throw new SeedanceDirectorAdapterError("QC_LINEAGE_MISMATCH", "QC evaluation is stale or does not bind this Scene package", "PRE_GENERATION_QC");
  }
  if (qc.providerCapabilityId !== "animation-video-generation" || qc.providerCapabilityVersion !== pkg.providerBinding.qcCapabilityVersion) {
    throw new SeedanceDirectorAdapterError("QC_CAPABILITY_VERSION_MISMATCH", "QC capability authority does not match the package Provider binding", "PRE_GENERATION_QC");
  }
  if (pkg.locationAuthority) {
    const location = scene.locationBinding;
    if (location.scope === "EPHEMERAL_ENVIRONMENT" || pkg.locationAuthority.locationId !== location.id || pkg.locationAuthority.locationVersionId !== location.authorityVersionId || pkg.locationAuthority.fingerprint !== location.authorityFingerprint) {
      throw new SeedanceDirectorAdapterError("LOCATION_BINDING_MISMATCH", "Persistent Location authority does not match the Scene binding", "LOCATION");
    }
    if (computeAiStoryLocationFingerprint(pkg.locationAuthority) !== pkg.locationAuthority.fingerprint) throw new SeedanceDirectorAdapterError("LOCATION_FINGERPRINT_MISMATCH", "Persistent Location fingerprint is invalid", "LOCATION");
  } else if (scene.locationBinding.scope !== "EPHEMERAL_ENVIRONMENT") {
    throw new SeedanceDirectorAdapterError("LOCATION_AUTHORITY_MISSING", "Persistent Scene Location authority is missing", "LOCATION");
  }
  const sceneCast = new Map(scene.castBindings.map((reference) => [`${reference.scope}:${reference.id}`, JSON.stringify(reference)]));
  const resolvedCast = new Map(pkg.castAuthorities.map((authority) => [`${authority.reference.scope}:${authority.reference.id}`, JSON.stringify(authority.reference)]));
  if (sceneCast.size !== resolvedCast.size || [...sceneCast].some(([key, value]) => resolvedCast.get(key) !== value)) {
    throw new SeedanceDirectorAdapterError("CAST_BINDING_MISMATCH", "Resolved Cast authority does not exactly match the canonical Scene", "CAST");
  }
  const sceneProducts = new Map(scene.productBindings.map((binding) => [binding.productAuthorityId, binding]));
  const resolvedProducts = new Map(pkg.productAuthorities.map((authority) => [authority.productAuthorityId, authority]));
  if (sceneProducts.size !== resolvedProducts.size || [...sceneProducts].some(([id, binding]) => {
    const authority = resolvedProducts.get(id);
    return !authority || authority.sourceAssetId !== binding.sourceAssetId || authority.sourceAssetContentHash !== binding.sourceAssetContentHash;
  })) {
    throw new SeedanceDirectorAdapterError("PRODUCT_BINDING_MISMATCH", "Resolved Product authority does not exactly match the canonical Scene", "PRODUCT_AUTHORITY");
  }
  const eventIds = new Set(scene.events.map((event) => event.entryId));
  if (pkg.motionScenePlan.actionExecutions.some((execution) => !eventIds.has(execution.scriptActionEntryId))) {
    throw new SeedanceDirectorAdapterError("SCRIPT_ACTION_BINDING_MISMATCH", "Motion references an Action outside canonical Scene events", "MOTION");
  }
  const shotIds = new Set(pkg.directorDirection.shots.map((shot) => shot.directorShotId));
  if ([...pkg.motionScenePlan.cameraExecutions, ...pkg.motionScenePlan.focusExecutions].some((execution) => !shotIds.has(execution.directorShotId))) {
    throw new SeedanceDirectorAdapterError("DIRECTOR_MOTION_SHOT_MISMATCH", "Motion execution references an unknown Director shot", "MOTION");
  }
  const recipeBinding = pkg.directorDirection.shotRecipeBinding;
  if ((recipeBinding && !pkg.shotRecipe) || (pkg.shotRecipe && (!recipeBinding || recipeBinding.recipeId !== pkg.shotRecipe.recipeId || recipeBinding.recipeVersion !== pkg.shotRecipe.version))) {
    throw new SeedanceDirectorAdapterError("SHOT_RECIPE_BINDING_MISMATCH", "Shot Recipe authority does not match the Director selection", "DIRECTOR");
  }
  if (recipeBinding && pkg.shotRecipe && recipeBinding.recipeFingerprint !== computeAiStoryShotRecipeFingerprint(pkg.shotRecipe)) throw new SeedanceDirectorAdapterError("SHOT_RECIPE_FINGERPRINT_MISMATCH", "Shot Recipe fingerprint is invalid", "DIRECTOR");
  if (pkg.directorDirection.shots.length !== 1) {
    throw new SeedanceDirectorAdapterError("MULTI_SHOT_UNCERTIFIED", "Seedance V1 Scene execution accepts one Director shot; multi-shot orchestration is not certified");
  }
}

function requirementByAuthority(pkg: AiStorySceneExecutionPackage): Map<string, "NONE" | "PREFERRED" | "REQUIRED"> {
  const result = new Map<string, "NONE" | "PREFERRED" | "REQUIRED">();
  result.set(pkg.scene.locationBinding.id, pkg.scene.locationBinding.visualIdentityRequirement);
  for (const cast of pkg.scene.castBindings) result.set(cast.id, cast.visualIdentityRequirement);
  for (const product of pkg.productAuthorities) result.set(product.productAuthorityId, product.visualIdentityRequirement);
  return result;
}

function selectReferences(pkg: AiStorySceneExecutionPackage): { selected: AiStoryExecutionVisualReference[]; degradations: SeedanceAdapterDegradation[] } {
  const requirements = requirementByAuthority(pkg);
  const grouped = new Map<string, AiStoryExecutionVisualReference[]>();
  for (const reference of pkg.visualReferences) {
    if (!requirements.has(reference.authorityId) && reference.authorityType !== "OTHER") {
      throw new SeedanceDirectorAdapterError("REFERENCE_AUTHORITY_UNKNOWN", `Reference ${reference.referenceId} does not resolve to a Scene authority`);
    }
    const list = grouped.get(reference.authorityId) ?? [];
    list.push(reference);
    grouped.set(reference.authorityId, list);
  }

  if (pkg.generation.mode === "TEXT_TO_VIDEO") {
    const required = [...requirements.entries()].filter(([, value]) => value === "REQUIRED");
    if (required.length) throw new SeedanceDirectorAdapterError("REQUIRED_VISUAL_AUTHORITY_MISSING", "TEXT_TO_VIDEO cannot represent REQUIRED image-conditioned visual authority");
    return {
      selected: [],
      degradations: [...requirements.entries()].filter(([, value]) => value === "PREFERRED").map(([authorityId]) => ({ code: "PREFERRED_REFERENCE_OMITTED" as const, authorityId, safeEvidence: "Explicit TEXT_TO_VIDEO mode preserved; preferred visual conditioning was not injected" })),
    };
  }

  const chosen: AiStoryExecutionVisualReference[] = [];
  const degradations: SeedanceAdapterDegradation[] = [];
  for (const [authorityId, requirement] of [...requirements.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (requirement === "NONE") continue;
    const candidates = [...(grouped.get(authorityId) ?? [])].sort((left, right) => right.selectionPriority - left.selectionPriority || left.assetId.localeCompare(right.assetId));
    if (!candidates[0]) {
      if (requirement === "REQUIRED") throw new SeedanceDirectorAdapterError("REQUIRED_VISUAL_AUTHORITY_MISSING", `Required visual authority ${authorityId} has no authorized reference Asset`);
      degradations.push({ code: "PREFERRED_REFERENCE_OMITTED", authorityId, safeEvidence: "Preferred visual authority had no authorized reference Asset" });
      continue;
    }
    if (candidates[0].authorityClass !== requirement) throw new SeedanceDirectorAdapterError("REFERENCE_AUTHORITY_CLASS_MISMATCH", `Reference classification for ${authorityId} does not match canonical visual identity requirement`);
    chosen.push(candidates[0]);
    for (const omitted of candidates.slice(1)) degradations.push({ code: omitted.authorityClass === "OPTIONAL" ? "OPTIONAL_REFERENCE_OMITTED" : "PREFERRED_REFERENCE_OMITTED", authorityId, safeEvidence: "Redundant same-authority reference omitted by deterministic priority" });
  }
  for (const reference of pkg.visualReferences.filter((candidate) => candidate.authorityType === "OTHER")) chosen.push(reference);

  const required = chosen.filter((reference) => reference.authorityClass === "REQUIRED");
  if (required.length > AI_STORY_SEEDANCE_REFERENCE_BUDGET) throw new SeedanceDirectorAdapterError("REQUIRED_REFERENCE_OVER_BUDGET", `Required references exceed the certified shared budget of ${AI_STORY_SEEDANCE_REFERENCE_BUDGET}`);
  const ordered = [...chosen].sort((left, right) => {
    const rank = { REQUIRED: 0, PREFERRED: 1, OPTIONAL: 2 } as const;
    return rank[left.authorityClass] - rank[right.authorityClass] || right.selectionPriority - left.selectionPriority || left.assetId.localeCompare(right.assetId);
  });
  const selected = ordered.slice(0, AI_STORY_SEEDANCE_REFERENCE_BUDGET);
  for (const omitted of ordered.slice(AI_STORY_SEEDANCE_REFERENCE_BUDGET)) {
    if (omitted.authorityClass === "REQUIRED") throw new SeedanceDirectorAdapterError("REQUIRED_REFERENCE_OVER_BUDGET", "A required reference would be dropped");
    degradations.push({ code: omitted.authorityClass === "PREFERRED" ? "PREFERRED_REFERENCE_OMITTED" : "OPTIONAL_REFERENCE_OMITTED", authorityId: omitted.authorityId, safeEvidence: "Reference omitted after deterministic shared-budget allocation" });
  }
  const firstFrames = selected.filter((reference) => reference.firstFrame);
  if (firstFrames.length !== 1) throw new SeedanceDirectorAdapterError("FIRST_FRAME_CARDINALITY", "FIRST_FRAME_IMAGE_TO_VIDEO requires exactly one selected first frame");
  return { selected, degradations };
}

function buildSemanticPlan(pkg: AiStorySceneExecutionPackage, degradations: SeedanceAdapterDegradation[], selectedReferences: readonly AiStoryExecutionVisualReference[]): AiStorySeedanceSemanticPlan {
  const scene = pkg.scene;
  const shot = pkg.directorDirection.shots[0]!;
  const camera = SEEDANCE_CERTIFIED_CAMERA_PROMPT_SEMANTICS[shot.cameraFamily as keyof typeof SEEDANCE_CERTIFIED_CAMERA_PROMPT_SEMANTICS];
  if (!camera && pkg.generation.cameraMappingRequirement === "REQUIRED") throw new SeedanceDirectorAdapterError("CAMERA_MAPPING_UNSAFE", `No certified Seedance prompt-semantic mapping exists for ${shot.cameraFamily}`, "DIRECTOR");
  if (!camera) degradations.push({ code: "OPTIONAL_CAMERA_OMITTED", safeEvidence: `Optional unmapped camera family ${shot.cameraFamily} was omitted` });
  const actions = scene.events.filter((event) => event.type === "ACTION");
  const dialogue = scene.events.filter((event) => event.type === "DIALOGUE").map((event) => `Dialogue context only; do not synthesize audio: “${event.line}”`);
  const voiceOver = scene.events.filter((event) => event.type === "VO").map((event) => `Voice-over narrative context only; do not synthesize audio: “${event.line}”`);
  const locationCore = pkg.locationAuthority
    ? [pkg.locationAuthority.facts.identity, pkg.locationAuthority.facts.appearance, ...pkg.locationAuthority.facts.fixedElements, ...pkg.locationAuthority.facts.environmentalCharacteristics]
    : [scene.locationBinding.scope === "EPHEMERAL_ENVIRONMENT" ? scene.locationBinding.environmentDescription : ""];
  const sections = new Map<typeof sectionOrder[number], string[]>([
    ["SCENE_CONTEXT", [`Order ${scene.order + 1}; role ${scene.sceneRole}; importance ${scene.importance}; time relation ${scene.timeRelation}`, ...scene.continuityFacts]],
    ["CAST_AUTHORITY", pkg.castAuthorities.flatMap((cast) => [`${cast.displayName}: ${cast.identity}`, `Appearance: ${cast.appearance}`, ...cast.coreContinuityFacts, ...cast.sceneStateFacts])],
    ["LOCATION_AUTHORITY", [...locationCore, ...Object.entries(scene.locationState).flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => `${key}: ${item}`) : value ? [`${key}: ${value}`] : [])]],
    ["PRODUCT_AUTHORITY", pkg.productAuthorities.flatMap((product) => [`${product.displayName}: ${product.identityFacts.join("; ")}`, ...product.sceneStateFacts])],
    ["ENTRY_STATE", scene.entryState.map((item) => fact(item.subjectId, item.dimension, item.value))],
    ["SCENE_PURPOSE", [`${scene.sceneFunction}: ${pkg.directorDirection.servedScriptSceneFunction}`, ...pkg.directorDirection.newAudienceInformation]],
    ["SCRIPT_ACTION", [...actions.map((event) => event.action), ...dialogue, ...voiceOver]],
    ["ACTION_PROGRESSION", pkg.motionScenePlan.actionExecutions.flatMap((execution) => [`Start: ${execution.startState.map((item) => fact(item.entityId, item.property, item.value)).join("; ")}`, `Action: ${execution.semanticAction}`, `Path: ${[...execution.actionPath].sort((a, b) => a.order - b.order).map((phase) => phase.semanticPhase).join(" → ")}`, `End: ${execution.endState.map((item) => fact(item.entityId, item.property, item.value)).join("; ")}`])],
    ["REQUIRED_EXIT_STATE", scene.exitState.map((item) => fact(item.subjectId, item.dimension, item.value))],
    ["DIRECTOR_VISUAL_TREATMENT", [`Visual role ${pkg.directorDirection.sceneVisualRole}; shot purpose ${shot.shotPurpose}; shot size ${shot.shotSize}`, shot.cameraIntent]],
    ["SHOT_RECIPE_SEMANTICS", pkg.shotRecipe ? [pkg.shotRecipe.semanticPurpose, pkg.shotRecipe.blockingPattern.semanticIntent, ...pkg.shotRecipe.constraints] : []],
    ["CAMERA", camera ? [camera, shot.cameraIntent, ...pkg.motionScenePlan.cameraExecutions.map((item) => `${item.startCameraState} → ${item.boundedMovement} → ${item.endCameraState}; ${item.timing}`)] : []],
    ["FOCUS", [`Target: ${shot.focusTarget.semanticLabel}`, `Progression: ${shot.focusProgression.map((item) => item.semanticLabel).join(" → ")}`, ...pkg.motionScenePlan.focusExecutions.flatMap((item) => item.progression.sort((a, b) => a.order - b.order).map((step) => `${step.semanticLabel}: ${step.timing}`))]],
    ["COMPOSITION", [shot.compositionIntent]],
    ["BLOCKING", [...shot.blockingIntents.map((item) => item.semanticIntent), ...pkg.motionScenePlan.blockingExecutions.map((item) => `${item.startPosition} → ${item.movementPath} → ${item.interactionPosition} → ${item.endPosition}`)]],
    ["ENVIRONMENTAL_MOTION", pkg.motionScenePlan.environmentalMotions.map((item) => `${item.semanticMotion}: ${item.timing}`)],
    ["REQUIRED_EVIDENCE", [...pkg.directorDirection.servedProductEvidence, ...pkg.productAuthorities.flatMap((product) => product.visibleEvidenceGoals)]],
    ["MUST_KEEP", [...scene.mustKeep, ...pkg.castAuthorities.flatMap((cast) => cast.mustKeep), ...pkg.productAuthorities.flatMap((product) => product.mustKeep), ...selectedReferences.map((reference) => `Reference conditioning: ${reference.semanticBinding}`)]],
    ["MUST_AVOID", [...scene.mustAvoid, ...pkg.productAuthorities.flatMap((product) => product.mustAvoid)]],
  ]);
  return AiStorySeedanceSemanticPlanSchema.parse({
    contractVersion: AI_STORY_SEMANTIC_PLAN_CONTRACT_VERSION,
    sceneExecutionPackageId: pkg.sceneExecutionPackageId,
    packageFingerprint: pkg.packageFingerprint,
    sections: sectionOrder.map((section) => ({ section, facts: unique(sections.get(section) ?? []) })),
    translationClasses: AI_STORY_SEEDANCE_TRANSLATION_MATRIX,
  });
}

function serializeSemanticPlan(plan: AiStorySeedanceSemanticPlan): string {
  const prompt = plan.sections.filter((section) => section.facts.length).map((section) => `${section.section}\n${section.facts.map((item) => `- ${item}`).join("\n")}`).join("\n\n");
  if (prompt.length > 12_000) throw new SeedanceDirectorAdapterError("PROMPT_DENSITY_EXCEEDED", "Execution-relevant semantic plan exceeds the bounded prompt budget");
  return prompt;
}

export function compileSceneExecutionPackageForSeedance(input: unknown): SeedanceDirectorCompilation {
  const pkg = AiStorySceneExecutionPackageSchema.parse(input);
  if (pkg.contractVersion !== AI_STORY_SCENE_EXECUTION_PACKAGE_CONTRACT_VERSION || pkg.providerBinding.adapterMappingVersion !== AI_STORY_SEEDANCE_MAPPING_VERSION) throw new SeedanceDirectorAdapterError("ADAPTER_VERSION_MISMATCH", "Scene execution package is not bound to this Adapter mapping version");
  const { packageFingerprint: _fingerprint, ...fingerprintInput } = pkg;
  if (seedanceSceneExecutionPackageFingerprint(fingerprintInput) !== pkg.packageFingerprint) throw new SeedanceDirectorAdapterError("SCENE_EXECUTION_PACKAGE_FINGERPRINT_MISMATCH", "Scene execution package fingerprint is invalid");
  assertExactBindings(pkg);
  const { selected, degradations } = selectReferences(pkg);
  const semanticPlan = buildSemanticPlan(pkg, degradations, selected);
  return {
    semanticPlan,
    prompt: serializeSemanticPlan(semanticPlan),
    selectedReferences: selected,
    degradations,
    requestFacts: {
      model: pkg.providerBinding.model,
      generationMode: pkg.generation.mode,
      duration: pkg.generation.durationSec,
      ratio: pkg.generation.ratio,
      resolution: pkg.generation.resolution,
      generateAudio: false,
      watermark: pkg.generation.watermark,
    },
  };
}
