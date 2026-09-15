import { callJsonModel } from "../llm";
import { z } from "zod";
import {
  AI_STORY_SCENE_FUNCTION_REGISTRY,
  AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
  AiStoryOutlineVersionSchema,
  AiStoryScriptSemanticProposalV1Schema,
  AiStoryStructuredDraftSchema,
  CreativeContextSchema,
  DirectorThinkingSchema,
  PlanningCharacterAuthorityProjectionSchema,
  ScenePlanItemSchema,
  StoryBeatSchema,
  type AiStoryOutlineVersion,
  type AiStoryScriptSemanticProposalV1,
  type AiStoryStructuredDraft,
  type CreativeContext,
  type DirectorThinking,
  type PlanningCharacterAuthorityProjection,
  type PlanningUsage,
  type ScenePlanItem,
  type StoryBeat,
} from "@ceo-agent/shared";

export type GenerateAiStoryScriptSemanticProposalV1Input = {
  frozenOutline: AiStoryOutlineVersion;
  story: AiStoryStructuredDraft;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  characterAuthorities: PlanningCharacterAuthorityProjection[];
  productAuthorityIds: string[];
};

/** One proposal-only structured planning call. Canonical identity is added downstream. */
export async function generateAiStoryScriptSemanticProposalV1(
  rawInput: GenerateAiStoryScriptSemanticProposalV1Input,
): Promise<{ semanticProposal: AiStoryScriptSemanticProposalV1; usage: PlanningUsage }> {
  const input = {
    frozenOutline: AiStoryOutlineVersionSchema.parse(rawInput.frozenOutline),
    story: AiStoryStructuredDraftSchema.parse(rawInput.story),
    storyBeats: StoryBeatSchema.array().min(1).parse(rawInput.storyBeats),
    scenePlan: ScenePlanItemSchema.array().min(1).parse(rawInput.scenePlan),
    creativeContext: CreativeContextSchema.parse(rawInput.creativeContext),
    directorThinking: DirectorThinkingSchema.parse(rawInput.directorThinking),
    characterAuthorities: PlanningCharacterAuthorityProjectionSchema.array().parse(rawInput.characterAuthorities),
    productAuthorityIds: z.array(z.string().uuid()).min(1).parse([...new Set(rawInput.productAuthorityIds)].sort()),
  };
  if (input.frozenOutline.status !== "FROZEN") throw new Error("CANONICAL_SCRIPT_FROZEN_OUTLINE_REQUIRED");
  const outlineProductIds = [...(input.frozenOutline.productStoryProfile?.productAuthorityIds ?? [])].sort();
  if (JSON.stringify(input.productAuthorityIds) !== JSON.stringify(outlineProductIds)) {
    throw new Error("CANONICAL_SCRIPT_PRODUCT_AUTHORITY_MISMATCH");
  }
  const schemaHint = JSON.stringify({
    contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
    scenes: [{
      scenePlanItemId: "exact supplied Scene Plan proposal id",
      sceneFunction: `one of: ${Object.keys(AI_STORY_SCENE_FUNCTION_REGISTRY).join(" | ")}`,
      sceneFunctionRegistryVersion: 1,
      sceneStateIn: [], sceneStateDeltas: [], sceneStateOut: [],
      entries: [{ type: "ACTION", subjectId: "exact supplied UUID", action: "string", storyEffect: "string" }],
      newInformation: [], newActionOutcomes: [],
    }],
  });
  const { result, usage } = await callJsonModel<unknown>(
    [
      "You are the AI Story V1 Script Semantic Writer. Produce semantic proposal data only.",
      "Cover every supplied Scene Plan item exactly once; never add, remove, merge, or duplicate Scenes.",
      "Use only exact supplied entity IDs. Never invent Character identity, Product identity, claims, or evidence.",
      "Choose sceneFunction only from the supplied Script Scene Function registry represented by the schema.",
      "Do not create canonical Script Scene IDs, Entry IDs, Script versions, provider prompts, shots, or video instructions.",
      "Return JSON only and no extra fields.",
    ].join(" "),
    JSON.stringify(input, null, 2),
    schemaHint,
  );
  return { semanticProposal: AiStoryScriptSemanticProposalV1Schema.parse(result), usage };
}
