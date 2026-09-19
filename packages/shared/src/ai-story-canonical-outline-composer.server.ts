import { z } from "zod";
import { AiStoryStructuredDraftSchema, StoryBeatSchema } from "./ai-story";
import {
  AiStoryOutlineAuthorityReferenceSchema,
  type AiStoryOutlineVersion,
} from "./ai-story-outline";
import { AiStoryProductStoryProfileReferenceSchema } from "./ai-story-product-story-profile";
import { CAMPAIGN_OBJECTIVE_IDS } from "./create-campaign";
import { buildAiStoryOutlineVersion } from "./ai-story-outline.server";
import { buildCanonicalOutlineBeatBasis } from "./ai-story-outline-beat-promotion.server";
import { buildAiStoryProductStoryOutlinePolicyV1 } from "./ai-story-product-story-outline-policy.server";

export const AI_STORY_CANONICAL_OUTLINE_COMPOSER_V1 = Object.freeze({
  policyId: "AI_STORY_CANONICAL_OUTLINE_COMPOSER",
  policyVersion: 1,
  contractVersion: "ai-story-canonical-outline-composer.v1",
  premiseSource: "FROZEN_STORY_DRAFT_SUMMARY",
  coreClaimSource: "FROZEN_STORY_DRAFT_OBJECTIVE",
  storyUnitsPolicy: "NONE",
  hooksPolicy: "NONE",
  setupPayoffsPolicy: "NONE",
  requiredSceneOutcomesPolicy: "NONE",
  upstreamAuthority: "STORY_VERSION",
} as const);

const CharacterAuthoritySchema = z.object({
  characterId: z.string().uuid(),
  characterVersionId: z.string().uuid(),
  characterFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict();

const ComposerInputSchema = z.object({
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  orgId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  campaignId: z.string().uuid(),
  version: z.number().int().positive(),
  profile: AiStoryProductStoryProfileReferenceSchema,
  storyDraft: AiStoryStructuredDraftSchema,
  proposedStoryBeats: z.array(StoryBeatSchema.strict()).min(1),
  campaignObjective: z.enum(CAMPAIGN_OBJECTIVE_IDS),
  customObjective: z.string().trim().min(1).max(500).nullable(),
  productAuthorityIds: z.array(z.string().uuid()).min(1),
  characterAuthorities: z.array(CharacterAuthoritySchema),
  originalIdea: z.string().trim().min(1).max(8000),
  supersedesOutlineVersionId: z.string().uuid().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
}).strict();

export type AiStoryCanonicalOutlineComposerV1Input = z.input<typeof ComposerInputSchema>;

function authorityReferences(input: z.infer<typeof ComposerInputSchema>) {
  return [
    AiStoryOutlineAuthorityReferenceSchema.parse({
      authorityType: "CAMPAIGN",
      authorityId: input.campaignId,
    }),
    ...[...new Set(input.productAuthorityIds)].map((authorityId) =>
      AiStoryOutlineAuthorityReferenceSchema.parse({ authorityType: "PRODUCT", authorityId })
    ),
    ...input.characterAuthorities.map((character) =>
      AiStoryOutlineAuthorityReferenceSchema.parse({
        authorityType: "CHARACTER",
        authorityId: character.characterId,
        authorityVersionId: character.characterVersionId,
        authorityFingerprint: character.characterFingerprint,
      })
    ),
  ].sort((left, right) =>
    `${left.authorityType}:${left.authorityId}`.localeCompare(`${right.authorityType}:${right.authorityId}`)
  );
}

/** Pure V1 composition. All semantic inputs are already-resolved server authority. */
export function composeAiStoryCanonicalOutlineV1(
  rawInput: AiStoryCanonicalOutlineComposerV1Input,
): AiStoryOutlineVersion {
  const input = ComposerInputSchema.parse(rawInput);
  const beats = buildCanonicalOutlineBeatBasis({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    profile: input.profile,
    proposedStoryBeats: input.proposedStoryBeats,
  });
  const productStoryProfile = buildAiStoryProductStoryOutlinePolicyV1({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    profile: input.profile,
    campaignObjective: input.campaignObjective,
    customObjective: input.customObjective,
    productAuthorityIds: [...new Set(input.productAuthorityIds)].sort((a, b) => a.localeCompare(b)),
    canonicalBeats: beats,
    originalIdea: input.originalIdea,
  });

  if (!input.storyDraft.summary.trim()) throw new Error("CANONICAL_OUTLINE_PREMISE_AUTHORITY_MISSING");
  if (!input.storyDraft.objective.trim()) throw new Error("CANONICAL_OUTLINE_CORE_CLAIM_AUTHORITY_MISSING");

  return buildAiStoryOutlineVersion({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    version: input.version,
    profile: input.profile,
    productStoryProfile,
    premise: input.storyDraft.summary,
    coreClaim: input.storyDraft.objective,
    storyUnits: [],
    beats,
    hooks: [],
    setupPayoffs: [],
    requiredSceneOutcomes: [],
    authorityReferences: authorityReferences(input),
    upstreamAuthorityId: input.storyVersionId,
    supersedesOutlineVersionId: input.supersedesOutlineVersionId,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  });
}
