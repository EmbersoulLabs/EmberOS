import { z } from "zod";
import {
  AI_STORY_SCENE_FUNCTION_REGISTRY,
  AI_STORY_SCENE_FUNCTION_REGISTRY_VERSION,
  AiStoryScriptStateDeltaSchema,
  AiStoryScriptStateFactSchema,
} from "./ai-story-script";

export const AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION =
  "ai-story-script-semantic-proposal.v1" as const;

const Id = z.string().uuid();
const Text = z.string().trim().min(1);
const SceneFunction = z.enum(
  Object.keys(AI_STORY_SCENE_FUNCTION_REGISTRY) as [
    keyof typeof AI_STORY_SCENE_FUNCTION_REGISTRY,
    ...(keyof typeof AI_STORY_SCENE_FUNCTION_REGISTRY)[],
  ],
);

const ProposalActionEntrySchema = z.object({
  type: z.literal("ACTION"),
  subjectId: Id,
  action: Text.max(2000),
  objectId: Id.optional(),
  storyEffect: Text.max(1000),
  stateDelta: AiStoryScriptStateDeltaSchema.optional(),
}).strict();

const ProposalDialogueEntrySchema = z.object({
  type: z.literal("DIALOGUE"),
  speakerId: Id,
  line: Text.max(4000),
  deliveryOrSubtext: Text.max(1000).optional(),
  language: Text.max(50),
}).strict();

const ProposalVoEntrySchema = z.object({
  type: z.literal("VO"),
  voiceOwnerId: Id,
  line: Text.max(4000),
  narrativePurpose: Text.max(1000),
  language: Text.max(50),
}).strict();

export const AiStoryScriptSemanticProposalEntryV1Schema = z.discriminatedUnion("type", [
  ProposalActionEntrySchema,
  ProposalDialogueEntrySchema,
  ProposalVoEntrySchema,
]);

export const AiStoryScriptSemanticProposalSceneV1Schema = z.object({
  scenePlanItemId: Text.max(500),
  sceneFunction: SceneFunction,
  sceneFunctionRegistryVersion: z.literal(AI_STORY_SCENE_FUNCTION_REGISTRY_VERSION),
  sceneStateIn: z.array(AiStoryScriptStateFactSchema),
  sceneStateDeltas: z.array(AiStoryScriptStateDeltaSchema),
  sceneStateOut: z.array(AiStoryScriptStateFactSchema),
  entries: z.array(AiStoryScriptSemanticProposalEntryV1Schema).min(1),
  newInformation: z.array(Text.max(1000)),
  newActionOutcomes: z.array(Text.max(1000)),
}).strict();

/** Proposal only: canonical Script/Scene/Entry identity is deliberately absent. */
export const AiStoryScriptSemanticProposalV1Schema = z.object({
  contractVersion: z.literal(AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION),
  scenes: z.array(AiStoryScriptSemanticProposalSceneV1Schema).min(1),
}).strict();

export type AiStoryScriptSemanticProposalV1 = z.infer<
  typeof AiStoryScriptSemanticProposalV1Schema
>;
export type AiStoryScriptSemanticProposalSceneV1 = z.infer<
  typeof AiStoryScriptSemanticProposalSceneV1Schema
>;
