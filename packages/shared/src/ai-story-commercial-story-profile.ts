import { z } from "zod";
import { CAMPAIGN_OBJECTIVE_IDS } from "./create-campaign";
import type { AiStoryMarketingIntentSnapshot } from "./ai-story-cinematic-execution-contract";

export const AI_STORY_COMMERCIAL_STORY_PROFILE_CONTRACT_VERSION = "ai-story-commercial-story-profile.v1" as const;
export const AI_STORY_COMMERCIAL_STORY_PROFILE_ID = "COMMERCIAL_STORY" as const;
export const AI_STORY_COMMERCIAL_STORY_PROFILE_VERSION = 1 as const;
export const AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT = "sha256:67679b5e5acddbbf7be0ee94bde1eb03be7aae8f5dc2c3e5641b0c8c50b239a5" as const;

export const AI_STORY_COMMERCIAL_ROLES = [
  "PRODUCT", "SERVICE", "OFFER", "BRAND_ONLY", "EXPERIENCE", "LOCATION", "CAUSE", "NONE",
] as const;

export const AI_STORY_COMMERCIAL_NARRATIVE_FUNCTIONS = [
  "HOOK", "SETUP", "DESIRE", "PROBLEM", "DISCOVERY", "ACTION", "ESCALATION", "COMPLICATION",
  "TURN", "PRODUCT_INTERVENTION", "SERVICE_INTERVENTION", "REACTION", "CONSEQUENCE",
  "TRANSFORMATION", "PAYOFF", "RESOLUTION", "BRAND_RESOLUTION", "CTA",
] as const;

export const AI_STORY_COMMERCIAL_PARTICIPATION_KINDS = [
  "CAUSE", "ENABLE", "REVEAL", "SOLVE", "INTENSIFY", "SYMBOLIZE", "RESOLVE",
] as const;

export const AI_STORY_COMMERCIAL_PROTAGONIST_KINDS = [
  "PERSON", "GROUP", "BUSINESS", "OBJECT", "PLACE", "PROCESS", "MEAL", "TRANSFORMATION", "EVENT",
] as const;

export const AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY = Object.freeze({
  contractVersion: AI_STORY_COMMERCIAL_STORY_PROFILE_CONTRACT_VERSION,
  profileId: AI_STORY_COMMERCIAL_STORY_PROFILE_ID,
  profileVersion: AI_STORY_COMMERCIAL_STORY_PROFILE_VERSION,
  productDefinition: "AI Story is not primarily a Product showcase generator. AI Story creates a watchable narrative in which a Product, service, offer, or brand participates naturally and the finished narrative fulfils a commercial objective.",
  canonicalPriority: Object.freeze(["STORY_CAUSALITY", "NATURAL_COMMERCIAL_INTEGRATION", "ADVERTISING_PAYOFF"] as const),
  commercialRoles: AI_STORY_COMMERCIAL_ROLES,
  narrativeFunctions: AI_STORY_COMMERCIAL_NARRATIVE_FUNCTIONS,
  participationKinds: AI_STORY_COMMERCIAL_PARTICIPATION_KINDS,
  protagonistKinds: AI_STORY_COMMERCIAL_PROTAGONIST_KINDS,
  causalMinimum: Object.freeze(["INITIAL_STATE", "CAUSE_ACTION_OR_DISCOVERY", "MATERIAL_CHANGE", "RESULT"] as const),
  productRequiredEveryScene: false,
  productRequiredInOpening: false,
  rigidSceneTemplateForbidden: true,
  subjectiveTasteHardGatesForbidden: true,
  physicalProductInteractionRequiredRoles: Object.freeze(["PRODUCT", "OFFER"] as const),
  integrationExemptRoles: Object.freeze(["NONE"] as const),
  objectivePolicies: Object.freeze({
    awareness: Object.freeze({ cta: "OPTIONAL" as const, payoff: "BRAND_RESOLUTION_ALLOWED" as const }),
    engagement: Object.freeze({ cta: "OPTIONAL" as const, payoff: "BRAND_RESOLUTION_ALLOWED" as const }),
    sales: Object.freeze({ cta: "REQUIRED" as const, payoff: "CONVERSION_PAYOFF_REQUIRED" as const }),
    lead_generation: Object.freeze({ cta: "REQUIRED" as const, payoff: "CONVERSION_PAYOFF_REQUIRED" as const }),
    other: Object.freeze({ cta: "OPTIONAL" as const, payoff: "BRAND_RESOLUTION_ALLOWED" as const }),
  }),
});

export const AI_STORY_COMMERCIAL_STORY_PROFILE = "CERTIFIED" as const;
export const STORY_FIRST_NARRATIVE_AUTHORITY = "CERTIFIED" as const;
export const CAUSAL_STORY_PROGRESSION = "CERTIFIED" as const;
export const COMMERCIAL_INTEGRATION_CAUSALITY = "CERTIFIED" as const;
export const COMMERCIAL_PAYOFF_AUTHORITY = "CERTIFIED" as const;
export const PRODUCT_NOT_REQUIRED_EVERY_SCENE = "CERTIFIED" as const;
export const PRODUCT_STORY_PROFILE_SEPARATION = "CERTIFIED" as const;
export const MARKETING_INTENT_TO_STORY_BRIDGE = "CERTIFIED" as const;

const Id = z.string().uuid();
const Text = z.string().trim().min(1);
export const AiStoryNarrativeFunctionSchema = z.string().regex(/^(?:[A-Z][A-Z0-9_]{1,63}|EXT:[a-z0-9.-]+:[A-Z][A-Z0-9_]{1,63})$/);

export const AiStoryCommercialStoryProfileReferenceSchema = z.object({
  profileId: z.literal(AI_STORY_COMMERCIAL_STORY_PROFILE_ID),
  profileVersion: z.literal(AI_STORY_COMMERCIAL_STORY_PROFILE_VERSION),
  policyFingerprint: z.literal(AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT),
}).strict();

export const AiStoryStoryCausalitySchema = z.object({
  storyQuestion: Text.max(1000),
  protagonistOrFocus: Text.max(500),
  protagonistKind: z.enum(AI_STORY_COMMERCIAL_PROTAGONIST_KINDS),
  initialState: Text.max(1000),
  wantOrNeed: Text.max(1000),
  obstacleOrTension: Text.max(1000),
  actions: z.array(Text.max(1000)).min(1),
  turningPoint: Text.max(1000),
  resolution: Text.max(1000),
  finalState: Text.max(1000),
  audienceTakeaway: Text.max(1000),
}).strict();

export const AiStoryCommercialIntegrationSchema = z.object({
  commercialAuthorityRefs: z.array(Id),
  integrationType: z.enum(AI_STORY_COMMERCIAL_ROLES),
  entryPoint: z.object({
    kind: z.enum(["SCENE_ORDER", "BEAT_ID"]),
    sceneOrder: z.number().int().nonnegative().optional(),
    beatId: Id.optional(),
  }).strict().refine((value) => value.kind === "SCENE_ORDER" ? value.sceneOrder !== undefined : Boolean(value.beatId), {
    message: "Commercial integration entry point must bind a Scene order or Beat id",
  }),
  narrativeFunction: AiStoryNarrativeFunctionSchema,
  preIntegrationState: Text.max(1000),
  commercialActionOrParticipation: z.enum(AI_STORY_COMMERCIAL_PARTICIPATION_KINDS),
  postIntegrationState: Text.max(1000),
  storyConsequence: Text.max(1000),
  audienceUnderstanding: Text.max(1000),
  naturalnessRationale: Text.max(2000),
}).strict();

export const AiStoryCommercialPayoffSchema = z.object({
  payoffType: z.enum(["BRAND_RESOLUTION", "CONVERSION", "LEAD", "EMOTIONAL_ASSOCIATION", "EXPERIENCE_CLOSE"]),
  brandMeaning: Text.max(1000),
  benefitOrOutcome: Text.max(1000),
  productOrServiceResolution: Text.max(1000),
  ctaStrategy: z.enum(["REQUIRED", "OPTIONAL", "NOT_REQUIRED", "BRAND_RESOLUTION"]),
  ctaTiming: z.enum(["ENDING", "MID_STORY", "NONE"]),
  packshotPolicy: z.enum(["REQUIRED", "OPTIONAL", "NOT_REQUIRED"]),
  brandVisibilityPolicy: z.enum(["REQUIRED", "OPTIONAL", "NOT_REQUIRED"]),
}).strict();

export const AiStoryCommercialStoryOutlinePolicySchema = z.object({
  campaignObjective: z.enum(CAMPAIGN_OBJECTIVE_IDS),
  storyIntent: Text.max(2000),
  audienceIntent: Text.max(1000),
  desiredEmotion: Text.max(500),
  commercialRole: z.enum(AI_STORY_COMMERCIAL_ROLES),
  productOrServiceAuthorityRefs: z.array(Id),
  integrationPolicy: z.enum(["CAUSAL_REQUIRED", "OPTIONAL", "NOT_REQUIRED"]),
  ctaPolicy: z.enum(["REQUIRED", "OPTIONAL", "NOT_REQUIRED"]),
  brandResolutionPolicy: z.enum(["REQUIRED", "OPTIONAL", "NOT_REQUIRED"]),
  userCreativeIntent: z.array(Text.max(1000)),
  storyCausality: AiStoryStoryCausalitySchema,
  commercialIntegration: AiStoryCommercialIntegrationSchema.optional(),
  commercialPayoff: AiStoryCommercialPayoffSchema,
  marketingIntentKind: z.enum(["MARKETING_INTENT_SNAPSHOT", "MARKETING_INTENT_ABSENT_LEGACY"]),
}).strict();

export const AiStoryCommercialSceneContributionSchema = z.object({
  commercialRole: z.enum(AI_STORY_COMMERCIAL_ROLES),
  narrativeFunction: AiStoryNarrativeFunctionSchema,
  participationKind: z.enum(AI_STORY_COMMERCIAL_PARTICIPATION_KINDS),
  commercialAuthorityIds: z.array(Id),
  preState: Text.max(1000),
  postState: Text.max(1000),
  storyConsequence: Text.max(1000),
}).strict();

export const AI_STORY_COMMERCIAL_STORY_PROFILE_GATES = [
  "COMMERCIAL_PROFILE_BINDING_GATE",
  "SCRIPT_COMMERCIAL_PROFILE_BINDING_GATE",
  "NARRATIVE_HOOK_GATE",
  "CAUSAL_PROGRESSION_GATE",
  "STATE_CHANGE_GATE",
  "SCENE_PURPOSE_PROGRESSION_GATE",
  "COMMERCIAL_INTEGRATION_GATE",
  "COMMERCIAL_PAYOFF_GATE",
  "MARKETING_INTENT_CONSUMPTION_GATE",
] as const;

export type AiStoryCommercialStoryOutlinePolicy = z.infer<typeof AiStoryCommercialStoryOutlinePolicySchema>;
export type AiStoryCommercialIntegration = z.infer<typeof AiStoryCommercialIntegrationSchema>;
export type AiStoryCommercialSceneContribution = z.infer<typeof AiStoryCommercialSceneContributionSchema>;
export type AiStoryStoryCausality = z.infer<typeof AiStoryStoryCausalitySchema>;
export type AiStoryCommercialStoryProfileIssue = {
  gate: typeof AI_STORY_COMMERCIAL_STORY_PROFILE_GATES[number];
  severity: "BLOCK" | "WARN";
  reasonCode: string;
  message: string;
};

export function resolveAiStoryCommercialStoryObjectivePolicy(objective: typeof CAMPAIGN_OBJECTIVE_IDS[number]) {
  return AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY.objectivePolicies[objective];
}

const HOOK_FUNCTIONS = new Set(["HOOK", "SETUP", "DESIRE", "PROBLEM", "DISCOVERY", "ACTION", "PRODUCT_INTERVENTION", "SERVICE_INTERVENTION"]);

export function isAiStoryNarrativeHookFunction(value: string) {
  const local = value.includes(":") ? value.split(":").pop() ?? value : value;
  return HOOK_FUNCTIONS.has(local);
}

export function consumeMarketingIntentSnapshot(snapshot: AiStoryMarketingIntentSnapshot | null) {
  if (!snapshot) {
    return Object.freeze({
      kind: "MARKETING_INTENT_ABSENT_LEGACY" as const,
      regeneratesMarketingPlan: false as const,
    });
  }
  const jobObjective = {
    PRODUCT_AD: "awareness",
    SERVICE_AD: "awareness",
    FOOD: "awareness",
    CHARACTER_STORY: "engagement",
    EMOTIONAL_STORY: "awareness",
    MINIMAL_HERO: "awareness",
  } as const;
  return Object.freeze({
    kind: "MARKETING_INTENT_SNAPSHOT" as const,
    regeneratesMarketingPlan: false as const,
    campaignObjective: snapshot.primaryGoal ?? jobObjective[snapshot.campaignJob],
    audienceIntent: snapshot.targetAudience ?? null,
    desiredEmotion: snapshot.desiredEmotion ?? null,
    contentAngle: snapshot.contentAngle ?? null,
    keyMessage: snapshot.keyMessage ?? null,
    ctaStrategy: snapshot.ctaStrategy ?? null,
    platform: snapshot.platform ?? null,
    distributionContext: snapshot.distributionContext ?? null,
    brandTone: snapshot.brandTone ?? null,
    commercialAuthorityRefs: snapshot.commercialAuthorityRefs ?? [],
  });
}

export function buildAiStoryCommercialStoryWriterGuidance(input: AiStoryCommercialStoryOutlinePolicy) {
  const policy = resolveAiStoryCommercialStoryObjectivePolicy(input.campaignObjective);
  return Object.freeze({
    profileId: AI_STORY_COMMERCIAL_STORY_PROFILE_ID,
    profileVersion: AI_STORY_COMMERCIAL_STORY_PROFILE_VERSION,
    policyFingerprint: AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
    objective: input.campaignObjective,
    commercialRole: input.commercialRole,
    ctaPolicy: input.ctaPolicy,
    brandResolutionPolicy: input.brandResolutionPolicy,
    requiredCtaByObjective: policy.cta,
    userCreativeIntent: [...input.userCreativeIntent],
    marketingIntentKind: input.marketingIntentKind,
    creativeGuidance: [
      "Write a coherent narrative first.",
      "Do not turn every Scene into a Product showcase.",
      "The Product/service may enter only where narratively justified.",
      "Commercial authority must have a meaningful role by the end.",
      "Preserve Marketing Intent.",
      "Do not invent unsupported Product facts or claims.",
      "Do not force Product presence into Scenes that work better without it.",
    ],
  });
}
