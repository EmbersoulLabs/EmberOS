import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import { AI_STORY_OUTLINE_CONTRACT_VERSION, AiStoryOutlineVersionSchema, type AiStoryOutlineVersion } from "./ai-story-outline";

export type CreateAiStoryOutlineInput = Omit<AiStoryOutlineVersion, "outlineVersionId" | "contractVersion" | "sourceHash" | "status" | "approvedBy" | "approvedAt" | "frozenAt">;

export function computeAiStoryOutlineSourceHash(input: Pick<AiStoryOutlineVersion,
  "storyId" | "storyVersionId" | "upstreamAuthorityId" | "profile" | "premise" | "coreClaim" |
  "storyUnits" | "beats" | "hooks" | "setupPayoffs" | "requiredSceneOutcomes" | "authorityReferences"
>) {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_OUTLINE_CONTRACT_VERSION,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    upstreamAuthorityId: input.upstreamAuthorityId,
    profile: input.profile,
    premise: input.premise,
    coreClaim: input.coreClaim,
    storyUnits: input.storyUnits,
    beats: input.beats,
    hooks: input.hooks,
    setupPayoffs: input.setupPayoffs,
    requiredSceneOutcomes: input.requiredSceneOutcomes,
    authorityReferences: input.authorityReferences,
  });
}

export function buildAiStoryOutlineVersion(input: CreateAiStoryOutlineInput): AiStoryOutlineVersion {
  const sourceHash = computeAiStoryOutlineSourceHash(input);
  return AiStoryOutlineVersionSchema.parse({
    ...input,
    outlineVersionId: deterministicUuidFromFingerprint("ai-story-outline-version", `${input.storyId}:${input.version}:${sourceHash}`),
    contractVersion: AI_STORY_OUTLINE_CONTRACT_VERSION,
    sourceHash,
    status: "DRAFT",
    approvedBy: null,
    approvedAt: null,
    frozenAt: null,
  });
}
