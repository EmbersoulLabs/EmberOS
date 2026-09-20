import {
  AiStoryOutlineVersionSchema,
  buildAiStoryCommercialStoryWriterGuidance,
  buildAiStoryProductStoryWriterGuidance,
  type AiStoryOutlineVersion,
} from "@ceo-agent/shared";

/**
 * Resolves Writer guidance from canonical Outline profile authority.
 * It is provider-neutral, contains no prompt dispatch, and never replaces Core validation.
 */
export function resolveAiStoryWriterProfileGuidance(raw: AiStoryOutlineVersion) {
  const outline = AiStoryOutlineVersionSchema.parse(raw);
  if (outline.profile.profileId === "CORE") {
    return Object.freeze({ kind: "CORE" as const, profileId: "CORE" as const, profileVersion: 1 as const });
  }
  if (outline.profile.profileId === "COMMERCIAL_STORY") {
    return Object.freeze({
      kind: "COMMERCIAL_STORY" as const,
      ...buildAiStoryCommercialStoryWriterGuidance(outline.commercialStoryProfile!),
    });
  }
  return Object.freeze({
    kind: "PRODUCT_STORY" as const,
    ...buildAiStoryProductStoryWriterGuidance(outline.productStoryProfile!),
  });
}
