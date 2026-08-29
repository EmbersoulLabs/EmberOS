import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import { validateAiStoryOutline, type AiStoryOutlineVersion } from "./ai-story-outline";
import { validateAiStoryScript, type AiStoryScriptVersion } from "./ai-story-script";
import { validateAiStoryScriptDirectorHandoff, type AiStoryScriptDirectorHandoff } from "./ai-story-script-director-handoff";
import { validateAiStoryDirectorPlan, type AiStoryDirectorPlan } from "./ai-story-director-plan";
import { validateAiStoryMotionPlan, type AiStoryMotionPlan } from "./ai-story-motion-plan";
import { computeAiStoryScriptDirectorHandoffFingerprint, computeAiStoryScriptDirectorHandoffSourceHash } from "./ai-story-script-director-handoff.server";
import { computeAiStoryDirectorPlanFingerprint, computeAiStoryDirectorPlanSourceHash } from "./ai-story-director-plan.server";
import { computeAiStoryMotionPlanFingerprint, computeAiStoryMotionPlanSourceHash } from "./ai-story-motion-plan.server";
import { computeAiStoryOutlineSourceHash } from "./ai-story-outline.server";
import { computeAiStoryScriptSourceHash } from "./ai-story-script.server";
import {
  AI_STORY_PRE_GENERATION_QC_CONTRACT_VERSION, AI_STORY_PRE_GENERATION_QC_GATE_ORDER,
  AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION, AiStoryPreGenerationQcCompilationRequestSchema,
  AiStoryPreGenerationQcEvaluationSchema, AiStoryPreGenerationQcProductAuthoritySchema,
  AiStoryPreGenerationQcProviderCapabilitySchema, type AiStoryPreGenerationQcEvaluation,
  type AiStoryPreGenerationQcGateId, type AiStoryPreGenerationQcGateResult,
} from "./ai-story-pre-generation-qc";

type Reason = { code:string; evidence:string; layer:AiStoryPreGenerationQcGateResult["failedLayer"]; owner:AiStoryPreGenerationQcGateResult["repairOwner"] };
export type AiStoryPreGenerationQcInput = {
  outline:AiStoryOutlineVersion; script:AiStoryScriptVersion; handoff:AiStoryScriptDirectorHandoff;
  directorPlan:AiStoryDirectorPlan; motionPlan:AiStoryMotionPlan;
  productAuthority:Array<{productAuthorityId:string;sourceAssetId:string;sourceAssetContentHash:string}>;
  providerCapability:{capabilityId:string;capabilityVersion:string;supportedExecutionModes:string[];supportedReferenceRoles:string[];supportedTimingStructures:string[];estimatedAttemptCostUsd:number|null;verified:boolean};
  compilationRequest:{sceneExecutionId:string;requestedCapabilityId:string;executionMode:string;referenceRoles:string[];timingStructure:string;providerNeutralInputsComplete:boolean};
  currentAuthority:{outlineVersionId:string;scriptVersionId:string;handoffId:string;directorPlanId:string;motionPlanId:string};
  knownAuthorityReferences?:ReadonlySet<string>; evaluatedBy:string; evaluatedAt:string;
  assistanceFindings?:Array<{classification:"AI_QC"|"HUMAN_PREVIEW";message:string}>;
};

const hard=(gateId:AiStoryPreGenerationQcGateId,reasons:Reason[],ids:AiStoryPreGenerationQcGateResult["evaluatedArtifactIds"]):AiStoryPreGenerationQcGateResult=>({gateId,gateVersion:1,classification:"HARD_GATE",status:reasons.length?"BLOCK":"PASS",failedLayer:reasons[0]?.layer??null,reasonCode:reasons[0]?.code??"PASS",safeEvidence:reasons.map(r=>r.evidence),repairOwner:reasons[0]?.owner??"NONE",evaluatedArtifactIds:ids,contractVersion:AI_STORY_PRE_GENERATION_QC_CONTRACT_VERSION});
const reason=(code:string,evidence:string,layer:Reason["layer"],owner:Reason["owner"]):Reason=>({code,evidence,layer,owner});
const has=(issues:readonly {gate:string;message:string}[],gates:readonly string[],layer:Reason["layer"],owner:Reason["owner"])=>(issues.filter(i=>gates.includes(i.gate)).map(i=>reason(i.gate,i.message,layer,owner)));

export function computeAiStoryPreGenerationQcFingerprint(input:Pick<AiStoryPreGenerationQcEvaluation,"orgId"|"workspaceId"|"storyId"|"storyVersionId"|"outlineVersionId"|"scriptVersionId"|"handoffId"|"directorPlanId"|"motionPlanId"|"sceneExecutionId"|"gateSetVersion"|"providerCapabilityId"|"providerCapabilityVersion"|"productAuthorityIds"|"gateResults"|"dispatchDecision">){
  return sha256CanonicalIntegrityHash({contractVersion:AI_STORY_PRE_GENERATION_QC_CONTRACT_VERSION,orgId:input.orgId,workspaceId:input.workspaceId,storyId:input.storyId,storyVersionId:input.storyVersionId,outlineVersionId:input.outlineVersionId,scriptVersionId:input.scriptVersionId,handoffId:input.handoffId,directorPlanId:input.directorPlanId,motionPlanId:input.motionPlanId,sceneExecutionId:input.sceneExecutionId,gateSetVersion:input.gateSetVersion,providerCapabilityId:input.providerCapabilityId,providerCapabilityVersion:input.providerCapabilityVersion,productAuthorityIds:input.productAuthorityIds,gateResults:input.gateResults,dispatchDecision:input.dispatchDecision});
}

export function evaluateAiStoryPreGenerationQc(raw:AiStoryPreGenerationQcInput):AiStoryPreGenerationQcEvaluation {
  const capability=AiStoryPreGenerationQcProviderCapabilitySchema.parse(raw.providerCapability);
  const compilation=AiStoryPreGenerationQcCompilationRequestSchema.parse(raw.compilationRequest);
  const products=raw.productAuthority.map(v=>AiStoryPreGenerationQcProductAuthoritySchema.parse(v));
  const {outline,script,handoff,directorPlan,motionPlan}=raw;
  const ids={storyId:script.storyId,storyVersionId:script.storyVersionId,outlineVersionId:outline.outlineVersionId,scriptVersionId:script.scriptVersionId,handoffId:handoff.handoffId,directorPlanId:directorPlan.directorPlanId,motionPlanId:motionPlan.motionPlanId,sceneExecutionId:compilation.sceneExecutionId};
  const outlineIssues=validateAiStoryOutline(outline,{knownAuthorityReferences:raw.knownAuthorityReferences});
  const scriptIssues=validateAiStoryScript(script,outline,{knownAuthorityReferences:raw.knownAuthorityReferences});
  const handoffIssues=validateAiStoryScriptDirectorHandoff(handoff,script,{expectedSourceHash:computeAiStoryScriptDirectorHandoffSourceHash(handoff),expectedFingerprint:computeAiStoryScriptDirectorHandoffFingerprint(handoff),currentScriptVersionId:raw.currentAuthority.scriptVersionId});
  const directorIssues=validateAiStoryDirectorPlan(directorPlan,handoff,{expectedSourceHash:computeAiStoryDirectorPlanSourceHash(directorPlan),expectedFingerprint:computeAiStoryDirectorPlanFingerprint(directorPlan),currentHandoffId:raw.currentAuthority.handoffId});
  const motionIssues=validateAiStoryMotionPlan(motionPlan,directorPlan,handoff,{expectedSourceHash:computeAiStoryMotionPlanSourceHash(motionPlan),expectedFingerprint:computeAiStoryMotionPlanFingerprint(motionPlan),currentDirectorPlanId:raw.currentAuthority.directorPlanId});
  const upstream:Reason[]=[];
  if([outline.status,script.status,directorPlan.status,motionPlan.status].some(v=>v!=="FROZEN"))upstream.push(reason("UPSTREAM_NOT_FROZEN","Every canonical creative artifact must be frozen","SCRIPT","SCRIPT"));
  if(outline.sourceHash!==computeAiStoryOutlineSourceHash(outline))upstream.push(reason("OUTLINE_SOURCE_HASH_MISMATCH","Outline source fingerprint does not match frozen content","OUTLINE","OUTLINE"));
  if(script.sourceHash!==computeAiStoryScriptSourceHash(script))upstream.push(reason("SCRIPT_SOURCE_HASH_MISMATCH","Script source fingerprint does not match frozen content","SCRIPT","SCRIPT"));
  if(raw.currentAuthority.outlineVersionId!==outline.outlineVersionId||raw.currentAuthority.motionPlanId!==motionPlan.motionPlanId)upstream.push(reason("STALE_UPSTREAM_AUTHORITY","QC input is not the current Outline/Motion authority","MOTION","MOTION"));
  if(script.outlineVersionId!==outline.outlineVersionId||handoff.scriptVersionId!==script.scriptVersionId||directorPlan.handoffId!==handoff.handoffId||motionPlan.directorPlanId!==directorPlan.directorPlanId)upstream.push(reason("BROKEN_ARTIFACT_LINEAGE","Writer-to-Motion lineage is not exact","HANDOFF","HANDOFF"));
  const productReasons:Reason[]=[];const productMap=new Map(products.map(p=>[p.productAuthorityId,p]));
  for(const binding of handoff.productAuthorityBindings){const p=productMap.get(binding.productAuthorityId);if(!p||p.sourceAssetId!==binding.sourceAssetId||p.sourceAssetContentHash!==binding.sourceAssetContentHash)productReasons.push(reason("PRODUCT_IDENTITY_DRIFT",`Product binding ${binding.productAuthorityId} does not resolve to canonical authority`,"PRODUCT_AUTHORITY","PRODUCT_AUTHORITY"));}
  productReasons.push(...has(directorIssues,["PRODUCT_AUTHORITY_BINDING_GATE"],"PRODUCT_AUTHORITY","PRODUCT_AUTHORITY"),...has(motionIssues,["PRODUCT_CAUSALITY_GATE","OBJECT_PERSISTENCE_GATE","MOTION_CONTINUITY_GATE"],"MOTION","MOTION"));
  const capabilityReasons:Reason[]=[];
  if(!capability.verified)capabilityReasons.push(reason("PROVIDER_CAPABILITY_UNVERIFIED","Provider capability declaration is not certified","PROVIDER_ADAPTER","PROVIDER_ADAPTER"));
  if(compilation.requestedCapabilityId!==capability.capabilityId||!capability.supportedExecutionModes.includes(compilation.executionMode)||!capability.supportedTimingStructures.includes(compilation.timingStructure)||compilation.referenceRoles.some(r=>!capability.supportedReferenceRoles.includes(r)))capabilityReasons.push(reason("PROVIDER_CAPABILITY_UNSUPPORTED","Requested execution requires an unsupported capability","PROVIDER_ADAPTER","PROVIDER_ADAPTER"));
  const results:AiStoryPreGenerationQcGateResult[]=[
    hard("UPSTREAM_ARTIFACT_INTEGRITY_GATE",[...upstream,...outlineIssues.map(i=>reason(i.gate,i.message,"OUTLINE","OUTLINE")),...has(handoffIssues,["SCRIPT_FROZEN_GATE","SCRIPT_VERSION_BINDING_GATE","HANDOFF_FINGERPRINT_GATE","STALE_HANDOFF_GATE"],"HANDOFF","HANDOFF"),...has(directorIssues,["HANDOFF_FROZEN_GATE","HANDOFF_BINDING_GATE","DIRECTOR_FINGERPRINT_GATE","STALE_DIRECTOR_PLAN_GATE"],"DIRECTOR","DIRECTOR"),...has(motionIssues,["DIRECTOR_BINDING_GATE","MOTION_FINGERPRINT_GATE","STALE_DIRECTOR_GATE"],"MOTION","MOTION")],ids),
    hard("SCRIPT_REFERENCE_INTEGRITY_GATE",has(scriptIssues,["SCRIPT_REFERENCE_INTEGRITY_GATE","DIALOGUE_SPEAKER_GATE"],"SCRIPT","SCRIPT"),ids),
    hard("BEAT_COVERAGE_GATE",has(scriptIssues,["BEAT_CLAIM_GATE","EXCLUSIVE_BEAT_CARDINALITY_GATE"],"SCRIPT","SCRIPT"),ids),
    hard("SCENE_FUNCTION_GATE",has(scriptIssues,["SCRIPT_SCENE_FUNCTION_GATE","ACTION_BEAT_PRESENCE_GATE"],"SCRIPT","SCRIPT"),ids),
    hard("SCRIPT_DUPLICATION_GATE",has(scriptIssues,["SCRIPT_SCENE_DUPLICATION_GATE"],"SCRIPT","SCRIPT"),ids),
    hard("SCRIPT_STATE_CONTINUITY_GATE",has(scriptIssues,["STATE_CONTINUITY_GATE"],"SCRIPT","SCRIPT"),ids),
    hard("SCRIPT_TIMING_FEASIBILITY_GATE",has(scriptIssues,["TIMING_FEASIBILITY_GATE"],"SCRIPT","SCRIPT"),ids),
    hard("HANDOFF_INTEGRITY_GATE",handoffIssues.map(i=>reason(i.gate,i.message,"HANDOFF","HANDOFF")),ids),
    hard("DIRECTOR_VISUAL_DIFFERENTIATION_GATE",has(directorIssues,["NEW_AUDIENCE_INFORMATION_GATE","DIFFERENTIATION_REQUIREMENT_GATE","DIRECTOR_VISUAL_DUPLICATION_GATE"],"DIRECTOR","DIRECTOR"),ids),
    hard("SCRIPT_TRUTH_PRESERVATION_GATE",[...has(directorIssues,["SCENE_IDENTITY_GATE","SCRIPT_TRUTH_BINDING_GATE","SCRIPT_ACTION_SUPPORT_GATE"],"DIRECTOR","DIRECTOR"),...has(motionIssues,["SCRIPT_ACTION_TRUTH_GATE"],"MOTION","MOTION")],ids),
    hard("MOTION_ACTION_COMPLETION_GATE",has(motionIssues,["START_STATE_GATE","ACTION_PATH_GATE","END_STATE_GATE","ACTION_COMPLETION_GATE","CONTACT_REQUIREMENT_GATE","FORCE_RESPONSE_GATE"],"MOTION","MOTION"),ids),
    hard("MOTION_PHYSICAL_PLAUSIBILITY_GATE",has(motionIssues,["PHYSICAL_PLAUSIBILITY_GATE","OBJECT_PERSISTENCE_GATE","BLOCKING_EXECUTION_GATE","CAMERA_EXECUTION_GATE","FOCUS_EXECUTION_GATE"],"MOTION","MOTION"),ids),
    hard("MOTION_CONTINUITY_GATE",has(motionIssues,["MOTION_CONTINUITY_GATE"],"MOTION","MOTION"),ids),
    hard("PRODUCT_AUTHORITY_CAUSALITY_CONTINUITY_GATE",productReasons,ids),
    hard("MOTION_COMPLEXITY_GATE",has(motionIssues,["MOTION_BUDGET_GATE"],"MOTION","MOTION"),ids),
    hard("PRODUCT_GROUNDED_MOTION_SAFETY_GATE",[...has(directorIssues,["PRODUCT_CAMERA_SAFETY_GATE"],"DIRECTOR","DIRECTOR"),...has(motionIssues,["PRODUCT_GROUNDED_MOTION_GATE"],"MOTION","MOTION")],ids),
    hard("PROVIDER_CAPABILITY_GATE",capabilityReasons,ids),
    hard("PROVIDER_COMPILATION_READINESS_GATE",compilation.providerNeutralInputsComplete?[]:[reason("PROVIDER_NEUTRAL_INPUT_INCOMPLETE","Required provider-neutral compilation input is missing","PROVIDER_ADAPTER","PROVIDER_ADAPTER")],ids),
  ];
  const repeatedCamera=directorPlan.sceneDirections.flatMap(s=>s.shots.map(x=>x.cameraFamily)).some((v,i,a)=>a.indexOf(v)!==i);
  if(repeatedCamera&&!results.some(r=>r.gateId==="DIRECTOR_VISUAL_DIFFERENTIATION_GATE"&&r.status==="BLOCK")){const r=results.find(x=>x.gateId==="DIRECTOR_VISUAL_DIFFERENTIATION_GATE")!;r.classification="SOFT_WARNING";r.status="WARN";r.reasonCode="CAMERA_FAMILY_REPEATED_WITH_VALID_DELTA";r.safeEvidence=["Camera-family repetition alone is not duplication"]}
  if(raw.assistanceFindings?.length&&!results.some(r=>r.gateId==="DIRECTOR_VISUAL_DIFFERENTIATION_GATE"&&r.status==="BLOCK")){const r=results.find(x=>x.gateId==="DIRECTOR_VISUAL_DIFFERENTIATION_GATE")!;if(r.status==="PASS"){r.classification=raw.assistanceFindings.some(f=>f.classification==="HUMAN_PREVIEW")?"HUMAN_PREVIEW":"AI_QC";r.status="WARN";r.reasonCode="SUBJECTIVE_QUALITY_ASSISTANCE_ONLY";r.safeEvidence=raw.assistanceFindings.map(f=>f.message)}}
  const blocks=results.some(r=>r.status==="BLOCK");const warnings=results.some(r=>r.status==="WARN")||Boolean(raw.assistanceFindings?.length);
  const dispatchDecision:AiStoryPreGenerationQcEvaluation["dispatchDecision"]=blocks?"DISPATCH_BLOCKED":warnings?"DISPATCH_ELIGIBLE_WITH_WARNINGS":"DISPATCH_ELIGIBLE";
  const base={orgId:script.orgId,workspaceId:script.workspaceId,...ids,contractVersion:AI_STORY_PRE_GENERATION_QC_CONTRACT_VERSION,gateSetVersion:AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION,providerCapabilityId:capability.capabilityId,providerCapabilityVersion:capability.capabilityVersion,productAuthorityIds:[...productMap.keys()].sort(),gateResults:results,dispatchDecision,preDispatchBlocked:blocks,providerCallAvoided:blocks,estimatedAttemptCostAvoidedUsd:blocks?capability.estimatedAttemptCostUsd:null,sceneFunction:handoff.sceneHandoffs[0]?.sceneFunction??"UNKNOWN",visualRole:directorPlan.sceneDirections[0]?.sceneVisualRole??"UNKNOWN",cameraFamily:directorPlan.sceneDirections[0]?.shots[0]?.cameraFamily??"UNKNOWN",motionRiskClass:motionPlan.sceneMotionPlans.some(s=>s.motionBudget.riskFactors.length>=3)?"HIGH":motionPlan.sceneMotionPlans.some(s=>s.motionBudget.riskFactors.length>0)?"MODERATE":"LOW",productGrounded:handoff.productAuthorityBindings.length>0,profileId:script.profileId,evaluatedBy:raw.evaluatedBy,evaluatedAt:raw.evaluatedAt};
  const qcFingerprint=computeAiStoryPreGenerationQcFingerprint(base);return AiStoryPreGenerationQcEvaluationSchema.parse({...base,qcEvaluationId:deterministicUuidFromFingerprint("ai-story-pre-generation-qc",`${compilation.sceneExecutionId}:${qcFingerprint}`),qcFingerprint});
}

export function validateAiStoryPreGenerationQcFingerprint(evaluation:AiStoryPreGenerationQcEvaluation){return evaluation.qcFingerprint===computeAiStoryPreGenerationQcFingerprint(evaluation);}
export function assertAiStoryPreGenerationQcCurrent(evaluation:AiStoryPreGenerationQcEvaluation,current:{outlineVersionId:string;scriptVersionId:string;handoffId:string;directorPlanId:string;motionPlanId:string}){if(evaluation.outlineVersionId!==current.outlineVersionId||evaluation.scriptVersionId!==current.scriptVersionId||evaluation.handoffId!==current.handoffId||evaluation.directorPlanId!==current.directorPlanId||evaluation.motionPlanId!==current.motionPlanId)throw new Error("STALE_PREGEN_QC_DENIED");}
export function assertAiStoryPreGenerationDispatchEligible(evaluation:AiStoryPreGenerationQcEvaluation){if(evaluation.dispatchDecision==="DISPATCH_BLOCKED"||!validateAiStoryPreGenerationQcFingerprint(evaluation))throw new Error("PREGEN_QC_DISPATCH_BLOCKED");return{qcEvaluationId:evaluation.qcEvaluationId,qcFingerprint:evaluation.qcFingerprint,dispatchDecision:evaluation.dispatchDecision};}
