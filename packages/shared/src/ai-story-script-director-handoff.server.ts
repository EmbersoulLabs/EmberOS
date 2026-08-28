import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AI_STORY_SCRIPT_DIRECTOR_HANDOFF_CONTRACT_VERSION,
  AiStoryScriptDirectorHandoffSchema,
  projectAiStoryScriptSceneHandoffs,
  type AiStoryDirectorHandoffProductBinding,
  type AiStoryScriptDirectorHandoff,
} from "./ai-story-script-director-handoff";
import type { AiStoryScriptVersion } from "./ai-story-script";

export function deriveProductBindingRoles(script: AiStoryScriptVersion, productAuthorityId: string): AiStoryDirectorHandoffProductBinding["requiredRoles"] {
  const scenes = script.scenes.filter((scene) => scene.productAuthorityRefs.includes(productAuthorityId));
  const roles = new Set<AiStoryDirectorHandoffProductBinding["requiredRoles"][number]>(["PRESENT"]);
  if (scenes.some((scene) => ["PRODUCT_USAGE", "PRODUCT_BENEFIT_PROOF", "PRODUCT_PAYOFF"].includes(scene.sceneFunction))) roles.add("PARTICIPATING");
  if (scenes.some((scene) => scene.productEvidence.length > 0)) roles.add("EVIDENCE_REQUIRED");
  return [...roles];
}

export function computeAiStoryScriptDirectorHandoffSourceHash(input: Pick<AiStoryScriptDirectorHandoff, "storyId" | "storyVersionId" | "outlineVersionId" | "scriptVersionId" | "scriptSourceHash" | "orgId" | "workspaceId" | "version" | "supersedesHandoffId">) {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_SCRIPT_DIRECTOR_HANDOFF_CONTRACT_VERSION,
    storyId: input.storyId, storyVersionId: input.storyVersionId, outlineVersionId: input.outlineVersionId,
    scriptVersionId: input.scriptVersionId, scriptSourceHash: input.scriptSourceHash, orgId: input.orgId,
    workspaceId: input.workspaceId, version: input.version, supersedesHandoffId: input.supersedesHandoffId,
  });
}

export function computeAiStoryScriptDirectorHandoffFingerprint(input: Pick<AiStoryScriptDirectorHandoff, "storyId" | "storyVersionId" | "outlineVersionId" | "scriptVersionId" | "scriptSourceHash" | "orgId" | "workspaceId" | "version" | "sceneHandoffs" | "productAuthorityBindings" | "characterWorldRefs" | "sourceHash" | "supersedesHandoffId">) {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_SCRIPT_DIRECTOR_HANDOFF_CONTRACT_VERSION,
    storyId: input.storyId, storyVersionId: input.storyVersionId, outlineVersionId: input.outlineVersionId,
    scriptVersionId: input.scriptVersionId, scriptSourceHash: input.scriptSourceHash, orgId: input.orgId,
    workspaceId: input.workspaceId, version: input.version, sceneHandoffs: input.sceneHandoffs,
    productAuthorityBindings: input.productAuthorityBindings, characterWorldRefs: input.characterWorldRefs,
    sourceHash: input.sourceHash, supersedesHandoffId: input.supersedesHandoffId,
  });
}

export function buildAiStoryScriptDirectorHandoff(input: {
  script: AiStoryScriptVersion;
  productAuthorityBindings: AiStoryDirectorHandoffProductBinding[];
  supersedesHandoffId: string | null;
  createdBy: string;
  createdAt: string;
}): AiStoryScriptDirectorHandoff {
  if (input.script.status !== "FROZEN") throw new Error("SCRIPT_NOT_FROZEN");
  const base = {
    storyId: input.script.storyId, storyVersionId: input.script.storyVersionId, outlineVersionId: input.script.outlineVersionId,
    scriptVersionId: input.script.scriptVersionId, scriptSourceHash: input.script.sourceHash,
    orgId: input.script.orgId, workspaceId: input.script.workspaceId, version: input.script.version,
    sceneHandoffs: projectAiStoryScriptSceneHandoffs(input.script),
    productAuthorityBindings: [...input.productAuthorityBindings].sort((a, b) => a.productAuthorityId.localeCompare(b.productAuthorityId)),
    characterWorldRefs: input.script.authorityReferences.filter((ref) => ["CHARACTER", "LOCATION", "PROP"].includes(ref.authorityType)),
    supersedesHandoffId: input.supersedesHandoffId,
  };
  const sourceHash = computeAiStoryScriptDirectorHandoffSourceHash(base);
  const handoffFingerprint = computeAiStoryScriptDirectorHandoffFingerprint({ ...base, sourceHash });
  return AiStoryScriptDirectorHandoffSchema.parse({
    ...base,
    handoffId: deterministicUuidFromFingerprint("ai-story-script-director-handoff", `${input.script.storyId}:${input.script.scriptVersionId}:${handoffFingerprint}`),
    contractVersion: AI_STORY_SCRIPT_DIRECTOR_HANDOFF_CONTRACT_VERSION,
    sourceHash,
    handoffFingerprint,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    frozenAt: input.createdAt,
  });
}
