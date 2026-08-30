import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import { AI_STORY_SCRIPT_CONTRACT_VERSION, AiStoryScriptVersionSchema, type AiStoryScriptVersion } from "./ai-story-script";

export type CreateAiStoryScriptInput = Omit<AiStoryScriptVersion, "scriptVersionId" | "contractVersion" | "sourceHash" | "status" | "approvedBy" | "approvedAt" | "frozenAt">;

export function computeAiStoryScriptSourceHash(input: Pick<AiStoryScriptVersion, "storyId" | "storyVersionId" | "outlineVersionId" | "outlineSourceHash" | "profileId" | "profileVersion" | "scenes" | "authorityReferences">) {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_SCRIPT_CONTRACT_VERSION,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    outlineVersionId: input.outlineVersionId,
    outlineSourceHash: input.outlineSourceHash,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    scenes: input.scenes,
    authorityReferences: input.authorityReferences,
  });
}

export function buildAiStoryScriptVersion(input: CreateAiStoryScriptInput): AiStoryScriptVersion {
  const sourceHash = computeAiStoryScriptSourceHash(input);
  return AiStoryScriptVersionSchema.parse({
    ...input,
    scriptVersionId: deterministicUuidFromFingerprint("ai-story-script-version", `${input.storyId}:${input.version}:${sourceHash}`),
    contractVersion: AI_STORY_SCRIPT_CONTRACT_VERSION,
    sourceHash,
    status: "DRAFT",
    approvedBy: null,
    approvedAt: null,
    frozenAt: null,
  });
}
