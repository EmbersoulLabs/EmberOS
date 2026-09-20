import { z } from "zod";
import {
  AI_STORY_COMMERCIAL_STORY_PROFILE_ID,
  AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_COMMERCIAL_STORY_PROFILE_VERSION,
  AiStoryCommercialStoryProfileReferenceSchema,
} from "./ai-story-commercial-story-profile";
import {
  AI_STORY_PRODUCT_STORY_PROFILE_ID,
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_PRODUCT_STORY_PROFILE_VERSION,
  AiStoryProductStoryProfileReferenceSchema,
} from "./ai-story-product-story-profile";

export const AiStoryOutlineCoreProfileReferenceSchema = z.object({
  profileId: z.literal("CORE"),
  profileVersion: z.literal(1),
}).strict();

/** Registered V1 Outline Profile reference authority. */
export const AiStoryOutlineProfileReferenceSchema = z.union([
  AiStoryOutlineCoreProfileReferenceSchema,
  AiStoryProductStoryProfileReferenceSchema,
  AiStoryCommercialStoryProfileReferenceSchema,
]);

export type AiStoryOutlineProfileReference = z.infer<
  typeof AiStoryOutlineProfileReferenceSchema
>;

export const AI_STORY_OUTLINE_PROFILE_REGISTRY = Object.freeze({
  CORE: Object.freeze({ profileId: "CORE" as const, profileVersion: 1 as const, hookRequired: false }),
  PRODUCT_STORY: Object.freeze({
    profileId: AI_STORY_PRODUCT_STORY_PROFILE_ID,
    profileVersion: AI_STORY_PRODUCT_STORY_PROFILE_VERSION,
    policyFingerprint: AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
    hookRequired: false,
  }),
  COMMERCIAL_STORY: Object.freeze({
    profileId: AI_STORY_COMMERCIAL_STORY_PROFILE_ID,
    profileVersion: AI_STORY_COMMERCIAL_STORY_PROFILE_VERSION,
    policyFingerprint: AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
    hookRequired: true,
  }),
});

/** Reconstructs the registered reference so policy identity is always server-owned. */
export function canonicalAiStoryOutlineProfileReference(
  profile: AiStoryOutlineProfileReference
): AiStoryOutlineProfileReference {
  const registered = AI_STORY_OUTLINE_PROFILE_REGISTRY[profile.profileId];
  return AiStoryOutlineProfileReferenceSchema.parse(
    registered.profileId === "CORE"
      ? { profileId: registered.profileId, profileVersion: registered.profileVersion }
      : {
          profileId: registered.profileId,
          profileVersion: registered.profileVersion,
          policyFingerprint: registered.policyFingerprint,
        }
  );
}
