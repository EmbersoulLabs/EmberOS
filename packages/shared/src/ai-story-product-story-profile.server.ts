import { sha256CanonicalIntegrityHash } from "./canonical-integrity";
import type { AiStoryOutlineVersion } from "./ai-story-outline";
import type { AiStoryScriptVersion } from "./ai-story-script";
import {
  AI_STORY_PRODUCT_STORY_PROFILE_ID,
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY,
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  type AiStoryProductStoryProfileIssue,
  resolveAiStoryProductStoryObjectivePolicy,
} from "./ai-story-product-story-profile";

export function computeAiStoryProductStoryProfilePolicyFingerprint() {
  return sha256CanonicalIntegrityHash(AI_STORY_PRODUCT_STORY_PROFILE_POLICY);
}

export function validateAiStoryProductStoryProfile(
  outline: AiStoryOutlineVersion,
  script?: AiStoryScriptVersion,
): AiStoryProductStoryProfileIssue[] {
  if (outline.profile.profileId !== AI_STORY_PRODUCT_STORY_PROFILE_ID) return [];
  const issues: AiStoryProductStoryProfileIssue[] = [];
  const add = (gate: AiStoryProductStoryProfileIssue["gate"], severity: AiStoryProductStoryProfileIssue["severity"], reasonCode: string, message: string) => issues.push({ gate, severity, reasonCode, message });
  const policy = outline.productStoryProfile;
  if (!policy || outline.profile.policyFingerprint !== AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT || computeAiStoryProductStoryProfilePolicyFingerprint() !== AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT) {
    add("PRODUCT_PROFILE_BINDING_GATE", "BLOCK", "PRODUCT_PROFILE_POLICY_MISMATCH", "PRODUCT_STORY must bind the immutable certified profile policy");
    return issues;
  }
  const beatIds = new Set(outline.beats.map((beat) => beat.id));
  const outcomeIds = new Set(outline.requiredSceneOutcomes.map((outcome) => outcome.outcomeId));
  const authorityRefs = new Set(outline.authorityReferences.filter((ref) => ref.authorityType === "PRODUCT").map((ref) => ref.authorityId));
  for (const id of policy.productAuthorityIds) if (!authorityRefs.has(id)) add("PRODUCT_AUTHORITY_GATE", "BLOCK", "PRODUCT_AUTHORITY_MISSING", `Product authority ${id} is not bound by the Outline`);
  for (const goal of policy.progressionGoals) {
    if (goal.beatIds.some((id) => !beatIds.has(id)) || goal.requiredSceneOutcomeIds.some((id) => !outcomeIds.has(id))) add("PRODUCT_INFORMATION_PROGRESSION_GATE", "BLOCK", "PRODUCT_GOAL_REFERENCE_INVALID", `Product progression goal ${goal.goalId} has a dangling authority reference`);
  }
  for (const claim of policy.claimEvidence) {
    if (!policy.productAuthorityIds.includes(claim.productAuthorityId) || claim.evidenceBeatIds.some((id) => !beatIds.has(id)) || claim.evidenceSceneOutcomeIds.some((id) => !outcomeIds.has(id))) add("CLAIM_EVIDENCE_GATE", "BLOCK", "UNSUPPORTED_PRODUCT_CLAIM", `Product claim ${claim.claimId} is not bound to canonical authority and evidence`);
  }
  const objectivePolicy = resolveAiStoryProductStoryObjectivePolicy(policy.campaignObjective);
  const requiredFunctions = new Set(policy.progressionGoals.filter((goal) => goal.required).map((goal) => goal.semanticFunction));
  if (objectivePolicy.requiredAny.length && !objectivePolicy.requiredAny.some((value) => requiredFunctions.has(value))) add("OBJECTIVE_AWARE_BEAT_GATE", "BLOCK", "OBJECTIVE_PRODUCT_FUNCTION_MISSING", `Campaign objective ${policy.campaignObjective} requires an applicable Product progression function`);
  if (objectivePolicy.cta === "REQUIRED" && policy.ctaPolicy !== "REQUIRED") add("OBJECTIVE_AWARE_BEAT_GATE", "BLOCK", "OBJECTIVE_CTA_REQUIREMENT_MISSING", `Campaign objective ${policy.campaignObjective} requires an explicit CTA policy`);
  if (!script) return issues;
  if (script.profileId !== AI_STORY_PRODUCT_STORY_PROFILE_ID || script.profileVersion !== outline.profile.profileVersion) add("SCRIPT_PRODUCT_PROFILE_BINDING_GATE", "BLOCK", "SCRIPT_PROFILE_MISMATCH", "Script must preserve the exact selected Outline profile version");
  const sceneContributions = script.scenes.flatMap((scene) => (scene.productStoryContributions ?? []).map((contribution) => ({ scene, contribution })));
  const distinctFunctions = new Set(sceneContributions.map(({ contribution }) => contribution.semanticFunction));
  if (distinctFunctions.size < AI_STORY_PRODUCT_STORY_PROFILE_POLICY.minimumDistinctFunctions) add("PRODUCT_INFORMATION_PROGRESSION_GATE", "BLOCK", "PRODUCT_PROGRESSION_INSUFFICIENT", "Product Story requires at least two distinct semantic Product contributions, not a fixed Scene count");
  for (const goal of policy.progressionGoals.filter((value) => value.required)) if (!distinctFunctions.has(goal.semanticFunction)) add("SCRIPT_PRODUCT_PROFILE_BINDING_GATE", "BLOCK", "REQUIRED_PRODUCT_FUNCTION_UNSERVED", `Script does not serve required Product function ${goal.semanticFunction}`);
  const claimIds = new Set(policy.claimEvidence.map((claim) => claim.claimId));
  for (const { scene, contribution } of sceneContributions) {
    if (contribution.productAuthorityIds.some((id) => !policy.productAuthorityIds.includes(id)) || contribution.claimIds.some((id) => !claimIds.has(id))) add("SCRIPT_PRODUCT_PROFILE_BINDING_GATE", "BLOCK", "SCRIPT_PRODUCT_REFERENCE_INVALID", `Scene ${scene.scriptSceneId} references unsupported Product profile authority`);
  }
  const introductions = sceneContributions.filter(({ contribution }) => contribution.semanticFunction === "PRODUCT_INTRODUCTION");
  for (const { scene } of introductions.slice(1)) {
    const hasDelta = scene.newInformation.length + scene.newEvidence.length + scene.newActionOutcomes.length + scene.productEvidence.length + scene.sceneStateDeltas.length > 0;
    const nonIntroduction = (scene.productStoryContributions ?? []).some((item) => item.semanticFunction !== "PRODUCT_INTRODUCTION");
    if (!hasDelta && !nonIntroduction) add("REPEATED_HERO_ONLY_GATE", "BLOCK", "REPEATED_HERO_WITHOUT_DELTA", `Scene ${scene.scriptSceneId} repeats Product introduction without new information, evidence, action, context, or consequence`);
  }
  const evidenceFunctions = new Set(["PRODUCT_DETAIL_REVEAL", "PRODUCT_EVIDENCE", "PRODUCT_BENEFIT_PROOF", "PRODUCT_USAGE"]);
  const proofContributionTypes = new Set(["NEW_PRODUCT_EVIDENCE", "NEW_PRODUCT_USE", "NEW_PRODUCT_CONSEQUENCE", "NEW_PRODUCT_BENEFIT"]);
  const servedClaims = new Set(sceneContributions.filter(({ contribution }) => evidenceFunctions.has(contribution.semanticFunction) || contribution.contributionTypes.some((type) => proofContributionTypes.has(type))).flatMap(({ contribution }) => contribution.claimIds));
  for (const claim of policy.claimEvidence.filter((value) => value.claimType === "BENEFIT_CLAIM")) if (!servedClaims.has(claim.claimId)) add("CLAIM_EVIDENCE_GATE", "BLOCK", "BENEFIT_PROOF_UNSERVED", `Benefit claim ${claim.claimId} is not served by Script evidence`);
  if (sceneContributions.length > 2 && !sceneContributions.some(({ contribution }) => evidenceFunctions.has(contribution.semanticFunction))) add("CLAIM_EVIDENCE_GATE", "WARN", "PRODUCT_EVIDENCE_DIVERSITY_THIN", "Product progression is valid but evidence diversity is thin");
  return issues;
}
