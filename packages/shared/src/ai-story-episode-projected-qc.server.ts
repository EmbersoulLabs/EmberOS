import { deterministicUuidFromFingerprint } from "./canonical-integrity";
import { validateAiStoryOutline } from "./ai-story-outline";
import { validateAiStoryScript } from "./ai-story-script";
import { validateAiStoryScriptDirectorHandoff } from "./ai-story-script-director-handoff";
import { computeAiStoryScriptDirectorHandoffFingerprint, computeAiStoryScriptDirectorHandoffSourceHash } from "./ai-story-script-director-handoff.server";
import { computeAiStoryOutlineSourceHash } from "./ai-story-outline.server";
import { computeAiStoryScriptSourceHash } from "./ai-story-script.server";
import { validateAiStoryProductStoryProfile } from "./ai-story-product-story-profile.server";
import { validateAiStoryCommercialStoryProfile } from "./ai-story-commercial-story-profile.server";
import { validateCharacterAuthorityBindings } from "./ai-story-character";
import { validateCastReferences } from "./ai-story-cast";
import { validateAiStoryCanonicalScenes } from "./ai-story-scene.server";
import {
  AI_STORY_PRE_GENERATION_QC_CONTRACT_VERSION,
  AI_STORY_PRE_GENERATION_QC_GATE_ORDER,
  AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION,
  AiStoryPreGenerationQcCompilationRequestSchema,
  AiStoryPreGenerationQcEvaluationSchema,
  AiStoryPreGenerationQcProductAuthoritySchema,
  AiStoryPreGenerationQcProviderCapabilitySchema,
  type AiStoryPreGenerationQcEvaluation,
  type AiStoryPreGenerationQcGateId,
  type AiStoryPreGenerationQcGateResult,
} from "./ai-story-pre-generation-qc";
import {
  AI_STORY_EPISODE_PROJECTED_MOTION_COMPLEXITY_POLICY,
  type AiStoryEpisodeProjectedDirectorPlan,
  type AiStoryEpisodeProjectedMotionPlan,
} from "./ai-story-episode-projected-authority";
import { computeAiStoryPreGenerationQcFingerprint, type AiStoryPreGenerationQcInput } from "./ai-story-pre-generation-qc.server";

type Reason = { code: string; evidence: string; layer: AiStoryPreGenerationQcGateResult["failedLayer"]; owner: AiStoryPreGenerationQcGateResult["repairOwner"] };
type Issue = { gate: string; severity: "BLOCK" | "WARN"; message: string };
export type EpisodeProjectedPreGenerationQcInput = Omit<AiStoryPreGenerationQcInput, "directorPlan" | "motionPlan"> & {
  directorPlan: AiStoryEpisodeProjectedDirectorPlan;
  motionPlan: AiStoryEpisodeProjectedMotionPlan;
};

const hard = (gateId: AiStoryPreGenerationQcGateId, reasons: Reason[], ids: AiStoryPreGenerationQcGateResult["evaluatedArtifactIds"]): AiStoryPreGenerationQcGateResult => ({
  gateId, gateVersion: 1, classification: "HARD_GATE", status: reasons.length ? "BLOCK" : "PASS", failedLayer: reasons[0]?.layer ?? null, reasonCode: reasons[0]?.code ?? "PASS", safeEvidence: reasons.map((reason) => reason.evidence), repairOwner: reasons[0]?.owner ?? "NONE", evaluatedArtifactIds: ids, contractVersion: AI_STORY_PRE_GENERATION_QC_CONTRACT_VERSION,
});
const reason = (code: string, evidence: string, layer: Reason["layer"], owner: Reason["owner"]): Reason => ({ code, evidence, layer, owner });
const has = (issues: readonly { gate: string; message: string }[], gates: readonly string[], layer: Reason["layer"], owner: Reason["owner"]) => issues.filter((issue) => gates.includes(issue.gate)).map((issue) => reason(issue.gate, issue.message, layer, owner));
const blocked = (issues: readonly Issue[], gates: readonly string[], layer: Reason["layer"], owner: Reason["owner"]) => issues.filter((issue) => issue.severity === "BLOCK" && gates.includes(issue.gate)).map((issue) => reason(issue.gate, issue.message, layer, owner));

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function projectedDirectorIssues(plan: AiStoryEpisodeProjectedDirectorPlan, handoff: AiStoryPreGenerationQcInput["handoff"], canonicalScenes: AiStoryPreGenerationQcInput["canonicalScenes"]): Issue[] {
  const issues: Issue[] = [];
  const add = (gate: string, message: string) => issues.push({ gate, severity: "BLOCK", message });
  if (plan.handoffId !== handoff.handoffId || plan.scriptVersionId !== handoff.scriptVersionId || plan.storyId !== handoff.storyId || plan.storyVersionId !== handoff.storyVersionId || plan.outlineVersionId !== handoff.outlineVersionId || plan.orgId !== handoff.orgId || plan.workspaceId !== handoff.workspaceId || plan.sourceHandoffFingerprint !== handoff.handoffFingerprint) add("HANDOFF_BINDING_GATE", "Projected Director does not bind the exact Handoff");
  if (!same(plan.sceneDirections.map((scene) => [scene.scriptSceneId, scene.sceneOrder]), handoff.sceneHandoffs.map((scene) => [scene.scriptSceneId, scene.sceneOrder]))) add("SCENE_IDENTITY_GATE", "Projected Director Scene identity differs from Script truth");
  for (const scene of plan.sceneDirections) {
    const source = handoff.sceneHandoffs.find((candidate) => candidate.scriptSceneId === scene.scriptSceneId);
    if (!source) continue;
    if (scene.sceneFunction !== source.sceneFunction) add("SCRIPT_TRUTH_BINDING_GATE", `Projected Director changed Scene function for ${scene.scriptSceneId}`);
    const actionIds = new Set(source.actionEntries.map((entry) => entry.entryId));
    if (scene.actionEntryIds.some((id) => !actionIds.has(id))) add("SCRIPT_ACTION_SUPPORT_GATE", `Projected Director action is not in the frozen Script for ${scene.scriptSceneId}`);
    if (canonicalScenes) {
      const canonical = canonicalScenes.find((candidate) => candidate.sceneVersionId === scene.canonicalSceneVersionId);
      if (!canonical || canonical.status !== "FROZEN" || canonical.sceneId !== scene.canonicalSceneId || canonical.fingerprint !== scene.canonicalSceneFingerprint || !canonical.sourceScriptSceneIds.includes(scene.scriptSceneId)) add("CANONICAL_SCENE_BINDING_GATE", `Projected Director does not bind the frozen Canonical Scene for ${scene.scriptSceneId}`);
    }
    if (scene.mustKeep.state === "NOT_ASSERTED" || scene.mustAvoid.state === "NOT_ASSERTED") add("MUST_KEEP_MUST_CHANGE_SEPARATION_GATE", `Projected must-keep evidence is not asserted for ${scene.scriptSceneId}`);
    if (scene.mustKeep.state === "KNOWN" && scene.mustAvoid.state === "KNOWN" && scene.mustKeep.value.some((item) => scene.mustAvoid.state === "KNOWN" && scene.mustAvoid.value.includes(item))) add("MUST_KEEP_MUST_CHANGE_SEPARATION_GATE", `Projected must-keep contradicts must-avoid for ${scene.scriptSceneId}`);
    if (scene.sceneOrder > 0 && scene.differentiation.state === "NOT_ASSERTED") add("DIFFERENTIATION_REQUIREMENT_GATE", `Projected differentiation is not asserted for ${scene.scriptSceneId}`);
    if (scene.sceneOrder === 0 && scene.differentiation.state === "KNOWN") add("DIFFERENTIATION_REQUIREMENT_GATE", `Opening Scene differentiation claims a comparison baseline`);
    const identitySensitive = scene.productBindingIds.length > 0 || (scene.generationAuthority.state === "KNOWN" && scene.generationAuthority.value.productVisualIdentityRequirement === "REQUIRED");
    const safetyMissing = [scene.shots.some((shot) => shot.perspectiveChange.state === "NOT_ASSERTED"), scene.shots.some((shot) => shot.revealsUnseenProductSurface.state === "NOT_ASSERTED"), scene.shots.some((shot) => shot.productIdentityTransformation.state === "NOT_ASSERTED")].some(Boolean);
    if (identitySensitive && safetyMissing) add("PRODUCT_CAMERA_SAFETY_GATE", `PROJECTED_PRODUCT_CAMERA_SAFETY_EVIDENCE_REQUIRED for ${scene.scriptSceneId}`);
    if (scene.generationAuthority.state === "NOT_ASSERTED") add("GENERATION_UNIT_BINDING_GATE", `Projected generation authority is not asserted for ${scene.scriptSceneId}`);
    if (scene.shots.length > 1 && new Set(scene.shots.map((shot) => shot.information)).size === 1 && new Set(scene.shots.map((shot) => shot.focus)).size === 1) add("INTRA_SCENE_SHOT_PROGRESSION_GATE", `Projected shots do not show a persisted intra-scene difference for ${scene.scriptSceneId}`);
  }
  for (let index = 1; index < plan.sceneDirections.length; index += 1) {
    const current = plan.sceneDirections[index]!;
    const previous = plan.sceneDirections[index - 1]!;
    const currentSignature = current.shots.map((shot) => [current.sceneFunction, shot.cameraType, shot.cameraMovement, shot.composition, shot.framing, shot.focus].join("|")).join("||");
    const previousSignature = previous.shots.map((shot) => [previous.sceneFunction, shot.cameraType, shot.cameraMovement, shot.composition, shot.framing, shot.focus].join("|")).join("||");
    if (currentSignature === previousSignature) add("CINEMATIC_CAMERA_GRAMMAR_GATE", `Adjacent Scenes ${previous.scriptSceneId} and ${current.scriptSceneId} repeat the same persisted camera grammar`);
    if (current.purpose === previous.purpose && shotField(current.shots, "composition") === shotField(previous.shots, "composition") && shotField(current.shots, "information") === shotField(previous.shots, "information")) add("CONTINUITY_NOT_DUPLICATION_GATE", `Adjacent Scenes ${previous.scriptSceneId} and ${current.scriptSceneId} repeat the same persisted visual facts`);
  }
  return issues;
}

function shotField(shots: readonly { composition: string; information: string }[], field: "composition" | "information") {
  return shots.map((shot) => shot[field]).join("\n");
}

function projectedMotionIssues(plan: AiStoryEpisodeProjectedMotionPlan, director: AiStoryEpisodeProjectedDirectorPlan, script: AiStoryPreGenerationQcInput["script"]): Issue[] {
  const issues: Issue[] = [];
  const add = (gate: string, message: string) => issues.push({ gate, severity: "BLOCK", message });
  if (plan.directorPlanId !== director.directorPlanId || plan.sourceDirectorFingerprint !== director.directorFingerprint || plan.handoffId !== director.handoffId) add("DIRECTOR_BINDING_GATE", "Projected Motion does not bind the frozen projected Director");
  if (!same(plan.sceneMotionPlans.map((scene) => [scene.scriptSceneId, scene.sceneOrder]), director.sceneDirections.map((scene) => [scene.scriptSceneId, scene.sceneOrder]))) add("DIRECTOR_BINDING_GATE", "Projected Motion Scene identity differs from projected Director");
  for (const scene of plan.sceneMotionPlans) {
    const scriptScene = script.scenes.find((candidate) => candidate.scriptSceneId === scene.scriptSceneId);
    if (!scriptScene) continue;
    const scriptActions = scriptScene.entries.flatMap((entry) => entry.type === "ACTION" ? [entry] : []);
    if (!same(scene.actions.map((action) => [action.entryId, action.semanticAction, action.subjectId, action.objectId]), scriptActions.map((action) => [action.entryId, action.action, action.subjectId, action.objectId ?? null]))) add("SCRIPT_ACTION_TRUTH_GATE", `Projected Motion changed Script action text for ${scene.scriptSceneId}`);
    if (!same(scene.sceneStateDeltas.map((fact) => [fact.dimension, fact.subjectId, fact.value, fact.fromValue ?? null]), scriptScene.sceneStateDeltas.map((fact) => [fact.dimension, fact.subjectId, fact.value, fact.fromValue ?? null]))) add("SCRIPT_ACTION_TRUTH_GATE", `Projected Motion changed Script state dimensions for ${scene.scriptSceneId}`);
    if (scene.actions.some((action) => "actionPath" in action || "phaseId" in action)) add("ACTION_PATH_GATE", "Projected Motion contains a synthetic action phase");
    if ("motionBudget" in scene) add("MOTION_BUDGET_GATE", "Projected Motion contains a fabricated motion budget");
    if (scene.physicalCompletion.state === "NOT_ASSERTED") {
      add("ACTION_COMPLETION_GATE", `PROJECTED_PHYSICAL_COMPLETION_EVIDENCE_REQUIRED for ${scene.scriptSceneId}`);
      add("SUBJECT_MOTION_FIRST_CLASS_GATE", `Physical subject completion is not asserted for ${scene.scriptSceneId}`);
      add("SUBJECT_MOTION_COMPLETION_GATE", `PROJECTED_PHYSICAL_COMPLETION_EVIDENCE_REQUIRED for ${scene.scriptSceneId}`);
    }
    if (scene.cameraStateBoundary.state === "NOT_ASSERTED") add("CAMERA_EXECUTION_GATE", `PROJECTED_CAMERA_START_END_EVIDENCE_REQUIRED for ${scene.scriptSceneId}`);
    if (scene.shots.some((shot) => "startCameraState" in shot || "endCameraState" in shot)) add("CAMERA_EXECUTION_GATE", "Projected Motion fabricated camera start or end state");
    const policy = AI_STORY_EPISODE_PROJECTED_MOTION_COMPLEXITY_POLICY;
    if (scene.measuredFacts.actionCount > policy.maxActions || scene.measuredFacts.shotCount > policy.maxShots || scene.measuredFacts.cameraBehaviorCount > policy.maxCameraBehaviors || scene.measuredFacts.durationSec > policy.maxDurationSec) add("MOTION_BUDGET_GATE", `Measured Episode complexity exceeds ${policy.policyId}`);
    if (scene.productBindingIds.length > 0 && scene.physicalCompletion.state !== "KNOWN") add("OBJECT_PERSISTENCE_GATE", `Projected object persistence is not proven for ${scene.scriptSceneId}`);
    if (scene.measuredFacts.productIdentitySensitive && scene.physicalCompletion.state === "NOT_ASSERTED") add("PRODUCT_GROUNDED_MOTION_GATE", `Identity-sensitive Product motion has no proven physical completion for ${scene.scriptSceneId}`);
  }
  for (let index = 1; index < plan.sceneMotionPlans.length; index += 1) {
    const current = plan.sceneMotionPlans[index]!;
    const previous = plan.sceneMotionPlans[index - 1]!;
    for (const entry of current.entryState) {
      const exit = previous.exitState.find((fact) => fact.dimension === entry.dimension && fact.subjectId === entry.subjectId);
      if (exit && exit.value !== entry.value) add("MOTION_CONTINUITY_GATE", `Projected ${entry.dimension} continuity breaks before ${current.scriptSceneId}`);
    }
  }
  return issues;
}

export function evaluateEpisodeProjectedPreGenerationQc(raw: EpisodeProjectedPreGenerationQcInput): AiStoryPreGenerationQcEvaluation {
  const capability = AiStoryPreGenerationQcProviderCapabilitySchema.parse(raw.providerCapability);
  const compilation = AiStoryPreGenerationQcCompilationRequestSchema.parse(raw.compilationRequest);
  const products = raw.productAuthority.map((value) => AiStoryPreGenerationQcProductAuthoritySchema.parse(value));
  const { outline, script, handoff, directorPlan, motionPlan } = raw;
  const sceneVersionIds = raw.canonicalScenes?.map((scene) => scene.sceneVersionId);
  const ids = { storyId: script.storyId, storyVersionId: script.storyVersionId, outlineVersionId: outline.outlineVersionId, scriptVersionId: script.scriptVersionId, handoffId: handoff.handoffId, directorPlanId: directorPlan.directorPlanId, motionPlanId: motionPlan.motionPlanId, sceneExecutionId: compilation.sceneExecutionId, ...(sceneVersionIds ? { sceneVersionIds } : {}) };
  const outlineIssues = validateAiStoryOutline(outline, { knownAuthorityReferences: raw.knownAuthorityReferences });
  const scriptIssues = validateAiStoryScript(script, outline, { knownAuthorityReferences: raw.knownAuthorityReferences });
  const characterBindings = script.authorityReferences.filter((item) => item.authorityType === "CHARACTER" && item.authorityVersionId && item.authorityFingerprint).map((item) => ({ characterId: item.authorityId, characterVersionId: item.authorityVersionId!, characterFingerprint: item.authorityFingerprint! }));
  const characterIds = [...new Set(script.scenes.flatMap((scene) => scene.characterIds))];
  const dialogueSpeakerIds = [...new Set(script.scenes.flatMap((scene) => scene.entries.flatMap((entry) => entry.type === "DIALOGUE" ? [entry.speakerId] : entry.type === "VO" ? [entry.voiceOwnerId] : [])))];
  const actionCharacterIds = [...new Set(script.scenes.flatMap((scene) => scene.entries.flatMap((entry) => entry.type === "ACTION" ? [entry.subjectId, entry.objectId].filter((id): id is string => Boolean(id && scene.characterIds.includes(id))) : [])))];
  const characterIssues = characterBindings.length ? validateCharacterAuthorityBindings({ campaignId: raw.campaignId ?? raw.characterVersions?.[0]?.campaignId ?? "", bindings: characterBindings, versions: raw.characterVersions ?? [], referencedCharacterIds: characterIds, dialogueSpeakerIds, actionCharacterIds, availableAssetIds: raw.availableCharacterAssetIds }) : [];
  const castReferences = script.scenes.flatMap((scene) => scene.castReferences ?? []);
  const castIssues = castReferences.length ? validateCastReferences({
    campaignId: raw.campaignId ?? raw.characterVersions?.[0]?.campaignId ?? raw.supportingCharacterVersions?.[0]?.campaignId ?? "",
    storyId: script.storyId,
    sceneIds: new Set(script.scenes.map((scene) => scene.scriptSceneId)),
    references: castReferences,
    campaignCharacters: (raw.characterVersions ?? []).map((item) => ({ characterId: item.characterId, characterVersionId: item.characterVersionId, campaignId: item.campaignId, fingerprint: item.fingerprint, status: item.status, visualAssetReferences: item.visualAssetReferences })),
    supportingCharacters: raw.supportingCharacterVersions ?? [],
    availableAssetIds: raw.availableCharacterAssetIds,
    dialogueReferences: script.scenes.flatMap((scene) => scene.entries.flatMap((entry) => entry.type === "DIALOGUE" && entry.speakerCastReference ? [entry.speakerCastReference] : entry.type === "VO" && entry.voiceOwnerCastReference ? [entry.voiceOwnerCastReference] : [])),
    actionReferences: script.scenes.flatMap((scene) => scene.entries.flatMap((entry) => entry.type === "ACTION" ? [entry.subjectCastReference, entry.objectCastReference].filter((item): item is NonNullable<typeof item> => Boolean(item)) : [])),
    sceneRelationships: script.scenes.flatMap((scene) => scene.castRelationships ?? []),
  }) : [];
  const sceneIssues = raw.canonicalScenes ? validateAiStoryCanonicalScenes(raw.canonicalScenes, script, raw.locationVersions ?? []) : [];
  const handoffIssues = validateAiStoryScriptDirectorHandoff(handoff, script, { expectedSourceHash: computeAiStoryScriptDirectorHandoffSourceHash(handoff), expectedFingerprint: computeAiStoryScriptDirectorHandoffFingerprint(handoff), currentScriptVersionId: raw.currentAuthority.scriptVersionId });
  const directorIssues = projectedDirectorIssues(directorPlan, handoff, raw.canonicalScenes);
  const motionIssues = projectedMotionIssues(motionPlan, directorPlan, script);
  const profileIssues = [...validateAiStoryProductStoryProfile(outline, script), ...validateAiStoryCommercialStoryProfile(outline, script)];
  const upstream: Reason[] = [];
  if ([outline.status, script.status, directorPlan.status, motionPlan.status].some((value) => value !== "FROZEN")) upstream.push(reason("UPSTREAM_NOT_FROZEN", "Every canonical creative artifact must be frozen", "SCRIPT", "SCRIPT"));
  if (outline.sourceHash !== computeAiStoryOutlineSourceHash(outline)) upstream.push(reason("OUTLINE_SOURCE_HASH_MISMATCH", "Outline source fingerprint does not match frozen content", "OUTLINE", "OUTLINE"));
  if (script.sourceHash !== computeAiStoryScriptSourceHash(script)) upstream.push(reason("SCRIPT_SOURCE_HASH_MISMATCH", "Script source fingerprint does not match frozen content", "SCRIPT", "SCRIPT"));
  if (raw.currentAuthority.outlineVersionId !== outline.outlineVersionId || raw.currentAuthority.motionPlanId !== motionPlan.motionPlanId) upstream.push(reason("STALE_UPSTREAM_AUTHORITY", "QC input is not the current Outline/Motion authority", "MOTION", "MOTION"));
  if (raw.canonicalScenes && raw.canonicalScenes.some((scene) => scene.status !== "FROZEN")) upstream.push(reason("SCENE_NOT_FROZEN", "Every canonical Scene must be frozen", "SCENE", "SCENE"));
  if (raw.canonicalScenes && raw.canonicalScenes.some((scene) => !scene.generationAuthority)) upstream.push(reason("CANONICAL_SCENE_GENERATION_MODE_AUTHORITY_MISSING", "Every current Canonical Scene needs an explicit generation mode", "SCENE", "SCENE"));
  if (raw.canonicalScenes && raw.currentSceneVersionIds && JSON.stringify([...sceneVersionIds!].sort()) !== JSON.stringify([...raw.currentSceneVersionIds].sort())) upstream.push(reason("STALE_SCENE_AUTHORITY", "QC input is not the current canonical Scene set", "SCENE", "SCENE"));
  if (script.outlineVersionId !== outline.outlineVersionId || handoff.scriptVersionId !== script.scriptVersionId || directorPlan.handoffId !== handoff.handoffId || motionPlan.directorPlanId !== directorPlan.directorPlanId) upstream.push(reason("BROKEN_ARTIFACT_LINEAGE", "Writer-to-Motion lineage is not exact", "HANDOFF", "HANDOFF"));
  const productReasons: Reason[] = [];
  const productMap = new Map(products.map((product) => [product.productAuthorityId, product]));
  for (const binding of handoff.productAuthorityBindings) {
    const product = productMap.get(binding.productAuthorityId);
    if (!product || product.sourceAssetId !== binding.sourceAssetId || product.sourceAssetContentHash !== binding.sourceAssetContentHash) productReasons.push(reason("PRODUCT_IDENTITY_DRIFT", `Product binding ${binding.productAuthorityId} does not resolve to canonical authority`, "PRODUCT_AUTHORITY", "PRODUCT_AUTHORITY"));
  }
  const capabilityReasons: Reason[] = [];
  if (!capability.verified) capabilityReasons.push(reason("PROVIDER_CAPABILITY_UNVERIFIED", "Provider capability declaration is not certified", "PROVIDER_ADAPTER", "PROVIDER_ADAPTER"));
  if (compilation.requestedCapabilityId !== capability.capabilityId || !capability.supportedExecutionModes.includes(compilation.executionMode) || !capability.supportedTimingStructures.includes(compilation.timingStructure) || compilation.referenceRoles.some((role) => !capability.supportedReferenceRoles.includes(role))) capabilityReasons.push(reason("PROVIDER_CAPABILITY_UNSUPPORTED", "Requested execution requires an unsupported capability", "PROVIDER_ADAPTER", "PROVIDER_ADAPTER"));
  const results: AiStoryPreGenerationQcGateResult[] = [
    hard("UPSTREAM_ARTIFACT_INTEGRITY_GATE", [...upstream, ...has(sceneIssues, ["SCENE_VERSION_GATE", "SCENE_FINGERPRINT_GATE", "SCENE_ORDER_GATE", "SCENE_LINEAGE_GATE"], "SCENE", "SCENE"), ...outlineIssues.map((issue) => reason(issue.gate, issue.message, "OUTLINE", "OUTLINE")), ...profileIssues.filter((issue) => issue.severity === "BLOCK" && ["PRODUCT_PROFILE_BINDING_GATE", "COMMERCIAL_PROFILE_BINDING_GATE"].includes(issue.gate)).map((issue) => reason(issue.reasonCode, issue.message, "OUTLINE", "OUTLINE")), ...has(handoffIssues, ["SCRIPT_FROZEN_GATE", "SCRIPT_VERSION_BINDING_GATE", "HANDOFF_FINGERPRINT_GATE", "STALE_HANDOFF_GATE"], "HANDOFF", "HANDOFF"), ...blocked(directorIssues, ["HANDOFF_BINDING_GATE"], "DIRECTOR", "DIRECTOR"), ...blocked(motionIssues, ["DIRECTOR_BINDING_GATE"], "MOTION", "MOTION")], ids),
    hard("SCRIPT_REFERENCE_INTEGRITY_GATE", [...has(scriptIssues, ["SCRIPT_REFERENCE_INTEGRITY_GATE", "DIALOGUE_SPEAKER_GATE"], "SCRIPT", "SCRIPT"), ...characterIssues.map((issue) => reason(issue.gate, issue.message, "SCRIPT", "SCRIPT")), ...castIssues.map((issue) => reason(issue.gate, issue.message, "SCRIPT", "SCRIPT")), ...(raw.reusableCharacterIssues ?? []).map((issue) => reason(issue.gate, issue.message, "SCRIPT", "SCRIPT")), ...has(sceneIssues, ["LOCATION_REFERENCE_GATE", "LOCATION_SCOPE_GATE", "LOCATION_VERSION_GATE", "CAST_BINDING_GATE"], "SCENE", "SCENE")], ids),
    hard("BEAT_COVERAGE_GATE", has(scriptIssues, ["BEAT_CLAIM_GATE", "EXCLUSIVE_BEAT_CARDINALITY_GATE"], "SCRIPT", "SCRIPT"), ids),
    hard("SCENE_FUNCTION_GATE", [...has(scriptIssues, ["SCRIPT_SCENE_FUNCTION_GATE", "ACTION_BEAT_PRESENCE_GATE"], "SCRIPT", "SCRIPT"), ...has(sceneIssues, ["SCENE_ROLE_GATE", "SCENE_PURPOSE_GATE"], "SCENE", "SCENE"), ...profileIssues.filter((issue) => issue.severity === "BLOCK" && ["PRODUCT_INFORMATION_PROGRESSION_GATE", "OBJECTIVE_AWARE_BEAT_GATE", "SCRIPT_PRODUCT_PROFILE_BINDING_GATE", "SCRIPT_COMMERCIAL_PROFILE_BINDING_GATE", "NARRATIVE_HOOK_GATE", "SCENE_PURPOSE_PROGRESSION_GATE"].includes(issue.gate)).map((issue) => reason(issue.reasonCode, issue.message, "SCRIPT", "SCRIPT"))], ids),
    hard("SCRIPT_DUPLICATION_GATE", [...has(scriptIssues, ["SCRIPT_SCENE_DUPLICATION_GATE"], "SCRIPT", "SCRIPT"), ...profileIssues.filter((issue) => issue.severity === "BLOCK" && issue.gate === "REPEATED_HERO_ONLY_GATE").map((issue) => reason(issue.reasonCode, issue.message, "SCRIPT", "SCRIPT"))], ids),
    hard("SCRIPT_STATE_CONTINUITY_GATE", [...has(scriptIssues, ["STATE_CONTINUITY_GATE"], "SCRIPT", "SCRIPT"), ...has(sceneIssues, ["ENTRY_STATE_GATE", "EXIT_STATE_GATE", "SCENE_CONTINUITY_GATE", "TIME_RELATION_GATE", "DISCONTINUITY_GATE", "LOCATION_CONTINUITY_GATE"], "SCENE", "SCENE"), ...profileIssues.filter((issue) => issue.severity === "BLOCK" && ["CAUSAL_PROGRESSION_GATE", "STATE_CHANGE_GATE"].includes(issue.gate)).map((issue) => reason(issue.reasonCode, issue.message, "SCRIPT", "SCRIPT"))], ids),
    hard("SCRIPT_TIMING_FEASIBILITY_GATE", has(scriptIssues, ["TIMING_FEASIBILITY_GATE"], "SCRIPT", "SCRIPT"), ids),
    hard("HANDOFF_INTEGRITY_GATE", handoffIssues.map((issue) => reason(issue.gate, issue.message, "HANDOFF", "HANDOFF")), ids),
    hard("DIRECTOR_VISUAL_DIFFERENTIATION_GATE", blocked(directorIssues, ["DIFFERENTIATION_REQUIREMENT_GATE"], "DIRECTOR", "DIRECTOR"), ids),
    hard("SCRIPT_TRUTH_PRESERVATION_GATE", [...blocked(directorIssues, ["SCENE_IDENTITY_GATE", "CANONICAL_SCENE_BINDING_GATE", "SCRIPT_TRUTH_BINDING_GATE", "SCRIPT_ACTION_SUPPORT_GATE"], "DIRECTOR", "DIRECTOR"), ...blocked(motionIssues, ["SCRIPT_ACTION_TRUTH_GATE"], "MOTION", "MOTION")], ids),
    hard("MOTION_ACTION_COMPLETION_GATE", blocked(motionIssues, ["ACTION_COMPLETION_GATE", "ACTION_PATH_GATE"], "MOTION", "MOTION"), ids),
    hard("MOTION_PHYSICAL_PLAUSIBILITY_GATE", blocked(motionIssues, ["CAMERA_EXECUTION_GATE", "OBJECT_PERSISTENCE_GATE"], "MOTION", "MOTION"), ids),
    hard("MOTION_CONTINUITY_GATE", blocked(motionIssues, ["MOTION_CONTINUITY_GATE"], "MOTION", "MOTION"), ids),
    hard("PRODUCT_AUTHORITY_CAUSALITY_CONTINUITY_GATE", [...productReasons, ...has(sceneIssues, ["PRODUCT_BINDING_GATE"], "PRODUCT_AUTHORITY", "PRODUCT_AUTHORITY"), ...profileIssues.filter((issue) => issue.severity === "BLOCK" && ["PRODUCT_AUTHORITY_GATE", "CLAIM_EVIDENCE_GATE", "COMMERCIAL_INTEGRATION_GATE", "COMMERCIAL_PAYOFF_GATE", "MARKETING_INTENT_CONSUMPTION_GATE"].includes(issue.gate)).map((issue) => reason(issue.reasonCode, issue.message, "PRODUCT_AUTHORITY", "PRODUCT_AUTHORITY"))], ids),
    hard("MOTION_COMPLEXITY_GATE", blocked(motionIssues, ["MOTION_BUDGET_GATE"], "MOTION", "MOTION"), ids),
    hard("PRODUCT_GROUNDED_MOTION_SAFETY_GATE", [...blocked(directorIssues, ["PRODUCT_CAMERA_SAFETY_GATE"], "DIRECTOR", "DIRECTOR"), ...blocked(motionIssues, ["PRODUCT_GROUNDED_MOTION_GATE"], "MOTION", "MOTION")], ids),
    hard("PROVIDER_CAPABILITY_GATE", capabilityReasons, ids),
    hard("PROVIDER_COMPILATION_READINESS_GATE", compilation.providerNeutralInputsComplete ? [] : [reason("PROVIDER_NEUTRAL_INPUT_INCOMPLETE", "Required provider-neutral compilation input is missing", "PROVIDER_ADAPTER", "PROVIDER_ADAPTER")], ids),
    hard("CINEMATIC_CAMERA_GRAMMAR_GATE", blocked(directorIssues, ["CINEMATIC_CAMERA_GRAMMAR_GATE"], "DIRECTOR", "DIRECTOR"), ids),
    hard("SUBJECT_MOTION_FIRST_CLASS_GATE", blocked(motionIssues, ["SUBJECT_MOTION_FIRST_CLASS_GATE"], "MOTION", "MOTION"), ids),
    hard("SUBJECT_MOTION_COMPLETION_GATE", blocked(motionIssues, ["SUBJECT_MOTION_COMPLETION_GATE"], "MOTION", "MOTION"), ids),
    hard("CONTINUITY_NOT_DUPLICATION_GATE", blocked(directorIssues, ["CONTINUITY_NOT_DUPLICATION_GATE"], "DIRECTOR", "DIRECTOR"), ids),
    hard("CINEMATIC_EXECUTION_CONTRACT_GATE", directorPlan.sceneDirections.some((scene) => !scene.purpose || scene.shots.some((shot) => !shot.information)) ? [reason("PROJECTED_EXECUTION_EVIDENCE_REQUIRED", "Projected Scene purpose or Shot information is missing", "DIRECTOR", "DIRECTOR")] : [], ids),
    hard("MUST_KEEP_MUST_CHANGE_SEPARATION_GATE", blocked(directorIssues, ["MUST_KEEP_MUST_CHANGE_SEPARATION_GATE"], "DIRECTOR", "DIRECTOR"), ids),
    hard("ANTI_PPT_CREATIVE_GATE", [], ids),
    hard("INTRA_SCENE_SHOT_PROGRESSION_GATE", blocked(directorIssues, ["INTRA_SCENE_SHOT_PROGRESSION_GATE"], "DIRECTOR", "DIRECTOR"), ids),
    hard("GENERATION_UNIT_COVERAGE_GATE", directorPlan.sceneDirections.some((scene) => scene.shots.length < 1) ? [reason("PROJECTED_SHOT_COVERAGE_REQUIRED", "Projected Scene has no Shot Plan coverage", "DIRECTOR", "DIRECTOR")] : [], ids),
    hard("GENERATION_UNIT_BINDING_GATE", blocked(directorIssues, ["GENERATION_UNIT_BINDING_GATE"], "DIRECTOR", "DIRECTOR"), ids),
  ];
  if (results.map((result) => result.gateId).join("|") !== AI_STORY_PRE_GENERATION_QC_GATE_ORDER.join("|")) {
    throw new Error("PROJECTED_QC_GATE_ORDER_MISMATCH");
  }
  const profileWarnings = profileIssues.filter((issue) => issue.severity === "WARN");
  if (profileWarnings.length) {
    const gate = results.find((result) => result.gateId === "PRODUCT_AUTHORITY_CAUSALITY_CONTINUITY_GATE")!;
    if (gate.status === "PASS") {
      gate.classification = "SOFT_WARNING";
      gate.status = "WARN";
      gate.reasonCode = profileWarnings[0]!.reasonCode;
      gate.safeEvidence = profileWarnings.map((issue) => issue.message);
    }
  }
  const blocks = results.some((result) => result.status === "BLOCK");
  const warnings = results.some((result) => result.status === "WARN");
  const dispatchDecision: AiStoryPreGenerationQcEvaluation["dispatchDecision"] = blocks ? "DISPATCH_BLOCKED" : warnings ? "DISPATCH_ELIGIBLE_WITH_WARNINGS" : "DISPATCH_ELIGIBLE";
  const base = {
    orgId: script.orgId,
    workspaceId: script.workspaceId,
    ...ids,
    contractVersion: AI_STORY_PRE_GENERATION_QC_CONTRACT_VERSION,
    gateSetVersion: AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION,
    providerCapabilityId: capability.capabilityId,
    providerCapabilityVersion: capability.capabilityVersion,
    productAuthorityIds: [...productMap.keys()].sort(),
    gateResults: results,
    dispatchDecision,
    preDispatchBlocked: blocks,
    providerCallAvoided: blocks,
    estimatedAttemptCostAvoidedUsd: blocks ? capability.estimatedAttemptCostUsd : null,
    sceneFunction: handoff.sceneHandoffs[0]?.sceneFunction ?? "UNKNOWN",
    visualRole: directorPlan.sceneDirections[0]?.sceneFunction ?? "UNKNOWN",
    cameraFamily: directorPlan.sceneDirections[0]?.shots[0]?.cameraMovement ?? "UNKNOWN",
    motionRiskClass: motionPlan.sceneMotionPlans.some((scene) => scene.measuredFacts.productIdentitySensitive && scene.physicalCompletion.state === "NOT_ASSERTED") ? "HIGH" as const : motionPlan.sceneMotionPlans.some((scene) => scene.shots.some((shot) => shot.cameraMovement !== "none")) ? "MODERATE" as const : "LOW" as const,
    productGrounded: handoff.productAuthorityBindings.length > 0,
    profileId: script.profileId,
    evaluatedBy: raw.evaluatedBy,
    evaluatedAt: raw.evaluatedAt,
  };
  const qcFingerprint = computeAiStoryPreGenerationQcFingerprint(base);
  return AiStoryPreGenerationQcEvaluationSchema.parse({ ...base, qcEvaluationId: deterministicUuidFromFingerprint("ai-story-pre-generation-qc", `${compilation.sceneExecutionId}:${qcFingerprint}`), qcFingerprint });
}
