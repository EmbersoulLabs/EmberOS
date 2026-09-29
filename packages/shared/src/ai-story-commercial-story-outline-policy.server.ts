import { z } from "zod";
import { AiStoryStructuredDraftSchema } from "./ai-story";
import { AiStoryOutlineBeatSchema } from "./ai-story-outline";
import {
  AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_COMMERCIAL_STORY_PROFILE_VERSION,
  AiStoryCommercialStoryOutlinePolicySchema,
  AiStoryCommercialStoryProfileReferenceSchema,
  resolveAiStoryCommercialStoryObjectivePolicy,
  type AiStoryCommercialStoryOutlinePolicy,
} from "./ai-story-commercial-story-profile";
import { buildCanonicalOutlineBeatBasis } from "./ai-story-outline-beat-promotion.server";
import { chunkNormalizedCreativeIntent } from "./ai-story-product-story-outline-policy.server";
import { CAMPAIGN_OBJECTIVE_IDS, type CampaignObjectiveId } from "./create-campaign";

export const AI_STORY_COMMERCIAL_STORY_OUTLINE_POLICY_PRODUCER_V1 = Object.freeze({
  policyId: "AI_STORY_COMMERCIAL_STORY_OUTLINE_POLICY_PRODUCER",
  policyVersion: 1,
  contractVersion: "ai-story-commercial-story-outline-policy-producer.v1",
  profileVersion: AI_STORY_COMMERCIAL_STORY_PROFILE_VERSION,
  profilePolicyFingerprint: AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
  protagonistKindWhenUnspecified: "EVENT",
  integrationBeatOrdinal: 1,
  marketingIntentWhenAbsent: "MARKETING_INTENT_ABSENT_LEGACY",
  userCreativeIntentSource: "NORMALIZED_STORY_ORIGINAL_IDEA_LOSSLESS_CHUNKS",
} as const);

const InputSchema = z.object({
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  profile: AiStoryCommercialStoryProfileReferenceSchema,
  storyDraft: AiStoryStructuredDraftSchema,
  canonicalBeats: z.array(AiStoryOutlineBeatSchema).min(1),
  campaignObjective: z.enum(CAMPAIGN_OBJECTIVE_IDS),
  productAuthorityIds: z.array(z.string().uuid()),
  originalIdea: z.string().trim().min(1).max(8000),
}).strict();

export type AiStoryCommercialStoryOutlinePolicyProducerV1Input = {
  storyId: string;
  storyVersionId: string;
  profile: z.input<typeof AiStoryCommercialStoryProfileReferenceSchema>;
  storyDraft: z.input<typeof AiStoryStructuredDraftSchema>;
  canonicalBeats: z.input<typeof AiStoryOutlineBeatSchema>[];
  campaignObjective: CampaignObjectiveId;
  productAuthorityIds: string[];
  originalIdea: string;
};

const ACTIVE_PRODUCT_USE = /\b(hold|holding|holds|use|using|uses|wear|wearing|operate|operating|point|aim|apply|applying)\b/i;
const VISIBLE_PRODUCT_EFFECT = /\b(movement|moves|moving|airflow|blows|blown)\b/i;
const SYMBOLIC_PRODUCT_ROLE = /\b(symboli[sz]e|symboli[sz]es|stands for|represents)\b/i;

/**
 * Product presence is not product participation. Active use is derived from
 * the preserved creative intent. A product story that only reveals or displays
 * the subject stays passive.
 */
export function resolveCommercialActionParticipation(intent: string): "ENABLE" | "REVEAL" | "SYMBOLIZE" {
  if (ACTIVE_PRODUCT_USE.test(intent) || VISIBLE_PRODUCT_EFFECT.test(intent)) return "ENABLE";
  if (SYMBOLIC_PRODUCT_ROLE.test(intent)) return "SYMBOLIZE";
  return "REVEAL";
}

/** Sentences in the preserved creative intent that already state a physical product obligation. */
export function compileInheritedCommercialMustKeep(intent: readonly string[], participation: string): string[] {
  if (participation !== "ENABLE" && participation !== "CAUSE" && participation !== "INTENSIFY") return [];
  const sentences = intent.join(" ").split(/(?<=[.!?])\s+/u);
  const kept: string[] = [];
  for (const sentence of sentences) {
    const text = sentence.trim();
    if (!text || text.length > 1000) continue;
    if (!ACTIVE_PRODUCT_USE.test(text) && !VISIBLE_PRODUCT_EFFECT.test(text)) continue;
    if (!kept.includes(text)) kept.push(text);
    if (kept.length === 8) break;
  }
  return kept.length > 0
    ? kept
    : ["The authorized product stays in physical use unless a visible action changes that state."];
}

function requiredText(value: string, code: string, max: number) {
  const text = value.trim();
  if (!text) throw new Error(code);
  if (text.length > max) throw new Error(`${code}_TOO_LONG`);
  return text;
}

/** Deterministic commercial Outline policy from an already authorized Story Version and Beat basis. */
export function buildAiStoryCommercialStoryOutlinePolicyV1(
  rawInput: AiStoryCommercialStoryOutlinePolicyProducerV1Input,
): AiStoryCommercialStoryOutlinePolicy {
  const input = InputSchema.parse(rawInput);
  const expected = buildCanonicalOutlineBeatBasis({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    profile: input.profile,
    proposedStoryBeats: input.canonicalBeats.map((beat) => ({
      id: beat.id,
      name: beat.name,
      purpose: beat.purpose,
      order: beat.order,
      summary: beat.summary,
    })),
  });
  if (JSON.stringify(input.canonicalBeats) !== JSON.stringify(expected)) {
    throw new Error("COMMERCIAL_STORY_CANONICAL_BEAT_AUTHORITY_INVALID");
  }
  const beats = [...input.canonicalBeats].sort((left, right) => left.order - right.order);
  if (!beats.every((beat, index) => beat.order === index)) {
    throw new Error("COMMERCIAL_STORY_CANONICAL_BEAT_ORDER_INVALID");
  }
  const productAuthorityIds = [...new Set(input.productAuthorityIds)].sort((left, right) => left.localeCompare(right));
  const commercialRole = productAuthorityIds.length > 0 ? "PRODUCT" as const : "NONE" as const;
  const opening = requiredText(input.storyDraft.story.opening, "COMMERCIAL_OUTLINE_INITIAL_STATE_AUTHORITY_MISSING", 1000);
  const ending = requiredText(input.storyDraft.story.ending, "COMMERCIAL_OUTLINE_FINAL_STATE_AUTHORITY_MISSING", 1000);
  if (opening.toLowerCase() === ending.toLowerCase()) {
    throw new Error("COMMERCIAL_OUTLINE_STATE_CHANGE_AUTHORITY_MISSING");
  }
  const development = requiredText(input.storyDraft.story.development, "COMMERCIAL_OUTLINE_TURNING_POINT_AUTHORITY_MISSING", 1000);
  const objective = requiredText(input.storyDraft.objective, "COMMERCIAL_OUTLINE_STORY_QUESTION_AUTHORITY_MISSING", 1000);
  const summary = requiredText(input.storyDraft.summary, "COMMERCIAL_OUTLINE_STORY_INTENT_AUTHORITY_MISSING", 2000);
  const objectivePolicy = resolveAiStoryCommercialStoryObjectivePolicy(input.campaignObjective);
  const integrationBeat = beats[Math.min(AI_STORY_COMMERCIAL_STORY_OUTLINE_POLICY_PRODUCER_V1.integrationBeatOrdinal, beats.length - 1)]!;
  const ctaRequired = objectivePolicy.cta === "REQUIRED";
  const actions = beats.map((beat) => requiredText(beat.summary, "COMMERCIAL_OUTLINE_ACTION_AUTHORITY_MISSING", 1000));

  return AiStoryCommercialStoryOutlinePolicySchema.parse({
    campaignObjective: input.campaignObjective,
    storyIntent: summary,
    audienceIntent: requiredText(input.storyDraft.targetAudience, "COMMERCIAL_OUTLINE_AUDIENCE_AUTHORITY_MISSING", 1000),
    desiredEmotion: requiredText(input.storyDraft.tone, "COMMERCIAL_OUTLINE_EMOTION_AUTHORITY_MISSING", 500),
    commercialRole,
    productOrServiceAuthorityRefs: productAuthorityIds,
    integrationPolicy: commercialRole === "NONE" ? "NOT_REQUIRED" : "CAUSAL_REQUIRED",
    ctaPolicy: ctaRequired ? "REQUIRED" : "OPTIONAL",
    brandResolutionPolicy: ctaRequired ? "OPTIONAL" : "REQUIRED",
    userCreativeIntent: chunkNormalizedCreativeIntent(input.originalIdea),
    storyCausality: {
      storyQuestion: objective,
      protagonistOrFocus: requiredText(input.storyDraft.title, "COMMERCIAL_OUTLINE_FOCUS_AUTHORITY_MISSING", 500),
      protagonistKind: AI_STORY_COMMERCIAL_STORY_OUTLINE_POLICY_PRODUCER_V1.protagonistKindWhenUnspecified,
      initialState: opening,
      wantOrNeed: objective,
      obstacleOrTension: development,
      actions,
      turningPoint: development,
      resolution: ending,
      finalState: ending,
      audienceTakeaway: requiredText(input.storyDraft.keyMessages[0] || input.storyDraft.objective, "COMMERCIAL_OUTLINE_TAKEAWAY_AUTHORITY_MISSING", 1000),
    },
    ...(commercialRole === "NONE" ? {} : {
      commercialIntegration: {
        commercialAuthorityRefs: productAuthorityIds,
        integrationType: commercialRole,
        entryPoint: { kind: "BEAT_ID" as const, beatId: integrationBeat.id },
        narrativeFunction: "PRODUCT_INTERVENTION",
        preIntegrationState: opening,
        commercialActionOrParticipation: resolveCommercialActionParticipation(input.originalIdea),
        postIntegrationState: ending,
        storyConsequence: ending,
        audienceUnderstanding: objective,
        naturalnessRationale: development,
      },
    }),
    commercialPayoff: {
      payoffType: ctaRequired ? "CONVERSION" as const : "BRAND_RESOLUTION" as const,
      brandMeaning: requiredText(input.storyDraft.keyMessages[0] || summary, "COMMERCIAL_OUTLINE_BRAND_MEANING_AUTHORITY_MISSING", 1000),
      benefitOrOutcome: ending,
      productOrServiceResolution: ending,
      ctaStrategy: ctaRequired ? "REQUIRED" as const : "BRAND_RESOLUTION" as const,
      ctaTiming: "ENDING" as const,
      packshotPolicy: "OPTIONAL" as const,
      brandVisibilityPolicy: "OPTIONAL" as const,
    },
    marketingIntentKind: AI_STORY_COMMERCIAL_STORY_OUTLINE_POLICY_PRODUCER_V1.marketingIntentWhenAbsent,
  });
}
