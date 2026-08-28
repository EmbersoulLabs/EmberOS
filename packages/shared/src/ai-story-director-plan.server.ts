import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import { AI_STORY_DIRECTOR_PLAN_CONTRACT_VERSION, AiStoryDirectorPlanSchema, type AiStoryDirectorPlan, type AiStoryDirectorSceneDirection } from "./ai-story-director-plan";
import type { AiStoryScriptDirectorHandoff } from "./ai-story-script-director-handoff";

export function computeAiStoryDirectorPlanSourceHash(input: Pick<AiStoryDirectorPlan,"storyId"|"storyVersionId"|"outlineVersionId"|"scriptVersionId"|"handoffId"|"sourceHandoffFingerprint"|"orgId"|"workspaceId"|"version"|"supersedesDirectorPlanId">) {
  return sha256CanonicalIntegrityHash({ contractVersion:AI_STORY_DIRECTOR_PLAN_CONTRACT_VERSION,storyId:input.storyId,storyVersionId:input.storyVersionId,outlineVersionId:input.outlineVersionId,scriptVersionId:input.scriptVersionId,handoffId:input.handoffId,sourceHandoffFingerprint:input.sourceHandoffFingerprint,orgId:input.orgId,workspaceId:input.workspaceId,version:input.version,supersedesDirectorPlanId:input.supersedesDirectorPlanId });
}
export function computeAiStoryDirectorPlanFingerprint(input: Pick<AiStoryDirectorPlan,"storyId"|"storyVersionId"|"outlineVersionId"|"scriptVersionId"|"handoffId"|"sourceHandoffFingerprint"|"orgId"|"workspaceId"|"version"|"sceneDirections"|"sourceHash"|"supersedesDirectorPlanId">) {
  return sha256CanonicalIntegrityHash({ contractVersion:AI_STORY_DIRECTOR_PLAN_CONTRACT_VERSION,storyId:input.storyId,storyVersionId:input.storyVersionId,outlineVersionId:input.outlineVersionId,scriptVersionId:input.scriptVersionId,handoffId:input.handoffId,sourceHandoffFingerprint:input.sourceHandoffFingerprint,orgId:input.orgId,workspaceId:input.workspaceId,version:input.version,sceneDirections:input.sceneDirections,sourceHash:input.sourceHash,supersedesDirectorPlanId:input.supersedesDirectorPlanId });
}
export function buildAiStoryDirectorPlan(input:{handoff:AiStoryScriptDirectorHandoff;sceneDirections:AiStoryDirectorSceneDirection[];version:number;supersedesDirectorPlanId:string|null;createdBy:string;createdAt:string}):AiStoryDirectorPlan {
  const base={storyId:input.handoff.storyId,storyVersionId:input.handoff.storyVersionId,outlineVersionId:input.handoff.outlineVersionId,scriptVersionId:input.handoff.scriptVersionId,handoffId:input.handoff.handoffId,sourceHandoffFingerprint:input.handoff.handoffFingerprint,orgId:input.handoff.orgId,workspaceId:input.handoff.workspaceId,version:input.version,sceneDirections:input.sceneDirections,supersedesDirectorPlanId:input.supersedesDirectorPlanId};
  const sourceHash=computeAiStoryDirectorPlanSourceHash(base);
  const directorFingerprint=computeAiStoryDirectorPlanFingerprint({...base,sourceHash});
  return AiStoryDirectorPlanSchema.parse({...base,directorPlanId:deterministicUuidFromFingerprint("ai-story-director-plan",`${input.handoff.handoffId}:${directorFingerprint}`),contractVersion:AI_STORY_DIRECTOR_PLAN_CONTRACT_VERSION,sourceHash,directorFingerprint,status:"DRAFT",createdBy:input.createdBy,createdAt:input.createdAt,approvedBy:null,approvedAt:null,frozenAt:null});
}
