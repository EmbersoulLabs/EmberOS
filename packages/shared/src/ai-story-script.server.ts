import { z } from "zod";
import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import { AI_STORY_SCRIPT_CONTRACT_VERSION, AiStoryScriptVersionSchema, type AiStoryScriptVersion } from "./ai-story-script";
import {
  AiStoryStructuredDraftSchema,
  CreativeContextSchema,
  DirectorThinkingSchema,
  PlanningCharacterAuthorityProjectionSchema,
  ScenePlanItemSchema,
  StoryBeatSchema,
  type AiStoryStructuredDraft,
  type CreativeContext,
  type DirectorThinking,
  type PlanningCharacterAuthorityProjection,
  type ScenePlanItem,
  type StoryBeat,
} from "./ai-story";
import { AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION } from "./ai-story-script-semantic-writer";
import { AI_STORY_SCRIPT_SEMANTIC_PROMOTION_POLICY_V1 } from "./ai-story-script-semantic-writer.server";

export type CreateAiStoryScriptInput = Omit<AiStoryScriptVersion, "scriptVersionId" | "contractVersion" | "sourceHash" | "status" | "approvedBy" | "approvedAt" | "frozenAt">;

export const AI_STORY_SCRIPT_SEMANTIC_INPUT_CONTRACT_VERSION = "ai-story-script-semantic-input.v1" as const;

export type AiStoryScriptSemanticInputFingerprintInput = {
  storyId: string;
  storyVersionId: string;
  outlineVersionId: string;
  outlineSourceHash: string;
  story: AiStoryStructuredDraft;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  characterAuthorities: PlanningCharacterAuthorityProjection[];
  productAuthorityIds: string[];
};

const AiStoryScriptSemanticInputFingerprintSchema = z.object({
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  outlineVersionId: z.string().uuid(),
  outlineSourceHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  story: AiStoryStructuredDraftSchema,
  storyBeats: StoryBeatSchema.array().min(1),
  scenePlan: ScenePlanItemSchema.array().min(1),
  creativeContext: CreativeContextSchema,
  directorThinking: DirectorThinkingSchema,
  characterAuthorities: PlanningCharacterAuthorityProjectionSchema.array(),
  productAuthorityIds: z.array(z.string().uuid()).min(1),
}).strict();

/** Canonical pre-model provenance for one Script semantic generation input. */
export function computeAiStoryScriptSemanticInputFingerprint(raw: AiStoryScriptSemanticInputFingerprintInput) {
  const parsed = AiStoryScriptSemanticInputFingerprintSchema.parse(raw);
  const input = {
    ...parsed,
    characterAuthorities: parsed.characterAuthorities
      .sort((left, right) => left.characterId.localeCompare(right.characterId)),
    productAuthorityIds: [...new Set(parsed.productAuthorityIds)].sort(),
  };
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_SCRIPT_SEMANTIC_INPUT_CONTRACT_VERSION,
    semanticProposalContractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
    semanticPromotionPolicy: AI_STORY_SCRIPT_SEMANTIC_PROMOTION_POLICY_V1,
    ...input,
  });
}

export function computeAiStoryScriptSourceHash(input: Pick<AiStoryScriptVersion, "storyId" | "storyVersionId" | "outlineVersionId" | "outlineSourceHash" | "profileId" | "profileVersion" | "semanticInputFingerprint" | "scenes" | "authorityReferences">) {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_SCRIPT_CONTRACT_VERSION,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    outlineVersionId: input.outlineVersionId,
    outlineSourceHash: input.outlineSourceHash,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    ...(input.semanticInputFingerprint ? { semanticInputFingerprint: input.semanticInputFingerprint } : {}),
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
