import { z } from "zod";
import { CAMPAIGN_OBJECTIVE_IDS } from "./create-campaign";

export const AI_STORY_PRODUCT_STORY_PROFILE_CONTRACT_VERSION = "ai-story-product-story-profile.v1" as const;
export const AI_STORY_PRODUCT_STORY_PROFILE_ID = "PRODUCT_STORY" as const;
export const AI_STORY_PRODUCT_STORY_PROFILE_VERSION = 1 as const;
export const AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT = "sha256:26bb7055894e1a5374f4b617efd031bcc31bcd03c5e05bde378a798148fd9be1" as const;

export const AI_STORY_PRODUCT_STORY_SEMANTIC_FUNCTIONS = [
  "PRODUCT_INTRODUCTION", "PRODUCT_DETAIL_REVEAL", "PRODUCT_USAGE", "PRODUCT_RELATIONSHIP",
  "PRODUCT_CONTEXT", "PRODUCT_BENEFIT_PROOF", "PRODUCT_EVIDENCE", "PRODUCT_REACTION",
  "PRODUCT_CONSEQUENCE", "PRODUCT_PAYOFF", "PACKSHOT", "CTA",
] as const;

export const AI_STORY_PRODUCT_STORY_CONTRIBUTION_TYPES = [
  "NEW_PRODUCT_INFORMATION", "NEW_PRODUCT_EVIDENCE", "NEW_PRODUCT_CONTEXT", "NEW_PRODUCT_USE",
  "NEW_PRODUCT_RELATIONSHIP", "NEW_PRODUCT_CONSEQUENCE", "NEW_PRODUCT_BENEFIT",
  "NEW_PRODUCT_STATE", "NEW_AUDIENCE_UNDERSTANDING",
] as const;

export const AI_STORY_PRODUCT_STORY_PROFILE_POLICY = Object.freeze({
  contractVersion: AI_STORY_PRODUCT_STORY_PROFILE_CONTRACT_VERSION,
  profileId: AI_STORY_PRODUCT_STORY_PROFILE_ID,
  profileVersion: AI_STORY_PRODUCT_STORY_PROFILE_VERSION,
  semanticFunctions: AI_STORY_PRODUCT_STORY_SEMANTIC_FUNCTIONS,
  minimumDistinctFunctions: 2,
  objectivePolicies: Object.freeze({
    awareness: Object.freeze({ requiredAny: ["PRODUCT_INTRODUCTION", "PRODUCT_DETAIL_REVEAL", "PRODUCT_CONTEXT", "PRODUCT_EVIDENCE"], cta: "OPTIONAL" }),
    engagement: Object.freeze({ requiredAny: ["PRODUCT_RELATIONSHIP", "PRODUCT_REACTION", "PRODUCT_USAGE", "PRODUCT_CONTEXT"], cta: "OPTIONAL" }),
    sales: Object.freeze({ requiredAny: ["PRODUCT_EVIDENCE", "PRODUCT_BENEFIT_PROOF", "PRODUCT_USAGE"], cta: "REQUIRED" }),
    lead_generation: Object.freeze({ requiredAny: ["PRODUCT_EVIDENCE", "PRODUCT_BENEFIT_PROOF"], cta: "REQUIRED" }),
    other: Object.freeze({ requiredAny: [] as string[], cta: "OPTIONAL" }),
  }),
});

const Id = z.string().uuid();
const Text = z.string().trim().min(1);
export const AiStoryProductStorySemanticFunctionSchema = z.string().regex(/^(?:[A-Z][A-Z0-9_]{1,63}|EXT:[a-z0-9.-]+:[A-Z][A-Z0-9_]{1,63})$/);

export const AiStoryProductStoryProfileReferenceSchema = z.object({
  profileId: z.literal(AI_STORY_PRODUCT_STORY_PROFILE_ID),
  profileVersion: z.literal(AI_STORY_PRODUCT_STORY_PROFILE_VERSION),
  policyFingerprint: z.literal(AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT),
}).strict();

export const AiStoryProductStoryProgressionGoalSchema = z.object({
  goalId: Id,
  semanticFunction: AiStoryProductStorySemanticFunctionSchema,
  required: z.boolean(),
  beatIds: z.array(Id).min(1),
  requiredSceneOutcomeIds: z.array(Id),
  intent: Text.max(1000),
}).strict();

export const AiStoryProductStoryClaimEvidenceSchema = z.object({
  claimId: Id,
  claimType: z.enum(["PRODUCT_CLAIM", "BENEFIT_CLAIM"]),
  claim: Text.max(1000),
  productAuthorityId: Id,
  authorityFactRefs: z.array(Text.max(300)).min(1),
  evidenceBeatIds: z.array(Id),
  evidenceSceneOutcomeIds: z.array(Id),
}).strict().refine((value) => value.evidenceBeatIds.length + value.evidenceSceneOutcomeIds.length > 0, {
  message: "A Product claim requires canonical Beat or Scene Outcome evidence",
});

export const AiStoryProductStoryOutlinePolicySchema = z.object({
  campaignObjective: z.enum(CAMPAIGN_OBJECTIVE_IDS),
  customObjective: Text.max(500).nullable(),
  productAuthorityIds: z.array(Id).min(1),
  progressionGoals: z.array(AiStoryProductStoryProgressionGoalSchema).min(1),
  claimEvidence: z.array(AiStoryProductStoryClaimEvidenceSchema),
  ctaPolicy: z.enum(["REQUIRED", "OPTIONAL", "NOT_REQUIRED"]),
  packshotPolicy: z.enum(["REQUIRED", "OPTIONAL", "NOT_REQUIRED"]),
  userCreativeIntent: z.array(Text.max(1000)),
}).strict();

export const AiStoryProductStorySceneContributionSchema = z.object({
  semanticFunction: AiStoryProductStorySemanticFunctionSchema,
  contributionTypes: z.array(z.enum(AI_STORY_PRODUCT_STORY_CONTRIBUTION_TYPES)).min(1),
  productAuthorityIds: z.array(Id).min(1),
  claimIds: z.array(Id),
  summary: Text.max(1000),
}).strict();

export const AI_STORY_PRODUCT_STORY_PROFILE_GATES = [
  "PRODUCT_PROFILE_BINDING_GATE", "PRODUCT_AUTHORITY_GATE", "PRODUCT_INFORMATION_PROGRESSION_GATE",
  "REPEATED_HERO_ONLY_GATE", "OBJECTIVE_AWARE_BEAT_GATE", "CLAIM_EVIDENCE_GATE",
  "SCRIPT_PRODUCT_PROFILE_BINDING_GATE",
] as const;

export type AiStoryProductStoryOutlinePolicy = z.infer<typeof AiStoryProductStoryOutlinePolicySchema>;
export type AiStoryProductStorySceneContribution = z.infer<typeof AiStoryProductStorySceneContributionSchema>;
export type AiStoryProductStoryProfileIssue = {
  gate: typeof AI_STORY_PRODUCT_STORY_PROFILE_GATES[number];
  severity: "BLOCK" | "WARN";
  reasonCode: string;
  message: string;
};

export function resolveAiStoryProductStoryObjectivePolicy(objective: typeof CAMPAIGN_OBJECTIVE_IDS[number]) {
  return AI_STORY_PRODUCT_STORY_PROFILE_POLICY.objectivePolicies[objective];
}

export function buildAiStoryProductStoryWriterGuidance(input: AiStoryProductStoryOutlinePolicy) {
  const policy = resolveAiStoryProductStoryObjectivePolicy(input.campaignObjective);
  return Object.freeze({
    profileId: AI_STORY_PRODUCT_STORY_PROFILE_ID,
    profileVersion: AI_STORY_PRODUCT_STORY_PROFILE_VERSION,
    policyFingerprint: AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
    objective: input.campaignObjective,
    requiredAnyObjectiveFunctions: [...policy.requiredAny],
    ctaPolicy: input.ctaPolicy,
    packshotPolicy: input.packshotPolicy,
    progressionGoals: input.progressionGoals.map((goal) => ({ ...goal })),
    claimEvidence: input.claimEvidence.map((claim) => ({ ...claim })),
    userCreativeIntent: [...input.userCreativeIntent],
    creativeGuidance: [
      "Create meaningful Product information progression rather than repeated display.",
      "Use any Script-supported human, environmental, usage, evidence, relationship, or consequence context.",
      "Preserve user creative intent unless deterministic Product authority or safety constraints fail.",
    ],
  });
}
