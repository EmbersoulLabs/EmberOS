import { z } from "zod";
import { StoryBeatSchema } from "./ai-story";
import {
  AiStoryOutlineBeatSchema,
  type AiStoryOutlineProfileReference,
} from "./ai-story-outline";
import { AiStoryOutlineProfileReferenceSchema } from "./ai-story-outline-profile";
import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";

export const AI_STORY_OUTLINE_BEAT_PROMOTION_POLICY_V1 = Object.freeze({
  policyId: "AI_STORY_OUTLINE_BEAT_PROMOTION_POLICY",
  policyVersion: 1,
  contractVersion: "ai-story-outline-beat-promotion-policy.v1",
  classification: "MAJOR",
  required: true,
  ownershipPolicy: "EXCLUSIVE",
  storyUnitPolicy: "NONE",
  beatAuthorityReferencePolicy: "NONE_AT_BASIS",
} as const);

const CanonicalOutlineBeatBasisInputSchema = z.object({
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  profile: AiStoryOutlineProfileReferenceSchema,
  proposedStoryBeats: z.array(StoryBeatSchema.strict()).min(1),
}).strict();

export type CanonicalOutlineBeatBasisInput = {
  storyId: string;
  storyVersionId: string;
  profile: AiStoryOutlineProfileReference;
  proposedStoryBeats: z.input<typeof StoryBeatSchema>[];
};

export type CanonicalOutlineBeatBasis = z.infer<typeof AiStoryOutlineBeatSchema>[];

/**
 * Promotes validated top-level Story Beat proposals into the canonical V1
 * Outline Beat basis. Proposal identity and all caller-supplied authority
 * fields are rejected; policy-owned fields are applied without inference.
 */
export function buildCanonicalOutlineBeatBasis(
  rawInput: CanonicalOutlineBeatBasisInput,
): CanonicalOutlineBeatBasis {
  const input = CanonicalOutlineBeatBasisInputSchema.parse(rawInput);

  input.proposedStoryBeats.forEach((beat, index) => {
    if (beat.order !== index) {
      throw new Error("CANONICAL_OUTLINE_BEAT_ORDER_INVALID");
    }
  });

  return input.proposedStoryBeats.map((beat) => {
    const semanticFingerprint = sha256CanonicalIntegrityHash({
      policy: AI_STORY_OUTLINE_BEAT_PROMOTION_POLICY_V1.contractVersion,
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      order: beat.order,
      name: beat.name,
      purpose: beat.purpose,
      summary: beat.summary,
    });

    return AiStoryOutlineBeatSchema.parse({
      id: deterministicUuidFromFingerprint(
        "ai-story-outline-beat",
        semanticFingerprint,
      ),
      order: beat.order,
      name: beat.name,
      purpose: beat.purpose,
      summary: beat.summary,
      classification: AI_STORY_OUTLINE_BEAT_PROMOTION_POLICY_V1.classification,
      required: AI_STORY_OUTLINE_BEAT_PROMOTION_POLICY_V1.required,
      ownershipPolicy: AI_STORY_OUTLINE_BEAT_PROMOTION_POLICY_V1.ownershipPolicy,
      authorityReferences: [],
    });
  });
}
