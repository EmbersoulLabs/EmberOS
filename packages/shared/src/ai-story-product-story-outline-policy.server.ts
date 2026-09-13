import { z } from "zod";
import {
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_PRODUCT_STORY_PROFILE_VERSION,
  AiStoryProductStoryOutlinePolicySchema,
  AiStoryProductStoryProfileReferenceSchema,
  resolveAiStoryProductStoryObjectivePolicy,
  type AiStoryProductStoryOutlinePolicy,
} from "./ai-story-product-story-profile";
import { AiStoryOutlineBeatSchema } from "./ai-story-outline";
import { buildCanonicalOutlineBeatBasis } from "./ai-story-outline-beat-promotion.server";
import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";
import { CAMPAIGN_OBJECTIVE_IDS, type CampaignObjectiveId } from "./create-campaign";

const OBJECTIVE_ADVANCE_FUNCTION = Object.freeze({
  awareness: "PRODUCT_DETAIL_REVEAL",
  engagement: "PRODUCT_RELATIONSHIP",
  sales: "PRODUCT_EVIDENCE",
  lead_generation: "PRODUCT_EVIDENCE",
  other: "PRODUCT_CONTEXT",
} as const satisfies Record<CampaignObjectiveId, string>);

const GOAL_INTENT = Object.freeze({
  PRODUCT_INTRODUCTION: "Establish the selected Product as a canonical subject of the story.",
  PRODUCT_DETAIL_REVEAL: "Reveal additional Product detail without inventing unsupported claims.",
  PRODUCT_RELATIONSHIP: "Develop the Product's relationship to the story context.",
  PRODUCT_EVIDENCE: "Use only authority-supported Product evidence.",
  PRODUCT_CONTEXT: "Place the Product in meaningful story context.",
} as const);

export const AI_STORY_PRODUCT_STORY_OUTLINE_POLICY_PRODUCER_V1 = Object.freeze({
  policyId: "AI_STORY_PRODUCT_STORY_OUTLINE_POLICY_PRODUCER",
  policyVersion: 1,
  contractVersion: "ai-story-product-story-outline-policy-producer.v1",
  profileVersion: AI_STORY_PRODUCT_STORY_PROFILE_VERSION,
  profilePolicyFingerprint: AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  introductionFunction: "PRODUCT_INTRODUCTION",
  objectiveAdvanceFunction: OBJECTIVE_ADVANCE_FUNCTION,
  progressionGoalCount: 2,
  claimEvidencePolicy: "NONE_UNTIL_CANONICAL_CLAIM_AUTHORITY",
  packshotPolicy: "OPTIONAL",
  userCreativeIntentSource: "NORMALIZED_STORY_ORIGINAL_IDEA_LOSSLESS_CHUNKS",
} as const);

const ProductStoryOutlinePolicyProducerInputSchema = z.object({
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  profile: AiStoryProductStoryProfileReferenceSchema,
  campaignObjective: z.enum(CAMPAIGN_OBJECTIVE_IDS),
  customObjective: z.string().trim().min(1).max(500).nullable(),
  productAuthorityIds: z.array(z.string().uuid()).min(1).superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Product authority IDs must be unique" });
    }
  }),
  canonicalBeats: z.array(AiStoryOutlineBeatSchema).min(1),
  originalIdea: z.string().trim().min(1).max(8000),
}).strict();

export type AiStoryProductStoryOutlinePolicyProducerV1Input = {
  storyId: string;
  storyVersionId: string;
  profile: z.input<typeof AiStoryProductStoryProfileReferenceSchema>;
  campaignObjective: CampaignObjectiveId;
  customObjective: string | null;
  productAuthorityIds: string[];
  canonicalBeats: z.input<typeof AiStoryOutlineBeatSchema>[];
  originalIdea: string;
};

function assertCanonicalBeatBasis(input: {
  storyId: string;
  storyVersionId: string;
  profile: z.input<typeof AiStoryProductStoryProfileReferenceSchema>;
  canonicalBeats: z.infer<typeof AiStoryOutlineBeatSchema>[];
}) {
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
    throw new Error("PRODUCT_STORY_CANONICAL_BEAT_AUTHORITY_INVALID");
  }
}

function previousUnicodeBoundary(value: string, index: number) {
  if (index > 0 && index < value.length) {
    const current = value.charCodeAt(index);
    const previous = value.charCodeAt(index - 1);
    if (current >= 0xdc00 && current <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) {
      return index - 1;
    }
  }
  return index;
}

function chunkNormalizedCreativeIntent(value: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = previousUnicodeBoundary(value, Math.min(start + 1000, value.length));
    if (end < value.length) {
      while (end > start && (/\s/u.test(value[end - 1]!) || /\s/u.test(value[end]!))) {
        end = previousUnicodeBoundary(value, end - 1);
      }
      if (end === start) {
        throw new Error("PRODUCT_STORY_USER_CREATIVE_INTENT_UNCHUNKABLE");
      }
    }
    const chunk = value.slice(start, end);
    if (chunk.length > 1000 || chunk.trim() !== chunk || chunk.length === 0) {
      throw new Error("PRODUCT_STORY_USER_CREATIVE_INTENT_UNCHUNKABLE");
    }
    chunks.push(chunk);
    start = end;
  }
  return chunks;
}

function progressionGoalId(input: {
  storyId: string;
  storyVersionId: string;
  semanticFunction: keyof typeof GOAL_INTENT;
  beatIds: string[];
}) {
  const fingerprint = sha256CanonicalIntegrityHash({
    producer: AI_STORY_PRODUCT_STORY_OUTLINE_POLICY_PRODUCER_V1.contractVersion,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    semanticFunction: input.semanticFunction,
    beatIds: input.beatIds,
  });
  return deterministicUuidFromFingerprint("ai-story-product-story-progression-goal", fingerprint);
}

/** Builds the immutable, deterministic V1 Product Story Outline policy projection. */
export function buildAiStoryProductStoryOutlinePolicyV1(
  rawInput: AiStoryProductStoryOutlinePolicyProducerV1Input,
): AiStoryProductStoryOutlinePolicy {
  const input = ProductStoryOutlinePolicyProducerInputSchema.parse(rawInput);
  if (input.campaignObjective === "other" && !input.customObjective) {
    throw new Error("PRODUCT_STORY_CUSTOM_OBJECTIVE_AUTHORITY_MISSING");
  }
  assertCanonicalBeatBasis(input);

  const canonicalBeats = [...input.canonicalBeats].sort((a, b) => a.order - b.order);
  if (!canonicalBeats.every((beat, index) => beat.order === index)) {
    throw new Error("PRODUCT_STORY_CANONICAL_BEAT_ORDER_INVALID");
  }
  const firstBeatId = canonicalBeats[0]!.id;
  const lastBeatId = canonicalBeats.at(-1)!.id;
  const advanceFunction = OBJECTIVE_ADVANCE_FUNCTION[input.campaignObjective];
  const goalInputs = [
    { semanticFunction: "PRODUCT_INTRODUCTION" as const, beatIds: [firstBeatId] },
    { semanticFunction: advanceFunction, beatIds: [lastBeatId] },
  ];
  const progressionGoals = goalInputs.map((goal) => ({
    goalId: progressionGoalId({
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      semanticFunction: goal.semanticFunction,
      beatIds: goal.beatIds,
    }),
    semanticFunction: goal.semanticFunction,
    required: true,
    beatIds: goal.beatIds,
    requiredSceneOutcomeIds: [],
    intent: GOAL_INTENT[goal.semanticFunction],
  }));
  const objectivePolicy = resolveAiStoryProductStoryObjectivePolicy(input.campaignObjective);

  return AiStoryProductStoryOutlinePolicySchema.parse({
    campaignObjective: input.campaignObjective,
    customObjective: input.campaignObjective === "other" ? input.customObjective : null,
    productAuthorityIds: [...input.productAuthorityIds].sort((a, b) => a.localeCompare(b)),
    progressionGoals,
    claimEvidence: [],
    ctaPolicy: objectivePolicy.cta,
    packshotPolicy: AI_STORY_PRODUCT_STORY_OUTLINE_POLICY_PRODUCER_V1.packshotPolicy,
    userCreativeIntent: chunkNormalizedCreativeIntent(input.originalIdea),
  });
}
