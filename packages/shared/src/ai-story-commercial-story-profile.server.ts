import { sha256CanonicalIntegrityHash } from "./canonical-integrity";
import { resolveMarketingIntentBridge } from "./ai-story-cinematic-execution-contract";
import type { AiStoryOutlineVersion } from "./ai-story-outline";
import type { AiStoryScriptVersion } from "./ai-story-script";
import {
  AI_STORY_COMMERCIAL_STORY_PROFILE_ID,
  AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY,
  AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
  consumeMarketingIntentSnapshot,
  isAiStoryNarrativeHookFunction,
  resolveAiStoryCommercialStoryObjectivePolicy,
  type AiStoryCommercialStoryProfileIssue,
} from "./ai-story-commercial-story-profile";

export function computeAiStoryCommercialStoryProfilePolicyFingerprint() {
  return sha256CanonicalIntegrityHash(AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY);
}

const SHOWCASE_FUNCTIONS = new Set([
  "PRODUCT_INTRODUCTION", "PRODUCT_DETAIL_REVEAL", "PRODUCT_USAGE", "PRODUCT_BENEFIT_PROOF",
  "PRODUCT_PAYOFF", "PACKSHOT", "CTA",
]);
const INTERVENTION_FUNCTIONS = new Set(["PRODUCT_INTERVENTION", "SERVICE_INTERVENTION", "DISCOVERY", "ACTION", "TURN", "TRANSFORMATION"]);

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function narrativeFunctionOf(scene: AiStoryScriptVersion["scenes"][number]) {
  return scene.narrativeFunction ?? scene.sceneFunction;
}

function materialProgression(scene: AiStoryScriptVersion["scenes"][number]) {
  const stateChanged = scene.sceneStateDeltas.some((delta) => delta.fromValue !== delta.value);
  return stateChanged
    || Boolean(scene.storyConsequence?.trim())
    || (scene.causalPreconditions?.length ?? 0) > 0
    || scene.newInformation.length > 0
    || scene.newActionOutcomes.length > 0
    || scene.newEvidence.length > 0
    || Boolean(scene.commercialContribution && scene.commercialContribution.preState !== scene.commercialContribution.postState);
}

function causalLink(previous: AiStoryScriptVersion["scenes"][number], next: AiStoryScriptVersion["scenes"][number]) {
  if ((next.causalPreconditions?.length ?? 0) > 0) return true;
  if (next.sceneStateDeltas.some((delta) => delta.fromValue !== delta.value)) return true;
  const previousOut = new Map(previous.sceneStateOut.map((fact) => [`${fact.dimension}:${fact.subjectId}`, fact.value]));
  if (next.sceneStateIn.some((fact) => previousOut.has(`${fact.dimension}:${fact.subjectId}`))) return true;
  if (next.commercialContribution && previous.storyConsequence) return true;
  return false;
}

export function validateAiStoryCommercialStoryProfile(
  outline: AiStoryOutlineVersion,
  script?: AiStoryScriptVersion,
  marketingIntent?: unknown | null,
): AiStoryCommercialStoryProfileIssue[] {
  if (outline.profile.profileId !== AI_STORY_COMMERCIAL_STORY_PROFILE_ID) return [];
  const issues: AiStoryCommercialStoryProfileIssue[] = [];
  const add = (
    gate: AiStoryCommercialStoryProfileIssue["gate"],
    severity: AiStoryCommercialStoryProfileIssue["severity"],
    reasonCode: string,
    message: string,
  ) => issues.push({ gate, severity, reasonCode, message });

  const policy = outline.commercialStoryProfile;
  if (!policy || outline.profile.policyFingerprint !== AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT || computeAiStoryCommercialStoryProfilePolicyFingerprint() !== AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT) {
    add("COMMERCIAL_PROFILE_BINDING_GATE", "BLOCK", "COMMERCIAL_PROFILE_POLICY_MISMATCH", "COMMERCIAL_STORY must bind the immutable certified profile policy");
    return issues;
  }

  const causality = policy.storyCausality;
  if (!outline.hooks.length && !causality.storyQuestion.trim()) {
    add("NARRATIVE_HOOK_GATE", "BLOCK", "NARRATIVE_HOOK_MISSING", "Commercial Story requires an identifiable reason for the audience to continue");
  }

  if (normalize(causality.initialState) === normalize(causality.finalState)) {
    add("STATE_CHANGE_GATE", "BLOCK", "NO_STORY_STATE_CHANGE", "A camera change is not a Story state change; initial and final Story states must differ");
  }
  if (!causality.actions.length || !causality.turningPoint.trim() || !causality.resolution.trim()) {
    add("CAUSAL_PROGRESSION_GATE", "BLOCK", "CAUSAL_MINIMUM_UNMET", "A sequence of different shots is not automatically a Story; causal progression is required");
  }

  const role = policy.commercialRole;
  const integrationRequired = role !== "NONE" && policy.integrationPolicy === "CAUSAL_REQUIRED";
  const physicalRequired = (AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY.physicalProductInteractionRequiredRoles as readonly string[]).includes(role);
  if (physicalRequired && policy.productOrServiceAuthorityRefs.length < 1) {
    add("COMMERCIAL_INTEGRATION_GATE", "BLOCK", "COMMERCIAL_AUTHORITY_MISSING", "PRODUCT or OFFER Commercial Stories require commercial authority references");
  }
  if (integrationRequired) {
    const integration = policy.commercialIntegration;
    if (!integration) {
      add("COMMERCIAL_INTEGRATION_GATE", "BLOCK", "COMMERCIAL_INTEGRATION_MISSING", "The Product must participate in the Story; the Story must not stop so the Product can be shown");
    } else {
      if (normalize(integration.preIntegrationState) === normalize(integration.postIntegrationState)) {
        add("COMMERCIAL_INTEGRATION_GATE", "BLOCK", "COMMERCIAL_INTEGRATION_WITHOUT_STATE_CHANGE", "Commercial integration must change Story state, not merely display the commercial subject");
      }
      if (integration.integrationType === "NONE") {
        add("COMMERCIAL_INTEGRATION_GATE", "BLOCK", "COMMERCIAL_INTEGRATION_TYPE_INVALID", "Causal integration cannot use commercial role NONE");
      }
      if (physicalRequired && integration.commercialAuthorityRefs.length < 1) {
        add("COMMERCIAL_INTEGRATION_GATE", "BLOCK", "COMMERCIAL_INTEGRATION_AUTHORITY_MISSING", "Causal Product/Offer integration requires bound commercial authority");
      }
    }
  }

  const objectivePolicy = resolveAiStoryCommercialStoryObjectivePolicy(policy.campaignObjective);
  if (objectivePolicy.cta === "REQUIRED" && policy.ctaPolicy !== "REQUIRED") {
    add("COMMERCIAL_PAYOFF_GATE", "BLOCK", "OBJECTIVE_CTA_REQUIREMENT_MISSING", `Campaign objective ${policy.campaignObjective} requires explicit CTA payoff authority`);
  }
  if (objectivePolicy.cta === "REQUIRED" && policy.commercialPayoff.ctaStrategy !== "REQUIRED") {
    add("COMMERCIAL_PAYOFF_GATE", "BLOCK", "CONVERSION_PAYOFF_MISSING", "Conversion or lead-generation Commercial Stories require CTA payoff authority");
  }
  if (objectivePolicy.cta === "OPTIONAL" && policy.commercialPayoff.ctaStrategy === "REQUIRED" && policy.brandResolutionPolicy === "NOT_REQUIRED" && !["BRAND_RESOLUTION", "EMOTIONAL_ASSOCIATION"].includes(policy.commercialPayoff.payoffType)) {
    add("COMMERCIAL_PAYOFF_GATE", "WARN", "AGGRESSIVE_CTA_NOT_REQUIRED", "Awareness or brand work may resolve without an aggressive CTA");
  }
  if (role !== "NONE" && policy.brandResolutionPolicy === "NOT_REQUIRED" && policy.commercialPayoff.ctaStrategy === "NOT_REQUIRED" && policy.ctaPolicy === "NOT_REQUIRED") {
    add("COMMERCIAL_PAYOFF_GATE", "BLOCK", "COMMERCIAL_PAYOFF_MISSING", "Commercial Story resolution must complete advertising intent without replacing narrative causality");
  }

  const marketing = resolveMarketingIntentBridge({ marketingIntent: marketingIntent ?? null });
  const consumed = consumeMarketingIntentSnapshot(marketing.kind === "MARKETING_INTENT_SNAPSHOT" ? marketing.snapshot : null);
  if (policy.marketingIntentKind === "MARKETING_INTENT_SNAPSHOT") {
    if (marketing.kind === "INVALID") {
      add("MARKETING_INTENT_CONSUMPTION_GATE", "BLOCK", "MARKETING_INTENT_SNAPSHOT_INVALID", "COMMERCIAL_STORY cannot consume an invalid Marketing Intent Snapshot");
    } else if (marketing.kind !== "MARKETING_INTENT_SNAPSHOT") {
      add("MARKETING_INTENT_CONSUMPTION_GATE", "BLOCK", "MARKETING_INTENT_SNAPSHOT_REQUIRED", "COMMERCIAL_STORY declared snapshot consumption but no Marketing Intent Snapshot is present");
    } else {
      if (consumed.kind === "MARKETING_INTENT_SNAPSHOT") {
        if (consumed.campaignObjective && consumed.campaignObjective !== policy.campaignObjective) {
          add("MARKETING_INTENT_CONSUMPTION_GATE", "BLOCK", "MARKETING_INTENT_OBJECTIVE_DRIFT", "Commercial Story must consume the Marketing Intent Snapshot rather than invent a second marketing strategy");
        }
        if (consumed.audienceIntent && consumed.audienceIntent !== policy.audienceIntent) {
          add("MARKETING_INTENT_CONSUMPTION_GATE", "BLOCK", "MARKETING_INTENT_AUDIENCE_DRIFT", "Audience intent must be consumed from the Marketing Intent Snapshot");
        }
        if (consumed.desiredEmotion && consumed.desiredEmotion !== policy.desiredEmotion) {
          add("MARKETING_INTENT_CONSUMPTION_GATE", "BLOCK", "MARKETING_INTENT_EMOTION_DRIFT", "Desired emotion must be consumed from the Marketing Intent Snapshot");
        }
        if (consumed.ctaStrategy && consumed.ctaStrategy !== policy.ctaPolicy && consumed.ctaStrategy !== policy.commercialPayoff.ctaStrategy) {
          add("MARKETING_INTENT_CONSUMPTION_GATE", "BLOCK", "MARKETING_INTENT_CTA_DRIFT", "CTA strategy must be consumed from the Marketing Intent Snapshot");
        }
      }
    }
  } else if (marketing.kind === "MARKETING_INTENT_SNAPSHOT") {
    add("MARKETING_INTENT_CONSUMPTION_GATE", "BLOCK", "MARKETING_INTENT_KIND_MISMATCH", "A present Marketing Intent Snapshot cannot be marked MARKETING_INTENT_ABSENT_LEGACY");
  }

  if (!script) return issues;
  if (script.profileId !== AI_STORY_COMMERCIAL_STORY_PROFILE_ID || script.profileVersion !== outline.profile.profileVersion) {
    add("SCRIPT_COMMERCIAL_PROFILE_BINDING_GATE", "BLOCK", "SCRIPT_PROFILE_MISMATCH", "Script must preserve the exact selected Outline COMMERCIAL_STORY profile version");
  }

  const first = script.scenes[0];
  if (first) {
    const firstFunction = narrativeFunctionOf(first);
    const hookEvidence = outline.hooks.length > 0
      || isAiStoryNarrativeHookFunction(firstFunction)
      || first.newInformation.length > 0
      || first.sceneStateIn.length > 0;
    if (!hookEvidence) {
      add("NARRATIVE_HOOK_GATE", "BLOCK", "NARRATIVE_HOOK_MISSING", "Commercial Story requires an identifiable opening reason to continue; spoken hook text is not required");
    }
  }

  const storyDeltas = script.scenes.flatMap((scene) => scene.sceneStateDeltas.filter((delta) => delta.fromValue !== delta.value));
  if (!storyDeltas.length) {
    add("STATE_CHANGE_GATE", "BLOCK", "NO_SCRIPT_STATE_DELTA", "At least one meaningful Story/world/character/process state must change");
  }

  let disconnected = 0;
  for (let index = 1; index < script.scenes.length; index += 1) {
    const previous = script.scenes[index - 1]!;
    const next = script.scenes[index]!;
    if (!causalLink(previous, next)) {
      disconnected += 1;
      add("CAUSAL_PROGRESSION_GATE", "BLOCK", "DISCONNECTED_SLIDE_SEQUENCE", `Scene ${next.scriptSceneId} has no causal relationship with the preceding Scene`);
    }
    const samePurpose = narrativeFunctionOf(previous) === narrativeFunctionOf(next);
    if (samePurpose && !materialProgression(next)) {
      add("SCENE_PURPOSE_PROGRESSION_GATE", "BLOCK", "EQUIVALENT_SCENE_PURPOSE_WITHOUT_PROGRESSION", `Adjacent Scenes share narrative purpose ${narrativeFunctionOf(next)} without material causal progression`);
    } else if (samePurpose && materialProgression(next) && !next.sceneStateDeltas.length) {
      add("SCENE_PURPOSE_PROGRESSION_GATE", "WARN", "EQUIVALENT_SCENE_PURPOSE_THIN_PROGRESSION", `Adjacent Scenes share narrative purpose ${narrativeFunctionOf(next)}; progression is thin`);
    }
  }

  const showcaseOnly = script.scenes.length >= 3
    && script.scenes.every((scene) => SHOWCASE_FUNCTIONS.has(scene.sceneFunction))
    && storyDeltas.length === 0;
  if (showcaseOnly || (disconnected > 0 && script.scenes.every((scene) => SHOWCASE_FUNCTIONS.has(scene.sceneFunction)))) {
    add("CAUSAL_PROGRESSION_GATE", "BLOCK", "SHOWCASE_WITHOUT_CAUSAL_NARRATIVE", "PRODUCT_STORY answers how to communicate a Product; COMMERCIAL_STORY requires causal Story progression");
  }

  const contributions = script.scenes.flatMap((scene) => scene.commercialContribution ? [{ scene, contribution: scene.commercialContribution }] : []);
  if (integrationRequired) {
    if (!contributions.length) {
      add("COMMERCIAL_INTEGRATION_GATE", "BLOCK", "COMMERCIAL_AUTHORITY_NEVER_PARTICIPATES", "Good narrative without commercial participation is not a Commercial Story");
    }
    for (const { scene, contribution } of contributions) {
      if (normalize(contribution.preState) === normalize(contribution.postState)) {
        add("COMMERCIAL_INTEGRATION_GATE", "BLOCK", "PRODUCT_INSERTION_WITHOUT_NARRATIVE_ROLE", `Scene ${scene.scriptSceneId} displays commercial authority without narrative participation`);
      }
      if (physicalRequired && contribution.commercialAuthorityIds.some((id) => !policy.productOrServiceAuthorityRefs.includes(id))) {
        add("COMMERCIAL_INTEGRATION_GATE", "BLOCK", "COMMERCIAL_SCENE_AUTHORITY_UNBOUND", `Scene ${scene.scriptSceneId} references unbound commercial authority`);
      }
    }
    for (const scene of script.scenes) {
      const inserted = scene.productAuthorityRefs.length > 0 && !scene.commercialContribution;
      const functionLocal = narrativeFunctionOf(scene);
      const intervention = INTERVENTION_FUNCTIONS.has(functionLocal) || functionLocal.includes("INTERVENTION");
      const stateChanged = scene.sceneStateDeltas.some((delta) => delta.fromValue !== delta.value);
      if (inserted && !stateChanged && !intervention) {
        add("COMMERCIAL_INTEGRATION_GATE", "BLOCK", "RANDOM_PRODUCT_INSERTION", `Scene ${scene.scriptSceneId} inserts commercial visibility without narrative relationship`);
      }
    }
    if (policy.commercialIntegration?.naturalnessRationale && !contributions.length) {
      add("COMMERCIAL_INTEGRATION_GATE", "BLOCK", "NATURALNESS_RATIONALE_INSUFFICIENT", "Freeform naturalness rationale is evidence only and cannot pass commercial integration");
    }
  }

  const payoffScene = script.scenes.some((scene) => {
    const fn = narrativeFunctionOf(scene);
    return ["PAYOFF", "RESOLUTION", "BRAND_RESOLUTION", "CTA"].includes(fn) || scene.sceneFunction === "PAYOFF" || scene.sceneFunction === "RESOLVE" || scene.sceneFunction === "PACKSHOT";
  });
  if (role !== "NONE" && !payoffScene && policy.commercialPayoff.ctaTiming === "NONE" && policy.ctaPolicy === "NOT_REQUIRED") {
    add("COMMERCIAL_PAYOFF_GATE", "BLOCK", "STORY_WITHOUT_COMMERCIAL_RESOLUTION", "Story ending cannot be followed by an unrelated advertisement; commercial payoff authority is missing");
  }

  const productEveryScene = script.scenes.every((scene) => scene.productAuthorityRefs.length > 0);
  if (productEveryScene && policy.commercialRole !== "PRODUCT" && policy.commercialRole !== "OFFER") {
    add("COMMERCIAL_INTEGRATION_GATE", "WARN", "PRODUCT_VISIBILITY_DOMINATES", "Commercial relevance is not constant Product visibility");
  }

  return issues;
}
